import { useState, useMemo } from "react";
import { T, ESTADO_EGRESO, fmtMoney, Badge, SummaryCard, PageHeader, Btn } from "./theme";
import { EGRESOS_SAMPLE } from "./data";
import NuevoEgresoModal from "./NuevoEgresoModal";

export default function PantallaEgresos() {
  const [busqueda, setBusqueda]     = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [showFiltros, setShowFiltros]  = useState(false);
  const [showNuevo,  setShowNuevo]     = useState(false);
  const [egresos, setEgresos]          = useState(EGRESOS_SAMPLE);

  const rows = useMemo(() => egresos.filter(e => {
    const matchEstado = filtroEstado === "todos" || e.estado === filtroEstado;
    const q = busqueda.toLowerCase();
    const matchQ = !q || e.proveedor.toLowerCase().includes(q) || e.cuenta.toLowerCase().includes(q) || e.cc.toLowerCase().includes(q);
    return matchEstado && matchQ;
  }), [busqueda, filtroEstado, egresos]);

  const totales = useMemo(() => ({
    cantidad: egresos.length,
    pagado:   egresos.filter(e=>e.estado==="pagado" && e.moneda==="ARS").reduce((s,e)=>s+e.importe,0),
    aPagar:   egresos.filter(e=>e.estado==="a_pagar" && e.moneda==="ARS").reduce((s,e)=>s+e.importe,0),
    vencido:  egresos.filter(e=>e.estado==="vencido" && e.moneda==="ARS").reduce((s,e)=>s+e.importe,0),
  }), [egresos]);

  const handleSave = (egreso) => setEgresos(prev => [{ ...egreso, proveedor: egreso.proveedorNombre ?? "Nuevo", fecha: egreso.fecha?.split("-").reverse().join("/") ?? "—", vto: egreso.vto?.split("-").reverse().join("/") ?? "—" }, ...prev]);

  return (
    <div style={{ padding:"28px 32px", maxWidth:1200 }} className="fade">
      <PageHeader
        title="Egresos"
        subtitle="Facturas recibidas, gastos y pagos a proveedores"
        action={
          <Btn variant="accent" onClick={()=>setShowNuevo(true)}>+ Nuevo Egreso</Btn>
        }
      />

      {/* Summary */}
      <div style={{ display:"flex", gap:12, marginBottom:24, flexWrap:"wrap" }}>
        <SummaryCard label="Cantidad"  value={totales.cantidad} sub="comprobantes" icon="🧾" />
        <SummaryCard label="Pagado"    value={fmtMoney(totales.pagado)}  color={T.green}  icon="✓" />
        <SummaryCard label="A Pagar"   value={fmtMoney(totales.aPagar)}  color={T.orange} icon="⏳" />
        <SummaryCard label="Vencido"   value={fmtMoney(totales.vencido)} color={T.red}    icon="⚠" />
      </div>

      {/* Filtros */}
      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
        padding:"12px 16px", marginBottom:16, boxShadow:T.shadow,
        display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
          placeholder="Buscar proveedor, cuenta, CC..."
          style={{ flex:1, minWidth:200, background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
            borderRadius:8, padding:"7px 12px", fontSize:13, color:T.text, outline:"none", fontFamily:T.font }} />
        {["todos","pagado","a_pagar","vencido"].map(e=>(
          <button key={e} onClick={()=>setFiltroEstado(e)} style={{
            background: filtroEstado===e ? T.accentDark : "#f3f4f6",
            color: filtroEstado===e ? T.accent : T.muted,
            border: `1px solid ${filtroEstado===e ? T.accentDark : T.cardBorder}`,
            borderRadius:999, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer",
          }}>
            {e==="todos" ? "Todos" : ESTADO_EGRESO[e]?.label}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
        boxShadow:T.shadow, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:T.tableHead }}>
              {["Estado","ID","Emisión","Vencimiento","Proveedor","Cuenta","Centro de Costo","Importe"].map(h=>(
                <th key={h} style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                  letterSpacing:".08em", textTransform:"uppercase",
                  color:T.tableHeadText, textAlign:"left", whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={8} style={{ padding:32, textAlign:"center", color:T.dim, fontSize:13 }}>Sin resultados</td></tr>
              : rows.map((e,i)=>(
                <tr key={e.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                  background: i%2===0 ? T.card : "#fafbfc", cursor:"pointer", transition:"background .1s" }}
                  onMouseEnter={ev=>ev.currentTarget.style.background="#f0f9ff"}
                  onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?T.card:"#fafbfc"}>
                  <td style={{ padding:"10px 14px" }}><Badge estado={e.estado} cfg={ESTADO_EGRESO} /></td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:T.blue, fontWeight:700, fontFamily:T.mono }}>{e.id}</td>
                  <td style={{ padding:"10px 14px", fontSize:13, color:T.text }}>{e.fecha}</td>
                  <td style={{ padding:"10px 14px", fontSize:13,
                    color:e.estado==="vencido"?T.red:T.text, fontWeight:e.estado==="vencido"?700:400 }}>{e.vto}</td>
                  <td style={{ padding:"10px 14px", fontSize:13, color:T.text, fontWeight:600 }}>{e.proveedor}</td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:T.muted }}>{e.cuenta}</td>
                  <td style={{ padding:"10px 14px" }}>
                    <span style={{ fontSize:11, background:"#f3f4f6", color:T.muted,
                      borderRadius:6, padding:"2px 8px", fontWeight:600 }}>{e.cc}</span>
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:13, fontFamily:T.mono,
                    fontWeight:700, color:T.text, textAlign:"right", whiteSpace:"nowrap" }}>
                    {fmtMoney(e.importe, e.moneda)}
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {showNuevo && <NuevoEgresoModal onClose={()=>setShowNuevo(false)} onSave={handleSave} />}
    </div>
  );
}
