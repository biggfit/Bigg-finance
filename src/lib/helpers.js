import { dmyToIso, isoToDmy, cmpDate, todayDmy, dateMonth, dateYear, inPeriod, upToPeriod } from "../data/franchisor";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
export const CURRENCIES = ["ARS", "USD", "EUR"];
// Tipos que NO afectan el saldo de cuenta corriente (son movimientos de caja, no deuda)
export const SKIP_CC_TYPES = new Set([]); // todos los tipos se muestran en el detalle
export const SYM        = { ARS: "$", USD: "U$D", EUR: "€" };
export const MONTHS     = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

// Documentos posibles
export const DOCS   = ["FACTURA", "NC"];
// Cuentas posibles
export const CUENTAS = ["FEE", "INTERUSOS", "PAUTA", "SPONSORS", "OTROS_INGRESOS"];
export const CUENTA_LABEL = {
  FEE:            "Fee",
  INTERUSOS:      "Interusos",
  PAUTA:          "Pauta",
  SPONSORS:       "Sponsors",
  OTROS_INGRESOS: "Otros Ingresos",
};
// Movimientos financieros (no tienen cuenta)
export const MOV_TYPES = {
  PAGO:         { label: "Pago Recibido",       sign: -1, color: "var(--green)" },
  PAGO_PAUTA:   { label: "Pagos a Cuenta",      sign: -1, color: "var(--cyan)"  },
  PAGO_ENVIADO: { label: "Transferencia Enviada", sign: +1, color: "var(--orange)" },
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
// Generar dinámicamente todos los tipos FACTURA|X y NC|X
DOCS.forEach(doc => {
  CUENTAS.forEach(cuenta => {
    const key = `${doc}|${cuenta}`;
    const sign = doc === "FACTURA" ? +1 : -1;
    const color = doc === "FACTURA" ? "var(--red)" : "var(--green)";
    COMP_TYPES[key] = { label: `${doc === "FACTURA" ? "Factura" : "NC"} ${CUENTA_LABEL[cuenta]}`, sign, color, doc, cuenta };
  });
});

// Helper: construir type key desde doc + cuenta
export const makeType = (doc, cuenta) => `${doc}|${cuenta}`;
// Helper: extraer doc y cuenta de un type
export const parseType = (type) => {
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
export function computeSaldo(frId, y, m, comps, saldoInicial, frCurrency = null, filterCurrency = null) {
  const key = String(frId);
  const applyInicial = filterCurrency === null || filterCurrency === frCurrency;
  let saldo = applyInicial ? (saldoInicial[key] ?? 0) : 0;
  const cutoff = `31/${String(m + 1).padStart(2,'0')}/${y}`;
  const frComps = (comps[key] ?? []).filter(c => {
    if (filterCurrency !== null && (c.currency ?? frCurrency) !== filterCurrency) return false;
    return !SKIP_CC_TYPES.has(c.type) && cmpDate(c.date, cutoff) <= 0;
  });
  for (const c of frComps) {
    const sign = COMP_TYPES[c.type]?.sign;
    if (sign === +1) saldo += c.amount;
    else if (sign === -1) saldo -= c.amount;
  }
  return saldo;
}

export function computeSaldoPrevMes(frId, y, m, comps, saldoInicial, frCurrency = null, filterCurrency = null) {
  const pm = m - 1 < 0 ? 11 : m - 1;
  const py = m - 1 < 0 ? y - 1 : y;
  return computeSaldo(frId, py, pm, comps, saldoInicial, frCurrency, filterCurrency);
}

export function buildCuentaCorriente(frId, comps, saldoInicial, frCurrency = null, filterCurrency = null) {
  const key = String(frId);
  const applyInicial = filterCurrency === null || filterCurrency === frCurrency;
  let saldo = applyInicial ? (saldoInicial[key] ?? 0) : 0;
  const lines = [{ type: "apertura", label: "Saldo de apertura", debit: 0, credit: 0, saldo, date: "31/12/2025", currency: frCurrency }];
  const frComps = (comps[key] ?? [])
    .filter(c => {
      if (filterCurrency !== null && (c.currency ?? frCurrency) !== filterCurrency) return false;
      return !SKIP_CC_TYPES.has(c.type);
    })
    .sort((a, b) => cmpDate(a.date, b.date));
  for (const c of frComps) {
    const sign = COMP_TYPES[c.type]?.sign;
    if (sign === undefined) continue;
    const amount = c.amount ?? 0;
    const compCurrency = c.currency ?? frCurrency;
    if (sign === +1) { saldo += amount; lines.push({ ...c, debit: amount, credit: 0, saldo, currency: compCurrency }); }
    else if (sign === -1) { saldo -= amount; lines.push({ ...c, debit: 0, credit: amount, saldo, currency: compCurrency }); }
  }
  return { lines, saldoFinal: saldo };
}

export function computePautaPendiente(frId, comps, upToYear, upToMonth, frCurrency = null, filterCurrency = null) {
  const key = String(frId);
  const all = comps[key] ?? [];
  const matchCur = c => filterCurrency === null || (c.currency ?? frCurrency) === filterCurrency;
  const cobros = all.filter(c => c.type === "PAGO_PAUTA" && upToPeriod(c, upToYear, upToMonth) && matchCur(c)).reduce((a, c) => a + c.amount, 0);
  const facts  = all.filter(c => c.type === makeType("FACTURA","PAUTA") && upToPeriod(c, upToYear, upToMonth) && matchCur(c)).reduce((a, c) => a + c.amount, 0);
  return Math.max(0, cobros - facts);
}

// ─── RE-EXPORT DATE HELPERS from data/franchisor ─────────────────────────────
export { dmyToIso, isoToDmy, cmpDate, todayDmy, dateMonth, dateYear, inPeriod, upToPeriod } from "../data/franchisor";
