// Tabla presentacional del ledger interco (Fecha · Tipo · Detalle · Monto · Saldo · ⋯).
// Compartida por el drill de Tesorería (PaginaIntercoLedger) y el reporte "Intercompañía por negocio".
// Recibe las `entries` YA calculadas (por intercoLedger o filtradas); NO fetchea ni deriva.
import { useState, useEffect } from "react";
import { T } from "../theme";
import { MONEDA_SYM } from "../../data/tesoreriaData";

const fmtSaldo = (n, moneda) => {
  const sym = MONEDA_SYM[moneda] ?? moneda;
  const abs = Math.abs(Number(n) || 0);
  return `${Number(n) < 0 ? "-" : ""}${sym} ${abs.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
};

// Chip de Tipo: etiqueta interna → label corto + color suave.
export const TIPO_CHIP = {
  "Pago":             { label: "Pago",     bg: "#eff6ff", fg: "#1d4ed8" },
  "Interco parkeada": { label: "Interco",  bg: "#f5f3ff", fg: "#7c3aed" },
  "Transferencia":    { label: "Transfer", bg: "#ecfeff", fg: "#0e7490" },
  "Interuso gestión": { label: "Interuso", bg: "#fffbeb", fg: "#b45309" },
  "Sueldo":           { label: "Sueldo",   bg: "#f0fdf4", fg: "#15803d" },
};
export const chipDe = e => TIPO_CHIP[e.tipo] || (String(e.concepto || "").startsWith("Pago ") ? TIPO_CHIP["Pago"] : { label: "—", bg: "#f3f4f6", fg: T.muted });

const fmtF = f => { const s = String(f || ""); if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const [y, m, d] = s.slice(0, 10).split("-"); return `${d}/${m}/${y}`; } return s; };

/** Tabla del ledger interco. `entries` en orden cronológico (se muestran del más reciente arriba).
 *  `opening` = saldo de apertura (tfoot); `onGoToMov(e)` opcional (menú ⋯ "Ir al movimiento"). */
// `usdCol`: agrega una columna "USD" (usa e.usd por fila) y muestra el Monto en la moneda propia de cada fila
// (e.moneda) → para el drill consolidado, donde conviven ARS/USD/EUR y no hay que confundir pesos con dólares.
export default function IntercoLedgerTable({ entries = [], moneda = "ARS", headerColor = T.accentDark, opening = null, onGoToMov, usdCol = false }) {
  const mon = moneda ?? "ARS";
  const rows = [...entries].reverse();
  const [menuFor, setMenuFor] = useState(null);
  useEffect(() => {
    if (menuFor == null) return;
    const h = () => setMenuFor(null);
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [menuFor]);
  const fmtUSD = n => { const v = Math.round(Number(n) || 0); return (v < 0 ? "-" : "") + "U$D " + Math.abs(v).toLocaleString("es-AR"); };
  const signed = (v, m = mon) => (v >= 0 ? "+ " : "− ") + fmtSaldo(Math.abs(v), m);
  const nCols = 6 + (usdCol ? 1 : 0);
  const thS = { padding: "10px 16px", fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,.85)", textAlign: "right", letterSpacing: ".04em", textTransform: "uppercase", whiteSpace: "nowrap" };
  const tdS = { padding: "9px 16px", fontSize: 13, textAlign: "right", fontFamily: "var(--mono)", color: T.text, whiteSpace: "nowrap" };
  return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflow: "visible" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: headerColor }}>
            <th style={{ ...thS, textAlign: "left" }}>Fecha</th>
            <th style={{ ...thS, textAlign: "left" }}>Tipo</th>
            <th style={{ ...thS, textAlign: "left" }}>Detalle</th>
            <th style={thS}>{usdCol ? "Monto (moneda local)" : "Monto"}</th>
            {usdCol && <th style={{ ...thS, color: "#fff" }}>Monto USD</th>}
            {!usdCol && <th style={{ ...thS, color: "#fff" }}>Saldo</th>}
            <th style={{ ...thS, width: 44 }} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={nCols} style={{ padding: "16px", fontSize: 13, color: T.muted, textAlign: "center" }}>Sin movimientos.</td></tr>
          )}
          {rows.map((e, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${T.cardBorder}`, background: i % 2 === 0 ? T.card : "#fafbfc" }}>
              <td style={{ padding: "9px 16px", fontSize: 12.5, color: T.muted, whiteSpace: "nowrap", verticalAlign: "top" }}>{fmtF(e.fecha)}</td>
              <td style={{ padding: "9px 16px", whiteSpace: "nowrap", verticalAlign: "top" }}>
                {(() => { const c = chipDe(e); return (
                  <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: c.bg, color: c.fg }}>{c.label}</span>
                ); })()}
              </td>
              <td style={{ padding: "9px 16px", fontSize: 13, color: T.text }} title={e.ref ? "#" + e.ref : undefined}>
                {[e.prov, e.cuenta].filter(Boolean).join(" · ")
                  || (e.cuentaDest ? "→ " + e.cuentaDest : String(e.concepto || "").replace(/^Interco\s*→\s*/i, ""))}
              </td>
              <td style={{ ...tdS, color: e.delta >= 0 ? "#16a34a" : "#dc2626", fontWeight: 700 }}>{signed(e.delta, e.moneda || mon)}</td>
              {usdCol
                ? <td style={{ ...tdS, color: (e.usd ?? 0) >= 0 ? "#16a34a" : "#dc2626", fontWeight: 800 }}>{e.usd == null ? "—" : fmtUSD(e.usd)}</td>
                : <td style={{ ...tdS, fontWeight: 800 }}>{e.saldo == null ? "" : fmtSaldo(e.saldo, mon)}</td>}
              <td style={{ padding: "9px 10px", textAlign: "center", position: "relative" }}>
                {onGoToMov && <>
                  <button onClick={ev => { ev.stopPropagation(); setMenuFor(menuFor === i ? null : i); }}
                    title="Más acciones"
                    style={{ background: "transparent", border: "none", fontSize: 18, fontWeight: 800, color: T.muted, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>⋯</button>
                  {menuFor === i && (
                    <div onClick={ev => ev.stopPropagation()} style={{ position: "absolute", right: 12, top: "100%", zIndex: 20, background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 8, boxShadow: T.shadowMd, minWidth: 180, overflow: "hidden" }}>
                      <button onClick={() => { setMenuFor(null); onGoToMov(e); }}
                        style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "9px 14px", fontSize: 12.5, fontWeight: 600, color: T.text, cursor: "pointer", fontFamily: T.font, whiteSpace: "nowrap" }}
                        onMouseEnter={ev => ev.currentTarget.style.background = "#eceff3"}
                        onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
                        Ir al movimiento →
                      </button>
                    </div>
                  )}
                </>}
              </td>
            </tr>
          ))}
        </tbody>
        {opening != null && (
          <tfoot>
            <tr style={{ background: "#f3f4f6", borderTop: `2px solid ${T.cardBorder}` }}>
              <td style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 800, color: T.muted }} colSpan={3}>Saldo de apertura</td>
              <td style={tdS} />
              <td style={{ ...tdS, fontWeight: 900 }}>{fmtSaldo(opening, mon)}</td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
