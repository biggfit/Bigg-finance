import { useState, useMemo, useEffect, useRef } from "react";
import { T, PageHeader } from "./theme";
import { fetchCentrosCosto, fetchMovTesoreria, fetchCuentasBancarias, fetchLineasEnriquecidas, fetchCuentas, esIgnorado, esCuentaCredito, fetchFinanciaciones, financiacionPasivoBuckets, agruparAnticipos, anticipoPasivo, fetchSocios, fetchSociosCC, sociosSaldos, fetchIntercoData, lecturaInterco, calcSaldoPendiente } from "../lib/numbersApi";
import { fetchLiquidacionesCerradas, liquidacionToPnLRows, fetchPagosAnio, pendienteSueldosPorLegajo, adelantoSueldosPorLegajo } from "../lib/sueldosApi";
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
    let total, _tipo;
    if (m.origen === "retencion") {
      total = Math.abs(monto);
      _tipo = "Retención";
    } else {
      const esIngreso = normCat(cuentaMap?.get(nombre)?.categoria_pnl) === "ventas";
      total = esIngreso ? monto : -monto;
      _tipo = esIngreso ? "Ingreso" : "Gasto";
    }
    out.push({
      fecha:           m.fecha,
      sociedad:        m.sociedad,
      centro_costo:    m.centro_costo ?? "",
      cuenta_contable: m.cuenta_contable ?? "",
      moneda:          m.moneda ?? "ARS",
      total,
      _tipo,                                          // para el detalle de Informes (tipo de egreso)
      contraparte_nombre: m.contraparte_nombre ?? "",
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
      if (capTot > 0) out.push({ fecha: p.fecha_consolidacion, sociedad: p.sociedad, centro_costo: p.centro_capital, cuenta_contable: p.cuenta_capital, moneda: p.moneda, total: capTot, _tipo: "Financiación", contraparte_nombre: p.acreedor_nombre ?? "" });
    }
    const base = { sociedad: p.sociedad, moneda: p.moneda, _tipo: "Financiación", contraparte_nombre: p.acreedor_nombre ?? "" };
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
const fmtSigned = n => !n ? "—" : (n < 0 ? "−" : "") + fmtN(n);   // conserva el signo (fmtN es absoluto)

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
  // NOTA: NO usar `will-change: transform` acá. Promueve la celda a su propia capa de composición y en
  // pantallas con DPR fraccional (ej. 1.25) su borde rasteriza ~1px corrido respecto de las celdas de
  // valores → los bordes gruesos (Resultado/Subtotal) se ven escalonados bajo la columna "Cuenta".
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
      {/* Repetir el borde inferior en la celda sticky: su background repinta y taparía la línea del <tr>. */}
      <td style={{ padding: "7px 16px 7px 44px", fontSize: 13, color: T.text, whiteSpace: "nowrap",
        borderBottom: `1px solid ${T.cardBorder}`,
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
        // Repetir el borde en la celda sticky: su background la repinta y taparía la línea del <tr>.
        borderTop: `${strong ? 3 : 2}px solid ${color ?? T.cardBorder}`,
        borderBottom: `2px solid ${T.cardBorder}`,
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
        // Repetir el borde en la celda sticky: su background la repinta y taparía la línea del <tr>.
        borderTop: `${strong ? 3 : 2}px solid ${color}`,
        borderBottom: strong ? `2px solid ${color}` : "none",
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
  { key: "gp_ocup",   label: "Ocupación",                color: SEDE_HDR, cuentas: ["Alquiler", "Expensas", "ABL", "Servicios"] },
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

// ─── Cesión de utilidades (apropiación del resultado, DEBAJO de Resultado Final) ────────────────
// Hektor cede el 49% del resultado de Barrio Norte a una contraparte (NO es gasto: es reparto del
// resultado). Los retiros se imputan a la cuenta "Inversores" (hoy caen en "Sin clasificar"). v1 read-only:
// muestra acreditado (pct×resFinal) − retirado (mov. "Inversores") = saldo de cuenta corriente acumulado.
// apertura = saldo heredado de Contagram al 30/6 (deuda con la contraparte; >0 = le debemos). Se siembra en
// `aperturaMes` (5 = junio, corte de go-live): ya incluye todo lo previo, así que julio lo hereda y acumula.
const CESION = { matchNombre: "Barrio Norte", pct: 0.49, contraparte: "", apertura: 15_500_000, aperturaMes: 5 };
const CESION_CUENTA = "Inversores";   // cuenta contable donde se imputan los retiros

// Helper puro: dado el resFinal[12] de la sede y los retiros[12] (cuenta "Inversores"), arma la cola.
function computeCesion(resFinal = [], retiros = [], { pct, apertura = 0, aperturaMes = 0 }) {
  const acreditado = Array.from({ length: 12 }, (_, m) => (Number(resFinal[m]) || 0) * pct);
  const retenido   = Array.from({ length: 12 }, (_, m) => (Number(resFinal[m]) || 0) * (1 - pct));
  // El retiro es un egreso (viene con signo negativo): tomamos la magnitud pagada, que REDUCE lo que se debe.
  const retirado   = Array.from({ length: 12 }, (_, m) => Math.abs(Number(retiros[m]) || 0));
  // La CC arranca en `aperturaMes` con el saldo heredado (que ya incluye todo lo previo); los meses anteriores
  // quedan sin saldo (null). Desde ahí acumula (acreditado − retirado). >0 = le debemos · <0 = adelantado.
  const saldoAcum = new Array(12).fill(null); let acc = 0;
  for (let m = aperturaMes; m < 12; m++) {
    acc = m === aperturaMes ? (Number(apertura) || 0) : acc + acreditado[m] - retirado[m];
    saldoAcum[m] = acc;
  }
  return { acreditado, retirado, saldoAcum, retenido };
}

// Cola de impuestos (Fondeadas/Rosedal): cuentas de "Sin clasificar" cuyo nombre matchea `matchers`
// (IVA, Ganancias…) → líneas de impuesto + Resultado Neto/FCF = resFinal − Σ impuestos. null si no hay.
function computeImpuestos(sinClasificar, matchers, resFinal) {
  const keys = Object.keys(sinClasificar).filter(k => matchers.some(m => _nkSede(k).includes(_nkSede(m))));
  if (!keys.length) return null;
  const byAcc = keys.map(k => ({ name: k, cur: sinClasificar[k] }));
  const total = Array.from({ length: 12 }, (_, m) => byAcc.reduce((s, a) => s + (Number(a.cur[m]) || 0), 0));
  const resNeto = resFinal.map((v, m) => (Number(v) || 0) - total[m]);
  return { keys, byAcc, resNeto };
}

// ─── Negocios por sociedad (además de Argentina núcleo): mismo P&L de sede, scopeado a UNA sociedad
// (por `empresa` + `familia` del centro) y su moneda, + una cola de IMPUESTOS debajo del Resultado
// Operativo → línea final (`netoLabel`). Los impuestos salen de "Sin clasificar". Empezamos por IVA + Ganancias.
//   · Fondeadas (anillo 2, familia "propios"): España/Colombia/Puertos → "Resultado Neto".
//   · Administrada (anillo 3, familia "gerenciamiento"): Rosedal → "Free Cash Flow" (base del reparto con Segui).
// (Huergo NO entra acá: es anillo 1, sin cola de impuestos.)
const FONDEADAS = {
  op_espana:   { empresa: "wellness",   moneda: "EUR", label: "España",   familia: "propios" },
  op_colombia: { empresa: "tigre-loco", moneda: "COP", label: "Colombia", familia: "propios" },
  op_puertos:  { empresa: "puertos",    moneda: "USD", label: "Puertos",  familia: "propios" },
  op_rosedal:  { empresa: "segui-fit",  moneda: "ARS", label: "Rosedal",  familia: "gerenciamiento", netoLabel: "Free Cash Flow" },
};
const IMPUESTOS_FOND = ["IVA", "Ganancias"];   // match por nombre de cuenta (incluye)

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

// ─── Vistas de tiempo del P&L Sedes (mismas filas, distinto bloque de columnas) ─────
const VISTAS_SEDE = [
  { id: "evolucion", label: "Evolución mensual" },
  { id: "mensual",   label: "Mensual" },
  { id: "ytd",       label: "YTD" },
];
function VistaToggle({ value, onChange }) {
  return (
    <div style={{ display: "inline-flex", gap: 2, background: "#f3f4f6", borderRadius: 9, padding: 3 }}>
      {VISTAS_SEDE.map(v => {
        const active = value === v.id;
        return (
          <button key={v.id} onClick={() => onChange(v.id)} style={{
            background: active ? T.accentDark : "transparent", border: "none", borderRadius: 7,
            color: active ? T.accent : T.muted, fontFamily: T.font, fontSize: 12.5,
            fontWeight: active ? 800 : 600, padding: "6px 14px", cursor: "pointer", transition: "all .15s ease" }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#e5e7eb"; }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
            {v.label}
          </button>
        );
      })}
    </div>
  );
}

const ZERO12 = new Array(12).fill(0);
const sumTo = (arr, m) => { let s = 0; for (let i = 0; i <= m && i < 12; i++) s += Number(arr?.[i]) || 0; return s; };
const primaryVal = (vista, arr, mes) =>
  vista === "ytd" ? sumTo(arr, mes)
  : vista === "mensual" ? (Number(arr?.[mes]) || 0)
  : (arr || []).reduce((s, v) => s + (Number(v) || 0), 0);

// Columnas de las vistas comparativas (mensual / ytd). Cada col: {header, kind:"val"|"var", get|a,b}.
function colsSedeVista(vista, mes, year) {
  const m1 = (c, p) => mes > 0 ? (Number(c[mes - 1]) || 0) : (Number(p?.[11]) || 0);   // M-1 (enero → dic año ant.)
  if (vista === "ytd") return [
    { header: `YTD ${year}`,     kind: "val", get: c => sumTo(c, mes) },
    { header: `YTD ${year - 1}`, kind: "val", get: (c, p) => sumTo(p, mes) },
    { header: "Var%",            kind: "var", a: c => sumTo(c, mes), b: (c, p) => sumTo(p, mes) },
  ];
  return [   // mensual
    { header: MESES[mes],       kind: "val", get: c => Number(c[mes]) || 0 },
    { header: "Mes ant.",       kind: "val", get: (c, p) => m1(c, p) },
    { header: "Var%",           kind: "var", a: c => Number(c[mes]) || 0, b: (c, p) => m1(c, p) },
    { header: `${MESES[mes]} ${year - 1}`, kind: "val", get: (c, p) => Number(p?.[mes]) || 0 },
    { header: "Var%",           kind: "var", a: c => Number(c[mes]) || 0, b: (c, p) => Number(p?.[mes]) || 0 },
  ];
}
// Columnas de la vista Evolución: una por mes activo + TOTAL (marcada con `total` para el separador/stock).
const colsEvolucion = months => [
  ...months.map(m => ({ header: MESES[m], kind: "val", get: c => Number(c[m]) || 0 })),
  { header: "TOTAL", kind: "val", total: true, get: c => (c || []).reduce((s, v) => s + (Number(v) || 0), 0) },
];

// Celdas de una fila. o = estilo base. o.bt/o.bb = borde sup/inf (se pone EN LA CELDA, no en el <tr>:
// con border-collapse los bordes del <tr> no pintan confiablemente sobre las celdas).
function celdasSede(cols, cur, prev, pol, o) {
  const bord = { ...(o.bt ? { borderTop: o.bt } : {}), ...(o.bb ? { borderBottom: o.bb } : {}) };
  return cols.map((col, i) => {
    if (col.kind === "var") {
      const a = col.a(cur, prev), b = col.b(cur, prev), d = a - b;
      const pct = b ? d / b * 100 : null;
      // flecha por signo crudo; color por MEJORA (polaridad: ingresos/resultados +1, costos −1).
      const color = pct == null ? T.dim : (d * pol > 0 ? T.green : d * pol < 0 ? T.red : T.dim);
      return <td key={i} style={{ padding: o.pad, fontSize: (o.fs || 13) - 1, textAlign: "right",
        fontFamily: "var(--mono)", fontWeight: 700, color, whiteSpace: "nowrap", ...bord,
        ...(col.total ? { borderLeft: `1px solid ${T.cardBorder}` } : {}) }}>
        {pct == null ? "—" : `${d > 0 ? "↑" : d < 0 ? "↓" : ""}${Math.abs(pct).toFixed(1)}%`}</td>;
    }
    const v = col.get(cur, prev);
    const color = o.bySign ? (v > 0 ? T.green : v < 0 ? T.red : T.dim) : (v ? (o.color || T.text) : T.dim);
    return <td key={i} style={{ padding: o.pad, fontSize: o.fs || 13, textAlign: "right",
      fontFamily: "var(--mono)", fontWeight: o.fw || 400, color, whiteSpace: "nowrap", ...bord,
      ...(col.total ? { borderLeft: `1px solid ${T.cardBorder}` } : {}) }}>
      {v ? fmtN(v) : "—"}</td>;
  });
}

function PnLTableSede({ pnl, sub, pnlPrev, subPrev, year, moneda, label, vista = "evolucion", mes = 0, cesion = null, impuestos = null, netoLabel = "Resultado Neto" }) {
  const { totIngresos, margenContrib, totGastosOp, resOp, resFinal, activeMonths } = sub;

  // Cesión de utilidades (cola de apropiación, solo cuando el scope es la sede con cesión, ej. Barrio Norte).
  // Los retiros son la cuenta "Inversores" de sinClasificar → se saca de ahí para no mostrarla dos veces.
  const cesKey = cesion && Object.keys(pnl.sinClasificar).find(k => _nkSede(k) === _nkSede(CESION_CUENTA));
  const cesData = cesion ? computeCesion(resFinal, cesKey ? pnl.sinClasificar[cesKey] : [], cesion) : null;

  // Impuestos (Fondeadas/Rosedal): cola debajo del Resultado Operativo/Final. Las cuentas se sacan de
  // "Sin clasificar" (no duplicar) → ver computeImpuestos.
  const impData = impuestos ? computeImpuestos(pnl.sinClasificar, impuestos, resFinal) : null;

  const hidden = new Set([cesKey, ...(impData?.keys || [])].filter(Boolean));
  const sinClasView = hidden.size
    ? Object.fromEntries(Object.entries(pnl.sinClasificar).filter(([k]) => !hidden.has(k)))
    : pnl.sinClasificar;

  // Colapso jerárquico: bandas de sección (Ingresos / Gastos Op) + cada sub-grupo + toggle maestro.
  const ALLKEYS = ["sec_ing", "sec_gop", ...SEDE_GRUPOS.map(g => g.key)];
  const [collapsed, setCollapsed] = useState({});
  const isCol  = k => !!collapsed[k];
  const toggle = k => setCollapsed(c => ({ ...c, [k]: !c[k] }));
  const allCol = ALLKEYS.every(k => collapsed[k]);
  const toggleAll = () => setCollapsed(allCol ? {} : Object.fromEntries(ALLKEYS.map(k => [k, true])));

  const sinCls = Object.keys(sinClasView).length > 0;

  if (activeMonths.length === 0) return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      padding: "60px 24px", textAlign: "center", boxShadow: T.shadow }}>
      <div style={{ fontSize: 14, color: T.muted }}>Sin datos para {year} en {moneda}{label ? ` · ${label}` : ""}.</div>
    </div>
  );

  // ── Un solo render para las 3 vistas: MISMAS filas, distinto bloque de columnas (cols) ──
  {
    const cols = vista === "evolucion" ? colsEvolucion(activeMonths) : colsSedeVista(vista, mes, year);
    const lastM = activeMonths[activeMonths.length - 1];
    const Pg = pnlPrev?.grupos || {};
    const stP = k => (subPrev?.st?.[k]) || ZERO12;
    const filas = [];
    const pushGrupo = (gk, pol) => {
      filas.push({ kind: "grupo", key: gk, label: grupoSede(gk).label, cur: sub.st[gk], prev: stP(gk), pol });
      if (!isCol(gk)) for (const name of grupoSede(gk).cuentas)
        filas.push({ kind: "cuenta", label: name, cur: pnl.grupos[gk][name], prev: (Pg[gk]?.[name] || ZERO12), pol });
    };
    filas.push({ kind: "banda", key: "sec_ing", label: "Ingresos" });
    if (!isCol("sec_ing")) { pushGrupo("vta_cf", 1); pushGrupo("int_bigg", 1); pushGrupo("int_corp", 1); }
    filas.push({ kind: "subtotal", label: "Total Ingresos", cur: totIngresos, prev: subPrev.totIngresos, pol: 1, strong: true });
    pushGrupo("cvar", -1);
    filas.push({ kind: "result", label: "Margen de Contribución", cur: margenContrib, prev: subPrev.margenContrib, pol: 1 });
    filas.push({ kind: "banda", key: "sec_gop", label: "Gastos Operativos" });
    if (!isCol("sec_gop")) { pushGrupo("gp_pers", -1); pushGrupo("gp_ocup", -1); pushGrupo("gp_mkt", -1); pushGrupo("gp_otros", -1); }
    filas.push({ kind: "subtotal", label: "Total Gastos Operativos", cur: totGastosOp, prev: subPrev.totGastosOp, pol: -1 });
    filas.push({ kind: "result", label: "Resultado Operativo", cur: resOp, prev: subPrev.resOp, pol: 1 });
    pushGrupo("com_res", -1);
    pushGrupo("inv_no_op", -1);
    filas.push({ kind: "result", label: "Resultado Final", cur: resFinal, prev: subPrev.resFinal, pol: 1 });

    // Impuestos (Fondeadas): cola debajo del Resultado Operativo/Final → Resultado Neto. Es P&L (flujos) →
    // se muestra en las 3 vistas.
    if (impData) {
      filas.push({ kind: "banda", label: "Impuestos" });
      for (const a of impData.byAcc) filas.push({ kind: "cuenta", label: a.name, cur: a.cur, prev: ZERO12, pol: -1 });
      filas.push({ kind: "result", label: netoLabel, cur: impData.resNeto, prev: ZERO12, pol: 1 });
    }

    // Cesión de utilidades (apropiación del resultado; NO afecta Resultado Final). Es una cuenta corriente
    // (serie de tiempo) → solo en Evolución; comparar un saldo corriente M-1/A-1/YTD no tiene sentido.
    if (cesData && vista === "evolucion") {
      filas.push({ kind: "spacer" });
      filas.push({ kind: "cesion", bold: true, top: true, signed: true, cur: cesData.acreditado,
        label: `Cesión de utilidades — ${Math.round(cesion.pct * 100)}%${cesion.contraparte ? ` · ${cesion.contraparte}` : ""} (acreditado)` });
      filas.push({ kind: "cesion", cur: cesData.retirado, label: "Retiros del período (cuenta Inversores)" });
      filas.push({ kind: "cesion", signed: true, stock: true, cur: cesData.saldoAcum, label: "Saldo cuenta corriente (acumulado)" });
      filas.push({ kind: "result", label: "Resultado retenido BIGG", cur: cesData.retenido, prev: ZERO12, pol: 1 });
    }
    // Sin clasificar (cuentas con movimiento fuera del P&L de la sede) — solo en Evolución (diagnóstico).
    if (sinCls && vista === "evolucion") {
      filas.push({ kind: "spacer" });
      filas.push({ kind: "banda", amber: true, label: "Sin clasificar (fuera del P&L de la sede)" });
      for (const [name, arr] of Object.entries(sinClasView))
        filas.push({ kind: "cuenta", label: name, cur: arr, prev: ZERO12, pol: 1, color: "#b45309" });
    }

    // Celdas de una fila de cesión (violeta, con signo). Stock (saldo) → la col TOTAL muestra el saldo final.
    const cesionCells = (f) => cols.map((col, i) => {
      if (col.kind === "var") return <td key={i} style={{ padding: "9px 12px", textAlign: "right", color: T.dim }}>—</td>;
      const v = f.stock && col.total ? (f.cur[lastM] ?? 0) : col.get(f.cur);
      return <td key={i} style={{ padding: "9px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--mono)",
        fontWeight: f.bold ? 800 : 700, color: "#6d28d9", whiteSpace: "nowrap",
        ...(col.total ? { borderLeft: `1px solid ${T.cardBorder}` } : {}) }}>{f.signed ? fmtSigned(v) : fmtN(v)}</td>;
    });

    return (
      <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
        boxShadow: T.shadow, overflowX: "auto", position: "relative" }}>
        <table style={{ width: "100%", borderCollapse: "collapse",
          ...(vista === "evolucion"
            ? { minWidth: 230 + activeMonths.length * 122 + 150, tableLayout: "fixed" }
            : { minWidth: 260 + cols.length * 120 }) }}>
          {vista === "evolucion" && (
            <colgroup>
              <col style={{ width: 230 }} />
              {activeMonths.map(m => <col key={m} style={{ width: 122 }} />)}
              <col style={{ width: 150 }} />
            </colgroup>
          )}
          <thead><tr>
            <th onClick={toggleAll} title="Contraer / expandir todo" style={{ ...thStyle, textAlign: "left",
              whiteSpace: "nowrap", cursor: "pointer", userSelect: "none", ...stickyCol,
              background: T.tableHead, zIndex: 4 }}>
              <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{allCol ? "▶" : "▼"}</span>Cuenta
            </th>
            {cols.map((c, i) => <th key={i} style={{ ...thStyle, ...(c.total ? { borderLeft: "1px solid rgba(255,255,255,.12)" } : {}) }}>{c.header}</th>)}
          </tr></thead>
          <tbody>
            {filas.map((f, idx) => {
              if (f.kind === "spacer")
                return <tr key={idx}><td colSpan={cols.length + 1} style={{ height: 16, background: "#f8fafc", borderTop: `2px solid ${T.cardBorder}` }} /></tr>;
              if (f.kind === "banda") {
                if (f.amber) return (
                  <tr key={idx} style={{ background: "#fffbeb" }}>
                    <td style={{ padding: "6px 16px", fontSize: 10, fontWeight: 800, color: "#b45309", letterSpacing: ".12em",
                      textTransform: "uppercase", ...stickyCol, background: "#fffbeb" }}>{f.label}</td>
                    <td colSpan={cols.length} style={{ background: "#fffbeb" }} />
                  </tr>
                );
                return <BandaRow key={idx} label={f.label} span={cols.length + 1}
                  expanded={f.key ? !isCol(f.key) : true} onToggle={f.key ? () => toggle(f.key) : undefined} />;
              }
              if (f.kind === "grupo") return (
                <tr key={idx} onClick={() => toggle(f.key)} style={{ background: "#f1f5f9", borderTop: `1px solid ${T.cardBorder}`, cursor: "pointer" }}>
                  <td style={{ padding: "7px 14px", fontSize: 10.5, fontWeight: 800, color: T.muted, textTransform: "uppercase",
                    letterSpacing: ".06em", userSelect: "none", ...stickyCol, background: "#f1f5f9" }}>
                    <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{isCol(f.key) ? "▶" : "▼"}</span>{f.label}
                  </td>
                  {celdasSede(cols, f.cur, f.prev, f.pol, { pad: "7px 12px", fs: 12, fw: 800, color: SEDE_HDR })}
                </tr>
              );
              if (f.kind === "cuenta") return (
                <tr key={idx} style={{ borderBottom: `1px solid ${T.cardBorder}`, background: T.card }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#f0f9ff"; e.currentTarget.firstChild.style.background = "#f0f9ff"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = T.card; e.currentTarget.firstChild.style.background = T.card; }}>
                  <td style={{ padding: "6px 14px 6px 32px", fontSize: 13, color: f.color || T.text, whiteSpace: "nowrap",
                    borderBottom: `1px solid ${T.cardBorder}`, ...stickyCol, background: T.card }}>{f.label}</td>
                  {celdasSede(cols, f.cur, f.prev, f.pol, { pad: "6px 12px", fs: 13, fw: 400, color: f.color || SEDE_HDR })}
                </tr>
              );
              if (f.kind === "cesion") {
                const bg = "#faf5ff", top = f.top ? { borderTop: "2px solid #7c3aed" } : {};
                return (
                  <tr key={idx} style={{ background: bg, borderBottom: `1px solid ${T.cardBorder}`, ...top }}>
                    <td style={{ padding: f.bold ? "10px 16px" : "9px 16px 9px 44px", fontSize: f.bold ? 14 : 13, fontWeight: f.bold ? 800 : 700,
                      color: "#6d28d9", whiteSpace: "nowrap", borderBottom: `1px solid ${T.cardBorder}`, ...top, ...stickyCol, background: bg }}>{f.label}</td>
                    {cesionCells(f)}
                  </tr>
                );
              }
              if (f.kind === "subtotal") {
                const bg = f.strong ? "#cbd5e1" : "#f3f4f6";
                return (
                  <tr key={idx} style={{ background: bg, borderTop: `${f.strong ? 3 : 2}px solid ${SEDE_HDR}`, borderBottom: `2px solid ${T.cardBorder}` }}>
                    <td style={{ padding: "12px 14px", fontSize: f.strong ? 15 : 14, fontWeight: 900, color: SEDE_HDR,
                      borderTop: `${f.strong ? 3 : 2}px solid ${SEDE_HDR}`, borderBottom: `2px solid ${T.cardBorder}`, ...stickyCol, background: bg }}>{f.label}</td>
                    {celdasSede(cols, f.cur, f.prev, f.pol, { pad: "12px 12px", fs: f.strong ? 15 : 14, fw: 900, color: SEDE_HDR,
                      bt: `${f.strong ? 3 : 2}px solid ${SEDE_HDR}`, bb: `2px solid ${T.cardBorder}` })}
                  </tr>
                );
              }
              const pv = primaryVal(vista, f.cur, mes), rc = pv >= 0 ? T.green : T.red, rbg = pv >= 0 ? "#bbf7d0" : "#fecaca";
              return (
                <tr key={idx} style={{ background: rbg, borderTop: `3px solid ${rc}`, borderBottom: `2px solid ${rc}` }}>
                  <td style={{ padding: "12px 14px", fontSize: 15, fontWeight: 900, color: rc,
                    borderTop: `3px solid ${rc}`, borderBottom: `2px solid ${rc}`, ...stickyCol, background: rbg }}>{f.label}</td>
                  {celdasSede(cols, f.cur, f.prev, f.pol, { pad: "12px 12px", fs: 15, fw: 900, bySign: true,
                    bt: `3px solid ${rc}`, bb: `2px solid ${rc}` })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {sinCls && vista === "evolucion" && (
          <div style={{ padding: "8px 16px", fontSize: 11, color: "#92400e", background: "#fffbeb", borderTop: "1px solid #fcd34d" }}>
            Estas cuentas tienen movimientos en la sede pero no están asignadas a ninguna línea del P&L.
            Revisá si corresponde re-imputarlas o agregarlas a la estructura.
          </div>
        )}
      </div>
    );
  }
}

// ─── P&L HUERGO (Wellness Real Estate, anillo 1) — negocio de MARGEN, no sede ──────────────────────
// Estructura simple (no waterfall de sede): Ingresos (lo que paga el edificio) − Costos (horas de coaches)
// = Margen. Agrupa dinámico por cuenta: inRows→Ingresos, egRows→Costos (así no hay que hardcodear cuentas).
function buildPnLHuergo(inRows, egRows, ccFilter, year, moneda) {
  const ingresos = {}, costos = {};
  const add = (rows, bucket) => {
    for (const row of rows) {
      if (!row.fecha || row.fecha.slice(0, 4) !== String(year)) continue;
      if ((row.moneda ?? "ARS") !== moneda) continue;
      const cc = row.centro_costo ?? "";
      if (!(Array.isArray(ccFilter) ? ccFilter.includes(cc) : cc === ccFilter)) continue;
      const m = parseInt(row.fecha.slice(5, 7), 10) - 1; if (m < 0 || m > 11) continue;
      const nombre = (row.cuenta_contable ?? "").trim() || "Sin cuenta";
      (bucket[nombre] ??= new Array(12).fill(0))[m] += Number(row.total) || 0;
    }
  };
  add(inRows, ingresos); add(egRows, costos);
  return { ingresos, costos };
}
function computeSubtotalsHuergo(pnl) {
  const sumB = obj => MESES.map((_, m) => Object.values(obj).reduce((s, a) => s + (a[m] || 0), 0));
  const totIng = sumB(pnl.ingresos), totCos = sumB(pnl.costos);
  const margen = totIng.map((v, m) => v - totCos[m]);
  const months = new Set(); const curM = new Date().getMonth();
  for (let i = 0; i <= curM; i++) months.add(i);
  [pnl.ingresos, pnl.costos].forEach(o => Object.values(o).forEach(a => a.forEach((v, i) => { if (v) months.add(i); })));
  return { totIng, totCos, margen, activeMonths: [...months].sort((a, b) => a - b) };
}
function PnLTableHuergo({ pnl, sub, pnlPrev, subPrev, year, moneda, vista = "evolucion", mes = 0 }) {
  const { totIng, totCos, margen, activeMonths } = sub;
  if (activeMonths.length === 0) return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      padding: "60px 24px", textAlign: "center", boxShadow: T.shadow }}>
      <div style={{ fontSize: 14, color: T.muted }}>Sin datos para {year} en {moneda}.</div>
    </div>
  );
  const cols = vista === "evolucion" ? colsEvolucion(activeMonths) : colsSedeVista(vista, mes, year);
  const Pi = pnlPrev?.ingresos || {}, Pc = pnlPrev?.costos || {};
  const filas = [{ kind: "banda", label: "Ingresos" }];
  for (const [n, a] of Object.entries(pnl.ingresos)) filas.push({ kind: "cuenta", label: n, cur: a, prev: Pi[n] || ZERO12, pol: 1 });
  filas.push({ kind: "subtotal", strong: true, label: "Total Ingresos", cur: totIng, prev: subPrev.totIng, pol: 1 });
  filas.push({ kind: "banda", label: "Costos (horas de coaches)" });
  for (const [n, a] of Object.entries(pnl.costos)) filas.push({ kind: "cuenta", label: n, cur: a, prev: Pc[n] || ZERO12, pol: -1 });
  filas.push({ kind: "subtotal", label: "Total Costos", cur: totCos, prev: subPrev.totCos, pol: -1 });
  filas.push({ kind: "result", label: "Margen", cur: margen, prev: subPrev.margen, pol: 1 });

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      boxShadow: T.shadow, overflowX: "auto", position: "relative" }}>
      <table style={{ width: "100%", borderCollapse: "collapse",
        ...(vista === "evolucion" ? { minWidth: 230 + activeMonths.length * 122 + 150, tableLayout: "fixed" } : { minWidth: 260 + cols.length * 120 }) }}>
        {vista === "evolucion" && (
          <colgroup><col style={{ width: 230 }} />{activeMonths.map(m => <col key={m} style={{ width: 122 }} />)}<col style={{ width: 150 }} /></colgroup>
        )}
        <thead><tr>
          <th style={{ ...thStyle, textAlign: "left", whiteSpace: "nowrap", ...stickyCol, background: T.tableHead, zIndex: 4 }}>Cuenta</th>
          {cols.map((c, i) => <th key={i} style={{ ...thStyle, ...(c.total ? { borderLeft: "1px solid rgba(255,255,255,.12)" } : {}) }}>{c.header}</th>)}
        </tr></thead>
        <tbody>
          {filas.map((f, idx) => {
            if (f.kind === "banda") return <BandaRow key={idx} label={f.label} span={cols.length + 1} expanded onToggle={undefined} />;
            if (f.kind === "cuenta") return (
              <tr key={idx} style={{ borderBottom: `1px solid ${T.cardBorder}`, background: T.card }}>
                <td style={{ padding: "6px 14px 6px 32px", fontSize: 13, color: T.text, whiteSpace: "nowrap",
                  borderBottom: `1px solid ${T.cardBorder}`, ...stickyCol, background: T.card }}>{f.label}</td>
                {celdasSede(cols, f.cur, f.prev, f.pol, { pad: "6px 12px", fs: 13, fw: 400, color: SEDE_HDR })}
              </tr>
            );
            if (f.kind === "subtotal") {
              const bg = f.strong ? "#cbd5e1" : "#f3f4f6";
              return (
                <tr key={idx} style={{ background: bg, borderTop: `${f.strong ? 3 : 2}px solid ${SEDE_HDR}`, borderBottom: `2px solid ${T.cardBorder}` }}>
                  <td style={{ padding: "12px 14px", fontSize: f.strong ? 15 : 14, fontWeight: 900, color: SEDE_HDR,
                    borderTop: `${f.strong ? 3 : 2}px solid ${SEDE_HDR}`, borderBottom: `2px solid ${T.cardBorder}`, ...stickyCol, background: bg }}>{f.label}</td>
                  {celdasSede(cols, f.cur, f.prev, f.pol, { pad: "12px 12px", fs: f.strong ? 15 : 14, fw: 900, color: SEDE_HDR,
                    bt: `${f.strong ? 3 : 2}px solid ${SEDE_HDR}`, bb: `2px solid ${T.cardBorder}` })}
                </tr>
              );
            }
            const pv = primaryVal(vista, f.cur, mes), rc = pv >= 0 ? T.green : T.red, rbg = pv >= 0 ? "#bbf7d0" : "#fecaca";
            return (
              <tr key={idx} style={{ background: rbg, borderTop: `3px solid ${rc}`, borderBottom: `2px solid ${rc}` }}>
                <td style={{ padding: "12px 14px", fontSize: 15, fontWeight: 900, color: rc,
                  borderTop: `3px solid ${rc}`, borderBottom: `2px solid ${rc}`, ...stickyCol, background: rbg }}>{f.label}</td>
                {celdasSede(cols, f.cur, f.prev, f.pol, { pad: "12px 12px", fs: 15, fw: 900, bySign: true, bt: `3px solid ${rc}`, bb: `2px solid ${rc}` })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── P&L BIGG CONSOLIDADO (sedes propias + HQ + franquicias) — Etapa 1: hasta Margen Bruto ──
// DATA-DRIVEN: el subgrupo sale de columnas que el usuario mantiene en Maestros, sin listas de cuentas
// hardcodeadas. Dos dimensiones:
//   · FAMILIA ← `operacion`/`grupo` del centro (nb_centros_costo): propios / gerenciamiento / wre / hq.
//   · SECCIÓN ← `categoria_pnl` de la cuenta (nb_cuentas): "Ventas"=ingreso · "Costo por Venta"=Gastos
//     por Ventas · (Gastos Operativos/Financieros/Impuestos = debajo de Margen Bruto → Etapa 2).
//   · Dentro de sedes propias, Venta vs Interuso ← `categoria_pnl_sede` ("Ventas" vs "Otros Ingresos").
// El lado (ingreso/costo) de una fila de egRows se deduce de su categoria_pnl (la venta de sede llega
// firmada como ingreso dentro de egRows). Las franquicias (inRows) son siempre ingreso.
const BIGG_GRUPOS = [
  { key: "vta_sp", label: "Venta Sedes Propias" },
  { key: "int_sp", label: "Interusos Sedes Propias" },
  { key: "ger",    label: "Ingreso Gerenciamiento Sedes" },
  { key: "wre",    label: "Ingreso Wellness Real Estate" },
  { key: "hq",     label: "Ingreso HQ" },
  { key: "gpv",    label: "Gastos por Ventas" },
  // Debajo de Margen Bruto (Etapa 2): gastos por CENTRO de costo, seccionados por categoría de la cuenta.
  { key: "gsp",    label: "Gastos Sedes Propias" },   // opex de sedes propias, una sola línea
  { key: "ghq",    label: "Gastos HQ" },               // filas = centros HQ (Sport, Tecnología, …)
  { key: "fin",    label: "Financieros" },             // Intereses Ganados − Pérdidas Financieras
  { key: "imp",    label: "Impuestos" },               // IVA, Ganancias, Plan AFIP…
];
// Orden de las cuentas dentro de cada subgrupo (display; las que no figuran van al final, alfabéticas).
// Hardcodeado a propósito: es presentación, bajo riesgo (un nombre que no matchea solo se ordena último).
const BIGG_ORDEN = [
  "Regalias s/Ventas", "Licencia Uso de Marca", "Equipamientos", "Coorporativos (Gympass)",
  "APP (Gympass)", "Sponsor", "Acciones de Mkt", "Otros Ingresos",
];

// Familia del centro (dimensión que separa los subgrupos). Devuelve null si no clasifica.
function familiaCentro(cc) {
  if (!cc) return null;
  const grupo = (cc.grupo ?? "").toLowerCase();
  const op    = (cc.operacion ?? "").trim();
  if (grupo === "hq") return "hq";
  if (grupo === "inversiones") return "wre";           // Puertos (hasta que tenga operacion propia)
  if (/^propios/i.test(op)) return "propios";
  if (op === "Sedes Administradas") return "gerenciamiento";
  if (op === "Wellness Real Estate") return "wre";
  return null;
}
const FAM_A_ING = { gerenciamiento: "ger", wre: "wre", hq: "hq" };   // familia → subgrupo de ingreso (salvo propios)

// Consolida SOLO anillo 1 (Núcleo): la operación propia + los fees que gana el núcleo operando lo de
// otros. Las fondeadas (anillo 2: España/Colombia/Puertos) y administradas (anillo 3: Rosedal) NO se
// consolidan línea por línea — su P&L es de esa sociedad; al núcleo solo le entra el fee (cargado en
// una sociedad núcleo). Un centro sin `empresa` (HQ/transversal) cuenta como núcleo.
function buildPnLBigg(inRows, egRows, ccMap, cuentaMap, nucleoEmpresas, year, moneda) {
  const grupos = {}; for (const g of BIGG_GRUPOS) grupos[g.key] = {};
  const sinClasificar = {};
  const add = (rows, forcedSide) => {
    for (const row of rows) {
      if (!row.fecha || row.fecha.slice(0, 4) !== String(year)) continue;
      if ((row.moneda ?? "ARS") !== moneda) continue;
      const m = parseInt(row.fecha.slice(5, 7), 10) - 1;
      if (m < 0 || m > 11) continue;
      const cc = ccMap.get(row.centro_costo ?? "");
      const emp = (cc?.empresa ?? "").trim();
      if (emp && !nucleoEmpresas.has(emp)) continue;   // fuera del núcleo (anillo 2/3) → no consolida
      const fam = familiaCentro(cc);
      const cuenta = (row.cuenta_contable ?? "").trim() || "Sin cuenta";
      const meta = cuentaMap?.get(cuenta);
      const catPnl  = normCat(meta?.categoria_pnl);                            // "ventas" | "costo_venta" | …
      const catRaw  = (meta?.categoria_pnl ?? "").toLowerCase();               // crudo, para financieros/impuestos
      const catSede = (meta?.categoria_pnl_sede ?? "").trim().toLowerCase();   // "ventas" | "otros ingresos" | "costo por venta"
      let gkey = null, rowKey = cuenta, val = Number(row.total) || 0;
      if (fam === "propios") {
        // Sede propia: por categoria_pnl_sede. Ingreso/interuso/costo arriba de margen; el opex (sin
        // categoria_pnl_sede) va a una única línea "Gastos Sedes Propias" (debajo de margen).
        if (catSede === "ventas") gkey = "vta_sp";
        else if (catSede === "otros ingresos") gkey = "int_sp";
        else if (catSede === "costo por venta") gkey = "gpv";
        else { gkey = "gsp"; rowKey = "Gastos Sedes Propias"; }
      } else if (catPnl === "costo_venta") {
        gkey = "gpv";                                     // costo que pega en el margen (aplica aunque venga de franquicias)
        if (forcedSide === "ingreso") val = -val;         // contra-ingreso (franquicias, signo ingreso) → costo positivo
      } else if (forcedSide === "ingreso" || catPnl === "ventas") {
        if (fam) { gkey = FAM_A_ING[fam]; if (gkey === "wre") rowKey = cc?.nombre ?? cuenta; }   // ingreso HQ/ger/wre
      } else if (catRaw.includes("financ")) {
        gkey = "fin";                                     // Financieros: filas = CUENTA (Intereses Ganados / Pérdidas Fin.)
      } else if (catRaw.includes("impuesto")) {
        gkey = "imp";                                     // Impuestos: filas = CUENTA (IVA / Ganancias / Plan AFIP…)
      } else {
        gkey = "ghq";                                     // Gastos HQ (operativos): filas = CENTRO
        rowKey = cc?.nombre ?? cuenta;
      }
      const bucket = gkey ? grupos[gkey] : sinClasificar;
      if (!bucket[rowKey]) bucket[rowKey] = new Array(12).fill(0);
      bucket[rowKey][m] += val;
    }
  };
  add(inRows, "ingreso"); add(egRows, null);
  return { grupos, sinClasificar };
}

// Orden de los centros dentro de "Gastos HQ" (display).
const BIGG_ORDEN_GHQ = ["HQ - Sport", "HQ - Tecnologia", "HQ - Ventas y Operaciones", "17 - Huergo",
  "HQ - Marketing", "HQ - BI", "HQ - Design", "HQ - Gerencia General", "HQ - Administracion",
  "HQ - Recursos Humanos", "HQ - Infraestructura IT"];
const BIGG_ORDEN_FIN = ["Intereses Ganados", "Perdidas Financieras"];
const BIGG_ORDEN_IMP = ["Plan Facilidades AFIP", "IVA", "IVA Inversiones", "IVA Compra", "Ganancias", "Otros Impuestos"];

// Cuentas de fee (gerenciamiento/WRE) que NO van en "Ingresos HQ" (ya son líneas de operación → no duplicar).
const BIGG_FEE_CUENTAS = ["Fee de Gestion y Adm", "Fee de Gestion y Adm (Huergo)"];

// P&L de HOLDING: arma el waterfall de management a partir de los RESULTADOS por negocio (resSedesAR/feeGer/
// resWRE, ya netos y pre-fin/pre-imp) + los grupos de HQ/financieros/impuestos que ya barrió buildPnLBigg.
// Convención de signo: igual que computeSubtotalsBigg (ingresos +, gastos/fin/imp positivos y se RESTAN).
function computeSubtotalsHolding(pnl, { resSedesAR, feeGer, resWRE }) {
  const Z = () => new Array(12).fill(0);
  const sar = resSedesAR || Z(), fg = feeGer || Z(), wre = resWRE || Z();
  const omit = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !keys.includes(k)));
  const sumG = obj => MESES.map((_, m) => Object.values(obj || {}).reduce((s, a) => s + (a[m] || 0), 0));
  const hqAccounts  = omit(pnl.grupos.hq,  BIGG_FEE_CUENTAS);    // ingresos HQ sin las fees de operación
  const ghqAccounts = omit(pnl.grupos.ghq, ["17 - Huergo"]);     // opex HQ sin Huergo (ya está en WRE)
  const ingHQ = sumG(hqAccounts), opexHQ = sumG(ghqAccounts), financieros = sumG(pnl.grupos.fin), impuestos = sumG(pnl.grupos.imp);
  const resOperaciones = MESES.map((_, m) => sar[m] + fg[m] + wre[m]);
  const resOpGrupo     = MESES.map((_, m) => resOperaciones[m] + ingHQ[m] - opexHQ[m]);
  const resAntesImp    = MESES.map((_, m) => resOpGrupo[m] - financieros[m]);
  const resGrupo       = MESES.map((_, m) => resAntesImp[m] - impuestos[m]);
  const months = new Set(); const cur = new Date().getMonth();
  for (let i = 0; i <= cur; i++) months.add(i);
  [sar, fg, wre, ingHQ, opexHQ, financieros, impuestos].forEach(a => a.forEach((v, i) => { if (v) months.add(i); }));
  return { sar, fg, wre, hqAccounts, ghqAccounts, ingHQ, opexHQ, financieros, impuestos,
           resOperaciones, resOpGrupo, resAntesImp, resGrupo, activeMonths: [...months].sort((a, b) => a - b) };
}

// P&L BIGG = P&L de HOLDING. Arriba el RESULTADO de cada negocio operativo (no la venta); después HQ
// (ingresos − opex), y al final financieros + impuestos del grupo. `sub` = computeSubtotalsHolding.
function PnLTableBigg({ pnl, sub, year, moneda }) {
  const { sar, fg, wre, hqAccounts, ghqAccounts, ingHQ, opexHQ,
          resOperaciones, resOpGrupo, resAntesImp, resGrupo, activeMonths } = sub;
  const ncols = activeMonths.length + 2;
  const ALLKEYS = ["sec_op", "sec_ing", "sec_opex", "sec_fin", "sec_imp"];
  const [collapsed, setCollapsed] = useState({});
  const isCol  = k => !!collapsed[k];
  const toggle = k => setCollapsed(c => ({ ...c, [k]: !c[k] }));
  const allCol = ALLKEYS.every(k => collapsed[k]);
  const toggleAll = () => setCollapsed(allCol ? {} : Object.fromEntries(ALLKEYS.map(k => [k, true])));

  const sec = (key, label, accounts, order) => <PnlSection sub label={label} accounts={accounts}
    order={order} color={SEDE_HDR} activeMonths={activeMonths} ncols={ncols}
    expanded={!isCol(key)} onToggle={() => toggle(key)} />;

  if (activeMonths.length === 0) return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      padding: "60px 24px", textAlign: "center", boxShadow: T.shadow }}>
      <div style={{ fontSize: 14, color: T.muted }}>Sin datos para {year} en {moneda}.</div>
    </div>
  );

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      boxShadow: T.shadow, overflowX: "auto", position: "relative" }}>
      <table style={{ width: "100%", minWidth: 230 + activeMonths.length * 122 + 150, borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 230 }} />
          {activeMonths.map(m => <col key={m} style={{ width: 122 }} />)}
          <col style={{ width: 150 }} />
        </colgroup>
        <thead>
          <tr>
            <th onClick={toggleAll} title="Contraer / expandir todo"
              style={{ ...thStyle, textAlign: "left", whiteSpace: "nowrap", cursor: "pointer",
                userSelect: "none", ...stickyCol, background: T.tableHead, zIndex: 4 }}>
              <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{allCol ? "▶" : "▼"}</span>Cuenta
            </th>
            {activeMonths.map(m => <th key={m} style={thStyle}>{MESES[m]}</th>)}
            <th style={{ ...thStyle, borderLeft: "1px solid rgba(255,255,255,.12)" }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {/* Resultado de operaciones: una línea por negocio = SU resultado (no la venta) */}
          <BandaRow label="Resultado de Operaciones" span={ncols} expanded={!isCol("sec_op")} onToggle={() => toggle("sec_op")} />
          {!isCol("sec_op") && <>
            <DataRow label="Sedes Propias Argentina" values={sar} activeMonths={activeMonths} color={SEDE_HDR} />
            <DataRow label="Gerenciamiento de Sedes (Rosedal)" values={fg} activeMonths={activeMonths} color={SEDE_HDR} />
            <DataRow label="Wellness Real Estate (Huergo)" values={wre} activeMonths={activeMonths} color={SEDE_HDR} />
          </>}
          <SubtotalRow strong label="Resultado de Operaciones" values={resOperaciones} activeMonths={activeMonths} color={SEDE_HDR} />

          {/* HQ: ingresos propios − opex por departamento */}
          {sec("sec_ing", "Ingresos HQ", hqAccounts, BIGG_ORDEN)}
          <SubtotalRow label="Total Ingresos HQ" values={ingHQ} activeMonths={activeMonths} color={SEDE_HDR} />
          {sec("sec_opex", "OPEX HQ", ghqAccounts, BIGG_ORDEN_GHQ)}
          <SubtotalRow label="Total OPEX HQ" values={opexHQ} activeMonths={activeMonths} color={SEDE_HDR} />
          <ResultadoRow strong label="Resultado Operativo del Grupo" values={resOpGrupo} activeMonths={activeMonths} />

          {/* Debajo del operativo: financieros e impuestos del grupo, en una línea al final */}
          {sec("sec_fin", "Financieros", pnl.grupos.fin, BIGG_ORDEN_FIN)}
          <ResultadoRow label="Resultado antes de Impuestos" values={resAntesImp} activeMonths={activeMonths} />
          {sec("sec_imp", "Impuestos", pnl.grupos.imp, BIGG_ORDEN_IMP)}
          <ResultadoRow strong label="Resultado del Grupo" values={resGrupo} activeMonths={activeMonths} />
        </tbody>
      </table>
    </div>
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
        // Repetir los bordes en la celda sticky: su background repinta y taparía las líneas del <tr>.
        borderTop: `2px solid ${color ?? T.cardBorder}`, borderBottom: `1px solid ${T.cardBorder}`,
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

  // Sueldos POR LEGAJO (mismo criterio que Tesorería): neto devengado(cerradas) − pagado(nb_movimientos
  // origen sueldos). Positivo → PASIVO (deuda). Negativo → ACTIVO "adelanto" (pago sin liquidación
  // cerrada aún) → mantiene el PN correcto hasta que se cierre la liquidación y se compensen. Por legajo
  // —NO por bucket— para no netear la deuda de un empleado con el adelanto de otro. Solo ARS.
  const sueldoSoc = (sociedad ?? "").toLowerCase();
  const sueldosLegajoRows = (fn) => fn(liqsCerradas, pagosSueldos)
    .map(leg => ({ label: leg.legajo, ars: leg.items.reduce((t, it) =>
      t + ((!sueldoSoc || (it.sociedad ?? "").toLowerCase() === sueldoSoc) ? it.monto : 0), 0) }))
    .filter(r => r.ars > 0.5);
  const cxpSueldosRows      = useMemo(() => sueldosLegajoRows(pendienteSueldosPorLegajo), [liqsCerradas, pagosSueldos, sueldoSoc]);
  const adelantoSueldosRows = useMemo(() => sueldosLegajoRows(adelantoSueldosPorLegajo),  [liqsCerradas, pagosSueldos, sueldoSoc]);
  const cxpSueldosTot      = { ...ZERO, ARS: cxpSueldosRows.reduce((s, r) => s + r.ars, 0) };
  const adelantoSueldosTot = { ...ZERO, ARS: adelantoSueldosRows.reduce((s, r) => s + r.ars, 0) };
  const hayAdelSld = adelantoSueldosTot.ARS > 0;

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

  const activoTot  = addVals(addVals(addVals(addVals(cajaTot, bancoTot), cxcTot), sociosActivoTot), adelantoSueldosTot);
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

            {hayAdelSld && <>
              <BGrpRow label="Adelantos a empleados" expanded onToggle={() => {}} />
              {adelantoSueldosRows.map(r => <BDRow key={r.label} label={r.label} vals={{ ...ZERO, ARS: r.ars }} indent />)}
              <BSubRow label="Total Adelantos a empleados" vals={adelantoSueldosTot} color={T.green} />
            </>}
          </>}
          <BResRow label="TOTAL ACTIVO" vals={activoTot} />

          <BSecRow label="Pasivo" expanded={pasivoOpen} onToggle={() => setPasivoOpen(o => !o)} />
          {pasivoOpen && <>
            <BGrpRow label="Cuentas a Pagar" expanded={cxpOpen} onToggle={() => setCxpOpen(o => !o)} />
            {cxpOpen && <BDRow label="Facturas pendientes de pago" vals={cxpTot} indent />}
            <BSubRow label="Total Cuentas a Pagar" vals={cxpTot} color={T.red} />

            <BGrpRow label="Cuentas a Pagar — Sueldos" expanded={cxpSldOpen} onToggle={() => setCxpSldOpen(o => !o)} />
            {cxpSldOpen && cxpSueldosRows.map(r => (
              <BDRow key={r.label} label={r.label} vals={{ ...ZERO, ARS: r.ars }} indent />
            ))}
            {cxpSldOpen && cxpSueldosRows.length === 0 && <BDRow label="(sin saldo de sueldos)" vals={ZERO} indent />}
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
  // ── Funcionando ──
  { id: "pl_sede", label: "P&L Sedes Propias Argentina",  icon: "🏬", desc: "Resultado operativo por sede: ventas, costos variables y márgenes." },
  { id: "pl_bigg", label: "P&L BIGG",   icon: "🏢", desc: "Resultado corporativo por centro de HQ (R&D, Sales & Mkt, G&A)." },
  { id: "cf",      label: "Cash Flow",  icon: "💵", desc: "Flujo de caja mensual: entradas y salidas por cuenta." },
  { id: "interco", label: "Intercompañía",   icon: "🔗", desc: "Posiciones entre sociedades, agrupadas por anillo." },
  { id: "consolidado", label: "Tesorería consolidada", icon: "🏦", desc: "Saldos y movimientos de todas las sociedades del grupo." },

  // ── WIP (solo esqueleto navegable; sin cálculo todavía) ──
  { id: "inf_egresos",  label: "Egresos (detalle)",  icon: "🔎", desc: "Listar y filtrar compras por cuenta · centro · proveedor · moneda · período." },
  { id: "inf_ingresos", label: "Ingresos (detalle)", icon: "🔎", desc: "Listar y filtrar ventas/ingresos por cuenta · centro · cliente · moneda · período." },

  { id: "er_soc",       label: "Estado de Resultados", icon: "📄", wip: true, desc: "P&L de la entidad legal seleccionada (por sociedad)." },

  { id: "op_espana",    label: "P&L Sedes Propias España", icon: "🇪🇸", desc: "Igual que Sedes propias AR + impuestos debajo del Resultado Operativo (sociedad Fondeada)." },
  { id: "op_colombia",  label: "P&L Sedes Propias Colombia", icon: "🇨🇴", desc: "Igual que Sedes propias AR + impuestos debajo del Resultado Operativo (sociedad Fondeada)." },
  { id: "op_puertos",   label: "P&L Puertos", icon: "⚓", wip: true, desc: "Igual que Sedes propias AR + impuestos debajo del Resultado Operativo (sociedad Fondeada, inversión USD)." },
  { id: "op_rosedal",   label: "P&L Rosedal (Segui Fit)", icon: "🤝", desc: "P&L completo de la operación administrada hasta Free Cash Flow, con impuestos dentro; a BIGG entra el fee + su % del FCF." },
  { id: "op_huergo",    label: "P&L Huergo", icon: "🏗️", desc: "Negocio propio (anillo 1): ingreso del edificio − horas de coaches = margen a seguir de cerca." },

  { id: "consol_grupo", label: "Consolidado de grupo", icon: "🌐", wip: true, desc: "P&L y patrimonio del grupo: propias full (neto de IVA) + fee/share de administradas + impuestos del anillo al final." },

  { id: "an_ventas",    label: "Ventas por línea de ingreso", icon: "📈", wip: true, desc: "Facturación abierta por línea de ingreso, para explicar de dónde vienen las ventas." },
  { id: "an_margenes",  label: "Márgenes por negocio", icon: "🧩", wip: true, desc: "Cuánto aporta cada negocio al Margen Bruto del grupo." },
  { id: "an_gastos_cc", label: "Gastos por centro de costo", icon: "🧾", wip: true, desc: "Apertura del gasto por centro de costo y, dentro, por cuenta contable." },
];

// ─── Menú por STORYTELLING (agrupado por la pregunta que uno se hace, no por taxonomía contable) ──
// Pensado para navegar el negocio de arriba hacia abajo: la foto del grupo → cómo rinde cada negocio →
// de dónde sale/va la plata → buscar el detalle → (lo fiscal/interno al fondo). Textos = management
// (todavía NO simplificados para dueños). El anillo de la sociedad manda cómo consolida (ver memoria).
const LENTES = [
  { id: "grupo",    label: "La foto del grupo",            tabs: ["consol_grupo", "pl_bigg", "cf", "consolidado"] },
  { id: "negocios", label: "Cómo le va a cada negocio",    tabs: ["pl_sede", "op_espana", "op_colombia", "op_rosedal", "op_huergo", "op_puertos"] },
  { id: "flujo",    label: "De dónde sale y a dónde va",   tabs: ["an_ventas", "an_gastos_cc"] },
  { id: "detalle",  label: "Buscar el detalle",            tabs: ["inf_egresos", "inf_ingresos"] },
  { id: "interno",  label: "Interno · fiscal / contable",  tabs: ["er_soc", "interco"] },
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
function ReportCard({ icon, title, wip, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", gap: 14, alignItems: "center", textAlign: "left",
      background: wip ? "#fafbfc" : T.card, border: `1px ${wip ? "dashed" : "solid"} ${T.cardBorder}`, borderRadius: 12,
      padding: "16px 20px", cursor: "pointer", fontFamily: T.font, width: "100%",
      boxShadow: "0 1px 3px rgba(0,0,0,.04)", transition: "all .15s ease" }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = T.shadowMd; e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,.04)"; e.currentTarget.style.borderColor = T.cardBorder; e.currentTarget.style.transform = "none"; }}>
      <div style={{ fontSize: 20, lineHeight: 1, flexShrink: 0, width: 42, height: 42, borderRadius: 10,
        background: wip ? "#e5e7eb" : T.accentDark, display: "flex", alignItems: "center", justifyContent: "center", opacity: wip ? .8 : 1 }}>{icon}</div>
      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: wip ? T.muted : T.text }}>{title}</span>
        {wip && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".06em", color: "#b45309",
          background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 6, padding: "1px 6px" }}>🚧 WIP</span>}
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
              return <ReportCard key={tid} icon={t.icon} title={t.label} desc={t.desc} wip={t.wip} onClick={() => onPick(tid)} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Multi-select con checkboxes (opciones planas o agrupadas · búsqueda opcional) ──
// selected = Set de values (vacío ⇒ "todos", sin filtro). groups = [{key,label,items:[{value,label}]}].
function MultiSelect({ label, options = null, groups = null, selected, onChange, searchable = false, allLabel = "Todos", width = 200 }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const flat = groups ? groups.flatMap(g => g.items) : (options || []);
  const summary = selected.size === 0 ? allLabel
    : selected.size === 1 ? (flat.find(o => selected.has(o.value))?.label ?? "1 sel.")
    : `${selected.size} seleccionados`;
  const toggle = v => { const s = new Set(selected); s.has(v) ? s.delete(v) : s.add(v); onChange(s); };
  const toggleGroup = items => { const s = new Set(selected); const all = items.every(i => s.has(i.value)); items.forEach(i => all ? s.delete(i.value) : s.add(i.value)); onChange(s); };
  const qq = q.trim().toLowerCase();
  const show = o => !qq || o.label.toLowerCase().includes(qq);
  const lbl = { display: "block", fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 };
  const row = { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      {label && <label style={lbl}>{label}</label>}
      <button type="button" onClick={() => setOpen(o => !o)} style={{ ...selStyle, width, textAlign: "left",
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected.size ? T.text : T.muted }}>{summary}</span>
        <span style={{ fontSize: 9, opacity: .6 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", zIndex: 60, top: "calc(100% + 4px)", left: 0, minWidth: width, maxWidth: 340,
          maxHeight: 340, overflowY: "auto", background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 10, boxShadow: T.shadowMd, padding: 4 }}>
          {searchable && (
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…" autoFocus
              style={{ ...selStyle, width: "100%", cursor: "text", marginBottom: 4 }} />
          )}
          {/* "Todos" arriba: limpiar la selección = sin filtro. Tildado cuando no hay nada elegido. */}
          <div onClick={() => onChange(new Set())} style={{ ...row, padding: "6px 10px", fontWeight: 700, borderBottom: `1px solid ${T.cardBorder}` }}>
            <input type="checkbox" checked={selected.size === 0} readOnly style={{ pointerEvents: "none", accentColor: T.accentDark }} />
            {allLabel}
          </div>
          {(groups || [{ key: "_", items: flat }]).map(g => {
            const items = g.items.filter(show);
            if (!items.length) return null;
            const allIn = g.items.every(i => selected.has(i.value));
            return (
              <div key={g.key}>
                {g.label && (
                  <div onClick={() => toggleGroup(g.items)} style={{ ...row, padding: "6px 10px", fontWeight: 800, fontSize: 10.5,
                    color: T.muted, textTransform: "uppercase", letterSpacing: ".04em", background: "#f1f5f9" }}>
                    <input type="checkbox" checked={allIn} readOnly style={{ pointerEvents: "none", accentColor: T.accentDark }} />
                    {g.label}
                  </div>
                )}
                {items.map(o => (
                  <div key={o.value} onClick={() => toggle(o.value)} style={{ ...row, padding: g.label ? "6px 10px 6px 26px" : "6px 10px", fontSize: 13, color: T.text }}>
                    <input type="checkbox" checked={selected.has(o.value)} readOnly style={{ pointerEvents: "none", accentColor: T.accentDark }} />
                    {o.label}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Filtro de fecha con presets (como Contagram) → devuelve rango {desde,hasta} ISO ──
const DATE_PRESETS = [
  { id: "todos", label: "Todo" }, { id: "hoy", label: "Hoy" }, { id: "ayer", label: "Ayer" },
  { id: "semana", label: "Últimos 7 días" }, { id: "dias30", label: "Últimos 30 días" },
  { id: "mes", label: "Mes actual" }, { id: "mes_ant", label: "Mes anterior" },
  { id: "anio", label: "Año actual" }, { id: "rango", label: "Desde – Hasta" },
];
function rangoDePreset(id, desde, hasta) {
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const mk = (a, b) => ({ desde: a ? iso(a) : "", hasta: b ? iso(b) : "" });
  const dd = n => { const x = new Date(t); x.setDate(t.getDate() + n); return x; };
  switch (id) {
    case "hoy":     return mk(t, t);
    case "ayer":    return mk(dd(-1), dd(-1));
    case "semana":  return mk(dd(-6), t);
    case "dias30":  return mk(dd(-29), t);
    case "mes":     return mk(new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 0));
    case "mes_ant": return mk(new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0));
    case "anio":    return mk(new Date(t.getFullYear(), 0, 1), new Date(t.getFullYear(), 11, 31));
    case "rango":   return { desde: desde || "", hasta: hasta || "" };
    default:        return { desde: "", hasta: "" };
  }
}

// Subtipo del comprobante → etiqueta de "tipo" para la columna.
const TIPO_COMP_LABEL = { EGRESO: "Compra", GASTO: "Gasto", INGRESO: "Venta", NC: "Nota de crédito" };

// ─── Detalle de comprobantes (Ingresos / Egresos) — listar + filtrar + KPIs ────
function TabDetalleComprobantes({ rows = [], movs = [], tipo, ccs = [], sociedades = [] }) {
  const esEg = tipo === "EGRESO";
  const contraLabel = esEg ? "Proveedor" : "Cliente";
  const ccMap  = useMemo(() => new Map(ccs.map(c => [String(c.id), c.nombre])), [ccs]);
  const socMap = useMemo(() => new Map(sociedades.map(s => [String(s.id), s.nombre])), [sociedades]);

  const [q, setQ]           = useState("");
  const [fSoc, setFSoc]     = useState(new Set());
  const [fCC, setFCC]       = useState(new Set());
  const [fCta, setFCta]     = useState(new Set());
  const [fMon, setFMon]     = useState(new Set());
  const [fEstado, setFEstado] = useState(new Set());
  const [preset, setPreset] = useState("anio");
  const [dDesde, setDDesde] = useState("");
  const [dHasta, setDHasta] = useState("");
  const { desde, hasta } = rangoDePreset(preset, dDesde, dHasta);

  // Opciones de filtro (de los datos crudos).
  const socOpts = useMemo(() => [...new Set(rows.map(r => String(r.sociedad)).filter(Boolean))].sort().map(s => ({ value: s, label: socMap.get(s) || s })), [rows, socMap]);
  const ctaOpts = useMemo(() => [...new Set(rows.map(r => r.cuenta_contable).filter(Boolean))].sort().map(c => ({ value: c, label: c })), [rows]);
  const monOpts = useMemo(() => [...new Set(rows.map(r => r.moneda || "ARS"))].sort().map(m => ({ value: m, label: m })), [rows]);
  // Centros presentes, agrupados por operación (o grupo HQ) — igual criterio que el filtro de Sedes.
  const centroGroups = useMemo(() => {
    const present = new Set(rows.map(r => String(r.centro_costo)).filter(Boolean));
    const m = new Map();
    for (const c of ccs) {
      const id = String(c.id);
      if (!present.has(id)) continue;
      const key = (c.operacion ?? "").trim() || (String(c.grupo ?? "").toLowerCase() === "hq" ? "HQ" : "Otros");
      if (!m.has(key)) m.set(key, { key, label: key, items: [] });
      m.get(key).items.push({ value: id, label: c.nombre });
    }
    const covered = new Set([...m.values()].flatMap(g => g.items.map(i => i.value)));
    const missing = [...present].filter(id => !covered.has(id));
    if (missing.length) m.set("_x", { key: "_x", label: "Sin centro", items: missing.map(id => ({ value: id, label: id })) });
    return [...m.values()];
  }, [rows, ccs]);

  // Estado de pago por comprobante: devengado (Σ líneas) − pagado (movimientos que lo referencian).
  const estadoDe = useMemo(() => {
    const pagoTipo = esEg ? "PAGO" : "COBRO";
    const totalByComp = {}, pagadoByComp = {};
    for (const r of rows) { const k = r.id_comp; totalByComp[k] = (totalByComp[k] || 0) + (Number(r.total) || 0); }
    for (const m of movs) { if (m.tipo === pagoTipo && m.documento_id) pagadoByComp[m.documento_id] = (pagadoByComp[m.documento_id] || 0) + Math.abs(Number(m.monto) || 0); }
    return r => {
      if (!r.id_comp) return null;   // estado de pago solo aplica a facturas (comprobantes)
      const t = totalByComp[r.id_comp] || 0, p = pagadoByComp[r.id_comp] || 0;
      if (t > 0 && calcSaldoPendiente(t, [{ monto: p }]) <= 0.5) return "Pagado";
      return p > 0.5 ? "Parcial" : "Pendiente";
    };
  }, [rows, movs, esEg]);

  const inSet = (set, v) => set.size === 0 || set.has(v);
  const filt = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return rows.filter(r => {
      const f = String(r.fecha || "");
      if (desde && f < desde) return false;
      if (hasta && f > hasta) return false;
      if (!inSet(fSoc, String(r.sociedad))) return false;
      if (!inSet(fCC, String(r.centro_costo))) return false;
      if (!inSet(fCta, r.cuenta_contable)) return false;
      if (!inSet(fMon, r.moneda || "ARS")) return false;
      if (fEstado.size && !fEstado.has(estadoDe(r))) return false;
      if (qq) {
        const hay = [r.contraparte_nombre, r.nro_comp, r.nota, r.cuenta_contable].map(x => String(x || "").toLowerCase()).join(" ");
        if (!hay.includes(qq)) return false;
      }
      return true;
    }).sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
  }, [rows, q, fSoc, fCC, fCta, fMon, fEstado, desde, hasta, estadoDe]);

  const porMon = useMemo(() => {
    const m = {};
    for (const r of filt) { const k = r.moneda || "ARS"; m[k] = (m[k] || 0) + Math.abs(Number(r.total) || 0); }
    return m;
  }, [filt]);

  const lbl = { display: "block", fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 };
  const td  = { padding: "8px 12px", fontSize: 13, borderBottom: `1px solid ${T.cardBorder}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  const th  = { padding: "9px 12px", fontSize: 10, fontWeight: 800, color: T.tableHeadText, textTransform: "uppercase", letterSpacing: ".06em", background: T.tableHead, position: "sticky", top: 0, textAlign: "left", whiteSpace: "nowrap" };

  return (
    <div className="fade">
      {/* Filtros */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", background: T.card,
        border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, padding: "12px 16px", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
        <div style={{ flex: "1 1 200px", minWidth: 170 }}>
          <label style={lbl}>Buscar</label>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={`${contraLabel}, N° comp, nota…`}
            style={{ ...selStyle, width: "100%", cursor: "text" }} />
        </div>
        <div>
          <label style={lbl}>Fecha</label>
          <select value={preset} onChange={e => setPreset(e.target.value)} style={selStyle}>
            {DATE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        {preset === "rango" && (
          <>
            <div><label style={lbl}>Desde</label>
              <input type="date" value={dDesde} onChange={e => setDDesde(e.target.value)} style={{ ...selStyle, cursor: "pointer" }} /></div>
            <div><label style={lbl}>Hasta</label>
              <input type="date" value={dHasta} onChange={e => setDHasta(e.target.value)} style={{ ...selStyle, cursor: "pointer" }} /></div>
          </>
        )}
        <MultiSelect label="Sociedad" options={socOpts} selected={fSoc} onChange={setFSoc} allLabel="Todas" />
        <MultiSelect label="Centro de costo" groups={centroGroups} selected={fCC} onChange={setFCC} searchable allLabel="Todos" width={220} />
        <MultiSelect label="Cuenta" options={ctaOpts} selected={fCta} onChange={setFCta} searchable allLabel="Todas" width={220} />
        <MultiSelect label="Moneda" options={monOpts} selected={fMon} onChange={setFMon} allLabel="Todas" width={120} />
        <MultiSelect label="Estado de pago" options={[{ value: "Pendiente", label: "Pendiente" }, { value: "Parcial", label: "Parcial" }, { value: "Pagado", label: "Pagado" }]} selected={fEstado} onChange={setFEstado} allLabel="Todos" width={150} />
      </div>

      {/* KPIs */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, padding: "12px 18px", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em" }}>Cantidad</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: T.text, fontFamily: T.mono }}>{filt.length}</div>
        </div>
        {Object.entries(porMon).sort((a, b) => b[1] - a[1]).map(([mo, tot]) => (
          <div key={mo} style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, padding: "12px 18px", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em" }}>Total {mo}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: esEg ? T.red : T.green, fontFamily: T.mono }}>{MONEDA_SYM[mo] ?? mo} {fmtN(tot)}</div>
          </div>
        ))}
      </div>

      {/* Tabla */}
      <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflow: "auto", maxHeight: "60vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: 1020 }}>
          <colgroup>
            <col style={{ width: 90 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 200 }} />
            <col style={{ width: 130 }} />
          </colgroup>
          <thead><tr>
            <th style={th}>Fecha</th><th style={th}>Tipo</th><th style={th}>Sociedad</th>
            <th style={th}>{contraLabel}</th><th style={th}>Cuenta</th><th style={th}>Centro</th>
            <th style={{ ...th, textAlign: "right" }}>Precio</th>
          </tr></thead>
          <tbody>
            {filt.length === 0
              ? <tr><td colSpan={7} style={{ ...td, textAlign: "center", color: T.dim, padding: 32 }}>Sin resultados con esos filtros.</td></tr>
              : filt.map((r, i) => (
                <tr key={r.id ?? i} style={{ background: i % 2 ? "#fafbfc" : T.card }}>
                  <td style={{ ...td, color: T.muted }}>{String(r.fecha || "").split("-").reverse().join("/")}</td>
                  <td style={{ ...td, fontSize: 12, color: T.muted }}>{r._tipo || TIPO_COMP_LABEL[String(r.subtipo || "").toUpperCase()] || r.subtipo || "—"}</td>
                  <td style={{ ...td, color: T.muted, fontSize: 12 }}>{socMap.get(String(r.sociedad)) || r.sociedad || "—"}</td>
                  <td style={{ ...td, color: T.text, fontWeight: 600 }} title={r.contraparte_nombre || ""}>{r.contraparte_nombre || "—"}</td>
                  <td style={{ ...td, color: T.text }} title={r.cuenta_contable || ""}>{r.cuenta_contable || "—"}</td>
                  <td style={{ ...td, color: T.muted, fontSize: 12 }} title={ccMap.get(String(r.centro_costo)) || r.centro_costo || ""}>{ccMap.get(String(r.centro_costo)) || r.centro_costo || "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: T.mono, fontWeight: 700, color: esEg ? T.red : T.green }}>
                    {MONEDA_SYM[r.moneda || "ARS"] ?? (r.moneda || "ARS")} {fmtN(Math.abs(Number(r.total) || 0))}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Placeholder de reporte en construcción (esqueleto navegable) ──────────────
function WipReport({ tab }) {
  return (
    <div className="fade" style={{ background: T.card, border: `1px dashed ${T.cardBorder}`, borderRadius: T.radius,
      boxShadow: T.shadow, padding: "48px 32px", textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🚧</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: T.text, marginBottom: 6 }}>{tab?.label}</div>
      <div style={{ display: "inline-block", fontSize: 10, fontWeight: 800, letterSpacing: ".08em",
        color: "#b45309", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 6, padding: "2px 8px", marginBottom: 16 }}>
        EN CONSTRUCCIÓN
      </div>
      <div style={{ fontSize: 13.5, color: T.muted, lineHeight: 1.55, maxWidth: 620, margin: "0 auto" }}>
        {tab?.desc}
      </div>
    </div>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function PantallaReportes({ sociedad = "nako" }) {
  const [activeTab,      setActiveTab]      = useState(null);   // null = menú-landing de reportes
  const [vistaPnl,       setVistaPnl]       = useState("evolucion");   // P&L Sedes: evolucion | mensual | ytd
  const [mesSel,         setMesSel]         = useState(new Date().getMonth());   // mes para vistas mensual/ytd
  const [year,           setYear]           = useState(CUR_YEAR);
  const [selectedSedeCCs, setSelectedSedeCCs] = useState(null);   // null = todas · [] = ninguna · [ids] = subconjunto
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
          // P&L Sedes/BIGG son group-level (todas las sociedades). Cash Flow (por sociedad) filtra client-side.
          fetchLineasEnriquecidas(null, ["EGRESO", "GASTO"]).catch(() => []),
          fetchLineasEnriquecidas(null, "INGRESO").catch(() => []),
          fetchMovTesoreria().catch(() => []),
          fetchCuentasBancarias().catch(() => []),
          fetchCentrosCosto().catch(() => []),
          fetchCuentas().catch(() => []),
          fetchLiquidacionesCerradas().catch(() => []),
          fetchPagosAnio().catch(() => []),
          fetchFinanciaciones().catch(() => []),
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
    // Sin `sociedad`: la carga es group-level (todas las sociedades). El re-scope por
    // sociedad de la lente "Por sociedad" es client-side (rawMovsSoc), no re-fetchea.
  }, [loadKey]);

  const curTab   = TABS.find(t => t.id === activeTab);
  const curLente = LENTES.find(l => l.tabs.includes(activeTab));

  // Fondeada activa (España/Colombia/Puertos ya construida). Usa el MISMO reporte de sede (mismos filtros
  // moneda + sede), pero escopea el universo de sedes a las de ESA sociedad y agrega la cola de impuestos.
  const fondCfg    = FONDEADAS[activeTab] || null;
  const isFond     = !!fondCfg && !curTab?.wip;
  const isSedeLike = activeTab === "pl_sede" || isFond;
  const isHuergo   = activeTab === "op_huergo" && !curTab?.wip;   // negocio de margen (WRE, anillo 1)
  const isPnlTiempo = isSedeLike || isHuergo;   // reportes con toggle de vista (Evolución/Mensual/YTD) + Año/Moneda
  // Al entrar a un negocio, arrancar en su moneda (fondeada = la suya; Huergo = ARS). Igual se puede cambiar.
  useEffect(() => { if (isFond) setMonedaPL(fondCfg.moneda); else if (isHuergo) setMonedaPL("ARS"); }, [activeTab]);   // eslint-disable-line react-hooks/exhaustive-deps

  const cuentaMap = useMemo(
    () => new Map((cuentas ?? []).map(c => [c.nombre, c])),
    [cuentas]
  );

  // rawMovs se carga group-level (todas las sociedades) para el P&L Sedes/BIGG.
  // La lente "Por sociedad" (Cash Flow / Balance / Evolución PN) filtra a la sociedad activa client-side.
  const rawMovsSoc = useMemo(() => {
    const soc = (sociedad ?? "").toLowerCase();
    return soc ? rawMovs.filter(m => (m.sociedad ?? "").toLowerCase() === soc) : rawMovs;
  }, [rawMovs, sociedad]);

  // Núcleo (anillo 1) = sociedades cuyo `anillo` contiene "cleo" (Núcleo, con o sin acento).
  const nucleoEmpresas = useMemo(() => new Set(
    (sociedades ?? [])
      .filter(s => (s.anillo ?? "").toLowerCase().includes("cleo"))
      .map(s => s.id)
  ), [sociedades]);

  // P&L Sedes = SOLO sedes propias del anillo 1. El anillo vive en la sociedad, no en el centro:
  // se resuelve centro → `empresa` → sociedad núcleo. Además la familia debe ser "propios" (sede
  // estándar), para excluir Huergo (WRE) y Rosedal (administrada). "Propios España/Colombia" son
  // propias pero de sociedades Fondeadas → NO entran (van a su propio reporte).
  // Universo de sedes del reporte activo: Argentina (pl_sede) = propias del núcleo; Fondeada = propias de
  // ESA sociedad (empresa). En ambos casos, familia "propios" (excluye WRE/administradas).
  const scopeEmpresas = useMemo(
    () => isFond ? new Set([fondCfg.empresa]) : nucleoEmpresas,
    [isFond, fondCfg, nucleoEmpresas]
  );
  const scopeFamilia = isFond ? (fondCfg.familia || "propios") : "propios";
  const sedeCCs = useMemo(() => ccs.filter(c =>
    (c.grupo ?? "").toLowerCase() === "operaciones" &&
    scopeEmpresas.has((c.empresa ?? "").trim()) &&
    familiaCentro(c) === scopeFamilia
  ), [ccs, scopeEmpresas, scopeFamilia]);

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

  // null = todas · [] = ninguna · [ids] = subconjunto. resolvedCCSede: null → todas las sedes.
  const resolvedCCSede = useMemo(
    () => (selectedSedeCCs === null ? sedeCCs.map(c => c.id) : selectedSedeCCs),
    [selectedSedeCCs, sedeCCs]
  );

  // Cesión de utilidades: se activa solo cuando el scope es EXACTAMENTE la sede con cesión (Barrio Norte);
  // aplicar el % sobre un agregado de varias sedes sería incorrecto.
  const cesionSede = useMemo(() => {
    if (resolvedCCSede.length !== 1) return null;
    const cc = ccMap.get(resolvedCCSede[0]);
    return cc && _nkSede(cc.nombre).includes(_nkSede(CESION.matchNombre)) ? CESION : null;
  }, [resolvedCCSede, ccMap]);

  // Toggle de un grupo (operación) entero: agrega/saca todas sus sedes de la selección.
  const toggleGrupoSede = (opId) => {
    const ids = (gruposSede.find(g => g.id === opId)?.sedes ?? []).map(c => c.id);
    setSelectedSedeCCs(prev => {
      const allIds = sedeCCs.map(c => c.id);
      const sel = new Set(prev === null ? allIds : prev);
      const allIn = ids.every(id => sel.has(id));
      ids.forEach(id => allIn ? sel.delete(id) : sel.add(id));
      const next = [...sel];
      return next.length === allIds.length ? null : next;   // completo → null (todas)
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
  // P&L Sedes/BIGG son group-level (todas las sociedades) → adaptadores sin filtro de sociedad.
  const salaryRows = useMemo(() => liqsCerradas.flatMap(liquidacionToPnLRows).map(r => ({ ...r, _tipo: "Sueldo", contraparte_nombre: r.legajo_nombre ?? r.contraparte_nombre ?? "" })), [liqsCerradas]);

  const gastoMovRows = useMemo(() => movimientoToPnLRows(rawMovs, "", cuentaMap), [rawMovs, cuentaMap]);
  // Cuentas-tarjeta (crédito): sus movimientos no son caja → se excluyen del Cash Flow (la salida real es el pago de la tarjeta).
  const tarjetaIds = useMemo(() => new Set(cuentasBancarias.filter(esCuentaCredito).map(c => c.id)), [cuentasBancarias]);

  // Financiaciones: capital del impuesto (plan AFIP) + interés/IVA/impuestos por cuota (mes a mes).
  const finRows = useMemo(() => financiacionToPnLRows(rawFin, ""), [rawFin]);

  const egConSueldos = useMemo(() => [...rawEg, ...salaryRows, ...gastoMovRows, ...finRows], [rawEg, salaryRows, gastoMovRows, finRows]);

  // Facturación a franquiciados (read-only) → ingreso del P&L HQ, en el centro HQ de Ventas.
  const ventasCcId = useMemo(
    () => ccs.find(c => (c.grupo ?? "").toLowerCase() === "hq" && normCat(c.categoria_pnl) === "ventas")?.id ?? "",
    [ccs]
  );
  const franqRows = useMemo(
    () => franquiciasIngresoPnLRows(rawFranq, "", ventasCcId).map(r => ({ ...r, _tipo: "Franquicia" })),
    [rawFranq, ventasCcId]
  );
  const inConFranq = useMemo(() => [...rawIn, ...franqRows], [rawIn, franqRows]);

  // Detalle de Informes: las MISMAS fuentes que el P&L (comprobantes + gastos directos + sueldos +
  // financiaciones), tagueadas por `_tipo`. Egresos = todo lo que resta en el resultado; Ingresos = ventas
  // + franquicias + ingresos contabilizados por movimiento.
  const egDetalle  = useMemo(() => egConSueldos.filter(r => !r._tipo || ["Gasto", "Sueldo", "Financiación"].includes(r._tipo)), [egConSueldos]);
  const ingDetalle = useMemo(() => [...inConFranq, ...gastoMovRows.filter(r => r._tipo === "Ingreso" || r._tipo === "Retención")], [inConFranq, gastoMovRows]);

  const pnlSede = useMemo(
    () => buildPnLSede(inConFranq, egConSueldos, resolvedCCSede, year, monedaPL),
    [inConFranq, egConSueldos, resolvedCCSede, year, monedaPL]
  );

  // Año anterior (mismos arrays, filtrados a year-1) → comparativas Mensual/YTD sin fetch extra.
  const pnlSedePrev = useMemo(
    () => buildPnLSede(inConFranq, egConSueldos, resolvedCCSede, year - 1, monedaPL),
    [inConFranq, egConSueldos, resolvedCCSede, year, monedaPL]
  );
  const subSede     = useMemo(() => computeSubtotalsSede(pnlSede), [pnlSede]);
  const subSedePrev = useMemo(() => computeSubtotalsSede(pnlSedePrev), [pnlSedePrev]);

  // Huergo (WRE): negocio de margen. Scope = centro con operacion "Wellness Real Estate".
  const huergoCCs = useMemo(
    () => ccs.filter(c => (c.operacion ?? "").trim() === "Wellness Real Estate").map(c => c.id),
    [ccs]
  );
  // Se computa solo cuando la pestaña Huergo está activa (evita escanear los datasets en cada render de otras).
  const pnlHuergo     = useMemo(() => isHuergo ? buildPnLHuergo(inConFranq, egConSueldos, huergoCCs, year, monedaPL) : null, [isHuergo, inConFranq, egConSueldos, huergoCCs, year, monedaPL]);
  const subHuergo     = useMemo(() => pnlHuergo ? computeSubtotalsHuergo(pnlHuergo) : null, [pnlHuergo]);
  const pnlHuergoPrev = useMemo(() => isHuergo ? buildPnLHuergo(inConFranq, egConSueldos, huergoCCs, year - 1, monedaPL) : null, [isHuergo, inConFranq, egConSueldos, huergoCCs, year, monedaPL]);
  const subHuergoPrev = useMemo(() => pnlHuergoPrev ? computeSubtotalsHuergo(pnlHuergoPrev) : null, [pnlHuergoPrev]);

  // ── P&L BIGG = P&L de HOLDING (Núcleo/anillo 1). Se computa solo en la pestaña pl_bigg. ──
  const isBigg = activeTab === "pl_bigg";
  // Scope fijo del holding (independiente del tab): sedes propias AR del núcleo + el centro Barrio Norte.
  const arNucleoCCs = useMemo(
    () => ccs.filter(c => (c.grupo ?? "").toLowerCase() === "operaciones" &&
      nucleoEmpresas.has((c.empresa ?? "").trim()) && familiaCentro(c) === "propios").map(c => c.id),
    [ccs, nucleoEmpresas]
  );
  const bnCcId = useMemo(() => ccs.find(c => _nkSede(c.nombre).includes(_nkSede(CESION.matchNombre)))?.id, [ccs]);

  // Línea "Sedes Propias Argentina" = resultado de las sedes AR NETO del 49% de la cesión de Barrio Norte.
  const resSedesAR = useMemo(() => {
    if (!isBigg) return null;
    const rfAR = computeSubtotalsSede(buildPnLSede(inConFranq, egConSueldos, arNucleoCCs, year, monedaPL)).resFinal;
    const rfBN = bnCcId ? computeSubtotalsSede(buildPnLSede(inConFranq, egConSueldos, [bnCcId], year, monedaPL)).resFinal : new Array(12).fill(0);
    return rfAR.map((v, m) => v - CESION.pct * (Number(rfBN[m]) || 0));
  }, [isBigg, inConFranq, egConSueldos, arNucleoCCs, bnCcId, year, monedaPL]);

  // Línea "Gerenciamiento (Rosedal)" = fee interco Ñako→Segui (cuenta "Fee de Gestion y Adm" exacta, núcleo).
  const feeGer = useMemo(() => {
    if (!isBigg) return null;
    const t = new Array(12).fill(0);
    for (const r of inConFranq) {
      if (_nkSede(r.cuenta_contable) !== _nkSede("Fee de Gestion y Adm")) continue;
      if (!nucleoEmpresas.has((r.sociedad ?? "").trim())) continue;
      if (!r.fecha || r.fecha.slice(0, 4) !== String(year)) continue;
      if ((r.moneda ?? "ARS") !== monedaPL) continue;
      const m = parseInt(r.fecha.slice(5, 7), 10) - 1; if (m >= 0 && m < 12) t[m] += Number(r.total) || 0;
    }
    return t;
  }, [isBigg, inConFranq, nucleoEmpresas, year, monedaPL]);

  // Línea "Wellness Real Estate" = margen de Huergo (+ Puertos a futuro).
  const resWRE = useMemo(
    () => isBigg ? computeSubtotalsHuergo(buildPnLHuergo(inConFranq, egConSueldos, huergoCCs, year, monedaPL)).margen : null,
    [isBigg, inConFranq, egConSueldos, huergoCCs, year, monedaPL]
  );

  const pnlBigg = useMemo(
    () => isBigg ? buildPnLBigg(inConFranq, egConSueldos, ccMap, cuentaMap, nucleoEmpresas, year, monedaPL) : null,
    [isBigg, inConFranq, egConSueldos, ccMap, cuentaMap, nucleoEmpresas, year, monedaPL]
  );
  const subBigg = useMemo(
    () => pnlBigg ? computeSubtotalsHolding(pnlBigg, { resSedesAR, feeGer, resWRE }) : null,
    [pnlBigg, resSedesAR, feeGer, resWRE]
  );

  const toggleSedeCC = (id) => {
    setSelectedSedeCCs(prev => {
      const allIds = sedeCCs.map(c => c.id);
      const cur = prev === null ? allIds : prev;
      const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
      return next.length === allIds.length ? null : next;   // completo → null (todas); [] queda como "ninguna"
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

  const showMonedaPL = isPnlTiempo || activeTab === "pl_bigg";
  const showMonedaCF = activeTab === "cf";
  const showSedes    = isSedeLike && sedeCCs.length > 0;

  // Menú-landing: sin reporte elegido → tarjetas agrupadas por lente (Operaciones = 1 tarjeta x operación).
  if (!activeTab) return (
    <div style={{ padding: "28px 32px", maxWidth: 1400 }} className="fade">
      <PageHeader title="Reportes" subtitle="Elegí un reporte" />
      <ReportesMenu onPick={setActiveTab} />
    </div>
  );

  return (
    // --border (dark, del theme global del shell) → cardBorder claro: las tablas de reportes viven en
    // cards blancas; así la regla global `td/th{border:var(--border)}` no pinta líneas oscuras sobre blanco.
    <div style={{ padding: "28px 32px", maxWidth: 1400, "--border": T.cardBorder }} className="fade">

      {/* ── Header del reporte + volver al menú ── */}
      <PageHeader
        title={curTab?.label ?? "Reporte"}
        subtitle={isPnlTiempo ? undefined : curLente?.label}
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {isPnlTiempo && <VistaToggle value={vistaPnl} onChange={setVistaPnl} />}
            <button onClick={() => setActiveTab(null)} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "#f3f4f6", border: `1px solid ${T.cardBorder}`, borderRadius: 8,
              color: T.text, fontFamily: T.font, fontSize: 13, fontWeight: 700,
              padding: "8px 16px", cursor: "pointer" }}
              onMouseEnter={e => e.currentTarget.style.background = "#e5e7eb"}
              onMouseLeave={e => e.currentTarget.style.background = "#f3f4f6"}>
              ← Reportes
            </button>
          </div>
        }
      />

      {/* ── Toolbar / Filters (Consolidado y los detalles traen su propia barra; los WIP no llevan) ── */}
      {activeTab !== "consolidado" && !curTab?.wip && activeTab !== "inf_egresos" && activeTab !== "inf_ingresos" && (
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

        {/* Mes — solo para vistas comparativas (Mensual / YTD) */}
        {isPnlTiempo && vistaPnl !== "evolucion" && (
          <div>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.muted,
              textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 }}>Mes</label>
            <select value={mesSel} onChange={e => setMesSel(Number(e.target.value))} style={selStyle}>
              {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </div>
        )}

        {/* Sedes dropdown — jerárquico: Operación (agrupador) › Sede */}
        {showSedes && (
          <div ref={sedeRef} style={{ position: "relative" }}>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.muted,
              textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 }}>Operaciones / Sedes</label>
            <button onClick={() => setSedeOpen(o => !o)} style={{
              ...selStyle, display: "flex", alignItems: "center", gap: 8, minWidth: 190,
              background: sedeOpen ? "#f0f2f5" : "#eceff3",
            }}>
              <span style={{ flex: 1, textAlign: "left" }}>
                {selectedSedeCCs === null ? "Todas las Sedes"
                  : selectedSedeCCs.length === 0 ? "Ninguna sede"
                  : `${selectedSedeCCs.length} sede${selectedSedeCCs.length > 1 ? "s" : ""}`}
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
                <div onClick={() => setSelectedSedeCCs(prev => prev === null ? [] : null)} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
                  borderBottom: `1px solid ${T.cardBorder}`, cursor: "pointer",
                  userSelect: "none", fontWeight: 600, color: T.text,
                }}>
                  <input type="checkbox" checked={selectedSedeCCs === null} readOnly
                    style={{ pointerEvents: "none", accentColor: T.accentDark }} />
                  Todas
                </div>
                {gruposSede.map(g => {
                  const ids = g.sedes.map(c => c.id);
                  const grpChecked = selectedSedeCCs === null || ids.every(id => selectedSedeCCs.includes(id));
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
                        const checked = selectedSedeCCs === null || selectedSedeCCs.includes(cc.id);
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

      {/* ── P&L Sedes (Argentina núcleo) y Fondeadas (España/Colombia/Puertos): mismo reporte, distinto
             universo de sedes (scopeEmpresas) + cola de impuestos en Fondeadas ── */}
      {isSedeLike && (
        <PnLTableSede pnl={pnlSede} sub={subSede} pnlPrev={pnlSedePrev} subPrev={subSedePrev}
          vista={vistaPnl} mes={mesSel} year={year} moneda={monedaPL}
          cesion={cesionSede} impuestos={isFond ? IMPUESTOS_FOND : null} netoLabel={fondCfg?.netoLabel}
          label={selectedSedeCCs === null ? "Todas las Sedes"
            : selectedSedeCCs.length === 0 ? "Ninguna sede"
            : `${selectedSedeCCs.length} seleccionada${selectedSedeCCs.length > 1 ? "s" : ""}`} />
      )}

      {/* ── P&L Huergo (Wellness Real Estate): Ingresos − Costos (horas de coaches) = Margen ── */}
      {isHuergo && (
        <PnLTableHuergo pnl={pnlHuergo} sub={subHuergo} pnlPrev={pnlHuergoPrev} subPrev={subHuergoPrev}
          vista={vistaPnl} mes={mesSel} year={year} moneda={monedaPL} />
      )}

      {/* ── P&L BIGG consolidado (subgrupos, hasta Margen Bruto) ── */}
      {activeTab === "pl_bigg" && (
        <PnLTableBigg pnl={pnlBigg} sub={subBigg} year={year} moneda={monedaPL} />
      )}

      {/* ── Cash Flow ── */}
      {activeTab === "cf" && (
        <TabCashFlow rawMovs={rawMovsSoc} year={year} moneda={monedaCF} tarjetaIds={tarjetaIds} />
      )}

      {activeTab === "balance" && (
        <TabBalance
          rawMovs={rawMovsSoc}
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
          rawMovs={rawMovsSoc}
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

      {/* ── Informes · detalle de comprobantes (Egresos / Ingresos) ── */}
      {activeTab === "inf_egresos" && (
        <TabDetalleComprobantes rows={egDetalle} movs={rawMovs} tipo="EGRESO" ccs={ccs} sociedades={sociedades} />
      )}
      {activeTab === "inf_ingresos" && (
        <TabDetalleComprobantes rows={ingDetalle} movs={rawMovs} tipo="INGRESO" ccs={ccs} sociedades={sociedades} />
      )}

      {/* ── Reportes en construcción (esqueleto navegable, sin cálculo todavía) ── */}
      {curTab?.wip && <WipReport tab={curTab} />}

    </div>
  );
}
