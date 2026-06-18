// ─── Adaptadores read-only Bigg Franquicias → Numbers ───────────────────────
// ÚNICO punto que consume los internals de Franquicias (compEmpresa/compCurrency/
// computeSaldoReal/COMP_TYPES). Las pantallas (Reportes, Tesorería) solo llaman a
// estas funciones — sin importar nada de Franquicias directamente.
//
// OJO — SWITCH futuro: hoy el saldo de CxC (franquiciasSaldosCxC) lee los cobros desde
// `comprobantes` de Franquicias. Cuando los movimientos financieros pasen SOLO a
// nb_movimientos, hay que reapuntar la fuente del saldo ACÁ (un solo lugar). Las facturas
// del P&L (franquiciasIngresoPnLRows) NO cambian: FACTURA|/NC| no son financieros.
import { compEmpresa, compCurrency, computeSaldoReal, COMP_TYPES } from "./helpers";

// Fuente única: sociedad Numbers → empresa emisora de Franquicias (y su inversa).
export const SOCIEDAD_EMPRESA = {
  nako:     "ÑAKO SRL",
  biggfit:  "BIGG FIT LLC",
  wellness: "Gestión Deportiva y Wellness SL",
};
const EMPRESA_SOCIEDAD = Object.fromEntries(Object.entries(SOCIEDAD_EMPRESA).map(([k, v]) => [v, k]));

// Sufijo del tipo de comprobante → cuenta contable de ingreso en Numbers (categoría Ventas).
const FRANQ_CUENTA = { FEE: "Fee de Gestion y Adm", INTERUSOS: "Interusos", PAUTA: "Pauta", SPONSORS: "Sponsor", SPONSOR: "Sponsor", OTROS: "Otros Ingresos" };
const MONEDAS = ["ARS", "USD", "EUR"];

// Facturación a franquiciados → filas P&L de ingreso. Solo FACTURA|* (+) y NC|* (−);
// ignora FC_RECIBIDA y los financieros (doc null). Sociedad por empresa emisora; centro = HQ Ventas.
export function franquiciasIngresoPnLRows(compsByFr, sociedad, ventasCcId) {
  const soc = (sociedad ?? "").toLowerCase();
  const out = [];
  for (const list of Object.values(compsByFr ?? {})) {
    for (const c of (list ?? [])) {
      const def = COMP_TYPES[c.type];
      if (!def || (def.doc !== "FACTURA" && def.doc !== "NC")) continue;
      const cSoc = EMPRESA_SOCIEDAD[compEmpresa(c)] ?? null;
      if (soc && cSoc !== soc) continue;
      const monto = Math.abs(Number(c.amount) || 0);
      if (!monto) continue;
      const cuenta = FRANQ_CUENTA[String(def.cuenta || "OTROS").toUpperCase()] || "Otros Ingresos";
      const fecha  = (c.year != null && c.month != null) ? `${c.year}-${String(c.month + 1).padStart(2, "0")}-15` : "";
      out.push({ fecha, sociedad: cSoc, centro_costo: ventasCcId, cuenta_contable: cuenta, moneda: compCurrency(c), total: monto * def.sign });
    }
  }
  return out;
}

// Saldos de franquiciados → { activo, pasivo } (presentación BRUTA, sin netear):
//   saldo > 0 (nos deben)  → Activo "Franquiciados"
//   saldo < 0 (les debemos) → Pasivo "Franquiciados (saldo a favor)" (ingreso diferido)
// Por moneda — una empresa puede facturar en varias (ej. Bigg Fit en USD y EUR).
export function franquiciasSaldosCxC({ comps, saldos, franchises }, sociedad, year, month) {
  const empresa = SOCIEDAD_EMPRESA[(sociedad ?? "").toLowerCase()];
  if (!empresa) return { activo: [], pasivo: [] };
  const activo = [], pasivo = [];
  for (const moneda of MONEDAS) {
    const deben = [], debemos = [];
    let totA = 0, totP = 0;
    for (const fr of (franchises ?? [])) {
      if (fr.activa === false) continue;
      const saldo = computeSaldoReal(fr.id, year, month, comps, saldos, null, moneda, empresa);
      if (saldo > 0.01)       { deben.push({ contraparte: fr.name, vto: "", saldo, moneda }); totA += saldo; }
      else if (saldo < -0.01) { debemos.push({ contraparte: fr.name, vto: "", saldo: -saldo, moneda }); totP += -saldo; }
    }
    if (totA > 0.01) { deben.sort((a, b) => b.saldo - a.saldo);   activo.push({ label: "Franquiciados", moneda, saldo: totA, docs: deben, headerColor: "#16a34a" }); }
    if (totP > 0.01) { debemos.sort((a, b) => b.saldo - a.saldo); pasivo.push({ label: "Franquiciados (saldo a favor)", moneda, saldo: totP, docs: debemos, headerColor: "#dc2626" }); }
  }
  return { activo, pasivo };
}
