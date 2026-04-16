import { useState, useEffect, useRef } from "react";
import "./lib/styles";
import { T } from "./numbers/theme";
import LOGO_SRC from "./assets/biggLogo";
import PantallaDashboard from "./numbers/PantallaDashboard";
import PantallaEgresos   from "./numbers/PantallaEgresos";
import PantallaIngresos  from "./numbers/PantallaIngresos";
import PantallaMaestros  from "./numbers/PantallaMaestros";
import PantallaTesoreria from "./numbers/PantallaTesoreria";
import PantallaReportes  from "./numbers/PantallaReportes";
import { SOCIEDADES as SOC_FALLBACK } from "./data/tesoreriaData";
import { fetchSociedades } from "./lib/numbersApi";

// ─── Secciones del sidebar (Maestros queda fuera — va al pie) ────────────────
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
  const [showMaestros,   setShowMaestros]   = useState(false);
  const [egresoSubView,  setEgresoSubView]  = useState(null); // null | "new-compra"
  const [ingresoSubView, setIngresoSubView] = useState(null); // null | "new-venta"
  const [egresoOpen,     setEgresoOpen]     = useState(false);
  const [ingresoOpen,    setIngresoOpen]    = useState(false);
  const [sociedades,   setSociedades]   = useState(SOC_FALLBACK);
  const [socIdx,       setSocIdx]       = useState(0);
  const [showSocDrop,  setShowSocDrop]  = useState(false);
  const [socReady,     setSocReady]     = useState(false); // true cuando fetchSociedades terminó
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

      {/* ── SIDEBAR ── */}
      <div style={{ width:210, flexShrink:0, background:T.sidebar,
        borderRight:`2px solid ${T.sidebarBorder}`,
        display:"flex", flexDirection:"column", overflow:"hidden" }}>

        {/* ── Logo + selector de sociedad ── */}
        <div style={{ padding:"14px 12px 10px", borderBottom:"1px solid rgba(255,255,255,.07)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
            <img src={LOGO_SRC} alt="BIGG" style={{ height:32, width:"auto", objectFit:"contain", flexShrink:0, filter:"invert(1) sepia(1) saturate(10) hue-rotate(52deg)" }} />
            <span style={{ fontSize:11, color:"rgba(255,255,255,.45)", fontWeight:700, letterSpacing:".08em", marginLeft:8 }}>NUMBERS</span>
          </div>
          {/* Dropdown selector de sociedad */}
          <div ref={socDropRef} style={{ position:"relative" }}>
            <button
              onClick={() => setShowSocDrop(v => !v)}
              title="Seleccionar sociedad"
              style={{
                padding:"6px 10px", fontSize:11,
                background: showSocDrop ? "rgba(173,255,25,.12)" : "rgba(255,255,255,.07)",
                border:`1px solid ${showSocDrop ? "rgba(173,255,25,.4)" : "rgba(255,255,255,.15)"}`,
                color:"rgba(255,255,255,.9)",
                borderRadius:6, fontFamily:T.font, cursor:"pointer",
                fontWeight:700, width:"100%", textAlign:"left",
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                display:"flex", alignItems:"center", gap:6,
              }}
            >
              <span style={{ fontSize:14 }}>{activeSoc.bandera}</span>
              <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis" }}>{activeSoc.nombre.toUpperCase()}</span>
              <span style={{ fontSize:9, color:"rgba(255,255,255,.35)", flexShrink:0 }}>
                {showSocDrop ? "▴" : "▾"}
              </span>
            </button>
            {showSocDrop && (
              <div style={{
                position:"absolute", top:"calc(100% + 4px)", left:0, right:0, zIndex:999,
                background:"#1a2035", border:"1px solid rgba(255,255,255,.15)",
                borderRadius:7, overflow:"hidden",
                boxShadow:"0 8px 24px rgba(0,0,0,.4)",
              }}>
                {sociedades.map((s, i) => (
                  <button key={s.id} onClick={() => { setSocIdx(i); setShowSocDrop(false); }}
                    style={{
                      display:"flex", alignItems:"center", gap:8,
                      width:"100%", padding:"8px 12px",
                      background: i === socIdx ? "rgba(173,255,25,.12)" : "transparent",
                      border:"none", borderLeft:`3px solid ${i === socIdx ? T.accent : "transparent"}`,
                      color: i === socIdx ? T.accent : "rgba(255,255,255,.75)",
                      fontFamily:T.font, fontSize:12, fontWeight: i === socIdx ? 700 : 500,
                      cursor:"pointer", textAlign:"left",
                    }}
                    onMouseEnter={e => { if (i !== socIdx) e.currentTarget.style.background = "rgba(255,255,255,.06)"; }}
                    onMouseLeave={e => { if (i !== socIdx) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ fontSize:13 }}>{s.bandera ?? ""}</span>
                    <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {s.nombre}
                    </span>
                    {i === socIdx && <span style={{ fontSize:10 }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Nav items ── */}
        <nav style={{ flex:1, display:"flex", flexDirection:"column", gap:1, padding:"8px 0", overflowY:"auto" }}>
          {SECTIONS.map(s => {
            const active = activeId === s.id && !showMaestros;

            // ── Egresos: tiene sub-items ──────────────────────────────────────
            if (s.id === "egresos") {
              return (
                <div key={s.id}>
                  {/* Ítem padre */}
                  <button onClick={() => {
                    if (active) { setEgresoOpen(o => !o); }
                    else { setActiveId("egresos"); setEgresoSubView(null); setEgresoOpen(true); setShowMaestros(false); }
                  }} style={{
                    width:"100%",
                    background: active ? "rgba(173,255,25,.10)" : "transparent",
                    border:"none", borderLeft:`3px solid ${active ? T.accent : "transparent"}`,
                    color: active ? T.accent : "rgba(255,255,255,.5)",
                    textAlign:"left", padding:"10px 16px",
                    fontSize:13, fontFamily:T.font, cursor:"pointer",
                    display:"flex", alignItems:"center", gap:10,
                    transition:"all .12s", fontWeight: active ? 700 : 500,
                  }}
                  onMouseEnter={e=>{ if(!active) e.currentTarget.style.background="rgba(255,255,255,.04)"; }}
                  onMouseLeave={e=>{ if(!active) e.currentTarget.style.background="transparent"; }}>
                    <span style={{ fontSize:14, width:18, textAlign:"center", flexShrink:0 }}>{s.icon}</span>
                    {s.label}
                  </button>

                  {/* Sub-items: visibles cuando Egresos está activo y expandido */}
                  {active && egresoOpen && [
                    { id:"new-compra", label:"Compras" },
                    { id:"new-gasto",  label:"Gastos"  },
                  ].map(sub => {
                    const subActive = egresoSubView === sub.id;
                    return (
                      <div key={sub.id} style={{ display:"flex", alignItems:"center",
                        borderLeft:`3px solid ${subActive ? T.accent : "transparent"}`,
                        background: subActive ? "rgba(173,255,25,.07)" : "rgba(0,0,0,.18)",
                        transition:"background .12s" }}
                        onMouseEnter={e=>{ if(!subActive) e.currentTarget.style.background="rgba(0,0,0,.28)"; }}
                        onMouseLeave={e=>{ if(!subActive) e.currentTarget.style.background="rgba(0,0,0,.18)"; }}>
                        <button
                          onClick={() => { setActiveId("egresos"); setEgresoSubView(sub.id); setEgresoOpen(true); setShowMaestros(false); }}
                          style={{
                            flex:1, background:"transparent", border:"none",
                            color: subActive ? T.accent : "rgba(255,255,255,.45)",
                            textAlign:"left", padding:"8px 8px 8px 32px",
                            fontSize:12, fontFamily:T.font, cursor:"pointer",
                            fontWeight: subActive ? 700 : 400,
                          }}>
                          {sub.label}
                        </button>
                        <button
                          onClick={() => { setActiveId("egresos"); setEgresoSubView(sub.id); setEgresoOpen(true); setShowMaestros(false); }}
                          style={{
                            background:"transparent", border:"none", outline:"none", flexShrink:0,
                            color:T.accent, fontSize:18, lineHeight:1, padding:"0 12px 0 0",
                            cursor:"pointer", fontFamily:T.font,
                          }}>
                          +
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            }

            // ── Ingresos: ítem simple (sin sub-items, el + está en el sub-item) ─
            if (s.id === "ingresos") {
              return (
                <div key={s.id}>
                  <button onClick={() => {
                    if (active) { setIngresoOpen(o => !o); }
                    else { setActiveId("ingresos"); setIngresoSubView(null); setIngresoOpen(true); setShowMaestros(false); }
                  }} style={{
                    width:"100%",
                    background: active ? "rgba(173,255,25,.10)" : "transparent",
                    border:"none", borderLeft:`3px solid ${active ? T.accent : "transparent"}`,
                    color: active ? T.accent : "rgba(255,255,255,.5)",
                    textAlign:"left", padding:"10px 16px",
                    fontSize:13, fontFamily:T.font, cursor:"pointer",
                    display:"flex", alignItems:"center", gap:10,
                    transition:"all .12s", fontWeight: active ? 700 : 500,
                  }}
                  onMouseEnter={e=>{ if(!active) e.currentTarget.style.background="rgba(255,255,255,.04)"; }}
                  onMouseLeave={e=>{ if(!active) e.currentTarget.style.background="transparent"; }}>
                    <span style={{ fontSize:14, width:18, textAlign:"center", flexShrink:0 }}>{s.icon}</span>
                    {s.label}
                  </button>
                  {active && ingresoOpen && (
                    <div style={{ display:"flex", alignItems:"center",
                      borderLeft:`3px solid ${ingresoSubView === "new-venta" ? T.accent : "transparent"}`,
                      background: ingresoSubView === "new-venta" ? "rgba(173,255,25,.07)" : "rgba(0,0,0,.18)",
                      transition:"background .12s" }}
                      onMouseEnter={e=>{ if(ingresoSubView !== "new-venta") e.currentTarget.style.background="rgba(0,0,0,.28)"; }}
                      onMouseLeave={e=>{ if(ingresoSubView !== "new-venta") e.currentTarget.style.background="rgba(0,0,0,.18)"; }}>
                      <button
                        onClick={() => { setActiveId("ingresos"); setIngresoSubView("new-venta"); setIngresoOpen(true); setShowMaestros(false); }}
                        style={{
                          flex:1, background:"transparent", border:"none",
                          color: ingresoSubView === "new-venta" ? T.accent : "rgba(255,255,255,.45)",
                          textAlign:"left", padding:"8px 8px 8px 32px",
                          fontSize:12, fontFamily:T.font, cursor:"pointer",
                          fontWeight: ingresoSubView === "new-venta" ? 700 : 400,
                        }}>
                        Ventas
                      </button>
                      <button
                        onClick={() => { setActiveId("ingresos"); setIngresoSubView("new-venta"); setIngresoOpen(true); setShowMaestros(false); }}
                        style={{
                          background:"transparent", border:"none", flexShrink:0,
                          color:T.accent, fontSize:18, lineHeight:1, padding:"0 12px 0 0",
                          cursor:"pointer", fontFamily:T.font,
                        }}>
                        +
                      </button>
                    </div>
                  )}
                </div>
              );
            }

            // ── Resto de secciones (sin sub-items) ────────────────────────────
            return (
              <button key={s.id} onClick={() => { setActiveId(s.id); setEgresoSubView(null); setIngresoSubView(null); setShowMaestros(false); }} style={{
                background: active ? "rgba(173,255,25,.10)" : "transparent",
                border:"none", borderLeft:`3px solid ${active ? T.accent : "transparent"}`,
                color: active ? T.accent : "rgba(255,255,255,.5)",
                textAlign:"left", padding:"10px 16px",
                fontSize:13, fontFamily:T.font, cursor:"pointer",
                display:"flex", alignItems:"center", gap:10,
                transition:"all .12s", fontWeight: active ? 700 : 500,
              }}
              onMouseEnter={e=>{ if(!active) e.currentTarget.style.background="rgba(255,255,255,.04)"; }}
              onMouseLeave={e=>{ if(!active) e.currentTarget.style.background="transparent"; }}>
                <span style={{ fontSize:14, width:18, textAlign:"center", flexShrink:0 }}>{s.icon}</span>
                {s.label}
              </button>
            );
          })}
        </nav>

        {/* ── Pie: Maestros + Franquicias ── */}
        <div style={{ borderTop:"1px solid rgba(255,255,255,.07)", padding:"6px 0", display:"flex", flexDirection:"column", gap:2 }}>
          {/* Maestros — al pie igual que en Franquicias */}
          <button onClick={() => setShowMaestros(true)} style={{
            display:"flex", alignItems:"center", gap:10,
            padding:"10px 16px",
            background: showMaestros ? "rgba(173,255,25,.10)" : "transparent",
            border:"none", borderLeft:`3px solid ${showMaestros ? T.accent : "transparent"}`,
            color: showMaestros ? T.accent : "rgba(255,255,255,.5)",
            fontFamily:T.font, fontSize:13, fontWeight: showMaestros ? 700 : 500,
            cursor:"pointer", textAlign:"left", width:"100%", transition:"all .12s",
          }}
          onMouseEnter={e=>{ if(!showMaestros) e.currentTarget.style.background="rgba(255,255,255,.04)"; }}
          onMouseLeave={e=>{ if(!showMaestros) e.currentTarget.style.background="transparent"; }}>
            <span style={{ fontSize:14, width:18, textAlign:"center", flexShrink:0 }}>⚙</span>
            Maestros
          </button>

          {/* → Bigg Franquicias */}
          <button onClick={onGoToFranquicias} style={{
            display:"flex", alignItems:"center", gap:10,
            padding:"10px 16px",
            background:"transparent", border:"none",
            borderLeft:"3px solid transparent",
            color:"rgba(255,255,255,.3)",
            fontFamily:T.font, fontSize:13, fontWeight:500,
            cursor:"pointer", textAlign:"left", width:"100%", transition:"all .12s",
          }}
          onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.04)"}
          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <span style={{ fontSize:14, width:18, textAlign:"center", flexShrink:0 }}>→</span>
            Bigg Franquicias
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
          <span style={{ fontSize:12, fontWeight:700, color:T.text }}>
            {showMaestros ? "Maestros"
              : egresoSubView  === "new-compra" ? "Egresos › Nueva Compra"
              : egresoSubView  === "new-gasto"  ? "Egresos › Nuevo Gasto"
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

        <div style={{ flex:1, overflowY:"auto" }}>
          {!socReady
            ? <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
                height:"100%", color:"#9ca3af", fontSize:13 }}>Cargando…</div>
            : showMaestros
            ? <PantallaMaestros />
            : section?.component
            ? section.id === "egresos"
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
