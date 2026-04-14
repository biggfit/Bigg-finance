import { useState } from "react";
import "./lib/styles";
import { T } from "./numbers/theme";
import PantallaDashboard from "./numbers/PantallaDashboard";
import PantallaEgresos   from "./numbers/PantallaEgresos";
import PantallaIngresos  from "./numbers/PantallaIngresos";
import PantallaMaestros  from "./numbers/PantallaMaestros";

// ─── Secciones del sidebar ────────────────────────────────────────────────────
const SECTIONS = [
  { id:"dashboard", label:"Dashboard", icon:"◈", component: PantallaDashboard },
  { id:"ingresos",  label:"Ingresos",  icon:"↑", component: PantallaIngresos  },
  { id:"egresos",   label:"Egresos",   icon:"↓", component: PantallaEgresos   },
  { id:"maestros",  label:"Maestros",  icon:"⚙", component: PantallaMaestros  },
  {
    id:"tesoreria", label:"Tesorería", icon:"⬡",
    placeholder: { desc:"Cuentas bancarias, movimientos y conciliación bancaria.",
      features:["ABM de cuentas bancarias","Movimientos de caja y banco","Conciliación de extracto","Posición por moneda"] }
  },
  {
    id:"reportes",  label:"Reportes",  icon:"▦",
    placeholder: { desc:"P&L, Cash Flow y reconciliación de resultados.",
      features:["Estado de Resultados (P&L)","Flujo de fondos","Reconciliación de resultados","Filtros por empresa y período"] }
  },
];

function Placeholder({ section }) {
  return (
    <div className="fade" style={{ padding:"40px 32px", maxWidth:680 }}>
      <h1 style={{ fontSize:24, fontWeight:900, color:T.text, margin:"0 0 8px", letterSpacing:"-.02em" }}>{section.label}</h1>
      <p style={{ fontSize:13, color:T.muted, margin:"0 0 28px" }}>{section.placeholder.desc}</p>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:28 }}>
        {section.placeholder.features.map((f,i)=>(
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

export default function NumbersApp({ onGoToFranquicias }) {
  const [activeId, setActiveId] = useState("dashboard");

  const section = SECTIONS.find(s => s.id === activeId);

  return (
    <div style={{ display:"flex", height:"100vh", overflow:"hidden", background:T.bg, fontFamily:T.font }}>

      {/* ── SIDEBAR ── */}
      <div style={{ width:210, flexShrink:0, background:T.sidebar,
        borderRight:`2px solid ${T.sidebarBorder}`,
        display:"flex", flexDirection:"column", overflow:"hidden" }}>

        <div style={{ padding:"22px 18px 14px" }}>
          <div style={{ fontSize:10, fontWeight:800, letterSpacing:".18em",
            color:"rgba(255,255,255,.35)", textTransform:"uppercase", marginBottom:2 }}>BIGG</div>
          <div style={{ fontSize:20, fontWeight:900, letterSpacing:"-.02em", color:T.accent, lineHeight:1 }}>Numbers</div>
        </div>

        <div style={{ height:1, background:"rgba(255,255,255,.07)", margin:"0 14px 8px" }} />

        <nav style={{ flex:1, display:"flex", flexDirection:"column", gap:1, padding:"4px 8px", overflowY:"auto" }}>
          {SECTIONS.map(s => {
            const active = activeId === s.id;
            return (
              <button key={s.id} onClick={()=>setActiveId(s.id)} style={{
                background: active ? "rgba(173,255,25,.10)" : "transparent",
                border:"none", borderLeft:`3px solid ${active ? T.accent : "transparent"}`,
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
            <span>🏪</span>Bigg Franquicias
            <span style={{ marginLeft:"auto", fontSize:10 }}>→</span>
          </button>
        </div>

      </div>

      {/* ── CONTENIDO ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ background:T.card, borderBottom:`1px solid ${T.cardBorder}`,
          padding:"10px 24px", display:"flex", alignItems:"center", gap:10,
          flexShrink:0, boxShadow:"0 1px 3px rgba(0,0,0,.06)" }}>
          <span style={{ fontSize:12, fontWeight:700, color:T.muted,
            letterSpacing:".08em", textTransform:"uppercase" }}>BIGG Numbers</span>
          <span style={{ fontSize:12, color:T.dim }}>›</span>
          <span style={{ fontSize:12, fontWeight:700, color:T.text }}>{section?.label}</span>
        </div>

        <div style={{ flex:1, overflowY:"auto" }}>
          {section?.component
            ? <section.component />
            : section?.placeholder
            ? <Placeholder section={section} />
            : null}
        </div>
      </div>

    </div>
  );
}
