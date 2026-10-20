import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { fetchLiquidacionesCerradas, fetchLegajos, fetchObjetivos, fetchCategorias, ambitoLiq } from "../lib/sueldosApi";
import {
  MESES_CORTO, MUNDOS, mundoDe, fmtPct, mesesConsecutivos, filtrarSedes, filtrarSedeMundo, sedesDisponibles, mesesCerrados,
  normalizarLiqs, rollupPersonaMes, porPuesto, escalera, porSede, porPersona, evolucionMensual, objetivosGrupales, lecturas,
} from "../lib/compensacionSedes";
import { fmtPesos } from "./sueldosUi";
import { copiarReporteComoImagen } from "../numbers/fotoReporte";
import { RowMenu } from "../numbers/comprobantesUi";

// Reporte "Compensación · Sedes": cómo cobra el staff de Sedes, para el management. Dos mundos
// (Coaches / Front Desk) y dos vistas (Mensual / Evolución). El eje es la ESCALERA: cómo sube el
// sueldo de cada puesto escalón por escalón, de la base (tarifa o fijo) a lo pagado. Solo meses
// CERRADOS, campos congelados de la liquidación. Cálculo en lib/compensacionSedes.js.

const T = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#1e293b", muted: "#64748b", dim: "#94a3b8",
  blue: "#2563eb", green: "#16a34a", red: "#dc2626", head: "#f1f5f9", dark: "#1e2022", fluo: "#ADFF19",
  font: "'Inter', system-ui, sans-serif",
};
const fmt   = (n) => fmtPesos(n, { guion: "vacio" });
const fmtN  = (n) => (n == null ? "—" : Math.round(Number(n) || 0).toLocaleString("es-AR"));
const fmtM  = (n) => (n == null ? "—" : `${(Number(n) / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M`);
const th = { padding: "7px 10px", textAlign: "left", fontWeight: 600, color: T.muted, fontSize: 11, letterSpacing: ".04em",
  borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" };
const thR = { ...th, textAlign: "right" };
const td  = { padding: "6px 10px", fontSize: 13, whiteSpace: "nowrap", borderBottom: `1px solid ${T.border}` };
const tdR = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: T.muted };
const sel = { border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: T.font,
  background: "#fff", color: T.text };
const btn = (primary) => ({ background: primary ? T.blue : "transparent", color: primary ? "#fff" : T.muted,
  border: primary ? "none" : `1px solid ${T.border}`, borderRadius: 7, padding: "7px 14px", fontSize: 13, fontWeight: 600,
  cursor: "pointer", fontFamily: T.font });
const vacio = { border: `1px dashed ${T.border}`, borderRadius: 8, padding: 40, textAlign: "center", color: T.muted, fontSize: 13 };
const COLOR_BASE = "#2a78d6", COLOR_INC = "#1baf7a";
const hoy = new Date();
const MES_ACTUAL = { mes: hoy.getMonth() + 1, anio: hoy.getFullYear() };
const ANIOS = [hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1].filter(a => a >= 2026);
const MSG_COPIADA = "✔ Imagen copiada — pegala en PowerPoint (Ctrl+V).";
const VISTAS = [{ key: "mensual", label: "Mensual" }, { key: "evolucion", label: "Evolución mensual" }];
// Tilda/destilda una clave en un estado Set.
const toggleEn = (set) => (key) => set(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

// ── Piezas visuales ─────────────────────────────────────────────────────────────────────────────
function Seccion({ titulo, sub, children }) {
  return (
    <div className="cs-seccion" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 18, breakInside: "avoid" }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{titulo}</div>
      {sub && <div style={{ fontSize: 12, color: T.muted, marginBottom: 10 }}>{sub}</div>}
      {children}
    </div>
  );
}
function Lectura({ children }) {
  if (!children) return null;
  return <div style={{ fontSize: 12.5, color: T.text, marginTop: 10, lineHeight: 1.45 }}><b>Lectura:</b> {children}</div>;
}
function Kpi({ label, value, sub, destacado }) {
  return (
    <div style={{ flex: "1 1 150px", minWidth: 150, borderRadius: 10, padding: "12px 14px",
      background: destacado ? T.dark : T.card, border: `1px solid ${destacado ? T.dark : T.border}` }}>
      <div style={{ ...lbl, color: destacado ? "rgba(255,255,255,.6)" : T.muted }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: destacado ? T.fluo : T.text, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, marginTop: 2, color: destacado ? "rgba(255,255,255,.7)" : T.muted }}>{sub}</div>}
    </div>
  );
}
function Sel({ label, value, onChange, children, disabled }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={lbl}>{label}</span>
      <select style={sel} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>{children}</select></label>
  );
}
// Grupo de pestañas (mundo, vista): botones pegados, el activo en oscuro.
function Pestanas({ opciones, value, onChange, grande }) {
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
      {opciones.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)}
          style={{ background: o.key === value ? T.dark : "#fff", color: o.key === value ? T.fluo : T.muted, border: "none",
            padding: grande ? "8px 18px" : "6px 12px", fontSize: grande ? 14 : 12.5, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
// Tabla con encabezado declarativo: cols = [[título, "r" si va a la derecha | "c" centrado], ...].
function Tabla({ cols, fontSize, children }) {
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
function CeldasRatio({ r, fmtU, esCoach }) {
  return (<>
    <td style={tdR}>{fmtU(r.baseUnidad)}</td>
    <td style={{ ...tdR, fontWeight: 700 }}>{fmtU(r.finalUnidad)}{r.mejoraPct != null && <span style={{ color: T.green, fontSize: 11, fontWeight: 600 }}> {fmtPct(r.mejoraPct, true)}</span>}</td>
    {esCoach && <td style={tdR}>{fmt(r.promedioMensual)}</td>}
    <td style={tdR}>{fmtPct(r.pctIncentivos)}</td>
  </>);
}
const colsRatio = (esCoach) => [[esCoach ? "$/h tarifa" : "Fijo / mes", "r"], [esCoach ? "$/h c/ incentivos" : "Cobrado / mes", "r"], ...(esCoach ? [["Promedio mensual", "r"]] : []), ["% incentivos", "r"]];
// Cascada: la escalera como barras flotantes, de la base (izquierda) a lo pagado (derecha), por unidad.
function Cascada({ pasos, W = 860, H = 280 }) {
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
// Barras agrupadas verticales: dos series por mes (base vs con incentivos) + tick de referencia.
function BarrasAgrupadas({ grupos, series, fmtU, W = 900, H = 300, refLabel }) {
  const [hover, setHover] = useState(null);
  const padL = 64, padR = 14, padT = 18, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxV = Math.max(1, ...grupos.flatMap(g => series.map(s => Number(g.valores[s.key]) || 0)), ...grupos.map(g => Number(g.ref) || 0));
  const niceMax = (() => { const p = Math.pow(10, Math.floor(Math.log10(maxV))); const f = maxV / p; const n = f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10; return n * p; })();
  const y = (v) => padT + plotH * (1 - v / niceMax);
  const n = grupos.length || 1, band = plotW / n, barW = Math.min(44, band * 0.3);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <g key={f}>
            <line x1={padL} y1={y(niceMax * f)} x2={W - padR} y2={y(niceMax * f)} stroke="#e5e7eb" strokeWidth="1" />
            <text x={padL - 8} y={y(niceMax * f) + 3} textAnchor="end" fontSize="10" fill="#898781">{fmtN(niceMax * f)}</text>
          </g>
        ))}
        {grupos.map((g, i) => {
          const x0 = padL + i * band + band / 2;
          return (
            <g key={g.label}>
              {series.map((s, j) => {
                const v = Number(g.valores[s.key]) || 0;
                const x = x0 - series.length * barW / 2 + j * (barW + 3);
                return (
                  <g key={s.key}>
                    <rect x={x} y={y(v)} width={barW} height={Math.max(0, plotH - (y(v) - padT))} rx={3} fill={s.color}
                      onMouseEnter={() => setHover({ g, s, v })}><title>{`${s.label} · ${g.label}: ${fmtU(v)}`}</title></rect>
                    <text x={x + barW / 2} y={y(v) - 4} textAnchor="middle" fontSize="10" fontWeight="600" fill="#334155">{fmtN(v)}</text>
                  </g>
                );
              })}
              {g.ref > 0 && (
                <line x1={x0 - band * 0.4} y1={y(g.ref)} x2={x0 + band * 0.4} y2={y(g.ref)} stroke="#64748b" strokeWidth="1.5" strokeDasharray="4 3">
                  <title>{`${refLabel} · ${g.label}: ${fmtU(g.ref)}`}</title></line>
              )}
              <text x={x0} y={H - padB + 16} textAnchor="middle" fontSize="11" fill="#52514e">{g.label}</text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 6, alignItems: "center" }}>
        {series.map(s => <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: T.muted }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />{s.label}</span>)}
        {refLabel && <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: T.muted }}>
          <span style={{ width: 14, borderTop: "2px dashed #64748b" }} />{refLabel}</span>}
        {hover && <span style={{ marginLeft: "auto", fontSize: 12, color: T.text }}><b>{hover.s.label}</b> · {hover.g.label}: <b>{fmtU(hover.v)}</b></span>}
      </div>
    </div>
  );
}
// Selector de meses tildables (vista Evolución): un botón que abre una lista de checkboxes.
function MesesPicker({ meses, seleccion, onToggle, onTodos, label }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!abierto) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setAbierto(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [abierto]);
  return (
    <div ref={ref} style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
      <span style={lbl}>Meses</span>
      <button onClick={() => setAbierto(v => !v)} disabled={!meses.length}
        style={{ ...sel, cursor: "pointer", minWidth: 130, textAlign: "left", display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>{label || "Elegí meses"}</span><span style={{ color: T.dim }}>▾</span>
      </button>
      {abierto && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50, background: "#fff", border: `1px solid ${T.border}`,
          borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,.12)", padding: "6px 0", minWidth: 180 }}>
          {meses.map(m => (
            <label key={m.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={seleccion.has(m.key)} onChange={() => onToggle(m.key)} />{m.label}
            </label>
          ))}
          <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 4, padding: "6px 12px 2px" }}>
            <button onClick={onTodos} style={{ ...btn(false), padding: "4px 10px", fontSize: 12 }}>Todos</button>
          </div>
        </div>
      )}
    </div>
  );
}
// Tabla sede × mes del objetivo grupal (% cobrado y monto); con un solo mes es una columna.
function TablaObjetivos({ objs, meses }) {
  const varios = meses.length > 1;
  return (
    <Tabla cols={[["Sede"], ...(varios ? [["Cumplidos", "c"]] : []), ...meses.map(me => [me.label, "c"])]}>
      {objs.sedes.map(s => (
        <tr key={s.sede_id}>
          <td style={{ ...td, fontWeight: 600 }}>{s.sede_nombre}</td>
          {varios && <td style={{ ...td, textAlign: "center", width: 1, color: T.muted, fontSize: 12 }}>{s.cumplidos}/{meses.length}</td>}
          {meses.map(me => {
            const cel = objs.celdas[`${s.sede_id}|${me.key}`];
            const ok = cel?.cumplido;
            return (
              <td key={me.key} style={{ ...td, textAlign: "center", background: ok ? `rgba(0,131,0,${0.08 + 0.5 * Math.min(1, (cel.pct || 0) / 55)})` : T.bg }}
                title={cel?.inconsistente ? `Configurado ${cel.pctConfig} %, pagado ${cel.pctPagado} %` : undefined}>
                {ok ? <><b>{cel.pct} %</b>{cel.inconsistente && <span style={{ color: T.red }}> ⚠</span>}<div style={{ fontSize: 11, color: T.muted }}>{fmt(cel.monto)}</div></> : <span style={{ color: T.dim }}>—</span>}
              </td>
            );
          })}
        </tr>
      ))}
      <tr style={{ background: T.bg, fontWeight: 700 }}>
        <td style={td}>Total pagado</td>
        {varios && <td style={td} />}
        {meses.map(me => <td key={me.key} style={{ ...td, textAlign: "center" }}>{fmt(objs.totalMes[me.key] || 0)}</td>)}
      </tr>
    </Tabla>
  );
}

// ── Pantalla ────────────────────────────────────────────────────────────────────────────────────
export default function PantallaCompensacionSedes({ pais = "AR" }) {
  const [anio,     setAnio]     = useState(hoy.getFullYear());
  const [mundoKey, setMundoKey] = useState("coaches");
  const [vista,    setVista]    = useState("mensual");
  const [mesSel,   setMesSel]   = useState("");                // vista Mensual: key "AAAA-MM"
  const [mesesSel, setMesesSel] = useState(() => new Set());   // vista Evolución: keys tildadas
  const [sedeSel,  setSedeSel]  = useState("");                // "" = todas
  const [liqs,     setLiqs]     = useState([]);
  const [mesesTodos, setMesesTodos] = useState([]);           // meses cerrados del año
  const [legajos,  setLegajos]  = useState([]);
  const [objetivosPorMes, setObjetivosPorMes] = useState({});
  const [tarifasPorMes,   setTarifasPorMes]   = useState({});
  const [loading,  setLoading]  = useState(true);
  const [fallo,    setFallo]    = useState("");
  const [fotoMsg,  setFotoMsg]  = useState(null);
  const [sedesAbiertas, setSedesAbiertas] = useState(() => new Set());
  const reportRef = useRef(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true); setFallo("");
      try {
        // Objetivos y tarifas bajan la hoja entera (una request cada una) y se filtran por mes desde la
        // caché: se piden en la misma ronda que las liquidaciones para no esperar dos viajes al script.
        const [ls, legs] = await Promise.all([
          fetchLiquidacionesCerradas(anio), fetchLegajos(),
          fetchObjetivos(1, anio, pais).catch(() => []), fetchCategorias(1, anio, pais).catch(() => []),
        ]);
        if (cancel) return;
        const sedesLiqs = filtrarSedes(ls, { pais, anio, ambitoDe: ambitoLiq });
        const meses = mesesCerrados(sedesLiqs, { excluirMesActual: MES_ACTUAL });
        const [objs, cats] = await Promise.all([
          Promise.all(meses.map(m => fetchObjetivos(m.mes, m.anio, pais).catch(() => []))),
          Promise.all(meses.map(m => fetchCategorias(m.mes, m.anio, pais).catch(() => []))),
        ]);
        if (cancel) return;
        setLiqs(sedesLiqs); setLegajos(legs); setMesesTodos(meses);
        setObjetivosPorMes(Object.fromEntries(meses.map((m, i) => [m.key, objs[i]])));
        setTarifasPorMes(Object.fromEntries(meses.map((m, i) => [m.key, cats[i]])));
        // Defaults: Mensual = último mes cerrado; Evolución = todos los meses cerrados.
        setMesSel(prev => (meses.some(m => m.key === prev) ? prev : meses[meses.length - 1]?.key || ""));
        setMesesSel(prev => {
          const vivos = new Set([...prev].filter(k => meses.some(m => m.key === k)));
          return vivos.size ? vivos : new Set(meses.map(m => m.key));
        });
      } catch (e) {
        if (!cancel) setFallo(e?.message || "No se pudieron cargar los datos.");
      } finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [anio, pais]);

  const mundo = mundoDe(mundoKey);
  const esCoach = mundo.tipo === "coach", mensual = vista === "mensual";
  const fmtU = (n) => (n == null ? "—" : esCoach ? `${fmtPesos(n)}/h` : fmtPesos(n));
  const unidadLabel = esCoach ? "$/h" : "$ por persona y mes";
  const mesesActivos = useMemo(() => (mensual ? new Set(mesSel ? [mesSel] : []) : mesesSel), [mensual, mesSel, mesesSel]);
  const meses = useMemo(() => mesesTodos.filter(m => mesesActivos.has(m.key)), [mesesTodos, mesesActivos]);
  const sedesLista = useMemo(() => sedesDisponibles(liqs), [liqs]);
  const filas = useMemo(() => normalizarLiqs(filtrarSedeMundo(liqs, { meses: mesesActivos, sede_id: sedeSel, tipo: mundo.tipo })), [liqs, mesesActivos, sedeSel, mundo.tipo]);
  const personasMes = useMemo(() => rollupPersonaMes(filas, legajos), [filas, legajos]);
  const k        = useMemo(() => porPuesto(personasMes, mundo), [personasMes, mundo]);          // por puesto + total (KPIs)
  const esc      = useMemo(() => escalera(k.filas.length > 1 ? k.filas : [k.total], mundo.tipo), [k, mundo.tipo]);
  const sedes    = useMemo(() => porSede(filas, mundo.tipo), [filas, mundo.tipo]);
  const personas = useMemo(() => porPersona(personasMes), [personasMes]);
  const evol     = useMemo(() => evolucionMensual(personasMes, meses, mundo.tipo, tarifasPorMes), [personasMes, meses, mundo.tipo, tarifasPorMes]);
  const escMes   = useMemo(() => escalera(evol, mundo.tipo), [evol, mundo.tipo]);
  // Por puesto mes a mes (vista Evolución): una fila por rol, una columna por mes.
  const evolPuesto = useMemo(() => {
    const porMes = meses.map(me => porPuesto(personasMes.filter(p => p.mesKey === me.key), mundo));
    const roles = [...new Map(porMes.flatMap(pp => pp.filas.filter(r => !r._sub)).map(r => [r.rol, r.label])).entries()];
    return { porMes, roles };
  }, [personasMes, meses, mundo]);
  const objs     = useMemo(() => objetivosGrupales(filas, objetivosPorMes, meses), [filas, objetivosPorMes, meses]);
  const lec      = useMemo(() => lecturas({ mundo, puesto: k, esc, sedes, evolucion: evol, objetivos: objs, meses }), [mundo, k, esc, sedes, evol, objs, meses]);
  // "Sep 2026" · "Jul–Sep 2026" si son meses consecutivos · "Jul, Sep 2026" si no.
  const periodoLabel = useMemo(() => {
    if (!meses.length) return "";
    const nombres = meses.map(m => MESES_CORTO[m.mes - 1]);
    const seguidos = meses.every((m, i) => i === 0 || mesesConsecutivos(meses[i - 1], m));
    return `${meses.length > 1 && seguidos ? `${nombres[0]}–${nombres[nombres.length - 1]}` : nombres.join(", ")} ${anio}`;
  }, [meses, anio]);
  const sedeLabel = sedeSel ? (sedesLista.find(s => s.sede_id === sedeSel)?.sede_nombre || sedeSel) : "Todas las sedes";
  const t = k.total;
  const toggleMes = toggleEn(setMesesSel), toggleSede = toggleEn(setSedesAbiertas);
  const colTotal = esc.columnas[esc.columnas.length - 1];
  const sinDatos = loading || !meses.length;

  // Copiar como imagen: primero el helper compartido (SVG foreignObject → PNG → portapapeles); si el
  // navegador no lo permite, html2canvas (el de los recibos) y, si tampoco deja escribir el portapapeles,
  // se descarga el PNG. Así siempre queda una imagen para pegar en PowerPoint.
  const copiarFoto = async () => {
    const node = reportRef.current;
    if (!node) return;
    const nombre = `Compensacion_${mundo.label.replace(/\s+/g, "")}_${pais}_${periodoLabel.replace(/[^\wÀ-ÿ]+/g, "_")}.png`;
    try {
      await copiarReporteComoImagen(node, { caption: `Compensación · ${mundo.label} · ${pais} · ${periodoLabel} · ${sedeLabel}` });
      setFotoMsg(MSG_COPIADA);
    } catch {
      try {
        const { default: html2canvas } = await import("html2canvas");
        const canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale: 2 });
        const blob = await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error("sin imagen"))), "image/png"));
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          setFotoMsg(MSG_COPIADA);
        } catch {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          setFotoMsg(`El navegador no deja copiar al portapapeles: se descargó ${nombre}.`);
        }
      } catch { setFotoMsg("No se pudo generar la imagen en este navegador."); }
    }
    setTimeout(() => setFotoMsg(null), 4500);
  };

  // Tabla de la escalera (escalón × columna). `acumulado`: cada celda muestra el acumulado por unidad en negrita
  // y, debajo, lo que suma el escalón (vista Mensual); si no, solo lo que suma (vista Evolución). Los escalones que
  // no entran al $/h (coaches: clases especiales y otras novedades) van después de la línea oscura, por persona y
  // mes, y al final el sueldo promedio que sí los incluye.
  const signo = (v) => (v < 0 ? "−" : "+");
  const TablaEscalera = ({ esc, acumulado }) => {
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
  };

  return (
    <div className="fade" style={{ padding: "24px 28px", maxWidth: 1180, fontFamily: T.font, color: T.text, "--border": T.border }}>
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body * { visibility: hidden; }
          #comp-sedes-report, #comp-sedes-report * { visibility: visible; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          #comp-sedes-report { position: absolute; left: 0; top: 0; width: 100%; zoom: .72; }
          .no-print { display: none !important; }
          .cs-seccion { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      {/* Toolbar (fuera de la foto y de la impresión) */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, flexGrow: 1 }}>Compensación · Sedes</h2>
        <Pestanas opciones={MUNDOS} value={mundoKey} onChange={setMundoKey} grande />
        <Pestanas opciones={VISTAS} value={vista} onChange={setVista} />
        <RowMenu align="right" label="⋯" items={[
          { label: "📋 Copiar imagen", onClick: copiarFoto, disabled: sinDatos, hint: "Copia el reporte como PNG para pegar en PowerPoint" },
          { label: "🖨 Imprimir", onClick: () => window.print(), disabled: sinDatos, hint: "A4 apaisado" },
        ]} />
      </div>
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <Sel label="Año" value={anio} onChange={v => setAnio(Number(v))}>{ANIOS.map(a => <option key={a} value={a}>{a}</option>)}</Sel>
        {mensual
          ? <Sel label="Mes" value={mesSel} onChange={setMesSel} disabled={!mesesTodos.length}>{mesesTodos.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</Sel>
          : <MesesPicker meses={mesesTodos} seleccion={mesesSel} onToggle={toggleMes} onTodos={() => setMesesSel(new Set(mesesTodos.map(m => m.key)))} label={periodoLabel} />}
        <Sel label="Sede" value={sedeSel} onChange={setSedeSel} disabled={!sedesLista.length}>
          <option value="">Todas</option>{sedesLista.map(s => <option key={s.sede_id} value={s.sede_id}>{s.sede_nombre}</option>)}</Sel>
      </div>
      {fotoMsg && <div className="no-print" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>{fotoMsg}</div>}
      {fallo && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>⚠️ {fallo}</div>}

      {loading ? <p style={{ color: T.muted, fontSize: 13 }}>Cargando…</p> : !mesesTodos.length ? (
        <div style={vacio}>No hay liquidaciones de Sedes cerradas en {anio}.</div>
      ) : !meses.length ? (
        <div style={vacio}>Tildá al menos un mes.</div>
      ) : !personasMes.length ? (
        <div style={vacio}>Sin liquidaciones de {mundo.label} en {sedeLabel} · {periodoLabel}.</div>
      ) : (
        <div id="comp-sedes-report" ref={reportRef}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Cómo cobra {esCoach ? "un coach" : "Front Desk"} · {pais} · {periodoLabel}</div>
            <div style={{ fontSize: 12, color: T.muted }}>
              {sedeLabel} · {t.personas} personas · {mensual ? "un mes" : `${meses.length} meses`} · importes brutos, lo liquidado · unidad: {unidadLabel}.
            </div>
          </div>

          {/* KPIs */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
            <Kpi label={esCoach ? "$/h de tarifa" : "Sueldo fijo por mes"} value={fmtU(t.baseUnidad)} sub={esCoach ? `${t.personas} coaches · ${fmtN(t.horasTotal)} h trabajadas` : `${t.personas} personas · promedio`} />
            <Kpi label={esCoach ? "$/h con incentivos" : "Sueldo promedio por mes"} value={fmtU(t.finalUnidad)} sub={`${fmtPct(t.mejoraPct, true)} sobre ${esCoach ? "la tarifa" : "el fijo"}`} destacado />
            {esCoach
              ? <>
                  <Kpi label="Horas por mes" value={`${fmtN(t.horasPorMes)} h`} sub="promedio por coach" />
                  <Kpi label="Sueldo promedio" value={fmt(t.promedioMensual)} sub={`por coach y mes · ${fmtPct(t.pctIncentivos)} son incentivos`} />
                </>
              : <Kpi label="Objetivo grupal" value={fmtM(objs.total)} sub={`${fmtPct(t.total ? objs.total / t.total : 0)} de lo pagado`} />}
          </div>

          {mensual ? (<>
            {/* Escalera del mes */}
            <Seccion titulo="La escalera: de la base a los incentivos" sub={`Cómo sube el sueldo escalón por escalón, en ${unidadLabel}. Barras: ${colTotal.label.toLowerCase()}. Tabla: cada puesto.`}>
              {colTotal && <Cascada pasos={colTotal.pasos.map(p => ({ ...p, ...esc.pasos.find(e => e.key === p.key) })).filter(p => !p.fueraRatio)} />}
              <div style={{ marginTop: 14 }}><TablaEscalera esc={esc} acumulado /></div>
              <Lectura>{lec.escalera}</Lectura>
            </Seccion>

            {/* Por puesto */}
            <Seccion titulo="Por puesto" sub={`Qué cobra cada rol: ${esCoach ? "horas por persona, tarifa y $/h con todos los incentivos" : "fijo y total por persona y mes"}, y cuánto de eso son incentivos.`}>
              <Tabla cols={[["Puesto"], ["Personas", "r"], ...(esCoach ? [["Horas / persona", "r"]] : []), ...colsRatio(esCoach)]}>
                {k.filas.map(r => (
                  <tr key={r.rol} style={{ background: r._sub ? T.bg : undefined, fontWeight: r._sub ? 700 : 400 }}>
                    <td style={td}>{r.label}</td><td style={tdR}>{r.personas}</td>
                    {esCoach && <td style={tdR}>{r.horasTotal ? fmtN(r.horasPorMes) : "—"}</td>}
                    <CeldasRatio r={r} fmtU={fmtU} esCoach={esCoach} />
                  </tr>
                ))}
              </Tabla>
              <Lectura>{lec.puesto}</Lectura>
            </Seccion>

            {/* Por sede (solo cuando se ven todas) */}
            {!sedeSel && sedes.length > 1 && (
              <Seccion titulo="Por sede" sub="Masa salarial de cada sede y cuánto de eso son incentivos. Click en una sede para ver sus puestos.">
                <Tabla cols={[["Sede"], ["Personas", "r"], ...(esCoach ? [["Horas", "r"]] : []), ["Total mes", "r"], ...colsRatio(esCoach)]}>
                  {sedes.map(s => {
                    const abierta = sedesAbiertas.has(s.sede_id);
                    return (
                      <Fragment key={s.sede_id}>
                        <tr onClick={() => toggleSede(s.sede_id)} style={{ cursor: "pointer", fontWeight: 600 }}>
                          <td style={td}><span style={{ color: T.dim, marginRight: 6 }}>{abierta ? "▾" : "▸"}</span>{s.sede_nombre}</td>
                          <td style={tdR}>{s.personas}</td>{esCoach && <td style={tdR}>{fmtN(s.horasTotal)}</td>}<td style={tdR}>{fmt(s.total)}</td>
                          <CeldasRatio r={s} fmtU={fmtU} esCoach={esCoach} />
                        </tr>
                        {abierta && s.roles.map(r => (
                          <tr key={r.rol} style={{ background: T.bg, color: T.muted, fontSize: 12 }}>
                            <td style={{ ...td, paddingLeft: 30 }}>{r.label}</td><td style={tdR}>{r.personas}</td>
                            {esCoach && <td style={tdR}>{r.horasTotal ? fmtN(r.horasTotal) : "—"}</td>}<td style={tdR}>{fmt(r.total)}</td>
                            <CeldasRatio r={r} fmtU={fmtU} esCoach={esCoach} />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </Tabla>
                <Lectura>{lec.sede}</Lectura>
              </Seccion>
            )}

            {/* Por persona */}
            <Seccion titulo="Por persona" sub={`${esCoach ? "Cuántas horas trabaja y cuánto gana cada uno" : "Fijo y total cobrado por cada uno"}. Ordenado por puesto y total.`}>
              <Tabla cols={[["Persona"], ["Puesto"], ...(esCoach ? [["Horas", "r"]] : []), ...colsRatio(esCoach)]}>
                {personas.map(p => (
                  <tr key={p.legajo_id}>
                    <td style={{ ...td, fontWeight: 600 }}>{p.nombre}</td><td style={{ ...td, color: T.muted }}>{p.label}</td>
                    {esCoach && <td style={tdR}>{p.horasTotal ? fmtN(p.horasTotal) : "—"}</td>}
                    <CeldasRatio r={p} fmtU={fmtU} esCoach={esCoach} />
                  </tr>
                ))}
              </Tabla>
            </Seccion>
          </>) : (<>
            {/* Evolución: base vs con incentivos */}
            <Seccion titulo={`${esCoach ? "$/h de tarifa contra $/h con incentivos" : "Fijo contra cobrado por persona"}, mes a mes`}
              sub={esCoach ? "La línea punteada es la tarifa de coach senior vigente ese mes." : "Promedio por persona y mes."}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(300px, 2fr)", gap: 18, alignItems: "start" }}>
                <BarrasAgrupadas fmtU={fmtU}
                  grupos={evol.map(e => ({ label: e.label, valores: { base: e.baseUnidad || 0, inc: e.finalUnidad || 0 }, ref: e.tarifaSenior || 0 }))}
                  series={[{ key: "base", label: esCoach ? "$/h de tarifa" : "Fijo por mes", color: COLOR_BASE }, { key: "inc", label: esCoach ? "$/h con incentivos" : "Cobrado por mes", color: COLOR_INC }]}
                  refLabel={esCoach ? "Tarifa senior vigente" : null} />
                <Tabla fontSize={12} cols={[["Mes"], ["Personas", "r"], ...(esCoach ? [["Horas / coach", "r"]] : []), [esCoach ? "$/h tarifa" : "Fijo", "r"], [esCoach ? "$/h c/ inc." : "Cobrado", "r"]]}>
                  {evol.map(e => (
                    <tr key={e.key}>
                      <td style={td}>{e.label}</td><td style={tdR}>{e.personas}</td>
                      {esCoach && <td style={tdR}>{e.personasMes ? fmtN(e.horasPorMes) : "—"}</td>}
                      <td style={tdR}>{fmtU(e.baseUnidad)}</td>
                      <td style={{ ...tdR, fontWeight: 700 }}>{fmtU(e.finalUnidad)} <span style={{ color: T.green, fontSize: 11 }}>{fmtPct(e.mejoraPct, true)}</span></td>
                    </tr>))}
                </Tabla>
              </div>
              <Lectura>{lec.evolucion}</Lectura>
            </Seccion>

            {/* Escalera por mes */}
            <Seccion titulo="La escalera, mes a mes" sub={`Cuánto suma cada escalón por mes, en ${unidadLabel}, y qué parte de lo pagado es. Se ve qué escalón crece o cae.`}>
              <TablaEscalera esc={escMes} />
            </Seccion>

            {/* Por puesto, mes a mes */}
            {evolPuesto.roles.length > 1 && (
              <Seccion titulo="Por puesto, mes a mes" sub={`${esCoach ? "$/h con incentivos" : "Cobrado por persona y mes"} de cada rol, y su mejora sobre la base.`}>
                <Tabla cols={[["Puesto"], ...meses.map(me => [me.label, "r"])]}>
                  {evolPuesto.roles.map(([rol, label]) => (
                    <tr key={rol}>
                      <td style={{ ...td, fontWeight: 600 }}>{label}</td>
                      {evolPuesto.porMes.map((pp, i) => {
                        const r = pp.filas.find(x => x.rol === rol);
                        return <td key={meses[i].key} style={tdR}>{r ? <>{fmtU(r.finalUnidad)} <span style={{ color: T.green, fontSize: 11 }}>{fmtPct(r.mejoraPct, true)}</span></> : <span style={{ color: T.dim }}>—</span>}</td>;
                      })}
                    </tr>
                  ))}
                </Tabla>
              </Seccion>
            )}
          </>)}

          {/* Objetivos grupales */}
          {objs.sedes.length > 0 && (
            <Seccion titulo="Objetivo grupal por sede" sub={`% del objetivo grupal que cobró cada sede${mensual ? "" : " cada mes"} y cuánto se pagó a ${mundo.label}. Sin color = no se cumplió.`}>
              <TablaObjetivos objs={objs} meses={meses} />
              <Lectura>{lec.objetivos}</Lectura>
            </Seccion>
          )}

          {/* Definiciones */}
          <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
            <b>Definiciones.</b>{" "}
            {esCoach
              ? <><b>Tarifa</b> = todas las horas trabajadas (regulares, domingos, feriados, yoga, running) a la tarifa del rol. <b>Asignados</b> = objetivos individuales cargados a mano en Liquidación Sedes. <b>Otros</b> = lo que domingos y feriados pagan por encima de la tarifa, one shot, comisión por resultado y ajustes. <b>$/h con incentivos</b> = lo liquidado / todas las horas, SIN clases especiales (running, custom, programaciones), reemplazos, feriados ni eventos cargados como novedad: pagan trabajo cuyas horas no están cargadas y entran solo al sueldo promedio. </>
              : <><b>Fijo</b> = sueldo fijo del mes. <b>Clases dadas</b> = horas de clase que dio el encargado o vendedor. <b>Asignados</b> = objetivos individuales cargados a mano. <b>Otros</b> = one shot, comisión por resultado, reemplazos, feriados y ajustes. <b>Cobrado</b> = todo lo liquidado (incluidas novedades) por persona y mes. </>}
            Las novedades se clasifican por la cuenta y el texto cargado (comisión por resultado, clases especiales, referidos, otras).{" "}
            Ajustes = redondeo del efectivo y diferencias entre conceptos y lo pagado en cierres editados a mano.{" "}
            Las horas salen de los check-ins de BIGG Eye e incluyen ausentes si no se quitaron al cerrar.{" "}
            Objetivo grupal = % configurado en Objetivos; sin fila o 0 = no cumplido.{" "}
            Solo meses cerrados; el mes en curso no se muestra. Con una sede elegida, una persona multi-sede muestra solo lo de esa sede.{" "}
            Quedan fuera Limpieza (100 % fijo), la gente de HQ que dio clases y Huergo.
            {k.avisos > 0 && <> ⚠ {k.avisos} persona(s) con sueldo fijo en más de una sede: se contó una vez.</>}
          </div>
        </div>
      )}
    </div>
  );
}
