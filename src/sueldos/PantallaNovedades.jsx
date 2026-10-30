import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchNovedades, appendNovedadesBatch, updateNovedad, deleteNovedad,
  fetchLegajos, fetchCuentasContablesNumbers,
  FP_TIPOS, FP_TIPO_LABEL, ROLES_HQ,
  fmtMiles, limpiarMonto,
} from "../lib/sueldosApi";
import { useRowChecks } from "../lib/useRowChecks";
import { novedadesDeAmbito } from "../lib/aguinaldo";
import { tmpRowId } from "../lib/tmpRowId";
import { fmtEntero, HeaderCheckTodas } from "./sueldosUi";

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

// Solapas por concepto. Las nombradas fijan su cuenta contable; "Otros" la elige por fila.
const CONCEPTOS = [
  { key: "monotributo", label: "Monotributo", cuenta: "Monotributo" },
  { key: "obra_social", label: "Obra Social", cuenta: "Obra Social" },
  { key: "autonomos",   label: "Autónomos",    cuenta: "Autónomos" },
  { key: "otros",       label: "Otros",        cuenta: null },
];

const norm = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

// Monotributistas a los que siempre hay que devolverles el monto del monotributo (pedido manual, no viene de una hoja).
const IDS_MONOTRIBUTISTAS_FIJOS = [
  "LEG-nako-0011", // Ana Leber
  "LEG-nako-0026", // Facundo Martino
  "LEG-nako-0006", // Federico Bosch
  "LEG-nako-0016", // Federico Bracco
  "LEG-nako-0017", // Florencia Silveyra
  "LEG-nako-0003", // Francisco Bosch
  "LEG-nako-0001", // Guillermo "Gigio" Mazzoni
  "LEG-nako-0005", // Guido Mazzoni
  "LEG-nako-0004", // Ignacio Alsogaray
  "LEG-nako-0019", // Jennifer Schwimmer
  "LEG-nako-0010", // Lucia Pini
  "LEG-nako-0002", // Martin Bergara
  "LEG-nako-0008", // Martin Miauro
  "LEG-nako-0009", // Matias Soloaga
  "LEG-nako-0012", // Santiago Paz
  "LEG-nako-0021", // Sara Salviu
  "LEG-nako-0015", // Tomas Mogaburu
  "LEG-nako-0007", // Victoria "Vicky" Mendez Casariego
];

// Los que cargan SOLOS su monotributo por el link del mail (aviso el 12, recordatorios el 24 y el 27): entra como
// novedad "pendiente" con comprobante y se aprueba acá. Los demás fijos los carga administración.
// (Misma lista que AUTOCARGA en apps-script-monotributo.gs.)
const IDS_MONOTRIBUTO_AUTOCARGA = new Set(IDS_MONOTRIBUTISTAS_FIJOS.filter(id => ![
  "LEG-nako-0001", // Gigio Mazzoni
  "LEG-nako-0005", // Guido Mazzoni
  "LEG-nako-0004", // Ignacio Alsogaray
  "LEG-nako-0007", // Victoria Mendez Casariego (va en el legajo de Gigio)
].includes(id)));

// Victoria está casada con Gigio: su devolución se carga en el legajo de él, nunca en el propio.
const ALIAS_MONOTRIBUTO = {
  "LEG-nako-0007": "LEG-nako-0001", // Victoria Mendez Casariego → Gigio Mazzoni
};
// Nota con la que se distingue, dentro del legajo de destino, la fila del alias.
const NOTA_ALIAS_MONOTRIBUTO = {
  "LEG-nako-0007": "Monotributo V",
};

// ¿La fila (o novedad) de Monotributo es la de este monotributista fijo? Resuelve el alias por la nota.
const filaDeFijo = (id) => (r) => {
  if (r.legajo_id !== (ALIAS_MONOTRIBUTO[id] ?? id)) return false;
  const nota = norm(r.nota ?? r.descripcion);
  if (NOTA_ALIAS_MONOTRIBUTO[id]) return nota === norm(NOTA_ALIAS_MONOTRIBUTO[id]);
  return !Object.values(NOTA_ALIAS_MONOTRIBUTO).some(n => nota === norm(n));
};

// A qué solapa pertenece una novedad: por su cuenta contable; si no matchea ninguna nombrada → "otros".
function conceptoDeNovedad(nov) {
  const c = CONCEPTOS.find(x => x.cuenta && norm(x.cuenta) === norm(nov.cuenta_contable_nombre));
  return c ? c.key : "otros";
}

function newRow(overrides = {}) {
  return {
    _id: tmpRowId(),
    id: null,
    legajo_id: "", legajo_nombre: "",
    monto: "", forma_pago: "efectivo", nota: "",
    cuenta_contable_id: "", cuenta_contable_nombre: "",
    estado: "", comprobante_url: "",
    ...overrides,
  };
}

function novToRow(n) {
  return {
    _id: n.id,
    id: n.id,
    legajo_id: n.legajo_id, legajo_nombre: n.legajo_nombre,
    monto: String(n.monto || ""), forma_pago: n.forma_pago || "efectivo", nota: n.descripcion || "",
    cuenta_contable_id: n.cuenta_contable_id, cuenta_contable_nombre: n.cuenta_contable_nombre,
    estado: n.estado || "", comprobante_url: n.comprobante_url || "",
  };
}

// Los 18 monotributistas fijos siempre tienen su renglón en la solapa Monotributo: al que no tiene fila
// este mes se le agrega una "semilla" editable (legajo, nota y forma de pago del mes anterior, sin monto).
// Una semilla sin monto no se guarda. Los de autocarga la ven reemplazada por su carga del link.
function sembrarFijos(rows, prevMono, nombreDe) {
  const faltan = IDS_MONOTRIBUTISTAS_FIJOS.filter(id => !rows.some(r => r.concepto === "monotributo" && filaDeFijo(id)(r)));
  return [...rows, ...faltan.map(id => {
    const legId = ALIAS_MONOTRIBUTO[id] ?? id;
    const ant = prevMono.find(filaDeFijo(id));
    return { ...newRow({
      legajo_id: legId, legajo_nombre: ant?.legajo_nombre || nombreDe(legId),
      nota: NOTA_ALIAS_MONOTRIBUTO[id] ?? "Monotributo",
      forma_pago: ant?.forma_pago || "transferencia_financiera",
    }), concepto: "monotributo", _semilla: true };
  })];
}

// Firma para detectar cambios entre la fila editada y la persistida.
const rowSig = (r) => [r.legajo_id, r.monto, r.forma_pago, r.nota, r.cuenta_contable_id, r.estado].join("|");

const iStyle = {
  border: `1px solid ${T.border}`, borderRadius: 5, padding: "5px 8px",
  fontSize: 13, fontFamily: T.font, background: "#eceff3", color: T.text,
  width: "100%", boxSizing: "border-box",
};

export default function PantallaNovedades({ pais = "" }) {
  const [mes,  setMes]  = useState(MES_DEF);
  const [anio, setAnio] = useState(ANO_DEF);
  const [tab,  setTab]  = useState(CONCEPTOS[0].key);

  const [rows,     setRows]     = useState([]);   // todas las filas (todas las solapas)
  const [loaded,   setLoaded]   = useState([]);   // snapshot persistido (para diff)
  const [legajos,  setLegajos]  = useState([]);
  const [cuentas,  setCuentas]  = useState([]);
  const [prevMap,  setPrevMap]  = useState(() => new Map());  // monto del mes anterior por legajo+cuenta
  const [prevMono, setPrevMono] = useState([]);   // filas de Monotributo del mes anterior (siembra de los fijos)
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [dirty,    setDirty]    = useState(false);
  const savingRef = useRef(false);
  const { checked, toggle: toggleCheck, setMany: setManyChecked } = useRowChecks(`novedades_check_hq_${anio}_${mes}`);

  const load = useCallback(async (m, a, p) => {
    if (!p) return;
    setLoading(true);
    try {
      const pm = m === 1 ? 12 : m - 1;
      const pa = m === 1 ? a - 1 : a;
      const [novs, prevNovs, legs, ccs] = await Promise.all([
        fetchNovedades(m, a, { conPendientes: true }),
        fetchNovedades(pm, pa),
        fetchLegajos(),
        fetchCuentasContablesNumbers(),
      ]);
      // Solo novedades de HQ (sin sede, sin aguinaldo): las de Sedes y las de Aguinaldo viven en su
      // propia pantalla y acá no se muestran ni se borran (el snapshot `loaded` no las incluye).
      const extras = novedadesDeAmbito(novs, "hq");
      const pMono = novedadesDeAmbito(prevNovs, "hq").filter(n => conceptoDeNovedad(n) === "monotributo");
      const nombreDe = (id) => legs.find(l => l.id === id)?.nombre ?? "";
      setRows(sembrarFijos(extras.map(n => ({ ...novToRow(n), concepto: conceptoDeNovedad(n) })), pMono, nombreDe));
      setLoaded(extras);
      // Monto del mes anterior por legajo+cuenta → alimenta la columna comparativa.
      const prev = new Map();
      for (const n of prevNovs.filter(x => x.tipo === "extra" && !x.sede_id)) {
        const k = `${n.legajo_id}|${norm(n.cuenta_contable_nombre)}`;
        prev.set(k, (prev.get(k) || 0) + (Number(n.monto) || 0));
      }
      setPrevMap(prev);
      setPrevMono(pMono);
      setLegajos(legs.filter(l => l.activo && ROLES_HQ.includes(l.rol) && l.pais === p));
      setCuentas(ccs);
      setDirty(false);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(mes, anio, pais); }, [mes, anio, pais, load]);

  const prevMes = () => {
    if (mes === 1) { setMes(12); setAnio(a => a - 1); }
    else setMes(m => m - 1);
  };
  const nextMes = () => {
    if (mes === 12) { setMes(1); setAnio(a => a + 1); }
    else setMes(m => m + 1);
  };

  const tabRows = rows.filter(r => r.concepto === tab);

  // Arrastrar y soltar para reordenar filas dentro de la solapa (útil para ubicar una fila recién agregada).
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
  const setCuenta = (rid, ccId) => {
    const cc = cuentas.find(c => c.id === ccId);
    setRow(rid, { cuenta_contable_id: ccId, cuenta_contable_nombre: cc?.nombre ?? "" });
  };
  const addRow = () => { setRows(prev => [...prev, { ...newRow(), concepto: tab }]); setDirty(true); };
  const delRow = (rid) => { setRows(prev => prev.filter(r => r._id !== rid)); setDirty(true); };

  // Cuenta contable de una fila al persistir: la nombrada fija de la solapa, o la elegida en "Otros".
  const resolveCuenta = (row) => {
    const con = CONCEPTOS.find(c => c.key === row.concepto);
    if (con?.cuenta) {
      const cc = cuentas.find(c => norm(c.nombre) === norm(con.cuenta));
      return { cuenta_contable_id: cc?.id ?? "", cuenta_contable_nombre: cc?.nombre ?? con.cuenta };
    }
    return { cuenta_contable_id: row.cuenta_contable_id, cuenta_contable_nombre: row.cuenta_contable_nombre };
  };

  const handleCopiarMesAnterior = async () => {
    const mAnt = mes === 1 ? 12 : mes - 1;
    const aAnt = mes === 1 ? anio - 1 : anio;
    // Solo novedades de HQ (sin sede). Copiar las de Sedes acá les borraría el sede_id
    // y las duplicaría como novedades de HQ (bug de fuga a HQ).
    // El monotributo de los que cargan solos NO se copia (lo cargan ellos por el link); y lo que ya
    // cargaron este mes se conserva, si no "Guardar" lo borraría.
    const esAutocarga = (n) => conceptoDeNovedad(n) === "monotributo" && IDS_MONOTRIBUTO_AUTOCARGA.has(n.legajo_id);
    const novs = novedadesDeAmbito(await fetchNovedades(mAnt, aAnt), "hq").filter(n => !esAutocarga(n));
    if (!novs.length) { alert("No hay novedades de HQ en el mes anterior."); return; }
    // Filas nuevas (sin id) para revisar y guardar.
    const copiadas = novs.map(n => ({ ...newRow(novToRow(n)), id: null, _id: tmpRowId(), concepto: conceptoDeNovedad(n),
      estado: "", comprobante_url: "" }));
    setRows(prev => sembrarFijos([...prev.filter(r => r.id && r.comprobante_url), ...copiadas], prevMono, legajoNombre));
    setDirty(true);
  };

  const handleGuardar = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Sin legajo no se persiste; una semilla de monotributista fijo, solo si le cargaron monto.
      const validas = rows.filter(r => r.legajo_id && !(r._semilla && !(parseFloat(r.monto) > 0)));
      const loadedById = new Map(loaded.map(n => [n.id, n]));

      // Altas: todas en UN lote (una request en vez de N). Ediciones y bajas: solo las que cambiaron.
      const nuevas = [];
      const ops = [];
      for (const r of validas) {
        const cc = resolveCuenta(r);
        const payload = {
          mes, anio,
          legajo_id: r.legajo_id, legajo_nombre: r.legajo_nombre,
          tipo: "extra",
          descripcion: r.nota,
          monto: parseFloat(r.monto) || 0,
          forma_pago: r.forma_pago,
          cuenta_contable_id: cc.cuenta_contable_id,
          cuenta_contable_nombre: cc.cuenta_contable_nombre,
          estado: r.estado || "", comprobante_url: r.comprobante_url || "",
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
        // vuelven a dar de alta (antes se duplicaban). El tilde pasa del id temporal al real.
        const idPorTmp = new Map(nuevas.map((n, i) => [n.tmpId, ids[i]]));
        setRows(prev => prev.map(x => idPorTmp.has(x._id) ? { ...x, id: idPorTmp.get(x._id) } : x));
        setLoaded(prev => [...prev, ...nuevas.map((n, i) => ({ id: ids[i], ...n.payload }))]);
        const tildadas = nuevas.filter(n => checked.has(n.tmpId));
        if (tildadas.length) {
          setManyChecked(tildadas.map(n => n.tmpId), false);
          setManyChecked(tildadas.map(n => idPorTmp.get(n.tmpId)), true);
        }
      }
      // Secuencial: el GAS pierde escrituras concurrentes (appendRow se pisa → se "borraba" una fila).
      for (const op of ops) await op();
      await load(mes, anio, pais);
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

  // Monto del mismo legajo+cuenta el mes anterior (0 si no tenía novedad de ese concepto).
  const montoAnterior = (row) => {
    // Monotributo de un fijo con alias (Gigio + Victoria en el mismo legajo): cada fila contra la suya.
    const fijo = row.concepto === "monotributo" && IDS_MONOTRIBUTISTAS_FIJOS.find(id => filaDeFijo(id)(row));
    if (fijo && Object.values(ALIAS_MONOTRIBUTO).includes(row.legajo_id))
      return prevMono.filter(filaDeFijo(fijo)).reduce((s, n) => s + (Number(n.monto) || 0), 0);
    const cta = resolveCuenta(row).cuenta_contable_nombre;
    return prevMap.get(`${row.legajo_id}|${norm(cta)}`) || 0;
  };
  const fmtAr   = fmtEntero;
  const fmt     = (n) => `$${fmtAr(n)}`;
  const fmtDiff = (n) => `${n < 0 ? "−" : n > 0 ? "+" : ""}$${fmtAr(Math.abs(n))}`;
  const diffCol = (n) => (n > 0 ? T.green : n < 0 ? T.red : T.dim);

  const totalTab  = tabRows.reduce((s, r) => s + (parseFloat(r.monto) || 0), 0);
  const totalPrev = tabRows.reduce((s, r) => s + montoAnterior(r), 0);
  const totalDiff = totalTab - totalPrev;
  const esOtros = tab === "otros";
  const esMonotributo = tab === "monotributo";
  const idsConDatos = tabRows.filter(r => r.legajo_id).map(r => r.id ?? r._id);
  const todosMarcados = idsConDatos.length > 0 && idsConDatos.every(id => checked.has(id));

  // Chequeo del piso fijo de monotributistas: alguno de sus renglones de Monotributo debe tener monto > 0.
  const montoMonotributoPorLegajo = new Map();
  for (const r of rows) {
    if (r.concepto !== "monotributo") continue;
    montoMonotributoPorLegajo.set(r.legajo_id, (montoMonotributoPorLegajo.get(r.legajo_id) || 0) + (parseFloat(r.monto) || 0));
  }
  const legajoNombre = (id) => legajos.find(l => l.id === id)?.nombre ?? id;
  const monotributistasFaltantes = IDS_MONOTRIBUTISTAS_FIJOS
    .filter(id => !(montoMonotributoPorLegajo.get(ALIAS_MONOTRIBUTO[id] ?? id) > 0))
    .map(legajoNombre);

  // Cargas por link pendientes de aprobar (no entran en la liquidación hasta aprobarlas + Guardar).
  const pendientes = rows.filter(r => r.estado === "pendiente");
  const aprobar = (rid) => setRow(rid, { estado: "aprobada" });
  const aprobarTodos = () => {
    setRows(prev => prev.map(r => r.estado === "pendiente" ? { ...r, estado: "aprobada" } : r));
    setDirty(true);
  };
  const colsExtra = (esOtros ? 1 : 0) + (esMonotributo ? 1 : 0);

  // Semilla de autocarga todavía vacía: la persona no cargó por el link.
  const esperaLink = (r) => r._semilla && IDS_MONOTRIBUTO_AUTOCARGA.has(r.legajo_id) && !(parseFloat(r.monto) > 0);

  return (
    <div style={{ padding: 24, fontFamily: T.font, color: T.text }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, flexGrow: 1 }}>Novedades de HQ</h2>

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

      {/* Solapas */}
      <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${T.border}`, marginBottom: 16, flexWrap: "wrap" }}>
        {CONCEPTOS.map(c => {
          const isActive = c.key === tab;
          const n = rows.filter(r => r.concepto === c.key && r.legajo_id).length;
          return (
            <button key={c.key} onClick={() => setTab(c.key)}
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
      </div>

      {esMonotributo && !loading && (
        monotributistasFaltantes.length === 0 ? (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534",
            borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 14 }}>
            ✅ Los {IDS_MONOTRIBUTISTAS_FIJOS.length} monotributistas fijos tienen monto cargado este mes.
          </div>
        ) : (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b",
            borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 14 }}>
            ⚠️ Faltan cargar {monotributistasFaltantes.length} de {IDS_MONOTRIBUTISTAS_FIJOS.length} monotributistas fijos: {monotributistasFaltantes.join(", ")}.
          </div>
        )
      )}

      {esMonotributo && !loading && pendientes.length > 0 && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 7,
          padding: "8px 12px", fontSize: 13, marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ flexGrow: 1 }}>
            ⏳ {pendientes.length === 1 ? "1 carga pendiente" : `${pendientes.length} cargas pendientes`} de aprobar.
            No entran en la liquidación hasta aprobarlas y guardar.
          </span>
          <button onClick={aprobarTodos} style={{ ...btnStyle(T.green), padding: "5px 12px" }}>Aprobar todos</button>
        </div>
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
                <th style={thStyle}>Legajo</th>
                <th style={{ ...thStyle, width: 120, textAlign: "right" }}>Mes anterior</th>
                <th style={{ ...thStyle, width: 130 }}>Monto $</th>
                <th style={{ ...thStyle, width: 120, textAlign: "right" }}>Diferencia</th>
                <th style={{ ...thStyle, width: 150 }}>Forma de pago</th>
                {esOtros && <th style={{ ...thStyle, width: 170 }}>Cuenta contable</th>}
                <th style={thStyle}>Nota</th>
                {esMonotributo && <th style={{ ...thStyle, width: 150 }}>Carga por link</th>}
                <th style={{ ...thStyle, width: 40 }}></th>
                <th style={{ ...thStyle, width: 40, textAlign: "center" }}>
                  <HeaderCheckTodas checked={todosMarcados} onToggle={() => setManyChecked(idsConDatos, !todosMarcados)} accent={T.green} />
                </th>
              </tr>
            </thead>
            <tbody>
              {tabRows.length === 0 && (
                <tr><td colSpan={9 + colsExtra} style={{ padding: "14px 10px", color: T.dim, fontSize: 13 }}>
                  Sin novedades en esta solapa. Agregá una fila abajo.
                </td></tr>
              )}
              {tabRows.map(r => {
                const prev = montoAnterior(r);
                const diff = (parseFloat(r.monto) || 0) - prev;
                const rid = r.id ?? r._id;
                const isChecked = checked.has(rid);
                return (
                <tr key={r._id} style={{ borderBottom: `1px solid ${T.border}`,
                  background: isChecked ? "#bbf7d0" : undefined }}
                  onDragOver={handleDragOver} onDrop={handleDrop(r._id)}>
                  <td style={{ padding: "6px 4px", textAlign: "center", cursor: "grab", color: T.dim }}
                    draggable onDragStart={handleDragStart(r._id)} title="Arrastrar para reordenar">⠿</td>
                  <td style={{ padding: "6px 10px" }}>
                    <select style={iStyle} value={r.legajo_id} onChange={e => setLegajo(r._id, e.target.value)}>
                      <option value="">— Elegir legajo —</option>
                      {legajos.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", color: T.muted }}>{fmt(prev)}</td>
                  <td style={{ padding: "6px 10px" }}>
                    <input style={{ ...iStyle, textAlign: "right" }} value={fmtMiles(r.monto)} placeholder="0"
                      inputMode="decimal"
                      onChange={e => setRow(r._id, { monto: limpiarMonto(e.target.value) })} />
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, color: diffCol(diff) }}>{fmtDiff(diff)}</td>
                  <td style={{ padding: "6px 10px" }}>
                    <select style={iStyle} value={r.forma_pago} onChange={e => setRow(r._id, { forma_pago: e.target.value })}>
                      {FP_TIPOS.map(t => <option key={t} value={t}>{FP_TIPO_LABEL[t]}</option>)}
                    </select>
                  </td>
                  {esOtros && (
                    <td style={{ padding: "6px 10px" }}>
                      <select style={iStyle} value={r.cuenta_contable_id} onChange={e => setCuenta(r._id, e.target.value)}>
                        <option value="">— Cuenta —</option>
                        {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </td>
                  )}
                  <td style={{ padding: "6px 10px" }}>
                    <input style={iStyle} value={r.nota} placeholder="Nota"
                      onChange={e => setRow(r._id, { nota: e.target.value })} />
                  </td>
                  {esMonotributo && (
                    <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                      {r.comprobante_url && (
                        <a href={r.comprobante_url} target="_blank" rel="noreferrer" title="Ver comprobante"
                          style={{ textDecoration: "none", fontSize: 15, marginRight: 8 }}>📎</a>
                      )}
                      {r.estado === "pendiente" ? (
                        <button onClick={() => aprobar(r._id)}
                          style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: 5,
                            padding: "3px 9px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
                          Aprobar
                        </button>
                      ) : r.estado === "aprobada" ? (
                        <span style={{ color: T.green, fontSize: 12, fontWeight: 600 }}>✓ Aprobada</span>
                      ) : esperaLink(r) ? (
                        <span style={{ color: "#b45309", fontSize: 12, fontWeight: 600 }}>⌛ Esperando carga</span>
                      ) : null}
                    </td>
                  )}
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
                <td colSpan={3} style={{ padding: "8px 10px" }}>Total</td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmt(totalTab)}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", color: diffCol(totalDiff) }}>{fmtDiff(totalDiff)}</td>
                <td colSpan={4 + colsExtra}></td>
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
