import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchNovedades, appendNovedad, updateNovedad, deleteNovedad,
  fetchLegajos, fetchCentrosCostoNumbers, fetchCuentasContablesNumbers,
  FP_TIPOS, FP_TIPO_LABEL, ROLES_SEDES,
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

function newRow(overrides = {}) {
  return {
    _id: Date.now() + Math.random(),
    id: null,
    legajo_id: "", legajo_nombre: "",
    sede_id: "", sede_nombre: "",
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
    sede_id: n.sede_id, sede_nombre: n.sede_nombre,
    monto: String(n.monto || ""), forma_pago: n.forma_pago || "efectivo", nota: n.descripcion || "",
    cuenta_contable_id: n.cuenta_contable_id, cuenta_contable_nombre: n.cuenta_contable_nombre,
  };
}

// Firma para detectar cambios entre la fila editada y la persistida.
const rowSig = (r) => [r.legajo_id, r.sede_id, r.monto, r.forma_pago, r.nota, r.cuenta_contable_id].join("|");

const iStyle = {
  border: `1px solid ${T.border}`, borderRadius: 5, padding: "5px 8px",
  fontSize: 13, fontFamily: T.font, background: "#fff", color: T.text,
  width: "100%", boxSizing: "border-box",
};

export default function PantallaNovedadesSedes({ pais = "" }) {
  const [mes,  setMes]  = useState(MES_DEF);
  const [anio, setAnio] = useState(ANO_DEF);

  const [rows,    setRows]    = useState([]);
  const [loaded,  setLoaded]  = useState([]);   // snapshot persistido (para diff)
  const [legajos, setLegajos] = useState([]);
  const [sedes,   setSedes]   = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [dirty,   setDirty]   = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(async (m, a, p) => {
    if (!p) return;
    setLoading(true);
    try {
      const [novs, legs, ccs, ctas] = await Promise.all([
        fetchNovedades(m, a),
        fetchLegajos(),
        fetchCentrosCostoNumbers(),
        fetchCuentasContablesNumbers(),
      ]);
      // Solo las de Sedes (extra + con sede). Las de HQ (sin sede) viven en la pantalla de HQ.
      const sedesNovs = novs.filter(n => n.tipo === "extra" && n.sede_id);
      setRows(sedesNovs.map(novToRow));
      setLoaded(sedesNovs);
      setLegajos(legs.filter(l => l.activo && ROLES_SEDES.includes(l.rol) && (!l.pais || l.pais === p)));
      setSedes(ccs.filter(c => !c.pais || c.pais === p));
      setCuentas(ctas);
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
  const addRow = () => { setRows(prev => [...prev, newRow()]); setDirty(true); };
  const delRow = (rid) => { setRows(prev => prev.filter(r => r._id !== rid)); setDirty(true); };

  const handleCopiarMesAnterior = async () => {
    const mAnt = mes === 1 ? 12 : mes - 1;
    const aAnt = mes === 1 ? anio - 1 : anio;
    const novs = (await fetchNovedades(mAnt, aAnt)).filter(n => n.tipo === "extra" && n.sede_id);
    if (!novs.length) { alert("No hay novedades de Sedes en el mes anterior."); return; }
    setRows(novs.map(n => ({ ...newRow(novToRow(n)), id: null, _id: Date.now() + Math.random() })));
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

      // Secuencial: el GAS pierde escrituras concurrentes (appendRow se pisa → se "borraba" la última).
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

  const total = rows.filter(r => r.legajo_id && r.sede_id).reduce((s, r) => s + Math.abs(parseFloat(r.monto) || 0), 0);

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

      {loading ? (
        <p style={{ color: T.muted, fontSize: 13 }}>Cargando…</p>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.bg }}>
                <th style={thStyle}>Legajo</th>
                <th style={{ ...thStyle, width: 170 }}>Sede</th>
                <th style={{ ...thStyle, width: 120 }}>Monto $</th>
                <th style={{ ...thStyle, width: 150 }}>Forma de pago</th>
                <th style={{ ...thStyle, width: 170 }}>Cuenta contable</th>
                <th style={thStyle}>Nota</th>
                <th style={{ ...thStyle, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} style={{ padding: "14px 10px", color: T.dim, fontSize: 13 }}>
                  Sin novedades de Sedes este mes. Agregá una fila abajo.
                </td></tr>
              )}
              {rows.map(r => (
                <tr key={r._id} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ padding: "6px 10px" }}>
                    <select style={iStyle} value={r.legajo_id} onChange={e => setLegajo(r._id, e.target.value)}>
                      <option value="">— Elegir legajo —</option>
                      {legajos.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <select style={iStyle} value={r.sede_id} onChange={e => setSede(r._id, e.target.value)}>
                      <option value="">— Elegir sede —</option>
                      {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
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
                  <td style={{ padding: "6px 10px" }}>
                    <select style={iStyle} value={r.cuenta_contable_id} onChange={e => setCuenta(r._id, e.target.value)}>
                      <option value="">— Cuenta —</option>
                      {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <input style={iStyle} value={r.nota} placeholder="Nota (ej: feriado 1/5)"
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
                <td colSpan={2} style={{ padding: "8px 10px" }}>Total</td>
                <td style={{ padding: "8px 10px", textAlign: "right" }}>
                  ${total.toLocaleString("es-AR")}
                </td>
                <td colSpan={4}></td>
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
