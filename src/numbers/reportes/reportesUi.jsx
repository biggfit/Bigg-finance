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
// Un clic suma o saca una opción (desde "todos", deja solo esa); el título de un grupo tilda o destilda el grupo entero
// y queda a medias cuando hay algunas elegidas. El botón dice qué hay elegido: el nombre, el grupo si es justo un
// grupo, dos nombres, o "N <plural>". `inline`: etiqueta a la izquierda y control bajo, para barras de una línea.
// Es EL filtro de varias opciones de Reportes (Martín 11/11/2026): no armar otro desplegable a mano.
const LBL = { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em" };
const ctrlInline = { ...selStyle, height: 30, lineHeight: "28px", fontSize: 12, fontWeight: 600 };
const unaLinea = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };
// colorScheme "light": index.css declara "light dark" y, con el sistema en modo oscuro, el tilde VACÍO se pinta oscuro
// y se confunde con uno tildado (acá casi todos arrancan vacíos).
const chk = { pointerEvents: "none", accentColor: T.accentDark, flexShrink: 0, colorScheme: "light" };
const resaltar = {
  onMouseEnter: e => { e.currentTarget.style.background = "#eceff3"; },
  onMouseLeave: e => { e.currentTarget.style.background = "transparent"; },
};

export function MultiSelect({ label, options = null, groups = null, selected, onChange, searchable = false, allLabel = "Todos", width = 200,
  inline = false, plural = "seleccionados" }) {
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
  const elegidos = flat.filter(o => selected.has(o.value));
  // "Todos" = nada elegido o todo tildado a mano: es el mismo filtro, y el botón lo dice igual.
  const todo = selected.size === 0 || (flat.length > 0 && elegidos.length === flat.length);
  const grupoJusto = (groups || []).find(g => g.label && g.items.length === elegidos.length && g.items.every(i => selected.has(i.value)));
  const summary = todo ? allLabel
    : !elegidos.length ? `${selected.size} sel.`
    : elegidos.length === 1 ? elegidos[0].label
    : grupoJusto ? grupoJusto.label
    : elegidos.length === 2 ? elegidos.map(o => o.label).join(", ")
    : `${elegidos.length} ${plural}`;
  const toggle = v => { const s = new Set(selected); s.has(v) ? s.delete(v) : s.add(v); onChange(s); };
  const toggleGroup = items => { const s = new Set(selected); const all = items.every(i => s.has(i.value)); items.forEach(i => all ? s.delete(i.value) : s.add(i.value)); onChange(s); };
  const qq = q.trim().toLowerCase();
  const show = o => !qq || o.label.toLowerCase().includes(qq);
  const row = { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" };
  return (
    <div ref={ref} style={inline ? { display: "inline-flex", alignItems: "center", gap: 8 } : undefined}>
      {label && <label style={inline ? LBL : { ...LBL, display: "block", marginBottom: 5 }}>{label}</label>}
      <div style={{ position: "relative" }}>
        <button type="button" onClick={() => setOpen(o => !o)} title={summary}
          style={{ ...(inline ? { ...ctrlInline, minWidth: width, maxWidth: 280 } : { ...selStyle, width }), textAlign: "left",
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <span style={{ ...unaLinea, color: todo && !inline ? T.muted : T.text }}>{summary}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={T.text} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0, transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }}><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {open && (
          <div style={{ position: "absolute", zIndex: 100, top: "calc(100% + 4px)", left: 0, minWidth: Math.max(width, 220), maxWidth: 420,
            maxHeight: 420, overflowY: "auto", background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 10, boxShadow: T.shadowMd, padding: 4 }}>
            {searchable && (
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…" autoFocus
                style={{ ...selStyle, width: "100%", cursor: "text", marginBottom: 4 }} />
            )}
            {/* "Todos" arriba: limpiar la selección = sin filtro. */}
            <div onClick={() => onChange(new Set())} {...resaltar} style={{ ...row, padding: "7px 12px", fontSize: 13, fontWeight: 700, color: T.text, borderBottom: `1px solid ${T.cardBorder}` }}>
              <input type="checkbox" checked={todo} readOnly style={chk} />
              {allLabel}
            </div>
            {(groups || [{ key: "_", items: flat }]).map(g => {
              const items = g.items.filter(show);
              if (!items.length) return null;
              const n = g.items.filter(i => selected.has(i.value)).length;
              const allIn = n === g.items.length;
              return (
                <div key={g.key}>
                  {g.label && (
                    <div onClick={() => toggleGroup(g.items)} style={{ ...row, padding: "6px 12px", fontWeight: 800, fontSize: 10.5,
                      color: T.muted, textTransform: "uppercase", letterSpacing: ".04em", background: "#f1f5f9" }}>
                      <input type="checkbox" checked={allIn} readOnly style={chk}
                        ref={el => { if (el) el.indeterminate = n > 0 && !allIn; }} />
                      {g.label}
                    </div>
                  )}
                  {items.map(o => (
                    <div key={o.value} onClick={() => toggle(o.value)} title={o.label} {...resaltar}
                      style={{ ...row, padding: g.label ? "6px 12px 6px 28px" : "6px 12px", fontSize: 13, color: T.text }}>
                      <input type="checkbox" checked={selected.has(o.value)} readOnly style={chk} />
                      <span style={unaLinea}>{o.label}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Select de UNA opción con la etiqueta a la izquierda (mismo alto que MultiSelect inline) ──
// options = [{ value, label }]. onChange recibe el value como string.
export function SelectInline({ label, value, onChange, options = [] }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={LBL}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} style={ctrlInline}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
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
