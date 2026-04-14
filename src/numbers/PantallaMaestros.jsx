import { useState, useMemo } from "react";
import { T, Btn, Input, Select, PageHeader } from "./theme";
import {
  CENTROS_COSTO, CUENTAS, PROVEEDORES_SEED, CLIENTES_SEED,
} from "../data/numbersData";

// ─── Tabs de la pantalla ──────────────────────────────────────────────────────
const TABS = [
  { id:"proveedores",  label:"Proveedores",    icon:"🧾" },
  { id:"clientes",     label:"Clientes",       icon:"🏢" },
  { id:"cuentas",      label:"Plan de Cuentas",icon:"📋" },
  { id:"cc",           label:"Centros de Costo",icon:"🗂" },
];

// ─── Chip de tipo ─────────────────────────────────────────────────────────────
function TipoChip({ tipo }) {
  const cfg = {
    gasto:      { bg:"#fee2e2", color:"#dc2626", label:"Gasto"     },
    ingreso:    { bg:"#dcfce7", color:"#16a34a", label:"Ingreso"   },
    financiero: { bg:"#ede9fe", color:"#7c3aed", label:"Financiero"},
    marca:      { bg:"#f0f9ff", color:"#0369a1", label:"Marca"     },
    operaciones:{ bg:"#fef9c3", color:"#b45309", label:"Sede"      },
  }[tipo] ?? { bg:"#f3f4f6", color:"#374151", label: tipo };
  return (
    <span style={{ display:"inline-block", padding:"2px 9px", borderRadius:999,
      fontSize:10, fontWeight:700, background:cfg.bg, color:cfg.color,
      letterSpacing:".04em", whiteSpace:"nowrap" }}>{cfg.label}</span>
  );
}

// ─── Modal de nuevo/editar proveedor ─────────────────────────────────────────
function ProveedorModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(initial ?? {
    nombre:"", cuit:"", condIVA:"Responsable Inscripto",
    monedaDefault:"ARS", cuentaDefault:"", ccDefault:"", nota:"", activo:true,
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const cuentasGasto = CUENTAS.filter(c => c.tipo==="gasto" || c.tipo==="financiero");
  const canSave = !!form.nombre;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:14, width:480,
        maxWidth:"97vw", maxHeight:"90vh", overflowY:"auto",
        boxShadow:"0 20px 60px rgba(0,0,0,.25)" }}
        onClick={e=>e.stopPropagation()}>

        <div style={{ background:T.accentDark, padding:"18px 24px", display:"flex",
          justifyContent:"space-between", alignItems:"center", borderRadius:"14px 14px 0 0" }}>
          <div style={{ fontSize:16, fontWeight:900, color:T.accent }}>
            {initial ? "Editar Proveedor" : "Nuevo Proveedor"}
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.4)", fontSize:18, cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
          <Input label="Nombre / Razón Social" required value={form.nombre} onChange={v=>set("nombre",v)} placeholder="ACME SRL" />
          <Input label="CUIT / DNI" value={form.cuit} onChange={v=>set("cuit",v)} placeholder="30-00000000-0" />
          <Select label="Condición IVA" value={form.condIVA} onChange={v=>set("condIVA",v)}
            options={["Responsable Inscripto","Monotributo","Consumidor Final","Exento","No categorizado"]
              .map(o=>({value:o,label:o}))} />
          <Select label="Moneda habitual" value={form.monedaDefault} onChange={v=>set("monedaDefault",v)}
            options={[{value:"ARS",label:"ARS — Pesos"},{value:"USD",label:"USD — Dólares"},{value:"EUR",label:"EUR — Euros"}]} />
          <Select label="Cuenta default" value={form.cuentaDefault ?? ""} onChange={v=>set("cuentaDefault",v)}
            options={cuentasGasto.map(c=>({value:c.id,label:c.nombre}))} />
          <Select label="Centro de costo default" value={form.ccDefault ?? ""} onChange={v=>set("ccDefault",v)}
            options={[
              { value:"__marca", label:"── Marca / HQ ──", disabled:true },
              ...CENTROS_COSTO.filter(c=>c.grupo==="marca").map(c=>({value:c.id,label:c.nombre})),
              { value:"__ops", label:"── Sedes Operativas ──", disabled:true },
              ...CENTROS_COSTO.filter(c=>c.grupo==="operaciones").map(c=>({value:c.id,label:c.nombre})),
            ]} />
          <div>
            <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>Nota interna</label>
            <textarea value={form.nota ?? ""} onChange={e=>set("nota",e.target.value)}
              placeholder="Detalle adicional..."
              style={{ width:"100%", background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
                borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
                fontFamily:T.font, outline:"none", resize:"vertical", minHeight:60, boxSizing:"border-box" }} />
          </div>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, paddingTop:8 }}>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn variant="accent" onClick={()=>{ onSave({...form, id: initial?.id ?? `prov-${Date.now()}`}); onClose(); }} disabled={!canSave}>
              {initial ? "Guardar cambios" : "Crear proveedor"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de nuevo/editar cliente ───────────────────────────────────────────
function ClienteModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(initial ?? {
    nombre:"", cuit:"", condIVA:"Responsable Inscripto",
    monedaDefault:"ARS", cuentaDefault:"", ccDefault:"", nota:"", activo:true,
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const cuentasIngreso = CUENTAS.filter(c => c.tipo==="ingreso");
  const canSave = !!form.nombre;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:14, width:480,
        maxWidth:"97vw", maxHeight:"90vh", overflowY:"auto",
        boxShadow:"0 20px 60px rgba(0,0,0,.25)" }}
        onClick={e=>e.stopPropagation()}>

        <div style={{ background:"#1e3a5f", padding:"18px 24px", display:"flex",
          justifyContent:"space-between", alignItems:"center", borderRadius:"14px 14px 0 0" }}>
          <div style={{ fontSize:16, fontWeight:900, color:"#93c5fd" }}>
            {initial ? "Editar Cliente" : "Nuevo Cliente"}
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.4)", fontSize:18, cursor:"pointer" }}>✕</button>
        </div>

        <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
          <Input label="Nombre / Razón Social" required value={form.nombre} onChange={v=>set("nombre",v)} placeholder="Empresa SA" />
          <Input label="CUIT / DNI" value={form.cuit} onChange={v=>set("cuit",v)} placeholder="30-00000000-0" />
          <Select label="Condición IVA" value={form.condIVA} onChange={v=>set("condIVA",v)}
            options={["Responsable Inscripto","Monotributo","Consumidor Final","Exento","No categorizado"]
              .map(o=>({value:o,label:o}))} />
          <Select label="Moneda habitual" value={form.monedaDefault} onChange={v=>set("monedaDefault",v)}
            options={[{value:"ARS",label:"ARS — Pesos"},{value:"USD",label:"USD — Dólares"},{value:"EUR",label:"EUR — Euros"}]} />
          <Select label="Cuenta default" value={form.cuentaDefault ?? ""} onChange={v=>set("cuentaDefault",v)}
            options={cuentasIngreso.map(c=>({value:c.id,label:c.nombre}))} />
          <Select label="Centro de costo default" value={form.ccDefault ?? ""} onChange={v=>set("ccDefault",v)}
            options={[
              { value:"__marca", label:"── Marca / HQ ──", disabled:true },
              ...CENTROS_COSTO.filter(c=>c.grupo==="marca").map(c=>({value:c.id,label:c.nombre})),
              { value:"__ops", label:"── Sedes Operativas ──", disabled:true },
              ...CENTROS_COSTO.filter(c=>c.grupo==="operaciones").map(c=>({value:c.id,label:c.nombre})),
            ]} />
          <div>
            <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>Nota interna</label>
            <textarea value={form.nota ?? ""} onChange={e=>set("nota",e.target.value)}
              placeholder="Detalle adicional..."
              style={{ width:"100%", background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
                borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
                fontFamily:T.font, outline:"none", resize:"vertical", minHeight:60, boxSizing:"border-box" }} />
          </div>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, paddingTop:8 }}>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" onClick={()=>{ onSave({...form, id: initial?.id ?? `cli-${Date.now()}`}); onClose(); }} disabled={!canSave}>
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
  const [proveedores, setProveedores] = useState(PROVEEDORES_SEED);
  const [busqueda, setBusqueda]       = useState("");
  const [modal, setModal]             = useState(null); // null | "nuevo" | proveedor-object

  const rows = useMemo(() => {
    const q = busqueda.toLowerCase();
    return !q ? proveedores : proveedores.filter(p =>
      p.nombre.toLowerCase().includes(q) || (p.cuit||"").includes(q) || (p.nota||"").toLowerCase().includes(q)
    );
  }, [busqueda, proveedores]);

  const handleSave = (p) => {
    setProveedores(prev => {
      const idx = prev.findIndex(x=>x.id===p.id);
      if (idx >= 0) { const a=[...prev]; a[idx]=p; return a; }
      return [p, ...prev];
    });
  };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
          placeholder="Buscar proveedor..."
          style={{ flex:1, maxWidth:340, background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
            borderRadius:8, padding:"7px 12px", fontSize:13, color:T.text, outline:"none", fontFamily:T.font }} />
        <Btn variant="accent" onClick={()=>setModal("nuevo")}>+ Nuevo Proveedor</Btn>
      </div>

      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
        boxShadow:T.shadow, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:T.tableHead }}>
              {["Nombre","CUIT","Cond. IVA","Moneda","Cuenta Default","Nota"].map(h=>(
                <th key={h} style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                  letterSpacing:".08em", textTransform:"uppercase", color:T.tableHeadText, textAlign:"left" }}>{h}</th>
              ))}
              <th style={{ padding:"10px 14px" }} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={7} style={{ padding:32, textAlign:"center", color:T.dim, fontSize:13 }}>Sin resultados</td></tr>
              : rows.map((p, i) => {
                const cuentaNombre = CUENTAS.find(c=>c.id===p.cuentaDefault)?.nombre ?? p.cuentaDefault ?? "—";
                return (
                  <tr key={p.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                    background: i%2===0 ? T.card : "#fafbfc", transition:"background .1s" }}
                    onMouseEnter={ev=>ev.currentTarget.style.background="#f0f9ff"}
                    onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?T.card:"#fafbfc"}>
                    <td style={{ padding:"10px 14px", fontSize:13, color:T.text, fontWeight:700 }}>{p.nombre}</td>
                    <td style={{ padding:"10px 14px", fontSize:12, color:T.muted, fontFamily:"var(--mono)" }}>{p.cuit || "—"}</td>
                    <td style={{ padding:"10px 14px", fontSize:12, color:T.muted }}>{p.condIVA || "—"}</td>
                    <td style={{ padding:"10px 14px" }}>
                      <span style={{ fontSize:11, background:"#f3f4f6", color:T.muted,
                        borderRadius:6, padding:"2px 8px", fontWeight:700 }}>{p.monedaDefault || "ARS"}</span>
                    </td>
                    <td style={{ padding:"10px 14px", fontSize:12, color:T.muted }}>{cuentaNombre}</td>
                    <td style={{ padding:"10px 14px", fontSize:12, color:T.dim, maxWidth:200 }}>{p.nota || "—"}</td>
                    <td style={{ padding:"10px 14px", textAlign:"right" }}>
                      <button onClick={()=>setModal(p)} style={{
                        background:"transparent", border:`1px solid ${T.cardBorder}`,
                        borderRadius:6, padding:"4px 10px", fontSize:11, color:T.muted,
                        cursor:"pointer", fontFamily:T.font, fontWeight:600 }}>Editar</button>
                    </td>
                  </tr>
                );
              })
            }
          </tbody>
        </table>
      </div>

      {modal && (
        <ProveedorModal
          initial={modal === "nuevo" ? null : modal}
          onClose={()=>setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ─── TAB: Clientes ────────────────────────────────────────────────────────────
function TabClientes() {
  const [clientes, setClientes] = useState(CLIENTES_SEED);
  const [busqueda, setBusqueda] = useState("");
  const [modal, setModal]       = useState(null);

  const rows = useMemo(() => {
    const q = busqueda.toLowerCase();
    return !q ? clientes : clientes.filter(c =>
      c.nombre.toLowerCase().includes(q) || (c.cuit||"").includes(q)
    );
  }, [busqueda, clientes]);

  const handleSave = (c) => {
    setClientes(prev => {
      const idx = prev.findIndex(x=>x.id===c.id);
      if (idx >= 0) { const a=[...prev]; a[idx]=c; return a; }
      return [c, ...prev];
    });
  };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
          placeholder="Buscar cliente..."
          style={{ flex:1, maxWidth:340, background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
            borderRadius:8, padding:"7px 12px", fontSize:13, color:T.text, outline:"none", fontFamily:T.font }} />
        <Btn variant="primary" onClick={()=>setModal("nuevo")}>+ Nuevo Cliente</Btn>
      </div>

      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
        boxShadow:T.shadow, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:T.tableHead }}>
              {["Nombre","CUIT","Cond. IVA","Moneda","Cuenta Default","Nota"].map(h=>(
                <th key={h} style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                  letterSpacing:".08em", textTransform:"uppercase", color:T.tableHeadText, textAlign:"left" }}>{h}</th>
              ))}
              <th style={{ padding:"10px 14px" }} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={7} style={{ padding:32, textAlign:"center", color:T.dim, fontSize:13 }}>Sin resultados</td></tr>
              : rows.map((c, i) => {
                const cuentaNombre = CUENTAS.find(x=>x.id===c.cuentaDefault)?.nombre ?? c.cuentaDefault ?? "—";
                return (
                  <tr key={c.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                    background: i%2===0 ? T.card : "#fafbfc", transition:"background .1s" }}
                    onMouseEnter={ev=>ev.currentTarget.style.background="#f0fff4"}
                    onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?T.card:"#fafbfc"}>
                    <td style={{ padding:"10px 14px", fontSize:13, color:T.text, fontWeight:700 }}>{c.nombre}</td>
                    <td style={{ padding:"10px 14px", fontSize:12, color:T.muted, fontFamily:"var(--mono)" }}>{c.cuit || "—"}</td>
                    <td style={{ padding:"10px 14px", fontSize:12, color:T.muted }}>{c.condIVA || "—"}</td>
                    <td style={{ padding:"10px 14px" }}>
                      <span style={{ fontSize:11, background:"#f3f4f6", color:T.muted,
                        borderRadius:6, padding:"2px 8px", fontWeight:700 }}>{c.monedaDefault || "ARS"}</span>
                    </td>
                    <td style={{ padding:"10px 14px", fontSize:12, color:T.muted }}>{cuentaNombre}</td>
                    <td style={{ padding:"10px 14px", fontSize:12, color:T.dim, maxWidth:200 }}>{c.nota || "—"}</td>
                    <td style={{ padding:"10px 14px", textAlign:"right" }}>
                      <button onClick={()=>setModal(c)} style={{
                        background:"transparent", border:`1px solid ${T.cardBorder}`,
                        borderRadius:6, padding:"4px 10px", fontSize:11, color:T.muted,
                        cursor:"pointer", fontFamily:T.font, fontWeight:600 }}>Editar</button>
                    </td>
                  </tr>
                );
              })
            }
          </tbody>
        </table>
      </div>

      {modal && (
        <ClienteModal
          initial={modal === "nuevo" ? null : modal}
          onClose={()=>setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ─── TAB: Plan de cuentas ─────────────────────────────────────────────────────
function TabCuentas() {
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [busqueda, setBusqueda]     = useState("");

  const rows = useMemo(() => CUENTAS.filter(c => {
    const matchT = filtroTipo === "todos" || c.tipo === filtroTipo;
    const q = busqueda.toLowerCase();
    const matchQ = !q || c.nombre.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
    return matchT && matchQ;
  }), [filtroTipo, busqueda]);

  return (
    <div>
      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:16, flexWrap:"wrap" }}>
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
          placeholder="Buscar cuenta..."
          style={{ flex:1, maxWidth:340, background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
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
        <span style={{ fontSize:12, color:T.dim, marginLeft:"auto" }}>{rows.length} cuentas</span>
      </div>

      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
        boxShadow:T.shadow, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:T.tableHead }}>
              {["Tipo","Nombre","ID","Centros de Costo permitidos"].map(h=>(
                <th key={h} style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                  letterSpacing:".08em", textTransform:"uppercase", color:T.tableHeadText, textAlign:"left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={4} style={{ padding:32, textAlign:"center", color:T.dim, fontSize:13 }}>Sin resultados</td></tr>
              : rows.map((c, i) => (
                <tr key={c.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                  background: i%2===0 ? T.card : "#fafbfc" }}>
                  <td style={{ padding:"9px 14px" }}><TipoChip tipo={c.tipo} /></td>
                  <td style={{ padding:"9px 14px", fontSize:13, color:T.text, fontWeight:600 }}>{c.nombre}</td>
                  <td style={{ padding:"9px 14px", fontSize:11, color:T.dim, fontFamily:"var(--mono)" }}>{c.id}</td>
                  <td style={{ padding:"9px 14px", fontSize:11, color:T.muted }}>
                    {c.centrosCostoPermitidos
                      ? c.centrosCostoPermitidos.length <= 4
                        ? c.centrosCostoPermitidos.join(", ")
                        : `${c.centrosCostoPermitidos.slice(0,3).join(", ")} +${c.centrosCostoPermitidos.length-3} más`
                      : <span style={{ color:T.dim, fontStyle:"italic" }}>Cualquiera</span>}
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── TAB: Centros de costo ────────────────────────────────────────────────────
function TabCC() {
  const sedes = CENTROS_COSTO.filter(c=>c.grupo==="operaciones");
  const hq    = CENTROS_COSTO.filter(c=>c.grupo==="marca");

  function Group({ title, items, color }) {
    return (
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:12, fontWeight:800, color:T.muted, letterSpacing:".1em",
          textTransform:"uppercase", marginBottom:10 }}>{title}</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(200px, 1fr))", gap:10 }}>
          {items.map(cc => (
            <div key={cc.id} style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
              borderRadius:T.radius, padding:"12px 16px", boxShadow:T.shadow,
              display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:color, flexShrink:0 }} />
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:T.text }}>{cc.nombre}</div>
                <div style={{ fontSize:10, color:T.dim, fontFamily:"var(--mono)", marginTop:2 }}>{cc.id}</div>
              </div>
              <span style={{ marginLeft:"auto" }}>
                <TipoChip tipo={cc.grupo} />
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <Group title={`Sedes Operativas (${sedes.length})`} items={sedes} color={T.orange} />
      <Group title={`Marca / HQ (${hq.length})`} items={hq} color={T.blue} />
      <div style={{ padding:"12px 16px", background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
        borderRadius:8, fontSize:12, color:T.muted, display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:16 }}>ℹ️</span>
        Para agregar o modificar centros de costo, contactar al administrador del sistema.
        Los centros de costo están sincronizados con el maestro de sedes.
      </div>
    </div>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function PantallaMaestros() {
  const [activeTab, setActiveTab] = useState("proveedores");

  const tabContent = {
    proveedores: <TabProveedores />,
    clientes:    <TabClientes />,
    cuentas:     <TabCuentas />,
    cc:          <TabCC />,
  };

  return (
    <div style={{ padding:"28px 32px", maxWidth:1200 }} className="fade">
      <PageHeader
        title="Maestros"
        subtitle="Plan de Cuentas · Centros de Costo · Proveedores · Clientes"
      />

      {/* Tabs */}
      <div style={{ display:"flex", gap:2, marginBottom:24, borderBottom:`2px solid ${T.cardBorder}` }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{
            background: "transparent",
            border: "none",
            borderBottom: `3px solid ${activeTab===tab.id ? T.accentDark : "transparent"}`,
            padding:"10px 18px",
            fontSize:13, fontWeight: activeTab===tab.id ? 700 : 400,
            color: activeTab===tab.id ? T.text : T.muted,
            cursor:"pointer", fontFamily:T.font,
            display:"flex", alignItems:"center", gap:7,
            marginBottom:-2, transition:"all .12s",
          }}>
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {tabContent[activeTab]}
    </div>
  );
}
