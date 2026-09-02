// Modal "Registrar Cobro" (registrar un cobro sobre un ingreso). Extraído de PantallaIngresos para
// reusarlo también desde el reporte CxC por cliente (click en un comprobante → abre este mismo modal).
// onSave recibe { fecha, monto, medioCobro, ingresoId }; el guardado real (appendCobro) lo hace el llamador.
// `sociedadNombre` (opcional): si viene, el label "Acreditar en" nombra la sociedad del comprobante.
import { useState } from "react";
import { T, fmtMoney } from "../theme";
import { TIPO_CUENTA } from "../../data/tesoreriaData";

export default function RegistrarCobroModal({ ingreso, saldoPendiente, cuentas, anticipos = [], sociedadNombre = "", onVerComprobante, onClose, onSave }) {
  const [form, setForm] = useState({
    fecha:      new Date().toISOString().slice(0, 10),
    monto:      String(saldoPendiente ?? ingreso.importe ?? ""),
    medioCobro: "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const montoNum = Number(form.monto) || 0;
  const excede   = montoNum > (saldoPendiente ?? ingreso.importe ?? 0);
  const canSave  = form.fecha && form.monto && form.medioCobro && !excede;

  const mediosCobro = [
    ...cuentas
      .filter(c => c.moneda === ingreso.moneda)
      .map(c => ({ id: c.id, nombre: `${TIPO_CUENTA[c.tipo]?.icon ?? "💳"} ${c.nombre}` })),
    // Anticipos del cliente con saldo (cobrar contra anticipo → no toca caja, baja el pasivo)
    ...anticipos
      .filter(a => (a.moneda || "ARS") === ingreso.moneda)
      .map(a => ({ id: `ant:${a.id}`, nombre: `🎟 Anticipo · saldo ${fmtMoney(a.saldo, ingreso.moneda)}` })),
  ];

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
              {ingreso.cliente} · Total: {fmtMoney(ingreso.importe, ingreso.moneda)}
            </div>
            <div style={{ fontSize:11, color:"#86efac", marginTop:2, fontWeight:700 }}>
              Saldo pendiente: {fmtMoney(saldoPendiente ?? ingreso.importe, ingreso.moneda)}
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
                style={{ width:"100%", background:"#eceff3", border:`1px solid ${T.cardBorder}`,
                  borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
                  fontFamily:T.font, outline:"none", boxSizing:"border-box" }} />
            </div>
            <div>
              <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>Importe $</label>
              <input type="number" value={form.monto}
                min={0} max={saldoPendiente ?? ingreso.importe ?? undefined}
                onChange={e => set("monto", e.target.value)}
                style={{ width:"100%", background:"#eceff3",
                  border:`1.5px solid ${excede ? "#dc2626" : T.cardBorder}`,
                  borderRadius:8, padding:"8px 12px", fontSize:13, color: excede ? "#dc2626" : T.text,
                  fontFamily:T.font, outline:"none", boxSizing:"border-box" }} />
              {excede && <div style={{ fontSize:11, color:"#dc2626", marginTop:3, fontWeight:600 }}>
                Supera el saldo pendiente
              </div>}
            </div>
          </div>

          <div>
            <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:8 }}>
              Acreditar en{sociedadNombre ? ` — ${sociedadNombre}` : ""} <span style={{ color:T.red }}>*</span>
            </label>
            <div style={{ display:"flex", flexDirection:"column", gap:6,
              maxHeight:220, overflowY:"auto", paddingRight:4 }}>
              {mediosCobro.length === 0 && (
                <div style={{ fontSize:13, color:T.dim, padding:"8px 0", fontStyle:"italic" }}>
                  Sin cuentas registradas para esta sociedad
                </div>
              )}
              {mediosCobro.map(m => (
                <button key={m.id} onClick={() => set("medioCobro", m.id)} style={{
                  background: form.medioCobro === m.id ? "#eff6ff" : "#eceff3",
                  border:`1.5px solid ${form.medioCobro === m.id ? "#2563eb" : T.cardBorder}`,
                  borderRadius:8, padding:"9px 14px", cursor:"pointer",
                  display:"flex", alignItems:"center", gap:10, textAlign:"left",
                  fontFamily:T.font, transition:"all .1s", flexShrink:0,
                }}>
                  <span style={{ fontSize:13, fontWeight:600, color:T.text, flex:1 }}>{m.nombre}</span>
                  {form.medioCobro === m.id && <span style={{ color:"#2563eb", fontWeight:800 }}>✓</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Botones — "Ver comprobante" (izq, para asientos específicos: anticipos, retenciones, editar) */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, paddingTop:4 }}>
            {onVerComprobante ? (
              <button onClick={() => { onVerComprobante(); onClose(); }} style={{
                background:"transparent", border:"none", color:"#1e3a5f", fontSize:13, fontWeight:700,
                cursor:"pointer", fontFamily:T.font, padding:0 }}>Ver comprobante →</button>
            ) : <span />}
            <div style={{ display:"flex", gap:10 }}>
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
    </div>
  );
}
