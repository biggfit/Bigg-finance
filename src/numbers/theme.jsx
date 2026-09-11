// ─── BIGG Numbers — Design tokens compartidos ─────────────────────────────
import { useRef, useLayoutEffect } from "react";

export const T = {
  sidebar:       "#16181a",
  sidebarBorder: "rgba(173,255,25,.35)",
  sidebarMuted:  "rgba(255,255,255,.4)",
  sidebarHover:  "rgba(255,255,255,.06)",
  sidebarActive: "rgba(173,255,25,.12)",
  bg:            "#f0f2f5",
  card:          "#ffffff",
  cardBorder:    "#e4e7ec",
  text:          "#111827",
  muted:         "#6b7280",
  dim:           "#9ca3af",
  accent:        "#ADFF19",
  accentDark:    "#1e2022",
  green:         "#16a34a",
  greenBg:       "#dcfce7",
  red:           "#dc2626",
  redBg:         "#fee2e2",
  orange:        "#d97706",
  orangeBg:      "#fef3c7",
  blue:          "#2563eb",
  blueBg:        "#dbeafe",
  purple:        "#7c3aed",
  purpleBg:      "#ede9fe",
  tableHead:     "#1e2022",
  tableHeadText: "#ADFF19",
  shadow:        "0 1px 4px rgba(0,0,0,.08), 0 2px 12px rgba(0,0,0,.05)",
  shadowMd:      "0 4px 20px rgba(0,0,0,.10)",
  radius:        10,
  font:          "var(--font)",
  mono:          "var(--mono)",
};

export const ESTADO_EGRESO = {
  pagado:  { label: "Pagado",   bg: "#dcfce7", color: "#16a34a" },
  a_pagar: { label: "A Pagar",  bg: "#fef9c3", color: "#ca8a04" },
  vencido: { label: "Vencido",  bg: "#fee2e2", color: "#dc2626" },
};

export const ESTADO_INGRESO = {
  cobrado:  { label: "Cobrado",   bg: "#dcfce7", color: "#16a34a" },
  a_cobrar: { label: "A Cobrar",  bg: "#dbeafe", color: "#2563eb" },
  vencido:  { label: "Vencido",   bg: "#fee2e2", color: "#dc2626" },
};

export const fmtDate = (str) => {
  if (!str) return "—";
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return str;
};

export const fmtMoney = (n, cur = "ARS") => {
  const sym = cur === "USD" ? "U$D" : cur === "EUR" ? "€" : "$";
  return `${sym} ${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export function Badge({ estado, cfg }) {
  const c = cfg[estado] ?? { label: estado, bg: "#f3f4f6", color: "#374151" };
  return (
    <span style={{ display:"inline-block", padding:"2px 10px", borderRadius:999,
      fontSize:11, fontWeight:700, background:c.bg, color:c.color,
      letterSpacing:".04em", whiteSpace:"nowrap" }}>
      {c.label}
    </span>
  );
}

export function CompactCard({ label, value, color, sub }) {
  return (
    <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
      padding:"8px 14px", boxShadow:T.shadow, flex:1, minWidth:110 }}>
      <div style={{ fontSize:10, color:T.muted, fontWeight:700, letterSpacing:".07em",
        textTransform:"uppercase", marginBottom:3 }}>{label}</div>
      <div style={{ fontSize:15, fontWeight:800, color: color ?? T.text, fontFamily:T.mono,
        whiteSpace:"nowrap" }}>{value}</div>
      {sub && <div style={{ fontSize:10, color:T.dim, marginTop:3 }}>{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action, back }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
      <div>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <h1 style={{ fontSize:24, fontWeight:900, color:T.text, margin:0, letterSpacing:"-.02em" }}>{title}</h1>
          {back}
        </div>
        {subtitle && <p style={{ fontSize:13, color:T.muted, margin:"4px 0 0" }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Btn({ children, onClick, variant = "primary", disabled }) {
  const styles = {
    primary: { background:T.accentDark, color:T.accent, border:"none" },
    accent:  { background:T.accent, color:T.accentDark, border:"none", boxShadow:"0 2px 8px rgba(173,255,25,.3)" },
    ghost:   { background:"transparent", color:T.muted, border:`1px solid ${T.cardBorder}` },
    danger:  { background:"transparent", color:T.red, border:`1px solid ${T.red}` },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...styles[variant], borderRadius:999, padding:"8px 20px",
      fontSize:13, fontWeight:700, cursor: disabled ? "default" : "pointer",
      fontFamily:T.font, letterSpacing:".03em", opacity: disabled ? .4 : 1,
      display:"flex", alignItems:"center", gap:7, transition:"opacity .15s",
    }}>
      {children}
    </button>
  );
}

// ─── Formato pesos ($ 22.400.000,50) ──────────────────────────────────────
// El "valor" que viaja por props/estado sigue siendo el número plano de siempre
// (punto decimal, sin miles — lo que ya esperan Number()/parseFloat() y el backend).
// Sólo la representación que ve el usuario en el input se muestra con puntos de
// miles y coma decimal, a la manera argentina.
export function formatPesosDisplay(canonical) {
  if (canonical == null) return "";
  const str = String(canonical);
  if (str === "" || str === "-") return str;
  const neg = str.startsWith("-");
  const body = neg ? str.slice(1) : str;
  const [intRaw, decRaw] = body.split(".");
  const intDisplay = (intRaw || "").replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const out = decRaw !== undefined ? `${intDisplay},${decRaw}` : intDisplay;
  return neg ? `-${out}` : out;
}

// Hook que traduce entre el valor plano (canonical) y lo que se muestra en el input,
// reformateando en cada tecla sin perder la posición del cursor (mismo enfoque que
// useNroCompMask: cuenta dígitos/coma antes del cursor y los reubica tras reformatear).
export function useMoneyMask(value, onChange) {
  const ref = useRef(null);
  const pendingCaret = useRef(null);
  const str = value == null ? "" : String(value);
  const display = formatPesosDisplay(str);

  const handleChange = (e) => {
    const el = e.target;
    let raw = el.value;
    const pos = el.selectionStart ?? raw.length;

    // Tolerar "." como separador decimal (hábito del numpad): si la única tecla nueva
    // es un punto y todavía no hay coma cargada, se lo trata igual que si fuera ",".
    // Los demás puntos (los de miles, auto-insertados) se siguen ignorando como antes.
    if (!str.includes(".") && raw.length === display.length + 1 && raw[pos - 1] === ".") {
      const withoutInserted = raw.slice(0, pos - 1) + raw.slice(pos);
      if (withoutInserted === display) raw = raw.slice(0, pos - 1) + "," + raw.slice(pos);
    }

    pendingCaret.current = (raw.slice(0, pos).match(/[0-9,]/g) || []).length;

    let s = raw.replace(/\./g, "");           // los puntos restantes son sólo separador de miles (auto)
    const neg = s.trim().startsWith("-");
    s = s.replace(/-/g, "");
    const firstComma = s.indexOf(",");
    const canonicalBody = firstComma === -1
      ? s.replace(/\D/g, "")
      : `${s.slice(0, firstComma).replace(/\D/g, "")}.${s.slice(firstComma + 1).replace(/\D/g, "")}`;

    onChange(neg ? `-${canonicalBody}` : canonicalBody);
  };

  useLayoutEffect(() => {
    if (pendingCaret.current == null || !ref.current) return;
    const target = pendingCaret.current;
    pendingCaret.current = null;
    let pos = 0, seen = 0;
    while (pos < display.length && seen < target) {
      if (/[0-9,]/.test(display[pos])) seen++;
      pos++;
    }
    try { ref.current.setSelectionRange(pos, pos); } catch { /* input sin selección */ }
  }, [display]);

  return { ref, display, onChange: handleChange };
}

/** Reemplazo directo de <input type="number"> para montos: mismo contrato de
 *  onChange basado en evento (e.target.value), pero muestra "$ 22.400.000,50". */
export function MoneyField({ value, onChange, ...rest }) {
  const mask = useMoneyMask(value, (canonical) => onChange({ target: { value: canonical } }));
  return (
    <input ref={mask.ref} type="text" inputMode="decimal"
      value={mask.display} onChange={mask.onChange} {...rest} />
  );
}

export function Input({ label, value, onChange, placeholder, type="text", required }) {
  const isMoney = type === "number";
  const mask = useMoneyMask(isMoney ? value : "", isMoney ? onChange : () => {});
  return (
    <div>
      <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>
        {label}{required && <span style={{ color:T.red }}> *</span>}
      </label>
      <input type={isMoney ? "text" : type} inputMode={isMoney ? "decimal" : undefined}
        ref={isMoney ? mask.ref : undefined}
        value={isMoney ? mask.display : value}
        onChange={isMoney ? mask.onChange : e=>onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width:"100%", background:"#eceff3", border:`1px solid ${T.cardBorder}`,
          borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
          fontFamily:T.font, outline:"none", boxSizing:"border-box" }} />
    </div>
  );
}

export function Select({ label, value, onChange, options, required }) {
  // Si alguna opción trae `group`, se renderiza con <optgroup> (mismo orden de aparición del grupo).
  // Útil cuando el selector mezcla varias sociedades y sería imposible de buscar en una lista plana.
  const agrupado = options.some(o => o && o.group);
  const grupos = agrupado ? (() => {
    const m = new Map();
    for (const o of options) { const g = o.group || "—"; if (!m.has(g)) m.set(g, []); m.get(g).push(o); }
    return [...m.entries()];
  })() : null;
  const opt = o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>;
  return (
    <div>
      <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>
        {label}{required && <span style={{ color:T.red }}> *</span>}
      </label>
      <select value={value} onChange={e=>onChange(e.target.value)}
        style={{ width:"100%", background:"#eceff3", border:`1px solid ${T.cardBorder}`,
          borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
          fontFamily:T.font, outline:"none", boxSizing:"border-box" }}>
        <option value="">— Seleccionar —</option>
        {agrupado
          ? grupos.map(([g, opts]) => <optgroup key={g} label={g}>{opts.map(opt)}</optgroup>)
          : options.map(opt)}
      </select>
    </div>
  );
}
