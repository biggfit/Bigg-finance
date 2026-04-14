import { useState, useMemo } from "react";
import { T } from "./theme";
import { CENTROS_COSTO, CUENTAS, PROVEEDORES_SEED } from "../data/numbersData";

// ─── Constantes ───────────────────────────────────────────────────────────────
const IVA_OPTS = [
  { value: 0,    label: "0%"    },
  { value: 10.5, label: "10.5%" },
  { value: 21,   label: "21%"   },
  { value: 27,   label: "27%"   },
];

const CUENTAS_GASTO = CUENTAS.filter(c => c.tipo === "gasto" || c.tipo === "financiero");

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays  = (iso, n) => {
  const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10);
};
const fmtNum = n => Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });
const newLinea = (cc = "") => ({ id: Date.now() + Math.random(), cc, subtotal: "", ivaRate: 21 });

// ─── Componentes de campo ─────────────────────────────────────────────────────
const Label = ({ children, required }) => (
  <label style={{ fontSize:11, color:T.muted, fontWeight:700, display:"block",
    marginBottom:4, textTransform:"uppercase", letterSpacing:".06em" }}>
    {children}{required && <span style={{ color:T.red }}> *</span>}
  </label>
);

const Field = ({ label, required, children }) => (
  <div>
    {label && <Label required={required}>{label}</Label>}
    {children}
  </div>
);

const inputStyle = {
  width:"100%", background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
  borderRadius:7, padding:"8px 10px", fontSize:13, color:T.text,
  fontFamily:T.font, outline:"none", boxSizing:"border-box",
};

// ─── Modal principal ──────────────────────────────────────────────────────────
export default function NuevoEgresoModal({ onClose, onSave }) {
  const [provId,    setProvId]    = useState("");
  const [cuentaId,  setCuentaId]  = useState("");
  const [moneda,    setMoneda]    = useState("ARS");
  const [fecha,     setFecha]     = useState(todayISO());
  const [vto,       setVto]       = useState(addDays(todayISO(), 30));
  const [nroComp,   setNroComp]   = useState("");
  const [nota,      setNota]      = useState("");
  const [lineas,    setLineas]    = useState([newLinea()]);

  // ── Pre-carga desde proveedor ──
  const handleProvChange = (id) => {
    setProvId(id);
    const p = PROVEEDORES_SEED.find(x => x.id === id);
    if (!p) return;
    if (p.cuentaDefault) setCuentaId(p.cuentaDefault);
    if (p.monedaDefault) setMoneda(p.monedaDefault);
    setLineas([newLinea(p.ccDefault ?? "")]);
  };

  // ── Operaciones sobre líneas ──
  const updLinea = (id, key, val) =>
    setLineas(prev => prev.map(l => l.id === id ? { ...l, [key]: val } : l));
  const addLinea  = () => setLineas(prev => [...prev, newLinea()]);
  const delLinea  = (id) => setLineas(prev => prev.filter(l => l.id !== id));

  // ── Totales ──
  const { totalSub, totalIva, totalFinal } = useMemo(() => {
    let totalSub = 0, totalIva = 0;
    lineas.forEach(l => {
      const sub = Number(l.subtotal) || 0;
      const iva = sub * (Number(l.ivaRate) / 100);
      totalSub += sub;
      totalIva += iva;
    });
    return { totalSub, totalIva, totalFinal: totalSub + totalIva };
  }, [lineas]);

  const canSave = provId && cuentaId && fecha && lineas.some(l => Number(l.subtotal) > 0);

  const handleSave = () => {
    const prov = PROVEEDORES_SEED.find(p => p.id === provId);
    const cuenta = CUENTAS_GASTO.find(c => c.id === cuentaId);
    onSave?.({
      id:         `EG-${Date.now()}`,
      proveedor:  prov?.nombre ?? "—",
      proveedorId: provId,
      cuenta:     cuenta?.nombre ?? cuentaId,
      cc:         lineas.map(l => l.cc).filter(Boolean).join(", ") || "—",
      moneda,
      importe:    totalFinal,
      fecha:      fecha.split("-").reverse().join("/"),
      vto:        vto.split("-").reverse().join("/"),
      nroComp,
      nota,
      lineas,
      estado:     "a_pagar",
    });
    onClose();
  };

  const prov = PROVEEDORES_SEED.find(p => p.id === provId);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:400,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" onClick={e => e.stopPropagation()} style={{
        background:"#f8f9fa", borderRadius:12, width:780, maxWidth:"98vw",
        maxHeight:"94vh", display:"flex", flexDirection:"column",
        boxShadow:"0 24px 64px rgba(0,0,0,.3)", overflow:"hidden",
      }}>

        {/* ── Header ── */}
        <div style={{ background:T.accentDark, padding:"16px 24px",
          display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
          <div>
            <div style={{ fontSize:16, fontWeight:900, color:T.accent }}>Nueva Factura de Proveedor</div>
            <div style={{ fontSize:11, color:"rgba(173,255,25,.45)", marginTop:2 }}>
              Completá los datos y las líneas de imputación
            </div>
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.4)", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>

        {/* ── Body ── */}
        <div style={{ flex:1, overflowY:"auto", padding:24 }}>

          {/* Fila 1: Proveedor + Cuenta */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
            <Field label="Proveedor" required>
              <select value={provId} onChange={e => handleProvChange(e.target.value)} style={inputStyle}>
                <option value="">— Seleccionar proveedor —</option>
                {PROVEEDORES_SEED.map(p => (
                  <option key={p.id} value={p.id}>{p.nombre}{p.cuit ? ` · ${p.cuit}` : ""}</option>
                ))}
              </select>
            </Field>
            <Field label="Cuenta contable" required>
              <select value={cuentaId} onChange={e => setCuentaId(e.target.value)} style={inputStyle}>
                <option value="">— Seleccionar cuenta —</option>
                {CUENTAS_GASTO.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Fila 2: Fechas + Moneda + N° */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 120px 1fr", gap:14, marginBottom:20 }}>
            <Field label="Fecha Emisión" required>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Vto. de Pago">
              <input type="date" value={vto} onChange={e => setVto(e.target.value)} style={inputStyle} />
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

            {/* Encabezado tabla */}
            <div style={{ background:T.tableHead, display:"grid",
              gridTemplateColumns:"1fr 130px 90px 110px 32px",
              padding:"9px 14px", gap:10 }}>
              {["Centro de Costo","Subtotal","IVA","Total",""].map((h, i) => (
                <div key={i} style={{ fontSize:11, fontWeight:700, color:T.tableHeadText,
                  letterSpacing:".08em", textTransform:"uppercase",
                  textAlign: i >= 1 ? "right" : "left" }}>{h}</div>
              ))}
            </div>

            {/* Filas */}
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

                  {/* CC */}
                  <select value={l.cc} onChange={e => updLinea(l.id, "cc", e.target.value)}
                    style={{ ...inputStyle, padding:"6px 8px", fontSize:12 }}>
                    <option value="">— Centro de Costo —</option>
                    <optgroup label="Marca / HQ">
                      {CENTROS_COSTO.filter(c => c.grupo === "marca").map(c => (
                        <option key={c.id} value={c.id}>{c.nombre}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Sedes Operativas">
                      {CENTROS_COSTO.filter(c => c.grupo === "operaciones").map(c => (
                        <option key={c.id} value={c.id}>{c.nombre}</option>
                      ))}
                    </optgroup>
                  </select>

                  {/* Subtotal */}
                  <input type="number" value={l.subtotal}
                    onChange={e => updLinea(l.id, "subtotal", e.target.value)}
                    placeholder="0,00"
                    style={{ ...inputStyle, padding:"6px 8px", fontSize:13,
                      textAlign:"right", fontFamily:"var(--mono)" }} />

                  {/* IVA % */}
                  <select value={l.ivaRate} onChange={e => updLinea(l.id, "ivaRate", e.target.value)}
                    style={{ ...inputStyle, padding:"6px 8px", fontSize:12, textAlign:"right" }}>
                    {IVA_OPTS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>

                  {/* Total línea */}
                  <div style={{ fontSize:13, fontFamily:"var(--mono)", fontWeight:700,
                    color: T.text, textAlign:"right" }}>
                    {moneda === "USD" ? "U$D" : moneda === "EUR" ? "€" : "$"} {fmtNum(tot)}
                  </div>

                  {/* Eliminar */}
                  <button onClick={() => delLinea(l.id)} disabled={lineas.length === 1}
                    style={{ background:"transparent", border:"none", cursor: lineas.length > 1 ? "pointer" : "default",
                      color: lineas.length > 1 ? T.red : T.dim, fontSize:16, padding:0,
                      display:"flex", alignItems:"center", justifyContent:"center" }}>🗑</button>
                </div>
              );
            })}

            {/* Agregar línea */}
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

        {/* ── Footer ── */}
        <div style={{ padding:"14px 24px", borderTop:`1px solid ${T.cardBorder}`,
          background:"#fff", display:"flex", justifyContent:"flex-end", gap:10, flexShrink:0 }}>
          <button onClick={onClose} style={{
            background:"#dc2626", border:"none", borderRadius:8, padding:"10px 24px",
            fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer",
            fontFamily:T.font, display:"flex", alignItems:"center", gap:7 }}>
            Cancelar ✕
          </button>
          <button onClick={handleSave} disabled={!canSave} style={{
            background: canSave ? "#16a34a" : "#9ca3af", border:"none", borderRadius:8,
            padding:"10px 24px", fontSize:13, fontWeight:700, color:"#fff",
            cursor: canSave ? "pointer" : "default",
            fontFamily:T.font, display:"flex", alignItems:"center", gap:7 }}>
            Guardar ✓
          </button>
        </div>
      </div>
    </div>
  );
}
