import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { fetchLiquidacionesCerradas, fetchLegajos, fetchObjetivos, fetchCategorias, ambitoLiq } from "../lib/sueldosApi";
import {
  MESES_CORTO, GRUPOS_PUESTO, fmtPct, mesesConsecutivos, filtrarSedes, filtrarSedePuesto, sedesDisponibles, mesesCerrados,
  normalizarLiqs, rollupPersonaMes, porPuesto, porSede, porPersona, evolucionMensual, objetivosGrupales, lecturas,
} from "../lib/compensacionSedes";
import { fmtPesos } from "./sueldosUi";
import { copiarReporteComoImagen } from "../numbers/fotoReporte";

// Reporte "Compensación · Sedes": cómo cobra el staff de Sedes, para el management. Por puesto, por
// sede, por persona, $/h de tarifa vs $/h con todos los incentivos, evolución y objetivos grupales
// mes a mes. Solo meses CERRADOS, campos congelados de la liquidación. Cálculo en lib/compensacionSedes.js.

const T = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#1e293b", muted: "#64748b", dim: "#94a3b8",
  blue: "#2563eb", green: "#16a34a", red: "#dc2626", head: "#f1f5f9", dark: "#1e2022", fluo: "#ADFF19",
  font: "'Inter', system-ui, sans-serif",
};
const fmt   = (n) => fmtPesos(n, { guion: "vacio" });
const fmtH  = (n) => (n == null ? "—" : `${fmtPesos(n)}/h`);
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
const COLS_RATIO = [["$/h tarifa", "r"], ["$/h c/ incentivos", "r"], ["Promedio mensual", "r"], ["% incentivos", "r"]];
// Las cuatro celdas de ratios que comparten Por puesto, Por sede y Por persona.
function CeldasRatio({ r, mejora }) {
  return (<>
    <td style={tdR}>{fmtH(r.porHoraBase)}</td>
    <td style={{ ...tdR, fontWeight: 700 }}>{fmtH(r.porHoraIncentivos)}{mejora && r.mejoraPct != null && <span style={{ color: T.green, fontSize: 11, fontWeight: 600 }}> {fmtPct(r.mejoraPct, true)}</span>}</td>
    <td style={tdR}>{fmt(r.promedioMensual)}</td>
    <td style={tdR}>{fmtPct(r.pctIncentivos)}</td>
  </>);
}
// Barras agrupadas verticales: dos series por mes ($/h tarifa vs $/h con incentivos) + tick de referencia.
function BarrasAgrupadas({ grupos, series, W = 900, H = 300, refLabel }) {
  const [hover, setHover] = useState(null);
  const padL = 54, padR = 14, padT = 18, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxV = Math.max(1, ...grupos.flatMap(g => series.map(s => Number(g.valores[s.key]) || 0)), ...grupos.map(g => Number(g.ref) || 0));
  const niceMax = (() => { const p = Math.pow(10, Math.floor(Math.log10(maxV))); const f = maxV / p; const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10; return n * p; })();
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
                      onMouseEnter={() => setHover({ g, s, v })}><title>{`${s.label} · ${g.label}: ${fmtH(v)}`}</title></rect>
                    <text x={x + barW / 2} y={y(v) - 4} textAnchor="middle" fontSize="10" fontWeight="600" fill="#334155">{fmtN(v)}</text>
                  </g>
                );
              })}
              {g.ref > 0 && (
                <line x1={x0 - band * 0.4} y1={y(g.ref)} x2={x0 + band * 0.4} y2={y(g.ref)} stroke="#64748b" strokeWidth="1.5" strokeDasharray="4 3">
                  <title>{`${refLabel} · ${g.label}: ${fmtH(g.ref)}`}</title></line>
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
        {hover && <span style={{ marginLeft: "auto", fontSize: 12, color: T.text }}><b>{hover.s.label}</b> · {hover.g.label}: <b>{fmtH(hover.v)}</b></span>}
      </div>
    </div>
  );
}
// Selector de meses tildables: un botón que abre una lista de checkboxes (un mes = foto; varios = evolución).
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

// ── Pantalla ────────────────────────────────────────────────────────────────────────────────────
export default function PantallaCompensacionSedes({ pais = "AR" }) {
  const [anio,     setAnio]     = useState(hoy.getFullYear());
  const [mesesSel, setMesesSel] = useState(() => new Set());   // keys "AAAA-MM" tildadas
  const [sedeSel,  setSedeSel]  = useState("");                // "" = todas
  const [puesto,   setPuesto]   = useState("todos");
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
        // Default: el último mes cerrado solo (foto del mes). Varios meses tildados → evolución.
        setMesesSel(prev => {
          const vivos = new Set([...prev].filter(k => meses.some(m => m.key === k)));
          return vivos.size ? vivos : new Set(meses.length ? [meses[meses.length - 1].key] : []);
        });
      } catch (e) {
        if (!cancel) setFallo(e?.message || "No se pudieron cargar los datos.");
      } finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [anio, pais]);

  const meses = useMemo(() => mesesTodos.filter(m => mesesSel.has(m.key)), [mesesTodos, mesesSel]);
  const sedesLista = useMemo(() => sedesDisponibles(liqs), [liqs]);
  const filas = useMemo(() => normalizarLiqs(filtrarSedePuesto(liqs, { meses: mesesSel, sede_id: sedeSel, puesto })), [liqs, mesesSel, sedeSel, puesto]);
  const personasMes = useMemo(() => rollupPersonaMes(filas, legajos), [filas, legajos]);
  const k        = useMemo(() => porPuesto(personasMes), [personasMes]);          // por puesto + totales (KPIs)
  const sedes    = useMemo(() => porSede(filas), [filas]);
  const personas = useMemo(() => porPersona(personasMes), [personasMes]);
  const evol     = useMemo(() => evolucionMensual(personasMes, meses, tarifasPorMes), [personasMes, meses, tarifasPorMes]);
  const objs     = useMemo(() => objetivosGrupales(filas, objetivosPorMes, meses), [filas, objetivosPorMes, meses]);
  const lec      = useMemo(() => lecturas({ puesto: k, sedes, evolucion: evol, objetivos: objs, meses }), [k, sedes, evol, objs, meses]);
  const variosMeses = meses.length > 1;
  // "Sep 2026" · "Jul–Sep 2026" si son meses consecutivos · "Jul, Sep 2026" si no.
  const periodoLabel = useMemo(() => {
    if (!meses.length) return "";
    const nombres = meses.map(m => MESES_CORTO[m.mes - 1]);
    const seguidos = meses.every((m, i) => i === 0 || mesesConsecutivos(meses[i - 1], m));
    return `${variosMeses && seguidos ? `${nombres[0]}–${nombres[nombres.length - 1]}` : nombres.join(", ")} ${anio}`;
  }, [meses, variosMeses, anio]);
  const grupo = GRUPOS_PUESTO.find(g => g.key === puesto) || GRUPOS_PUESTO[0];
  const sedeLabel = sedeSel ? (sedesLista.find(s => s.sede_id === sedeSel)?.sede_nombre || sedeSel) : "Todas las sedes";
  const c = k.coaches, f = k.fijos;
  const hayCoaches = c.personas > 0, hayFijos = f.personas > 0;
  const toggleMes = toggleEn(setMesesSel), toggleSede = toggleEn(setSedesAbiertas);

  // Copiar como imagen: primero el helper compartido (SVG foreignObject → PNG → portapapeles); si el
  // navegador no lo permite, html2canvas (el de los recibos) y, si tampoco deja escribir el portapapeles,
  // se descarga el PNG. Así siempre queda una imagen para pegar en PowerPoint.
  const copiarFoto = async () => {
    const node = reportRef.current;
    if (!node) return;
    const nombre = `Compensacion_Sedes_${pais}_${periodoLabel.replace(/[^\wÀ-ÿ]+/g, "_")}.png`;
    try {
      await copiarReporteComoImagen(node, { caption: `Compensación · Sedes · ${pais} · ${periodoLabel} · ${sedeLabel}` });
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
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, flexGrow: 1 }}>Compensación · Sedes</h2>
        <Sel label="Año" value={anio} onChange={v => setAnio(Number(v))}>{ANIOS.map(a => <option key={a} value={a}>{a}</option>)}</Sel>
        <MesesPicker meses={mesesTodos} seleccion={mesesSel} onToggle={toggleMes} onTodos={() => setMesesSel(new Set(mesesTodos.map(m => m.key)))} label={periodoLabel} />
        <Sel label="Sede" value={sedeSel} onChange={setSedeSel} disabled={!sedesLista.length}>
          <option value="">Todas</option>{sedesLista.map(s => <option key={s.sede_id} value={s.sede_id}>{s.sede_nombre}</option>)}</Sel>
        <Sel label="Puesto" value={puesto} onChange={setPuesto}>{GRUPOS_PUESTO.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}</Sel>
        <button onClick={copiarFoto} style={btn(false)} disabled={loading || !meses.length}>📋 Copiar imagen</button>
        <button onClick={() => window.print()} style={btn(true)} disabled={loading || !meses.length}>🖨 Imprimir</button>
      </div>
      {fotoMsg && <div className="no-print" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>{fotoMsg}</div>}
      {fallo && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>⚠️ {fallo}</div>}

      {loading ? <p style={{ color: T.muted, fontSize: 13 }}>Cargando…</p> : !meses.length ? (
        <div style={vacio}>No hay liquidaciones de Sedes cerradas en {anio}.</div>
      ) : !personasMes.length ? (
        <div style={vacio}>Sin liquidaciones para {grupo.label.toLowerCase()} en {sedeLabel} · {periodoLabel}.</div>
      ) : (
        <div id="comp-sedes-report" ref={reportRef}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Cómo cobra el staff de Sedes · {pais} · {periodoLabel}</div>
            <div style={{ fontSize: 12, color: T.muted }}>
              {sedeLabel} · {grupo.label} · {k.personas} personas · {variosMeses ? `${meses.length} meses, acumulado` : "un mes"} · importes brutos, lo liquidado.
            </div>
          </div>

          {/* KPIs */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
            <Kpi label="Total pagado" value={fmtM(k.total)} sub={`${fmtPct(k.pctIncentivos)} son incentivos`} />
            {hayCoaches && <>
              <Kpi label="Coaches · $/h de tarifa" value={fmtH(c.porHoraBase)} sub={`${c.personas} coaches · ${fmtN(c.horasTotal)} h`} />
              <Kpi label="Coaches · $/h con incentivos" value={fmtH(c.porHoraIncentivos)} sub={`${fmtPct(c.mejoraPct, true)} sobre la tarifa`} destacado />
              <Kpi label="Coaches · horas por mes" value={`${fmtN(c.horasPorMes)} h`} sub={`promedio por coach · ${fmt(c.promedioMensual)} por mes`} />
            </>}
            {hayFijos && <Kpi label="Fijos · promedio mensual" value={fmt(f.promedioMensual)} sub={`${f.personas} personas · ${fmtPct(f.pctIncentivos)} incentivos`} />}
          </div>

          {/* Por puesto */}
          <Seccion titulo="Por puesto" sub="Qué cobra cada rol: horas por persona y mes, $/h de tarifa, $/h con todos los incentivos y cuánto de eso son incentivos.">
            <Tabla cols={[["Puesto"], ["Personas", "r"], ["Horas / persona·mes", "r"], ...COLS_RATIO]}>
              {k.filas.map(r => (
                <tr key={r.rol} style={{ background: r._sub ? T.bg : undefined, fontWeight: r._sub ? 700 : 400 }}>
                  <td style={td}>{r.label}</td><td style={tdR}>{r.personas}</td>
                  <td style={tdR}>{r.tipo === "coach" && r.horasTotal ? fmtN(r.horasPorMes) : "—"}</td>
                  <CeldasRatio r={r} mejora />
                </tr>
              ))}
            </Tabla>
            <Lectura>{lec.puesto}</Lectura>
          </Seccion>

          {/* Por sede (solo cuando se ven todas) */}
          {!sedeSel && sedes.length > 1 && (
            <Seccion titulo="Por sede" sub="Masa salarial de cada sede y cuánto de eso son incentivos. Click en una sede para ver sus puestos.">
              <Tabla cols={[["Sede"], ["Personas", "r"], ["Horas", "r"], [`Total ${variosMeses ? "período" : "mes"}`, "r"], ["$/h tarifa", "r"], ["$/h c/ incentivos", "r"], ["Promedio / persona·mes", "r"], ["% incentivos", "r"]]}>
                {sedes.map(s => {
                  const abierta = sedesAbiertas.has(s.sede_id);
                  return (
                    <Fragment key={s.sede_id}>
                      <tr onClick={() => toggleSede(s.sede_id)} style={{ cursor: "pointer", fontWeight: 600 }}>
                        <td style={td}><span style={{ color: T.dim, marginRight: 6 }}>{abierta ? "▾" : "▸"}</span>{s.sede_nombre}</td>
                        <td style={tdR}>{s.personas}</td><td style={tdR}>{fmtN(s.horasTotal)}</td><td style={tdR}>{fmt(s.total)}</td>
                        <CeldasRatio r={s} />
                      </tr>
                      {abierta && s.roles.map(r => (
                        <tr key={r.rol} style={{ background: T.bg, color: T.muted, fontSize: 12 }}>
                          <td style={{ ...td, paddingLeft: 30 }}>{r.label}</td><td style={tdR}>{r.personas}</td>
                          <td style={tdR}>{r.horasTotal ? fmtN(r.horasTotal) : "—"}</td><td style={tdR}>{fmt(r.total)}</td>
                          <CeldasRatio r={r} />
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
          <Seccion titulo="Por persona" sub={`Cuántas horas trabaja y cuánto gana cada uno${variosMeses ? ", promedio por mes del período" : ""}. Ordenado por puesto y promedio mensual.`}>
            <Tabla cols={[["Persona"], ["Puesto"], ...(variosMeses ? [["Meses", "r"]] : []), ["Horas / mes", "r"], ...COLS_RATIO]}>
              {personas.map(p => (
                <tr key={p.legajo_id}>
                  <td style={{ ...td, fontWeight: 600 }}>{p.nombre}</td><td style={{ ...td, color: T.muted }}>{p.label}</td>
                  {variosMeses && <td style={tdR}>{p.meses}</td>}
                  <td style={tdR}>{p.horasTotal ? fmtN(p.horasPorMes) : "—"}</td>
                  <CeldasRatio r={p} />
                </tr>
              ))}
            </Tabla>
          </Seccion>

          {/* Evolución mensual (varios meses) */}
          {variosMeses && hayCoaches && (
            <Seccion titulo="Evolución mensual · coaches" sub="$/h de tarifa contra $/h con todos los incentivos, mes a mes. La línea punteada es la tarifa de coach senior vigente ese mes.">
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(300px, 2fr)", gap: 18, alignItems: "start" }}>
                <BarrasAgrupadas
                  grupos={evol.map(e => ({ label: e.label, valores: { base: e.coaches.porHoraBase || 0, inc: e.coaches.porHoraIncentivos || 0 }, ref: e.tarifaSenior || 0 }))}
                  series={[{ key: "base", label: "$/h de tarifa", color: COLOR_BASE }, { key: "inc", label: "$/h con incentivos", color: COLOR_INC }]}
                  refLabel="Tarifa senior vigente" />
                <Tabla fontSize={12} cols={[["Mes"], ["Coaches", "r"], ["Horas / coach", "r"], ["$/h tarifa", "r"], ["$/h c/ inc.", "r"], ...(hayFijos ? [["Fijos prom.", "r"]] : [])]}>
                  {evol.map(e => (
                    <tr key={e.key}>
                      <td style={td}>{e.label}</td><td style={tdR}>{e.coaches.personas}</td>
                      <td style={tdR}>{e.coaches.personasMes ? fmtN(e.coaches.horasPorMes) : "—"}</td>
                      <td style={tdR}>{fmtH(e.coaches.porHoraBase)}</td>
                      <td style={{ ...tdR, fontWeight: 700 }}>{fmtH(e.coaches.porHoraIncentivos)} <span style={{ color: T.green, fontSize: 11 }}>{fmtPct(e.coaches.mejoraPct, true)}</span></td>
                      {hayFijos && <td style={tdR}>{fmt(e.fijos.promedioMensual)}</td>}
                    </tr>))}
                </Tabla>
              </div>
              <Lectura>{lec.evolucion}</Lectura>
            </Seccion>
          )}

          {/* Objetivos grupales */}
          {grupo.grupal && objs.sedes.length > 0 && (
            <Seccion titulo="Objetivo grupal por sede" sub="% del objetivo grupal que cobró cada sede cada mes y cuánto se pagó. Sin color = no se cumplió.">
              <Tabla cols={[["Sede"], ...meses.map(me => [me.label, "c"]), ...(variosMeses ? [["Cumplidos", "r"]] : [])]}>
                {objs.sedes.map(s => (
                  <tr key={s.sede_id}>
                    <td style={{ ...td, fontWeight: 600 }}>{s.sede_nombre}</td>
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
                    {variosMeses && <td style={tdR}>{s.cumplidos}/{meses.length}</td>}
                  </tr>
                ))}
                <tr style={{ background: T.bg, fontWeight: 700 }}>
                  <td style={td}>Total pagado</td>
                  {meses.map(me => <td key={me.key} style={{ ...td, textAlign: "center" }}>{fmt(objs.totalMes[me.key] || 0)}</td>)}
                  {variosMeses && <td style={tdR}>{fmt(objs.total)}</td>}
                </tr>
              </Tabla>
              <Lectura>{lec.objetivos}</Lectura>
            </Seccion>
          )}

          {/* Definiciones */}
          <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
            <b>Definiciones.</b> <b>$/h de tarifa</b> = monto de horas regulares / horas regulares (la tarifa pura del rol).{" "}
            <b>$/h con incentivos</b> = todo lo liquidado (incluidas novedades) / todas las horas (regulares + feriados + domingos + yoga + running).{" "}
            <b>Incentivos</b> = feriados, domingos, yoga y running, CDP, one shot, objetivos individuales, objetivo grupal y novedades.{" "}
            Los fijos (encargados, ventas, limpieza) no tienen horas: se muestran como sueldo fijo más incentivos y promedio mensual.{" "}
            Las horas salen de los check-ins de BIGG Eye e incluyen ausentes si no se quitaron al cerrar.{" "}
            Objetivo grupal = % configurado en Objetivos; sin fila o 0 = no cumplido.{" "}
            Solo meses cerrados; el mes en curso no se muestra. Con una sede elegida, una persona multi-sede muestra solo lo de esa sede.{" "}
            Quedan fuera la gente de HQ que dio clases y Huergo.
            {k.avisos > 0 && <> ⚠ {k.avisos} persona(s) con sueldo fijo en más de una sede: se contó una vez.</>}
          </div>
        </div>
      )}
    </div>
  );
}
