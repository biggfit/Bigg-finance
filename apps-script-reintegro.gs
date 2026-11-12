// ─────────────────────────────────────────────────────────────────────────────
// BIGG Reintegros — Apps Script INDEPENDIENTE (proyecto propio, no el de Sueldos)
// ─────────────────────────────────────────────────────────────────────────────
//
// Qué hace:
//   - Da a cada persona un LINK PERSONAL PERMANENTE (un "formulario de reintegro"). Lo usa cuando
//     tiene un gasto para que se lo reintegren con el sueldo. No manda mails ni tiene disparadores:
//     el link se reparte una vez (WhatsApp / mail) o se guarda.
//   - Recibe la carga (vía /api/reintegro de la app): el formulario permite VARIAS líneas, cada una
//     con descripción + importe + uno o VARIOS comprobantes (foto/PDF). Guarda los comprobantes en
//     Drive y da de alta UNA novedad "Otros" por línea en su_novedades (solapa Otros de Novedades HQ)
//     con estado "pendiente" y SIN cuenta contable: la asigna administración al aprobar.
//
// No toca la planilla directo: lee y escribe por la API del GAS de Sueldos (mismo formato que la app).
//
// PUESTA EN MARCHA: ver docs/reintegro-autocarga.md
//
// Propiedades del script (Configuración del proyecto → Propiedades del script):
//   SUELDOS_URL    URL /exec del Apps Script de BIGG Sueldos (= VITE_SUELDOS_API_URL)
//   SUELDOS_TOKEN  token del GAS de Sueldos (= VITE_SHEETS_TOKEN)
//   APP_URL        URL de la app, ej. https://xxxx.vercel.app (sin barra al final)
//   SECRET, FOLDER_ID → los crea solos `instalar()`
// ─────────────────────────────────────────────────────────────────────────────

const TZ = "America/Argentina/Buenos_Aires";

const MESES = ["enero","febrero","marzo","abril","mayo","junio",
               "julio","agosto","septiembre","octubre","noviembre","diciembre"];

// Reintegros: la cuenta la asigna administración al aprobar (el que carga solo describe el gasto).
const FORMA_PAGO_DEFAULT = "deposito";
const SEP_URLS = " | ";   // varios comprobantes en el único campo comprobante_url

// ── Config ────────────────────────────────────────────────────────────────────

function cfg_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error("Falta la propiedad del script " + k);
  return v;
}

// Período = mes en que se carga el gasto ("2026-11"). Se devuelve con la liquidación de ese mes.
function periodoActual_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM"); }
function mesLabel_(periodo) {
  const [a, m] = periodo.split("-");
  return MESES[Number(m) - 1] + " " + a;
}

// ── Firma del link: HMAC(legajo). Link PERMANENTE (no lleva período): sirve todos los meses, y el
//    server usa el mes en curso al recibir la carga. No se puede armar para otro legajo. ──

function firma_(legajoId) {
  const raw = Utilities.computeHmacSha256Signature("reintegro|" + legajoId, cfg_("SECRET"));
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, "").slice(0, 24);
}

function linkDe_(legajoId) {
  return cfg_("APP_URL") + "/?reintegro=1&l=" + encodeURIComponent(legajoId) + "&t=" + firma_(legajoId);
}

function verificar_(l, t) {
  if (!l || !t) throw new Error("Link inválido.");
  if (firma_(l) !== t) throw new Error("Link inválido.");
  const leg = legajo_(l);
  if (String(leg.activo) === "false") throw new Error("Este legajo está inactivo.");
  return leg;
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

// ── Web app ───────────────────────────────────────────────────────────────────

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// GET ?accion=info&l=&t= → datos para la página del formulario.
function doGet(e) {
  try {
    const q = e.parameter || {};
    if (q.accion !== "info") return json_({ error: "Acción desconocida" });
    const leg = verificar_(q.l, q.t);
    const periodo = periodoActual_();
    return json_({ nombre: leg.nombre, periodo: periodo, mesLabel: mesLabel_(periodo) });
  } catch (err) {
    return json_({ error: err.message });
  }
}

// POST { accion: "cargar", l, t, lineas: [{ descripcion, monto, comprobantes: [{ nombre, mime, base64 }] }] }
// Crea UNA novedad "Otros" pendiente por línea. El período es el mes en curso del servidor.
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const d = JSON.parse(e.postData.contents || "{}");
    if (d.accion !== "cargar") return json_({ error: "Acción desconocida" });
    const leg = verificar_(d.l, d.t);

    const lineas = Array.isArray(d.lineas) ? d.lineas : [];
    const validas = lineas.filter(ln => Number(ln.monto) > 0);
    if (!validas.length) throw new Error("Cargá al menos un gasto con importe.");
    for (const ln of validas) {
      if (!String(ln.descripcion || "").trim()) throw new Error("Cada gasto necesita una descripción.");
      if (!(ln.comprobantes && ln.comprobantes.length && ln.comprobantes[0] && ln.comprobantes[0].base64))
        throw new Error("Adjuntá el comprobante de cada gasto.");
    }

    lock.waitLock(30000);
    const periodo = periodoActual_();
    const [a, m] = periodo.split("-");
    const creadas = [];
    for (const ln of validas) {
      const urls = (ln.comprobantes || [])
        .filter(c => c && c.base64)
        .map(c => guardarComprobante_(periodo, leg.nombre, c));
      sueldosPost_({ action: "add", sheet: "su_novedades", row: {
        id: "NOV-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7).toUpperCase(),
        mes: Number(m), anio: Number(a),
        legajo_id: d.l, legajo_nombre: leg.nombre,
        sede_id: "", sede_nombre: "",                       // HQ: la solapa Otros filtra por sede vacía
        tipo: "extra", descripcion: String(ln.descripcion).trim(),
        monto: Number(ln.monto),
        forma_pago: FORMA_PAGO_DEFAULT,
        cuenta_contable_id: "", cuenta_contable_nombre: "", // la asigna administración al aprobar
        estado: "pendiente", comprobante_url: urls.join(SEP_URLS),
        created_at: new Date().toISOString(),
      } });
      creadas.push(1);
    }
    return json_({ ok: true, n: creadas.length });
  } catch (err) {
    return json_({ error: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ── Drive ─────────────────────────────────────────────────────────────────────

// Carpeta raíz → subcarpeta por período → "2026-11 - Ana Leber - 173...-ab.pdf".
// Un sufijo único por archivo evita pisar comprobantes cuando hay varios en el mismo mes.
function guardarComprobante_(periodo, nombre, archivo) {
  const raiz = DriveApp.getFolderById(cfg_("FOLDER_ID"));
  const it = raiz.getFoldersByName(periodo);
  const carpeta = it.hasNext() ? it.next() : raiz.createFolder(periodo);
  const ext = (String(archivo.nombre || "").match(/\.[a-z0-9]{1,5}$/i) || [""])[0].toLowerCase();
  const sufijo = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 5);
  const blob = Utilities.newBlob(Utilities.base64Decode(archivo.base64), archivo.mime || "application/octet-stream",
    periodo + " - " + nombre + " - " + sufijo + ext);
  const file = carpeta.createFile(blob);
  try { file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* política del dominio */ }
  return file.getUrl();
}

// ── Links para repartir ─────────────────────────────────────────────────────────

// Imprime el link permanente de CADA legajo activo de HQ (rol HQ / HQ_OWNER / HQ_EXT), para copiar y
// pasar por WhatsApp o mail. El link no caduca. Correr a mano cuando haga falta.
function listarLinks() {
  const ROLES_HQ = ["HQ", "HQ_OWNER", "HQ_EXT"];
  const legs = sueldosGet_("su_legajos", {}).filter(l => String(l.activo) !== "false" && ROLES_HQ.indexOf(l.rol) !== -1);
  legs.sort(function (x, y) { return String(x.nombre).localeCompare(String(y.nombre)); });
  const out = legs.map(function (l) { return l.nombre + "  —  " + linkDe_(l.id); });
  console.log("Links de reintegro (" + out.length + "):\n\n" + out.join("\n"));
  return out;
}

// Link de UNA persona puntual (por id de legajo), por si hay que repartir uno solo.
function linkDeLegajo(legajoId) {
  const l = legajo_(legajoId);
  const url = linkDe_(l.id);
  console.log(l.nombre + ": " + url);
  return url;
}

// ── Instalación (correr UNA vez a mano) ──────────────────────────────────────

function instalar() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("SECRET")) props.setProperty("SECRET", Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty("FOLDER_ID")) props.setProperty("FOLDER_ID", DriveApp.createFolder("Comprobantes Reintegros").getId());
  // Prueba de conexión con Sueldos (falla acá si SUELDOS_URL / SUELDOS_TOKEN están mal).
  console.log("Legajos leídos: " + sueldosGet_("su_legajos", {}).length);
  console.log("Listo. Carpeta: https://drive.google.com/drive/folders/" + props.getProperty("FOLDER_ID"));
  console.log("Ahora corré `listarLinks` para obtener los links de cada persona.");
}
