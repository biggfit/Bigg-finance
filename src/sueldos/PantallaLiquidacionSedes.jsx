import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react";
import * as XLSX from "xlsx";
import {
  fetchLegajos, fetchCategorias, fetchObjetivos,
  fetchLiquidacionesSedes, deleteLiquidacionSede,
  fetchCentrosCostoNumbers, fetchSociedadesNumbers, fetchCuentasBancariasNumbers,
  fetchPagos, appendPago, appendPagos, deletePago, nuevoLote, updateLegajo, fetchHorasDesdeEye, fetchCdpDesdeEye,
  fetchNovedades,
  ROLES_COACHES, ROLES_FRONT, ROLES_LIMP, ROL_CONCEPTO,
  FP_TIPO_LABEL, FP_TIPO_COLOR, esTransferencia,
  idLiqDe, lineaLiq, sociedadDeFormaPago, saveLiquidacionesLinesBatch, isCerrada,
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
// Deriva los 5 campos de pago (fuente única) desde el detalle de líneas de clase de BIGG Eye.
// Feriado/Domingo solo aplican a BIGG CLASS; YOGA/RUNNING = tarifa plana (todas sus horas a su balde).
function sumar5(detalle) {
  const t = { horas: 0, horas_feriados: 0, horas_domingos: 0, horas_yoga: 0, horas_running: 0 };
  for (const l of (detalle || [])) {
    const reg = Number(l.regulares) || 0, fer = Number(l.feriado) || 0, dom = Number(l.domingo) || 0;
    const c = String(l.clase || "BIGG CLASS").toUpperCase();
    if (c.includes("YOGA"))         t.horas_yoga    += reg + fer + dom;
    else if (c.includes("RUNNING")) t.horas_running += reg + fer + dom;
    else { t.horas += reg; t.horas_feriados += fer; t.horas_domingos += dom; }
  }
  return t;
}

// Ordena las líneas de clase: Presentes antes que Ausentes (espejo de BIGG Eye), estable en el resto.
function ordenarDetalle(detalle) {
  return [...(detalle || [])].sort((a, b) =>
    (a.asistio === "Ausentes" ? 1 : 0) - (b.asistio === "Ausentes" ? 1 : 0));
}

// Sintetiza líneas de detalle desde los 5 campos agregados (para filas sin check-in de Eye o guardadas).
function detalleDesde5(row) {
  const h = Number(row.horas) || 0, f = Number(row.horas_feriados) || 0, dm = Number(row.horas_domingos) || 0;
  const y = Number(row.horas_yoga) || 0, r = Number(row.horas_running) || 0;
  const d = [{ clase: "BIGG CLASS", asistio: "Presentes", regulares: h, feriado: f, domingo: dm }];
  if (y) d.push({ clase: "YOGA",    asistio: "Presentes", regulares: y, feriado: 0, domingo: 0 });
  if (r) d.push({ clase: "RUNNING", asistio: "Presentes", regulares: r, feriado: 0, domingo: 0 });
  return d;
}

// Ranking de rol: Encargado → Vendedor → Coach Senior → Coach Junior → resto → Limpieza (última).
const ROL_ORDEN = { ENCARGADO: 0, VENTAS: 1, COACH_SENIOR: 2, COACH: 3, LIMPIEZA: 9 };
const rolRank = (rol) => ROL_ORDEN[rol] ?? 5;  // resto (Botánico/Yoga/Running/…) entre junior y limpieza
// Orden por defecto: primero por SEDE, luego por ROL (ranking), luego por nombre.
const sortByRol = (arr) => [...arr].sort((a, b) => {
  const se = (a.sede_nombre || "").localeCompare(b.sede_nombre || "", "es", { numeric: true });
  if (se !== 0) return se;
  const ro = rolRank(a.rol) - rolRank(b.rol);
  if (ro !== 0) return ro;
  return (a.legajo_nombre || "").localeCompare(b.legajo_nombre || "");
});

// Separador fuerte cuando la fila i arranca una sede distinta a la anterior (lista ya ordenada por sede).
const SEDE_SEP = "4px solid #334155";
const sedeCambia = (arr, i) => i > 0 && (arr[i - 1]?.sede_nombre || "") !== (arr[i]?.sede_nombre || "");

// Header con filtro embebido (ícono ⌕ + popover). mode="multi" (checkboxes, Set) o "text" (búsqueda).
// Espejo del patrón de TabContabilidad, con el theme de Sueldos. La etiqueta sigue siendo ordenable si se pasa onSort.
const ghostBtn = { flex: 1, fontSize: 10, background: "transparent", border: `1px solid ${T.border}`,
  borderRadius: 5, padding: "3px 6px", cursor: "pointer", color: T.muted, fontFamily: T.font };
function HeaderFilter({ label, align = "left", minWidth, mode = "multi", options = [],
  selected, onToggle, onSetAll, textValue = "", onText, labelFn = (x) => x, onSort, sortDir }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const active = mode === "text" ? !!textValue : selected.size > 0;
  const opts   = options.filter(o => labelFn(o).toLowerCase().includes(q.toLowerCase()));
  const allSel = mode === "multi" && options.length > 0 && options.every(o => selected.has(o));
  const thStyle = { padding: "7px 8px", textAlign: align, fontWeight: 600, color: T.muted, fontSize: 11,
    letterSpacing: ".04em", borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap",
    background: T.bg, minWidth, position: "relative" };
  return (
    <th style={thStyle} ref={ref}>
      <span onClick={onSort} style={{ cursor: onSort ? "pointer" : "default", userSelect: "none" }}>
        {label}{onSort && sortDir ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
      </span>
      <span onClick={() => setOpen(o => !o)}
        style={{ marginLeft: 5, cursor: "pointer", fontSize: 11, opacity: active ? 1 : 0.4, color: active ? T.blue : "inherit" }}>⌕</span>
      {mode === "multi" && selected.size > 0 && (
        <span style={{ marginLeft: 4, fontSize: 9, background: T.blue, color: "#fff", borderRadius: 99, padding: "1px 5px", fontWeight: 800 }}>{selected.size}</span>
      )}
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 30, background: "#fff",
          border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,.18)",
          padding: 8, minWidth: 210, fontWeight: 400, textTransform: "none", letterSpacing: 0, textAlign: "left" }}>
          {mode === "text" ? (
            <input autoFocus value={textValue} onChange={e => onText(e.target.value)} placeholder="Buscar…"
              style={{ ...iStyle, fontSize: 12 }} />
          ) : (
            <>
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar…"
                style={{ ...iStyle, fontSize: 12, marginBottom: 6 }} />
              <div style={{ display: "flex", gap: 6, marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${T.border}` }}>
                <button onClick={() => onSetAll(allSel ? [] : options)} style={ghostBtn}>{allSel ? "✕ Ninguno" : "✓ Todos"}</button>
                {selected.size > 0 && !allSel && <button onClick={() => onSetAll([])} style={ghostBtn}>✕ Limpiar</button>}
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                {opts.map(o => (
                  <label key={o} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, cursor: "pointer",
                    padding: "4px 6px", borderRadius: 5, background: selected.has(o) ? "#eff6ff" : "transparent" }}>
                    <input type="checkbox" checked={selected.has(o)} onChange={() => onToggle(o)} style={{ accentColor: T.blue, cursor: "pointer" }} />
                    <span style={{ color: selected.has(o) ? T.blue : T.text }}>{labelFn(o)}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </th>
  );
}
// Helper: toggle de un valor dentro de un Set en estado.
const toggleEnSet = (setter) => (val) => setter(prev => { const n = new Set(prev); n.has(val) ? n.delete(val) : n.add(val); return n; });

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
  const [legajosInactivos, setLegajosInactivos] = useState([]);  // dados de baja (para reconocer check-ins de ex/suplentes)
  const [liqsSaved,  setLiqsSaved]  = useState([]);  // su_liquidaciones guardadas (se mergean en rosterBase)
  const [eyeItems,   setEyeItems]   = useState([]);  // items de BIGG Eye (coach × sede × horas)
  const [eyeSource,  setEyeSource]  = useState(null); // { source: "vivo"|"cache"|"cache-fallback"|"error", ts }
  // Aplica la respuesta de Eye (items + de dónde vinieron, para el cartel en vivo/cache).
  const applyEyeData = useCallback((data) => {
    setEyeItems(data?.items ?? []);
    setEyeSource({ source: data?._source ?? null, ts: data?._cache_ts ?? null });
  }, []);
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
    // Sede canónica: matchea por id; si no, por nombre parcial (Eye guarda "Recoleta" vs "01 - Recoleta").
    const mkNorm = (sedesArr) => (sedeId, sedeName) => {
      const byId = sedesArr.find(s => s.id === sedeId);
      if (byId) return byId.nombre;
      const byName = sedesArr.find(s =>
        s.nombre.toLowerCase().includes((sedeName ?? "").toLowerCase()) ||
        (sedeName ?? "").toLowerCase().includes(s.nombre.toLowerCase().replace(/^\d+\s*-\s*/, "")));
      return byName?.nombre ?? sedeName ?? "";
    };
    let socIds = [], legIds = new Set();
    try {
      // ── OLA 1: lo esencial para mostrar el Paso 1 (roster + país + sedes + tarifas + estado guardado).
      // Menos consultas concurrentes = el GAS no se satura (con 9 juntas algunas fallaban) y no esperamos
      // al tapón de 20s (cuentas), que no se necesita hasta Paso 4. allSettled: si una falla, cae a [].
      const w1 = await Promise.allSettled([
        fetchLegajos(),                    // 0
        fetchCategorias(m, a, p),          // 1
        fetchLiquidacionesSedes(m, a, p),  // 2  (r.id → evita duplicar al guardar)
        fetchSociedadesNumbers(),          // 3
        fetchCentrosCostoNumbers(),        // 4
      ]);
      const f1 = w1.filter(r => r.status === "rejected").length;
      if (f1) console.warn(`[Liquidación Sedes] ola 1: ${f1}/5 consultas fallaron`);
      const [legs, cats, liqs, socs, ccs] = w1.map(r => (r.status === "fulfilled" ? r.value : []));
      socIds = socs.filter(s => s.pais === p).map(s => s.id);
      const sedesArr = ccs.filter(c => !c.pais || c.pais === p);
      setLegajos(legs.filter(l => l.activo && (!l.pais || l.pais === p)));
      setLegajosInactivos(legs.filter(l => !l.activo && (!l.pais || l.pais === p)));
      setSedes(sedesArr);
      setCategorias(cats);
      const norm = mkNorm(sedesArr);
      setLiqsSaved(liqs.map(r => ({ ...r, sede_nombre: norm(r.sede_id, r.sede_nombre) })));
      legIds = new Set(liqs.map(l => l.legajo_id));
      // BIGG Eye NO se trae en la carga (llamada en vivo lenta, el Paso 1 no la necesita): manual.
      setEyeItems([]);
      setEyeSource({ source: "pendiente", ts: null });
    } finally { setLoading(false); }   // Paso 1 ya puede mostrarse; lo demás llega en segundo plano.

    // ── OLA 2: secundario (Paso 3/4/5), en segundo plano, sin bloquear la pantalla ni el Paso 1.
    Promise.allSettled([
      fetchPagos(m, a),
      fetchNovedades(m, a),
      fetchObjetivos(m, a, p),
      fetchCuentasBancariasNumbers(),   // el tapón de 20s — ya no bloquea la carga
    ]).then(w2 => {
      const [pags, novs, objs, ctas] = w2.map(r => (r.status === "fulfilled" ? r.value : []));
      setPagos(pags.filter(pg => pg.ambito === "sedes" || (!pg.ambito && legIds.has(pg.legajo_id))));
      setNovedades(novs.filter(n => n.tipo === "extra" && n.sede_id));
      setObjetivos(objs);
      setCuentas(ctas.filter(c => !c.sociedad || socIds.includes(c.sociedad)));
    });
  }, []);

  // Refresh LIVIANO tras guardar/pagar: solo re-trae liquidaciones + pagos (lo único que cambió),
  // sin re-descargar las 9 fuentes ni bloquear la pantalla con "Cargando…". Reusa `sedes` de estado.
  const refreshLiqs = useCallback(async () => {
    const [liqs, pags] = await Promise.all([
      fetchLiquidacionesSedes(mes, anio, pais).catch(() => []),
      fetchPagos(mes, anio).catch(() => []),
    ]);
    const byId = new Map(sedes.map(s => [s.id, s]));
    const norm = (sedeId, sedeName) => {
      const hit = byId.get(sedeId);
      if (hit) return hit.nombre;
      const byName = sedes.find(s =>
        s.nombre.toLowerCase().includes((sedeName ?? "").toLowerCase()) ||
        (sedeName ?? "").toLowerCase().includes(s.nombre.toLowerCase().replace(/^\d+\s*-\s*/, "")));
      return byName?.nombre ?? sedeName ?? "";
    };
    setLiqsSaved(liqs.map(r => ({ ...r, sede_nombre: norm(r.sede_id, r.sede_nombre) })));
    const legIds = new Set(liqs.map(l => l.legajo_id));
    setPagos(pags.filter(pg => pg.ambito === "sedes" || (!pg.ambito && legIds.has(pg.legajo_id))));
  }, [mes, anio, pais, sedes]);

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
    // Match contra legajos DADOS DE BAJA (para reconocer check-ins de ex/suplentes que volvieron).
    const normInactivos = legajosInactivos.map(leg => ({ leg, norm: normNombreM(leg.nombre) }));
    const matchInactivo = (normName) => {
      let best = null, bestScore = 0;
      for (const { leg, norm } of normInactivos) {
        const ns = nameScoreM(norm, normName);
        if (ns > bestScore) { bestScore = ns; best = leg; }
      }
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
        const legInact = matchInactivo(normCoach);
        if (legInact) {
          // Está en la base pero dado de baja (ex/suplente). Se reconoce y puede pagarse/reactivarse.
          key  = `${legInact.id}__${sede.id}`;
          seed = { _id: key, bucket: "inactivo",
            legajo_id: legInact.id, legajo_nombre: legInact.nombre,
            sociedad_id: legInact.sociedad_id ?? "", sociedad_nombre: legInact.sociedad_nombre ?? "",
            sede_id: sede.id, sede_nombre: sede.nombre,
            rol: legInact.rol || "COACH",
            sueldo_base: ROLES_SEDES_ALL.includes(legInact.rol) ? (Number(legInact.sueldo_total) || 0) : 0 };
        } else {
          key  = `eye__${normCoach}__${sede.id}`;
          seed = { _id: key, bucket: "sin_legajo",
            legajo_nombre: item.coach_name, sede_id: sede.id, sede_nombre: sede.nombre, rol: "COACH" };
        }
      }
      if (!byKey.has(key)) byKey.set(key, baseRow(seed));
      // 1 línea de detalle por clase × asistió (espejo del reporte). El pago sale de acá (ver normalización).
      (byKey.get(key).horas_detalle ??= []).push({
        clase: item.clase || "BIGG CLASS", asistio: item.asistio || "Presentes",
        regulares: Number(item.regulares) || 0, feriado: Number(item.feriado) || 0, domingo: Number(item.domingo) || 0,
      });
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

    // Normalización: el detalle por clase es la fuente única de las horas.
    //  - guardada (id): sus 5 campos mandan → sintetizo el detalle desde ellos (para la grilla).
    //  - de Eye (tiene detalle): los 5 campos = suma del detalle (Presentes + Ausentes; ver grilla).
    //  - sin check-in / sin detalle: sintetizo 1 línea BIGG CLASS desde los agregados (0/base).
    for (const row of byKey.values()) {
      if (row.id)                         row.horas_detalle = detalleDesde5(row);
      else if (row.horas_detalle?.length) Object.assign(row, sumar5(row.horas_detalle));
      else                                row.horas_detalle = detalleDesde5(row);
      // Presentes primero (espejo de BIGG Eye): estable, respeta el orden de clases dentro de cada asistió.
      row.horas_detalle = ordenarDetalle(row.horas_detalle);
    }

    return applyObjetivosToRows([...byKey.values()], objetivos);
  }, [eyeItems, legajos, legajosInactivos, liqsSaved, sedes, objetivos, mes, anio, pais]);

  // Snapshot de base salarial derivada (baseline del % aumento en Paso 1).
  useEffect(() => {
    originalRows.current = Object.fromEntries(rosterBase.map(r => [r._id, r.sueldo_base]));
  }, [rosterBase]);

  const rows = useMemo(() => {
    const overlay = (r) => ({ ...r, ...edits[r._id] });
    return [...rosterBase.map(overlay), ...manualRows.map(overlay)]
      .filter(r => !r._deleted);
  }, [rosterBase, manualRows, edits]);

  // Detalle base (sin ediciones) por fila, para el editor de líneas de clase.
  const baseDetalle = useMemo(
    () => new Map([...rosterBase, ...manualRows].map(r => [r._id, r.horas_detalle || []])),
    [rosterBase, manualRows]);
  // Edita una línea del detalle (regulares/feriado/domingo) y recalcula los 5 campos de pago del coach.
  const updateDetalle = useCallback((_id, idx, field, val) => {
    setEdits(prev => {
      const cur = prev[_id]?.horas_detalle ?? baseDetalle.get(_id) ?? [];
      const detalle = cur.map((l, i) => i === idx ? { ...l, [field]: Number(val) || 0 } : l);
      return { ...prev, [_id]: { ...(prev[_id] || {}), horas_detalle: detalle, ...sumar5(detalle) } };
    });
  }, [baseDetalle]);
  // Borra UNA línea de detalle (clase×asistió), ej. la de Ausentes, sin tocar al coach. Recalcula el pago.
  // Si era la última, deja una línea BIGG CLASS en 0 (para no romper el editor).
  const removeDetalle = useCallback((_id, idx) => {
    setEdits(prev => {
      const cur = prev[_id]?.horas_detalle ?? baseDetalle.get(_id) ?? [];
      const rest = cur.filter((_, i) => i !== idx);
      const detalle = rest.length ? rest : [{ clase: "BIGG CLASS", asistio: "Presentes", regulares: 0, feriado: 0, domingo: 0 }];
      return { ...prev, [_id]: { ...(prev[_id] || {}), horas_detalle: detalle, ...sumar5(detalle) } };
    });
  }, [baseDetalle]);

  // Conciliación: contadores por bucket para el banner.
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
      horas_detalle: [{ clase: "BIGG CLASS", asistio: "Presentes", regulares: 0, feriado: 0, domingo: 0 }],
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
      // Una sola escritura para todos los legajos (add_batch). `replace` solo en los ya guardados:
      // el primer guardado del mes va todo nuevo → 0 borrados → un único request.
      const entries = dirty.map(r => ({
        id_liq:  idLiqDe(r.legajo_id, mes, anio, r.sede_id),
        lineas:  lineasConceptoDeRow(r, "borrador").lineas,
        replace: true,   // idempotente: borrar-y-reescribir siempre (r.id no es confiable si la carga falló → duplicaba)
      }));
      await saveLiquidacionesLinesBatch(entries);
      await refreshLiqs();   // refresh liviano (no re-descarga todo ni bloquea la pantalla)
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
      // Base del prorrateo = suma de los totales de fila SIN redondeo (mismo criterio que rowTotal).
      // Usar empl.total_sueldo (que INCLUYE el redondeo del efectivo) daba share<1 en un empleado de
      // una sola sede → escalaba mal los haberes (200.000 → 199.994). Con esto, una sola sede = share 1.
      const totalSueldoPorLegajo = {};
      for (const r of rows) {
        totalSueldoPorLegajo[r.legajo_id] = (totalSueldoPorLegajo[r.legajo_id] || 0) + lineasConceptoDeRow(r, "cerrado").total;
      }
      const entries = [];
      for (const r of rows) {
        const { lineas, total: rowTotal, header } = lineasConceptoDeRow(r, "cerrado");
        const empl      = empls.find(e => e.legajo_id === r.legajo_id);
        // El reparto de forma de pago es del SUELDO (sin redondeo), no de las novedades.
        const emplTotal = totalSueldoPorLegajo[r.legajo_id] || rowTotal;
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
        // replace SIEMPRE true: el cierre debe ser IDEMPOTENTE (borrar-y-reescribir), aunque sea lento.
        // Confiar en r.id era peligroso: si la consulta de liquidaciones falló al cargar, r.id venía
        // vacío → no borraba → el add_batch duplicaba sobre lo ya guardado. La velocidad la resuelve el
        // del_comp_batch en el GAS (pendiente), no saltear el borrado.
        entries.push({ id_liq: idLiqDe(r.legajo_id, mes, anio, r.sede_id), lineas: [...lineasFin, ...pagos, ...novLineas], replace: true });
      }
      // Un solo add_batch para todas las liquidaciones (replace: reescribe el borrador como "cerrado").
      await saveLiquidacionesLinesBatch(entries);
      await refreshLiqs();   // refresh liviano (no bloquea la pantalla)
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
          <StepsIndicator paso={paso} onPaso={p => p < paso && setPaso(p)} />

          {paso === 1 && (
            <PasoFijos
              rowsFijos={rowsFijos}
              legajos={legajosFijos}
              sedes={sedes}
              originalRows={originalRows}
              novsByRowKey={novsByRowKey}
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
              novsByRowKey={novsByRowKey}
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
              updateDetalle={updateDetalle}
              removeDetalle={removeDetalle}
              onResyncEye={applyEyeData}
              eyeSource={eyeSource}
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
              novsByRowKey={novsByRowKey}
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
              onBatchPaid={() => refreshLiqs()}
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
            onSaved={async () => { setShowPago(null); await refreshLiqs(); }}
          />
        );
      })()}
    </div>
  );
}

// ── Banner de conciliación (BIGG Eye × legajos) ────────────────────────────────

// ── Color de fila según bucket de conciliación ─────────────────────────────────
function bucketBg(row, fallback) {
  if (row.bucket === "sin_legajo")  return "#fee2e2";  // 🔴 rojo: check-in sin legajo (no está en la base)
  if (row.bucket === "sin_checkin" && row.revisar) return "#fef9c3";  // 🟡 amarillo: en nómina sin check-in
  if (row.bucket === "inactivo")    return "#fef9c3";  // 🟡 amarillo: legajo dado de baja con check-in
  return fallback;  // 🟢 verde/OK: no pinta
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

// Chip verde de novedades al lado del nombre (espejo de HQ). Total + detalle en tooltip.
function NovChip({ novs }) {
  const list = novs || [];
  const total = list.reduce((s, n) => s + (Number(n.monto) || 0), 0);
  if (!total) return null;
  const detalle = list
    .map(n => `${n.descripcion || n.cuenta_contable_nombre || "Novedad"}: ${fmtMoney(Number(n.monto) || 0)}`)
    .join("\n");
  return (
    <span title={detalle} style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#16a34a",
      background: "#dcfce7", borderRadius: 6, padding: "1px 7px", cursor: "help", whiteSpace: "nowrap" }}>
      +{fmtMoney(total)}
    </span>
  );
}

function PasoFijos({ rowsFijos, legajos, sedes, originalRows, novsByRowKey, updateRow, removeRow,
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

  const [fNombre, setFNombre] = useState("");
  const [fRol,    setFRol]    = useState(() => new Set());
  const [fSede,   setFSede]   = useState(() => new Set());
  const rolesDisp = useMemo(() => [...new Set(rowsFijos.map(r => r.rol).filter(Boolean))].sort(), [rowsFijos]);
  const sedesDisp = useMemo(() => [...new Set(rowsFijos.map(r => r.sede_nombre).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true })), [rowsFijos]);
  const fijosFilt = useMemo(() => rowsFijos.filter(r =>
    (!fNombre || (r.legajo_nombre || "").toLowerCase().includes(fNombre.toLowerCase())) &&
    (fRol.size === 0  || fRol.has(r.rol)) &&
    (fSede.size === 0 || fSede.has(r.sede_nombre))
  ), [rowsFijos, fNombre, fRol, fSede]);
  const sortedFijos = useMemo(
    () => (sortKey ? sortRows(fijosFilt, sortKey, sortDir) : sortByRol(fijosFilt)),
    [fijosFilt, sortKey, sortDir]
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
              <HeaderFilter label="Nombre" minWidth={140} mode="text" textValue={fNombre} onText={setFNombre}
                onSort={() => toggleSort("legajo_nombre")} sortDir={sortKey === "legajo_nombre" ? sortDir : undefined} />
              <HeaderFilter label="Rol" minWidth={80} options={rolesDisp} selected={fRol}
                onToggle={toggleEnSet(setFRol)} onSetAll={arr => setFRol(new Set(arr))} labelFn={r => ROL_CONCEPTO[r] ?? r}
                onSort={() => toggleSort("rol")} sortDir={sortKey === "rol" ? sortDir : undefined} />
              <HeaderFilter label="Centro de costo" minWidth={110} options={sedesDisp} selected={fSede}
                onToggle={toggleEnSet(setFSede)} onSetAll={arr => setFSede(new Set(arr))}
                onSort={() => toggleSort("sede_nombre")} sortDir={sortKey === "sede_nombre" ? sortDir : undefined} />
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
                <tr key={row._id} style={{ background: bucketBg(row, i % 2 === 0 ? T.card : T.bg), borderBottom: `1px solid ${T.border}`, borderTop: sedeCambia(sortedFijos, i) ? "2px solid #94a3b8" : undefined }}>
                  <td style={{ padding: "5px 8px", fontWeight: 800 }}>{row.legajo_nombre}<NovChip novs={novsByRowKey[rowKeyDe(row.legajo_id, row.sede_id)]} /></td>
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

function PasoHoras({ rowsCoaches, legajos, allLegajos, sedes, calcTotal, novsByRowKey, updateRow, removeRow, updateDetalle, removeDetalle,
  showAddForm, setShowAddForm, addForm, setAddForm, handleAddRow,
  mes, anio, pais, onResyncEye, eyeSource,
  onAtras, onContinuar, onSiguiente, saving }) {

  const HORA_COLS = [
    { field: "horas",          label: "Hs. Coach", w: 80 },
    { field: "horas_feriados", label: "Feriados",   w: 80 },
    { field: "horas_domingos", label: "Domingos",   w: 80 },
    { field: "horas_yoga",     label: "Yoga",       w: 70 },
    { field: "horas_running",  label: "Running",    w: 75 },
  ];

  const [sortKey,    setSortKey]    = useState(null);   // null = orden por sede → rol
  const [sortDir,    setSortDir]    = useState("asc");
  const [openDet,    setOpenDet]    = useState(null);   // _id del coach con el detalle de Eye abierto
  const [eyeLoading, setEyeLoading] = useState(false);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };
  const [fNombre, setFNombre] = useState("");
  const [fRol,    setFRol]    = useState(() => new Set());
  const [fSede,   setFSede]   = useState(() => new Set());
  const rolesDisp = useMemo(() => [...new Set(rowsCoaches.map(r => r.rol).filter(Boolean))].sort(), [rowsCoaches]);
  const sedesDisp = useMemo(() => [...new Set(rowsCoaches.map(r => r.sede_nombre).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true })), [rowsCoaches]);
  const filtered = useMemo(() => rowsCoaches.filter(r =>
    (!fNombre || (r.legajo_nombre || "").toLowerCase().includes(fNombre.toLowerCase())) &&
    (fRol.size === 0  || fRol.has(r.rol)) &&
    (fSede.size === 0 || fSede.has(r.sede_nombre))
  ), [rowsCoaches, fNombre, fRol, fSede]);
  const sortedRows = useMemo(() => (sortKey ? sortRows(filtered, sortKey, sortDir) : sortByRol(filtered)), [filtered, sortKey, sortDir]);

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
    try {
      const eyeIds = sedes.filter(s => s.bigg_eye_id).map(s => s.bigg_eye_id);
      const eyeData = await fetchHorasDesdeEye(mes, anio, pais, eyeIds, true);  // fresh: baja en vivo, saltea cache
      onResyncEye(eyeData);
    } catch (e) {
      alert("Error al cargar desde BIGG Eye: " + e.message);
    } finally {
      setEyeLoading(false);
    }
  };

  // Resumen de conciliación derivado de los MISMOS buckets que pintan las filas
  // (así el conteo del banner y los colores siempre coinciden).
  const nombresUnicos  = (rows) => [...new Set(rows.map(r => r.legajo_nombre).filter(Boolean))];
  const sinLegajoNom   = nombresUnicos(rowsCoaches.filter(r => r.bucket === "sin_legajo"));
  const sinCheckinNom  = nombresUnicos(rowsCoaches.filter(r => r.bucket === "sin_checkin" && r.revisar));
  const inactivoNom    = nombresUnicos(rowsCoaches.filter(r => r.bucket === "inactivo"));
  const matchCount     = rowsCoaches.filter(r => r.bucket === "match").length;
  const hayAlertas     = sinLegajoNom.length > 0 || sinCheckinNom.length > 0 || inactivoNom.length > 0;

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: T.muted, flexGrow: 1 }}>
          {rowsCoaches.length} coach{rowsCoaches.length !== 1 ? "s" : ""}
        </span>
        {eyeSource?.source && (() => {
          const vivo = eyeSource.source === "vivo";
          const err  = eyeSource.source === "error";
          const pend = eyeSource.source === "pendiente";
          const bg   = vivo ? "#dcfce7" : err ? "#fee2e2" : pend ? "#f1f5f9" : "#fef9c3";
          const fg   = vivo ? "#166534" : err ? "#991b1b" : pend ? "#475569" : "#854d0e";
          const txt  = vivo ? "🟢 En vivo desde BIGG Eye"
                     : err  ? "🔴 No se pudo conectar a BIGG Eye"
                     : pend ? "⚪ BIGG Eye sin sincronizar — apretá Re-sincronizar"
                     : `🟡 Datos del cache${eyeSource.ts ? ` (${eyeSource.ts})` : ""}${eyeSource.source === "cache-fallback" ? " — Eye no respondió" : ""}`;
          return <span title="De dónde salen las horas mostradas" style={{ fontSize: 11, fontWeight: 700, padding: "4px 9px", borderRadius: 999, background: bg, color: fg }}>{txt}</span>;
        })()}
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

      {/* Conciliación BIGG Eye × Legajos — mismos buckets que pintan las filas */}
      <div style={{
        background: hayAlertas ? "#fffbeb" : "#f0fdf4",
        border: `1px solid ${hayAlertas ? "#fde68a" : "#86efac"}`, borderRadius: 8,
        padding: "10px 14px", marginBottom: 12, fontSize: 12,
      }}>
        <strong style={{ color: "#16a34a" }}>🟢 {matchCount} con legajo y check-in</strong>
        {sinCheckinNom.length > 0 && (
          <div style={{ marginTop: 6, color: "#b45309" }}>
            <strong>🟡 En nómina sin check-in ({sinCheckinNom.length}):</strong>{" "}
            {sinCheckinNom.join(", ")} — no vinieron horas de BIGG Eye este mes
          </div>
        )}
        {inactivoNom.length > 0 && (
          <div style={{ marginTop: 6, color: "#b45309" }}>
            <strong>🟡 Inactivo con check-in ({inactivoNom.length}):</strong>{" "}
            {inactivoNom.join(", ")} — está en la base pero dado de baja; reactivá el legajo si volvió
          </div>
        )}
        {sinLegajoNom.length > 0 && (
          <div style={{ marginTop: 6, color: "#dc2626" }}>
            <strong>🔴 Sin legajo ({sinLegajoNom.length}):</strong>{" "}
            {sinLegajoNom.join(", ")} — no está en la base; falta crear el legajo
          </div>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.bg }}>
              <HeaderFilter label="Nombre" minWidth={130} mode="text" textValue={fNombre} onText={setFNombre}
                onSort={() => toggleSort("legajo_nombre")} sortDir={sortKey === "legajo_nombre" ? sortDir : undefined} />
              <HeaderFilter label="Rol" minWidth={95} options={rolesDisp} selected={fRol}
                onToggle={toggleEnSet(setFRol)} onSetAll={arr => setFRol(new Set(arr))} labelFn={r => ROL_CONCEPTO[r] ?? r}
                onSort={() => toggleSort("rol")} sortDir={sortKey === "rol" ? sortDir : undefined} />
              <HeaderFilter label="Sede" minWidth={100} options={sedesDisp} selected={fSede}
                onToggle={toggleEnSet(setFSede)} onSetAll={arr => setFSede(new Set(arr))}
                onSort={() => toggleSort("sede_nombre")} sortDir={sortKey === "sede_nombre" ? sortDir : undefined} />
              <th style={TH({ minWidth: 90 })}>Clase</th>
              <th style={TH({ width: 80, textAlign: "right" })}>Regulares</th>
              <th style={TH({ width: 70, textAlign: "right" })}>Feriado</th>
              <th style={TH({ width: 70, textAlign: "right" })}>Domingo</th>
              <th style={TH({ width: 60, textAlign: "right" })}>Total</th>
              <th style={TH({ minWidth: 90 })}>Asistió</th>
              <th style={TH({ width: 32 })}></th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: "24px 10px", textAlign: "center", color: T.dim, fontSize: 12 }}>
                  Sin coaches para este mes. Agregá filas abajo.
                </td>
              </tr>
            ) : sortedRows.map((row, i) => {
                // Una fila por clase × asistió (espejo de BIGG Eye). Nombre/Rol/Sede solo en la 1ª línea del coach.
                const det = (row.horas_detalle && row.horas_detalle.length)
                  ? row.horas_detalle
                  : [{ clase: "BIGG CLASS", asistio: "Presentes", regulares: 0, feriado: 0, domingo: 0 }];
                const bg = bucketBg(row, i % 2 === 0 ? T.card : T.bg);
                const sedeSep = sedeCambia(sortedRows, i);
                return det.map((l, di) => {
                  const pres  = l.asistio !== "Ausentes";
                  const esBigg = !/YOGA|RUNNING/i.test(l.clase || "");   // feriado/domingo solo en BIGG CLASS
                  const first = di === 0, last = di === det.length - 1;
                  const tot   = (Number(l.regulares) || 0) + (Number(l.feriado) || 0) + (Number(l.domingo) || 0);
                  const inp = (field, on) => on
                    ? <input style={iStyle} value={l[field] || ""} placeholder="0"
                        onChange={e => updateDetalle(row._id, di, field, e.target.value)} />
                    : <span style={{ color: T.dim }}>—</span>;
                  return (
                    <tr key={row._id + "-" + di} style={{ background: bg, borderBottom: last ? `1px solid ${T.border}` : "none", borderTop: (first && sedeSep) ? SEDE_SEP : undefined }}>
                      <td style={{ padding: "5px 8px", fontWeight: 600 }}>{first ? row.legajo_nombre : ""}{first && <NovChip novs={novsByRowKey[rowKeyDe(row.legajo_id, row.sede_id)]} />}</td>
                      <td style={{ padding: "4px 6px" }}>
                        {first && (
                          <select value={row.rol} onChange={e => updateRow(row._id, "rol", e.target.value)}
                            style={{ fontSize: 11, fontFamily: T.font, border: `1px solid ${T.border}`,
                              borderRadius: 4, padding: "2px 4px", background: T.card, color: T.text, width: "100%", cursor: "pointer" }}>
                            {ROLES_COACHES.map(r => <option key={r} value={r}>{ROL_CONCEPTO[r] ?? r}</option>)}
                          </select>
                        )}
                      </td>
                      <td style={{ padding: "5px 8px", color: T.muted }}>{first ? (row.sede_nombre || "—") : ""}</td>
                      <td style={{ padding: "5px 8px", fontWeight: 600, color: T.text }}>{l.clase}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right" }}>{inp("regulares", true)}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right" }}>{inp("feriado", esBigg)}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right" }}>{inp("domingo", esBigg)}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700, color: T.text }}>{tot}</td>
                      <td style={{ padding: "4px 8px" }}>
                        <span style={{ padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                          color: pres ? "#16a34a" : "#b45309", background: pres ? "#dcfce7" : "#fef3c7" }}
                          title={pres ? undefined : "Check-in pendiente — igual paga si dejás horas"}>
                          {pres ? "Presentes" : "Ausentes"}
                        </span>
                      </td>
                      <td style={{ padding: "4px", textAlign: "center" }}>
                        {first
                          ? <button onClick={() => removeRow(row._id)} title="Borrar el coach entero"
                              style={{ background: "none", border: "none", cursor: "pointer", color: T.dim, fontSize: 12, padding: 2 }}>🗑</button>
                          : <button onClick={() => removeDetalle(row._id, di)} title="Borrar esta línea (ej. Ausentes)"
                              style={{ background: "none", border: "none", cursor: "pointer", color: T.dim, fontSize: 12, padding: 2 }}>🗑</button>}
                      </td>
                    </tr>
                  );
                });
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

function PasoIncentivos({ rows, legajos, sedes, mes, anio, pais, novsByRowKey, updateRow, removeRow,
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

  const [fNombre, setFNombre] = useState("");
  const [fRol,    setFRol]    = useState(() => new Set());
  const [fSede,   setFSede]   = useState(() => new Set());
  const rolesDisp = useMemo(() => [...new Set(rows.map(r => r.rol).filter(Boolean))].sort(), [rows]);
  const sedesDisp = useMemo(() => [...new Set(rows.map(r => r.sede_nombre).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true })), [rows]);
  const filtered = useMemo(() => rows.filter(r =>
    (!fNombre || (r.legajo_nombre || "").toLowerCase().includes(fNombre.toLowerCase())) &&
    (fRol.size === 0  || fRol.has(r.rol)) &&
    (fSede.size === 0 || fSede.has(r.sede_nombre))
  ), [rows, fNombre, fRol, fSede]);
  const sortedRows = useMemo(() => {
    if (!sortKey) return sortByRol(filtered);
    return sortRows(filtered, sortKey, sortDir);
  }, [filtered, sortKey, sortDir]);

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
      const cdpData = await fetchCdpDesdeEye(mes, anio, pais, eyeIds, true);  // fresh: baja en vivo, saltea cache
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
              <HeaderFilter label="Nombre" minWidth={140} mode="text" textValue={fNombre} onText={setFNombre}
                onSort={() => toggleSort("legajo_nombre")} sortDir={sortKey === "legajo_nombre" ? sortDir : undefined} />
              <HeaderFilter label="Rol" minWidth={90} options={rolesDisp} selected={fRol}
                onToggle={toggleEnSet(setFRol)} onSetAll={arr => setFRol(new Set(arr))} labelFn={r => ROL_CONCEPTO[r] ?? r} />
              <HeaderFilter label="Sede" minWidth={110} options={sedesDisp} selected={fSede}
                onToggle={toggleEnSet(setFSede)} onSetAll={arr => setFSede(new Set(arr))}
                onSort={() => toggleSort("sede_nombre")} sortDir={sortKey === "sede_nombre" ? sortDir : undefined} />
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
                <tr key={row._id} style={{ background: bucketBg(row, i % 2 === 0 ? T.card : T.bg), borderBottom: `1px solid ${T.border}`, borderTop: sedeCambia(sortedRows, i) ? SEDE_SEP : undefined }}>
                  <td style={{ padding: "5px 8px", fontWeight: 600 }}>{row.legajo_nombre}<NovChip novs={novsByRowKey[rowKeyDe(row.legajo_id, row.sede_id)]} /></td>
                  <td style={{ padding: "5px 8px", color: T.muted, fontSize: 11 }}>
                    {ROL_CONCEPTO[row.rol] ?? row.rol}
                  </td>
                  <td style={{ padding: "5px 8px", color: T.muted }}>{row.sede_nombre || "—"}</td>
                  <td style={{ padding: "4px 6px" }}>
                    {!isLimp ? inp(row, "asignado") : dash}
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    {/* Objetivo grupal: aplica a TODOS los roles (baseGrupalDe: coaches sobre horas,
                        fijos/limpieza sobre sueldo básico + feriado). Antes se ocultaba para limpieza
                        → no se podía cargar el % y no multiplicaba. */}
                    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <input style={{ ...iStyle, width: 44 }} value={row.c_grupo_pct || ""} placeholder="0"
                        onChange={e => updateRow(row._id, "c_grupo_pct", e.target.value)} />
                      <span style={{ fontSize: 10, color: T.muted }}>%</span>
                    </div>
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

  const [fNombre, setFNombre] = useState("");
  const [fRol,    setFRol]    = useState(() => new Set());
  const [fSede,   setFSede]   = useState(() => new Set());
  const rolesDisp = useMemo(() => [...new Set(empls.map(e => e.rol).filter(Boolean))].sort(), [empls]);
  const sedesDisp = useMemo(() => [...new Set(empls.flatMap(e => e.sedes || []).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true })), [empls]);
  const emplsFilt = useMemo(() => empls.filter(e =>
    (!fNombre || (e.legajo_nombre || "").toLowerCase().includes(fNombre.toLowerCase())) &&
    (fRol.size === 0  || fRol.has(e.rol)) &&
    (fSede.size === 0 || (e.sedes || []).some(s => fSede.has(s)))
  ), [empls, fNombre, fRol, fSede]);

  return (
    <div>
      {/* Necesidades por forma de pago: cuánto hay que tener en banco y en efectivo. */}
      <FondeoBand stats={stats} />

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.bg }}>
              <HeaderFilter label="Empleado" minWidth={160} mode="text" textValue={fNombre} onText={setFNombre} />
              <HeaderFilter label="Rol" minWidth={80} options={rolesDisp} selected={fRol}
                onToggle={toggleEnSet(setFRol)} onSetAll={arr => setFRol(new Set(arr))} labelFn={r => ROL_CONCEPTO[r] ?? r} />
              <HeaderFilter label="Sedes" minWidth={90} options={sedesDisp} selected={fSede}
                onToggle={toggleEnSet(setFSede)} onSetAll={arr => setFSede(new Set(arr))} />
              <th style={TH({ width: 110, textAlign: "right" })}>Total</th>
              <th style={TH({ width: 100, textAlign: "right" })}>Haberes</th>
              <th style={TH({ width: 100, textAlign: "right" })}>Monotributo</th>
              <th style={TH({ width: 100, textAlign: "right" })}>Efectivo</th>
            </tr>
          </thead>
          <tbody>
            {emplsFilt.map((empl, i) => {
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

  const [fNombre, setFNombre] = useState("");
  const [fSede,   setFSede]   = useState(() => new Set());
  const sedesDisp = useMemo(() => [...new Set(empls.flatMap(e => e.sedes || []).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true })), [empls]);
  const emplsFilt = useMemo(() => empls.filter(e =>
    (!fNombre || (e.legajo_nombre || "").toLowerCase().includes(fNombre.toLowerCase())) &&
    (fSede.size === 0 || (e.sedes || []).some(s => fSede.has(s)))
  ), [empls, fNombre, fSede]);

  return (
    <div>
      {/* Totales y pendientes por forma de pago. */}
      <ResumenPagosBand stats={tipoStats} />

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 8 }}>
          <thead>
            <tr>
              <HeaderFilter label="Nombre" mode="text" textValue={fNombre} onText={setFNombre} />
              <HeaderFilter label="Sedes" options={sedesDisp} selected={fSede}
                onToggle={toggleEnSet(setFSede)} onSetAll={arr => setFSede(new Set(arr))} />
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
            {emplsFilt.map((empl, i) => (
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
      // Una sola escritura (add_batch) para toda la tanda, en vez de un request por empleado
      // (evita el "línea por línea" lento: cada request al GAS cuesta ~3s).
      const items = emplsSelec.map(empl => ({
        mes, anio, lote_pago,
        legajo_id:              empl.legajo_id,
        legajo_nombre:          empl.legajo_nombre,
        sociedad_id:            tipo === "haberes" ? empl.sociedad_id     : (form.sociedad_id || "beta"),
        sociedad_nombre:        tipo === "haberes" ? empl.sociedad_nombre : socNombre,
        tipo_componente:        tipo,
        monto:                  getMontoTipo(empl, tipo),
        fecha:                  form.fecha,
        cuenta_bancaria_id:     form.cuenta_id,
        cuenta_bancaria_nombre: ctaNombre,
        cuenta_contable_id:     "CUENTA_Sueldos",   // movimiento de Tesorería → cuenta Sueldos (no "Sin clasificar")
        cuenta_contable_nombre: "Sueldos",
        ambito:                 "sedes",
      }));
      await appendPagos(items);
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
    nota:            "",
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
      // La sociedad del pago = la dueña de la CAJA que paga (efectivo → Beta, monotributo → la elegida,
      // haberes → la del legajo). NO la del legajo por defecto, o el efectivo caería en Hektor.
      const socId  = cta?.sociedad || socFiltro || liq.sociedad_id;
      const socNom = sociedades.find(s => s.id === socId)?.nombre || liq.sociedad_nombre;
      await appendPago({
        mes, anio,
        lote_pago:              nuevoLote(),
        legajo_id:              liq.legajo_id,
        legajo_nombre:          liq.legajo_nombre,
        sociedad_id:            socId,
        sociedad_nombre:        socNom,
        tipo_componente:        form.tipo_componente,
        monto:                  parseFloat(form.monto) || 0,
        fecha:                  form.fecha,
        cuenta_bancaria_id:     form.cuenta_id,
        cuenta_bancaria_nombre: cta?.nombre ?? "",
        cuenta_contable_id:     "CUENTA_Sueldos",
        cuenta_contable_nombre: "Sueldos",
        ambito:                 "sedes",
        nota:                   form.nota.trim(),
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
          <div>
            <ModalLabel>Nota (opcional)</ModalLabel>
            <input style={MODAL_INPUT} value={form.nota} placeholder="Ej: adelanto a cuenta"
              onChange={e => set("nota", e.target.value)} />
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
