import { useState } from "react";
import "./lib/styles";

// ─── Secciones del sidebar ─────────────────────────────────────────────────
const SECTIONS = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "◈",
    color: "var(--accent)",
    description: "Vista general de KPIs financieros, alertas de vencimiento y estado de cuentas.",
    features: ["Saldos por empresa y moneda", "Alertas de facturas vencidas", "Resumen de flujo de fondos", "KPIs del mes"],
  },
  {
    id: "ingresos",
    label: "Ingresos",
    icon: "↑",
    color: "var(--green)",
    description: "Gestión de facturas emitidas a clientes, cobros y estado de cuentas a cobrar.",
    features: ["Facturas emitidas a clientes", "Seguimiento de cobros", "Cuentas a cobrar por vencimiento", "Historial por cliente"],
  },
  {
    id: "egresos",
    label: "Egresos",
    icon: "↓",
    color: "var(--red)",
    description: "Facturas recibidas de proveedores, pagos realizados y pendientes de pago.",
    features: ["Facturas de proveedores", "Pagos vinculados a facturas concretas", "Calendario de vencimientos", "Estado por proveedor"],
  },
  {
    id: "tesoreria",
    label: "Tesorería",
    icon: "⬡",
    color: "var(--blue)",
    description: "Cuentas bancarias, movimientos de caja y conciliación de extractos.",
    features: ["ABM de cuentas bancarias", "Movimientos de caja y banco", "Conciliación con extracto bancario", "Posición por moneda"],
  },
  {
    id: "reportes",
    label: "Reportes",
    icon: "▦",
    color: "var(--purple)",
    description: "P&L, Cash Flow y reconciliación de resultados por empresa y centro de costo.",
    features: ["Estado de Resultados (P&L)", "Flujo de fondos", "Reconciliación de resultados", "Filtros por empresa, período y CC"],
  },
];

// ─── Placeholder de sección ────────────────────────────────────────────────
function SectionPlaceholder({ section }) {
  return (
    <div className="fade" style={{ padding: "40px 48px", maxWidth: 720 }}>
      {/* Header de la sección */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 32 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: "var(--bg3)", border: `1px solid var(--border2)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, color: section.color,
        }}>
          {section.icon}
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-.01em" }}>
            {section.label}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
            {section.description}
          </div>
        </div>
      </div>

      {/* Features que se están construyendo */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 32 }}>
        {section.features.map((f, i) => (
          <div key={i} style={{
            background: "var(--bg2)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "14px 16px",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: section.color, flexShrink: 0,
            }} />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{f}</span>
          </div>
        ))}
      </div>

      {/* Badge "en construcción" */}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        background: "rgba(173,255,25,.06)", border: "1px solid rgba(173,255,25,.2)",
        borderRadius: 999, padding: "6px 14px",
        fontSize: 11, fontWeight: 700, color: "var(--accent)",
        letterSpacing: ".08em", textTransform: "uppercase",
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "var(--accent)",
          animation: "pulse 1.5s ease-in-out infinite",
        }} />
        En desarrollo — Fase {SECTIONS.findIndex(s => s.id === section.id) + 1}
      </div>
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────
export default function NumbersApp({ onGoToFranquicias }) {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [showMaestros, setShowMaestros] = useState(false);

  const section = SECTIONS.find(s => s.id === activeSection);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>

      {/* ── SIDEBAR ── */}
      <div style={{
        width: 210, flexShrink: 0,
        background: "var(--bg2)",
        borderRight: "2px solid rgba(173,255,25,.35)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>

        {/* Logo / título */}
        <div style={{ padding: "20px 18px 14px" }}>
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: ".18em",
            color: "var(--muted)", textTransform: "uppercase", marginBottom: 2,
          }}>
            BIGG
          </div>
          <div style={{
            fontSize: 18, fontWeight: 900, letterSpacing: "-.02em",
            color: "var(--accent)", lineHeight: 1,
          }}>
            Numbers
          </div>
        </div>

        {/* Separador */}
        <div style={{ height: 1, background: "var(--border)", margin: "0 12px 8px" }} />

        {/* Nav principal */}
        <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, padding: "4px 8px", overflowY: "auto" }}>
          {SECTIONS.map(s => {
            const active = activeSection === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                style={{
                  background: active ? "rgba(173,255,25,.08)" : "transparent",
                  border: "none",
                  borderLeft: `3px solid ${active ? "var(--accent)" : "transparent"}`,
                  borderRadius: "0 8px 8px 0",
                  color: active ? "var(--accent)" : "var(--muted)",
                  textAlign: "left", padding: "9px 12px",
                  fontSize: 13, fontFamily: "var(--font)", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 9,
                  transition: "all .12s", fontWeight: active ? 700 : 400,
                }}>
                <span style={{ fontSize: 14, color: active ? s.color : "var(--dim)" }}>{s.icon}</span>
                {s.label}
              </button>
            );
          })}
        </nav>

        {/* ── Bigg Franquicias ── */}
        <div style={{ padding: "8px 8px 0", borderTop: "1px solid var(--border)" }}>
          <button
            onClick={onGoToFranquicias}
            style={{
              width: "100%", background: "rgba(173,255,25,.05)",
              border: "1px solid rgba(173,255,25,.2)", borderRadius: 8,
              color: "var(--accent)", padding: "9px 12px",
              fontSize: 12, fontFamily: "var(--font)", cursor: "pointer",
              fontWeight: 700, letterSpacing: ".04em",
              display: "flex", alignItems: "center", gap: 8,
              transition: "all .12s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(173,255,25,.12)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(173,255,25,.05)"}
          >
            <span style={{ fontSize: 14 }}>🏪</span>
            Bigg Franquicias
            <span style={{ marginLeft: "auto", fontSize: 10 }}>→</span>
          </button>
        </div>

        {/* ── Maestros ── */}
        <div style={{ padding: "8px", borderTop: "1px solid var(--border)", marginTop: 8 }}>
          <button
            onClick={() => setShowMaestros(true)}
            style={{
              width: "100%", background: "transparent",
              border: "none", borderRadius: 8,
              color: "var(--muted)", padding: "8px 12px",
              fontSize: 12, fontFamily: "var(--font)", cursor: "pointer",
              fontWeight: 600, letterSpacing: ".04em",
              display: "flex", alignItems: "center", gap: 8,
              transition: "all .12s",
            }}
            onMouseEnter={e => e.currentTarget.style.color = "var(--text)"}
            onMouseLeave={e => e.currentTarget.style.color = "var(--muted)"}
          >
            <span style={{ fontSize: 13 }}>⚙</span>
            Maestros
          </button>
        </div>

      </div>{/* fin sidebar */}

      {/* ── ÁREA DE CONTENIDO ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Topbar */}
        <div style={{
          background: "var(--bg2)", borderBottom: "1px solid var(--border)",
          padding: "10px 24px", display: "flex", alignItems: "center", gap: 12,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: ".08em", textTransform: "uppercase" }}>
            {section?.label}
          </span>
          <span style={{ fontSize: 10, color: "var(--dim)" }}>—</span>
          <span style={{ fontSize: 11, color: "var(--dim)" }}>BIGG Numbers</span>
        </div>

        {/* Contenido */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {section && <SectionPlaceholder section={section} />}
        </div>

      </div>{/* fin área contenido */}

      {/* ── Modal maestros (placeholder) ── */}
      {showMaestros && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowMaestros(false)}
        >
          <div
            className="fade"
            style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 14, padding: 32, width: 480, textAlign: "center" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 32, marginBottom: 16 }}>📋</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Maestros — BIGG Numbers</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24, lineHeight: 1.6 }}>
              Plan de Cuentas, Centros de Costo, Proveedores y<br />
              Cuentas Bancarias. En desarrollo.
            </div>
            <button className="ghost" onClick={() => setShowMaestros(false)}>Cerrar</button>
          </div>
        </div>
      )}

    </div>
  );
}
