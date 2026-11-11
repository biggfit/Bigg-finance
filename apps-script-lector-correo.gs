// ─────────────────────────────────────────────────────────────────────────────
// BIGG Lector de Correo — Apps Script INDEPENDIENTE, uno por casilla (pagos.es@ / pagos@)
// ─────────────────────────────────────────────────────────────────────────────
//
// Qué hace:
//   - Corre DENTRO de la casilla (se crea el proyecto logueado como pagos.es@bigg.fit): lee su propia
//     bandeja con permiso de solo lectura. Sin delegación, sin reenvíos, sin cron: se dispara con el
//     botón "Leer el buzón" de Reportes › Correo (GET ?accion=leer).
//   - Por cada mail con factura (PDF adjunto o remitente conocido): identifica al proveedor, extrae
//     número, fecha, vencimiento, total e IVA (del cuerpo y del texto del PDF) y la sede, y la PARKEA en
//     nb_comprobantes como subtipo EGRESO_BORRADOR. El equipo la contabiliza o ignora desde la bandeja.
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
// Servicio avanzado requerido: Drive API (v2) — se usa para sacar el texto de los PDF (conversión a Doc).
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
  return {
    remitente: porTipo("remitente"), asunto: porTipo("asunto"), sedes,
    proveedores, provPorId: Object.fromEntries(proveedores.map(p => [String(p.id), p])),
    cuentas,
  };
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
  for (const [frag, centro] of ctx.sedes) if (frag && t.indexOf(frag) !== -1) hits[centro] = true;
  return Object.keys(hits);
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
             || fecha_((/Invoice\s+Date\s*[:\s]*([^\n]{6,20})/i.exec(t) || [])[1])
             || fecha_((/(?:^|\n)\s*Fecha\s*[:\s]+([^\n]{6,20})/i.exec(t) || [])[1])
             || fecha_((/,\s*(?:el|a)\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(t) || [])[1])          // "Las Rozas, el 01/11/2026"
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

  const res = { ok: true, buzon, sociedad, desde, revisados: 0, parkeadas: [], ya_cargadas: [], viejas: [], sin_regla: 0, descartados: 0, lotes: [], errores: [], parcial: false, dry };
  const filas = [];
  ultimoErrorPdf_ = "";
  const vistos = {};                                              // PDFs ya tomados en esta corrida (proveedor|archivo|bytes)
  const maxMs = dry ? 300000 : MAX_MS_POR_CORRIDA;                // desde el editor (simulacro) hay 6 min; desde el botón, 45 s
  const [y, mo, d] = desde.split("-");
  // En un simulacro, la propiedad SIMULACRO_FILTRO acota la búsqueda (ej. "from:grupovoldis.es") para probar un proveedor.
  const filtro = dry ? cfg_("SIMULACRO_FILTRO", "") : "";
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
        if (memo[mailId]) continue;
        res.revisados++;
        const b = bucketDe(msg.getFrom(), msg.getDate());
        if (porBucket[b] > maxRafaga) {
          if (!rafagaVista[b]) { rafagaVista[b] = true; res.lotes.push({ mail: "ráfaga de " + porBucket[b] + " mails en 5 min (" + msg.getSubject() + "…)", remitente: mailDe_(msg.getFrom()), pdfs: new Array(porBucket[b]).fill(""), fecha: fmtFecha_(msg.getDate()) }); }
          memo[mailId] = "lote";
          if (!dry) etiquetarHilo_(th, "lote", etiquetados);
          continue;
        }
        try {
          const r = procesarMail_(ctx, msg, th, { sociedad, moneda, buzon, ids, yaCargada, yaParkeada, vistos, corte });
          if (r.descartado) { memo[mailId] = "descartado"; res.descartados++; if (!dry) etiquetarHilo_(th, "descartado", etiquetados); continue; }
          // Lote (muchos PDF en un mail: históricos, regularizaciones): no se parkea, se avisa para mirarlo a mano.
          if (r.lote) { res.lotes.push({ mail: msg.getSubject(), remitente: r.remitente, pdfs: r.lote, fecha: fmtFecha_(msg.getDate()) }); memo[mailId] = "lote"; if (!dry) etiquetarHilo_(th, "lote", etiquetados); continue; }
          let todoResuelto = true;
          for (const f of r.facturas) {
            if (f.vieja) { res.viejas.push({ proveedor: f.proveedor, nro: f.nro, total: f.total, fecha: f.vieja, archivo: f.archivo }); continue; }
            if (f.ya_cargada) { res.ya_cargadas.push({ proveedor: f.proveedor, nro: f.nro, total: f.total, egreso: f.ya_cargada }); continue; }
            if (f.duplicado) continue;    // ya parkeada antes (candado 1)
            if (!f.proveedor_id) res.sin_regla++;
            res.parkeadas.push({ proveedor: f.proveedor || f.remitente, nro: f.nro, total: f.total, centro: f.centro, archivo: f.archivo, sin_regla: !f.proveedor_id, diag: dry ? f.diag : undefined });
            if (!dry) filas.push(f.fila); else todoResuelto = false;
          }
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
    // Parcial: se guarda la página para retomar; completa: se olvida el cursor y la próxima ventana arranca
    // dos días antes de hoy (lo ya procesado queda en el memo).
    if (res.parcial) props.setProperty("CURSOR", String(start)); else { props.deleteProperty("CURSOR"); props.setProperty("COMPLETA_EN", new Date().toISOString()); }
  }
  if (ultimoErrorPdf_) res.error_pdf = "No se pudo leer el texto de los PDF: " + ultimoErrorPdf_;
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
  fuentes.forEach(src => {
    // Mismo PDF (proveedor + nombre + tamaño) ya visto en esta corrida (ej. un hilo con el mail repetido) → no se duplica.
    const firma = (imp.proveedor_id || remitente) + "|" + src.archivo + "|" + src.bytes;
    if (src.archivo && env.vistos[firma]) return;
    env.vistos[firma] = true;
    if (src.texto === null) src.texto = textoPdf_(src.blob);
    const id_comp = "COR-" + msg.getId() + (src.k ? "-" + src.k : "");
    const textoTot = (src.texto || "") + "\n" + cuerpo;
    const nro   = extraerNro_(src.texto || cuerpo, asunto, src.archivo);
    // Total: clave inequívoca en el PDF y/o en el cuerpo del mail (si hay dos, la mayor: la menor suele ser un
    // subtotal) → "Total" genérico del PDF → del cuerpo.
    const totalPdfFuerte = src.texto ? totalFuerte_(src.texto) : null;
    const totalPdfGen = src.texto ? totalGenerico_(src.texto) : null;
    const total = (totalPdfFuerte !== null || totalCuerpoFuerte !== null) ? Math.max(totalPdfFuerte || 0, totalCuerpoFuerte || 0)
      : totalPdfGen !== null ? totalPdfGen : totalCuerpo;
    const fe    = extraerFechas_(src.texto || cuerpo, msg.getDate());
    const iva   = extraerIva_(src.texto || cuerpo);
    const sedes = imp.centro ? [imp.centro] : sedesEnTexto_(ctx, asunto + "\n" + textoTot);
    const centro = sedes.length === 1 ? sedes[0] : "";
    const f = { archivo: src.archivo, remitente, proveedor_id: imp.proveedor_id, proveedor: imp.proveedor, nro, total, centro, duplicado: false, ya_cargada: "", vieja: "" };
    // Diagnóstico para el simulacro: si faltó el total o la fecha salió del mail (no del PDF), un pedazo del texto.
    if (total === null || fe.fechaFactura === fmtFecha_(msg.getDate())) f.diag = plano_(src.texto || "").replace(/\n+/g, " ⏎ ").slice(0, 500);
    if (fe.fechaFactura && new Date(fe.fechaFactura + "T00:00:00") < limiteVieja) { f.vieja = fe.fechaFactura; facturas.push(f); return; }   // histórico reenviado
    if (env.ids[id_comp]) { f.duplicado = true; facturas.push(f); return; }                     // candado 1
    if (env.yaParkeada(imp, nro, src.archivo)) { f.duplicado = true; facturas.push(f); return; } // mismo nº o mismo PDF ya en la bandeja (otro mail del hilo)
    f.ya_cargada = env.yaCargada(imp, nro, total, (fe.fechaServicio || "").slice(0, 7));          // candados 2 y 3
    if (f.ya_cargada) { facturas.push(f); return; }

    const t = total !== null ? total : 0;
    const sub = iva > 0 ? round2_(t / (1 + iva / 100)) : t;
    const notas = [
      "mail_ref=" + th.getId(), "fecha_correo=" + fmtFecha_(msg.getDate()), "remitente=" + remitente, "buzon=" + env.buzon,
      src.archivo ? "archivo=" + src.archivo.replace(/[;=]/g, "_") : "", imp.regla_id ? "regla=" + imp.regla_id : "",
      !imp.proveedor_id ? "sin_regla=1" : "", sedes.length > 1 ? "sedes=" + sedes.join("|") : "", total === null ? "sin_total=1" : "",
    ].filter(Boolean).join(";");
    f.fila = {
      id: id_comp + "-L01", id_comp, sociedad: env.sociedad,
      fecha: fe.fechaServicio || fe.fechaFactura || "", vto: fe.vto || "",
      subtipo: "EGRESO_BORRADOR",
      contraparte_id: imp.proveedor_id, contraparte_nombre: imp.proveedor || remitente,
      cuenta_contable: imp.cuentaId ? (ctx.cuentas[imp.cuentaId] || imp.cuentaId) : "", cuenta_contable_id: imp.cuentaId,
      moneda: env.moneda, centro_costo: centro,
      subtotal: sub, iva_rate: iva, iva_monto: round2_(t - sub), total: t,
      nro_comp: nro, fecha_fiscal: fe.fechaFactura || "",
      nota: notas, registrado_por: "lector-correo", created_at: new Date().toISOString(),
    };
    env.ids[id_comp] = true;
    facturas.push(f);
  });
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
const ETIQUETAS = { contabilizada: "Numbers/Contabilizada", ignorada: "Numbers/Ignorada", descartado: "Numbers/Descartado", lote: "Numbers/Lote" };

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
  Object.keys(ETIQUETAS).forEach(k => { if (k !== estado) { const l = GmailApp.getUserLabelByName(ETIQUETAS[k]); if (l) th.removeLabel(l); } });
  th.addLabel(etiqueta_(nombre));
  th.markRead();
  return { ok: true, etiqueta: nombre, asunto: th.getFirstMessageSubject() };
}

// GET ?accion=leer[&desde=YYYY-MM-DD][&dry=1]  → corre el lector.   ?accion=estado → config y última corrida.
// ?accion=reset → olvida el memo (vuelve a mirar todo desde la fecha de corte; los parkeados no se duplican).
// ?accion=marcar&ref=<id de hilo>&estado=contabilizada|ignorada → leído + etiqueta Numbers/… en Gmail.
function doGet(e) {
  const lock = LockService.getScriptLock();
  try {
    const q = e.parameter || {};
    if (q.token !== cfg_("NUMBERS_TOKEN")) return json_({ error: "unauthorized" });
    if (q.accion === "marcar") return json_(marcar_(q.ref, q.estado));
    if (q.accion === "retro") { etiquetarRetroactivo(); return json_({ ok: true }); }
    if (q.accion === "estado") {
      return json_({ ok: true, buzon: cfg_("BUZON", ""), sociedad: cfg_("SOCIEDAD"), moneda: cfg_("MONEDA", "EUR"), corte: cfg_("FECHA_CORTE", ""),
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
}

// Etiqueta en Gmail, de una vez, los mails que el lector YA descartó o apartó como lote en corridas anteriores
// (están en el memo). Correr desde el editor una sola vez al activar las etiquetas; después lo hace cada corrida.
function etiquetarRetroactivo() {
  const memo = memo_();
  const etiquetados = {};
  let n = 0, fallas = 0;
  Object.keys(memo).forEach(mailId => {
    const clave = memo[mailId] === "descartado" ? "descartado" : memo[mailId] === "lote" ? "lote" : "";
    if (!clave) return;
    try { etiquetarHilo_(GmailApp.getMessageById(mailId).getThread(), clave, etiquetados); n++; }
    catch (e) { fallas++; }
  });
  console.log("Etiquetados: " + n + " · sin encontrar: " + fallas + " (hilos distintos: " + Object.keys(etiquetados).length + ")");
}

// Simulacro: lee y muestra qué parkearía, sin escribir nada. Correr desde el editor y mirar el registro.
function simulacro() {
  const r = leerBuzon_({ dry: true });
  // Resumen primero (el registro del editor trunca los textos largos), después el detalle.
  console.log("RESUMEN: revisados " + r.revisados + " · parkearía " + r.parkeadas.length + " (sin total " + r.parkeadas.filter(p => p.total === null).length +
    ", sin centro " + r.parkeadas.filter(p => !p.centro).length + ") · ya cargadas " + r.ya_cargadas.length + " · sin regla " + r.sin_regla +
    " · descartados " + r.descartados + " · lotes " + r.lotes.length + " · viejas " + r.viejas.length + " · errores " + r.errores.length + (r.parcial ? " · PARCIAL" : "") +
    (r.error_pdf ? "\nPDF: " + r.error_pdf : "\nPDF: texto leído OK"));
  if (r.lotes.length) console.log("LOTES (no se parkean): " + r.lotes.map(l => l.remitente + " · " + l.mail + " (" + l.pdfs.length + " PDF)").join(" | "));
  if (r.viejas.length) console.log("VIEJAS (fecha de factura muy anterior al corte, no se parkean): " + r.viejas.map(v => v.proveedor + " " + v.nro + " " + v.fecha).join(" | "));
  if (r.ya_cargadas.length) console.log("YA CARGADAS: " + r.ya_cargadas.map(v => v.proveedor + " " + v.nro + " → " + v.egreso).join(" | "));
  console.log(r.parkeadas.map(p => [p.proveedor, p.nro || "(sin nro)", p.total === null ? "(sin total)" : p.total, p.centro || "(sin centro)", p.archivo].join(" · ")).join("\n"));
  if (r.errores.length) console.log("ERRORES: " + JSON.stringify(r.errores));
  // Texto de los PDF que quedaron sin total o sin fecha propia (solo los 6 primeros distintos por proveedor), para afinar la extracción.
  const vistos = {}; const diag = r.parkeadas.filter(p => p.diag && !vistos[p.proveedor] && (vistos[p.proveedor] = true)).slice(0, 6);
  if (diag.length) console.log("DIAGNÓSTICO (texto del PDF):\n" + diag.map(p => "— " + p.proveedor + " · " + p.archivo + "\n" + p.diag).join("\n"));
}
