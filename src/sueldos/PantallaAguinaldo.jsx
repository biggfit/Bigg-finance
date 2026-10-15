import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from "react";
import * as XLSX from "xlsx";
import {
  fetchLegajos, fetchCuentasContablesNumbers, fetchLiquidacionesCerradas, fetchNovedades,
  appendNovedadesBatch, updateNovedad, deleteNovedad,
  ambitoLiq, devengadoPorFormaYSociedad,
  FP_TIPOS, FP_TIPO_LABEL, fmtMiles, limpiarMonto,
} from "../lib/sueldosApi";
import {
  SEMESTRES, MESES_CORTO, CUENTA_AGUINALDO, CUENTAS_BASE_FIJAS,
  calcularAguinaldo, filasNovedadAguinaldo, esNovedadAguinaldo, esCuentaAguinaldo, ambitoNovedad,
  semestreDeMes, normTxt, descripcionAguinaldo,
} from "../lib/aguinaldo";
import { fmtPesos } from "./sueldosUi";
import { tmpRowId } from "../lib/tmpRowId";
import { useConfirm } from "../numbers/useConfirm";

// Pantalla propia (pedido de Martín, 14/10): el aguinaldo NO se mezcla con las novedades del mes.
// Por abajo SON novedades (su_novedades, mes de pago, cuenta "Aguinaldos") y los cierres de HQ /
// Sedes las absorben como cualquier otra. Las pantallas de Novedades las excluyen.

const T = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#1e293b", muted: "#64748b",
  dim: "#94a3b8", blue: "#2563eb", red: "#dc2626", green: "#16a34a", amber: "#b45309",
  head: "#f1f5f9", font: "'Inter', system-ui, sans-serif",
};
const iStyle = {
  border: `1px solid ${T.border}`, borderRadius: 5, padding: "5px 8px", fontSize: 13,
  fontFamily: T.font, background: "#eceff3", color: T.text, width: "100%", boxSizing: "border-box",
};
const btnStyle = (color = T.blue) => ({
  background: color, color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px",
  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font,
});
const ghostBtn = { ...btnStyle("#64748b"), background: "transparent", color: T.muted, border: `1px solid ${T.border}` };
const th = { padding: "7px 10px", textAlign: "left", fontWeight: 600, color: T.muted, fontSize: 11,
  letterSpacing: ".04em", borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" };
const td = { padding: "6px 10px", fontSize: 13, whiteSpace: "nowrap" };
const der = { ...td, textAlign: "right" };
const fmt = (n) => fmtPesos(n);
const AMBITO_LABEL = { hq: "HQ", sedes: "Sedes" };
const AVISO_STYLE = {
  error: { background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b" },
  info:  { background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534" },
};
const FORMA_OPTIONS = FP_TIPOS.map(t => <option key={t} value={t}>{FP_TIPO_LABEL[t]}</option>);

function Toggle({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 2, background: T.head, borderRadius: 7, padding: 3 }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} style={{
          background: value === v ? T.card : "transparent", border: "none", borderRadius: 5, padding: "5px 14px",
          cursor: "pointer", fontSize: 12, fontWeight: value === v ? 700 : 500, color: value === v ? T.blue : T.muted,
          fontFamily: T.font, boxShadow: value === v ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
        }}>{label}</button>
      ))}
    </div>
  );
}

const hoy = new Date();

// `_ambito` fija a qué grilla pertenece la fila (una fila nueva de Sedes todavía sin sede elegida
// tiene que seguir viéndose en Sedes). Persistido: HQ = sin sede, Sedes = con sede.
function newRow(o = {}) {
  return { _id: tmpRowId(), id: null, _ambito: "hq", legajo_id: "", legajo_nombre: "", sede_id: "", sede_nombre: "",
    monto: "", forma_pago: "efectivo", nota: "", ...o };
}
function novToRow(n) {
  return { _id: n.id, id: n.id, _ambito: ambitoNovedad(n), legajo_id: n.legajo_id, legajo_nombre: n.legajo_nombre, sede_id: n.sede_id ?? "",
    sede_nombre: n.sede_nombre ?? "", monto: String(n.monto || ""), forma_pago: n.forma_pago || "efectivo", nota: n.descripcion || "" };
}
const rowSig = (r) => [r.legajo_id, r.sede_id, r.monto, r.forma_pago, r.nota].join("|");

export default function PantallaAguinaldo({ pais = "" }) {
  const [anio,     setAnio]     = useState(hoy.getFullYear());
  const [semestre, setSemestre] = useState(semestreDeMes(hoy.getMonth() + 1));
  const [ambito,   setAmbito]   = useState("hq");

  const [legajos,  setLegajos]  = useState([]);
  const [cuentas,  setCuentas]  = useState([]);
  const [liqs,     setLiqs]     = useState([]);
  const [rows,     setRows]     = useState([]);      // grilla: novedades Aguinaldos del mes de pago (ambos ámbitos)
  const [loaded,   setLoaded]   = useState([]);      // snapshot persistido (solo Aguinaldos) para el diff
  const [haberesEdit, setHaberesEdit] = useState({}); // override manual de la columna Haberes, por legajo|ambito
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [formaMasa, setFormaMasa] = useState("efectivo");
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [dirty,    setDirty]    = useState(false);
  const [fallo,    setFallo]    = useState("");
  const [aviso,    setAviso]    = useState(null);     // { tipo: "error" | "info", texto } — en pantalla, no alert()
  const [confirm, confirmUI]    = useConfirm();        // modal in-app (el navegador embebido bloquea window.confirm)
  const savingRef = useRef(false);

  const S = SEMESTRES[semestre];
  const mesPago = S.mesPago;
  const ambitoLabel = AMBITO_LABEL[ambito];

  const load = useCallback(async (a, sem, p) => {
    setLoading(true); setFallo("");
    try {
      const mp = SEMESTRES[sem].mesPago;
      const [legs, ctas, ls, novs] = await Promise.all([
        fetchLegajos(), fetchCuentasContablesNumbers(), fetchLiquidacionesCerradas(a), fetchNovedades(mp, a),
      ]);
      const legsPais = legs.filter(l => !p || !l.pais || l.pais === p);
      const idsPais  = new Set(legsPais.map(l => l.id));
      setLegajos(legsPais);
      setCuentas(ctas);
      setLiqs(ls.filter(l => (!p || !l.pais || l.pais === p) && idsPais.has(l.legajo_id)).map(l => ({ ...l, _ambito: ambitoLiq(l) || "sedes" })));
      const agui = novs.filter(n => esNovedadAguinaldo(n) && idsPais.has(n.legajo_id));
      setRows(agui.map(novToRow));
      setLoaded(agui);
      setDirty(false);
    } catch (e) {
      setFallo(e?.message || "No se pudieron cargar los datos.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(anio, semestre, pais); }, [anio, semestre, pais, load]);

  // Cuenta "Aguinaldos" real de la hoja (id CTA-… o CUENTA_…); fallback a la constante.
  const cuentaAgui = useMemo(() => cuentas.find(c => esCuentaAguinaldo(c.id, c.nombre)) || CUENTA_AGUINALDO, [cuentas]);
  // Base = cuentas fijas + las tildadas en Maestros (si las hay). `nombresBase` es la lista deduplicada
  // para la leyenda; `cuentasBase` el Set normalizado para el cálculo.
  const nombresBase = useMemo(() => {
    const fijas = new Set(CUENTAS_BASE_FIJAS.map(normTxt));
    return [...CUENTAS_BASE_FIJAS, ...cuentas.filter(c => c.base_aguinaldo && !fijas.has(normTxt(c.nombre))).map(c => c.nombre)];
  }, [cuentas]);
  const cuentasBase = useMemo(() => new Set(nombresBase.map(normTxt)), [nombresBase]);

  // Cálculo por persona del ámbito: una fila por legajo con liquidaciones cerradas en el semestre.
  const calc = useMemo(() => {
    const esCuentaBase = (nombre) => cuentasBase.has(normTxt(nombre));
    const liqsAmb = liqs.filter(l => l._ambito === ambito && Number(l.anio) === Number(anio) && S.meses.includes(Number(l.mes)));
    const mesesCerrados = new Set(liqsAmb.map(l => Number(l.mes)));
    const porLegajo = new Map();
    for (const l of liqsAmb) { if (!porLegajo.has(l.legajo_id)) porLegajo.set(l.legajo_id, []); porLegajo.get(l.legajo_id).push(l); }
    const byId = new Map(legajos.map(l => [l.id, l]));
    return [...porLegajo.entries()].map(([id, mias]) => {
      const leg = byId.get(id) || { id, nombre: mias[0].legajo_nombre || id, sinLegajo: true };
      return { leg, res: calcularAguinaldo({ legajo: leg, liqs: mias, anio, semestre, ambito, mesesCerrados, devengadoDe: devengadoPorFormaYSociedad, esCuentaBase }) };
    }).sort((a, b) => String(a.leg.nombre).localeCompare(String(b.leg.nombre), "es"));
  }, [liqs, legajos, ambito, anio, semestre, S, cuentasBase]);

  // Filas de la grilla del ámbito activo y total cargado por persona.
  const rowsAmb = useMemo(() => rows.filter(r => r._ambito === ambito), [rows, ambito]);
  const enGrillaPorLegajo = useMemo(() => {
    const m = new Map();
    for (const r of rowsAmb) m.set(r.legajo_id, (m.get(r.legajo_id) || 0) + (parseFloat(r.monto) || 0));
    return m;
  }, [rowsAmb]);

  // Cálculo + haberes elegidos + estado respecto de la grilla, una vez por render (lo usan la tabla,
  // los totales y el Excel).
  const filas = useMemo(() => calc.map(c => {
    const r = c.res;
    const k = `${c.leg.id}|${ambito}`;
    const v = haberesEdit[k];
    const hab = r.aguinaldo ? Math.max(0, Math.min(r.aguinaldo, Math.round(Number(v == null || v === "" ? r.haberesDefault : v) || 0))) : 0;
    const enGrilla = enGrillaPorLegajo.get(c.leg.id);
    let estado;
    if (r.motivo)              estado = enGrilla ? { t: "en grilla sin cálculo", color: T.amber } : { t: r.motivo, color: T.dim };
    else if (enGrilla == null) estado = { t: "pendiente", color: T.muted };
    else if (Math.abs(enGrilla - r.aguinaldo) <= 0.5) estado = { t: "en grilla", color: T.green };
    else                       estado = { t: `en grilla: ${fmt(enGrilla)}`, color: T.amber };
    return { ...c, k, hab, estado };
  }), [calc, ambito, haberesEdit, enGrillaPorLegajo]);

  // Lleva el cálculo a la grilla: actualiza las filas existentes de cada persona (misma forma) y
  // agrega las que faltan. No borra nada por su cuenta. Nada se escribe hasta Guardar.
  const cargarEnGrilla = async () => {
    const conMonto = filas.filter(c => c.res.aguinaldo > 0);
    if (!conMonto.length) { setAviso({ tipo: "info", texto: "No hay aguinaldo calculado para cargar." }); return; }
    const yaHay = conMonto.filter(c => enGrillaPorLegajo.has(c.leg.id)).length;
    const ok = await confirm({
      title: "Cargar en la grilla",
      message: `Se van a cargar ${conMonto.length} personas en la grilla de ${S.corto} ${anio} (${ambitoLabel}).` +
        (yaHay ? ` ${yaHay} ya tienen filas: se actualiza el monto de la misma forma de pago y se agregan las que falten.` : "") +
        ` No se escribe nada hasta que aprietes Guardar.`,
      confirmLabel: "Cargar", cancelLabel: "Cancelar", danger: false,
    });
    if (!ok) return;
    setRows(prev => {
      const next = [...prev];
      for (const c of conMonto) {
        const esDeEsta = (r) => r.legajo_id === c.leg.id && r._ambito === ambito;
        for (const d of filasNovedadAguinaldo(c.res, c.hab)) {
          const idx = next.findIndex(r => esDeEsta(r) && r.forma_pago === d.forma_pago);
          if (idx >= 0) next[idx] = { ...next[idx], monto: String(d.monto), nota: next[idx].nota || d.descripcion,
            sede_id: next[idx].sede_id || d.sede_id, sede_nombre: next[idx].sede_nombre || d.sede_nombre };
          else next.push(newRow({ _ambito: ambito, ...d, monto: String(d.monto), nota: d.descripcion }));
        }
      }
      return next;
    });
    setDirty(true);
  };

  const setRow = (rid, patch) => { setRows(prev => prev.map(r => r._id === rid ? { ...r, ...patch } : r)); setDirty(true); };
  const delRow = (rid) => { setRows(prev => prev.filter(r => r._id !== rid)); setDirty(true); };
  const addRow = () => { setRows(prev => [...prev, newRow({ _ambito: ambito })]); setDirty(true); };
  const legajoOptions = useMemo(() => legajos.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>), [legajos]);
  const legajoById = useMemo(() => new Map(legajos.map(l => [l.id, l])), [legajos]);
  // Sedes donde cada persona tuvo liquidación en el año (para el desplegable de sede de una fila).
  const sedesPorLegajo = useMemo(() => {
    const m = new Map();
    for (const l of liqs) {
      if (l._ambito !== "sedes" || !l.sede_id) continue;
      if (!m.has(l.legajo_id)) m.set(l.legajo_id, new Map());
      m.get(l.legajo_id).set(String(l.sede_id), l.sede_nombre || l.sede_id);
    }
    return m;
  }, [liqs]);

  // Forma de pago EN MASA (Martín: a fin de año paga casi todo en efectivo). Pasa todas las filas del
  // ámbito a una forma y unifica las filas de cada persona (y sede) en UNA sola: la primera conserva
  // el id (se edita), las demás se borran al Guardar.
  const aplicarFormaATodas = async () => {
    const personas = new Set(rowsAmb.filter(r => r.legajo_id).map(r => `${r.legajo_id}|${r.sede_id || ""}`)).size;
    if (!personas) { setAviso({ tipo: "info", texto: "No hay filas en la grilla." }); return; }
    const ok = await confirm({
      title: "Forma de pago para todas",
      message: `Se pasan todas las filas de ${ambitoLabel} (${personas} personas) a ${FP_TIPO_LABEL[formaMasa]}, una sola fila por persona. Después apretá Guardar.`,
      confirmLabel: "Aplicar", cancelLabel: "Cancelar", danger: false,
    });
    if (!ok) return;
    setRows(prev => {
      const out = [];
      const vistos = new Map();   // legajo|sede → índice en out
      for (const r of prev) {
        if (r._ambito !== ambito) { out.push(r); continue; }
        const k = `${r.legajo_id}|${r.sede_id || ""}`;
        const idx = vistos.get(k);
        if (idx == null) {
          vistos.set(k, out.length);
          out.push({ ...r, forma_pago: formaMasa, nota: descripcionAguinaldo(anio, semestre, formaMasa) });
        } else {
          out[idx] = { ...out[idx], monto: String((parseFloat(out[idx].monto) || 0) + (parseFloat(r.monto) || 0)) };
        }
      }
      return out;
    });
    setDirty(true);
  };

  // Guardar: altas en lote, ediciones y bajas por diff (mismo esquema que Novedades HQ/Sedes). El
  // snapshot `loaded` SOLO tiene novedades de Aguinaldos → esta pantalla nunca toca otras novedades.
  const handleGuardar = async () => {
    if (savingRef.current) return;
    const conDatos = rows.filter(r => r.legajo_id || parseFloat(r.monto) > 0 || (r.nota || "").trim());
    const incompletas = conDatos.filter(r => !r.legajo_id || !(parseFloat(r.monto) > 0) || (r._ambito === "sedes" && !r.sede_id));
    if (incompletas.length) { setAviso({ tipo: "error", texto: `Hay ${incompletas.length} fila(s) incompleta(s): legajo, monto > 0 y, en Sedes, la sede.` }); return; }
    setAviso(null);
    savingRef.current = true; setSaving(true);
    try {
      const loadedById = new Map(loaded.map(n => [n.id, n]));
      const nuevas = [], ops = [];
      for (const r of conDatos) {
        const enSedes = r._ambito === "sedes";
        const payload = {
          mes: mesPago, anio, legajo_id: r.legajo_id, legajo_nombre: r.legajo_nombre,
          sede_id: enSedes ? (r.sede_id || "") : "", sede_nombre: enSedes ? (r.sede_nombre || "") : "",
          tipo: "extra", descripcion: r.nota, monto: parseFloat(r.monto) || 0, forma_pago: r.forma_pago,
          cuenta_contable_id: cuentaAgui.id, cuenta_contable_nombre: cuentaAgui.nombre,
        };
        if (!r.id) nuevas.push({ tmpId: r._id, payload });
        else {
          const orig = loadedById.get(r.id);
          if (!orig || rowSig(r) !== rowSig(novToRow(orig))) ops.push(() => updateNovedad(r.id, payload));
        }
      }
      const keepIds = new Set(conDatos.filter(r => r.id).map(r => r.id));
      // Al borrar, sacarla del snapshot: un "Guardar" reintentado no la vuelve a pedir.
      for (const n of loaded) if (!keepIds.has(n.id)) ops.push(async () => {
        await deleteNovedad(n.id);
        setLoaded(prev => prev.filter(x => x.id !== n.id));
      });
      if (nuevas.length) {
        const ids = await appendNovedadesBatch(nuevas.map(n => n.payload));
        // Fijar los ids YA: si una op posterior falla y se reintenta "Guardar", estas filas no se
        // vuelven a dar de alta.
        const idPorTmp = new Map(nuevas.map((n, i) => [n.tmpId, ids[i]]));
        setRows(prev => prev.map(x => idPorTmp.has(x._id) ? { ...x, id: idPorTmp.get(x._id) } : x));
        setLoaded(prev => [...prev, ...nuevas.map((n, i) => ({ id: ids[i], ...n.payload }))]);
      }
      // Secuencial: el GAS pierde escrituras concurrentes.
      for (const op of ops) await op();
      await load(anio, semestre, pais);
      setAviso({ tipo: "info", texto: "Guardado." });
    } catch (e) {
      setAviso({ tipo: "error", texto: "Error al guardar: " + e.message });
    } finally { setSaving(false); savingRef.current = false; }
  };

  const exportarExcel = () => {
    const resumen = filas.map(c => ({
      Empleado: c.leg.nombre, Rol: c.leg.rol || "", Ambito: ambitoLabel,
      "Meses con sueldo": `${c.res.cantidad}/${c.res.totalMeses}`,
      "Mejor mes": c.res.mejorMes ? MESES_CORTO[c.res.mejorMes.mes - 1] : "",
      "Base mejor mes": c.res.mejorMes?.base || 0, Aguinaldo: c.res.aguinaldo,
      Haberes: c.hab, Resto: c.res.aguinaldo - c.hab,
      "Forma resto": FP_TIPO_LABEL[c.res.restoForma] || c.res.restoForma,
      "Sede destino": c.res.sedeDestino?.sede_nombre || "", Estado: c.estado.t, Avisos: c.res.avisos.join("; "),
    }));
    const detalle = [];
    for (const c of filas) for (const m of c.res.meses) for (const q of m.cuentas)
      detalle.push({ Empleado: c.leg.nombre, Mes: MESES_CORTO[m.mes - 1], Cuenta: q.cuenta, Base: q.base ? "sí" : "no", Monto: q.monto,
        "Base del mes": m.base, "Haberes del mes": m.haberes });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), "Resumen");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalle), "Detalle");
    XLSX.writeFile(wb, `Aguinaldo_${ambito}_${S.corto}_${anio}.xlsx`);
  };

  const totCalc   = filas.reduce((s, c) => s + c.res.aguinaldo, 0);
  const totHab    = filas.reduce((s, c) => s + c.hab, 0);
  const totGrilla = rowsAmb.reduce((s, r) => s + (parseFloat(r.monto) || 0), 0);
  const nColsCalc = ambito === "sedes" ? 11 : 10;
  const toggleAbierto = (id) => setAbiertos(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div style={{ padding: 24, fontFamily: T.font, color: T.text }}>
      {confirmUI}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, flexGrow: 1 }}>Aguinaldo</h2>
        <Toggle options={[[1, SEMESTRES[1].corto], [2, SEMESTRES[2].corto]]} value={semestre} onChange={setSemestre} />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => setAnio(a => a - 1)} style={ghostBtn}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 44, textAlign: "center" }}>{anio}</span>
          <button onClick={() => setAnio(a => a + 1)} style={ghostBtn}>›</button>
        </div>
        <Toggle options={Object.entries(AMBITO_LABEL)} value={ambito} onChange={setAmbito} />
        <button onClick={exportarExcel} style={ghostBtn} disabled={loading}>Excel control</button>
        <button onClick={handleGuardar} disabled={!dirty || saving} style={{ ...btnStyle(), opacity: (!dirty || saving) ? 0.5 : 1 }}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>

      <p style={{ fontSize: 12, color: T.muted, marginTop: 0, marginBottom: 12 }}>
        {S.label} {anio}: 50 % del mejor mes (solo cuentas base) × meses con sueldo / {S.meses.length}. Se paga como novedades de{" "}
        <b>{MESES_CORTO[mesPago - 1]} {anio}</b> con cuenta Aguinaldos; los cierres de {ambitoLabel} las toman solas.
        {" "}Cuentas base: <b>{nombresBase.join(", ")}</b> (fijas; se suman las tildadas en Numbers › Maestros › Cuentas).
      </p>

      {fallo && <div style={{ ...AVISO_STYLE.error, borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>⚠️ {fallo}</div>}
      {aviso && (
        <div style={{ ...AVISO_STYLE[aviso.tipo], display: "flex", alignItems: "center", gap: 10, borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>
          <span style={{ flex: 1 }}>{aviso.texto}</span>
          <button onClick={() => setAviso(null)} style={ghostBtn}>Cerrar</button>
        </div>
      )}
      {loading ? <p style={{ color: T.muted, fontSize: 13 }}>Cargando…</p> : (<>

        {/* ── Cálculo ─────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Cálculo · {ambitoLabel}</h3>
          <span style={{ fontSize: 12, color: T.dim }}>Haberes propone el 50 % del blanco del mejor mes y se edita por persona; el resto va por efectivo.</span>
          <button onClick={cargarEnGrilla} style={{ ...btnStyle(T.green), marginLeft: "auto" }} disabled={!filas.length}>Cargar en la grilla ↓</button>
        </div>
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflowX: "auto", marginBottom: 22 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: T.bg }}>
              <th style={{ ...th, width: 24 }}></th><th style={th}>Empleado</th><th style={th}>Rol</th>
              <th style={{ ...th, textAlign: "center" }}>Meses</th><th style={th}>Mejor mes</th>
              <th style={{ ...th, textAlign: "right" }}>Base</th><th style={{ ...th, textAlign: "right" }}>Aguinaldo</th>
              <th style={{ ...th, width: 130 }}>Haberes</th><th style={{ ...th, textAlign: "right" }}>Resto</th>
              {ambito === "sedes" && <th style={th}>Sede destino</th>}
              <th style={th}>Estado</th>
            </tr></thead>
            <tbody>
              {filas.length === 0 && <tr><td colSpan={nColsCalc} style={{ ...td, color: T.dim, padding: 14 }}>Sin liquidaciones cerradas de {ambitoLabel} en el semestre.</td></tr>}
              {filas.map(c => {
                const r = c.res, abierto = abiertos.has(c.leg.id);
                const tooltipMeses = [
                  r.mesesConSueldo.length ? `Con sueldo: ${r.mesesConSueldo.map(m => MESES_CORTO[m - 1]).join(", ")}` : "",
                  r.mesesAsumidos.length ? `Asumidos (sin cerrar): ${r.mesesAsumidos.map(m => MESES_CORTO[m - 1]).join(", ")}` : "",
                  r.mesesSinSueldo.length ? `Sin sueldo: ${r.mesesSinSueldo.map(m => MESES_CORTO[m - 1]).join(", ")}` : "",
                ].filter(Boolean).join("\n");
                return (<Fragment key={c.leg.id}>
                  <tr style={{ borderBottom: `1px solid ${T.border}`, opacity: r.motivo ? 0.6 : 1 }}>
                    <td style={{ ...td, textAlign: "center", cursor: "pointer", color: T.dim }} onClick={() => toggleAbierto(c.leg.id)}>{abierto ? "▾" : "▸"}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{c.leg.nombre}{c.leg.sinLegajo && <span style={{ color: T.red, fontSize: 11 }}> (sin legajo)</span>}
                      {r.avisos.length > 0 && <span title={r.avisos.join("\n")} style={{ marginLeft: 6, color: T.amber, cursor: "help" }}>⚠</span>}</td>
                    <td style={{ ...td, color: T.muted }}>{c.leg.rol || ""}</td>
                    <td style={{ ...td, textAlign: "center" }} title={tooltipMeses}>{r.cantidad}/{r.totalMeses}{r.mesesAsumidos.length ? "*" : ""}</td>
                    <td style={td}>{r.mejorMes ? MESES_CORTO[r.mejorMes.mes - 1] : "—"}</td>
                    <td style={der}>{r.mejorMes ? fmt(r.mejorMes.base) : "—"}</td>
                    <td style={{ ...der, fontWeight: 700 }}>{r.aguinaldo ? fmt(r.aguinaldo) : "—"}</td>
                    <td style={td}>
                      {r.aguinaldo > 0 && (
                        <input style={{ ...iStyle, textAlign: "right" }} inputMode="decimal"
                          value={fmtMiles(haberesEdit[c.k] ?? String(c.hab))}
                          onChange={e => setHaberesEdit(prev => ({ ...prev, [c.k]: limpiarMonto(e.target.value) }))} />
                      )}
                    </td>
                    <td style={der}>{r.aguinaldo ? <>{fmt(r.aguinaldo - c.hab)} <span style={{ color: T.dim, fontSize: 11 }}>{FP_TIPO_LABEL[r.restoForma] || r.restoForma}</span></> : "—"}</td>
                    {ambito === "sedes" && <td style={{ ...td, color: T.muted }}>{r.sedeDestino?.sede_nombre || "—"}</td>}
                    <td style={{ ...td, color: c.estado.color, fontWeight: 600 }}>{c.estado.t}</td>
                  </tr>
                  {abierto && (
                    <tr style={{ background: T.bg }}><td></td><td colSpan={nColsCalc - 1} style={{ padding: "6px 10px 10px" }}>
                      <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                        <thead><tr>
                          <th style={th}>Mes</th><th style={{ ...th, textAlign: "right" }}>Base</th><th style={{ ...th, textAlign: "right" }}>Haberes</th>
                          <th style={th}>Cuentas base</th><th style={th}>No base</th>
                        </tr></thead>
                        <tbody>{r.meses.map(m => (
                          <tr key={m.mes} style={{ background: r.mejorMes?.mes === m.mes ? "#dcfce7" : undefined }}>
                            <td style={td}>{MESES_CORTO[m.mes - 1]}{r.mejorMes?.mes === m.mes ? " ★" : ""}</td>
                            <td style={{ ...der, fontWeight: 600 }}>{fmt(m.base)}</td>
                            <td style={der}>{fmt(m.haberes)}</td>
                            <td style={{ ...td, whiteSpace: "normal" }}>{m.cuentas.filter(q => q.base).map(q => `${q.cuenta} ${fmt(q.monto)}`).join(" · ") || "—"}</td>
                            <td style={{ ...td, whiteSpace: "normal", color: T.dim }}>{m.cuentas.filter(q => !q.base).map(q => `${q.cuenta} ${fmt(q.monto)}`).join(" · ") || "—"}</td>
                          </tr>))}
                        </tbody>
                      </table>
                    </td></tr>
                  )}
                </Fragment>);
              })}
            </tbody>
            <tfoot><tr style={{ background: T.bg, fontWeight: 700 }}>
              <td colSpan={6} style={td}>Total calculado · {filas.filter(c => c.res.aguinaldo > 0).length} personas</td>
              <td style={der}>{fmt(totCalc)}</td>
              <td style={der}>{fmt(totHab)}</td>
              <td style={der}>{fmt(totCalc - totHab)}</td>
              <td colSpan={nColsCalc - 9}></td>
            </tr></tfoot>
          </table>
        </div>

        {/* ── Grilla (novedades Aguinaldos del mes de pago) ───────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
            Novedades de aguinaldo · {MESES_CORTO[mesPago - 1]} {anio} · {ambitoLabel}
            <span style={{ fontWeight: 400, color: T.muted, fontSize: 12 }}> — se guardan con Guardar y las toma el cierre de {MESES_CORTO[mesPago - 1]}</span>
          </h3>
          <span style={{ marginLeft: "auto", fontSize: 12, color: T.muted }}>Todas a:</span>
          <select style={{ ...iStyle, width: "auto" }} value={formaMasa} onChange={e => setFormaMasa(e.target.value)}>{FORMA_OPTIONS}</select>
          <button onClick={aplicarFormaATodas} style={ghostBtn} disabled={!rowsAmb.length}>Aplicar a todas</button>
        </div>
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: T.bg }}>
              <th style={th}>Legajo</th>{ambito === "sedes" && <th style={{ ...th, width: 180 }}>Sede</th>}
              <th style={{ ...th, width: 130 }}>Monto $</th><th style={{ ...th, width: 160 }}>Forma de pago</th><th style={th}>Nota</th><th style={{ ...th, width: 40 }}></th>
            </tr></thead>
            <tbody>
              {rowsAmb.length === 0 && <tr><td colSpan={6} style={{ ...td, color: T.dim, padding: 14 }}>Sin novedades de aguinaldo. Usá "Cargar en la grilla" o agregá una fila.</td></tr>}
              {rowsAmb.map(r => {
                const sedesDeR = sedesPorLegajo.get(r.legajo_id) || new Map();
                return (
                <tr key={r._id} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={td}>
                    <select style={iStyle} value={r.legajo_id} onChange={e => setRow(r._id, { legajo_id: e.target.value, legajo_nombre: legajoById.get(e.target.value)?.nombre ?? "" })}>
                      <option value="">— Elegir legajo —</option>
                      {legajoOptions}
                    </select>
                  </td>
                  {ambito === "sedes" && (
                    <td style={td}>
                      <select style={iStyle} value={String(r.sede_id)} onChange={e => setRow(r._id, { sede_id: e.target.value, sede_nombre: sedesDeR.get(e.target.value) ?? r.sede_nombre })}>
                        <option value="">— Sede —</option>
                        {r.sede_id && !sedesDeR.has(String(r.sede_id)) && <option value={String(r.sede_id)}>{r.sede_nombre || r.sede_id}</option>}
                        {[...sedesDeR.entries()].map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
                      </select>
                    </td>
                  )}
                  <td style={td}>
                    <input style={{ ...iStyle, textAlign: "right" }} value={fmtMiles(r.monto)} placeholder="0" inputMode="decimal"
                      onChange={e => setRow(r._id, { monto: limpiarMonto(e.target.value) })} />
                  </td>
                  <td style={td}><select style={iStyle} value={r.forma_pago} onChange={e => setRow(r._id, { forma_pago: e.target.value })}>{FORMA_OPTIONS}</select></td>
                  <td style={td}><input style={iStyle} value={r.nota} onChange={e => setRow(r._id, { nota: e.target.value })} /></td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <button onClick={() => delRow(r._id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: T.dim }}>🗑</button>
                  </td>
                </tr>
                );
              })}
            </tbody>
            <tfoot><tr style={{ background: T.bg, fontWeight: 700 }}>
              <td colSpan={ambito === "sedes" ? 2 : 1} style={td}>Total en grilla</td>
              <td style={der}>{fmt(totGrilla)}</td>
              <td colSpan={3} style={{ ...td, color: Math.abs(totGrilla - totCalc) > 0.5 ? T.amber : T.green, fontWeight: 600 }}>
                {Math.abs(totGrilla - totCalc) > 0.5 ? `difiere del cálculo en ${fmt(totGrilla - totCalc)}` : "coincide con el cálculo"}
              </td>
            </tr></tfoot>
          </table>
          <div style={{ padding: "8px 10px" }}>
            <button onClick={addRow} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: T.blue, fontFamily: T.font, padding: 0 }}>+ Agregar fila</button>
          </div>
        </div>
      </>)}
    </div>
  );
}
