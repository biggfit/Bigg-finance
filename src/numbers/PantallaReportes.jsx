import { useState, useMemo, useCallback, useEffect, useRef, Fragment } from "react";
import { T, PageHeader } from "./theme";
import { fetchCentrosCosto, fetchMovTesoreria, fetchCuentasBancarias, fetchLineasEnriquecidas, fetchCuentas, esIgnorado, esCuentaCredito, fetchFinanciaciones, financiacionPasivoBuckets, agruparAnticipos, anticipoPasivo, fetchSocios, fetchSociosCC, sociosSaldos, fetchIntercoData, lecturaInterco, fondeoFondeadasMensual, calcSaldoPendiente, primeCache, fetchTiposCambio, tcDelMes, montoAUSD, fetchPnLHistorico, RETDEP_TAG } from "../lib/numbersApi";
import { fetchLiquidacionesCerradas, liquidacionToPnLRows, fetchPagosAnio, pendienteSueldosPorLegajo, adelantoSueldosPorLegajo } from "../lib/sueldosApi";
import { MONEDA_SYM } from "../data/tesoreriaData";
import { fetchComps } from "../lib/sheetsApi";          // Franquicias (read-only)
import { franquiciasIngresoPnLRows } from "../lib/franquiciasAdapter";
import { exportarPackReportes } from "./exportReportes";
import { copiarReporteComoImagen, clonarParaFoto, medirContenido } from "./fotoReporte";
import TabTesoreriaConsolidada from "./reportes/TabTesoreriaConsolidada";
import TabCxPProveedores from "./reportes/TabCxPProveedores";
import TabCxCClientes from "./reportes/TabCxCClientes";
import PantallaSocios from "./PantallaSocios";

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
  if (s === "capex"        || s === "inversiones")            return "capex";
  if (s === "r_y_d"  || s === "r&d"  || s === "ryd")         return "r_y_d";
  if (s === "sales_marketing" || s.includes("sales"))         return "sales_marketing";
  if (s === "g_and_a" || s === "g&a" || s === "gna")         return "g_and_a";
  return s;
}

// Match de id de centro de costo CASE-INSENSITIVE. El maestro tiene ids con caja inconsistente
// (ej. "CC-2026-88265" vs "cc-2026-88265") y el lookup sensible a mayúsculas hacía que un CECO no
// resolviera → la fila caía en la línea/bucket equivocado. Normalizar a minúsculas lo evita.
const ccKey = s => String(s ?? "").trim().toLowerCase();
const ccEnFiltro = (ccFilter, cc) => {
  const k = ccKey(cc);
  return Array.isArray(ccFilter) ? ccFilter.some(f => ccKey(f) === k) : ccKey(ccFilter) === k;
};

// ─── Pivot P&L estructurado ───────────────────────────────────────────────────
function buildPnL(inRows, egRows, cuentaMap, ccFilter, year, moneda) {
  const cats = { ventas:{}, costo_venta:{}, gastos_operativos:{}, gastos_financieros:{}, impuestos:{}, sin_categoria:{} };
  const add = (rows) => {
    for (const row of rows) {
      if (!row.fecha || row.fecha.slice(0,4) !== String(year)) continue;
      if ((row.moneda ?? "ARS") !== moneda) continue;
      if (ccFilter !== "todos" && !ccEnFiltro(ccFilter, row.centro_costo)) continue;
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
// Período contable (P&L) vs fecha de caja: un gasto pagado en un mes puede "pertenecer" a otro
// (ej. nómina de julio pagada el 3/8) → override opcional embebido en `referencia` (sin columna
// nueva en la sheet, mismo patrón que el resto de la metadata empacada ahí: cod=/tipo=/regla=…).
// Cash Flow/Tesorería siguen usando `m.fecha` (la plata se movió ese día); sólo el P&L respeta esto.
const periodoPnLDe = (m) => {
  const hit = String(m.referencia ?? "").match(/(?:^|;)periodo=([^;]*)/);
  return hit && hit[1] ? `${hit[1]}-01` : m.fecha;
};
function movimientoToPnLRows(movs, sociedad, cuentaMap) {
  const soc = (sociedad ?? "").toLowerCase();
  const out = [];
  for (const m of (movs ?? [])) {
    if (soc && (m.sociedad ?? "").toLowerCase() !== soc) continue;
    const raw = (m.cuenta_contable ?? "").trim();
    if (!raw) continue;
    // La fila puede traer el NOMBRE de la cuenta o (si el writer no supo convertirlo) su ID.
    // `cuentaMap` resuelve ambos → canonizamos a nombre acá, una sola vez, para que las tres
    // tablas (Sede, estructurado, BIGG) agrupen por la misma clave y no partan una cuenta en dos.
    const cuenta = cuentaMap?.get(raw);
    const nombre = cuenta?.nombre || raw;
    // Entra al P&L: gasto/ingreso contado-conciliado (CONTAB-), retención sufrida, o interuso de
    // gestión (asiento de gestión de sede propia, pata 2). La retención lleva documento_id de la
    // factura (netea la CxC), por eso se la reconoce por origen; el interuso de gestión NO tiene caja.
    if (!String(m.documento_id ?? "").startsWith("CONTAB-") && m.origen !== "retencion" && m.origen !== "interuso_gestion") continue;
    const monto = Number(m.monto) || 0;
    let total, _tipo;
    if (m.origen === "retencion") {
      total = Math.abs(monto);
      _tipo = "Retención";
    } else if (m.origen === "interuso_gestion") {
      // El writer ya firmó el monto desde la óptica de la sede (NC → ingreso +, FACTURA → cargo −)
      // sobre su línea de interusos → pass-through directo, sin re-signar por categoría.
      total = monto;
      _tipo = "Interuso gestión";
    } else {
      // Ingreso = ventas, o un INGRESO de cuenta financiera (ej. Intereses Ganados): son ingresos, no gastos
      // → no negar. (Antes solo "ventas" era ingreso y el interés ganado quedaba negativo.)
      const esFinancIn = m.tipo === "INGRESO" && String(cuenta?.categoria_pnl || "").toLowerCase().includes("financ");
      const esIngreso = normCat(cuenta?.categoria_pnl) === "ventas" || esFinancIn;
      total = esIngreso ? monto : -monto;
      _tipo = esIngreso ? "Ingreso" : "Gasto";
    }
    out.push({
      fecha:           periodoPnLDe(m),
      sociedad:        m.sociedad,
      centro_costo:    m.centro_costo ?? "",
      cuenta_contable: nombre,                        // canónico (nunca el id crudo)
      moneda:          m.moneda ?? "ARS",
      total,
      iva_monto:       Math.abs(Number(m.iva_monto) || 0),   // para la vista "sin IVA" (neto = total − iva)
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
// Convención contable. neg=false (ingresos/resultados): positivo normal, negativo (pérdida) entre
// paréntesis. neg=true (líneas de gasto/que restan): positivo = egreso entre paréntesis, negativo = crédito
// (ej. Intereses Ganados dentro de Financieros) normal. Siempre se muestra la magnitud.
const fmtPar = (n, neg = false) => !n ? "—" : (neg ? n > 0 : n < 0) ? `(${fmtN(n)})` : fmtN(n);

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

function DataRow({ label, values, activeMonths, color, neg = false }) {
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
          {fmtPar(values[m], neg)}
        </td>
      ))}
      <td style={{ padding: "7px 14px", fontSize: 13, textAlign: "right", fontFamily: "var(--mono)",
        fontWeight: 800, color: color ?? T.text, whiteSpace: "nowrap",
        borderLeft: `1px solid ${T.cardBorder}` }}>
        {fmtPar(total, neg)}
      </td>
    </tr>
  );
}

// totalOverride: para filas de SALDO (running balance), la columna TOTAL no debe sumar los meses (no tiene
// sentido). Se pasa el saldo final; `null` deja el TOTAL en blanco. undefined → suma normal (subtotales de flujo).
function SubtotalRow({ label, values, activeMonths, color, strong, neg = false, noBottom = false, totalOverride }) {
  const total = totalOverride !== undefined ? totalOverride : rowSum(values);
  const bg = strong ? "#cbd5e1" : "#f3f4f6";
  // Bordes SOLO en las celdas (no en el <tr>): con border-collapse + celda sticky, duplicar el borde
  // en el <tr> y en la celda genera costura/doblado al colapsar. Fuente única = la celda.
  // noBottom: el divisor de abajo lo posee la fila siguiente (su borderTop) → evita que el borde
  // inferior propio compita con el de la fila de abajo (la sticky no colapsa y quedaría despareja).
  const bord = { borderTop: `${strong ? 3 : 2}px solid ${color ?? T.cardBorder}`,
                 borderBottom: noBottom ? "none" : `2px solid ${T.cardBorder}` };
  return (
    <tr style={{ background: bg }}>
      <td style={{ padding: "12px 16px", fontSize: strong ? 15 : 14, fontWeight: 900,
        color: color ?? T.text, letterSpacing: ".02em", ...bord,
        ...stickyCol, background: bg }}>{label}</td>
      {activeMonths.map(m => (
        <td key={m} style={{ padding: "12px 12px", fontSize: 14, textAlign: "right",
          fontFamily: "var(--mono)", fontWeight: 900, color: color ?? T.text,
          whiteSpace: "nowrap", ...bord }}>
          {fmtPar(values[m], neg)}
        </td>
      ))}
      <td style={{ padding: "12px 14px", fontSize: 15, textAlign: "right", fontFamily: "var(--mono)",
        fontWeight: 900, color: color ?? T.text, whiteSpace: "nowrap",
        borderLeft: `1px solid ${T.cardBorder}`, ...bord }}>
        {total === null ? "" : fmtPar(total, neg)}
      </td>
    </tr>
  );
}

function ResultadoRow({ label, values, activeMonths, strong, noBottom = false }) {
  const total = rowSum(values);
  const color = total >= 0 ? T.green : T.red;
  const bg = strong ? (total >= 0 ? "#bbf7d0" : "#fecaca") : (total >= 0 ? "#f0fdf4" : "#fff1f2");
  // Bordes SOLO en las celdas (no en el <tr>): evita costura/doblado en la sticky al colapsar.
  // noBottom: la fila siguiente posee el divisor (su borderTop) → sin borde inferior propio que compita.
  const bord = { borderTop: `${strong ? 3 : 2}px solid ${color}`,
                 borderBottom: (strong && !noBottom) ? `2px solid ${color}` : "none" };
  return (
    <tr style={{ background: bg }}>
      <td style={{ padding: "12px 16px", fontSize: strong ? 15 : 14, fontWeight: 900,
        color, letterSpacing: ".02em", ...bord,
        ...stickyCol, background: bg }}>{label}</td>
      {activeMonths.map(m => (
        <td key={m} style={{ padding: "12px 12px", fontSize: 14, textAlign: "right",
          fontFamily: "var(--mono)", fontWeight: 900,
          color: values[m] > 0 ? T.green : values[m] < 0 ? T.red : T.dim,
          whiteSpace: "nowrap", ...bord }}>
          {fmtPar(values[m])}
        </td>
      ))}
      <td style={{ padding: "12px 14px", fontSize: 15, textAlign: "right", fontFamily: "var(--mono)",
        fontWeight: 900, color, whiteSpace: "nowrap",
        borderLeft: `1px solid ${T.cardBorder}`, ...bord }}>
        {fmtPar(total)}
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
  { key: "vta_cf",    label: "Ventas consumidor final",  color: SEDE_HDR, cuentas: ["Ventas Mercado Pago", "Ing.Stripe", "Ing. Datafono", "Depositos", "Ventas en Efectivo", "Otros Ingresos"] },
  { key: "int_bigg",  label: "Interusos red BIGG",       color: SEDE_HDR, cuentas: ["Interusos"] },
  { key: "int_corp",  label: "Interusos corporativos",   color: SEDE_HDR, cuentas: ["Coorporativos"] },
  { key: "cvar",      label: "Costos Variables",         color: SEDE_HDR, cuentas: ["Fee Facturación", "Aranceles y Otros Financieros", "IIBB", "Imp. Cred. y Deb."] },
  { key: "gp_pers",   label: "Personal",                 color: SEDE_HDR, cuentas: ["Sueldos", "Incentivos", "Comisiones", "Aguinaldos", "Costos Salariales"] },
  { key: "gp_ocup",   label: "Ocupación",                color: SEDE_HDR, cuentas: ["Alquiler", "Expensas", "ABL", "Servicios"] },
  { key: "gp_mkt",    label: "Mkt y Pauta",              color: SEDE_HDR, cuentas: ["Acciones de Mkt", "Pauta"] },
  { key: "gp_otros",  label: "Otros Gastos de la Sede",  color: SEDE_HDR, cuentas: ["Honorarios Profesionales", "Equipamiento y Mantenimiento", "Limpieza", "Otros Gastos del Centro", "Gastos Menores de Caja"] },
  { key: "com_res",   label: "Comisión por resultados",  color: SEDE_HDR, cuentas: ["Comision S/Resultado"] },
  { key: "inv_no_op", label: "Inversiones no operativas", color: SEDE_HDR, cuentas: ["Inversiones / Gastos no Operativos"] },
];
const _nkSede = s => (s ?? "").trim().toLowerCase();
// Cuentas que se OCULTAN si están vacías (todo el año en cero). Ing.Stripe / Ing. Datafono son naturales de
// España → en el resto de las sedes vienen en 0 y ensucian; en España, donde sí hay dato, se muestran solas.
const SEDE_OCULTAR_SI_VACIA = new Set([_nkSede("Ing.Stripe"), _nkSede("Ing. Datafono")]);
const SEDE_CUENTA_A_GRUPO = (() => {
  const m = new Map();
  for (const g of SEDE_GRUPOS) for (const c of g.cuentas) m.set(_nkSede(c), g.key);
  return m;
})();
const grupoSede = (key) => SEDE_GRUPOS.find(g => g.key === key);
// Alias de cuenta → línea del P&L Sede: cuentas que deben plegarse a una línea existente (mismo grupo y misma
// fila). Ej.: "Mantenimiento" se contabiliza dentro de "Equipamiento y Mantenimiento".
const SEDE_CUENTA_ALIAS = { "mantenimiento": "Equipamiento y Mantenimiento" };
const aliasCuentaSede = (nombre) => SEDE_CUENTA_ALIAS[_nkSede(nombre)] || nombre;

// ─── Cesión de utilidades (apropiación del resultado, DEBAJO de Resultado Final) ────────────────
// Hektor cede el 49% del resultado de Barrio Norte a una contraparte (NO es gasto: es reparto del
// resultado). Los retiros se imputan a la cuenta "Inversores" (hoy caen en "Sin clasificar"). v1 read-only:
// muestra acreditado (pct×resFinal) − retirado (mov. "Inversores") = saldo de cuenta corriente acumulado.
// apertura = saldo heredado con la contraparte al CIERRE del año anterior a `aperturaYear` (deuda; >0 = le
// debemos). Es un CARRY-IN: entra al inicio de `aperturaYear` y la CC acumula los 12 meses (acreditado −
// retirado) desde enero. Ej.: saldo socios BN al 31/12/2025 = 7.840.230 → siembra 2026 y corre hasta hoy.
const CESION = { matchNombre: "Barrio Norte", pct: 0.49, contraparte: "", apertura: 7_840_230, aperturaYear: 2026 };
const CESION_CUENTA = "Inversores";   // cuenta contable donde se imputan los retiros

// Helper puro: dado el resFinal[12] de la sede y los retiros[12] (cuenta "Inversores"), arma la cola.
function computeCesion(resFinal = [], retiros = [], { pct, apertura = 0, aperturaYear }, year) {
  const acreditado = Array.from({ length: 12 }, (_, m) => (Number(resFinal[m]) || 0) * pct);
  // El retiro es un egreso (viene con signo negativo): tomamos la magnitud pagada, que REDUCE lo que se debe.
  const retirado   = Array.from({ length: 12 }, (_, m) => Math.abs(Number(retiros[m]) || 0));
  // Carry-in: en `aperturaYear` la CC arranca con el saldo heredado al 1/1 (que ya incluye todo lo previo) y
  // acumula los 12 meses (acreditado − retirado) desde enero. Años previos al ancla: sin CC (null).
  // >0 = le debemos · <0 = adelantado.  (v1: años posteriores a `aperturaYear` reinician en 0, sin carry-forward.)
  const saldoAcum = new Array(12).fill(null);
  const saldoPrev = new Array(12).fill(null);   // saldo pendiente al inicio del mes (= saldo acumulado del mes anterior)
  if (year >= aperturaYear) {
    let acc = year === aperturaYear ? (Number(apertura) || 0) : 0;
    for (let m = 0; m < 12; m++) { saldoPrev[m] = acc; acc += acreditado[m] - retirado[m]; saldoAcum[m] = acc; }
  }
  return { acreditado, retirado, saldoAcum, saldoPrev };
}

// Cola de impuestos (Fondeadas/Rosedal): cuentas de "Sin clasificar" cuyo nombre matchea `matchers`
// (IVA, Ganancias…) → líneas de impuesto + Resultado Neto/FCF = resFinal − Σ impuestos. null si no hay.
function computeImpuestos(sinClasificar, matchers, resFinal) {
  const keys = Object.keys(sinClasificar).filter(k => matchers.some(m => _nkSede(k).includes(_nkSede(m))));
  if (!keys.length) return null;
  const byAcc = keys.map(k => ({ name: k, cur: sinClasificar[k] }));
  const total = Array.from({ length: 12 }, (_, m) => byAcc.reduce((s, a) => s + (Number(a.cur[m]) || 0), 0));
  const resNeto = resFinal.map((v, m) => (Number(v) || 0) - total[m]);
  return { keys, byAcc, total, resNeto };
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
// Match por nombre de cuenta (incluye). "Retenciones" son las retenciones sufridas en la fondeada
// (en Colombia: RteFte / RteICA) — la cuenta declara categoria_pnl="impuestos", igual que IVA, así
// que pertenece a esta cola. Sin esto quedaban en "Sin clasificar", fuera de todo total.
// TODO: esta lista curada por nombre debería salir de categoria_pnl="impuestos" en maestros —
// hoy cada cuenta de impuesto nueva hay que acordarse de agregarla acá o desaparece del resultado.
const IMPUESTOS_FOND = ["IVA", "Ganancias", "Retenciones"];
// Cola de resultado financiero (Fondeadas/Rosedal): cuentas de "Sin clasificar" que son financieras
// (intereses ganados suma, pérdidas financieras resta) → línea debajo de impuestos, antes del neto/FCF.
const FINANCIEROS_FOND = ["Intereses Ganados", "Perdidas Financieras"];
// Distribución de resultados de Rosedal (Segui Fit): cuenta corriente por parte (Socios / Ñako-BIGG) debajo
// del Free Cash Flow. INTERINO/hardcodeado del Excel del usuario (el módulo socios/inversores todavía no lleva
// esto). Reparto ~50/50 salvo el arranque (ago-2025 = 100% Socios, hasta consumir el saldo de apertura).
// Arrays month-indexed 0-11. Cuando exista el módulo, los Retiros saldrán de la cuenta Inversores por proveedor.
const Z12 = () => new Array(12).fill(0);
const _fill = (obj) => { const a = Z12(); for (const k in obj) a[k] = obj[k]; return a; };
const DISTRIB_ROSEDAL = {
  2025: {
    gananciaSocios: _fill({ 7:-2371243, 8:1130406, 9:1909142, 10:1793001, 11:1302583 }),
    gananciaBigg:   _fill({ 8:1130406, 9:1909142, 10:1793001, 11:1302583 }),
    retiroSocios:   _fill({ 7:7955000, 8:1360977, 10:1732096, 11:1732096 }),
    retiroBigg:     _fill({ 8:1349873, 10:1732096, 11:1732096 }),
    saldoSocios:    _fill({ 6:10337347, 7:11104, 8:-219467, 9:1689674, 10:1750580, 11:1321067 }),
    saldoBigg:      _fill({ 8:-219467, 9:1689674, 10:1750580, 11:1321067 }),
  },
  2026: {
    gananciaSocios: _fill({ 0:1812859, 1:4027135, 2:4127125, 3:3480096, 4:5181676, 5:863232 }),
    gananciaBigg:   _fill({ 0:1812859, 1:4027135, 2:4127125, 3:3480096, 4:5181676, 5:863232 }),
    retiroSocios:   _fill({ 0:1310100, 1:1963271, 2:3970800, 3:4657000, 4:2930000, 5:3500000 }),
    retiroBigg:     _fill({ 0:1310200, 1:1963170, 2:3970803, 3:4657189, 4:2930000, 5:3500000 }),
    saldoSocios:    _fill({ 0:1823826, 1:3887690, 2:4044015, 3:2867111, 4:5118787, 5:2482019 }),
    saldoBigg:      _fill({ 0:1823726, 1:3887691, 2:4044013, 3:2866920, 4:5118596, 5:2481828 }),
  },
};

// Go-live: el P&L arranca el 1/7/2026. Todo lo anterior es migración de saldos iniciales de Contagram
// (metida en cualquier cuenta/centro) y NO es resultado del período → se excluye de TODOS los P&L. Los
// saldos iniciales de verdad viven como filas SALDO_INICIAL en nb_movimientos (Balance/Tesorería, nunca P&L).
const PNL_INICIO = "2026-07-01";
// Mes en curso "YYYY-MM": corte para el aviso de TC faltante (mes pasado sin TC = hueco; en curso = esperado).
const _mesActualYM = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();

// Pre-traduce filas de P&L a USD (consolidado): convierte `total` + `iva_monto` al TC del mes de CADA fila
// (mes por mes) y marca `moneda:"USD"`, para que los builders corran nativos en USD sin tocar su lógica.
// `fx(monto, moneda, anio, mes)` traduce (o null si falta TC). Filas sin TC se dropean; los meses PASADOS
// sin TC se listan en `mesesSinTC` (el mes en curso sin TC de cierre es esperado → no se lista).
function traducirFilasUSD(rows, fx) {
  if (!fx) return { rows, mesesSinTC: [] };
  const out = [], sin = new Set();
  for (const r of (rows || [])) {
    if (!r?.fecha) { out.push(r); continue; }
    const anio = parseInt(r.fecha.slice(0, 4), 10), mes = parseInt(r.fecha.slice(5, 7), 10);
    const t = fx(Number(r.total) || 0, r.moneda || "ARS", anio, mes);
    if (t == null) { const ym = r.fecha.slice(0, 7); if (ym < _mesActualYM) sin.add(ym); continue; }
    const iva = fx(Number(r.iva_monto) || 0, r.moneda || "ARS", anio, mes) ?? 0;
    out.push({ ...r, total: t, iva_monto: iva, moneda: "USD" });
  }
  return { rows: out, mesesSinTC: [...sin].sort() };
}
// Overlay de P&L histórico pre go-live (nb_pnl_historico). APAGADO: la data histórica y su motor quedan
// construidos pero ocultos (los reportes se muestran de julio 2026 en adelante). Poner en true para re-activar.
const HISTORICO_HABILITADO = true;
const PNL_INICIO_ANIO = 2026;
const PNL_INICIO_MES  = 6;   // julio (0-based): en el año del go-live no se muestran los meses previos
// En el año del go-live, oculta las columnas de meses anteriores al go-live (Ene–Jun 2026 = vacías).
// En el año del go-live se ocultan los meses previos (Ene–Jun 2026 vacíos)… salvo cuando hay histórico cargado
// (nb_pnl_historico), donde esos meses SÍ tienen datos → se muestran.
const mesesVisibles = (activeMonths, year, hayHistorico = false, mesMax = null) => {
  const a = (Number(year) === PNL_INICIO_ANIO && !hayHistorico) ? activeMonths.filter(m => m >= PNL_INICIO_MES) : activeMonths;
  return mesMax == null ? a : a.filter(m => m <= mesMax);
};

// Monto de una fila del P&L: bruto (con IVA) o NETO (sin IVA → resultado real / EBITDA). El neto resta
// el iva_monto de la fila (facturas y movimientos imputados lo traen; sueldos/otros sin IVA → neto = total).
const montoPnL = (row, sinIva) => {
  const total = Number(row.total) || 0;
  return sinIva ? total - (Number(row.iva_monto) || 0) : total;
};

// Grupos de INGRESO del P&L Sede (los que suman en totIngresos) → su IVA es débito (ventas); el resto, crédito.
const SEDE_ING_KEYS = new Set(["vta_cf", "int_bigg", "int_corp"]);

// La consolidación FX (USD) se resuelve pre-traduciendo las filas a USD ANTES de llamar acá
// (ver traducirFilasUSD): este builder corre siempre en modo nativo (filtra por `moneda`).
function buildPnLSede(inRows, egRows, ccFilter, year, moneda, sinIva = false) {
  // Pre-poblar cada grupo con sus cuentas configuradas en 0 → se muestran aunque no tengan monto.
  const grupos = {};
  for (const g of SEDE_GRUPOS) { grupos[g.key] = {}; for (const c of g.cuentas) grupos[g.key][c] = new Array(12).fill(0); }
  const sinClasificar = {};
  // IVA stripped por línea (solo Sin IVA), para que el holding lo sume: líneas de ingreso → débito, de costo → crédito.
  const ivaDeb = new Array(12).fill(0), ivaCred = new Array(12).fill(0);
  const add = (rows) => {
    for (const row of rows) {
      if (!row.fecha || (row.fecha < PNL_INICIO && !row._historico) || row.fecha.slice(0,4) !== String(year)) continue;
      if ((row.moneda ?? "ARS") !== moneda) continue;
      if (ccFilter !== "todos" && !ccEnFiltro(ccFilter, row.centro_costo)) continue;
      const m = parseInt(row.fecha.slice(5,7), 10) - 1;
      if (m < 0 || m > 11) continue;
      const nombre = aliasCuentaSede((row.cuenta_contable ?? "").trim() || "Sin cuenta");
      const gkey   = SEDE_CUENTA_A_GRUPO.get(_nkSede(nombre));
      const bucket = gkey ? grupos[gkey] : sinClasificar;
      if (!bucket[nombre]) bucket[nombre] = new Array(12).fill(0);
      // Un COMPROBANTE cuyo subtipo no coincide con la naturaleza del grupo es CONTRA: un EGRESO (factura de
      // compra) en una cuenta de INGRESO (ej. Interusos) RESTA; un INGRESO en una cuenta de costo, resta. Así
      // el interuso netea (+ cobrado / − pagado, clearing de la sede). Los movimientos (sin subtipo) mantienen
      // su signo — ya vienen firmados desde movimientoToPnLRows.
      const st = String(row.subtipo || "").toUpperCase();
      const esEg = st === "EGRESO", esIn = st === "INGRESO", enIng = SEDE_ING_KEYS.has(gkey);
      const contra = !!gkey && ((esEg && enIng) || (esIn && !enIng));
      bucket[nombre][m] += montoPnL(row, sinIva) * (contra ? -1 : 1);
      // IVA: comprobante ingreso → débito, egreso → crédito; movimiento (sin subtipo) → por grupo.
      if (sinIva && gkey) ((esIn ? true : esEg ? false : enIng) ? ivaDeb : ivaCred)[m] += Number(row.iva_monto) || 0;
    }
  };
  add(inRows); add(egRows);
  return { grupos, sinClasificar, ivaDeb, ivaCred };
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
           ivaDeb: pnl.ivaDeb || new Array(12).fill(0), ivaCred: pnl.ivaCred || new Array(12).fill(0),
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
// Toggle Con IVA / Sin IVA (sin IVA = resultado real / EBITDA, cada línea neta de su IVA).
function IvaToggle({ value, onChange }) {
  const opts = [{ id: false, label: "Con IVA" }, { id: true, label: "Sin IVA" }];
  return (
    <div style={{ display: "inline-flex", gap: 2, background: "#f3f4f6", borderRadius: 9, padding: 3 }}>
      {opts.map(o => {
        const active = value === o.id;
        return (
          <button key={String(o.id)} onClick={() => onChange(o.id)} style={{
            background: active ? T.accentDark : "transparent", border: "none", borderRadius: 7,
            color: active ? T.accent : T.muted, fontFamily: T.font, fontSize: 12.5,
            fontWeight: active ? 800 : 600, padding: "6px 14px", cursor: "pointer", transition: "all .15s ease" }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#e5e7eb"; }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

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

// Overlay "Ampliar": muestra el reporte apuntado por `srcRef` como una foto a pantalla completa, escalada
// para entrar entera (sin scroll). Cierra con ✕, click en el fondo, o Esc.
function FotoOverlay({ srcRef, onClose, caption }) {
  const boxRef = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const src = srcRef.current, box = boxRef.current;
    if (!src || !box) return;
    const clon = clonarParaFoto(src, { caption });   // clon expandido (ancho real) + encabezado, colgado fuera de pantalla
    const { w, h } = medirContenido(clon);   // extensión real (evita que se corte la última columna)
    clon.style.position = "static"; clon.style.left = "auto";   // lo traigo al box
    box.innerHTML = ""; box.appendChild(clon);
    const availW = window.innerWidth * 0.96, availH = window.innerHeight * 0.9;
    setScale(Math.min(availW / w, availH / h, 1));
  }, [srcRef, caption]);
  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.78)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <button onClick={onClose} title="Cerrar" style={{ position: "absolute", top: 18, right: 22, zIndex: 1001,
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 40, height: 40, borderRadius: 999, border: "none", background: "rgba(255,255,255,.16)",
        color: "#fff", fontSize: 20, cursor: "pointer", padding: 0 }}>✕</button>
      <div onClick={e => e.stopPropagation()} style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}>
        <div ref={boxRef} />
      </div>
    </div>
  );
}

// Ítem del menú ⋮ de acciones del reporte (Excel / Ampliar / Copiar).
const actMenuItem = {
  display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
  background: "transparent", border: "none", borderRadius: 7, padding: "9px 12px",
  fontFamily: T.font, fontSize: 13, fontWeight: 600, color: T.text, cursor: "pointer",
};

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
    { header: "Δ",               kind: "var", abs: true, a: c => sumTo(c, mes), b: (c, p) => sumTo(p, mes) },
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
  { header: "TOTAL", kind: "val", total: true, get: c => months.reduce((s, m) => s + (Number(c?.[m]) || 0), 0) },
];

// Celdas de una fila. o = estilo base. o.bt/o.bb = borde sup/inf (se pone EN LA CELDA, no en el <tr>:
// con border-collapse los bordes del <tr> no pintan confiablemente sobre las celdas).
function celdasSede(cols, cur, prev, pol, o) {
  const bord = { ...(o.bt ? { borderTop: o.bt } : {}), ...(o.bb ? { borderBottom: o.bb } : {}) };
  return cols.map((col, i) => {
    if (col.kind === "var") {
      const a = col.a(cur, prev), b = col.b(cur, prev), d = a - b;
      if (col.abs) {
        // Δ absoluto: misma convención de signo que el resto del P&L (paréntesis = movió para el lado malo),
        // color por MEJORA (ingresos/resultados +1, costos −1).
        const dcolor = d * pol > 0 ? T.green : d * pol < 0 ? T.red : T.dim;
        return <td key={i} style={{ padding: o.pad, fontSize: (o.fs || 13) - 1, textAlign: "right",
          fontFamily: "var(--mono)", fontWeight: 700, color: dcolor, whiteSpace: "nowrap", ...bord,
          ...(col.total ? { borderLeft: `1px solid ${T.cardBorder}` } : {}) }}>{fmtPar(d, pol < 0)}</td>;
      }
      const pct = b ? d / b * 100 : null;
      // flecha por signo crudo; color por MEJORA (polaridad: ingresos/resultados +1, costos −1).
      const color = pct == null ? T.dim : (d * pol > 0 ? T.green : d * pol < 0 ? T.red : T.dim);
      return <td key={i} style={{ padding: o.pad, fontSize: (o.fs || 13) - 1, textAlign: "right",
        fontFamily: "var(--mono)", fontWeight: 700, color, whiteSpace: "nowrap", ...bord,
        ...(col.total ? { borderLeft: `1px solid ${T.cardBorder}` } : {}) }}>
        {pct == null ? "—" : `${d > 0 ? "↑" : d < 0 ? "↓" : ""}${Math.abs(pct).toFixed(1)}%`}</td>;
    }
    // Stock (saldo corriente): en la col TOTAL de Evolución no se suma; muestra el saldo del último mes CON
    // dato (≤ lastM), porque los meses vivos sin distribución vienen en 0 y no deben pisar el saldo.
    let v;
    if (o.stock && col.total) {
      let lm = o.lastM; while (lm > 0 && !(Number(cur?.[lm]) || 0)) lm--;
      v = Number(cur?.[lm]) || 0;
    } else v = col.get(cur, prev);
    if (o.pct && !o.stock) {
      // Al lado del nominal, el share (chiquito, gris) sobre el Total de Ingresos de la MISMA columna.
      const tot = col.get(o.pctTotalCur, o.pctTotalPrev);
      const sh = tot ? v / tot * 100 : null;
      const color = o.bySign ? (v > 0 ? T.green : v < 0 ? T.red : T.dim) : (v ? (o.color || T.text) : T.dim);
      return <td key={i} style={{ padding: o.pad, fontSize: o.fs || 13, textAlign: "right",
        fontFamily: "var(--mono)", fontWeight: o.fw || 400, color, whiteSpace: "nowrap", ...bord,
        ...(col.total ? { borderLeft: `1px solid ${T.cardBorder}` } : {}) }}>
        {fmtPar(v, pol < 0)}{v && sh != null ? <span style={{ color: T.muted, fontSize: (o.fs || 13) - 3, marginLeft: 4, fontWeight: 400 }}>({sh.toFixed(0)}%)</span> : ""}</td>;
    }
    const color = o.bySign ? (v > 0 ? T.green : v < 0 ? T.red : T.dim) : (v ? (o.color || T.text) : T.dim);
    return <td key={i} style={{ padding: o.pad, fontSize: o.fs || 13, textAlign: "right",
      fontFamily: "var(--mono)", fontWeight: o.fw || 400, color, whiteSpace: "nowrap", ...bord,
      ...(col.total ? { borderLeft: `1px solid ${T.cardBorder}` } : {}) }}>
      {fmtPar(v, pol < 0)}</td>;
  });
}

// Constructor PURO de las filas + columnas del P&L Sede (waterfall + colas Fondeadas/Rosedal). Lo usan tanto el
// render (PnLTableSede) como el exportador a Excel → una sola fuente de verdad para que la planilla salga
// idéntica a la pantalla. `isCol(key)` decide qué grupos van colapsados (el export pasa `() => false` = todo
// expandido). Devuelve { cols, filas, activeMonths, lastM }.
export function buildPnLSedeFilas(props, isCol) {
  const { pnl, sub, pnlPrev, subPrev, year, vista = "evolucion", mes = 0, cesion = null, impuestos = null,
          financieros = null, distribucion = null, retirosVivos = null, feeIvaVivo = null,
          netoLabel = "Resultado Neto", nombreCuenta = (x) => x, hayHistorico = false, mesMax = null,
          cesionResFinal = null, cesionRetiros = null } = props;
  const { totIngresos, margenContrib, totGastosOp, resOp, resFinal, activeMonths: _amRaw } = sub;
  const activeMonths = mesesVisibles(_amRaw, year, hayHistorico, mesMax);

  // Cesión de utilidades (cola de apropiación, solo cuando el scope es la sede con cesión, ej. Barrio Norte).
  // Los retiros son la cuenta "Inversores" de sinClasificar → se saca de ahí para no mostrarla dos veces.
  const cesKey = cesion && Object.keys(pnl.sinClasificar).find(k => _nkSede(k) === _nkSede(CESION_CUENTA));
  const cesData = cesion ? computeCesion(cesionResFinal || resFinal, cesionRetiros || (cesKey ? pnl.sinClasificar[cesKey] : []), cesion, year) : null;

  // Impuestos (Fondeadas/Rosedal): cola debajo del Resultado Operativo/Final. Las cuentas se sacan de
  // "Sin clasificar" (no duplicar) → ver computeImpuestos.
  const impData = impuestos ? computeImpuestos(pnl.sinClasificar, impuestos, resFinal) : null;
  // Fee IVA VIVO (Rosedal): el IVA del fee a Ñako (21%) se suma a la línea "IVA Compra" como crédito fiscal
  // (costo del mes; se recupera el mes siguiente). Es un derivado, no una cuenta → se inyecta acá.
  if (impData && feeIvaVivo && feeIvaVivo.some(v => Math.abs(v) > 0.5)) {
    const ic = impData.byAcc.find(a => _nkSede(a.name).includes(_nkSede("IVA Compra")));
    if (ic) ic.cur = ic.cur.map((v, m) => (Number(v) || 0) + (feeIvaVivo[m] || 0));
    else impData.byAcc.push({ name: "IVA Compra", cur: feeIvaVivo.map(v => Number(v) || 0) });
    impData.total = impData.total.map((v, m) => v + (feeIvaVivo[m] || 0));
  }
  // Resultado financiero (Fondeadas/Rosedal): intereses ganados − pérdidas, debajo de impuestos.
  const finData = financieros ? computeImpuestos(pnl.sinClasificar, financieros, resFinal) : null;

  // "Inversores" es la cuenta de retiros de cesión/distribución (reparto del resultado, NO gasto del P&L): se
  // muestra en su cola cuando el scope la tiene (Barrio Norte / Rosedal). En cualquier otro scope (ej. las 5
  // sedes juntas) NO es una cuenta "sin clasificar" real → se oculta SIEMPRE del diagnóstico. Es un match por
  // nombre exacto a esa única cuenta: cualquier otra cuenta genuinamente sin clasificar sigue con su alerta.
  const invKey = Object.keys(pnl.sinClasificar).find(k => _nkSede(k) === _nkSede(CESION_CUENTA));
  const hidden = new Set([cesKey, invKey, ...(impData?.keys || []), ...(finData?.keys || [])].filter(Boolean));
  const sinClasView = hidden.size
    ? Object.fromEntries(Object.entries(pnl.sinClasificar).filter(([k]) => !hidden.has(k)))
    : pnl.sinClasificar;
  const sinCls = Object.keys(sinClasView).length > 0;

  const cols = vista === "evolucion" ? colsEvolucion(activeMonths) : colsSedeVista(vista, mes, year);
  const lastM = activeMonths[activeMonths.length - 1];
  const Pg = pnlPrev?.grupos || {};
  const stP = k => (subPrev?.st?.[k]) || ZERO12;
  const filas = [];
  {
    const pushGrupo = (gk, pol) => {
      filas.push({ kind: "grupo", key: gk, label: grupoSede(gk).label, cur: sub.st[gk], prev: stP(gk), pol });
      if (!isCol(gk)) for (const name of grupoSede(gk).cuentas) {
        const cur = pnl.grupos[gk][name];
        if (SEDE_OCULTAR_SI_VACIA.has(_nkSede(name)) && !(cur || []).some(v => Number(v))) continue;
        filas.push({ kind: "cuenta", label: name, cur, prev: (Pg[gk]?.[name] || ZERO12), pol });
      }
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

    let fcfArr = resFinal;   // FCF (o Resultado Final sin cola) → base de la ganancia viva de la distribución
    if (impData || finData) {
      // Vista con cola (Fondeadas/Rosedal): Op → Financiero → Impuestos → Resultado Final → Comisión/Inversiones
      // → Free Cash Flow. El FCF es el mismo valor de siempre; solo cambia dónde caen las líneas.
      if (finData) {
        filas.push({ kind: "banda", label: "Resultado Financiero" });
        for (const a of finData.byAcc) filas.push({ kind: "cuenta", label: a.name, cur: a.cur, prev: ZERO12, pol: 1 });
      }
      if (impData) {
        filas.push({ kind: "banda", label: "Impuestos" });
        for (const a of impData.byAcc) filas.push({ kind: "cuenta", label: a.name, cur: a.cur, prev: ZERO12, pol: -1 });
      }
      const resFin = resOp.map((v, m) => (Number(v) || 0) + (finData?.total[m] || 0) - (impData?.total[m] || 0));
      filas.push({ kind: "result", label: "Resultado Final", cur: resFin, prev: ZERO12, pol: 1 });
      pushGrupo("com_res", -1);
      pushGrupo("inv_no_op", -1);
      fcfArr = resFin.map((v, m) => v - (sub.st.com_res?.[m] || 0) - (sub.st.inv_no_op?.[m] || 0));
      filas.push({ kind: "result", label: netoLabel, cur: fcfArr, prev: ZERO12, pol: 1 });
    } else {
      // Vista estándar (P&L Sedes): Comisión/Inversiones → Resultado Final (sin cola).
      pushGrupo("com_res", -1);
      pushGrupo("inv_no_op", -1);
      filas.push({ kind: "result", label: "Resultado Final", cur: resFinal, prev: subPrev.resFinal, pol: 1 });
    }

    // Distribución del FCF (Rosedal): cuenta corriente por parte (Socios / Ñako-BIGG). Apropiación del resultado
    // (NO lo afecta) → diseño VIOLETA (igual que la cesión) para diferenciarla del P&L. Es serie de saldo →
    // solo en Evolución. Datos del Excel del usuario (interino, DISTRIB_ROSEDAL).
    if (distribucion && vista === "evolucion") {
      const d = distribucion;
      const rv = retirosVivos || { socios: ZERO12, bigg: ZERO12 };
      // Primer mes VIVO del año: en el año de go-live desde PNL_INICIO_MES; años posteriores todo vivo; años
      // previos todo histórico. Histórico = hardcodeo (matchea el Excel, incl. el arranque no-50/50); vivo =
      // Ganancia = FCF/2 (50/50) y Retiros = movimientos de la cuenta Inversores por proveedor.
      const primerVivo = year === PNL_INICIO_ANIO ? PNL_INICIO_MES : (year > PNL_INICIO_ANIO ? 0 : 12);
      const combinar = (histGan, histRet, histSaldo, rvSide) => {
        const gan = new Array(12).fill(0), ret = new Array(12).fill(0), saldo = new Array(12).fill(0);
        let prev = 0;
        for (let m = 0; m < 12; m++) {
          if (m < primerVivo) { gan[m] = histGan?.[m] || 0; ret[m] = histRet?.[m] || 0; saldo[m] = histSaldo?.[m] || 0; }
          else { gan[m] = (Number(fcfArr[m]) || 0) / 2; ret[m] = rvSide?.[m] || 0; saldo[m] = prev + gan[m] - ret[m]; }
          prev = saldo[m];
        }
        return { gan, ret, saldo };
      };
      const soc = combinar(d.gananciaSocios, d.retiroSocios, d.saldoSocios, rv.socios);
      const big = combinar(d.gananciaBigg, d.retiroBigg, d.saldoBigg, rv.bigg);
      filas.push({ kind: "spacer" });
      // Banda maestra colapsable: agrupa toda la distribución (Socios + Ñako/BIGG) en un solo desplegable.
      filas.push({ kind: "banda", violet: true, key: "distrib", label: "Distribución" });
      if (!isCol("distrib")) {
        filas.push({ kind: "banda", violet: true, label: "Distribución — Socios" });
        filas.push({ kind: "cesion", signed: true, cur: soc.gan, label: "Ganancia del período" });
        filas.push({ kind: "cesion", cur: soc.ret, label: "Retiros" });
        filas.push({ kind: "cesion", bold: true, signed: true, stock: true, cur: soc.saldo, label: "Saldo acumulado" });
        filas.push({ kind: "banda", violet: true, label: "Distribución — Ñako / BIGG" });
        filas.push({ kind: "cesion", signed: true, cur: big.gan, label: "Ganancia del período" });
        filas.push({ kind: "cesion", cur: big.ret, label: "Retiros" });
        filas.push({ kind: "cesion", bold: true, signed: true, stock: true, cur: big.saldo, label: "Saldo acumulado" });
      }
    }

    // Cesión de utilidades (apropiación del resultado; NO afecta Resultado Final). Es una cuenta corriente
    // (serie de tiempo) → solo en Evolución; comparar un saldo corriente M-1/A-1/YTD no tiene sentido.
    if (cesData && vista === "evolucion") {
      filas.push({ kind: "spacer" });
      filas.push({ kind: "banda", violet: true, label: `Cesión de utilidades — ${Math.round(cesion.pct * 100)}%${cesion.contraparte ? ` · ${cesion.contraparte}` : ""}` });
      filas.push({ kind: "cesion", signed: true, stock: true, cur: cesData.saldoPrev, label: "Saldo pendiente" });
      filas.push({ kind: "cesion", signed: true, cur: cesData.acreditado, label: "Utilidades del período" });
      filas.push({ kind: "cesion", cur: cesData.retirado, label: "Retiros del período" });
      filas.push({ kind: "cesion", bold: true, signed: true, stock: true, cur: cesData.saldoAcum, label: "Saldo acumulado" });
    }
    // Sin clasificar (cuentas con movimiento fuera del P&L de la sede) — solo en Evolución (diagnóstico).
    if (sinCls && vista === "evolucion") {
      filas.push({ kind: "spacer" });
      filas.push({ kind: "banda", amber: true, label: "Sin clasificar (fuera del P&L de la sede)" });
      for (const [name, arr] of Object.entries(sinClasView))
        filas.push({ kind: "cuenta", label: nombreCuenta(name), cur: arr, prev: ZERO12, pol: 1, color: "#b45309" });
    }
  }
  return { cols, filas, activeMonths, lastM, sinCls };
}

function PnLTableSede(props) {
  const { moneda, label, year, vista = "evolucion", mes = 0 } = props;
  // Colapso jerárquico: bandas de sección (Ingresos / Gastos Op) + cada sub-grupo + Distribución + toggle maestro.
  const ALLKEYS = ["sec_ing", "sec_gop", "distrib", ...SEDE_GRUPOS.map(g => g.key)];
  const [collapsed, setCollapsed] = useState(() => Object.fromEntries(ALLKEYS.map(k => [k, true])));   // arranca compactado
  const isCol  = k => !!collapsed[k];
  const toggle = k => setCollapsed(c => ({ ...c, [k]: !c[k] }));
  const allCol = ALLKEYS.every(k => collapsed[k]);
  const toggleAll = () => setCollapsed(allCol ? {} : Object.fromEntries(ALLKEYS.map(k => [k, true])));

  const { cols, filas, activeMonths, lastM, sinCls } = buildPnLSedeFilas(props, isCol);

  if (activeMonths.length === 0) return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      padding: "60px 24px", textAlign: "center", boxShadow: T.shadow }}>
      <div style={{ fontSize: 14, color: T.muted }}>Sin datos para {year} en {moneda}{label ? ` · ${label}` : ""}.</div>
    </div>
  );

  // Celdas de una fila de cesión (violeta, con signo). Stock (saldo) → la col TOTAL muestra el saldo final.
  const cesionCells = (f) => cols.map((col, i) => {
      if (col.kind === "var") return <td key={i} style={{ padding: "9px 12px", textAlign: "right", color: T.dim }}>—</td>;
      let v;
      if (f.stock && col.total) { let lm = lastM; while (lm > 0 && !(Number(f.cur?.[lm]) || 0)) lm--; v = Number(f.cur?.[lm]) || 0; }
      else v = col.get(f.cur);
      return <td key={i} style={{ padding: "9px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--mono)",
        fontWeight: f.bold ? 800 : 700, color: "#6d28d9", whiteSpace: "nowrap",
        ...(col.total ? { borderLeft: `1px solid ${T.cardBorder}` } : {}) }}>{f.signed ? fmtSigned(v) : fmtN(v)}</td>;
    });

    return (
      <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
        boxShadow: T.shadow, overflowX: "auto", position: "relative" }}>
        <table style={{ width: "100%", borderCollapse: "collapse",
          ...(vista === "evolucion"
            ? { minWidth: 280 + activeMonths.length * 122 + 150, tableLayout: "fixed" }
            : { minWidth: 260 + cols.length * 120 }) }}>
          {vista === "evolucion" && (
            <colgroup>
              <col style={{ width: 280 }} />
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
                if (f.amber || f.violet) {
                  const c = f.violet ? { bg: "#ede9fe", fg: "#6d28d9" } : { bg: "#fffbeb", fg: "#b45309" };
                  const clickable = !!f.key;
                  return (
                    <tr key={idx} style={{ background: c.bg, cursor: clickable ? "pointer" : "default" }}
                      onClick={clickable ? () => toggle(f.key) : undefined}>
                      <td style={{ padding: "6px 16px", fontSize: 10, fontWeight: 800, color: c.fg, letterSpacing: ".12em",
                        textTransform: "uppercase", userSelect: "none", ...stickyCol, background: c.bg }}>
                        {clickable && <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{isCol(f.key) ? "▶" : "▼"}</span>}{f.label}</td>
                      <td colSpan={cols.length} style={{ background: c.bg }} />
                    </tr>
                  );
                }
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
                    stock: f.stock, lastM, bt: `3px solid ${rc}`, bb: `2px solid ${rc}` })}
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

// ─── P&L HUERGO (Wellness Real Estate, anillo 1) — negocio de MARGEN, no sede ──────────────────────
// Estructura simple (no waterfall de sede): Ingresos (lo que paga el edificio) − Costos (horas de coaches)
// = Margen. Agrupa dinámico por cuenta: inRows→Ingresos, egRows→Costos (así no hay que hardcodear cuentas).
function buildPnLHuergo(inRows, egRows, ccFilter, year, moneda, sinIva = false) {
  const ingresos = {}, costos = {};
  const ivaDeb = new Array(12).fill(0), ivaCred = new Array(12).fill(0);   // ingreso → débito, costo → crédito
  const add = (rows, bucket, esIng) => {
    for (const row of rows) {
      if (!row.fecha || (row.fecha < PNL_INICIO && !row._historico) || row.fecha.slice(0, 4) !== String(year)) continue;
      if ((row.moneda ?? "ARS") !== moneda) continue;
      if (!ccEnFiltro(ccFilter, row.centro_costo)) continue;
      const m = parseInt(row.fecha.slice(5, 7), 10) - 1; if (m < 0 || m > 11) continue;
      const nombre = (row.cuenta_contable ?? "").trim() || "Sin cuenta";
      (bucket[nombre] ??= new Array(12).fill(0))[m] += montoPnL(row, sinIva);
      if (sinIva) (esIng ? ivaDeb : ivaCred)[m] += Number(row.iva_monto) || 0;
    }
  };
  add(inRows, ingresos, true); add(egRows, costos, false);
  return { ingresos, costos, ivaDeb, ivaCred };
}
function computeSubtotalsHuergo(pnl) {
  const sumB = obj => MESES.map((_, m) => Object.values(obj).reduce((s, a) => s + (a[m] || 0), 0));
  const totIng = sumB(pnl.ingresos), totCos = sumB(pnl.costos);
  const margen = totIng.map((v, m) => v - totCos[m]);
  const months = new Set(); const curM = new Date().getMonth();
  for (let i = 0; i <= curM; i++) months.add(i);
  [pnl.ingresos, pnl.costos].forEach(o => Object.values(o).forEach(a => a.forEach((v, i) => { if (v) months.add(i); })));
  return { totIng, totCos, margen, ivaDeb: pnl.ivaDeb || new Array(12).fill(0), ivaCred: pnl.ivaCred || new Array(12).fill(0),
           activeMonths: [...months].sort((a, b) => a - b) };
}
function PnLTableHuergo({ pnl, sub, pnlPrev, subPrev, year, moneda, vista = "evolucion", mes = 0, hayHistorico = false, mesMax = null }) {
  const { totIng, totCos, margen, activeMonths: _amRaw } = sub;
  const activeMonths = mesesVisibles(_amRaw, year, hayHistorico, mesMax);
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
        ...(vista === "evolucion" ? { minWidth: 280 + activeMonths.length * 122 + 150, tableLayout: "fixed" } : { minWidth: 260 + cols.length * 120 }) }}>
        {vista === "evolucion" && (
          <colgroup><col style={{ width: 280 }} />{activeMonths.map(m => <col key={m} style={{ width: 122 }} />)}<col style={{ width: 150 }} /></colgroup>
        )}
        <thead><tr>
          <th style={{ ...thStyle, textAlign: "left", whiteSpace: "nowrap", ...stickyCol, background: T.tableHead, zIndex: 4 }}>Cuenta</th>
          {cols.map((c, i) => <th key={i} style={{ ...thStyle, ...(c.total ? { borderLeft: "1px solid rgba(255,255,255,.12)" } : {}) }}>{c.header}</th>)}
        </tr></thead>
        <tbody>
          {filas.map((f, idx) => {
            if (f.kind === "banda") return <BandaRow key={idx} label={f.label} span={cols.length + 1} expanded onToggle={undefined} />;
            if (f.kind === "cuenta") {
              const clickable = !!f.toggleKey;
              const cbg = f.nested ? "#eef1f5" : T.card;                              // filas de sede: fondo un toque más oscuro
              const pad = f.nested ? "6px 14px 6px 48px" : "6px 14px 6px 32px";        // sangría extra si es sede anidada
              return (
                <tr key={idx} onClick={clickable ? () => toggle(f.toggleKey) : undefined}
                  style={{ borderBottom: `1px solid ${T.cardBorder}`, background: cbg, cursor: clickable ? "pointer" : "default" }}>
                  <td style={{ padding: pad, fontSize: 13, color: T.text, whiteSpace: "nowrap",
                    borderBottom: `1px solid ${T.cardBorder}`, userSelect: clickable ? "none" : undefined, ...stickyCol, background: cbg }}>
                    {clickable && <span style={{ display: "inline-block", width: 18, marginLeft: -18, fontSize: 9, opacity: .7 }}>{isCol(f.toggleKey) ? "▶" : "▼"}</span>}{f.label}</td>
                  {celdasSede(cols, f.cur, f.prev, f.pol, { pad: "6px 12px", fs: 13, fw: 400, color: SEDE_HDR })}
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
  { key: "capex",  label: "Inversiones / Capex" },      // compra de operaciones: centro con categoria_pnl="capex" → DEBAJO del Resultado del Grupo
];
// Orden de las cuentas dentro de cada subgrupo (display; las que no figuran van al final, alfabéticas).
// Hardcodeado a propósito: es presentación, bajo riesgo (un nombre que no matchea solo se ordena último).
const BIGG_ORDEN = [
  "Regalias s/Ventas", "Licencia Uso de Marca", "Equipamientos", "Coorporativos (Gympass)",
  "Coorporativos", "APP (Gympass)", "Sponsor", "Pauta", "Otros Ingresos",
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
function buildPnLBigg(inRows, egRows, ccMap, cuentaMap, nucleoEmpresas, year, moneda, sinIva = false) {
  const grupos = {}; for (const g of BIGG_GRUPOS) grupos[g.key] = {};
  const sinClasificar = {};
  // IVA embebido (solo modo sin IVA): débito de ventas y crédito de compras, con signo "de caja"
  // (crédito compras = entra, + ; débito ventas = sale, −). Suman al resultado igual que hoy (el neto
  // restituye el IVA → Resultado del Grupo da IGUAL con/sin IVA), pero se muestran con su signo natural.
  const ivaDeb = new Array(12).fill(0), ivaCred = new Array(12).fill(0);
  const add = (rows, forcedSide) => {
    for (const row of rows) {
      if (!row.fecha || (row.fecha < PNL_INICIO && !row._historico) || row.fecha.slice(0, 4) !== String(year)) continue;
      if ((row.moneda ?? "ARS") !== moneda) continue;
      const m = parseInt(row.fecha.slice(5, 7), 10) - 1;
      if (m < 0 || m > 11) continue;
      const cc = ccMap.get(ccKey(row.centro_costo));
      const emp = (cc?.empresa ?? "").trim();
      if (emp && !nucleoEmpresas.has(emp)) continue;   // fuera del núcleo (anillo 2/3) → no consolida
      const fam = familiaCentro(cc);
      const cuenta = (row.cuenta_contable ?? "").trim() || "Sin cuenta";
      const meta = cuentaMap?.get(cuenta);
      const catPnl  = normCat(meta?.categoria_pnl);                            // "ventas" | "costo_venta" | …
      const catRaw  = (meta?.categoria_pnl ?? "").toLowerCase();               // crudo, para financieros/impuestos
      const catSede = (meta?.categoria_pnl_sede ?? "").trim().toLowerCase();   // "ventas" | "otros ingresos" | "costo por venta"
      let gkey = null, rowKey = cuenta, val = montoPnL(row, sinIva), neg = false;
      if (normCat(cc?.categoria_pnl) === "capex") {
        // Centro tagueado capex (ej. "HQ - Capex"): compra de operaciones → sección propia DEBAJO del
        // Resultado del Grupo, fuera de OPEX/sede. Lo decide el CENTRO (no la cuenta), y gana sobre todo.
        gkey = "capex";
      } else if (fam === "propios") {
        // Sede propia: en el HOLDING entra como RESULTADO (línea "Sedes Propias Argentina", vía su propio
        // motor) → ningún bucket de sede alimenta el holding. Su costo por venta va a "Gastos Sedes Propias"
        // (no a gpv) para no duplicarlo con el resultado de sede.
        if (catSede === "ventas") gkey = "vta_sp";
        else if (catSede === "otros ingresos") gkey = "int_sp";
        else { gkey = "gsp"; rowKey = "Gastos Sedes Propias"; }
      } else if ((fam === "wre" || fam === "gerenciamiento") && forcedSide !== "ingreso" && catPnl !== "ventas") {
        // EGRESO de WRE (Huergo/Puertos) o Gerenciamiento (Rosedal): su resultado entra al holding vía su
        // propio motor (resWRE / feeGer), que YA resta estos costos. Rutearlos a su bucket (no consumido por
        // computeSubtotalsHolding) evita el doble conteo — antes un costo con categoria "costo_venta" caía en
        // gpv y se restaba dos veces (una en el margen WRE, otra en Gastos por Ventas del holding).
        gkey = FAM_A_ING[fam]; if (gkey === "wre") rowKey = cc?.nombre ?? cuenta;
      } else if (ING_CONTRA_HQ.has(cuenta)) {
        gkey = "hq";                                      // netea en Ingresos
        rowKey = ING_CONTRA_HQ.get(cuenta) || cuenta;     // MISMA fila que su ingreso par → una sola línea neta
        if (forcedSide !== "ingreso") { val = -val; neg = true; }   // el costo (egreso) RESTA al ingreso
      } else if (catPnl === "costo_venta") {
        gkey = "gpv";                                     // COSTO por venta → Gastos por Ventas: Interusos, Fee Fact.
        if (forcedSide === "ingreso") { val = -val; neg = true; }   // lado ingreso de una cuenta intermediada = contra → neto en gpv
      } else if (forcedSide === "ingreso" || catPnl === "ventas") {
        if (fam) { gkey = FAM_A_ING[fam]; if (gkey === "wre") rowKey = cc?.nombre ?? cuenta; }   // VENTA → Ingresos HQ/ger/wre
      } else if (GPV_COSTO_EGRESO.has(cuenta)) {
        gkey = "gpv";                                     // cuenta intermediada: la venta es ingreso HQ, la COMPRA (egreso) = costo por venta (Pauta)
      } else if (catRaw.includes("financ")) {
        gkey = "fin";                                     // Financieros: filas = CUENTA (Intereses Ganados / Pérdidas Fin.)
      } else if (catRaw.includes("impuesto") || BIGG_ORDEN_IMP.includes(cuenta)) {
        gkey = "imp";                                     // Impuestos: filas = CUENTA (IVA / Ganancias / Plan AFIP…).
        // BIGG_ORDEN_IMP captura las que no tienen categoria en el maestro (ej. "IVA Inversiones") y si no caerían a OPEX.
      } else {
        gkey = "ghq";                                     // Gastos HQ (operativos): filas = CENTRO
        rowKey = cc?.nombre ?? cuenta;
      }
      const bucket = gkey ? grupos[gkey] : sinClasificar;
      if (!bucket[rowKey]) bucket[rowKey] = new Array(12).fill(0);
      bucket[rowKey][m] += val;
      // IVA stripped (solo Sin IVA) SOLO de los buckets HQ que consolida el holding (hq/gpv/ghq/fin/imp) —
      // sede/WRE/gerenciamiento reportan su IVA por su propio motor, no acá. Se clasifica por el signo con
      // que la línea entra al Resultado del Grupo: revenue (+) → débito ventas, costo (−) → crédito compras.
      // Así Σ(débito) − Σ(crédito) = impacto de HQ en el resultado, y el puente cierra por construcción.
      if (sinIva && HQ_IVA_BUCKETS.has(gkey)) {
        const contribSign = gkey === "hq" ? (neg ? -1 : 1) : gkey === "gpv" ? (neg ? 1 : -1) : -1;
        (contribSign > 0 ? ivaDeb : ivaCred)[m] += Number(row.iva_monto) || 0;
      }
    }
  };
  add(inRows, "ingreso"); add(egRows, null);
  return { grupos, sinClasificar, ivaDeb, ivaCred };
}

// Buckets HQ que el holding consolida línea por línea (para acumular su IVA acá; sede/WRE/ger lo hacen aparte).
const HQ_IVA_BUCKETS = new Set(["hq", "gpv", "ghq", "fin", "imp"]);

// Orden de los centros dentro de "Gastos HQ" (display).
const BIGG_ORDEN_GHQ = ["HQ - Sport", "HQ - Tecnologia", "HQ - Ventas y Operaciones", "11 - Huergo",
  "HQ - Marketing", "HQ - BI", "HQ - Design", "HQ - Gerencia General", "HQ - Administracion",
  "HQ - Recursos Humanos", "HQ - Infraestructura IT"];
const BIGG_ORDEN_GPV = ["Interusos", "Acciones de Mkt", "Coorporativos (Gympass)", "Fee Facturación"];
// Cuentas intermediadas: su VENTA es ingreso HQ, pero su COMPRA (egreso) es costo por venta (pega en margen).
const GPV_COSTO_EGRESO = new Set([]);
// Ingreso intermediado que netea DENTRO de Ingresos (no en Gastos por Ventas): su costo entra como
// contra (−) EN LA MISMA FILA que su ingreso par → una sola línea neta. Ej.: "Interusos" (costo) se
// suma a la fila "Coorporativos" → Coorporativos − Interusos. "Pauta" es igual: la venta a franquiciados
// (ingreso) netea la compra a JMC/Meta/Google (egreso) en la fila "Pauta". Margen y resultados NO cambian.
// Mapa: cuenta contra → fila de ingreso donde netea.
const ING_CONTRA_HQ = new Map([["Interusos", "Coorporativos"], ["Pauta", "Pauta"]]);
const BIGG_ORDEN_FIN = ["Intereses Ganados", "Perdidas Financieras"];
const BIGG_ORDEN_IMP = ["Plan Facilidades AFIP", "IVA", "IVA Inversiones", "IVA Compra", "Ganancias", "Otros Impuestos"];

// Cuentas de fee (gerenciamiento/WRE) que NO van en "Ingresos HQ" (ya son líneas de operación → no duplicar).
const BIGG_FEE_CUENTAS = ["Fee de Gestion y Adm", "Fee de Gestion y Adm (Huergo)"];

// P&L de HOLDING: arma el waterfall de management a partir de los RESULTADOS por negocio (resSedesAR/feeGer/
// resWRE, ya netos y pre-fin/pre-imp) + los grupos de HQ/financieros/impuestos que ya barrió buildPnLBigg.
// Convención de signo: igual que computeSubtotalsBigg (ingresos +, gastos/fin/imp positivos y se RESTAN).
function computeSubtotalsHolding(pnl, { resSedesAR, feeGer, resWRE }) {
  const Z = () => new Array(12).fill(0);
  // Cada negocio operativo llega como objeto { res, ivaDeb, ivaCred } (su resultado neto + el IVA que le sacó
  // a sus líneas). El holding suma esos IVA como cualquier otra línea → el empate Con/Sin sale por construcción.
  const cRes = c => (c && c.res) || Z(), cDeb = c => (c && c.ivaDeb) || Z(), cCred = c => (c && c.ivaCred) || Z();
  const sar = cRes(resSedesAR), fg = cRes(feeGer), wre = cRes(resWRE);
  const omit = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !keys.includes(k)));
  const sumG = obj => MESES.map((_, m) => Object.values(obj || {}).reduce((s, a) => s + (a[m] || 0), 0));
  const hqAccounts  = omit(pnl.grupos.hq,  BIGG_FEE_CUENTAS);    // ingresos HQ sin las fees de operación
  const ghqAccounts = omit(pnl.grupos.ghq, ["11 - Huergo"]);     // opex HQ sin Huergo (ya está en WRE)
  const gpvAccounts = pnl.grupos.gpv;                            // costo por venta HQ: Interusos, Fee Fact., compra Pauta
  const impuestos = sumG(pnl.grupos.imp);   // tributos reales (IVA saldo, Ganancias, etc.)
  const capexAccounts = pnl.grupos.capex;   // compra de operaciones: abajo del resultado, NO es gasto operativo
  const capex = sumG(capexAccounts);
  const ingHQ = sumG(hqAccounts), gpv = sumG(gpvAccounts), opexHQ = sumG(ghqAccounts),
        financieros = sumG(pnl.grupos.fin);
  const resOperaciones = MESES.map((_, m) => sar[m] + fg[m] + wre[m]);
  const resOpMasIngHQ  = MESES.map((_, m) => resOperaciones[m] + ingHQ[m]);   // Total Ingresos (waterfall corriente)
  const margen         = MESES.map((_, m) => resOpMasIngHQ[m] - gpv[m]);      // Margen de Contribución
  const resOpGrupo     = MESES.map((_, m) => margen[m] - opexHQ[m]);
  const resAntesImp    = MESES.map((_, m) => resOpGrupo[m] - financieros[m]);
  const resGrupoNeto   = MESES.map((_, m) => resAntesImp[m] - impuestos[m]);   // sin las líneas de IVA
  // IVA (solo modo Sin IVA): las líneas operativas van NETAS; las dos líneas de IVA devuelven el IVA embebido
  // → el Resultado del Grupo da IGUAL que Con IVA por construcción (sacar el IVA línea por línea y sumarlo
  // abajo = identidad). Débito (ventas, +) y Crédito (compras, −) son la columna REAL de IVA del núcleo
  // (cruzable AFIP): se suman de cada negocio (Sedes con el 49% de Barrio Norte cedido, Huergo, Gerenciamiento)
  // + HQ. No hay plug ni ancla: Débito − Crédito = el IVA que efectivamente se le sacó al resultado.
  const D = MESES.map((_, m) => cDeb(resSedesAR)[m] + cDeb(feeGer)[m] + cDeb(resWRE)[m] + (pnl.ivaDeb || Z())[m]);
  const C = MESES.map((_, m) => cCred(resSedesAR)[m] + cCred(feeGer)[m] + cCred(resWRE)[m] + (pnl.ivaCred || Z())[m]);
  const ivaDeb  = D;                    // mostrado sumando (+)
  const ivaCred = C.map(v => -v);       // mostrado restando (−)
  const resGrupo = MESES.map((_, m) => resGrupoNeto[m] + D[m] - C[m]);
  const resFinal = MESES.map((_, m) => resGrupo[m] - capex[m]);   // Resultado Final = después de inversiones/capex
  const months = new Set(); const cur = new Date().getMonth();
  for (let i = 0; i <= cur; i++) months.add(i);
  [sar, fg, wre, ingHQ, gpv, opexHQ, financieros, impuestos, capex].forEach(a => a.forEach((v, i) => { if (v) months.add(i); }));
  return { sar, fg, wre, hqAccounts, ghqAccounts, gpvAccounts, capexAccounts, ingHQ, gpv, opexHQ, financieros, impuestos, capex,
           ivaDeb, ivaCred,
           resOperaciones, resOpMasIngHQ, margen, resOpGrupo, resAntesImp, resGrupo, resFinal, activeMonths: [...months].sort((a, b) => a - b) };
}

// Construye cols + filas del P&L BIGG (holding). PURA y reutilizable: la usa el render (PnLTableBigg) Y la
// exportación a Excel → la planilla sale idéntica a la pantalla. `isCol(key)` decide qué secciones van
// expandidas (en export = () => false: todas abiertas, y el agrupado nativo de Excel las colapsa).
export function buildPnLBiggFilas({ pnl, sub, pnlPrev, subPrev, year, vista = "evolucion", mes = 0, hayHistorico = false, mesMax = null, soloIngresos = false, sedesApertura = null }, isCol) {
  const { sar, fg, wre, hqAccounts, ghqAccounts, gpvAccounts, capexAccounts,
          resOperaciones, resOpMasIngHQ, margen, resOpGrupo, resAntesImp, resGrupo, resFinal, activeMonths: _amRaw } = sub;
  const activeMonths = mesesVisibles(_amRaw, year, hayHistorico, mesMax);
  const hayCapex = Object.keys(capexAccounts || {}).length > 0;
  const cols = vista === "evolucion" ? colsEvolucion(activeMonths) : colsSedeVista(vista, mes, year);
  const lastM = activeMonths.length ? activeMonths[activeMonths.length - 1] : 0;
  const P = subPrev || {};
  const Pg = pnlPrev?.grupos || {};
  const sumMap = obj => MESES.map((_, m) => Object.values(obj || {}).reduce((s, a) => s + (a[m] || 0), 0));
  const ivaOn = sub.ivaDeb?.some(v => v) || sub.ivaCred?.some(v => v);
  const impBlockTot     = MESES.map((_, m) => (sub.ivaDeb?.[m] || 0) + (sub.ivaCred?.[m] || 0) - (sub.impuestos?.[m] || 0));
  const impBlockTotPrev = MESES.map((_, m) => ((P.ivaDeb?.[m]) || 0) + ((P.ivaCred?.[m]) || 0) - ((P.impuestos?.[m]) || 0));

  const filas = [];
  // Sección colapsable con cuentas por adentro (cur del sub, prev del subPrev; sumaria = Σ cuentas).
  const secc = (key, label, accounts, accountsPrev, order, pol) => {
    filas.push({ kind: "grupo", key, label, cur: sumMap(accounts), prev: sumMap(accountsPrev), pol });
    if (!isCol(key)) for (const [n] of Object.entries(accounts || {}).sort(ordCmp(order)))
      filas.push({ kind: "cuenta", label: n, cur: accounts[n], prev: (accountsPrev?.[n]) || ZERO12, pol });
  };

  // Resultado de Operaciones (una línea por negocio = SU resultado).
  filas.push({ kind: "grupo", key: "sec_op", label: "Resultado de Operaciones", cur: resOperaciones, prev: P.resOperaciones, pol: 1 });
  if (!isCol("sec_op")) {
    if (sedesApertura) {
      // Sedes Propias Argentina = grupo colapsable (arranca cerrado). Adentro: apertura por sede + una fila de
      // reconciliación (cesión Barrio Norte 49% + ajustes) para que las sedes cierren EXACTO con el total del holding.
      // "Sedes Propias Argentina": misma pinta que Rosedal/Huergo (fila cuenta), diferenciada solo por la
      // flechita (es el agrupador). Adentro, la apertura por sede va anidada (fondo + sangría).
      filas.push({ kind: "cuenta", toggleKey: "sec_sedes", label: "Sedes Propias Argentina", cur: sar, prev: P.sar, pol: 1 });
      if (!isCol("sec_sedes")) {
        const sumList = (list) => MESES.map((_, m) => (list || []).reduce((a, s) => a + (Number(s.arr?.[m]) || 0), 0));
        // Reconciliación (cesión Barrio Norte 49% + ajuste IVA aranceles) → se pliega dentro de la fila de BN,
        // que queda NETA de la cesión (se queda con el 51%). Así las sedes cierran EXACTO con el total del holding.
        const recCur  = MESES.map((_, m) => (Number(sar[m]) || 0)    - sumList(sedesApertura.cur)[m]);
        const recPrev = MESES.map((_, m) => (Number(P.sar?.[m]) || 0) - sumList(sedesApertura.prev)[m]);
        for (const s of (sedesApertura.cur || [])) {
          let curArr = s.arr;
          let prevArr = (sedesApertura.prev || []).find(x => x.label === s.label)?.arr || ZERO12;
          if (s.isBN) {
            curArr  = MESES.map((_, m) => (Number(s.arr?.[m]) || 0)   + recCur[m]);
            prevArr = MESES.map((_, m) => (Number(prevArr?.[m]) || 0) + recPrev[m]);
          }
          filas.push({ kind: "cuenta", nested: true, label: s.isBN ? `${s.label} (51%)` : s.label, cur: curArr, prev: prevArr, pol: 1 });
        }
      }
    } else {
      filas.push({ kind: "cuenta", label: "Sedes Propias Argentina",         cur: sar, prev: P.sar, pol: 1 });
    }
    filas.push({ kind: "cuenta", label: "Gerenciamiento de Sedes (Rosedal)", cur: fg,  prev: P.fg,  pol: 1 });
    filas.push({ kind: "cuenta", label: "Wellness Real Estate (Huergo)",    cur: wre, prev: P.wre, pol: 1 });
  }
  secc("sec_ing", "Ingresos HQ", hqAccounts, P.hqAccounts, BIGG_ORDEN, 1);
  filas.push({ kind: "subtotal", strong: true, label: "Total Ingresos", cur: resOpMasIngHQ, prev: P.resOpMasIngHQ, pol: 1, pctTotal: true });
  if (!soloIngresos) {
  secc("sec_gpv", "Gastos por Ventas", gpvAccounts, P.gpvAccounts, BIGG_ORDEN_GPV, -1);
  filas.push({ kind: "subtotal", strong: true, label: "Margen de Contribución", cur: margen, prev: P.margen, pol: 1 });
  secc("sec_opex", "OPEX HQ", ghqAccounts, P.ghqAccounts, BIGG_ORDEN_GHQ, -1);
  filas.push({ kind: "result", label: "Resultado Operativo del Grupo", cur: resOpGrupo, prev: P.resOpGrupo, pol: 1 });
  secc("sec_fin", "Financieros", pnl.grupos.fin, Pg.fin, BIGG_ORDEN_FIN, -1);
  filas.push({ kind: "result", label: "Resultado antes de Impuestos", cur: resAntesImp, prev: P.resAntesImp, pol: 1 });
  // Impuestos: sumarizador (contribución del bloque) + IVA débito/crédito (solo Sin IVA) + tributos reales.
  filas.push({ kind: "grupo", key: "sec_imp", label: "Impuestos", cur: impBlockTot, prev: impBlockTotPrev, pol: 1 });
  if (!isCol("sec_imp")) {
    if (ivaOn) {
      filas.push({ kind: "cuenta", label: "IVA Débito (ventas)",   cur: sub.ivaDeb,  prev: P.ivaDeb,  pol: 1 });
      filas.push({ kind: "cuenta", label: "IVA Crédito (compras)", cur: sub.ivaCred, prev: P.ivaCred, pol: 1 });
    }
    for (const [n, v] of Object.entries(pnl.grupos.imp || {}).sort(ordCmp(BIGG_ORDEN_IMP)))
      filas.push({ kind: "cuenta", label: n, cur: v, prev: (Pg.imp?.[n]) || ZERO12, pol: -1 });
  }
  filas.push({ kind: "result", strong: true, label: "Resultado del Grupo", cur: resGrupo, prev: P.resGrupo, pol: 1 });
  if (hayCapex) {
    filas.push({ kind: "spacer" });
    secc("sec_capex", "Inversiones / Capex", capexAccounts, P.capexAccounts, null, -1);
    filas.push({ kind: "result", strong: true, label: "Resultado Final del Grupo", cur: resFinal, prev: P.resFinal, pol: 1 });
  }
  }
  return { cols, filas, lastM, activeMonths };
}

// P&L BIGG = P&L de HOLDING. Arriba el RESULTADO de cada negocio operativo (no la venta); después HQ
// (ingresos − opex), y al final financieros + impuestos del grupo. `sub` = computeSubtotalsHolding.
function PnLTableBigg({ pnl, sub, pnlPrev, subPrev, year, moneda, vista = "evolucion", mes = 0, hayHistorico = false, mesMax = null, soloIngresos = false, sedesApertura = null, pctMode = false }) {
  const ALLKEYS = ["sec_op", "sec_sedes", "sec_ing", "sec_gpv", "sec_opex", "sec_fin", "sec_imp", "sec_capex"];
  const [collapsed, setCollapsed] = useState(() => Object.fromEntries(ALLKEYS.map(k => [k, true])));   // arranca compactado
  const isCol  = k => !!collapsed[k];
  const toggle = k => setCollapsed(c => ({ ...c, [k]: !c[k] }));
  const allCol = ALLKEYS.every(k => collapsed[k]);
  const toggleAll = () => setCollapsed(allCol ? {} : Object.fromEntries(ALLKEYS.map(k => [k, true])));

  const { cols, filas, activeMonths } = buildPnLBiggFilas(
    { pnl, sub, pnlPrev, subPrev, year, vista, mes, hayHistorico, mesMax, soloIngresos, sedesApertura }, isCol);

  if (activeMonths.length === 0) return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      padding: "60px 24px", textAlign: "center", boxShadow: T.shadow }}>
      <div style={{ fontSize: 14, color: T.muted }}>Sin datos para {year} en {moneda}.</div>
    </div>
  );

  // Modo % (flag del reporte "Composición de Ingresos"): las celdas muestran share del Total de Ingresos.
  const pctOpt = pctMode ? { pct: true, pctTotalCur: sub.resOpMasIngHQ, pctTotalPrev: (subPrev || {}).resOpMasIngHQ } : {};

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      boxShadow: T.shadow, overflowX: "auto", position: "relative" }}>
      <table style={{ width: "100%", borderCollapse: "collapse",
        ...(vista === "evolucion" ? { minWidth: 280 + activeMonths.length * 122 + 150, tableLayout: "fixed" } : { minWidth: 260 + cols.length * 120 }) }}>
        {vista === "evolucion" && (
          <colgroup><col style={{ width: 280 }} />{activeMonths.map(m => <col key={m} style={{ width: 122 }} />)}<col style={{ width: 150 }} /></colgroup>
        )}
        <thead><tr>
          <th onClick={toggleAll} title="Contraer / expandir todo" style={{ ...thStyle, textAlign: "left",
            whiteSpace: "nowrap", cursor: "pointer", userSelect: "none", ...stickyCol, background: T.tableHead, zIndex: 4 }}>
            <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{allCol ? "▶" : "▼"}</span>Cuenta
          </th>
          {cols.map((c, i) => <th key={i} style={{ ...thStyle, ...(c.total ? { borderLeft: "1px solid rgba(255,255,255,.12)" } : {}) }}>{c.header}</th>)}
        </tr></thead>
        <tbody>
          {filas.map((f, idx) => {
            if (f.kind === "spacer")
              return <tr key={idx}><td colSpan={cols.length + 1} style={{ height: 10, border: "none" }} /></tr>;
            if (f.kind === "grupo") return (
              <tr key={idx} onClick={() => toggle(f.key)} style={{ background: "#f1f5f9", borderTop: `1px solid ${T.cardBorder}`, cursor: "pointer" }}>
                <td style={{ padding: "7px 14px", fontSize: 11, fontWeight: 800, color: SEDE_HDR, textTransform: "uppercase",
                  letterSpacing: ".04em", userSelect: "none", ...stickyCol, background: "#f1f5f9" }}>
                  <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{isCol(f.key) ? "▶" : "▼"}</span>{f.label}
                </td>
                {celdasSede(cols, f.cur, f.prev, f.pol, { pad: "7px 12px", fs: 12, fw: 800, color: SEDE_HDR, ...pctOpt })}
              </tr>
            );
            if (f.kind === "cuenta") {
              const clickable = !!f.toggleKey;
              const cbg = f.nested ? "#eef1f5" : T.card;                              // filas de sede: fondo un toque más oscuro
              const pad = f.nested ? "6px 14px 6px 48px" : "6px 14px 6px 32px";        // sangría extra si es sede anidada
              return (
                <tr key={idx} onClick={clickable ? () => toggle(f.toggleKey) : undefined}
                  style={{ borderBottom: `1px solid ${T.cardBorder}`, background: cbg, cursor: clickable ? "pointer" : "default" }}>
                  <td style={{ padding: pad, fontSize: 13, color: T.text, whiteSpace: "nowrap",
                    borderBottom: `1px solid ${T.cardBorder}`, userSelect: clickable ? "none" : undefined, ...stickyCol, background: cbg }}>
                    {clickable && <span style={{ display: "inline-block", width: 18, marginLeft: -18, fontSize: 9, opacity: .7 }}>{isCol(f.toggleKey) ? "▶" : "▼"}</span>}{f.label}</td>
                  {celdasSede(cols, f.cur, f.prev, f.pol, { pad: "6px 12px", fs: 13, fw: 400, color: SEDE_HDR, ...pctOpt })}
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
                    bt: `${f.strong ? 3 : 2}px solid ${SEDE_HDR}`, bb: `2px solid ${T.cardBorder}`, ...(f.pctTotal ? {} : pctOpt) })}
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
// Comparador de cuentas: por `order` (índice explícito) y luego alfabético; sin `order`, alfabético.
const ordCmp = (order) => ([a], [b]) => {
  if (order) { const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b); }
  return a.localeCompare(b);
};

function PnlSection({ label, accounts, activeMonths, color, ncols, sub, order, expanded: expandedProp, onToggle, neg = false }) {
  const [expandedState, setExpandedState] = useState(true);
  // Controlado si viene onToggle (lo maneja el toggle maestro); si no, estado interno (como antes).
  const controlled = onToggle !== undefined;
  const expanded = controlled ? expandedProp : expandedState;
  const toggle = controlled ? onToggle : () => setExpandedState(e => !e);
  // `order` (opcional) = orden explícito de cuentas; sin él, alfabético (comportamiento previo).
  const rows = Object.entries(accounts).sort(ordCmp(order));
  const subTotals = MESES.map((_,m) => rows.reduce((s,[,v]) => s + (v[m] || 0), 0));
  return (
    <>
      {!sub && (
        <SectionRow label={label} values={subTotals} activeMonths={activeMonths}
          expanded={expanded} onToggle={toggle} />
      )}
      {sub && (
        <SubSectionRow label={label} values={subTotals} activeMonths={activeMonths}
          color={color} expanded={expanded} onToggle={toggle} neg={neg} />
      )}
      {expanded && rows.map(([nombre, vals]) => (
        <DataRow key={nombre} label={nombre} values={vals} activeMonths={activeMonths} color={color} neg={neg} />
      ))}
    </>
  );
}

function SubSectionRow({ label, values, activeMonths, color, expanded, onToggle, neg = false }) {
  const total = rowSum(values);
  const bg = "#f1f5f9";
  // Bordes SOLO en las celdas (no en el <tr>): evita costura/doblado en la sticky al colapsar.
  const bord = { borderTop: `2px solid ${color ?? T.cardBorder}`, borderBottom: `1px solid ${T.cardBorder}` };
  return (
    <tr style={{ background: bg, cursor: "pointer" }}
      onClick={onToggle}>
      <td style={{ padding: "7px 16px", fontSize: 12, fontWeight: 800,
        color: color ?? T.muted, letterSpacing: ".06em", textTransform: "uppercase", ...bord,
        userSelect: "none", ...stickyCol, background: bg }}>
        <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{expanded ? "▼" : "▶"}</span>
        {label}
      </td>
      {activeMonths.map(m => (
        <td key={m} style={{ padding: "7px 12px", fontSize: 12, textAlign: "right",
          fontFamily: "var(--mono)", fontWeight: 800, color: color ?? T.muted, whiteSpace: "nowrap", ...bord }}>
          {fmtPar(values[m], neg)}
        </td>
      ))}
      <td style={{ padding: "7px 14px", fontSize: 12, textAlign: "right", fontFamily: "var(--mono)",
        fontWeight: 900, color: color ?? T.muted, whiteSpace: "nowrap",
        borderLeft: `1px solid ${T.cardBorder}`, ...bord }}>
        {fmtPar(total, neg)}
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

// CxC / CxP del Balance = saldo PENDIENTE por comprobante. Los comprobantes NO tienen campo `estado`
// (el estado de pago se deriva); por eso NO se filtra por r.estado (que era siempre undefined → sumaba
// todo lo histórico). Se agrupa por id_comp (una FC = varias líneas), se restan los pagos (COBRO/PAGO por
// documento_id), y se suma el saldo remanente. Scope por sociedad, igual que cajas/bancos. Devuelve por moneda.
function saldoPendientePorComp(lineas, movs, subtipo, pagoTipo, sociedad) {
  const comp = {};   // id_comp → { total, moneda }
  for (const r of lineas) {
    if ((r.subtipo ?? "").toUpperCase() !== subtipo) continue;
    if (sociedad && (r.sociedad ?? "").toLowerCase() !== sociedad.toLowerCase()) continue;
    const k = r.id_comp || r.id;
    if (!comp[k]) comp[k] = { total: 0, moneda: r.moneda ?? "ARS" };
    comp[k].total += Number(r.total) || 0;
  }
  const pagado = {};   // documento_id → Σ |monto| de los pagos
  for (const m of movs) {
    if (m.tipo === pagoTipo && m.documento_id) pagado[m.documento_id] = (pagado[m.documento_id] || 0) + Math.abs(Number(m.monto) || 0);
  }
  const out = { ...ZERO };
  for (const k in comp) {
    const saldo = calcSaldoPendiente(comp[k].total, [{ monto: pagado[k] || 0 }]);
    if (saldo > 0.5 && comp[k].moneda in out) out[comp[k].moneda] += saldo;
  }
  return out;
}

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

  const cxcTot = useMemo(() => saldoPendientePorComp(rawIn, rawMovs, "INGRESO", "COBRO", sociedad), [rawIn, rawMovs, sociedad]);
  const cxpTot = useMemo(() => saldoPendientePorComp(rawEg, rawMovs, "EGRESO", "PAGO", sociedad), [rawEg, rawMovs, sociedad]);

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

// ─── Cash Flow: clasificación por ACTIVIDAD (método directo) ───────────────────
// Cada movimiento de caja se mapea a una actividad (operativo / inversión / financiación)
// y a un concepto (la línea de detalle). Los movimientos internos (transferencias entre
// cuentas propias y cambio de moneda) van a su propia sección: netean a nivel grupo pero
// mueven caja por cuenta/moneda, así el saldo de caja reconcilia con el banco.
// v1 curado; se itera. La clasificación fina inversión vs financiación de interco se hará por anillo.
const CF_ACT = [
  { key: "operativo",    label: "Actividades operativas" },
  { key: "inversion",    label: "Actividades de inversión" },
  { key: "financiacion", label: "Actividades de financiación" },
  { key: "internos",     label: "Movimientos internos (transferencias / cambio)" },
];
// Orden fijo de conceptos por actividad (para que las líneas salgan en orden de negocio, no por magnitud).
const CF_CONCEPTO_ORDEN = {
  operativo:    ["Ingresos Sedes", "Ingresos HQ", "Franquicias (neto)", "Costos Sedes", "Costos HQ", "Sin conciliar (pendiente)"],
  inversion:    ["Movimientos intercompañía", "Fondeo a otros negocios"],
  financiacion: ["Préstamos recibidos", "Pago de préstamos / cuotas", "Anticipos de clientes", "Aportes / dividendos / préstamos de socios"],
  internos:     ["Transferencias entre cuentas", "Cambio de moneda"],
};
// Clasifica un movimiento de caja por ACTIVIDAD + concepto de NEGOCIO. Resuelve el centro del propio
// movimiento o —si es cobro/pago contra factura— de la factura linkeada (docCentro). El negocio sale del
// centro: grupo=hq → HQ, sino sede. Fondeo = gasto a un centro de sociedad FUERA del núcleo → inversión.
function clasificarFlujo(m, { ccMap, nucleoEmpresas, docCentro } = {}) {
  const origen = String(m.origen || "").toLowerCase();
  const tipo   = String(m.tipo || "").toUpperCase();
  const doc    = String(m.documento_id || "");
  const entra  = (Number(m.monto) || 0) >= 0;
  // Internos (plata entre cajas/monedas propias — no es flujo del negocio)
  if (tipo === "TRANSFERENCIA") return { act: "internos", concepto: "Transferencias entre cuentas" };
  if (tipo === "CAMBIO")        return { act: "internos", concepto: "Cambio de moneda" };
  // Financiación
  if (origen === "socios") return { act: "financiacion", concepto: "Aportes / dividendos / préstamos de socios" };
  if (origen.startsWith("financiacion") || origen === "cuota" || doc.startsWith("FIN-"))
    return { act: "financiacion", concepto: entra ? "Préstamos recibidos" : "Pago de préstamos / cuotas" };
  if (origen === "anticipo_alta") return { act: "financiacion", concepto: "Anticipos de clientes" };   // el cliente te financia
  // Pago del resumen de tarjeta: settlement central → Costos HQ.
  if (tipo === "PAGO_TARJETA" || origen === "pago_tarjeta") return { act: "operativo", concepto: "Costos HQ" };
  // Franquicias (neto ingreso − egreso)
  if (origen === "franquicias") return { act: "operativo", concepto: "Franquicias (neto)" };
  // Inversión — interco
  if (origen === "intercompania" || origen === "interco_park" || origen === "interco_recibida" || tipo === "INTERCOMPANIA")
    return { act: "inversion", concepto: "Movimientos intercompañía" };
  // Resolver el centro: el del movimiento o el de la factura que paga/cobra (cobros/pagos no traen centro).
  const centroId = String(m.centro_costo || "").trim() || (doc && docCentro ? (docCentro.get(doc) || "") : "");
  const cc = centroId && ccMap ? ccMap.get(ccKey(centroId)) : null;
  const empresa = String(cc?.empresa || "").trim();
  const grupo   = String(cc?.grupo || "").toLowerCase();
  // Inversión — fondeo: gasto/ingreso a un centro cuya sociedad dueña está FUERA del núcleo.
  if (empresa && nucleoEmpresas && !nucleoEmpresas.has(empresa))
    return { act: "inversion", concepto: "Fondeo a otros negocios" };
  // Operativo por negocio. HQ = todo lo que NO es sede ni franquicia (sueldos HQ, otros gastos, catch-all).
  if (grupo === "hq")
    return { act: "operativo", concepto: entra ? "Ingresos HQ" : "Costos HQ" };
  if (cc && grupo !== "inversiones")   // centro de sede (operaciones): sueldos de sede caen en Costos Sedes
    return { act: "operativo", concepto: entra ? "Ingresos Sedes" : "Costos Sedes" };
  // Línea del extracto TODAVÍA no aceptada en la bandeja (caja real, aún sin imputar) = backlog de conciliación.
  // Una sola línea (neta): que dé CERO = los motores de conciliación están limpios para ese mes.
  if (origen === "extracto" && !doc)
    return { act: "operativo", concepto: "Sin conciliar (pendiente)" };
  // Catch-all: sin centro resoluble (raro) → HQ (no es sede ni franquicia).
  return { act: "operativo", concepto: entra ? "Ingresos HQ" : "Costos HQ" };
}

// ─── Tab Cash Flow ────────────────────────────────────────────────────────────
// CONSOLIDADO del núcleo (anillo 1): suma las cajas de todas las sociedades núcleo. El interco
// intra-núcleo se netea SOLO (ambas patas —origen "intercompania", mismo documento_id— están en el
// set y son opuestas → suman 0). El fondeo hacia anillo 2/3 queda (solo está la pata del núcleo) →
// aparece como Inversión: es plata que salió del perímetro del grupo.
const CF_GO_LIVE_YEAR = 2026;   // año del go-live
const CF_START_MES = 6;   // Julio (0-indexed): el Cash Flow arranca acá SOLO el año de go-live (1/7/2026).
                          // Los años posteriores arrancan en enero (todo lo previo va al saldo inicial).
// Orden de anillos en el filtro (los que no matcheen van al final, alfabético).
const CF_ANILLO_ORDEN = ["cleo", "fond", "extern"];
const anilloRank = (a) => { const x = String(a || "").toLowerCase(); const i = CF_ANILLO_ORDEN.findIndex(k => x.includes(k)); return i === -1 ? 99 : i; };

function TabCashFlow({ rawMovs, rawIn = [], rawEg = [], ccMap, nucleoEmpresas, selSoc = new Set(), year, moneda, tarjetaIds, cuentasBancarias = [] }) {
  const [open, setOpen] = useState({ operativo: true, inversion: true, financiacion: true, internos: false });
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }));

  // Índice factura → centro (los cobros/pagos no traen centro; lo sacamos de la factura linkeada).
  // El pago referencia el id_comp (ej. EG-123); las filas de comprobante traen sufijo de línea
  // (EG-123-L00001) → clavear por id_comp (sin -L) además del id completo. 1ª línea con centro gana.
  const docCentro = useMemo(() => {
    const m = new Map();
    for (const r of [...rawIn, ...rawEg]) {
      const centro = String(r.centro_costo ?? "");
      if (!centro) continue;
      const full = String(r.id ?? "");
      const comp = full.replace(/-L\d+$/i, "");
      if (full && !m.has(full)) m.set(full, centro);
      if (comp && !m.has(comp)) m.set(comp, centro);
    }
    return m;
  }, [rawIn, rawEg]);
  const ctx = useMemo(() => ({ ccMap, nucleoEmpresas, docCentro }), [ccMap, nucleoEmpresas, docCentro]);

  // Moneda AUTORITATIVA = la de la cuenta bancaria (una cuenta USD solo tiene USD). El campo `moneda` del
  // movimiento es fallback (por si una cuenta no está en el maestro). Evita que un movimiento mal cargado
  // (moneda en blanco → antes caía a ARS) se cuele en la moneda equivocada.
  const cuentaMoneda = useMemo(() => {
    const mm = new Map();
    for (const c of (cuentasBancarias || [])) mm.set(String(c.id), String(c.moneda || "ARS"));
    return mm;
  }, [cuentasBancarias]);
  const monedaDe = (m) => cuentaMoneda.get(String(m.cuenta_bancaria)) || (m.moneda ?? "ARS");

  // Predicado de caja: sociedad ELEGIDA (filtro en el box), con banco real, no ignorada, no tarjeta, en la moneda.
  const esCash = (m) => !!m.fecha && !esIgnorado(m) && !!m.cuenta_bancaria
    && !(tarjetaIds?.has(m.cuenta_bancaria)) && monedaDe(m) === moneda
    && (selSoc.size === 0 || selSoc.has(String(m.sociedad ?? "").trim()));

  // Arranque del período: SOLO el año de go-live empieza en julio (1/7/2026); los años posteriores en enero.
  // Todo lo previo al cutoff (incl. las aperturas al 30/6/2026) va al saldo inicial.
  const cfStartMes = year === CF_GO_LIVE_YEAR ? CF_START_MES : 0;
  const cutoff = `${year}-${String(cfStartMes + 1).padStart(2, "0")}-01`;

  const movsFilt = useMemo(() => rawMovs.filter(m => esCash(m) && m.fecha.slice(0, 4) === String(year) && m.fecha >= cutoff),
    [rawMovs, year, moneda, tarjetaIds, selSoc, cuentaMoneda]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saldo de caja al inicio del período (todo lo movido ANTES del cutoff, en esta moneda).
  const openingCash = useMemo(() => rawMovs.reduce((s, m) =>
    (esCash(m) && m.fecha < cutoff) ? s + (Number(m.monto) || 0) : s, 0),
    [rawMovs, year, moneda, tarjetaIds, selSoc, cuentaMoneda]); // eslint-disable-line react-hooks/exhaustive-deps

  // porAct[actividad][concepto] = 12 meses (neto firmado); actTot[actividad] = subtotal mensual.
  const { porAct, actTot } = useMemo(() => {
    const porAct = { operativo: {}, inversion: {}, financiacion: {}, internos: {} };
    for (const m of movsFilt) {
      const mes = parseInt(m.fecha.slice(5, 7), 10) - 1;
      if (mes < 0 || mes > 11) continue;
      const { act, concepto } = clasificarFlujo(m, ctx);
      (porAct[act][concepto] ??= new Array(12).fill(0))[mes] += Number(m.monto) || 0;
    }
    const actTot = {};
    for (const k of Object.keys(porAct))
      actTot[k] = MESES.map((_, m) => Object.values(porAct[k]).reduce((s, a) => s + a[m], 0));
    return { porAct, actTot };
  }, [movsFilt]);

  const flujoNeto = useMemo(() =>
    MESES.map((_, m) => CF_ACT.reduce((s, a) => s + actTot[a.key][m], 0)), [actTot]);

  // Saldo de caja acumulado (arranca en openingCash) y saldo al inicio de cada mes.
  const saldoFinal = useMemo(() => {
    let cum = openingCash;
    return flujoNeto.map(v => { cum += v; return cum; });
  }, [flujoNeto, openingCash]);
  const saldoInicioMes = useMemo(() => MESES.map((_, m) => saldoFinal[m] - flujoNeto[m]), [saldoFinal, flujoNeto]);

  const activeMonths = useMemo(() => {
    const s = new Set();
    movsFilt.forEach(m => { const i = parseInt(m.fecha.slice(5, 7), 10) - 1; if (i >= cfStartMes && i <= 11) s.add(i); });
    const finYear = new Date().getFullYear() === year ? new Date().getMonth() : 11;
    for (let i = cfStartMes; i <= Math.max(finYear, cfStartMes); i++) s.add(i);
    return [...s].sort((a, b) => a - b);
  }, [movsFilt, year]);

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
    <div style={{ fontSize: 12, color: T.muted, margin: "2px 0 10px", maxWidth: 820, lineHeight: 1.5 }}>
      Consolidado desde <b>julio</b> (go-live). El interco entre las sociedades <b>elegidas</b> se netea;
      el fondeo hacia una sociedad no elegida queda como <b>Inversión</b> (caja que sale del perímetro).
    </div>
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
      boxShadow: T.shadow, overflowX: "auto", position: "relative" }}>
      <table style={{ width: "100%", minWidth: 280 + activeMonths.length * 110, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: "left", minWidth: 260,
              ...stickyCol, background: T.tableHead, zIndex: 4 }}>Concepto</th>
            {activeMonths.map(m => <th key={m} style={thStyle}>{MESES[m]}</th>)}
            <th style={{ ...thStyle, borderLeft: "1px solid rgba(255,255,255,.12)" }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {/* Saldo de caja al inicio de cada mes. TOTAL = saldo al arranque del período (NO la suma de meses). */}
          <SubtotalRow label="Saldo inicial de caja" values={saldoInicioMes} activeMonths={activeMonths} color={T.muted} noBottom
            totalOverride={saldoInicioMes[activeMonths[0]] ?? 0} />

          {CF_ACT.map(({ key, label }) => {
            const ord = CF_CONCEPTO_ORDEN[key] || [];
            const rank = (n) => { const i = ord.indexOf(n); return i === -1 ? 99 : i; };
            const conceptos = Object.entries(porAct[key])
              .sort((a, b) => rank(a[0]) - rank(b[0]) || Math.abs(rowSum(b[1])) - Math.abs(rowSum(a[1])));
            const hasData = conceptos.length > 0;
            return (
              <Fragment key={key}>
                <SectionRow label={label} values={actTot[key]} activeMonths={activeMonths}
                  expanded={open[key]} onToggle={hasData ? () => toggle(key) : undefined} />
                {open[key] && conceptos.map(([nombre, vals]) => (
                  <DataRow key={nombre} label={nombre} values={vals} activeMonths={activeMonths}
                    color={rowSum(vals) >= 0 ? T.green : T.red} />
                ))}
              </Fragment>
            );
          })}

          <ResultadoRow label="Flujo neto del período" values={flujoNeto} activeMonths={activeMonths} />
          {/* TOTAL = saldo final del último mes activo (el saldo de caja "a hoy"), NO la suma de los meses. */}
          <SubtotalRow label="Saldo final de caja" values={saldoFinal} activeMonths={activeMonths} color={T.text} strong
            totalOverride={saldoFinal[activeMonths[activeMonths.length - 1]] ?? 0} />
        </tbody>
      </table>
    </div>
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
  { id: "cxp_prov", label: "CxP por proveedor", icon: "📋", desc: "Cuentas por pagar consolidadas por proveedor (todas las sociedades), con antigüedad." },
  { id: "cxc_cli", label: "CxC por cliente", icon: "📥", desc: "Cuentas por cobrar consolidadas por cliente (todas las sociedades), con antigüedad." },
  { id: "socios",  label: "Socios", icon: "◎", desc: "Cuenta corriente de socios: dividendos, aportes y préstamos (balance, no P&L)." },

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

  { id: "an_ventas",    label: "Composición de Ingresos", icon: "📈", desc: "Igual que el P&L BIGG hasta Total Ingresos: cada negocio (Sedes AR con apertura por sede / Rosedal / Huergo) y las líneas de HQ." },
  { id: "an_margenes",  label: "Márgenes por negocio", icon: "🧩", wip: true, desc: "Cuánto aporta cada negocio al Margen Bruto del grupo." },
  { id: "an_gastos_cc", label: "Gastos por centro de costo", icon: "🧾", wip: true, desc: "Apertura del gasto por centro de costo y, dentro, por cuenta contable." },
];

// ─── Menú por STORYTELLING (agrupado por la pregunta que uno se hace, no por taxonomía contable) ──
// Pensado para navegar el negocio de arriba hacia abajo: la foto del grupo → cómo rinde cada negocio →
// de dónde sale/va la plata → buscar el detalle → (lo fiscal/interno al fondo). Textos = management
// (todavía NO simplificados para dueños). El anillo de la sociedad manda cómo consolida (ver memoria).
const LENTES = [
  { id: "grupo",    label: "La foto del grupo",            tabs: ["consol_grupo", "pl_bigg", "an_ventas", "cf", "consolidado", "cxp_prov", "cxc_cli", "socios"] },
  { id: "negocios", label: "Cómo le va a cada negocio",    tabs: ["pl_sede", "op_espana", "op_colombia", "op_rosedal", "op_huergo", "op_puertos"] },
  { id: "flujo",    label: "De dónde sale y a dónde va",   tabs: ["an_gastos_cc"] },
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
  // Egresos incluyen sueldos → la contraparte es proveedor O legajo (ambos en contraparte_nombre,
  // que el buscador de la línea 2288 ya matchea). El label lo refleja.
  const contraLabel = esEg ? "Proveedor / Legajo" : "Cliente";
  const ccMap  = useMemo(() => new Map(ccs.map(c => [ccKey(c.id), c.nombre])), [ccs]);
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
                  <td style={{ ...td, color: T.muted, fontSize: 12 }} title={ccMap.get(ccKey(r.centro_costo)) || r.centro_costo || ""}>{ccMap.get(ccKey(r.centro_costo)) || r.centro_costo || "—"}</td>
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

// Modal "Descargar reportes a Excel": elige qué vistas incluir (Evolución/Mensual/YTD) y hasta qué mes.
// YTD arranca destildado si no hay datos del año anterior para comparar (defaultYtd).
function ExportModal({ open, onClose, onConfirm, defaultMes, hayAnioAnterior }) {
  const [vistas, setVistas] = useState({ evolucion: true, mensual: true, ytd: !!hayAnioAnterior });
  const [mes, setMes] = useState(defaultMes);
  useEffect(() => {
    if (open) { setVistas({ evolucion: true, mensual: true, ytd: !!hayAnioAnterior }); setMes(defaultMes); }
  }, [open, defaultMes, hayAnioAnterior]);
  if (!open) return null;
  const any = vistas.evolucion || vistas.mensual || vistas.ytd;
  const mesAnt = mes > 0 ? MESES[mes - 1] : "Dic";
  const OPCS = [
    { key: "evolucion", titulo: "Evolución", desc: `Mes a mes, Ene–${MESES[mes]} + TOTAL`, nota: null },
    { key: "mensual", titulo: "Mensual", desc: `${MESES[mes]} vs ${mesAnt} (y vs año anterior)`, nota: null },
    { key: "ytd", titulo: "YTD (acumulado)", desc: `Acumulado del año hasta ${MESES[mes]}`,
      nota: hayAnioAnterior ? null : "sin datos del año anterior para comparar" },
  ];
  const check = { width: 18, height: 18, cursor: "pointer", accentColor: "#065f46" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: 460,
        maxWidth: "92vw", padding: 24, boxShadow: "0 20px 50px rgba(0,0,0,.3)", fontFamily: T.font }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: T.text, marginBottom: 4 }}>Descargar reportes a Excel</div>
        <div style={{ fontSize: 13, color: T.muted, marginBottom: 18 }}>Elegí qué vistas incluir y hasta qué mes.</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          {OPCS.map(o => (
            <label key={o.key} style={{ display: "flex", gap: 11, alignItems: "flex-start", cursor: "pointer",
              padding: "10px 12px", border: `1px solid ${vistas[o.key] ? "#065f46" : T.cardBorder}`,
              borderRadius: 10, background: vistas[o.key] ? "#ecfdf5" : "#fff" }}>
              <input type="checkbox" checked={vistas[o.key]} style={check}
                onChange={() => setVistas(v => ({ ...v, [o.key]: !v[o.key] }))} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{o.titulo}</div>
                <div style={{ fontSize: 12, color: T.muted }}>{o.desc}</div>
                {o.nota && <div style={{ fontSize: 11.5, color: "#b45309", fontWeight: 600, marginTop: 2 }}>⚠ {o.nota}</div>}
              </div>
            </label>
          ))}
        </div>

        <div style={{ marginBottom: 22 }}>
          <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.muted,
            textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 }}>Hasta el mes</label>
          <select value={mes} onChange={e => setMes(Number(e.target.value))} style={selStyle}>
            {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ background: "#f3f4f6", border: `1px solid ${T.cardBorder}`,
            borderRadius: 8, color: T.text, fontFamily: T.font, fontSize: 13, fontWeight: 700,
            padding: "9px 18px", cursor: "pointer" }}>Cancelar</button>
          <button disabled={!any} onClick={() => onConfirm({ vistas, mes })} style={{
            background: any ? "#065f46" : "#9ca3af", border: "none", borderRadius: 8, color: "#fff",
            fontFamily: T.font, fontSize: 13, fontWeight: 700, padding: "9px 18px",
            cursor: any ? "pointer" : "not-allowed" }}>⬇ Descargar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function PantallaReportes({ sociedad = "nako" }) {
  const [activeTab,      setActiveTab]      = useState(null);   // null = menú-landing de reportes
  const [vistaPnl,       setVistaPnl]       = useState("evolucion");   // P&L Sedes: evolucion | mensual | ytd
  const [sinIva,         setSinIva]         = useState(() => { try { return localStorage.getItem("pnlSinIva") === "1"; } catch { return false; } });   // toggle Con/Sin IVA (recordado)
  const [mesSel,         setMesSel]         = useState(Math.max(0, new Date().getMonth() - 1));   // mes para vistas mensual/ytd (default: último mes completo, no el en curso)
  const [mesCorte,       setMesCorte]       = useState(null);   // Evolución: cortar meses > mesCorte (null = todos). Para ocultar el mes en curso incompleto.
  const [dlgExport,      setDlgExport]      = useState(false);  // modal "Descargar reportes a Excel"
  const [showActMenu,    setShowActMenu]    = useState(false);  // menú ⋮ de acciones del reporte
  const [fotoOpen,       setFotoOpen]       = useState(false);  // overlay "Ampliar" (reporte a pantalla completa)
  const [fotoMsg,        setFotoMsg]        = useState(null);   // feedback del "Copiar imagen" ("copiado"/error)
  const actMenuRef = useRef(null);   // menú ⋮ (outside-click)
  const reportRef  = useRef(null);   // contenedor de la tabla del reporte (fuente de la "foto")
  const [year,           setYear]           = useState(CUR_YEAR);
  const [selectedSedeCCs, setSelectedSedeCCs] = useState(null);   // null = todas · [] = ninguna · [ids] = subconjunto
  const [sedeOpen,        setSedeOpen]        = useState(false);
  useEffect(() => { try { localStorage.setItem("pnlSinIva", sinIva ? "1" : "0"); } catch {} }, [sinIva]);
  const [monedaSel,      setMonedaSel]      = useState("ARS");   // valor crudo del selector (incl. modos FX consolidados)
  const [tiposCambio,    setTiposCambio]    = useState({});      // nb_tipos_cambio: mapa YYYY-MM → tasas USD
  useEffect(() => { fetchTiposCambio().then(setTiposCambio).catch(() => {}); }, []);
  const [rawHist,        setRawHist]        = useState([]);      // nb_pnl_historico: leaf rows pre go-live (USD, sin IVA)
  useEffect(() => { if (!HISTORICO_HABILITADO) return; fetchPnLHistorico().then(r => setRawHist(Array.isArray(r) ? r : [])).catch(() => {}); }, []);
  // Modo de consolidación FX derivado del selector. "native" = filtra por moneda (como siempre);
  // "real" = traduce TODO a USD al TC de cierre de CADA mes (mezcla operación + efecto cambiario);
  // "const" = traduce TODO a USD al TC de UN mes ancla (el del selector Mes) → comparable, aísla el FX
  // (ARS vs USD y EUR vs USD quedan fijos, sin ruido de devaluación/caída del euro).
  const fxMode   = monedaSel === "USD_REAL" ? "real" : monedaSel === "USD_CONST" ? "const" : "native";
  const monedaPL = fxMode === "native" ? monedaSel : "USD";
  const setMonedaPL = setMonedaSel;   // los efectos que forzaban moneda (fondeadas/Huergo) siguen andando
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

  // Outside-click del menú ⋮ de acciones del reporte.
  useEffect(() => {
    if (!showActMenu) return;
    const handler = (e) => { if (actMenuRef.current && !actMenuRef.current.contains(e.target)) setShowActMenu(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showActMenu]);


  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true); setError(null);
      try {
        // Sueldos (liquidaciones + pagos) vive en otro backend → se dispara en paralelo al batch de Numbers.
        const liqsP  = fetchLiquidacionesCerradas().catch(() => []);
        const pagosP = fetchPagosAnio().catch(() => []);
        // Batch: 8 hojas group-wide de Numbers en UNA llamada → los fetch de abajo salen de caché.
        await primeCache([
          { resource: "nb_comprobantes" },
          { resource: "nb_movimientos" },
          { resource: "nb_cuentas_bancarias" },
          { resource: "nb_centros_costo" },
          { resource: "nb_cuentas" },
          { resource: "nb_financiaciones" },
          { resource: "nb_socios" },
          { resource: "nb_socios_cc" },
        ]);
        const [eg, ing, movs, cbs, ccList, ctaList, fin, socs, socsCC] = await Promise.all([
          // P&L Sedes/BIGG son group-level (todas las sociedades). Cash Flow (por sociedad) filtra client-side.
          fetchLineasEnriquecidas(null, ["EGRESO", "GASTO"]).catch(() => []),
          fetchLineasEnriquecidas(null, "INGRESO").catch(() => []),
          fetchMovTesoreria().catch(() => []),
          fetchCuentasBancarias().catch(() => []),
          fetchCentrosCosto().catch(() => []),
          fetchCuentas().catch(() => []),
          fetchFinanciaciones().catch(() => []),
          fetchSocios().catch(() => []),
          fetchSociosCC().catch(() => []),
        ]);
        const [liqsC, pagosS] = [await liqsP, await pagosP];
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

  // Clave por NOMBRE (lo que guardan las filas) y TAMBIÉN por id: varios writers de numbersApi
  // convierten id→nombre con `.replace(/^CUENTA_/, "")`, que no toca los ids nuevos (`CTA-…`) y
  // deja el id crudo en `cuenta_contable`. Esas filas no resolvían categoría y caían fuera de
  // todo total. Los nombres se cargan al final: si un id coincidiera con el nombre de otra
  // cuenta, gana el nombre.
  const cuentaMap = useMemo(() => {
    const m = new Map();
    for (const c of cuentas ?? []) if (c.id)     m.set(c.id, c);
    for (const c of cuentas ?? []) if (c.nombre) m.set(c.nombre, c);
    return m;
  }, [cuentas]);
  // id de cuenta → nombre (para mostrar nombre en "Sin clasificar" cuando el movimiento guardó el id).
  const nombreCuenta = useMemo(() => {
    const byId = new Map((cuentas ?? []).map(c => [c.id, c.nombre]));
    return (x) => byId.get(x) || x;
  }, [cuentas]);

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

  // Cash Flow: sociedades a consolidar (default = núcleo). Estado en el padre para que el filtro
  // viva en el box de filtros (junto a Año/Moneda). null = todavía sin tocar → usa el núcleo.
  const [cfSelSoc, setCfSelSoc] = useState(null);
  const cfSel = cfSelSoc ?? new Set(nucleoEmpresas);
  const cfSocGroups = useMemo(() => {
    const byAnillo = {};
    for (const s of (sociedades ?? [])) (byAnillo[s.anillo || "Sin anillo"] ??= []).push(s);
    return Object.entries(byAnillo)
      .sort(([a], [b]) => anilloRank(a) - anilloRank(b) || a.localeCompare(b))
      .map(([anillo, ss]) => ({ key: anillo, label: anillo,
        items: ss.sort((a, b) => (a.nombre || a.id).localeCompare(b.nombre || b.id))
          .map(s => ({ value: String(s.id), label: s.nombre || s.id })) }));
  }, [sociedades]);

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

  const ccMap = useMemo(() => new Map(ccs.map(c => [ccKey(c.id), c])), [ccs]);

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
    const cc = ccMap.get(ccKey(resolvedCCSede[0]));
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

  // Histórico pre go-live (nb_pnl_historico): leaf rows en moneda nativa, con dos columnas de IVA (`neto` = sin
  // IVA, `total` = con IVA → iva_monto = total − neto). Se parten en ingreso/egreso por la naturaleza de la
  // cuenta (mismo criterio que lo vivo) y se taguean `_historico` → saltan el corte del go-live en los builders.
  const { histIn, histEg } = useMemo(() => {
    const ins = [], egs = [];
    for (const r of (rawHist || [])) {
      const cuenta  = String(r.cuenta_contable || "").trim();
      const meta    = cuentaMap?.get(cuenta);
      const catPnl  = normCat(meta?.categoria_pnl);
      const catSede = String(meta?.categoria_pnl_sede || "").trim().toLowerCase();
      // Solo VENTAS/otros ingresos van por el lado ingreso (rutean a vta/int/ger/wre/hq). Financieros (incl.
      // Intereses Ganados), impuestos, costos y opex van por egRows → caen en su branch del motor por cuenta.
      // "Pauta" es ingreso HQ (netea con su compra vía ING_CONTRA_HQ) aunque no esté categorizada en el maestro.
      const esIngreso = catSede === "ventas" || catSede === "otros ingresos" || catPnl === "ventas" || cuenta.toLowerCase() === "pauta";
      const total = Number(r.total) || 0, neto = Number(r.neto) || 0;
      const row = {
        fecha: String(r.fecha || "").slice(0, 10), centro_costo: r.centro_costo || "",
        cuenta_contable: cuenta, sociedad: String(r.sociedad || "").trim(),
        moneda: String(r.moneda || "ARS").trim().toUpperCase(),
        total, iva_monto: total - neto, subtipo: esIngreso ? "INGRESO" : "EGRESO",
        _historico: true, _tipo: "Histórico",
      };
      (esIngreso ? ins : egs).push(row);
    }
    return { histIn: ins, histEg: egs };
  }, [rawHist, cuentaMap]);
  const hayHistorico = rawHist.length > 0;   // hay overlay pre go-live → mostrar los meses previos al go-live

  // Los comprobantes de retención practicada (tag RETDEP) son el "por pagar a AFIP" que nace al retenerle
  // a un proveedor: son PASIVO (viven en CxP vía rawEg), NO resultado del período (el gasto ya devengó en la
  // factura de compra). Se excluyen de TODOS los P&L acá, en el único punto donde rawEg alimenta el resultado.
  const egParaPnL = useMemo(() => rawEg.filter(r => !String(r.nota || "").includes(RETDEP_TAG)), [rawEg]);
  const egConSueldos = useMemo(() => [...egParaPnL, ...salaryRows, ...gastoMovRows, ...finRows, ...histEg], [egParaPnL, salaryRows, gastoMovRows, finRows, histEg]);

  // Mes ancla del modo constante: sigue al selector Mes en Mensual/YTD; en Evolución usa "Hasta" (o el
  // último mes completo). 0-based. El TC de ESTE mes (del año en curso) traduce TODOS los meses de AMBOS años.
  const anchorMes = (vistaPnl === "evolucion")
    ? (mesCorte ?? (year >= CUR_YEAR ? Math.max(0, new Date().getMonth() - 1) : 11))
    : mesSel;
  const fxConstTC   = useMemo(() => fxMode === "const" ? tcDelMes(tiposCambio, year, anchorMes + 1) : null, [fxMode, tiposCambio, year, anchorMes]);
  const fxConstFalta = fxMode === "const" && !fxConstTC;   // el mes ancla no tiene TC cargado
  // Traductor FX del P&L (consolidación). null en modo nativo. "real" = a USD al TC de cierre del mes de cada
  // fila (traducí mes por mes y sumá). "const" = a USD al TC del mes ancla, ignorando el mes de la fila.
  const fxConv = useMemo(() => {
    if (fxMode === "real")  return (monto, moneda, anio, mes) => montoAUSD(monto, moneda, tcDelMes(tiposCambio, anio, mes));
    if (fxMode === "const") return (monto, moneda) => montoAUSD(monto, moneda, fxConstTC);
    return null;
  }, [fxMode, tiposCambio, fxConstTC]);
  // Traduce un array mensual ARS [12] a USD al TC de cierre de cada mes (o lo deja igual en modo nativo).
  const fxArrARS = useCallback((arr, anio) => {
    if (!fxConv || !arr) return arr;
    return arr.map((v, m) => v ? (fxConv(v, "ARS", anio, m + 1) ?? 0) : 0);
  }, [fxConv]);

  // Retiros VIVOS de Rosedal (Segui Fit): movimientos a la cuenta "Inversores" del centro Rosedal, agrupados
  // por proveedor → Ñako = BIGG, resto (individuos) = Socios. Alimenta la distribución del período post go-live
  // (el histórico sigue del hardcodeo DISTRIB_ROSEDAL). { year → { socios:[12], bigg:[12], feeIva:[12] } }.
  const retirosRosedal = useMemo(() => {
    const out = {};
    for (const l of egConSueldos) {
      if (String(l.cuenta_contable || "").trim() !== "Inversores") continue;
      if (String(l.centro_costo || "") !== "cc-2026-rosedal") continue;
      const f = String(l.fecha || ""); if (!f) continue;
      const y = parseInt(f.slice(0, 4), 10), m = parseInt(f.slice(5, 7), 10) - 1;
      if (m < 0 || m > 11) continue;
      // Solo meses VIVOS (>= go-live). Los meses históricos ya traen su distribución+fee del hardcodeo
      // (DISTRIB_ROSEDAL) → un movimiento en un mes histórico duplicaría el fee IVA / los retiros.
      const esVivo = (y > PNL_INICIO_ANIO) || (y === PNL_INICIO_ANIO && m >= PNL_INICIO_MES);
      if (!esVivo) continue;
      const prov = String(l.contraparte_nombre || l.proveedor_nombre || "").toLowerCase();
      // Traducir al MISMO TC que el P&L (modo USD). En modo nativo, ARS crudo.
      const amt = fxConv ? (fxConv(Math.abs(Number(l.total) || 0), "ARS", y, m + 1) ?? 0) : Math.abs(Number(l.total) || 0);
      const o = out[y] = out[y] || { socios: new Array(12).fill(0), bigg: new Array(12).fill(0), feeIva: new Array(12).fill(0) };
      if (/[ñn]ako/.test(prov)) {
        // Ñako = fee facturado con IVA (el movimiento es bruto): retiro NETO = bruto/1,21; el IVA (21%) sube
        // a la línea "IVA Compra" (crédito fiscal), no queda en el retiro de la distribución.
        const net = amt / 1.21;
        o.bigg[m] += net;
        o.feeIva[m] += amt - net;
      } else {
        o.socios[m] += amt;   // individuos = monotributistas, sin IVA
      }
    }
    return out;
  }, [egConSueldos, fxConv]);

  // Distribución histórica (DISTRIB_ROSEDAL) traducida a USD al TC de cada mes (idéntica en modo nativo).
  const distribRosedalFx = useMemo(() => {
    const base = DISTRIB_ROSEDAL[year];
    if (!base || !fxConv) return base;
    const out = {};
    for (const k of Object.keys(base)) out[k] = fxArrARS(base[k], year);
    return out;
  }, [year, fxConv, fxArrARS]);

  // Facturación a franquiciados (read-only) → ingreso del P&L HQ, en el centro HQ de Ventas.
  const ventasCcId = useMemo(
    () => ccs.find(c => (c.grupo ?? "").toLowerCase() === "hq" && normCat(c.categoria_pnl) === "ventas")?.id ?? "",
    [ccs]
  );
  const franqRows = useMemo(
    () => franquiciasIngresoPnLRows(rawFranq, "", ventasCcId).map(r => ({ ...r, _tipo: "Franquicia" })),
    [rawFranq, ventasCcId]
  );
  const inConFranq = useMemo(() => [...rawIn, ...franqRows, ...histIn], [rawIn, franqRows, histIn]);

  // Detalle de Informes: las MISMAS fuentes que el P&L (comprobantes + gastos directos + sueldos +
  // financiaciones), tagueadas por `_tipo`. Egresos = todo lo que resta en el resultado; Ingresos = ventas
  // + franquicias + ingresos contabilizados por movimiento.
  const egDetalle  = useMemo(() => egConSueldos.filter(r => !r._tipo || ["Gasto", "Sueldo", "Financiación"].includes(r._tipo)), [egConSueldos]);
  const ingDetalle = useMemo(() => [...inConFranq, ...gastoMovRows.filter(r => r._tipo === "Ingreso" || r._tipo === "Retención")], [inConFranq, gastoMovRows]);

  // Filas pre-traducidas a USD para el consolidado (UNA vez, mes por mes). En modo nativo (fxConv null) son
  // las mismas filas → todos los P&L (Sedes/Huergo/BIGG) corren nativos en USD sin tocar su lógica. Mecanismo
  // único de traducción del consolidado.
  const inFxRows = useMemo(() => traducirFilasUSD(inConFranq, fxConv), [inConFranq, fxConv]);
  const egFxRows = useMemo(() => traducirFilasUSD(egConSueldos, fxConv), [egConSueldos, fxConv]);
  const inFx = inFxRows.rows, egFx = egFxRows.rows;
  // Meses PASADOS sin TC (alimenta el aviso). El mes en curso sin TC de cierre es esperado → no entra.
  const mesesSinTC = useMemo(
    () => [...new Set([...(inFxRows.mesesSinTC || []), ...(egFxRows.mesesSinTC || [])])].sort(),
    [inFxRows, egFxRows]
  );
  const pnlSede = useMemo(
    () => buildPnLSede(inFx, egFx, resolvedCCSede, year, monedaPL, sinIva),
    [inFx, egFx, resolvedCCSede, year, monedaPL, sinIva]
  );

  // Año anterior (mismos arrays, filtrados a year-1) → comparativas Mensual/YTD sin fetch extra.
  const pnlSedePrev = useMemo(
    () => buildPnLSede(inFx, egFx, resolvedCCSede, year - 1, monedaPL, sinIva),
    [inFx, egFx, resolvedCCSede, year, monedaPL, sinIva]
  );
  const subSede     = useMemo(() => computeSubtotalsSede(pnlSede), [pnlSede]);
  const subSedePrev = useMemo(() => computeSubtotalsSede(pnlSedePrev), [pnlSedePrev]);
  // Resultado NETO (sin IVA) de la sede → base para el ACREDITADO de la cesión: el 49% se apropia sobre la
  // ganancia real, NO sobre el resultado bruto (en Con IVA el acreditado se infla). Independiente del toggle.
  const subSedeNet  = useMemo(
    () => sinIva ? subSede : computeSubtotalsSede(buildPnLSede(inFx, egFx, resolvedCCSede, year, monedaPL, true)),
    [inFx, egFx, resolvedCCSede, year, monedaPL, sinIva, subSede]
  );
  // Retiros de la cesión (cuenta "Inversores") SIEMPRE con IVA (total), independiente del toggle: el retiro es
  // el efectivo real pagado al inversor. Tomo la versión Con IVA del pnl de sede.
  const cesionRetirosCI = useMemo(() => {
    const p = sinIva ? buildPnLSede(inFx, egFx, resolvedCCSede, year, monedaPL, false) : pnlSede;
    const k = Object.keys(p.sinClasificar).find(x => _nkSede(x) === _nkSede(CESION_CUENTA));
    return k ? p.sinClasificar[k] : null;
  }, [inFx, egFx, resolvedCCSede, year, monedaPL, sinIva, pnlSede]);

  // Huergo (WRE): negocio de margen. Scope = centro con operacion "Wellness Real Estate".
  const huergoCCs = useMemo(
    () => ccs.filter(c => (c.operacion ?? "").trim() === "Wellness Real Estate").map(c => c.id),
    [ccs]
  );
  // Se computa solo cuando la pestaña Huergo está activa (evita escanear los datasets en cada render de otras).
  const pnlHuergo     = useMemo(() => isHuergo ? buildPnLHuergo(inFx, egFx, huergoCCs, year, monedaPL) : null, [isHuergo, inFx, egFx, huergoCCs, year, monedaPL]);
  const subHuergo     = useMemo(() => pnlHuergo ? computeSubtotalsHuergo(pnlHuergo) : null, [pnlHuergo]);
  const pnlHuergoPrev = useMemo(() => isHuergo ? buildPnLHuergo(inFx, egFx, huergoCCs, year - 1, monedaPL) : null, [isHuergo, inFx, egFx, huergoCCs, year, monedaPL]);
  const subHuergoPrev = useMemo(() => pnlHuergoPrev ? computeSubtotalsHuergo(pnlHuergoPrev) : null, [pnlHuergoPrev]);

  // ── P&L BIGG = P&L de HOLDING (Núcleo/anillo 1). Se computa solo en la pestaña pl_bigg. ──
  const isBigg = activeTab === "pl_bigg";
  const isVentasHQ = activeTab === "an_ventas";   // reporte "Aporte a los ingresos" — reusa el holding
  const ordControls = isSedeLike || isBigg || isVentasHQ;   // ordena Año→Mes a la izquierda y Moneda/IVA a la derecha (como P&L Sedes)
  // Scope fijo del holding (independiente del tab): sedes propias AR del núcleo + el centro Barrio Norte.
  const arNucleoCCs = useMemo(
    () => ccs.filter(c => (c.grupo ?? "").toLowerCase() === "operaciones" &&
      nucleoEmpresas.has((c.empresa ?? "").trim()) && familiaCentro(c) === "propios").map(c => c.id),
    [ccs, nucleoEmpresas]
  );
  const bnCcId = useMemo(() => ccs.find(c => _nkSede(c.nombre).includes(_nkSede(CESION.matchNombre)))?.id, [ccs]);

  // El holding usa las MISMAS filas pre-traducidas (inFx/egFx, definidas arriba). Alias por legibilidad.
  const inBigg = inFx, egBigg = egFx;

  // Holding (P&L BIGG) para un año dado → { pnl (grupos+capex con fondeo), sub (subtotales) }. Se calcula para
  // `year` y `year-1` (comparativas Mensual/YTD). Usa las filas pre-traducidas inBigg/egBigg (USD en consolidado).
  const holdingDe = (yr) => {
    // Sedes Propias AR neto del 49% de Barrio Norte. La cesión es una apropiación del resultado NETO (no lleva
    // IVA): se resta 0,49 × resultado neto de BN al `res` y NO se toca el tracking de IVA. Así coincide con los
    // DIVIDENDOS BN y no se infla en la vista Con IVA (antes cedía 0,49 × resultado bruto → sobrestimaba ~1,7M/mes).
    const sAR = computeSubtotalsSede(buildPnLSede(inBigg, egBigg, arNucleoCCs, yr, monedaPL, sinIva));
    const sBNnet = bnCcId ? computeSubtotalsSede(buildPnLSede(inBigg, egBigg, [bnCcId], yr, monedaPL, true)) : null;
    // IVA de aranceles de sedes AR (total − neto): el histórico no trae iva_monto, así que la sede computa aranceles
    // BRUTO. Ese IVA es un costo que NO va a la sede (los socios se liquidan neto → sus saldos ya cierran): se
    // DEVUELVE al resultado de sede (queda neto) y se reconoce como costo en HQ (abajo). No toca el dato de sede.
    const arIVASedes = new Array(12).fill(0);
    const sumaArIVA = (r) => {
      if (!/aranceles/i.test(String(r.cuenta_contable || ""))) return;
      if (!r.fecha || (r.fecha < PNL_INICIO && !r._historico) || r.fecha.slice(0, 4) !== String(yr)) return;
      if ((r.moneda ?? "ARS") !== monedaPL) return;
      if (!ccEnFiltro(arNucleoCCs, r.centro_costo)) return;
      const m = parseInt(r.fecha.slice(5, 7), 10) - 1;
      const t = Number(r.total) || 0, n = Number(r.neto);
      // iva_monto no viene en el histórico y `neto` se pierde en el pipeline → derivo el IVA (21%) del total.
      const iva = Number(r.iva_monto) || (Number.isFinite(n) && n ? t - n : t * 0.21 / 1.21);
      if (m >= 0 && m < 12 && Number.isFinite(iva)) arIVASedes[m] += iva;
    };
    for (const r of inBigg) sumaArIVA(r);
    for (const r of egBigg) sumaArIVA(r);
    const resSedesAR = {
      res:    sAR.resFinal.map((v, m) => v - CESION.pct * (Number(sBNnet?.resFinal?.[m]) || 0) + arIVASedes[m]),
      ivaDeb: sAR.ivaDeb, ivaCred: sAR.ivaCred,
    };
    // Gerenciamiento (Rosedal) = fee Ñako→Segui (cuenta "Fee de Gestion y Adm" exacta, núcleo; venta → IVA débito).
    const fRes = new Array(12).fill(0), fDeb = new Array(12).fill(0);
    for (const r of inBigg) {
      if (_nkSede(r.cuenta_contable) !== _nkSede("Fee de Gestion y Adm")) continue;
      if (!nucleoEmpresas.has((r.sociedad ?? "").trim())) continue;
      if (!r.fecha || (r.fecha < PNL_INICIO && !r._historico) || r.fecha.slice(0, 4) !== String(yr)) continue;
      if ((r.moneda ?? "ARS") !== monedaPL) continue;
      const m = parseInt(r.fecha.slice(5, 7), 10) - 1;
      if (m >= 0 && m < 12) { fRes[m] += montoPnL(r, sinIva); if (sinIva) fDeb[m] += Number(r.iva_monto) || 0; }
    }
    const feeGer = { res: fRes, ivaDeb: fDeb, ivaCred: new Array(12).fill(0) };
    // Wellness Real Estate = margen de Huergo (+ Puertos a futuro).
    const sH = computeSubtotalsHuergo(buildPnLHuergo(inBigg, egBigg, huergoCCs, yr, monedaPL, sinIva));
    const resWRE = { res: sH.margen, ivaDeb: sH.ivaDeb, ivaCred: sH.ivaCred };
    // HQ + fondeo de las fondeadas (anillo 2) dentro de Inversiones/Capex. El fondeo interco ya está en USD.
    const pnl = buildPnLBigg(inBigg, egBigg, ccMap, cuentaMap, nucleoEmpresas, yr, monedaPL, sinIva);
    // Nota: el IVA de aranceles de sedes (arIVASedes) YA se devolvió al resultado de sede arriba (queda neta). NO
    // se reconoce como gasto en HQ: es crédito fiscal recuperable, no un costo del P&L → sale del resultado.
    const fondeo = fondeoFondeadasMensual(intercoData, { year: yr, moneda: monedaPL, desde: PNL_INICIO });
    const nomSoc = new Map((intercoData?.sociedades || []).map(s => [String(s.id), s.nombre || s.id]));
    for (const [fid, arr] of Object.entries(fondeo)) {
      if (!arr.some(v => Math.abs(v) > 0.01)) continue;
      // SUMA (no sobrescribe): la misma línea puede traer históricos por cuenta_contable
      // (ej. "Fondeo · Gestion Deportiva y Wellness" = inversión España Ene-Jun) + el fondeo en vivo (Jul+).
      const k = `Fondeo · ${nomSoc.get(String(fid)) || fid}`;
      const prev = pnl.grupos.capex[k] || new Array(12).fill(0);
      pnl.grupos.capex[k] = prev.map((v, i) => v + (arr[i] || 0));
    }
    return { pnl, sub: computeSubtotalsHolding(pnl, { resSedesAR, feeGer, resWRE }) };
  };
  const biggCur  = useMemo(() => (isBigg || isVentasHQ) ? holdingDe(year)     : null,   // eslint-disable-line react-hooks/exhaustive-deps
    [isBigg, isVentasHQ, inBigg, egBigg, arNucleoCCs, bnCcId, huergoCCs, ccMap, cuentaMap, nucleoEmpresas, year, monedaPL, sinIva, intercoData]);
  const biggPrev = useMemo(() => (isBigg || isVentasHQ) ? holdingDe(year - 1) : null,   // eslint-disable-line react-hooks/exhaustive-deps
    [isBigg, isVentasHQ, inBigg, egBigg, arNucleoCCs, bnCcId, huergoCCs, ccMap, cuentaMap, nucleoEmpresas, year, monedaPL, sinIva, intercoData]);
  const pnlBigg     = biggCur?.pnl  || null;
  const subBigg     = biggCur?.sub  || null;
  const pnlBiggPrev = biggPrev?.pnl || null;
  const subBiggPrev = biggPrev?.sub || null;

  // Apertura por sede (reporte "Composición de Ingresos"): resultado final de cada sede del núcleo AR, para
  // abrir la línea "Sedes Propias Argentina". La fila de reconciliación (en el builder) cierra contra `sar`.
  const nombreCC = (cc) => {
    const s = String(cc);
    const hit = ccMap.get(s) || ccMap.get(s.toLowerCase()) || ccMap.get(s.toUpperCase())
      || ccs.find(c => String(c.id).toLowerCase() === s.toLowerCase());
    return hit?.nombre || s;
  };
  const sedesAperturaDe = (yr) => arNucleoCCs.map(cc => ({
    label: nombreCC(cc),
    isBN: String(cc) === String(bnCcId),
    arr: computeSubtotalsSede(buildPnLSede(inBigg, egBigg, [cc], yr, monedaPL, sinIva)).resFinal,
  }));
  const sedesApCur  = useMemo(() => isVentasHQ ? sedesAperturaDe(year)     : null,   // eslint-disable-line react-hooks/exhaustive-deps
    [isVentasHQ, inBigg, egBigg, arNucleoCCs, ccMap, year, monedaPL, sinIva]);
  const sedesApPrev = useMemo(() => isVentasHQ ? sedesAperturaDe(year - 1) : null,   // eslint-disable-line react-hooks/exhaustive-deps
    [isVentasHQ, inBigg, egBigg, arNucleoCCs, ccMap, year, monedaPL, sinIva]);

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

  const showMonedaPL = isPnlTiempo || activeTab === "pl_bigg" || isVentasHQ;
  const showMonedaCF = activeTab === "cf";
  const showSedes    = isSedeLike && sedeCCs.length > 0;

  // Menú-landing: sin reporte elegido → tarjetas agrupadas por lente (Operaciones = 1 tarjeta x operación).
  if (!activeTab) return (
    <div style={{ padding: "28px 32px", maxWidth: 1400 }} className="fade">
      <PageHeader title="Reportes" />
      <ReportesMenu onPick={setActiveTab} />
    </div>
  );

  // Socios: cuenta corriente de socios (pantalla propia embebida como reporte). Página limpia + volver al menú.
  if (activeTab === "socios") return (
    <div style={{ padding: "28px 32px", maxWidth: 1400 }} className="fade">
      <button onClick={() => setActiveTab(null)} style={{
        display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 16,
        background: "#f3f4f6", border: `1px solid ${T.cardBorder}`, borderRadius: 8,
        color: T.text, fontFamily: T.font, fontSize: 13, fontWeight: 700,
        padding: "8px 16px", cursor: "pointer" }}
        onMouseEnter={e => e.currentTarget.style.background = "#e5e7eb"}
        onMouseLeave={e => e.currentTarget.style.background = "#f3f4f6"}>
        ← Reportes
      </button>
      <PantallaSocios />
    </div>
  );

  // ── Exportación a Excel (P&L Sede/Fondeadas y P&L BIGG): una hoja por vista, reusando las MISMAS filas del
  //    render (buildPnLSedeFilas / buildPnLBiggFilas) → la planilla sale idéntica a pantalla, con las filas de
  //    detalle agrupadas y colapsadas (esquema nativo de Excel). ──
  const expSub     = isBigg ? subBigg     : subSede;
  const expSubPrev = isBigg ? subBiggPrev : subSedePrev;
  const hayAnioAnterior = (isBigg ? (expSubPrev?.resOpMasIngHQ || []) : (subSedePrev?.totIngresos || [])).some(v => Number(v));
  // Default "hasta": último mes COMPLETO (excluye el mes en curso, que está incompleto y se ve feo).
  const mesExportDefault = (() => {
    const curCal = new Date().getMonth(), act = expSub?.activeMonths || [];
    const completos = act.filter(m => m < curCal);
    return completos.length ? completos[completos.length - 1] : (act.length ? act[act.length - 1] : curCal);
  })();
  const ejecutarExport = ({ vistas, mes }) => {
    const monLabel = MONEDA_SYM[monedaPL] || monedaPL;
    const repLabel = curTab?.label || "Reporte";
    const monMeta  = `Moneda: ${monLabel}${fxMode === "const" ? " · constante" : fxMode === "real" ? " · TC real" : ""}`;
    const scopeLabel = isBigg ? "Grupo BIGG (holding · todas las sociedades)"
      : selectedSedeCCs === null ? "Todas las sedes"
      : selectedSedeCCs.length === 0 ? "Ninguna sede" : `${selectedSedeCCs.length} sede(s)`;
    const baseSede = {
      pnl: pnlSede, sub: subSede, pnlPrev: pnlSedePrev, subPrev: subSedePrev, year,
      nombreCuenta, cesion: cesionSede, cesionResFinal: subSedeNet?.resFinal, cesionRetiros: cesionRetirosCI,
      impuestos: isFond ? IMPUESTOS_FOND : null, financieros: isFond ? FINANCIEROS_FOND : null,
      distribucion: activeTab === "op_rosedal" ? distribRosedalFx : null,
      retirosVivos: activeTab === "op_rosedal" ? (retirosRosedal[year] || null) : null,
      feeIvaVivo: activeTab === "op_rosedal" ? (retirosRosedal[year]?.feeIva || null) : null,
      netoLabel: fondCfg?.netoLabel, hayHistorico,
    };
    const buildFilas = isBigg
      ? (vista, extra) => buildPnLBiggFilas({ pnl: pnlBigg, sub: subBigg, pnlPrev: pnlBiggPrev, subPrev: subBiggPrev, year, hayHistorico, vista, ...extra }, () => false)
      : (vista, extra) => buildPnLSedeFilas({ ...baseSede, vista, ...extra }, () => false);
    const VIS = [
      { key: "evolucion", sheet: "Evolución",            vista: "evolucion", extra: { mesMax: mes } },
      { key: "mensual",   sheet: `Mensual ${MESES[mes]}`, vista: "mensual",   extra: { mes } },
      { key: "ytd",       sheet: `YTD ${MESES[mes]}`,      vista: "ytd",       extra: { mes } },
    ];
    const hojas = VIS.filter(v => vistas[v.key]).map(v => {
      const { cols, filas, lastM } = buildFilas(v.vista, v.extra);
      return { sheetName: v.sheet, cols, filas, lastM, titulo: `${repLabel} — ${v.sheet}`,
        meta: [`Año ${year} · hasta ${MESES[mes]}`, monMeta, scopeLabel, sinIva ? "Sin IVA" : "Con IVA"] };
    });
    if (hojas.length) exportarPackReportes({ archivo: `${repLabel.replace(/[^\w]+/g, "_")}_${year}_hasta_${MESES[mes]}.xlsx`, hojas })
      .catch(e => { console.error("Export Excel falló:", e); alert("No se pudo generar el Excel. Revisá la consola."); });
    setDlgExport(false);
  };

  // Encabezado de la "foto" (Ampliar / Copiar imagen): título + año + vista + moneda + IVA, para entender
  // qué se está viendo (igual criterio que la bajada a Excel).
  const monedaFotoLabel = { ARS: "$ ARS", USD: "U$D", EUR: "€ EUR", COP: "COP",
    USD_REAL: "U$D · TC Real", USD_CONST: `U$D constante (${MESES[anchorMes]} ${year})` }[monedaSel] || monedaSel;
  const vistaFotoLabel = vistaPnl === "evolucion" ? "Evolución mensual"
    : vistaPnl === "mensual" ? `Mensual · ${MESES[mesSel]}`
    : `YTD a ${MESES[mesSel]}`;
  const fotoCaption = `${curTab?.label ?? "Reporte"}  ·  ${year}  ·  ${vistaFotoLabel}  ·  ${monedaFotoLabel}  ·  ${sinIva ? "Sin IVA" : "Con IVA"}`;

  // Copiar el reporte visible como imagen (para pegar en PowerPoint). Feedback efímero.
  const copiarFoto = async () => {
    if (!reportRef.current) return;
    try {
      await copiarReporteComoImagen(reportRef.current, { caption: fotoCaption });
      setFotoMsg("✔ Imagen copiada — pegala en PowerPoint (Ctrl+V).");
    } catch (err) {
      setFotoMsg("No se pudo copiar la imagen en este navegador.");
    }
    setTimeout(() => setFotoMsg(null), 3500);
  };

  return (
    // --border (dark, del theme global del shell) → cardBorder claro: las tablas de reportes viven en
    // cards blancas; así la regla global `td/th{border:var(--border)}` no pinta líneas oscuras sobre blanco.
    <div style={{ padding: "28px 32px", maxWidth: 1400, "--border": T.cardBorder }} className="fade">

      {/* ── Header del reporte: "← Reportes" al lado del título; a la derecha vista + menú ⋮ ── */}
      <PageHeader
        title={curTab?.label ?? "Reporte"}
        subtitle={(isPnlTiempo || isBigg || isVentasHQ) ? undefined : curLente?.label}
        back={
          <button onClick={() => setActiveTab(null)} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "#f3f4f6", border: `1px solid ${T.cardBorder}`, borderRadius: 8,
            color: T.text, fontFamily: T.font, fontSize: 13, fontWeight: 700,
            padding: "6px 14px", cursor: "pointer" }}
            onMouseEnter={e => e.currentTarget.style.background = "#e5e7eb"}
            onMouseLeave={e => e.currentTarget.style.background = "#f3f4f6"}>
            ← Reportes
          </button>
        }
        action={
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {(isPnlTiempo || isBigg || isVentasHQ) && <VistaToggle value={vistaPnl} onChange={v => {
              // El mes persiste al cambiar de vista (como Moneda/IVA): "Hasta" (Evolución) y "Mes" (Mensual/YTD)
              // comparten el mes elegido. Al entrar a Evolución llevo Mes→Hasta; al salir, Hasta→Mes (si no es "Todos").
              if (v !== vistaPnl) {
                if (v === "evolucion") setMesCorte(mesSel);
                else if (vistaPnl === "evolucion" && mesCorte != null) setMesSel(mesCorte);
              }
              setVistaPnl(v);
            }} />}
            {/* Menú ⋮: Bajar a Excel / Ampliar (foto) / Copiar imagen (para PowerPoint). Solo en reportes con tabla P&L. */}
            {(isPnlTiempo || isBigg || isVentasHQ) && (
              <div ref={actMenuRef} style={{ position: "relative" }}>
                <button onClick={() => setShowActMenu(o => !o)} title="Acciones" style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: showActMenu ? "#e5e7eb" : "#f3f4f6", border: `1px solid ${T.cardBorder}`,
                  borderRadius: 8, color: T.text, fontSize: 20, fontWeight: 700, lineHeight: 1,
                  width: 38, height: 36, cursor: "pointer" }}>⋮</button>
                {showActMenu && (
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 40,
                    background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 10,
                    boxShadow: T.shadowMd, padding: 4, minWidth: 210 }}>
                    {(isSedeLike || isBigg) && (
                      <button onClick={() => { setShowActMenu(false); setDlgExport(true); }} style={actMenuItem}>
                        <span style={{ width: 20 }}>⬇</span> Bajar a Excel
                      </button>
                    )}
                    <button onClick={() => { setShowActMenu(false); setFotoOpen(true); }} style={actMenuItem}>
                      <span style={{ width: 20 }}>⛶</span> Ampliar
                    </button>
                    <button onClick={() => { setShowActMenu(false); copiarFoto(); }} style={actMenuItem}>
                      <span style={{ width: 20 }}>⧉</span> Copiar imagen
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        }
      />
      {/* Feedback efímero del "Copiar imagen". */}
      {fotoMsg && (
        <div style={{ marginBottom: 12, background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 8,
          padding: "8px 14px", fontSize: 12, color: "#3730a3", fontWeight: 600 }}>{fotoMsg}</div>
      )}

      {/* ── Toolbar / Filters (Consolidado y los detalles traen su propia barra; los WIP no llevan) ── */}
      {activeTab !== "consolidado" && activeTab !== "cxp_prov" && activeTab !== "cxc_cli" && !curTab?.wip && activeTab !== "inf_egresos" && activeTab !== "inf_ingresos" && (
      <div style={{
        display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap", alignItems: "flex-end",
        background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
        padding: "12px 16px", boxShadow: "0 1px 3px rgba(0,0,0,.04)",
      }}>
        {/* Año */}
        <div style={{ order: ordControls ? 2 : 0 }}>
          <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.muted,
            textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 }}>Año</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={selStyle}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {/* Moneda — P&L (en sede, arranca el grupo derecho) */}
        {showMonedaPL && (
          <div style={{ order: ordControls ? 4 : 0, marginLeft: ordControls ? "auto" : undefined }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, color: T.muted,
              textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 }}>
              Moneda
              {/* Estado del modo constante: badge chico con tooltip por hover (no ocupa fila en el reporte). */}
              {fxMode === "const" && (
                <span className="nb-tip" style={{ fontSize: 12, lineHeight: 1 }}>
                  {fxConstFalta ? "⚠️" : "🔒"}
                  <span className="nb-tip-box">
                    {fxConstFalta
                      ? `Falta el tipo de cambio de ${MESES[anchorMes]} ${year} (mes ancla del modo constante). Cargalo en Maestros (nb_tipos_cambio) o elegí otro mes.`
                      : `U$D constante — todo valuado al TC de ${MESES[anchorMes]} ${year} (comparable, sin efecto cambiario). El mes ancla lo fija el selector ${vistaPnl === "evolucion" ? "Hasta" : "Mes"}.`}
                  </span>
                </span>
              )}
            </label>
            <select value={monedaSel} onChange={e => setMonedaSel(e.target.value)} style={selStyle}>
              <optgroup label="Monedas">
                {Object.entries(MONEDA_SYM).map(([k, v]) => (
                  <option key={k} value={k}>{v} {k}</option>
                ))}
              </optgroup>
              <optgroup label="Consolidado">
                <option value="USD_REAL">U$D · TC Real</option>
                <option value="USD_CONST">U$D · Constante</option>
              </optgroup>
            </select>
          </div>
        )}

        {/* IVA — P&L Sedes/BIGG: ver con IVA o neto (EBITDA real). A la derecha, junto a Moneda. */}
        {(isSedeLike || isBigg || isVentasHQ) && (
          <div style={{ order: 5 }}>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.muted,
              textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 }}>IVA</label>
            <IvaToggle value={sinIva} onChange={setSinIva} />
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

        {/* Sociedades a consolidar — CF (agrupadas por anillo) */}
        {showMonedaCF && (
          <MultiSelect label="Sociedades a consolidar" groups={cfSocGroups} selected={cfSel}
            onChange={setCfSelSoc} allLabel="Todas" width={230} />
        )}

        {/* Mes — solo para vistas comparativas (Mensual / YTD) */}
        {(isPnlTiempo || isBigg || isVentasHQ) && vistaPnl !== "evolucion" && (
          <div style={{ order: ordControls ? 3 : 0 }}>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.muted,
              textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 }}>Mes</label>
            <select value={mesSel} onChange={e => setMesSel(Number(e.target.value))} style={selStyle}>
              {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </div>
        )}

        {/* Hasta — corta la vista Evolución en un mes (para ocultar el mes en curso incompleto). */}
        {(isPnlTiempo || isBigg || isVentasHQ) && vistaPnl === "evolucion" && (
          <div style={{ order: ordControls ? 3 : 0 }}>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.muted,
              textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 }}>Hasta</label>
            <select value={mesCorte ?? ""} onChange={e => setMesCorte(e.target.value === "" ? null : Number(e.target.value))} style={selStyle}>
              <option value="">Todos</option>
              {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </div>
        )}

        {/* Sedes dropdown — jerárquico: Operación (agrupador) › Sede */}
        {showSedes && (
          <div ref={sedeRef} style={{ position: "relative", order: isSedeLike ? 1 : 0 }}>
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

      {/* Aviso de meses PASADOS sin TC en modo consolidado (el mes en curso queda en blanco, es esperado). */}
      {fxMode === "real" && mesesSinTC.length > 0 && (
        <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 14px",
          marginBottom: 16, fontSize: 12, color: "#92400e", fontWeight: 600 }}>
          ⚠ Faltan tipos de cambio de: {mesesSinTC.join(", ")} → esos meses no se tradujeron a USD. Cargalos en Maestros (nb_tipos_cambio).
        </div>
      )}

      {/* ── P&L Sedes (Argentina núcleo) y Fondeadas (España/Colombia/Puertos): mismo reporte, distinto
             universo de sedes (scopeEmpresas) + cola de impuestos en Fondeadas ── */}
      {isSedeLike && (
        <div ref={reportRef}>
        <PnLTableSede pnl={pnlSede} sub={subSede} pnlPrev={pnlSedePrev} subPrev={subSedePrev}
          vista={vistaPnl} mes={mesSel} year={year} moneda={monedaPL} nombreCuenta={nombreCuenta}
          cesion={cesionSede} cesionResFinal={subSedeNet?.resFinal} cesionRetiros={cesionRetirosCI}
          impuestos={isFond ? IMPUESTOS_FOND : null} financieros={isFond ? FINANCIEROS_FOND : null}
          distribucion={activeTab === "op_rosedal" ? distribRosedalFx : null}
          retirosVivos={activeTab === "op_rosedal" ? (retirosRosedal[year] || null) : null}
          feeIvaVivo={activeTab === "op_rosedal" ? (retirosRosedal[year]?.feeIva || null) : null} netoLabel={fondCfg?.netoLabel}
          hayHistorico={hayHistorico} mesMax={mesCorte}
          label={selectedSedeCCs === null ? "Todas las Sedes"
            : selectedSedeCCs.length === 0 ? "Ninguna sede"
            : `${selectedSedeCCs.length} seleccionada${selectedSedeCCs.length > 1 ? "s" : ""}`} />
        </div>
      )}

      {(isSedeLike || isBigg) && <ExportModal open={dlgExport} onClose={() => setDlgExport(false)}
        onConfirm={ejecutarExport} defaultMes={mesExportDefault} hayAnioAnterior={hayAnioAnterior} />}

      {/* ── P&L Huergo (Wellness Real Estate): Ingresos − Costos (horas de coaches) = Margen ── */}
      {isHuergo && (
        <div ref={reportRef}>
        <PnLTableHuergo pnl={pnlHuergo} sub={subHuergo} pnlPrev={pnlHuergoPrev} subPrev={subHuergoPrev}
          vista={vistaPnl} mes={mesSel} year={year} moneda={monedaPL} hayHistorico={hayHistorico} mesMax={mesCorte} />
        </div>
      )}

      {/* ── P&L BIGG consolidado (subgrupos, hasta Margen Bruto) ── */}
      {activeTab === "pl_bigg" && (
        <div ref={reportRef}>
        <PnLTableBigg pnl={pnlBigg} sub={subBigg} pnlPrev={pnlBiggPrev} subPrev={subBiggPrev}
          vista={vistaPnl} mes={mesSel} year={year} moneda={monedaPL} hayHistorico={hayHistorico} mesMax={mesCorte} />
        </div>
      )}

      {/* ── Cash Flow ── */}
      {activeTab === "cf" && (
        <TabCashFlow rawMovs={rawMovs} rawIn={rawIn} rawEg={rawEg} ccMap={ccMap} nucleoEmpresas={nucleoEmpresas}
          selSoc={cfSel} year={year} moneda={monedaCF} tarjetaIds={tarjetaIds} cuentasBancarias={cuentasBancarias} />
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

      {isVentasHQ && subBigg && (
        <div ref={reportRef}>
        <PnLTableBigg pnl={pnlBigg} sub={subBigg} pnlPrev={pnlBiggPrev} subPrev={subBiggPrev}
          vista={vistaPnl} mes={mesSel} year={year} moneda={monedaPL} hayHistorico={hayHistorico} mesMax={mesCorte}
          soloIngresos pctMode sedesApertura={{ cur: sedesApCur, prev: sedesApPrev }} />
        </div>
      )}

      {activeTab === "consolidado" && (
        <TabTesoreriaConsolidada />
      )}

      {activeTab === "cxp_prov" && (
        <TabCxPProveedores />
      )}

      {activeTab === "cxc_cli" && (
        <TabCxCClientes />
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

      {/* ── "Ampliar": el reporte como foto a pantalla completa ── */}
      {fotoOpen && <FotoOverlay srcRef={reportRef} onClose={() => setFotoOpen(false)} caption={fotoCaption} />}

    </div>
  );
}
