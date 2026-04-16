import { useState, useMemo, useEffect } from "react";
import { T } from "./theme";
import { IVA_OPTS, todayISO, addDays, fmtNum } from "../data/numbersData";
import {
  norm, inputStyle, dateStyle, lookupId, makeCCResolver, calcLineasTotals,
  Label, Field, CCSelectOptions,
} from "./formUtils";
import { useLineas, newLinea } from "./useLineas";

// ─── Modal / Página de nueva factura de proveedor ─────────────────────────────
// asPage={true} → renderiza como pantalla completa (sin overlay flotante)
// asPage={false} (default) → renderiza como modal flotante
export default function NuevoEgresoModal({ onClose, onSave, proveedores = [], cuentas = [], centrosCosto, initialData, asPage = false }) {
  const isEdit = !!initialData;
  const CUENTAS_GASTO = cuentas.filter(c => {
    const t = (c.tipo ?? "").toLowerCase();
    return t === "gasto" || t === "gastos" || t === "financiero" || t === "financieros";
  });
  const CC_LIST = centrosCosto ?? [];

  const resolveCC   = makeCCResolver(CC_LIST);
  const initProvId  = lookupId(proveedores, "proveedorId", "proveedor", initialData);
  const initCuentaId = lookupId(CUENTAS_GASTO, "cuentaId", "cuenta", initialData);

  const initLineas = initialData?.lineas?.map(l => ({
    id: Date.now() + Math.random(),
    cc: resolveCC(l.cc ?? ""),
    subtotal: String(l.subtotal ?? ""),
    ivaRate: l.ivaRate ?? 21,
  })) ?? [newLinea()];

  const [provId,   setProvId]   = useState(initProvId);
  const [cuentaId, setCuentaId] = useState(initCuentaId);
  const [moneda,   setMoneda]   = useState(initialData?.moneda ?? "ARS");
  const [fecha,    setFecha]    = useState(initialData?.fecha ?? todayISO());
  const [vto,      setVto]      = useState(initialData?.vto ?? addDays(todayISO(), 30));
  const [nroComp,  setNroComp]  = useState(initialData?.nroComp ?? "");
  const [nota,     setNota]     = useState(initialData?.nota ?? "");
  const { lineas, setLineas, updLinea, addLinea, delLinea } = useLineas(initLineas);

  const ccGroups = useMemo(() => {
    const hq   = CC_LIST.filter(c => ["hq","marca","hq - marca"].includes(norm(c.grupo ?? "")));
    const ops  = CC_LIST.filter(c => ["operaciones","ops","sedes"].includes(norm(c.grupo ?? "")));
    const rest = CC_LIST.filter(c => !hq.includes(c) && !ops.includes(c));
    return { hq, ops, rest };
  }, [CC_LIST]);

  useEffect(() => {
    if (!initialData || provId) return;
    const found =
      proveedores.find(p => p.id === initialData.proveedorId) ||
      proveedores.find(p => norm(p.nombre) === norm(initialData.proveedor));
    if (found) setProvId(found.id);
  }, [proveedores]);

  useEffect(() => {
    if (!initialData || cuentaId) return;
    const found =
      CUENTAS_GASTO.find(c => c.id === initialData.cuentaId) ||
      CUENTAS_GASTO.find(c => norm(c.nombre) === norm(initialData.cuenta));
    if (found) setCuentaId(found.id);
  }, [cuentas]);

  const handleProvChange = (id) => {
    setProvId(id);
    const p = proveedores.find(x => x.id === id);
    if (!p) return;
    if (p.cuentaDefault) setCuentaId(p.cuentaDefault);
    if (p.monedaDefault) setMoneda(p.monedaDefault);
    setLineas([newLinea(p.ccDefault ?? "")]);
  };

  const { totalSub, totalIva, totalFinal } = useMemo(() => calcLineasTotals(lineas), [lineas]);

  const canSave = provId && cuentaId && fecha && lineas.some(l => Number(l.subtotal) > 0);

  const buildPayload = (extra = {}) => {
    const prov   = proveedores.find(p => p.id === provId);
    const cuenta = CUENTAS_GASTO.find(c => c.id === cuentaId);
    return {
      id:          isEdit ? initialData.id : `EG-${Date.now()}`,
      _isEdit:     isEdit,
      proveedor:   prov?.nombre ?? "—",
      proveedorId: provId,
      cuenta:      cuenta?.nombre ?? cuentaId,
      cuentaId:    cuentaId,
      cc:          lineas.map(l => l.cc).filter(Boolean).join(", ") || "—",
      moneda,
      importe:     totalFinal,
      fecha:       fecha.split("-").reverse().join("/"),
      vto:         vto.split("-").reverse().join("/"),
      nroComp,
      nota,
      lineas,
      estado:      "a_pagar",
      ...extra,
    };
  };

  const handleSave = () => {
    onSave?.(buildPayload());
    if (!asPage) onClose();
  };

  const handleSaveAndPay = () => {
    onSave?.(buildPayload({ _saveAndPay: true }));
    if (!asPage) onClose();
  };

  const prov = proveedores.find(p => p.id === provId);

  // ── Contenido del formulario (compartido entre modal y página) ────────────
  const formBody = (
    <div style={{ padding: asPage ? 0 : 24 }}>
      {/* Filas 1+2: grid de 4 cols — fila 1 span 2 cada campo, fila 2 col individual */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:14, marginBottom:20 }}>
        <div style={{ gridColumn:"1 / 3" }}>
          <Field label="Proveedor" required>
            <select value={provId} onChange={e => handleProvChange(e.target.value)} style={inputStyle}>
              <option value="">— Seleccionar proveedor —</option>
              {proveedores.length === 0 && (
                <option disabled>Sin proveedores — cargá uno en Maestros</option>
              )}
              {proveedores.map(p => (
                <option key={p.id} value={p.id}>{p.nombre}{p.cuit ? ` · ${p.cuit}` : ""}</option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ gridColumn:"3 / 5" }}>
          <Field label="Cuenta contable" required>
            <select value={cuentaId} onChange={e => setCuentaId(e.target.value)} style={inputStyle}>
              <option value="">— Seleccionar cuenta —</option>
              {CUENTAS_GASTO.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Fecha Emisión" required>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={dateStyle} />
        </Field>
        <Field label="Vto. de Pago">
          <input type="date" value={vto} onChange={e => setVto(e.target.value)} style={dateStyle} />
          {prov && (
            <div style={{ fontSize:10, color:T.blue, marginTop:3 }}>
              📌 Pre-cargado · podés modificarlo
            </div>
          )}
        </Field>
        <Field label="Moneda">
          <select value={moneda} onChange={e => setMoneda(e.target.value)} style={inputStyle}>
            <option value="ARS">$ ARS</option>
            <option value="USD">U$D</option>
            <option value="EUR">€ EUR</option>
          </select>
        </Field>
        <Field label="N° Comprobante">
          <input value={nroComp} onChange={e => setNroComp(e.target.value)}
            placeholder="FC-A 0001-00001234" style={inputStyle} />
        </Field>
      </div>

      {/* ── Tabla de líneas ── */}
      <div style={{ background:"#fff", border:`1px solid ${T.cardBorder}`,
        borderRadius:9, overflow:"hidden", marginBottom:16, boxShadow:T.shadow }}>
        <div style={{ background:T.tableHead, display:"grid",
          gridTemplateColumns:"1fr 130px 90px 110px 32px",
          padding:"9px 14px", gap:10 }}>
          {["Centro de Costo","Subtotal","IVA","Total",""].map((h, i) => (
            <div key={i} style={{ fontSize:11, fontWeight:700, color:T.tableHeadText,
              letterSpacing:".08em", textTransform:"uppercase",
              textAlign: i >= 1 ? "right" : "left" }}>{h}</div>
          ))}
        </div>

        {lineas.map((l, idx) => {
          const sub  = Number(l.subtotal) || 0;
          const iva  = sub * (Number(l.ivaRate) / 100);
          const tot  = sub + iva;
          return (
            <div key={l.id} style={{ display:"grid",
              gridTemplateColumns:"1fr 130px 90px 110px 32px",
              padding:"8px 14px", gap:10, alignItems:"center",
              borderTop:`1px solid ${T.cardBorder}`,
              background: idx % 2 === 0 ? "#fff" : "#fafbfc" }}>
              <select value={l.cc} onChange={e => updLinea(l.id, "cc", e.target.value)}
                style={{ ...inputStyle, padding:"6px 8px", fontSize:12 }}>
                <option value="">— Centro de Costo —</option>
                <CCSelectOptions ccGroups={ccGroups} />
              </select>
              <input type="number" value={l.subtotal}
                onChange={e => updLinea(l.id, "subtotal", e.target.value)}
                placeholder="0,00"
                style={{ ...inputStyle, padding:"6px 8px", fontSize:13,
                  textAlign:"right", fontFamily:"var(--mono)" }} />
              <select value={l.ivaRate} onChange={e => updLinea(l.id, "ivaRate", e.target.value)}
                style={{ ...inputStyle, padding:"6px 8px", fontSize:12, textAlign:"right" }}>
                {IVA_OPTS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <div style={{ fontSize:13, fontFamily:"var(--mono)", fontWeight:700,
                color: T.text, textAlign:"right" }}>
                {moneda === "USD" ? "U$D" : moneda === "EUR" ? "€" : "$"} {fmtNum(tot)}
              </div>
              <button onClick={() => delLinea(l.id)}
                style={{ background:"transparent", border:"none", cursor:"pointer",
                  color: T.red, fontSize:16, padding:0,
                  display:"flex", alignItems:"center", justifyContent:"center" }}>🗑</button>
            </div>
          );
        })}

        <div style={{ borderTop:`1px solid ${T.cardBorder}`, padding:"8px 14px" }}>
          <button onClick={addLinea} style={{
            background:"transparent", border:`1.5px dashed ${T.cardBorder}`,
            borderRadius:7, padding:"6px 16px", fontSize:12, color:T.muted,
            cursor:"pointer", fontFamily:T.font, fontWeight:600,
            display:"flex", alignItems:"center", gap:6,
          }}>+ Agregar línea</button>
        </div>
      </div>

      {/* ── Nota + Totales ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:20, alignItems:"start" }}>
        <Field label="Nota interna">
          <textarea value={nota} onChange={e => setNota(e.target.value)}
            placeholder="Observaciones, referencia interna..."
            style={{ ...inputStyle, resize:"vertical", minHeight:80 }} />
        </Field>
        <div style={{ background:"#fff", border:`1px solid ${T.cardBorder}`,
          borderRadius:9, padding:"16px 20px", boxShadow:T.shadow, minWidth:220 }}>
          {[
            { label:"Subtotal", value:totalSub, color:T.text },
            { label:"IVA",      value:totalIva, color:T.muted },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ display:"flex", justifyContent:"space-between",
              marginBottom:8, fontSize:13 }}>
              <span style={{ color }}>{label}</span>
              <span style={{ fontFamily:"var(--mono)", fontWeight:600, color }}>
                {moneda === "USD" ? "U$D" : "$"} {fmtNum(value)}
              </span>
            </div>
          ))}
          <div style={{ height:1, background:T.cardBorder, margin:"10px 0" }} />
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:14, fontWeight:800, color:T.text }}>Total</span>
            <span style={{ fontSize:16, fontFamily:"var(--mono)", fontWeight:900,
              color: totalFinal > 0 ? T.text : T.dim }}>
              {moneda === "USD" ? "U$D" : "$"} {fmtNum(totalFinal)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  const footerBtns = (
    <>
      <button onClick={onClose} style={{
        background:"#dc2626", border:"none", borderRadius:8, padding:"10px 24px",
        fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer",
        fontFamily:T.font, display:"flex", alignItems:"center", gap:7 }}>
        {asPage ? "← Cancelar" : "Cancelar ✕"}
      </button>
      {asPage && (
        <button onClick={handleSaveAndPay} disabled={!canSave} style={{
          background: canSave ? "#0e7490" : "#9ca3af", border:"none", borderRadius:8,
          padding:"10px 24px", fontSize:13, fontWeight:700, color:"#fff",
          cursor: canSave ? "pointer" : "default",
          fontFamily:T.font, display:"flex", alignItems:"center", gap:7 }}>
          Guardar y Pagar 💳
        </button>
      )}
      <button onClick={handleSave} disabled={!canSave} style={{
        background: canSave ? "#16a34a" : "#9ca3af", border:"none", borderRadius:8,
        padding:"10px 24px", fontSize:13, fontWeight:700, color:"#fff",
        cursor: canSave ? "pointer" : "default",
        fontFamily:T.font, display:"flex", alignItems:"center", gap:7 }}>
        Guardar ✓
      </button>
    </>
  );

  // ── Modo página (pantalla completa) ──────────────────────────────────────────
  if (asPage) {
    return (
      <div className="fade" style={{ padding:"28px 32px" }}>
        {/* Header */}
        <div style={{ background:T.accentDark, borderRadius:T.radius, padding:"16px 24px",
          display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
          <div>
            <div style={{ fontSize:16, fontWeight:900, color:T.accent }}>
              {isEdit ? "Editar Factura de Proveedor" : "Nueva Factura de Proveedor"}
            </div>
            <div style={{ fontSize:11, color:"rgba(173,255,25,.45)", marginTop:3 }}>
              Egresos › {isEdit ? `Editando ${initialData.id}` : "Nueva Compra"}
            </div>
          </div>
        </div>

        {/* Formulario */}
        <div style={{ background:"#d5d9e0", borderRadius:12, overflow:"hidden",
          boxShadow:"0 2px 12px rgba(0,0,0,.10)" }}>
          <div style={{ padding:24, background:"#f3f4f6", margin:16, borderRadius:10 }}>{formBody}</div>
          <div style={{ padding:"14px 24px", borderTop:`1px solid ${T.cardBorder}`,
            background:"#dde1e7", display:"flex", justifyContent:"flex-end", gap:10 }}>
            {footerBtns}
          </div>
        </div>
      </div>
    );
  }

  // ── Modo modal (flotante) ─────────────────────────────────────────────────────
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:400,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" onClick={e => e.stopPropagation()} style={{
        background:"#f8f9fa", borderRadius:12, width:780, maxWidth:"98vw",
        maxHeight:"94vh", display:"flex", flexDirection:"column",
        boxShadow:"0 24px 64px rgba(0,0,0,.3)", overflow:"hidden",
      }}>
        {/* Header */}
        <div style={{ background:T.accentDark, padding:"16px 24px",
          display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
          <div>
            <div style={{ fontSize:16, fontWeight:900, color:T.accent }}>
              {isEdit ? "Editar Factura de Proveedor" : "Nueva Factura de Proveedor"}
            </div>
            <div style={{ fontSize:11, color:"rgba(173,255,25,.45)", marginTop:2 }}>
              {isEdit ? `Editando ${initialData.id}` : "Completá los datos y las líneas de imputación"}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.4)", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:"auto" }}>{formBody}</div>

        {/* Footer */}
        <div style={{ padding:"14px 24px", borderTop:`1px solid ${T.cardBorder}`,
          background:"#fff", display:"flex", justifyContent:"flex-end", gap:10, flexShrink:0 }}>
          {footerBtns}
        </div>
      </div>
    </div>
  );
}
