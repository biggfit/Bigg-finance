// Derivación pura de la foto de Tesorería de UNA sociedad: saldos de cuentas +
// Activo (a cobrar) + Pasivo (a pagar), combinando TODAS las fuentes (comprobantes,
// franquicias, socios, sueldos, financiaciones, anticipos, tarjetas).
// La usan PantallaTesoreria (una sociedad, datos ya scopeados) y el tab consolidado
// de Reportes (loop por sociedad sobre datasets de todas). Sin React, sin I/O.
import {
  calcSaldoPendiente, esCuentaCredito, esIgnorado,
  financiacionPasivoBuckets, financiacionLedger, agruparAnticipos, anticipoPasivo, sociosSaldos, lecturaInterco,
} from "../lib/numbersApi";
import { parsePagoFromMov, normSoc, pendienteSueldosPorLegajo, adelantoSueldosPorLegajo } from "../lib/sueldosApi";
import { franquiciasSaldosCxC } from "../lib/franquiciasAdapter";

// Orden Activo/Pasivo: Franquiciados arriba (alineado entre ambos lados), luego por monto.
const _esFranq = it => (it.label ?? "").startsWith("Franquiciados");
export const franqFirst = (a, b) => (_esFranq(b) ? 1 : 0) - (_esFranq(a) ? 1 : 0) || b.saldo - a.saldo;

// Mapa id→nombre de sociedad (reusado por Tesorería, Intercompañía y el consolidado).
export const sociedadNombreMap = (sociedades = []) =>
  new Map(sociedades.map(s => [String(s.id), s.nombre || String(s.id)]));

// Una posición interco → item de Activo (neto>0, nos deben) o Pasivo (neto<0, les debemos).
// `ref` (opcional) = { sociedadId, contraparteId } → habilita el drill-down al extracto interco.
const intercoItem = (neto, moneda, nombre, ref = null) => ({
  label: `Intercompañía · ${nombre}`, moneda, saldo: Math.abs(neto),
  docs: [{ contraparte: nombre, vto: "", saldo: Math.abs(neto), moneda }],
  headerColor: neto > 0 ? "#16a34a" : "#dc2626",
  ...(ref ? { intercoLedger: true, sociedadId: ref.sociedadId, contraparteId: ref.contraparteId } : {}),
});

// Ledger (extracto) de una cuenta corriente CxC/CxP: factura (+) − pago/cobro (−) por fecha, saldo
// corriente. `final` = pendiente del grupo. Mismo shape que financiacionLedger/intercoLedger.
function cxLedger(entries = []) {
  entries.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  let saldo = 0;
  for (const e of entries) { saldo += e.delta; e.saldo = saldo; }
  return { opening: 0, entries, final: saldo };
}

// Vista CONSOLIDADA del interco sobre un set de sociedades: las posiciones núcleo↔núcleo internas
// al set se ELIMINAN (intra-grupo); las demás (fondeadas/externas) se muestran. Devuelve {activo,pasivo}.
export function intercoConsolidado(intercoData, selectedIds, sociedades = []) {
  const anilloDe = new Map(sociedades.map(s => [String(s.id), String(s.anillo || "")]));
  const nombreDe = sociedadNombreMap(sociedades);
  const esNucleo = id => /^n[úu]cleo/i.test(anilloDe.get(String(id)) || "");
  const nom      = id => nombreDe.get(String(id)) || String(id);
  const sel      = new Set((selectedIds || []).map(String));
  const activo = [], pasivo = [];
  for (const p of lecturaInterco(intercoData)) {   // cada par aparece una vez con neto>0 (acreedor)
    if (p.neto <= 0.01) continue;
    const s = String(p.sociedad), c = String(p.contraparte);
    const sIn = sel.has(s), cIn = sel.has(c);
    if (esNucleo(s) && esNucleo(c) && sIn && cIn) continue;   // núcleo↔núcleo interno → netea
    if (sIn)      activo.push(intercoItem(+p.neto, p.moneda, nom(c), { sociedadId: s, contraparteId: c }));   // una del set es acreedora
    else if (cIn) pasivo.push(intercoItem(-p.neto, p.moneda, nom(s), { sociedadId: c, contraparteId: s }));   // una del set es deudora
  }
  return { activo, pasivo };
}

// Busca en nb_cuentas por id, nombre exacto, o nombre normalizado (guiones→espacios).
const _norm = s => (s ?? "").toLowerCase().replace(/_/g, " ").trim();
function resolveCuenta(cuentaById, cuentaByNombre, id, nombre) {
  return cuentaById.get(id ?? "")
    || cuentaByNombre.get((nombre ?? "").toLowerCase())
    || cuentaByNombre.get(_norm(id))
    || cuentaByNombre.get(_norm(nombre))
    || null;
}

/**
 * @returns {{ cuentas, aCobrar, aPagar }} — cuentas con saldo (de esta sociedad),
 * y las listas Activo/Pasivo ya combinadas y ordenadas (equivalentes a aCobrarFull/aPagarFull).
 */
export function derivarSaldos({
  sociedad, fechaCorte = "",
  movimientos = [], egresos = [], ingresos = [], pagosCobros = [],
  cuentasBancarias = [], cuentasContables = [],
  liqsSueldos = [], financiaciones = [], socios = [], sociosCC = [],
  franqData = { comps: {}, saldos: {}, franchises: [] },
  movsFranq = null,   // cobros de franquicia GROUP-WIDE (independientes de la sociedad de la caja); si null → usa `movimientos`
  intercoData = null, sociedadesMap = null,   // si vienen → agrega la posición interco de ESTA sociedad
}) {
  const _soc  = (sociedad ?? "").toLowerCase();
  const corte = fechaCorte || null;

  // ── Posición intercompañía de ESTA sociedad (neto>0 nos deben / neto<0 les debemos) ──
  const intercoAct = [], intercoPas = [];
  if (intercoData) {
    const nom = id => sociedadesMap?.get?.(String(id)) || String(id);
    for (const p of lecturaInterco(intercoData, { sociedad })) {
      if (Math.abs(p.neto) < 0.01) continue;
      (p.neto > 0 ? intercoAct : intercoPas).push(intercoItem(p.neto, p.moneda, nom(p.contraparte), { sociedadId: p.sociedad, contraparteId: p.contraparte }));
    }
  }

  // ── Cuentas con saldo calculado desde movimientos ──
  // Una cuenta puesta como inactiva (activo=false) se OCULTA, pero SOLO si quedó en $0: si todavía
  // tiene saldo la seguimos mostrando para no esconder plata del total (desactivar ≠ borrar el saldo).
  const cuentaInactiva = (c) => /^(false|no|0)$/i.test(String(c.activo ?? "").trim());
  const cuentas = cuentasBancarias
    .filter(c => (c.sociedad ?? "").toLowerCase() === _soc)
    .map(cuenta => {
      const movsCuenta = movimientos.filter(m =>
        m.cuenta_bancaria === cuenta.id && !esIgnorado(m) && (!corte || (m.fecha ?? "") <= corte));
      const saldo = movsCuenta.reduce((s, m) => s + (Number(m.monto) || 0), 0);
      return { ...cuenta, tipo: (cuenta.tipo ?? "").toLowerCase(), saldo };
    })
    .filter(c => !cuentaInactiva(c) || Math.abs(Number(c.saldo) || 0) > 0.005);

  const cuentaById     = new Map(cuentasContables.map(c => [c.id, c]));
  const cuentaByNombre = new Map(cuentasContables.map(c => [(c.nombre ?? "").toLowerCase(), c]));

  // ── CC comercial con OTRAS SOCIEDADES del grupo (facturas reales, NO funding) ──
  // Comprobantes cuya contraparte es otra sociedad = deuda comercial real (ej. Ñako le factura
  // alquiler/pauta a Segui, Segui le hace una NC). Se consolidan por contraparte (neto CxC−CxP) y
  // van a Activo (nos deben) o Pasivo (les debemos), en UNA fila — separado del bloque
  // "Intercompañía" (que es funding: transferencias / pagar con caja ajena, saldo fluctuante).
  const socIds = sociedadesMap ? new Set([...sociedadesMap.keys()].map(x => String(x).toLowerCase())) : null;
  const nomSoc = id => sociedadesMap?.get?.(String(id)) || sociedadesMap?.get?.(String(id).toLowerCase()) || String(id);
  const esContraparteSociedad = cpId => !!socIds && !!cpId && socIds.has(String(cpId).toLowerCase()) && String(cpId).toLowerCase() !== _soc;
  const ccGrupo = new Map();   // `${cpId}||${moneda}` → { cpId, nombre, moneda, cobrar, pagar, docs }
  const accCC = (cpId, moneda, side, saldo, doc) => {
    const k = `${String(cpId).toLowerCase()}||${moneda}`;
    let e = ccGrupo.get(k);
    if (!e) { e = { cpId, nombre: nomSoc(cpId), moneda, cobrar: 0, pagar: 0, docs: [] }; ccGrupo.set(k, e); }
    e[side] += saldo;
    e.docs.push({ ...doc, _side: side, monto: saldo });
  };

  // ── A cobrar (comprobantes de ingreso pendientes) ──
  const cobros = pagosCobros.filter(p => p.tipo === "COBRO" && (!corte || (p.fecha ?? "") <= corte));
  const grpCob = {};
  const ledCob = {};   // ledger por grupo (label||moneda): TODAS las facturas + sus cobros
  for (const ing of ingresos) {
    if ((ing.sociedad ?? "").toLowerCase() !== _soc) continue;
    if (corte && (ing.fecha ?? "") > corte) continue;
    const pagosDoc = cobros.filter(c => c.documento_id === ing.id);
    const saldo    = calcSaldoPendiente(ing.importe, pagosDoc);
    // Contraparte = otra sociedad → CC comercial (no va al bucket por cuenta; se netea aparte).
    if (esContraparteSociedad(ing.clienteId)) {
      if (saldo > 0) accCC(ing.clienteId, ing.moneda ?? "ARS", "cobrar", saldo,
        { fecha: ing.fecha, cuenta: ing.cuenta || "—", nroComp: ing.nroComp || ing.nro_comp || "", vto: ing.vto, moneda: ing.moneda ?? "ARS" });
      continue;
    }
    const cuentaDef = resolveCuenta(cuentaById, cuentaByNombre, ing.cuentaId, ing.cuenta);
    const label     = cuentaDef?.cuenta_pasivo || ing.cuenta || "Sin cuenta";
    const key       = `${label}||${ing.moneda ?? "ARS"}`;
    (ledCob[key] ??= []).push({ fecha: ing.fecha, delta: Math.abs(Number(ing.importe) || 0),
      concepto: `Factura${ing.nroComp || ing.nro_comp ? " " + (ing.nroComp || ing.nro_comp) : ""} · ${ing.cliente || ing.proveedor || "—"}`,
      sub: ing.vto ? `vto ${ing.vto}` : "" });
    for (const c of pagosDoc) ledCob[key].push({ fecha: c.fecha, delta: -Math.abs(Number(c.monto) || 0),
      concepto: `Cobro · ${ing.cliente || ing.proveedor || "—"}` });
    if (saldo <= 0) continue;
    if (!grpCob[key]) grpCob[key] = { label, moneda: ing.moneda ?? "ARS", saldo: 0, docs: [], headerColor: "#16a34a" };
    grpCob[key].saldo += saldo;
    grpCob[key].docs.push({ contraparte: ing.cliente || ing.proveedor || "Sin nombre", vto: ing.vto, saldo, moneda: ing.moneda ?? "ARS" });
  }
  const aCobrarComp = Object.values(grpCob).sort((a, b) => b.saldo - a.saldo);
  for (const it of aCobrarComp) it.ledger = cxLedger(ledCob[`${it.label}||${it.moneda}`] || []);

  // ── Franquiciados (Bigg Franquicias, read-only): activo/pasivo por empresa+moneda ──
  const now    = new Date();
  // La CxC de franquiciados netea por franquiciado × empresa × moneda, sin importar en qué caja
  // (sociedad) entró el cobro. Por eso usa los cobros GROUP-WIDE (movsFranq), no los de esta sociedad.
  const franqCC = franquiciasSaldosCxC(franqData, sociedad, now.getFullYear(), now.getMonth(), movsFranq ?? movimientos);

  // ── Socios (dividendos + préstamos): slice de esta sociedad, balance puro ──
  const sociosCCsld = sociosSaldos(socios, sociosCC, movimientos, { sociedad });

  // ── Sueldos: neto devengado−pagado por legajo/mes. Positivo → PASIVO (deuda); negativo →
  //    ACTIVO (adelanto: pago sin liquidación cerrada aún). Se compensa al cerrar la liquidación. ──
  // Solo pagos de sueldo REALES (tipo SUELDO). El pago del F931 (cargas sociales) es origen "sueldos"
  // pero tipo PAGO y sin legajo → excluirlo evita un "Adelanto a empleados" fantasma en el Activo.
  const pagosSueldos = movimientos.filter(m => m.origen === "sueldos" && m.tipo === "SUELDO").map(parsePagoFromMov);
  const sueldosSide = (porLegajo) => {
    const soc = normSoc(sociedad);
    const docs = []; let total = 0;
    for (const leg of porLegajo) for (const it of leg.items) {
      if (normSoc(it.sociedad) !== soc) continue;
      total += it.monto;
      // Vencimiento real del sueldo: se paga entre el 1 y 5 del mes SIGUIENTE (mes vencido) → vto = 05 del mes M+1 (ISO).
      const _m2 = Number(it.mes) === 12 ? 1 : Number(it.mes) + 1;
      const _a2 = Number(it.mes) === 12 ? Number(it.anio) + 1 : Number(it.anio);
      docs.push({ contraparte: leg.legajo, vto: `${_a2}-${String(_m2).padStart(2, "0")}-05`, saldo: it.monto, moneda: "ARS" });
    }
    docs.sort((a, b) => b.saldo - a.saldo);
    return { total, docs };
  };
  const sueldosPasivo = sueldosSide(pendienteSueldosPorLegajo(liqsSueldos, pagosSueldos));
  const sueldosActivo = sueldosSide(adelantoSueldosPorLegajo(liqsSueldos, pagosSueldos));

  const aCobrar = [...aCobrarComp, ...franqCC.activo, ...sociosCCsld.activo,
    ...(sueldosActivo.total > 0 ? [{ label: "Adelanto a empleados", moneda: "ARS", saldo: sueldosActivo.total, docs: sueldosActivo.docs, headerColor: "#16a34a" }] : []),
  ].sort(franqFirst);

  // ── A pagar (comprobantes de egreso pendientes) ──
  const pagos = pagosCobros.filter(p => (p.tipo === "PAGO" || p.tipo === "EGRESO_GASTO") && (!corte || (p.fecha ?? "") <= corte));
  const pasivoLabel = { proveedores: "Proveedores", sueldos: "Sueldos", impuestos: "Impuestos", financiero: "Financiero", ventas: "Ventas" };
  const grpPag = {};
  const ledPag = {};   // ledger por grupo (label||moneda): TODAS las facturas + sus pagos
  for (const eg of egresos) {
    if ((eg.sociedad ?? "").toLowerCase() !== _soc) continue;
    if (corte && (eg.fecha ?? "") > corte) continue;
    const pagosDoc = pagos.filter(p => p.documento_id === eg.id);
    const saldo    = calcSaldoPendiente(eg.importe, pagosDoc);
    // Contraparte = otra sociedad → CC comercial (no va al bucket por cuenta; se netea aparte).
    if (esContraparteSociedad(eg.proveedorId)) {
      if (saldo > 0) accCC(eg.proveedorId, eg.moneda ?? "ARS", "pagar", saldo,
        { fecha: eg.fecha, cuenta: eg.cuenta || "—", nroComp: eg.nroComp || eg.nro_comp || "", vto: eg.vto, moneda: eg.moneda ?? "ARS" });
      continue;
    }
    const cuentaDef = resolveCuenta(cuentaById, cuentaByNombre, eg.cuentaId, eg.cuenta);
    const bucket    = (cuentaDef?.cuenta_pasivo ?? "").toLowerCase() || "proveedores";
    const label     = /^tarjeta/i.test(eg.proveedor ?? "") ? "Tarjeta de crédito"
                      : (pasivoLabel[bucket] ?? cuentaDef?.cuenta_pasivo ?? "Proveedores");
    const key       = `${label}||${eg.moneda ?? "ARS"}`;
    (ledPag[key] ??= []).push({ fecha: eg.fecha, delta: Math.abs(Number(eg.importe) || 0),
      concepto: `Factura${eg.nroComp || eg.nro_comp ? " " + (eg.nroComp || eg.nro_comp) : ""} · ${eg.proveedor || "—"}`,
      sub: eg.vto ? `vto ${eg.vto}` : "" });
    for (const p of pagosDoc) ledPag[key].push({ fecha: p.fecha, delta: -Math.abs(Number(p.monto) || 0),
      concepto: `Pago · ${eg.proveedor || "—"}` });
    if (saldo <= 0) continue;
    if (!grpPag[key]) grpPag[key] = { label, moneda: eg.moneda ?? "ARS", saldo: 0, docs: [], headerColor: "#dc2626" };
    grpPag[key].saldo += saldo;
    grpPag[key].docs.push({ contraparte: eg.proveedor || "Sin proveedor", vto: eg.vto, saldo, moneda: eg.moneda ?? "ARS" });
  }
  const aPagarComp = Object.values(grpPag).sort((a, b) => b.saldo - a.saldo);
  for (const it of aPagarComp) it.ledger = cxLedger(ledPag[`${it.label}||${it.moneda}`] || []);

  // ── Pasivo de financiaciones (planes AFIP + créditos) ──
  const finPasivo = (() => {
    const b = financiacionPasivoBuckets(financiaciones, sociedad);
    const items = [];
    const armar = (bucket, label, tipo) => {
      for (const mon of ["ARS", "USD", "EUR"]) {
        if (bucket.tot[mon] <= 0) continue;
        const docs = bucket.docs.filter(d => d.moneda === mon)
          .map(d => ({ contraparte: `${d.acreedor || "—"}${d.nro_plan ? " · " + d.nro_plan : ""}`, vto: d.prox_vto, saldo: d.saldo, moneda: mon }));
        // ledger = extracto del pasivo (apertura + cuotas pagadas/devengadas con saldo corriente)
        const ledger = financiacionLedger(financiaciones, { tipo, moneda: mon });
        items.push({ label, moneda: mon, saldo: bucket.tot[mon], docs, ledger, headerColor: "#dc2626" });
      }
    };
    armar(b.impuestos, "Planes de pago", "plan_afip");
    armar(b.financiero, "Créditos", "prestamo");
    return items;
  })();

  // ── Pasivo de anticipos de clientes (ingresos diferidos) ──
  const anticiposPasivo = (() => {
    const { tot, docs } = anticipoPasivo(agruparAnticipos(movimientos), sociedad);
    const items = [];
    for (const mon of ["ARS", "USD", "EUR"]) {
      if (tot[mon] <= 0) continue;
      const d = docs.filter(x => x.moneda === mon).map(x => ({ contraparte: x.cliente || "—", vto: x.fecha, saldo: x.saldo, moneda: mon }));
      items.push({ label: "Anticipos de clientes", moneda: mon, saldo: tot[mon], docs: d, headerColor: "#dc2626" });
    }
    return items;
  })();

  // ── Deuda de tarjetas (saldo negativo de las cuentas-tarjeta) ──
  const tarjetasPasivo = cuentas.filter(c => esCuentaCredito(c) && (Number(c.saldo) || 0) < 0)
    .map(c => {
      const movsCard = movimientos.filter(m => m.cuenta_bancaria === c.id && !esIgnorado(m)
        && (!corte || (m.fecha ?? "") <= corte));
      const docs = movsCard.map(m => ({
        contraparte: m.concepto || (Number(m.monto) < 0 ? "Consumo" : "Pago"),
        vto: m.fecha, saldo: -(Number(m.monto) || 0), moneda: c.moneda,
      }));
      return { label: c.nombre, moneda: c.moneda, saldo: -(Number(c.saldo) || 0), docs, headerColor: "#dc2626" };
    });

  // ── Pasivo combinado ──
  const aPagar = (() => {
    const out = aPagarComp.map(it => ({ ...it }));
    if (sueldosPasivo.total > 0) {
      const existente = out.find(it => it.label === "Sueldos" && it.moneda === "ARS");
      if (existente) {
        existente.saldo += sueldosPasivo.total;
        existente.docs  = [...existente.docs, ...sueldosPasivo.docs];
      } else {
        out.push({ label: "Sueldos", moneda: "ARS", saldo: sueldosPasivo.total, docs: sueldosPasivo.docs, headerColor: "#dc2626" });
      }
    }
    out.push(...finPasivo, ...anticiposPasivo, ...franqCC.pasivo, ...tarjetasPasivo, ...sociosCCsld.pasivo);
    return out.sort(franqFirst);
  })();

  // Interco = bloque propio (abajo de Inversiones), NO mezclado en Activo/Pasivo.
  const interco = [...intercoAct, ...intercoPas];

  // ── CC comercial del grupo: neto por contraparte → Activo (nos deben) / Pasivo (les debemos) ──
  // Una fila por contraparte, deuda REAL en el Balance (a diferencia del bloque Intercompañía/funding).
  // El neteo saca la NC del Activo y la compensa contra el Pasivo → no distorsiona el PN.
  const ccAct = [], ccPas = [];
  for (const e of ccGrupo.values()) {
    const neto = e.cobrar - e.pagar;   // >0 nos deben (activo) · <0 les debemos (pasivo)
    if (Math.abs(neto) < 0.5) continue;
    const ladoSuma = neto > 0 ? "cobrar" : "pagar";   // el otro lado resta (p.ej. una NC en un pasivo)
    const docs = e.docs.map(d => ({
      fecha: d.fecha, cuenta: d.cuenta, nroComp: d.nroComp, side: d._side, monto: d.monto,
      vto: d.vto, moneda: d.moneda,
      contraparte: `${d.cuenta || "—"}${d.nroComp ? " " + d.nroComp : ""}`,   // fallback para la vista aging
      saldo: (d._side === ladoSuma ? 1 : -1) * d.monto,                        // firmado → el total reconcilia al neto
    }));
    const item = { label: e.nombre, moneda: e.moneda, saldo: Math.abs(neto), docs,
      headerColor: neto > 0 ? "#16a34a" : "#dc2626", ccGrupo: true };
    (neto > 0 ? ccAct : ccPas).push(item);
  }

  return {
    cuentas,
    aCobrar: ccAct.length ? [...aCobrar, ...ccAct].sort(franqFirst) : aCobrar,
    aPagar:  ccPas.length ? [...aPagar,  ...ccPas].sort(franqFirst) : aPagar,
    interco,
  };
}
