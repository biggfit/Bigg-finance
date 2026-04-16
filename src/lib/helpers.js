import { upToPeriod, COMPANIES, cmpDate } from "../data/franchisor";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
export const CURRENCIES = ["ARS", "USD", "EUR"];
// Tipos que NO afectan el saldo de cuenta corriente (son movimientos de caja, no deuda)
export const SKIP_CC_TYPES = new Set([]); // todos los tipos se muestran en el detalle
export const SYM        = { ARS: "$", USD: "U$D", EUR: "€" };
export const MONTHS     = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

// Documentos posibles (emisión propia)
export const DOCS   = ["FACTURA", "NC"];
// Documentos recibidos (no se emiten, se registran)
const DOCS_RECIBIDOS = ["FC_RECIBIDA"];
// Cuentas posibles
export const CUENTAS = ["FEE", "INTERUSOS", "PAUTA", "SPONSORS", "OTROS"];
export const CUENTA_LABEL = {
  FEE:       "Fee",
  INTERUSOS: "Interusos",
  PAUTA:     "Pauta",
  SPONSORS:  "Sponsors",
  OTROS:     "Otros",
};
// COMP_TYPES — compatibilidad con código existente que usa c.type como key
// Para comprobantes: type = "FACTURA|FEE", "NC|FEE", etc.
// Para movimientos:  type = "PAGO", "PAGO_PAUTA", "PAGO_ENVIADO"
export const COMP_TYPES = {
  // Movimientos financieros
  PAGO:         { label: "Pago Recibido",        sign: -1, color: "var(--green)",  doc: null, cuenta: null },
  PAGO_PAUTA:   { label: "Pagos a Cuenta",       sign: -1, color: "var(--cyan)",   doc: null, cuenta: null },
  PAGO_ENVIADO: { label: "Transferencia Enviada",sign: +1, color: "var(--orange)", doc: null, cuenta: null },
};
// Generar dinámicamente todos los tipos FACTURA|X, NC|X
DOCS.forEach(doc => {
  CUENTAS.forEach(cuenta => {
    const key = `${doc}|${cuenta}`;
    const sign = doc === "FACTURA" ? +1 : -1;
    const color = doc === "FACTURA" ? "var(--red)" : "var(--green)";
    const label = doc === "FACTURA" ? "Factura" : "NC";
    COMP_TYPES[key] = { label: `${label} ${CUENTA_LABEL[cuenta]}`, sign, color, doc, cuenta };
  });
});
// Generar FC_RECIBIDA|X (documentos recibidos, sign -1, no se emiten)
DOCS_RECIBIDOS.forEach(doc => {
  CUENTAS.forEach(cuenta => {
    const key = `${doc}|${cuenta}`;
    COMP_TYPES[key] = { label: `FC Recibida ${CUENTA_LABEL[cuenta]}`, sign: -1, color: "var(--blue)", doc, cuenta };
  });
});

// Helper: construir type key desde doc + cuenta
export const makeType = (doc, cuenta) => `${doc}|${cuenta}`;
// Helper: extraer doc y cuenta de un type
const parseType = (type) => {
  if (!type || !type.includes("|")) return { doc: null, cuenta: null };
  const [doc, cuenta] = type.split("|");
  return { doc, cuenta };
};

export const AVAILABLE_YEARS = [2024, 2025, 2026, 2027];

// Tipos que son movimientos financieros (solo afectan CC, sin documento)
export const TIPOS_MOVIMIENTO  = ["PAGO","PAGO_PAUTA","PAGO_ENVIADO"];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
/** Format absolute value with currency symbol */
export const fmt  = (v, c) => `${SYM[c] || "$"}\u202f${Math.abs(v).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Format with sign prefix */
export const fmtS = (v, c) => `${v < 0 ? "-" : v > 0 ? "+" : ""}${fmt(v, c)}`;
/** Stable unique ID for new comprobantes */
export const uid  = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────
export function downloadCSV(rows, filename) {
  const blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href); // prevent memory leak
}

// ─── EMPRESA HELPERS ─────────────────────────────────────────────────────────

/**
 * Devuelve la empresa emisora de un comprobante.
 * Usa c.empresa si existe; si no, deriva de la moneda (legacy data).
 * No necesita frCurrency — la empresa se infiere del propio comprobante.
 */
export const compEmpresa = (c) => {
  if (c.empresa) return c.empresa;
  const cur = c.currency ?? "ARS";
  return cur === "ARS" ? "ÑAKO SRL" : "BIGG FIT LLC";
};

/**
 * Devuelve la moneda efectiva de un comprobante.
 * Usa c.currency si existe; si no, deriva de la empresa del comprobante.
 * Elimina la necesidad de pasar frCurrency como fallback de moneda.
 */
export const compCurrency = (c) => c.currency ?? COMPANIES[compEmpresa(c)]?.currency ?? "ARS";

/**
 * Accede al saldo inicial de una franquicia, compatible con todos los formatos:
 * - Formato v3: { "ÑAKO SRL": { frId: { saldo, currency } }, ... }
 * - Formato v2: { "ÑAKO SRL": { frId: number }, ... }
 * - Formato legado: { frId: number }
 * frCurrency: moneda nativa de la franquicia (fallback si el entry no tiene currency explícita).
 * filterCurrency: si se pasa, solo aplica el saldo cuando la moneda coincide.
 * Si empresa es null, suma todas las empresas (vista consolidada).
 */
export function getSaldoInicial(si, key, empresa, frCurrency = null, filterCurrency = null) {
  const resolve = (entry) => {
    if (entry === undefined || entry === null) return 0;
    if (typeof entry === "object" && "saldo" in entry) {
      // Formato v3: { saldo, currency }
      const cur = entry.currency ?? frCurrency;
      if (filterCurrency !== null && cur && cur !== filterCurrency) return 0;
      return entry.saldo ?? 0;
    }
    if (typeof entry === "number") {
      // Formato v2/legado: número plano — la moneda es frCurrency
      if (filterCurrency !== null && frCurrency && frCurrency !== filterCurrency) return 0;
      return entry;
    }
    return 0;
  };

  if (empresa) {
    const entMap = si[empresa];
    // Si no existe la clave empresa, puede ser formato legado { frId: number } — hacer fallback
    if (typeof entMap !== "object" || entMap === null) {
      if (typeof si[key] === "number") return resolve(si[key]);
      return 0;
    }
    return resolve(entMap[key]);
  }
  // Formato legado plano { frId: number }
  if (typeof si[key] === "number") return resolve(si[key]);
  // Formato v2/v3 sin filtro de empresa: sumar todas
  let total = 0;
  for (const v of Object.values(si)) {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) total += resolve(v[key]);
  }
  return total;
}

// ─── PURE ACCOUNTING FUNCTIONS ───────────────────────────────────────────────
// All accept normalised string-keyed comprobantes maps.
// IDs are normalised to strings once at the state-update callsite,
// so these functions never call String() internally.

/**
 * Compute the running balance for a franchise up to and including month m of year y.
 * frCurrency: the franchise's main billing currency (for saldoInicial attribution).
 * filterCurrency: if provided, only count comprobantes in that currency.
 *   - saldoInicial applies only when filterCurrency matches frCurrency (or no filter).
 *   - Comprobante currency falls back to frCurrency when not explicitly set (legacy data).
 */
export function computeSaldo(frId, y, m, comps, saldoInicial, frCurrency = null, filterCurrency = null, empresa = null) {
  const key = String(frId);
  let saldo = getSaldoInicial(saldoInicial, key, empresa, frCurrency, filterCurrency);
  const cutoff = `31/${String(m + 1).padStart(2,'0')}/${y}`;
  const frComps = (comps[key] ?? []).filter(c => {
    if (empresa !== null && compEmpresa(c) !== empresa) return false;
    if (filterCurrency !== null && compCurrency(c) !== filterCurrency) return false;
    return !SKIP_CC_TYPES.has(c.type) && cmpDate(c.date, cutoff) <= 0;
  });
  for (const c of frComps) {
    const sign = COMP_TYPES[c.type]?.sign;
    if (sign === +1) saldo += c.amount;
    else if (sign === -1) saldo -= c.amount;
  }
  return saldo;
}

export function computeSaldoPrevMes(frId, y, m, comps, saldoInicial, frCurrency = null, filterCurrency = null, empresa = null) {
  const pm = m - 1 < 0 ? 11 : m - 1;
  const py = m - 1 < 0 ? y - 1 : y;
  return computeSaldo(frId, py, pm, comps, saldoInicial, frCurrency, filterCurrency, empresa);
}

export function buildCuentaCorriente(frId, comps, saldoInicial, frCurrency = null, filterCurrency = null, empresa = null) {
  const key = String(frId);
  let saldo = getSaldoInicial(saldoInicial, key, empresa, frCurrency, filterCurrency);
  const lines = [{ type: "apertura", label: "Saldo de apertura", debit: 0, credit: 0, saldo, date: "31/12/2025", currency: frCurrency }];
  const frComps = (comps[key] ?? [])
    .filter(c => {
      if (empresa !== null && compEmpresa(c) !== empresa) return false;
      if (filterCurrency !== null && compCurrency(c) !== filterCurrency) return false;
      return !SKIP_CC_TYPES.has(c.type);
    })
    .sort((a, b) => cmpDate(a.date, b.date));
  for (const c of frComps) {
    const sign = COMP_TYPES[c.type]?.sign;
    if (sign === undefined) continue;
    const amount = c.amount ?? 0;
    const lineCur = c.currency ?? frCurrency;
    if (sign === +1) { saldo += amount; lines.push({ ...c, debit: amount, credit: 0, saldo, currency: lineCur }); }
    else if (sign === -1) { saldo -= amount; lines.push({ ...c, debit: 0, credit: amount, saldo, currency: lineCur }); }
  }
  return { lines, saldoFinal: saldo };
}

export function computePautaPendiente(frId, comps, upToYear, upToMonth, frCurrency = null, filterCurrency = null, empresa = null) {
  const key = String(frId);
  const all = comps[key] ?? [];
  const matchCur = c => filterCurrency === null || compCurrency(c) === filterCurrency;
  const matchEmp = c => empresa === null || compEmpresa(c) === empresa;
  const cobros = all.filter(c => c.type === "PAGO_PAUTA" && upToPeriod(c, upToYear, upToMonth) && matchCur(c) && matchEmp(c)).reduce((a, c) => a + c.amount, 0);
  const facts  = all.filter(c => c.type === makeType("FACTURA","PAUTA") && upToPeriod(c, upToYear, upToMonth) && matchCur(c) && matchEmp(c)).reduce((a, c) => a + c.amount, 0);
  return Math.max(0, cobros - facts);
}

// ─── RE-EXPORT DATE HELPERS from data/franchisor ─────────────────────────────
export { cmpDate, COMPANIES } from "../data/franchisor";
