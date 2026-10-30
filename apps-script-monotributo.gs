// ─────────────────────────────────────────────────────────────────────────────
// BIGG Monotributo — Apps Script INDEPENDIENTE (proyecto propio, no el de Sueldos)
// ─────────────────────────────────────────────────────────────────────────────
//
// Qué hace:
//   - Día 12: manda a cada monotributista un mail con su link personal para cargar el importe del
//     monotributo del mes y adjuntar el comprobante (vence el 20 o el hábil siguiente; quien paga a
//     mano carga apenas paga, quien tiene débito automático después del débito).
//   - Días 24 y 27: recordatorio SOLO a quien todavía no cargó.
//   - Recibe la carga (vía /api/monotributo de la app): guarda el comprobante en Drive y da de alta
//     la novedad en su_novedades (solapa Monotributo de Novedades HQ) con estado "pendiente".
//     Alguien la aprueba desde la app; recién ahí entra en la liquidación.
//
// No toca la planilla directo: lee y escribe por la API del GAS de Sueldos (mismo formato que la app).
//
// PUESTA EN MARCHA: ver docs/monotributo-autocarga.md
//
// Propiedades del script (Configuración del proyecto → Propiedades del script):
//   SUELDOS_URL    URL /exec del Apps Script de BIGG Sueldos (= VITE_SUELDOS_API_URL)
//   SUELDOS_TOKEN  token del GAS de Sueldos (= VITE_SHEETS_TOKEN)
//   APP_URL        URL de la app, ej. https://xxxx.vercel.app (sin barra al final)
//   ADMIN_EMAIL    a quién mandar la vista previa del mail
//   SECRET, FOLDER_ID → los crea solos `instalar()`
// ─────────────────────────────────────────────────────────────────────────────

const TZ = "America/Argentina/Buenos_Aires";

// Quienes cargan solos. Gigio, Guido, Ignacio y Victoria NO: los carga administración a mano.
// (Misma lista que IDS_MONOTRIBUTO_AUTOCARGA en src/sueldos/PantallaNovedades.jsx.)
const AUTOCARGA = [
  "LEG-nako-0011", // Ana Leber
  "LEG-nako-0026", // Facundo Martino
  "LEG-nako-0006", // Federico Bosch
  "LEG-nako-0016", // Federico Bracco
  "LEG-nako-0017", // Florencia Silveyra
  "LEG-nako-0003", // Francisco Bosch
  "LEG-nako-0019", // Jennifer Schwimmer
  "LEG-nako-0010", // Lucia Pini
  "LEG-nako-0002", // Martin Bergara
  "LEG-nako-0008", // Martin Miauro
  "LEG-nako-0009", // Matias Soloaga
  "LEG-nako-0012", // Santiago Paz
  "LEG-nako-0021", // Sara Salviu
  "LEG-nako-0015", // Tomas Mogaburu
];

const MESES = ["enero","febrero","marzo","abril","mayo","junio",
               "julio","agosto","septiembre","octubre","noviembre","diciembre"];

const CUENTA_ID     = "CUENTA_Monotributo";
const CUENTA_NOMBRE = "Monotributo";

// ── Config ────────────────────────────────────────────────────────────────────

function cfg_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error("Falta la propiedad del script " + k);
  return v;
}

// Período = mes en que se paga el monotributo ("2026-10"). Se devuelve en la liquidación de ese mes.
function periodoActual_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM"); }
function mesLabel_(periodo) {
  const [a, m] = periodo.split("-");
  return MESES[Number(m) - 1] + " " + a;
}

// ── Firma del link: HMAC(legajo|período). El link no se puede armar para otro legajo ni otro mes. ──

function firma_(legajoId, periodo) {
  const raw = Utilities.computeHmacSha256Signature(legajoId + "|" + periodo, cfg_("SECRET"));
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, "").slice(0, 24);
}

function linkDe_(legajoId, periodo) {
  return cfg_("APP_URL") + "/?monotributo=1&l=" + encodeURIComponent(legajoId) +
    "&p=" + periodo + "&t=" + firma_(legajoId, periodo);
}

function verificar_(l, p, t) {
  if (!l || !/^\d{4}-\d{2}$/.test(p || "") || !t) throw new Error("Link inválido.");
  if (AUTOCARGA.indexOf(l) === -1 || firma_(l, p) !== t) throw new Error("Link inválido.");
}

// ── API del GAS de Sueldos ────────────────────────────────────────────────────

function sueldosGet_(resource, params) {
  const q = Object.keys(params || {}).map(k => "&" + k + "=" + encodeURIComponent(params[k])).join("");
  const url = cfg_("SUELDOS_URL") + "?resource=" + resource + "&token=" + encodeURIComponent(cfg_("SUELDOS_TOKEN")) + q;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  const data = JSON.parse(res.getContentText());
  if (data && data.error) throw new Error(data.error);
  return Array.isArray(data) ? data : [];
}

function sueldosPost_(payload) {
  payload.token = cfg_("SUELDOS_TOKEN");
  const res = UrlFetchApp.fetch(cfg_("SUELDOS_URL"), {
    method: "post", contentType: "application/json", payload: JSON.stringify(payload),
    muteHttpExceptions: true, followRedirects: true,
  });
  const data = JSON.parse(res.getContentText());
  if (data && data.error) throw new Error(data.error);
  return data;
}

function legajo_(id) {
  const l = sueldosGet_("su_legajos", { id: id })[0];
  if (!l) throw new Error("No se encontró el legajo " + id);
  return l;
}

const esMono_ = (n) => n.tipo === "extra" && !n.sede_id && String(n.cuenta_contable_nombre || "").trim().toLowerCase() === "monotributo";

// Novedades de Monotributo (HQ) del período, de un legajo o de todos.
function novedadesMono_(periodo, legajoId) {
  const [a, m] = periodo.split("-");
  const params = { mes: Number(m), anio: Number(a) };
  if (legajoId) params.legajo_id = legajoId;
  return sueldosGet_("su_novedades", params).filter(esMono_);
}

function periodoAnterior_(periodo) {
  const [a, m] = periodo.split("-").map(Number);
  return m === 1 ? (a - 1) + "-12" : a + "-" + ("0" + (m - 1)).slice(-2);
}

// ── Web app ───────────────────────────────────────────────────────────────────

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// GET ?accion=info&l=&p=&t= → datos para la página de carga.
function doGet(e) {
  try {
    const q = e.parameter || {};
    if (q.accion !== "info") return json_({ error: "Acción desconocida" });
    verificar_(q.l, q.p, q.t);
    const leg  = legajo_(q.l);
    const mia  = novedadesMono_(q.p, q.l)[0];
    const prev = novedadesMono_(periodoAnterior_(q.p), q.l)[0];
    return json_({
      nombre: leg.nombre, periodo: q.p, mesLabel: mesLabel_(q.p),
      carga: mia ? { monto: Number(mia.monto) || 0, estado: mia.estado || "aprobada", comprobante_url: mia.comprobante_url || "" } : null,
      montoAnterior: prev ? Number(prev.monto) || 0 : 0,
    });
  } catch (err) {
    return json_({ error: err.message });
  }
}

// POST { accion: "cargar", l, p, t, monto, archivo: { nombre, mime, base64 } }
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const d = JSON.parse(e.postData.contents || "{}");
    if (d.accion !== "cargar") return json_({ error: "Acción desconocida" });
    verificar_(d.l, d.p, d.t);
    const monto = Number(d.monto);
    if (!(monto > 0)) throw new Error("Cargá el importe.");

    lock.waitLock(30000);
    const leg = legajo_(d.l);
    const existente = novedadesMono_(d.p, d.l)[0];
    // Ya aprobada, o cargada a mano por administración (sin estado) → no se pisa.
    if (existente && existente.estado !== "pendiente")
      throw new Error("El monotributo de este mes ya está aprobado. Si hay que corregirlo, escribile a administración.");

    // Corrección de una carga pendiente: puede cambiar solo el importe y conservar el comprobante.
    const tieneArchivo = d.archivo && d.archivo.base64;
    if (!tieneArchivo && !(existente && existente.comprobante_url)) throw new Error("Adjuntá el comprobante.");
    const url = tieneArchivo
      ? guardarComprobante_(d.p, leg.nombre, d.archivo, existente && existente.comprobante_url)
      : existente.comprobante_url;

    if (existente) {
      // Fila completa (como hace la app): no se sabe si el GAS de Sueldos pisa las columnas que faltan.
      sueldosPost_({ action: "upd", sheet: "su_novedades", id: existente.id,
        row: Object.assign({}, existente, { monto: monto, comprobante_url: url, estado: "pendiente" }) });
    } else {
      const prev = novedadesMono_(periodoAnterior_(d.p), d.l)[0];
      const [a, m] = d.p.split("-");
      sueldosPost_({ action: "add", sheet: "su_novedades", row: {
        id: "NOV-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7).toUpperCase(),
        mes: Number(m), anio: Number(a),
        legajo_id: d.l, legajo_nombre: leg.nombre,
        sede_id: "", sede_nombre: "",
        tipo: "extra", descripcion: "Monotributo",
        monto: monto,
        forma_pago: (prev && prev.forma_pago) || "deposito",
        cuenta_contable_id: (prev && prev.cuenta_contable_id) || CUENTA_ID,
        cuenta_contable_nombre: CUENTA_NOMBRE,
        estado: "pendiente", comprobante_url: url,
        created_at: new Date().toISOString(),
      } });
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ error: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ── Drive ─────────────────────────────────────────────────────────────────────

// Carpeta raíz → subcarpeta por período → "2026-10 - Ana Leber.pdf". Si vuelve a subir, el anterior va a la papelera.
function guardarComprobante_(periodo, nombre, archivo, urlAnterior) {
  const raiz = DriveApp.getFolderById(cfg_("FOLDER_ID"));
  const it = raiz.getFoldersByName(periodo);
  const carpeta = it.hasNext() ? it.next() : raiz.createFolder(periodo);
  const ext = (String(archivo.nombre || "").match(/\.[a-z0-9]{1,5}$/i) || [""])[0].toLowerCase();
  const blob = Utilities.newBlob(Utilities.base64Decode(archivo.base64), archivo.mime || "application/octet-stream",
    periodo + " - " + nombre + ext);
  const file = carpeta.createFile(blob);
  try { file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* política del dominio */ }
  if (urlAnterior) {
    const m = String(urlAnterior).match(/\/d\/([^/]+)/);
    if (m) try { DriveApp.getFileById(m[1]).setTrashed(true); } catch (e) { /* ya no existe */ }
  }
  return file.getUrl();
}

// ── Mails ─────────────────────────────────────────────────────────────────────

function htmlMail_(nombre, periodo, link, esRecordatorio) {
  const pila = String(nombre || "").split(" ")[0];
  const intro = esRecordatorio
    ? "Todavía no cargaste el monotributo de <b>" + mesLabel_(periodo) + "</b>."
    : "Cuando pagues el monotributo de <b>" + mesLabel_(periodo) + "</b>, cargalo con este link para que te lo devolvamos con la liquidación del mes.";
  const debito = esRecordatorio ? ""
    : "<p>Si lo tenés en débito automático, cargalo después del 20, cuando ya se haya debitado.</p>";
  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;max-width:520px">' +
    "<p>Hola " + pila + ",</p>" +
    "<p>" + intro + "</p>" + debito +
    "<p>Solo tenés que poner el importe que pagaste y adjuntar el comprobante (PDF, foto o captura de pantalla).</p>" +
    '<p style="margin:24px 0"><a href="' + link + '" style="background:#2563eb;color:#fff;text-decoration:none;' +
    'padding:11px 20px;border-radius:7px;font-weight:bold">Cargar monotributo</a></p>' +
    '<p style="color:#64748b;font-size:12px">El link es personal, no lo reenvíes.</p>' +
    "<p>Gracias,<br>Administración BIGG</p></div>";
}

function enviar_(to, nombre, periodo, legajoId, esRecordatorio) {
  MailApp.sendEmail({
    to: to,
    subject: (esRecordatorio ? "Recordatorio: " : "") + "Cargá tu monotributo de " + mesLabel_(periodo),
    htmlBody: htmlMail_(nombre, periodo, linkDe_(legajoId, periodo), esRecordatorio),
    name: "BIGG Administración",
  });
}

// Disparador día 12 (a todos).
function enviarMailsMonotributo() {
  const periodo = periodoActual_();
  const legs = sueldosGet_("su_legajos", {});
  for (const id of AUTOCARGA) {
    const l = legs.find(x => x.id === id);
    if (!l || !l.email || String(l.activo) === "false") { console.warn("Sin mail/inactivo: " + id); continue; }
    enviar_(l.email, l.nombre, periodo, id, false);
  }
}

// Disparadores días 24 y 27: solo a quien no cargó (pendiente o aprobada cuenta como cargado).
function recordatorioMonotributo() {
  const periodo = periodoActual_();
  const cargados = new Set(novedadesMono_(periodo).map(n => n.legajo_id));
  const legs = sueldosGet_("su_legajos", {});
  for (const id of AUTOCARGA) {
    if (cargados.has(id)) continue;
    const l = legs.find(x => x.id === id);
    if (!l || !l.email || String(l.activo) === "false") continue;
    enviar_(l.email, l.nombre, periodo, id, true);
  }
}

// Vista previa: manda los dos mails (aviso y recordatorio) SOLO a ADMIN_EMAIL, con el link de Santiago Paz.
function vistaPreviaMail() {
  const id = "LEG-nako-0012";
  const l = legajo_(id);
  enviar_(cfg_("ADMIN_EMAIL"), l.nombre, periodoActual_(), id, false);
  enviar_(cfg_("ADMIN_EMAIL"), l.nombre, periodoActual_(), id, true);
}

// ── Instalación (correr UNA vez a mano) ──────────────────────────────────────

function instalar() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("SECRET")) props.setProperty("SECRET", Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty("FOLDER_ID")) props.setProperty("FOLDER_ID", DriveApp.createFolder("Comprobantes Monotributo").getId());
  for (const t of ScriptApp.getProjectTriggers()) {
    if (["enviarMailsMonotributo", "recordatorioMonotributo"].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger("enviarMailsMonotributo").timeBased().onMonthDay(12).atHour(9).inTimezone(TZ).create();
  // Dos recordatorios (24 y 27), cada uno solo a quien todavía no cargó.
  ScriptApp.newTrigger("recordatorioMonotributo").timeBased().onMonthDay(24).atHour(9).inTimezone(TZ).create();
  ScriptApp.newTrigger("recordatorioMonotributo").timeBased().onMonthDay(27).atHour(9).inTimezone(TZ).create();
  // Prueba de conexión con Sueldos (falla acá si SUELDOS_URL / SUELDOS_TOKEN están mal).
  console.log("Legajos leídos: " + sueldosGet_("su_legajos", {}).length);
  console.log("Listo. Carpeta: https://drive.google.com/drive/folders/" + props.getProperty("FOLDER_ID"));
}
