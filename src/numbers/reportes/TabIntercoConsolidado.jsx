// Reporte "Intercompañía por negocio" (Reportes, vista consolidada del grupo — NO Tesorería).
// Matriz: meses en columnas · filas agrupadas por NEGOCIO (contraparte no-núcleo) y dentro por TIPO
// (Pago/Transfer/Interco/Interuso/Sueldo), en USD consolidado (como el P&L). Click en celda → los
// movimientos que la componen, en el formato del ledger de Tesorería.
import { Fragment, useEffect, useState } from "react";
import { T } from "../theme";
import { intercoLedger } from "../../lib/numbersApi";
import IntercoLedgerTable, { chipDe } from "./IntercoLedgerTable";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const PNL_INICIO_ANIO = 2026;
const PNL_INICIO_MES  = 6;   // julio (0-based)
const MONS_DRILL = ["ARS", "USD", "EUR", "COP", "UYU", "PYG", "CLP", "PEN"];
const mesDe = f => parseInt(String(f || "").slice(5, 7), 10) - 1;
const fmtUSD = n => { const v = Math.round(Number(n) || 0); return (v < 0 ? "-" : "") + "U$D " + Math.abs(v).toLocaleString("es-AR"); };

// `matriz` (intercoConsolidadoMensual) y `negocioFiltro` los provee el wrapper (PantallaReportes), que también
// dibuja el selector de negocio junto al de Año. Acá solo se filtra y se renderiza.
export default function TabIntercoConsolidado({ data, sociedades = [], year, matriz, negocioFiltro = "", fx, onDrillActive, onVerComprobante }) {
  const [collapsed, setCollapsed] = useState({});
  const [drill, setDrill] = useState(null);   // { negocioNombre, tipo, mes }
  // Avisa al wrapper cuando se entra/sale del drill → oculta el header y los filtros de arriba.
  useEffect(() => { onDrillActive?.(!!drill); }, [drill, onDrillActive]);
  const negocios = negocioFiltro ? matriz.negocios.filter(n => n.negocioId === negocioFiltro) : matriz.negocios;

  // Rango de meses (columnas estables por el total del grupo); total mostrado respeta el filtro de negocio.
  const mesDesde = year === PNL_INICIO_ANIO ? PNL_INICIO_MES : 0;
  let mesHasta = mesDesde;
  matriz.totalMes.forEach((v, i) => { if (Math.abs(v) >= 0.01 && i > mesHasta) mesHasta = i; });
  const meses = [];
  for (let m = mesDesde; m <= mesHasta; m++) meses.push(m);
  const totalMesShown = new Array(12).fill(0);
  for (const n of negocios) n.totalMes.forEach((v, i) => { totalMesShown[i] += v; });

  // ── Drill: movimientos de una celda (negocio × tipo × mes) ────────────────────
  if (drill) {
    const nucleoIds = sociedades.filter(s => /n[úu]cleo/i.test(String(s.anillo || ""))).map(s => String(s.id));
    const entries = [];
    for (const nid of nucleoIds) for (const mon of MONS_DRILL) {
      const led = intercoLedger(data, { sociedad: nid, contraparte: drill.negocioId, moneda: mon });
      for (const e of led.entries) {
        if (mesDe(e.fecha) === drill.mes && e.tipo === drill.tipo) {
          const anio = parseInt(String(e.fecha).slice(0, 4), 10);
          // moneda propia de la fila + su equivalente USD (para no confundir pesos con dólares). saldo corrido
          // no aplica cross-par → se oculta (la columna Saldo se reemplaza por Monto USD).
          entries.push({ ...e, moneda: mon, usd: fx ? fx(e.delta, mon, anio, mesDe(e.fecha) + 1) : null, saldo: null });
        }
      }
    }
    entries.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    return (
      <div className="fade" style={{ padding: "8px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
          <button onClick={() => setDrill(null)} style={{ background: "#f3f4f6", border: `1px solid ${T.cardBorder}`, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 700, color: T.muted, cursor: "pointer", fontFamily: T.font }}>← Volver</button>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 900, color: T.text, margin: 0 }}>{drill.negocioNombre} · {chipDe({ tipo: drill.tipo }).label} · {MESES[drill.mes]} {year}</h1>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{entries.length} movimiento{entries.length !== 1 ? "s" : ""} · montos en su moneda original</div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>Total celda (USD)</div>
            <div style={{ fontSize: 20, fontFamily: "var(--mono)", fontWeight: 900, color: T.text }}>{fmtUSD(drill.valor)}</div>
          </div>
        </div>
        <IntercoLedgerTable entries={entries} usdCol onGoToMov={onVerComprobante ? e => onVerComprobante(e) : undefined} />
      </div>
    );
  }

  // ── Matriz ────────────────────────────────────────────────────────────────────
  const thMes = { padding: "8px 10px", fontSize: 11, fontWeight: 800, color: T.tableHeadText, textAlign: "right", whiteSpace: "nowrap" };
  const tdMes = (v, clickable) => ({ padding: "7px 10px", fontSize: 12.5, textAlign: "right", fontFamily: "var(--mono)", whiteSpace: "nowrap",
    color: Math.abs(v) < 0.01 ? T.dim : (v < 0 ? "#dc2626" : T.text), cursor: clickable && Math.abs(v) >= 0.01 ? "pointer" : "default" });
  const cel = v => Math.abs(v) < 0.01 ? "—" : fmtUSD(v);

  return (
    <div className="fade" style={{ padding: "8px 0" }}>
      {negocios.length === 0 ? (
        <div style={{ color: T.muted, fontSize: 13, padding: "24px 4px" }}>No hay movimientos intercompañía en el período.</div>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 120 + meses.length * 90 }}>
            <thead>
              <tr style={{ background: T.tableHead }}>
                <th style={{ padding: "8px 14px", fontSize: 11, fontWeight: 800, color: T.tableHeadText, textAlign: "left", letterSpacing: ".04em", textTransform: "uppercase", position: "sticky", left: 0, background: T.tableHead }}>Negocio · tipo</th>
                {meses.map(m => <th key={m} style={thMes}>{MESES[m]}</th>)}
                <th style={{ ...thMes, borderLeft: `1px solid ${T.cardBorder}` }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {negocios.map(neg => {
                const abierto = !collapsed[neg.negocioId];
                const totNeg = meses.reduce((s, m) => s + neg.totalMes[m], 0);
                return (
                  <Fragment key={neg.negocioId}>
                    <tr onClick={() => setCollapsed(c => ({ ...c, [neg.negocioId]: !c[neg.negocioId] }))}
                      style={{ background: "#f1f5f9", borderTop: `1px solid ${T.cardBorder}`, cursor: "pointer" }}>
                      <td style={{ padding: "8px 14px", fontSize: 12.5, fontWeight: 800, color: T.text, position: "sticky", left: 0, background: "#f1f5f9" }}>
                        <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{abierto ? "▼" : "▶"}</span>{neg.negocioNombre}
                      </td>
                      {meses.map(m => <td key={m} style={{ ...tdMes(neg.totalMes[m], false), fontWeight: 700 }}>{cel(neg.totalMes[m])}</td>)}
                      <td style={{ ...tdMes(totNeg, false), fontWeight: 800, borderLeft: `1px solid ${T.cardBorder}` }}>{cel(totNeg)}</td>
                    </tr>
                    {abierto && matriz.tipos.filter(t => neg.tipos[t]?.some(v => Math.abs(v) >= 0.01)).map(t => {
                      const arr = neg.tipos[t];
                      const totT = meses.reduce((s, m) => s + arr[m], 0);
                      return (
                        <tr key={t} style={{ borderTop: `1px solid ${T.cardBorder}` }}>
                          <td style={{ padding: "6px 14px 6px 30px", fontSize: 12.5, color: T.muted, position: "sticky", left: 0, background: T.card }}>
                            <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: chipDe({ tipo: t }).bg, color: chipDe({ tipo: t }).fg }}>{chipDe({ tipo: t }).label}</span>
                          </td>
                          {meses.map(m => (
                            <td key={m} style={tdMes(arr[m], true)}
                              onClick={Math.abs(arr[m]) >= 0.01 ? () => setDrill({ negocioId: neg.negocioId, negocioNombre: neg.negocioNombre, tipo: t, mes: m, valor: arr[m] }) : undefined}>
                              {cel(arr[m])}
                            </td>
                          ))}
                          <td style={{ ...tdMes(totT, false), fontWeight: 700, borderLeft: `1px solid ${T.cardBorder}` }}>{cel(totT)}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: "#0e7490", color: "#fff", borderTop: `2px solid ${T.cardBorder}` }}>
                <td style={{ padding: "9px 14px", fontSize: 12.5, fontWeight: 800, position: "sticky", left: 0, background: "#0e7490" }}>{negocioFiltro ? "Total" : "Total grupo (USD)"}</td>
                {meses.map(m => <td key={m} style={{ padding: "9px 10px", fontSize: 12.5, textAlign: "right", fontFamily: "var(--mono)", fontWeight: 800 }}>{cel(totalMesShown[m])}</td>)}
                <td style={{ padding: "9px 10px", fontSize: 12.5, textAlign: "right", fontFamily: "var(--mono)", fontWeight: 900, borderLeft: "1px solid rgba(255,255,255,.3)" }}>{cel(meses.reduce((s, m) => s + totalMesShown[m], 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
