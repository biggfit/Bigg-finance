import { useState, useMemo, useEffect, useRef } from "react";
import { T, ESTADO_INGRESO, fmtMoney, Badge, SummaryCard, PageHeader, Btn } from "./theme";
import { INGRESOS_SAMPLE } from "./data";
import NuevoIngresoModal from "./NuevoIngresoModal";

// ─── Medios de cobro ──────────────────────────────────────────────────────────
const MEDIOS_COBRO = [
  { id:"00-hq-ars",         nombre:"00 - HQ ARS"             },
  { id:"00-hq-usd",         nombre:"00 - HQ USD"             },
  { id:"01-mp-nako",        nombre:"01 - Mercado Pago - Ñako"},
  { id:"07-galicia-nako",   nombre:"07 - Galicia - Ñako"     },
  { id:"08-galicia-hektor", nombre:"08 - Galicia - Hektor"   },
];

// ─── Modal: Registrar Cobro ───────────────────────────────────────────────────
function RegistrarCobroModal({ ingreso, onClose, onSave }) {
  const [form, setForm] = useState({
    fecha:     new Date().toISOString().slice(0, 10),
    monto:     String(ingreso.importe ?? ""),
    medioCobro: "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const canSave = form.fecha && form.monto && form.medioCobro;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:10, width:440,
        maxWidth:"97vw", boxShadow:"0 20px 60px rgba(0,0,0,.3)", overflow:"hidden" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ background:"#1e3a5f", padding:"14px 22px", display:"flex",
          justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:"#93c5fd" }}>Registrar Cobro</div>
            <div style={{ fontSize:11, color:"rgba(147,197,253,.55)", marginTop:2 }}>
              {ingreso.cliente} · {fmtMoney(ingreso.importe, ingreso.moneda)}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.5)", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>

        <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <div>
              <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>Fecha</label>
              <input type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)}
                style={{ width:"100%", background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
                  borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
                  fontFamily:T.font, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div>
              <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>Importe $</label>
              <input type="number" value={form.monto} onChange={e => set("monto", e.target.value)}
                style={{ width:"100%", background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
                  borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
                  fontFamily:T.font, outline:"none", boxSizing:"border-box" }} />
            </div>
          </div>

          <div>
            <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:8 }}>
              Acreditar en <span style={{ color:T.red }}>*</span>
            </label>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {MEDIOS_COBRO.map(m => (
                <button key={m.id} onClick={() => set("medioCobro", m.id)} style={{
                  background: form.medioCobro === m.id ? "#eff6ff" : "#f9fafb",
                  border:`1.5px solid ${form.medioCobro === m.id ? "#2563eb" : T.cardBorder}`,
                  borderRadius:8, padding:"9px 14px", cursor:"pointer",
                  display:"flex", alignItems:"center", gap:10, textAlign:"left",
                  fontFamily:T.font, transition:"all .1s",
                }}>
                  <span style={{ fontSize:16 }}>🏦</span>
                  <span style={{ fontSize:13, fontWeight:600, color:T.text, flex:1 }}>{m.nombre}</span>
                  {form.medioCobro === m.id && <span style={{ color:"#2563eb", fontWeight:800 }}>✓</span>}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, paddingTop:4 }}>
            <button onClick={onClose} style={{
              background:"#dc2626", border:"none", borderRadius:8, padding:"9px 20px",
              fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer",
              fontFamily:T.font, display:"flex", alignItems:"center", gap:6 }}>Cancelar ✕</button>
            <button onClick={() => { onSave({ ...form, ingresoId: ingreso.id }); onClose(); }}
              disabled={!canSave} style={{
                background: canSave ? "#16a34a" : "#9ca3af", border:"none", borderRadius:8,
                padding:"9px 20px", fontSize:13, fontWeight:700, color:"#fff",
                cursor: canSave ? "pointer" : "default",
                fontFamily:T.font, display:"flex", alignItems:"center", gap:6 }}>Guardar ✓</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Ver Detalle ───────────────────────────────────────────────────────
function DetalleModal({ ingreso, onClose }) {
  const campo = (label, value) => (
    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
      <span style={{ fontSize:11, color:T.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:".06em" }}>{label}</span>
      <span style={{ fontSize:13, color:T.text, fontWeight:600 }}>{value || "—"}</span>
    </div>
  );
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:12, width:460,
        maxWidth:"97vw", boxShadow:"0 20px 60px rgba(0,0,0,.25)", overflow:"hidden" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ background:"#1e3a5f", padding:"14px 22px", display:"flex",
          justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:"#93c5fd" }}>Detalle del Ingreso</div>
            <div style={{ fontSize:11, color:"rgba(147,197,253,.5)", marginTop:2 }}>{ingreso.id}</div>
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.4)", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>
        <div style={{ padding:24, display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          {campo("Cliente",         ingreso.cliente)}
          {campo("Estado",          ESTADO_INGRESO[ingreso.estado]?.label ?? ingreso.estado)}
          {campo("Cuenta",          ingreso.cuenta)}
          {campo("Centro de Costo", ingreso.cc)}
          {campo("Fecha Emisión",   ingreso.fecha)}
          {campo("Vencimiento",     ingreso.vto)}
          {campo("Moneda",          ingreso.moneda)}
          {campo("Importe",         fmtMoney(ingreso.importe, ingreso.moneda))}
        </div>
        <div style={{ padding:"14px 24px", borderTop:`1px solid ${T.cardBorder}`,
          display:"flex", justifyContent:"flex-end" }}>
          <Btn variant="ghost" onClick={onClose}>Cerrar</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Dropdown de acciones por fila ────────────────────────────────────────────
function RowMenu({ ingreso, onCobro, onDetalle, onEliminar }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const item = (label, onClick, color) => (
    <button onClick={() => { onClick(); setOpen(false); }} style={{
      display:"block", width:"100%", textAlign:"left", padding:"8px 14px",
      background:"transparent", border:"none", fontSize:13, color: color ?? T.text,
      cursor:"pointer", fontFamily:T.font,
    }}
    onMouseEnter={e => e.currentTarget.style.background="#f3f4f6"}
    onMouseLeave={e => e.currentTarget.style.background="transparent"}>
      {label}
    </button>
  );

  const divider = <div style={{ height:1, background:T.cardBorder, margin:"3px 0" }} />;

  return (
    <div ref={ref} style={{ position:"relative", display:"inline-block" }}>
      <button onClick={() => setOpen(o => !o)} style={{
        background: open ? "#e5e7eb" : "#f3f4f6",
        border:`1px solid ${T.cardBorder}`, borderRadius:6,
        padding:"3px 8px", cursor:"pointer", fontSize:12, color:T.muted,
        fontFamily:T.font, lineHeight:1,
      }}>▾</button>

      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, zIndex:300,
          background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:8,
          boxShadow:T.shadowMd, minWidth:170, overflow:"hidden" }}>
          {item("Ver Detalle",       onDetalle)}
          {item("Editar",            () => {})}
          {divider}
          {item("Registrar Cobro",   onCobro, "#1e3a5f")}
          {item("Crear NC/ND",       () => {})}
          {item("Cta. Cte.",         () => {})}
          {divider}
          {item("Eliminar",          onEliminar, T.red)}
        </div>
      )}
    </div>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function PantallaIngresos() {
  const [busqueda, setBusqueda]         = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [showNuevo, setShowNuevo]       = useState(false);
  const [ingresos, setIngresos]         = useState(INGRESOS_SAMPLE);
  const [showCobro, setShowCobro]       = useState(null);
  const [showDetalle, setShowDetalle]   = useState(null);

  const handleSave = (ingreso) => setIngresos(prev => [{
    ...ingreso,
    cliente: ingreso.clienteNombre ?? ingreso.cliente ?? "Nuevo",
    fecha:   ingreso.fecha?.includes("-") ? ingreso.fecha.split("-").reverse().join("/") : ingreso.fecha ?? "—",
    vto:     ingreso.vto?.includes("-")   ? ingreso.vto.split("-").reverse().join("/")   : ingreso.vto   ?? "—",
  }, ...prev]);

  const handleEliminar = (id) => setIngresos(prev => prev.filter(e => e.id !== id));

  const rows = useMemo(() => ingresos.filter(e => {
    const matchEstado = filtroEstado === "todos" || e.estado === filtroEstado;
    const q = busqueda.toLowerCase();
    const matchQ = !q || e.cliente.toLowerCase().includes(q) || e.cuenta.toLowerCase().includes(q) || e.cc.toLowerCase().includes(q);
    return matchEstado && matchQ;
  }), [busqueda, filtroEstado, ingresos]);

  const totales = useMemo(() => ({
    cantidad: ingresos.length,
    cobrado:  ingresos.filter(e=>e.estado==="cobrado"  && e.moneda==="ARS").reduce((s,e)=>s+e.importe,0),
    aCobrar:  ingresos.filter(e=>e.estado==="a_cobrar" && e.moneda==="ARS").reduce((s,e)=>s+e.importe,0),
    vencido:  ingresos.filter(e=>e.estado==="vencido"  && e.moneda==="ARS").reduce((s,e)=>s+e.importe,0),
  }), [ingresos]);

  return (
    <div style={{ padding:"28px 32px", maxWidth:1200 }} className="fade">
      <PageHeader
        title="Ingresos"
        subtitle="Facturas emitidas, cobros y cuentas a cobrar"
        action={<Btn variant="accent" onClick={() => setShowNuevo(true)}>+ Nuevo Ingreso</Btn>}
      />

      <div style={{ display:"flex", gap:12, marginBottom:24, flexWrap:"wrap" }}>
        <SummaryCard label="Cantidad"  value={totales.cantidad} sub="comprobantes" icon="📄" />
        <SummaryCard label="Cobrado"   value={fmtMoney(totales.cobrado)}  color={T.green} icon="✓" />
        <SummaryCard label="A Cobrar"  value={fmtMoney(totales.aCobrar)}  color={T.blue}  icon="📥" />
        <SummaryCard label="Vencido"   value={fmtMoney(totales.vencido)}  color={T.red}   icon="⚠" />
      </div>

      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
        padding:"12px 16px", marginBottom:16, boxShadow:T.shadow,
        display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar cliente, cuenta, CC..."
          style={{ flex:1, minWidth:200, background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
            borderRadius:8, padding:"7px 12px", fontSize:13, color:T.text, outline:"none", fontFamily:T.font }} />
        {["todos","cobrado","a_cobrar","vencido"].map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)} style={{
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
              <th style={{ width:36 }} />
              {["Estado","ID","Emisión","Vencimiento","Cliente","Cuenta","Centro de Costo","Importe"].map(h => (
                <th key={h} style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                  letterSpacing:".08em", textTransform:"uppercase", color:T.tableHeadText, textAlign:"left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={9} style={{ padding:32, textAlign:"center", color:T.dim, fontSize:13 }}>Sin resultados</td></tr>
              : rows.map((e, i) => (
                <tr key={e.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                  background: i%2===0 ? T.card : "#fafbfc", transition:"background .1s" }}
                  onMouseEnter={ev => ev.currentTarget.style.background="#f0fff4"}
                  onMouseLeave={ev => ev.currentTarget.style.background=i%2===0?T.card:"#fafbfc"}>

                  <td style={{ padding:"8px 6px 8px 10px", verticalAlign:"middle" }}>
                    <RowMenu
                      ingreso={e}
                      onCobro={()    => setShowCobro(e)}
                      onDetalle={()  => setShowDetalle(e)}
                      onEliminar={() => handleEliminar(e.id)}
                    />
                  </td>

                  <td style={{ padding:"10px 14px" }}><Badge estado={e.estado} cfg={ESTADO_INGRESO} /></td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:T.green, fontWeight:700, fontFamily:"var(--mono)" }}>{e.id}</td>
                  <td style={{ padding:"10px 14px", fontSize:13, color:T.text }}>{e.fecha}</td>
                  <td style={{ padding:"10px 14px", fontSize:13,
                    color:e.estado==="vencido"?T.red:T.text, fontWeight:e.estado==="vencido"?700:400 }}>{e.vto}</td>
                  <td style={{ padding:"10px 14px", fontSize:13, color:T.text, fontWeight:600 }}>{e.cliente}</td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:T.muted }}>{e.cuenta}</td>
                  <td style={{ padding:"10px 14px" }}>
                    <span style={{ fontSize:11, background:"#f3f4f6", color:T.muted,
                      borderRadius:6, padding:"2px 8px", fontWeight:600 }}>{e.cc}</span>
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:13, fontFamily:"var(--mono)",
                    fontWeight:700, color:T.green, textAlign:"right", whiteSpace:"nowrap" }}>
                    {fmtMoney(e.importe, e.moneda)}
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {showNuevo   && <NuevoIngresoModal    onClose={() => setShowNuevo(false)}   onSave={handleSave} />}
      {showCobro   && <RegistrarCobroModal  ingreso={showCobro}   onClose={() => setShowCobro(null)}   onSave={() => {}} />}
      {showDetalle && <DetalleModal         ingreso={showDetalle} onClose={() => setShowDetalle(null)} />}
    </div>
  );
}
