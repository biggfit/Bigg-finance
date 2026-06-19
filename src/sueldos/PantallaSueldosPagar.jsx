import { useState, useEffect, useMemo } from "react";
import { fetchLiquidacionesCerradas, fetchPagosAnio, pendienteSueldosPorLegajo } from "../lib/sueldosApi";

const T = {
  card:   "#ffffff",
  border: "#e2e8f0",
  text:   "#1e293b",
  muted:  "#64748b",
  dim:    "#94a3b8",
  red:    "#dc2626",
  blue:   "#2563eb",
  head:   "#f1f5f9",
  font:   "'Inter', system-ui, sans-serif",
};

const MESES_ABR = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const fmt = (n) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-AR");
const periodKey   = (mes, anio) => anio * 100 + mes;
const periodLabel = (mes, anio) => `${MESES_ABR[mes - 1]} ${anio}`;

const FILTROS = [["all", "Todos"], ["hq", "HQ"], ["sedes", "Sedes"]];
const toggleBtn = (active) => ({
  background: active ? T.card : "transparent", border: "none", borderRadius: 5,
  padding: "5px 14px", cursor: "pointer", fontSize: 12, fontWeight: active ? 700 : 500,
  color: active ? T.blue : T.muted, fontFamily: T.font,
  boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
});

export default function PantallaSueldosPagar({ pais = "AR", onNavigate }) {
  const [liqs,    setLiqs]    = useState([]);
  const [pagos,   setPagos]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro,  setFiltro]  = useState("all");   // all | hq | sedes

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const [ls, ps] = await Promise.all([
          fetchLiquidacionesCerradas().catch(() => []),
          fetchPagosAnio().catch(() => []),
        ]);
        if (cancel) return;
        setLiqs(Array.isArray(ls) ? ls : []);
        setPagos(Array.isArray(ps) ? ps : []);
      } finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [pais]);

  // Por legajo: total + deuda por período (mes/año), cada uno con su ámbito (para el deep-link).
  const filas = useMemo(() =>
    pendienteSueldosPorLegajo(liqs, pagos, { pais })
      .map(r => {
        const items = filtro === "all" ? r.items : r.items.filter(it => it.ambito === filtro);
        if (!items.length) return null;
        const byPeriod = {};
        for (const it of items) {
          const k = periodKey(it.mes, it.anio);
          const cur = byPeriod[k] || { mes: it.mes, anio: it.anio, monto: 0, ambito: it.ambito };
          cur.monto += it.monto;
          byPeriod[k] = cur;
        }
        const total = items.reduce((s, it) => s + it.monto, 0);
        if (total <= 0.5) return null;
        return { legajo_id: r.legajo_id, legajo: r.legajo, total, byPeriod };
      })
      .filter(Boolean)
      .sort((a, b) => b.total - a.total),
  [liqs, pagos, pais, filtro]);

  // Columnas = unión de períodos con deuda, del más viejo (izq) al más nuevo (der).
  const periodos = useMemo(() => {
    const m = new Map();
    for (const f of filas) for (const k in f.byPeriod) {
      const p = f.byPeriod[k];
      m.set(Number(k), { key: Number(k), mes: p.mes, anio: p.anio });
    }
    return [...m.values()].sort((a, b) => a.key - b.key);
  }, [filas]);

  const tot = useMemo(() => {
    const perCol = {}; let total = 0;
    for (const f of filas) {
      total += f.total;
      for (const k in f.byPeriod) perCol[k] = (perCol[k] || 0) + f.byPeriod[k].monto;
    }
    return { perCol, total };
  }, [filas]);

  const abrir = (p, legajo_id) => {
    onNavigate?.(p.ambito === "hq" ? "liq-hq" : "liq-sedes", {
      mes: p.mes, anio: p.anio, paso: p.ambito === "hq" ? 3 : 5, legajo: legajo_id,
    });
  };

  const th = { fontSize: 11, fontWeight: 800, color: T.muted, textTransform: "uppercase",
    letterSpacing: ".04em", padding: "10px 14px", whiteSpace: "nowrap" };
  const td = { fontSize: 13, padding: "10px 14px", fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap" };
  const monto = (v, strong) => v > 0
    ? <span style={{ color: T.red, fontWeight: strong ? 800 : 600 }}>{fmt(v)}</span>
    : <span style={{ color: T.dim }}>—</span>;

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100 }} className="fade">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.blue }}>Sueldos por pagar</h2>
        <div style={{ display: "flex", gap: 2, background: T.head, borderRadius: 7, padding: 3 }}>
          {FILTROS.map(([v, label]) => (
            <button key={v} onClick={() => setFiltro(v)} style={toggleBtn(filtro === v)}>{label}</button>
          ))}
        </div>
        <span style={{ marginLeft: "auto", fontSize: 13, color: T.muted }}>
          Total: <b style={{ color: T.red }}>{fmt(tot.total)}</b>
        </span>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: T.muted }}>Cargando…</div>
      ) : filas.length === 0 ? (
        <div style={{ border: `1px dashed ${T.border}`, borderRadius: 8, padding: 40,
          textAlign: "center", color: T.muted, fontSize: 13 }}>
          No hay sueldos pendientes. 🎉
        </div>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
          boxShadow: "0 1px 4px rgba(0,0,0,.06)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: T.head, borderBottom: `1px solid ${T.border}` }}>
                <th style={{ ...th, textAlign: "left" }}>Empleado</th>
                {periodos.map(p => (
                  <th key={p.key} style={{ ...th, textAlign: "right" }}>{periodLabel(p.mes, p.anio)}</th>
                ))}
                <th style={{ ...th, textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.legajo_id}
                  style={{ borderBottom: `1px solid ${T.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background = "#eceff3"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}>
                  <td style={{ ...td, fontWeight: 600, color: T.text }}>{f.legajo}</td>
                  {periodos.map(p => {
                    const cell = f.byPeriod[p.key];
                    return (
                      <td key={p.key}
                        onClick={cell ? () => abrir(cell, f.legajo_id) : undefined}
                        title={cell ? `Ir a la liquidación de ${periodLabel(p.mes, p.anio)}` : undefined}
                        style={{ ...td, textAlign: "right", cursor: cell ? "pointer" : "default" }}>
                        {monto(cell ? cell.monto : 0)}
                      </td>
                    );
                  })}
                  <td style={{ ...td, textAlign: "right" }}>{monto(f.total, true)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "#fafbfc", borderTop: `2px solid ${T.border}` }}>
                <td style={{ ...td, fontWeight: 800 }}>Total</td>
                {periodos.map(p => (
                  <td key={p.key} style={{ ...td, textAlign: "right" }}>{monto(tot.perCol[p.key] || 0, true)}</td>
                ))}
                <td style={{ ...td, textAlign: "right" }}>{monto(tot.total, true)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
