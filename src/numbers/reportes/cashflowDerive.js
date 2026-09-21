// Motor de caja (método DIRECTO), puro. Cada movimiento de una caja/banco real se clasifica por lo que UNO quiere saber
// de la caja: qué cobró, qué pagó y a quién (naturaleza), qué fondeó, qué financió y cuánta plata cambió de moneda.
// Rediseño 19/9/2026 (Martín: "necesito entender si tengo caja positiva o negativa y por qué"):
//  · Operación por NATURALEZA (cobros de clientes, franquicias, sueldos, impuestos, tarjeta, proveedores), no por centro.
//  · Cambio de moneda como bloque PROPIO (en una moneda sola es la fuente/destino de plata más grande del núcleo).
//  · Transferencias sin par y extracto sin conciliar = CONTROLES (deberían dar cero), separados de la operación.
// Lo consumen la vista directa ("Por qué se movió la caja") y la indirecta ("Del resultado a la caja") que usa
// `flujoNeto` como control cruzado contra la variación de saldos del Balance.
import { esIgnorado } from "../../lib/numbersApi";

const ccKey = s => String(s ?? "").trim().toLowerCase();
const normCat = raw => String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");

export const CF_ACT = [
  { key: "operativo",    label: "Operación (cobros y pagos del negocio)" },
  { key: "inversion",    label: "Fondeo e inversión" },
  { key: "financiacion", label: "Financiación (plata que no es resultado)" },
  { key: "cambio",       label: "Cambio de moneda" },
  { key: "control",      label: "Controles (deberían dar cero)" },
];
// Orden fijo de conceptos por actividad (orden de negocio, no por magnitud).
export const CF_CONCEPTO_ORDEN = {
  operativo:    ["Cobros de clientes · Sedes", "Cobros de clientes · HQ", "Franquicias (cobros − pagos)",
                 "Sueldos", "Impuestos y cargas sociales", "Tarjeta de crédito (pago del resumen)",
                 "Pagos a proveedores · Sedes", "Pagos a proveedores · HQ"],
  inversion:    ["Fondeo a otros negocios", "Movimientos intercompañía"],
  financiacion: ["Préstamos recibidos", "Cuotas de planes y préstamos", "Anticipos de clientes", "Socios (aportes, préstamos, dividendos)"],
  cambio:       ["Cambio de moneda"],
  control:      ["Transferencias entre cuentas (sin par)", "Sin conciliar (pendiente)"],
};
export const CF_GO_LIVE_YEAR = 2026;   // año del go-live
export const CF_START_MES = 6;         // Julio (0-indexed): el Cash Flow arranca acá SOLO el año de go-live (1/7/2026).

const RE_SUELDO   = /sueldo|haber|aguinaldo|honorario.*coach/i;
const RE_IMPUESTO = /impuesto|imp\.|iva|ganancia|ingresos brutos|iibb|afip|agip|arba|abl|carga|931|monotributo|sicore|percep|retenc|tasa|sellos|seguridad social|tgss|dian|ica\b/i;

// Clasifica un movimiento de caja por ACTIVIDAD + concepto. Resuelve la cuenta contable del propio movimiento o del
// comprobante que paga/cobra (docCuenta) y el centro (propio o del comprobante, docCentro). `perimetro` = set de
// sociedades elegidas: un gasto a un centro cuya empresa está FUERA del perímetro es fondeo (inversión).
export function clasificarFlujo(m, { ccMap, perimetro, docCentro, docCuenta, cuentaMap } = {}) {
  const origen = String(m.origen || "").toLowerCase();
  const tipo   = String(m.tipo || "").toUpperCase();
  const doc    = String(m.documento_id || "");
  const entra  = (Number(m.monto) || 0) >= 0;
  // Controles / cambio (plata entre cajas propias: no es flujo del negocio)
  if (tipo === "TRANSFERENCIA") return { act: "control", concepto: "Transferencias entre cuentas (sin par)" };
  if (tipo === "CAMBIO")        return { act: "cambio",  concepto: "Cambio de moneda" };
  // Financiación
  if (origen === "socios") return { act: "financiacion", concepto: "Socios (aportes, préstamos, dividendos)" };
  if (origen.startsWith("financiacion") || origen === "cuota" || doc.startsWith("FIN-"))
    return { act: "financiacion", concepto: entra ? "Préstamos recibidos" : "Cuotas de planes y préstamos" };
  if (origen === "anticipo_alta") return { act: "financiacion", concepto: "Anticipos de clientes" };   // el cliente te financia
  // Operación por naturaleza (independiente del centro)
  if (tipo === "PAGO_TARJETA" || origen === "pago_tarjeta") return { act: "operativo", concepto: "Tarjeta de crédito (pago del resumen)" };
  if (origen === "franquicias") return { act: "operativo", concepto: "Franquicias (cobros − pagos)" };
  // Inversión — interco
  if (origen === "intercompania" || origen === "interco_park" || origen === "interco_recibida" || tipo === "INTERCOMPANIA")
    return { act: "inversion", concepto: "Movimientos intercompañía" };
  // Centro: el del movimiento o el del comprobante que paga/cobra (cobros/pagos no traen centro).
  const centroId = String(m.centro_costo || "").trim() || (doc && docCentro ? (docCentro.get(doc) || "") : "");
  const cc = centroId && ccMap ? ccMap.get(ccKey(centroId)) : null;
  const empresa = String(cc?.empresa || "").trim();
  const grupo   = String(cc?.grupo || "").toLowerCase();
  // Fondeo: gasto/ingreso a un centro cuya sociedad dueña está FUERA del perímetro elegido.
  if (empresa && perimetro && perimetro.size > 0 && !perimetro.has(empresa))
    return { act: "inversion", concepto: "Fondeo a otros negocios" };
  // Naturaleza por cuenta contable (del movimiento o del comprobante)
  const ctaRaw = String(m.cuenta_contable || "").trim() || (doc && docCuenta ? (docCuenta.get(doc) || "") : "");
  const cta = ctaRaw && cuentaMap ? (cuentaMap.get(ctaRaw) || cuentaMap.get(ctaRaw.toLowerCase())) : null;
  const ctaNombre = String(cta?.nombre || ctaRaw);
  const ctaCat = normCat(cta?.categoria_pnl);
  if (tipo === "SUELDO" || origen === "sueldos" || doc.startsWith("LIQ-") || RE_SUELDO.test(ctaNombre))
    return { act: "operativo", concepto: "Sueldos" };
  if (!entra && (ctaCat === "impuestos" || ctaCat === "impuesto" || RE_IMPUESTO.test(ctaNombre)))
    return { act: "operativo", concepto: "Impuestos y cargas sociales" };
  // Cobros / pagos por negocio: HQ = todo lo que NO es sede (sueldos HQ ya salieron arriba).
  if (grupo === "hq")
    return { act: "operativo", concepto: entra ? "Cobros de clientes · HQ" : "Pagos a proveedores · HQ" };
  if (cc && grupo !== "inversiones")
    return { act: "operativo", concepto: entra ? "Cobros de clientes · Sedes" : "Pagos a proveedores · Sedes" };
  // Línea del extracto TODAVÍA no aceptada en la bandeja (caja real, aún sin imputar) = backlog de conciliación.
  if (origen === "extracto" && !doc)
    return { act: "control", concepto: "Sin conciliar (pendiente)" };
  return { act: "operativo", concepto: entra ? "Cobros de clientes · HQ" : "Pagos a proveedores · HQ" };
}

// `fx(monto, moneda, anio, mes)` → monto en la moneda de vista (null si falta TC). Sin `fx` → nativo en `moneda`.
// `perimetro` = Set de ids de sociedad elegidas (vacío = todas). Devuelve agregados mensuales [12].
export function computeCashFlow({ rawMovs = [], rawIn = [], rawEg = [], docs = [], ccMap, cuentaMap = null, perimetro = new Set(),
                                  year, moneda, fx = null, tarjetaIds, cuentasBancarias = [] }) {
  // Índices comprobante → centro / cuenta (los cobros/pagos no traen centro; el pago sí suele traer cuenta_contable).
  // Filas de P&L (id con sufijo -Lnnnnn) y documentos enriquecidos (id de comprobante con `cc`/`cuenta`).
  const docCentro = new Map(), docCuenta = new Map();
  for (const r of [...rawIn, ...rawEg]) {
    const full = String(r.id ?? ""); const comp = full.replace(/-L\d+$/i, "");
    const centro = String(r.centro_costo ?? ""), cuenta = String(r.cuenta_contable ?? "");
    if (centro) { if (full && !docCentro.has(full)) docCentro.set(full, centro); if (comp && !docCentro.has(comp)) docCentro.set(comp, centro); }
    if (cuenta) { if (full && !docCuenta.has(full)) docCuenta.set(full, cuenta); if (comp && !docCuenta.has(comp)) docCuenta.set(comp, cuenta); }
  }
  for (const d of docs) {
    const id = String(d.id ?? ""); if (!id) continue;
    if (d.cc && !docCentro.has(id)) docCentro.set(id, String(d.cc));
    if ((d.cuentaId || d.cuenta) && !docCuenta.has(id)) docCuenta.set(id, String(d.cuentaId || d.cuenta));
  }
  const ctx = { ccMap, perimetro, docCentro, docCuenta, cuentaMap };
  // Moneda AUTORITATIVA = la de la cuenta bancaria; el campo `moneda` del movimiento es fallback.
  const cuentaMoneda = new Map(), cuentaSoc = new Map();
  for (const c of (cuentasBancarias || [])) { cuentaMoneda.set(String(c.id), String(c.moneda || "ARS")); cuentaSoc.set(String(c.id), String(c.sociedad || "").toLowerCase()); }
  const monedaDe = (m) => cuentaMoneda.get(String(m.cuenta_bancaria)) || (m.moneda ?? "ARS");
  const montoDe = (m) => {
    const v = Number(m.monto) || 0;
    if (!fx) return v;
    const anio = parseInt(m.fecha.slice(0, 4), 10), mes = parseInt(m.fecha.slice(5, 7), 10);
    return fx(v, monedaDe(m), anio, mes) ?? 0;
  };
  // Predicado de caja: la SOCIEDAD ES LA DE LA CUENTA (mismo criterio que derivarSaldos → el Δ caja ata con el Balance),
  // banco/caja real, no ignorada, no tarjeta. Nativo → en LA moneda; con `fx` → todas las monedas (cada una traducida).
  const perimLC = new Set([...perimetro].map(x => String(x).toLowerCase()));
  const esCash = (m) => !!m.fecha && !esIgnorado(m) && !!m.cuenta_bancaria && cuentaMoneda.has(String(m.cuenta_bancaria))
    && !(tarjetaIds?.has(m.cuenta_bancaria)) && (fx ? true : monedaDe(m) === moneda)
    && (perimLC.size === 0 || perimLC.has(cuentaSoc.get(String(m.cuenta_bancaria))));
  const cfStartMes = year === CF_GO_LIVE_YEAR ? CF_START_MES : 0;
  const cutoff = `${year}-${String(cfStartMes + 1).padStart(2, "0")}-01`;
  const movsFilt = rawMovs.filter(m => esCash(m) && m.fecha.slice(0, 4) === String(year) && m.fecha >= cutoff);
  // Saldo inicial = saldo de cada moneda al cierre anterior al arranque, traducido (si hay fx) al TC de ESE mes (como el
  // Balance de apertura), no movimiento por movimiento (evita pedir TC de años viejos y ata con el Balance al 30/6).
  const openingCash = (() => {
    const porMon = {};
    for (const m of rawMovs) if (esCash(m) && m.fecha < cutoff) porMon[monedaDe(m)] = (porMon[monedaDe(m)] || 0) + (Number(m.monto) || 0);
    if (!fx) return Object.values(porMon).reduce((s, v) => s + v, 0);
    const [aY, aM] = cfStartMes === 0 ? [year - 1, 12] : [year, cfStartMes];   // mes anterior al arranque (1-based)
    return Object.entries(porMon).reduce((s, [mo, v]) => s + (fx(v, mo, aY, aM) ?? 0), 0);
  })();
  const porAct = Object.fromEntries(CF_ACT.map(a => [a.key, {}]));
  const detalle = {};   // concepto → movimientos (para drill / diagnóstico)
  for (const m of movsFilt) {
    const mes = parseInt(m.fecha.slice(5, 7), 10) - 1; if (mes < 0 || mes > 11) continue;
    const { act, concepto } = clasificarFlujo(m, ctx);
    (porAct[act][concepto] ??= new Array(12).fill(0))[mes] += montoDe(m);
    (detalle[concepto] ??= []).push(m);
  }
  const Z = () => new Array(12).fill(0);
  const actTot = {};
  for (const k of Object.keys(porAct)) actTot[k] = Z().map((_, m) => Object.values(porAct[k]).reduce((s, a) => s + a[m], 0));
  const flujoNeto = Z().map((_, m) => CF_ACT.reduce((s, a) => s + actTot[a.key][m], 0));
  let cum = openingCash;
  const saldoFinal = flujoNeto.map(v => { cum += v; return cum; });
  const saldoInicioMes = Z().map((_, m) => saldoFinal[m] - flujoNeto[m]);
  const hoy = new Date();
  const mesEnCurso = hoy.getFullYear() === year ? hoy.getMonth() : null;   // columna "abierta": no entra a los totales
  const upto = mesEnCurso == null ? 11 : mesEnCurso;
  const activeMonths = []; for (let i = cfStartMes; i <= Math.max(upto, cfStartMes); i++) activeMonths.push(i);
  return { porAct, actTot, flujoNeto, openingCash, saldoFinal, saldoInicioMes, activeMonths, cfStartMes, mesEnCurso, detalle };
}
