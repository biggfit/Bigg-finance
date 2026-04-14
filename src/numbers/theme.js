// ─── BIGG Numbers — Design tokens compartidos ─────────────────────────────
export const T = {
  sidebar:       "#16181a",
  sidebarBorder: "rgba(173,255,25,.35)",
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
  cobrado:    { label: "Cobrado",    bg: "#dcfce7", color: "#16a34a" },
  a_cobrar:   { label: "A Cobrar",   bg: "#dbeafe", color: "#2563eb" },
  vencido:    { label: "Vencido",    bg: "#fee2e2", color: "#dc2626" },
};

export const fmtMoney = (n, cur = "ARS") => {
  const sym = cur === "USD" ? "U$D" : cur === "EUR" ? "€" : "$";
  return `${sym} ${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;
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

export function SummaryCard({ label, value, color, sub, icon }) {
  return (
    <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
      padding:"16px 20px", boxShadow:T.shadow, flex:1, minWidth:140 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div style={{ fontSize:11, color:T.muted, fontWeight:600, letterSpacing:".06em",
          textTransform:"uppercase", marginBottom:6 }}>{label}</div>
        {icon && <span style={{ fontSize:16, opacity:.5 }}>{icon}</span>}
      </div>
      <div style={{ fontSize:20, fontWeight:800, color: color ?? T.text, fontFamily:T.mono }}>
        {value}
      </div>
      {sub && <div style={{ fontSize:11, color:T.dim, marginTop:4 }}>{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
      <div>
        <h1 style={{ fontSize:24, fontWeight:900, color:T.text, margin:0, letterSpacing:"-.02em" }}>{title}</h1>
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

export function Input({ label, value, onChange, placeholder, type="text", required }) {
  return (
    <div>
      <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>
        {label}{required && <span style={{ color:T.red }}> *</span>}
      </label>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width:"100%", background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
          borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
          fontFamily:T.font, outline:"none", boxSizing:"border-box" }} />
    </div>
  );
}

export function Select({ label, value, onChange, options, required }) {
  return (
    <div>
      <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>
        {label}{required && <span style={{ color:T.red }}> *</span>}
      </label>
      <select value={value} onChange={e=>onChange(e.target.value)}
        style={{ width:"100%", background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
          borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
          fontFamily:T.font, outline:"none", boxSizing:"border-box" }}>
        <option value="">— Seleccionar —</option>
        {options.map(o => (
          <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
        ))}
      </select>
    </div>
  );
}
