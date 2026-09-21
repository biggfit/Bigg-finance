// ─── PUENTE P&L → ΔPN (cómputo de DIAGNÓSTICO, descartable) ─────────────────────────────────
// Para una sociedad (o set), moneda y mes: Resultado económico (Devengado crudo) vs variación del PN
// (mismo motor que Evolución PN: derivarSaldos + intercoConsolidado en dos cortes), y una lista de
// "explicadores" que cuantifican la diferencia con las filas detrás de cada uno.
// Convención: e = aporte al gap, gap = (ΔPN − Δcambio) − Resultado; residual = gap − Σe (debe ≈ 0).
// NO es UI. Se expone en dev por window.__buildPuente (ver TabTesoreriaConsolidada) y se corre en consola.
import { derivarSaldos, intercoConsolidado, sociedadNombreMap } from "../tesoreriaDerive";
import { intercoLedger, toNum } from "../../lib/numbersApi";
import { normSoc } from "../../lib/sueldosApi";
import { buildDevengado, pnAmount } from "./TabDevengado";

const GO_LIVE = "2026-07-01";
const lc = s => String(s ?? "").trim().toLowerCase();
const finDeMes = (year, m) => m < 0 ? `${year - 1}-12-31` : `${year}-${String(m + 1).padStart(2, "0")}-31`;
const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);

// Suma de saldos de una lista de items para una moneda (misma fórmula que TabTesoreriaConsolidada.sumSaldo).
const sumSaldo = (a, mon, pred = () => true) => a.reduce((s, it) => s + ((it.moneda === mon && pred(it)) ? (Number(it.saldo) || 0) : 0), 0);

// Balance a una fecha para el set S, con la MISMA composición que EEPNView: caja + bancos + aCobrar +
// intercoAct − aPagar − intercoPas (tarjetas fuera de bancos; su deuda vive en aPagar).
function balanceAsOf({ data, intercoData, sociedades, socsIncl, sociedadesMap, mon, fecha }) {
  const perSoc = socsIncl.map(s => derivarSaldos({ ...data, sociedad: s.id, fechaCorte: fecha, sociedadesMap }));
  const ic = intercoData ? intercoConsolidado(intercoData, socsIncl.map(s => s.id), sociedades, fecha) : { activo: [], pasivo: [] };
  const cuentas = perSoc.flatMap(r => r.cuentas);
  const aCobrar = perSoc.flatMap(r => r.aCobrar), aPagar = perSoc.flatMap(r => r.aPagar);
  const caja   = sumSaldo(cuentas, mon, c => (c.tipo || "") === "caja");
  const bancos = sumSaldo(cuentas, mon, c => { const t = c.tipo || ""; return t !== "caja" && t !== "tarjeta"; });
  const cxc = sumSaldo(aCobrar, mon), icA = sumSaldo(ic.activo, mon), cxp = sumSaldo(aPagar, mon), icP = sumSaldo(ic.pasivo, mon);
  const pn = caja + bancos + cxc + icA - cxp - icP;
  // rubros con label (para la tabla ΔRubro)
  const rubros = new Map();
  const put = (k, v) => rubros.set(k, (rubros.get(k) || 0) + v);
  for (const c of cuentas) if (c.moneda === mon) put(`${(c.tipo || "") === "caja" ? "Caja" : (c.tipo === "tarjeta" ? "Tarjeta(saldo)" : "Banco")} · ${c.nombre}`, Number(c.saldo) || 0);
  for (const it of aCobrar) if (it.moneda === mon) put(`ACTIVO · ${it.label}`, Number(it.saldo) || 0);
  for (const it of ic.activo) if (it.moneda === mon) put(`ACTIVO · ${it.label}`, Number(it.saldo) || 0);
  for (const it of aPagar) if (it.moneda === mon) put(`PASIVO · ${it.label}`, -(Number(it.saldo) || 0));
  for (const it of ic.pasivo) if (it.moneda === mon) put(`PASIVO · ${it.label}`, -(Number(it.saldo) || 0));
  return { caja, bancos, cxc, icA, cxp, icP, pn, rubros, aCobrar, aPagar, ic };
}

export function buildPuente({
  data, intercoData, sociedades, inRows, egRows, cuentaMap, ccMap,
  socIds, moneda = "ARS", year = 2026, m, sinIva = false,
}) {
  const S = new Set((socIds || []).map(lc));
  const socsIncl = (sociedades || []).filter(s => S.has(lc(s.id)));
  const sociedadesMap = sociedadNombreMap(sociedades);
  const nucleo = new Set((sociedades || []).filter(s => /n[úu]cleo/i.test(String(s.anillo || ""))).map(s => lc(s.id)));
  const empresaDe = id => lc((data.centrosCosto || []).find(c => lc(c.id) === lc(id))?.empresa);
  const aplicaInterco1 = (A, B) => { A = lc(A); B = lc(B); return !!A && !!B && A !== B && !(nucleo.has(A) && nucleo.has(B)); };
  const ant = finDeMes(year, m - 1), fin = finDeMes(year, m);
  const enMes = f => { f = String(f ?? ""); return f > ant && f <= fin; };

  // ── Lado balance ──
  const bAnt = balanceAsOf({ data, intercoData, sociedades, socsIncl, sociedadesMap, mon: moneda, fecha: ant });
  const bFin = balanceAsOf({ data, intercoData, sociedades, socsIncl, sociedadesMap, mon: moneda, fecha: fin });
  const dPN = bFin.pn - bAnt.pn;
  const dCambio = sum((data.movimientos || []).filter(mv => mv.origen === "cambio" && S.has(lc(mv.sociedad)) && (mv.moneda || "ARS") === moneda && enMes(mv.fecha)), mv => mv.monto);
  const rubroKeys = new Set([...bAnt.rubros.keys(), ...bFin.rubros.keys()]);
  const rubros = [...rubroKeys].map(k => ({ rubro: k, antes: bAnt.rubros.get(k) || 0, despues: bFin.rubros.get(k) || 0, delta: (bFin.rubros.get(k) || 0) - (bAnt.rubros.get(k) || 0) }))
    .filter(r => Math.abs(r.delta) > 0.5 || Math.abs(r.despues) > 0.5).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // ── Lado P&L ──
  const dev = buildDevengado(inRows, egRows, { cuentaMap, ccMap, year, moneda, socSet: S, ccSet: null, sinIva });
  const resultado = dev.resultado[m] || 0;
  const gap = (dPN - dCambio) - resultado;

  // Filas P&L del mes en el perímetro (mismos predicados que buildDevengado).
  const filasPnL = [];
  const addRows = (rows, ladoIngreso) => {
    for (const row of (rows || [])) {
      const f = row.fecha ?? "";
      if (f < GO_LIVE || f.slice(0, 4) !== String(year) || (row.moneda ?? "ARS") !== moneda) continue;
      const perim = empresaDe(row.centro_costo) || lc(row.sociedad);
      if (!S.has(perim)) continue;
      if (parseInt(f.slice(5, 7), 10) - 1 !== m) continue;
      const val = pnAmount(row, ladoIngreso, sinIva);
      if (!val) continue;
      filasPnL.push({ row, ladoIngreso, val, perim });
    }
  };
  addRows(inRows, true); addRows(egRows, false);

  // ── Explicadores ──
  const E = new Map();   // key → { key, label, e, filas[] }
  const ex = (key, label, e, fila) => {
    let x = E.get(key); if (!x) { x = { key, label, e: 0, n: 0, filas: [] }; E.set(key, x); }
    x.e += e; x.n++; x.filas.push({ e, ...fila });
  };
  const INFO = new Map();   // neutros informativos (para auditar la clasificación)
  const info = (key, monto, fila) => { let x = INFO.get(key); if (!x) { x = { key, monto: 0, n: 0, filas: [] }; INFO.set(key, x); } x.monto += monto; x.n++; x.filas.push(fila); };
  const fRow = (r, extra = {}) => ({ fecha: r.fecha, tipo: r._tipo || r.subtipo || "comp", cuenta: r.cuenta_contable, contraparte: r.contraparte_nombre || r.proveedor || r.cliente || "", monto: r.total, sociedad: r.sociedad, centro: r.centro_costo, ...extra });
  const fMov = (mv, extra = {}) => ({ id: mv.id, fecha: mv.fecha, tipo: mv.tipo, origen: mv.origen, cuenta: mv.cuenta_contable, contraparte: mv.contraparte_nombre, monto: toNum(mv.monto), sociedad: mv.sociedad, centro: mv.centro_costo, cta_banc: mv.cuenta_bancaria, doc: mv.documento_id, ref: mv.referencia, concepto: mv.concepto, ...extra });

  // U2 — filas P&L del perímetro
  let memoInversores = 0;
  for (const { row, ladoIngreso, val, perim } of filasPnL) {
    const socRow = normSoc(row.sociedad), propia = S.has(socRow);
    if (lc(row.cuenta_contable) === "inversores") memoInversores += val;
    if (row._tipo === "Sueldo") {
      if (propia) info("pnl_sueldo_propio", val, fRow(row, { bucket: row.bucket }));
      else if (aplicaInterco1(socRow, perim)) info("pnl_sueldo_otra_soc_interco6", val, fRow(row, { bucket: row.bucket }));   // devengado → interco por devengado (fuente 6)
      else ex("E2d_sueldo_otra_soc_sin_interco", "P&L: sueldo devengado en el perímetro a cargo de OTRA sociedad SIN interco (núcleo↔núcleo)", -val, fRow(row, { bucket: row.bucket }));
      continue;
    }
    if (row._tipo === "Gasto" || row._tipo === "Ingreso") {   // movimiento CONTAB
      if (propia) info("pnl_contab_propio", val, fRow(row));
      else if (row._tipo === "Gasto" && aplicaInterco1(socRow, perim)) info("pnl_contab_otra_soc_interco1b", val, fRow(row));
      else ex("E2c_contab_otra_soc_sin_interco", "P&L: movimiento contabilizado por OTRA sociedad al perímetro sin posición interco", -val, fRow(row));
      continue;
    }
    if (row._tipo === "Financiación") { ex("E9a_financiacion", "P&L: devengado de financiación (interés/IVA por vto; capital plan) — revisar contra pasivo", -val, fRow(row)); continue; }
    if (row._tipo === "Retención" || row._tipo === "Interuso gestión") { if (propia) info(`pnl_${row._tipo}`, val, fRow(row)); else ex("E2x_otro_tipo_otra_soc", `P&L: ${row._tipo} de OTRA sociedad en el perímetro`, -val, fRow(row)); continue; }
    if (row._historico) continue;
    // comprobante
    const st = String(row.subtipo || "").toUpperCase();
    if (propia) {
      if (st === "GASTO") ex("E7b_comp_gasto_sin_cxp", "P&L: comprobante subtipo GASTO (entra al P&L, NO a CxP)", -val, fRow(row));
      else info("pnl_comp_propio", val, fRow(row));
    } else if (st === "INGRESO" || ladoIngreso) {
      ex("E2c_ingreso_otra_soc", "P&L: INGRESO booked por OTRA sociedad imputado al perímetro (sin interco)", -val, fRow(row));
    } else if (aplicaInterco1(socRow, perim)) {
      info("pnl_comp_otra_soc_interco1a", val, fRow(row));
    } else {
      ex("E2a_comp_nucleo_nucleo", "P&L: comprobante núcleo↔núcleo al perímetro sin interco", -val, fRow(row));
    }
  }

  // U1 — movimientos de caja de S (por cuenta bancaria de la sociedad, en la moneda)
  const ctasS = new Map((data.cuentasBancarias || []).filter(c => S.has(lc(c.sociedad)) && (c.moneda || "ARS") === moneda).map(c => [String(c.id), c]));
  const movs = (data.movimientos || []);
  const U1 = movs.filter(mv => ctasS.has(String(mv.cuenta_bancaria)) && enMes(mv.fecha));
  const compById = new Map([...(data.egresos || []), ...(data.ingresos || [])].map(c => [String(c.id), c]));
  const grpTrf = new Map();
  for (const mv of U1) if (mv.tipo === "TRANSFERENCIA" || mv.tipo === "PAGO_TARJETA") { const k = mv.documento_id || mv.id; grpTrf.set(k, (grpTrf.get(k) || 0) + toNum(mv.monto)); }
  const trfVisto = new Set();
  for (const mv of U1) {
    const monto = toNum(mv.monto), doc = String(mv.documento_id || ""), tipo = String(mv.tipo || "").toUpperCase();
    if (tipo === "SALDO_INICIAL") { ex("E1a_saldo_inicial_en_mes", "Caja: SALDO_INICIAL fechado dentro del mes (debería ser 30/6)", monto, fMov(mv)); continue; }
    if (tipo === "CAMBIO" || mv.origen === "cambio") { info("mov_cambio", monto, fMov(mv)); continue; }
    if (tipo === "TRANSFERENCIA" || tipo === "PAGO_TARJETA") {
      const k = mv.documento_id || mv.id; if (trfVisto.has(k)) continue; trfVisto.add(k);
      const neto = grpTrf.get(k) || 0;
      if (Math.abs(neto) > 0.5) ex("E1b_transferencia_pata_fuera", "Caja: transferencia con una pata fuera del perímetro/moneda", neto, fMov(mv, { neto }));
      else info("mov_transferencia_ok", 0, fMov(mv));
      continue;
    }
    if (mv.origen === "interco_park") { info("mov_interco_park", monto, fMov(mv)); continue; }
    if (tipo === "INTERCOMPANIA" || mv.origen === "intercompania") {
      const par = movs.find(o => o !== mv && String(o.tipo).toUpperCase() === "INTERCOMPANIA" && (o.documento_id || o.id) === (mv.documento_id || mv.id));
      if (par) info("mov_interco_par_ok", monto, fMov(mv)); else ex("E1c_interco_sin_par", "Caja: INTERCOMPANIA de una sola pata", monto, fMov(mv));
      continue;
    }
    if (mv.origen === "interco_park") { info("mov_interco_park", monto, fMov(mv)); continue; }
    if (mv.origen === "interco_recibida" || mv.origen === "interco_enviada") { ex("E10_interco_recibida_enviada", "Caja: interco recibida/enviada (posición la crea la contraparte; revisar mes del park)", monto, fMov(mv)); continue; }
    if (mv.origen === "sueldos" && tipo === "SUELDO") { info("mov_sueldo_pagado", monto, fMov(mv, { legajo: mv.legajo_nombre })); continue; }
    if (doc.startsWith("CONTAB-")) {
      if (!String(mv.cuenta_contable || "").trim()) { ex("E8a_contab_sin_cuenta", "Caja: CONTAB sin cuenta contable (no entra al P&L)", monto, fMov(mv)); continue; }
      const perim = empresaDe(mv.centro_costo) || lc(mv.sociedad);
      if (!S.has(perim)) {
        if (tipo !== "INGRESO" && tipo !== "COBRO" && aplicaInterco1(mv.sociedad, perim)) info("mov_contab_centro_ajeno_interco1b", monto, fMov(mv));
        else ex("E2b_contab_centro_ajeno_sin_interco", "Caja: CONTAB imputado a centro de otra empresa SIN interco", monto, fMov(mv));
        continue;
      }
      info("mov_contab_ok", monto, fMov(mv)); continue;
    }
    if (mv.origen === "financiacion_alta") { info("mov_financiacion_alta", monto, fMov(mv)); continue; }
    if (mv.origen === "cuota" || /^FIN-/.test(doc)) {
      // documento_id "FIN-<plan>#<n>" (a veces "FIN-FIN-…"): buscar la cuota para separar capital (neutro) de interés/IVA/imp.
      const mm = doc.replace(/^FIN-FIN-/, "FIN-").match(/^(.*)#(\d+)$/);
      const plan = mm && (data.financiaciones || []).find(f => [f.id, f.plan_id, f.nro_plan].map(String).includes(mm[1]));
      const cuota = plan && (plan.cuotas || []).find(c => Number(c.nro_cuota) === Number(mm[2]));
      const tot = cuota ? (toNum(cuota.total) || toNum(cuota.capital)) : 0;
      const fracNoCap = cuota && tot > 0 ? Math.max(0, 1 - (toNum(cuota.capital) || 0) / tot) : 0;
      if (!cuota) ex("E9b_pago_cuota_sin_plan", "Caja: pago de cuota cuyo plan/cuota no se encontró", monto, fMov(mv));
      else if (fracNoCap > 0.0001) ex("E9b_pago_cuota_no_capital", "Caja: parte no-capital de la cuota (interés/IVA/imp. devengan al vto en P&L)", monto * fracNoCap, fMov(mv, { fracNoCap }));
      else info("mov_cuota_capital", monto, fMov(mv));
      continue;
    }
    if (mv.origen === "anticipo_alta" || mv.origen === "anticipo_consumo") { info("mov_anticipo", monto, fMov(mv)); continue; }
    if (mv.origen === "socios") { info("mov_socios", monto, fMov(mv, { socio_tipo: mv.socio_tipo })); continue; }
    if (mv.origen === "franquicias" && ["nako","biggfit","wellness"].some(x => S.has(x))) { info("mov_cobro_franquicia", monto, fMov(mv)); continue; }
    if (mv.origen === "franquicias") { ex("E1d_cobro_franquicia", "Caja: cobro de franquicia (S sin mapeo de empresa emisora → CxC no en su balance)", monto, fMov(mv)); continue; }
    if (tipo === "PAGO" || tipo === "COBRO" || (tipo === "EGRESO_GASTO" && doc)) {
      if (!doc) { ex("E1g_sin_imputar", "Caja: movimiento sin imputar (sin documento)", monto, fMov(mv)); continue; }
      const comp = compById.get(doc);
      if (!comp) { ex("E1e_pago_huerfano", "Caja: pago/cobro cuyo documento no existe como comprobante EGRESO/INGRESO", monto, fMov(mv)); continue; }
      if (!S.has(lc(comp.sociedad))) { ex("E1f_pago_comp_otra_soc", "Caja: pago/cobro de comprobante de OTRA sociedad", monto, fMov(mv, { comp_soc: comp.sociedad })); continue; }
      // 18/9: derivarSaldos lleva el pago a comprobante posterior al activo "Pagos a cuenta" (y el sobrepago también) → neutro.
      if (String(comp.fecha || "") > fin) { info("mov_pago_a_cuenta_comp_posterior", monto, fMov(mv, { comp_fecha: comp.fecha })); continue; }
      info(tipo === "COBRO" ? "mov_cobro_ok" : "mov_pago_ok", monto, fMov(mv)); continue;
    }
    if (tipo === "EGRESO" || tipo === "INGRESO" || tipo === "EGRESO_GASTO") { ex("E1g_sin_imputar", "Caja: movimiento sin imputar (extracto pendiente / manual sin CONTAB)", monto, fMov(mv)); continue; }
    ex("E1h_otro", `Caja: otro (${tipo}/${mv.origen})`, monto, fMov(mv));
  }

  // U3 — comprobantes de S fuera del perímetro P&L (centro de otra empresa) + subtipos raros (raw)
  for (const comp of [...(data.egresos || []), ...(data.ingresos || [])]) {
    if (!S.has(lc(comp.sociedad)) || !enMes(comp.fecha) || (comp.moneda || "ARS") !== moneda) continue;
    for (const l of (comp.lineas || [])) {
      const emp = empresaDe(l.cc); if (!emp || S.has(emp)) continue;
      const t = toNum(l.total_linea);
      const st = String(comp.subtipo || "").toUpperCase();
      const fila = { fecha: comp.fecha, tipo: st, cuenta: l.cuenta, contraparte: comp.proveedor || comp.cliente || "", monto: t, sociedad: comp.sociedad, centro: l.cc, empresa_centro: emp, id_comp: comp.id };
      if (st === "INGRESO") ex("E6b_venta_S_centro_ajeno", "Balance: venta de S imputada a centro de otra empresa (CxC sin P&L propio)", +t, fila);
      else if (aplicaInterco1(comp.sociedad, emp)) info("comp_S_centro_ajeno_interco1a", t, fila);
      else ex("E6a_gasto_S_centro_ajeno_sin_interco", "Balance: gasto de S a centro de otra empresa núcleo↔núcleo (CxP sin P&L propio)", -t, fila);
    }
  }
  const diag = { subtipoRaro: [], saldoInicialPost: [], fechaNoIso: [] };
  for (const r of (intercoData?.comps || [])) if (S.has(lc(r.sociedad))) {
    const st = String(r.subtipo || "").toUpperCase();
    if (!["EGRESO", "INGRESO", "EGRESO_BORRADOR"].includes(st)) diag.subtipoRaro.push({ id: r.id, id_comp: r.id_comp, fecha: r.fecha, subtipo: r.subtipo, cuenta: r.cuenta_contable, total: toNum(r.total), centro: r.centro_costo });
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(r.fecha || ""))) diag.fechaNoIso.push({ id: r.id, fecha: r.fecha });
  }
  for (const mv of movs) if (ctasS.has(String(mv.cuenta_bancaria))) {
    if (String(mv.tipo).toUpperCase() === "SALDO_INICIAL" && String(mv.fecha) > "2026-06-30") diag.saldoInicialPost.push(fMov(mv));
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(mv.fecha || ""))) diag.fechaNoIso.push(fMov(mv));
  }

  // U4 — flujos interco del mes (ledger por par), desde la óptica de S
  const ledgerMes = [];
  let sumLedger = 0;
  for (const s of socsIncl) for (const c of (sociedades || [])) {
    if (lc(c.id) === lc(s.id) || S.has(lc(c.id))) continue;
    if (!intercoData) break;
    const led = intercoLedger(intercoData, { sociedad: s.id, contraparte: c.id, moneda });
    for (const e of led.entries) if (enMes(e.fecha)) { ledgerMes.push({ contraparte: c.nombre || c.id, ...e }); sumLedger += e.delta; }
  }
  for (const e of ledgerMes) {
    const fila = { fecha: e.fecha, tipo: e.tipo, contraparte: e.contraparte, detalle: `${e.prov || ""} ${e.cuenta || ""} ${e.centro || ""} ${e.cuentaDest || ""}`.trim(), monto: e.delta, ref: e.ref };
    if (e.tipo === "Sueldo") info("interco_Sueldo", e.delta, fila);   // devengado (neutro con la fila P&L) o pago por cuenta ajena (neutro con la caja)
    else info(`interco_${e.tipo}`, e.delta, fila);
  }
  const dInterco = (bFin.icA - bFin.icP) - (bAnt.icA - bAnt.icP);

  // Tarjetas con saldo POSITIVO al corte: derivarSaldos las saca de bancos (tipo tarjeta) y solo lleva al pasivo el saldo NEGATIVO → un saldo a favor desaparece del PN.
  for (const c of bFin.aPagar.length >= 0 ? (data.cuentasBancarias || []) : []) {
    if (!S.has(lc(c.sociedad)) || (c.moneda || "ARS") !== moneda || String(c.tipo || "").toLowerCase() !== "tarjeta") continue;
    const saldoAt = corte => movs.filter(mv => mv.cuenta_bancaria === c.id && String(mv.fecha ?? "") <= corte).reduce((s2, mv) => s2 + toNum(mv.monto), 0);
    const posAnt = Math.max(0, saldoAt(ant)), posFin = Math.max(0, saldoAt(fin));
    if (Math.abs(posFin - posAnt) > 0.005) ex("E11_tarjeta_saldo_positivo", "Balance: tarjeta con saldo A FAVOR (positivo) queda fuera del PN (ni banco ni deuda)", -(posFin - posAnt), { cuenta: c.nombre, id: c.id, saldoAnt: posAnt, saldoFin: posFin });
  }

  // Financiaciones de APERTURA fechadas después del go-live: entran al pasivo en ese mes sin caja ni P&L (un saldo
  // inicial SOLO va al 30/6; cargado después siempre da diferencia). Mismo patrón que el SALDO_INICIAL post go-live.
  for (const f of (data.financiaciones || [])) {
    if (!S.has(lc(f.sociedad)) || (f.moneda || "ARS") !== moneda || !f.es_apertura) continue;
    const fc = String(f.fecha_consolidacion || "");
    if (fc <= "2026-06-30" || !enMes(fc)) continue;
    const cap = (f.cuotas || []).reduce((s2, c) => s2 + (toNum(c.capital) || 0), 0);
    ex("E1a_fin_apertura_post_golive", "Balance: financiación de APERTURA fechada después del go-live (pasivo sin caja)", -cap, { id: f.id, acreedor: f.acreedor_nombre, fecha_consolidacion: fc, capital: cap, tipo: f.tipo });
  }

  // U5 — socios (no-cash) del mes
  for (const r of (data.sociosCC || [])) if (S.has(lc(r.sociedad)) && enMes(r.fecha) && (r.moneda || "ARS") === moneda)
    ex("E3a_socios_cc", "Balance: CC socios no-cash (dividendos declarados / aportes) — revisar signo", toNum(r.monto), { ...r });

  const explicadores = [...E.values()].sort((a, b) => Math.abs(b.e) - Math.abs(a.e));
  const explicado = sum(explicadores, x => x.e);
  return {
    filtro: { socIds: [...S], moneda, year, mes: m + 1, ant, fin, sinIva },
    resumen: { resultado, dPN, dCambio, gap, explicado, residual: gap - explicado, memoInversores, pnAnt: bAnt.pn, pnFin: bFin.pn,
      checkInterco: { dInterco, sumLedger, diff: dInterco - sumLedger } },
    explicadores, informativos: [...INFO.values()], rubros, diag, ledgerMes, filasPnL,
    balance: { antes: bAnt, despues: bFin }, devengado: dev,
  };
}

// Resumen legible para consola.
export function printPuente(p) {
  const f = n => Math.round(n).toLocaleString("es-AR");
  console.log(`PUENTE ${p.filtro.socIds.join("+")} ${p.filtro.moneda} mes ${p.filtro.mes} (${p.filtro.ant} → ${p.filtro.fin})`);
  console.table({ Resultado: f(p.resumen.resultado), dPN: f(p.resumen.dPN), dCambio: f(p.resumen.dCambio), Gap: f(p.resumen.gap), Explicado: f(p.resumen.explicado), Residual: f(p.resumen.residual), memoInversores: f(p.resumen.memoInversores) });
  console.table(p.explicadores.map(x => ({ key: x.key, e: f(x.e), n: x.n, label: x.label })));
  console.table(p.informativos.map(x => ({ key: x.key, monto: f(x.monto), n: x.n })));
  console.table(p.rubros.map(r => ({ rubro: r.rubro, antes: f(r.antes), despues: f(r.despues), delta: f(r.delta) })));
  console.log("checkInterco", p.resumen.checkInterco, "diag", p.diag);
}
