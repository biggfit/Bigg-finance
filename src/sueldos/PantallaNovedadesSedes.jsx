import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  fetchNovedades, appendNovedadesBatch, updateNovedad, deleteNovedad,
  fetchLegajos, fetchCentrosCostoNumbers, fetchCuentasContablesNumbers,
  FP_TIPOS, FP_TIPO_LABEL, ROLES_FRONT, ROLES_COACHES, ROLES_LIMP, ROLES_HQ,
  fmtMiles, limpiarMonto,
} from "../lib/sueldosApi";
import { useRowChecks } from "../lib/useRowChecks";
import { novedadesDeAmbito, normTxt } from "../lib/aguinaldo";
import { tmpRowId } from "../lib/tmpRowId";
import { readDraft, writeDraft, clearDraft } from "../lib/borradorLocal";
import { HeaderCheckTodas } from "./sueldosUi";

// Orden del picker de legajos (pedido del usuario): encargado/vendedor → coach → limpieza → HQ.
// Incluye TODOS los legajos activos (un HQ que presta servicios en una sede se elige acá).
const ROL_ORDEN = [...ROLES_FRONT, ...ROLES_COACHES, ...ROLES_LIMP, ...ROLES_HQ];
const rolRank = (rol) => { const i = ROL_ORDEN.indexOf(rol); return i === -1 ? ROL_ORDEN.length : i; };
// Grupos para el <optgroup> (división visual en el picker), en el mismo orden.
const ROL_GRUPOS = [
  { label: "Encargados y Vendedores", roles: ROLES_FRONT },
  { label: "Coaches",                 roles: ROLES_COACHES },
  { label: "Limpieza",                roles: ROLES_LIMP },
  { label: "HQ",                      roles: ROLES_HQ },
  { label: "Otros",                   roles: [] },   // cualquier rol no contemplado
];
const grupoDeRol = (rol) => ROL_GRUPOS.find(g => g.roles.includes(rol))?.label || "Otros";

const T = {
  bg:     "#f8fafc",
  card:   "#ffffff",
  border: "#e2e8f0",
  text:   "#1e293b",
  muted:  "#64748b",
  dim:    "#94a3b8",
  blue:   "#2563eb",
  red:    "#dc2626",
  green:  "#16a34a",
  font:   "'Inter', system-ui, sans-serif",
};

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
               "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const hoy     = new Date();
const MES_DEF = hoy.getMonth() === 0 ? 12 : hoy.getMonth();
const ANO_DEF = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();

// Solapas por concepto. A diferencia de HQ, la cuenta contable se sigue eligiendo por fila: la solapa
// se guarda aparte, en `solapa`.
const SOLAPAS = [
  { key: "comision_resultados", label: "Comisión sobre resultados" },
  { key: "comision_referido",   label: "Comisión por referido" },
  { key: "servicio_custom",     label: "Servicio Custom" },
  { key: "feriados",            label: "Feriados" },
  { key: "otros",               label: "Otros conceptos", ayuda: "Reemplazos, horas extras, ajustes puntuales, adicionales, running, programaciones…" },
];
const SOLAPA_KEYS = new Set(SOLAPAS.map(c => c.key));

// Solapa de una novedad: la guardada; las cargadas antes de las solapas se ubican por la nota y la cuenta.
function solapaDe(n) {
  if (SOLAPA_KEYS.has(n.solapa)) return n.solapa;
  const cta = normTxt(n.cuenta_contable_nombre), txt = normTxt(n.descripcion);
  if (/referid/.test(txt)) return "comision_referido";
  if (/custom/.test(txt)) return "servicio_custom";
  if (/feriad/.test(txt)) return "feriados";
  if (/resultado/.test(cta) || /comisi/.test(txt)) return "comision_resultados";
  return "otros";
}

function newRow(overrides = {}) {
  return {
    _id: tmpRowId(),
    id: null,
    legajo_id: "", legajo_nombre: "",
    sede_id: "", sede_nombre: "",
    monto: "", forma_pago: "efectivo", nota: "",
    cuenta_contable_id: "", cuenta_contable_nombre: "",
    solapa: "otros",
    ...overrides,
  };
}

function novToRow(n) {
  return {
    _id: n.id,
    id: n.id,
    legajo_id: n.legajo_id, legajo_nombre: n.legajo_nombre,
    sede_id: n.sede_id, sede_nombre: n.sede_nombre,
    monto: String(n.monto || ""), forma_pago: n.forma_pago || "efectivo", nota: n.descripcion || "",
    cuenta_contable_id: n.cuenta_contable_id, cuenta_contable_nombre: n.cuenta_contable_nombre,
    solapa: solapaDe(n),
  };
}

// Borrador local de lo editado sin guardar (ver lib/borradorLocal), por país y mes.
const draftKey = (p, a, m) => `novedades_sedes_borrador_${p}_${a}_${m}`;

// Firma para detectar cambios entre la fila editada y la persistida.
const rowSig = (r) => [r.legajo_id, r.sede_id, r.monto, r.forma_pago, r.nota, r.cuenta_contable_id, r.solapa].join("|");

const iStyle = {
  border: `1px solid ${T.border}`, borderRadius: 5, padding: "5px 8px",
  fontSize: 13, fontFamily: T.font, background: "#eceff3", color: T.text,
  width: "100%", boxSizing: "border-box",
};
// Resalta un campo requerido sin completar (rojito).
const invStyle = { border: "1px solid #ef4444", background: "#fee2e2" };

export default function PantallaNovedadesSedes({ pais = "" }) {
  const [mes,  setMes]  = useState(MES_DEF);
  const [anio, setAnio] = useState(ANO_DEF);
  const [tab,  setTab]  = useState(SOLAPAS[0].key);

  const [rows,    setRows]    = useState([]);
  const [loaded,  setLoaded]  = useState([]);   // snapshot persistido (para diff)
  const [legajos, setLegajos] = useState([]);
  const [sedes,   setSedes]   = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [dirty,   setDirty]   = useState(false);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [draftTs, setDraftTs] = useState(null);   // fecha del borrador recuperado (para el cartel)
  const savingRef = useRef(false);
  // Clave del borrador del mes YA cargado: mientras carga otro mes, las filas en pantalla siguen siendo
  // del anterior y no deben escribirse bajo la clave nueva.
  const draftKeyRef = useRef(null);
  const { checked, toggle: toggleCheck, setMany: setManyChecked } = useRowChecks(`novedades_check_sedes_${anio}_${mes}`);
  const toggleSort = (k) => {
    if (sortKey === k) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  const load = useCallback(async (m, a, p, { descartarBorrador = false } = {}) => {
    if (!p) return;
    const key = draftKey(p, a, m);
    if (descartarBorrador) clearDraft(key);
    setLoading(true);
    try {
      const [novs, legs, ccs, ctas] = await Promise.all([
        fetchNovedades(m, a),
        fetchLegajos(),
        fetchCentrosCostoNumbers(),
        fetchCuentasContablesNumbers(),
      ]);
      // Solo las de Sedes (con sede, sin aguinaldo): las de HQ y las de Aguinaldo viven en su propia
      // pantalla y acá no se muestran ni se borran.
      const sedesNovs = novedadesDeAmbito(novs, "sedes");
      const draft = descartarBorrador ? null : readDraft(key);
      if (draft) {
        // Una fila del borrador cuyo id ya no está en la planilla (la borró otro) vuelve a ser alta.
        const ids = new Set(sedesNovs.map(n => n.id));
        // Un borrador de antes de las solapas no trae `solapa`: se ubica igual que una novedad vieja.
        setRows(draft.rows.map(r => {
          const fila = { ...r, solapa: solapaDe({ ...r, descripcion: r.nota }) };
          return fila.id && !ids.has(fila.id) ? { ...fila, id: null } : fila;
        }));
        setDraftTs(draft.ts);
      } else {
        setRows(sedesNovs.map(novToRow));
        setDraftTs(null);
      }
      setLoaded(sedesNovs);
      draftKeyRef.current = key;
      setLegajos(legs
        .filter(l => l.activo && (!l.pais || l.pais === p))
        .sort((a, b) => rolRank(a.rol) - rolRank(b.rol) || a.nombre.localeCompare(b.nombre, "es")));
      setSedes(ccs.filter(c => !c.pais || c.pais === p));
      setCuentas(ctas);
      setDirty(!!draft);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(mes, anio, pais); }, [mes, anio, pais, load]);

  // Cada cambio sin guardar se escribe al instante en el borrador; sin cambios pendientes, se borra.
  useEffect(() => {
    const key = draftKeyRef.current;
    if (!key || loading) return;
    if (dirty) writeDraft(key, rows); else clearDraft(key);
  }, [rows, dirty, loading]);

  const handleDescartarBorrador = () => {
    if (!confirm("¿Descartar los cambios sin guardar y volver a lo que está guardado?")) return;
    load(mes, anio, pais, { descartarBorrador: true });
  };

  const prevMes = () => {
    if (mes === 1) { setMes(12); setAnio(a => a - 1); }
    else setMes(m => m - 1);
  };
  const nextMes = () => {
    if (mes === 12) { setMes(1); setAnio(a => a + 1); }
    else setMes(m => m + 1);
  };

  // Arrastrar y soltar para reordenar filas (solo con orden natural: un sort por columna activo lo pisaría al instante).
  const dragIdRef = useRef(null);
  const handleDragStart = (rid) => (e) => { dragIdRef.current = rid; e.dataTransfer.effectAllowed = "move"; };
  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
  const handleDrop = (targetRid) => (e) => {
    e.preventDefault();
    const draggedRid = dragIdRef.current;
    dragIdRef.current = null;
    if (!draggedRid || draggedRid === targetRid) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const antesDelTarget = e.clientY < rect.top + rect.height / 2;
    setRows(prev => {
      const arr = [...prev];
      const fromIdx = arr.findIndex(r => r._id === draggedRid);
      if (fromIdx === -1) return prev;
      const [item] = arr.splice(fromIdx, 1);
      let toIdx = arr.findIndex(r => r._id === targetRid);
      if (toIdx === -1) return prev;
      arr.splice(antesDelTarget ? toIdx : toIdx + 1, 0, item);
      return arr;
    });
    setDirty(true);
  };

  const setRow = (rid, patch) => {
    setRows(prev => prev.map(r => r._id === rid ? { ...r, ...patch } : r));
    setDirty(true);
  };
  const setLegajo = (rid, legId) => {
    const leg = legajos.find(l => l.id === legId);
    setRow(rid, { legajo_id: legId, legajo_nombre: leg?.nombre ?? "" });
  };
  const setSede = (rid, sedeId) => {
    const s = sedes.find(c => String(c.id) === String(sedeId));
    setRow(rid, { sede_id: sedeId, sede_nombre: s?.nombre ?? "" });
  };
  const setCuenta = (rid, ccId) => {
    const cc = cuentas.find(c => c.id === ccId);
    setRow(rid, { cuenta_contable_id: ccId, cuenta_contable_nombre: cc?.nombre ?? "" });
  };
  const addRow = () => { setRows(prev => [...prev, newRow({ solapa: tab })]); setDirty(true); };
  const delRow = (rid) => { setRows(prev => prev.filter(r => r._id !== rid)); setDirty(true); };

  const handleCopiarMesAnterior = async () => {
    const mAnt = mes === 1 ? 12 : mes - 1;
    const aAnt = mes === 1 ? anio - 1 : anio;
    const novs = novedadesDeAmbito(await fetchNovedades(mAnt, aAnt), "sedes");
    if (!novs.length) { alert("No hay novedades de Sedes en el mes anterior."); return; }
    setRows(novs.map(n => ({ ...newRow(novToRow(n)), id: null, _id: tmpRowId() })));
    setDirty(true);
  };

  const handleGuardar = async () => {
    if (savingRef.current) return;
    // Todos los campos son obligatorios: toda fila con algún dato debe estar completa
    // (legajo + sede + cuenta contable + monto > 0). Las filas totalmente vacías se ignoran.
    const conDatos = rows.filter(r =>
      r.legajo_id || r.sede_id || r.cuenta_contable_id || (r.nota || "").trim() || parseFloat(r.monto) > 0);
    const incompletas = conDatos.filter(r =>
      !r.legajo_id || !r.sede_id || !r.cuenta_contable_id || !(parseFloat(r.monto) > 0));
    if (incompletas.length) {
      alert(`Hay ${incompletas.length} novedad(es) incompleta(s). Completá legajo, sede, cuenta contable y monto en cada fila (o borrá las filas vacías) antes de guardar.`);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const validas = conDatos;   // todas completas (validado arriba)
      const loadedById = new Map(loaded.map(n => [n.id, n]));

      // Altas: todas en UN lote (una request en vez de N). Ediciones y bajas: solo las que cambiaron.
      const nuevas = [];
      const ops = [];
      for (const r of validas) {
        const payload = {
          mes, anio,
          legajo_id: r.legajo_id, legajo_nombre: r.legajo_nombre,
          sede_id: r.sede_id, sede_nombre: r.sede_nombre,
          tipo: "extra",
          descripcion: r.nota,
          monto: Math.abs(parseFloat(r.monto) || 0),   // extras siempre suman
          forma_pago: r.forma_pago,
          cuenta_contable_id: r.cuenta_contable_id,
          cuenta_contable_nombre: r.cuenta_contable_nombre,
          solapa: r.solapa,
        };
        if (!r.id) {
          nuevas.push({ tmpId: r._id, payload });
        } else {
          const orig = loadedById.get(r.id);
          if (!orig || rowSig(r) !== rowSig(novToRow(orig))) ops.push(() => updateNovedad(r.id, payload));
        }
      }

      // Bajas: ids cargados que ya no están entre las filas con id
      const keepIds = new Set(validas.filter(r => r.id).map(r => r.id));
      // Al borrar, sacarla del snapshot: un "Guardar" reintentado no la vuelve a pedir.
      for (const n of loaded) if (!keepIds.has(n.id)) ops.push(async () => {
        await deleteNovedad(n.id);
        setLoaded(prev => prev.filter(x => x.id !== n.id));
      });

      if (nuevas.length) {
        const ids = await appendNovedadesBatch(nuevas.map(n => n.payload));
        // Fijar los ids YA: si una op posterior falla y se reintenta "Guardar", estas filas no se
        // vuelven a dar de alta. El tilde verde (guardado en localStorage bajo el _id temporal) pasa
        // al id real; sin esto se "perdía" en el primer guardado.
        const idPorTmp = new Map(nuevas.map((n, i) => [n.tmpId, ids[i]]));
        setRows(prev => prev.map(x => idPorTmp.has(x._id) ? { ...x, id: idPorTmp.get(x._id) } : x));
        setLoaded(prev => [...prev, ...nuevas.map((n, i) => ({ id: ids[i], ...n.payload }))]);
        const tildadas = nuevas.filter(n => checked.has(n.tmpId));
        if (tildadas.length) {
          setManyChecked(tildadas.map(n => n.tmpId), false);
          setManyChecked(tildadas.map(n => idPorTmp.get(n.tmpId)), true);
        }
      }
      // Secuencial: el GAS pierde escrituras concurrentes (appendRow se pisa → se "borraba" la última).
      for (const op of ops) await op();
      await load(mes, anio, pais, { descartarBorrador: true });
    } catch (e) {
      alert("Error al guardar: " + e.message);
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  const btnStyle = (color = T.blue) => ({
    background: color, color: "#fff", border: "none", borderRadius: 7,
    padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
    fontFamily: T.font,
  });

  const thStyle = { padding: "7px 10px", textAlign: "left", fontWeight: 600,
    color: T.muted, fontSize: 11, letterSpacing: ".04em",
    borderBottom: `1px solid ${T.border}` };

  const sumar = (rs) => rs.filter(r => r.legajo_id && r.sede_id).reduce((s, r) => s + Math.abs(parseFloat(r.monto) || 0), 0);
  const tabRows = rows.filter(r => r.solapa === tab);
  const totalTab = sumar(tabRows);
  const totalGeneral = sumar(rows);
  const tabActual = SOLAPAS.find(c => c.key === tab);

  // Orden por header (vista derivada; los edits siguen mapeando por _id).
  // Mapas id→nombre precomputados una vez (antes se hacía arr.find en CADA comparación del sort).
  const nombreMaps = useMemo(() => ({
    legajo: new Map(legajos.map(x => [x.id, x.nombre])),
    sede:   new Map(sedes.map(x => [x.id, x.nombre])),
    cuenta: new Map(cuentas.map(x => [x.id, x.nombre])),
  }), [legajos, sedes, cuentas]);
  const valOrden = (r, k) =>
      k === "legajo"     ? (nombreMaps.legajo.get(r.legajo_id) || "")
    : k === "sede"       ? (nombreMaps.sede.get(r.sede_id) || "")
    : k === "cuenta"     ? (nombreMaps.cuenta.get(r.cuenta_contable_id) || "")
    : k === "monto"      ? (parseFloat(r.monto) || 0)
    : k === "forma_pago" ? (r.forma_pago || "")
    :                      (r.nota || "");
  const vista = useMemo(() => {
    if (!sortKey) return tabRows;
    return [...tabRows].sort((a, b) => {
      const va = valOrden(a, sortKey), vb = valOrden(b, sortKey);
      const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, tab, sortKey, sortDir, nombreMaps]);

  const idsConDatos = tabRows.filter(r => r.legajo_id && r.sede_id).map(r => r.id ?? r._id);
  const todosMarcados = idsConDatos.length > 0 && idsConDatos.every(id => checked.has(id));

  return (
    <div style={{ padding: 24, fontFamily: T.font, color: T.text }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, flexGrow: 1 }}>Novedades de Sedes</h2>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={prevMes} style={{ background: "none", border: `1px solid ${T.border}`,
            borderRadius: 5, padding: "4px 9px", cursor: "pointer", fontSize: 13, color: T.muted }}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 110, textAlign: "center" }}>
            {MESES[mes - 1]} {anio}
          </span>
          <button onClick={nextMes} style={{ background: "none", border: `1px solid ${T.border}`,
            borderRadius: 5, padding: "4px 9px", cursor: "pointer", fontSize: 13, color: T.muted }}>›</button>
        </div>

        <button onClick={handleCopiarMesAnterior}
          style={{ ...btnStyle("#64748b"), background: "transparent", color: T.muted,
            border: `1px solid ${T.border}` }}>
          Copiar mes anterior
        </button>

        <button onClick={handleGuardar} disabled={!dirty || saving}
          style={{ ...btnStyle(), opacity: (!dirty || saving) ? 0.5 : 1 }}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>

      <p style={{ fontSize: 12, color: T.muted, marginTop: 0, marginBottom: 16 }}>
        Extras que suman al sueldo de Sedes (plus, día de feriado del front desk, etc.). Cada novedad va a una sede y se imputa a esa liquidación.
      </p>

      {!loading && dirty && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          background: "#fef9c3", border: "1px solid #fde047", borderRadius: 7,
          padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#854d0e" }}>
          <span style={{ flexGrow: 1 }}>
            {draftTs
              ? `Recuperé tus cambios sin guardar del ${new Date(draftTs).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}.`
              : "Tenés cambios sin guardar."}
            {" "}Quedan como borrador solo en esta computadora; nadie más los ve hasta que toques Guardar.
          </span>
          <button onClick={handleDescartarBorrador}
            style={{ background: "none", border: "1px solid #eab308", borderRadius: 5, padding: "3px 9px",
              cursor: "pointer", fontSize: 12, color: "#854d0e", fontFamily: T.font }}>
            Descartar borrador
          </button>
        </div>
      )}

      {/* Solapas */}
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${T.border}`, marginBottom: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        {SOLAPAS.map(c => {
          const isActive = c.key === tab;
          const n = rows.filter(r => r.solapa === c.key && r.legajo_id).length;
          return (
            <button key={c.key} onClick={() => setTab(c.key)} title={c.ayuda}
              style={{
                background: "none", border: "none", borderBottom: `2px solid ${isActive ? T.blue : "transparent"}`,
                padding: "8px 12px", cursor: "pointer", fontFamily: T.font,
                fontSize: 13, fontWeight: isActive ? 700 : 500,
                color: isActive ? T.blue : T.muted, marginBottom: -1,
              }}>
              {c.label}{n > 0 ? ` (${n})` : ""}
            </button>
          );
        })}
        <span style={{ marginLeft: "auto", padding: "8px 4px", fontSize: 12, color: T.muted }}>
          Total todas las solapas: <b style={{ color: T.text }}>${totalGeneral.toLocaleString("es-AR")}</b>
        </span>
      </div>

      {tabActual?.ayuda && (
        <p style={{ fontSize: 12, color: T.muted, marginTop: -6, marginBottom: 12 }}>{tabActual.ayuda}</p>
      )}

      {loading ? (
        <p style={{ color: T.muted, fontSize: 13 }}>Cargando…</p>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.bg }}>
                <th style={{ ...thStyle, width: 24 }}></th>
                {[
                  { h: "Legajo", k: "legajo", w: null }, { h: "Sede", k: "sede", w: 170 },
                  { h: "Monto $", k: "monto", w: 120 }, { h: "Forma de pago", k: "forma_pago", w: 150 },
                  { h: "Cuenta contable", k: "cuenta", w: 170 }, { h: "Nota", k: "nota", w: null },
                ].map(({ h, k, w }) => (
                  <th key={k} onClick={() => toggleSort(k)}
                    style={{ ...thStyle, ...(w ? { width: w } : {}), cursor: "pointer", userSelect: "none" }}>
                    {h}{sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
                <th style={{ ...thStyle, width: 130 }}>Mover a</th>
                <th style={{ ...thStyle, width: 40 }}></th>
                <th style={{ ...thStyle, width: 40, textAlign: "center" }}>
                  <HeaderCheckTodas checked={todosMarcados} onToggle={() => setManyChecked(idsConDatos, !todosMarcados)} accent={T.green} />
                </th>
              </tr>
            </thead>
            <tbody>
              {tabRows.length === 0 && (
                <tr><td colSpan={10} style={{ padding: "14px 10px", color: T.dim, fontSize: 13 }}>
                  Sin novedades en esta solapa. Agregá una fila abajo.
                </td></tr>
              )}
              {vista.map(r => {
                const rid = r.id ?? r._id;
                const isChecked = checked.has(rid);
                const ordenNatural = sortKey === null;
                return (
                <tr key={r._id} style={{ borderBottom: `1px solid ${T.border}`,
                  background: isChecked ? "#bbf7d0" : undefined }}
                  onDragOver={ordenNatural ? handleDragOver : undefined}
                  onDrop={ordenNatural ? handleDrop(r._id) : undefined}>
                  <td style={{ padding: "6px 4px", textAlign: "center", color: ordenNatural ? T.dim : "#cbd5e1",
                    cursor: ordenNatural ? "grab" : "not-allowed" }}
                    draggable={ordenNatural} onDragStart={ordenNatural ? handleDragStart(r._id) : undefined}
                    title={ordenNatural ? "Arrastrar para reordenar" : "Quitá el orden por columna para reordenar a mano"}>⠿</td>
                  <td style={{ padding: "6px 10px" }}>
                    <select style={{ ...iStyle, ...(r.legajo_id ? {} : invStyle) }} value={r.legajo_id} onChange={e => setLegajo(r._id, e.target.value)}>
                      <option value="">— Elegir legajo —</option>
                      {ROL_GRUPOS.map(g => {
                        const items = legajos.filter(l => grupoDeRol(l.rol) === g.label);
                        return items.length ? (
                          <optgroup key={g.label} label={g.label}>
                            {items.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                          </optgroup>
                        ) : null;
                      })}
                    </select>
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <select style={{ ...iStyle, ...(r.sede_id ? {} : invStyle) }} value={r.sede_id} onChange={e => setSede(r._id, e.target.value)}>
                      <option value="">— Elegir sede —</option>
                      {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <input style={{ ...iStyle, textAlign: "right", ...(Number(r.monto) ? {} : invStyle) }} value={fmtMiles(r.monto)} placeholder="0"
                      inputMode="decimal"
                      onChange={e => setRow(r._id, { monto: limpiarMonto(e.target.value) })} />
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <select style={iStyle} value={r.forma_pago} onChange={e => setRow(r._id, { forma_pago: e.target.value })}>
                      {FP_TIPOS.map(t => <option key={t} value={t}>{FP_TIPO_LABEL[t]}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <select style={{ ...iStyle, ...(r.cuenta_contable_id ? {} : invStyle) }} value={r.cuenta_contable_id} onChange={e => setCuenta(r._id, e.target.value)}>
                      <option value="">— Cuenta —</option>
                      {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <input style={iStyle} value={r.nota} placeholder="Nota (ej: feriado 1/5)"
                      onChange={e => setRow(r._id, { nota: e.target.value })} />
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <select style={{ ...iStyle, fontSize: 12, color: T.muted }} value={r.solapa}
                      title="Pasar esta novedad a otra solapa"
                      onChange={e => setRow(r._id, { solapa: e.target.value })}>
                      {SOLAPAS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                    <button onClick={() => delRow(r._id)}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: T.dim, padding: 2 }}>🗑</button>
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                    <button onClick={() => toggleCheck(rid)} title="Marcar como revisado (solo en esta máquina)"
                      style={{
                        width: 18, height: 18, borderRadius: 4, cursor: "pointer", padding: 0,
                        border: `1px solid ${isChecked ? T.green : T.border}`,
                        background: isChecked ? T.green : "transparent",
                        color: "#fff", fontSize: 12, lineHeight: "16px",
                      }}>{isChecked ? "✓" : ""}</button>
                  </td>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: T.bg, fontWeight: 700 }}>
                <td colSpan={3} style={{ padding: "8px 10px" }}>Total {tabActual?.label}</td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>
                  ${totalTab.toLocaleString("es-AR")}
                </td>
                <td colSpan={6}></td>
              </tr>
            </tfoot>
          </table>
          </div>
          <div style={{ padding: "8px 10px" }}>
            <button onClick={addRow}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: T.blue, fontFamily: T.font, padding: 0 }}>
              + Agregar fila
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
