// Piezas visuales compartidas por los reportes de compensación de Sedes
// (Compensación · Sedes y Sueldos Sedes · Franquiciados).
import { T, fmt, fmtN, th, thR, td, tdR, lbl, sel, COLOR_BASE, COLOR_INC } from "./compensacionEstilos";
import { fmtPct } from "../lib/compensacionSedes";

// ── Piezas visuales ─────────────────────────────────────────────────────────────────────────────
export function Seccion({ titulo, sub, children }) {
  return (
    <div className="cs-seccion" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 18, breakInside: "avoid" }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{titulo}</div>
      {sub && <div style={{ fontSize: 12, color: T.muted, marginBottom: 10 }}>{sub}</div>}
      {children}
    </div>
  );
}
export function Lectura({ children }) {
  if (!children) return null;
  return <div style={{ fontSize: 12.5, color: T.text, marginTop: 10, lineHeight: 1.45 }}><b>Lectura:</b> {children}</div>;
}
export function Kpi({ label, value, sub, destacado }) {
  return (
    <div style={{ flex: "1 1 150px", minWidth: 150, borderRadius: 10, padding: "12px 14px",
      background: destacado ? T.dark : T.card, border: `1px solid ${destacado ? T.dark : T.border}` }}>
      <div style={{ ...lbl, color: destacado ? "rgba(255,255,255,.6)" : T.muted }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: destacado ? T.fluo : T.text, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, marginTop: 2, color: destacado ? "rgba(255,255,255,.7)" : T.muted }}>{sub}</div>}
    </div>
  );
}
export function Sel({ label, value, onChange, children, disabled }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={lbl}>{label}</span>
      <select style={sel} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>{children}</select></label>
  );
}
// Tabla con encabezado declarativo: cols = [[título, "r" si va a la derecha | "c" centrado], ...].
export function Tabla({ cols, fontSize, children }) {
  const estilo = (al) => (al === "r" ? thR : al === "c" ? { ...th, textAlign: "center" } : th);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize }}>
        <thead><tr style={{ background: T.head }}>{cols.map(([t, al], i) => <th key={i} style={estilo(al)}>{t}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
// Las celdas de ratios que comparten Por puesto, Por sede y Por persona: base → final (+mejora), promedio
// mensual (solo coaches: para Front Desk "cobrado por mes" ya es el promedio), % incentivos.
export function CeldasRatio({ r, fmtU, esCoach }) {
  return (<>
    <td style={tdR}>{fmtU(r.baseUnidad)}</td>
    <td style={{ ...tdR, fontWeight: 700 }}>{fmtU(r.finalUnidad)}{r.mejoraPct != null && <span style={{ color: T.green, fontSize: 11, fontWeight: 600 }}> {fmtPct(r.mejoraPct, true)}</span>}</td>
    {esCoach && <td style={tdR}>{fmt(r.promedioMensual)}</td>}
    <td style={tdR}>{fmtPct(r.pctIncentivos)}</td>
  </>);
}
// Cascada: la escalera como barras flotantes, de la base (izquierda) a lo pagado (derecha), por unidad.
export function Cascada({ pasos, W = 860, H = 280 }) {
  const padL = 64, padR = 12, padT = 26, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const items = pasos.map((p, i) => ({ ...p, desde: i === 0 ? 0 : pasos[i - 1].acumUnidad, hasta: p.acumUnidad }));
  const fin = pasos[pasos.length - 1]?.acumUnidad || 0;
  items.push({ key: "__total", corto: "Con incentivos", desde: 0, hasta: fin, total: true });
  const maxV = Math.max(1, ...items.map(i => Math.max(i.desde, i.hasta)));
  const niceMax = (() => { const p = Math.pow(10, Math.floor(Math.log10(maxV))); const f = maxV / p; const n = f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10; return n * p; })();
  const y = (v) => padT + plotH * (1 - Math.max(0, v) / niceMax);
  const band = plotW / items.length, barW = Math.min(60, band * 0.64);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {[0, 0.25, 0.5, 0.75, 1].map(f => (
        <g key={f}>
          <line x1={padL} y1={y(niceMax * f)} x2={W - padR} y2={y(niceMax * f)} stroke="#e5e7eb" strokeWidth="1" />
          <text x={padL - 8} y={y(niceMax * f) + 3} textAnchor="end" fontSize="10" fill="#898781">{fmtN(niceMax * f)}</text>
        </g>
      ))}
      {items.map((it, i) => {
        const x = padL + i * band + (band - barW) / 2, delta = it.hasta - it.desde;
        const top = y(Math.max(it.desde, it.hasta)), h = Math.max(1, Math.abs(y(it.desde) - y(it.hasta)));
        const color = it.total ? T.dark : it.base ? COLOR_BASE : delta < 0 ? T.red : COLOR_INC;
        const etiqueta = it.total || it.base ? fmtN(it.hasta) : `${delta < 0 ? "−" : "+"}${fmtN(Math.abs(delta))}`;
        return (
          <g key={it.key}>
            <rect x={x} y={top} width={barW} height={h} rx={3} fill={color}><title>{`${it.label || it.corto}: ${fmtN(it.hasta)}`}</title></rect>
            {i < items.length - 1 && <line x1={x + barW} y1={y(it.hasta)} x2={x + band} y2={y(it.hasta)} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />}
            <text x={x + barW / 2} y={top - 5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#334155">{etiqueta}</text>
            <text x={x + barW / 2} y={H - padB + 15} textAnchor="middle" fontSize="10" fill="#52514e">{it.corto}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Tabla de la escalera (escalón × columna). `acumulado`: cada celda muestra el acumulado por unidad en negrita
// y, debajo, lo que suma el escalón (vista Mensual); si no, solo lo que suma (vista Evolución). Los escalones que
// no entran al $/h (coaches: clases especiales y otras novedades) van después de la línea oscura, por persona y
// mes, y al final el sueldo promedio que sí los incluye.
const signo = (v) => (v < 0 ? "−" : "+");
export function TablaEscalera({ esc, acumulado, fmtU, esCoach }) {
  const enRatio = esc.pasos.filter(p => !p.fueraRatio), fuera = esc.pasos.filter(p => p.fueraRatio);
  const idx = (key) => esc.pasos.findIndex(p => p.key === key);
  const colKey = (c) => c.rol ?? c.key;
  return (
    <Tabla cols={[["Escalón"], ...esc.columnas.map(c => [c.label, "r"])]}>
      {enRatio.map((p, i) => (
        <tr key={p.key} style={{ background: p.base ? T.bg : undefined }}>
          <td style={{ ...td, whiteSpace: "normal" }}><span style={{ color: T.dim, marginRight: 8, fontSize: 11 }}>{i + 1}</span>{p.label}</td>
          {esc.columnas.map(c => {
            const x = c.pasos[idx(p.key)];
            return (
              <td key={colKey(c)} style={{ ...tdR, lineHeight: 1.25 }}>
                <div style={{ fontWeight: acumulado || p.base ? 700 : 500, color: !acumulado && x.monto < 0 ? T.red : T.text }}>
                  {acumulado ? fmtU(x.acumUnidad) : p.base ? fmtU(x.porUnidad) : `${signo(x.monto)}${fmtN(Math.abs(x.porUnidad))}`}
                </div>
                <div style={{ fontSize: 11, color: !acumulado || p.base ? T.muted : x.monto < 0 ? T.red : T.green }}>
                  {p.base ? `${fmtPct(x.pctTotal)} de lo pagado` : acumulado ? `${signo(x.monto)}${fmtN(Math.abs(x.porUnidad))} · ${fmtPct(Math.abs(x.pctTotal))}` : fmtPct(Math.abs(x.pctTotal))}
                </div>
              </td>
            );
          })}
        </tr>
      ))}
      <tr style={{ background: T.dark, color: "#fff", fontWeight: 700 }}>
        <td style={{ ...td, borderBottom: "none" }}>{esCoach ? "$/h con incentivos" : "Sueldo promedio por mes"} · mejora sobre la base</td>
        {esc.columnas.map(c => <td key={colKey(c)} style={{ ...tdR, borderBottom: "none" }}>{fmtU(c.finalUnidad)} <span style={{ color: T.fluo }}>{fmtPct(c.mejoraPct, true)}</span></td>)}
      </tr>
      {fuera.length > 0 && <>
        <tr><td colSpan={esc.columnas.length + 1} style={{ ...td, fontSize: 11, color: T.muted, paddingTop: 10, whiteSpace: "normal" }}>
          Además cobró, por persona y mes (trabajo cuyas horas no están cargadas: no entra al $/h)</td></tr>
        {fuera.map(p => (
          <tr key={p.key}>
            <td style={{ ...td, whiteSpace: "normal" }}>{p.label}</td>
            {esc.columnas.map(c => { const x = c.pasos[idx(p.key)]; return (
              <td key={colKey(c)} style={{ ...tdR, lineHeight: 1.25 }}>
                <div>{signo(x.monto)}{fmt(Math.abs(x.porPersonaMes))}</div>
                <div style={{ fontSize: 11, color: T.muted }}>{fmtPct(Math.abs(x.pctTotal))}</div>
              </td>); })}
          </tr>
        ))}
        <tr style={{ background: T.bg, fontWeight: 700 }}>
          <td style={td}>Sueldo promedio por mes, con todo</td>
          {esc.columnas.map(c => <td key={colKey(c)} style={tdR}>{fmt(c.promedioMensual)}</td>)}
        </tr>
      </>}
    </Tabla>
  );
}
