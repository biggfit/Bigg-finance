import { useState, useMemo, useEffect, useRef } from "react";
import { T, PageHeader } from "./theme";
import { fetchCentrosCosto, fetchMovTesoreria, fetchCuentasBancarias, fetchLineasEnriquecidas, fetchCuentas, esIgnorado, esCuentaCredito, fetchFinanciaciones, financiacionPasivoBuckets, agruparAnticipos, anticipoPasivo, fetchSocios, fetchSociosCC, sociosSaldos, fetchIntercoData, lecturaInterco } from "../lib/numbersApi";
import { fetchLiquidacionesCerradas, liquidacionToPnLRows, fetchPagosAnio, SALARY_BUCKETS, pagoTipoABucket, devengadoPorFormaYSociedad } from "../lib/sueldosApi";
import { MONEDA_SYM } from "../data/tesoreriaData";
import { fetchComps } from "../lib/sheetsApi";          // Franquicias (read-only)
import { franquiciasIngresoPnLRows } from "../lib/franquiciasAdapter";
import TabTesoreriaConsolidada from "./reportes/TabTesoreriaConsolidada";

const MESES    = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const CUR_YEAR = new Date().getFullYear();
const YEARS    = [CUR_YEAR - 2, CUR_YEAR - 1, CUR_YEAR];

function normCat(raw) {
  const s = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (s === "ventas")                                          return "ventas";
  if (s === "costo_venta"  || s.includes("costo")
   || s === "gasto_por_venta" || s === "gastos_por_venta")    return "costo_venta";
  if (s === "gastos_operativos" || s === "gasto_operativo"
   || s === "gastos_operativo")                               return "gastos_operativos";
  if (s === "gastos_financieros" || s === "gasto_financiero"
   || s === "financiero"   || s === "financieros")            return "gastos_financieros";
  if (s === "impuestos"    || s === "impuesto")               return "impuestos";
  if (s === "r_y_d"  || s === "r&d"  || s === "ryd")         return "r_y_d";
  if (s === "sales_marketing" || s.includes("sales"))         return "sales_marketing";
  if (s === "g_and_a" || s === "g&a" || s === "gna")         return "g_and_a";
  return s;
}

// ─── Pivot P&L estructurado ───────────────────────────────────────────────────
function buildPnL(inRows, egRows, cuentaMap, ccFilter, year, moneda) {
  const cats = { ventas:{}, costo_venta:{}, gastos_operativos:{}, gastos_financieros:{}, impuestos:{}, sin_categoria:{} };
  const add = (rows) => {
    for (const row of rows) {
      if (!row.fecha || row.fecha.slice(0,4) !== String(year)) continue;
      if ((row.moneda ?? "ARS") !== moneda) continue;
      if (ccFilter !== "todos") {
        const cc = row.centro_costo ?? "";
        if (Array.isArray(ccFilter) ? !ccFilter.includes(cc) : cc !== ccFilter) continue;
      }
      const m = parseInt(row.fecha.slice(5,7), 10) - 1;
      if (m < 0 || m > 11) continue;
      const nombre = (row.cuenta_contable ?? "").trim() || "Sin cuenta";
      const cat    = normCat(cuentaMap.get(nombre)?.categoria_pnl);
      const bucket = cats[cat] ?? cats.sin_categoria;
      if (!bucket[nombre]) bucket[nombre] = new Array(12).fill(0);
      bucket[nombre][m] += Number(row.total) || 0;
    }
  };
  add(inRows);
  add(egRows);
  for (const [nombre, cuenta] of cuentaMap) {
    const cat = normCat(cuenta.categoria_pnl);
    if (!cat) continue;
    const bucket = cats[cat] ?? cats.sin_categoria;
    if (!bucket[nombre]) bucket[nombre] = new Array(12).fill(0);
  }
  return cats;
}

// Adapter: nb_movimientos imputados que SON el hecho económico (gasto contado /
// conciliación contabilizada) → mismo formato que las filas de nb_comprobantes.
// Marcador único: documento_id empieza con "CONTAB-" (devengado-vía-movimiento).
// Si una fila se reimputa como pago de una FC, su documento_id pasa al id_comp y
// SALE del P&L automáticamente (el devengado lo aporta el comprobante de la FC).
// El SIGNO del movimiento importa (no |monto|): el aporte al P&L depende de si el movimiento va
// en la dirección natural de su cuenta o es una reversión.
//   · Cuenta de INGRESO (categoría "ventas"): crédito (+) suma / débito (−) resta → devolución neta.
//   · Cuenta de resultado NEGATIVO (costo/gasto/impuesto/financiero): débito (−) suma como costo /
//     crédito (+) resta (reintegro, ej. Intereses Ganados en "Financieros" → mejora el resultado).
//   · Retención sufrida: siempre costo (se guarda con monto +) → valor absoluto.
// Requiere cuentaMap (nombre→cuenta) para leer la categoría de la cuenta.
function movimientoToPnLRows(movs, sociedad, cuentaMap) {
  const soc = (sociedad ?? "").toLowerCase();
  const out = [];
  for (const m of (movs ?? [])) {
    if (soc && (m.sociedad ?? "").toLowerCase() !== soc) continue;
    const nombre = (m.cuenta_contable ?? "").trim();
    if (!nombre) continue;
    // Entra al P&L: gasto/ingreso contado-conciliado (CONTAB-) o retención sufrida. La retención
    // lleva documento_id de la factura (netea la CxC), por eso se la reconoce por origen.
    if (!String(m.documento_id ?? "").startsWith("CONTAB-") && m.origen !== "retencion") continue;
    const monto = Number(m.monto) || 0;
    let total;
    if (m.origen === "retencion") {
      total = Math.abs(monto);
    } else {
      const esIngreso = normCat(cuentaMap?.get(nombre)?.categoria_pnl) === "ventas";
      total = esIngreso ? monto : -monto;
    }
    out.push({
      fecha:           m.fecha,
      sociedad:        m.sociedad,
      centro_costo:    m.centro_costo ?? "",
      cuenta_contable: m.cuenta_contable ?? "",
      moneda:          m.moneda ?? "ARS",
      total,
    });
  }
  return out;
}

// Adapter: financiaciones (planes AFIP + créditos) → filas P&L. Dos reconocimientos en
// distinta línea de tiempo (sin partida doble; la caja vive aparte en nb_movimientos):
//   · Capital del plan AFIP = el impuesto → 1 fila en el mes de consolidación (salvo apertura,
//     que ya está en Contagram). El capital de un préstamo NO entra (es deuda, no gasto).
//   · Interés financiero + IVA + sellos de cada cuota → en el mes de su VENCIMIENTO (devengo
//     mes a mes, pagada o no). El resarcitorio solo si se pagó tardío (fecha_pago > vto).
function financiacionToPnLRows(planes, sociedad) {
  const soc = (sociedad ?? "").toLowerCase();
  const out = [];
  for (const p of (planes ?? [])) {
    if (soc && (p.sociedad ?? "").toLowerCase() !== soc) continue;
    if (p.tipo === "plan_afip" && !p.es_apertura && p.cuenta_capital) {
      const capTot = (p.cuotas ?? []).reduce((s, c) => s + (Number(c.capital) || 0), 0);
      if (capTot > 0) out.push({ fecha: p.fecha_consolidacion, sociedad: p.sociedad, centro_costo: p.centro_capital, cuenta_contable: p.cuenta_capital, moneda: p.moneda, total: capTot });
    }
    const base = { sociedad: p.sociedad, moneda: p.moneda };
    const push = (cuenta, centro, total, fecha) => { if (total > 0 && cuenta) out.push({ ...base, fecha, centro_costo: centro, cuenta_contable: cuenta, total }); };
    for (const c of (p.cuotas ?? [])) {
      if (c.estado === "cancelada") continue;
      push(p.cuenta_interes,   p.centro_interes,   c.interes,   c.vto);
      push(p.cuenta_iva,       p.centro_iva,       c.iva,       c.vto);
      push(p.cuenta_impuestos, p.centro_impuestos, c.impuestos, c.vto);
      if (c.estado === "pagada" && c.fecha_pago && c.fecha_pago > c.vto)
        push(p.cuenta_interes, p.centro_interes, c.interes_resarc, c.fecha_pago);   // resarcitorio (pago tardío)
    }
  }
  return out;
}

const sumCat = (catObj) =>
  MESES.map((_, m) => Object.values(catObj).reduce((s, arr) => s + (arr[m] || 0), 0));

function computeSubtotals(pnl) {
  const ventasTot   = sumCat(pnl.ventas);
  const costoTot    = sumCat(pnl.costo_venta);
  const opexTot     = sumCat(pnl.gastos_operativos);
  const finTot      = sumCat(pnl.gastos_financieros);
  const impTot      = sumCat(pnl.impuestos);
  const margenBruto = MESES.map((_,m) => ventasTot[m]  - costoTot[m]);
  const resOp       = MESES.map((_,m) => margenBruto[m] - opexTot[m]);
  const resAntesImp = MESES.map((_,m) => resOp[m]       - finTot[m]);
  const resNeto     = MESES.map((_,m) => resAntesImp[m] - impTot[m]);
  const months = new Set();
  Object.values(pnl).forEach(cat =>
    Object.values(cat).forEach(arr => arr.forEach((v,i) => { if (v) months.add(i); }))
  );
  const curMonth = new Date().getMonth();
  for (let i = 0; i <= curMonth; i++) months.add(i);
  return { ventasTot, costoTot, opexTot, finTot, impTot,
           margenBruto, resOp, resAntesImp, resNeto,
           activeMonths: [...months].sort((a,b) => a-b) };
}

const rowSum = arr => arr.reduce((s, v) => s + v, 0);
const fmtN   = n => !n ? "—" : Math.round(Math.abs(n)).toLocaleString("es-AR");

// ─── Estilos base ─────────────────────────────────────────────────────────────
const CTRL_H = 36;

const selStyle = {
  background: "#eceff3", border: `1px solid ${T.cardBorder}`,
  borderRadius: 8, padding: "0 12px", fontSize: 13, color: T.text,
  fontFamily: T.font, outline: "none", cursor: "pointer", height: CTRL_H,
  lineHeight: `${CTRL_H}px`,
};

const thStyle = {
  padding: "9px 12px", fontSize: 10, fontWeight: 800, color: T.tableHeadText,
  textTransform: "uppercase", letterSpacing: ".08em", textAlign: "right",
  whiteSpace: "nowrap", background: T.tableHead, position: "sticky", top: 0, zIndex: 3,
};

const stickyCol = {
  position: "sticky", left: 0, zIndex: 2, background: "inherit",
  boxShadow: "2px 0 4px rgba(0,0,0,.04)",
};

// ─── Spinner ──────────────────────────────────────────────────────────────────
const spinnerKeyframes = `@keyframes rpt-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`;

function Spinner({ size = 32, color = T.accentDark }) {
  return (
    <>
      <style>{spinnerKeyframes}</style>
      <div style={{
        width: size, height: size, border: `3px solid ${T.cardBorder}`,
        borderTopColor: color, borderRadius: "50%",
        animation: "rpt-spin .7s linear infinite",
      }} />
    </>
  );
}

// ─── Row components ───────────────────────────────────────────────────────────
function SectionRow({ label, span, values, activeMonths, expanded, onToggle }) {
  const clickable = !!onToggle;
  return (
    <tr style={{ background: T.accentDark, cursor: clickable ? "pointer" : "default" }}
      onClick={onToggle}>
      <td style={{ padding: "8px 16px", fontSize: 11, fontWeight: 800,
        color: T.accent, letterSpacing: ".1em", textTransform: "uppercase", userSelect: "none",
        ...stickyCol, background: T.accentDark }}>
        {clickable && <span style={{ marginRight: 6, fontSize: 9, opacity: .6 }}>{expanded ? "▼" : "▶"}</span>}
        {label}
      </td>
      {values && activeMonths.map(m => (
        <td key={m} style={{ padding: "8px 12px", fontSize: 11, textAlign: "right",
          fontFamily: "var(--mono)", fontWeight: 800, color: T.accent, whiteSpace: "nowrap" }}>
          {values[m] ? fmtN(values[m]) : ""}
        </td>
      ))}
      {values && (
        <td style={{ padding: "8px 14px", fontSize: 11, textAlign: "right", fontFamily: "var(--mono)",
          fontWeight: 900, color: T.accent, whiteSpace: "nowrap",
          borderLeft: "1px solid rgba(255,255,255,.12)" }}>
          {rowSum(values) ? fmtN(rowSum(values)) : ""}
        </td>
      )}
      {!values && <td colSpan={span - 1} />}
    </tr>
  );
}

function DataRow({ label, values, activeMonths, color }) {
  const total = rowSum(values);
  return (
    <tr style={{ borderBottom: `1px solid ${T.cardBorder}`, background: T.card }}
      onMouseEnter={e => { e.currentTarget.style.background = "#f0f9ff"; e.currentTarget.firstChild.style.background = "#f0f9ff"; }}
      onMouseLeave={e => { e.currentTarget.style.background = T.card; e.currentTarget.firstChild.style.background = T.card; }}>
      {/* fondo explícito (no "inherit"): evita que la celda sticky no repinte y "aparezca" al hover */}
      <td style={{ padding: "7px 16px 7px 44px", fontSize: 13, color: T.text, whiteSpace: "nowrap",
        ...stickyCol, background: T.card }}>{label}</td>
      {activeMonths.map(m => (
        <td key={m} style={{ padding: "7px 12px", fontSize: 13, textAlign: "right",
          fontFamily: "var(--mono)", color: values[m] ? (color ?? T.text) : T.dim,
          whiteSpace: "nowrap" }}>
          {values[m] ? fmtN(values[m]) : "—"}
        </td>
      ))}
      <td style={{ padding: "7px 14px", fontSize: 13, textAlign: "right", fontFamily: "var(--mono)",
        fontWeight: 800, color: color ?? T.text, whiteSpace: "nowrap",
        borderLeft: `1px solid ${T.cardBorder}` }}>
        {fmtN(total)}
      </td>
    </tr>
  );
}

function SubtotalRow({ label, values, activeMonths, color, strong }) {
  const total = rowSum(values);
  const bg = strong ? "#cbd5e1" : "#f3f4f6";
  return (
    <tr style={{ background: bg, borderTop: `${strong ? 3 : 2}px solid ${color ?? T.cardBorder}`, borderBottom: `2px solid ${T.cardBorder}` }}>
      <td style={{ padding: "12px 16px", fontSize: strong ? 15 : 14, fontWeight: 900,
        color: color ?? T.text, letterSpacing: ".02em",
        ...stickyCol, background: bg }}>{label}</td>
      {activeMonths.map(m => (
        <td key={m} style={{ padding: "12px 12px", fontSize: 14, textAlign: "right",
          fontFamily: "var(--mono)", fontWeight: 900, color: color ?? T.text,
          whiteSpace: "nowrap" }}>
          {values[m] ? fmtN(values[m]) : "—"}
        </td>
      ))}
      <td style={{ padding: "12px 14px", fontSize: 15, textAlign: "right", fontFamily: "var(--mono)",
        fontWeight: 900, color: color ?? T.text, whiteSpace: "nowrap",
        borderLeft: `1px solid ${T.cardBorder}` }}>
        {fmtN(total)}
      </td>
    </tr>
  );
}

function ResultadoRow({ label, values, activeMonths, strong }) {
  const total = rowSum(values);
  const color = total >= 0 ? T.green : T.red;
  const bg = strong ? (total >= 0 ? "#bbf7d0" : "#fecaca") : (total >= 0 ? "#f0fdf4" : "#fff1f2");
  return (
    <tr style={{ background: bg,
      borderTop: `${strong ? 3 : 2}px solid ${total >= 0 ? T.green : T.red}`,
      borderBottom: strong ? `2px solid ${total >= 0 ? T.green : T.red}` : "none" }}>
      <td style={{ padding: "12px 16px", fontSize: strong ? 15 : 14, fontWeight: 900,
        color, letterSpacing: ".02em",
        ...stickyCol, background: bg }}>{label}</td>
      {activeMonths.map(m => (
        <td key={m} style={{ padding: "12px 12px", fontSize: 14, textAlign: "right",
          fontFamily: "var(--mono)", fontWeight: 900,
          color: values[m] > 0 ? T.green : values[m] < 0 ? T.red : T.dim,
          whiteSpace: "nowrap" }}>
          {values[m] !== 0 ? fmtN(values[m]) : "—"}
        </td>
      ))}
      <td style={{ padding: "12px 14px", fontSize: 15, textAlign: "right", fontFamily: "var(--mono)",
        fontWeight: 900, color, whiteSpace: "nowrap",
        borderLeft: `1px solid ${T.cardBorder}` }}>
        {fmtN(total)}
      </td>
    </tr>
  );
}

// ─── P&L SEDES: estructura fija (waterfall estable) + mapeo cuenta→línea (curado) ──
// El "qué cuenta va en cada línea" vive acá a propósito: es el P&L de management de la sede,
// curado. Cuentas fuera de este mapeo con movimientos → bloque "Sin clasificar" al pie
// (control de fugas: líneas mapeadas + sin clasificar = todo, nada se esconde).
// Paleta sobria: los subgrupos van todos en gris pizarra neutro; el color con significado
// (verde/rojo) se reserva para las líneas de resultado. Las bandas de sección aportan la estructura.
const SEDE_HDR = "#475569";   // slate — encabezados de subgrupo y montos de cuenta
const SEDE_GRUPOS = [
  { key: "vta_cf",    label: "Ventas consumidor final",  color: SEDE_HDR, cuentas: ["Ventas Mercado Pago", "Depositos", "Ventas en Efectivo", "Otros Ingresos"] },
  { key: "int_bigg",  label: "Interusos red BIGG",       color: SEDE_HDR, cuentas: ["Interusos"] },
  { key: "int_corp",  label: "Interusos corporativos",   color: SEDE_HDR, cuentas: ["Coorporativos"] },
  { key: "cvar",      label: "Costos Variables",         color: SEDE_HDR, cuentas: ["Fee Facturación", "Aranceles y Otros Financieros", "IIBB", "Imp. Cred. y Deb."] },
  { key: "gp_pers",   label: "Personal",                 color: SEDE_HDR, cuentas: ["Sueldos", "Comisiones", "Aguinaldos", "Costos Salariales"] },
  { key: "gp_ocup",   label: "Ocupación",                color: SEDE_HDR, cuentas: ["Alquiler", "Expensas y ABL", "Servicios"] },
  { key: "gp_mkt",    label: "Mkt y Pauta",              color: SEDE_HDR, cuentas: ["Acciones de Mkt"] },
  { key: "gp_otros",  label: "Otros Gastos de la Sede",  color: SEDE_HDR, cuentas: ["Honorarios Profesionales", "Equipamiento y Mantenimiento", "Limpieza", "Otros Gastos del Centro"] },
  { key: "com_res",   label: "Comisión por resultados",  color: SEDE_HDR, cuentas: ["Comision S/Resultado"] },
  { key: "inv_no_op", label: "Inversiones no operativas", color: SEDE_HDR, cuentas: ["Inversiones / Gastos no Operativos"] },
];
const _nkSede = s => (s ?? "").trim().toLowerCase();
const SEDE_CUENTA_A_GRUPO = (() => {
  const m = new Map();
  for (const g of SEDE_GRUPOS) for (const c of g.cuentas) m.set(_nkSede(c), g.key);
  return m;
})();
const grupoSede = (key) => SEDE_GRUPOS.find(g => g.key === key);

function buildPnLSede(inRows, egRows, ccFilter, year, moneda) {
  // Pre-poblar cada grupo con sus cuentas configuradas en 0 → se muestran aunque no tengan monto.
  const grupos = {};
  for (const g of SEDE_GRUPOS) { grupos[g.key] = {}; for (const c of g.cuentas) grupos[g.key][c] = new Array(12).fill(0); }
  const sinClasificar = {};
  const add = (rows) => {
    for (const row of rows) {
      if (!row.fecha || row.fecha.slice(0,4) !== String(year)) continue;
      if ((row.moneda ?? "ARS") !== moneda) continue;
      if (ccFilter !== "todos") {
        const cc = row.centro_costo ?? "";
        if (Array.isArray(ccFilter) ? !ccFilter.includes(cc) : cc !== ccFilter) continue;
      }
      const m = parseInt(row.fecha.slice(5,7), 10) - 1;
      if (m < 0 || m > 11) continue;
      const nombre = (row.cuenta_contable ?? "").trim() || "Sin cuenta";
      const gkey   = SEDE_CUENTA_A_GRUPO.get(_nkSede(nombre));
      const bucket = gkey ? grupos[gkey] : sinClasificar;
      if (!bucket[nombre]) bucket[nombre] = new Array(12).fill(0);
      bucket[nombre][m] += Number(row.total) || 0;
    }
  };
  add(inRows); add(egRows);
  return { grupos, sinClasificar };
}

const sumGrupoSede = (g) => MESES.map((_, m) => Object.values(g).reduce((s, arr) => s + (arr[m] || 0), 0));

function computeSubtotalsSede(pnl) {
  const { grupos, sinClasificar } = pnl;
  const st = {};
  for (const g of SEDE_GRUPOS) st[g.key] = sumGrupoSede(grupos[g.key]);
  const totIngresos   = MESES.map((_, m) => st.vta_cf[m] + st.int_bigg[m] + st.int_corp[m]);
  const margenContrib = MESES.map((_, m) => totIngresos[m] - st.cvar[m]);
  const totGastosOp   = MESES.map((_, m) => st.gp_pers[m] + st.gp_ocup[m] + st.gp_mkt[m] + st.gp_otros[m]);
  const resOp         = MESES.map((_, m) => margenContrib[m] - totGastosOp[m]);
  const resFinal      = MESES.map((_, m) => resOp[m] - st.com_res[m] - st.inv_no_op[m]);
  const months = new Set();
  const curMonth = new Date().getMonth();
  for (let i = 0; i <= curMonth; i++) months.add(i);
  const scan = (obj) => Object.values(obj).forEach(arr => arr.forEach((v,i) => { if (v) months.add(i); }));
  Object.values(grupos).forEach(scan); scan(sinClasificar);
  return { st, totIngresos, margenContrib, totGastosOp, resOp, resFinal,
           activeMonths: [...months].sort((a,b) => a-b) };
}

// Banda de sección (INGRESOS / GASTOS OPERATIVOS): colapsa la sección entera. La etiqueta va en
// una celda sticky (queda fija al scroll horizontal) + relleno oscuro para el resto de columnas.
function BandaRow({ label, span, expanded, onToggle }) {
  return (
    <tr style={{ background: T.tableHead, cursor: onToggle ? "pointer" : "default" }} onClick={onToggle}>
      <td style={{ padding: "6px 16px", fontSize: 10, fontWeight: 800,
        color: T.tableHeadText, letterSpacing: ".12em", textTransform: "uppercase",
        userSelect: "none", ...stickyCol, background: T.tableHead }}>
        {onToggle && <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{expanded ? "▼" : "▶"}</span>}
        {label}
      </td>
      <td colSpan={span - 1} style={{ background: T.tableHead }} />
    </tr>
  );
}

function PnLTableSede({ pnl, sub, year, moneda, label }) {
  const { totIngresos, margenContrib, totGastosOp, resOp, resFinal, activeMonths } = sub;
  const ncols = activeMonths.length + 2;

  // Colapso jerárquico: bandas de sección (Ingresos / Gastos Op) + cada sub-grupo + toggle maestro.
  const ALLKEYS = ["sec_ing", "sec_gop", ...SEDE_GRUPOS.map(g => g.key)];
  const [collapsed, setCollapsed] = useState({});
  const isCol  = k => !!collapsed[k];
  const toggle = k => setCollapsed(c => ({ ...c, [k]: !c[k] }));
  const allCol = ALLKEYS.every(k => collapsed[k]);
  const toggleAll = () => setCollapsed(allCol ? {} : Object.fromEntries(ALLKEYS.map(k => [k, true])));

  const grp = (key) => <PnlSection sub label={grupoSede(key).label} accounts={pnl.grupos[key]}
    order={grupoSede(key).cuentas} color={grupoSede(key).color} activeMonths={activeMonths} ncols={ncols}
    expanded={!isCol(key)} onToggle={() => toggle(key)} />;
  const sinCls = Object.keys(pnl.sinClasificar).length > 0;

  if (activeMonths.length === 0) return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      padding: "60px 24px", textAlign: "center", boxShadow: T.shadow }}>
      <div style={{ fontSize: 14, color: T.muted }}>Sin datos para {year} en {moneda}{label ? ` · ${label}` : ""}.</div>
    </div>
  );

  return (
    <>
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      boxShadow: T.shadow, overflowX: "auto", position: "relative" }}>
      <table style={{ width: "100%", minWidth: 180 + activeMonths.length * 110, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th onClick={toggleAll} title="Contraer / expandir todo"
              style={{ ...thStyle, textAlign: "left", width: 1, whiteSpace: "nowrap", cursor: "pointer",
                userSelect: "none", ...stickyCol, background: T.tableHead, zIndex: 4 }}>
              <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{allCol ? "▶" : "▼"}</span>Cuenta
            </th>
            {activeMonths.map(m => <th key={m} style={thStyle}>{MESES[m]}</th>)}
            <th style={{ ...thStyle, borderLeft: "1px solid rgba(255,255,255,.12)" }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          <BandaRow label="Ingresos" span={ncols} expanded={!isCol("sec_ing")} onToggle={() => toggle("sec_ing")} />
          {!isCol("sec_ing") && <>
            {grp("vta_cf")}
            {grp("int_bigg")}
            {grp("int_corp")}
          </>}
          <SubtotalRow strong label="Total Ingresos" values={totIngresos} activeMonths={activeMonths} color={SEDE_HDR} />

          {grp("cvar")}
          <ResultadoRow strong label="Margen de Contribución" values={margenContrib} activeMonths={activeMonths} />

          <BandaRow label="Gastos Operativos" span={ncols} expanded={!isCol("sec_gop")} onToggle={() => toggle("sec_gop")} />
          {!isCol("sec_gop") && <>
            {grp("gp_pers")}
            {grp("gp_ocup")}
            {grp("gp_mkt")}
            {grp("gp_otros")}
          </>}
          <SubtotalRow label="Total Gastos Operativos" values={totGastosOp} activeMonths={activeMonths} color={SEDE_HDR} />
          <ResultadoRow strong label="Resultado Operativo" values={resOp} activeMonths={activeMonths} />

          {grp("com_res")}
          {grp("inv_no_op")}
          <ResultadoRow strong label="Resultado Final" values={resFinal} activeMonths={activeMonths} />
        </tbody>
      </table>
    </div>
    {sinCls && (
      <div style={{ marginTop: 16, background: T.card, border: "1px solid #fcd34d",
        borderRadius: T.radius, boxShadow: T.shadow, overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 280 + activeMonths.length * 110, borderCollapse: "collapse" }}>
          <tbody>
            <PnlSection label="Sin clasificar (fuera del P&L de la sede)" accounts={pnl.sinClasificar}
              activeMonths={activeMonths} color="#f59e0b" ncols={ncols} />
          </tbody>
        </table>
        <div style={{ padding: "8px 16px", fontSize: 11, color: "#92400e", background: "#fffbeb" }}>
          Estas cuentas tienen movimientos en la sede pero no están asignadas a ninguna línea del P&L.
          Revisá si corresponde re-imputarlas o agregarlas a la estructura.
        </div>
      </div>
    )}
    </>
  );
}

// ─── PnLTable ─────────────────────────────────────────────────────────────────
function PnLTable({ pnl, sub, year, moneda, label }) {
  const { ventasTot, costoTot, opexTot, finTot, impTot,
          margenBruto, resOp, resAntesImp, resNeto, activeMonths } = sub;
  const ncols = activeMonths.length + 2;

  if (activeMonths.length === 0) return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      padding: "60px 24px", textAlign: "center", boxShadow: T.shadow }}>
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={T.dim} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 10 }}>
        <path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 5-6"/>
      </svg>
      <div style={{ fontSize: 14, color: T.muted }}>
        Sin datos para {year} en {moneda}{label ? ` · ${label}` : ""}.
      </div>
      <div style={{ fontSize: 12, color: T.dim, marginTop: 6 }}>
        Asegurate de asignar la Categoría P&L a cada cuenta en Maestros → Plan de Cuentas.
      </div>
    </div>
  );

  return (
    <>
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      boxShadow: T.shadow, overflowX: "auto", position: "relative" }}>
      <table style={{ width: "100%", minWidth: 280 + activeMonths.length * 110, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: "left", minWidth: 240,
              ...stickyCol, background: T.tableHead, zIndex: 4 }}>Cuenta</th>
            {activeMonths.map(m => <th key={m} style={thStyle}>{MESES[m]}</th>)}
            <th style={{ ...thStyle, borderLeft: "1px solid rgba(255,255,255,.12)" }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          <PnlSection label="Ventas" accounts={pnl.ventas}
            activeMonths={activeMonths} color={T.green} ncols={ncols} />
          <SubtotalRow label="Total Ventas" values={ventasTot}
            activeMonths={activeMonths} color={T.green} />

          <PnlSection label="Costo por Venta" accounts={pnl.costo_venta}
            activeMonths={activeMonths} color="#f97316" ncols={ncols} />
          <ResultadoRow label="Margen Bruto" values={margenBruto} activeMonths={activeMonths} />

          <PnlSection label="Gastos Operativos" accounts={pnl.gastos_operativos}
            activeMonths={activeMonths} color={T.red} ncols={ncols} />
          <ResultadoRow label="Resultado Operativo" values={resOp} activeMonths={activeMonths} />

          <PnlSection label="Gastos Financieros" accounts={pnl.gastos_financieros}
            activeMonths={activeMonths} color="#8b5cf6" ncols={ncols} />
          <ResultadoRow label="Resultado antes de Impuestos" values={resAntesImp} activeMonths={activeMonths} />

          <PnlSection label="Impuestos" accounts={pnl.impuestos}
            activeMonths={activeMonths} color="#64748b" ncols={ncols} />
          <ResultadoRow label="Resultado Neto" values={resNeto} activeMonths={activeMonths} />
        </tbody>
      </table>
    </div>
    {pnl.sin_categoria && Object.keys(pnl.sin_categoria).length > 0 && (
      <div style={{ marginTop: 16, background: T.card, border: `1px solid #fcd34d`,
        borderRadius: T.radius, boxShadow: T.shadow, overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 280 + activeMonths.length * 110, borderCollapse: "collapse" }}>
          <tbody>
            <PnlSection label="Sin Categoría P&L" accounts={pnl.sin_categoria}
              activeMonths={activeMonths} color="#f59e0b" ncols={ncols} />
          </tbody>
        </table>
      </div>
    )}
    </>
  );
}

// ─── PnlSection ───────────────────────────────────────────────────────────────
function PnlSection({ label, accounts, activeMonths, color, ncols, sub, order, expanded: expandedProp, onToggle }) {
  const [expandedState, setExpandedState] = useState(true);
  // Controlado si viene onToggle (lo maneja el toggle maestro); si no, estado interno (como antes).
  const controlled = onToggle !== undefined;
  const expanded = controlled ? expandedProp : expandedState;
  const toggle = controlled ? onToggle : () => setExpandedState(e => !e);
  // `order` (opcional) = orden explícito de cuentas; sin él, alfabético (comportamiento previo).
  const rows = Object.entries(accounts).sort(([a],[b]) => {
    if (order) { const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b); }
    return a.localeCompare(b);
  });
  const subTotals = MESES.map((_,m) => rows.reduce((s,[,v]) => s + (v[m] || 0), 0));
  return (
    <>
      {!sub && (
        <SectionRow label={label} values={subTotals} activeMonths={activeMonths}
          expanded={expanded} onToggle={toggle} />
      )}
      {sub && (
        <SubSectionRow label={label} values={subTotals} activeMonths={activeMonths}
          color={color} expanded={expanded} onToggle={toggle} />
      )}
      {expanded && rows.map(([nombre, vals]) => (
        <DataRow key={nombre} label={nombre} values={vals} activeMonths={activeMonths} color={color} />
      ))}
    </>
  );
}

function SubSectionRow({ label, values, activeMonths, color, expanded, onToggle }) {
  const total = rowSum(values);
  const bg = "#f1f5f9";
  return (
    <tr style={{ background: bg, borderTop: `2px solid ${color ?? T.cardBorder}`,
      borderBottom: `1px solid ${T.cardBorder}`, cursor: "pointer" }}
      onClick={onToggle}>
      <td style={{ padding: "7px 16px", fontSize: 12, fontWeight: 800,
        color: color ?? T.muted, letterSpacing: ".06em", textTransform: "uppercase",
        userSelect: "none", ...stickyCol, background: bg }}>
        <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{expanded ? "▼" : "▶"}</span>
        {label}
      </td>
      {activeMonths.map(m => (
        <td key={m} style={{ padding: "7px 12px", fontSize: 12, textAlign: "right",
          fontFamily: "var(--mono)", fontWeight: 800, color: color ?? T.muted, whiteSpace: "nowrap" }}>
          {values[m] ? fmtN(values[m]) : "—"}
        </td>
      ))}
      <td style={{ padding: "7px 14px", fontSize: 12, textAlign: "right", fontFamily: "var(--mono)",
        fontWeight: 900, color: color ?? T.muted, whiteSpace: "nowrap",
        borderLeft: `1px solid ${T.cardBorder}` }}>
        {total ? fmtN(total) : "—"}
      </td>
    </tr>
  );
}

// ─── P&L HQ: agrupa por centro_costo usando cc.categoria_pnl ─────────────────
function buildPnLHQ(rawIn, rawEg, ccMap, year, moneda) {
  const cats = { ventas:{}, costo_venta:{}, r_y_d:{}, sales_marketing:{}, g_and_a:{}, gastos_financieros:{}, impuestos:{}, sin_categoria:{} };
  const add = (rows) => {
    for (const row of rows) {
      if (!row.fecha || row.fecha.slice(0,4) !== String(year)) continue;
      if ((row.moneda ?? "ARS") !== moneda) continue;
      const cc = ccMap.get(row.centro_costo ?? "");
      if (!cc || (cc.grupo ?? "").toLowerCase() !== "hq") continue;
      const m = parseInt(row.fecha.slice(5,7), 10) - 1;
      if (m < 0 || m > 11) continue;
      const nombre = cc.nombre;
      const cat    = normCat(cc.categoria_pnl);
      const bucket = cats[cat] ?? cats.sin_categoria;
      if (!bucket[nombre]) bucket[nombre] = new Array(12).fill(0);
      bucket[nombre][m] += Number(row.total) || 0;
    }
  };
  add(rawIn); add(rawEg);
  for (const cc of ccMap.values()) {
    if ((cc.grupo ?? "").toLowerCase() !== "hq") continue;
    const cat = normCat(cc.categoria_pnl);
    if (!cat) continue;
    const bucket = cats[cat] ?? cats.sin_categoria;
    if (!bucket[cc.nombre]) bucket[cc.nombre] = new Array(12).fill(0);
  }
  return cats;
}

function computeSubtotalsHQ(pnl) {
  const ventasTot = sumCat(pnl.ventas);
  const costoTot  = sumCat(pnl.costo_venta);
  const rydTot    = sumCat(pnl.r_y_d);
  const smTot     = sumCat(pnl.sales_marketing);
  const gaTot     = sumCat(pnl.g_and_a);
  const opexTot   = MESES.map((_,m) => rydTot[m] + smTot[m] + gaTot[m]);
  const finTot    = sumCat(pnl.gastos_financieros);
  const impTot    = sumCat(pnl.impuestos);
  const margenBruto   = MESES.map((_,m) => ventasTot[m] - costoTot[m]);
  const resOp         = MESES.map((_,m) => margenBruto[m] - opexTot[m]);
  const resAntesImp   = MESES.map((_,m) => resOp[m] - finTot[m]);
  const resNeto       = MESES.map((_,m) => resAntesImp[m] - impTot[m]);
  const months = new Set();
  const curMonth = new Date().getMonth();
  for (let i = 0; i <= curMonth; i++) months.add(i);
  Object.values(pnl).forEach(cat =>
    Object.values(cat).forEach(arr => arr.forEach((v,i) => { if (v) months.add(i); }))
  );
  return { ventasTot, costoTot, rydTot, smTot, gaTot, opexTot, finTot, impTot,
           margenBruto, resOp, resAntesImp, resNeto,
           activeMonths: [...months].sort((a,b) => a-b) };
}

function PnLTableHQ({ pnl, sub, year, moneda }) {
  const { ventasTot, costoTot, rydTot, smTot, gaTot, opexTot, finTot, impTot,
          margenBruto, resOp, resAntesImp, resNeto, activeMonths } = sub;
  const ncols = activeMonths.length + 2;
  const [opexExpanded, setOpexExpanded] = useState(true);
  return (
    <>
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      boxShadow: T.shadow, overflowX: "auto", position: "relative" }}>
      <table style={{ width: "100%", minWidth: 280 + activeMonths.length * 110, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: "left", minWidth: 240,
              ...stickyCol, background: T.tableHead, zIndex: 4 }}>Centro de Costo</th>
            {activeMonths.map(m => <th key={m} style={thStyle}>{MESES[m]}</th>)}
            <th style={{ ...thStyle, borderLeft: "1px solid rgba(255,255,255,.12)" }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          <PnlSection label="Ventas" accounts={pnl.ventas}
            activeMonths={activeMonths} color={T.green} ncols={ncols} />
          <SubtotalRow label="Total Ventas" values={ventasTot}
            activeMonths={activeMonths} color={T.green} />

          <PnlSection label="Costo por Venta" accounts={pnl.costo_venta}
            activeMonths={activeMonths} color="#f97316" ncols={ncols} />
          <ResultadoRow label="Margen Bruto" values={margenBruto} activeMonths={activeMonths} />

          <SectionRow label="Gastos Operativos" values={opexTot}
            activeMonths={activeMonths} expanded={opexExpanded}
            onToggle={() => setOpexExpanded(e => !e)} />
          {opexExpanded && <>
            <PnlSection label="R&D" accounts={pnl.r_y_d}
              activeMonths={activeMonths} color={T.red} ncols={ncols} sub />
            <PnlSection label="Sales & Marketing" accounts={pnl.sales_marketing}
              activeMonths={activeMonths} color={T.red} ncols={ncols} sub />
            <PnlSection label="G&A" accounts={pnl.g_and_a}
              activeMonths={activeMonths} color={T.red} ncols={ncols} sub />
          </>}
          <ResultadoRow label="Resultado Operativo" values={resOp} activeMonths={activeMonths} />

          <PnlSection label="Gastos Financieros" accounts={pnl.gastos_financieros}
            activeMonths={activeMonths} color="#8b5cf6" ncols={ncols} />
          <ResultadoRow label="Resultado antes de Impuestos" values={resAntesImp} activeMonths={activeMonths} />

          <PnlSection label="Impuestos" accounts={pnl.impuestos}
            activeMonths={activeMonths} color="#64748b" ncols={ncols} />
          <ResultadoRow label="Resultado Neto" values={resNeto} activeMonths={activeMonths} />
        </tbody>
      </table>
    </div>
    {pnl.sin_categoria && Object.keys(pnl.sin_categoria).length > 0 && (
      <div style={{ marginTop: 16, background: T.card, border: `1px solid #fcd34d`,
        borderRadius: T.radius, boxShadow: T.shadow, overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 280 + activeMonths.length * 110, borderCollapse: "collapse" }}>
          <tbody>
            <PnlSection label="Sin Categoría P&L" accounts={pnl.sin_categoria}
              activeMonths={activeMonths} color="#f59e0b" ncols={ncols} />
          </tbody>
        </table>
      </div>
    )}
    </>
  );
}

// ─── Tab Balance / Posición Financiera ───────────────────────────────────────
const MON_COLS = [
  { key: "ARS", label: "$ ARS" },
  { key: "USD", label: "U$D" },
  { key: "EUR", label: "€ EUR" },
];

function BSecRow({ label, expanded, onToggle }) {
  const clickable = !!onToggle;
  return (
    <tr style={{ background: T.accentDark, cursor: clickable ? "pointer" : "default" }}
      onClick={onToggle}>
      <td colSpan={MON_COLS.length + 1} style={{ padding: "8px 16px", fontSize: 11,
        fontWeight: 800, color: T.accent, letterSpacing: ".1em", textTransform: "uppercase",
        userSelect: "none" }}>
        {clickable && <span style={{ marginRight: 6, fontSize: 9, opacity: .6 }}>{expanded ? "▼" : "▶"}</span>}
        {label}
      </td>
    </tr>
  );
}
function BGrpRow({ label, expanded, onToggle }) {
  const clickable = !!onToggle;
  return (
    <tr style={{ background: "#f8fafc", borderTop: `1px solid ${T.cardBorder}`,
      cursor: clickable ? "pointer" : "default" }}
      onClick={onToggle}>
      <td colSpan={MON_COLS.length + 1} style={{ padding: "6px 16px", fontSize: 11,
        fontWeight: 700, color: T.muted, letterSpacing: ".06em", textTransform: "uppercase",
        userSelect: "none" }}>
        {clickable && <span style={{ marginRight: 5, fontSize: 9, opacity: .7 }}>{expanded ? "▼" : "▶"}</span>}
        {label}
      </td>
    </tr>
  );
}
function BDRow({ label, vals, indent = false }) {
  return (
    <tr style={{ borderBottom: `1px solid ${T.cardBorder}` }}
      onMouseEnter={e => e.currentTarget.style.background = "#f0f9ff"}
      onMouseLeave={e => e.currentTarget.style.background = ""}>
      <td style={{ padding: `7px ${indent ? 28 : 16}px`, fontSize: 13, color: T.text,
        whiteSpace: "nowrap", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </td>
      {MON_COLS.map(({ key }) => {
        const v = vals[key] ?? 0;
        return (
          <td key={key} style={{ padding: "7px 16px", textAlign: "right",
            fontFamily: "var(--mono)", fontSize: 13, whiteSpace: "nowrap",
            color: v < 0 ? T.red : v > 0 ? T.text : T.dim }}>
            {v ? (v < 0 ? "−" : "") + Math.round(Math.abs(v)).toLocaleString("es-AR") : "—"}
          </td>
        );
      })}
    </tr>
  );
}
function BSubRow({ label, vals, color }) {
  return (
    <tr style={{ background: "#f3f4f6", borderTop: `2px solid ${color ?? T.cardBorder}`,
      borderBottom: `2px solid ${T.cardBorder}` }}>
      <td style={{ padding: "10px 16px", fontSize: 14, fontWeight: 900, color: color ?? T.text }}>
        {label}
      </td>
      {MON_COLS.map(({ key }) => {
        const v = vals[key] ?? 0;
        return (
          <td key={key} style={{ padding: "10px 16px", textAlign: "right",
            fontFamily: "var(--mono)", fontSize: 14, fontWeight: 900, whiteSpace: "nowrap",
            color: v < 0 ? T.red : color ?? T.text }}>
            {v ? (v < 0 ? "−" : "") + Math.round(Math.abs(v)).toLocaleString("es-AR") : "—"}
          </td>
        );
      })}
    </tr>
  );
}
function BResRow({ label, vals }) {
  const color = (vals.USD ?? 0) >= 0 ? T.green : T.red;
  return (
    <tr style={{ background: color === T.green ? "#f0fdf4" : "#fff1f2",
      borderTop: `2px solid ${color}` }}>
      <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 900, color }}>
        {label}
      </td>
      {MON_COLS.map(({ key }) => {
        const v = vals[key] ?? 0;
        return (
          <td key={key} style={{ padding: "12px 16px", textAlign: "right",
            fontFamily: "var(--mono)", fontSize: 14, fontWeight: 900, whiteSpace: "nowrap",
            color: v > 0 ? T.green : v < 0 ? T.red : T.dim }}>
            {v ? (v < 0 ? "−" : "") + Math.round(Math.abs(v)).toLocaleString("es-AR") : "—"}
          </td>
        );
      })}
    </tr>
  );
}

const sumMon = (rows, getMoneda, getMonto) => {
  const t = { ARS: 0, USD: 0, EUR: 0 };
  for (const r of rows) {
    const mon = getMoneda(r);
    if (mon in t) t[mon] += getMonto(r);
  }
  return t;
};
const addVals = (a, b) => ({ ARS: a.ARS + b.ARS, USD: a.USD + b.USD, EUR: a.EUR + b.EUR });
const subVals = (a, b) => ({ ARS: a.ARS - b.ARS, USD: a.USD - b.USD, EUR: a.EUR - b.EUR });
const ZERO    = { ARS: 0, USD: 0, EUR: 0 };

const SALARY_BUCKET_LABEL = { haberes: "Haberes", deposito: "Depósito", monotributo: "Monotributo", efectivo: "Efectivo" };

// Pasivo de financiaciones por bucket (impuestos/financiero). Usa el helper compartido de
// numbersApi → mismo número que Tesorería (una sola fuente de la clasificación).
function financiacionPasivoRows(planes, sociedad) {
  const b = financiacionPasivoBuckets(planes, sociedad);
  return { impuestos: b.impuestos.tot, financiero: b.financiero.tot };
}

function TabBalance({ rawMovs, cuentasBancarias, rawIn, rawEg, sociedad, liqsCerradas = [], pagosSueldos = [], rawFin = [], socios = [], sociosCC = [] }) {
  const [activoOpen,  setActivoOpen]  = useState(true);
  const [pasivoOpen,  setPasivoOpen]  = useState(true);
  const [cajaOpen,    setCajaOpen]    = useState(true);
  const [bancosOpen,  setBancosOpen]  = useState(true);
  const [cxcOpen,     setCxcOpen]     = useState(true);
  const [cxpOpen,     setCxpOpen]     = useState(true);
  const [cxpSldOpen,  setCxpSldOpen]  = useState(true);

  const saldos = useMemo(() => {
    const map = {};
    for (const m of rawMovs) {
      const cb  = m.cuenta_bancaria ?? "";
      const mon = m.moneda ?? "ARS";
      if (!cb || !(mon in ZERO)) continue;
      if (!map[cb]) map[cb] = { ...ZERO };
      map[cb][mon] += Number(m.monto) || 0;
    }
    return map;
  }, [rawMovs]);

  const cuentasSoc = useMemo(() =>
    cuentasBancarias.filter(c => !sociedad ||
      (c.sociedad ?? "").toLowerCase() === sociedad.toLowerCase()),
    [cuentasBancarias, sociedad]);

  const cajas    = useMemo(() => cuentasSoc.filter(c => (c.tipo ?? "").toLowerCase() === "caja"),  [cuentasSoc]);
  const tarjetas = useMemo(() => cuentasSoc.filter(esCuentaCredito), [cuentasSoc]);
  const bancos   = useMemo(() => cuentasSoc.filter(c => (c.tipo ?? "").toLowerCase() !== "caja" && !esCuentaCredito(c)), [cuentasSoc]);

  const getBal = (id) => saldos[id] ?? { ...ZERO };
  const sumGrp = (grp) => grp.reduce((t, c) => addVals(t, getBal(c.id)), { ...ZERO });

  const cajaTot  = useMemo(() => sumGrp(cajas),  [cajas, saldos]);
  const bancoTot = useMemo(() => sumGrp(bancos), [bancos, saldos]);
  // Deuda de tarjetas: saldo de las cuentas-tarjeta (negativo) → al pasivo como magnitud positiva.
  const tarjetaDeuda = useMemo(() => subVals({ ...ZERO }, sumGrp(tarjetas)), [tarjetas, saldos]);
  const hayTarjeta = (tarjetaDeuda.ARS + tarjetaDeuda.USD + tarjetaDeuda.EUR) !== 0;

  const cxcRows = useMemo(() =>
    rawIn.filter(r => (r.subtipo ?? "").toUpperCase() === "INGRESO" && r.estado !== "cobrado"),
    [rawIn]);
  const cxpRows = useMemo(() =>
    rawEg.filter(r => (r.subtipo ?? "").toUpperCase() === "EGRESO" && r.estado !== "pagado"),
    [rawEg]);

  const cxcTot = useMemo(() => sumMon(cxcRows, r => r.moneda ?? "ARS", r => Number(r.total) || 0), [cxcRows]);
  const cxpTot = useMemo(() => sumMon(cxpRows, r => r.moneda ?? "ARS", r => Number(r.total) || 0), [cxpRows]);

  // Cuenta por pagar de sueldos = devengado (cerradas) − pagado (nb_movimientos origen sueldos), por balde de
  // forma de pago (efectivo ≠ haberes), filtrado por la sociedad de cada forma. Solo ARS.
  const sueldoSoc = (sociedad ?? "").toLowerCase();
  const cxpSueldosBuckets = useMemo(() => {
    const match = (s) => !sueldoSoc || (s ?? "").toLowerCase() === sueldoSoc;
    const dev = {}, pag = {};
    for (const { bucket } of SALARY_BUCKETS) { dev[bucket] = 0; pag[bucket] = 0; }
    // Sociedad del devengado por (legajo, balde): la obligación de haberes es del legajo,
    // no de la caja con la que se pagó. El pago se atribuye a esta sociedad, no a su origen.
    const devSoc = new Map();
    for (const liq of liqsCerradas)
      for (const { bucket, sociedad, total } of devengadoPorFormaYSociedad(liq)) {
        if (match(sociedad)) dev[bucket] += total;
        const k = liq.legajo_id + "|" + bucket;
        if (!devSoc.has(k)) devSoc.set(k, sociedad);
      }
    for (const p of pagosSueldos) {
      const bucket = pagoTipoABucket(p.tipo_componente);
      const soc = devSoc.get(p.legajo_id + "|" + bucket) ?? p.sociedad_id;  // devengado, no caja
      if (match(soc)) pag[bucket] += Number(p.monto) || 0;
    }
    return SALARY_BUCKETS
      .map(({ bucket }) => ({ bucket, pendiente: Math.max(0, dev[bucket] - pag[bucket]) }))
      .filter(b => b.pendiente > 0);
  }, [liqsCerradas, pagosSueldos, sueldoSoc]);
  const cxpSueldosTot = { ...ZERO, ARS: cxpSueldosBuckets.reduce((s, b) => s + b.pendiente, 0) };

  // Pasivo de financiaciones (planes AFIP → impuestos, créditos → financiero)
  const [finOpen, setFinOpen] = useState(true);
  const finPasivo    = useMemo(() => financiacionPasivoRows(rawFin, sociedad), [rawFin, sociedad]);
  const finPasivoTot = useMemo(() => addVals(finPasivo.impuestos, finPasivo.financiero), [finPasivo]);
  const hayFin = (finPasivoTot.ARS + finPasivoTot.USD + finPasivoTot.EUR) > 0;

  // Pasivo de anticipos de clientes (ingresos diferidos), derivado de los movimientos
  const antPasivo    = useMemo(() => anticipoPasivo(agruparAnticipos(rawMovs), sociedad).tot, [rawMovs, sociedad]);
  const hayAnt = (antPasivo.ARS + antPasivo.USD + antPasivo.EUR) > 0;

  // Socios: slice de esta sociedad (activo = nos deben / pasivo = les debemos). Balance puro,
  // ya devengado fuera del P&L. Los movs de caja de socios viven en rawMovs (origen="socios").
  const sociosSld = useMemo(() => sociosSaldos(socios, sociosCC, rawMovs, { sociedad }), [socios, sociosCC, rawMovs, sociedad]);
  const sociosActivoTot = useMemo(() => sumMon(sociosSld.activo, r => r.moneda, r => r.saldo), [sociosSld]);
  const sociosPasivoTot = useMemo(() => sumMon(sociosSld.pasivo, r => r.moneda, r => r.saldo), [sociosSld]);
  const haySocA = (sociosActivoTot.ARS + sociosActivoTot.USD + sociosActivoTot.EUR) > 0;
  const haySocP = (sociosPasivoTot.ARS + sociosPasivoTot.USD + sociosPasivoTot.EUR) > 0;

  const activoTot  = addVals(addVals(addVals(cajaTot, bancoTot), cxcTot), sociosActivoTot);
  const pasivoTot  = addVals(addVals(addVals(addVals(addVals(cxpTot, cxpSueldosTot), finPasivoTot), antPasivo), tarjetaDeuda), sociosPasivoTot);
  const pnTot      = subVals(activoTot, pasivoTot);

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      boxShadow: T.shadow, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: "left", minWidth: 300 }}>Concepto</th>
            {MON_COLS.map(({ key, label }) => <th key={key} style={thStyle}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          <BSecRow label="Activo" expanded={activoOpen} onToggle={() => setActivoOpen(o => !o)} />
          {activoOpen && <>
            <BGrpRow label="Caja / Efectivo" expanded={cajaOpen} onToggle={() => setCajaOpen(o => !o)} />
            {cajaOpen && cajas.map(c => <BDRow key={c.id} label={c.nombre} vals={getBal(c.id)} indent />)}
            {cajaOpen && cajas.length === 0 && <BDRow label="(sin cuentas de caja)" vals={ZERO} indent />}
            <BSubRow label="Total Caja" vals={cajaTot} color={T.green} />

            <BGrpRow label="Bancos" expanded={bancosOpen} onToggle={() => setBancosOpen(o => !o)} />
            {bancosOpen && bancos.map(c => <BDRow key={c.id} label={c.nombre} vals={getBal(c.id)} indent />)}
            {bancosOpen && bancos.length === 0 && <BDRow label="(sin cuentas de banco)" vals={ZERO} indent />}
            <BSubRow label="Total Bancos" vals={bancoTot} color={T.green} />

            <BGrpRow label="Cuentas a Cobrar" expanded={cxcOpen} onToggle={() => setCxcOpen(o => !o)} />
            {cxcOpen && <BDRow label="Facturas pendientes de cobro" vals={cxcTot} indent />}
            <BSubRow label="Total Cuentas a Cobrar" vals={cxcTot} color={T.green} />

            {haySocA && <>
              <BGrpRow label="Socios (nos deben)" expanded onToggle={() => {}} />
              <BDRow label="Préstamos / adelantos a socios" vals={sociosActivoTot} indent />
              <BSubRow label="Total Socios" vals={sociosActivoTot} color={T.green} />
            </>}
          </>}
          <BResRow label="TOTAL ACTIVO" vals={activoTot} />

          <BSecRow label="Pasivo" expanded={pasivoOpen} onToggle={() => setPasivoOpen(o => !o)} />
          {pasivoOpen && <>
            <BGrpRow label="Cuentas a Pagar" expanded={cxpOpen} onToggle={() => setCxpOpen(o => !o)} />
            {cxpOpen && <BDRow label="Facturas pendientes de pago" vals={cxpTot} indent />}
            <BSubRow label="Total Cuentas a Pagar" vals={cxpTot} color={T.red} />

            <BGrpRow label="Cuentas a Pagar — Sueldos" expanded={cxpSldOpen} onToggle={() => setCxpSldOpen(o => !o)} />
            {cxpSldOpen && cxpSueldosBuckets.map(b => (
              <BDRow key={b.bucket} label={SALARY_BUCKET_LABEL[b.bucket] ?? b.bucket} vals={{ ...ZERO, ARS: b.pendiente }} indent />
            ))}
            {cxpSldOpen && cxpSueldosBuckets.length === 0 && <BDRow label="(sin saldo de sueldos)" vals={ZERO} indent />}
            <BSubRow label="Total Cuentas a Pagar — Sueldos" vals={cxpSueldosTot} color={T.red} />

            {hayFin && <>
              <BGrpRow label="Financiaciones (planes y créditos)" expanded={finOpen} onToggle={() => setFinOpen(o => !o)} />
              {finOpen && (finPasivo.impuestos.ARS + finPasivo.impuestos.USD + finPasivo.impuestos.EUR) > 0 && <BDRow label="Planes de pago (impuestos)" vals={finPasivo.impuestos} indent />}
              {finOpen && (finPasivo.financiero.ARS + finPasivo.financiero.USD + finPasivo.financiero.EUR) > 0 && <BDRow label="Créditos / préstamos" vals={finPasivo.financiero} indent />}
              <BSubRow label="Total Financiaciones" vals={finPasivoTot} color={T.red} />
            </>}

            {hayAnt && <>
              <BGrpRow label="Anticipos de clientes (ingresos diferidos)" expanded onToggle={() => {}} />
              <BDRow label="Saldo de anticipos sin facturar" vals={antPasivo} indent />
              <BSubRow label="Total Anticipos" vals={antPasivo} color={T.red} />
            </>}

            {hayTarjeta && <>
              <BGrpRow label="Tarjetas de crédito" expanded onToggle={() => {}} />
              <BDRow label="Saldo a pagar de tarjetas" vals={tarjetaDeuda} indent />
              <BSubRow label="Total Tarjetas" vals={tarjetaDeuda} color={T.red} />
            </>}

            {haySocP && <>
              <BGrpRow label="Socios (les debemos)" expanded onToggle={() => {}} />
              <BDRow label="Dividendos a pagar / aportes de socios" vals={sociosPasivoTot} indent />
              <BSubRow label="Total Socios" vals={sociosPasivoTot} color={T.red} />
            </>}
          </>}
          <BResRow label="TOTAL PASIVO" vals={pasivoTot} />

          <BResRow label="PATRIMONIO NETO = Activo − Pasivo" vals={pnTot} />
        </tbody>
      </table>
    </div>
  );
}

// ─── Tab Cash Flow ────────────────────────────────────────────────────────────
function TabCashFlow({ rawMovs, year, moneda, tarjetaIds }) {

  const movsFilt = useMemo(() => rawMovs.filter(m => {
    if (!m.fecha) return false;
    if (esIgnorado(m)) return false;                 // líneas descartadas no entran al flujo
    if (!m.cuenta_bancaria) return false;            // sin banco = no es caja (retención, consumo de anticipo, apertura)
    if (tarjetaIds?.has(m.cuenta_bancaria)) return false;  // las cuentas-tarjeta no son caja: la salida real es el pago de la tarjeta
    if (m.fecha.slice(0, 4) !== String(year)) return false;
    if ((m.moneda ?? "ARS") !== moneda) return false;
    return true;
  }), [rawMovs, year, moneda, tarjetaIds]);

  const movsOp    = useMemo(() => movsFilt.filter(m => m.tipo !== "TRANSFERENCIA"), [movsFilt]);
  const movsTrans = useMemo(() => movsFilt.filter(m => m.tipo === "TRANSFERENCIA"), [movsFilt]);

  const { entradas, salidas } = useMemo(() => {
    const e = {}, s = {};
    for (const m of movsOp) {
      const mes   = parseInt(m.fecha.slice(5, 7), 10) - 1;
      const monto = Number(m.monto) || 0;
      const cta   = (m.cuenta_contable ?? "").trim()
        || (m.tipo === "PAGO_TARJETA" || m.origen === "pago_tarjeta" ? "Pago de tarjeta" : "Sin clasificar");
      if (monto > 0) {
        if (!e[cta]) e[cta] = new Array(12).fill(0);
        e[cta][mes] += monto;
      } else if (monto < 0) {
        if (!s[cta]) s[cta] = new Array(12).fill(0);
        s[cta][mes] += Math.abs(monto);
      }
    }
    return { entradas: e, salidas: s };
  }, [movsOp]);

  const totalEntradas = useMemo(() => MESES.map((_, m) => Object.values(entradas).reduce((s, a) => s + a[m], 0)), [entradas]);
  const totalSalidas  = useMemo(() => MESES.map((_, m) => Object.values(salidas).reduce((s, a)  => s + a[m], 0)), [salidas]);
  const flujoNeto     = useMemo(() => MESES.map((_, m) => totalEntradas[m] - totalSalidas[m]), [totalEntradas, totalSalidas]);

  const saldoAcumulado = useMemo(() => {
    let cum = 0;
    return flujoNeto.map(v => { cum += v; return cum; });
  }, [flujoNeto]);

  const activeMonths = useMemo(() => {
    const s = new Set();
    movsOp.forEach(m => {
      const i = parseInt(m.fecha.slice(5, 7), 10) - 1;
      if (i >= 0 && i <= 11) s.add(i);
    });
    const cur = new Date().getMonth();
    for (let i = 0; i <= cur; i++) s.add(i);
    return [...s].sort((a, b) => a - b);
  }, [movsOp]);

  const ncols = activeMonths.length + 2;

  if (activeMonths.length === 0) return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      padding: "60px 24px", textAlign: "center", boxShadow: T.shadow }}>
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={T.dim} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 10 }}>
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6"/>
      </svg>
      <div style={{ fontSize: 14, color: T.muted }}>Sin movimientos para {year} en {moneda}.</div>
    </div>
  );

  return (
    <>
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      boxShadow: T.shadow, overflowX: "auto", position: "relative" }}>
      <table style={{ width: "100%", minWidth: 280 + activeMonths.length * 110, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: "left", minWidth: 240,
              ...stickyCol, background: T.tableHead, zIndex: 4 }}>Concepto</th>
            {activeMonths.map(m => <th key={m} style={thStyle}>{MESES[m]}</th>)}
            <th style={{ ...thStyle, borderLeft: "1px solid rgba(255,255,255,.12)" }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          <PnlSection label="Entradas" accounts={entradas}
            activeMonths={activeMonths} color={T.green} ncols={ncols} />
          <SubtotalRow label="Total Entradas" values={totalEntradas}
            activeMonths={activeMonths} color={T.green} />

          <PnlSection label="Salidas" accounts={salidas}
            activeMonths={activeMonths} color={T.red} ncols={ncols} />
          <SubtotalRow label="Total Salidas" values={totalSalidas}
            activeMonths={activeMonths} color={T.red} />

          <ResultadoRow label="Flujo Neto del Período" values={flujoNeto} activeMonths={activeMonths} />

          <tr style={{ background: "#f8fafc", borderTop: `1px solid ${T.cardBorder}` }}>
            <td style={{ padding: "10px 16px", fontSize: 12, fontWeight: 800,
              color: T.muted, letterSpacing: ".04em",
              ...stickyCol, background: "#f8fafc" }}>Saldo Acumulado (base período)</td>
            {activeMonths.map(m => {
              const v = saldoAcumulado[m];
              return (
                <td key={m} style={{ padding: "10px 12px", textAlign: "right",
                  fontFamily: "var(--mono)", whiteSpace: "nowrap",
                  color: v >= 0 ? T.green : T.red, fontWeight: 800 }}>
                  {v !== 0 ? (v > 0 ? "+" : "−") + Math.round(Math.abs(v)).toLocaleString("es-AR") : "—"}
                </td>
              );
            })}
            <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "var(--mono)",
              fontWeight: 900, whiteSpace: "nowrap", borderLeft: `1px solid ${T.cardBorder}`,
              color: (saldoAcumulado[activeMonths.at(-1)] ?? 0) >= 0 ? T.green : T.red }}>
              {(() => { const v = saldoAcumulado[activeMonths.at(-1)] ?? 0;
                return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.round(Math.abs(v)).toLocaleString("es-AR"); })()}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    {movsTrans.length > 0 && (
      <div style={{ marginTop: 16, background: "#eff6ff", border: "1px solid #bfdbfe",
        borderRadius: T.radius, padding: "10px 16px", fontSize: 12, color: "#1d4ed8",
        display: "flex", alignItems: "center", gap: 8 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <span><strong>Transferencias internas:</strong> {movsTrans.length} movimiento{movsTrans.length !== 1 ? "s" : ""} entre
        cuentas propias no se incluyen en el flujo neto.</span>
      </div>
    )}
    </>
  );
}

// ─── Tab Evolución Patrimonio Neto ────────────────────────────────────────────
function TabEvolucionPN({ rawMovs, cuentasBancarias, rawIn, rawEg, sociedad, year }) {
  const [activoOpen, setActivoOpen] = useState({ ARS: true, USD: true, EUR: true });
  const [pasivoOpen, setPasivoOpen] = useState({ ARS: true, USD: true, EUR: true });
  const toggleActivo = (mon) => setActivoOpen(o => ({ ...o, [mon]: !o[mon] }));
  const togglePasivo = (mon) => setPasivoOpen(o => ({ ...o, [mon]: !o[mon] }));

  const saldosMensuales = useMemo(() => {
    const map = {};
    const movs = [...rawMovs].sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? ""));
    const running = {};
    for (const m of movs) {
      if (!m.fecha) continue;
      const mes = parseInt(m.fecha.slice(5, 7), 10) - 1;
      const yr  = parseInt(m.fecha.slice(0, 4), 10);
      if (yr > year) break;
      const cb  = m.cuenta_bancaria ?? "";
      const mon = m.moneda ?? "ARS";
      if (!cb) continue;
      const key = `${cb}__${mon}`;
      running[key] = (running[key] ?? 0) + (Number(m.monto) || 0);
      if (yr === year) {
        if (!map[cb]) map[cb] = Array.from({ length: 12 }, () => ({ ARS: 0, USD: 0, EUR: 0 }));
        map[cb][mes][mon] = running[key];
      }
    }
    for (const cid of Object.keys(map)) {
      for (let m = 1; m < 12; m++) {
        for (const mon of ["ARS", "USD", "EUR"]) {
          if (map[cid][m][mon] === 0 && map[cid][m - 1][mon] !== 0) {
            map[cid][m][mon] = map[cid][m - 1][mon];
          }
        }
      }
    }
    return map;
  }, [rawMovs, year]);

  const cuentasSoc = useMemo(() =>
    cuentasBancarias.filter(c => !sociedad ||
      (c.sociedad ?? "").toLowerCase() === sociedad.toLowerCase()),
    [cuentasBancarias, sociedad]);

  const cajas  = useMemo(() => cuentasSoc.filter(c => (c.tipo ?? "").toLowerCase() === "caja"),  [cuentasSoc]);
  const bancos = useMemo(() => cuentasSoc.filter(c => (c.tipo ?? "").toLowerCase() !== "caja"), [cuentasSoc]);

  const grpMes = (grp, mon) =>
    MESES.map((_, m) => grp.reduce((s, c) => s + ((saldosMensuales[c.id]?.[m]?.[mon]) ?? 0), 0));

  const cxcMes = useMemo(() => {
    const t = { ARS: new Array(12).fill(0), USD: new Array(12).fill(0), EUR: new Array(12).fill(0) };
    for (const r of rawIn) {
      if ((r.subtipo ?? "").toUpperCase() !== "INGRESO") continue;
      if (r.estado === "cobrado") continue;
      if (!r.fecha || r.fecha.slice(0, 4) !== String(year)) continue;
      const m = parseInt(r.fecha.slice(5, 7), 10) - 1;
      const mon = r.moneda ?? "ARS";
      if (m >= 0 && m <= 11 && mon in t) t[mon][m] += Number(r.total) || 0;
    }
    return t;
  }, [rawIn, year]);

  const cxpMes = useMemo(() => {
    const t = { ARS: new Array(12).fill(0), USD: new Array(12).fill(0), EUR: new Array(12).fill(0) };
    for (const r of rawEg) {
      if ((r.subtipo ?? "").toUpperCase() !== "EGRESO") continue;
      if (r.estado === "pagado") continue;
      if (!r.fecha || r.fecha.slice(0, 4) !== String(year)) continue;
      const m = parseInt(r.fecha.slice(5, 7), 10) - 1;
      const mon = r.moneda ?? "ARS";
      if (m >= 0 && m <= 11 && mon in t) t[mon][m] += Number(r.total) || 0;
    }
    return t;
  }, [rawEg, year]);

  const curMonth = new Date().getMonth();
  const activeMonths = MESES.map((_, i) => i).filter(i => i <= curMonth);

  const ncols = activeMonths.length + 2;

  const sections = useMemo(() =>
    MON_COLS.map(({ key: mon }) => {
      const cajaTot  = grpMes(cajas,  mon);
      const bancoTot = grpMes(bancos, mon);
      const cxc      = cxcMes[mon];
      const cxp      = cxpMes[mon];
      const activo   = MESES.map((_, m) => cajaTot[m] + bancoTot[m] + cxc[m]);
      const pn       = MESES.map((_, m) => activo[m] - cxp[m]);
      return { mon, cajaTot, bancoTot, cxc, cxp, activo, pasivo: cxp, pn };
    }),
    [cajas, bancos, cxcMes, cxpMes, saldosMensuales] // eslint-disable-line
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {sections.map(({ mon, cajaTot, bancoTot, cxc, cxp, activo, pasivo, pn }) => {
        const hasData = activeMonths.some(m => activo[m] !== 0 || pasivo[m] !== 0);
        if (!hasData) return null;
        return (
          <div key={mon}>
            <div style={{ fontSize: 11, fontWeight: 800, color: T.muted, textTransform: "uppercase",
              letterSpacing: ".1em", marginBottom: 8 }}>
              {MONEDA_SYM[mon] ?? mon} {mon}
            </div>
            <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
              boxShadow: T.shadow, overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 280 + activeMonths.length * 100, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: "left", minWidth: 220 }}>Concepto</th>
                    {activeMonths.map(m => <th key={m} style={thStyle}>{MESES[m]}</th>)}
                    <th style={{ ...thStyle, borderLeft: "1px solid rgba(255,255,255,.12)" }}>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  <SectionRow label="Activo" span={ncols}
                    expanded={activoOpen[mon]} onToggle={() => toggleActivo(mon)} />
                  {activoOpen[mon] && <>
                    <DataRow label="Caja / Efectivo"   values={cajaTot}  activeMonths={activeMonths} color={T.green} />
                    <DataRow label="Bancos"             values={bancoTot} activeMonths={activeMonths} color={T.green} />
                    <DataRow label="Cuentas a Cobrar"   values={cxc}      activeMonths={activeMonths} color={T.green} />
                  </>}
                  <SubtotalRow label="Total Activo"     values={activo}   activeMonths={activeMonths} color={T.green} />

                  <SectionRow label="Pasivo" span={ncols}
                    expanded={pasivoOpen[mon]} onToggle={() => togglePasivo(mon)} />
                  {pasivoOpen[mon] && (
                    <DataRow label="Cuentas a Pagar"    values={cxp}      activeMonths={activeMonths} color={T.red} />
                  )}
                  <SubtotalRow label="Total Pasivo"     values={pasivo}   activeMonths={activeMonths} color={T.red} />

                  <ResultadoRow label="Patrimonio Neto" values={pn}       activeMonths={activeMonths} />
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab config ───────────────────────────────────────────────────────────────
const TABS = [
  { id: "pl_sede", label: "P&L Sedes",  icon: "🏬", desc: "Resultado operativo por sede: ventas, costos variables y márgenes." },
  { id: "pl_bigg", label: "P&L BIGG",   icon: "🏢", desc: "Resultado corporativo por centro de HQ (R&D, Sales & Mkt, G&A)." },
  { id: "cf",      label: "Cash Flow",  icon: "💵", desc: "Flujo de caja mensual: entradas y salidas por cuenta." },
  { id: "interco", label: "Intercompañía",   icon: "🔗", desc: "Posiciones entre sociedades, agrupadas por anillo." },
  { id: "consolidado", label: "Tesorería consolidada", icon: "🏦", desc: "Saldos y movimientos de todas las sociedades del grupo." },
];

// ─── Lentes (3 miradas por stakeholder; cada una agrupa un subconjunto de solapas) ──
// Por sociedad = estados de la entidad legal (scoped) · Operaciones = management del negocio
// (sedes) · BIGG HQ = mirada consolidada/corporativa.
const LENTES = [
  { id: "sociedad",    label: "Por sociedad",       tabs: ["cf"] },
  { id: "operaciones", label: "Operaciones (sedes)", tabs: ["pl_sede"] },
  { id: "bigg",        label: "BIGG HQ",            tabs: ["pl_bigg", "interco", "consolidado"] },
];

// ─── Tab Intercompañía (resumen de posiciones por anillo — LECTURA) ─────────────
function TabInterco({ data, sociedades }) {
  const socMap  = useMemo(() => new Map((sociedades || []).map(s => [String(s.id), s])), [sociedades]);
  const nombre  = id => socMap.get(String(id))?.nombre || id;
  const anilloDe = id => socMap.get(String(id))?.anillo || "Sin anillo";
  // Cada relación una sola vez: neto>0 → `sociedad` es ACREEDOR (le deben) de `contraparte`.
  const pos = useMemo(() => lecturaInterco(data).filter(p => p.neto > 0.01), [data]);
  const grupos = {};
  for (const p of pos) (grupos[anilloDe(p.contraparte)] ??= []).push(p);
  const anillos = Object.keys(grupos).sort();
  const money = (n, mon) => `${MONEDA_SYM[mon] ?? mon} ${fmtN(n)}`;

  return (
    <div className="fade" style={{ padding: "8px 0" }}>
      <PageHeader title="Posiciones Intercompañía" subtitle="Quién le debe a quién, por anillo (lectura). El que manda la plata queda como acreedor." />
      {pos.length === 0 ? (
        <div style={{ color: T.muted, fontSize: 13, padding: "24px 4px" }}>No hay posiciones intercompañía registradas todavía.</div>
      ) : anillos.map(a => (
        <div key={a} style={{ marginBottom: 20, background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, overflow: "hidden", boxShadow: T.shadow }}>
          <div style={{ background: T.tableHead, color: T.tableHeadText, padding: "8px 14px", fontSize: 12, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase" }}>{a}</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>
                <th style={{ textAlign: "left", padding: "8px 14px" }}>Acreedor (le deben)</th>
                <th style={{ textAlign: "left", padding: "8px 14px" }}>Deudor (debe)</th>
                <th style={{ textAlign: "right", padding: "8px 14px" }}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {grupos[a].sort((x, y) => y.neto - x.neto).map((p, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${T.cardBorder}` }}>
                  <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 600, color: T.text }}>{nombre(p.sociedad)}</td>
                  <td style={{ padding: "9px 14px", fontSize: 13, color: T.text }}>{nombre(p.contraparte)}</td>
                  <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 700, textAlign: "right", fontFamily: T.mono, color: T.green }}>{money(p.neto, p.moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ─── Menú-landing de Reportes: tarjetas agrupadas por lente ─────────────────────
function ReportCard({ icon, title, desc, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", gap: 14, alignItems: "flex-start", textAlign: "left",
      background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 12,
      padding: "18px 20px", cursor: "pointer", fontFamily: T.font, width: "100%",
      boxShadow: "0 1px 3px rgba(0,0,0,.04)", transition: "all .15s ease" }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = T.shadowMd; e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,.04)"; e.currentTarget.style.borderColor = T.cardBorder; e.currentTarget.style.transform = "none"; }}>
      <div style={{ fontSize: 20, lineHeight: 1, flexShrink: 0, width: 42, height: 42, borderRadius: 10,
        background: T.accentDark, display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.text, marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.4 }}>{desc}</div>
      </div>
    </button>
  );
}

function ReportesMenu({ onPick }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {LENTES.map(lente => (
        <div key={lente.id}>
          <div style={{ fontSize: 11, fontWeight: 800, color: T.muted, letterSpacing: ".1em",
            textTransform: "uppercase", marginBottom: 10 }}>{lente.label}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
            {lente.tabs.map(tid => {
              const t = TABS.find(x => x.id === tid);
              return <ReportCard key={tid} icon={t.icon} title={t.label} desc={t.desc} onClick={() => onPick(tid)} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function PantallaReportes({ sociedad = "nako" }) {
  const [activeTab,      setActiveTab]      = useState(null);   // null = menú-landing de reportes
  const [year,           setYear]           = useState(CUR_YEAR);
  const [selectedSedeCCs, setSelectedSedeCCs] = useState([]);
  const [sedeOpen,        setSedeOpen]        = useState(false);
  const [monedaPL,       setMonedaPL]       = useState("ARS");
  const [monedaCF,       setMonedaCF]       = useState("ARS");
  const [rawEg,     setRawEg]     = useState([]);
  const [rawIn,     setRawIn]     = useState([]);
  const [rawMovs,   setRawMovs]   = useState([]);
  const [cuentasBancarias, setCuentasBancarias] = useState([]);
  const [cuentas,   setCuentas]   = useState([]);
  const [ccs,       setCcs]       = useState([]);
  const [liqsCerradas, setLiqsCerradas] = useState([]);  // su_liquidaciones cerradas (devengado sueldos)
  const [pagosSueldos, setPagosSueldos] = useState([]);  // pagos de sueldo (nb_movimientos origen sueldos)
  const [rawFin,    setRawFin]    = useState([]);        // financiaciones (planes AFIP + créditos)
  const [socios,    setSocios]    = useState([]);        // maestro de socios (group-level)
  const [sociosCC,  setSociosCC]  = useState([]);        // cuenta corriente de socios no-cash (dividendos + apertura)
  const [rawFranq,  setRawFranq]  = useState({});        // comprobantes de Franquicias (read-only)
  const [intercoData,  setIntercoData]  = useState({ movs: [], comps: [], centros: [] });  // fuentes interco (read-only, todas las sociedades)
  const [sociedades,   setSociedades]   = useState([]);  // maestro sociedades (id→nombre/anillo)
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [loadKey,   setLoadKey]   = useState(0);

  const sedeRef = useRef(null);
  const tabsRef = useRef(null);

  // Click-outside to close sede dropdown
  useEffect(() => {
    if (!sedeOpen) return;
    const handler = (e) => {
      if (sedeRef.current && !sedeRef.current.contains(e.target)) setSedeOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sedeOpen]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true); setError(null);
      try {
        const [eg, ing, movs, cbs, ccList, ctaList, liqsC, pagosS, fin, socs, socsCC] = await Promise.all([
          fetchLineasEnriquecidas(sociedad, ["EGRESO", "GASTO"]).catch(() => []),
          fetchLineasEnriquecidas(sociedad, "INGRESO").catch(() => []),
          fetchMovTesoreria(sociedad).catch(() => []),
          fetchCuentasBancarias().catch(() => []),
          fetchCentrosCosto().catch(() => []),
          fetchCuentas().catch(() => []),
          fetchLiquidacionesCerradas().catch(() => []),
          fetchPagosAnio().catch(() => []),
          fetchFinanciaciones(sociedad).catch(() => []),
          fetchSocios().catch(() => []),
          fetchSociosCC().catch(() => []),
        ]);
        if (cancelled) return;
        setRawEg(eg);
        setRawIn(ing);
        setRawMovs(Array.isArray(movs) ? movs : []);
        setCuentasBancarias(Array.isArray(cbs) ? cbs : []);
        setCcs(Array.isArray(ccList) ? ccList : []);
        setCuentas(Array.isArray(ctaList) ? ctaList : []);
        setLiqsCerradas(Array.isArray(liqsC) ? liqsC : []);
        setPagosSueldos(Array.isArray(pagosS) ? pagosS : []);
        setRawFin(Array.isArray(fin) ? fin : []);
        setSocios(Array.isArray(socs) ? socs : []);
        setSociosCC(Array.isArray(socsCC) ? socsCC : []);
        // Franquicias (read-only) — fuera del Promise.all para NO bloquear Reportes si ese backend tarda.
        fetchComps().then(c => { if (!cancelled && c && typeof c === "object") setRawFranq(c); }).catch(() => {});
        // Intercompañía (read-only) — todas las fuentes (fondeo + transfers) + maestro sociedades (anillo).
        // `fetchIntercoData` ya trae `sociedades`, así que no hace falta un fetch aparte.
        fetchIntercoData().then(d => {
          if (cancelled || !d) return;
          setIntercoData(d);
          if (Array.isArray(d.sociedades)) setSociedades(d.sociedades);
        }).catch(() => {});
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [sociedad, loadKey]);

  const curTab   = TABS.find(t => t.id === activeTab);
  const curLente = LENTES.find(l => l.tabs.includes(activeTab));

  const cuentaMap = useMemo(
    () => new Map((cuentas ?? []).map(c => [c.nombre, c])),
    [cuentas]
  );

  const sedeCCs = useMemo(() => ccs.filter(c => (c.grupo ?? "").toLowerCase() === "operaciones"), [ccs]);

  const ccMap = useMemo(() => new Map(ccs.map(c => [c.id, c])), [ccs]);

  // Sedes agrupadas por `operacion` (lo carga el usuario en nb_centros_costo). La operación es el
  // agrupador (categoría) y la sede la subcategoría → un solo filtro jerárquico. Sin `operacion` → grupo aparte.
  const OP_SIN = "__sin__";
  const gruposSede = useMemo(() => {
    const map = new Map();
    for (const c of sedeCCs) {
      const key = (c.operacion ?? "").trim() || OP_SIN;
      if (!map.has(key)) map.set(key, { id: key, label: key === OP_SIN ? "Sin operación" : key, sedes: [] });
      map.get(key).sedes.push(c);
    }
    return [...map.values()];
  }, [sedeCCs]);

  const resolvedCCSede = useMemo(() => {
    if (selectedSedeCCs.length === 0) return sedeCCs.map(c => c.id);
    return selectedSedeCCs;
  }, [selectedSedeCCs, sedeCCs]);

  // Toggle de un grupo (operación) entero: agrega/saca todas sus sedes de la selección.
  const toggleGrupoSede = (opId) => {
    const ids = (gruposSede.find(g => g.id === opId)?.sedes ?? []).map(c => c.id);
    setSelectedSedeCCs(prev => {
      const allIds = sedeCCs.map(c => c.id);
      const sel = new Set(prev.length === 0 ? allIds : prev);
      const allIn = ids.every(id => sel.has(id));
      ids.forEach(id => allIn ? sel.delete(id) : sel.add(id));
      const next = [...sel];
      return next.length === allIds.length ? [] : next;
    });
  };

  // P&L = UNA lógica de agregación (buildPnL/HQ) + TRES adaptadores ("normalizar y agregar"):
  //   · nb_comprobantes → ya viene en formato {fecha,sociedad,centro_costo,cuenta_contable,total}
  //   · su_liquidaciones → liquidacionToPnLRows lo adapta a ese mismo formato (cuenta "Sueldos")
  //   · nb_movimientos imputados (gasto contado / conciliación contabilizada) → movimientoToPnLRows
  // No es doble lógica: el P&L no sabe de qué libro vino la fila. Decisión: Opción A (su_liquidaciones
  // es la única verdad del sueldo, sin partida doble en nb_comprobantes). Ver memoria project_pnl_sueldos.
  // OJO: nunca sumar nb_movimientos SUELDO acá (eso es caja → Cash Flow; el devengado viene de liquidaciones).
  // movimientoToPnLRows excluye sueldos, transferencias y pagos de factura (esos ya están vía comprobante).
  const salaryRows = useMemo(() => {
    const soc = (sociedad ?? "").toLowerCase();
    return liqsCerradas
      .flatMap(liquidacionToPnLRows)
      .filter(r => !soc || (r.sociedad ?? "").toLowerCase() === soc);
  }, [liqsCerradas, sociedad]);

  const gastoMovRows = useMemo(() => movimientoToPnLRows(rawMovs, sociedad, cuentaMap), [rawMovs, sociedad, cuentaMap]);
  // Cuentas-tarjeta (crédito): sus movimientos no son caja → se excluyen del Cash Flow (la salida real es el pago de la tarjeta).
  const tarjetaIds = useMemo(() => new Set(cuentasBancarias.filter(esCuentaCredito).map(c => c.id)), [cuentasBancarias]);

  // Financiaciones: capital del impuesto (plan AFIP) + interés/IVA/impuestos por cuota (mes a mes).
  const finRows = useMemo(() => financiacionToPnLRows(rawFin, sociedad), [rawFin, sociedad]);

  const egConSueldos = useMemo(() => [...rawEg, ...salaryRows, ...gastoMovRows, ...finRows], [rawEg, salaryRows, gastoMovRows, finRows]);

  // Facturación a franquiciados (read-only) → ingreso del P&L HQ, en el centro HQ de Ventas.
  const ventasCcId = useMemo(
    () => ccs.find(c => (c.grupo ?? "").toLowerCase() === "hq" && normCat(c.categoria_pnl) === "ventas")?.id ?? "",
    [ccs]
  );
  const franqRows = useMemo(
    () => franquiciasIngresoPnLRows(rawFranq, sociedad, ventasCcId),
    [rawFranq, sociedad, ventasCcId]
  );
  const inConFranq = useMemo(() => [...rawIn, ...franqRows], [rawIn, franqRows]);

  const pnlSede = useMemo(
    () => buildPnLSede(inConFranq, egConSueldos, resolvedCCSede, year, monedaPL),
    [inConFranq, egConSueldos, resolvedCCSede, year, monedaPL]
  );
  const pnlHQ = useMemo(
    () => buildPnLHQ(inConFranq, egConSueldos, ccMap, year, monedaPL),
    [inConFranq, egConSueldos, ccMap, year, monedaPL]
  );

  const subSede = useMemo(() => computeSubtotalsSede(pnlSede), [pnlSede]);
  const subHQ   = useMemo(() => computeSubtotalsHQ(pnlHQ), [pnlHQ]);

  const toggleSedeCC = (id) => {
    setSelectedSedeCCs(prev => {
      const allIds = sedeCCs.map(c => c.id);
      if (prev.length === 0) return allIds.filter(x => x !== id);
      if (prev.includes(id)) {
        const next = prev.filter(x => x !== id);
        return next.length === 0 ? [] : next;
      }
      const next = [...prev, id];
      return next.length === allIds.length ? [] : next;
    });
  };

  // ── Loading state ──
  if (loading) return (
    <div style={{ padding: "28px 32px", maxWidth: 1400 }} className="fade">
      <PageHeader title="Reportes" subtitle="Estados financieros y evolución patrimonial" />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "80px 32px", gap: 16 }}>
        <Spinner size={36} />
        <div style={{ fontSize: 14, color: T.muted, fontWeight: 500 }}>Cargando reportes…</div>
      </div>
    </div>
  );

  // ── Error state ──
  if (error) return (
    <div style={{ padding: "28px 32px", maxWidth: 1400 }} className="fade">
      <PageHeader title="Reportes" subtitle="Estados financieros y evolución patrimonial" />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "60px 32px", gap: 16 }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: T.redBg,
          display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={T.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
          </svg>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>Error al cargar reportes</div>
          <div style={{ fontSize: 13, color: T.muted, maxWidth: 400 }}>{error}</div>
        </div>
        <button onClick={() => setLoadKey(k => k + 1)} style={{
          background: T.accentDark, color: T.accent, border: "none", borderRadius: 999,
          padding: "8px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer",
          fontFamily: T.font, letterSpacing: ".03em", marginTop: 4,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 105.64-11.36L1 10"/>
          </svg>
          Reintentar
        </button>
      </div>
    </div>
  );

  const showMonedaPL = activeTab === "pl_sede" || activeTab === "pl_bigg";
  const showMonedaCF = activeTab === "cf";
  // El multiselect de Sedes solo aplica si NO se entró por una operación (esa ya define los centros).
  const showSedes    = activeTab === "pl_sede" && sedeCCs.length > 0;

  // Menú-landing: sin reporte elegido → tarjetas agrupadas por lente (Operaciones = 1 tarjeta x operación).
  if (!activeTab) return (
    <div style={{ padding: "28px 32px", maxWidth: 1400 }} className="fade">
      <PageHeader title="Reportes" subtitle="Elegí un reporte" />
      <ReportesMenu onPick={setActiveTab} />
    </div>
  );

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1400 }} className="fade">

      {/* ── Header del reporte + volver al menú ── */}
      <PageHeader
        title={curTab?.label ?? "Reporte"}
        subtitle={curLente?.label}
        action={
          <button onClick={() => setActiveTab(null)} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "#f3f4f6", border: `1px solid ${T.cardBorder}`, borderRadius: 8,
            color: T.text, fontFamily: T.font, fontSize: 13, fontWeight: 700,
            padding: "8px 16px", cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.background = "#e5e7eb"}
            onMouseLeave={e => e.currentTarget.style.background = "#f3f4f6"}>
            ← Reportes
          </button>
        }
      />

      {/* ── Toolbar / Filters (Consolidado trae la suya propia) ── */}
      {activeTab !== "consolidado" && (
      <div style={{
        display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap", alignItems: "flex-end",
        background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
        padding: "12px 16px", boxShadow: "0 1px 3px rgba(0,0,0,.04)",
      }}>
        {/* Año */}
        <div>
          <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.muted,
            textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 }}>Año</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={selStyle}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {/* Moneda — P&L */}
        {showMonedaPL && (
          <div>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.muted,
              textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 }}>Moneda</label>
            <select value={monedaPL} onChange={e => setMonedaPL(e.target.value)} style={selStyle}>
              {Object.entries(MONEDA_SYM).map(([k, v]) => (
                <option key={k} value={k}>{v} {k}</option>
              ))}
            </select>
          </div>
        )}

        {/* Moneda — CF */}
        {showMonedaCF && (
          <div>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.muted,
              textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 }}>Moneda</label>
            <select value={monedaCF} onChange={e => setMonedaCF(e.target.value)} style={selStyle}>
              {Object.entries(MONEDA_SYM).map(([k, v]) => (
                <option key={k} value={k}>{v} {k}</option>
              ))}
            </select>
          </div>
        )}

        {/* Sedes dropdown — jerárquico: Operación (agrupador) › Sede */}
        {showSedes && (
          <div ref={sedeRef} style={{ position: "relative" }}>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.muted,
              textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 }}>Sedes</label>
            <button onClick={() => setSedeOpen(o => !o)} style={{
              ...selStyle, display: "flex", alignItems: "center", gap: 8, minWidth: 190,
              background: sedeOpen ? "#f0f2f5" : "#eceff3",
            }}>
              <span style={{ flex: 1, textAlign: "left" }}>
                {selectedSedeCCs.length === 0 ? "Todas las Sedes" : `${selectedSedeCCs.length} sede${selectedSedeCCs.length > 1 ? "s" : ""}`}
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.muted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: "transform .15s", transform: sedeOpen ? "rotate(180deg)" : "rotate(0)" }}>
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
            {sedeOpen && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100,
                border: `1px solid ${T.cardBorder}`, borderRadius: 10, background: T.card,
                boxShadow: T.shadowMd, minWidth: 220, fontSize: 13,
                color: T.text, padding: "4px 0", maxHeight: 280, overflowY: "auto",
              }}>
                <div onClick={() => setSelectedSedeCCs([])} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
                  borderBottom: `1px solid ${T.cardBorder}`, cursor: "pointer",
                  userSelect: "none", fontWeight: 600, color: T.text,
                }}>
                  <input type="checkbox" checked={selectedSedeCCs.length === 0} readOnly
                    style={{ pointerEvents: "none", accentColor: T.accentDark }} />
                  Todas
                </div>
                {gruposSede.map(g => {
                  const ids = g.sedes.map(c => c.id);
                  const grpChecked = selectedSedeCCs.length === 0 || ids.every(id => selectedSedeCCs.includes(id));
                  return (
                    <div key={g.id}>
                      {/* Operación = agrupador (seleccionar toda la operación) */}
                      <div onClick={() => toggleGrupoSede(g.id)} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "7px 14px",
                        cursor: "pointer", userSelect: "none", fontWeight: 800, color: T.muted,
                        background: "#f1f5f9", borderTop: `1px solid ${T.cardBorder}`,
                        textTransform: "uppercase", fontSize: 10.5, letterSpacing: ".06em",
                      }}>
                        <input type="checkbox" checked={grpChecked} readOnly
                          style={{ pointerEvents: "none", accentColor: T.accentDark }} />
                        {g.label}
                      </div>
                      {g.sedes.map(cc => {
                        const checked = selectedSedeCCs.length === 0 || selectedSedeCCs.includes(cc.id);
                        return (
                          <div key={cc.id} onClick={() => toggleSedeCC(cc.id)} style={{
                            display: "flex", alignItems: "center", gap: 8, padding: "6px 14px 6px 32px",
                            cursor: "pointer", userSelect: "none", color: T.text, transition: "background .1s",
                          }}
                            onMouseEnter={e => e.currentTarget.style.background = "#eceff3"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                            <input type="checkbox" checked={checked} readOnly
                              style={{ pointerEvents: "none", accentColor: T.accentDark }} />
                            {cc.nombre}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* ── P&L Sedes ── */}
      {activeTab === "pl_sede" && (
        <PnLTableSede pnl={pnlSede} sub={subSede} year={year} moneda={monedaPL}
          label={selectedSedeCCs.length === 0 ? "Todas las Sedes" : `${selectedSedeCCs.length} seleccionada${selectedSedeCCs.length > 1 ? "s" : ""}`} />
      )}

      {/* ── P&L BIGG ── */}
      {activeTab === "pl_bigg" && (
        <PnLTableHQ pnl={pnlHQ} sub={subHQ} year={year} moneda={monedaPL} />
      )}

      {/* ── Cash Flow ── */}
      {activeTab === "cf" && (
        <TabCashFlow rawMovs={rawMovs} year={year} moneda={monedaCF} tarjetaIds={tarjetaIds} />
      )}

      {activeTab === "balance" && (
        <TabBalance
          rawMovs={rawMovs}
          cuentasBancarias={cuentasBancarias}
          rawIn={rawIn}
          rawEg={rawEg}
          sociedad={sociedad}
          liqsCerradas={liqsCerradas}
          pagosSueldos={pagosSueldos}
          rawFin={rawFin}
          socios={socios}
          sociosCC={sociosCC}
        />
      )}

      {activeTab === "evpn" && (
        <TabEvolucionPN
          rawMovs={rawMovs}
          cuentasBancarias={cuentasBancarias}
          rawIn={rawIn}
          rawEg={rawEg}
          sociedad={sociedad}
          year={year}
        />
      )}

      {activeTab === "interco" && (
        <TabInterco data={intercoData} sociedades={sociedades} />
      )}

      {activeTab === "consolidado" && (
        <TabTesoreriaConsolidada />
      )}

    </div>
  );
}
