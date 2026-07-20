import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react";
import * as XLSX from "xlsx";
import {
  fetchLegajos, fetchCategorias, fetchObjetivos,
  fetchLiquidacionesSedes, deleteLiquidacionSede,
  fetchCentrosCostoNumbers, fetchSociedadesNumbers, fetchCuentasBancariasNumbers,
  fetchPagos, appendPago, deletePago, nuevoLote, updateLegajo, fetchHorasDesdeEye, fetchCdpDesdeEye,
  fetchNovedades,
  ROLES_COACHES, ROLES_FRONT, ROLES_LIMP, ROL_CONCEPTO,
  FP_TIPO_LABEL, FP_TIPO_COLOR, esTransferencia,
  idLiqDe, lineaLiq, sociedadDeFormaPago, saveLiquidacionLines, isCerrada,
} from "../lib/sueldosApi";

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
  yellow: "#ca8a04",
  purple: "#7c3aed",
  font:   "'Inter', system-ui, sans-serif",
};

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
               "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const hoy     = new Date();
const MES_DEF = hoy.getMonth() === 0 ? 12 : hoy.getMonth();
const ANO_DEF = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();
const ROLES_FIJOS = [...ROLES_FRONT, ...ROLES_LIMP];
const ROLES_SEDES_ALL = [...ROLES_COACHES, ...ROLES_FIJOS];
// Columnas de horas que bajan de Eye (cualquiera con valor mantiene la fila en Paso Horas).
const HORA_FIELDS = ["horas", "horas_feriados", "horas_domingos", "horas_yoga", "horas_running"];

// Forma de pago de una novedad → bucket escalar de Sedes (haberes / transferencia[=monotributo] /
// efectivo). El efectivo es el remanente, así que solo se rutean los no-efectivo.
const NOV_FP_BUCKET = {
  haberes: "haberes",
  deposito: "deposito",
  transferencia_financiera: "transferencia",
  monotributo: "transferencia",
  efectivo: "efectivo",
};
const rowKeyDe = (legajo_id, sede_id) => `${legajo_id || ""}__${sede_id || ""}`;

// Base sobre la que se aplica el % de objetivo grupal (regla de negocio, depende del rol):
//  - coaches: horas (normales + feriado) + objetivos individuales (asignado).
//  - front/fijo (encargado, ventas, limpieza): sueldo básico + feriado.
// El feriado del front se carga como novedad (no es campo de la fila), así que su monto NO
// entra acá; para front la base efectiva es el sueldo básico.
function baseGrupalDe(rol, { horasMonto, feriadosMonto, asignado, sueldoBase }) {
  return ROLES_COACHES.includes(rol)
    ? horasMonto + feriadosMonto + asignado
    : sueldoBase + feriadosMonto;
}

// Orden de visualización: primero por rol (Encargados → Vendedores → Limpieza → Coaches),
// luego por centro de costo 1→7 (numérico, según el prefijo "01 - …" de la sede).
const ROL_ORDEN = { ENCARGADO: 0, VENTAS: 1, LIMPIEZA: 2, COACH_SENIOR: 3, COACH: 4, BOTANICO: 5, YOGA: 6 };
const sortByRol = (arr) => [...arr].sort((a, b) => {
  const ro = (ROL_ORDEN[a.rol] ?? 9) - (ROL_ORDEN[b.rol] ?? 9);
  if (ro !== 0) return ro;
  const se = (a.sede_nombre || "").localeCompare(b.sede_nombre || "", "es", { numeric: true });
  if (se !== 0) return se;
  return (a.legajo_nombre || "").localeCompare(b.legajo_nombre || "");
});

function fmtMoney(n) {
  if (!n && n !== 0) return "—";
  return "$" + Math.round(n).toLocaleString("es-AR");
}

function sortRows(arr, key, dir) {
  if (!key) return arr;
  return [...arr].sort((a, b) => {
    const av = a[key] ?? "", bv = b[key] ?? "";
    const cmp = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv), "es", { numeric: true });
    return dir === "desc" ? -cmp : cmp;
  });
}

const iStyle = {
  border: `1px solid #cbd5e1`, borderRadius: 4, padding: "4px 6px",
  fontSize: 12, fontFamily: T.font, background: "#fff", color: T.text,
  width: "100%", boxSizing: "border-box", textAlign: "right",
};

const TH = (extra = {}) => ({
  padding: "7px 8px", textAlign: "left", fontWeight: 600,
  color: T.muted, fontSize: 11, letterSpacing: ".04em",
  borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap",
  background: T.bg, ...extra,
});

const BTN_PRIMARY = (disabled) => ({
  background: disabled ? T.dim : T.blue, color: "#fff", border: "none",
  borderRadius: 7, padding: "8px 20px", fontSize: 13, fontWeight: 600,
  cursor: disabled ? "not-allowed" : "pointer", fontFamily: T.font,
});

const BTN_SECONDARY = {
  border: `1px solid #94a3b8`, background: "#fff", borderRadius: 7,
  padding: "8px 20px", fontSize: 13, cursor: "pointer", color: T.text,
  fontFamily: T.font,
};

const TD = (extra = {}) => ({
  padding: "9px 8px", borderBottom: `1px solid ${T.border}`,
  verticalAlign: "middle", ...extra,
});

const BTN_EXPORT = (color) => ({
  display: "flex", alignItems: "center", gap: 6,
  border: `1px solid ${color}`, background: "#fff", borderRadius: 7,
  padding: "7px 14px", fontSize: 12, fontWeight: 600,
  cursor: "pointer", color, fontFamily: T.font,
});

const MODAL_INPUT = {
  border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px",
  fontSize: 13, fontFamily: T.font, width: "100%", boxSizing: "border-box",
  color: T.text, background: "#fff",
};

function ModalLabel({ children }) {
  return <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>{children}</label>;
}

function ctaLabel(c, sociedades) {
  const soc = sociedades.find(s => s.id === c.sociedad)?.nombre ?? c.sociedad;
  const mon = c.moneda !== "ARS" ? ` (${c.moneda})` : "";
  return `${soc} — ${c.nombre}${mon}`;
}

// ── Utilidades de fuzzy-matching (también usadas en PasoIncentivos) ───────────

const DIACRIT_RE_MOD = new RegExp("[\\u0300-\\u036f]", "g");
function normNombreM(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(DIACRIT_RE_MOD, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wordOverlapM(a, b) {
  const wa = new Set(a.split(" ").filter(w => w.length > 2));
  const wb = new Set(b.split(" ").filter(w => w.length > 2));
  return [...wa].filter(w => wb.has(w)).length;
}

function nameScoreM(normA, normB) {
  if (normA === normB) return 4;
  if (normA.includes(normB) || normB.includes(normA)) return 2;
  const ov = wordOverlapM(normA, normB);
  return ov >= 2 ? 1.5 : ov === 1 ? 0.8 : 0;
}

// Aplica el % de objetivos por sede a las filas (solo si c_grupo_pct === 0).
// Recibe el array de rows y el array de objetivos { sede_id, porcentaje }.
function applyObjetivosToRows(rowsArr, objetivosArr) {
  if (!objetivosArr?.length) return rowsArr;
  const objBySede = Object.fromEntries(objetivosArr.map(o => [o.sede_id, o.porcentaje]));
  return rowsArr.map(r => {
    if (Number(r.c_grupo_pct) !== 0) return r;   // no pisar valores ya ingresados
    const pct = objBySede[r.sede_id];
    return pct != null ? { ...r, c_grupo_pct: pct } : r;
  });
}

// ── Componente principal ───────────────────────────────────────────────────────

export default function PantallaLiquidacionSedes({ pais = "", initialMes, initialAnio, initialPaso }) {
  const [mes,  setMes]  = useState(initialMes  ?? MES_DEF);
  const [anio, setAnio] = useState(initialAnio ?? ANO_DEF);
  const [paso, setPaso] = useState(initialPaso ?? 1);
  const deepLinkPasoRef = useRef(false);  // consumir initialPaso (deep-link) una sola vez

  const [legajos,    setLegajos]    = useState([]);
  const [liqsSaved,  setLiqsSaved]  = useState([]);  // su_liquidaciones guardadas (se mergean en rosterBase)
  const [eyeItems,   setEyeItems]   = useState([]);  // items de BIGG Eye (coach × sede × horas)
  const [edits,      setEdits]      = useState({});  // overlay editable: { [rowKey]: { campo: val, _deleted? } }
  const [manualRows, setManualRows] = useState([]);  // filas agregadas a mano (alta manual)
  const [categorias, setCategorias] = useState([]);
  const [objetivos,  setObjetivos]  = useState([]);
  const [sedes,      setSedes]      = useState([]);
  const [cuentas,    setCuentas]    = useState([]);
  const [pagos,      setPagos]      = useState([]);
  const [novedades,  setNovedades]  = useState([]);  // novedades de Sedes (extra + sede) del mes
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState(null);
  const savingRef    = useRef(false);
  const lastDraftRef = useRef(null);  // último JSON escrito a localStorage (no-op guard)
  const originalRows = useRef({});  // rowKey → sueldo_base snapshot (baseline % aumento)

  // Wizard state
  const [actualizarLegs, setActualizarLegs] = useState(false);
  const [pagoDraft,      setPagoDraft]      = useState({});
  // { [legajo_id]: { monto_haberes, monto_transferencia } }  (monto_transferencia = Monotributo)

  // Add row form (shared between paso 1 & 2)
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm,     setAddForm]     = useState({ legajo_id: "", sede_id: "" });

  // Paso 4 modal
  const [showPago, setShowPago] = useState(null);  // legajo_id

  const load = useCallback(async (m, a, p) => {
    if (!p) return;
    setLoading(true);
    try {
      const [legs, cats, objs, liqs, socs, ccs, ctas, pags, novs] = await Promise.all([
        fetchLegajos(),
        fetchCategorias(m, a, p),
        fetchObjetivos(m, a, p),
        fetchLiquidacionesSedes(m, a, p),
        fetchSociedadesNumbers(),
        fetchCentrosCostoNumbers(),
        fetchCuentasBancariasNumbers(),
        fetchPagos(m, a),
        fetchNovedades(m, a),
      ]);
      // Solo novedades de Sedes: extra + con sede (las de HQ no tienen sede_id).
      setNovedades(novs.filter(n => n.tipo === "extra" && n.sede_id));
      const socIds   = socs.filter(s => s.pais === p).map(s => s.id);
      // Sedes del país. nb_centros_costo tiene `pais` (no `sociedad`): antes filtraba por
      // c.sociedad (columna inexistente) → traía TODAS las sedes (incl. ES/CL). Ahora por país.
      // Los check-ins de Eye salen de estas sedes que tengan bigg_eye_id (ver eyeIds más abajo).
      const sedesArr = ccs.filter(c => !c.pais || c.pais === p);
      setLegajos(legs.filter(l => l.activo && (!l.pais || l.pais === p)));
      setSedes(sedesArr);
      setCuentas(ctas.filter(c => !c.sociedad || socIds.includes(c.sociedad)));
      setCategorias(cats);
      setObjetivos(objs);

      // Normalize sede_nombre: rows imported from BIGG Eye may have the short name
      // ("Recoleta") instead of the CC canonical name ("01 - Recoleta").
      // Match by bigg_eye_id first, then fallback to partial-name lookup.
      const eyeIdToCc = Object.fromEntries(
        sedesArr.filter(s => s.bigg_eye_id).map(s => [s.bigg_eye_id, s])
      );
      const normSedeNombre = (sedeId, sedeName) => {
        // If stored sedeId matches a CC id → use that CC nombre
        const byId = sedesArr.find(s => s.id === sedeId);
        if (byId) return byId.nombre;
        // Fallback: find CC whose nombre contains the stored sedeName
        const byName = sedesArr.find(s =>
          s.nombre.toLowerCase().includes((sedeName ?? "").toLowerCase()) ||
          (sedeName ?? "").toLowerCase().includes(s.nombre.toLowerCase().replace(/^\d+\s*-\s*/, ""))
        );
        return byName?.nombre ?? sedeName ?? "";
      };

      const mapped = liqs.map(r => ({
        ...r,
        sede_nombre: normSedeNombre(r.sede_id, r.sede_nombre),
      }));
      setLiqsSaved(mapped);
      // Pagos de Sedes: los nuevos llevan ambito="sedes". Fallback para legacy (sin ambito):
      // los de legajos de rol Sedes. Un legajo con liquidación en HQ y Sedes (ej. HQ que da clases)
      // se distingue por ambito → su pago de HQ no se cuenta acá y viceversa.
      const legIds = new Set(liqs.map(l => l.legajo_id));
      setPagos(pags.filter(pg => pg.ambito === "sedes" || (!pg.ambito && legIds.has(pg.legajo_id))));

      // BIGG Eye: traer horas por sede. No bloquea la carga si el servicio falla.
      const eyeIds = sedesArr.filter(s => s.bigg_eye_id).map(s => s.bigg_eye_id);
      try {
        const eyeData = await fetchHorasDesdeEye(m, a, p, eyeIds);
        setEyeItems(eyeData.items ?? []);
      } catch {
        setEyeItems([]);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(mes, anio, pais); }, [mes, anio, pais, load]);

  const draftKey = `sedesDraft:${pais}:${anio}-${mes}`;

  // Reset wizard when period or country changes; recover local draft if present.
  useEffect(() => {
    setPagoDraft({});
    setActualizarLegs(false);
    setShowAddForm(false);
    setDraftSavedAt(null);
    const raw = (() => { try { return localStorage.getItem(draftKey); } catch { return null; } })();
    lastDraftRef.current = raw;
    // Deep-link (1ª corrida): respetar el paso pedido en vez del draft/1.
    const deep = !deepLinkPasoRef.current && initialPaso != null;
    if (deep) deepLinkPasoRef.current = true;
    if (raw) {
      try {
        const d = JSON.parse(raw);
        setEdits(d.edits || {});
        setManualRows(d.manualRows || []);
        setPaso(deep ? initialPaso : (d.paso || 1));
        return;
      } catch { /* fall through */ }
    }
    setEdits({});
    setManualRows([]);
    setPaso(deep ? initialPaso : 1);
  }, [mes, anio, pais]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Borrador local automático (debounced). La pestaña "vive abierta como un mail".
  useEffect(() => {
    if (loading) return;
    if (!Object.keys(edits).length && !manualRows.length) return;
    const t = setTimeout(() => {
      const payload = JSON.stringify({ edits, manualRows, paso });
      if (payload === lastDraftRef.current) return;  // nada cambió: no reescribir ni re-renderizar
      try {
        localStorage.setItem(draftKey, payload);
        lastDraftRef.current = payload;
        setDraftSavedAt(Date.now());
      } catch { /* storage lleno o no disponible */ }
    }, 800);
    return () => clearTimeout(t);
  }, [edits, manualRows, paso, loading, draftKey]);

  const discardDraft = () => {
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    lastDraftRef.current = null;
    setEdits({});
    setManualRows([]);
    setDraftSavedAt(null);
  };

  // Match de tarifa insensible a mayúsculas Y acentos: "BOTÁNICO" (ROL_CONCEPTO) debe
  // matchear con la categoría guardada "BOTANICO" (sin acento), etc.
  const normConcepto = (s) => String(s || "").toUpperCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  // Mapa normConcepto → monto, armado una sola vez por mes (getTarifa hace lookup O(1);
  // antes era un .find lineal sobre `categorias` y se llama ~6 veces por fila).
  const tarifasMap = useMemo(() => {
    const m = new Map();
    for (const c of categorias) m.set(normConcepto(c.concepto), Number(c.monto) || 0);
    return m;
  }, [categorias]);
  const getTarifa = useCallback((concepto) => concepto ? (tarifasMap.get(normConcepto(concepto)) ?? 0) : 0, [tarifasMap]);

  // Tarifa por hora: los roles coach usan la tarifa de su rol; cualquier otro rol que
  // dé clases (horas que bajan de Eye) se paga a tarifa COACH SENIOR (decisión de negocio).
  const tarifaHoraRow = useCallback((rol) =>
    getTarifa(ROLES_COACHES.includes(rol) ? (ROL_CONCEPTO[rol] ?? rol) : ROL_CONCEPTO.COACH_SENIOR),
  [getTarifa]);

  // Fórmula ÚNICA de los montos por concepto de una fila (la usan calcTotal y lineasConceptoDeRow,
  // así no divergen). `total` = sueldo SIN redondeo (el redondeo se calcula al cerrar y se guarda).
  const montosDeRow = useCallback((row) => {
    const tarifaHora = tarifaHoraRow(row.rol);
    const tCdpCoach  = getTarifa("CDP COACHES");
    const tCdpFront  = getTarifa("CDP FRONT DESK");
    const tarifaOS   = getTarifa("ONE SHOT");
    const tarifaDom  = getTarifa("DOMINGO");
    const tarifaYoga = getTarifa("YOGA");
    const tarifaRun  = getTarifa("RUNNING");
    const fijo     = Number(row.sueldo_base) || 0;
    const horas    = Number(row.horas) || 0,          horasMonto    = horas * tarifaHora;
    const feriados = Number(row.horas_feriados) || 0, feriadosMonto = feriados * tarifaHora;
    const domingos = Number(row.horas_domingos) || 0, domingosMonto = domingos * tarifaDom;
    const yoga     = Number(row.horas_yoga) || 0,     yogaMonto     = yoga * tarifaYoga;
    const running  = Number(row.horas_running) || 0,  runningMonto  = running * tarifaRun;
    const cdpCoach = Number(row.q_cdp_coach) || 0,    cdpCoachMonto = cdpCoach * tCdpCoach;
    const cdpFront = Number(row.q_cdp_front) || 0,    cdpFrontMonto = cdpFront * tCdpFront;
    const os       = Number(row.q_one_shot) || 0,     osMonto       = os * tarifaOS;
    const asignado  = Number(row.asignado) || 0;
    const cGrupoPct = Number(row.c_grupo_pct) || 0;
    const cGrupoMonto = baseGrupalDe(row.rol, { horasMonto, feriadosMonto, asignado, sueldoBase: fijo }) * (cGrupoPct / 100);
    const total = fijo + horasMonto + feriadosMonto + domingosMonto + yogaMonto + runningMonto
                + cdpCoachMonto + cdpFrontMonto + osMonto + asignado + cGrupoMonto;
    return { tarifaHora, tCdpCoach, tCdpFront, tarifaOS, tarifaDom, tarifaYoga, tarifaRun, fijo,
      horas, horasMonto, feriados, feriadosMonto, domingos, domingosMonto, yoga, yogaMonto, running, runningMonto,
      cdpCoach, cdpCoachMonto, cdpFront, cdpFrontMonto, os, osMonto, asignado, cGrupoPct, cGrupoMonto, total };
  }, [getTarifa, tarifaHoraRow]);

  // Total de la fila = sueldo (montos) + el redondeo guardado (se calcula al cerrar).
  const calcTotal = useCallback((row) => montosDeRow(row).total + (Number(row.redondeo) || 0), [montosDeRow]);

  // Líneas `concepto` de una fila de Sedes (desglose del sueldo). Σ conceptos = total (sin redondeo).
  const lineasConceptoDeRow = useCallback((r, estado) => {
    const m = montosDeRow(r);
    const h = {
      mes, anio, pais, estado,
      legajo_id: r.legajo_id, legajo_nombre: r.legajo_nombre,
      sociedad_id: r.sociedad_id, sociedad_nombre: r.sociedad_nombre,
      sede_id: r.sede_id, sede_nombre: r.sede_nombre,
      rol: r.rol, tipo_contratacion: r.tipo_contratacion || "relacion_dependencia",
    };
    const L = [];
    const add = (concepto, cantidad, monto_unit, monto) => {
      if (monto > 0) L.push(lineaLiq(h, { tipo: "concepto", concepto, cuenta_contable: "Sueldos", cantidad, monto_unit, monto }));
    };
    add("Sueldo base", 0, 0, m.fijo);
    add("Horas", m.horas, m.tarifaHora, m.horasMonto);
    add("Feriados", m.feriados, m.tarifaHora, m.feriadosMonto);
    add("Domingos", m.domingos, m.tarifaDom, m.domingosMonto);
    add("Yoga", m.yoga, m.tarifaYoga, m.yogaMonto);
    add("Running", m.running, m.tarifaRun, m.runningMonto);
    add("CDP coach", m.cdpCoach, m.tCdpCoach, m.cdpCoachMonto);
    add("CDP front desk", m.cdpFront, m.tCdpFront, m.cdpFrontMonto);
    add("One Shot", m.os, m.tarifaOS, m.osMonto);
    add("Objetivos", 0, 0, m.asignado);
    add("Objetivo grupal", m.cGrupoPct, 0, m.cGrupoMonto);
    return { lineas: L, total: m.total, header: h };
  }, [montosDeRow, mes, anio, pais]);

  // ── Roster derivado en vivo (cross BIGG Eye × legajos × liquidaciones guardadas) ──
  // Reemplaza el botón "Inicializar": cada carga reconstruye el roster con clave estable
  // (rowKey) y un bucket de conciliación. Las ediciones del usuario viven en `edits`.
  const rosterBase = useMemo(() => {
    const baseRow = (over) => ({
      mes, anio, pais,
      legajo_id: "", legajo_nombre: "", sociedad_id: "", sociedad_nombre: "",
      sede_id: "", sede_nombre: "", rol: "COACH",
      horas: 0, horas_feriados: 0, horas_domingos: 0, horas_yoga: 0, horas_running: 0,
      q_cdp_coach: 0, q_cdp_front: 0, q_one_shot: 0, asignado: 0, c_grupo_pct: 0, redondeo: 0,
      sueldo_base: 0,
      monto_haberes: 0, monto_deposito: 0, monto_transferencia: 0, monto_efectivo: 0,
      estado: "borrador", revisar: false,
      ...over,
    });

    const resolveSede = (locationId, locationName) => {
      const m = sedes.find(s => s.bigg_eye_id === locationId);
      return { id: m?.id ?? String(locationId ?? ""), nombre: m?.nombre ?? locationName ?? "" };
    };
    // Normaliza los nombres de legajos una sola vez (no por cada item de Eye).
    const normLegajos = legajos.map(leg => ({ leg, norm: normNombreM(leg.nombre) }));
    const matchLegajo = (normName) => {
      let best = null, bestScore = 0;
      for (const { leg, norm } of normLegajos) {
        const ns = nameScoreM(norm, normName);
        if (ns > bestScore) { bestScore = ns; best = leg; }
      }
      // Requiere nombre COMPLETO (exacto=4, contención=2, o ≥2 palabras=1.5). Un solo
      // nombre de pila en común (score 0.8) NO alcanza: varios "Facundo …" se fusionaban mal.
      return bestScore >= 1.5 ? best : null;
    };

    const byKey = new Map();
    const matchedLegIds = new Set();

    // 1) Items de BIGG Eye → driver del roster. Una fila por coach × sede.
    for (const item of eyeItems) {
      const normCoach = normNombreM(item.coach_name);
      const sede = resolveSede(item.location_id, item.location_name);
      const leg  = matchLegajo(normCoach);
      let key, seed;
      if (leg) {
        matchedLegIds.add(leg.id);
        key  = `${leg.id}__${sede.id}`;
        seed = { _id: key, bucket: "match",
          legajo_id: leg.id, legajo_nombre: leg.nombre,
          sociedad_id: leg.sociedad_id ?? "", sociedad_nombre: leg.sociedad_nombre ?? "",
          sede_id: sede.id, sede_nombre: sede.nombre,
          rol: leg.rol || "COACH",
          // El sueldo base de Sedes solo aplica a roles de Sedes. Si quien dio la clase es
          // de otro ámbito (HQ, etc.), en Sedes cobra SOLO sus horas, no su sueldo.
          sueldo_base: ROLES_SEDES_ALL.includes(leg.rol) ? (Number(leg.sueldo_total) || 0) : 0 };
      } else {
        key  = `eye__${normCoach}__${sede.id}`;
        seed = { _id: key, bucket: "sin_legajo",
          legajo_nombre: item.coach_name, sede_id: sede.id, sede_nombre: sede.nombre, rol: "COACH" };
      }
      if (!byKey.has(key)) byKey.set(key, baseRow(seed));
      const row = byKey.get(key);
      // Guardo la línea cruda de Eye (clase × asistió × reg/fer/dom) para la grilla espejo.
      (row.horas_detalle ??= []).push({
        clase: item.clase || "BIGG CLASS", asistio: item.asistio || "Presentes",
        regulares: Number(item.regulares) || 0, feriado: Number(item.feriado) || 0, domingo: Number(item.domingo) || 0,
      });
      // Derivo los campos de pago desde lo CONFIRMADO (Presentes). Feriado/Domingo solo en BIGG CLASS;
      // YOGA/RUNNING = tarifa plana (todas sus horas a su balde). Los Ausentes quedan en el detalle
      // (editables/pagables aparte). Las liquidaciones guardadas pisan estos derivados en el merge (paso 3).
      if (item.asistio !== "Ausentes") {
        const reg = Number(item.regulares) || 0, fer = Number(item.feriado) || 0, dom = Number(item.domingo) || 0;
        const clase = (item.clase || "BIGG CLASS").toUpperCase();
        if (clase === "YOGA")         row.horas_yoga    += reg + fer + dom;
        else if (clase === "RUNNING") row.horas_running += reg + fer + dom;
        else { row.horas += reg; row.horas_feriados += fer; row.horas_domingos += dom; }
      }
    }

    // 2) Legajos activos de rol Sedes sin check-in → se siembran igual (0 horas).
    const rolesSedes = [...ROLES_COACHES, ...ROLES_FIJOS];
    for (const leg of legajos) {
      if (!rolesSedes.includes(leg.rol)) continue;
      if (matchedLegIds.has(leg.id))     continue;
      const sedeId = leg.sede_id ?? "";
      const key = `${leg.id}__${sedeId}`;
      if (byKey.has(key)) continue;
      byKey.set(key, baseRow({
        _id: key, bucket: "sin_checkin",
        legajo_id: leg.id, legajo_nombre: leg.nombre,
        sociedad_id: leg.sociedad_id ?? "", sociedad_nombre: leg.sociedad_nombre ?? "",
        sede_id: sedeId, sede_nombre: leg.sede_nombre ?? "",
        rol: leg.rol, sueldo_base: Number(leg.sueldo_total) || 0,
        revisar: ROLES_COACHES.includes(leg.rol),  // coach sin check-in = alerta
      }));
    }

    // 3) Merge con su_liquidaciones guardadas: pisan los defaults y conservan `id`.
    for (const saved of liqsSaved) {
      const key = saved.legajo_id
        ? `${saved.legajo_id}__${saved.sede_id ?? ""}`
        : `eye__${normNombreM(saved.legajo_nombre)}__${saved.sede_id ?? ""}`;
      const existing = byKey.get(key);
      if (existing) {
        byKey.set(key, { ...existing, ...saved, _id: key, bucket: existing.bucket, id: saved.id });
      } else {
        byKey.set(key, baseRow({ ...saved, _id: key, id: saved.id,
          bucket: saved.legajo_id ? "match" : "sin_legajo" }));
      }
    }

    return applyObjetivosToRows([...byKey.values()], objetivos);
  }, [eyeItems, legajos, liqsSaved, sedes, objetivos, mes, anio, pais]);

  // Snapshot de base salarial derivada (baseline del % aumento en Paso 1).
  useEffect(() => {
    originalRows.current = Object.fromEntries(rosterBase.map(r => [r._id, r.sueldo_base]));
  }, [rosterBase]);

  const rows = useMemo(() => {
    const overlay = (r) => ({ ...r, ...edits[r._id] });
    return [...rosterBase.map(overlay), ...manualRows.map(overlay)]
      .filter(r => !r._deleted);
  }, [rosterBase, manualRows, edits]);

  // Conciliación: contadores por bucket para el banner.
  const conc = useMemo(() => {
    let match = 0, sinCheckin = 0, sinLegajo = 0;
    for (const r of rows) {
      if (r.bucket === "sin_legajo")      sinLegajo++;
      else if (r.bucket === "sin_checkin") sinCheckin++;
      else                                 match++;
    }
    return { match, sinCheckin, sinLegajo };
  }, [rows]);

  // Paso 1: employees with a negotiated base salary (role-agnostic, covers other countries)
  const rowsFijos   = useMemo(() => rows.filter(r => Number(r.sueldo_base) > 0),       [rows]);
  // Coaches por rol + cualquier persona que vino de un check-in de Eye (bucket match/sin_legajo,
  // aunque su rol no sea coach: un Encargado/HQ con clases sueltas se liquida acá) + cualquier
  // fila con horas cargadas a mano. Usar el bucket evita que la fila desaparezca al editar
  // (p. ej. borrar Hs. Coach y dejar solo Feriados).
  const rowsCoaches = useMemo(() => rows.filter(r =>
    ROLES_COACHES.includes(r.rol) ||
    r.bucket === "match" || r.bucket === "sin_legajo" ||
    HORA_FIELDS.some(f => Number(r[f]) > 0)
  ), [rows]);

  // Novedades de Sedes indexadas por fila (legajo×sede). Una novedad lleva UNA sede →
  // matchea exactamente una fila, así una persona con varias sedes no la cuenta doble.
  const novsByRowKey = useMemo(() => {
    const m = {};
    for (const n of novedades) {
      const k = rowKeyDe(n.legajo_id, n.sede_id);
      (m[k] ??= []).push(n);
    }
    return m;
  }, [novedades]);

  // One entry per unique legajo (coaches may have multiple sede-rows).
  // Includes payment distribution fields (monto_haberes etc.) summed from all rows,
  // plus pagos/total_pagado/pendiente for the HQ-style PasoPagos table.
  const empls = useMemo(() => {
    // Index pagos by legajo_id once — O(pagos) — to avoid O(rows × pagos) filter per row.
    const pagosByLeg = {};
    for (const p of pagos) {
      if (!pagosByLeg[p.legajo_id]) pagosByLeg[p.legajo_id] = [];
      pagosByLeg[p.legajo_id].push(p);
    }

    const map = {};
    rows.forEach(r => {
      // Unmatched rows (sin_legajo) share legajo_id "" — group by _id so they don't
      // collapse into one phantom employee.
      const ek  = r.legajo_id || r._id;
      const tot = calcTotal(r);
      if (!map[ek]) {
        const leg         = legajos.find(l => l.id === r.legajo_id);
        const pagosMios   = pagosByLeg[r.legajo_id] ?? [];
        const totalPagado = pagosMios.reduce((s, p) => s + p.monto, 0);
        map[ek] = {
          legajo_id:           r.legajo_id,
          legajo_nombre:       r.legajo_nombre,
          rol:                 r.rol,
          sociedad_id:         r.sociedad_id,
          sociedad_nombre:     r.sociedad_nombre,
          sedes:               r.sede_nombre ? [r.sede_nombre] : [],
          cerrada:             isCerrada(r.estado),
          total:               tot,
          total_sueldo:        tot,   // sin novedades (base del split de forma de pago)
          total_nov:           0,
          novedades:           [],
          monto_haberes:       Number(r.monto_haberes)       || 0,
          monto_deposito:      Number(r.monto_deposito)      || 0,
          monto_transferencia: Number(r.monto_transferencia) || 0,
          blanco_neto:         leg?.blanco_neto || 0,
          cbu:                 leg?.cbu   || "",
          banco:               leg?.banco || "",
          pagos:               pagosMios,
          total_pagado:        totalPagado,
        };
      } else {
        map[ek].total               += tot;
        map[ek].total_sueldo        += tot;
        map[ek].monto_haberes       += Number(r.monto_haberes)       || 0;
        map[ek].monto_deposito      += Number(r.monto_deposito)      || 0;
        map[ek].monto_transferencia += Number(r.monto_transferencia) || 0;
        if (r.sede_nombre && !map[ek].sedes.includes(r.sede_nombre))
          map[ek].sedes.push(r.sede_nombre);
        if (isCerrada(r.estado)) map[ek].cerrada = true;
      }

      // Novedades de esta fila (extra que suma). Van al total/pendiente del empleado y al
      // bucket de su forma de pago (para que aparezcan como pagables en Paso 5). El split del
      // sueldo (total_sueldo) NO las incluye: se congelan como líneas tipo "novedad" aparte.
      const novsR = novsByRowKey[rowKeyDe(r.legajo_id, r.sede_id)];
      if (novsR?.length) {
        for (const n of novsR) {
          const monto = Number(n.monto) || 0;
          map[ek].total     += monto;
          map[ek].total_nov += monto;
          const b = NOV_FP_BUCKET[n.forma_pago] || "efectivo";
          if (b !== "efectivo") map[ek][`monto_${b}`] += monto;
        }
        map[ek].novedades.push(...novsR);
      }
    });
    const arr = Object.values(map)
      .map(e => {
        const efectivo  = Math.max(0, e.total - e.monto_haberes - e.monto_deposito - e.monto_transferencia);
        return { ...e, monto_efectivo: efectivo, pendiente: e.total - e.total_pagado };
      });
    return sortByRol(arr);
  }, [rows, legajos, pagos, calcTotal, novsByRowKey]);

  const totalMes = useMemo(() => empls.reduce((s, e) => s + e.total, 0), [empls]);

  // Al entrar a Forma de pago, sembrar la distribución faltante: lo ya guardado
  // (monto_haberes) o, si no, el neto en blanco del legajo. No pisa ediciones previas.
  useEffect(() => {
    if (paso !== 4) return;
    setPagoDraft(prev => {
      let changed = false;
      const next = { ...prev };
      for (const empl of empls) {
        if (next[empl.legajo_id]) continue;
        // El blanco (haberes registrados) solo aplica a roles de Sedes. Un empleado de HQ que dio
        // clases sueltas cobra ese trabajo acá (cae en efectivo), pero su blanco YA se paga en HQ
        // → no sembrarlo en Sedes o se duplica (su sociedad aparecería de más en el fondeo de banco).
        const esSedes = ROLES_SEDES_ALL.includes(empl.rol);
        next[empl.legajo_id] = {
          monto_haberes:       empl.monto_haberes       || (esSedes ? empl.blanco_neto : 0) || 0,
          monto_transferencia: empl.monto_transferencia || 0,  // = Monotributo
        };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [paso, empls]);

  const updateRow = useCallback((_id, key, val) =>
    setEdits(prev => ({ ...prev, [_id]: { ...(prev[_id] || {}), [key]: val } })), []);

  // CDP/one-shot desde BIGG Eye → overlay en edits. Map<rowKey, { q_cdp, q_one_shot }>
  const applyEyeCdp = useCallback((cdpMap) => {
    setEdits(prev => {
      const next = { ...prev };
      for (const [id, vals] of cdpMap) next[id] = { ...(next[id] || {}), ...vals };
      return next;
    });
  }, []);

  const removeRow = async (_id) => {
    const row = rows.find(r => r._id === _id);
    if (row?.id) {
      await deleteLiquidacionSede(row.id);
      setLiqsSaved(prev => prev.filter(r => r.id !== row.id));
    }
    if (manualRows.some(r => r._id === _id)) {
      setManualRows(prev => prev.filter(r => r._id !== _id));
      setEdits(prev => { const n = { ...prev }; delete n[_id]; return n; });
    } else {
      setEdits(prev => ({ ...prev, [_id]: { ...(prev[_id] || {}), _deleted: true } }));
    }
  };

  // Filas del roster ocultadas con removeRow (edits[_id]._deleted). El borrado persiste en el draft;
  // este contador + "Restaurar" las hace recuperables (limpia el flag, dejando el resto de los edits).
  const ocultas = useMemo(
    () => rosterBase.filter(r => edits[r._id]?._deleted).map(r => r.legajo_nombre),
    [rosterBase, edits]);
  const restaurarOcultas = () => setEdits(prev => {
    const n = {};
    for (const [k, v] of Object.entries(prev)) {
      if (v?._deleted) { const { _deleted, ...rest } = v; if (Object.keys(rest).length) n[k] = rest; }
      else n[k] = v;
    }
    return n;
  });

  const handleAddRow = () => {
    const leg  = legajos.find(l => l.id === addForm.legajo_id);
    const sede = sedes.find(s => s.id === addForm.sede_id);
    if (!leg) return;
    setManualRows(prev => [...prev, {
      _id:             `manual-${Date.now()}`,
      bucket:          "match",
      mes, anio, pais,
      legajo_id:       leg.id,
      legajo_nombre:   leg.nombre,
      sociedad_id:     leg.sociedad_id     ?? "",
      sociedad_nombre: leg.sociedad_nombre ?? "",
      sede_id:         sede?.id            ?? "",
      sede_nombre:     sede?.nombre        ?? "",
      rol:             leg.rol,
      horas: 0, horas_feriados: 0, horas_domingos: 0, horas_yoga: 0, horas_running: 0,
      q_cdp_coach: 0, q_cdp_front: 0, q_one_shot: 0, asignado: 0, c_grupo_pct: 0, redondeo: 0,
      sueldo_base: leg.sueldo_total ?? 0,
      monto_haberes: 0, monto_deposito: 0, monto_transferencia: 0, monto_efectivo: 0,
      estado: "borrador",
    }]);
    setAddForm({ legajo_id: "", sede_id: "" });
    setShowAddForm(false);
  };

  // Guardar borrador: upsert SECUENCIAL (GAS no soporta escrituras paralelas) de las filas
  // dirty — nuevas sin `id` o tocadas en `edits`. Luego recarga para refrescar `id`/estado.
  const handleGuardarBorrador = async () => {
    if (savingRef.current) return;
    const dirty = rows.filter(r => !r.id || edits[r._id]);
    if (!dirty.length) return;
    savingRef.current = true;
    setSaving(true);
    try {
      for (const r of dirty) {
        const { lineas } = lineasConceptoDeRow(r, "borrador");
        await saveLiquidacionLines(idLiqDe(r.legajo_id, mes, anio, r.sede_id), lineas);
      }
      await load(mes, anio, pais);
    } catch (e) {
      alert("Error al guardar borrador: " + e.message);
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  // ── Wizard handlers ──────────────────────────────────────────────────────────

  // Los pasos de cálculo avanzan EN MEMORIA; la durabilidad la cubre el autosave local
  // y el botón global "Guardar borrador". No se persiste por paso.
  async function handleConfirmarFijos() {
    if (savingRef.current) return;
    if (actualizarLegs) {
      savingRef.current = true;
      setSaving(true);
      try {
        // Secuencial: GAS pierde escrituras concurrentes (ver handleGuardarBorrador).
        for (const r of rowsFijos) {
          const baseOriginal = originalRows.current[r._id] ?? 0;
          if (!baseOriginal || r.sueldo_base <= baseOriginal) continue;
          // Solo el sueldo pactado (total). El blanco se gestiona aparte y NO se toca acá.
          await updateLegajo(r.legajo_id, { sueldo_total: r.sueldo_base });
        }
      } catch (e) {
        alert("Error al actualizar legajos: " + e.message);
      } finally {
        setSaving(false);
        savingRef.current = false;
      }
    }
    setPaso(2);
  }

  function handleConfirmarHoras() {
    setPaso(3);
  }

  function handleConfirmarIncentivos() {
    setPaso(4);
  }

  async function handleConfirmarFormaPago() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Cada fila (legajo×sede) = un id_liq. La forma de pago es por EMPLEADO; se prorratea
      // entre las sedes del empleado según el total de cada una (cada id_liq queda balanceado
      // y el devengado se imputa al centro de costo donde se ganó). Secuencial: GAS pierde
      // escrituras concurrentes.
      for (const r of rows) {
        const { lineas, total: rowTotal, header } = lineasConceptoDeRow(r, "cerrado");
        const empl      = empls.find(e => e.legajo_id === r.legajo_id);
        // El reparto de forma de pago es del SUELDO (total_sueldo), no de las novedades.
        const emplTotal = empl?.total_sueldo ?? rowTotal;
        const share     = emplTotal > 0 ? rowTotal / emplTotal : 0;
        const d    = pagoDraft[r.legajo_id] || {};
        const habRow   = Math.round((Number(d.monto_haberes)       || 0) * share);
        const monoRow  = Math.round((Number(d.monto_transferencia) || 0) * share);
        // Novedades de esta fila: las pagadas EN EFECTIVO entran al redondeo (la plata EN MANO debe quedar redonda).
        const novsR    = novsByRowKey[rowKeyDe(r.legajo_id, r.sede_id)] || [];
        const novEfectivo = novsR.reduce((s, n) => ((n.forma_pago || "efectivo") === "efectivo" ? s + (Number(n.monto) || 0) : s), 0);
        const eftExacto  = Math.max(0, rowTotal - habRow - monoRow);
        const cashExacto = eftExacto + novEfectivo;            // efectivo del sueldo + novedades en efectivo
        const redondeo   = Math.ceil(cashExacto / 100) * 100 - cashExacto;  // ajuste para que la plata en mano sea múltiplo de $100
        const eftRow     = eftExacto + redondeo;               // efectivo base + ajuste (sumado a las novedades en efectivo → redondo)
        const pagos = [];
        if (habRow > 0)  pagos.push(lineaLiq(header, { tipo: "pago", concepto: FP_TIPO_LABEL.haberes,     cuenta_contable: "Sueldos", forma_pago: "haberes",     sociedad_id: sociedadDeFormaPago("haberes", "", r.sociedad_id),     monto: habRow }));
        if (monoRow > 0) pagos.push(lineaLiq(header, { tipo: "pago", concepto: FP_TIPO_LABEL.monotributo, cuenta_contable: "Sueldos", forma_pago: "monotributo", sociedad_id: sociedadDeFormaPago("monotributo", "", r.sociedad_id), monto: monoRow }));
        if (eftRow > 0)  pagos.push(lineaLiq(header, { tipo: "pago", concepto: FP_TIPO_LABEL.efectivo,    cuenta_contable: "Sueldos", forma_pago: "efectivo",    sociedad_id: "beta",                                              monto: eftRow }));
        // Novedades de esta fila (extra): se congelan como líneas tipo "novedad", cada una con
        // SU cuenta contable y forma de pago. No entran en el reparto del sueldo de arriba.
        const novLineas = novsR.map(n => lineaLiq(header, {
          tipo: "novedad",
          concepto: n.descripcion || n.cuenta_contable_nombre || "Novedad",   // etiqueta visible (ej. "Feriado X Día")
          cuenta_contable: n.cuenta_contable_nombre || "Sueldos",              // cuenta contable (P&L)
          cuenta_contable_id: n.cuenta_contable_id || "",
          forma_pago: n.forma_pago || "efectivo",
          sociedad_id: sociedadDeFormaPago(n.forma_pago || "efectivo", "", r.sociedad_id),
          monto: Number(n.monto) || 0,
        }));
        // El redondeo del efectivo es un aumento de sueldo: se agrega como concepto (cuenta Sueldos)
        // para que Σconcepto = Σpago y el costo extra impacte en el resultado (P&L).
        const lineasFin = redondeo > 0
          ? [...lineas, lineaLiq(header, { tipo: "concepto", concepto: "Redondeo", cuenta_contable: "Sueldos", cantidad: 0, monto_unit: 0, monto: redondeo })]
          : lineas;
        await saveLiquidacionLines(idLiqDe(r.legajo_id, mes, anio, r.sede_id), [...lineasFin, ...pagos, ...novLineas]);
      }
      await load(mes, anio, pais);
      setPaso(5);
    } catch (e) {
      alert("Error al guardar: " + e.message);
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }

  const prevMes = () => {
    if (mes === 1) { setMes(12); setAnio(a => a - 1); } else setMes(m => m - 1);
  };
  const nextMes = () => {
    if (mes === 12) { setMes(1); setAnio(a => a + 1); } else setMes(m => m + 1);
  };

  if (loading) return (
    <div style={{ padding: 40, color: T.muted, fontFamily: T.font, fontSize: 13 }}>Cargando…</div>
  );

  // Match same criterion as rowsFijos: any legajo with a negotiated base salary
  const legajosFijos   = legajos.filter(l => Number(l.sueldo_total) > 0 || Number(l.blanco_neto) > 0);
  const legajosCoaches = legajos.filter(l => ROLES_COACHES.includes(l.rol));

  return (
    <div style={{ padding: 24, fontFamily: T.font, color: T.text }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Liquidación — Sedes</h2>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={prevMes}
            style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 5, padding: "4px 9px", cursor: "pointer", fontSize: 13, color: T.muted }}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 110, textAlign: "center" }}>{MESES[mes - 1]} {anio}</span>
          <button onClick={nextMes}
            style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 5, padding: "4px 9px", cursor: "pointer", fontSize: 13, color: T.muted }}>›</button>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {categorias.length === 0 && (
            <span style={{ fontSize: 12, color: T.yellow }}>⚠️ Sin tarifas — cargalas en Categorías</span>
          )}
          {ocultas.length > 0 && (
            <span style={{ fontSize: 11, color: T.muted, display: "flex", alignItems: "center", gap: 6 }}
              title={`Ocultas: ${ocultas.join(", ")}`}>
              🙈 {ocultas.length} {ocultas.length === 1 ? "fila oculta" : "filas ocultas"}
              <button onClick={restaurarOcultas}
                style={{ background: "none", border: "none", cursor: "pointer", color: T.blue, fontSize: 11, textDecoration: "underline", fontFamily: T.font }}>
                restaurar
              </button>
            </span>
          )}
          {draftSavedAt && (
            <span style={{ fontSize: 11, color: T.muted, display: "flex", alignItems: "center", gap: 6 }}>
              💾 borrador local
              <button onClick={discardDraft}
                style={{ background: "none", border: "none", cursor: "pointer", color: T.dim, fontSize: 11, textDecoration: "underline", fontFamily: T.font }}>
                descartar
              </button>
            </span>
          )}
          <button onClick={handleGuardarBorrador} disabled={saving || !rows.length}
            style={{ ...BTN_PRIMARY(saving || !rows.length), padding: "7px 14px" }}>
            {saving ? "Guardando…" : "💾 Guardar borrador"}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ border: `1px dashed ${T.border}`, borderRadius: 8, padding: 40, textAlign: "center", color: T.muted, fontSize: 13 }}>
          No hay actividad ni legajos de Sedes para {MESES[mes - 1]} {anio}. Verificá los check-ins de BIGG Eye y los legajos activos del país.
        </div>
      ) : (
        <>
          {paso <= 3 && <ConciliacionBanner conc={conc} />}

          <StepsIndicator paso={paso} onPaso={p => p < paso && setPaso(p)} />

          {paso === 1 && (
            <PasoFijos
              rowsFijos={rowsFijos}
              legajos={legajosFijos}
              sedes={sedes}
              originalRows={originalRows}
              updateRow={updateRow}
              removeRow={removeRow}
              showAddForm={showAddForm}
              setShowAddForm={setShowAddForm}
              addForm={addForm}
              setAddForm={setAddForm}
              handleAddRow={handleAddRow}
              actualizarLegs={actualizarLegs}
              onChangeActualizar={setActualizarLegs}
              onContinuar={() => setPaso(2)}
              onSiguiente={handleConfirmarFijos}
              saving={saving}
            />
          )}

          {paso === 2 && (
            <PasoHoras
              rowsCoaches={rowsCoaches}
              legajos={legajosCoaches}
              allLegajos={legajos}
              sedes={sedes}
              calcTotal={calcTotal}
              updateRow={updateRow}
              removeRow={removeRow}
              showAddForm={showAddForm}
              setShowAddForm={setShowAddForm}
              addForm={addForm}
              setAddForm={setAddForm}
              handleAddRow={handleAddRow}
              mes={mes}
              anio={anio}
              pais={pais}
              onResyncEye={setEyeItems}
              onAtras={() => setPaso(1)}
              onContinuar={() => setPaso(3)}
              onSiguiente={handleConfirmarHoras}
              saving={saving}
            />
          )}

          {paso === 3 && (
            <PasoIncentivos
              rows={rows}
              legajos={legajos}
              sedes={sedes}
              mes={mes}
              anio={anio}
              pais={pais}
              updateRow={updateRow}
              removeRow={removeRow}
              showAddForm={showAddForm}
              setShowAddForm={setShowAddForm}
              addForm={addForm}
              setAddForm={setAddForm}
              handleAddRow={handleAddRow}
              onApplyEyeCdp={applyEyeCdp}
              onAtras={() => setPaso(2)}
              onContinuar={() => setPaso(4)}
              onSiguiente={handleConfirmarIncentivos}
              saving={saving}
            />
          )}

          {paso === 4 && (
            <PasoFormaPago
              empls={empls}
              pagoDraft={pagoDraft}
              onChangePago={(legajo_id, field, val) =>
                setPagoDraft(d => ({ ...d, [legajo_id]: { ...(d[legajo_id] || {}), [field]: val } }))
              }
              onAtras={() => setPaso(3)}
              onContinuar={() => setPaso(5)}
              onSiguiente={handleConfirmarFormaPago}
              saving={saving}
            />
          )}

          {paso === 5 && (
            <PasoPagos
              empls={empls}
              mes={mes}
              anio={anio}
              onAtras={() => setPaso(4)}
              onRegistrarPago={setShowPago}
              onBatchPaid={() => load(mes, anio, pais)}
            />
          )}
        </>
      )}

      {showPago && (() => {
        const empl = empls.find(e => e.legajo_id === showPago);
        if (!empl) return null;
        return (
          <ModalPagoSede
            mes={mes} anio={anio}
            liq={empl}
            onClose={() => setShowPago(null)}
            onSaved={async () => { setShowPago(null); await load(mes, anio, pais); }}
          />
        );
      })()}
    </div>
  );
}

// ── Banner de conciliación (BIGG Eye × legajos) ────────────────────────────────

function ConciliacionBanner({ conc }) {
  const items = [
    { n: conc.match,      label: "con actividad",            color: T.green,  bg: "#f0fdf4", bd: "#86efac" },
    { n: conc.sinCheckin, label: "en nómina sin check-in",   color: "#92400e", bg: "#fffbeb", bd: "#fde68a" },
    { n: conc.sinLegajo,  label: "check-in sin legajo",      color: T.yellow, bg: "#fefce8", bd: "#fde68a" },
  ];
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
      {items.map(({ n, label, color, bg, bd }) => (
        <div key={label} style={{
          flex: "1 1 0", minWidth: 150, background: bg, border: `1px solid ${bd}`,
          borderRadius: 8, padding: "8px 12px",
        }}>
          <span style={{ fontSize: 18, fontWeight: 700, color }}>{n}</span>
          <span style={{ fontSize: 12, color: T.muted, marginLeft: 6 }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Color de fila según bucket de conciliación ─────────────────────────────────
function bucketBg(row, fallback) {
  if (row.bucket === "sin_legajo")  return "#fef9c3";  // amarillo: check-in sin legajo
  if (row.bucket === "sin_checkin" && row.revisar) return "#ffedd5";  // naranja: coach en nómina sin check-in
  return fallback;
}

// ── Indicador de pasos ─────────────────────────────────────────────────────────

function StepsIndicator({ paso, onPaso }) {
  const steps = [
    { n: 1, label: "Sueldos fijos" },
    { n: 2, label: "Horas" },
    { n: 3, label: "Incentivos" },
    { n: 4, label: "Forma de pago" },
    { n: 5, label: "Registrar pagos" },
  ];
  return (
    <div style={{ display: "flex", marginBottom: 24, borderRadius: 8, overflow: "hidden", border: `1px solid ${T.border}` }}>
      {steps.map((s, i) => (
        <button key={s.n} onClick={() => onPaso(s.n)}
          style={{
            flex: 1, padding: "10px 0", border: "none",
            borderRight: i < steps.length - 1 ? `1px solid ${T.border}` : "none",
            cursor: s.n < paso ? "pointer" : "default",
            background: s.n === paso ? T.blue : s.n < paso ? "#eff6ff" : T.bg,
            color: s.n === paso ? "#fff" : s.n < paso ? "#1d4ed8" : T.dim,
            fontWeight: 600, fontSize: 12, fontFamily: T.font,
          }}>
          {s.n}. {s.label}
        </button>
      ))}
    </div>
  );
}

// ── Paso 1: Sueldos fijos (Front Desk + Limpieza) ─────────────────────────────

function PasoFijos({ rowsFijos, legajos, sedes, originalRows, updateRow, removeRow,
  showAddForm, setShowAddForm, addForm, setAddForm, handleAddRow,
  actualizarLegs, onChangeActualizar, onContinuar, onSiguiente, saving }) {

  const [pctGlobal, setPctGlobal] = useState("");
  const [pctRaw,    setPctRaw]    = useState({});  // { [_id]: "5" } — solo display del input %

  const [sortKey, setSortKey] = useState(null);   // null = orden por rol
  const [sortDir, setSortDir] = useState("asc");

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const sortedFijos = useMemo(
    () => (sortKey ? sortRows(rowsFijos, sortKey, sortDir) : sortByRol(rowsFijos)),
    [rowsFijos, sortKey, sortDir]
  );

  const thSort = (key, label, extra = {}) => (
    <th key={key} style={{ ...TH(extra), cursor: "pointer", userSelect: "none" }}
      onClick={() => toggleSort(key)}>
      {label}{sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );

  const baseOf = (r) => originalRows.current[r._id] ?? r.sueldo_base;

  // Edición en vivo (como HQ): el % o el monto escriben sueldo_base directo en el overlay.
  const handlePct = (r, rawPct) => {
    setPctRaw(p => ({ ...p, [r._id]: rawPct }));
    const base  = baseOf(r);
    const nuevo = rawPct !== "" ? Math.round(base * (1 + parseFloat(rawPct) / 100)) : base;
    updateRow(r._id, "sueldo_base", nuevo);
  };
  const handleNuevo = (r, rawVal) => {
    setPctRaw(p => ({ ...p, [r._id]: "" }));
    const clean = rawVal.replace(/\./g, "").replace(/,/g, ".");
    updateRow(r._id, "sueldo_base", parseFloat(clean) || 0);
  };
  const handlePctGlobal = (rawPct) => {
    setPctGlobal(rawPct);
    rowsFijos.forEach(r => handlePct(r, rawPct));
  };

  const totalActual = rowsFijos.reduce((s, r) => s + baseOf(r), 0);
  const totalNuevo  = rowsFijos.reduce((s, r) => s + (Number(r.sueldo_base) || 0), 0);
  const diff        = totalNuevo - totalActual;

  return (
    <div>
      {/* Resumen de totales */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Sueldos actuales", value: totalActual, color: T.text },
          { label: "Sueldos nuevos",   value: totalNuevo,  color: T.blue },
          { label: "Diferencia",       value: diff,        color: diff > 0 ? T.green : diff < 0 ? T.red : T.muted, prefix: diff > 0 ? "+" : "" },
        ].map(({ label, value, color, prefix = "" }) => (
          <div key={label} style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color }}>{prefix}{fmtMoney(value)}</div>
          </div>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.bg }}>
              {thSort("legajo_nombre", "Nombre",       { minWidth: 140 })}
              {thSort("rol",          "Rol",           { minWidth: 80 })}
              {thSort("sede_nombre",  "Centro de costo",{ minWidth: 110 })}
              <th style={TH({ width: 100, textAlign: "right" })}>Sueldo M-1</th>
              {thSort("sueldo_base",  "Sueldo actual", { width: 110, textAlign: "right" })}
              <th style={TH({ width: 60, textAlign: "right" })} title="Variación M-1 vs sueldo actual">↑ %</th>
              <th style={TH({ width: 90, textAlign: "right", borderLeft: `1px solid ${T.border}` })}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                  <span title="Aumento en %">↑ %</span>
                  <input
                    type="number" value={pctGlobal}
                    onChange={e => handlePctGlobal(e.target.value)}
                    placeholder="todos" title="Aplicar % a todos"
                    style={{ ...iStyle, width: 48, fontSize: 11, padding: "2px 5px", border: "1px solid #6366f1" }}
                  />
                </div>
              </th>
              <th style={TH({ width: 100, textAlign: "right" })} title="Aumento en $">↑ $</th>
              <th style={TH({ width: 120, textAlign: "right" })}>Nuevo sueldo</th>
              <th style={TH({ width: 32 })}></th>
            </tr>
          </thead>
          <tbody>
            {sortedFijos.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: "24px 10px", textAlign: "center", color: T.dim, fontSize: 12 }}>
                  Sin empleados de sueldo fijo. Agregá filas abajo.
                </td>
              </tr>
            ) : sortedFijos.map((row, i) => {
              const base    = baseOf(row);
              const nuevo   = Number(row.sueldo_base) || 0;
              const aumento = nuevo - base;
              const subio   = nuevo > base;
              const pctDer  = base ? Math.round((nuevo / base - 1) * 100 * 10) / 10 : 0;
              const pct     = pctRaw[row._id] ?? (pctDer ? String(pctDer) : "");
              const sueldoM1 = 0;   // placeholder hasta leer la liquidación cerrada de M-1
              const pctM1    = sueldoM1 ? (base - sueldoM1) / sueldoM1 * 100 : null;
              return (
                <tr key={row._id} style={{ background: bucketBg(row, i % 2 === 0 ? T.card : T.bg), borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ padding: "5px 8px", fontWeight: 600 }}>{row.legajo_nombre}</td>
                  <td style={{ padding: "5px 8px", color: T.muted, fontSize: 11 }}>{row.rol}</td>
                  <td style={{ padding: "5px 8px", color: T.muted }}>{row.sede_nombre || "—"}</td>
                  <td style={{ padding: "5px 8px", textAlign: "right", color: T.dim }}>{fmtMoney(sueldoM1)}</td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700, color: T.blue }}>
                    {fmtMoney(base)}
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontSize: 11, color: pctM1 == null ? T.dim : pctM1 > 0 ? T.green : pctM1 < 0 ? T.red : T.dim }}>
                    {pctM1 == null ? "—" : `${pctM1 > 0 ? "↑" : pctM1 < 0 ? "↓" : ""} ${Math.abs(pctM1).toFixed(1)}%`}
                  </td>
                  <td style={{ padding: "4px 6px", borderLeft: `1px solid ${T.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 3, justifyContent: "flex-end" }}>
                      <input type="number" value={pct} placeholder="0"
                        onChange={e => handlePct(row, e.target.value)}
                        style={{ ...iStyle, width: 52 }} />
                      <span style={{ color: T.muted, fontSize: 11 }}>%</span>
                    </div>
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right", color: aumento > 0 ? T.green : aumento < 0 ? T.red : T.dim }}>
                    {aumento ? (aumento > 0 ? "+" : "") + fmtMoney(aumento) : "—"}
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                      <input type="text"
                        value={nuevo ? Math.round(nuevo).toLocaleString("es-AR") : ""}
                        onChange={e => handleNuevo(row, e.target.value)}
                        style={{ ...iStyle, width: 96, fontWeight: 700, color: subio ? T.green : T.text }}
                      />
                      {subio && <span style={{ color: T.green, fontSize: 12 }}>↑</span>}
                    </div>
                  </td>
                  <td style={{ padding: "4px", textAlign: "center" }}>
                    <button onClick={() => removeRow(row._id)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: T.dim, fontSize: 12, padding: 2 }}>🗑</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AddRowForm
        show={showAddForm} setShow={setShowAddForm}
        legajos={legajos} sedes={sedes}
        addForm={addForm} setAddForm={setAddForm}
        handleAddRow={handleAddRow} label="empleado"
      />

      <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 12, padding: "16px 0", borderTop: `1px solid ${T.border}`, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", flexGrow: 1 }}>
          <input type="checkbox" checked={actualizarLegs} onChange={e => onChangeActualizar(e.target.checked)} />
          Actualizar base en legajos
        </label>
        <button onClick={onContinuar} style={BTN_SECONDARY}>Continuar →</button>
        <button onClick={onSiguiente} disabled={saving} style={BTN_PRIMARY(saving)}>
          {saving ? "Guardando…" : "Guardar y continuar →"}
        </button>
      </div>
    </div>
  );
}

// ── Paso 2: Horas (solo coaches) ──────────────────────────────────────────────

function PasoHoras({ rowsCoaches, legajos, allLegajos, sedes, calcTotal, updateRow, removeRow,
  showAddForm, setShowAddForm, addForm, setAddForm, handleAddRow,
  mes, anio, pais, onResyncEye,
  onAtras, onContinuar, onSiguiente, saving }) {

  // Tipos de check-in que bajan de BIGG Eye (por ahora solo "horas" se autocompleta;
  // el resto se carga a mano hasta que Eye los discrimine).
  const HORA_COLS = [
    { field: "horas",          label: "Hs. Coach", w: 80 },
    { field: "horas_feriados", label: "Feriados",   w: 80 },
    { field: "horas_domingos", label: "Domingos",   w: 80 },
    { field: "horas_yoga",     label: "Yoga",       w: 70 },
    { field: "horas_running",  label: "Running",    w: 75 },
  ];

  const [sortKey,    setSortKey]    = useState("sede_nombre");
  const [sortDir,    setSortDir]    = useState("asc");
  const [openDet,    setOpenDet]    = useState(null);   // _id del coach con el detalle de Eye abierto
  const [eyeLoading, setEyeLoading] = useState(false);
  const [eyeResult,  setEyeResult]  = useState(null);
  // { items: N, matched: N, eyeOnly: [coach_name, ...] }

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };
  const sortedRows = useMemo(() => sortRows(rowsCoaches, sortKey, sortDir), [rowsCoaches, sortKey, sortDir]);

  const thSort = (key, label, extra = {}) => (
    <th key={key} style={{ ...TH(extra), cursor: "pointer", userSelect: "none" }}
      onClick={() => toggleSort(key)}>
      {label}{sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );

  // Re-sincronizar: vuelve a traer las horas de BIGG Eye y re-deriva el roster
  // (horas + filas sin legajo). El cruce vive en `rosterBase`, no acá.
  const handleCargarEye = async () => {
    setEyeLoading(true);
    setEyeResult(null);
    try {
      const eyeIds = sedes.filter(s => s.bigg_eye_id).map(s => s.bigg_eye_id);
      const eyeData = await fetchHorasDesdeEye(mes, anio, pais, eyeIds);
      const items = eyeData.items ?? [];
      onResyncEye(items);

      const matchLeg = (normName) => {
        let best = 0;
        for (const leg of (allLegajos ?? [])) {
          const ns = nameScoreM(normNombreM(leg.nombre), normName);
          if (ns > best) best = ns;
        }
        return best >= 0.8;
      };
      let matched = 0;
      const eyeOnly = new Set();
      for (const it of items) {
        if (matchLeg(normNombreM(it.coach_name))) matched++;
        else eyeOnly.add(it.coach_name);
      }
      setEyeResult({ items: items.length, matched, eyeOnly: [...eyeOnly] });
    } catch (e) {
      alert("Error al cargar desde BIGG Eye: " + e.message);
    } finally {
      setEyeLoading(false);
    }
  };

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: T.muted, flexGrow: 1 }}>
          {rowsCoaches.length} coach{rowsCoaches.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={handleCargarEye}
          disabled={eyeLoading}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: eyeLoading ? T.bg : "#eff6ff",
            border: `1px solid #93c5fd`, borderRadius: 7,
            padding: "7px 14px", fontSize: 12, fontWeight: 600,
            cursor: eyeLoading ? "not-allowed" : "pointer",
            color: "#2563eb", fontFamily: T.font,
          }}>
          {eyeLoading ? "⏳ Cargando…" : "🔄 Re-sincronizar BIGG Eye"}
        </button>
      </div>

      {/* BIGG Eye result summary */}
      {eyeResult && (
        <div style={{
          background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8,
          padding: "10px 14px", marginBottom: 12, fontSize: 12,
        }}>
          <strong style={{ color: T.green }}>
            ✓ BIGG Eye: {eyeResult.items} check-in{eyeResult.items !== 1 ? "s" : ""}
            {" · "}{eyeResult.matched} con legajo
          </strong>
          {eyeResult.eyeOnly?.length > 0 && (
            <div style={{ marginTop: 6, color: "#92400e" }}>
              <strong>Sin legajo ({eyeResult.eyeOnly.length}):</strong>{" "}
              {eyeResult.eyeOnly.join(", ")} — verificá que tengan legajo creado
            </div>
          )}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.bg }}>
              {thSort("legajo_nombre", "Nombre", { minWidth: 140 })}
              {thSort("rol",          "Rol",    { minWidth: 100 })}
              {thSort("sede_nombre",  "Sede",   { minWidth: 110 })}
              {HORA_COLS.map(c => (
                <th key={c.field} style={TH({ width: c.w, textAlign: "right" })}>{c.label}</th>
              ))}
              <th style={TH({ width: 32 })}></th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={4 + HORA_COLS.length} style={{ padding: "24px 10px", textAlign: "center", color: T.dim, fontSize: 12 }}>
                  Sin coaches para este mes. Agregá filas abajo.
                </td>
              </tr>
            ) : sortedRows.map((row, i) => {
                const det = row.horas_detalle || [];
                const abierto = openDet === row._id;
                return (
                <Fragment key={row._id}>
                <tr style={{ background: bucketBg(row, i % 2 === 0 ? T.card : T.bg), borderBottom: det.length && abierto ? "none" : `1px solid ${T.border}` }}>
                  <td style={{ padding: "5px 8px", fontWeight: 600, cursor: det.length ? "pointer" : "default" }}
                    onClick={() => det.length && setOpenDet(abierto ? null : row._id)}
                    title={det.length ? "Ver detalle de BIGG Eye por clase" : undefined}>
                    {det.length > 0 && <span style={{ color: T.dim, marginRight: 5, fontSize: 10 }}>{abierto ? "▾" : "▸"}</span>}
                    {row.legajo_nombre}
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <select
                      value={row.rol}
                      onChange={e => updateRow(row._id, "rol", e.target.value)}
                      style={{ fontSize: 11, fontFamily: T.font, border: `1px solid ${T.border}`,
                        borderRadius: 4, padding: "2px 4px", background: T.card, color: T.text,
                        width: "100%", cursor: "pointer" }}>
                      {ROLES_COACHES.map(r => (
                        <option key={r} value={r}>{ROL_CONCEPTO[r] ?? r}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: "5px 8px", color: T.muted }}>{row.sede_nombre || "—"}</td>
                  {HORA_COLS.map(c => (
                    <td key={c.field} style={{ padding: "4px 6px" }}>
                      <input style={iStyle} value={row[c.field] || ""} placeholder="0"
                        onChange={e => updateRow(row._id, c.field, e.target.value)} />
                    </td>
                  ))}
                  <td style={{ padding: "4px", textAlign: "center" }}>
                    <button onClick={() => removeRow(row._id)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: T.dim, fontSize: 12, padding: 2 }}>🗑</button>
                  </td>
                </tr>
                {/* Detalle BIGG Eye por clase × asistió (espejo del reporte; los Ausentes NO suman a las columnas) */}
                {abierto && det.map((l, di) => {
                  const pres = l.asistio !== "Ausentes";
                  return (
                    <tr key={row._id + "-d" + di} style={{ background: pres ? "#f8fafc" : "#fffbeb",
                      borderBottom: di === det.length - 1 ? `1px solid ${T.border}` : "none", fontSize: 11 }}>
                      <td style={{ padding: "3px 8px 3px 24px", color: T.muted }} colSpan={3}>
                        <span style={{ fontWeight: 600, color: T.text }}>{l.clase}</span>
                        <span style={{ marginLeft: 8, padding: "1px 6px", borderRadius: 4, fontSize: 9.5, fontWeight: 700,
                          color: pres ? "#16a34a" : "#b45309", background: pres ? "#dcfce7" : "#fef3c7" }}>
                          {pres ? "Presentes" : "Ausentes · pendiente check-in"}
                        </span>
                      </td>
                      <td style={{ padding: "3px 6px", textAlign: "right", color: pres ? T.text : "#b45309" }} title="Regulares">{l.regulares || 0}</td>
                      <td style={{ padding: "3px 6px", textAlign: "right", color: pres ? T.text : "#b45309" }} title="Feriado">{l.feriado || 0}</td>
                      <td style={{ padding: "3px 6px", textAlign: "right", color: pres ? T.text : "#b45309" }} title="Domingo">{l.domingo || 0}</td>
                      <td colSpan={3} />
                    </tr>
                  );
                })}
                </Fragment>
                );
              })}
          </tbody>
        </table>
      </div>

      <AddRowForm
        show={showAddForm} setShow={setShowAddForm}
        legajos={legajos} sedes={sedes}
        addForm={addForm} setAddForm={setAddForm}
        handleAddRow={handleAddRow} label="coach"
      />

      <div style={{ marginTop: 24, display: "flex", gap: 12, padding: "16px 0", borderTop: `1px solid ${T.border}` }}>
        <button onClick={onAtras} style={BTN_SECONDARY}>← Atrás</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={onContinuar} style={BTN_SECONDARY}>Continuar →</button>
          <button onClick={onSiguiente} disabled={saving} style={BTN_PRIMARY(saving)}>
            {saving ? "Guardando…" : "Guardar y continuar →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Paso 3: Incentivos y comisiones (todos los empleados) ─────────────────────

function PasoIncentivos({ rows, legajos, sedes, mes, anio, pais, updateRow, removeRow,
  showAddForm, setShowAddForm, addForm, setAddForm, handleAddRow,
  onApplyEyeCdp, onAtras, onContinuar, onSiguiente, saving }) {

  const [sortKey,    setSortKey]    = useState(null);   // null = orden por rol
  const [sortDir,    setSortDir]    = useState("asc");
  const [cdpLoading, setCdpLoading] = useState(false);
  const [cdpResult,  setCdpResult]  = useState(null);
  // { updated: N, _source }

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const sortedRows = useMemo(() => {
    if (!sortKey) return sortByRol(rows);
    return sortRows(rows, sortKey, sortDir);
  }, [rows, sortKey, sortDir]);

  const thSort = (key, label, extra = {}) => (
    <th key={key} style={{ ...TH(extra), cursor: "pointer", userSelect: "none" }}
      onClick={() => toggleSort(key)}>
      {label}{sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );

  const dash = <span style={{ display: "block", textAlign: "right", color: T.dim }}>—</span>;
  const inp  = (row, field) => (
    <input style={iStyle} value={row[field] || ""} placeholder="0"
      onChange={e => updateRow(row._id, field, e.target.value)} />
  );

  const handleCargarCdp = async () => {
    setCdpLoading(true);
    setCdpResult(null);
    try {
      const eyeIds = sedes.filter(s => s.bigg_eye_id).map(s => s.bigg_eye_id);
      const cdpData = await fetchCdpDesdeEye(mes, anio, pais, eyeIds);
      const items = cdpData.items ?? [];

      const cdpMap = new Map();   // row._id → { q_cdp, q_one_shot }
      let updated = 0;

      for (const item of items) {
        const normCoach = normNombreM(item.coach_name);

        // Primero: resolver location_id exacto → sede interna (igual que horas handler)
        const matchedSede = sedes.find(s => s.bigg_eye_id === item.location_id);
        if (!matchedSede) continue;  // item de sede desconocida, ignorar

        // Buscar la fila que mejor matchea: solo dentro de la misma sede (sin fuzzy de location)
        let bestRow = null, bestScore = 0;
        for (const row of rows) {
          if (row.sede_id !== matchedSede.id) continue;  // filtro estricto por sede
          const ns = nameScoreM(normNombreM(row.legajo_nombre), normCoach);
          if (ns === 0) continue;
          if (ns > bestScore) { bestScore = ns; bestRow = row; }
        }

        if (bestRow && bestScore >= 1.5) {
          // Split coach/front. Cache viejo solo trae cdp_count (mergeado): se asigna por
          // el rol de la fila (coach → coach, resto → front) hasta regenerar el cache.
          let cCoach = item.cdp_coach, cFront = item.cdp_front;
          if (cCoach == null && cFront == null) {
            const merged = item.cdp_count ?? 0;
            if (ROLES_COACHES.includes(bestRow.rol)) { cCoach = merged; cFront = 0; }
            else { cCoach = 0; cFront = merged; }
          }
          const prev = cdpMap.get(bestRow._id) ?? { q_cdp_coach: 0, q_cdp_front: 0, q_one_shot: 0 };
          cdpMap.set(bestRow._id, {
            q_cdp_coach: prev.q_cdp_coach + (cCoach ?? 0),
            q_cdp_front: prev.q_cdp_front + (cFront ?? 0),
            q_one_shot:  prev.q_one_shot  + (item.one_shot_count ?? 0),
          });
          updated++;
        }
      }

      onApplyEyeCdp(cdpMap);
      setCdpResult({ updated, total: items.length, _source: cdpData._source });
    } catch (e) {
      alert("Error al cargar CDP desde BIGG Eye: " + e.message);
    } finally {
      setCdpLoading(false);
    }
  };

  return (
    <div>
      {/* Toolbar BIGG Eye */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: T.muted, flexGrow: 1 }}>
          {rows.length} empleado{rows.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={handleCargarCdp}
          disabled={cdpLoading}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: cdpLoading ? T.bg : "#eff6ff",
            border: `1px solid #93c5fd`, borderRadius: 7,
            padding: "7px 14px", fontSize: 12, fontWeight: 600,
            cursor: cdpLoading ? "not-allowed" : "pointer",
            color: "#2563eb", fontFamily: T.font,
          }}>
          {cdpLoading ? "⏳ Cargando…" : "📥 Cargar CDP desde BIGG Eye"}
        </button>
      </div>

      {cdpResult && (
        <div style={{
          background: cdpResult.updated > 0 ? "#f0fdf4" : "#fefce8",
          border: `1px solid ${cdpResult.updated > 0 ? "#86efac" : "#fde68a"}`,
          borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12,
        }}>
          <strong style={{ color: cdpResult.updated > 0 ? T.green : T.yellow }}>
            {cdpResult.updated > 0
              ? `✓ ${cdpResult.updated} fila${cdpResult.updated !== 1 ? "s" : ""} actualizadas con datos de CDP`
              : "Sin datos de CDP disponibles para este mes"}
          </strong>
          {cdpResult._source && (
            <span style={{ color: T.muted, marginLeft: 8 }}>({cdpResult._source})</span>
          )}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.bg }}>
              {thSort("legajo_nombre", "Nombre",  { minWidth: 140 })}
              <th style={TH({ minWidth: 90 })}>Rol</th>
              {thSort("sede_nombre",  "Sede",     { minWidth: 110 })}
              <th style={TH({ width: 90, textAlign: "right" })}>Asignado $</th>
              <th style={TH({ width: 80, textAlign: "right" })}>C. Grupo %</th>
              <th style={TH({ width: 70, textAlign: "right", borderLeft: `1px solid ${T.border}` })}>CDP coach (u)</th>
              <th style={TH({ width: 70, textAlign: "right" })}>CDP front (u)</th>
              <th style={TH({ width: 70, textAlign: "right" })}>One-Shot (u)</th>
              <th style={TH({ width: 32 })}></th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: "24px 10px", textAlign: "center", color: T.dim, fontSize: 12 }}>
                  Sin empleados para este mes.
                </td>
              </tr>
            ) : sortedRows.map((row, i) => {
              const isLimp      = row.rol === "LIMPIEZA";
              const canCdp      = !isLimp;   // todos menos limpieza
              return (
                <tr key={row._id} style={{ background: bucketBg(row, i % 2 === 0 ? T.card : T.bg), borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ padding: "5px 8px", fontWeight: 600 }}>{row.legajo_nombre}</td>
                  <td style={{ padding: "5px 8px", color: T.muted, fontSize: 11 }}>
                    {ROL_CONCEPTO[row.rol] ?? row.rol}
                  </td>
                  <td style={{ padding: "5px 8px", color: T.muted }}>{row.sede_nombre || "—"}</td>
                  <td style={{ padding: "4px 6px" }}>
                    {!isLimp ? inp(row, "asignado") : dash}
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    {!isLimp ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                        <input style={{ ...iStyle, width: 44 }} value={row.c_grupo_pct || ""} placeholder="0"
                          onChange={e => updateRow(row._id, "c_grupo_pct", e.target.value)} />
                        <span style={{ fontSize: 10, color: T.muted }}>%</span>
                      </div>
                    ) : dash}
                  </td>
                  <td style={{ padding: "4px 6px", borderLeft: `1px solid ${T.border}` }}>
                    {canCdp ? inp(row, "q_cdp_coach") : dash}
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    {canCdp ? inp(row, "q_cdp_front") : dash}
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    {!isLimp ? inp(row, "q_one_shot") : dash}
                  </td>
                  <td style={{ padding: "4px", textAlign: "center" }}>
                    <button onClick={() => removeRow(row._id)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: T.dim, fontSize: 12, padding: 2 }}>🗑</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AddRowForm
        show={showAddForm} setShow={setShowAddForm}
        legajos={legajos} sedes={sedes}
        addForm={addForm} setAddForm={setAddForm}
        handleAddRow={handleAddRow} label="empleado"
      />

      <div style={{ marginTop: 24, display: "flex", gap: 12, padding: "16px 0", borderTop: `1px solid ${T.border}` }}>
        <button onClick={onAtras} style={BTN_SECONDARY}>← Atrás</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={onContinuar} style={BTN_SECONDARY}>Continuar →</button>
          <button onClick={onSiguiente} disabled={saving} style={BTN_PRIMARY(saving)}>
            {saving ? "Guardando…" : "Guardar y continuar →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Paso 4: Forma de pago ──────────────────────────────────────────────────────

function PasoFormaPago({ empls, pagoDraft, onChangePago, onAtras, onContinuar, onSiguiente, saving }) {
  const MON = (extra = {}) => ({
    border: `1px solid #cbd5e1`, borderRadius: 4, padding: "4px 8px",
    fontSize: 12, fontFamily: T.font, background: "#fff", color: T.text,
    textAlign: "right", width: 90, boxSizing: "border-box", ...extra,
  });

  // Stats del split en vivo (lo que se está repartiendo en esta pantalla).
  const stats = useMemo(() => statsDesdePagoDraft(empls, pagoDraft), [empls, pagoDraft]);

  return (
    <div>
      {/* Necesidades por forma de pago: cuánto hay que tener en banco y en efectivo. */}
      <FondeoBand stats={stats} />

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.bg }}>
              <th style={TH({ minWidth: 160 })}>Empleado</th>
              <th style={TH({ minWidth: 80 })}>Rol</th>
              <th style={TH({ minWidth: 90 })}>Sedes</th>
              <th style={TH({ width: 110, textAlign: "right" })}>Total</th>
              <th style={TH({ width: 100, textAlign: "right" })}>Haberes</th>
              <th style={TH({ width: 100, textAlign: "right" })}>Monotributo</th>
              <th style={TH({ width: 100, textAlign: "right" })}>Efectivo</th>
            </tr>
          </thead>
          <tbody>
            {empls.map((empl, i) => {
              const d    = pagoDraft[empl.legajo_id] || {};
              const hab  = Number(d.monto_haberes)       || 0;
              // "Monotributo" se persiste en la columna monto_transferencia (factura monotributo).
              const mono = Number(d.monto_transferencia) || 0;
              // Haberes/Monotributo son el reparto del SUELDO (inputs). El Efectivo es el remanente
              // del TOTAL (incluye las novedades): así las 3 columnas suman el total mostrado y la
              // novedad (que se paga en su forma, normalmente efectivo) no queda fuera del reparto.
              const eft  = Math.max(0, Math.ceil((empl.total - hab - mono) / 100) * 100);  // efectivo en mano → redondeado SIEMPRE hacia arriba a $100
              const sobra = hab + mono > empl.total;
              const nov  = empl.total_nov || 0;
              return (
                <tr key={empl.legajo_id} style={{ background: i % 2 === 0 ? T.card : T.bg, borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ padding: "5px 8px", fontWeight: 600 }}>
                    {empl.legajo_nombre}
                    {empl.cerrada && <span title="Liquidación cerrada" style={{ marginLeft: 6, fontSize: 11, color: T.green }}>🔒</span>}
                  </td>
                  <td style={{ padding: "5px 8px", color: T.muted }}>{empl.rol}</td>
                  <td style={{ padding: "5px 8px", color: T.muted, fontSize: 11 }}>{empl.sedes.join(", ") || "—"}</td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700 }}
                    title={nov > 0 ? `Incluye ${fmtMoney(nov)} de novedades` : undefined}>
                    {fmtMoney(empl.total)}
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    <input style={MON()} value={d.monto_haberes ?? ""} placeholder="0"
                      onChange={e => onChangePago(empl.legajo_id, "monto_haberes", parseFloat(e.target.value) || 0)} />
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>
                    <input style={MON()} value={d.monto_transferencia ?? ""} placeholder="0"
                      onChange={e => onChangePago(empl.legajo_id, "monto_transferencia", parseFloat(e.target.value) || 0)} />
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700,
                    color: sobra ? T.red : T.muted }}>
                    {sobra
                      ? `⚠ ${fmtMoney(hab + mono - empl.total)} de más`
                      : fmtMoney(eft)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 24, display: "flex", gap: 12, padding: "16px 0", borderTop: `1px solid ${T.border}` }}>
        <button onClick={onAtras} style={BTN_SECONDARY}>← Atrás</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={onContinuar} style={BTN_SECONDARY}>Continuar →</button>
          <button onClick={onSiguiente} disabled={saving} style={BTN_PRIMARY(saving)}>
            {saving ? "Guardando…" : "Guardar y continuar →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Paso 5: Registrar pagos ────────────────────────────────────────────────────

// ── Helpers de exportación Excel (formato Galicia Office) ─────────────────────

const GALICIA_HEADERS = [
  "CBU/CVU/Alias/Nro cuenta            ",
  "Monto", "Concepto",
  "Descripción\r\n(opcional)",
  "Email destinatario\r\n(opcional)",
  "Mensaje del email\r\n(opcional)",
];

function descargarExcelGalicia(filas, nombreArchivo) {
  const ws = XLSX.utils.aoa_to_sheet([GALICIA_HEADERS, ...filas]);
  ws["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 32 }, { wch: 14 }, { wch: 24 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Formulario");
  XLSX.writeFile(wb, nombreArchivo);
}

function exportarHaberes(empls, mes, anio) {
  const desc = `Sueldo ${String(mes).padStart(2, "0")}/${anio}`.slice(0, 12);
  const filas = empls
    .filter(e => (e.monto_haberes || 0) > 0 && e.cbu)
    .map(e => [e.cbu, e.monto_haberes, "acreditamiento de haberes", desc, "", ""]);
  if (!filas.length) { alert("No hay empleados con Haberes y CBU cargado."); return; }
  descargarExcelGalicia(filas, `Haberes_Sedes_${String(mes).padStart(2,"0")}_${anio}.xlsx`);
}

// ── Helpers de pago ───────────────────────────────────────────────────────────

// Sedes paga 3 componentes; reusa los labels/colores compartidos con HQ.
// "monotributo" se persiste en el balde escalar monto_transferencia (igual que HQ).
const TIPOS_PAGO = ["haberes", "monotributo", "efectivo"].map(id => ({
  id, label: FP_TIPO_LABEL[id], color: FP_TIPO_COLOR[id],
}));

function getMontoTipo(empl, tipo) {
  if (tipo === "haberes")     return empl.monto_haberes       || 0;
  if (tipo === "monotributo") return empl.monto_transferencia || 0;
  return empl.monto_efectivo || 0;
}

function getPagosTipo(empl, tipo) {
  return empl.pagos?.filter(p => p.tipo_componente === tipo) ?? [];
}

function isPaid(empl, tipo) {
  return getPagosTipo(empl, tipo).length > 0;
}

// Stats por forma de pago a partir del split en vivo (pagoDraft) — para Paso 4, donde el
// reparto se está editando y aún no se guardó. Efectivo = remanente del total, redondeado a $100.
function statsDesdePagoDraft(empls, pagoDraft) {
  const s = { haberes: { total: 0, pagado: 0 }, monotributo: { total: 0, pagado: 0 }, efectivo: { total: 0, pagado: 0 }, bancoPorSociedad: {} };
  for (const empl of empls) {
    const d    = pagoDraft[empl.legajo_id] || {};
    const hab  = Number(d.monto_haberes)       || 0;
    const mono = Number(d.monto_transferencia) || 0;
    const eft  = Math.max(0, Math.ceil((empl.total - hab - mono) / 100) * 100);
    s.haberes.total     += hab;
    s.monotributo.total += mono;
    s.efectivo.total    += eft;
    // Plata de banco (haberes + monotributo) por sociedad: cada una se acredita desde su propia
    // cuenta (Hektor, Segui Fit, etc.), así que el fondeo se necesita discriminado por sociedad.
    const banco = hab + mono;
    if (banco > 0) {
      const soc = empl.sociedad_nombre || "Sin sociedad";
      s.bancoPorSociedad[soc] = (s.bancoPorSociedad[soc] || 0) + banco;
    }
    for (const p of empl.pagos || []) {
      if (s[p.tipo_componente]) s[p.tipo_componente].pagado += Number(p.monto) || 0;
    }
  }
  return s;
}

// Banda "Total a pagar / Pagado / Pendiente" desglosada por forma de pago. `stats` = { tipo: {total, pagado} }.
function ResumenPagosBand({ stats }) {
  const grand = TIPOS_PAGO.reduce((a, { id }) => {
    a.total += stats[id]?.total || 0; a.pagado += stats[id]?.pagado || 0; return a;
  }, { total: 0, pagado: 0 });
  const pend = grand.total - grand.pagado;
  const cols = [
    { label: "Total a pagar", grand: grand.total,  color: T.text,  valor: id => stats[id].total },
    { label: "Pagado",        grand: grand.pagado, color: T.green, valor: id => stats[id].pagado },
    { label: "Pendiente",     grand: pend,         color: pend > 0 ? T.red : T.green, valor: id => stats[id].total - stats[id].pagado },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 }}>
      {cols.map(({ label, grand, color, valor }) => (
        <div key={label} style={{ background: "#fff", border: `1px solid ${T.border}`, borderTop: `3px solid ${color}`, borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>{label}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color, marginBottom: 8 }}>{fmtMoney(grand)}</div>
          {TIPOS_PAGO.filter(({ id }) => stats[id]?.total > 0).map(({ id, label: l }) => {
            const v = valor(id);
            return (
              <div key={id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.muted, marginBottom: 2 }}>
                <span>{l}</span>
                <span style={{ color: v ? color : T.dim, fontWeight: 600 }}>{fmtMoney(v)}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Banda de fondeo: a dónde va la plata. Banco = Haberes + Monotributo (acreditación/transferencia);
// Efectivo = en mano. (Sedes no usa "financiera".) `stats` = { tipo: {total} }.
function FondeoBand({ stats }) {
  const eft = stats.efectivo?.total || 0;
  // Banco discriminado por sociedad (cada una acredita desde su cuenta).
  const bancoRows  = Object.entries(stats.bancoPorSociedad || {}).sort((a, b) => b[1] - a[1]);
  const bancoTotal = bancoRows.reduce((s, [, v]) => s + v, 0);
  const cards = [
    { titulo: "Banco",    sub: "Lo que tiene que haber en el banco, por sociedad", color: FP_TIPO_COLOR.haberes || T.blue, rows: bancoRows.length ? bancoRows : [["—", 0]], total: bancoTotal },
    { titulo: "Efectivo", sub: "Lo que necesito en efectivo",                       color: FP_TIPO_COLOR.efectivo || T.text, rows: [["Efectivo", eft]],                        total: eft },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 16 }}>
      {cards.map(card => (
        <div key={card.titulo} style={{ background: "#fff", border: `1px solid ${T.border}`, borderTop: `3px solid ${card.color}`, borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{card.titulo}</div>
          <div style={{ fontSize: 10, color: T.muted, marginBottom: 8 }}>{card.sub}</div>
          {card.rows.map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.muted, marginBottom: 2 }}>
              <span>{l}</span><span style={{ color: T.text, fontWeight: 600 }}>{fmtMoney(v)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: `1px solid ${T.border}`, marginTop: "auto", paddingTop: 6 }}>
            <span style={{ color: T.muted, fontSize: 11, fontWeight: 600 }}>Total</span>
            <span style={{ color: card.color, fontSize: 16, fontWeight: 700 }}>{fmtMoney(card.total)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Componente PasoPagos ──────────────────────────────────────────────────────

function PasoPagos({ empls, mes, anio, onAtras, onRegistrarPago, onBatchPaid }) {
  const [batchModal,  setBatchModal]  = useState(null);
  const [anularModal, setAnularModal] = useState(null);

  // pendientesMap: unpaid employees per tipo. hayAlgoMap: any employee has this tipo (paid or not).
  const { pendientesMap, hayAlgoMap, tipoStats } = useMemo(() => {
    const pending = {};
    const hayAlgo = {};
    const stats   = {};
    for (const { id } of TIPOS_PAGO) {
      pending[id] = empls.filter(e => getMontoTipo(e, id) > 0 && !isPaid(e, id));
      hayAlgo[id] = empls.some(e => getMontoTipo(e, id) > 0);
      stats[id]   = { total: 0, pagado: 0 };
    }
    for (const e of empls) {
      for (const { id } of TIPOS_PAGO) stats[id].total += getMontoTipo(e, id);
      for (const p of e.pagos || []) {
        if (stats[p.tipo_componente]) stats[p.tipo_componente].pagado += Number(p.monto) || 0;
      }
    }
    return { pendientesMap: pending, hayAlgoMap: hayAlgo, tipoStats: stats };
  }, [empls]);

  return (
    <div>
      {/* Totales y pendientes por forma de pago. */}
      <ResumenPagosBand stats={tipoStats} />

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 8 }}>
          <thead>
            <tr>
              <th style={TH()}>Nombre</th>
              <th style={TH({ fontSize: 11, color: T.dim })}>Sedes</th>
              <th style={TH({ textAlign: "right" })}>Total</th>
              {TIPOS_PAGO.map(({ id, label }) => {
                const pend       = pendientesMap[id];
                const hayAlgo    = hayAlgoMap[id];
                const todoPagado = hayAlgo && pend.length === 0;
                return (
                  <th key={id} style={TH({ textAlign: "right" })}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                      {label}
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20 }}>
                        {todoPagado
                          ? <span title="Todos pagados" style={{ fontSize: 11, color: T.green, fontWeight: 700 }}>✓</span>
                          : hayAlgo
                            ? <button
                                onClick={() => setBatchModal({ tipo: id })}
                                title={`Confirmar pago de ${label}`}
                                style={{ background: T.green, color: "#fff", border: "none", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 700, cursor: "pointer", lineHeight: "1.6", fontFamily: T.font }}>✓</button>
                            : null
                        }
                      </span>
                    </div>
                  </th>
                );
              })}
              <th style={TH({ textAlign: "right" })}>Pagado</th>
              <th style={TH({ textAlign: "right" })}>Pendiente</th>
              <th style={TH()}></th>
            </tr>
          </thead>
          <tbody>
            {empls.map((empl, i) => (
              <tr key={empl.legajo_id} style={{ background: i % 2 === 0 ? "#fff" : T.bg }}>
                <td style={TD({ fontWeight: 600 })}>
                  <div>
                    {empl.legajo_nombre}
                    {empl.cerrada && <span title="Liquidación cerrada" style={{ marginLeft: 6, fontSize: 11, color: T.green }}>🔒</span>}
                  </div>
                  {empl.cbu && <div style={{ fontSize: 10, color: T.dim }}>CBU: {empl.cbu}</div>}
                </td>
                <td style={TD({ fontSize: 11, color: T.dim })}>{empl.sedes.join(", ") || "—"}</td>
                <td style={TD({ textAlign: "right", fontWeight: 700, color: T.blue })}>{fmtMoney(empl.total)}</td>

                {TIPOS_PAGO.map(({ id, color }) => {
                  const monto = getMontoTipo(empl, id);
                  const pagos = getPagosTipo(empl, id);
                  const dup   = pagos.length > 1;
                  if (!monto) return (
                    <td key={id} style={TD({ textAlign: "right" })}>
                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
                        <span style={{ color: T.dim }}>—</span>
                        <span style={{ width: 20 }} />
                      </div>
                    </td>
                  );
                  const totalPagadoTipo = pagos.reduce((s, p) => s + p.monto, 0);
                  return (
                    <td key={id} style={TD({ textAlign: "right", color: dup ? T.red : pagos.length ? T.green : color })}>
                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
                        {dup ? fmtMoney(totalPagadoTipo) : fmtMoney(monto)}
                        <span style={{ display: "inline-flex", justifyContent: "center", width: 20, fontSize: 11, fontWeight: 700 }}>
                          {pagos[0]
                            ? <button
                                onClick={() => setAnularModal(pagos[0])}
                                title={dup ? `⚠️ ${pagos.length} pagos — total ${fmtMoney(totalPagadoTipo)} (esperado ${fmtMoney(monto)})` : "Ver / anular este pago"}
                                style={{ background: "none", border: "none", cursor: "pointer", color: dup ? T.red : T.green, fontSize: 12, fontWeight: 700, padding: 0, lineHeight: 1 }}>
                                {dup ? `×${pagos.length}` : "✓"}
                              </button>
                            : ""
                          }
                        </span>
                      </div>
                    </td>
                  );
                })}

                <td style={TD({ textAlign: "right", color: T.green })}>{fmtMoney(empl.total_pagado)}</td>
                <td style={TD({ textAlign: "right", fontWeight: 600, color: empl.pendiente > 0 ? T.red : T.green })}>
                  {fmtMoney(empl.pendiente)}
                </td>
                <td style={TD({ whiteSpace: "nowrap" })}>
                  {empl.pendiente > 0
                    ? <button onClick={() => onRegistrarPago(empl.legajo_id)} style={{
                        background: "#fff", color: T.green, border: `1px solid ${T.green}`,
                        borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}>💳 Pagar</button>
                    : <span style={{ fontSize: 12, color: T.green, fontWeight: 600 }}>✓</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "16px 0", borderTop: `1px solid ${T.border}`, marginTop: 8 }}>
        <button style={BTN_EXPORT("#16a34a")} onClick={() => exportarHaberes(empls, mes, anio)}>
          📥 Excel Haberes (banco)
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={onAtras} style={BTN_SECONDARY}>← Atrás</button>
      </div>

      {batchModal && (
        <ModalBatchPago
          tipo={batchModal.tipo}
          empls={pendientesMap[batchModal.tipo]}
          mes={mes} anio={anio}
          onClose={() => setBatchModal(null)}
          onSaved={() => { setBatchModal(null); onBatchPaid?.(); }}
        />
      )}

      {anularModal && (
        <ModalAnularPago
          pago={anularModal}
          onClose={() => setAnularModal(null)}
          onAnulado={() => { setAnularModal(null); onBatchPaid?.(); }}
        />
      )}
    </div>
  );
}

// ── Modal batch pago ──────────────────────────────────────────────────────────

function ModalBatchPago({ tipo, empls, mes, anio, onClose, onSaved }) {
  const meta    = TIPOS_PAGO.find(t => t.id === tipo);
  const socFija = tipo === "efectivo" ? "beta" : null;
  // Haberes/monotributo: pre-cargar la sociedad del legajo si todos coinciden; editable.
  const socDefault = socFija ?? (() => {
    const socs = [...new Set(empls.map(e => e.sociedad_id).filter(Boolean))];
    return socs.length === 1 ? socs[0] : "";
  })();

  const [form, setForm] = useState({
    fecha:       new Date().toISOString().slice(0, 10),
    sociedad_id: socDefault,
    cuenta_id:   "",
  });
  const [sociedades,  setSociedades]  = useState([]);
  const [cuentas,     setCuentas]     = useState([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [selec, setSelec] = useState(() => new Set(empls.map(e => e.legajo_id)));
  const [saving,   setSaving]   = useState(false);
  const savingRef = useRef(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    Promise.all([fetchSociedadesNumbers(), fetchCuentasBancariasNumbers()])
      .then(([socs, ctas]) => { setSociedades(socs); setCuentas(ctas); })
      .finally(() => setLoadingMeta(false));
  }, []);

  const cuentasFiltradas = useMemo(() => {
    if (!form.sociedad_id)  return cuentas;
    return cuentas.filter(c => c.sociedad === form.sociedad_id);
  }, [cuentas, form.sociedad_id]);

  // En Haberes cada legajo cobra de SU sociedad (Hektor / Segui Fit / …). Se paga una sociedad por
  // vez: elegida la sociedad, se filtran los empleados de esa sociedad y las cuentas de esa sociedad.
  const emplsVisibles = useMemo(() =>
    (tipo === "haberes" && form.sociedad_id)
      ? empls.filter(e => e.sociedad_id === form.sociedad_id)
      : empls,
    [empls, tipo, form.sociedad_id]);
  const emplsSelec = useMemo(() => emplsVisibles.filter(e => selec.has(e.legajo_id)), [emplsVisibles, selec]);
  const total      = emplsSelec.reduce((s, e) => s + getMontoTipo(e, tipo), 0);

  const toggleSelec = (id) => setSelec(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleSave = async () => {
    if (savingRef.current) return;
    if (mostrarSociedad && !form.sociedad_id) { alert("Elegí la sociedad (se paga una por vez; cada legajo cobra de la suya)."); return; }
    if (!emplsSelec.length) { alert("Seleccioná al menos un empleado."); return; }
    if (!form.cuenta_id) { alert("Seleccioná una cuenta bancaria."); return; }
    savingRef.current = true; setSaving(true);
    try {
      const ctaNombre = cuentas.find(c => c.id === form.cuenta_id)?.nombre ?? form.cuenta_id;
      const socNombre = sociedades.find(s => s.id === form.sociedad_id)?.nombre ?? form.sociedad_id;
      const lote_pago = nuevoLote();   // un lote por tanda → Conciliación matchea el débito contra su total
      for (const empl of emplsSelec) {
        const soc_id     = tipo === "haberes" ? empl.sociedad_id     : (form.sociedad_id || "beta");
        const soc_nombre = tipo === "haberes" ? empl.sociedad_nombre : socNombre;
        await appendPago({
          mes, anio, lote_pago,
          legajo_id:              empl.legajo_id,
          legajo_nombre:          empl.legajo_nombre,
          sociedad_id:            soc_id,
          sociedad_nombre:        soc_nombre,
          tipo_componente:        tipo,
          monto:                  getMontoTipo(empl, tipo),
          fecha:                  form.fecha,
          cuenta_bancaria_id:     form.cuenta_id,
          cuenta_bancaria_nombre: ctaNombre,
          cuenta_contable_id:     "CUENTA_Sueldos",   // movimiento de Tesorería → cuenta Sueldos (no "Sin clasificar")
          cuenta_contable_nombre: "Sueldos",
          ambito:                 "sedes",
        });
      }
      await onSaved();
    } catch (e) {
      alert("Error: " + e.message);
      setSaving(false);
    } finally {
      savingRef.current = false;
    }
  };

  const mostrarSociedad = tipo !== "efectivo";   // haberes + monotributo eligen sociedad (la cuenta es de esa sociedad)

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 440, boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: T.font, maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>
          Confirmar pago — {meta?.label}
        </h3>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: T.muted }}>
          {emplsSelec.length} empleado{emplsSelec.length !== 1 ? "s" : ""} · Total <strong>{fmtMoney(total)}</strong>
        </p>

        {/* Lista con checkboxes */}
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, marginBottom: 16, maxHeight: 180, overflowY: "auto" }}>
          {emplsVisibles.map((empl, i) => {
            const checked = selec.has(empl.legajo_id);
            return (
              <label key={empl.legajo_id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "7px 10px", cursor: "pointer", fontSize: 13,
                borderBottom: i < emplsVisibles.length - 1 ? `1px solid ${T.border}` : "none",
                background: checked ? "#f0fdf4" : "#fff",
              }}>
                <input type="checkbox" checked={checked} onChange={() => toggleSelec(empl.legajo_id)}
                  style={{ accentColor: T.green, width: 14, height: 14, cursor: "pointer" }} />
                <span style={{ flex: 1, color: T.text }}>{empl.legajo_nombre}</span>
                <span style={{ fontWeight: 700, color: checked ? (meta?.color || T.text) : T.dim }}>
                  {fmtMoney(getMontoTipo(empl, tipo))}
                </span>
              </label>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <ModalLabel>Fecha</ModalLabel>
            <input style={MODAL_INPUT} type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} />
          </div>

          {mostrarSociedad && (
            <div>
              <ModalLabel>{tipo === "haberes" ? "Sociedad (se paga una por vez)" : "Sociedad que transfiere"}</ModalLabel>
              <select style={MODAL_INPUT} value={form.sociedad_id} onChange={e => { set("sociedad_id", e.target.value); set("cuenta_id", ""); }}>
                <option value="">— Seleccioná —</option>
                {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          )}

          {socFija && (
            <div style={{ fontSize: 12, color: T.muted, background: T.bg, borderRadius: 5, padding: "6px 10px" }}>
              Sociedad: <strong style={{ color: T.text }}>Beta</strong>
            </div>
          )}

          <div>
            <ModalLabel>{tipo === "efectivo" ? "Caja" : "Cuenta bancaria"}</ModalLabel>
            {loadingMeta
              ? <div style={{ fontSize: 12, color: T.muted }}>Cargando cuentas…</div>
              : <select style={MODAL_INPUT} value={form.cuenta_id} onChange={e => set("cuenta_id", e.target.value)}>
                  <option value="">— Seleccioná —</option>
                  {cuentasFiltradas.map(c => (
                    <option key={c.id} value={c.id}>{ctaLabel(c, sociedades)}</option>
                  ))}
                </select>
            }
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={BTN_SECONDARY}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !emplsSelec.length} style={{
            background: (saving || !emplsSelec.length) ? T.dim : T.green, color: "#fff", border: "none",
            borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600,
            cursor: (saving || !emplsSelec.length) ? "not-allowed" : "pointer",
          }}>
            {saving ? "Procesando…" : `Confirmar ${emplsSelec.length} pago${emplsSelec.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal anular / editar pago ────────────────────────────────────────────────

function PagoDetailRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${T.border}`, fontSize: 13 }}>
      <span style={{ color: T.muted }}>{label}</span>
      <span style={{ fontWeight: 600, color: T.text }}>{value}</span>
    </div>
  );
}

function ModalAnularPago({ pago, onClose, onAnulado }) {
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({
    monto:       pago.monto,
    fecha:       (pago.fecha ?? "").slice(0, 10),
    cuenta_id:   pago.cuenta_bancaria_id ?? "",
    sociedad_id: "",
  });
  const [cuentas,     setCuentas]     = useState([]);
  const [sociedades,  setSociedades]  = useState([]);
  const [loadingCtas, setLoadingCtas] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const savingRef = useRef(false);
  const set  = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const meta = TIPOS_PAGO.find(t => t.id === pago.tipo_componente);

  const handleStartEdit = () => {
    setLoadingCtas(true);
    Promise.all([fetchSociedadesNumbers(), fetchCuentasBancariasNumbers()])
      .then(([socs, ctas]) => { setSociedades(socs); setCuentas(ctas); })
      .finally(() => setLoadingCtas(false));
    setEditMode(true);
  };

  const socFiltro = pago.tipo_componente === "haberes" ? pago.sociedad_id
    : esTransferencia(pago.tipo_componente)            ? form.sociedad_id
    : "beta";
  const cuentasFiltradas = socFiltro ? cuentas.filter(c => c.sociedad === socFiltro) : [];

  const handleAnular = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      await deletePago(pago.id, pago.nb_movimiento_id);
      await onAnulado();
    } catch (e) { alert("Error: " + e.message); setSaving(false); } finally { savingRef.current = false; }
  };

  const handleGuardar = async () => {
    if (savingRef.current) return;
    if (!form.monto)    { alert("Completá el monto."); return; }
    if (!form.cuenta_id){ alert("Seleccioná una cuenta."); return; }
    savingRef.current = true; setSaving(true);
    try {
      const cta = cuentas.find(c => c.id === form.cuenta_id);
      await deletePago(pago.id, pago.nb_movimiento_id);
      await appendPago({
        mes:                    pago.mes,
        anio:                   pago.anio,
        lote_pago:              nuevoLote(),
        legajo_id:              pago.legajo_id,
        legajo_nombre:          pago.legajo_nombre,
        sociedad_id:            pago.tipo_componente === "haberes" ? pago.sociedad_id : (form.sociedad_id || "beta"),
        sociedad_nombre:        pago.tipo_componente === "haberes" ? pago.sociedad_nombre : (sociedades.find(s => s.id === (form.sociedad_id || "beta"))?.nombre ?? "Beta"),
        tipo_componente:        pago.tipo_componente,
        monto:                  parseFloat(form.monto) || 0,
        fecha:                  form.fecha,
        cuenta_bancaria_id:     form.cuenta_id,
        cuenta_bancaria_nombre: cta?.nombre ?? "",
        cuenta_contable_id:     "CUENTA_Sueldos",
        cuenta_contable_nombre: "Sueldos",
        ambito:                 pago.ambito || "sedes",
      });
      await onAnulado();
    } catch (e) { alert("Error: " + e.message); setSaving(false); } finally { savingRef.current = false; }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: T.font }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>
          {editMode ? "Editar pago" : "Pago registrado"} — {pago.legajo_nombre}
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: T.muted }}>
          {editMode ? "Los cambios reemplazan el pago y el movimiento en Tesorería." : `${meta?.label ?? pago.tipo_componente}`}
        </p>

        {!editMode ? (
          <>
            <div style={{ marginBottom: 20 }}>
              <PagoDetailRow label="Tipo"   value={meta?.label ?? pago.tipo_componente} />
              <PagoDetailRow label="Monto"  value={fmtMoney(pago.monto)} />
              <PagoDetailRow label="Fecha"  value={(pago.fecha ?? "").slice(0, 10)} />
              <PagoDetailRow label="Cuenta" value={pago.cuenta_bancaria_nombre || "—"} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={BTN_SECONDARY}>Cerrar</button>
              <button onClick={handleStartEdit} style={{ ...BTN_SECONDARY, borderColor: T.blue, color: T.blue }}>✏️ Editar</button>
              <button onClick={handleAnular} disabled={saving} style={{
                background: saving ? T.dim : T.red, color: "#fff", border: "none",
                borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
              }}>
                {saving ? "Anulando…" : "Anular"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <ModalLabel>Monto (ARS)</ModalLabel>
                <input style={MODAL_INPUT} type="number" value={form.monto} onChange={e => set("monto", e.target.value)} />
              </div>
              <div>
                <ModalLabel>Fecha</ModalLabel>
                <input style={MODAL_INPUT} type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} />
              </div>
              {esTransferencia(pago.tipo_componente) && (
                <div>
                  <ModalLabel>Sociedad que transfiere</ModalLabel>
                  <select style={MODAL_INPUT} value={form.sociedad_id}
                    onChange={e => setForm(f => ({ ...f, sociedad_id: e.target.value, cuenta_id: "" }))}>
                    <option value="">— Seleccioná —</option>
                    {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
              )}
              {pago.tipo_componente === "efectivo" && (
                <div style={{ fontSize: 12, color: T.muted, background: T.bg, borderRadius: 5, padding: "6px 10px" }}>
                  Sociedad: <strong style={{ color: T.text }}>Beta</strong>
                </div>
              )}
              <div>
                <ModalLabel>{pago.tipo_componente === "efectivo" ? "Caja" : "Cuenta bancaria"}</ModalLabel>
                {loadingCtas
                  ? <div style={{ fontSize: 12, color: T.muted }}>Cargando…</div>
                  : <select style={MODAL_INPUT} value={form.cuenta_id} onChange={e => set("cuenta_id", e.target.value)}
                      disabled={esTransferencia(pago.tipo_componente) && !form.sociedad_id}>
                      <option value="">— Seleccioná —</option>
                      {cuentasFiltradas.map(c => (
                        <option key={c.id} value={c.id}>{ctaLabel(c, sociedades)}</option>
                      ))}
                    </select>
                }
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button onClick={() => setEditMode(false)} style={BTN_SECONDARY}>Cancelar</button>
              <button onClick={handleGuardar} disabled={saving} style={{
                background: saving ? T.dim : T.blue, color: "#fff", border: "none",
                borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
              }}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Modal pago individual ─────────────────────────────────────────────────────

function ModalPagoSede({ mes, anio, liq, onClose, onSaved }) {
  const [form, setForm] = useState({
    tipo_componente: "haberes",
    monto:           liq?.monto_haberes || liq?.total || "",
    fecha:           new Date().toISOString().slice(0, 10),
    sociedad_id:     "",
    cuenta_id:       "",
  });
  const [cuentas,     setCuentas]     = useState([]);
  const [sociedades,  setSociedades]  = useState([]);
  const [loadingCtas, setLoadingCtas] = useState(true);
  const [saving,      setSaving]      = useState(false);
  const savingRef = useRef(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    Promise.all([fetchSociedadesNumbers(), fetchCuentasBancariasNumbers()])
      .then(([socs, ctas]) => { setSociedades(socs); setCuentas(ctas); })
      .finally(() => setLoadingCtas(false));
  }, []);

  const socFiltro = useMemo(() => {
    if (form.tipo_componente === "haberes")  return liq?.sociedad_id ?? "";
    if (form.tipo_componente === "efectivo") return "beta";
    return form.sociedad_id;  // monotributo: la elige el usuario
  }, [form.tipo_componente, form.sociedad_id, liq?.sociedad_id]);

  const cuentasFiltradas = useMemo(() =>
    socFiltro ? cuentas.filter(c => c.sociedad === socFiltro) : [],
  [cuentas, socFiltro]);

  const handleTipo = (tipo) => {
    const montos = {
      haberes:     liq?.monto_haberes       || "",
      monotributo: liq?.monto_transferencia || "",
      efectivo:    liq?.monto_efectivo      || "",
    };
    setForm(f => ({ ...f, tipo_componente: tipo, cuenta_id: "", sociedad_id: "", ...(montos[tipo] ? { monto: montos[tipo] } : {}) }));
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!form.monto)    { alert("Completá el monto."); return; }
    if (!form.cuenta_id){ alert("Seleccioná una cuenta bancaria."); return; }
    savingRef.current = true; setSaving(true);
    try {
      const cta = cuentas.find(c => c.id === form.cuenta_id);
      await appendPago({
        mes, anio,
        lote_pago:              nuevoLote(),
        legajo_id:              liq.legajo_id,
        legajo_nombre:          liq.legajo_nombre,
        sociedad_id:            liq.sociedad_id,
        sociedad_nombre:        liq.sociedad_nombre,
        tipo_componente:        form.tipo_componente,
        monto:                  parseFloat(form.monto) || 0,
        fecha:                  form.fecha,
        cuenta_bancaria_id:     form.cuenta_id,
        cuenta_bancaria_nombre: cta?.nombre ?? "",
        cuenta_contable_id:     "CUENTA_Sueldos",
        cuenta_contable_nombre: "Sueldos",
        ambito:                 "sedes",
      });
      await onSaved();
    } catch (e) { alert("Error: " + e.message); setSaving(false); } finally { savingRef.current = false; }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: T.font }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>Registrar pago — {liq?.legajo_nombre}</h3>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: T.muted }}>Pendiente: {fmtMoney(liq?.pendiente)}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <ModalLabel>Componente</ModalLabel>
            <select style={MODAL_INPUT} value={form.tipo_componente} onChange={e => handleTipo(e.target.value)}>
              <option value="haberes">Haberes (recibo de sueldo)</option>
              <option value="monotributo">Monotributo (factura)</option>
              <option value="efectivo">Efectivo</option>
            </select>
          </div>
          <div>
            <ModalLabel>Monto (ARS)</ModalLabel>
            <input style={MODAL_INPUT} type="number" value={form.monto} onChange={e => set("monto", e.target.value)} />
          </div>
          <div>
            <ModalLabel>Fecha</ModalLabel>
            <input style={MODAL_INPUT} type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} />
          </div>
          {esTransferencia(form.tipo_componente) && (
            <div>
              <ModalLabel>Sociedad que transfiere</ModalLabel>
              <select style={MODAL_INPUT} value={form.sociedad_id}
                onChange={e => setForm(f => ({ ...f, sociedad_id: e.target.value, cuenta_id: "" }))}>
                <option value="">— Seleccioná —</option>
                {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          )}
          {form.tipo_componente === "efectivo" && (
            <div style={{ fontSize: 12, color: T.muted, background: T.bg, borderRadius: 5, padding: "6px 10px" }}>
              Sociedad: <strong style={{ color: T.text }}>Beta</strong>
            </div>
          )}
          <div>
            <ModalLabel>{form.tipo_componente === "efectivo" ? "Caja" : "Cuenta bancaria"}</ModalLabel>
            {loadingCtas
              ? <div style={{ fontSize: 12, color: T.muted }}>Cargando…</div>
              : <select style={MODAL_INPUT} value={form.cuenta_id} onChange={e => set("cuenta_id", e.target.value)}
                  disabled={esTransferencia(form.tipo_componente) && !form.sociedad_id}>
                  <option value="">— Seleccioná —</option>
                  {cuentasFiltradas.map(c => (
                    <option key={c.id} value={c.id}>{ctaLabel(c, sociedades)}</option>
                  ))}
                </select>
            }
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={BTN_SECONDARY}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{
            background: saving ? T.dim : T.green, color: "#fff", border: "none",
            borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
          }}>
            {saving ? "Procesando…" : "Registrar y enviar a Tesorería"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Formulario agregar fila ────────────────────────────────────────────────────

function AddRowForm({ show, setShow, legajos, sedes, addForm, setAddForm, handleAddRow, label }) {
  const selStyle = {
    border: `1px solid ${T.border}`, borderRadius: 5, padding: "5px 8px",
    fontSize: 12, fontFamily: T.font, color: T.text,
  };

  if (!show) {
    return (
      <button onClick={() => setShow(true)}
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: T.blue, fontFamily: T.font, padding: "10px 0 0" }}>
        + Agregar {label}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
      background: "#eff6ff", padding: "10px 12px", borderRadius: 8, marginTop: 10 }}>
      <select value={addForm.legajo_id} onChange={e => setAddForm(f => ({ ...f, legajo_id: e.target.value }))} style={selStyle}>
        <option value="">— Seleccionar {label} —</option>
        {legajos.map(l => <option key={l.id} value={l.id}>{l.nombre} ({l.rol})</option>)}
      </select>
      <select value={addForm.sede_id} onChange={e => setAddForm(f => ({ ...f, sede_id: e.target.value }))} style={selStyle}>
        <option value="">— Sede —</option>
        {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
      </select>
      <button onClick={handleAddRow}
        style={{ background: T.blue, color: "#fff", border: "none", borderRadius: 5, padding: "5px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
        Agregar
      </button>
      <button onClick={() => setShow(false)}
        style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 5, padding: "5px 10px", fontSize: 12, cursor: "pointer", fontFamily: T.font, color: T.muted }}>
        Cancelar
      </button>
    </div>
  );
}
