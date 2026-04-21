import { useState, useMemo, useEffect, useRef } from "react";
import { T, PageHeader } from "./theme";
import { fetchCentrosCosto, fetchMovTesoreria, fetchCuentasBancarias, fetchLineasEnriquecidas, fetchCuentas } from "../lib/numbersApi";
import { MONEDA_SYM } from "../data/tesoreriaData";

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
  background: "#f9fafb", border: `1px solid ${T.cardBorder}`,
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
      onMouseEnter={e => { e.currentTarget.style.background = "#f0f9ff"; }}
      onMouseLeave={e => { e.currentTarget.style.background = T.card; }}>
      <td style={{ padding: "7px 28px", fontSize: 13, color: T.text, whiteSpace: "nowrap",
        maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis",
        ...stickyCol, background: "inherit" }}>{label}</td>
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

function SubtotalRow({ label, values, activeMonths, color }) {
  const total = rowSum(values);
  const bg = "#f3f4f6";
  return (
    <tr style={{ background: bg, borderTop: `2px solid ${color ?? T.cardBorder}`, borderBottom: `2px solid ${T.cardBorder}` }}>
      <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 900,
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

function ResultadoRow({ label, values, activeMonths }) {
  const total = rowSum(values);
  const color = total >= 0 ? T.green : T.red;
  const bg = total >= 0 ? "#f0fdf4" : "#fff1f2";
  return (
    <tr style={{ background: bg,
      borderTop: `2px solid ${total >= 0 ? T.green : T.red}` }}>
      <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 900,
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
function PnlSection({ label, accounts, activeMonths, color, ncols, sub }) {
  const [expanded, setExpanded] = useState(true);
  const rows = Object.entries(accounts).sort(([a],[b]) => a.localeCompare(b));
  const subTotals = MESES.map((_,m) => rows.reduce((s,[,v]) => s + (v[m] || 0), 0));
  const toggle = () => setExpanded(e => !e);
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

function TabBalance({ rawMovs, cuentasBancarias, rawIn, rawEg, sociedad }) {
  const [activoOpen,  setActivoOpen]  = useState(true);
  const [pasivoOpen,  setPasivoOpen]  = useState(true);
  const [cajaOpen,    setCajaOpen]    = useState(true);
  const [bancosOpen,  setBancosOpen]  = useState(true);
  const [cxcOpen,     setCxcOpen]     = useState(true);
  const [cxpOpen,     setCxpOpen]     = useState(true);

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

  const cajas  = useMemo(() => cuentasSoc.filter(c => (c.tipo ?? "").toLowerCase() === "caja"),  [cuentasSoc]);
  const bancos = useMemo(() => cuentasSoc.filter(c => (c.tipo ?? "").toLowerCase() !== "caja"), [cuentasSoc]);

  const getBal = (id) => saldos[id] ?? { ...ZERO };
  const sumGrp = (grp) => grp.reduce((t, c) => addVals(t, getBal(c.id)), { ...ZERO });

  const cajaTot  = useMemo(() => sumGrp(cajas),  [cajas, saldos]);
  const bancoTot = useMemo(() => sumGrp(bancos), [bancos, saldos]);

  const cxcRows = useMemo(() =>
    rawIn.filter(r => (r.subtipo ?? "").toUpperCase() === "INGRESO" && r.estado !== "cobrado"),
    [rawIn]);
  const cxpRows = useMemo(() =>
    rawEg.filter(r => (r.subtipo ?? "").toUpperCase() === "EGRESO" && r.estado !== "pagado"),
    [rawEg]);

  const cxcTot = useMemo(() => sumMon(cxcRows, r => r.moneda ?? "ARS", r => Number(r.total) || 0), [cxcRows]);
  const cxpTot = useMemo(() => sumMon(cxpRows, r => r.moneda ?? "ARS", r => Number(r.total) || 0), [cxpRows]);

  const activoTot  = addVals(addVals(cajaTot, bancoTot), cxcTot);
  const pasivoTot  = cxpTot;
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
          </>}
          <BResRow label="TOTAL ACTIVO" vals={activoTot} />

          <BSecRow label="Pasivo" expanded={pasivoOpen} onToggle={() => setPasivoOpen(o => !o)} />
          {pasivoOpen && <>
            <BGrpRow label="Cuentas a Pagar" expanded={cxpOpen} onToggle={() => setCxpOpen(o => !o)} />
            {cxpOpen && <BDRow label="Facturas pendientes de pago" vals={cxpTot} indent />}
            <BSubRow label="Total Cuentas a Pagar" vals={cxpTot} color={T.red} />
          </>}
          <BResRow label="TOTAL PASIVO" vals={pasivoTot} />

          <BResRow label="PATRIMONIO NETO = Activo − Pasivo" vals={pnTot} />
        </tbody>
      </table>
    </div>
  );
}

// ─── Tab Cash Flow ────────────────────────────────────────────────────────────
function TabCashFlow({ rawMovs, year, moneda }) {

  const movsFilt = useMemo(() => rawMovs.filter(m => {
    if (!m.fecha) return false;
    if (m.fecha.slice(0, 4) !== String(year)) return false;
    if ((m.moneda ?? "ARS") !== moneda) return false;
    return true;
  }), [rawMovs, year, moneda]);

  const movsOp    = useMemo(() => movsFilt.filter(m => m.tipo !== "TRANSFERENCIA"), [movsFilt]);
  const movsTrans = useMemo(() => movsFilt.filter(m => m.tipo === "TRANSFERENCIA"), [movsFilt]);

  const { entradas, salidas } = useMemo(() => {
    const e = {}, s = {};
    for (const m of movsOp) {
      const mes   = parseInt(m.fecha.slice(5, 7), 10) - 1;
      const monto = Number(m.monto) || 0;
      const cta   = (m.cuenta_contable ?? "").trim() || "Sin clasificar";
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
  { id: "pl_sede", label: "P&L Sedes" },
  { id: "pl_bigg", label: "P&L BIGG" },
  { id: "cf",      label: "Cash Flow" },
  { id: "balance", label: "Patrimonio Neto" },
  { id: "evpn",    label: "Evolución PN" },
];

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function PantallaReportes({ sociedad = "nako" }) {
  const [activeTab,      setActiveTab]      = useState("pl_sede");
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
        const [eg, ing, movs, cbs, ccList, ctaList] = await Promise.all([
          fetchLineasEnriquecidas(sociedad, ["EGRESO", "GASTO"]).catch(() => []),
          fetchLineasEnriquecidas(sociedad, "INGRESO").catch(() => []),
          fetchMovTesoreria(sociedad).catch(() => []),
          fetchCuentasBancarias().catch(() => []),
          fetchCentrosCosto().catch(() => []),
          fetchCuentas().catch(() => []),
        ]);
        if (cancelled) return;
        setRawEg(eg);
        setRawIn(ing);
        setRawMovs(Array.isArray(movs) ? movs : []);
        setCuentasBancarias(Array.isArray(cbs) ? cbs : []);
        setCcs(Array.isArray(ccList) ? ccList : []);
        setCuentas(Array.isArray(ctaList) ? ctaList : []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [sociedad, loadKey]);

  // Keyboard navigation for tabs
  const handleTabKeyDown = (e) => {
    const idx = TABS.findIndex(t => t.id === activeTab);
    let next = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      next = (idx + 1) % TABS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      next = (idx - 1 + TABS.length) % TABS.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      next = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      next = TABS.length - 1;
    } else {
      return;
    }
    setActiveTab(TABS[next].id);
    tabsRef.current?.querySelectorAll('[role="tab"]')[next]?.focus();
  };

  const cuentaMap = useMemo(
    () => new Map((cuentas ?? []).map(c => [c.nombre, c])),
    [cuentas]
  );

  const sedeCCs = useMemo(() => ccs.filter(c => (c.grupo ?? "").toLowerCase() === "operaciones"), [ccs]);

  const ccMap = useMemo(() => new Map(ccs.map(c => [c.id, c])), [ccs]);

  const resolvedCCSede = useMemo(() => {
    if (selectedSedeCCs.length === 0) return sedeCCs.map(c => c.id);
    return selectedSedeCCs;
  }, [selectedSedeCCs, sedeCCs]);

  const pnlSede = useMemo(
    () => buildPnL(rawIn, rawEg, cuentaMap, resolvedCCSede, year, monedaPL),
    [rawIn, rawEg, cuentaMap, resolvedCCSede, year, monedaPL]
  );
  const pnlHQ = useMemo(
    () => buildPnLHQ(rawIn, rawEg, ccMap, year, monedaPL),
    [rawIn, rawEg, ccMap, year, monedaPL]
  );

  const subSede = useMemo(() => computeSubtotals(pnlSede), [pnlSede]);
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
  const showSedes    = activeTab === "pl_sede" && sedeCCs.length > 0;

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1400 }} className="fade">

      {/* ── Header ── */}
      <PageHeader
        title="Reportes"
              />

      {/* ── Pill tabs ── */}
      <div
        ref={tabsRef}
        role="tablist"
        aria-label="Reportes financieros"
        onKeyDown={handleTabKeyDown}
        style={{
          display: "inline-flex", gap: 2, marginBottom: 20,
          background: "#f3f4f6", borderRadius: 10, padding: 3,
        }}
      >
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: active ? T.accentDark : "transparent",
                border: "none", borderRadius: 8,
                color: active ? T.accent : T.muted,
                fontFamily: T.font, fontSize: 13,
                fontWeight: active ? 800 : 500,
                padding: "7px 18px", cursor: "pointer",
                transition: "all .15s ease",
                outline: "none",
                boxShadow: active ? T.shadow : "none",
              }}
              onFocus={e => { e.currentTarget.style.outline = `2px solid ${T.accent}`; e.currentTarget.style.outlineOffset = "-2px"; }}
              onBlur={e => { e.currentTarget.style.outline = "none"; }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#e5e7eb"; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Toolbar / Filters ── */}
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

        {/* Sedes dropdown */}
        {showSedes && (
          <div ref={sedeRef} style={{ position: "relative" }}>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: T.muted,
              textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 }}>Sedes</label>
            <button onClick={() => setSedeOpen(o => !o)} style={{
              ...selStyle, display: "flex", alignItems: "center", gap: 8, minWidth: 190,
              background: sedeOpen ? "#f0f2f5" : "#f9fafb",
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
                <label style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
                  borderBottom: `1px solid ${T.cardBorder}`, cursor: "pointer",
                  userSelect: "none", fontWeight: 600, color: T.text,
                }}>
                  <input type="checkbox" checked={selectedSedeCCs.length === 0}
                    onChange={() => setSelectedSedeCCs([])} style={{ cursor: "pointer", accentColor: T.accentDark }} />
                  Todas
                </label>
                {sedeCCs.map(cc => {
                  const checked = selectedSedeCCs.length === 0 || selectedSedeCCs.includes(cc.id);
                  return (
                    <label key={cc.id} style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "7px 14px",
                      cursor: "pointer", userSelect: "none", color: T.text,
                      transition: "background .1s",
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = "#f9fafb"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <input type="checkbox" checked={checked}
                        onChange={() => toggleSedeCC(cc.id)} style={{ cursor: "pointer", accentColor: T.accentDark }} />
                      {cc.nombre}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── P&L Sedes ── */}
      {activeTab === "pl_sede" && (
        <PnLTable pnl={pnlSede} sub={subSede} year={year} moneda={monedaPL}
          label={selectedSedeCCs.length === 0 ? "Todas las Sedes" : `${selectedSedeCCs.length} seleccionada${selectedSedeCCs.length > 1 ? "s" : ""}`} />
      )}

      {/* ── P&L BIGG ── */}
      {activeTab === "pl_bigg" && (
        <PnLTableHQ pnl={pnlHQ} sub={subHQ} year={year} moneda={monedaPL} />
      )}

      {/* ── Cash Flow ── */}
      {activeTab === "cf" && (
        <TabCashFlow rawMovs={rawMovs} year={year} moneda={monedaCF} />
      )}

      {activeTab === "balance" && (
        <TabBalance
          rawMovs={rawMovs}
          cuentasBancarias={cuentasBancarias}
          rawIn={rawIn}
          rawEg={rawEg}
          sociedad={sociedad}
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

    </div>
  );
}
