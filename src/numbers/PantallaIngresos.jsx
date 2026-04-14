import { useState, useMemo } from "react";
import { T, ESTADO_INGRESO, fmtMoney, Badge, SummaryCard, PageHeader, Btn } from "./theme";
import { INGRESOS_SAMPLE } from "./data";
import NuevoIngresoModal from "./NuevoIngresoModal";

export default function PantallaIngresos() {
  const [busqueda, setBusqueda]         = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [showNuevo, setShowNuevo]       = useState(false);
  const [ingresos, setIngresos]         = useState(INGRESOS_SAMPLE);

  const handleSave = (ingreso) => setIngresos(prev => [{
    ...ingreso,
    cliente: ingreso.clienteNombre ?? "Nuevo",
    fecha:   ingreso.fecha?.split("-").reverse().join("/") ?? "—",
    vto:     ingreso.vto?.split("-").reverse().join("/")   ?? "—",
  }, ...prev]);

  const rows = useMemo(() => ingresos.filter(e => {
    const matchEstado = filtroEstado === "todos" || e.estado === filtroEstado;
    const q = busqueda.toLowerCase();
    const matchQ = !q || e.cliente.toLowerCase().includes(q) || e.cuenta.toLowerCase().includes(q) || e.cc.toLowerCase().includes(q);
    return matchEstado && matchQ;
  }), [busqueda, filtroEstado, ingresos]);

  const totales = useMemo(() => ({
    cantidad:  ingresos.length,
    cobrado:   ingresos.filter(e=>e.estado==="cobrado"  && e.moneda==="ARS").reduce((s,e)=>s+e.importe,0),
    aCobrar:   ingresos.filter(e=>e.estado==="a_cobrar" && e.moneda==="ARS").reduce((s,e)=>s+e.importe,0),
    vencido:   ingresos.filter(e=>e.estado==="vencido"  && e.moneda==="ARS").reduce((s,e)=>s+e.importe,0),
  }), [ingresos]);

  return (
    <div style={{ padding:"28px 32px", maxWidth:1200 }} className="fade">
      <PageHeader
        title="Ingresos"
        subtitle="Facturas emitidas, cobros y cuentas a cobrar"
        action={<Btn variant="accent" onClick={()=>setShowNuevo(true)}>+ Nuevo Ingreso</Btn>}
      />

      <div style={{ display:"flex", gap:12, marginBottom:24, flexWrap:"wrap" }}>
        <SummaryCard label="Cantidad"  value={totales.cantidad} sub="comprobantes" icon="📄" />
        <SummaryCard label="Cobrado"   value={fmtMoney(totales.cobrado)}  color={T.green}  icon="✓" />
        <SummaryCard label="A Cobrar"  value={fmtMoney(totales.aCobrar)}  color={T.blue}   icon="📥" />
        <SummaryCard label="Vencido"   value={fmtMoney(totales.vencido)}  color={T.red}    icon="⚠" />
      </div>

      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
        padding:"12px 16px", marginBottom:16, boxShadow:T.shadow,
        display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
          placeholder="Buscar cliente, cuenta, CC..."
          style={{ flex:1, minWidth:200, background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
            borderRadius:8, padding:"7px 12px", fontSize:13, color:T.text, outline:"none", fontFamily:T.font }} />
        {["todos","cobrado","a_cobrar","vencido"].map(e=>(
          <button key={e} onClick={()=>setFiltroEstado(e)} style={{
            background: filtroEstado===e ? T.accentDark : "#f3f4f6",
            color: filtroEstado===e ? T.accent : T.muted,
            border:`1px solid ${filtroEstado===e ? T.accentDark : T.cardBorder}`,
            borderRadius:999, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer",
          }}>
            {e==="todos" ? "Todos" : ESTADO_INGRESO[e]?.label}
          </button>
        ))}
      </div>

      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
        boxShadow:T.shadow, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:T.tableHead }}>
              {["Estado","ID","Emisión","Vencimiento","Cliente","Cuenta","Centro de Costo","Importe"].map(h=>(
                <th key={h} style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                  letterSpacing:".08em", textTransform:"uppercase", color:T.tableHeadText, textAlign:"left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={8} style={{ padding:32, textAlign:"center", color:T.dim, fontSize:13 }}>Sin resultados</td></tr>
              : rows.map((e,i)=>(
                <tr key={e.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                  background:i%2===0?T.card:"#fafbfc", cursor:"pointer", transition:"background .1s" }}
                  onMouseEnter={ev=>ev.currentTarget.style.background="#f0fff4"}
                  onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?T.card:"#fafbfc"}>
                  <td style={{ padding:"10px 14px" }}><Badge estado={e.estado} cfg={ESTADO_INGRESO} /></td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:T.green, fontWeight:700, fontFamily:T.mono }}>{e.id}</td>
                  <td style={{ padding:"10px 14px", fontSize:13, color:T.text }}>{e.fecha}</td>
                  <td style={{ padding:"10px 14px", fontSize:13,
                    color:e.estado==="vencido"?T.red:T.text, fontWeight:e.estado==="vencido"?700:400 }}>{e.vto}</td>
                  <td style={{ padding:"10px 14px", fontSize:13, color:T.text, fontWeight:600 }}>{e.cliente}</td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:T.muted }}>{e.cuenta}</td>
                  <td style={{ padding:"10px 14px" }}>
                    <span style={{ fontSize:11, background:"#f3f4f6", color:T.muted,
                      borderRadius:6, padding:"2px 8px", fontWeight:600 }}>{e.cc}</span>
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:13, fontFamily:T.mono,
                    fontWeight:700, color:T.green, textAlign:"right", whiteSpace:"nowrap" }}>
                    {fmtMoney(e.importe, e.moneda)}
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {showNuevo && <NuevoIngresoModal onClose={()=>setShowNuevo(false)} onSave={handleSave} />}
    </div>
  );
}
