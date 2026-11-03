import { useState, useEffect, useMemo, useRef } from "react";
import { fetchLiquidacionesCerradas, fetchLegajos, fetchObjetivos, fetchCategorias, ambitoLiq } from "../lib/sueldosApi";
import {
  MUNDOS, fmtPct, filtrarSedes, filtrarSedeMundo, mesesCerrados, normalizarLiqs, rollupPersonaMes, porPuesto,
  escalera, objetivosGrupales, lecturas, tarifaDe,
} from "../lib/compensacionSedes";
import { fmtPesos } from "./sueldosUi";
import { RowMenu } from "../numbers/comprobantesUi";
import { T, fmt, fmtN, td, tdR, vacio, colsRatio, copiarImagenReporte } from "./compensacionEstilos";
import { Seccion, Lectura, Kpi, Sel, Tabla, CeldasRatio, Cascada, TablaEscalera } from "./compensacionUi";

// Reporte "Sueldos Sedes · Franquiciados": lo que pagamos al staff de Sedes y cómo se compone, para
// compartir con los franquiciados. Mismo cálculo que Compensación · Sedes (lib/compensacionSedes.js),
// pero SIN nada que identifique a una persona o a una sede: no hay Por persona, Por sede ni objetivo
// grupal sede por sede, ni selector de sede. Todas las sedes juntas, un mes cerrado, los dos mundos en
// una sola imagen. Arriba, los valores de Categorías del mes (tarifas por hora, CDP, one shot…).

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const hoy = new Date();
const MES_ACTUAL = { mes: hoy.getMonth() + 1, anio: hoy.getFullYear() };
const ANIOS = [hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1].filter(a => a >= 2026);

// Valores de Categorías que se muestran, en este orden. Lista cerrada a propósito: un concepto nuevo de
// Categorías no se publica a los franquiciados hasta sumarlo acá (Huergo y Limpieza quedan fuera).
const VALORES = [
  { concepto: "COACH SENIOR",        label: "Hora Coach senior",     como: "por hora de clase (también feriados)" },
  { concepto: "BIGG COACH",          label: "Hora BIGG coach",       como: "por hora de clase (también feriados)" },
  { concepto: "YOGA",                label: "Hora de yoga",          como: "por hora de yoga" },
  { concepto: "DOMINGO",             label: "Hora de domingo",       como: "por hora de clase en domingo" },
  { concepto: "RUNNING A",           label: "Hora de running A",     como: "por hora de running, categoría A" },
  { concepto: "RUNNING B",           label: "Hora de running B",     como: "por hora de running, categoría B" },
  { concepto: "CDP COACHES",         label: "CDP coaches",           como: "por clase de prueba convertida en socio" },
  { concepto: "CDP FRONT DESK",      label: "CDP Front Desk",        como: "por clase de prueba convertida en socio" },
  { concepto: "ONE SHOT",            label: "One shot",              como: "por one shot vendido" },
  { concepto: "COMISIÓN X REFERIDO", label: "Comisión por referido", como: "por socio referido" },
];

// Escalera + por puesto de un mundo (coaches o Front Desk) sobre las liquidaciones del mes.
function calcMundo(liqs, mesesActivos, legajos, mundo) {
  const filas = normalizarLiqs(filtrarSedeMundo(liqs, { meses: mesesActivos, tipo: mundo.tipo }));
  const k = porPuesto(rollupPersonaMes(filas, legajos), mundo);
  const esc = escalera(k.filas.length > 1 ? k.filas : [k.total], mundo.tipo);
  const lec = lecturas({ mundo, puesto: k, esc, sedes: [], evolucion: [], objetivos: { sedes: [] }, meses: [] });
  return { mundo, filas, k, esc, lec };
}

function BloqueMundo({ d }) {
  const { mundo, k, esc, lec } = d;
  const esCoach = mundo.tipo === "coach", t = k.total;
  const fmtU = (n) => (n == null ? "—" : esCoach ? `${fmtPesos(n)}/h` : fmtPesos(n));
  const unidadLabel = esCoach ? "$/h" : "$ por persona y mes";
  const colTotal = esc.columnas[esc.columnas.length - 1];
  if (!t.personas) return null;
  return (
    <Seccion titulo={mundo.label}
      sub={esCoach ? `${t.personas} coaches · cobran por hora. La escalera va de la tarifa al $/h con todos los incentivos.`
                   : `${t.personas} personas (encargados y ventas) · sueldo fijo más incentivos, por persona y mes.`}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <Kpi label={esCoach ? "$/h de tarifa" : "Sueldo fijo por mes"} value={fmtU(t.baseUnidad)} sub="promedio" />
        <Kpi label={esCoach ? "$/h con incentivos" : "Sueldo promedio por mes"} value={fmtU(t.finalUnidad)}
          sub={`${fmtPct(t.mejoraPct, true)} sobre ${esCoach ? "la tarifa" : `el fijo · ${fmtPct(t.pctIncentivos)} son incentivos`}`} destacado />
        {esCoach && <>
          <Kpi label="Horas por mes" value={`${fmtN(t.horasPorMes)} h`} sub="promedio por coach" />
          <Kpi label="Sueldo promedio" value={fmt(t.promedioMensual)} sub={`por coach y mes · ${fmtPct(t.pctIncentivos)} son incentivos`} />
        </>}
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, margin: "6px 0 4px" }}>Cómo se compone, escalón por escalón ({unidadLabel})</div>
      {colTotal && <Cascada pasos={colTotal.pasos.map(p => ({ ...p, ...esc.pasos.find(e => e.key === p.key) })).filter(p => !p.fueraRatio)} />}
      <div style={{ marginTop: 14 }}><TablaEscalera esc={esc} acumulado fmtU={fmtU} esCoach={esCoach} /></div>
      <Lectura>{lec.escalera}</Lectura>

      <div style={{ fontSize: 13, fontWeight: 700, margin: "18px 0 4px" }}>Por puesto</div>
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
  );
}

export default function PantallaSueldosFranquiciados({ pais = "AR" }) {
  const [anio,     setAnio]     = useState(hoy.getFullYear());
  const [mesSel,   setMesSel]   = useState("");            // key "AAAA-MM"
  const [liqs,     setLiqs]     = useState([]);
  const [meses,    setMeses]    = useState([]);            // meses cerrados del año
  const [legajos,  setLegajos]  = useState([]);
  const [tarifas,  setTarifas]  = useState([]);            // Categorías del mes elegido
  const [objetivos, setObjetivos] = useState([]);          // Objetivos del mes elegido
  const [loading,  setLoading]  = useState(true);
  const [fallo,    setFallo]    = useState("");
  const [fotoMsg,  setFotoMsg]  = useState(null);
  const reportRef = useRef(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true); setFallo("");
      try {
        const [ls, legs] = await Promise.all([fetchLiquidacionesCerradas(anio), fetchLegajos()]);
        if (cancel) return;
        const sedesLiqs = filtrarSedes(ls, { pais, anio, ambitoDe: ambitoLiq });
        const ms = mesesCerrados(sedesLiqs, { excluirMesActual: MES_ACTUAL });
        setLiqs(sedesLiqs); setLegajos(legs); setMeses(ms);
        setMesSel(prev => (ms.some(m => m.key === prev) ? prev : ms[ms.length - 1]?.key || ""));
      } catch (e) {
        if (!cancel) setFallo(e?.message || "No se pudieron cargar los datos.");
      } finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [anio, pais]);

  const mes = meses.find(m => m.key === mesSel) || null;
  useEffect(() => {
    if (!mes) { setTarifas([]); setObjetivos([]); return; }
    let cancel = false;
    Promise.all([fetchCategorias(mes.mes, mes.anio, pais).catch(() => []), fetchObjetivos(mes.mes, mes.anio, pais).catch(() => [])])
      .then(([cats, objs]) => { if (!cancel) { setTarifas(cats); setObjetivos(objs); } });
    return () => { cancel = true; };
  }, [mes?.key, pais]);   // eslint-disable-line react-hooks/exhaustive-deps

  const mesesActivos = useMemo(() => new Set(mesSel ? [mesSel] : []), [mesSel]);
  const mundos = useMemo(() => MUNDOS.map(m => calcMundo(liqs, mesesActivos, legajos, m)), [liqs, mesesActivos, legajos]);
  // Objetivo grupal: solo cuántas sedes lo cobraron y con qué porcentajes, sin decir cuáles.
  const grupal = useMemo(() => {
    if (!mes) return null;
    const objs = objetivosGrupales(mundos.flatMap(d => d.filas), { [mes.key]: objetivos }, [mes]);
    const celdas = objs.sedes.map(s => objs.celdas[`${s.sede_id}|${mes.key}`]).filter(c => c?.cumplido);
    const pcts = [...new Set(celdas.map(c => c.pct).filter(p => p > 0))].sort((a, b) => a - b);
    return { sedes: objs.sedes.length, cumplidas: celdas.length, pcts };
  }, [mundos, objetivos, mes]);
  const valores = useMemo(() => VALORES.map(v => ({ ...v, monto: tarifaDe(tarifas, v.concepto) })).filter(v => v.monto), [tarifas]);
  const fijos = useMemo(() => mundos.find(d => d.mundo.tipo === "fijo")?.k.filas.filter(r => !r._sub) || [], [mundos]);

  const periodoLabel = mes ? `${MESES[mes.mes - 1]} ${mes.anio}` : "";
  const hayDatos = mundos.some(d => d.k.total.personas);
  const sinDatos = loading || !hayDatos;

  const copiarFoto = async () => {
    if (!reportRef.current) return;
    setFotoMsg(await copiarImagenReporte(reportRef.current, {
      nombre: `Sueldos_Sedes_${pais}_${periodoLabel.replace(/\s+/g, "_")}.png`,
      caption: `Sueldos Sedes · ${pais} · ${periodoLabel}`,
    }));
    setTimeout(() => setFotoMsg(null), 4500);
  };

  return (
    <div className="fade" style={{ padding: "24px 28px", maxWidth: 1180, fontFamily: T.font, color: T.text, "--border": T.border }}>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          body * { visibility: hidden; }
          #sueldos-franq-report, #sueldos-franq-report * { visibility: visible; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          #sueldos-franq-report { position: absolute; left: 0; top: 0; width: 100%; zoom: .72; }
          .no-print { display: none !important; }
          .cs-seccion { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, flexGrow: 1 }}>Sueldos Sedes · Franquiciados</h2>
        <RowMenu align="right" label="⋯" items={[
          { label: "📋 Copiar imagen", onClick: copiarFoto, disabled: sinDatos, hint: "Copia el informe como PNG para pegar o mandar" },
          { label: "🖨 Imprimir / PDF", onClick: () => window.print(), disabled: sinDatos, hint: "A4 vertical" },
        ]} />
      </div>
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <Sel label="Año" value={anio} onChange={v => setAnio(Number(v))}>{ANIOS.map(a => <option key={a} value={a}>{a}</option>)}</Sel>
        <Sel label="Mes" value={mesSel} onChange={setMesSel} disabled={!meses.length}>{meses.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</Sel>
      </div>
      <div className="no-print" style={{ fontSize: 12, color: T.muted, marginBottom: 16 }}>
        Para compartir: todas las sedes juntas, sin nombres de personas ni montos por sede. Un puesto con una sola persona muestra, de hecho, lo que cobra esa persona.
      </div>
      {fotoMsg && <div className="no-print" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>{fotoMsg}</div>}
      {fallo && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>⚠️ {fallo}</div>}

      {loading ? <p style={{ color: T.muted, fontSize: 13 }}>Cargando…</p> : !meses.length ? (
        <div style={vacio}>No hay liquidaciones de Sedes cerradas en {anio}.</div>
      ) : !hayDatos ? (
        <div style={vacio}>Sin liquidaciones de Sedes en {periodoLabel}.</div>
      ) : (
        <div id="sueldos-franq-report" ref={reportRef}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Sueldos Sedes · {periodoLabel}</div>
            <div style={{ fontSize: 12, color: T.muted }}>Todas las sedes · {pais} · importes brutos liquidados · promedios por puesto.</div>
          </div>

          <Seccion titulo="Valores vigentes" sub={`Lo que se paga por cada concepto en ${periodoLabel}.`}>
            <Tabla cols={[["Concepto"], ["Valor", "r"], ["Cómo se paga"]]}>
              {valores.map(v => (
                <tr key={v.concepto}><td style={{ ...td, fontWeight: 600 }}>{v.label}</td><td style={tdR}>{fmt(v.monto)}</td><td style={{ ...td, color: T.muted, whiteSpace: "normal" }}>{v.como}</td></tr>
              ))}
              {fijos.map(r => (
                <tr key={r.rol}><td style={{ ...td, fontWeight: 600 }}>Sueldo fijo {r.label.toLowerCase()}</td><td style={tdR}>{fmt(r.baseUnidad)}</td>
                  <td style={{ ...td, color: T.muted, whiteSpace: "normal" }}>por mes, promedio ({r.personas} {r.personas === 1 ? "persona" : "personas"})</td></tr>
              ))}
              <tr>
                <td style={{ ...td, fontWeight: 600 }}>Objetivo grupal</td>
                <td style={tdR}>{grupal?.pcts.length ? grupal.pcts.map(p => `${p} %`).join(" · ") : "—"}</td>
                <td style={{ ...td, color: T.muted, whiteSpace: "normal" }}>
                  % según el cumplimiento de la sede. Coaches: sobre horas, feriados, domingos y asignados. Front Desk: sobre el sueldo fijo. Yoga no lo cobra.
                  {grupal?.sedes ? ` Este mes lo cobraron ${grupal.cumplidas} de ${grupal.sedes} sedes.` : ""}
                </td>
              </tr>
            </Tabla>
          </Seccion>

          {mundos.map(d => <BloqueMundo key={d.mundo.key} d={d} />)}

          <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
            <b>Definiciones.</b>{" "}
            <b>Tarifa</b> = todas las horas trabajadas (regulares, domingos, feriados, yoga, running) a la tarifa del puesto.{" "}
            <b>CDP</b> = clases de prueba convertidas en socios. <b>Asignados</b> = objetivos individuales.{" "}
            <b>Otros</b> = lo que domingos y feriados pagan por encima de la tarifa, one shot, comisión por resultado, redondeo y ajustes.{" "}
            <b>$/h con incentivos</b> = lo liquidado dividido todas las horas, sin clases especiales (running, custom, programaciones), reemplazos, feriados ni eventos cargados aparte: pagan trabajo cuyas horas no están cargadas y entran solo al sueldo promedio.{" "}
            <b>Cobrado</b> (Front Desk) = todo lo liquidado por persona y mes. Importes brutos de liquidaciones cerradas. No incluye Limpieza.
          </div>
        </div>
      )}
    </div>
  );
}
