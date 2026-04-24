import { useState, useEffect, useRef } from "react";
import "./lib/styles";
import { T } from "./numbers/theme";
import LOGO_SRC from "./assets/biggLogo";
import PantallaDashboard from "./numbers/PantallaDashboard";
import PantallaEgresos   from "./numbers/PantallaEgresos";
import PantallaIngresos  from "./numbers/PantallaIngresos";
import PantallaMaestros  from "./numbers/PantallaMaestros";
import PantallaTesoreria from "./numbers/PantallaTesoreria";
import PantallaReportes      from "./numbers/PantallaReportes";
import PantallaCambioMoneda   from "./numbers/PantallaCambioMoneda";
import PantallaIntercompania  from "./numbers/PantallaIntercompania";
import PantallaGastos         from "./numbers/PantallaGastos";
import { SOCIEDADES as SOC_FALLBACK } from "./data/tesoreriaData";
import { fetchSociedades } from "./lib/numbersApi";

// ─── Nav button style helpers ─────────────────────────────────────────────────
const navBtnStyle = (active) => ({
  width:"calc(100% - 12px)", margin:"0 6px",
  background: active ? T.sidebarActive : "transparent",
  border:"none", borderRadius:8,
  color: active ? T.accent : "rgba(255,255,255,.55)",
  textAlign:"left", padding:"9px 10px",
  fontSize:13, fontFamily:T.font, cursor:"pointer",
  display:"flex", alignItems:"center", gap:10,
  transition:"background .15s, color .15s", fontWeight: active ? 700 : 500,
});
const navBtnHover = (active) => ({
  onMouseEnter: e => { if (!active) e.currentTarget.style.background = T.sidebarHover; },
  onMouseLeave: e => { if (!active) e.currentTarget.style.background = "transparent"; },
});

const MAESTROS_TABS = [
  { id:"sociedades",  label:"Sociedades",       icon:"🏛" },
  { id:"cajas",       label:"Cajas y Bancos",   icon:"🏦" },
  { id:"cc",          label:"Centros de Costo", icon:"🗂" },
  { id:"cuentas",     label:"Plan de Cuentas",  icon:"📋" },
  { id:"clientes",    label:"Clientes",          icon:"🏢" },
  { id:"proveedores", label:"Proveedores",       icon:"🧾" },
];

const SECTIONS = [
  { id:"dashboard", label:"Dashboard", icon:"◈", component: PantallaDashboard },
  { id:"ingresos",  label:"Ingresos",  icon:"↑", component: PantallaIngresos  },
  { id:"egresos",   label:"Egresos",   icon:"↓", component: PantallaEgresos   },
  { id:"tesoreria", label:"Tesorería", icon:"⬡", component: PantallaTesoreria },
  { id:"reportes",  label:"Reportes",  icon:"▦", component: PantallaReportes  },
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
  const [activeId,       setActiveId]       = useState("dashboard");
  const [egresoSubView,  setEgresoSubView]  = useState(null);
  const [ingresoSubView, setIngresoSubView] = useState(null);
  const [egresoOpen,     setEgresoOpen]     = useState(false);
  const [ingresoOpen,    setIngresoOpen]    = useState(false);
  const [sociedades,     setSociedades]     = useState(SOC_FALLBACK);
  const [socIdx,         setSocIdx]         = useState(0);
  const [showSocDrop,    setShowSocDrop]    = useState(false);
  const [socReady,       setSocReady]       = useState(false);
  const [activeSpecial,  setActiveSpecial]  = useState(null);
  // null = main app; string = maestros active tab
  const [activeMaestrosTab, setActiveMaestrosTab] = useState(null);
  const showMaestros = activeMaestrosTab !== null;
  const socDropRef = useRef(null);
  const activeSoc = sociedades[socIdx] ?? sociedades[0];

  // Cerrar dropdown al hacer click afuera
  useEffect(() => {
    if (!showSocDrop) return;
    const handler = (e) => {
      if (socDropRef.current && !socDropRef.current.contains(e.target)) {
        setShowSocDrop(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSocDrop]);

  // Carga sociedades PRIMERO — los componentes hijos no montan hasta que socReady=true
  // Esto evita requests concurrentes al proxy de Vite en el arranque inicial
  useEffect(() => {
    fetchSociedades()
      .then(data => {
        const activas = Array.isArray(data) ? data.filter(s => {
            const a = s.activo;
            if (a === false || a === 0 || a === "FALSE" || a === "false" || a === "0" || a === "") return false;
            return true;
          }) : [];
        if (activas.length > 0) setSociedades(activas);
      })
      .catch(err => console.error("[Numbers] fetchSociedades error:", err))
      .finally(() => setSocReady(true));
  }, []);

  const section = SECTIONS.find(s => s.id === activeId);

  return (
    <div style={{ display:"flex", height:"100vh", overflow:"hidden", background:T.bg, fontFamily:T.font }}>
      <style>{`.numbers-sidebar button:focus-visible{outline:2px solid ${T.accent};outline-offset:-2px;border-radius:8px}.numbers-sidebar button:focus:not(:focus-visible){outline:none}`}</style>

      {/* ── SIDEBAR ── */}
      {showMaestros ? (
        /* ── Sidebar Maestros ── */
        <div className="numbers-sidebar" style={{ width:210, flexShrink:0, background:"#0f172a",
          borderRight:"2px solid rgba(99,102,241,.35)",
          display:"flex", flexDirection:"column", overflow:"hidden" }}>

          {/* Volver */}
          <div style={{ padding:"14px 12px 10px", borderBottom:"1px solid rgba(255,255,255,.07)" }}>
            <button onClick={() => setActiveMaestrosTab(null)} style={{
              display:"flex", alignItems:"center", gap:8,
              background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.1)",
              borderRadius:8, padding:"7px 10px", width:"100%",
              color:"rgba(255,255,255,.6)", fontFamily:T.font, fontSize:12,
              fontWeight:600, cursor:"pointer", textAlign:"left",
              transition:"background .15s",
            }}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.1)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,.06)"}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink:0 }}>
                <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Numbers
            </button>
            <div style={{ padding:"10px 4px 2px", fontSize:10, fontWeight:700, letterSpacing:".1em", color:T.sidebarMuted, textTransform:"uppercase" }}>Maestros</div>
          </div>

          {/* Nav items maestros */}
          <nav aria-label="Secciones de maestros" style={{ flex:1, display:"flex", flexDirection:"column", gap:1, padding:"8px 0", overflowY:"auto" }}>
            {MAESTROS_TABS.map(tab => {
              const active = activeMaestrosTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveMaestrosTab(tab.id)}
                  aria-current={active ? "page" : undefined}
                  style={navBtnStyle(active)} {...navBtnHover(active)}>
                  <span style={{ fontSize:14, width:18, textAlign:"center", flexShrink:0 }}>{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      ) : (
        /* ── Sidebar principal ── */
        <div className="numbers-sidebar" style={{ width:210, flexShrink:0, background:T.sidebar,
          borderRight:`2px solid ${T.sidebarBorder}`,
          display:"flex", flexDirection:"column", overflow:"hidden" }}>

          {/* ── Logo + selector de sociedad ── */}
          <div style={{ padding:"14px 12px 10px", borderBottom:"1px solid rgba(255,255,255,.07)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
              <img src={LOGO_SRC} alt="BIGG" style={{ height:32, width:"auto", objectFit:"contain", flexShrink:0, filter:"invert(1) sepia(1) saturate(10) hue-rotate(52deg)" }} />
              <span style={{ fontSize:11, color:T.sidebarMuted, fontWeight:700, letterSpacing:".08em", marginLeft:8 }}>NUMBERS</span>
            </div>
            {/* Dropdown selector de sociedad */}
            <div ref={socDropRef} style={{ position:"relative" }}>
              <button
                onClick={() => setShowSocDrop(v => !v)}
                aria-haspopup="listbox"
                aria-expanded={showSocDrop}
                title="Seleccionar sociedad"
                style={{
                  padding:"7px 10px", fontSize:11,
                  background: showSocDrop ? T.sidebarActive : T.sidebarHover,
                  border:`1px solid ${showSocDrop ? "rgba(173,255,25,.35)" : "rgba(255,255,255,.12)"}`,
                  color:"rgba(255,255,255,.9)",
                  borderRadius:8, fontFamily:T.font, cursor:"pointer",
                  fontWeight:700, width:"100%", textAlign:"left",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                  display:"flex", alignItems:"center", gap:6,
                  transition:"background .15s, border-color .15s",
                }}
              >
                <span style={{ fontSize:14, lineHeight:1, display:"flex", alignItems:"center" }}>{activeSoc.bandera}</span>
                <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", lineHeight:1 }}>{activeSoc.nombre.toUpperCase()}</span>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink:0, transform: showSocDrop ? "rotate(180deg)" : "rotate(0deg)", transition:"transform .2s" }}>
                  <path d="M2 3.5L5 6.5L8 3.5" stroke="rgba(255,255,255,.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {showSocDrop && (
                <div role="listbox" aria-label="Sociedades" style={{
                  position:"absolute", top:"calc(100% + 4px)", left:0, right:0, zIndex:999,
                  background:"#1a1d20", border:"1px solid rgba(255,255,255,.12)",
                  borderRadius:8, overflow:"hidden", padding:"4px",
                  boxShadow:"0 8px 24px rgba(0,0,0,.5)",
                }}>
                  {sociedades.map((s, i) => (
                    <button key={s.id} role="option" aria-selected={i === socIdx}
                      onClick={() => { setSocIdx(i); setShowSocDrop(false); }}
                      style={{
                        display:"flex", alignItems:"center", gap:8,
                        width:"100%", padding:"7px 10px", borderRadius:6,
                        background: i === socIdx ? T.sidebarActive : "transparent",
                        border:"none",
                        color: i === socIdx ? T.accent : "rgba(255,255,255,.7)",
                        fontFamily:T.font, fontSize:12, fontWeight: i === socIdx ? 700 : 500,
                        cursor:"pointer", textAlign:"left", transition:"background .12s",
                      }}
                      onMouseEnter={e => { if (i !== socIdx) e.currentTarget.style.background = T.sidebarHover; }}
                      onMouseLeave={e => { if (i !== socIdx) e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{ fontSize:13 }}>{s.bandera ?? ""}</span>
                      <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {s.nombre}
                      </span>
                      {i === socIdx && <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7L6 10L11 4" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Nav items ── */}
          <nav aria-label="Navegación principal" style={{ flex:1, display:"flex", flexDirection:"column", gap:1, padding:"8px 0", overflowY:"auto" }}>
            <div style={{ padding:"4px 16px 6px", fontSize:10, fontWeight:700, letterSpacing:".1em", color:T.sidebarMuted, textTransform:"uppercase" }}>Navegación</div>
            {SECTIONS.map(s => {
              const active = activeId === s.id && !showMaestros;

              // ── Egresos: tiene sub-items ──────────────────────────────────────
              if (s.id === "egresos") {
                return (
                  <div key={s.id}>
                    <button onClick={() => { setEgresoOpen(o => !o); setIngresoOpen(false); }}
                    aria-expanded={egresoOpen}
                    style={navBtnStyle(active)} {...navBtnHover(active)}>
                      <span style={{ fontSize:14, width:18, textAlign:"center", flexShrink:0 }}>{s.icon}</span>
                      <span style={{ flex:1 }}>{s.label}</span>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink:0, transform: egresoOpen ? "rotate(180deg)" : "rotate(0deg)", transition:"transform .2s", opacity:.5 }}>
                        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>

                    {egresoOpen && [
                      { id:"new-compra", label:"Compras", listId:null,      ariaAdd:"Agregar compra" },
                      { id:"new-gasto",  label:"Gastos",  listId:"gastos",  ariaAdd:"Agregar gasto"  },
                    ].map(sub => {
                      const subActive = sub.listId === null
                        ? (egresoSubView === null || egresoSubView === "new-compra")
                        : (egresoSubView === sub.listId || egresoSubView === sub.id);
                      return (
                        <div key={sub.id} style={{ display:"flex", alignItems:"center",
                          margin:"1px 6px", borderRadius:8,
                          background: subActive ? "rgba(173,255,25,.08)" : "rgba(0,0,0,.35)",
                          transition:"background .12s" }}
                          onMouseEnter={e=>{ if(!subActive) e.currentTarget.style.background="rgba(0,0,0,.5)"; }}
                          onMouseLeave={e=>{ if(!subActive) e.currentTarget.style.background=subActive?"rgba(173,255,25,.08)":"rgba(0,0,0,.35)"; }}>
                          <button
                            onClick={() => { setActiveId("egresos"); setEgresoSubView(sub.listId); setEgresoOpen(true); setActiveMaestrosTab(null); setActiveSpecial(null); }}
                            aria-current={subActive ? "page" : undefined}
                            style={{
                              flex:1, background:"transparent", border:"none", borderRadius:8,
                              color: subActive ? T.accent : "rgba(255,255,255,.45)",
                              textAlign:"left", padding:"7px 8px 7px 38px",
                              fontSize:12, fontFamily:T.font, cursor:"pointer",
                              fontWeight: subActive ? 700 : 400,
                            }}>
                            {sub.label}
                          </button>
                          <button
                            onClick={() => { setActiveId("egresos"); setEgresoSubView(sub.id); setEgresoOpen(true); setActiveMaestrosTab(null); }}
                            aria-label={sub.ariaAdd}
                            title={sub.ariaAdd}
                            style={{
                              background:"transparent", border:"none", borderRadius:6, flexShrink:0,
                              color:T.accent, fontSize:16, lineHeight:1,
                              minWidth:32, minHeight:32, display:"flex", alignItems:"center", justifyContent:"center",
                              cursor:"pointer", fontFamily:T.font, transition:"background .12s",
                            }}
                            onMouseEnter={e=>e.currentTarget.style.background="rgba(173,255,25,.12)"}
                            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                            +
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              }

              // ── Ingresos: tiene sub-items ───────────────────────────────────
              if (s.id === "ingresos") {
                return (
                  <div key={s.id}>
                    <button onClick={() => { setIngresoOpen(o => !o); setEgresoOpen(false); }}
                    aria-expanded={ingresoOpen}
                    style={navBtnStyle(active)} {...navBtnHover(active)}>
                      <span style={{ fontSize:14, width:18, textAlign:"center", flexShrink:0 }}>{s.icon}</span>
                      <span style={{ flex:1 }}>{s.label}</span>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink:0, transform: ingresoOpen ? "rotate(180deg)" : "rotate(0deg)", transition:"transform .2s", opacity:.5 }}>
                        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    {ingresoOpen && (
                      <div style={{ display:"flex", alignItems:"center",
                        margin:"1px 6px", borderRadius:8,
                        background: ingresoSubView === "new-venta" ? "rgba(173,255,25,.08)" : "rgba(0,0,0,.35)",
                        transition:"background .12s" }}
                        onMouseEnter={e=>{ if(ingresoSubView !== "new-venta") e.currentTarget.style.background="rgba(0,0,0,.5)"; }}
                        onMouseLeave={e=>{ if(ingresoSubView !== "new-venta") e.currentTarget.style.background=ingresoSubView==="new-venta"?"rgba(173,255,25,.08)":"rgba(0,0,0,.35)"; }}>
                        <button
                          onClick={() => { setActiveId("ingresos"); setIngresoSubView(null); setIngresoOpen(true); setActiveMaestrosTab(null); setActiveSpecial(null); }}
                          aria-current={ingresoSubView === "new-venta" ? "page" : undefined}
                          style={{
                            flex:1, background:"transparent", border:"none", borderRadius:8,
                            color: ingresoSubView === "new-venta" ? T.accent : "rgba(255,255,255,.45)",
                            textAlign:"left", padding:"7px 8px 7px 38px",
                            fontSize:12, fontFamily:T.font, cursor:"pointer",
                            fontWeight: ingresoSubView === "new-venta" ? 700 : 400,
                          }}>
                          Ventas
                        </button>
                        <button
                          onClick={() => { setActiveId("ingresos"); setIngresoSubView("new-venta"); setIngresoOpen(true); setActiveMaestrosTab(null); }}
                          aria-label="Agregar venta"
                          title="Agregar venta"
                          style={{
                            background:"transparent", border:"none", borderRadius:6, flexShrink:0,
                            color:T.accent, fontSize:16, lineHeight:1,
                            minWidth:32, minHeight:32, display:"flex", alignItems:"center", justifyContent:"center",
                            cursor:"pointer", fontFamily:T.font, transition:"background .12s",
                          }}
                          onMouseEnter={e=>e.currentTarget.style.background="rgba(173,255,25,.12)"}
                          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                          +
                        </button>
                      </div>
                    )}
                  </div>
                );
              }

              // ── Resto de secciones (sin sub-items) ────────────────────────────
              return (
                <button key={s.id} onClick={() => { setActiveId(s.id); setEgresoSubView(null); setIngresoSubView(null); setActiveMaestrosTab(null); setActiveSpecial(null); }}
                  aria-current={active ? "page" : undefined}
                  style={navBtnStyle(active)} {...navBtnHover(active)}>
                  <span style={{ fontSize:14, width:18, textAlign:"center", flexShrink:0 }}>{s.icon}</span>
                  {s.label}
                </button>
              );
            })}
          </nav>

          {/* ── Módulos especiales ── */}
          <div style={{ borderTop:"1px solid rgba(255,255,255,.07)", padding:"8px 0 4px" }}>
            <div style={{ padding:"4px 16px 6px", fontSize:10, fontWeight:700, letterSpacing:".1em", color:T.sidebarMuted, textTransform:"uppercase" }}>Especiales</div>
            {[
              { id:"intercompania", icon:"⇄", label:"Intercompañía",   soon:false, onClick: () => { setActiveSpecial("intercompania"); } },
              { id:"cambio",        icon:"$", label:"Cambio de moneda", soon:false, onClick: () => { setActiveSpecial("cambio"); } },
            ].map(item => {
              const active = !item.soon && activeSpecial === item.id;
              return (
                <button key={item.label} disabled={item.soon} onClick={item.onClick}
                  style={{ ...navBtnStyle(active), color: item.soon ? "rgba(255,255,255,.3)" : active ? T.accent : "rgba(255,255,255,.55)", cursor: item.soon ? "default" : "pointer" }}
                  {...navBtnHover(active)}>
                  <span style={{ fontSize:14, width:18, textAlign:"center", flexShrink:0 }}>{item.icon}</span>
                  <span style={{ flex:1 }}>{item.label}</span>
                  {item.soon && (
                    <span style={{ fontSize:9, fontWeight:700, letterSpacing:".06em", color:"rgba(255,255,255,.2)",
                      background:"rgba(255,255,255,.06)", borderRadius:4, padding:"2px 5px" }}>PRONTO</span>
                  )}
                </button>
              );
            })}
            <button onClick={onGoToFranquicias} style={{
              display:"flex", alignItems:"center", gap:10,
              width:"calc(100% - 12px)", margin:"0 6px",
              padding:"9px 10px", borderRadius:8,
              background:"transparent", border:"none",
              color:"rgba(255,255,255,.4)",
              fontFamily:T.font, fontSize:13, fontWeight:500,
              cursor:"pointer", textAlign:"left", transition:"background .15s",
            }}
            onMouseEnter={e=>e.currentTarget.style.background=T.sidebarHover}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <span style={{ fontSize:14, width:18, textAlign:"center", flexShrink:0 }}>→</span>
              Bigg Franquicias
            </button>
          </div>

          {/* ── Pie: Maestros ── */}
          <div style={{ borderTop:"1px solid rgba(255,255,255,.07)", padding:"6px 0" }}>
            <button onClick={() => { setActiveMaestrosTab("sociedades"); setActiveSpecial(null); }}
              aria-current={showMaestros ? "page" : undefined}
              style={navBtnStyle(showMaestros)} {...navBtnHover(showMaestros)}>
              <span style={{ fontSize:14, width:18, textAlign:"center", flexShrink:0 }}>⚙</span>
              Maestros
            </button>
          </div>

        </div>
      )}

      {/* ── CONTENIDO ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div style={{ background:T.card, borderBottom:`1px solid ${T.cardBorder}`,
          padding:"10px 24px", display:"flex", alignItems:"center", gap:10,
          flexShrink:0, boxShadow:"0 1px 3px rgba(0,0,0,.06)" }}>
          <span style={{ fontSize:12, fontWeight:700, color:T.muted,
            letterSpacing:".08em", textTransform:"uppercase" }}>BIGG Numbers</span>
          <span style={{ fontSize:12, color:T.dim }}>›</span>
          <span style={{ fontSize:12, fontWeight:700, color:T.text }}>
            {showMaestros
              ? `Maestros › ${MAESTROS_TABS.find(t => t.id === activeMaestrosTab)?.label ?? ""}`
              : activeSpecial === "intercompania" ? "Intercompañía"
              : activeSpecial === "cambio" ? "Cambio de moneda"
              : egresoSubView  === "new-compra" ? "Egresos › Nueva Compra"
              : egresoSubView  === "new-gasto"  ? "Gastos › Nuevo Gasto"
              : egresoSubView  === "gastos"     ? "Gastos"
              : ingresoSubView === "new-venta"  ? "Ingresos › Nueva Venta"
              : section?.label}
          </span>
          {/* Badge sociedad activa en el topbar */}
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6,
            background:"#f0f9ff", border:"1px solid #bae6fd", borderRadius:999,
            padding:"3px 10px", fontSize:11, fontWeight:700, color:"#0369a1" }}>
            <span>{activeSoc.bandera}</span>
            <span>{activeSoc.nombre}</span>
          </div>
        </div>

        <div style={{ flex:1, overflow:"auto", display:"flex", flexDirection:"column" }}>
          {!socReady
            ? <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
                height:"100%", color:"#9ca3af", fontSize:13 }}>Cargando…</div>
            : showMaestros
            ? <PantallaMaestros activeTab={activeMaestrosTab} />
            : activeSpecial === "intercompania"
            ? <PantallaIntercompania sociedad={activeSoc.id} />
            : activeSpecial === "cambio"
            ? <PantallaCambioMoneda sociedad={activeSoc.id} />
            : section?.component
            ? section.id === "egresos" && (egresoSubView === "gastos" || egresoSubView === "new-gasto")
              ? <PantallaGastos   sociedad={activeSoc.id} subView={egresoSubView}  onSubViewChange={setEgresoSubView}  />
              : section.id === "egresos"
              ? <PantallaEgresos  sociedad={activeSoc.id} subView={egresoSubView}  onSubViewChange={setEgresoSubView}  />
              : section.id === "ingresos"
              ? <PantallaIngresos sociedad={activeSoc.id} subView={ingresoSubView} onSubViewChange={setIngresoSubView} />
              : <section.component sociedad={activeSoc.id} />
            : section?.placeholder
            ? <Placeholder section={section} />
            : null}
        </div>
      </div>

    </div>
  );
}
