// ─── Google Sheets API layer (via Apps Script Web App) ────────────────────────
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
  const res = await fetch(url);
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

/**
 * Carga todos los comprobantes desde Sheets.
 * @returns {{ [frId: string]: Comprobante[] }}
 */
export async function fetchComps() {
  const raw = await get("comps");
  const result = {};
  for (const [frId, comps] of Object.entries(raw)) {
    result[frId] = comps.map(c => {
      // fecha_emision viene como "YYYY-MM-DD" o "YYYY-MM-DDTHH:mm:ss.sssZ" (Google Sheets
      // convierte columnas de fecha a ISO datetime al serializarlas en Apps Script JSON).
      // Tomamos solo los primeros 10 chars para obtener siempre "YYYY-MM-DD".
      const fechaStr = String(c.fecha_emision).slice(0, 10);
      const d = new Date(fechaStr + "T12:00:00"); // T12 evita desfase por timezone
      const month = d.getMonth();       // 0-indexed
      const year  = d.getFullYear();
      const dd    = String(d.getDate()).padStart(2, "0");
      const mm    = String(d.getMonth() + 1).padStart(2, "0");
      const date  = `${dd}/${mm}/${year}`; // formato interno del app: DD/MM/YYYY

      return {
        ...c,
        frId:       Number(c.frId),
        amount:     Number(c.amount)     || 0,
        amountNeto: c.amountNeto !== "" ? Number(c.amountNeto) : undefined,
        amountIVA:  c.amountIVA  !== "" ? Number(c.amountIVA)  : undefined,
        // Sheets devuelve strings vacíos para campos opcionales; los convertimos a
        // undefined para que el operador ?? en helpers.js active el fallback correcto.
        currency:   c.currency  !== "" ? c.currency  : undefined,
        invoice:    c.invoice   !== "" ? c.invoice   : undefined,
        loteId:     c.loteId    !== "" ? c.loteId    : undefined,
        ref:        c.ref       !== "" ? c.ref       : undefined,
        nota:       c.nota      !== "" ? c.nota      : undefined,
        date,   // campo interno del app
        month,  // derivado de fecha_emision
        year,   // derivado de fecha_emision
      };
    });
  }
  return result;
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
  const { date, month, year, ...rest } = comp;
  const [dd, mm, yyyy] = (date ?? "").split("/");
  const fecha_emision = dd && mm && yyyy ? `${yyyy}-${mm}-${dd}` : "";
  return post({ action: "add", comp: { frId: String(frId), ...rest, fecha_emision } });
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

/**
 * Carga todas las franquicias desde Sheets.
 * @returns {Franchise[]}
 */
export async function fetchFranchises() {
  const rows = await get("franchises");
  return rows.map(f => ({
    ...f,
    id:       Number(f.id),
    activa:   f.activa === true || f.activa === "TRUE" || f.activa === "true",
    applyIVA: f.applyIVA === true || f.applyIVA === "TRUE" || f.applyIVA === "true",
    taxExempt:f.taxExempt === true || f.taxExempt === "TRUE" || f.taxExempt === "true",
  }));
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
