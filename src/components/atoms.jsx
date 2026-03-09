import { memo } from "react";
import { fmtS, COMP_TYPES } from "../lib/helpers";

// ─── ATOMS ────────────────────────────────────────────────────────────────────
export const SaldoBadge = memo(function SaldoBadge({ value, currency, size = "md" }) {
  const pos = value > 0.01, neg = value < -0.01;
  const color = pos ? "var(--red)" : neg ? "var(--green)" : "var(--muted)";
  return (
    <span className="mono" style={{ fontSize: size === "lg" ? 18 : 13, fontWeight: 700, color, whiteSpace: "nowrap" }}>{fmtS(value, currency)}</span>
  );
});

export const TypePill = memo(function TypePill({ type }) {
  const ct = COMP_TYPES[type];
  if (!ct) return null;
  return <span className="pill" style={{ color: ct.color, background: `${ct.color}18`, border: `1px solid ${ct.color}30` }}>{ct.label}</span>;
});

export function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children, width = 580 }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.88)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="fade" style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 14, width, maxWidth: "96vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div>
          {subtitle && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>{subtitle}</div>}
        </div>
        <div style={{ overflowY: "auto", flex: 1, padding: "18px 22px" }}>{children}</div>
      </div>
    </div>
  );
}
