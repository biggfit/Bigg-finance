// Piezas de UI que comparten la pantalla de Reportes y sus tabs (formato de números, estilo de los selects,
// multi-select con checkboxes y presets de fecha). Importar de acá, no de PantallaReportes (ciclo).
import { useState, useEffect, useRef } from "react";
import { T } from "../theme";

export const fmtN   = n => !n ? "—" : Math.round(Math.abs(n)).toLocaleString("es-AR");
export const fmtSigned = n => !n ? "—" : (n < 0 ? "−" : "") + fmtN(n);   // conserva el signo (fmtN es absoluto)

export const CTRL_H = 36;

export const selStyle = {
  background: "#eceff3", border: `1px solid ${T.cardBorder}`,
  borderRadius: 8, padding: "0 12px", fontSize: 13, color: T.text,
  fontFamily: T.font, outline: "none", cursor: "pointer", height: CTRL_H,
  lineHeight: `${CTRL_H}px`,
};

// ─── Multi-select con checkboxes (opciones planas o agrupadas · búsqueda opcional) ──
// selected = Set de values (vacío ⇒ "todos", sin filtro). groups = [{key,label,items:[{value,label}]}].
export function MultiSelect({ label, options = null, groups = null, selected, onChange, searchable = false, allLabel = "Todos", width = 200 }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const flat = groups ? groups.flatMap(g => g.items) : (options || []);
  const summary = selected.size === 0 ? allLabel
    : selected.size === 1 ? (flat.find(o => selected.has(o.value))?.label ?? "1 sel.")
    : `${selected.size} seleccionados`;
  const toggle = v => { const s = new Set(selected); s.has(v) ? s.delete(v) : s.add(v); onChange(s); };
  const toggleGroup = items => { const s = new Set(selected); const all = items.every(i => s.has(i.value)); items.forEach(i => all ? s.delete(i.value) : s.add(i.value)); onChange(s); };
  const qq = q.trim().toLowerCase();
  const show = o => !qq || o.label.toLowerCase().includes(qq);
  const lbl = { display: "block", fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 };
  const row = { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      {label && <label style={lbl}>{label}</label>}
      <button type="button" onClick={() => setOpen(o => !o)} style={{ ...selStyle, width, textAlign: "left",
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected.size ? T.text : T.muted }}>{summary}</span>
        <span style={{ fontSize: 9, opacity: .6 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", zIndex: 60, top: "calc(100% + 4px)", left: 0, minWidth: width, maxWidth: 340,
          maxHeight: 340, overflowY: "auto", background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 10, boxShadow: T.shadowMd, padding: 4 }}>
          {searchable && (
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…" autoFocus
              style={{ ...selStyle, width: "100%", cursor: "text", marginBottom: 4 }} />
          )}
          {/* "Todos" arriba: limpiar la selección = sin filtro. Tildado cuando no hay nada elegido. */}
          <div onClick={() => onChange(new Set())} style={{ ...row, padding: "6px 10px", fontWeight: 700, borderBottom: `1px solid ${T.cardBorder}` }}>
            <input type="checkbox" checked={selected.size === 0} readOnly style={{ pointerEvents: "none", accentColor: T.accentDark }} />
            {allLabel}
          </div>
          {(groups || [{ key: "_", items: flat }]).map(g => {
            const items = g.items.filter(show);
            if (!items.length) return null;
            const allIn = g.items.every(i => selected.has(i.value));
            return (
              <div key={g.key}>
                {g.label && (
                  <div onClick={() => toggleGroup(g.items)} style={{ ...row, padding: "6px 10px", fontWeight: 800, fontSize: 10.5,
                    color: T.muted, textTransform: "uppercase", letterSpacing: ".04em", background: "#f1f5f9" }}>
                    <input type="checkbox" checked={allIn} readOnly style={{ pointerEvents: "none", accentColor: T.accentDark }} />
                    {g.label}
                  </div>
                )}
                {items.map(o => (
                  <div key={o.value} onClick={() => toggle(o.value)} style={{ ...row, padding: g.label ? "6px 10px 6px 26px" : "6px 10px", fontSize: 13, color: T.text }}>
                    <input type="checkbox" checked={selected.has(o.value)} readOnly style={{ pointerEvents: "none", accentColor: T.accentDark }} />
                    {o.label}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Filtro de fecha con presets (como Contagram) → devuelve rango {desde,hasta} ISO ──
export const DATE_PRESETS = [
  { id: "todos", label: "Todo" }, { id: "hoy", label: "Hoy" }, { id: "ayer", label: "Ayer" },
  { id: "semana", label: "Últimos 7 días" }, { id: "dias30", label: "Últimos 30 días" },
  { id: "mes", label: "Mes actual" }, { id: "mes_ant", label: "Mes anterior" },
  { id: "anio", label: "Año actual" }, { id: "rango", label: "Desde – Hasta" },
];
export function rangoDePreset(id, desde, hasta) {
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const mk = (a, b) => ({ desde: a ? iso(a) : "", hasta: b ? iso(b) : "" });
  const dd = n => { const x = new Date(t); x.setDate(t.getDate() + n); return x; };
  switch (id) {
    case "hoy":     return mk(t, t);
    case "ayer":    return mk(dd(-1), dd(-1));
    case "semana":  return mk(dd(-6), t);
    case "dias30":  return mk(dd(-29), t);
    case "mes":     return mk(new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 0));
    case "mes_ant": return mk(new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0));
    case "anio":    return mk(new Date(t.getFullYear(), 0, 1), new Date(t.getFullYear(), 11, 31));
    case "rango":   return { desde: desde || "", hasta: hasta || "" };
    default:        return { desde: "", hasta: "" };
  }
}
