// Reporte "Saldos entre sociedades" (Reportes) — posición neta interco (préstamos/saldos) entre TODAS las
// sociedades, por moneda. Distinto de "Fondeo por negocio" (que es el flujo mensual núcleo→negocio / CAPEX):
// esto es el BALANCE acumulado, incluye núcleo↔núcleo. Filtro de sociedad + columnas por moneda + total USD.
// Click en una celda (relación × moneda) → el ledger de esa posición (mismo formato que Tesorería).
import { useEffect, useMemo, useState } from "react";
import { T } from "../theme";
import { lecturaInterco, intercoLedger } from "../../lib/numbersApi";
import { MONEDA_SYM } from "../../data/tesoreriaData";
import IntercoLedgerTable, { fmtUSD } from "./IntercoLedgerTable";

const MONS_ORDER = ["ARS", "USD", "EUR", "COP", "UYU", "PYG", "CLP", "PEN"];
const fmtMon = (n, mon) => { const sym = MONEDA_SYM[mon] ?? mon; const v = Math.round(Number(n) || 0); return `${v < 0 ? "-" : ""}${sym} ${Math.abs(v).toLocaleString("es-AR")}`; };

export default function TabSaldosInterco({ data, sociedades = [], saldoSoc = "", fx, onDrillActive, onVerComprobante }) {
  const [drill, setDrill] = useState(null);   // { sociedad, contraparte, moneda, label }
  useEffect(() => { onDrillActive?.(!!drill); }, [drill, onDrillActive]);
  const nombreSoc = useMemo(() => new Map((sociedades || []).map(s => [String(s.id), s.nombre || s.id])), [sociedades]);
  const nombre = id => nombreSoc.get(String(id)) || id;
  // Consolida un saldo a USD con el TC provisto (fx(v, mon) → USD al último TC cargado). Sin TC → 0.
  const usd = (v, mon) => (fx ? (fx(v, mon) || 0) : 0);

  // ── Drill: ledger de UNA posición (sociedad, contraparte, moneda) — como en Tesorería ──
  if (drill) {
    const led = intercoLedger(data, { sociedad: drill.sociedad, contraparte: drill.contraparte, moneda: drill.moneda });
    const nosDeben = (led.final ?? 0) >= 0;
    const col = nosDeben ? "#16a34a" : "#dc2626";
    return (
      <div className="fade" style={{ padding: "8px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
          <button onClick={() => setDrill(null)} style={{ background: "#f3f4f6", border: `1px solid ${T.cardBorder}`, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 700, color: T.muted, cursor: "pointer", fontFamily: T.font }}>← Volver</button>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 900, color: T.text, margin: 0 }}>{drill.label} · {drill.moneda}</h1>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>Cuenta corriente intercompañía · {led.entries.length} movimiento{led.entries.length !== 1 ? "s" : ""}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>Saldo actual</span>
              <span style={{ fontSize: 22, fontFamily: "var(--mono)", fontWeight: 900, color: col, whiteSpace: "nowrap" }}>{fmtMon(led.final ?? 0, drill.moneda)}</span>
            </div>
            <span style={{ fontSize: 10, color: T.muted }}>{nosDeben ? "nos deben" : "les debemos"}</span>
          </div>
        </div>
        <IntercoLedgerTable entries={led.entries} moneda={drill.moneda} headerColor={col} opening={led.opening ?? 0} onGoToMov={onVerComprobante} />
      </div>
    );
  }

  // ── Tabla de saldos ──────────────────────────────────────────────────────────
  // lecturaInterco trae AMBAS direcciones (s→c neto, c→s -neto). Con filtro de sociedad orientamos desde su
  // óptica (+ = le deben / − = les debemos); sin filtro dedup a la pata acreedora (neto>0).
  const pos = lecturaInterco(data).filter(p => Math.abs(p.neto) > 0.01);
  const rowsMap = {};
  for (const p of pos) {
    if (saldoSoc) {
      if (String(p.sociedad) !== String(saldoSoc)) continue;
      const r = (rowsMap[String(p.contraparte)] ??= { sociedad: saldoSoc, contraparte: p.contraparte, label: nombre(p.contraparte), mon: {} });
      r.mon[p.moneda] = (r.mon[p.moneda] || 0) + p.neto;
    } else {
      if (p.neto <= 0.01) continue;   // dedup a acreedor
      const r = (rowsMap[`${p.sociedad}|${p.contraparte}`] ??= { sociedad: p.sociedad, contraparte: p.contraparte, label: `${nombre(p.sociedad)} ← ${nombre(p.contraparte)}`, mon: {} });
      r.mon[p.moneda] = (r.mon[p.moneda] || 0) + p.neto;
    }
  }
  const rows = Object.values(rowsMap).map(r => ({ ...r, totUsd: MONS_ORDER.reduce((s, m) => s + usd(r.mon[m] || 0, m), 0) }));
  rows.sort((a, b) => Math.abs(b.totUsd) - Math.abs(a.totUsd));
  const mons = MONS_ORDER.filter(m => rows.some(r => Math.abs(r.mon[m] || 0) > 0.01));
  const totCol = {}; for (const m of mons) totCol[m] = rows.reduce((s, r) => s + (r.mon[m] || 0), 0);
  const totUsdAll = rows.reduce((s, r) => s + r.totUsd, 0);

  const thN = { padding: "8px 12px", fontSize: 11, fontWeight: 800, color: T.tableHeadText, textAlign: "right", whiteSpace: "nowrap" };
  const cellCol = v => Math.abs(v) < 0.01 ? T.dim : (v < 0 ? "#dc2626" : "#16a34a");
  const tdN = { padding: "7px 12px", fontSize: 12.5, textAlign: "right", fontFamily: "var(--mono)", whiteSpace: "nowrap" };

  return (
    <div className="fade" style={{ padding: "8px 0" }}>
      {rows.length === 0 ? (
        <div style={{ color: T.muted, fontSize: 13, padding: "24px 4px" }}>No hay posiciones intercompañía{saldoSoc ? ` para ${nombre(saldoSoc)}` : ""}.</div>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 260 + mons.length * 120 }}>
            <thead>
              <tr style={{ background: T.tableHead }}>
                <th style={{ padding: "8px 14px", fontSize: 11, fontWeight: 800, color: T.tableHeadText, textAlign: "left", letterSpacing: ".04em", textTransform: "uppercase", position: "sticky", left: 0, background: T.tableHead }}>{saldoSoc ? "Contraparte" : "Acreedor ← Deudor"}</th>
                {mons.map(m => <th key={m} style={thN}>{m}</th>)}
                <th style={{ ...thN, borderLeft: `1px solid ${T.cardBorder}` }}>Total USD</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${T.cardBorder}`, background: i % 2 === 0 ? T.card : "#fafbfc" }}>
                  <td style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: 700, color: T.text, position: "sticky", left: 0, background: i % 2 === 0 ? T.card : "#fafbfc" }}>{r.label}</td>
                  {mons.map(m => {
                    const v = r.mon[m] || 0;
                    const on = Math.abs(v) >= 0.01;
                    return (
                      <td key={m} style={{ ...tdN, color: cellCol(v), cursor: on ? "pointer" : "default", fontWeight: 700 }}
                        onClick={on ? () => setDrill({ sociedad: r.sociedad, contraparte: r.contraparte, moneda: m, label: r.label }) : undefined}>
                        {on ? fmtMon(v, m) : "—"}
                      </td>
                    );
                  })}
                  <td style={{ ...tdN, color: cellCol(r.totUsd), fontWeight: 800, borderLeft: `1px solid ${T.cardBorder}` }}>{Math.abs(r.totUsd) < 0.01 ? "—" : fmtUSD(r.totUsd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "#0e7490", color: "#fff", borderTop: `2px solid ${T.cardBorder}` }}>
                <td style={{ padding: "9px 14px", fontSize: 12.5, fontWeight: 800, position: "sticky", left: 0, background: "#0e7490" }}>Total</td>
                {mons.map(m => <td key={m} style={{ padding: "9px 12px", fontSize: 12.5, textAlign: "right", fontFamily: "var(--mono)", fontWeight: 800 }}>{fmtMon(totCol[m], m)}</td>)}
                <td style={{ padding: "9px 12px", fontSize: 12.5, textAlign: "right", fontFamily: "var(--mono)", fontWeight: 900, borderLeft: "1px solid rgba(255,255,255,.3)" }}>{fmtUSD(totUsdAll)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div style={{ fontSize: 11, color: T.muted, marginTop: 8 }}>{saldoSoc ? "+ = le deben a esta sociedad · − = les debe. " : "Cada relación una vez (pata acreedora). "}Total USD al último TC cargado.</div>
    </div>
  );
}
