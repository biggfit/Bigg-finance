import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchNovedades, appendNovedad, updateNovedad, deleteNovedad,
  fetchLegajos, fetchCuentasContablesNumbers,
  FP_TIPOS, FP_TIPO_LABEL, ROLES_HQ,
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

// A qué solapa pertenece una novedad: por su cuenta contable; si no matchea ninguna nombrada → "otros".
function conceptoDeNovedad(nov) {
  const c = CONCEPTOS.find(x => x.cuenta && norm(x.cuenta) === norm(nov.cuenta_contable_nombre));
  return c ? c.key : "otros";
}

function newRow(overrides = {}) {
  return {
    _id: Date.now() + Math.random(),
    id: null,
    legajo_id: "", legajo_nombre: "",
    monto: "", forma_pago: "efectivo", nota: "",
    cuenta_contable_id: "", cuenta_contable_nombre: "",
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
  };
}

// Firma para detectar cambios entre la fila editada y la persistida.
const rowSig = (r) => [r.legajo_id, r.monto, r.forma_pago, r.nota, r.cuenta_contable_id].join("|");

const iStyle = {
  border: `1px solid ${T.border}`, borderRadius: 5, padding: "5px 8px",
  fontSize: 13, fontFamily: T.font, background: "#fff", color: T.text,
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
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [dirty,    setDirty]    = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(async (m, a, p) => {
    if (!p) return;
    setLoading(true);
    try {
      const [novs, legs, ccs] = await Promise.all([
        fetchNovedades(m, a),
        fetchLegajos(),
        fetchCuentasContablesNumbers(),
      ]);
      // Solo novedades de HQ (sin sede). Las de Sedes (con sede_id) viven en su propia pantalla.
      const extras = novs.filter(n => n.tipo === "extra" && !n.sede_id);
      setRows(extras.map(n => ({ ...novToRow(n), concepto: conceptoDeNovedad(n) })));
      setLoaded(extras);
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
    const novs = (await fetchNovedades(mAnt, aAnt)).filter(n => n.tipo === "extra");
    if (!novs.length) { alert("No hay novedades en el mes anterior."); return; }
    // Filas nuevas (sin id) para revisar y guardar.
    setRows(novs.map(n => ({ ...newRow(novToRow(n)), id: null, _id: Date.now() + Math.random(), concepto: conceptoDeNovedad(n) })));
    setDirty(true);
  };

  const handleGuardar = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const validas = rows.filter(r => r.legajo_id);   // sin legajo no se persiste
      const loadedById = new Map(loaded.map(n => [n.id, n]));

      // Altas + ediciones
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
        };
        if (!r.id) {
          ops.push(() => appendNovedad(payload));
        } else {
          const orig = loadedById.get(r.id);
          if (!orig || rowSig(r) !== rowSig(novToRow(orig))) ops.push(() => updateNovedad(r.id, payload));
        }
      }

      // Bajas: ids cargados que ya no están entre las filas con id
      const keepIds = new Set(validas.filter(r => r.id).map(r => r.id));
      for (const n of loaded) if (!keepIds.has(n.id)) ops.push(() => deleteNovedad(n.id));

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

  const totalTab = tabRows.reduce((s, r) => s + (parseFloat(r.monto) || 0), 0);
  const esOtros = tab === "otros";

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

      {loading ? (
        <p style={{ color: T.muted, fontSize: 13 }}>Cargando…</p>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.bg }}>
                <th style={thStyle}>Legajo</th>
                <th style={{ ...thStyle, width: 130 }}>Monto $</th>
                <th style={{ ...thStyle, width: 150 }}>Forma de pago</th>
                {esOtros && <th style={{ ...thStyle, width: 170 }}>Cuenta contable</th>}
                <th style={thStyle}>Nota</th>
                <th style={{ ...thStyle, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {tabRows.length === 0 && (
                <tr><td colSpan={esOtros ? 6 : 5} style={{ padding: "14px 10px", color: T.dim, fontSize: 13 }}>
                  Sin novedades en esta solapa. Agregá una fila abajo.
                </td></tr>
              )}
              {tabRows.map(r => (
                <tr key={r._id} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ padding: "6px 10px" }}>
                    <select style={iStyle} value={r.legajo_id} onChange={e => setLegajo(r._id, e.target.value)}>
                      <option value="">— Elegir legajo —</option>
                      {legajos.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <input style={{ ...iStyle, textAlign: "right" }} value={r.monto} placeholder="0"
                      onChange={e => setRow(r._id, { monto: e.target.value })} />
                  </td>
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
                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                    <button onClick={() => delRow(r._id)}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: T.dim, padding: 2 }}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: T.bg, fontWeight: 700 }}>
                <td style={{ padding: "8px 10px" }}>Total</td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>
                  ${totalTab.toLocaleString("es-AR")}
                </td>
                <td colSpan={esOtros ? 4 : 3}></td>
              </tr>
            </tfoot>
          </table>
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
