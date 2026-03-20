export const DEFAULT_FRANCHISOR = {
  ar: {
    razonSocial:    "ÑAKO SRL",
    cuit:           "30-71234567-8",
    condIVA:        "Responsable Inscripto",
    domicilio:      "",
    localidad:      "Buenos Aires",
    provincia:      "CABA",
    cp:             "",
    telefono:       "",
    email:          "",
    puntoVenta:     "0001",
    cbu:            "",
    banco:          "",
    alias:          "",
    notaPie:        "",
  },
  usa: {
    legalName:      "BIGG FIT LLC",
    ein:            "",
    address:        "",
    city:           "",
    state:          "",
    zip:            "",
    country:        "United States",
    bankName:       "",
    routingNumber:  "",
    accountNumber:  "",
    swift:          "",
    notaPie:        "",
  },
  es: {
    legalName:      "Gestión Deportiva y Wellness SL",
    nif:            "B09706771",
    address:        "Calle Eloy Gonzalo 34",
    city:           "",
    cp:             "",
    country:        "España",
    bankName:       "",
    iban:           "",
    swift:          "",
    notaPie:        "",
  },
};

// ─── COMPANIES MAP ────────────────────────────────────────────────────────────
// Mapa de sociedad franquiciante → config. Clave = razonSocial exacta (campo `empresa` en Sheets).
// `currencies` lista las monedas habilitadas para emitir comprobantes (configurable en Maestros).
export const COMPANIES = {
  "ÑAKO SRL":                        { side: "ar",  flag: "🇦🇷", currency: "ARS", currencies: ["ARS"] },
  "BIGG FIT LLC":                    { side: "usa", flag: "🇺🇸", currency: "USD", currencies: ["USD", "EUR"] },
  "Gestión Deportiva y Wellness SL": { side: "es",  flag: "🇪🇸", currency: "EUR", currencies: ["EUR"] },
};
export const COMPANY_NAMES = Object.keys(COMPANIES); // ["ÑAKO SRL", "BIGG FIT LLC", "Gestión Deportiva y Wellness SL"]

/**
 * Devuelve las monedas habilitadas de una franquicia (sede).
 * Si tiene `currencies` guardadas, las usa; si no, deriva de `currency`/`moneda`.
 * @param {object} franchise — objeto de franquicia
 */
export function getFranchiseCurrencies(franchise) {
  if (Array.isArray(franchise?.currencies) && franchise.currencies.length > 0)
    return franchise.currencies;
  return [franchise?.currency ?? franchise?.moneda ?? "ARS"];
}

/**
 * Devuelve las monedas permitidas para una empresa.
 * Usa el config guardado en franchisor (Sheets) si existe; si no, el default de COMPANIES.
 * @param {string} empresa  — clave exacta de COMPANIES
 * @param {object} franchisor — objeto de estado del franquiciante (puede ser null)
 */
export function getCompanyCurrencies(empresa, franchisor) {
  const co = COMPANIES[empresa];
  if (!co) return ["ARS"];
  const stored = franchisor?.[co.side]?.currencies;
  if (Array.isArray(stored) && stored.length > 0) return stored;
  return co.currencies ?? [co.currency ?? "ARS"];
}

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────
// Almacenamiento interno: dd/mm/aaaa  →  comparación: aaaa-mm-dd (temporal)
export const dmyToIso = d => { if (!d || !d.includes("/")) return d ?? ""; const [dd,mm,yy] = d.split("/"); return `${yy}-${mm}-${dd}`; };
export const isoToDmy = d => { if (!d || !d.includes("-")) return d ?? ""; const [yy,mm,dd] = d.split("-"); return `${dd}/${mm}/${yy}`; };
export const cmpDate    = (a, b) => dmyToIso(a).localeCompare(dmyToIso(b));
export const todayDmy   = () => { const n = new Date(); return `${String(n.getDate()).padStart(2,"0")}/${String(n.getMonth()+1).padStart(2,"0")}/${n.getFullYear()}`; };
export const dateMonth  = (dmy) => { if (!dmy) return 0; const p = dmy.split("/"); return parseInt(p[1], 10) - 1; };
export const dateYear   = (dmy) => { if (!dmy) return 0; const p = dmy.split("/"); return parseInt(p[2], 10); };
export const inPeriod   = (c, month, year) => dateMonth(c.date) === month && dateYear(c.date) === year;
export const upToPeriod = (c, year, month) => dateYear(c.date) < year || (dateYear(c.date) === year && dateMonth(c.date) <= month);

// ─── DATA ─────────────────────────────────────────────────────────────────────
// Moved to module scope — never changes, no reason to live inside the component tree.
