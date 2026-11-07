// Negocios por sociedad fuera del núcleo (fondeadas España/Colombia/Puertos y Rosedal administrada): la config de cada
// uno y su RESULTADO NETO con el mismo motor que su pestaña del P&L (sede + estructura + cola de impuestos y
// financieros). Lo usan PantallaReportes (pestañas op_* y, desde T5, las filas "Negocios en desarrollo" del P&L del
// grupo) y cesionDerive (distribución por socio de Wellness). Sin React, sin I/O.
import { MESES, _nkSede, buildPnLSede, computeSubtotalsSede, familiaCentro } from "./pnlDerive";
import { tcDelMes, montoAMoneda } from "../../lib/numbersApi";

const ZERO = () => new Array(12).fill(0);

// Clave = id de pestaña del P&L. `empresa` = id de sociedad; `familia` = la de sus centros (familiaCentro);
// estructura = un centro (España) o una cuenta en "Sin clasificar" (Colombia).
export const FONDEADAS = {
  op_espana:   { empresa: "wellness",   moneda: "EUR", label: "España",   familia: "propios", estructuraCC: "cc-2026-88271" },
  op_colombia: { empresa: "tigre-loco", moneda: "USD", label: "Colombia", familia: "propios", estructuraCuenta: "Estructura Tigre Loco" },   // USD consolidado; estructura = cuenta, no centro
  op_puertos:  { empresa: "puertos",    moneda: "USD", label: "Puertos",  familia: "propios" },
  op_rosedal:  { empresa: "segui-fit",  moneda: "ARS", label: "Rosedal",  familia: "gerenciamiento", netoLabel: "Free Cash Flow" },
};
// Negocios en desarrollo (T5): los que entran al P&L del grupo por su resultado al 100 %.
export const DESARROLLO = ["op_espana", "op_colombia"];
// Match por nombre de cuenta (incluye). "Retenciones" son las retenciones sufridas en la fondeada (en Colombia: RteFte /
// RteICA) — la cuenta declara categoria_pnl="impuestos", igual que IVA, así que pertenece a esta cola.
// TODO: esta lista curada por nombre debería salir de categoria_pnl="impuestos" en maestros.
export const IMPUESTOS_FOND = ["IVA", "Ganancias", "Retenciones", "RTEFTE", "RTEICA"];
// Cola de resultado financiero (Fondeadas/Rosedal): cuentas de "Sin clasificar" que son financieras
// (intereses ganados suma, pérdidas financieras resta) → línea debajo de impuestos, antes del neto/FCF.
export const FINANCIEROS_FOND = ["Intereses Ganados", "Perdidas Financieras"];

// Cola de impuestos (Fondeadas/Rosedal): cuentas de "Sin clasificar" cuyo nombre matchea `matchers`
// (IVA, Ganancias…) → líneas de impuesto + Resultado Neto/FCF = resFinal − Σ impuestos. null si no hay.
export function computeImpuestos(sinClasificar, matchers, resFinal) {
  const keys = Object.keys(sinClasificar || {}).filter(k => matchers.some(m => _nkSede(k).includes(_nkSede(m))));
  if (!keys.length) return null;
  const byAcc = keys.map(k => ({ name: k, cur: sinClasificar[k] }));
  const total = Array.from({ length: 12 }, (_, m) => byAcc.reduce((s, a) => s + (Number(a.cur[m]) || 0), 0));
  const resNeto = (resFinal || ZERO()).map((v, m) => (Number(v) || 0) - total[m]);
  return { keys, byAcc, total, resNeto };
}

// Centros de una fondeada: sus sedes (grupo operaciones, su empresa, su familia). El centro de estructura (España) suele
// cumplir ese mismo filtro y ya viene dentro de `sedes` (su opex entra con el de las sedes, como en la pestaña con
// "Todas las Sedes"); solo se devuelve aparte si NO está adentro, para sumarlo una sola vez.
export function centrosDeFondeada(ccs, cfg) {
  const low = id => String(id ?? "").toLowerCase();
  const sedes = (ccs || []).filter(c => (c.grupo ?? "").toLowerCase() === "operaciones"
    && String(c.empresa ?? "").trim() === cfg.empresa && familiaCentro(c) === (cfg.familia || "propios")).map(c => c.id);
  const estructura = cfg.estructuraCC && !sedes.some(id => low(id) === low(cfg.estructuraCC))
    && (ccs || []).some(c => low(c.id) === low(cfg.estructuraCC)) ? cfg.estructuraCC : null;
  return { sedes, estructura };
}

// Resultado NETO de una fondeada, mes a mes, en `moneda` (las filas tienen que venir en esa moneda o ya traducidas):
//   resultado final de sus sedes (buildPnLSede + computeSubtotalsSede)
//   − opex del centro de estructura (España) o la cuenta de estructura (Colombia)
//   − impuestos (IMPUESTOS_FOND) − financieros (FINANCIEROS_FOND), ambos leídos de "Sin clasificar".
// Es el "Resultado Neto" de su pestaña con TODA la estructura (sin prorrateo: acá se mira el negocio entero).
// Devuelve null si la fondeada no tiene centros. ivaDeb/ivaCred acompañan para el modo Sin IVA del grupo.
export function resultadoFondeada(inRows, egRows, ccs, cfg, year, moneda, sinIva = false) {
  const { sedes, estructura } = centrosDeFondeada(ccs, cfg);
  if (!sedes.length && !estructura) return null;
  const p = buildPnLSede(inRows, egRows, sedes, year, moneda, sinIva);
  const s = computeSubtotalsSede(p);
  const imp = computeImpuestos(p.sinClasificar, IMPUESTOS_FOND, s.resFinal);
  const fin = computeImpuestos(p.sinClasificar, FINANCIEROS_FOND, s.resFinal);
  let estr = ZERO(), estrDeb = ZERO(), estrCred = ZERO();
  if (estructura) {
    const sE = computeSubtotalsSede(buildPnLSede(inRows, egRows, [estructura], year, moneda, sinIva));
    estr = sE.totGastosOp || ZERO(); estrDeb = sE.ivaDeb || ZERO(); estrCred = sE.ivaCred || ZERO();
  } else if (cfg.estructuraCuenta) {
    const k = Object.keys(p.sinClasificar || {}).find(x => _nkSede(x) === _nkSede(cfg.estructuraCuenta));
    if (k) estr = p.sinClasificar[k];
  }
  const res = MESES.map((_, m) => (Number(s.resFinal[m]) || 0) - (Number(estr[m]) || 0) - (imp?.total[m] || 0) - (fin?.total[m] || 0));
  return {
    res, resOp: s.resFinal, estructura: estr, impuestos: imp?.total || ZERO(), financieros: fin?.total || ZERO(),
    ivaDeb: MESES.map((_, m) => (Number(s.ivaDeb?.[m]) || 0) + (Number(estrDeb[m]) || 0)),
    ivaCred: MESES.map((_, m) => (Number(s.ivaCred?.[m]) || 0) + (Number(estrCred[m]) || 0)),
  };
}

// Traduce filas del P&L a `destino` con el TC del mes de cada fila (nb_tipos_cambio). Las filas sin TC se descartan
// (igual que traducirFilasFx del P&L). Para mirar una fondeada entera en SU moneda: lo que paga en otra (España:
// sueldos en USD, gastos en ARS) entra convertido en vez de perderse como en el modo nativo.
export function traducirFilas(rows, tiposCambio, destino) {
  if (!tiposCambio) return rows || [];
  const out = [];
  for (const r of rows || []) {
    if (!r?.fecha) { out.push(r); continue; }
    if ((r.moneda || "ARS") === destino) { out.push(r); continue; }
    const tc = tcDelMes(tiposCambio, parseInt(r.fecha.slice(0, 4), 10), parseInt(r.fecha.slice(5, 7), 10));
    const t = montoAMoneda(Number(r.total) || 0, r.moneda || "ARS", tc, destino);
    if (t == null) continue;
    out.push({ ...r, total: t, iva_monto: montoAMoneda(Number(r.iva_monto) || 0, r.moneda || "ARS", tc, destino) ?? 0, moneda: destino });
  }
  return out;
}
