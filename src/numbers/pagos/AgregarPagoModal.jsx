// Modal "Agregar Pago" (registrar un pago sobre un egreso). Extraído de PantallaEgresos para reusarlo
// también desde el reporte CxP por proveedor (click en un comprobante → abre este mismo modal).
// onSave recibe { fecha, monto, medioPago, nota, egresoId }; el guardado real (appendPago) lo hace el llamador.
import { useState } from "react";
import { T, fmtMoney } from "../theme";
import { TIPO_CUENTA } from "../../data/tesoreriaData";

export default function AgregarPagoModal({ egreso, saldoPendiente, cuentas, sociedadNombre = "", onVerComprobante, onClose, onSave }) {
  const [form, setForm] = useState({
    fecha:     new Date().toISOString().slice(0, 10),
    monto:     String(saldoPendiente ?? egreso.importe ?? ""),
    medioPago: "",
    nota:      "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const montoNum = Number(form.monto) || 0;
  const excede   = montoNum > (saldoPendiente ?? egreso.importe ?? 0);
  const canSave  = form.fecha && form.monto && form.medioPago && !excede;

  const mediosPago = cuentas
    .filter(c => c.moneda === egreso.moneda)
    .map(c => ({
      id:     c.id,
      nombre: `${TIPO_CUENTA[c.tipo]?.icon ?? "💳"} ${c.nombre}`,
    }));

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:10, width:440,
        maxWidth:"97vw", boxShadow:"0 20px 60px rgba(0,0,0,.3)", overflow:"hidden" }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ background:"#0e7490", padding:"14px 22px", display:"flex",
          justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:"#fff" }}>Nuevo Pago</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,.6)", marginTop:2 }}>
              {egreso.proveedor} · Total: {fmtMoney(egreso.importe, egreso.moneda)}
            </div>
            <div style={{ fontSize:11, color:"#a7f3d0", marginTop:2, fontWeight:700 }}>
              Saldo pendiente: {fmtMoney(saldoPendiente ?? egreso.importe, egreso.moneda)}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.6)", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>

        <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
          {/* Fecha + Monto */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <div>
              <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>Fecha</label>
              <input type="date" value={form.fecha} onChange={e=>set("fecha",e.target.value)}
                style={{ width:"100%", background:"#eceff3", border:`1px solid ${T.cardBorder}`,
                  borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
                  fontFamily:T.font, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div>
              <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>
                Importe $
              </label>
              <input type="number" value={form.monto}
                min={0} max={saldoPendiente ?? egreso.importe ?? undefined}
                onChange={e => set("monto", e.target.value)}
                style={{ width:"100%", background:"#eceff3",
                  border:`1.5px solid ${excede ? "#dc2626" : T.cardBorder}`,
                  borderRadius:8, padding:"8px 12px", fontSize:13,
                  color: excede ? "#dc2626" : T.text,
                  fontFamily:T.font, outline:"none", boxSizing:"border-box" }} />
              {excede && <div style={{ fontSize:11, color:"#dc2626", marginTop:3, fontWeight:600 }}>
                Supera el saldo pendiente
              </div>}
            </div>
          </div>

          {/* Medio de pago */}
          <div>
            <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>
              Elija Medio de Pago{sociedadNombre ? ` — ${sociedadNombre}` : ""} <span style={{ color:T.red }}>*</span>
            </label>
            <div style={{ display:"flex", flexDirection:"column", gap:6,
              maxHeight:220, overflowY:"auto", paddingRight:4 }}>
              {mediosPago.length === 0 && (
                <div style={{ fontSize:13, color:T.dim, padding:"8px 0", fontStyle:"italic" }}>
                  Sin cuentas registradas para esta sociedad
                </div>
              )}
              {mediosPago.map(m => (
                <button key={m.id} onClick={() => set("medioPago", m.id)} style={{
                  background: form.medioPago === m.id ? "#e0f2fe" : "#eceff3",
                  border:`1.5px solid ${form.medioPago === m.id ? "#0284c7" : T.cardBorder}`,
                  borderRadius:8, padding:"9px 14px", cursor:"pointer",
                  display:"flex", alignItems:"center", gap:10, textAlign:"left",
                  fontFamily:T.font, transition:"all .1s", flexShrink:0,
                }}>
                  <span style={{ fontSize:16 }}>🏦</span>
                  <span style={{ fontSize:13, fontWeight:600, color:T.text, flex:1 }}>{m.nombre}</span>
                  {form.medioPago === m.id && <span style={{ color:"#0284c7", fontWeight:800 }}>✓</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Nota (opcional) */}
          <div>
            <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>Nota</label>
            <textarea value={form.nota} onChange={e => set("nota", e.target.value)} rows={2}
              placeholder="Nota del pago (opcional)"
              style={{ width:"100%", background:"#eceff3", border:`1px solid ${T.cardBorder}`,
                borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
                fontFamily:T.font, outline:"none", boxSizing:"border-box", resize:"vertical" }} />
          </div>

          {/* Botones — "Ver comprobante" (izq, para asientos específicos: anticipos, retenciones, editar) */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, paddingTop:4 }}>
            {onVerComprobante ? (
              <button onClick={() => { onVerComprobante(); onClose(); }} style={{
                background:"transparent", border:"none", color:"#0e7490", fontSize:13, fontWeight:700,
                cursor:"pointer", fontFamily:T.font, padding:0 }}>Ver comprobante →</button>
            ) : <span />}
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={onClose} style={{
                background:"#dc2626", border:"none", borderRadius:8, padding:"9px 20px",
                fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer", fontFamily:T.font,
                display:"flex", alignItems:"center", gap:6 }}>Cancelar ✕</button>
              <button onClick={() => { onSave({ ...form, egresoId: egreso.id }); onClose(); }}
                disabled={!canSave} style={{
                  background: canSave ? "#16a34a" : "#9ca3af", border:"none", borderRadius:8,
                  padding:"9px 20px", fontSize:13, fontWeight:700, color:"#fff",
                  cursor: canSave ? "pointer" : "default", fontFamily:T.font,
                  display:"flex", alignItems:"center", gap:6 }}>Guardar ✓</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
