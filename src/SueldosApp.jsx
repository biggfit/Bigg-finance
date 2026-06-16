import { useState, useEffect, useRef } from "react";
import LOGO_SRC                  from "./assets/biggLogo";
import PantallaLegajos          from "./sueldos/PantallaLegajos";
import PantallaLiquidacionSedes from "./sueldos/PantallaLiquidacionSedes";
import PantallaLiquidacionHQ   from "./sueldos/PantallaLiquidacionHQ";
import PantallaNovedades        from "./sueldos/PantallaNovedades";
import PantallaNovedadesSedes   from "./sueldos/PantallaNovedadesSedes";
import PantallaCargasSociales  from "./sueldos/PantallaCargasSociales";
import PantallaCategorias       from "./sueldos/PantallaCategorias";
import PantallaObjetivos        from "./sueldos/PantallaObjetivos";
import PantallaResumen          from "./sueldos/PantallaResumen";
import PantallaSueldosPagar     from "./sueldos/PantallaSueldosPagar";
import { fetchPaises }          from "./lib/sueldosApi";

const T = {
  bg:       "#f1f5f9",
  sidebar:  "#1e293b",
  sideLine: "#334155",
  text:     "#f8fafc",
  muted:    "#94a3b8",
  active:   "#2563eb",
  activeBg: "#1e3a5f",
  card:     "#ffffff",
  border:   "#e2e8f0",
  bodyText: "#1e293b",
  font:     "'Inter', system-ui, sans-serif",
};

const NAV = [
  { id: "sueldos-pagar", icon: "💸", label: "Sueldos por pagar" },
  { id: "resumen",       icon: "🧾", label: "Resúmenes" },
  { id: "liq-hq",     icon: "⬡",  label: "Liquidación HQ" },
  { id: "novedades",  icon: "◦",  label: "Novedades de HQ", sub: true },
  { id: "liq-sedes",  icon: "◈",  label: "Liquidación Sedes" },
  { id: "nov-sedes",  icon: "◦",  label: "Novedades de Sedes", sub: true },
  { id: "categorias", icon: "◦",  label: "Categorías",   sub: true },
  { id: "objetivos",  icon: "◦",  label: "Objetivos",    sub: true },
  { id: "cargas",     icon: "📋", label: "Cargas sociales" },
  { id: "legajos",    icon: "👤", label: "Legajos" },
];

export default function SueldosApp({ onVolver }) {
  const [activeId, setActiveId] = useState("liq-hq");
  const [navParams,    setNavParams]    = useState(null);
  const [paises,       setPaises]       = useState([]);
  const [paisActivo,   setPaisActivo]   = useState("AR");
  const [showPaisDrop, setShowPaisDrop] = useState(false);
  const paisDropRef = useRef(null);

  useEffect(() => { fetchPaises().then(setPaises); }, []);

  useEffect(() => {
    const handler = (e) => {
      if (paisDropRef.current && !paisDropRef.current.contains(e.target)) {
        setShowPaisDrop(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const active = NAV.find(n => n.id === activeId);

  const breadcrumb = {
    "liq-sedes":  "Liquidación · Sedes",
    "nov-sedes":  "Liquidación · Sedes › Novedades",
    "resumen":    "Resúmenes",
    "categorias": "Liquidación · Sedes › Categorías",
    "objetivos":  "Liquidación · Sedes › Objetivos",
    "liq-hq":     "Liquidación · HQ",
    "novedades":  "Liquidación · HQ › Novedades",
    "legajos":    "Legajos",
    "cargas":     "Cargas sociales",
    "sueldos-pagar": "Sueldos por pagar",
  }[activeId] ?? "";

  // Deep-link desde "Sueldos por pagar" → wizard del mes/legajo de la deuda.
  const handleNavigate = (id, params) => { setActiveId(id); setNavParams(params); };
  // Navegación manual por el sidebar limpia el deep-link (no “pega” el período).
  const goTo = (id) => { setNavParams(null); setActiveId(id); };

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: T.font, overflow: "hidden" }}>
      {/* Sidebar */}
      <aside style={{
        width: 210, background: T.sidebar, display: "flex", flexDirection: "column",
        flexShrink: 0, userSelect: "none",
      }}>
        {/* Logo */}
        <div style={{ padding: "20px 16px 12px", borderBottom: `1px solid ${T.sideLine}`, display: "flex", alignItems: "center", gap: 8 }}>
          <img src={LOGO_SRC} alt="BIGG" style={{ height: 32, width: "auto", objectFit: "contain", flexShrink: 0, filter: "invert(1) sepia(1) saturate(10) hue-rotate(52deg)" }} />
          <span style={{ flex: 1, textAlign: "center", fontSize: 11, color: T.muted, fontWeight: 700, letterSpacing: ".08em" }}>PAYROLL</span>
        </div>

        {/* Selector de País */}
        <div ref={paisDropRef} style={{ position: "relative", padding: "8px 8px 0" }}>
          {(() => {
            const paisObj = paises.find(p => p.pais === paisActivo);
            const bandera = paisObj?.bandera ?? "🌐";
            return (
              <button
                onClick={() => setShowPaisDrop(v => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  background: "#0f172a", border: `1px solid ${T.sideLine}`,
                  borderRadius: 7, padding: "8px 10px", cursor: "pointer",
                  color: T.text, fontSize: 13, fontFamily: T.font,
                  justifyContent: "space-between",
                }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 16 }}>{bandera}</span>
                  <span style={{ fontWeight: 600 }}>{paisActivo}</span>
                </span>
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                  <path d="M1 1l4 4 4-4" stroke={T.muted} strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            );
          })()}
          {showPaisDrop && (
            <div style={{
              position: "absolute", top: "calc(100% + 2px)", left: 8, right: 8,
              background: "#0f172a", border: `1px solid ${T.sideLine}`,
              borderRadius: 7, overflow: "hidden", zIndex: 100,
              boxShadow: "0 4px 12px rgba(0,0,0,.4)",
            }}>
              {paises.map(p => (
                <button
                  key={p.pais}
                  onClick={() => { setPaisActivo(p.pais); setShowPaisDrop(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    background: p.pais === paisActivo ? T.activeBg : "transparent",
                    border: "none", padding: "8px 12px", cursor: "pointer",
                    color: T.text, fontSize: 13, fontFamily: T.font, textAlign: "left",
                  }}>
                  <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>
                    {p.pais === paisActivo ? "✓" : ""}
                  </span>
                  <span style={{ fontSize: 16 }}>{p.bandera}</span>
                  <span>{p.pais}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV.map(({ id, icon, label, sub }) => {
            const isActive = id === activeId;
            return (
              <button
                key={id}
                onClick={() => goTo(id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  background: isActive ? T.activeBg : "transparent",
                  border: "none", borderRadius: 7,
                  padding: sub ? "6px 12px 6px 32px" : "9px 12px",
                  cursor: "pointer", textAlign: "left",
                  color: isActive ? T.text : sub ? "#64748b" : T.muted,
                  fontSize: sub ? 12 : 13,
                  fontWeight: isActive ? 600 : 400,
                  fontFamily: T.font,
                  transition: "background .12s",
                }}>
                <span style={{ fontSize: sub ? 10 : 15, lineHeight: 1 }}>{icon}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        {/* Volver a Numbers */}
        <div style={{ padding: "12px 8px", borderTop: `1px solid ${T.sideLine}` }}>
          <button
            onClick={onVolver}
            style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              background: "transparent", border: "none", borderRadius: 7, padding: "8px 12px",
              cursor: "pointer", color: T.muted, fontSize: 12, fontFamily: T.font,
            }}>
            ← Volver a Numbers
          </button>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: T.bg }}>
        {/* Topbar */}
        <div style={{
          height: 48, display: "flex", alignItems: "center", gap: 8, padding: "0 20px",
          borderBottom: `1px solid ${T.border}`, background: T.card, flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.muted, letterSpacing: ".08em", textTransform: "uppercase" }}>
            BIGG Sueldos
          </span>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>›</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.bodyText }}>{breadcrumb}</span>
        </div>

        {/* Contenido */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {activeId === "liq-sedes"  && <PantallaLiquidacionSedes pais={paisActivo}
            initialMes={navParams?.mes} initialAnio={navParams?.anio} initialPaso={navParams?.paso} />}
          {activeId === "nov-sedes"  && <PantallaNovedadesSedes   pais={paisActivo} />}
          {activeId === "resumen"    && <PantallaResumen          pais={paisActivo} />}
          {activeId === "sueldos-pagar" && <PantallaSueldosPagar  pais={paisActivo} onNavigate={handleNavigate} />}
          {activeId === "categorias" && <PantallaCategorias       pais={paisActivo} />}
          {activeId === "objetivos"  && <PantallaObjetivos        pais={paisActivo} />}
          {activeId === "liq-hq"    && <PantallaLiquidacionHQ    pais={paisActivo}
            initialMes={navParams?.mes} initialAnio={navParams?.anio} initialPaso={navParams?.paso} />}
          {activeId === "novedades" && <PantallaNovedades        pais={paisActivo} />}
          {activeId === "legajos"   && <PantallaLegajos           pais={paisActivo} />}
          {activeId === "cargas"    && <PantallaCargasSociales    pais={paisActivo} />}
        </div>
      </div>
    </div>
  );
}
