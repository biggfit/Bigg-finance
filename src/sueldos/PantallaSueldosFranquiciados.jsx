import { useState, useEffect, useMemo, useRef } from "react";
import { fetchLiquidacionesCerradas, fetchLegajos, fetchCategorias, ambitoLiq } from "../lib/sueldosApi";
import {
  filtrarSedes, filtrarSedeMundo, mesesCerrados, normalizarLiqs, rollupPersonaMes, rolLabel, tarifaDe,
} from "../lib/compensacionSedes";
import { RowMenu } from "../numbers/comprobantesUi";
import { T, fmt, td, tdR, vacio, btn, copiarImagenReporte } from "./compensacionEstilos";
import { Seccion, Sel, Tabla } from "./compensacionUi";

// Informe "Sueldos Sedes · Franquiciados": los valores que pagamos al staff de Sedes en un mes cerrado,
// para compartir con los franquiciados. Solo la tabla de valores vigentes (Categorías, sueldo fijo de
// Front Desk y objetivo grupal): la escalera y los promedios de Compensación · Sedes son internos y
// confundían (decisión del 03/11/2026). Nada identifica a una persona ni a una sede. El objetivo grupal
// va sin porcentajes ni reglas: los fija Ventas y Operaciones cada mes y no se explican afuera.

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const hoy = new Date();
const MES_ACTUAL = { mes: hoy.getMonth() + 1, anio: hoy.getFullYear() };
const ANIOS = [hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1].filter(a => a >= 2026);

// Valores de Categorías que se muestran, en este orden. Lista cerrada a propósito: un concepto nuevo de
// Categorías no se publica a los franquiciados hasta sumarlo acá (Huergo y Limpieza quedan fuera).
// `texto`: fila sin valor en Categorías, se muestra ese texto en lugar del monto.
const VALORES = [
  { concepto: "COACH SENIOR",        label: "Hora Coach senior",     como: "por hora de clase" },
  { concepto: "BIGG COACH",          label: "Hora BIGG coach",       como: "por hora de clase" },
  { concepto: null,                  label: "Hora en feriado",       texto: "Doble", como: "el doble de la hora de su puesto" },
  { concepto: "YOGA",                label: "Hora de yoga",          como: "por hora de yoga" },
  { concepto: "DOMINGO",             label: "Hora de domingo",       como: "por hora de clase en domingo" },
  { concepto: "RUNNING A",           label: "Hora de running A",     como: "por hora de running, categoría A" },
  { concepto: "RUNNING B",           label: "Hora de running B",     como: "por hora de running, categoría B" },
  { concepto: "CDP COACHES",         label: "CDP coaches",           como: "por clase de prueba convertida en socio" },
  { concepto: "CDP FRONT DESK",      label: "CDP Front Desk",        como: "por clase de prueba convertida en socio" },
  { concepto: "ONE SHOT",            label: "One shot",              como: "por one shot vendido" },
  { concepto: "COMISIÓN X REFERIDO", label: "Comisión por referido", como: "por socio referido" },
];

// Roles de sueldo fijo que se informan. El fijo es el mismo para todos los del puesto: se muestra el más
// repetido del mes (no el promedio, que baja por altas, bajas o meses parciales).
const ROLES_FIJO = ["ENCARGADO", "VENTAS"];
function fijoDelPuesto(personasMes, rol) {
  const cuenta = new Map();
  for (const p of personasMes) if (p.rol === rol && p.m.fijo > 0) { const v = Math.round(p.m.fijo); cuenta.set(v, (cuenta.get(v) || 0) + 1); }
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || null;
}

export default function PantallaSueldosFranquiciados({ pais = "AR" }) {
  const [anio,     setAnio]     = useState(hoy.getFullYear());
  const [mesSel,   setMesSel]   = useState("");            // key "AAAA-MM"
  const [liqs,     setLiqs]     = useState([]);
  const [meses,    setMeses]    = useState([]);            // meses cerrados del año
  const [legajos,  setLegajos]  = useState([]);
  const [tarifas,  setTarifas]  = useState([]);            // Categorías del mes elegido
  const [valoresMes, setValoresMes] = useState("");        // key del mes cuyas tarifas ya llegaron
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
    if (!mes) { setTarifas([]); setValoresMes(""); return; }
    let cancel = false;
    fetchCategorias(mes.mes, mes.anio, pais).catch(() => [])
      .then(cats => { if (!cancel) { setTarifas(cats); setValoresMes(mes.key); } });
    return () => { cancel = true; };
  }, [mes?.key, pais]);   // eslint-disable-line react-hooks/exhaustive-deps

  const mesesActivos = useMemo(() => new Set(mesSel ? [mesSel] : []), [mesSel]);
  const filas = useMemo(() => ["coach", "fijo"].flatMap(tipo => normalizarLiqs(filtrarSedeMundo(liqs, { meses: mesesActivos, tipo }))), [liqs, mesesActivos]);
  const valores = useMemo(() => VALORES.map(v => ({ ...v, monto: v.texto ? null : tarifaDe(tarifas, v.concepto) })).filter(v => v.texto || v.monto), [tarifas]);
  const fijos = useMemo(() => {
    const personasMes = rollupPersonaMes(filas, legajos);
    return ROLES_FIJO.map(rol => ({ rol, label: rolLabel(rol), monto: fijoDelPuesto(personasMes, rol) })).filter(f => f.monto);
  }, [filas, legajos]);
  // Las filas del informe, ya como texto: las usan la tabla de la pantalla y el PDF.
  const informe = useMemo(() => [
    ...valores.map(v => ({ concepto: v.label, valor: v.texto ?? fmt(v.monto), como: v.como })),
    ...fijos.map(f => ({ concepto: `Sueldo fijo ${f.label.toLowerCase()}`, valor: fmt(f.monto), como: "por mes" })),
    { concepto: "Objetivo grupal", valor: "Variable", como: "% según el cumplimiento de la sede" },
  ], [valores, fijos]);

  const periodoLabel = mes ? `${MESES[mes.mes - 1]} ${mes.anio}` : "";
  const hayDatos = filas.length > 0;
  // Hasta que lleguen las tarifas del mes no se muestra la tabla: una imagen copiada antes saldría incompleta.
  const cargando = loading || (!!mes && valoresMes !== mes.key);
  const sinDatos = cargando || !hayDatos;

  const copiarFoto = async () => {
    if (!reportRef.current) return;
    setFotoMsg(await copiarImagenReporte(reportRef.current, {
      nombre: "Valores_Sedes.png", caption: `Sueldos Sedes · ${pais} · ${periodoLabel}`,
    }));
    setTimeout(() => setFotoMsg(null), 4500);
  };
  const descargarPdf = async () => {
    try {
      const { descargarValoresPdf } = await import("./valoresFranquiciadosPdf");
      await descargarValoresPdf({
        nombre: `Valores_Sedes_${pais}_${periodoLabel.replace(/ /g, "_")}.pdf`,
        titulo: `Sueldos Sedes · ${periodoLabel}`,
        subtitulo: `Valores de referencia · todas las sedes · ${pais} · importes brutos.`,
        filas: informe,
      });
    } catch { setFotoMsg("No se pudo generar el PDF."); setTimeout(() => setFotoMsg(null), 4500); }
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
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, flexGrow: 1 }}>Valores de referencia para franquiciados</h2>
        <button onClick={descargarPdf} disabled={sinDatos} style={{ ...btn(true), opacity: sinDatos ? 0.5 : 1 }}>⬇ Descargar PDF</button>
        <RowMenu align="right" label="⋯" items={[
          { label: "📋 Copiar imagen", onClick: copiarFoto, disabled: sinDatos, hint: "Copia el informe como PNG para pegar o mandar" },
          { label: "🖨 Imprimir", onClick: () => window.print(), disabled: sinDatos, hint: "A4 vertical" },
        ]} />
      </div>
      <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <Sel label="Año" value={anio} onChange={v => setAnio(Number(v))}>{ANIOS.map(a => <option key={a} value={a}>{a}</option>)}</Sel>
        <Sel label="Mes" value={mesSel} onChange={setMesSel} disabled={!meses.length}>{meses.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</Sel>
      </div>
      <div className="no-print" style={{ fontSize: 12, color: T.muted, marginBottom: 16 }}>
        Para compartir: los valores que se pagan en todas las sedes, sin nombres de personas ni montos por sede.
      </div>
      {fotoMsg && <div className="no-print" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>{fotoMsg}</div>}
      {fallo && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>⚠️ {fallo}</div>}

      {cargando ? <p style={{ color: T.muted, fontSize: 13 }}>Cargando…</p> : !meses.length ? (
        <div style={vacio}>No hay liquidaciones de Sedes cerradas en {anio}.</div>
      ) : !hayDatos ? (
        <div style={vacio}>Sin liquidaciones de Sedes en {periodoLabel}.</div>
      ) : (
        <div id="sueldos-franq-report" ref={reportRef}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Sueldos Sedes · {periodoLabel}</div>
            <div style={{ fontSize: 12, color: T.muted }}>Todas las sedes · {pais} · importes brutos.</div>
          </div>

          <Seccion titulo="Valores vigentes" sub={`Lo que se paga por cada concepto en ${periodoLabel}.`}>
            <Tabla cols={[["Concepto"], ["Valor", "r"], ["Cómo se paga"]]}>
              {informe.map(f => (
                <tr key={f.concepto}><td style={{ ...td, fontWeight: 600 }}>{f.concepto}</td><td style={tdR}>{f.valor}</td><td style={{ ...td, color: T.muted, whiteSpace: "normal" }}>{f.como}</td></tr>
              ))}
            </Tabla>
          </Seccion>

        </div>
      )}
    </div>
  );
}
