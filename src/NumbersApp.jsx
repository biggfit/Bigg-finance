import { useState, useMemo } from "react";
import "./lib/styles";
import { CENTROS_COSTO, CUENTAS, PROVEEDORES_SEED, CLIENTES_SEED, CUENTAS_PASIVO } from "./data/numbersData";

// ─── THEME ────────────────────────────────────────────────────────────────────
const T = {
  sidebar:    "#16181a",
  sidebarBorder: "rgba(173,255,25,.35)",
  bg:         "#f0f2f5",
  card:       "#ffffff",
  cardBorder: "#e4e7ec",
  text:       "#111827",
  muted:      "#6b7280",
  dim:        "#9ca3af",
  accent:     "#ADFF19",
  accentDark: "#1e2022",
  green:      "#16a34a",
  greenBg:    "#dcfce7",
  red:        "#dc2626",
  redBg:      "#fee2e2",
  orange:     "#d97706",
  orangeBg:   "#fef3c7",
  blue:       "#2563eb",
  blueBg:     "#dbeafe",
  tableHead:  "#1e2022",
  tableHeadText: "#ADFF19",
  shadow:     "0 1px 4px rgba(0,0,0,.08), 0 2px 12px rgba(0,0,0,.05)",
  shadowMd:   "0 4px 20px rgba(0,0,0,.10)",
  radius:     10,
  font:       "var(--font)",
};

// ─── DATOS DE PRUEBA — Egresos ─────────────────────────────────────────────
const EGRESOS_SAMPLE = [
  { id: "EG-001", fecha: "03/04/2026", vto: "03/04/2026", proveedor: "UTEDYC",                 cuit: "30-53160227-3", cuenta: "Obra Social",              cc: "HQ - Recursos Humanos", moneda: "ARS", importe: 485000,    estado: "pagado"   },
  { id: "EG-002", fecha: "01/04/2026", vto: "10/04/2026", proveedor: "HOLDED TECHNOLOGIES",     cuit: "",             cuenta: "Licencias de Software",      cc: "HQ - Administracion",  moneda: "USD", importe: 312,       estado: "a_pagar"  },
  { id: "EG-003", fecha: "01/04/2026", vto: "05/04/2026", proveedor: "Banco Galicia",           cuit: "",             cuenta: "Gastos Bancarios",           cc: "HQ - Administracion",  moneda: "ARS", importe: 33200,     estado: "vencido"  },
  { id: "EG-004", fecha: "01/04/2026", vto: "30/04/2026", proveedor: "Propietario Recoleta",    cuit: "",             cuenta: "Alquiler",                   cc: "01 - Recoleta",         moneda: "ARS", importe: 2100000,   estado: "a_pagar"  },
  { id: "EG-005", fecha: "31/03/2026", vto: "31/03/2026", proveedor: "AFIP",                   cuit: "33-69345023-9",cuenta: "IIBB",                       cc: "HQ - Impuestos",        moneda: "ARS", importe: 198400,    estado: "pagado"   },
  { id: "EG-006", fecha: "28/03/2026", vto: "10/04/2026", proveedor: "NEW RELIC",              cuit: "",             cuenta: "Servidores y Alojamiento Web",cc: "HQ - Infraestructura IT",moneda:"USD", importe: 890,       estado: "a_pagar"  },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmtMoney = (n, cur = "ARS") => {
  const sym = cur === "USD" ? "U$D" : cur === "EUR" ? "€" : "$";
  return `${sym} ${n.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;
};

const ESTADO_CFG = {
  pagado:  { label: "Pagado",   bg: "#dcfce7", color: "#16a34a" },
  a_pagar: { label: "A Pagar",  bg: "#fef9c3", color: "#ca8a04" },
  vencido: { label: "Vencido",  bg: "#fee2e2", color: "#dc2626" },
};

// ─── ATOMS ────────────────────────────────────────────────────────────────────
function Badge({ estado }) {
  const cfg = ESTADO_CFG[estado] ?? { label: estado, bg: "#f3f4f6", color: "#374151" };
  return (
    <span style={{ display:"inline-block", padding:"2px 10px", borderRadius:999,
      fontSize:11, fontWeight:700, background:cfg.bg, color:cfg.color,
      letterSpacing:".04em" }}>
      {cfg.label}
    </span>
  );
}

function SummaryCard({ label, value, color, sub }) {
  return (
    <div style={{ background: T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
      padding:"16px 20px", boxShadow:T.shadow, flex:1, minWidth:140 }}>
      <div style={{ fontSize:11, color:T.muted, fontWeight:600, letterSpacing:".06em",
        textTransform:"uppercase", marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:800, color: color ?? T.text, fontFamily:"var(--mono)" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize:11, color:T.dim, marginTop:4 }}>{sub}</div>}
    </div>
  );
}

// ─── PANTALLA EGRESOS ─────────────────────────────────────────────────────────
function PantallaEgresos() {
  const [busqueda, setBusqueda]   = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [showFiltros, setShowFiltros]  = useState(false);
  const [showNuevo, setShowNuevo]      = useState(false);

  const rows = useMemo(() => EGRESOS_SAMPLE.filter(e => {
    const matchEstado = filtroEstado === "todos" || e.estado === filtroEstado;
    const q = busqueda.toLowerCase();
    const matchQ = !q || e.proveedor.toLowerCase().includes(q) || e.cuenta.toLowerCase().includes(q) || e.cc.toLowerCase().includes(q);
    return matchEstado && matchQ;
  }), [busqueda, filtroEstado]);

  const totales = useMemo(() => ({
    total:   EGRESOS_SAMPLE.reduce((s,e) => s + (e.moneda==="ARS" ? e.importe : 0), 0),
    pagado:  EGRESOS_SAMPLE.filter(e=>e.estado==="pagado").reduce((s,e)=>s+(e.moneda==="ARS"?e.importe:0),0),
    aPagar:  EGRESOS_SAMPLE.filter(e=>e.estado==="a_pagar").reduce((s,e)=>s+(e.moneda==="ARS"?e.importe:0),0),
    vencido: EGRESOS_SAMPLE.filter(e=>e.estado==="vencido").reduce((s,e)=>s+(e.moneda==="ARS"?e.importe:0),0),
  }), []);

  return (
    <div style={{ padding:"28px 32px", maxWidth:1200 }} className="fade">

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:24, fontWeight:900, color:T.text, margin:0, letterSpacing:"-.02em" }}>Egresos</h1>
          <p style={{ fontSize:13, color:T.muted, margin:"4px 0 0" }}>Facturas recibidas, gastos y pagos a proveedores</p>
        </div>
        <button onClick={()=>setShowNuevo(true)} style={{
          background:T.accent, color:T.accentDark, border:"none", borderRadius:999,
          padding:"9px 20px", fontSize:13, fontWeight:800, cursor:"pointer",
          display:"flex", alignItems:"center", gap:7, letterSpacing:".03em",
          boxShadow:"0 2px 8px rgba(173,255,25,.3)",
        }}>
          + Nuevo Egreso
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display:"flex", gap:12, marginBottom:24, flexWrap:"wrap" }}>
        <SummaryCard label="Cantidad" value={EGRESOS_SAMPLE.length} sub="comprobantes" />
        <SummaryCard label="Pagado"   value={fmtMoney(totales.pagado)}  color={T.green} />
        <SummaryCard label="A Pagar"  value={fmtMoney(totales.aPagar)}  color={T.orange} />
        <SummaryCard label="Vencido"  value={fmtMoney(totales.vencido)} color={T.red} />
        <SummaryCard label="Total ARS" value={fmtMoney(totales.total)}  color={T.blue} />
      </div>

      {/* Barra filtros */}
      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
        padding:"12px 16px", marginBottom:16, boxShadow:T.shadow,
        display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>

        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)}
          placeholder="Buscar proveedor, cuenta, CC..."
          style={{ flex:1, minWidth:200, background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
            borderRadius:8, padding:"7px 12px", fontSize:13, color:T.text,
            outline:"none", fontFamily:T.font }} />

        {["todos","pagado","a_pagar","vencido"].map(e=>(
          <button key={e} onClick={()=>setFiltroEstado(e)} style={{
            background: filtroEstado===e ? T.accentDark : "#f3f4f6",
            color: filtroEstado===e ? T.accent : T.muted,
            border: filtroEstado===e ? `1px solid ${T.accentDark}` : `1px solid ${T.cardBorder}`,
            borderRadius:999, padding:"6px 14px", fontSize:12, fontWeight:700,
            cursor:"pointer", letterSpacing:".04em",
          }}>
            {e==="todos"?"Todos":ESTADO_CFG[e]?.label}
          </button>
        ))}

        <button onClick={()=>setShowFiltros(v=>!v)} style={{
          background: showFiltros ? "#f3f4f6" : "transparent",
          border:`1px solid ${T.cardBorder}`, borderRadius:8,
          padding:"7px 12px", fontSize:12, color:T.muted, cursor:"pointer",
          display:"flex", alignItems:"center", gap:5, fontFamily:T.font,
        }}>
          ⚙ Filtros {showFiltros ? "▲" : "▼"}
        </button>
      </div>

      {/* Panel filtros avanzados */}
      {showFiltros && (
        <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
          padding:"16px 20px", marginBottom:16, boxShadow:T.shadow,
          display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }} className="fade">
          {[["Proveedor",""],["Centro de Costo",""],["Cuenta",""]].map(([label])=>(
            <div key={label}>
              <label style={{fontSize:11,color:T.muted,fontWeight:600,display:"block",marginBottom:4}}>{label}</label>
              <select style={{ width:"100%", background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
                borderRadius:8, padding:"7px 10px", fontSize:13, color:T.text,
                fontFamily:T.font, outline:"none" }}>
                <option>Todos</option>
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Tabla */}
      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
        boxShadow:T.shadow, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:T.tableHead }}>
              {["Estado","ID","Emisión","Vencimiento","Proveedor","Cuenta","Centro de Costo","Importe"].map(h=>(
                <th key={h} style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                  letterSpacing:".08em", textTransform:"uppercase",
                  color:T.tableHeadText, textAlign:"left", whiteSpace:"nowrap",
                  borderBottom:`2px solid rgba(173,255,25,.2)` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} style={{ padding:32, textAlign:"center", color:T.dim, fontSize:13 }}>
                Sin resultados
              </td></tr>
            ) : rows.map((e,i)=>(
              <tr key={e.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                background: i%2===0 ? T.card : "#fafbfc",
                transition:"background .1s", cursor:"pointer" }}
                onMouseEnter={ev=>ev.currentTarget.style.background="#f0f9ff"}
                onMouseLeave={ev=>ev.currentTarget.style.background=i%2===0?T.card:"#fafbfc"}>
                <td style={{ padding:"10px 14px" }}><Badge estado={e.estado} /></td>
                <td style={{ padding:"10px 14px", fontSize:12, color:T.blue, fontWeight:700, fontFamily:"var(--mono)" }}>{e.id}</td>
                <td style={{ padding:"10px 14px", fontSize:13, color:T.text }}>{e.fecha}</td>
                <td style={{ padding:"10px 14px", fontSize:13, color: e.estado==="vencido" ? T.red : T.text, fontWeight: e.estado==="vencido" ? 700 : 400 }}>{e.vto}</td>
                <td style={{ padding:"10px 14px", fontSize:13, color:T.text, fontWeight:600 }}>{e.proveedor}</td>
                <td style={{ padding:"10px 14px", fontSize:12, color:T.muted }}>{e.cuenta}</td>
                <td style={{ padding:"10px 14px" }}>
                  <span style={{ fontSize:11, background:"#f3f4f6", color:T.muted,
                    borderRadius:6, padding:"2px 8px", fontWeight:600 }}>{e.cc}</span>
                </td>
                <td style={{ padding:"10px 14px", fontSize:13, fontFamily:"var(--mono)",
                  fontWeight:700, color:T.text, textAlign:"right" }}>
                  {fmtMoney(e.importe, e.moneda)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal nuevo egreso (placeholder) */}
      {showNuevo && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.4)", zIndex:300,
          display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={()=>setShowNuevo(false)}>
          <div className="fade" style={{ background:T.card, borderRadius:14, padding:32,
            width:520, boxShadow:T.shadowMd }} onClick={e=>e.stopPropagation()}>
            <h2 style={{ fontSize:18, fontWeight:800, color:T.text, margin:"0 0 20px" }}>Nuevo Egreso</h2>
            <p style={{ fontSize:13, color:T.muted, lineHeight:1.6, margin:"0 0 24px" }}>
              El formulario guiado de carga de egresos se implementa en la siguiente fase.<br/>
              Incluirá: tipo de operación, proveedor, cuenta, centro de costo y medio de pago.
            </p>
            <button onClick={()=>setShowNuevo(false)} style={{
              background:T.accentDark, color:T.accent, border:"none", borderRadius:999,
              padding:"8px 20px", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PLACEHOLDER genérico para secciones en construcción ─────────────────────
function Placeholder({ label, descripcion, features }) {
  return (
    <div className="fade" style={{ padding:"40px 32px", maxWidth:680 }}>
      <h1 style={{ fontSize:24, fontWeight:900, color:T.text, margin:"0 0 8px", letterSpacing:"-.02em" }}>{label}</h1>
      <p style={{ fontSize:13, color:T.muted, margin:"0 0 28px" }}>{descripcion}</p>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:28 }}>
        {features.map((f,i)=>(
          <div key={i} style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
            borderRadius:T.radius, padding:"14px 16px", boxShadow:T.shadow,
            display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:T.accentDark, flexShrink:0 }} />
            <span style={{ fontSize:13, color:T.muted }}>{f}</span>
          </div>
        ))}
      </div>
      <div style={{ display:"inline-flex", alignItems:"center", gap:8,
        background:"#f0fdf4", border:"1px solid #bbf7d0",
        borderRadius:999, padding:"6px 14px",
        fontSize:11, fontWeight:700, color:"#16a34a", letterSpacing:".08em" }}>
        <div style={{ width:6, height:6, borderRadius:"50%", background:"#16a34a",
          animation:"pulse 1.5s ease-in-out infinite" }} />
        En desarrollo
      </div>
    </div>
  );
}

// ─── SECCIONES ────────────────────────────────────────────────────────────────
const SECTIONS = [
  { id:"dashboard", label:"Dashboard", icon:"◈",
    descripcion:"Vista general de KPIs financieros, alertas y estado de cuentas.",
    features:["Saldos por empresa y moneda","Alertas de facturas vencidas","Resumen de flujo de fondos","KPIs del mes"] },
  { id:"ingresos",  label:"Ingresos",  icon:"↑",
    descripcion:"Facturas emitidas a clientes, cobros y cuentas a cobrar.",
    features:["Facturas emitidas a clientes","Seguimiento de cobros","Cuentas a cobrar por vencimiento","Historial por cliente"] },
  { id:"egresos",   label:"Egresos",   icon:"↓", component: PantallaEgresos },
  { id:"tesoreria", label:"Tesorería", icon:"⬡",
    descripcion:"Cuentas bancarias, movimientos y conciliación bancaria.",
    features:["ABM de cuentas bancarias","Movimientos de caja y banco","Conciliación de extracto bancario","Posición por moneda"] },
  { id:"reportes",  label:"Reportes",  icon:"▦",
    descripcion:"P&L, Cash Flow y reconciliación de resultados.",
    features:["Estado de Resultados (P&L)","Flujo de fondos","Reconciliación de resultados","Filtros por empresa, período y CC"] },
];

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────
export default function NumbersApp({ onGoToFranquicias }) {
  const [activeSection, setActiveSection] = useState("egresos");
  const [showMaestros,  setShowMaestros]  = useState(false);

  const section = SECTIONS.find(s => s.id === activeSection);

  return (
    <div style={{ display:"flex", height:"100vh", overflow:"hidden", background:T.bg, fontFamily:T.font }}>

      {/* ── SIDEBAR ── */}
      <div style={{ width:210, flexShrink:0, background:T.sidebar,
        borderRight:`2px solid ${T.sidebarBorder}`,
        display:"flex", flexDirection:"column", overflow:"hidden" }}>

        {/* Logo */}
        <div style={{ padding:"22px 18px 14px" }}>
          <div style={{ fontSize:10, fontWeight:800, letterSpacing:".18em",
            color:"rgba(255,255,255,.35)", textTransform:"uppercase", marginBottom:2 }}>BIGG</div>
          <div style={{ fontSize:20, fontWeight:900, letterSpacing:"-.02em",
            color:T.accent, lineHeight:1 }}>Numbers</div>
        </div>

        <div style={{ height:1, background:"rgba(255,255,255,.07)", margin:"0 14px 8px" }} />

        {/* Nav */}
        <nav style={{ flex:1, display:"flex", flexDirection:"column", gap:1, padding:"4px 8px", overflowY:"auto" }}>
          {SECTIONS.map(s => {
            const active = activeSection === s.id;
            return (
              <button key={s.id} onClick={()=>setActiveSection(s.id)} style={{
                background: active ? "rgba(173,255,25,.1)" : "transparent",
                border:"none",
                borderLeft:`3px solid ${active ? T.accent : "transparent"}`,
                borderRadius:"0 8px 8px 0",
                color: active ? T.accent : "rgba(255,255,255,.5)",
                textAlign:"left", padding:"9px 12px",
                fontSize:13, fontFamily:T.font, cursor:"pointer",
                display:"flex", alignItems:"center", gap:9,
                transition:"all .12s", fontWeight: active ? 700 : 400,
              }}>
                <span style={{ fontSize:14 }}>{s.icon}</span>
                {s.label}
              </button>
            );
          })}
        </nav>

        {/* → Franquicias */}
        <div style={{ padding:"8px", borderTop:"1px solid rgba(255,255,255,.07)" }}>
          <button onClick={onGoToFranquicias} style={{
            width:"100%", background:"rgba(173,255,25,.05)",
            border:`1px solid rgba(173,255,25,.2)`, borderRadius:8,
            color:T.accent, padding:"9px 12px", fontSize:12,
            fontFamily:T.font, cursor:"pointer", fontWeight:700,
            display:"flex", alignItems:"center", gap:8, transition:"all .12s",
          }}
          onMouseEnter={e=>e.currentTarget.style.background="rgba(173,255,25,.12)"}
          onMouseLeave={e=>e.currentTarget.style.background="rgba(173,255,25,.05)"}>
            <span>🏪</span>
            Bigg Franquicias
            <span style={{ marginLeft:"auto", fontSize:10 }}>→</span>
          </button>
        </div>

        {/* Maestros */}
        <div style={{ padding:"8px", borderTop:"1px solid rgba(255,255,255,.07)", marginTop:4 }}>
          <button onClick={()=>setShowMaestros(true)} style={{
            width:"100%", background:"transparent", border:"none", borderRadius:8,
            color:"rgba(255,255,255,.4)", padding:"8px 12px", fontSize:12,
            fontFamily:T.font, cursor:"pointer", fontWeight:600,
            display:"flex", alignItems:"center", gap:8, transition:"all .12s",
          }}
          onMouseEnter={e=>e.currentTarget.style.color="rgba(255,255,255,.8)"}
          onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,.4)"}>
            <span>⚙</span>
            Maestros
          </button>
        </div>

      </div>

      {/* ── CONTENIDO ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>

        {/* Topbar */}
        <div style={{ background:T.card, borderBottom:`1px solid ${T.cardBorder}`,
          padding:"10px 24px", display:"flex", alignItems:"center", gap:10,
          flexShrink:0, boxShadow:"0 1px 3px rgba(0,0,0,.06)" }}>
          <span style={{ fontSize:12, fontWeight:700, color:T.muted,
            letterSpacing:".08em", textTransform:"uppercase" }}>BIGG Numbers</span>
          <span style={{ fontSize:12, color:T.dim }}>›</span>
          <span style={{ fontSize:12, fontWeight:700, color:T.text }}>{section?.label}</span>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:"auto" }}>
          {section?.component
            ? <section.component />
            : section && <Placeholder label={section.label} descripcion={section.descripcion} features={section.features} />
          }
        </div>

      </div>

      {/* Modal Maestros placeholder */}
      {showMaestros && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.4)", zIndex:300,
          display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={()=>setShowMaestros(false)}>
          <div className="fade" style={{ background:T.card, borderRadius:14, padding:32,
            width:480, textAlign:"center", boxShadow:T.shadowMd }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:32, marginBottom:16 }}>📋</div>
            <h2 style={{ fontSize:18, fontWeight:800, color:T.text, margin:"0 0 8px" }}>Maestros</h2>
            <p style={{ fontSize:13, color:T.muted, lineHeight:1.6, margin:"0 0 24px" }}>
              Plan de Cuentas · Centros de Costo · Proveedores<br/>Cuentas Bancarias — En desarrollo.
            </p>
            <button className="ghost" onClick={()=>setShowMaestros(false)}>Cerrar</button>
          </div>
        </div>
      )}

    </div>
  );
}
