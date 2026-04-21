import { useState, useMemo, useEffect } from "react";
import { T, Btn, Input, Select } from "./theme";
import { CUENTAS_BANCARIAS, TIPO_CUENTA } from "../data/tesoreriaData";
import {
  fetchProveedores, appendProveedor, updateProveedor, deleteProveedor,
  fetchClientes,    appendCliente,   updateCliente,   deleteCliente,
  fetchCuentasBancarias, appendCuentaBancaria, updateCuentaBancaria, deleteCuentaBancaria,
  fetchCentrosCosto, appendCentroCosto, updateCentroCosto, deleteCentroCosto,
  fetchCuentas, appendCuenta, updateCuenta, deleteCuenta,
  fetchSociedades, appendSociedad, updateSociedad, deleteSociedad,
  appendSaldoInicial, fetchSaldoInicialMovimiento, updateSaldoInicial,
} from "../lib/numbersApi";
import { CUENTAS as CUENTAS_STATIC, CENTROS_COSTO as CENTROS_COSTO_STATIC } from "../data/numbersData";

// ─── Chip de tipo ─────────────────────────────────────────────────────────────
function TipoChip({ tipo }) {
  const cfg = {
    gasto:      { bg:"#fee2e2", color:"#dc2626", label:"Gasto"      },
    ingreso:    { bg:"#dcfce7", color:"#16a34a", label:"Ingreso"    },
    financiero: { bg:"#ede9fe", color:"#7c3aed", label:"Financiero" },
    hq:         { bg:"#f0f9ff", color:"#0369a1", label:"HQ"         },
    operaciones:{ bg:"#fef9c3", color:"#b45309", label:"Sede"       },
  }[(tipo ?? "").toLowerCase()] ?? { bg:"#f3f4f6", color:"#374151", label: tipo };
  return (
    <span style={{ display:"inline-block", padding:"2px 9px", borderRadius:999,
      fontSize:10, fontWeight:700, background:cfg.bg, color:cfg.color,
      letterSpacing:".04em", whiteSpace:"nowrap" }}>{cfg.label}</span>
  );
}

// ─── Estado vacío genérico ────────────────────────────────────────────────────
function EmptyState({ icon, label, action }) {
  return (
    <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
      borderRadius:T.radius, padding:"60px 24px", textAlign:"center",
      boxShadow:T.shadow }}>
      <div style={{ fontSize:32, marginBottom:10 }}>{icon}</div>
      <div style={{ fontSize:14, color:T.muted, marginBottom:16 }}>{label}</div>
      {action}
    </div>
  );
}

// ─── Helpers compartidos de modales ──────────────────────────────────────────
const MODAL_SECTION_CARD = { background:"#fff", border:"1px solid #e2e8f0", borderRadius:10, padding:"16px 20px", display:"flex", flexDirection:"column", gap:12 };
const MODAL_INP = { width:"100%", background:"#fff", border:"1.5px solid #d1d5db", borderRadius:8,
  padding:"9px 12px", fontSize:13, color:"#111827", fontFamily:"var(--font)", outline:"none", boxSizing:"border-box" };
const ModalSectionTitle = ({ label, color }) => (
  <div style={{ fontSize:10, fontWeight:800, letterSpacing:".1em", textTransform:"uppercase", color: color ?? "#6b7280", marginBottom:2 }}>{label}</div>
);
const ModalField = ({ label, required, children }) => (
  <div>
    <label style={{ fontSize:12, color:"#374151", fontWeight:600, display:"block", marginBottom:5 }}>
      {label}{required && <span style={{ color:"#dc2626" }}> *</span>}
    </label>
    {children}
  </div>
);

function formaPagoLabel(formaPago, diasPago) {
  if (!formaPago || formaPago === "libre") return "—";
  if (formaPago === "transferencia")     return `+${diasPago || "?"}d fac.`;
  if (formaPago === "debito_automatico") return `Déb. día ${diasPago || "?"}`;
  if (formaPago === "contrato")          return `Cont. día ${diasPago || "?"}`;
  if (formaPago === "impuesto")          return `Imp. día ${diasPago || "?"}`;
  return formaPago;
}

// ─── Modal: Proveedor ─────────────────────────────────────────────────────────
const FORMA_PAGO_OPTS = [
  { value:"transferencia",     label:"Transferencia (fecha factura + N días)" },
  { value:"debito_automatico", label:"Débito automático (día fijo del mes)"   },
  { value:"contrato",          label:"Contrato (día fijo del mes)"            },
  { value:"impuesto",          label:"Impuesto / obligación (día fijo)"       },
  { value:"libre",             label:"Sin regla — ingresar manualmente"        },
];

function ProveedorModal({ initial, onClose, onSave, cuentas = [], centrosCosto = [] }) {
  const [form, setForm] = useState(initial ?? {
    nombre:"", cuit:"", condIVA:"Responsable Inscripto",
    monedaDefault:"ARS", cuentaDefault:"", ccDefault:"",
    formaPago:"libre", diasPago:"", nota:"",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const cuentasGasto = useMemo(() => cuentas.filter(c => { const t = (c.tipo ?? "").toLowerCase(); return t === "gasto" || t === "gastos" || t === "financiero"; }), [cuentas]);
  const canSave = !!form.nombre.trim();

  const handleSubmit = () => {
    // Para edit: incluye el id; para create: sin id (API lo genera)
    onSave(initial ? { ...form, id: initial.id } : form);
    onClose();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:"#f1f5f9", borderRadius:16, width:580,
        maxWidth:"97vw", maxHeight:"92vh", overflowY:"auto",
        boxShadow:"0 24px 80px rgba(0,0,0,.3)" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ background:T.accentDark, padding:"18px 24px", display:"flex",
          justifyContent:"space-between", alignItems:"center", borderRadius:"16px 16px 0 0" }}>
          <div>
            <div style={{ fontSize:16, fontWeight:900, color:T.accent }}>
              {initial ? "Editar proveedor" : "Nuevo proveedor"}
            </div>
            {initial && <div style={{ fontSize:11, color:"rgba(255,255,255,.4)", marginTop:2 }}>{initial.nombre}</div>}
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.4)", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>

        <div style={{ padding:"20px 20px 24px", display:"flex", flexDirection:"column", gap:14 }}>

          <div style={MODAL_SECTION_CARD}>
            <ModalSectionTitle label="Datos del proveedor" />
            <ModalField label="Nombre / Razón Social" required>
              <input value={form.nombre} onChange={e=>set("nombre",e.target.value)}
                placeholder="ACME SRL" style={MODAL_INP} />
            </ModalField>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <ModalField label="CUIT / DNI">
                <input value={form.cuit ?? ""} onChange={e=>set("cuit",e.target.value)}
                  placeholder="30-00000000-0" style={MODAL_INP} />
              </ModalField>
              <ModalField label="Condición IVA">
                <select value={form.condIVA ?? ""} onChange={e=>set("condIVA",e.target.value)} style={MODAL_INP}>
                  <option value="">— Seleccionar —</option>
                  {["Responsable Inscripto","Monotributo","Consumidor Final","Exento","No categorizado"].map(o=>(
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </ModalField>
            </div>
          </div>

          <div style={{ ...MODAL_SECTION_CARD, border:"1.5px solid #bfdbfe" }}>
            <ModalSectionTitle label="Condición de pago" color="#1d4ed8" />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <ModalField label="Forma de pago">
                <select value={form.formaPago ?? "libre"} onChange={e=>set("formaPago",e.target.value)} style={{ ...MODAL_INP, borderColor:"#93c5fd" }}>
                  {FORMA_PAGO_OPTS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </ModalField>
              <ModalField label={
                !form.formaPago || form.formaPago === "libre" ? "Plazo en días (referencia)"
                : form.formaPago === "transferencia" ? "Días desde factura"
                : "Día fijo del mes"
              }>
                <input type="number" min="0" value={form.diasPago ?? ""} onChange={e=>set("diasPago",e.target.value)}
                  placeholder={form.formaPago === "transferencia" ? "20" : !form.formaPago || form.formaPago === "libre" ? "30" : "5"}
                  style={{ ...MODAL_INP, borderColor:"#93c5fd" }} />
              </ModalField>
            </div>
          </div>

          <div style={MODAL_SECTION_CARD}>
            <ModalSectionTitle label="Imputación contable" />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <ModalField label="Moneda habitual">
                <select value={form.monedaDefault ?? "ARS"} onChange={e=>set("monedaDefault",e.target.value)} style={MODAL_INP}>
                  <option value="ARS">ARS — Pesos</option>
                  <option value="USD">USD — Dólares</option>
                  <option value="EUR">EUR — Euros</option>
                </select>
              </ModalField>
              <ModalField label="Centro de costo default">
                <select value={form.ccDefault ?? ""} onChange={e=>set("ccDefault",e.target.value)} style={MODAL_INP}>
                  <option value="">— Ninguno —</option>
                  {centrosCosto.filter(c=>c.grupo==="HQ").map(c=>(
                    <option key={c.id} value={c.id}>HQ · {c.nombre}</option>
                  ))}
                  {centrosCosto.filter(c=>c.grupo==="operaciones").map(c=>(
                    <option key={c.id} value={c.id}>Sede · {c.nombre}</option>
                  ))}
                </select>
              </ModalField>
            </div>
            <ModalField label="Cuenta contable default">
              <select value={form.cuentaDefault ?? ""} onChange={e=>set("cuentaDefault",e.target.value)} style={MODAL_INP}>
                <option value="">— Sin asignar —</option>
                {cuentasGasto.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </ModalField>
            <ModalField label="Nota interna">
              <textarea value={form.nota ?? ""} onChange={e=>set("nota",e.target.value)}
                placeholder="Detalle adicional, condiciones especiales..."
                style={{ ...MODAL_INP, resize:"vertical", minHeight:52 }} />
            </ModalField>
          </div>

          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, paddingTop:4 }}>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn variant="accent" onClick={handleSubmit} disabled={!canSave}>
              {initial ? "Guardar cambios" : "Crear proveedor"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Cliente ───────────────────────────────────────────────────────────
function ClienteModal({ initial, onClose, onSave, cuentas = [], centrosCosto = [] }) {
  const [form, setForm] = useState(initial ?? {
    nombre:"", cuit:"", condIVA:"Responsable Inscripto",
    monedaDefault:"ARS", cuentaDefault:"", ccDefault:"",
    formaPago:"libre", diasPago:"", nota:"",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const cuentasIngreso = useMemo(() => cuentas.filter(c => { const t = (c.tipo ?? "").toLowerCase(); return t === "ingreso" || t === "ingresos"; }), [cuentas]);
  const canSave = !!form.nombre.trim();

  const handleSubmit = () => {
    onSave(initial ? { ...form, id: initial.id } : form);
    onClose();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:"#f1f5f9", borderRadius:16, width:580,
        maxWidth:"97vw", maxHeight:"92vh", overflowY:"auto",
        boxShadow:"0 24px 80px rgba(0,0,0,.3)" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ background:"#1e3a5f", padding:"18px 24px", display:"flex",
          justifyContent:"space-between", alignItems:"center", borderRadius:"16px 16px 0 0" }}>
          <div>
            <div style={{ fontSize:16, fontWeight:900, color:"#93c5fd" }}>
              {initial ? "Editar cliente" : "Nuevo cliente"}
            </div>
            {initial && <div style={{ fontSize:11, color:"rgba(255,255,255,.4)", marginTop:2 }}>{initial.nombre}</div>}
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.4)", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>

        <div style={{ padding:"20px 20px 24px", display:"flex", flexDirection:"column", gap:14 }}>

          <div style={MODAL_SECTION_CARD}>
            <ModalSectionTitle label="Datos del cliente" />
            <ModalField label="Nombre / Razón Social" required>
              <input value={form.nombre} onChange={e=>set("nombre",e.target.value)}
                placeholder="Empresa SA" style={MODAL_INP} />
            </ModalField>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <ModalField label="CUIT / DNI">
                <input value={form.cuit ?? ""} onChange={e=>set("cuit",e.target.value)}
                  placeholder="30-00000000-0" style={MODAL_INP} />
              </ModalField>
              <ModalField label="Condición IVA">
                <select value={form.condIVA ?? ""} onChange={e=>set("condIVA",e.target.value)} style={MODAL_INP}>
                  <option value="">— Seleccionar —</option>
                  {["Responsable Inscripto","Monotributo","Consumidor Final","Exento","No categorizado"].map(o=>(
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </ModalField>
            </div>
          </div>

          <div style={{ ...MODAL_SECTION_CARD, border:"1.5px solid #bbf7d0" }}>
            <ModalSectionTitle label="Condición de cobro" color="#15803d" />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <ModalField label="Forma de cobro">
                <select value={form.formaPago ?? "libre"} onChange={e=>set("formaPago",e.target.value)} style={{ ...MODAL_INP, borderColor:"#86efac" }}>
                  {FORMA_PAGO_OPTS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </ModalField>
              <ModalField label={
                !form.formaPago || form.formaPago === "libre" ? "Plazo en días (referencia)"
                : form.formaPago === "transferencia" ? "Días desde factura"
                : "Día fijo del mes"
              }>
                <input type="number" min="0" value={form.diasPago ?? ""} onChange={e=>set("diasPago",e.target.value)}
                  placeholder={form.formaPago === "transferencia" ? "20" : !form.formaPago || form.formaPago === "libre" ? "30" : "5"}
                  style={{ ...MODAL_INP, borderColor:"#86efac" }} />
              </ModalField>
            </div>
          </div>

          <div style={MODAL_SECTION_CARD}>
            <ModalSectionTitle label="Imputación contable" />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <ModalField label="Moneda habitual">
                <select value={form.monedaDefault ?? "ARS"} onChange={e=>set("monedaDefault",e.target.value)} style={MODAL_INP}>
                  <option value="ARS">ARS — Pesos</option>
                  <option value="USD">USD — Dólares</option>
                  <option value="EUR">EUR — Euros</option>
                </select>
              </ModalField>
              <ModalField label="Centro de costo default">
                <select value={form.ccDefault ?? ""} onChange={e=>set("ccDefault",e.target.value)} style={MODAL_INP}>
                  <option value="">— Ninguno —</option>
                  {centrosCosto.filter(c=>c.grupo==="HQ").map(c=>(
                    <option key={c.id} value={c.id}>HQ · {c.nombre}</option>
                  ))}
                  {centrosCosto.filter(c=>c.grupo==="operaciones").map(c=>(
                    <option key={c.id} value={c.id}>Sede · {c.nombre}</option>
                  ))}
                </select>
              </ModalField>
            </div>
            <ModalField label="Cuenta contable default">
              <select value={form.cuentaDefault ?? ""} onChange={e=>set("cuentaDefault",e.target.value)} style={MODAL_INP}>
                <option value="">— Sin asignar —</option>
                {cuentasIngreso.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </ModalField>
            <ModalField label="Nota interna">
              <textarea value={form.nota ?? ""} onChange={e=>set("nota",e.target.value)}
                placeholder="Detalle adicional, condiciones especiales..."
                style={{ ...MODAL_INP, resize:"vertical", minHeight:52 }} />
            </ModalField>
          </div>

          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, paddingTop:4 }}>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" onClick={handleSubmit} disabled={!canSave}>
              {initial ? "Guardar cambios" : "Crear cliente"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TAB: Proveedores ─────────────────────────────────────────────────────────
function TabProveedores() {
  const [proveedores, setProveedores] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [busqueda,    setBusqueda]    = useState("");
  const [modal,       setModal]       = useState(null); // null | "nuevo" | objeto
  const [cuentas,      setCuentas]      = useState(CUENTAS_STATIC);
  const [centrosCosto, setCentrosCosto] = useState(CENTROS_COSTO_STATIC);

  const recargar = async () => {
    setLoading(true);
    try {
      const data = await fetchProveedores();
      setProveedores(Array.isArray(data) ? data : []);
    } catch (e) {
      alert("Error al cargar proveedores: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    recargar();
    fetchCuentas().then(data => {
      if (Array.isArray(data) && data.length > 0) {
        const ids = new Set(data.map(c => c.id));
        setCuentas([...data, ...CUENTAS_STATIC.filter(c => !ids.has(c.id))]);
      }
    }).catch(()=>{});
    fetchCentrosCosto().then(data => { if (Array.isArray(data)) setCentrosCosto(data); }).catch(()=>{});
  }, []);

  const handleSave = async (p) => {
    try {
      if (p.id) {
        const { id, ...patch } = p;
        await updateProveedor(id, patch);
      } else {
        const maxNum = proveedores.reduce((max, x) => {
          const n = parseInt((x.id ?? "").replace(/^PRV-/, ""), 10);
          return isNaN(n) ? max : Math.max(max, n);
        }, 0);
        await appendProveedor({ id: `PRV-${String(maxNum + 1).padStart(3, "0")}`, ...p });
      }
      await recargar();
    } catch (e) {
      alert("Error al guardar: " + e.message);
    }
  };

  const handleEliminar = async (prov) => {
    if (!confirm(`¿Eliminar "${prov.nombre}"?`)) return;
    try {
      await deleteProveedor(prov.id);
      setProveedores(prev => prev.filter(p => p.id !== prov.id));
    } catch (e) {
      alert("Error al eliminar: " + e.message);
    }
  };

  const rows = useMemo(() => {
    const q = busqueda.toLowerCase();
    return !q ? proveedores : proveedores.filter(p =>
      (p.nombre||"").toLowerCase().includes(q) ||
      (p.cuit||"").includes(q) ||
      (p.nota||"").toLowerCase().includes(q)
    );
  }, [busqueda, proveedores]);

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", minHeight:0 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
        marginBottom:12, gap:12, flexShrink:0, paddingBottom:4 }}>
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
          placeholder="Buscar proveedor..."
          style={{ flex:1, maxWidth:340, background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
            borderRadius:8, padding:"7px 12px", fontSize:13, color:T.text, outline:"none", fontFamily:T.font }} />
        <span style={{ fontSize:12, color:T.dim }}>{proveedores.length} proveedores</span>
        <Btn variant="accent" onClick={()=>setModal("nuevo")}>+ Nuevo Proveedor</Btn>
      </div>

      {loading ? (
        <div style={{ padding:"60px 24px", textAlign:"center", color:T.muted, fontSize:14 }}>
          Cargando proveedores…
        </div>
      ) : proveedores.length === 0 ? (
        <EmptyState icon="🧾" label="Todavía no hay proveedores cargados."
          action={<Btn variant="accent" onClick={()=>setModal("nuevo")}>Crear el primero</Btn>} />
      ) : (
        <div style={{ flex:1, background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
          boxShadow:T.shadow, overflow:"auto", minHeight:0 }}>
          <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
            <colgroup>
              <col style={{ width:"90px" }} />
              <col />
              <col style={{ width:"28%" }} />
              <col style={{ width:"130px" }} />
              <col style={{ width:"130px" }} />
            </colgroup>
            <thead>
              <tr style={{ background:T.tableHead }}>
                {["ID","Nombre","Cuenta","Forma de pago",""].map(h=>(
                  <th key={h} style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                    letterSpacing:".08em", textTransform:"uppercase",
                    color:T.tableHeadText, textAlign: h==="" ? "right" : "left",
                    position:"sticky", top:0, zIndex:1, background:T.tableHead }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0
                ? <tr><td colSpan={5} style={{ padding:32, textAlign:"center", color:T.dim, fontSize:13 }}>Sin resultados</td></tr>
                : rows.map((p, i) => {
                  const cuentaNombre = cuentas.find(c=>c.id===p.cuentaDefault)?.nombre ?? p.cuentaDefault ?? "—";
                  const pagoLabel = formaPagoLabel(p.formaPago, p.diasPago);
                  return (
                    <tr key={p.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                      background: i%2===0 ? T.card : "#fafbfc", transition:"background .1s" }}
                      onMouseEnter={ev=>ev.currentTarget.style.background="#f0f9ff"}
                      onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?T.card:"#fafbfc"}>
                      <td style={{ padding:"10px 14px", fontSize:11, color:T.dim,
                        fontFamily:"var(--mono)", whiteSpace:"nowrap" }}>{p.id}</td>
                      <td style={{ padding:"10px 14px", fontSize:13, color:T.text, fontWeight:700,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.nombre}</td>
                      <td style={{ padding:"10px 14px", fontSize:12, color:T.muted,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{cuentaNombre}</td>
                      <td style={{ padding:"10px 14px", fontSize:12,
                        color: p.formaPago && p.formaPago !== "libre" ? T.blue : T.dim,
                        whiteSpace:"nowrap" }}>{pagoLabel}</td>
                      <td style={{ padding:"10px 14px", textAlign:"right", whiteSpace:"nowrap" }}>
                        <button onClick={()=>setModal(p)} style={{
                          background:"transparent", border:`1px solid ${T.cardBorder}`,
                          borderRadius:6, padding:"4px 10px", fontSize:11, color:T.muted,
                          cursor:"pointer", fontFamily:T.font, fontWeight:600, marginRight:6 }}>Editar</button>
                        <button onClick={()=>handleEliminar(p)} style={{
                          background:"transparent", border:`1px solid #fecaca`,
                          borderRadius:6, padding:"4px 10px", fontSize:11, color:T.red,
                          cursor:"pointer", fontFamily:T.font, fontWeight:600 }}>Eliminar</button>
                      </td>
                    </tr>
                  );
                })
              }
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ProveedorModal
          initial={modal === "nuevo" ? null : modal}
          onClose={()=>setModal(null)}
          onSave={handleSave}
          cuentas={cuentas}
          centrosCosto={centrosCosto}
        />
      )}
    </div>
  );
}

// ─── TAB: Clientes ────────────────────────────────────────────────────────────
function TabClientes() {
  const [clientes, setClientes] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [modal,    setModal]    = useState(null);
  const [cuentas,      setCuentas]      = useState(CUENTAS_STATIC);
  const [centrosCosto, setCentrosCosto] = useState(CENTROS_COSTO_STATIC);

  const recargar = async () => {
    setLoading(true);
    try {
      const data = await fetchClientes();
      setClientes(Array.isArray(data) ? data : []);
    } catch (e) {
      alert("Error al cargar clientes: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    recargar();
    fetchCuentas().then(data => {
      if (Array.isArray(data) && data.length > 0) {
        const ids = new Set(data.map(c => c.id));
        setCuentas([...data, ...CUENTAS_STATIC.filter(c => !ids.has(c.id))]);
      }
    }).catch(()=>{});
    fetchCentrosCosto().then(data => { if (Array.isArray(data)) setCentrosCosto(data); }).catch(()=>{});
  }, []);

  const handleSave = async (c) => {
    try {
      if (c.id) {
        const { id, ...patch } = c;
        await updateCliente(id, patch);
      } else {
        const maxNum = clientes.reduce((max, x) => {
          const n = parseInt((x.id ?? "").replace(/^CLI-/, ""), 10);
          return isNaN(n) ? max : Math.max(max, n);
        }, 0);
        await appendCliente({ id: `CLI-${String(maxNum + 1).padStart(3, "0")}`, ...c });
      }
      await recargar();
    } catch (e) {
      alert("Error al guardar: " + e.message);
    }
  };

  const handleEliminar = async (cli) => {
    if (!confirm(`¿Eliminar "${cli.nombre}"?`)) return;
    try {
      await deleteCliente(cli.id);
      setClientes(prev => prev.filter(c => c.id !== cli.id));
    } catch (e) {
      alert("Error al eliminar: " + e.message);
    }
  };

  const rows = useMemo(() => {
    const q = busqueda.toLowerCase();
    return !q ? clientes : clientes.filter(c =>
      (c.nombre||"").toLowerCase().includes(q) || (c.cuit||"").includes(q)
    );
  }, [busqueda, clientes]);

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", minHeight:0 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
        marginBottom:12, gap:12, flexShrink:0, paddingBottom:4 }}>
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
          placeholder="Buscar cliente..."
          style={{ flex:1, maxWidth:340, background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
            borderRadius:8, padding:"7px 12px", fontSize:13, color:T.text, outline:"none", fontFamily:T.font }} />
        <span style={{ fontSize:12, color:T.dim }}>{clientes.length} clientes</span>
        <Btn variant="primary" onClick={()=>setModal("nuevo")}>+ Nuevo Cliente</Btn>
      </div>

      {loading ? (
        <div style={{ padding:"60px 24px", textAlign:"center", color:T.muted, fontSize:14 }}>
          Cargando clientes…
        </div>
      ) : clientes.length === 0 ? (
        <EmptyState icon="🏢" label="Todavía no hay clientes cargados."
          action={<Btn variant="primary" onClick={()=>setModal("nuevo")}>Crear el primero</Btn>} />
      ) : (
        <div style={{ flex:1, background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
          boxShadow:T.shadow, overflow:"auto", minHeight:0 }}>
          <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
            <colgroup>
              <col style={{ width:"90px" }} />
              <col />
              <col style={{ width:"28%" }} />
              <col style={{ width:"130px" }} />
              <col style={{ width:"130px" }} />
            </colgroup>
            <thead>
              <tr style={{ background:T.tableHead }}>
                {["ID","Nombre","Cuenta","Forma de cobro",""].map(h=>(
                  <th key={h} style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                    letterSpacing:".08em", textTransform:"uppercase",
                    color:T.tableHeadText, textAlign: h==="" ? "right" : "left",
                    position:"sticky", top:0, zIndex:1, background:T.tableHead }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0
                ? <tr><td colSpan={5} style={{ padding:32, textAlign:"center", color:T.dim, fontSize:13 }}>Sin resultados</td></tr>
                : rows.map((c, i) => {
                  const cuentaNombre = cuentas.find(x=>x.id===c.cuentaDefault)?.nombre ?? c.cuentaDefault ?? "—";
                  const formaLabel = formaPagoLabel(c.formaPago, c.diasPago);
                  return (
                    <tr key={c.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                      background: i%2===0 ? T.card : "#fafbfc", transition:"background .1s" }}
                      onMouseEnter={ev=>ev.currentTarget.style.background="#f0fff4"}
                      onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?T.card:"#fafbfc"}>
                      <td style={{ padding:"10px 14px", fontSize:11, color:T.dim,
                        fontFamily:"var(--mono)", whiteSpace:"nowrap" }}>{c.id}</td>
                      <td style={{ padding:"10px 14px", fontSize:13, color:T.text, fontWeight:700,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.nombre}</td>
                      <td style={{ padding:"10px 14px", fontSize:12, color:T.muted,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{cuentaNombre}</td>
                      <td style={{ padding:"10px 14px", fontSize:12,
                        color: c.formaPago && c.formaPago !== "libre" ? "#15803d" : T.dim,
                        whiteSpace:"nowrap" }}>{formaLabel}</td>
                      <td style={{ padding:"10px 14px", textAlign:"right", whiteSpace:"nowrap" }}>
                        <button onClick={()=>setModal(c)} style={{
                          background:"transparent", border:`1px solid ${T.cardBorder}`,
                          borderRadius:6, padding:"4px 10px", fontSize:11, color:T.muted,
                          cursor:"pointer", fontFamily:T.font, fontWeight:600, marginRight:6 }}>Editar</button>
                        <button onClick={()=>handleEliminar(c)} style={{
                          background:"transparent", border:`1px solid #fecaca`,
                          borderRadius:6, padding:"4px 10px", fontSize:11, color:T.red,
                          cursor:"pointer", fontFamily:T.font, fontWeight:600 }}>Eliminar</button>
                      </td>
                    </tr>
                  );
                })
              }
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ClienteModal
          initial={modal === "nuevo" ? null : modal}
          onClose={()=>setModal(null)}
          onSave={handleSave}
          cuentas={cuentas}
          centrosCosto={centrosCosto}
        />
      )}
    </div>
  );
}

// ─── Chip de cuenta pasivo ────────────────────────────────────────────────────
const PASIVO_CFG = {
  proveedores: { bg:"#fef3c7", color:"#b45309", label:"Proveedores" },
  sueldos:     { bg:"#ede9fe", color:"#7c3aed", label:"Sueldos"     },
  impuestos:   { bg:"#fee2e2", color:"#dc2626", label:"Impuestos"   },
  financiero:  { bg:"#e0f2fe", color:"#0369a1", label:"Financiero"  },
};
function PasivoChip({ value }) {
  if (!value) return <span style={{ color:"#9ca3af", fontStyle:"italic", fontSize:11 }}>—</span>;
  const cfg = PASIVO_CFG[value] ?? { bg:"#f3f4f6", color:"#374151", label: value };
  return (
    <span style={{ display:"inline-block", padding:"2px 9px", borderRadius:999,
      fontSize:10, fontWeight:700, background:cfg.bg, color:cfg.color, letterSpacing:".04em" }}>
      {cfg.label}
    </span>
  );
}

// ─── Modal: Cuenta contable ───────────────────────────────────────────────────
function CuentaModal({ initial, onClose, onSave }) {
  const blank = { nombre:"", tipo:"gasto", categoria_pnl:"", cuenta_pasivo:"" };
  const [form, setForm] = useState(initial ?? blank);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const canSave = !!form.nombre.trim() && !!form.tipo;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:14, width:420,
        maxWidth:"97vw", boxShadow:"0 20px 60px rgba(0,0,0,.25)" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ background:"#1e293b", padding:"18px 24px", display:"flex",
          justifyContent:"space-between", alignItems:"center", borderRadius:"14px 14px 0 0" }}>
          <div style={{ fontSize:16, fontWeight:900, color:"#e2e8f0" }}>
            {initial ? "Editar Cuenta" : "Nueva Cuenta"}
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.4)", fontSize:18, cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
          <Input label="Nombre de la cuenta" required value={form.nombre} onChange={v=>set("nombre",v)}
            placeholder="Alquileres, Sueldos, Fee Franquicias..." />
          <Select label="Tipo" required value={form.tipo} onChange={v=>set("tipo",v)}
            options={[
              { value:"gasto",      label:"Gasto"      },
              { value:"ingreso",    label:"Ingreso"    },
              { value:"financiero", label:"Financiero" },
              { value:"activo",     label:"Activo"     },
              { value:"pasivo",     label:"Pasivo"     },
            ]} />
          <Select label="Categoría P&L" value={form.categoria_pnl ?? ""} onChange={v=>set("categoria_pnl",v)}
            options={[
              { value:"",                   label:"— Sin clasificar —"        },
              { value:"ventas",             label:"Ventas"                    },
              { value:"costo_venta",        label:"Costo por Venta"           },
              { value:"gastos_operativos",  label:"Gastos Operativos"         },
              { value:"gastos_financieros", label:"Gastos Financieros"        },
              { value:"impuestos",          label:"Impuestos"                 },
            ]} />
          <Select label="Cuenta pasivo P&L" value={form.cuenta_pasivo ?? ""} onChange={v=>set("cuenta_pasivo",v)}
            options={[
              { value:"",           label:"— Ninguna —"  },
              { value:"proveedores",label:"Proveedores"  },
              { value:"sueldos",    label:"Sueldos"      },
              { value:"impuestos",  label:"Impuestos"    },
              { value:"financiero", label:"Financiero"   },
            ]} />
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, paddingTop:8 }}>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn variant="accent" onClick={() => { onSave(initial ? { ...form, id: initial.id } : form); onClose(); }} disabled={!canSave}>
              {initial ? "Guardar cambios" : "Crear cuenta"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TAB: Plan de cuentas ─────────────────────────────────────────────────────
function TabCuentas() {
  const [cuentas,    setCuentas]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [fromSeed,   setFromSeed]   = useState(false);
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [busqueda,   setBusqueda]   = useState("");
  const [modal,      setModal]      = useState(null);

  const recargar = async () => {
    setLoading(true);
    try {
      const data = await fetchCuentas();
      if (Array.isArray(data) && data.length > 0) {
        setCuentas(data);
        setFromSeed(false);
      }
    } catch (e) {
      // fallback silencioso a static
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { recargar(); }, []);

  const handleSave = async (c) => {
    try {
      if (c.id) {
        const { id, ...patch } = c;
        await updateCuenta(id, patch);
      } else {
        await appendCuenta(c);
      }
      await recargar();
    } catch (e) {
      alert("Error al guardar: " + e.message);
    }
  };

  const handleEliminar = async (cuenta) => {
    if (!confirm(`¿Eliminar "${cuenta.nombre}"?`)) return;
    try {
      await deleteCuenta(cuenta.id);
      setCuentas(prev => prev.filter(c => c.id !== cuenta.id));
    } catch (e) {
      alert("Error al eliminar: " + e.message);
    }
  };

  const rows = useMemo(() => cuentas.filter(c => {
    const t = (c.tipo ?? "").toLowerCase();
    const matchT = filtroTipo === "todos"
      || (filtroTipo === "gasto"      && (t === "gasto"      || t === "gastos"))
      || (filtroTipo === "ingreso"    && (t === "ingreso"    || t === "ingresos" || t === "venta" || t === "ventas"))
      || (filtroTipo === "financiero" && (t === "financiero" || t === "financieros"));
    const q = busqueda.toLowerCase();
    const matchQ = !q || c.nombre.toLowerCase().includes(q) || (c.id||"").toLowerCase().includes(q);
    return matchT && matchQ;
  }), [filtroTipo, busqueda, cuentas]);

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", minHeight:0 }}>
      {fromSeed && !loading && (
        <div style={{ background:"#fef9c3", border:"1px solid #fde68a", borderRadius:8,
          padding:"10px 16px", marginBottom:14, display:"flex", alignItems:"center", gap:10, fontSize:13, flexShrink:0 }}>
          <span>⚠️</span>
          <span style={{ flex:1, color:"#92400e" }}>
            El sheet <strong>nb_cuentas</strong> está vacío — mostrando datos del sistema. Creá cuentas para reemplazarlos.
          </span>
        </div>
      )}

      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:12, flexWrap:"wrap", flexShrink:0 }}>
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
          placeholder="Buscar cuenta..."
          style={{ flex:1, maxWidth:300, background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
            borderRadius:8, padding:"7px 12px", fontSize:13, color:T.text, outline:"none", fontFamily:T.font }} />
        {["todos","gasto","ingreso","financiero"].map(t=>(
          <button key={t} onClick={()=>setFiltroTipo(t)} style={{
            background: filtroTipo===t ? T.accentDark : "#f3f4f6",
            color: filtroTipo===t ? T.accent : T.muted,
            border:`1px solid ${filtroTipo===t ? T.accentDark : T.cardBorder}`,
            borderRadius:999, padding:"5px 13px", fontSize:12, fontWeight:700, cursor:"pointer",
          }}>
            {t === "todos" ? "Todas" : t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
        <span style={{ fontSize:12, color:T.dim }}>{rows.length} cuentas</span>
        <Btn variant="accent" onClick={()=>setModal("nuevo")} style={{ marginLeft:"auto" }}>+ Nueva Cuenta</Btn>
      </div>

      {loading ? (
        <div style={{ padding:"60px 24px", textAlign:"center", color:T.muted, fontSize:14 }}>Cargando cuentas…</div>
      ) : (
        <div style={{ flex:1, background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
          boxShadow:T.shadow, overflow:"auto", minHeight:0 }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:T.tableHead }}>
                {["Tipo","Nombre","Cta. Pasivo P&L","ID",""].map(h=>(
                  <th key={h} style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                    letterSpacing:".08em", textTransform:"uppercase", color:T.tableHeadText, textAlign:"left",
                    position:"sticky", top:0, zIndex:1, background:T.tableHead }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} style={{ padding:32, textAlign:"center", color:T.dim, fontSize:13 }}>Sin resultados</td></tr>
              ) : rows.map((c, i) => (
                <tr key={c.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                  background: i%2===0 ? T.card : "#fafbfc" }}
                  onMouseEnter={ev=>ev.currentTarget.style.background="#f8fafc"}
                  onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?T.card:"#fafbfc"}>
                  <td style={{ padding:"9px 14px" }}><TipoChip tipo={c.tipo} /></td>
                  <td style={{ padding:"9px 14px", fontSize:13, color:T.text, fontWeight:600 }}>{c.nombre}</td>
                  <td style={{ padding:"9px 14px" }}><PasivoChip value={c.cuenta_pasivo} /></td>
                  <td style={{ padding:"9px 14px", fontSize:11, color:T.dim, fontFamily:"var(--mono)" }}>{c.id}</td>
                  <td style={{ padding:"9px 14px", textAlign:"right", whiteSpace:"nowrap" }}>
                    {!fromSeed && <>
                      <button onClick={()=>setModal(c)} style={{
                        background:"transparent", border:`1px solid ${T.cardBorder}`,
                        borderRadius:6, padding:"4px 10px", fontSize:11, color:T.muted,
                        cursor:"pointer", fontFamily:T.font, fontWeight:600, marginRight:6 }}>Editar</button>
                      <button onClick={()=>handleEliminar(c)} style={{
                        background:"transparent", border:`1px solid #fecaca`,
                        borderRadius:6, padding:"4px 10px", fontSize:11, color:T.red,
                        cursor:"pointer", fontFamily:T.font, fontWeight:600 }}>Eliminar</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <CuentaModal
          initial={modal === "nuevo" ? null : modal}
          onClose={()=>setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ─── Modal: Cuenta bancaria / Caja ───────────────────────────────────────────
function CuentaBancariaModal({ initial, onClose, onSave, sociedades = [] }) {
  const HOY = new Date().toISOString().slice(0, 10);
  const blank = { sociedad:"", nombre:"", tipo:"banco", moneda:"ARS", banco:"", cbu:"", nota:"", saldoInicial:"", fechaSaldoInicial: HOY };
  const [form, setForm] = useState(initial ?? blank);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const canSave = !!form.nombre.trim() && !!form.sociedad;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:14, width:460,
        maxWidth:"97vw", maxHeight:"90vh", overflowY:"auto",
        boxShadow:"0 20px 60px rgba(0,0,0,.25)" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ background:"#1e3a5f", padding:"18px 24px", display:"flex",
          justifyContent:"space-between", alignItems:"center", borderRadius:"14px 14px 0 0" }}>
          <div style={{ fontSize:16, fontWeight:900, color:"#93c5fd" }}>
            {initial ? "Editar Cuenta" : "Nueva Cuenta / Caja"}
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.4)", fontSize:18, cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
          <Select label="Sociedad" required value={form.sociedad} onChange={v=>set("sociedad",v)}
            options={[
              { value:"", label:"— Seleccionar sociedad —" },
              ...sociedades.map(s=>({value:s.id, label:`${s.bandera ?? ""} ${s.nombre}`})),
            ]} />
          <Input label="Nombre" required value={form.nombre} onChange={v=>set("nombre",v)}
            placeholder="Ej: Galicia ARS, Caja HQ" />
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <Select label="Tipo" value={form.tipo} onChange={v=>set("tipo",v)}
              options={Object.entries(TIPO_CUENTA).map(([k,v])=>({value:k, label:`${v.icon} ${v.label}`}))} />
            <Select label="Moneda" value={form.moneda} onChange={v=>set("moneda",v)}
              options={[
                {value:"ARS",label:"$ ARS"},{value:"USD",label:"U$D USD"},
                {value:"EUR",label:"€ EUR"},{value:"COP",label:"COP"},
              ]} />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 150px", gap:12, alignItems:"end" }}>
            <Input label={`Saldo inicial${form.moneda ? ` (${form.moneda})` : ""}`}
              value={form.saldoInicial ?? ""} onChange={v=>set("saldoInicial",v)}
              type="number" placeholder="0 — dejar en blanco si no hay" />
            <div>
              <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>Fecha del saldo</label>
              <input type="date" value={form.fechaSaldoInicial ?? HOY}
                onChange={e=>set("fechaSaldoInicial", e.target.value)}
                style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:`1px solid ${T.cardBorder}`,
                  fontSize:13, fontFamily:T.font, background:"#fff", color:T.text, outline:"none", boxSizing:"border-box" }} />
            </div>
          </div>
          <Input label="Banco / Entidad" value={form.banco ?? ""} onChange={v=>set("banco",v)}
            placeholder="Banco Galicia, Mercado Pago…" />
          <Input label="CBU / Alias" value={form.cbu ?? ""} onChange={v=>set("cbu",v)}
            placeholder="0000000-00000000-0" />
          <div>
            <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>Nota</label>
            <textarea value={form.nota ?? ""} onChange={e=>set("nota",e.target.value)}
              placeholder="Observaciones..."
              style={{ width:"100%", background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
                borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
                fontFamily:T.font, outline:"none", resize:"vertical", minHeight:56, boxSizing:"border-box" }} />
          </div>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, paddingTop:8 }}>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" onClick={()=>{ onSave(initial ? {...form,id:initial.id} : form); onClose(); }} disabled={!canSave}>
              {initial ? "Guardar cambios" : "Crear cuenta"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TAB: Cajas y Bancos ──────────────────────────────────────────────────────
function TabCajas() {
  const [cuentas,    setCuentas]    = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [seeding,        setSeeding]        = useState(false);
  const [fromSeed,       setFromSeed]       = useState(false);
  const [modal,      setModal]      = useState(null);
  const [filtroSoc,  setFiltroSoc]  = useState("todos");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [sociedades, setSociedades] = useState([]);

  const recargar = async () => {
    setLoading(true);
    try {
      const data = await fetchCuentasBancarias();
      if (Array.isArray(data) && data.length > 0) {
        setCuentas(data);
        setFromSeed(false);
      } else {
        setCuentas([]);
        setFromSeed(false);
      }
    } catch {
      setCuentas([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSeedCajas = async () => {
    if (!confirm("¿Cargar todas las cajas en el sheet? Esto creará una fila por cada caja en nb_cuentas_bancarias.")) return;
    setSeeding(true);
    try {
      const cajas = CUENTAS_BANCARIAS.filter(c => c.tipo === "caja");
      for (const c of cajas) {
        const { saldo, ...rest } = c; // no guardar saldo hardcodeado
        await appendCuentaBancaria(rest);
      }
      await recargar();
    } catch (e) {
      alert("Error al importar: " + e.message);
    } finally {
      setSeeding(false);
    }
  };


  useEffect(() => {
    recargar();
    fetchSociedades().then(data => { if (Array.isArray(data) && data.length > 0) setSociedades(data); }).catch(()=>{});
  }, []);

  const handleSave = async (c) => {
    try {
      const { id, saldoInicial, fechaSaldoInicial, _saldoInicialRow, ...patch } = c;
      const monto = Number(saldoInicial) || 0;
      const fecha = fechaSaldoInicial || new Date().toISOString().slice(0, 10);
      if (id) {
        await updateCuentaBancaria(id, patch);
        if (_saldoInicialRow) {
          // Siempre actualizar — nunca borrar, solo poner 0 si corresponde
          const changed = monto !== Number(_saldoInicialRow.monto) || fecha !== _saldoInicialRow.fecha;
          if (changed) await updateSaldoInicial(_saldoInicialRow.id, monto, fecha);
        } else {
          // No existía la fila → crearla siempre (aunque monto sea 0)
          await appendSaldoInicial({ sociedad: c.sociedad, cuentaId: id, moneda: c.moneda, monto, fecha });
        }
      } else {
        const result = await appendCuentaBancaria(patch);
        const cuentaId = result?.id;
        if (cuentaId) {
          // Siempre crear la fila de saldo inicial al crear una cuenta
          await appendSaldoInicial({ sociedad: c.sociedad, cuentaId, moneda: c.moneda, monto, fecha });
        }
      }
      await recargar();
    } catch (e) {
      alert("Error al guardar: " + e.message);
    }
  };


  const handleEditarCuenta = async (c) => {
    const siRow = await fetchSaldoInicialMovimiento(c.id).catch(() => null);
    // Normalizar sociedad a ID y tipo a minúscula (el sheet puede guardar variantes)
    const socId = sociedades.find(s =>
      s.id === (c.sociedad ?? "").toLowerCase() || s.nombre === c.sociedad
    )?.id ?? (c.sociedad ?? "").toLowerCase();
    setModal({
      ...c,
      sociedad:          socId,
      tipo:              (c.tipo ?? "").toLowerCase(),
      moneda:            (c.moneda ?? "").toUpperCase(),
      _saldoInicialRow:  siRow,
      saldoInicial:      siRow ? String(Math.abs(Number(siRow.monto) || 0)) : "",
      fechaSaldoInicial: siRow?.fecha ?? new Date().toISOString().slice(0, 10),
    });
  };

  const handleEliminar = async (c) => {
    if (!confirm(`¿Eliminar "${c.nombre}"?`)) return;
    try {
      await deleteCuentaBancaria(c.id);
      setCuentas(prev => prev.filter(x => x.id !== c.id));
    } catch (e) {
      alert("Error al eliminar: " + e.message);
    }
  };

  const rows = useMemo(() => {
    return cuentas.filter(c => {
      if (filtroSoc !== "todos") {
        // c.sociedad puede ser ID ("nako") o nombre completo ("Ñako SRL")
        const soc = sociedades.find(s => s.id === filtroSoc);
        if (!soc) return false;
        if (c.sociedad !== soc.id && c.sociedad !== soc.nombre) return false;
      }
      if (filtroTipo !== "todos" && c.tipo !== filtroTipo) return false;
      return true;
    });
  }, [cuentas, filtroSoc, filtroTipo]);

  // Agrupar por sociedad para mostrar — normaliza a ID canónico para evitar duplicados por casing
  const grouped = useMemo(() => {
    const map = new Map();
    for (const c of rows) {
      const soc = sociedades.find(s => s.id === c.sociedad || s.nombre === c.sociedad || s.id === (c.sociedad ?? "").toLowerCase());
      const key = soc?.id ?? (c.sociedad ?? "").toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    return map;
  }, [rows, sociedades]);

  const socMap     = useMemo(() => { const m = new Map(); for (const s of sociedades) m.set(s.id, s); return m; }, [sociedades]);
  const socNombre  = (val) => socMap.get(val)?.nombre  ?? val;
  const socBandera = (val) => socMap.get(val)?.bandera ?? "";

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", minHeight:0 }}>
      {/* Toolbar */}
      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:16, flexWrap:"wrap", flexShrink:0 }}>
        <select value={filtroSoc} onChange={e=>setFiltroSoc(e.target.value)}
          style={{ background:"#f9fafb", border:`1px solid ${T.cardBorder}`, borderRadius:8,
            padding:"7px 12px", fontSize:13, color:T.text, outline:"none", fontFamily:T.font }}>
          <option value="todos">Todas las sociedades</option>
          {sociedades.map(s=>(
            <option key={s.id} value={s.id}>{s.bandera} {s.nombre}</option>
          ))}
        </select>
        {["todos","banco","caja","inversion"].map(t=>(
          <button key={t} onClick={()=>setFiltroTipo(t)} style={{
            background: filtroTipo===t ? "#1e3a5f" : "#f3f4f6",
            color: filtroTipo===t ? "#93c5fd" : T.muted,
            border:`1px solid ${filtroTipo===t ? "#1e3a5f" : T.cardBorder}`,
            borderRadius:999, padding:"5px 13px", fontSize:12, fontWeight:700, cursor:"pointer",
          }}>
            {t === "todos" ? "Todos" : `${TIPO_CUENTA[t]?.icon} ${TIPO_CUENTA[t]?.label}`}
          </button>
        ))}
        <span style={{ fontSize:12, color:T.dim, marginLeft:"auto" }}>{rows.length} cuentas</span>
        <Btn variant="primary" onClick={()=>setModal("nuevo")}>+ Nueva Cuenta</Btn>
      </div>

      <div style={{ flex:1, overflow:"auto", minHeight:0 }}>
      {/* Banner seed */}
      {fromSeed && !loading && (
        <div style={{ background:"#fef9c3", border:"1px solid #fde047", borderRadius:8,
          padding:"10px 16px", marginBottom:14, display:"flex", alignItems:"center", gap:10, fontSize:13 }}>
          <span>⚠️</span>
          <span style={{ flex:1, color:"#92400e" }}>
            El sheet <strong>nb_cuentas_bancarias</strong> está vacío — mostrando datos del sistema.
          </span>
          <button onClick={handleSeedCajas} disabled={seeding} style={{
            background:"#ca8a04", border:"none", borderRadius:7, padding:"6px 14px",
            fontSize:12, fontWeight:700, color:"#fff", cursor:"pointer", fontFamily:T.font }}>
            {seeding ? "Importando…" : "Importar cajas al sheet"}
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ padding:"60px 24px", textAlign:"center", color:T.muted, fontSize:14 }}>Cargando…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon="🏦" label="No hay cuentas para los filtros seleccionados."
          action={<Btn variant="primary" onClick={()=>setModal("nuevo")}>Crear la primera</Btn>} />
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
          {[...grouped.entries()].map(([socId, items]) => (
            <div key={socId}>
              {/* Header sociedad */}
              <div style={{ fontSize:12, fontWeight:800, color:T.muted, letterSpacing:".1em",
                textTransform:"uppercase", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
                <span>{socBandera(socId)}</span>
                <span>{socNombre(socId)}</span>
                <span style={{ fontWeight:400, color:T.dim }}>({items.length})</span>
              </div>
              <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
                boxShadow:T.shadow, overflow:"hidden" }}>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead>
                    <tr style={{ background:T.tableHead }}>
                      {["Tipo","Nombre","Moneda","Banco / Entidad","CBU / Alias",""].map(h=>(
                        <th key={h} style={{ padding:"9px 14px", fontSize:11, fontWeight:700,
                          letterSpacing:".08em", textTransform:"uppercase",
                          color:T.tableHeadText, textAlign:"left" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((c, i) => {
                      const tc = TIPO_CUENTA[(c.tipo ?? "").toLowerCase()] ?? { icon:"💳", label:c.tipo, color:T.muted };
                      return (
                        <tr key={c.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                          background: i%2===0 ? T.card : "#fafbfc", transition:"background .1s" }}
                          onMouseEnter={ev=>ev.currentTarget.style.background="#f0f9ff"}
                          onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?T.card:"#fafbfc"}>
                          <td style={{ padding:"9px 14px" }}>
                            <span style={{ display:"inline-flex", alignItems:"center", gap:5,
                              fontSize:11, fontWeight:700, padding:"2px 9px", borderRadius:999,
                              background: tc.color + "18", color: tc.color }}>
                              {tc.icon} {tc.label}
                            </span>
                          </td>
                          <td style={{ padding:"9px 14px", fontSize:13, fontWeight:700, color:T.text }}>{c.nombre}</td>
                          <td style={{ padding:"9px 14px" }}>
                            <span style={{ fontSize:11, background:"#f3f4f6", color:T.muted,
                              borderRadius:6, padding:"2px 8px", fontWeight:700 }}>{c.moneda}</span>
                          </td>
                          <td style={{ padding:"9px 14px", fontSize:12, color:T.muted }}>{c.banco || "—"}</td>
                          <td style={{ padding:"9px 14px", fontSize:11, color:T.dim, fontFamily:"var(--mono)" }}>{c.cbu || "—"}</td>
                          <td style={{ padding:"9px 14px", textAlign:"right", whiteSpace:"nowrap" }}>
                            <button onClick={()=>handleEditarCuenta(c)} style={{
                              background:"transparent", border:`1px solid ${T.cardBorder}`,
                              borderRadius:6, padding:"4px 10px", fontSize:11, color:T.muted,
                              cursor:"pointer", fontFamily:T.font, fontWeight:600, marginRight:6 }}>Editar</button>
                            <button onClick={()=>handleEliminar(c)} style={{
                              background:"transparent", border:`1px solid #fecaca`,
                              borderRadius:6, padding:"4px 10px", fontSize:11, color:T.red,
                              cursor:"pointer", fontFamily:T.font, fontWeight:600 }}>Eliminar</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      </div>

      {modal && (
        <CuentaBancariaModal
          initial={modal === "nuevo" ? null : modal}
          onClose={()=>setModal(null)}
          onSave={handleSave}
          sociedades={sociedades}
        />
      )}
    </div>
  );
}

// ─── TAB: Centros de costo ────────────────────────────────────────────────────
// ─── Modal: Centro de Costo ───────────────────────────────────────────────────
function CCModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(initial ?? {
    nombre: "", grupo: "HQ", categoria_pnl: "", empresa: "", nota: "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const canSave = !!form.nombre.trim();

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:14, width:420,
        maxWidth:"97vw", boxShadow:"0 20px 60px rgba(0,0,0,.25)", overflow:"hidden" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ background:T.accentDark, padding:"18px 24px", display:"flex",
          justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontSize:16, fontWeight:900, color:T.accent }}>
            {initial ? "Editar Centro de Costo" : "Nuevo Centro de Costo"}
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.4)", fontSize:18, cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
          <Input label="Nombre *" value={form.nombre} onChange={v=>set("nombre",v)}
            placeholder="Ej: Administración, Sede Palermo" required />

          <div>
            <label style={{ fontSize:11, color:T.muted, fontWeight:700, display:"block",
              marginBottom:5, textTransform:"uppercase", letterSpacing:".06em" }}>Grupo *</label>
            <div style={{ display:"flex", gap:8 }}>
              {[{v:"HQ",label:"HQ"},{v:"operaciones",label:"Sede Operativa"}].map(opt=>(
                <button key={opt.v} onClick={()=>set("grupo",opt.v)} style={{
                  flex:1, padding:"8px 12px", borderRadius:8, fontSize:12, fontWeight:700,
                  cursor:"pointer", fontFamily:T.font,
                  background: form.grupo===opt.v ? T.accentDark : "#f3f4f6",
                  color:      form.grupo===opt.v ? T.accent     : T.muted,
                  border:     form.grupo===opt.v ? `1px solid ${T.accentDark}` : `1px solid ${T.cardBorder}`,
                }}>{opt.label}</button>
              ))}
            </div>
          </div>

          <Select label="Categoría P&L" value={form.categoria_pnl ?? ""} onChange={v=>set("categoria_pnl",v)}
            options={[
              { value:"",                 label:"— Sin clasificar —"       },
              { value:"ventas",           label:"Ventas"                   },
              { value:"costo_venta",      label:"Costo por Venta"          },
              { value:"r_y_d",            label:"R&D (Gastos Operativos)"  },
              { value:"sales_marketing",  label:"Sales & Marketing (OPEX)" },
              { value:"g_and_a",          label:"G&A (Gastos Operativos)"  },
              { value:"gastos_financieros", label:"Gastos Financieros"     },
              { value:"impuestos",        label:"Impuestos"                },
            ]} />
          <Input label="Empresa (dejar vacío = todas)" value={form.empresa ?? ""}
            onChange={v=>set("empresa",v)} placeholder="Ej: Ñako SRL" />
          <Input label="Nota" value={form.nota ?? ""} onChange={v=>set("nota",v)}
            placeholder="Observaciones opcionales" />
        </div>

        <div style={{ padding:"14px 24px", borderTop:`1px solid ${T.cardBorder}`,
          display:"flex", justifyContent:"flex-end", gap:10 }}>
          <button onClick={onClose} style={{ background:"#dc2626", border:"none", borderRadius:8,
            padding:"9px 20px", fontSize:13, fontWeight:700, color:"#fff",
            cursor:"pointer", fontFamily:T.font }}>Cancelar ✕</button>
          <button onClick={() => { onSave(initial ? {...form, id:initial.id} : form); onClose(); }}
            disabled={!canSave} style={{ background: canSave?"#16a34a":"#9ca3af", border:"none",
            borderRadius:8, padding:"9px 20px", fontSize:13, fontWeight:700, color:"#fff",
            cursor: canSave?"pointer":"default", fontFamily:T.font }}>Guardar ✓</button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Centros de Costo ────────────────────────────────────────────────────
function TabCC() {
  const [ccs,      setCcs]      = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [modal,    setModal]    = useState(null);

  const recargar = async () => {
    setLoading(true);
    try {
      const data = await fetchCentrosCosto();
      setCcs(Array.isArray(data) ? data : []);
    } catch (e) {
      alert("Error al cargar centros de costo: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { recargar(); }, []);

  const handleSave = async (cc) => {
    try {
      if (cc.id) {
        const { id, ...patch } = cc;
        await updateCentroCosto(id, patch);
      } else {
        await appendCentroCosto(cc);
      }
      await recargar();
    } catch (e) {
      alert("Error al guardar: " + e.message);
    }
  };

  const handleEliminar = async (cc) => {
    if (!confirm(`¿Eliminar "${cc.nombre}"?`)) return;
    try {
      await deleteCentroCosto(cc.id);
      setCcs(prev => prev.filter(c => c.id !== cc.id));
    } catch (e) {
      alert("Error al eliminar: " + e.message);
    }
  };

  const rows = useMemo(() => {
    const q = busqueda.toLowerCase();
    return !q ? ccs : ccs.filter(c =>
      (c.nombre||"").toLowerCase().includes(q) ||
      (c.id||"").toLowerCase().includes(q) ||
      (c.grupo||"").toLowerCase().includes(q)
    );
  }, [busqueda, ccs]);

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", minHeight:0 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
        marginBottom:16, gap:12, flexShrink:0 }}>
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
          placeholder="Buscar centro de costo..."
          style={{ flex:1, maxWidth:340, background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
            borderRadius:8, padding:"7px 12px", fontSize:13, color:T.text,
            outline:"none", fontFamily:T.font }} />
        <span style={{ fontSize:12, color:T.dim }}>{ccs.length} centros</span>
        <Btn variant="accent" onClick={()=>setModal("nuevo")}>+ Nuevo CC</Btn>
      </div>

      {loading ? (
        <div style={{ padding:"60px 24px", textAlign:"center", color:T.muted, fontSize:14 }}>
          Cargando centros de costo…
        </div>
      ) : ccs.length === 0 ? (
        <EmptyState icon="🗂" label="Todavía no hay centros de costo cargados."
          action={<Btn variant="accent" onClick={()=>setModal("nuevo")}>Crear el primero</Btn>} />
      ) : (
        <div style={{ flex:1, background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
          boxShadow:T.shadow, overflow:"auto", minHeight:0 }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:T.tableHead }}>
                {["ID","Nombre","Grupo","Empresa",""].map(h=>(
                  <th key={h} style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                    letterSpacing:".08em", textTransform:"uppercase",
                    color:T.tableHeadText, textAlign:"left",
                    position:"sticky", top:0, zIndex:1, background:T.tableHead }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0
                ? <tr><td colSpan={5} style={{ padding:32, textAlign:"center",
                    color:T.dim, fontSize:13 }}>Sin resultados</td></tr>
                : rows.map((cc, i) => (
                  <tr key={cc.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                    background: i%2===0 ? T.card : "#fafbfc", transition:"background .1s" }}
                    onMouseEnter={ev=>ev.currentTarget.style.background="#f0f9ff"}
                    onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?T.card:"#fafbfc"}>
                    <td style={{ padding:"10px 14px", fontSize:11, color:T.muted,
                      fontFamily:"var(--mono)", fontWeight:700 }}>{cc.id}</td>
                    <td style={{ padding:"10px 14px", fontSize:13, color:T.text, fontWeight:700 }}>{cc.nombre}</td>
                    <td style={{ padding:"10px 14px" }}><TipoChip tipo={cc.grupo} /></td>
                    <td style={{ padding:"10px 14px", fontSize:12, color:T.muted }}>{cc.empresa || "Todas"}</td>
                    <td style={{ padding:"10px 14px", textAlign:"right", whiteSpace:"nowrap" }}>
                      <button onClick={()=>setModal(cc)} style={{
                        background:"transparent", border:`1px solid ${T.cardBorder}`,
                        borderRadius:6, padding:"4px 10px", fontSize:11, color:T.muted,
                        cursor:"pointer", fontFamily:T.font, fontWeight:600, marginRight:6 }}>Editar</button>
                      <button onClick={()=>handleEliminar(cc)} style={{
                        background:"transparent", border:`1px solid #fecaca`,
                        borderRadius:6, padding:"4px 10px", fontSize:11, color:T.red,
                        cursor:"pointer", fontFamily:T.font, fontWeight:600 }}>Eliminar</button>
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <CCModal
          initial={modal === "nuevo" ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ─── TAB: Sociedades ─────────────────────────────────────────────────────────
const PAISES = [
  { value:"AR", label:"🇦🇷 Argentina", moneda:"ARS", bandera:"🇦🇷" },
  { value:"US", label:"🇺🇸 Estados Unidos", moneda:"USD", bandera:"🇺🇸" },
  { value:"ES", label:"🇪🇸 España", moneda:"EUR", bandera:"🇪🇸" },
  { value:"CO", label:"🇨🇴 Colombia", moneda:"COP", bandera:"🇨🇴" },
];

function SociedadModal({ initial, onClose, onSave }) {
  const blank = { id:"", nombre:"", pais:"AR", moneda:"ARS", bandera:"🇦🇷", discreta:false, nota:"" };
  const [form, setForm] = useState(initial ?? blank);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const canSave = !!form.nombre.trim() && !!form.id.trim();

  const handlePaisChange = (pais) => {
    const p = PAISES.find(p => p.value === pais);
    set("pais", pais);
    if (p) { set("moneda", p.moneda); set("bandera", p.bandera); }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:14, width:460,
        maxWidth:"97vw", maxHeight:"90vh", overflowY:"auto",
        boxShadow:"0 20px 60px rgba(0,0,0,.25)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ background:"#1e3a5f", padding:"18px 24px", display:"flex",
          justifyContent:"space-between", alignItems:"center", borderRadius:"14px 14px 0 0" }}>
          <div style={{ fontSize:16, fontWeight:900, color:"#93c5fd" }}>
            {initial ? "Editar Sociedad" : "Nueva Sociedad"}
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.4)", fontSize:18, cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <Input label="ID (único, sin espacios)" required value={form.id}
              onChange={v => set("id", v.toLowerCase().replace(/\s+/g,"-"))}
              placeholder="ej: nako, biggfit" disabled={!!initial} />
            <Input label="Nombre" required value={form.nombre} onChange={v=>set("nombre",v)}
              placeholder="Ej: Ñako SRL" />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 80px", gap:14 }}>
            <Select label="País" value={form.pais} onChange={handlePaisChange}
              options={PAISES.map(p=>({ value:p.value, label:p.label }))} />
            <Select label="Moneda" value={form.moneda} onChange={v=>set("moneda",v)}
              options={[
                {value:"ARS",label:"$ ARS"},{value:"USD",label:"U$D USD"},
                {value:"EUR",label:"€ EUR"},{value:"COP",label:"COP"},
              ]} />
            <Input label="Bandera" value={form.bandera ?? ""} onChange={v=>set("bandera",v)}
              placeholder="🇦🇷" />
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <input type="checkbox" id="discreta" checked={!!form.discreta}
              onChange={e=>set("discreta", e.target.checked)}
              style={{ width:16, height:16, cursor:"pointer" }} />
            <label htmlFor="discreta" style={{ fontSize:13, color:T.muted, cursor:"pointer" }}>
              Sociedad discreta (ocultar nombre en vistas públicas)
            </label>
          </div>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, paddingTop:8 }}>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" onClick={()=>{ onSave(initial ? {...form,id:initial.id} : form); onClose(); }} disabled={!canSave}>
              {initial ? "Guardar cambios" : "Crear sociedad"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabSociedades() {
  const [socs,    setSocs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null);

  const recargar = async () => {
    setLoading(true);
    try { setSocs(await fetchSociedades() ?? []); }
    catch { setSocs([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { recargar(); }, []);

  const handleSave = async (s) => {
    try {
      if (s.id && modal !== "nuevo") {
        const { id, ...patch } = s;
        await updateSociedad(id, patch);
      } else {
        await appendSociedad(s);
      }
      await recargar();
    } catch (e) { alert("Error: " + e.message); }
  };

  const handleEliminar = async (s) => {
    if (!confirm(`¿Eliminar "${s.nombre}"? Esto no elimina las cuentas asociadas.`)) return;
    try { await deleteSociedad(s.id); await recargar(); }
    catch (e) { alert("Error: " + e.message); }
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", minHeight:0 }}>
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:16, flexShrink:0 }}>
        <Btn variant="primary" onClick={()=>setModal("nuevo")}>+ Nueva Sociedad</Btn>
      </div>
      {loading ? (
        <div style={{ padding:"60px 24px", textAlign:"center", color:T.muted, fontSize:14 }}>Cargando…</div>
      ) : socs.length === 0 ? (
        <EmptyState icon="🏛" label="No hay sociedades registradas."
          action={<Btn variant="primary" onClick={()=>setModal("nuevo")}>Crear la primera</Btn>} />
      ) : (
        <div style={{ flex:1, background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
          boxShadow:T.shadow, overflow:"auto", minHeight:0 }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:T.tableHead }}>
                {["ID","Nombre","País","Moneda",""].map((h,i) => (
                  <th key={i} style={{ padding:"9px 14px", fontSize:11, fontWeight:700,
                    letterSpacing:".08em", textTransform:"uppercase",
                    color:T.tableHeadText, textAlign:"left",
                    position:"sticky", top:0, zIndex:1, background:T.tableHead }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {socs.map((s, i) => (
                <tr key={s.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                  background: i%2===0 ? T.card : "#fafbfc" }}
                  onMouseEnter={ev=>ev.currentTarget.style.background="#f0f9ff"}
                  onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?T.card:"#fafbfc"}>
                  <td style={{ padding:"9px 14px" }}>
                    <span style={{ fontFamily:"var(--mono)", fontSize:12, background:"#f3f4f6",
                      color:T.muted, borderRadius:6, padding:"2px 8px", fontWeight:700 }}>{s.id}</span>
                  </td>
                  <td style={{ padding:"9px 14px", fontSize:13, fontWeight:700, color:T.text }}>
                    {s.nombre}
                    {s.discreta && <span style={{ marginLeft:8, fontSize:10, color:T.dim }}>🔒 discreta</span>}
                  </td>
                  <td style={{ padding:"9px 14px", fontSize:12, color:T.muted }}>{s.pais ?? "—"}</td>
                  <td style={{ padding:"9px 14px" }}>
                    <span style={{ fontSize:11, background:"#f3f4f6", color:T.muted,
                      borderRadius:6, padding:"2px 8px", fontWeight:700 }}>{s.moneda}</span>
                  </td>
                  <td style={{ padding:"9px 14px", textAlign:"right", whiteSpace:"nowrap" }}>
                    <button onClick={()=>setModal(s)} style={{
                      background:"transparent", border:`1px solid ${T.cardBorder}`,
                      borderRadius:6, padding:"4px 10px", fontSize:11, color:T.muted,
                      cursor:"pointer", fontFamily:T.font, fontWeight:600, marginRight:6 }}>Editar</button>
                    <button onClick={()=>handleEliminar(s)} style={{
                      background:"transparent", border:"1px solid #fecaca",
                      borderRadius:6, padding:"4px 10px", fontSize:11, color:T.red,
                      cursor:"pointer", fontFamily:T.font, fontWeight:600 }}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && (
        <SociedadModal
          initial={modal === "nuevo" ? null : modal}
          onClose={()=>setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function PantallaMaestros({ activeTab = "sociedades" }) {
  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden",
      padding:"24px 32px 0", boxSizing:"border-box" }} className="fade maestros-screen">
      <style>{`
        .maestros-screen button:focus-visible {
          outline: 2px solid ${T.accent};
          outline-offset: 2px;
        }
      `}</style>
      {activeTab === "proveedores" ? <TabProveedores />
       : activeTab === "clientes"  ? <TabClientes />
       : activeTab === "cajas"     ? <TabCajas />
       : activeTab === "cuentas"   ? <TabCuentas />
       : activeTab === "cc"        ? <TabCC />
       : <TabSociedades />}
    </div>
  );
}
