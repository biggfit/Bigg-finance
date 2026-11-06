// Molde compartido de las tablas "meses en columnas" en pocas líneas (Caja, Del resultado al patrimonio): header negro
// con los meses como primera fila, layout fijo con una columna por mes y una de Total, filas con flechita para abrir
// bloques y celdas clickeables para el detalle. Mismo lenguaje visual que Tesorería › Saldos (Martín 5/11/2026).
import { T } from "../theme";
import { MESES_CORTOS, fmtBal } from "./balanceUtils";
import { COL_MES, COL_TOT, TABLA, trLine, tdLabel } from "./tablaMesesEstilos";
const thMes = { padding: "9px 12px", textAlign: "right", fontSize: 11, fontWeight: 800, letterSpacing: ".10em", color: T.tableHeadText, whiteSpace: "nowrap" };

export function Celda({ valor, fuerte = false, color, dim = false, onClick, title }) {
  const v = Number(valor) || 0;
  const col = color || (v < 0 ? T.red : Math.abs(v) < 0.5 ? T.dim : T.text);
  return (
    <td onClick={onClick} title={title}
      style={{ padding: "7px 12px", textAlign: "right", fontFamily: "var(--mono)", fontSize: 12.5, whiteSpace: "nowrap",
        fontWeight: fuerte ? 800 : 600, color: col, opacity: dim ? .55 : 1, cursor: onClick ? "pointer" : "default" }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.textDecoration = "underline"; }}
      onMouseLeave={e => { e.currentTarget.style.textDecoration = "none"; }}>
      {fmtBal(v)}
    </td>
  );
}

// `get(m)` por mes. Total: la suma de los meses cerrados (el mes en curso se ve en gris y no entra), o el primero /
// el último cerrado para las filas de saldo.
export function Fila({ label, get, meses, cerrados, mesEnCurso, style = {}, labelStyle = {}, fuerte = false, color, total = "suma", onCelda, sangria = 0, flecha = null, onToggle }) {
  const tot = total === "primero" ? (meses.length ? get(meses[0]) : 0)
    : total === "ultimo" ? (cerrados.length ? get(cerrados[cerrados.length - 1]) : 0)
    : cerrados.reduce((s, m) => s + get(m), 0);
  return (
    <tr style={{ ...trLine, ...style }}>
      <td style={{ ...tdLabel, paddingLeft: 18 + sangria, fontWeight: fuerte ? 800 : 500, ...labelStyle, cursor: onToggle ? "pointer" : "default", userSelect: onToggle ? "none" : "auto" }}
        onClick={onToggle}>
        {flecha != null && <span style={{ display: "inline-block", width: 14, fontSize: 9, color: T.dim, transform: flecha ? "rotate(90deg)" : "none", transition: "transform .12s" }}>▶</span>}
        {label}
      </td>
      {meses.map(m => <Celda key={m} valor={get(m)} fuerte={fuerte} color={color} dim={m === mesEnCurso}
        onClick={onCelda ? () => onCelda(m) : undefined} title={onCelda ? `${label} · ${MESES_CORTOS[m]}: ver movimientos` : undefined} />)}
      <Celda valor={tot} fuerte color={color} />
    </tr>
  );
}

// La tarjeta con la tabla: título en el header negro, un <th> por mes (el mes en curso atenuado) y TOTAL.
export function TablaMeses({ titulo, meses, mesEnCurso, children, marginBottom = 16 }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflowX: "auto", marginBottom }}>
      <table style={{ ...TABLA, minWidth: 320 + meses.length * COL_MES + COL_TOT }}>
        <colgroup><col />{meses.map(m => <col key={m} style={{ width: COL_MES }} />)}<col style={{ width: COL_TOT }} /></colgroup>
        <thead>
          <tr style={{ background: T.tableHead }}>
            <th style={{ padding: "9px 18px", textAlign: "left", fontSize: 11, fontWeight: 800, color: T.tableHeadText, letterSpacing: ".10em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{titulo}</th>
            {meses.map(m => <th key={m} style={{ ...thMes, opacity: m === mesEnCurso ? .55 : 1 }}>{MESES_CORTOS[m].toUpperCase()}{m === mesEnCurso ? " · EN CURSO" : ""}</th>)}
            <th style={{ ...thMes, borderLeft: "1px solid rgba(255,255,255,.15)" }}>TOTAL</th>
          </tr>
        </thead>
        {children}
      </table>
    </div>
  );
}
