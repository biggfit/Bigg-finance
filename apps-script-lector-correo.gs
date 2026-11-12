// ─────────────────────────────────────────────────────────────────────────────
// BIGG Lector de Correo — Apps Script INDEPENDIENTE, uno por casilla (pagos.es@ / pagos@)
// ─────────────────────────────────────────────────────────────────────────────
//
// Qué hace:
//   - Corre DENTRO de la casilla (se crea el proyecto logueado como pagos.es@bigg.fit): lee su propia
//     bandeja con permiso de solo lectura. Sin delegación, sin reenvíos, sin cron: se dispara con el
//     botón "Leer el buzón" de Reportes › Correo (GET ?accion=leer).
//   - Por cada mail con factura (PDF adjunto o remitente conocido): identifica al proveedor, extrae
//     número, fecha, vencimiento, total e IVA y la sede, y la PARKEA en nb_comprobantes como subtipo
//     EGRESO_BORRADOR. El equipo la contabiliza o ignora desde la bandeja.
//   - Extracción (v6): Gemini lee el PDF entero y devuelve un JSON con esquema (las facturas de España no son
//     electrónicas y cada proveedor cambia de plantilla: los patrones no escalan). El modelo SOLO extrae datos;
//     proveedor, cuenta y centro siguen saliendo de las reglas del Sheet. Sin GEMINI_KEY, o si la API falla,
//     se usa la extracción por patrones sobre el texto del PDF (Drive) y el cuerpo del mail, como antes.
//   - NUNCA contabiliza, NUNCA marca leído, etiqueta, archiva ni borra nada del mail.
//
// De dónde salen las reglas: SIEMPRE del Sheet, el script no tiene ninguna adentro.
//   - nb_banco_reglas (Maestros › Reglas de banco), match_tipo:
//       remitente  → "contiene" sobre el mail del remitente REAL (en un reenvío, el "De:" original)
//       asunto     → "contiene" sobre el asunto (sin Fwd:/RV:/Re:)
//       sede       → texto que identifica la sede en asunto/cuerpo/PDF → centro_costo
//     La regla aporta proveedor_id, cuenta_contable y centro_costo. Gana la coincidencia más larga.
//     accion = "ignorar" → el mail se descarta (newsletters, avisos, portales que no mandan la factura).
//   - nb_proveedores.remitenteMail → fallback de proveedor; cuentaDefault / ccDefault → fallback de imputación.
//   - Sin regla de sede que matchee (o con varias), el centro queda vacío y lo elige el equipo en la bandeja.
//   Las reglas relevadas el 11/11/2026 ya están cargadas en el Sheet (ids REG-ML-*); se editan desde Maestros.
//
// Dedup (tres candados, en este orden):
//   1. id_comp = COR-<mailId>[-k]  (k = índice del PDF cuando un mail trae varios, ej. Grenke)
//   2. nº de factura normalizado + mismo proveedor contra los EGRESO reales
//   3. mismo proveedor + mismo total + mismo mes de servicio (NO ±días: los recurrentes repiten importe)
//
// No toca la planilla directo: lee y escribe por la API del GAS de Numbers (mismo formato que la app).
//
// PUESTA EN MARCHA: ver docs/lector-correo.md
//
// Propiedades del script (Configuración del proyecto → Propiedades del script):
//   NUMBERS_URL    URL /exec del Apps Script de BIGG Numbers (= VITE_NUMBERS_API_URL)
//   NUMBERS_TOKEN  token del GAS de Numbers (= VITE_SHEETS_TOKEN). También autentica el botón.
//   SOCIEDAD       id de sociedad de Numbers para este buzón (pagos.es@ → "wellness")
//   MONEDA         "EUR" (pagos@ → "ARS")
//   PAIS           "ES" (reglas con pais vacío o igual a este)
//   FECHA_CORTE    "2026-10-01": no se mira nada anterior (facturas viejas reenviadas en lote, etc.)
//   BUZON          "pagos.es@bigg.fit" (va en la nota → el link "Ver mail" abre la casilla correcta)
//   Opcionales (tienen valor por defecto):
//   INTERNOS       dominios internos separados por coma ("bigg.fit"): en un reenvío se busca el "De:" original
//   IVA_DEFAULT    % de IVA cuando la factura no lo dice ("21")
//   PALABRAS_FACTURA   expresión regular: qué hace que un mail sin regla cuente como factura
//   PALABRAS_DESCARTE  expresión regular: asuntos que se descartan aunque traigan PDF (catálogos, ofertas…)
//   PALABRAS_PDF_DESCARTE  expresión regular: nombres de PDF que no son facturas (certificado, contrato, IPC…)
//   PARKEAR_SIN_PDF    "1" para parkear también mails sin PDF de proveedores conocidos (por defecto no:
//                      avisos, pedidos y conversaciones del proveedor no son facturas)
//   MAX_PDFS_POR_MAIL  más PDF que esto en un mail = lote (históricos, regularizaciones): se reporta, no se parkea ("6")
//   GEMINI_KEY         clave de la API de Gemini (Google AI Studio). Sin clave → extracción por patrones.
//   GEMINI_MODEL       modelo ("gemini-3.1-flash-lite"). Se cambia acá, sin tocar el código.
//   NOMBRE_REMITENTE   nombre con el que salen los acuses de recibo ("Administración BIGG España").
// Servicio avanzado requerido: Drive API (v2/v3) — solo para el fallback por patrones (texto del PDF vía Doc).
// ─────────────────────────────────────────────────────────────────────────────

const TZ = "Europe/Madrid";
const MAX_MS_POR_CORRIDA = 45000;      // el proxy de Vercel corta a los 60 s → devolvemos parcial y el botón sigue
const MAX_PDF_BYTES      = 5 * 1024 * 1024;   // catálogos y dossiers no son facturas

// ── Config ────────────────────────────────────────────────────────────────────

function cfg_(k, def) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (v === null || v === "") { if (def !== undefined) return def; throw new Error("Falta la propiedad del script " + k); }
  return v;
}
const dominiosInternos_ = () => cfg_("INTERNOS", "bigg.fit").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const rePalabrasFactura_ = () => new RegExp(cfg_("PALABRAS_FACTURA", "factura|invoice|fra\\.?\\b|recibo|liquidaci[oó]n|renta\\b|alquiler|arrendamiento"), "i");
const rePalabrasDescarte_ = () => new RegExp(cfg_("PALABRAS_DESCARTE", "cat[aá]logo|dossier|presupuesto|newsletter|webinar|oferta|black friday|promoci[oó]n|encuesta"), "i");
// Nombres de PDF que vienen junto a una factura pero NO lo son (certificados bancarios, contratos, avisos de IPC…).
const rePdfDescarte_ = () => new RegExp(cfg_("PALABRAS_PDF_DESCARTE", "certificad|titularidad|justificante|contrato|condiciones|anexo|ipc|cat[aá]logo|presupuesto|albar[aá]n|preventa"), "i");

// ── API del GAS de Numbers ────────────────────────────────────────────────────

function nbGet_(resource, params) {
  const q = Object.keys(params || {}).map(k => "&" + k + "=" + encodeURIComponent(params[k])).join("");
  const url = cfg_("NUMBERS_URL") + "?resource=" + resource + "&token=" + encodeURIComponent(cfg_("NUMBERS_TOKEN")) + q;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  const data = JSON.parse(res.getContentText());
  if (data && data.error) throw new Error(data.error);
  return Array.isArray(data) ? data : (data.rows || data.data || []);
}

function nbPost_(payload) {
  payload.token = cfg_("NUMBERS_TOKEN");
  const res = UrlFetchApp.fetch(cfg_("NUMBERS_URL"), {
    method: "post", contentType: "application/json", payload: JSON.stringify(payload),
    muteHttpExceptions: true, followRedirects: true,
  });
  const data = JSON.parse(res.getContentText());
  if (data && data.error) throw new Error(data.error);
  return data;
}

// ── Utilidades de texto ───────────────────────────────────────────────────────

const sinAcentos_ = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const up_  = s => sinAcentos_(s).toUpperCase().replace(/\s+/g, " ");
const lc_  = s => String(s || "").toLowerCase();
const mailDe_ = s => { const m = String(s || "").match(/<([^>]+)>/); return lc_(m ? m[1] : String(s || "")).trim(); };
const dominio_ = m => (m.split("@")[1] || "");
const esInterno_ = m => dominiosInternos_().some(d => dominio_(m) === d);
const asuntoLimpio_ = s => String(s || "").replace(/^(\s*(fwd?|rv|re|tr|fw)\s*:\s*)+/i, "").trim();
const round2_ = n => Math.round((Number(n) || 0) * 100) / 100;
const fmtFecha_ = d => Utilities.formatDate(d, TZ, "yyyy-MM-dd");

// Importes en formato europeo "1.234,56" o anglosajón "1,234.56" → número.
function importe_(s) {
  s = String(s || "").trim();
  if (/,\d{1,2}$/.test(s)) return round2_(Number(s.replace(/\./g, "").replace(",", ".")));
  if (/\.\d{1,2}$/.test(s)) return round2_(Number(s.replace(/,/g, "")));
  return null;
}

// Fecha "dd/mm/yyyy", "dd.mm.yyyy", "dd-mm-yy" o "9 de noviembre de 2026" → "yyyy-mm-dd".
const MESES_ES = { enero:1, febrero:2, marzo:3, abril:4, mayo:5, junio:6, julio:7, agosto:8, septiembre:9, setiembre:9, octubre:10, noviembre:11, diciembre:12 };
function fecha_(s) {
  if (!s) return "";
  let m = String(s).match(/(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return y + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2); }
  m = sinAcentos_(String(s)).toLowerCase().match(/(\d{1,2}) de (\w+) de (\d{4})/);
  if (m && MESES_ES[m[2]]) return m[3] + "-" + ("0" + MESES_ES[m[2]]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  return "";
}

// Normaliza un nº de factura para comparar: mayúsculas, solo alfanumérico, sin ceros a la izquierda.
// "26/219518" ≡ "26-219518"; "1/202604094" ≡ "202604094" (endsWith); "0005655" ≡ "5655".
const normNro_ = s => up_(s).replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
function mismoNro_(a, b) {
  a = normNro_(a); b = normNro_(b);
  if (!a || !b || a.length < 4 || b.length < 4) return false;
  if (a === b || a.endsWith(b) || b.endsWith(a)) return true;
  // Un comprobante cargado con varias facturas ("FAC-2026-152 + FAC-2026-153") contiene el número buscado.
  return (a.length >= 6 && b.indexOf(a) !== -1) || (b.length >= 6 && a.indexOf(b) !== -1);
}

// ── Remitente real (reenvíos internos) ────────────────────────────────────────

// Lucía/Bautista/Gonzalo reenvían facturas: el remitente real es el primer "De:"/"From:" del cuerpo que
// NO sea interno. Si no hay, se queda el remitente del mail.
function remitenteReal_(from, cuerpo) {
  const f = mailDe_(from);
  if (!esInterno_(f)) return f;
  const re = /(?:^|\n)\s*\*?(?:De|From|Von)\*?\s*:\s*\*?[^\n<]*<([^>\s]+@[^>\s]+)>/gi;
  let m;
  while ((m = re.exec(cuerpo || ""))) { const e = lc_(m[1]); if (!esInterno_(e)) return e; }
  const re2 = /(?:^|\n)\s*\*?(?:De|From)\*?\s*:\s*([^\s<]+@[^\s>]+)/gi;
  while ((m = re2.exec(cuerpo || ""))) { const e = lc_(m[1]).replace(/[>*]/g, ""); if (!esInterno_(e)) return e; }
  return f;
}

// ── Reglas (nb_banco_reglas) y proveedores ────────────────────────────────────

function cargarContexto_() {
  const pais = cfg_("PAIS", "ES");
  const reglas = nbGet_("nb_banco_reglas", {}).filter(r =>
    String(r.activo) !== "false" && (!r.pais || String(r.pais).toUpperCase() === pais));
  const porTipo = t => reglas.filter(r => String(r.match_tipo) === t && String(r.match_valor || "").trim());
  const sedes = porTipo("sede").map(r => [up_(r.match_valor), String(r.centro_costo || "")]).filter(x => x[1]);
  const proveedores = nbGet_("nb_proveedores", {});
  const cuentas = {};
  nbGet_("nb_cuentas", {}).forEach(c => { cuentas[String(c.id)] = String(c.nombre || c.id); });
  // Centros de costo de esta sociedad (id → nombre): validan la sede que elige el modelo y arman su diccionario.
  const sociedad = cfg_("SOCIEDAD");
  const centros = {};
  nbGet_("nb_centros_costo", {}).forEach(c => {
    if (String(c.activo) === "false") return;
    if (lc_(c.empresa) === lc_(sociedad) || (!c.empresa && String(c.pais || "").toUpperCase() === pais)) centros[String(c.id)] = String(c.nombre || c.id);
  });
  return {
    remitente: porTipo("remitente"), asunto: porTipo("asunto"), sedes,
    proveedores, provPorId: Object.fromEntries(proveedores.map(p => [String(p.id), p])),
    cuentas, centros,
  };
}

// Proveedor por CIF/NIF que figura en la factura (nb_proveedores.cuit), cuando ninguna regla ni remitente lo dio.
const normCif_ = s => up_(s).replace(/[^A-Z0-9]/g, "");
function proveedorPorCif_(ctx, cif, imp) {
  const c = normCif_(cif);
  if (c.length < 8) return imp;
  const prov = ctx.proveedores.find(p => String(p.activo) !== "false" && normCif_(p.cuit) === c);
  if (!prov) return imp;
  return Object.assign({}, imp, {
    proveedor_id: String(prov.id), proveedor: String(prov.nombre || ""),
    cuentaId: imp.cuentaId || String(prov.cuentaDefault || ""), centro: imp.centro || String(prov.ccDefault || ""), por_cif: true,
  });
}

// Regla que matchea: la de valor más largo; a igual largo, menor `prioridad`.
function mejorRegla_(reglas, texto) {
  const t = lc_(texto);
  let best = null;
  for (const r of reglas) {
    const v = lc_(r.match_valor).trim();
    if (!v || t.indexOf(v) === -1) continue;
    if (!best || v.length > lc_(best.match_valor).trim().length ||
        (v.length === lc_(best.match_valor).trim().length && Number(r.prioridad || 10) < Number(best.prioridad || 10))) best = r;
  }
  return best;
}

// Imputación propuesta: regla remitente → regla asunto → proveedor por remitenteMail. Devuelve
// { proveedor_id, proveedor, cuentaId, centro, regla_id } (campos vacíos si no se pudo).
// Una regla con accion "ignorar" descarta el mail ({ ignorar: true }).
function imputar_(ctx, remitente, asunto) {
  const regla = mejorRegla_(ctx.remitente, remitente) || mejorRegla_(ctx.asunto, asunto);
  if (regla && lc_(regla.accion) === "ignorar") return { ignorar: true, regla_id: String(regla.id || "") };
  let prov = regla && regla.proveedor_id ? ctx.provPorId[String(regla.proveedor_id)] : null;
  if (!prov) {
    prov = ctx.proveedores.find(p => {
      const rm = lc_(p.remitenteMail).trim();
      return rm && String(p.activo) !== "false" && remitente.indexOf(rm) !== -1;
    }) || null;
  }
  return {
    regla_id:     regla ? String(regla.id || "") : "",
    proveedor_id: prov ? String(prov.id) : "",
    proveedor:    prov ? String(prov.nombre || "") : "",
    cuentaId:     String((regla && regla.cuenta_contable) || (prov && prov.cuentaDefault) || ""),
    centro:       String((regla && regla.centro_costo)    || (prov && prov.ccDefault)     || ""),
  };
}

// Sede por texto: devuelve los centros distintos que matchean. 1 → se imputa; 0 o >1 → queda vacío
// (la factura multi-sede se reparte desde "Abrir para editar" en la bandeja).
function sedesEnTexto_(ctx, texto) {
  const t = up_(texto);
  const hits = {};
  for (const [frag, centro] of ctx.sedes) {
    if (!frag) continue;
    if (t.indexOf(frag) !== -1) { hits[centro] = true; continue; }
    // Nº de contrato / CUPS / nº de cliente ("134-31369"): el proveedor lo imprime distinto en cada sitio
    // ("134031369", "134/31369", "13431369") → grupos de dígitos en orden, separador y ceros opcionales entre ellos.
    const grupos = frag.match(/\d+/g) || [];
    if (grupos.join("").length >= 6 && new RegExp("(?:^|\\D)" + grupos.map(g => g.replace(/^0+/, "")).join("\\D{0,3}0*") + "(?!\\d)").test(t)) hits[centro] = true;
  }
  return Object.keys(hits);
}

// ── Extracción con Gemini ─────────────────────────────────────────────────────
// El modelo recibe el PDF entero (lee también escaneados) y devuelve JSON con este esquema. Solo extrae: no decide
// cuenta ni centro. El diccionario de sedes del prompt son las reglas `sede` del Sheet (fragmento → centro), así
// que una sede nueva o un nº de contrato nuevo se agregan desde Maestros, no acá.

let ultimoErrorGemini_ = "";
const geminiActivo_ = () => !!cfg_("GEMINI_KEY", "");

const ESQUEMA_FACTURA = {
  type: "OBJECT",
  properties: {
    tipo_documento: { type: "STRING", enum: ["factura", "factura_rectificativa_o_abono", "recibo", "presupuesto_o_pedido", "albaran", "certificado_o_aviso", "otro"] },
    emisor_nombre: { type: "STRING" },
    emisor_cif: { type: "STRING", nullable: true },
    numero_factura: { type: "STRING", nullable: true },
    fecha_emision: { type: "STRING", nullable: true, description: "YYYY-MM-DD" },
    periodo_desde: { type: "STRING", nullable: true, description: "YYYY-MM-DD, inicio del período de servicio facturado, si lo indica" },
    periodo_hasta: { type: "STRING", nullable: true, description: "YYYY-MM-DD, fin del período de servicio facturado, si lo indica" },
    fecha_vencimiento: { type: "STRING", nullable: true, description: "YYYY-MM-DD" },
    moneda: { type: "STRING" },
    base_imponible: { type: "NUMBER", nullable: true },
    iva_porcentaje: { type: "NUMBER", nullable: true },
    iva_importe: { type: "NUMBER", nullable: true },
    otros_impuestos_o_retenciones: { type: "NUMBER", nullable: true, description: "IRPF, tasas, etc., con signo (retención negativa)" },
    total: { type: "NUMBER", nullable: true, description: "importe total a pagar" },
    ya_pagada: { type: "BOOLEAN", nullable: true, description: "true si el documento dice que ya está pagada/cobrada o domiciliada" },
    concepto: { type: "STRING", description: "qué se factura, en una línea" },
    sede_texto: { type: "STRING", nullable: true, description: "nombre o dirección del local/gimnasio al que corresponde el servicio, tal como figura" },
    sede_id: { type: "STRING", nullable: true, description: "id de sede de la lista; null si no se puede determinar" },
    lineas_por_sede: { type: "ARRAY", nullable: true, description: "si la factura reparte importes entre varias sedes, una entrada por sede con su total con IVA",
      items: { type: "OBJECT", properties: { sede_id: { type: "STRING", nullable: true }, sede_texto: { type: "STRING" }, total: { type: "NUMBER" } }, required: ["sede_texto", "total"] } },
    referencias: { type: "ARRAY", items: { type: "STRING" }, description: "nº de contrato, CUPS, póliza, nº de cliente, etc." },
    confianza: { type: "NUMBER", description: "0 a 1" },
    dudas: { type: "STRING", nullable: true, description: "qué no quedó claro" },
  },
  required: ["tipo_documento", "emisor_nombre", "moneda", "concepto", "confianza", "referencias"],
};

function promptFactura_(ctx, pistas) {
  // Diccionario de sedes: centro → fragmentos de las reglas `sede` (direcciones, nombres, nº de contrato).
  const porCentro = {};
  ctx.sedes.forEach(([frag, centro]) => { (porCentro[centro] = porCentro[centro] || []).push(frag); });
  const sedes = Object.keys(porCentro).map(c => c + " = " + (ctx.centros[c] || c) + " (" + porCentro[c].join(", ") + ")");
  return [
    "Sos el asistente contable de BIGG, una cadena de gimnasios. Leé el documento adjunto y devolvé los datos en JSON según el esquema.",
    "- Fechas YYYY-MM-DD. Importes como números con punto decimal, sin símbolo. \"total\" es el importe final a pagar (con IVA); \"base_imponible\" sin impuestos.",
    "- Si el documento no es una factura (presupuesto, pedido, albarán, certificado, aviso, recibo de cobro), marcá tipo_documento igual.",
    sedes.length ? "- Sedes (id = nombre (pistas: direcciones, nombres, nº de contrato)): " + sedes.join("; ") + "." : "- No hay lista de sedes: sede_id siempre null.",
    "- sede_id se elige por la dirección de suministro/entrega/local del servicio o por el nº de contrato, NUNCA por el domicilio fiscal del cliente. Si la factura reparte entre varias sedes, llená lineas_por_sede. Si no se puede saber, null.",
    "- Si hay período de servicio (consumo del 1 al 31, alquiler de un mes), llená periodo_desde/hasta.",
    "- numero_factura: exactamente como está impreso en el documento (no el nombre del archivo ni el asunto del mail). Si el documento no lo tiene, null.",
    "- No inventes: si un dato no está, null.",
    "Contexto del mail (solo orientativo): asunto \"" + String(pistas.asunto || "") + "\" · archivo \"" + String(pistas.archivo || "") + "\" · remitente " + String(pistas.remitente || ""),
  ].join("\n");
}

// Llama a la API. Devuelve la extracción normalizada (ver validarExtraccion_) o null si no hay clave o falló (el
// motivo queda en ultimoErrorGemini_ y se informa en la corrida; el mail sigue por el camino de patrones).
function extraerGemini_(ctx, blob, pistas) {
  const key = cfg_("GEMINI_KEY", "");
  if (!key) return null;
  const model = cfg_("GEMINI_MODEL", "gemini-3.1-flash-lite");
  const body = {
    contents: [{ parts: [
      { inlineData: { mimeType: "application/pdf", data: Utilities.base64Encode(blob.getBytes()) } },
      { text: promptFactura_(ctx, pistas) },
    ] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: ESQUEMA_FACTURA, temperature: 0 },
  };
  try {
    const res = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
      method: "post", contentType: "application/json", headers: { "x-goog-api-key": key },
      payload: JSON.stringify(body), muteHttpExceptions: true,
    });
    const d = JSON.parse(res.getContentText());
    if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
    const cand = (d.candidates || [])[0];
    const txt = ((cand && cand.content && cand.content.parts) || []).map(p => p.text || "").join("");
    if (!txt) throw new Error("respuesta vacía" + (cand && cand.finishReason ? " (" + cand.finishReason + ")" : ""));
    return validarExtraccion_(ctx, JSON.parse(txt), pistas);
  } catch (e) {
    ultimoErrorGemini_ = String(e && e.message || e);
    return null;
  }
}

// Chequeos antes de confiar en el modelo. No descarta: lo que no cierra se parkea igual, con `revisar=` en la
// nota para que el equipo lo mire (base+IVA ≠ total, sin nº, sin fecha, vto anterior a la emisión, confianza baja).
const fechaIso_ = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : "");
const numOrNull_ = v => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : round2_(Number(v)));
function validarExtraccion_(ctx, j, pistas) {
  const revisar = [];
  const emision = fechaIso_(j.fecha_emision);
  let hasta = fechaIso_(j.periodo_hasta), vto = fechaIso_(j.fecha_vencimiento);
  // Período: vale si termina como mucho 75 días antes de la emisión (más viejo = una línea suelta, no la factura)
  // y no más de 45 días después (alquiler del mes que empieza).
  if (hasta && emision) { const d = (new Date(emision + "T00:00:00") - new Date(hasta + "T00:00:00")) / 864e5; if (d > 75 || d < -45) hasta = ""; }
  if (vto && emision && vto < emision) vto = "";
  const total = numOrNull_(j.total), base = numOrNull_(j.base_imponible), ivaImp = numOrNull_(j.iva_importe), otros = numOrNull_(j.otros_impuestos_o_retenciones) || 0;
  let ivaPct = numOrNull_(j.iva_porcentaje);
  if (ivaPct === null && base > 0 && ivaImp !== null) ivaPct = Math.round(ivaImp / base * 100);
  if (ivaPct === null) ivaPct = Number(cfg_("IVA_DEFAULT", "21")) || 0;
  if (total === null || total <= 0) revisar.push("sin_total");
  else if (base !== null && ivaImp !== null && Math.abs(round2_(base + ivaImp + otros) - total) > 0.05) revisar.push("no_cuadra");
  // Nº: el del modelo; si no lo dio, los códigos fuertes del asunto/archivo (Disbere, Scentair) como siempre.
  const nro = String(j.numero_factura || "").trim() || extraerNro_("", pistas.asunto, pistas.archivo);
  if (!nro) revisar.push("sin_nro");
  if (!emision) revisar.push("sin_fecha");
  const conf = Number(j.confianza);
  if (!isNaN(conf) && conf < 0.6) revisar.push("confianza");
  const tipo = String(j.tipo_documento || "");
  if (tipo === "factura_rectificativa_o_abono") revisar.push("abono");
  const lineas = Array.isArray(j.lineas_por_sede) ? j.lineas_por_sede.map(l => ({ sede_id: String(l.sede_id || ""), sede_texto: String(l.sede_texto || ""), total: numOrNull_(l.total) })).filter(l => l.total !== null) : [];
  return {
    fuente: "gemini", tipo, nro, total, base, iva: ivaPct, moneda: String(j.moneda || ""),
    fechaFactura: emision, fechaServicio: hasta || emision, vto,
    emisor: String(j.emisor_nombre || ""), cif: String(j.emisor_cif || ""), concepto: String(j.concepto || ""),
    sedeId: String(j.sede_id || ""), sedeTexto: String(j.sede_texto || ""), refs: Array.isArray(j.referencias) ? j.referencias.map(String) : [],
    lineas, pagada: j.ya_pagada === true, confianza: isNaN(conf) ? null : conf, dudas: String(j.dudas || ""), revisar, texto: "",
  };
}

// Reparto por sede que trae la propia factura (ej. Scentair: una línea por gimnasio) → una línea por centro.
// Solo si no hay centro fijo por regla, hay 2+ líneas, suman el total y TODAS resuelven a un centro (por las
// reglas `sede` sobre el texto de la línea, o por la sede elegida por el modelo). Si no, se parkea entera.
function lineasPorSede_(ctx, ex, centroFijo) {
  const ls = ex.lineas || [];
  if (centroFijo || ls.length < 2 || ex.total === null) return [];
  const suma = ls.reduce((a, l) => a + l.total, 0);
  if (Math.abs(round2_(suma) - ex.total) > 0.05) return [];
  const out = [];
  for (const l of ls) {
    const hits = sedesEnTexto_(ctx, l.sede_texto);
    const c = hits.length === 1 ? hits[0] : (l.sede_id && ctx.centros[l.sede_id] ? l.sede_id : "");
    if (!c) return [];
    out.push({ centro: c, total: round2_(l.total) });
  }
  return out;
}

// Fallback: extracción por patrones sobre el texto del PDF (Drive → Doc) y el cuerpo del mail. Misma salida que Gemini.
function extraerPatrones_(src, cuerpo, asunto, totalCuerpoFuerte, totalCuerpo, fechaMail) {
  if (src.texto === null) src.texto = textoPdf_(src.blob);
  const nro = extraerNro_(src.texto || cuerpo, asunto, src.archivo);
  // Total: clave inequívoca en el PDF y/o en el cuerpo del mail (si hay dos, la mayor: la menor suele ser un
  // subtotal) → "Total" genérico del PDF → del cuerpo.
  const totalPdfFuerte = src.texto ? totalFuerte_(src.texto) : null;
  const totalPdfGen = src.texto ? totalGenerico_(src.texto) : null;
  const total = (totalPdfFuerte !== null || totalCuerpoFuerte !== null) ? Math.max(totalPdfFuerte || 0, totalCuerpoFuerte || 0)
    : totalPdfGen !== null ? totalPdfGen : totalCuerpo;
  const fe = extraerFechas_(src.texto || cuerpo, fechaMail);
  const ex = {
    fuente: "patrones", tipo: "", nro, total, base: null, iva: extraerIva_(src.texto || cuerpo), moneda: "",
    fechaFactura: fe.fechaFactura, fechaServicio: fe.fechaServicio, vto: fe.vto || "",
    emisor: "", cif: "", concepto: "", sedeId: "", sedeTexto: "", refs: [], lineas: [], pagada: false, confianza: null, dudas: "",
    revisar: total === null ? ["sin_total"] : [], texto: (src.texto || "") + "\n" + cuerpo,
  };
  // Diagnóstico para el simulacro: si faltó el total o la fecha salió del mail (no del PDF), un pedazo del texto.
  if (total === null || fe.fechaFactura === fmtFecha_(fechaMail)) ex.diag = plano_(src.texto || "").replace(/\n+/g, " ⏎ ").slice(0, 500);
  return ex;
}

// ── Texto del PDF (Drive API: conversión a Google Doc temporal, lee la capa de texto; OCR si es imagen) ──
// Funciona con el servicio avanzado Drive en v2 (Files.insert) o v3 (Files.create). Si falla, el motivo
// queda en `ultimoErrorPdf_` y se informa en el resultado de la corrida (antes fallaba en silencio).

let ultimoErrorPdf_ = "";
function textoPdf_(blob) {
  let id = null;
  try {
    if (typeof Drive === "undefined") throw new Error("Falta agregar el servicio avanzado 'Drive API' en Servicios (+)");
    const nombre = "lector-tmp-" + Utilities.getUuid();
    if (Drive.Files && typeof Drive.Files.insert === "function") {        // v2
      id = Drive.Files.insert({ title: nombre, mimeType: "application/vnd.google-apps.document" }, blob,
        { convert: true, ocr: true, ocrLanguage: "es" }).id;
    } else if (Drive.Files && typeof Drive.Files.create === "function") { // v3: el mimeType de destino convierte
      id = Drive.Files.create({ name: nombre, mimeType: "application/vnd.google-apps.document" }, blob,
        { ocrLanguage: "es" }).id;
    } else throw new Error("Servicio Drive sin Files.insert ni Files.create");
    return DocumentApp.openById(id).getBody().getText() || "";
  } catch (e) {
    ultimoErrorPdf_ = String(e && e.message || e);
    return "";
  } finally {
    if (id) {
      try { if (typeof Drive.Files.remove === "function") Drive.Files.remove(id); else DriveApp.getFileById(id).setTrashed(true); }
      catch (e) { /* queda en la papelera de Drive, no importa */ }
    }
  }
}

// ── Extracción de datos de la factura ─────────────────────────────────────────

// Importes con 1 o 2 decimales ("677,6 €" también aparece), separador de miles opcional.
const RE_IMP_ES = "(\\d{1,3}(?:\\.\\d{3})*,\\d{1,2})(?!\\d)";
const RE_IMP_EN = "(\\d{1,3}(?:,\\d{3})*\\.\\d{1,2})(?!\\d)";

// Texto "aplanado": espacios repetidos a uno (el PDF a columnas deja huecos enormes), saltos de línea intactos.
const plano_ = s => String(s || "").replace(/[ \t ]+/g, " ");
// Importe en los dos formatos, para verificar que "base + IVA" aparece escrito en la factura.
const fmtEs_ = n => n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const fmtEn_ = n => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// Base imponible y cuota de IVA, si la factura las enuncia con esas palabras (sirven para deducir el total y el %).
function baseEIva_(t) {
  const num = re => { const m = re.exec(t); return m ? importe_(m[1]) : null; };
  const base = num(new RegExp("(?:Total\\s+)?Base\\s+imponible[^\\d\\n]{0,40}" + RE_IMP_ES, "i"))
            || num(new RegExp("B\\.?\\s*Imponible[^\\d\\n]{0,40}" + RE_IMP_ES, "i"));
  const iva  = num(new RegExp("(?:Cuota\\s+|Total\\s+)?I\\.?V\\.?A\\.?\\s*(?:\\(?\\s*\\d{1,2}(?:[,\\.]\\d+)?\\s*%\\s*\\)?)?[^\\d\\n%]{0,30}" + RE_IMP_ES, "i"))
            || num(new RegExp("Impuesto[^\\d\\n]{0,40}" + RE_IMP_ES, "i"));
  return { base, iva };
}

// Mayor importe de un bloque de texto: primero en formato español (1.234,56); si no hay, en inglés (1,234.56).
const mayorEn_ = (s) => {
  for (const pat of [RE_IMP_ES, RE_IMP_EN]) {
    let best = null, m; const re = new RegExp(pat, "g");
    while ((m = re.exec(s))) { const v = importe_(m[1]); if (v !== null && (best === null || v > best)) best = v; }
    if (best !== null) return best;
  }
  return null;
};

// Total "fuerte": junto a una clave inequívoca, o deducido como base imponible + cuota de IVA. null si no hay.
function totalFuerte_(texto) {
  const t = plano_(texto);
  const claves = [
    "TOTAL\\s+FACTURA", "TOTAL\\s+CANTIDAD\\s+A\\s+PAGAR", "IMPORTE\\s+DE\\s+LA\\s+FACTURA", "IMPORTE\\s+TOTAL",
    "TOTAL\\s+A\\s+PAGAR", "TOTAL\\s+IMPORTE", "TOTAL\\s+\\(EUR\\)", "TOTAL\\s+EUR", "AMOUNT\\s+DUE", "TOTAL\\s+DUE", "PAID",
  ];
  // 1) una clave fuerte seguida de un importe en la MISMA línea (cualquiera de las claves, antes de mirar
  //    encabezados: en una factura de varios renglones "Paid: 454.96" abajo vale más que la columna "Total")
  //    (se tolera UN salto de línea entre la clave y el importe: "Paid:" ⏎ "454.96")
  for (const k of claves) {
    let m = new RegExp("(?<![A-Z])" + k + "[^\\d\\n]{0,60}\\n?[^\\d\\n]{0,20}" + RE_IMP_ES, "i").exec(t); if (m) return importe_(m[1]);
    m = new RegExp("(?<![A-Z])" + k + "[^\\d\\n]{0,60}\\n?[^\\d\\n]{0,20}" + RE_IMP_EN, "i").exec(t);     if (m) return importe_(m[1]);
  }
  // 1b) la clave es un encabezado de tabla y los valores vienen abajo: el total es el MAYOR importe del bloque
  //     que sigue (los demás son base, IVA, ecotasa… o los renglones de una factura multi-sede)
  for (const k of claves) {
    const m = new RegExp("(?<![A-Z])" + k + "[^\\n]*\\n([\\s\\S]{0,400})", "i").exec(t);
    if (m) { const v = mayorEn_(m[1]); if (v !== null) return v; }
  }
  // 2) base imponible + cuota de IVA, si la suma figura escrita en la factura
  const bi = baseEIva_(t);
  if (bi.base !== null && bi.iva !== null) {
    const s = round2_(bi.base + bi.iva);
    if (t.indexOf(fmtEs_(s)) !== -1 || t.indexOf(fmtEn_(s)) !== -1) return s;
  }
  return null;
}

// Total genérico: el mayor importe en el bloque que sigue a "Total" (nunca "Subtotal"). null si no hay.
function totalGenerico_(texto) {
  const t = plano_(texto);
  let best = null; const re = /(?<![A-Z])TOTAL(?!\s*IMPUESTOS)([\s\S]{0,200})/gi; let m;
  while ((m = re.exec(t))) { const v = mayorEn_(m[1]); if (v !== null && (best === null || v > best)) best = v; re.lastIndex = m.index + 5; }
  return best;
}

function extraerTotal_(texto) {
  const f = totalFuerte_(texto);
  return f !== null ? f : totalGenerico_(texto);
}

const NRO_OK = v => v && /\d/.test(v) && !/^(DE|DEL|FECHA|N|NO|N[ºo°])$/i.test(v);
// Códigos de factura inequívocos (FP26-070059, FAC-2026-175, 26/219518, 1-202604094, INV/2026/438844, 001673_0005655 → 0005655,
// R 11 / 2026). En el asunto o el nombre del archivo ganan sobre el texto del PDF, que trae otros códigos (cliente, contrato…).
const RE_CODIGO_FUERTE = /(?:^|[^\w])(FP\d{2}-\d{4,}|FAC-\d{4}-\d{2,}|INV\/\d{4}\/\d{3,}|\d{2}\/\d{6}|\d{2}-\d{6}|\d-\d{9}|R\s?\d{1,2}\s?\/\s?\d{4}|\d{6}_(\d{7}))(?![\d\/])/i;

function extraerNro_(texto, asunto, archivo) {
  const t = plano_(texto);
  const stem = String(archivo || "").replace(/\.pdf$/i, "").trim();
  let m = RE_CODIGO_FUERTE.exec(asuntoLimpio_(asunto)) || RE_CODIGO_FUERTE.exec(stem);
  if (m) return (m[2] || m[1]).replace(/\s+/g, "");
  const pats = [
    /n[ºo°]\.?\s*([A-Z]?\s*\d{1,4}\s*\/\s*\d{4})\b/i,                                       // "nº R 11 / 2026" (aun partido en dos líneas)
    /N[ºo°\.]*\s*(?:de\s+)?factura\s*(?:n[ºo°\.]*)?\s*[:\s]\s*([A-Z0-9][A-Z0-9\/\-\._]{2,30})/i,
    /Factura\s+(?:n[ºo°]\.?|n[úu]mero|venta|nro\.?)\s*[:\s]*([A-Z0-9][A-Z0-9\/\-\._]{2,30})/i,
    /Invoice\s*(?:No\.?|#|Number|Nº)?\s*[:\s]\s*([A-Z0-9][A-Z0-9\/\-\._]{2,30})/i,
    /FACTURA\s+N[ºo°]\s*([A-Z0-9][A-Z0-9\/\-\._]{2,30})/i,
    /(?:^|\n)\s*(?:n[ºo°]\.?\s*)?factura\s*[:\s]+\s*([A-Z0-9][A-Z0-9\/\-\._]{2,30})\s*$/im,
    /N[ºo°]\.?\s*Factura[^\n]*\n\s*([A-Z0-9][A-Z0-9\/\-\._]{2,30})/i,                       // cabecera de tabla, valor en la línea de abajo
  ];
  for (const p of pats) { const mm = p.exec(t); if (mm && NRO_OK(mm[1])) return mm[1].replace(/\s+/g, "").replace(/[\.\s]+$/, ""); }
  // último recurso: un número largo en el asunto o el archivo (SPA_SA_202611020000008, 6501856_…)
  const re = /(?:^|[^\w])(\d{6,})(?![\w\/])/;
  m = re.exec(asuntoLimpio_(asunto)); if (m) return m[1];
  m = re.exec(stem); if (m) return m[1];
  const tok = stem.split(/\s+/).find(x => /\d{5,}/.test(x)); if (tok) return tok;
  return "";
}

// Sin rótulo de fecha: la fecha MÁS TEMPRANA de la primera parte del PDF (4.000 caracteres: algunos ponen los
// rótulos arriba y los valores bastante más abajo) que sea razonable para una factura (hasta 400 días antes del
// mail y no después de él). Las de vencimiento son posteriores y quedan descartadas por "más temprana".
function primeraFechaRazonable_(t, fechaMail) {
  const cab = String(t || "").slice(0, 4000);
  const re = /(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{4})/g;
  const min = fechaMail.getTime() - 400 * 864e5, max = fechaMail.getTime() + 2 * 864e5;
  let best = ""; let m;
  while ((m = re.exec(cab))) {
    const f = fecha_(m[1]); if (!f) continue;
    const ts = new Date(f + "T00:00:00").getTime();
    if (ts < min || ts > max) continue;
    if (!best || f < best) best = f;
  }
  return best;
}

function extraerFechas_(texto, fechaMail) {
  const t = plano_(texto);
  const fFact = fecha_((/Fecha\s*(?:de\s+)?(?:la\s+)?(?:factura|emisi[oó]n|expedici[oó]n)\s*[:\s]*([^\n]{6,30})/i.exec(t) || [])[1])
             || fecha_((/Fecha\s*(?:de\s+)?(?:la\s+)?(?:factura|emisi[oó]n)\s*:?[\s\S]{0,80}?(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}|\d{1,2} de \w+ de \d{4})/i.exec(t) || [])[1])   // rótulo y valor en líneas distintas (PDF a columnas)
             || fecha_((/Invoice\s+Date\s*[:\s]*([^\n]{6,20})/i.exec(t) || [])[1])
             || fecha_((/(?:^|\n)\s*Fecha\s*[:\s]+([^\n]{6,20})/i.exec(t) || [])[1])
             // "Las Rozas (Madrid), el 01/11/2026" · "Madrid, 06.11.2026": ciudad + coma + fecha es la fecha de emisión
             || fecha_((/\b[A-ZÁÉÍÓÚ][a-záéíóúñ]{2,20}(?:\s\([^)]{2,20}\))?,\s*(?:el\s+|a\s+)?(\d{1,2}[\.\/]\d{1,2}[\.\/]\d{4})/.exec(t) || [])[1])
             || fecha_((/\bFecha\b[^\n]*\n[^\n]*?(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})/i.exec(t) || [])[1])   // cabecera "Fecha | …" y valor abajo
             || primeraFechaRazonable_(t, fechaMail)
             || fmtFecha_(fechaMail);
  const vto   = fecha_((/(?:Fecha\s+de\s+)?Venc(?:imiento|\.)?s?\s*[:\s]*([^\n]{6,20})/i.exec(t) || [])[1])
             || fecha_((/Fecha\s+de\s+cargo\s*[:\s]*([^\n]{6,20})/i.exec(t) || [])[1]);
  // Período de servicio ("Del 30/09/2026 al 31/10/2026" / "01.11.2026-30.11.2026") → fecha = FIN del período.
  // Solo vale si termina como mucho 75 días antes de la fecha de factura: un período más viejo es el de una línea
  // suelta (ej. una suscripción facturada con atraso), no el de la factura.
  const per = /(?:per[ií]odo[^\n]{0,30}?)?(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})\s*(?:al?|-|–|hasta)\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})/i.exec(t);
  let fServ = per ? fecha_(per[2]) : "";
  if (fServ && fFact && (new Date(fFact + "T00:00:00") - new Date(fServ + "T00:00:00")) > 75 * 864e5) fServ = "";
  return { fechaFactura: fFact, vto, fechaServicio: fServ || fFact };
}

function extraerIva_(texto) {
  const t = plano_(texto);
  const m = /(?:I\.?V\.?A\.?|VAT)\s*\(?\s*(\d{1,2})(?:[,\.]\d+)?\s*%/i.exec(t);
  if (m) return Number(m[1]);
  // Sin "% IVA" explícito: se deduce de base y cuota si están enunciadas (4, 10 o 21)
  const bi = baseEIva_(t);
  if (bi.base > 0 && bi.iva !== null) { const r = Math.round(bi.iva / bi.base * 100); if ([0, 4, 10, 21].indexOf(r) !== -1) return r; }
  return Number(cfg_("IVA_DEFAULT", "21")) || 0;   // cuando la factura no lo dice
}

// ── Memo de mails ya procesados (para no re-leer PDFs en cada click) ──────────

function memo_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty("PROCESADOS") || "{}"); } catch (e) { return {}; } }
function guardarMemo_(m) {
  const keys = Object.keys(m);
  if (keys.length > 3000) keys.slice(0, keys.length - 3000).forEach(k => delete m[k]);   // los más viejos primero
  PropertiesService.getScriptProperties().setProperty("PROCESADOS", JSON.stringify(m));
}

// ── Corrida ───────────────────────────────────────────────────────────────────

// Lee el buzón desde FECHA_CORTE (o `desde`) y parkea lo nuevo. Devuelve el resumen. Si se queda sin
// tiempo devuelve parcial=true: el botón vuelve a llamar y sigue donde quedó (gracias al memo).
function leerBuzon_(opts) {
  const t0 = Date.now();
  opts = opts || {};
  const sociedad = cfg_("SOCIEDAD"), moneda = cfg_("MONEDA", "EUR"), buzon = cfg_("BUZON", Session.getActiveUser().getEmail());
  const corte = cfg_("FECHA_CORTE", "2026-10-01");
  const dry = !!opts.dry;
  const props = PropertiesService.getScriptProperties();
  // Ventana de lectura: desde el corte la primera vez (o tras ?accion=reset); después, desde dos días antes de la
  // última corrida COMPLETA. Así una corrida diaria no vuelve a recorrer todo el buzón (y no agota la cuota de Gmail).
  const completaEn = dry ? "" : (props.getProperty("COMPLETA_EN") || "");
  const desde = opts.desde || (completaEn ? maxFecha_(corte, fmtFecha_(new Date(new Date(completaEn).getTime() - 2 * 864e5))) : corte);
  const ctx = cargarContexto_();
  const memo = memo_();

  // Comprobantes existentes de la sociedad: ids (candado 1), borradores ya parkeados (mismo nº o mismo PDF en otro
  // mail del hilo → no se repite) y EGRESO reales (candados 2 y 3)
  const comps = nbGet_("nb_comprobantes", { sociedad: sociedad });
  const ids = {}; comps.forEach(c => { ids[String(c.id_comp)] = true; });
  const borradores = comps.filter(c => String(c.subtipo || "").toUpperCase() === "EGRESO_BORRADOR")
    .map(c => ({ prov_id: String(c.contraparte_id || ""), nro: String(c.nro_comp || ""), archivo: (String(c.nota || "").match(/(?:^|;)archivo=([^;]+)/) || [])[1] || "" }));
  const yaParkeada = (imp, nro, archivo) => borradores.some(b => b.prov_id && b.prov_id === imp.proveedor_id &&
    ((nro && b.nro && mismoNro_(nro, b.nro)) || (archivo && b.archivo && b.archivo === archivo.replace(/[;=]/g, "_"))));
  const egresos = {};
  comps.filter(c => String(c.subtipo || "").toUpperCase() === "EGRESO").forEach(c => {
    const k = String(c.id_comp);
    if (!egresos[k]) egresos[k] = { prov_id: String(c.contraparte_id || ""), prov: lc_(c.contraparte_nombre), nro: String(c.nro_comp || ""), fecha: String(c.fecha || "").slice(0, 7), total: 0 };
    egresos[k].total += Number(c.total) || 0;
  });
  const listaEgresos = Object.keys(egresos).map(k => Object.assign({ id_comp: k }, egresos[k]));

  const yaCargada = (imp, nro, total, mesServicio) => {
    const mismoProv = e => (imp.proveedor_id && e.prov_id === imp.proveedor_id) || (imp.proveedor && e.prov && (e.prov.indexOf(lc_(imp.proveedor).slice(0, 12)) !== -1));
    for (const e of listaEgresos) {
      if (!mismoProv(e)) continue;
      if (nro && e.nro && mismoNro_(nro, e.nro)) return e.id_comp;                                     // candado 2
      if (total !== null && Math.abs(round2_(e.total) - total) < 0.015 && mesServicio && e.fecha === mesServicio) return e.id_comp;   // candado 3
    }
    return "";
  };

  const res = { ok: true, buzon, sociedad, desde, revisados: 0, parkeadas: [], ya_cargadas: [], ya_parkeadas: [], viejas: [], sin_regla: 0, descartados: 0, lotes: [], errores: [], parcial: false, dry,
    gemini: { activo: geminiActivo_(), gemini: 0, fallback: 0 } };   // PDFs leídos por el modelo / que cayeron a patrones
  const filas = [];
  ultimoErrorPdf_ = ""; ultimoErrorGemini_ = "";
  const vistos = {};                                              // PDFs ya tomados en esta corrida (proveedor|archivo|bytes)
  const maxMs = dry ? 300000 : MAX_MS_POR_CORRIDA;                // desde el editor (simulacro) hay 6 min; desde el botón, 45 s
  const [y, mo, d] = desde.split("-");
  // En un simulacro, la propiedad SIMULACRO_FILTRO acota la búsqueda (ej. "from:grupovoldis.es") para probar un proveedor.
  const filtro = dry ? cfg_("SIMULACRO_FILTRO", "") : "";
  const ignorarMemo = dry && !!filtro;
  const query = "after:" + y + "/" + mo + "/" + d + " -in:sent -in:trash -in:spam -in:draft" + (filtro ? " " + filtro : "");
  const desdeTs = new Date(desde + "T00:00:00");

  // Pasada previa (sin PDF): ráfagas de un mismo remitente. Más de MAX_PDFS_POR_MAIL mails del mismo remitente en
  // 5 minutos es un reenvío masivo de históricos (ej. Voldis mandó 25 facturas de ene-jun en un minuto el
  // 8/10/2026), no facturación normal → se tratan como lote: se reportan, no se parkean.
  // Se calcula UNA vez por ventana y queda en caché 6 h: las vueltas siguientes del botón no vuelven a leer todo el buzón.
  const maxRafaga = Number(cfg_("MAX_PDFS_POR_MAIL", "6")) || 6;
  const bucketDe = (from, date) => mailDe_(from) + "|" + Math.floor(date.getTime() / (5 * 60 * 1000));
  const cache = CacheService.getScriptCache();
  const cacheKey = "buckets|" + query;
  let porBucket = null;
  try { const c = cache.get(cacheKey); if (c) porBucket = JSON.parse(c); } catch (e) { porBucket = null; }
  if (!porBucket) {
    porBucket = {};
    for (let s = 0; ; s += 100) {
      const ths = GmailApp.search(query, s, 100);
      if (!ths.length) break;
      ths.forEach(th => th.getMessages().forEach(m => { if (m.getDate() >= desdeTs) { const b = bucketDe(m.getFrom(), m.getDate()); porBucket[b] = (porBucket[b] || 0) + 1; } }));
      if (ths.length < 100) break;
    }
    try { cache.put(cacheKey, JSON.stringify(porBucket), 6 * 3600); } catch (e) { /* caché llena: se recalcula la próxima */ }
  }
  const rafagaVista = {};
  const etiquetados = {};                                        // hilos ya etiquetados en esta corrida
  const hilosConFactura = {};                                    // hilos con alguna factura parkeada/pendiente: nunca llevan Descartado
  // Reproceso: si alguien le SACÓ la etiqueta Descartado a un mail en Gmail (ej. era una factura y se cargó la regla),
  // se vuelve a mirar aunque esté en el memo. Se consulta una vez por hilo.
  const labelsDe = {};
  const tieneDescartado = th => { const id = th.getId(); if (!(id in labelsDe)) { try { labelsDe[id] = th.getLabels().some(l => l.getName() === ETIQUETAS.descartado); } catch (e) { labelsDe[id] = true; } } return labelsDe[id]; };

  // Recorrido por páginas de 100 hilos (más nuevos primero). Si la corrida anterior quedó parcial, se retoma desde
  // la página donde se cortó (CURSOR); con el memo, un hilo repetido no hace daño.
  let start = dry ? 0 : Number(props.getProperty("CURSOR") || 0) || 0;
  let seguir = true;
  while (seguir) {
    const threads = GmailApp.search(query, start, 100);
    if (!threads.length) break;
    for (const th of threads) {
      if (!seguir) break;
      for (const msg of th.getMessages()) {
        if (Date.now() - t0 > maxMs) { res.parcial = true; seguir = false; break; }
        const mailId = msg.getId();
        if (msg.getDate() < desdeTs || msg.isInTrash()) continue;
        // Simulacro acotado (SIMULACRO_FILTRO): se ignora el memo para poder re-leer mails ya procesados y comparar.
        if (memo[mailId] && !ignorarMemo && !(memo[mailId] === "descartado" && !dry && !tieneDescartado(th))) continue;
        res.revisados++;
        const b = bucketDe(msg.getFrom(), msg.getDate());
        if (porBucket[b] > maxRafaga) {
          if (!rafagaVista[b]) { rafagaVista[b] = true; res.lotes.push({ mail: "ráfaga de " + porBucket[b] + " mails en 5 min (" + msg.getSubject() + "…)", remitente: mailDe_(msg.getFrom()), pdfs: new Array(porBucket[b]).fill(""), fecha: fmtFecha_(msg.getDate()) }); }
          memo[mailId] = "lote";
          if (!dry) etiquetarHilo_(th, "lote", etiquetados);
          continue;
        }
        try {
          const r = procesarMail_(ctx, msg, th, { sociedad, moneda, buzon, ids, yaCargada, yaParkeada, vistos, corte, stats: res.gemini });
          if (r.descartado) { memo[mailId] = "descartado"; res.descartados++; if (!dry) etiquetarHilo_(th, "descartado", etiquetados); continue; }
          // Lote (muchos PDF en un mail: históricos, regularizaciones): no se parkea, se avisa para mirarlo a mano.
          if (r.lote) { res.lotes.push({ mail: msg.getSubject(), remitente: r.remitente, pdfs: r.lote, fecha: fmtFecha_(msg.getDate()) }); memo[mailId] = "lote"; if (!dry) etiquetarHilo_(th, "lote", etiquetados); continue; }
          let todoResuelto = true;
          for (const f of r.facturas) {
            if (f.vieja) { res.viejas.push({ proveedor: f.proveedor, nro: f.nro, total: f.total, fecha: f.vieja, archivo: f.archivo }); continue; }
            if (f.ya_cargada) { res.ya_cargadas.push({ proveedor: f.proveedor, nro: f.nro, total: f.total, egreso: f.ya_cargada }); continue; }
            if (f.duplicado) {            // ya parkeada antes (candado 1); en un simulacro se muestra igual lo extraído, para comparar
              if (dry) res.ya_parkeadas.push({ proveedor: f.proveedor || f.remitente, nro: f.nro, total: f.total, centro: f.centro, archivo: f.archivo, fuente: f.fuente, revisar: f.revisar && f.revisar.length ? f.revisar.join("|") : "", diag: f.diag });
              continue;
            }
            if (!f.proveedor_id) res.sin_regla++;
            res.parkeadas.push({ proveedor: f.proveedor || f.remitente, nro: f.nro, total: f.total, centro: f.centro, archivo: f.archivo, sin_regla: !f.proveedor_id,
              fuente: f.fuente, revisar: f.revisar && f.revisar.length ? f.revisar.join("|") : "", diag: dry ? f.diag : undefined });
            if (!dry) f.filas.forEach(x => filas.push(x)); else todoResuelto = false;
          }
          if (r.facturas.length) hilosConFactura[th.getId()] = th;   // tuvo factura (parkeada, ya cargada o vieja)
          if (todoResuelto && !dry) memo[mailId] = "ok";
        } catch (e) {
          res.errores.push({ mail: msg.getSubject(), error: e.message });
        }
      }
    }
    if (!seguir) break;
    start += 100;
    if (threads.length < 100) break;
  }

  if (filas.length) nbPost_({ action: "add_batch", sheet: "nb_comprobantes", rows: filas });
  if (!dry) {
    guardarMemo_(memo);
    // La etiqueta es por hilo: si un hilo tiene factura y además respuestas descartadas, gana la factura.
    quitarDescartadoDe_(Object.keys(hilosConFactura).map(k => hilosConFactura[k]));
    // Parcial: se guarda la página para retomar; completa: se olvida el cursor y la próxima ventana arranca
    // dos días antes de hoy (lo ya procesado queda en el memo).
    if (res.parcial) props.setProperty("CURSOR", String(start)); else { props.deleteProperty("CURSOR"); props.setProperty("COMPLETA_EN", new Date().toISOString()); }
  }
  if (ultimoErrorPdf_) res.error_pdf = "No se pudo leer el texto de los PDF: " + ultimoErrorPdf_;
  if (ultimoErrorGemini_) res.error_gemini = "Gemini falló en algún PDF (se usaron patrones): " + ultimoErrorGemini_;
  res.duracion_ms = Date.now() - t0;
  props.setProperty("ULTIMA", JSON.stringify({ cuando: new Date().toISOString(), desde, parcial: res.parcial, parkeadas: res.parkeadas.length, ya_cargadas: res.ya_cargadas.length, revisados: res.revisados }));
  return res;
}

const maxFecha_ = (a, b) => (a > b ? a : b);

// Un mail → 0..N facturas (una por PDF; sin PDF, una sola con los datos del cuerpo).
function procesarMail_(ctx, msg, th, env) {
  const asunto = asuntoLimpio_(msg.getSubject());
  const cuerpo = String(msg.getPlainBody() || "").slice(0, 20000);
  const remitente = remitenteReal_(msg.getFrom(), cuerpo);
  const pdfs = msg.getAttachments({ includeInlineImages: false, includeAttachments: true })
    .filter(a => /pdf/i.test(a.getContentType()) || /\.pdf$/i.test(a.getName()))
    .filter(a => a.getSize() <= MAX_PDF_BYTES)
    .filter(a => !rePdfDescarte_().test(a.getName()));               // certificados, contratos, IPC… no son facturas
  const imp = imputar_(ctx, remitente, asunto);
  if (imp.ignorar) return { descartado: true };                       // regla con accion "ignorar"
  const conocido = !!imp.proveedor_id;

  // Filtro de entrada: la factura viene SIEMPRE en PDF (avisos, pedidos y conversaciones del mismo proveedor
  // no se parkean); y para un remitente sin regla, además tiene que oler a factura y no a catálogo.
  const texto0 = asunto + "\n" + cuerpo.slice(0, 3000) + "\n" + pdfs.map(a => a.getName()).join("\n");
  if (!pdfs.length && cfg_("PARKEAR_SIN_PDF", "0") !== "1") return { descartado: true };
  if (!pdfs.length && !conocido) return { descartado: true };
  if (!conocido && !rePalabrasFactura_().test(texto0)) return { descartado: true };
  if (!conocido && rePalabrasDescarte_().test(asunto)) return { descartado: true };
  // Muchos PDF en un mail = lote (históricos, regularizaciones): no se parkea, se reporta para revisar a mano.
  const maxPdfs = Number(cfg_("MAX_PDFS_POR_MAIL", "6")) || 6;
  if (pdfs.length > maxPdfs) return { lote: pdfs.map(a => a.getName()), remitente };
  // El total del cuerpo del mail solo vale si el mail trae UN PDF (con varios, es el total de otra cosa).
  const totalCuerpoFuerte = pdfs.length <= 1 ? totalFuerte_(cuerpo) : null;
  const totalCuerpo = pdfs.length <= 1 ? (totalCuerpoFuerte !== null ? totalCuerpoFuerte : totalGenerico_(cuerpo)) : null;
  // Facturas con fecha muy anterior al corte (lotes de históricos reenviados): se apartan, no se parkean.
  const limiteVieja = new Date(new Date(env.corte + "T00:00:00").getTime() - 45 * 864e5);

  const facturas = [];
  const fuentes = pdfs.length ? pdfs.map((a, k) => ({ k, archivo: a.getName(), bytes: a.getSize(), texto: null, blob: a })) : [{ k: 0, archivo: "", bytes: 0, texto: "" }];
  let noFactura = 0;
  fuentes.forEach(src => {
    // Mismo PDF (proveedor + nombre + tamaño) ya visto en esta corrida (ej. un hilo con el mail repetido) → no se duplica.
    const firma = (imp.proveedor_id || remitente) + "|" + src.archivo + "|" + src.bytes;
    if (src.archivo && env.vistos[firma]) return;
    env.vistos[firma] = true;
    const id_comp = "COR-" + msg.getId() + (src.k ? "-" + src.k : "");
    // 1) Datos de la factura: Gemini lee el PDF entero; sin clave o si falla, patrones (texto del PDF + cuerpo).
    let ex = src.blob ? extraerGemini_(ctx, src.blob, { asunto, archivo: src.archivo, remitente }) : null;
    if (ex) env.stats.gemini++;
    else { if (src.blob && geminiActivo_()) env.stats.fallback++; ex = extraerPatrones_(src, cuerpo, asunto, totalCuerpoFuerte, totalCuerpo, msg.getDate()); }
    // 2) Proveedor: regla o remitente (imputar_) → si no, por el CIF que figura en el PDF.
    const impS = (!imp.proveedor_id && ex.cif) ? proveedorPorCif_(ctx, ex.cif, imp) : imp;
    // Lo que el modelo dice que NO es factura (pedido, albarán, presupuesto, certificado): de un remitente sin regla
    // se descarta; de un proveedor conocido se parkea marcado para revisar (una duda del modelo nunca pierde una factura).
    if (ex.tipo && !/^factura/.test(ex.tipo)) { if (!impS.proveedor_id) { noFactura++; return; } ex.revisar.push("tipo:" + ex.tipo); }
    const nro = ex.nro, total = ex.total, iva = ex.iva;
    // 3) Sede: centro de la regla → fragmentos de sede del Sheet en asunto, cuerpo, dirección/referencias del PDF
    //    (patrones: texto entero del PDF) → sede elegida por el modelo (validada contra los centros de la sociedad).
    const textoSede = [asunto, cuerpo.slice(0, 3000), ex.sedeTexto, ex.refs.join("\n"), ex.lineas.map(l => l.sede_texto).join("\n"), ex.texto].join("\n");
    const sedes = impS.centro ? [impS.centro] : sedesEnTexto_(ctx, textoSede);
    let centro = sedes.length === 1 ? sedes[0] : "";
    if (!centro && !sedes.length && ex.sedeId && ctx.centros[ex.sedeId]) centro = ex.sedeId;
    const lineas = lineasPorSede_(ctx, ex, impS.centro);          // reparto por sede que trae la propia factura
    const f = { archivo: src.archivo, remitente, proveedor_id: impS.proveedor_id, proveedor: impS.proveedor || ex.emisor, nro, total,
      centro: lineas.length ? lineas.map(l => l.centro).join("+") : centro, fuente: ex.fuente, revisar: ex.revisar, duplicado: false, ya_cargada: "", vieja: "" };
    if (ex.diag) f.diag = ex.diag;
    else if (ex.revisar.length) f.diag = "revisar " + ex.revisar.join("|") + (ex.dudas ? " · " + ex.dudas : "") + " · conf " + ex.confianza;
    if (ex.fechaFactura && new Date(ex.fechaFactura + "T00:00:00") < limiteVieja) { f.vieja = ex.fechaFactura; facturas.push(f); return; }   // histórico reenviado
    if (env.ids[id_comp]) { f.duplicado = true; facturas.push(f); return; }                      // candado 1
    if (env.yaParkeada(impS, nro, src.archivo)) { f.duplicado = true; facturas.push(f); return; } // mismo nº o mismo PDF ya en la bandeja (otro mail del hilo)
    f.ya_cargada = env.yaCargada(impS, nro, total, (ex.fechaServicio || "").slice(0, 7));          // candados 2 y 3
    if (f.ya_cargada) { facturas.push(f); return; }

    const notas = [
      "mail_ref=" + th.getId(), "fecha_correo=" + fmtFecha_(msg.getDate()), "remitente=" + remitente, "buzon=" + env.buzon,
      src.archivo ? "archivo=" + src.archivo.replace(/[;=]/g, "_") : "", impS.regla_id ? "regla=" + impS.regla_id : "", impS.por_cif ? "por_cif=1" : "",
      !impS.proveedor_id ? "sin_regla=1" : "", sedes.length > 1 && !lineas.length ? "sedes=" + sedes.join("|") : "", total === null ? "sin_total=1" : "",
      ex.fuente === "gemini" ? "fuente=gemini" : "", ex.revisar.length ? "revisar=" + ex.revisar.join("|").replace(/[;=]/g, "_") : "", ex.pagada ? "pagada=1" : "",
    ].filter(Boolean).join(";");
    const base = {
      id_comp, sociedad: env.sociedad,
      fecha: ex.fechaServicio || ex.fechaFactura || "", vto: ex.vto || "",
      subtipo: "EGRESO_BORRADOR",
      contraparte_id: impS.proveedor_id, contraparte_nombre: impS.proveedor || ex.emisor || remitente,
      cuenta_contable: impS.cuentaId ? (ctx.cuentas[impS.cuentaId] || impS.cuentaId) : "", cuenta_contable_id: impS.cuentaId,
      moneda: env.moneda, iva_rate: iva,
      nro_comp: nro, fecha_fiscal: ex.fechaFactura || "",
      nota: notas, registrado_por: "lector-correo", created_at: new Date().toISOString(),
    };
    // Una línea por centro (reparto que trae la factura) o una sola línea. Subtotal: la base imponible que dice la
    // factura si cuadra con el total (IVA mixto 10/21, retenciones); si no, total / (1 + IVA).
    const linea = (i, cc, t, sub) => Object.assign({ id: id_comp + "-L" + ("0" + i).slice(-2), centro_costo: cc, subtotal: sub, iva_monto: round2_(t - sub), total: t }, base);
    const subDe = t => (iva > 0 ? round2_(t / (1 + iva / 100)) : t);
    const baseOk = total !== null && ex.base !== null && ex.base > 0 && ex.base <= total && ex.revisar.indexOf("no_cuadra") === -1;
    f.filas = lineas.length ? lineas.map((l, i) => linea(i + 1, l.centro, l.total, baseOk ? round2_(l.total * ex.base / total) : subDe(l.total)))
      : [linea(1, centro, total !== null ? total : 0, baseOk ? ex.base : subDe(total !== null ? total : 0))];
    env.ids[id_comp] = true;
    facturas.push(f);
  });
  // Todos los PDF del mail eran "no factura" de un remitente desconocido → el mail se descarta (como un aviso cualquiera).
  if (!facturas.length && noFactura && noFactura === fuentes.length) return { descartado: true };
  return { facturas };
}

// ── Web app ───────────────────────────────────────────────────────────────────

function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

// ── Estado en Gmail con etiquetas propias (prefijo Numbers/), reversibles. Nunca archiva ni borra. ───────────
//   Contabilizada / Ignorada → las pone la bandeja al decidir (además marca leído).
//   Descartado → lo que el lector descarta en cada corrida por no ser factura (newsletters, avisos, pedidos…).
//   Lote → ráfagas y lotes de históricos que no se parkean.
//   Sin etiqueta = pendiente (está en la bandeja de Numbers esperando decisión). Borrar lo descartado lo decide
//   una persona en Gmail, filtrando por etiqueta.
const ETIQUETAS = { contabilizada: "Numbers/Contabilizada", ignorada: "Numbers/Ignorada", descartado: "Numbers/Descartado", lote: "Numbers/Lote", respondida: "Numbers/Respondida" };

const _labelCache = {};
function etiqueta_(nombre) {
  if (!_labelCache[nombre]) _labelCache[nombre] = GmailApp.getUserLabelByName(nombre) || GmailApp.createLabel(nombre);
  return _labelCache[nombre];
}
// Etiqueta un hilo una sola vez por corrida (varios mensajes del mismo hilo → una llamada a Gmail).
function etiquetarHilo_(th, clave, yaEtiquetados) {
  const id = th.getId();
  if (yaEtiquetados[id + "|" + clave]) return;
  yaEtiquetados[id + "|" + clave] = true;
  try { th.addLabel(etiqueta_(ETIQUETAS[clave])); } catch (e) { /* sin etiqueta no pasa nada: el memo manda */ }
}

// `ref` = id del hilo (mail_ref de la nota del borrador); si es un id de mensaje, se toma su hilo.
function marcar_(ref, estado) {
  const nombre = ETIQUETAS[String(estado || "").toLowerCase()];
  if (!nombre) throw new Error("Estado desconocido: " + estado);
  let th = null;
  try { th = GmailApp.getThreadById(ref); } catch (e) { th = null; }
  if (!th) { try { th = GmailApp.getMessageById(ref).getThread(); } catch (e) { th = null; } }
  if (!th) throw new Error("No se encontró el mail " + ref + " en " + cfg_("BUZON", ""));
  Object.keys(ETIQUETAS).forEach(k => { if (k !== estado && k !== "respondida") { const l = GmailApp.getUserLabelByName(ETIQUETAS[k]); if (l) th.removeLabel(l); } });
  th.addLabel(etiqueta_(nombre));
  th.markRead();
  return { ok: true, etiqueta: nombre, asunto: th.getFirstMessageSubject() };
}

// ── Acuse de recibo: responde el hilo de la factura desde esta casilla ("Contabilizar y responder" en la bandeja). ──
// `ref` = id del hilo (mail_ref), `para` = destinatario (el remitente real de la nota, editable en el modal),
// `texto` = cuerpo ya confirmado por una persona. Responde al último mensaje del hilo que mandó `para` (queda en
// el mismo hilo); si en el hilo no hay ningún mensaje suyo (llegó reenviado por alguien de BIGG), manda un mail
// nuevo "Re: <asunto>". Deja la etiqueta Numbers/Respondida. Nunca manda nada sin que la bandeja lo pida.
function responder_(ref, para, texto) {
  para = lc_(para).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) throw new Error("Destinatario inválido: " + para);
  if (!String(texto || "").trim()) throw new Error("El texto de la respuesta está vacío");
  let th = null;
  try { th = GmailApp.getThreadById(ref); } catch (e) { th = null; }
  if (!th) { try { th = GmailApp.getMessageById(ref).getThread(); } catch (e) { th = null; } }
  if (!th) throw new Error("No se encontró el mail " + ref + " en " + cfg_("BUZON", ""));
  const asunto = th.getFirstMessageSubject();
  const opciones = { name: cfg_("NOMBRE_REMITENTE", "Administración BIGG España") };
  const suyo = th.getMessages().filter(m => mailDe_(m.getFrom()) === para).pop();
  if (suyo) suyo.reply(texto, opciones);
  else GmailApp.sendEmail(para, "Re: " + asuntoLimpio_(asunto), texto, opciones);
  try { th.addLabel(etiqueta_(ETIQUETAS.respondida)); } catch (e) { /* sin etiqueta no pasa nada */ }
  return { ok: true, para, asunto, en_hilo: !!suyo };
}

// ── Vista previa: devuelve el PDF de una factura parkeada (el mail es la única copia; no se guarda en Drive) ──
// `mail` = id del mensaje (el id_comp del borrador es COR-<mail>[-k]); `archivo` = nombre del adjunto (nota archivo=).
function pdfDe_(mailId, archivo) {
  let msg = null;
  try { msg = GmailApp.getMessageById(mailId); } catch (e) { msg = null; }
  if (!msg) throw new Error("No se encontró el mail " + mailId + " en " + cfg_("BUZON", ""));
  const quiero = String(archivo || "").replace(/[;=]/g, "_");
  const pdfs = msg.getAttachments({ includeInlineImages: false, includeAttachments: true })
    .filter(a => /pdf/i.test(a.getContentType()) || /\.pdf$/i.test(a.getName()));
  const a = pdfs.find(x => x.getName().replace(/[;=]/g, "_") === quiero) || (pdfs.length === 1 ? pdfs[0] : null);
  if (!a) throw new Error("El mail no tiene el PDF " + (archivo || "") + " (adjuntos: " + pdfs.map(x => x.getName()).join(", ") + ")");
  return { ok: true, nombre: a.getName(), mime: "application/pdf", bytes: a.getSize(), base64: Utilities.base64Encode(a.getBytes()) };
}

// GET ?accion=leer[&desde=YYYY-MM-DD][&dry=1]  → corre el lector.   ?accion=estado → config y última corrida.
// ?accion=pdf&mail=<id de mensaje>&archivo=<nombre> → el PDF en base64 (vista previa desde la bandeja).
// ?accion=reset → olvida el memo (vuelve a mirar todo desde la fecha de corte; los parkeados no se duplican).
// ?accion=marcar&ref=<id de hilo>&estado=contabilizada|ignorada → leído + etiqueta Numbers/… en Gmail.
// ?accion=responder&ref=<id de hilo>&para=<mail>&texto=<cuerpo> → acuse de recibo en el hilo (lo confirma una persona).
function doGet(e) {
  const lock = LockService.getScriptLock();
  try {
    const q = e.parameter || {};
    if (q.token !== cfg_("NUMBERS_TOKEN")) return json_({ error: "unauthorized" });
    if (q.accion === "marcar") return json_(marcar_(q.ref, q.estado));
    if (q.accion === "responder") return json_(responder_(q.ref, q.para, q.texto));
    if (q.accion === "pdf") return json_(pdfDe_(q.mail, q.archivo));
    if (q.accion === "retro") { etiquetarRetroactivo(); return json_({ ok: true }); }
    if (q.accion === "estado") {
      return json_({ ok: true, buzon: cfg_("BUZON", ""), sociedad: cfg_("SOCIEDAD"), moneda: cfg_("MONEDA", "EUR"), corte: cfg_("FECHA_CORTE", ""),
        gemini: geminiActivo_() ? cfg_("GEMINI_MODEL", "gemini-3.1-flash-lite") : "", version: 6,
        ultima: JSON.parse(PropertiesService.getScriptProperties().getProperty("ULTIMA") || "null"), memo: Object.keys(memo_()).length });
    }
    if (q.accion === "reset") {
      const p = PropertiesService.getScriptProperties();
      ["PROCESADOS", "CURSOR", "COMPLETA_EN"].forEach(k => p.deleteProperty(k));
      try { CacheService.getScriptCache().removeAll([]); } catch (e) { /* sin caché que limpiar */ }
      return json_({ ok: true });
    }
    if (q.accion !== "leer") return json_({ error: "Acción desconocida" });
    if (!lock.tryLock(5000)) return json_({ error: "El lector ya está corriendo. Esperá a que termine." });
    try { return json_(leerBuzon_({ desde: q.desde || "", dry: q.dry === "1" })); }
    finally { lock.releaseLock(); }
  } catch (err) {
    return json_({ error: err.message });
  }
}

// ── Instalación y utilidades para correr a mano desde el editor ───────────────

function instalar() {
  const props = PropertiesService.getScriptProperties();
  ["NUMBERS_URL", "NUMBERS_TOKEN", "SOCIEDAD"].forEach(k => cfg_(k));
  if (!props.getProperty("BUZON")) props.setProperty("BUZON", Session.getActiveUser().getEmail());
  if (!props.getProperty("MONEDA")) props.setProperty("MONEDA", "EUR");
  if (!props.getProperty("PAIS")) props.setProperty("PAIS", "ES");
  if (!props.getProperty("FECHA_CORTE")) props.setProperty("FECHA_CORTE", "2026-10-01");
  // Prueba de conexión con Numbers y de permisos de Gmail/Drive (falla acá si algo está mal).
  console.log("Proveedores leídos: " + nbGet_("nb_proveedores", {}).length);
  const ctx = cargarContexto_();
  console.log("Reglas del lector en el Sheet: remitente " + ctx.remitente.length + " · asunto " + ctx.asunto.length + " · sede " + ctx.sedes.length);
  console.log("Hilos en la bandeja (7 días): " + GmailApp.search("newer_than:7d", 0, 50).length);
  console.log("Buzón: " + props.getProperty("BUZON") + " → sociedad " + props.getProperty("SOCIEDAD"));
  console.log("Centros de la sociedad: " + Object.keys(ctx.centros).length + " · Gemini: " + (geminiActivo_() ? cfg_("GEMINI_MODEL", "gemini-3.1-flash-lite") : "SIN CLAVE (se usan patrones)"));
}

// Etiqueta en Gmail, de una vez, los mails que el lector YA descartó o apartó como lote en corridas anteriores
// (están en el memo). Correr desde el editor una sola vez al activar las etiquetas; después lo hace cada corrida.
function etiquetarRetroactivo() {
  const memo = memo_();
  const etiquetados = {};
  const conFactura = {};
  let n = 0, fallas = 0;
  Object.keys(memo).forEach(mailId => {
    const clave = memo[mailId] === "descartado" ? "descartado" : memo[mailId] === "lote" ? "lote" : "";
    try {
      const th = GmailApp.getMessageById(mailId).getThread();
      if (clave) { etiquetarHilo_(th, clave, etiquetados); n++; }
      else conFactura[th.getId()] = th;               // "ok" = tuvo factura (parkeada o ya cargada)
    } catch (e) { fallas++; }
  });
  // Un hilo con factura no lleva Descartado aunque otros mensajes del mismo hilo (respuestas) se hayan descartado.
  const quitadas = quitarDescartadoDe_(Object.keys(conFactura).map(k => conFactura[k]));
  console.log("Etiquetados: " + n + " · sin encontrar: " + fallas + " (hilos distintos: " + Object.keys(etiquetados).length + ") · Descartado quitado de " + quitadas + " hilos con factura");
}

function quitarDescartadoDe_(hilos) {
  const l = GmailApp.getUserLabelByName(ETIQUETAS.descartado);
  if (!l) return 0;
  let n = 0;
  hilos.forEach(th => { try { if (th.getLabels().some(x => x.getName() === ETIQUETAS.descartado)) { th.removeLabel(l); n++; } } catch (e) { /* nada */ } });
  return n;
}

// Simulacro: lee y muestra qué parkearía, sin escribir nada. Correr desde el editor y mirar el registro.
function simulacro() {
  const r = leerBuzon_({ dry: true });
  // Resumen primero (el registro del editor trunca los textos largos), después el detalle.
  console.log("RESUMEN: revisados " + r.revisados + " · parkearía " + r.parkeadas.length + " (sin total " + r.parkeadas.filter(p => p.total === null).length +
    ", sin centro " + r.parkeadas.filter(p => !p.centro).length + ") · ya cargadas " + r.ya_cargadas.length + " · sin regla " + r.sin_regla +
    " · descartados " + r.descartados + " · lotes " + r.lotes.length + " · viejas " + r.viejas.length + " · errores " + r.errores.length + (r.parcial ? " · PARCIAL" : "") +
    "\nGemini: " + (r.gemini.activo ? r.gemini.gemini + " PDF leídos por el modelo · " + r.gemini.fallback + " a patrones" : "sin clave (patrones)") + (r.error_gemini ? " · " + r.error_gemini : "") +
    (r.error_pdf ? "\nPDF: " + r.error_pdf : ""));
  const rev = r.parkeadas.filter(p => p.revisar);
  if (rev.length) console.log("PARA REVISAR: " + rev.map(p => p.proveedor + " " + (p.nro || "(sin nro)") + " → " + p.revisar).join(" | "));
  if (r.lotes.length) console.log("LOTES (no se parkean): " + r.lotes.map(l => l.remitente + " · " + l.mail + " (" + l.pdfs.length + " PDF)").join(" | "));
  if (r.viejas.length) console.log("VIEJAS (fecha de factura muy anterior al corte, no se parkean): " + r.viejas.map(v => v.proveedor + " " + v.nro + " " + v.fecha).join(" | "));
  if (r.ya_cargadas.length) console.log("YA CARGADAS: " + r.ya_cargadas.map(v => v.proveedor + " " + v.nro + " → " + v.egreso).join(" | "));
  // Con SIMULACRO_FILTRO se re-leen mails ya procesados: lo que ya está en la bandeja se muestra con lo que el modelo
  // extrajo ahora (proveedor · nº · total · centro · fuente · revisar), para comparar contra lo parkeado antes.
  if (r.ya_parkeadas.length) console.log("YA EN BANDEJA (re-leídas para comparar):\n" + r.ya_parkeadas.map(p =>
    [p.proveedor, p.nro || "(sin nro)", p.total === null ? "(sin total)" : p.total, p.centro || "(sin centro)", p.fuente, p.revisar || "", p.archivo].join(" · ")).join("\n"));
  console.log(r.parkeadas.map(p => [p.proveedor, p.nro || "(sin nro)", p.total === null ? "(sin total)" : p.total, p.centro || "(sin centro)", p.archivo].join(" · ")).join("\n"));
  if (r.errores.length) console.log("ERRORES: " + JSON.stringify(r.errores));
  // Diagnóstico de lo que quedó para revisar (solo los 6 primeros distintos por proveedor): dudas del modelo, o el
  // texto del PDF cuando fue por patrones y faltó el total o la fecha.
  const vistos = {}; const diag = r.parkeadas.filter(p => p.diag && !vistos[p.proveedor] && (vistos[p.proveedor] = true)).slice(0, 6);
  if (diag.length) console.log("DIAGNÓSTICO:\n" + diag.map(p => "— " + p.proveedor + " · " + p.archivo + "\n" + p.diag).join("\n"));
}
