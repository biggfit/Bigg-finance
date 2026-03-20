import { memo, useMemo } from "react";
import { fmt, computeSaldo, computeSaldoPrevMes, computePautaPendiente, makeType, SYM, compEmpresa, compCurrency } from "../lib/helpers";
import { SaldoBadge } from "../components/atoms";
import { useStore } from "../lib/context";
import { inPeriod } from "../data/franchisor";

// ─── TAB: RESUMEN MES ────────────────────────────────────────────────────────
const TabResumenMes = memo(function TabResumenMes({ allFranchises, month, year, onNavigate, selectedFrIds }) {
  const { comps, saldoInicial, activeCompany } = useStore();

  const tarjetas = useMemo(() => {
    const CUR_ORDER = ["ARS", "USD", "EUR"];
    const franchises = selectedFrIds?.size > 0
      ? allFranchises.filter(fr => selectedFrIds.has(fr.id))
      : allFranchises;

    return CUR_ORDER.map(cur => {
      const perFr = franchises.map(fr => {
        const key = String(fr.id);
        const fc = (comps[key] ?? []).filter(c =>
          inPeriod(c, month, year) &&
          compCurrency(c) === cur &&
          (!activeCompany || compEmpresa(c) === activeCompany)
        );

        const sp = computeSaldoPrevMes(fr.id, year, month, comps, saldoInicial, null, cur, activeCompany);
        const sa = computeSaldo(fr.id, year, month, comps, saldoInicial, null, cur, activeCompany);

        const netoCuenta = (cuenta) => {
          const facts = fc.filter(c => c.type === makeType("FACTURA", cuenta)).reduce((a, c) => a + c.amount, 0);
          const ncs   = fc.filter(c => c.type === makeType("NC",      cuenta)).reduce((a, c) => a + c.amount, 0);
          return { facts, ncs, neto: facts - ncs };
        };

        const fee           = netoCuenta("FEE");
        const interusos     = netoCuenta("INTERUSOS");
        const pauta         = netoCuenta("PAUTA");
        const sponsors      = netoCuenta("SPONSORS");
        const otrosIngresos = netoCuenta("OTROS_INGRESOS");
        const pagos         = fc.filter(c => c.type === "PAGO").reduce((a, c) => a + c.amount, 0);
        const pagosACuenta  = fc.filter(c => c.type === "PAGO_PAUTA").reduce((a, c) => a + c.amount, 0);
        const enviados      = fc.filter(c => c.type === "PAGO_ENVIADO").reduce((a, c) => a + c.amount, 0);
        const pautaPendiente = computePautaPendiente(fr.id, comps, year, month, null, cur, activeCompany);

        return { fr, sp, sa, fee, interusos, pauta, sponsors, otrosIngresos, pagos, pagosACuenta, enviados, pautaPendiente };
      });

      const sum = fn => perFr.reduce((a, d) => a + fn(d), 0);
      return {
        cur,
        totSP: sum(d => d.sp),
        totSA: sum(d => d.sa),
        fee:           { facts: sum(d => d.fee.facts),           ncs: sum(d => d.fee.ncs),           neto: sum(d => d.fee.neto)           },
        interusos:     { facts: sum(d => d.interusos.facts),     ncs: sum(d => d.interusos.ncs),     neto: sum(d => d.interusos.neto)     },
        pauta:         { facts: sum(d => d.pauta.facts),         ncs: sum(d => d.pauta.ncs),         neto: sum(d => d.pauta.neto)         },
        sponsors:      { facts: sum(d => d.sponsors.facts),      ncs: sum(d => d.sponsors.ncs),      neto: sum(d => d.sponsors.neto)      },
        otrosIngresos: { facts: sum(d => d.otrosIngresos.facts), ncs: sum(d => d.otrosIngresos.ncs), neto: sum(d => d.otrosIngresos.neto) },
        totPagos:        sum(d => d.pagos),
        totPagosACuenta: sum(d => d.pagosACuenta),
        totEnv:          sum(d => d.enviados),
        nDeben:          perFr.filter(d => d.sa >  0.01).length,
        cobrarReal:      perFr.filter(d => d.sa < -0.01 && d.pautaPendiente < 0.01),
        pautaPendRows:   perFr.filter(d => d.pautaPendiente > 0.01),
        totPautaPend:    perFr.filter(d => d.pautaPendiente > 0.01).reduce((a, d) => a + d.pautaPendiente, 0),
        totDeben:        perFr.filter(d => d.sa >  0.01).reduce((a, d) => a + d.sa, 0),
      };
    }).filter(Boolean);
  }, [allFranchises, comps, saldoInicial, month, year, activeCompany, selectedFrIds]);

  const fmtInt = (v, c) => `${SYM[c] || "$"}\u202f${Math.round(Math.abs(v)).toLocaleString("es-AR")}`;

  const CuentaRow = ({ label, data, cur, cuenta }) => {
    const hayMovimiento = data.facts > 0 || data.ncs > 0;
    return (
      <div
        onClick={hayMovimiento ? () => onNavigate("detalle", "ALL", { cuenta, moneda: cur }) : undefined}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", padding: "5px 0", cursor: hayMovimiento ? "pointer" : "default", borderRadius: 3 }}
        onMouseEnter={hayMovimiento ? e => e.currentTarget.style.background="rgba(255,255,255,.04)" : undefined}
        onMouseLeave={hayMovimiento ? e => e.currentTarget.style.background="" : undefined}
      >
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}{hayMovimiento ? <span style={{ opacity:.4, fontSize:9, marginLeft:4 }}>↗</span> : null}</span>
        <span className="mono" style={{ fontSize: 12, fontWeight: 800, color: hayMovimiento ? (data.neto >= 0 ? "var(--red)" : "var(--green)") : "var(--dim)" }}>
          {hayMovimiento ? (data.neto >= 0 ? "+" : "−") + fmt(Math.abs(data.neto), cur) : "—"}
        </span>
      </div>
    );
  };

  return (
    <div className="fade">
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${tarjetas.length || 1}, minmax(0, 1fr))`, gap: 16, alignItems: "stretch" }}>
        {tarjetas.map(({ cur, totSP, totSA, fee, interusos, pauta, sponsors, otrosIngresos, totPagos, totPagosACuenta, totEnv, nDeben, cobrarReal, pautaPendRows, totDeben, totPautaPend }) => {
          const accentC = cur === "ARS" ? "var(--gold)" : cur === "USD" ? "var(--green)" : "var(--cyan)";
          const totDebo = Math.abs(cobrarReal.reduce((a,d)=>a+d.sa,0));
          return (
            <div key={cur} style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, padding: 22, display: "flex", flexDirection: "column", minWidth: 0 }}>
              <div style={{ fontWeight: 900, fontSize: 22, letterSpacing: ".1em", color: accentC, marginBottom: 14 }}>{cur}</div>

              {/* Saldo arrastrado */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid var(--border)", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 800 }}>Saldo Arrastrado</span>
                <SaldoBadge value={totSP} currency={cur} />
              </div>

              {/* Por cuenta */}
              <CuentaRow label="Fee"            data={fee}           cur={cur} cuenta="FEE"           />
              <CuentaRow label="Interusos"      data={interusos}     cur={cur} cuenta="INTERUSOS"     />
              <CuentaRow label="Pauta"          data={pauta}         cur={cur} cuenta="PAUTA"         />
              <CuentaRow label="Sponsors"       data={sponsors}      cur={cur} cuenta="SPONSORS"      />
              <CuentaRow label="Otros Ingresos" data={otrosIngresos} cur={cur} cuenta="OTROS_INGRESOS"/>

              {/* Movimientos financieros */}
              <div style={{ marginTop: 8 }}>
                {[
                  ["Pagos Recibidos",  totPagos,       -1, "var(--green)",  "PAGO"],
                  ["Trf. Enviadas",    totEnv,          1, "var(--orange)", "PAGO_ENVIADO"],
                  ["Pagos a Cuenta",   totPagosACuenta,-1, "var(--cyan)",   "PAGO_PAUTA"],
                ].map(([lbl, val, sign, col, cuenta]) => (
                  <div key={lbl}
                    onClick={val !== 0 ? () => onNavigate("detalle","ALL",{cuenta, moneda: cur}) : undefined}
                    style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "4px 0", borderBottom: "1px solid var(--border)", cursor: val !== 0 ? "pointer" : "default" }}
                    onMouseEnter={val !== 0 ? e => e.currentTarget.style.background="rgba(255,255,255,.04)" : undefined}
                    onMouseLeave={val !== 0 ? e => e.currentTarget.style.background="" : undefined}
                  >
                    <span style={{ color: "var(--muted)" }}>{lbl}{val !== 0 ? <span style={{ opacity:.4, fontSize:9, marginLeft:4 }}>↗</span> : null}</span>
                    <span className="mono" style={{ color: col, fontWeight: 600 }}>
                      {val === 0 ? "—" : `${sign === -1 ? "−" : "+"}${fmt(val, cur)}`}
                    </span>
                  </div>
                ))}
              </div>

              {/* Saldo final */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 10, borderTop: "2px solid var(--border2)" }}>
                <span style={{ fontWeight: 800, fontSize: 13 }}>Saldo Neto</span>
                <SaldoBadge value={totSA} currency={cur} />
              </div>

              {/* Nos deben / Debemos / A Facturar */}
              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div onClick={() => onNavigate("saldos", "deben", { moneda: cur })}
                  style={{ padding: "10px 12px", borderRadius: 7, background: "rgba(255,85,112,.05)", border: "1px solid rgba(255,85,112,.1)", textAlign: "center", cursor: "pointer", transition: "background .15s", containerType: "inline-size", minWidth: 0, overflow: "hidden" }}
                  onMouseEnter={e => e.currentTarget.style.background="rgba(255,85,112,.12)"}
                  onMouseLeave={e => e.currentTarget.style.background="rgba(255,85,112,.05)"}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "var(--red)", letterSpacing: ".08em", marginBottom: 4 }}>NOS DEBEN ↗</div>
                  <div className="mono" style={{ fontSize: "clamp(10px, 11cqi, 14px)", fontWeight: 800, color: "var(--red)", whiteSpace: "nowrap" }}>{fmtInt(totDeben, cur)}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{nDeben} sede{nDeben !== 1 ? "s" : ""}</div>
                </div>
                <div onClick={() => onNavigate("saldos", "debemos", { moneda: cur })}
                  style={{ padding: "10px 12px", borderRadius: 7, background: "rgba(16,217,122,.05)", border: "1px solid rgba(16,217,122,.1)", textAlign: "center", cursor: "pointer", transition: "background .15s", containerType: "inline-size", minWidth: 0, overflow: "hidden" }}
                  onMouseEnter={e => e.currentTarget.style.background="rgba(16,217,122,.12)"}
                  onMouseLeave={e => e.currentTarget.style.background="rgba(16,217,122,.05)"}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "var(--green)", letterSpacing: ".08em", marginBottom: 4 }}>DEBEMOS ↗</div>
                  <div className="mono" style={{ fontSize: "clamp(10px, 11cqi, 14px)", fontWeight: 800, color: "var(--green)", whiteSpace: "nowrap" }}>{fmtInt(totDebo, cur)}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{cobrarReal.length} sede{cobrarReal.length !== 1 ? "s" : ""}</div>
                </div>
                <div onClick={() => onNavigate("detalle", "facturar", { cuenta: ["PAGO_PAUTA", "PAUTA"], moneda: cur })}
                  style={{ padding: "10px 12px", borderRadius: 7, background: "rgba(34,211,238,.05)", border: "1px solid rgba(34,211,238,.15)", textAlign: "center", cursor: "pointer", transition: "background .15s", gridColumn: "1 / -1", containerType: "inline-size", minWidth: 0, overflow: "hidden" }}
                  onMouseEnter={e => e.currentTarget.style.background="rgba(34,211,238,.12)"}
                  onMouseLeave={e => e.currentTarget.style.background="rgba(34,211,238,.05)"}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "var(--cyan)", letterSpacing: ".08em", marginBottom: 4 }}>A FACTURAR ↗</div>
                  <div className="mono" style={{ fontSize: "clamp(10px, 11cqi, 14px)", fontWeight: 800, color: "var(--cyan)", whiteSpace: "nowrap" }}>{fmtInt(totPautaPend, cur)}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>Pagos a cuenta · {pautaPendRows.length} sede{pautaPendRows.length !== 1 ? "s" : ""}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default TabResumenMes;
