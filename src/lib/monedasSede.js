// ─── En qué monedas opera una sede dentro de una sociedad ──────────────────────────────────
// La cuenta corriente se arma por sociedad, y dentro de una sociedad casi siempre hay una sola
// moneda (ÑAKO en ARS; BIGG FIT LLC en USD para LATAM y en EUR para España). Pero los saldos no
// se pueden sumar entre monedas: cada pantalla que muestra un saldo pide acá las monedas y calcula
// uno por moneda en lugar de sumar todo y etiquetarlo con la moneda de la sociedad. Así estaba
// Deudores en "TODAS" con LLC: España salía en U$D y los totales sumaban dólares y euros.
import { compEmpresa, compCurrency, SKIP_CC_TYPES } from "./helpers";

/**
 * Monedas con movimientos (o saldo de apertura) de la sede en la sociedad. Sin nada, [fallback].
 * Ordenadas con `fallback` primero (la moneda de la sociedad), el resto alfabético.
 */
export function monedasDeSede(frId, comps, saldoInicial, empresa, fallback) {
  const key = String(frId);
  const set = new Set();
  for (const c of comps?.[key] ?? []) {
    if (empresa && compEmpresa(c) !== empresa) continue;
    if (SKIP_CC_TYPES.has(c.type)) continue;
    set.add(compCurrency(c));
  }
  const si = empresa ? saldoInicial?.[empresa]?.[key] : saldoInicial?.[key];
  if (si && typeof si === "object" && Number(si.saldo)) set.add(si.currency ?? fallback);
  else if (typeof si === "number" && si !== 0) set.add(fallback);
  if (set.size === 0) set.add(fallback);
  return [...set].sort((a, b) => (a === fallback ? -1 : b === fallback ? 1 : a.localeCompare(b)));
}
