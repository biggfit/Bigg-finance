// ─── Google Sheets API layer (via Apps Script Web App) ────────────────────────
import { getFranchiseCurrencies } from "../data/franchisor";
// Todas las operaciones de lectura/escritura pasan por acá.
// Configurar en .env.local:
//   VITE_SHEETS_API_URL=https://script.google.com/macros/s/.../exec
//   VITE_SHEETS_TOKEN=tu-token-secreto

const CONFIGURED = !!import.meta.env.VITE_SHEETS_API_URL;
const TOKEN      = import.meta.env.VITE_SHEETS_TOKEN;

// En dev: usamos el proxy de Vite (/api/sheets) que sigue los redirects server-side
// En prod: idem — Vercel reescribirá /api/sheets hacia el Apps Script
const PROXY_BASE = "/api/sheets";

/** GET a la Apps Script Web App (via proxy) */
async function get(resource) {
  if (!CONFIGURED) throw new Error("VITE_SHEETS_API_URL no configurada");
  const url = `${PROXY_BASE}?resource=${resource}&token=${encodeURIComponent(TOKEN)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/** POST a la Apps Script Web App (via proxy) */
async function post(body) {
  if (!CONFIGURED) throw new Error("VITE_SHEETS_API_URL no configurada");
  const res = await fetch(PROXY_BASE, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ ...body, token: TOKEN }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ─── Lectura ──────────────────────────────────────────────────────────────────

/** Transforma comps crudos de Sheets al formato interno */
function parseComps(raw) {
  const result = {};
  for (const [frId, comps] of Object.entries(raw)) {
    result[frId] = comps.map(c => {
      const fechaStr = String(c.fecha_emision).slice(0, 10);
      const d = new Date(fechaStr + "T12:00:00");
      const month = d.getMonth();
      const year  = d.getFullYear();
      const dd    = String(d.getDate()).padStart(2, "0");
      const mm    = String(d.getMonth() + 1).padStart(2, "0");
      const date  = `${dd}/${mm}/${year}`;
      return {
        ...c,
        frId:       Number(c.frId),
        amount:     Number(c.amount)     || 0,
        amountNeto: c.amountNeto !== "" ? Number(c.amountNeto) : undefined,
        amountIVA:  c.amountIVA  !== "" ? Number(c.amountIVA)  : undefined,
        currency:   c.currency  !== "" ? c.currency  : undefined,
        invoice:    c.invoice   !== "" ? c.invoice   : undefined,
        loteId:       c.loteId       !== "" ? c.loteId       : undefined,
        facturanteId: c.facturanteId !== "" ? c.facturanteId : undefined,
        ref:          c.ref          !== "" ? c.ref          : undefined,
        nota:       c.nota      !== "" ? c.nota      : undefined,
        date, month, year,
      };
    });
  }
  return result;
}

/**
 * Carga TODOS los datos en un solo request (comps, saldos, franchises, franchisor, recordatorios).
 * Evita hacer 5 requests simultáneas que Google Apps Script throttlea.
 */
/** Normaliza una franquicia cruda de Sheets a los tipos esperados. */
function parseFranchise(f) {
  return {
    ...f,
    id:          Number(f.id),
    activa:      f.activa === true || f.activa === "TRUE" || f.activa === "true",
    applyIVA:    f.applyIVA === true || f.applyIVA === "TRUE" || f.applyIVA === "true",
    taxExempt:   f.taxExempt === true || f.taxExempt === "TRUE" || f.taxExempt === "true",
    biggEyeId:   f.biggEyeId !== "" && f.biggEyeId != null ? Number(f.biggEyeId) : null,
    currencies:  deriveCurrencies(f),
  };
}

export async function fetchAll() {
  const raw = await get("all");
  return {
    comps:          parseComps(raw.comps ?? {}),
    saldos:         raw.saldos ?? {},
    franchises:     (raw.franchises ?? []).map(parseFranchise),
    franchisor:     raw.franchisor ?? null,
    recordatorios:  raw.recordatorios ?? {},
  };
}

/**
 * Carga todos los comprobantes desde Sheets.
 * @returns {{ [frId: string]: Comprobante[] }}
 */
export async function fetchComps() {
  return parseComps(await get("comps"));
}

/**
 * Carga los saldos iniciales desde Sheets.
 * @returns {{ [frId: string]: number }}
 */
export async function fetchSaldos() {
  return get("saldos");
}

// ─── Escritura ────────────────────────────────────────────────────────────────

/**
 * Agrega un comprobante nuevo a Sheets.
 * @param {string|number} frId
 * @param {object} comp
 */
export async function appendComp(frId, comp) {
  // Convertir date (DD/MM/YYYY) → fecha_emision (YYYY-MM-DD) para el Sheet
  // y omitir month/year que son campos derivados internos
  const { date, month, year, frId: _oldFrId, ...rest } = comp;
  const [dd, mm, yyyy] = (date ?? "").split("/");
  const fecha_emision = dd && mm && yyyy ? `${yyyy}-${mm}-${dd}` : "";
  return post({ action: "add", comp: { ...rest, frId: String(frId), fecha_emision } });
}

/**
 * Edita campos de un comprobante existente en Sheets.
 * @param {string|number} frId
 * @param {string} compId
 * @param {object} patch
 */
export async function updateComp(frId, compId, patch) {
  // Si el patch trae date (DD/MM/YYYY), convertirla a fecha_emision (YYYY-MM-DD)
  const { date, month, year, ...rest } = patch;
  const sheetPatch = { ...rest };
  if (date) {
    const [dd, mm, yyyy] = date.split("/");
    sheetPatch.fecha_emision = `${yyyy}-${mm}-${dd}`;
  }
  return post({ action: "edit", frId: String(frId), compId: String(compId), patch: sheetPatch });
}

/**
 * Elimina un comprobante de Sheets.
 * @param {string|number} frId
 * @param {string} compId
 */
export async function removeComp(frId, compId) {
  return post({ action: "del", frId: String(frId), compId: String(compId) });
}

// ─── Franquicias ──────────────────────────────────────────────────────────────

// Países por región → moneda por defecto
const EUROPA_COUNTRIES  = ["España","Espana","Francia","Italia","Alemania","Portugal","Reino Unido"];
const LATAM_COUNTRIES   = ["Uruguay","Chile","Colombia","Peru","Mexico","Bolivia","Paraguay","Ecuador"];

/**
 * Deriva las monedas permitidas de una franquicia a partir de su país,
 * cuando el campo `currencies` no está guardado en Sheets todavía.
 * Regla: Argentina→ARS, Europa→EUR, LATAM/USA→USD.
 * Excepción: "Horneros" opera USD+ARS.
 */
function deriveCurrencies(f) {
  // Si ya tiene currencies guardadas en Sheets, úsalas directamente
  if (Array.isArray(f.currencies) && f.currencies.length > 0) return f.currencies;

  const name    = (f.name ?? "").toLowerCase();
  const country = f.country ?? "";

  // Excepción Horneros: opera ARS y USD
  if (name.includes("horneros")) return ["USD", "ARS"];

  if (country === "Argentina")              return ["ARS"];
  if (EUROPA_COUNTRIES.includes(country))   return ["EUR"];
  if (LATAM_COUNTRIES.includes(country))    return ["USD"];
  if (country === "USA")                    return ["USD"];

  // Fallback: derivar de la moneda principal del registro
  return getFranchiseCurrencies(f);
}

/**
 * Carga todas las franquicias desde Sheets.
 * @returns {Franchise[]}
 */
export async function fetchFranchises() {
  const rows = await get("franchises");
  return rows.map(parseFranchise);
}

/** Guarda cambios de una franquicia existente en Sheets. */
export async function sheetsSaveFr(id, data) {
  return post({ action: "saveFr", id: Number(id), data });
}

/** Agrega una franquicia nueva a Sheets. */
export async function sheetsAddFr(data) {
  return post({ action: "addFr", data });
}

/** Elimina una franquicia de Sheets. */
export async function sheetsDeleteFr(id) {
  return post({ action: "deleteFr", id: Number(id) });
}

/**
 * Obtiene y reserva el próximo correlativo de invoice para una sede USA.
 * Devuelve { ok, num, label } donde label es "USA-{frId}-{NNNN}".
 */
export async function getNextInvoiceNum(frId, prefix = "USA") {
  return post({ action: "nextInvoiceNum", frId: Number(frId), prefix });
}

// ─── Franquiciante ────────────────────────────────────────────────────────────

/**
 * Carga la config del franquiciante desde Sheets.
 * @returns {{ ar: object, usa: object }}
 */
export async function fetchFranchisor() {
  return get("franchisor");
}

/** Guarda una sección del franquiciante (ar o usa) en Sheets. */
export async function sheetsSaveFranchisor(side, data) {
  return post({ action: "saveFranchisor", side, data });
}

// ─── Recordatorios ───────────────────────────────────────────────────────────

/**
 * Carga todos los recordatorios enviados.
 * @returns {{ [frId: string]: { fecha: string, ccMes: number, ccAnio: number, to: string }[] }}
 */
export async function fetchRecordatorios() {
  try {
    const data = await get("recordatorios");
    return data;
  } catch (e) { console.error("[fetchRecordatorios] FAILED:", e); return {}; }
}

/**
 * Guarda un recordatorio enviado en Sheets.
 */
export async function saveRecordatorio({ frId, fecha, ccMes, ccAnio, to }) {
  return post({ action: "addRecordatorio", frId, fecha, ccMes, ccAnio, to });
}

// ─── Mail ─────────────────────────────────────────────────────────────────────

/**
 * Envía un mail vía GmailApp en el Apps Script.
 * @param {object} params
 * @param {string}   params.to          — destinatario (email)
 * @param {string}   params.subject     — asunto
 * @param {string}   params.htmlBody    — cuerpo HTML del mail
 * @param {Array<{ data: string, mimeType: string, name: string }>} params.attachments
 *   — adjuntos en base64 (UTF-8), mimeType y nombre de archivo
 */
export async function sendMailFr({ to, subject, htmlBody, attachments = [] }) {
  return post({ action: "sendMail", to, subject, htmlBody, attachments });
}
