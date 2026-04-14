import { T, fmtMoney } from "./theme";
import { EGRESOS_SAMPLE, INGRESOS_SAMPLE } from "./data";

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
      {trend !== undefined && (
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

export default function PantallaDashboard() {
  const totalIngresos = INGRESOS_SAMPLE.filter(e=>e.moneda==="ARS").reduce((s,e)=>s+e.importe,0);
  const totalEgresos  = EGRESOS_SAMPLE.filter(e=>e.moneda==="ARS").reduce((s,e)=>s+e.importe,0);
  const resultado     = totalIngresos - totalEgresos;
  const aPagar        = EGRESOS_SAMPLE.filter(e=>e.estado==="a_pagar"&&e.moneda==="ARS").reduce((s,e)=>s+e.importe,0);
  const aCobrar       = INGRESOS_SAMPLE.filter(e=>e.estado==="a_cobrar"&&e.moneda==="ARS").reduce((s,e)=>s+e.importe,0);
  const vencidosEg    = EGRESOS_SAMPLE.filter(e=>e.estado==="vencido");
  const vencidosIn    = INGRESOS_SAMPLE.filter(e=>e.estado==="vencido");

  const topEgresos = [...EGRESOS_SAMPLE].filter(e=>e.moneda==="ARS").sort((a,b)=>b.importe-a.importe).slice(0,4);
  const topIngresos= [...INGRESOS_SAMPLE].filter(e=>e.moneda==="ARS").sort((a,b)=>b.importe-a.importe).slice(0,4);

  return (
    <div style={{ padding:"28px 32px" }} className="fade">
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:24, fontWeight:900, color:T.text, margin:0, letterSpacing:"-.02em" }}>Dashboard</h1>
        <p style={{ fontSize:13, color:T.muted, margin:"4px 0 0" }}>Abril 2026 · ÑAKO SRL</p>
      </div>

      {/* KPIs principales */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:14, marginBottom:24 }}>
        <KpiCard label="Ingresos ARS"   value={fmtMoney(totalIngresos)} color={T.green}  icon="↑" trend={12} />
        <KpiCard label="Egresos ARS"    value={fmtMoney(totalEgresos)}  color={T.red}    icon="↓" trend={-5} />
        <KpiCard label="Resultado Neto" value={fmtMoney(resultado)}     color={resultado>=0?T.green:T.red} icon="=" />
        <KpiCard label="Margen" value={totalIngresos>0 ? `${((resultado/totalIngresos)*100).toFixed(1)}%` : "—"}
          color={resultado>=0?T.green:T.red} icon="%" sub="sobre ingresos" />
      </div>

      {/* KPIs secundarios */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:14, marginBottom:28 }}>
        <KpiCard label="Deudas a pagar"  value={fmtMoney(aPagar)}  color={T.orange} icon="⏳" sub={`${EGRESOS_SAMPLE.filter(e=>e.estado==="a_pagar").length} comprobantes`} />
        <KpiCard label="Cobros pendientes" value={fmtMoney(aCobrar)} color={T.blue} icon="📥" sub={`${INGRESOS_SAMPLE.filter(e=>e.estado==="a_cobrar").length} comprobantes`} />
        <KpiCard label="Vencidos" value={vencidosEg.length + vencidosIn.length} color={T.red} icon="⚠" sub="comprobantes vencidos" />
      </div>

      {/* Alertas + Tablas */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:24 }}>

        {/* Alertas */}
        <div>
          <div style={{ fontSize:13, fontWeight:800, color:T.text, marginBottom:12 }}>Alertas del período</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {vencidosEg.map(e=>(
              <AlertItem key={e.id} tipo="vencido"
                texto={`Pago vencido — ${e.proveedor}`}
                detalle={`${fmtMoney(e.importe, e.moneda)} · vto. ${e.vto}`} />
            ))}
            {vencidosIn.map(e=>(
              <AlertItem key={e.id} tipo="vencido"
                texto={`Cobro vencido — ${e.cliente}`}
                detalle={`${fmtMoney(e.importe, e.moneda)} · vto. ${e.vto}`} />
            ))}
            <AlertItem tipo="proximo"
              texto="Alquiler Recoleta vence en 17 días"
              detalle={`${fmtMoney(2100000)} · vto. 30/04/2026`} />
            <AlertItem tipo="info"
              texto="2 facturas USD pendientes de cobro"
              detalle="Gympass España + USD Pase Libre" />
          </div>
        </div>

        {/* Top egresos */}
        <MiniTable
          title="Mayores egresos del mes (ARS)"
          color={T.red}
          rows={topEgresos.map(e=>({ label:e.proveedor, sub:e.cuenta, value:fmtMoney(e.importe) }))}
        />
      </div>

      {/* Top ingresos */}
      <MiniTable
        title="Mayores ingresos del mes (ARS)"
        color={T.green}
        rows={topIngresos.map(e=>({ label:e.cliente, sub:e.cuenta, value:fmtMoney(e.importe) }))}
      />
    </div>
  );
}
