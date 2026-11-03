import { useState } from "react";
import LOGO_SRC from "./assets/biggLogo";
import PantallaReportes, { Icono } from "./numbers/PantallaReportes";
import { TABS } from "./numbers/reportes/reportesMenu";

// ─── BIGG Reportes: los mismos reportes de Numbers, con sidebar propio ──────────────────────────────
// Solo lectura. No tiene datos propios ni escrituras: monta PantallaReportes en modo controlado (tab/onTab), que
// carga lo mismo que dentro de Numbers (group-level, sin selector de sociedad). La tarjeta "Reportes" de Numbers
// sigue existiendo: son dos puertas al MISMO componente (decisión Martín 4/11/2026: no perder, agregar).
// V2 (acordado): selector global de año / mes / moneda en un upper menu.

const T = {
  bg:       "#f1f5f9",
  sidebar:  "#1e293b",
  sideLine: "#334155",
  text:     "#f8fafc",
  muted:    "#94a3b8",
  dim:      "#64748b",
  activeBg: "#1e3a5f",
  accent:   "#ADFF19",
  card:     "#ffffff",
  border:   "#e2e8f0",
  bodyText: "#1e293b",
  font:     "'Inter', system-ui, sans-serif",
};

// Las cuatro miradas (Martín 3/11/2026): comité · negocios · participaciones · administración. Los ids son los
// mismos `TABS` de PantallaReportes (label, ícono y WIP salen de ahí → una sola lista). Lo que está en
// construcción va al final de su grupo, en gris, igual que en el menú de tarjetas.
const MIRADAS = [
  { id: "comite",   label: "Comité",          hint: "Cómo nos fue, en pocos números",
    tabs: ["pl_bigg", "an_ventas", "posicion_fin", "an_margenes", "consol_grupo"] },
  { id: "negocios", label: "Negocios",        hint: "Un P&L por operación",
    tabs: ["pl_sede", "op_espana", "op_colombia", "op_rosedal", "op_huergo", "op_puertos"] },
  { id: "partic",   label: "Participaciones", hint: "Socios, fondeo y saldos entre sociedades",
    tabs: ["socios", "interco_matriz", "interco"] },
  { id: "admin",    label: "Administración",  hint: "Tesorería, cierre y detalle",
    tabs: ["consolidado", "cf", "balance_pn", "devengado", "inf_egresos", "inf_ingresos", "inf_pagos", "cxp_prov", "cxc_cli", "an_gastos_cc", "er_soc"] },
];

const tabDe = (id) => TABS.find(t => t.id === id);

export default function ReportesApp({ onVolver }) {
  const [activeId, setActiveId] = useState("pl_bigg");
  const activeTab    = tabDe(activeId);
  const activeMirada = MIRADAS.find(m => m.tabs.includes(activeId));

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: T.font, overflow: "hidden" }}>
      {/* Sidebar */}
      <aside style={{ width: 230, background: T.sidebar, display: "flex", flexDirection: "column", flexShrink: 0, userSelect: "none" }}>
        <div style={{ padding: "20px 16px 12px", borderBottom: `1px solid ${T.sideLine}`, display: "flex", alignItems: "center", gap: 8 }}>
          <img src={LOGO_SRC} alt="BIGG" style={{ height: 32, width: "auto", objectFit: "contain", flexShrink: 0, filter: "invert(1) sepia(1) saturate(10) hue-rotate(52deg)" }} />
          <span style={{ flex: 1, textAlign: "center", fontSize: 11, color: T.muted, fontWeight: 700, letterSpacing: ".08em" }}>REPORTES</span>
        </div>

        <nav style={{ flex: 1, overflowY: "auto", padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {MIRADAS.map(m => {
            const items = m.tabs.map(tabDe).filter(Boolean);
            // WIP al final del grupo (orden estable dentro de cada mitad).
            const ordenados = [...items.filter(t => !t.wip), ...items.filter(t => t.wip)];
            return (
              <div key={m.id} style={{ marginBottom: 10 }}>
                <div title={m.hint} style={{ padding: "10px 12px 4px", fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: T.dim }}>
                  {m.label}
                </div>
                {ordenados.map(t => {
                  const isActive = t.id === activeId;
                  return (
                    <button key={t.id} onClick={() => setActiveId(t.id)} title={t.desc}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        background: isActive ? T.activeBg : "transparent",
                        border: "none", borderRadius: 7, padding: "8px 12px",
                        cursor: "pointer", textAlign: "left",
                        color: isActive ? T.text : t.wip ? T.dim : T.muted,
                        fontSize: 13, fontWeight: isActive ? 600 : 400, fontFamily: T.font,
                        transition: "background .12s",
                      }}>
                      <span style={{ width: 18, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}>
                        <Icono name={t.ico} emoji={t.icon} size={16} color={isActive ? T.accent : t.wip ? T.dim : T.muted} />
                      </span>
                      <span style={{ flex: 1, lineHeight: 1.25 }}>{t.label}</span>
                      {t.wip && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".06em", color: T.dim }}>WIP</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div style={{ padding: "12px 8px", borderTop: `1px solid ${T.sideLine}` }}>
          <button onClick={onVolver} style={{
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
        <div style={{ height: 48, display: "flex", alignItems: "center", gap: 8, padding: "0 20px", borderBottom: `1px solid ${T.border}`, background: T.card, flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.muted, letterSpacing: ".08em", textTransform: "uppercase" }}>BIGG Reportes</span>
          <span style={{ fontSize: 12, color: T.muted }}>›</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.muted }}>{activeMirada?.label ?? ""}</span>
          <span style={{ fontSize: 12, color: T.muted }}>›</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.bodyText }}>{activeTab?.label ?? ""}</span>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          <PantallaReportes tab={activeId} onTab={setActiveId} />
        </div>
      </div>
    </div>
  );
}
