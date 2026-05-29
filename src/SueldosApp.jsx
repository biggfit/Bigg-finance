import { useState } from "react";
import PantallaLegajos          from "./sueldos/PantallaLegajos";
import PantallaLiquidacionSedes from "./sueldos/PantallaLiquidacionSedes";
import PantallaLiquidacionHQ   from "./sueldos/PantallaLiquidacionHQ";
import PantallaCargasSociales  from "./sueldos/PantallaCargasSociales";

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
  { id: "liq-sedes", icon: "◈", label: "Liquidación Sedes" },
  { id: "liq-hq",    icon: "⬡", label: "Liquidación HQ" },
  { id: "legajos",   icon: "👤", label: "Legajos" },
  { id: "cargas",    icon: "📋", label: "Cargas sociales" },
];

export default function SueldosApp({ onVolver }) {
  const [activeId, setActiveId] = useState("liq-sedes");

  const active = NAV.find(n => n.id === activeId);

  const breadcrumb = {
    "liq-sedes": "Liquidación · Sedes",
    "liq-hq":    "Liquidación · HQ",
    "legajos":   "Legajos",
    "cargas":    "Cargas sociales",
  }[activeId] ?? "";

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: T.font, overflow: "hidden" }}>
      {/* Sidebar */}
      <aside style={{
        width: 210, background: T.sidebar, display: "flex", flexDirection: "column",
        flexShrink: 0, userSelect: "none",
      }}>
        {/* Logo */}
        <div style={{ padding: "20px 16px 12px", borderBottom: `1px solid ${T.sideLine}` }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.text, letterSpacing: ".06em" }}>BIGG</div>
          <div style={{ fontSize: 11, color: T.muted, fontWeight: 600, letterSpacing: ".1em" }}>SUELDOS</div>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {NAV.map(({ id, icon, label }) => {
            const isActive = id === activeId;
            return (
              <button
                key={id}
                onClick={() => setActiveId(id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  background: isActive ? T.activeBg : "transparent",
                  border: "none", borderRadius: 7, padding: "9px 12px",
                  cursor: "pointer", textAlign: "left",
                  color: isActive ? T.text : T.muted,
                  fontSize: 13, fontWeight: isActive ? 600 : 400,
                  fontFamily: T.font,
                  transition: "background .12s",
                }}>
                <span style={{ fontSize: 15, lineHeight: 1 }}>{icon}</span>
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
          {activeId === "liq-sedes" && <PantallaLiquidacionSedes />}
          {activeId === "liq-hq"   && <PantallaLiquidacionHQ />}
          {activeId === "legajos"  && <PantallaLegajos />}
          {activeId === "cargas"   && <PantallaCargasSociales />}
        </div>
      </div>
    </div>
  );
}
