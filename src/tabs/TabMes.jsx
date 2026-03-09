import { memo, useMemo } from "react";
import { useStore } from "../lib/context";
import { computeSaldo, computeSaldoPrevMes, COMP_TYPES, MONTHS, fmt, fmtS } from "../lib/helpers";
import { inPeriod } from "../data/franchisor";
import { SaldoBadge } from "../components/atoms";

// ─── TAB: MES ─────────────────────────────────────────────────────────────────
const TabMes = memo(function TabMes({ franchises, month, year, onOpenFr }) {
  const { comps, saldoInicial } = useStore();

  // Single pass over filtered franchises — each franchise computed once
  const sumData = useMemo(() => franchises.map(fr => {
    const key = String(fr.id);
    const frComps = (comps[key] ?? []).filter(c => inPeriod(c, month, year));
    const sp    = computeSaldoPrevMes(fr.id, year, month, comps, saldoInicial);
    const sa    = computeSaldo(fr.id, year, month, comps, saldoInicial);
    const facts = frComps.filter(c => COMP_TYPES[c.type]?.sign === +1 && c.type !== "PAGO_ENVIADO").reduce((a, c) => a + c.amount, 0);
    const ncs   = frComps.filter(c => COMP_TYPES[c.type]?.sign === -1 && c.type !== "PAGO" && c.type !== "PAGO_PAUTA").reduce((a, c) => a + c.amount, 0);
    const pagos = frComps.filter(c => c.type === "PAGO").reduce((a, c) => a + c.amount, 0);
    const env   = frComps.filter(c => c.type === "PAGO_ENVIADO").reduce((a, c) => a + c.amount, 0);
    return { fr, sp, sa, facts, ncs, pagos, enviados: env, frComps };
  }), [franchises, comps, saldoInicial, month, year]);

  // Currency summary aggregated from sumData — no second pass over franchises
  const totalesPorMoneda = useMemo(() => {
    const currs = [...new Set(franchises.map(f => f.currency))];
    return currs.map(cur => {
      const rows = sumData.filter(d => d.fr.currency === cur);
      return {
        cur,
        sp:       rows.reduce((a, d) => a + d.sp,       0),
        facts:    rows.reduce((a, d) => a + d.facts,    0),
        ncs:      rows.reduce((a, d) => a + d.ncs,      0),
        pagos:    rows.reduce((a, d) => a + d.pagos,    0),
        enviados: rows.reduce((a, d) => a + d.enviados, 0),
        sa:       rows.reduce((a, d) => a + d.sa,       0),
      };
    });
  }, [sumData, franchises]);

  return (
    <div className="fade">
      {/* Currency summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${totalesPorMoneda.length}, 1fr)`, gap: 14, marginBottom: 18 }}>
        {totalesPorMoneda.map(({ cur, sp, facts, ncs, pagos, enviados, sa }) => {
          const accentC  = cur === "ARS" ? "var(--gold)" : cur === "USD" ? "var(--green)" : "var(--cyan)";
          const rowsC    = sumData.filter(d => d.fr.currency === cur);
          const totalDeben   = rowsC.filter(d => d.sa >  0.01).reduce((a, d) => a + d.sa, 0);
          const totalDebemos = rowsC.filter(d => d.sa < -0.01).reduce((a, d) => a + d.sa, 0);
          const nDeben   = rowsC.filter(d => d.sa >  0.01).length;
          const nDebemos = rowsC.filter(d => d.sa < -0.01).length;
          return (
            <div key={cur} style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, padding: "16px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontWeight: 900, fontSize: 18, letterSpacing: ".1em", color: accentC }}>{cur}</span>
                <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, letterSpacing: ".1em" }}>RESUMEN {MONTHS[month].toUpperCase()} {year}</span>
              </div>
              {[
                ["Saldo Arrastrado",  sp,       sp       > 0.01 ? "var(--orange)" : sp       < -0.01 ? "var(--cyan)"  : "var(--muted)"],
                ["+ Facturas",        facts,    "var(--blue)"],
                ["− NC / Créditos",   ncs,      "var(--green)"],
                ["− Pagos Recibidos", pagos,    "var(--green)"],
                ["+ Trf. Enviadas",   enviados, "var(--red)"],
              ].map(([lbl, val, col]) => (
                <div key={lbl} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--muted)" }}>{lbl}</span>
                  <span className="mono" style={{ color: col, fontWeight: 600 }}>{val === 0 ? "—" : fmtS(val, cur)}</span>
                </div>
              ))}
              {/* Nos deben / Debemos split */}
              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div style={{ background: "rgba(255,85,112,.06)", border: "1px solid rgba(255,85,112,.15)", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", letterSpacing: ".08em", marginBottom: 4 }}>NOS DEBEN · {nDeben}</div>
                  <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: "var(--red)" }}>{fmt(totalDeben, cur)}</div>
                </div>
                <div style={{ background: "rgba(16,217,122,.06)", border: "1px solid rgba(16,217,122,.15)", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", letterSpacing: ".08em", marginBottom: 4 }}>DEBEMOS · {nDebemos}</div>
                  <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: "var(--green)" }}>{fmt(Math.abs(totalDebemos), cur)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail table */}
      <div className="card">
        <div className="tbl-wrap"><table>
          <thead>
            <tr>
              <th>Franquicia</th><th>Mon.</th>
              <th style={{ textAlign: "right" }}>Saldo Anterior</th>
              <th style={{ textAlign: "right" }}>Facturas</th>
              <th style={{ textAlign: "right" }}>NC / Créditos</th>
              <th style={{ textAlign: "right" }}>Pagos Recibidos</th>
              <th style={{ textAlign: "right" }}>Trf. Enviadas</th>
              <th style={{ textAlign: "right" }}>Saldo Final</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sumData.map(({ fr, sp, sa, facts, ncs, pagos, enviados }, i) => (
              <tr key={fr.id} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.01)" }}>
                <td style={{ fontWeight: 700, fontSize: 13, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{fr.name}</td>
                <td style={{ color: "var(--muted)", fontSize: 11 }}>{fr.currency}</td>
                <td style={{ textAlign: "right" }}>
                  <span className="mono" style={{ fontSize: 12, color: sp > 0.01 ? "var(--orange)" : sp < -0.01 ? "var(--cyan)" : "var(--muted)" }}>{fmtS(sp, fr.currency)}</span>
                </td>
                <td style={{ textAlign: "right" }}>{facts    > 0 ? <span className="mono" style={{ fontSize: 12, color: "var(--blue)",   fontWeight: 700 }}>+{fmt(facts,    fr.currency)}</span> : <span style={{ color: "var(--dim)" }}>—</span>}</td>
                <td style={{ textAlign: "right" }}>{ncs      > 0 ? <span className="mono" style={{ fontSize: 12, color: "var(--green)", fontWeight: 700 }}>-{fmt(ncs,      fr.currency)}</span> : <span style={{ color: "var(--dim)" }}>—</span>}</td>
                <td style={{ textAlign: "right" }}>{pagos    > 0 ? <span className="mono" style={{ fontSize: 12, color: "var(--green)", fontWeight: 700 }}>-{fmt(pagos,    fr.currency)}</span> : <span style={{ color: "var(--dim)" }}>—</span>}</td>
                <td style={{ textAlign: "right" }}>{enviados > 0 ? <span className="mono" style={{ fontSize: 12, color: "var(--red)",   fontWeight: 700 }}>+{fmt(enviados, fr.currency)}</span> : <span style={{ color: "var(--dim)" }}>—</span>}</td>
                <td style={{ textAlign: "right" }}><SaldoBadge value={sa} currency={fr.currency} /></td>
                <td><button className="ghost" style={{ fontSize: 10, whiteSpace: "nowrap" }} onClick={() => onOpenFr(fr.id)}>Ver →</button></td>
              </tr>
            ))}
          </tbody>
          {/* Footer: subtotales por signo por moneda */}
          <tfoot>
            {totalesPorMoneda.map(({ cur }) => {
              const rowsC      = sumData.filter(d => d.fr.currency === cur);
              const totalDeben   = rowsC.filter(d => d.sa >  0.01).reduce((a, d) => a + d.sa, 0);
              const totalDebemos = rowsC.filter(d => d.sa < -0.01).reduce((a, d) => a + d.sa, 0);
              const nDeben   = rowsC.filter(d => d.sa >  0.01).length;
              const nDebemos = rowsC.filter(d => d.sa < -0.01).length;
              return (
                <tr key={cur} style={{ borderTop: "2px solid var(--border2)", background: "rgba(255,255,255,.02)" }}>
                  <td colSpan={7} style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, paddingTop: 10 }}>{cur} — totales</td>
                  <td style={{ textAlign: "right", paddingTop: 10 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 800, color: "var(--red)", whiteSpace: "nowrap" }}>
                        ↑ {fmt(totalDeben, cur)} <span style={{ fontSize: 9, fontWeight: 400, color: "var(--muted)" }}>({nDeben} sedes)</span>
                      </span>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 800, color: "var(--green)", whiteSpace: "nowrap" }}>
                        ↓ {fmt(Math.abs(totalDebemos), cur)} <span style={{ fontSize: 9, fontWeight: 400, color: "var(--muted)" }}>({nDebemos} sedes)</span>
                      </span>
                    </div>
                  </td>
                  <td></td>
                </tr>
              );
            })}
          </tfoot>
        </table></div>
      </div>
    </div>
  );
});

export default TabMes;
