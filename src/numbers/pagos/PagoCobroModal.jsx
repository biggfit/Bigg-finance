// Modal único "Nuevo Pago" (Compras / CxP) y "Registrar Cobro" (Ventas / CxC). Eran dos copias que ya
// habían empezado a divergir; lo que cambia entre lados es DATO (textos, paleta, tolerancia al pagar de
// más, si hay nota, si se cobra contra anticipos) y sale de CFG. AgregarPagoModal / RegistrarCobroModal
// quedan como envoltorios de una línea, así ningún llamador cambia.
//
// onSave recibe { fecha, monto, medioPago, nota, egresoId } (pago) o { fecha, monto, medioCobro, ingresoId }
// (cobro); el guardado real (appendPago / appendCobro / cobrarContraAnticipo) lo hace el llamador.
import { useState } from "react";
import { T, fmtMoney, MoneyField } from "../theme";
import { TIPO_CUENTA } from "../../data/tesoreriaData";

const CFG = {
  pago: {
    titulo: "Nuevo Pago", headerBg: "#0e7490", tituloColor: "#fff", subColor: "rgba(255,255,255,.6)",
    saldoColor: "#a7f3d0", cerrarColor: "rgba(255,255,255,.6)", linkColor: "#0e7490",
    medioLabel: "Elija Medio de Pago", medioLabelMb: 5, selBg: "#e0f2fe", selBorder: "#0284c7", iconoBanco: true,
    conNota: true,
    tolerancia: 0,          // pagar de más: ni un centavo por encima del saldo
    idKey: "egresoId", medioKey: "medioPago", party: d => d.proveedor,
  },
  cobro: {
    titulo: "Registrar Cobro", headerBg: "#1e3a5f", tituloColor: "#93c5fd", subColor: "rgba(147,197,253,.55)",
    saldoColor: "#86efac", cerrarColor: "rgba(255,255,255,.5)", linkColor: "#1e3a5f",
    medioLabel: "Acreditar en", medioLabelMb: 8, selBg: "#eff6ff", selBorder: "#2563eb", iconoBanco: false,
    conNota: false,
    tolerancia: 0.005,      // cobrar de más: medio centavo de tolerancia por redondeos
    idKey: "ingresoId", medioKey: "medioCobro", party: d => d.cliente,
  },
};

const INP = { width:"100%", background:"#eceff3", border:`1px solid ${T.cardBorder}`, borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text, fontFamily:T.font, outline:"none", boxSizing:"border-box" };
const LBL = { fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 };

export default function PagoCobroModal({ modo, doc, saldoPendiente, cuentas, anticipos = [], sociedadNombre = "", onVerComprobante, onClose, onSave }) {
  const cfg = CFG[modo];
  const [form, setForm] = useState({
    fecha:          new Date().toISOString().slice(0, 10),
    monto:          String(saldoPendiente ?? doc.importe ?? ""),
    [cfg.medioKey]: "",
    ...(cfg.conNota ? { nota: "" } : {}),
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const medio    = form[cfg.medioKey];
  const saldoDoc = saldoPendiente ?? doc.importe ?? 0;
  // Anticipo seleccionado (si el medio es "ant:<id>") → su saldo topea el cobro además del saldo del doc.
  const antSel   = String(medio).startsWith("ant:") ? anticipos.find(a => `ant:${a.id}` === medio) : null;
  const tope     = antSel ? Math.min(saldoDoc, Number(antSel.saldo) || 0) : saldoDoc;
  const montoNum = Number(form.monto) || 0;
  const excede   = montoNum > tope + cfg.tolerancia;
  const canSave  = form.fecha && form.monto && medio && !excede;
  // Al elegir el medio, si es un anticipo con menos saldo que el monto actual, clampeo al saldo del anticipo.
  const pickMedio = (id) => setForm(f => {
    const a = String(id).startsWith("ant:") ? anticipos.find(x => `ant:${x.id}` === id) : null;
    const cap = a ? Math.min(saldoDoc, Number(a.saldo) || 0) : saldoDoc;
    const m = Number(f.monto) || 0;
    return { ...f, [cfg.medioKey]: id, monto: m > cap ? String(cap) : f.monto };
  });

  const medios = [
    ...cuentas
      .filter(c => c.moneda === doc.moneda)
      .map(c => ({ id: c.id, nombre: `${TIPO_CUENTA[c.tipo]?.icon ?? "💳"} ${c.nombre}` })),
    // Anticipos del cliente con saldo (cobrar contra anticipo → no toca caja, baja el pasivo)
    ...anticipos
      .filter(a => (a.moneda || "ARS") === doc.moneda)
      .map(a => ({ id: `ant:${a.id}`, nombre: `🎟 Anticipo · saldo ${fmtMoney(a.saldo, doc.moneda)}` })),
  ];

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:10, width:440,
        maxWidth:"97vw", boxShadow:"0 20px 60px rgba(0,0,0,.3)", overflow:"hidden" }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ background:cfg.headerBg, padding:"14px 22px", display:"flex",
          justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:cfg.tituloColor }}>{cfg.titulo}</div>
            <div style={{ fontSize:11, color:cfg.subColor, marginTop:2 }}>
              {cfg.party(doc)} · Total: {fmtMoney(doc.importe, doc.moneda)}
            </div>
            <div style={{ fontSize:11, color:cfg.saldoColor, marginTop:2, fontWeight:700 }}>
              Saldo pendiente: {fmtMoney(saldoPendiente ?? doc.importe, doc.moneda)}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:cfg.cerrarColor, fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>

        <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
          {/* Fecha + Monto */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <div>
              <label style={LBL}>Fecha</label>
              <input type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} style={INP} />
            </div>
            <div>
              <label style={LBL}>Importe $</label>
              <MoneyField value={form.monto}
                onChange={e => set("monto", e.target.value)}
                style={{ ...INP, border:`1.5px solid ${excede ? "#dc2626" : T.cardBorder}`, color: excede ? "#dc2626" : T.text }} />
              {excede && <div style={{ fontSize:11, color:"#dc2626", marginTop:3, fontWeight:600 }}>
                {antSel ? `Supera el saldo del anticipo (${fmtMoney(antSel.saldo, doc.moneda)})` : "Supera el saldo pendiente"}
              </div>}
            </div>
          </div>

          {/* Medio de pago / de cobro */}
          <div>
            <label style={{ ...LBL, marginBottom: cfg.medioLabelMb }}>
              {cfg.medioLabel}{sociedadNombre ? ` — ${sociedadNombre}` : ""} <span style={{ color:T.red }}>*</span>
            </label>
            <div style={{ display:"flex", flexDirection:"column", gap:6,
              maxHeight:220, overflowY:"auto", paddingRight:4 }}>
              {medios.length === 0 && (
                <div style={{ fontSize:13, color:T.dim, padding:"8px 0", fontStyle:"italic" }}>
                  Sin cuentas registradas para esta sociedad
                </div>
              )}
              {medios.map(m => (
                <button key={m.id} onClick={() => pickMedio(m.id)} style={{
                  background: medio === m.id ? cfg.selBg : "#eceff3",
                  border:`1.5px solid ${medio === m.id ? cfg.selBorder : T.cardBorder}`,
                  borderRadius:8, padding:"9px 14px", cursor:"pointer",
                  display:"flex", alignItems:"center", gap:10, textAlign:"left",
                  fontFamily:T.font, transition:"all .1s", flexShrink:0,
                }}>
                  {cfg.iconoBanco && <span style={{ fontSize:16 }}>🏦</span>}
                  <span style={{ fontSize:13, fontWeight:600, color:T.text, flex:1 }}>{m.nombre}</span>
                  {medio === m.id && <span style={{ color:cfg.selBorder, fontWeight:800 }}>✓</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Nota (opcional; solo pagos) */}
          {cfg.conNota && (
            <div>
              <label style={LBL}>Nota</label>
              <textarea value={form.nota} onChange={e => set("nota", e.target.value)} rows={2}
                placeholder="Nota del pago (opcional)"
                style={{ ...INP, resize:"vertical" }} />
            </div>
          )}

          {/* Botones — "Ver comprobante" (izq, para asientos específicos: anticipos, retenciones, editar) */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, paddingTop:4 }}>
            {onVerComprobante ? (
              <button onClick={() => { onVerComprobante(); onClose(); }} style={{
                background:"transparent", border:"none", color:cfg.linkColor, fontSize:13, fontWeight:700,
                cursor:"pointer", fontFamily:T.font, padding:0 }}>Ver comprobante →</button>
            ) : <span />}
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={onClose} style={{
                background:"#dc2626", border:"none", borderRadius:8, padding:"9px 20px",
                fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer", fontFamily:T.font,
                display:"flex", alignItems:"center", gap:6 }}>Cancelar ✕</button>
              <button onClick={() => { onSave({ ...form, [cfg.idKey]: doc.id }); onClose(); }}
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
