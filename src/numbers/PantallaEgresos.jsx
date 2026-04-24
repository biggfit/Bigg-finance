import { useState, useMemo, useEffect, useRef } from "react";
import { T, ESTADO_EGRESO, fmtMoney, fmtDate, Badge, CompactCard, PageHeader, Btn } from "./theme";
import { TIPO_CUENTA } from "../data/tesoreriaData";
import { fetchEgresos, appendEgreso, deleteEgreso, appendPago, fetchPagosCobros, calcSaldoPendiente, calcEstadoEgreso, fetchProveedores, fetchCentrosCosto, fetchCuentasBancarias, fetchCuentas, deleteMovTesoreria, updateMovTesoreria, shortId } from "../lib/numbersApi";
import { CENTROS_COSTO as CENTROS_COSTO_STATIC } from "../data/numbersData";
import { makeResolveCC, makeResolveCB, inputStyle, CCSelectOptions } from "./formUtils";
import NuevoEgresoModal from "./NuevoEgresoModal";
import FiltroFecha, { useFiltroFecha } from "./FiltroFecha";

function CCDisplay({ lineas, resolveCC }) {
  const ids = [...new Set((lineas ?? []).map(l => l.cc).filter(Boolean))];
  if (ids.length === 0) return <span style={{ color:T.dim, fontSize:11 }}>—</span>;
  const names = ids.map(id => resolveCC(id));
  if (ids.length === 1) return <span style={{ fontSize:11, background:"#f3f4f6", color:T.muted, borderRadius:6, padding:"2px 8px", fontWeight:600 }}>{names[0]}</span>;
  return <span title={names.join("\n")} style={{ fontSize:11, background:"#f3f4f6", color:T.muted, borderRadius:6, padding:"2px 8px", fontWeight:600, cursor:"help" }}>Múltiple ({ids.length})</span>;
}

// ─── Modal: Agregar Pago ──────────────────────────────────────────────────────
function AgregarPagoModal({ egreso, saldoPendiente, cuentas, onClose, onSave }) {
  const [form, setForm] = useState({
    fecha:     new Date().toISOString().slice(0, 10),
    monto:     String(saldoPendiente ?? egreso.importe ?? ""),
    medioPago: "",
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
                style={{ width:"100%", background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
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
                style={{ width:"100%", background:"#f9fafb",
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
              Elija Medio de Pago <span style={{ color:T.red }}>*</span>
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
                  background: form.medioPago === m.id ? "#e0f2fe" : "#f9fafb",
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

          {/* Botones */}
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, paddingTop:4 }}>
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
  );
}

// ─── Modal: Editar Pago ───────────────────────────────────────────────────────
function EditarPagoModal({ pago, sociedad, cuentasSoc, onClose, onSaved }) {
  const [form, setForm] = useState({
    fecha:          pago.fecha ?? new Date().toISOString().slice(0, 10),
    monto:          String(Math.abs(Number(pago.monto) || 0)),
    cuenta_bancaria: pago.cuenta_bancaria ?? "",
    nota:           pago.nota ?? "",
  });
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const canSave = form.fecha && form.monto && Number(form.monto) > 0;

  const handleGuardar = async () => {
    setSaving(true);
    try {
      const monto = Number(form.monto);
      await updateMovTesoreria(pago.id, { fecha: form.fecha, monto: -monto, cuenta_bancaria: form.cuenta_bancaria, nota: form.nota });
      onSaved();
    } catch (e) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const handleBorrar = async () => {
    if (!window.confirm("¿Eliminar este pago? Esta acción no se puede deshacer.")) return;
    setDeleting(true);
    try {
      await deleteMovTesoreria(pago.id);
      onSaved();
    } catch (e) { alert("Error al eliminar: " + e.message); }
    finally { setDeleting(false); }
  };

  const cuentasOpts = cuentasSoc
    .filter(c => c.moneda === pago.moneda)
    .map(c => ({ value: c.id, label: `${TIPO_CUENTA[(c.tipo ?? "").toLowerCase()]?.icon ?? "💳"} ${c.nombre}` }));

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.55)", zIndex:600,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:10, width:440, maxWidth:"97vw",
        boxShadow:"0 20px 60px rgba(0,0,0,.35)", overflow:"hidden" }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ background:"#0e7490", padding:"13px 20px",
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:15, fontWeight:800, color:"#fff" }}>Editar Pago</span>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.7)", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding:"20px 22px", display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase",
                letterSpacing:".07em", display:"block", marginBottom:4 }}>Fecha</label>
              <input type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)}
                style={{ width:"100%", padding:"8px 10px", fontSize:13, borderRadius:8, boxSizing:"border-box",
                  border:`1px solid ${T.cardBorder}`, background:"#f9fafb", color:T.text, fontFamily:"inherit" }} />
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase",
                letterSpacing:".07em", display:"block", marginBottom:4 }}>Monto</label>
              <input type="number" value={form.monto} onChange={e => set("monto", e.target.value)}
                style={{ width:"100%", padding:"8px 10px", fontSize:13, borderRadius:8, boxSizing:"border-box",
                  border:`1px solid ${T.cardBorder}`, background:"#f9fafb", color:T.text, fontFamily:"inherit" }} />
            </div>
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase",
              letterSpacing:".07em", display:"block", marginBottom:4 }}>Medio de pago</label>
            <select value={form.cuenta_bancaria} onChange={e => set("cuenta_bancaria", e.target.value)}
              style={{ width:"100%", padding:"8px 10px", fontSize:13, borderRadius:8,
                border:`1px solid ${T.cardBorder}`, background:"#f9fafb", color:T.text, fontFamily:"inherit" }}>
              <option value="">— Seleccionar —</option>
              {cuentasOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase",
              letterSpacing:".07em", display:"block", marginBottom:4 }}>Nota</label>
            <textarea value={form.nota} onChange={e => set("nota", e.target.value)} rows={3}
              style={{ width:"100%", padding:"8px 10px", fontSize:13, borderRadius:8, boxSizing:"border-box",
                border:`1px solid ${T.cardBorder}`, background:"#f9fafb", color:T.text,
                fontFamily:"inherit", resize:"vertical" }} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding:"12px 22px 18px", display:"flex", gap:8 }}>
          <button onClick={handleBorrar} disabled={deleting}
            style={{ padding:"9px 16px", borderRadius:8, border:"none", cursor:"pointer",
              background:"#dc2626", color:"#fff", fontWeight:700, fontSize:13, fontFamily:"inherit",
              display:"flex", alignItems:"center", gap:6 }}>
            🗑 {deleting ? "Eliminando…" : "Borrar"}
          </button>
          <div style={{ flex:1 }} />
          <button onClick={onClose}
            style={{ padding:"9px 18px", borderRadius:8, border:`1px solid ${T.cardBorder}`,
              cursor:"pointer", background:"#f3f4f6", color:T.muted, fontWeight:700,
              fontSize:13, fontFamily:"inherit" }}>Cancelar</button>
          <button onClick={handleGuardar} disabled={!canSave || saving}
            style={{ padding:"9px 18px", borderRadius:8, border:"none",
              cursor: canSave ? "pointer" : "default", fontWeight:700, fontSize:13,
              fontFamily:"inherit", background: canSave ? "#16a34a" : "#9ca3af", color:"#fff",
              display:"flex", alignItems:"center", gap:6 }}>
            💾 {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Ver Detalle (estilo Contagram) ───────────────────────────────────
function DetalleModal({ egreso, cuentasBancarias = [], centrosCosto = [], onClose, onAgregarPago, onEditar, onEditarPago, asPage = false }) {
  const resolveCB = makeResolveCB(cuentasBancarias);
  const resolveCC = makeResolveCC(centrosCosto);
  const pagado  = egreso.pagosVinculados?.reduce((s,p) => s + (Number(p.monto)||0), 0) ?? 0;
  const aPagar  = egreso.importe - pagado;
  const lineas  = egreso.lineas ?? [];

  const netoNoGravado = lineas.filter(l => !Number(l.ivaRate))
    .reduce((s,l) => s + (Number(l.subtotal)||0), 0);
  const netoGravado = lineas.filter(l => Number(l.ivaRate) > 0)
    .reduce((s,l) => s + (Number(l.subtotal)||0), 0);
  const ivaGroups = [...new Set(lineas.map(l => Number(l.ivaRate)).filter(r => r > 0))].sort((a,b)=>a-b);

  const estadoCfg = ESTADO_EGRESO[egreso.estado] ?? { label: egreso.estado, color: T.muted };
  const estadoBg  = estadoCfg.bg ?? "#f3f4f6";

  const infoRow = (label, value, valueColor) => (
    <div style={{ display:"flex", gap:8 }}>
      <span style={{ fontSize:12, color:T.muted, minWidth:120, flexShrink:0 }}>{label}:</span>
      <span style={{ fontSize:12, fontWeight:600, color: valueColor ?? T.text }}>{value || "—"}</span>
    </div>
  );

  return (
    <div
      style={asPage
        ? { padding:"28px 32px", maxWidth:920 }
        : { position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:500,
            display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={asPage ? undefined : onClose}>
      <div
        className="fade"
        style={asPage
          ? { background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:T.shadowMd }
          : { background:"#fff", borderRadius:12, width:860, maxWidth:"98vw", maxHeight:"92vh",
              display:"flex", flexDirection:"column", boxShadow:"0 24px 64px rgba(0,0,0,.3)", overflow:"hidden" }}
        onClick={asPage ? undefined : e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div style={{ background:T.accentDark, padding:"13px 22px",
          ...(asPage ? {} : { flexShrink:0 }),
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:900, color:T.accent }}>Egreso</div>
            <div style={{ fontSize:11, color:"rgba(173,255,25,.4)", marginTop:1,
              fontFamily:"var(--mono)" }}>{egreso.id}</div>
          </div>
          {asPage
            ? <button onClick={onClose} style={{ background:"transparent", border:"none",
                color:"rgba(255,255,255,.7)", fontSize:13, fontWeight:700, cursor:"pointer",
                fontFamily:T.font }}>← Volver</button>
            : <button onClick={onClose} style={{ background:"transparent", border:"none",
                color:"rgba(255,255,255,.4)", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
          }
        </div>

        <div style={asPage ? {} : { flex:1, overflowY:"auto" }}>

          {/* ── Barra de totales ── */}
          <div style={{ display:"flex", alignItems:"stretch", borderBottom:`1px solid ${T.cardBorder}`,
            background:"#f8f9fa" }}>
            {[
              { label:"Total Compra", value: fmtMoney(egreso.importe, egreso.moneda), color:"#1a1a1a", bold:true },
              { label:"Pagado",       value: fmtMoney(pagado,         egreso.moneda), color: T.green,  bold:true },
              { label: aPagar < -0.005 ? "⚠ Sobrepago" : "A Pagar",
                value: fmtMoney(Math.abs(aPagar), egreso.moneda),
                color: aPagar < -0.005 ? T.orange : aPagar > 0.005 ? T.red : T.green,
                bold: true },
            ].map((item, i, arr) => (
              <div key={item.label} style={{ flex:1, padding:"14px 20px",
                borderRight: i < arr.length-1 ? `1px solid ${T.cardBorder}` : "none",
                display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                <span style={{ fontSize:11, color:T.muted, fontWeight:600,
                  textTransform:"uppercase", letterSpacing:".06em" }}>{item.label}</span>
                <span style={{ fontSize:17, fontWeight:800, color:item.color,
                  fontFamily:"var(--mono)" }}>{item.value}</span>
              </div>
            ))}
          </div>

          {/* ── PAGOS (primero, header rojo Contagram) ── */}
          <div style={{ padding:"18px 24px 0" }}>
            <div style={{ background:"#c0392b", padding:"10px 16px", marginBottom:0,
              borderRadius:"7px 7px 0 0" }}>
              <span style={{ fontSize:13, fontWeight:800, color:"#fff", letterSpacing:".06em",
                textTransform:"uppercase" }}>Pagos</span>
            </div>
            <div style={{ border:`1px solid #c0392b`, borderTop:"none", borderRadius:"0 0 7px 7px", overflow:"hidden" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${T.cardBorder}`, background:"#fafafa" }}>
                    {["ID","Fecha","Medio de Pago","Monto",""].map(h => (
                      <th key={h} style={{ padding:"8px 14px", fontSize:11, fontWeight:700,
                        color:T.muted, textAlign:h==="Monto"?"right":"left",
                        letterSpacing:".06em", textTransform:"uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(egreso.pagosVinculados?.length ?? 0) === 0
                    ? <tr><td colSpan={5} style={{ padding:"12px 14px", fontSize:13,
                        color:T.dim, fontStyle:"italic" }}>Sin pagos registrados</td></tr>
                    : egreso.pagosVinculados.map((p, pi) => (
                      <tr key={p.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                        background: pi%2===0 ? "#f2f3f5" : "#e9eaec" }}>
                        <td style={{ padding:"8px 14px", fontSize:11, color:"#666",
                          fontFamily:"var(--mono)" }}>{p.id}</td>
                        <td style={{ padding:"8px 14px", fontSize:13, color:"#1a1a1a" }}>{fmtDate(p.fecha)}</td>
                        <td style={{ padding:"8px 14px", fontSize:13, color:"#333" }}>{resolveCB(p.cuenta_bancaria)}</td>
                        <td style={{ padding:"8px 14px", fontSize:13, fontFamily:"var(--mono)",
                          fontWeight:700, color:T.green, textAlign:"right" }}>
                          {fmtMoney(Number(p.monto), egreso.moneda)}
                        </td>
                        <td style={{ padding:"8px 8px", textAlign:"center" }}>
                          <button onClick={() => onEditarPago?.(p)} title="Editar pago"
                            style={{ background:"transparent", border:`1px solid ${T.cardBorder}`,
                              borderRadius:6, padding:"3px 7px", cursor:"pointer",
                              fontSize:12, color:T.muted, lineHeight:1 }}>✎</button>
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
              <div style={{ padding:"10px 14px", borderTop:`1px solid ${T.cardBorder}` }}>
                <button onClick={() => { if (!asPage) onClose?.(); onAgregarPago(egreso); }} style={{
                  background:"transparent", border:`1.5px dashed ${T.cardBorder}`,
                  borderRadius:7, padding:"6px 16px", fontSize:12, color:"#0e7490",
                  cursor:"pointer", fontFamily:T.font, fontWeight:700,
                  display:"flex", alignItems:"center", gap:6 }}>+ Agregar Pago</button>
              </div>
            </div>
          </div>

          {/* ── Info de la factura ── */}
          <div style={{ padding:"16px 24px 14px", display:"grid", gridTemplateColumns:"1fr 1fr",
            gap:"6px 24px", borderBottom:`1px solid ${T.cardBorder}`,
            borderTop:`1px solid ${T.cardBorder}`, background:"#fafafa", marginTop:16 }}>
            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
              {infoRow("Proveedor", egreso.proveedor)}
              {infoRow("CUIT",      egreso.cuit)}
              {infoRow("Moneda",    egreso.moneda)}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
              {infoRow("N° Comprobante", egreso.nroComp)}
              {infoRow("Fecha emisión",  fmtDate(egreso.fecha))}
              {infoRow("Vencimiento",    fmtDate(egreso.vto), egreso.estado === "vencido" ? T.red : undefined)}
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <span style={{ fontSize:12, color:T.muted, minWidth:120, flexShrink:0 }}>Estado:</span>
                <span style={{ display:"inline-block", padding:"2px 9px", borderRadius:12,
                  fontSize:11, fontWeight:700, background:estadoBg, color:estadoCfg.color ?? T.muted }}>
                  {estadoCfg.label ?? egreso.estado}
                </span>
              </div>
            </div>
          </div>

          {/* ── CONCEPTOS ── */}
          <div style={{ padding:"18px 24px 22px" }}>
            <div style={{ fontSize:12, fontWeight:800, color:"#444", letterSpacing:".08em",
              textTransform:"uppercase", marginBottom:8 }}>Conceptos</div>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:"#606060" }}>
                  {["Centro de Costo","Subtotal","Alicuota IVA","Subtotal c/IVA"].map((h,i) => (
                    <th key={h} style={{ padding:"10px 14px", fontSize:12, fontWeight:600,
                      color:"#fff", textAlign:i===0?"left":"right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lineas.length === 0
                  ? <tr><td colSpan={4} style={{ padding:14, fontSize:13, color:T.dim,
                      fontStyle:"italic" }}>Sin líneas registradas</td></tr>
                  : lineas.map((l, i) => (
                    <tr key={i} style={{ background:i%2===0?"#f2f3f5":"#e9eaec",
                      borderBottom:"1px solid #d4d5d8" }}>
                      <td style={{ padding:"9px 14px", fontSize:13, color:"#1a1a1a" }}>{resolveCC(l.cc)}</td>
                      <td style={{ padding:"9px 14px", fontSize:13, textAlign:"right",
                        fontFamily:"var(--mono)", color:"#1a1a1a" }}>{fmtMoney(Number(l.subtotal)||0, egreso.moneda)}</td>
                      <td style={{ padding:"9px 14px", fontSize:13, textAlign:"right",
                        color:"#444" }}>{Number(l.ivaRate)||0}%</td>
                      <td style={{ padding:"9px 14px", fontSize:13, textAlign:"right",
                        fontFamily:"var(--mono)", fontWeight:700, color:"#111" }}>
                        {fmtMoney(Number(l.total_linea)||0, egreso.moneda)}
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>

            {/* Box de totales */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", gap:16 }}>
              {/* Nota interna */}
              <div style={{ flex:1, padding:"10px 4px 4px" }}>
                {egreso.nota && (
                  <>
                    <div style={{ fontSize:11, color:"#888", fontWeight:700, textTransform:"uppercase",
                      letterSpacing:".06em", marginBottom:4 }}>Nota interna</div>
                    <div style={{ fontSize:13, color:"#444", lineHeight:1.5 }}>{egreso.nota}</div>
                  </>
                )}
              </div>
              <div style={{ background:"#606060", color:"#fff", minWidth:360,
                padding:"12px 18px", display:"flex", flexDirection:"column", gap:5 }}>
                {netoNoGravado > 0 && (
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:13 }}>
                    <span>Importe Neto No Gravado</span>
                    <span style={{ fontFamily:"var(--mono)" }}>{fmtMoney(netoNoGravado, egreso.moneda)}</span>
                  </div>
                )}
                {netoGravado > 0 && (
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:13 }}>
                    <span>Importe Neto Gravado</span>
                    <span style={{ fontFamily:"var(--mono)" }}>{fmtMoney(netoGravado, egreso.moneda)}</span>
                  </div>
                )}
                {ivaGroups.map(rate => {
                  const amt = lineas.filter(l => Number(l.ivaRate) === rate)
                    .reduce((s,l) => s + ((Number(l.total_linea)||0)-(Number(l.subtotal)||0)), 0);
                  return (
                    <div key={rate} style={{ display:"flex", justifyContent:"space-between", fontSize:13 }}>
                      <span>IVA {rate}%</span>
                      <span style={{ fontFamily:"var(--mono)" }}>{fmtMoney(amt, egreso.moneda)}</span>
                    </div>
                  );
                })}
                <div style={{ height:1, background:"rgba(255,255,255,.25)", margin:"3px 0" }} />
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, fontWeight:700 }}>
                  <span>Total Compra</span>
                  <span style={{ fontFamily:"var(--mono)" }}>{fmtMoney(egreso.importe, egreso.moneda)}</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, fontWeight:700 }}>
                  <span>Total Pagado</span>
                  <span style={{ fontFamily:"var(--mono)" }}>{fmtMoney(pagado, egreso.moneda)}</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:14, fontWeight:800,
                  color: aPagar < 0 ? "#fca5a5" : aPagar === 0 ? "#86efac" : "#fde68a" }}>
                  <span>{aPagar < 0 ? "⚠ Sobrepago" : "Total a Pagar"}</span>
                  <span style={{ fontFamily:"var(--mono)" }}>
                    {aPagar < 0 ? "−" : ""}{fmtMoney(Math.abs(aPagar), egreso.moneda)}
                  </span>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* ── Footer ── */}
        <div style={{ padding:"12px 22px", borderTop:`1px solid ${T.cardBorder}`,
          background:"#fff", display:"flex", justifyContent:"flex-end", gap:10,
          ...(asPage ? {} : { flexShrink:0 }) }}>
          {!asPage && <Btn variant="ghost" onClick={onClose}>Cerrar</Btn>}
          <Btn variant="primary" onClick={() => { onClose(); onEditar(egreso); }}>Editar</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Cuenta Corriente Proveedor ───────────────────────────────────────
function CtaCteModal({ proveedor, documentos, onClose }) {
  const totalFacturado = documentos.reduce((s, d) => s + d.importe, 0);
  const totalPagado    = documentos.reduce((s, d) => s + (d.importe - (d.saldoPendiente ?? d.importe)), 0);
  const totalPendiente = documentos.reduce((s, d) => s + (d.saldoPendiente ?? 0), 0);

  // Group by moneda
  const monedas = [...new Set(documentos.map(d => d.moneda))].filter(Boolean);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:"#f8f9fa", borderRadius:12, width:820,
        maxWidth:"98vw", maxHeight:"90vh", display:"flex", flexDirection:"column",
        boxShadow:"0 24px 64px rgba(0,0,0,.3)", overflow:"hidden" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ background:T.accentDark, padding:"14px 22px", flexShrink:0,
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:900, color:T.accent }}>
              Estado de Cuenta — {proveedor}
            </div>
            <div style={{ fontSize:11, color:"rgba(173,255,25,.45)", marginTop:2 }}>
              {documentos.length} comprobante{documentos.length !== 1 ? "s" : ""}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.4)", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>

        {/* Resumen */}
        <div style={{ background:"#fff", borderBottom:`1px solid ${T.cardBorder}`,
          display:"flex", flexShrink:0 }}>
          {[
            { label:"Total Facturado", value: fmtMoney(totalFacturado), color:T.text },
            { label:"Total Pagado",    value: fmtMoney(totalPagado),    color:T.green },
            { label:"Saldo Pendiente", value: fmtMoney(totalPendiente), color: totalPendiente>0 ? T.red : T.green },
          ].map((item, i) => (
            <div key={item.label} style={{ flex:1, padding:"14px 20px",
              borderRight: i<2 ? `1px solid ${T.cardBorder}` : "none" }}>
              <div style={{ fontSize:10, color:T.muted, fontWeight:700,
                textTransform:"uppercase", letterSpacing:".07em", marginBottom:4 }}>{item.label}</div>
              <div style={{ fontSize:18, fontWeight:900, color:item.color,
                fontFamily:"var(--mono)" }}>{item.value}</div>
            </div>
          ))}
        </div>

        {/* Tabla de comprobantes */}
        <div style={{ flex:1, overflowY:"auto", padding:20 }}>
          <div style={{ background:"#fff", border:`1px solid ${T.cardBorder}`,
            borderRadius:8, overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:T.tableHead }}>
                  {["Fecha","Vencimiento","N° Comp.","Cuenta","Importe","Pagado","Pendiente","Estado"].map(h => (
                    <th key={h} style={{ padding:"9px 14px", fontSize:11, fontWeight:700,
                      color:T.tableHeadText, textAlign: ["Importe","Pagado","Pendiente"].includes(h) ? "right" : "left",
                      letterSpacing:".07em", textTransform:"uppercase", whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {documentos.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding:24, textAlign:"center", color:T.dim, fontSize:13 }}>
                    Sin comprobantes
                  </td></tr>
                ) : documentos.map((d, i) => {
                  const pagado    = d.importe - (d.saldoPendiente ?? d.importe);
                  const pendiente = d.saldoPendiente ?? 0;
                  const estadoCfg = ESTADO_EGRESO[d.estado] ?? { label: d.estado, color: T.muted };
                  return (
                    <tr key={d.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                      background: i%2===0 ? "#fff" : "#fafbfc" }}>
                      <td style={{ padding:"9px 14px", fontSize:13 }}>{fmtDate(d.fecha)}</td>
                      <td style={{ padding:"9px 14px", fontSize:13,
                        color: d.estado==="vencido" ? T.red : T.text }}>{fmtDate(d.vto)}</td>
                      <td style={{ padding:"9px 14px", fontSize:11, color:T.dim,
                        fontFamily:"var(--mono)" }}>{d.nroComp || "—"}</td>
                      <td style={{ padding:"9px 14px", fontSize:12, color:T.muted }}>{d.cuenta}</td>
                      <td style={{ padding:"9px 14px", fontSize:13, fontFamily:"var(--mono)",
                        fontWeight:700, textAlign:"right" }}>{fmtMoney(d.importe, d.moneda)}</td>
                      <td style={{ padding:"9px 14px", fontSize:13, fontFamily:"var(--mono)",
                        fontWeight:700, color:T.green, textAlign:"right" }}>{fmtMoney(pagado, d.moneda)}</td>
                      <td style={{ padding:"9px 14px", fontSize:13, fontFamily:"var(--mono)",
                        fontWeight:700, color: pendiente>0 ? T.orange : T.green, textAlign:"right" }}>
                        {fmtMoney(pendiente, d.moneda)}
                      </td>
                      <td style={{ padding:"9px 14px" }}>
                        <Badge estado={d.estado} cfg={ESTADO_EGRESO} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ padding:"12px 22px", borderTop:`1px solid ${T.cardBorder}`,
          background:"#fff", display:"flex", justifyContent:"flex-end", flexShrink:0 }}>
          <Btn variant="ghost" onClick={onClose}>Cerrar</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Dropdown de acciones por fila ────────────────────────────────────────────
function RowMenu({ egreso, onPago, onDetalle, onEditar, onCtaCte, onEliminar }) {
  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState({ top:0, left:0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const handler = e => {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          btnRef.current  && !btnRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
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
    <>
      <button ref={btnRef} onClick={handleToggle} style={{
        background: open ? "#e5e7eb" : "#f3f4f6",
        border:`1px solid ${T.cardBorder}`, borderRadius:6,
        padding:"3px 8px", cursor:"pointer", fontSize:12, color:T.muted,
        fontFamily:T.font, lineHeight:1,
      }}>▾</button>

      {open && (
        <div ref={menuRef} style={{
          position:"fixed", top:pos.top, left:pos.left, zIndex:9999,
          background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:8,
          boxShadow:"0 8px 24px rgba(0,0,0,.15)", minWidth:170, overflow:"hidden",
        }}>
          {item("Ver Detalle",   onDetalle)}
          {item("Editar",        onEditar)}
          {divider}
          {item("Agregar Pago",  onPago, "#0e7490")}
          {item("Cta. Cte.",     onCtaCte)}
          {divider}
          {item("Eliminar",      onEliminar, T.red)}
        </div>
      )}
    </>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function PantallaEgresos({ sociedad = "nako", subView = null, onSubViewChange }) {
  const [busqueda, setBusqueda]         = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const filtroFecha = useFiltroFecha();
  const [egresos, setEgresos]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [showPago, setShowPago]             = useState(null);
  const [showDetalle, setShowDetalle]       = useState(null);
  const [showEditar, setShowEditar]         = useState(null);
  const [editingPago, setEditingPago]       = useState(null);
  const [showCtaCte, setShowCtaCte]         = useState(null); // { proveedor, docs }
  const [proveedores, setProveedores]       = useState([]);
  const [centrosCosto, setCentrosCosto]     = useState(CENTROS_COSTO_STATIC);
  const [cuentasBancarias, setCuentasBancarias] = useState([]);
  const [cuentas, setCuentas]               = useState([]);

  // Cuentas bancarias de la sociedad activa (para medios de pago)
  const cuentasSoc = useMemo(
    () => {
      const soc = (sociedad ?? "").toLowerCase();
      return cuentasBancarias.filter(c => (c.sociedad ?? "").toLowerCase() === soc);
    },
    [sociedad, cuentasBancarias]
  );

  // ── Fetch desde Google Sheets ──
  const cargarEgresos = async () => {
    setLoading(true);
    setError(null);
    try {
      const [docs, pagos] = await Promise.all([fetchEgresos(sociedad), fetchPagosCobros(sociedad)]);
      // Enriquecer cada documento con saldo y estado derivado
      const pagosDocs = pagos.filter(p => p.tipo === "PAGO" || p.tipo === "EGRESO_GASTO");
      const enriched  = docs.map(doc => {
        const docPagos = pagosDocs.filter(p => p.documento_id === doc.id);
        const saldo    = calcSaldoPendiente(doc.total, docPagos);
        return { ...doc, importe: Number(doc.total) || 0, saldoPendiente: saldo,
                 pagosVinculados: docPagos, estado: calcEstadoEgreso(saldo, doc.total, doc.vto) };
      });
      setEgresos(enriched);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarEgresos();
    fetchProveedores().then(data => setProveedores(Array.isArray(data) ? data : [])).catch(()=>{});
    fetchCentrosCosto().then(data => { if (Array.isArray(data) && data.length > 0) setCentrosCosto(data); }).catch(()=>{});
    fetchCuentasBancarias().then(data => setCuentasBancarias(Array.isArray(data) ? data : [])).catch(()=>{});
    fetchCuentas().then(data => {
      if (Array.isArray(data) && data.length > 0) setCuentas(data);
    }).catch(()=>{});
  }, [sociedad]);

  const resolveCC = useMemo(() => makeResolveCC(centrosCosto), [centrosCosto]);
  const resolveCB = useMemo(() => makeResolveCB(cuentasBancarias), [cuentasBancarias]);

  const rows = useMemo(() => egresos.filter(e => {
    const matchEstado = filtroEstado === "todos" || e.estado === filtroEstado;
    const q = busqueda.toLowerCase();
    const matchQ = !q || (e.proveedor ?? "").toLowerCase().includes(q) || (e.cuenta ?? "").toLowerCase().includes(q) || (e.cc ?? "").toLowerCase().includes(q);
    return matchEstado && matchQ && filtroFecha.inRange(e.fecha);
  }), [busqueda, filtroEstado, egresos, filtroFecha.inRange]);

  const totalesPorMoneda = useMemo(() => {
    const enPeriodo = egresos.filter(e => filtroFecha.inRange(e.fecha));
    const monedas = [...new Set(enPeriodo.map(e => e.moneda))].filter(Boolean).sort();
    return monedas.map(moneda => {
      const docs = enPeriodo.filter(e => e.moneda === moneda);
      return {
        moneda,
        cantidad: docs.length,
        total:   docs.reduce((s,e) => s + (e.importe ?? 0), 0),
        pagado:  docs.reduce((s,e) => s + (e.pagosVinculados?.reduce((ps,p) => ps + (Number(p.monto)||0), 0) ?? 0), 0),
        aPagar:  docs.filter(e => e.estado === "a_pagar").reduce((s,e) => s + (e.saldoPendiente ?? e.importe), 0),
        vencido: docs.filter(e => e.estado === "vencido").reduce((s,e) => s + (e.saldoPendiente ?? e.importe), 0),
      };
    });
  }, [egresos, filtroFecha.inRange]);

  // Cuando egresos se recarga, sincronizar showDetalle con datos frescos
  useEffect(() => {
    if (!showDetalle) return;
    const updated = egresos.find(e => e.id === showDetalle.id);
    if (updated) setShowDetalle(updated);
  }, [egresos]); // eslint-disable-line

  const handleSave = async (egreso) => {
    try {
      if (egreso._isEdit) {
        await deleteEgreso(egreso.id);
      }
      const result = await appendEgreso({ ...egreso, sociedad });
      // Volver a la lista y abrir el detalle como página
      if (subView === "new-compra" && onSubViewChange) {
        onSubViewChange(null);
        const nuevoEgreso = {
          ...egreso,
          id:             result?.id_comp,
          importe:        egreso.importe ?? 0,
          saldoPendiente: egreso.importe ?? 0,
          pagosVinculados: [],
          estado:         "a_pagar",
        };
        setShowDetalle(nuevoEgreso);
        // "Guardar y Pagar": abrir modal de pago sobre el detalle
        if (egreso._saveAndPay) {
          setShowPago(nuevoEgreso);
        }
      }
      await cargarEgresos();
    } catch (e) {
      alert("Error al guardar: " + e.message);
    }
  };

  const handleEliminar = async (id_comp) => {
    if (!confirm("¿Eliminar este egreso? Se eliminarán también los pagos asociados.")) return;
    try {
      const egreso = egresos.find(e => e.id === id_comp);
      if (egreso?.pagosVinculados?.length > 0) {
        await Promise.all(egreso.pagosVinculados.map(p => deleteMovTesoreria(p.id)));
      }
      await deleteEgreso(id_comp);
      setEgresos(prev => prev.filter(e => e.id !== id_comp));
    } catch (e) {
      alert("Error al eliminar: " + e.message);
    }
  };

  const handlePago = async (data) => {
    const egreso = egresos.find(e => e.id === data.egresoId);
    const ccHeredado = egreso?.lineas?.find(l => l.cc)?.cc ?? "";
    try {
      await appendPago({
        documento_id:    data.egresoId,
        sociedad,
        fecha:           data.fecha,
        monto:           Number(data.monto),
        moneda:          egreso?.moneda ?? "ARS",
        cuenta_bancaria: data.medioPago,
        cuenta:          egreso?.cuenta ?? "",
        referencia:      data.referencia ?? "",
        nota:            data.nota ?? "",
        centro_costo:    ccHeredado,
      });
      // Recargar con pagos para recalcular estado
      await cargarEgresos();
    } catch (e) {
      alert("Error al registrar pago: " + e.message);
    }
  };

  // ── Páginas de alta: no esperan el loading de la lista ───────────────────────
  // ── Detalle como página ──────────────────────────────────────────────────────
  if (showDetalle) {
    return (
      <>
        <DetalleModal
          asPage
          egreso={showDetalle}
          cuentasBancarias={cuentasBancarias}
          centrosCosto={centrosCosto}
          onClose={() => setShowDetalle(null)}
          onAgregarPago={e => setShowPago(e)}
          onEditar={e => { setShowDetalle(null); setShowEditar(e); }}
          onEditarPago={p => setEditingPago(p)}
        />
        {showPago    && <AgregarPagoModal egreso={showPago} saldoPendiente={showPago.saldoPendiente ?? showPago.importe} cuentas={cuentasSoc} onClose={() => setShowPago(null)} onSave={handlePago} />}
        {editingPago && <EditarPagoModal  pago={editingPago} sociedad={sociedad} cuentasSoc={cuentasSoc} onClose={() => setEditingPago(null)} onSaved={() => { setEditingPago(null); cargarEgresos(); }} />}
      </>
    );
  }

  if (subView === "new-compra") {
    return (
      <NuevoEgresoModal
        asPage
        sociedad={sociedad}
        proveedores={proveedores}
        cuentas={cuentas}
        centrosCosto={centrosCosto}
        onClose={() => onSubViewChange?.(null)}
        onSave={handleSave}
      />
    );
  }

  if (loading) return (
    <div style={{ padding:"60px 32px", textAlign:"center", color:T.muted, fontSize:14 }}>
      Cargando egresos…
    </div>
  );

  if (error) return (
    <div style={{ padding:"40px 32px" }}>
      <div style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:8,
        padding:"16px 20px", color:"#dc2626", fontSize:13 }}>
        <strong>Error al conectar con Google Sheets:</strong> {error}
        <br /><span style={{ fontSize:11, opacity:.7 }}>Verificá que VITE_NUMBERS_API_URL esté configurada en .env.local</span>
      </div>
    </div>
  );

  return (
    <div style={{ padding:"28px 32px", maxWidth:1200 }} className="fade">
      <PageHeader
        title="Compras"
        subtitle="Facturas recibidas de proveedores"
        action={<Btn variant="accent" onClick={() => onSubViewChange?.("new-compra")}>+ Nueva Compra</Btn>}
      />

      {/* Summary por moneda */}
      <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:24 }}>
        {totalesPorMoneda.map(t => (
          <div key={t.moneda} style={{ display:"flex", gap:8, alignItems:"stretch" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
              background:T.accentDark, borderRadius:T.radius, padding:"0 12px",
              fontSize:11, fontWeight:800, color:T.accent, letterSpacing:".08em", minWidth:48 }}>
              {t.moneda}
            </div>
            <CompactCard label="Total"   value={fmtMoney(t.total,  t.moneda)} color={T.text}   sub={`${t.cantidad} comprobante${t.cantidad !== 1 ? "s" : ""}`} />
            <CompactCard label="Pagado"  value={fmtMoney(t.pagado, t.moneda)} color={T.green} />
            <CompactCard label="A Pagar" value={fmtMoney(t.aPagar, t.moneda)} color={T.orange} />
            <CompactCard label="Vencido" value={fmtMoney(t.vencido,t.moneda)} color={T.red} />
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
        padding:"12px 16px", marginBottom:16, boxShadow:T.shadow,
        display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
          placeholder="Buscar proveedor, cuenta, CC..."
          style={{ flex:1, minWidth:200, background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
            borderRadius:8, padding:"7px 12px", fontSize:13, color:T.text, outline:"none", fontFamily:T.font }} />
        <FiltroFecha {...filtroFecha} />
        {["todos","pagado","a_pagar","vencido"].map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)} style={{
            background: filtroEstado===e ? T.accentDark : "#f3f4f6",
            color: filtroEstado===e ? T.accent : T.muted,
            border:`1px solid ${filtroEstado===e ? T.accentDark : T.cardBorder}`,
            borderRadius:999, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer",
          }}>
            {e==="todos" ? "Todos" : ESTADO_EGRESO[e]?.label}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
        boxShadow:T.shadow, overflowX:"auto" }}>
        <table style={{ width:"100%", minWidth:1060, borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:T.tableHead }}>
              <th style={{ width:36 }} />
              {["ID","Estado","Emisión","Vencimiento","Proveedor","N° FC","Cuenta","Centros de Costo","Importe","Pagado","Pendiente","Medio de Pago","Nota"].map(h => (
                <th key={h} style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                  letterSpacing:".08em", textTransform:"uppercase",
                  color:T.tableHeadText, textAlign:"left", whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={11} style={{ padding:32, textAlign:"center", color:T.dim, fontSize:13 }}>Sin resultados</td></tr>
              : rows.map((e, i) => (
                <tr key={e.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                  background: i%2===0 ? T.card : "#fafbfc", transition:"background .1s" }}
                  onMouseEnter={ev => ev.currentTarget.style.background="#f0f9ff"}
                  onMouseLeave={ev => ev.currentTarget.style.background=i%2===0?T.card:"#fafbfc"}>

                  {/* Acciones */}
                  <td style={{ padding:"8px 6px 8px 10px", verticalAlign:"middle" }}>
                    <RowMenu
                      egreso={e}
                      onPago={()     => setShowPago(e)}
                      onDetalle={()  => setShowDetalle(e)}
                      onEditar={()   => setShowEditar(e)}
                      onCtaCte={()   => setShowCtaCte({ proveedor: e.proveedor, docs: egresos.filter(x => x.proveedor === e.proveedor) })}
                      onEliminar={() => handleEliminar(e.id)}
                    />
                  </td>

                  <td style={{ padding:"10px 14px", fontSize:11, color:T.muted, fontFamily:"var(--mono)" }}>{shortId(e.id)}</td>
                  <td style={{ padding:"10px 14px" }}><Badge estado={e.estado} cfg={ESTADO_EGRESO} /></td>
                  <td style={{ padding:"10px 14px", fontSize:13, color:T.text }}>{fmtDate(e.fecha)}</td>
                  <td style={{ padding:"10px 14px", fontSize:13,
                    color:e.estado==="vencido"?T.red:T.text, fontWeight:e.estado==="vencido"?700:400 }}>{fmtDate(e.vto)}</td>
                  <td style={{ padding:"10px 14px", fontSize:13, color:T.text, fontWeight:600 }}>{e.proveedor}</td>
                  <td style={{ padding:"10px 14px", fontSize:11, color:T.muted, fontFamily:"var(--mono)" }}>{e.nroComp || "—"}</td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:T.muted }}>{e.cuenta}</td>
                  <td style={{ padding:"10px 14px" }}>
                    <CCDisplay lineas={e.lineas} resolveCC={resolveCC} />
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:13, fontFamily:"var(--mono)",
                    fontWeight:700, color:T.text, textAlign:"right", whiteSpace:"nowrap" }}>
                    {fmtMoney(e.importe, e.moneda)}
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:13, fontFamily:"var(--mono)",
                    fontWeight:700, color:T.green, textAlign:"right", whiteSpace:"nowrap" }}>
                    {fmtMoney(e.pagosVinculados?.reduce((s,p)=>s+(Number(p.monto)||0),0)??0, e.moneda)}
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:13, fontFamily:"var(--mono)",
                    fontWeight:700, color: (e.saldoPendiente??0)>0 ? T.orange : T.green, textAlign:"right", whiteSpace:"nowrap" }}>
                    {fmtMoney(e.saldoPendiente??0, e.moneda)}
                  </td>
                  <td style={{ padding:"10px 14px" }}>
                    {[...new Set((e.pagosVinculados??[]).map(p=>p.cuenta_bancaria).filter(Boolean))].map(id => (
                      <span key={id} style={{ display:"inline-block", fontSize:11, background:"#e0f2fe",
                        color:"#0369a1", borderRadius:6, padding:"2px 8px", fontWeight:600, marginRight:3 }}>
                        {resolveCB(id)}
                      </span>
                    ))}
                    {!(e.pagosVinculados??[]).length && <span style={{ color:T.dim, fontSize:11 }}>—</span>}
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:T.muted, maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.nota || "—"}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {/* Modales */}
      {showEditar  && <NuevoEgresoModal  sociedad={sociedad} proveedores={proveedores} cuentas={cuentas} centrosCosto={centrosCosto} initialData={showEditar} onClose={() => setShowEditar(null)} onSave={handleSave} />}
      {showPago    && <AgregarPagoModal  egreso={showPago} saldoPendiente={showPago.saldoPendiente ?? showPago.importe} cuentas={cuentasSoc} onClose={() => setShowPago(null)} onSave={handlePago} />}
      {editingPago && <EditarPagoModal   pago={editingPago} sociedad={sociedad} cuentasSoc={cuentasSoc} onClose={() => setEditingPago(null)} onSaved={() => { setEditingPago(null); cargarEgresos(); }} />}
      {showCtaCte  && <CtaCteModal       proveedor={showCtaCte.proveedor} documentos={showCtaCte.docs} onClose={() => setShowCtaCte(null)} />}
    </div>
  );
}
