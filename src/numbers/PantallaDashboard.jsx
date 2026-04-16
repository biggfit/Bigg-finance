import { useState, useEffect, useMemo } from "react";
import { T, fmtMoney, fmtDate } from "./theme";
import {
  fetchEgresos, fetchIngresos, fetchPagosCobros,
  calcSaldoPendiente, calcEstadoEgreso, calcEstadoIngreso,
} from "../lib/numbersApi";

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
               "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

// ─── Parsea "DD/MM/YYYY" o "YYYY-MM-DD" → { year, month (1-12) } ─────────────
function parseYM(fechaStr) {
  if (!fechaStr) return null;
  if (/^\d{4}-\d{2}/.test(fechaStr)) {
    return { year: +fechaStr.slice(0,4), month: +fechaStr.slice(5,7) };
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaStr)) {
    const [, m, y] = fechaStr.split("/");
    return { year: +y, month: +m };
  }
  return null;
}

function KpiCard({ label, value, color, sub, icon, trend }) {
  return (
    <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
      padding:"20px 22px", boxShadow:T.shadow }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
        <span style={{ fontSize:11, color:T.muted, fontWeight:600,
          letterSpacing:".07em", textTransform:"uppercase" }}>{label}</span>
        <span style={{ fontSize:20 }}>{icon}</span>
      </div>
      <div style={{ fontSize:22, fontWeight:900, color: color ?? T.text, fontFamily:T.mono, marginBottom:4 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize:12, color:T.dim }}>{sub}</div>}
      {trend !== undefined && trend !== null && (
        <div style={{ fontSize:11, color: trend >= 0 ? T.green : T.red, marginTop:6, fontWeight:700 }}>
          {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}% vs mes anterior
        </div>
      )}
    </div>
  );
}

function AlertItem({ tipo, texto, detalle }) {
  const cfg = {
    vencido:  { color:T.red,    bg:"#fff5f5", icon:"🔴" },
    proximo:  { color:T.orange, bg:"#fffbeb", icon:"🟡" },
    info:     { color:T.blue,   bg:"#eff6ff", icon:"🔵" },
  }[tipo] ?? { color:T.muted, bg:"#f9fafb", icon:"⚪" };

  return (
    <div style={{ display:"flex", alignItems:"flex-start", gap:10,
      padding:"10px 14px", background:cfg.bg, borderRadius:8, borderLeft:`3px solid ${cfg.color}` }}>
      <span>{cfg.icon}</span>
      <div>
        <div style={{ fontSize:13, color:T.text, fontWeight:600 }}>{texto}</div>
        <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>{detalle}</div>
      </div>
    </div>
  );
}

function MiniTable({ title, rows, color }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
      boxShadow:T.shadow, overflow:"hidden" }}>
      <div style={{ padding:"14px 18px", borderBottom:`1px solid ${T.cardBorder}`,
        fontSize:13, fontWeight:800, color:T.text }}>{title}</div>
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: i<rows.length-1 ? `1px solid ${T.cardBorder}` : "none" }}>
              <td style={{ padding:"9px 16px", fontSize:12, color:T.text, fontWeight:600 }}>{r.label}</td>
              <td style={{ padding:"9px 16px", fontSize:12, color:T.muted }}>{r.sub}</td>
              <td style={{ padding:"9px 16px", fontSize:12, fontFamily:T.mono,
                fontWeight:700, color: color ?? T.text, textAlign:"right" }}>
                {r.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PantallaDashboard({ sociedad = "nako" }) {
  const [egresos,     setEgresos]     = useState([]);
  const [ingresos,    setIngresos]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);

  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError(null);
      try {
        const [egs, ings, pcs] = await Promise.all([
          fetchEgresos(sociedad),
          fetchIngresos(sociedad),
          fetchPagosCobros(sociedad).catch(() => []),
        ]);
        if (cancelled) return;

        const pagos  = Array.isArray(pcs) ? pcs.filter(p => p.tipo === "PAGO_FC" || p.tipo === "EGRESO_GASTO") : [];
        const cobros = Array.isArray(pcs) ? pcs.filter(p => p.tipo === "COBRO_FC") : [];

        const enrichEg = (Array.isArray(egs) ? egs : []).map(doc => {
          const docPagos = pagos.filter(p => p.documento_id === doc.id);
          const saldo    = calcSaldoPendiente(doc.total, docPagos);
          return { ...doc, importe: Number(doc.total) || 0, saldoPendiente: saldo,
                   pagosVinculados: docPagos, estado: calcEstadoEgreso(saldo, doc.total, doc.vto) };
        });

        const enrichIn = (Array.isArray(ings) ? ings : []).map(doc => {
          const docCobros = cobros.filter(c => c.documento_id === doc.id);
          const saldo     = calcSaldoPendiente(doc.total, docCobros);
          return { ...doc, importe: Number(doc.total) || 0, saldoPendiente: saldo,
                   pagosVinculados: docCobros, estado: calcEstadoIngreso(saldo, doc.total, doc.vto) };
        });

        setEgresos(enrichEg);
        setIngresos(enrichIn);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [sociedad]);

  // ── Filtrar por mes actual ──────────────────────────────────────────────────
  const egMes = useMemo(() => egresos.filter(e => {
    const ym = parseYM(e.fecha);
    return ym && ym.year === year && ym.month === month;
  }), [egresos, year, month]);

  const inMes = useMemo(() => ingresos.filter(e => {
    const ym = parseYM(e.fecha);
    return ym && ym.year === year && ym.month === month;
  }), [ingresos, year, month]);

  // ── KPIs del mes (ARS) ─────────────────────────────────────────────────────
  const totalEgARS = useMemo(() => egMes.filter(e=>e.moneda==="ARS").reduce((s,e)=>s+e.importe,0), [egMes]);
  const totalInARS = useMemo(() => inMes.filter(e=>e.moneda==="ARS").reduce((s,e)=>s+e.importe,0), [inMes]);
  const resultado  = totalInARS - totalEgARS;
  const margen     = totalInARS > 0 ? ((resultado / totalInARS) * 100).toFixed(1) : null;

  // ── Pendientes (todos los meses, no solo el actual) ─────────────────────────
  const aPagar  = useMemo(() => egresos.filter(e=>e.moneda==="ARS"&&(e.estado==="a_pagar"||e.estado==="vencido")).reduce((s,e)=>s+(e.saldoPendiente??e.importe),0), [egresos]);
  const aCobrar = useMemo(() => ingresos.filter(e=>e.moneda==="ARS"&&(e.estado==="a_cobrar"||e.estado==="vencido")).reduce((s,e)=>s+(e.saldoPendiente??e.importe),0), [ingresos]);

  const vencidosEg = useMemo(() => egresos.filter(e=>e.estado==="vencido"), [egresos]);
  const vencidosIn = useMemo(() => ingresos.filter(e=>e.estado==="vencido"), [ingresos]);

  // ── Top egresos/ingresos del mes (ARS) ────────────────────────────────────
  const topEgresos  = useMemo(() => [...egMes].filter(e=>e.moneda==="ARS").sort((a,b)=>b.importe-a.importe).slice(0,4), [egMes]);
  const topIngresos = useMemo(() => [...inMes].filter(e=>e.moneda==="ARS").sort((a,b)=>b.importe-a.importe).slice(0,4), [inMes]);

  const mesLabel = `${MESES[month-1]} ${year}`;

  if (loading) return (
    <div style={{ padding:"60px 32px", textAlign:"center", color:T.muted, fontSize:14 }}>
      Cargando dashboard…
    </div>
  );

  if (error) return (
    <div style={{ padding:"40px 32px" }}>
      <div style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:8,
        padding:"16px 20px", color:"#dc2626", fontSize:13 }}>
        <strong>Error:</strong> {error}
      </div>
    </div>
  );

  return (
    <div style={{ padding:"28px 32px" }} className="fade">
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:24, fontWeight:900, color:T.text, margin:0, letterSpacing:"-.02em" }}>Dashboard</h1>
        <p style={{ fontSize:13, color:T.muted, margin:"4px 0 0" }}>{mesLabel}</p>
      </div>

      {/* KPIs principales */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:14, marginBottom:24 }}>
        <KpiCard label="Ingresos ARS"   value={fmtMoney(totalInARS)} color={T.green} icon="↑" />
        <KpiCard label="Egresos ARS"    value={fmtMoney(totalEgARS)} color={T.red}   icon="↓" />
        <KpiCard label="Resultado Neto" value={fmtMoney(resultado)}  color={resultado>=0?T.green:T.red} icon="=" />
        <KpiCard label="Margen" value={margen !== null ? `${margen}%` : "—"}
          color={resultado>=0?T.green:T.red} icon="%" sub="sobre ingresos" />
      </div>

      {/* KPIs secundarios */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:14, marginBottom:28 }}>
        <KpiCard label="Deudas a pagar"   value={fmtMoney(aPagar)}  color={T.orange} icon="⏳"
          sub={`${egresos.filter(e=>e.estado==="a_pagar"||e.estado==="vencido").length} comprobantes`} />
        <KpiCard label="Cobros pendientes" value={fmtMoney(aCobrar)} color={T.blue}   icon="📥"
          sub={`${ingresos.filter(e=>e.estado==="a_cobrar"||e.estado==="vencido").length} comprobantes`} />
        <KpiCard label="Vencidos" value={vencidosEg.length + vencidosIn.length}
          color={T.red} icon="⚠" sub="comprobantes vencidos" />
      </div>

      {/* Alertas + Top egresos */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:24 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:800, color:T.text, marginBottom:12 }}>Alertas del período</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {vencidosEg.length === 0 && vencidosIn.length === 0 && (
              <AlertItem tipo="info" texto="Sin vencidos" detalle="Todo al día" />
            )}
            {vencidosEg.map(e=>(
              <AlertItem key={e.id} tipo="vencido"
                texto={`Pago vencido — ${e.proveedor}`}
                detalle={`${fmtMoney(e.saldoPendiente??e.importe, e.moneda)} · vto. ${fmtDate(e.vto)}`} />
            ))}
            {vencidosIn.map(e=>(
              <AlertItem key={e.id} tipo="vencido"
                texto={`Cobro vencido — ${e.cliente}`}
                detalle={`${fmtMoney(e.saldoPendiente??e.importe, e.moneda)} · vto. ${fmtDate(e.vto)}`} />
            ))}
          </div>
        </div>
        <MiniTable
          title={`Mayores egresos del mes (ARS)`}
          color={T.red}
          rows={topEgresos.map(e=>({ label: e.proveedor ?? "—", sub: e.cuenta ?? "—", value: fmtMoney(e.importe) }))}
        />
      </div>

      {/* Top ingresos */}
      <MiniTable
        title={`Mayores ingresos del mes (ARS)`}
        color={T.green}
        rows={topIngresos.map(e=>({ label: e.cliente ?? "—", sub: e.cuenta ?? "—", value: fmtMoney(e.importe) }))}
      />
    </div>
  );
}
