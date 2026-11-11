import { useEffect, useState } from "react";
import LOGO_SRC from "./assets/biggLogo";
import PantallaReportes, { Icono } from "./numbers/PantallaReportes";
import { TABS } from "./numbers/reportes/reportesMenu";
import { forzarRefresco } from "./lib/cacheBust";

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

// Secciones del sidebar (Martín 5/11/2026): Administración PRIMERO, para que lo operativo del equipo esté a la vista; después resultados económicos y financieros; y todo lo que está en construcción junto al final, plegado.
// Los ids son los mismos `TABS` de PantallaReportes (label, ícono, WIP y "a retirar" salen de ahí → una sola lista).
// Cada sección se pliega con la flechita y el estado se recuerda en el navegador (cada usuario arma su vista).
const MIRADAS = [
  // Lo que se opera todos los días (Martín 5/11: la caja primero, Ingresos antes que Egresos).
  { id: "admin",    label: "Administración",       hint: "La caja y lo que se opera todos los días",
    tabs: ["consolidado", "inf_ingresos", "inf_egresos", "cxc_cli", "cxp_prov", "inf_pagos"] },
  // Martín 5/11: Comité + Negocios en una sola sección; lo financiero (posición, flujo, patrimonio) en otra.
  { id: "economico", label: "Resultados económicos",  hint: "Cómo nos fue: el grupo y cada negocio",
    tabs: ["pl_grupo", "an_ventas", "pl_sede", "op_espana", "op_colombia", "op_rosedal", "op_huergo"] },
  { id: "financiero", label: "Resultados financieros", hint: "Posición, flujo de caja y patrimonio",
    tabs: ["posicion_fin", "cf", "balance_pn", "valuacion"] },
  { id: "partic",   label: "Participaciones",      hint: "Socios, fondeo y saldos entre sociedades",
    tabs: ["socios", "interco_matriz", "interco"] },
  // Martín 10/11/2026: lo que NO es para leer el negocio sino para dar el mes por cerrado va aparte. "Del resultado al
  // patrimonio" se abre una vez por mes: si "Sin explicar" da cero, resultado, caja y balance dicen lo mismo.
  { id: "control",  label: "Control de cierre",    hint: "Para dar el mes por cerrado: que resultado, caja y balance digan lo mismo",
    tabs: ["patrimonio_ctrl", "devengado"] },
  { id: "wip",      label: "En construcción",      hint: "Reportes a terminar o a retirar", plegadaInicial: true,
    tabs: ["an_margenes", "consol_grupo", "op_puertos", "an_gastos_cc", "er_soc", "pl_bigg"] },
];

const LS_PLEGADAS = "reportes.sidebar.plegadas";
const tabDe   = (id) => TABS.find(t => t.id === id);

export default function ReportesApp({ onVolver }) {
  const [activeId, setActiveId] = useState("pl_grupo");
  const [plegadas, setPlegadas] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem(LS_PLEGADAS) || "null"); if (v && typeof v === "object") return v; } catch { /* sin storage */ }
    return Object.fromEntries(MIRADAS.filter(m => m.plegadaInicial).map(m => [m.id, true]));
  });
  useEffect(() => { try { localStorage.setItem(LS_PLEGADAS, JSON.stringify(plegadas)); } catch { /* sin storage */ } }, [plegadas]);

  const activeTab    = tabDe(activeId);
  const activeMirada = MIRADAS.find(m => m.tabs.includes(activeId));
  const toggle = (id) => setPlegadas(p => ({ ...p, [id]: !p[id] }));
  // Ir a un reporte (click en el sidebar o link interno vía onTab): si su sección está plegada, se abre sola.
  const irA = (id) => {
    setActiveId(id);
    const m = MIRADAS.find(x => x.tabs.includes(id));
    if (m) setPlegadas(p => p[m.id] ? { ...p, [m.id]: false } : p);
  };

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
            const plegada = !!plegadas[m.id];
            return (
              <div key={m.id} style={{ marginBottom: plegada ? 2 : 10 }}>
                <button onClick={() => toggle(m.id)} title={m.hint}
                  style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", background: "transparent", border: "none",
                    padding: "10px 12px 4px", cursor: "pointer", color: T.dim, fontFamily: T.font, textAlign: "left" }}>
                  <span style={{ fontSize: 9, width: 10, display: "inline-block", transform: plegada ? "rotate(0deg)" : "rotate(90deg)", transition: "transform .12s" }}>▶</span>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase" }}>{m.label}</span>
                </button>
                {!plegada && m.tabs.map(tabDe).filter(Boolean).map(t => {
                  const isActive = t.id === activeId;
                  const apagado  = t.wip || t.retirar;
                  return (
                    <button key={t.id} onClick={() => irA(t.id)} title={t.desc}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        background: isActive ? T.activeBg : "transparent",
                        border: "none", borderRadius: 7, padding: "8px 12px",
                        cursor: "pointer", textAlign: "left",
                        color: isActive ? T.text : apagado ? T.dim : T.muted,
                        fontSize: 13, fontWeight: isActive ? 600 : 400, fontFamily: T.font,
                        transition: "background .12s",
                      }}>
                      <span style={{ width: 18, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}>
                        <Icono name={t.ico} emoji={t.icon} size={16} color={isActive ? T.accent : apagado ? T.dim : T.muted} />
                      </span>
                      <span style={{ flex: 1, lineHeight: 1.25 }}>{t.label}</span>
                      {t.retirar && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".06em", color: T.dim }}>A RETIRAR</span>}
                      {t.wip && !t.retirar && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".06em", color: T.dim }}>WIP</span>}
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
          {/* Actualizar datos: igual que en Numbers (salta la caché de borde y recarga). */}
          <button onClick={() => { forzarRefresco(); window.location.reload(); }} title="Actualizar datos"
            style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", fontSize: 19, lineHeight: 1, padding: 6, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", color: T.muted }}
            onMouseEnter={e => e.currentTarget.style.background = "#f1f5f9"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>🔄</button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          <PantallaReportes tab={activeId} onTab={irA} />
        </div>
      </div>
    </div>
  );
}
