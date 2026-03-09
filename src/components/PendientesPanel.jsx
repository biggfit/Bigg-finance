import { useMemo } from "react";
import { useStore } from "../lib/context";
import { makeType, MONTHS, fmt } from "../lib/helpers";
import { inPeriod, dateMonth, dateYear } from "../data/franchisor";

// ── Pendientes panel ────────────────────────────────────────────────────────
export default function PendientesPanel({ onEmitir }) {
  const { franchises, comps } = useStore();
  const pendientes = useMemo(() => {
    return franchises.filter(f => f.activa !== false).flatMap(fr => {
      const frComps = comps[fr.id] ?? [];
      return frComps
        .filter(c => c.type === "PAGO_PAUTA")
        .filter(c => {
          // tiene pago a cuenta sin factura asociada
          const hasFact = frComps.some(f2 => f2.type === makeType("FACTURA","PAUTA") && inPeriod(f2, dateMonth(c.date), dateYear(c.date)));
          return !hasFact;
        })
        .map(c => ({ fr, comp: c }));
    });
  }, [franchises, comps]);

  if (pendientes.length === 0) return null;
  return (
    <div style={{ background: "rgba(222,251,151,.04)", border: "1px solid rgba(222,251,151,.2)", borderRadius: 10, padding: "14px 18px", marginBottom: 20 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: "var(--gold)", letterSpacing: ".1em", marginBottom: 10 }}>
        ⚠ PAGOS A CUENTA SIN FACTURA — {pendientes.length} pendiente{pendientes.length !== 1 ? "s" : ""}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {pendientes.map(({ fr, comp }, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg2)", borderRadius: 7, padding: "8px 12px" }}>
            <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>{fr.name}</span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{MONTHS[comp.month]} {comp.year}</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--gold)", fontWeight: 700 }}>{fmt(comp.amount, fr.currency)}</span>
            <span className="pill" style={{ color: "var(--gold)", background: "rgba(222,251,151,.1)", fontSize: 9 }}>PAGO A CTA</span>
            <button className="ghost" style={{ fontSize: 10, padding: "2px 8px", color: "var(--gold)" }}
              onClick={() => onEmitir(fr, comp)}>Emitir factura →</button>
          </div>
        ))}
      </div>
    </div>
  );
}
