import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchObjetivos, saveObjetivos,
  fetchCentrosCostoNumbers, fetchSociedadesNumbers,
} from "../lib/sueldosApi";

const T = {
  bg:     "#f8fafc",
  card:   "#ffffff",
  border: "#e2e8f0",
  text:   "#1e293b",
  muted:  "#64748b",
  dim:    "#94a3b8",
  blue:   "#2563eb",
  font:   "'Inter', system-ui, sans-serif",
};

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
               "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const hoy     = new Date();
const MES_DEF = hoy.getMonth() === 0 ? 12 : hoy.getMonth();
const ANO_DEF = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();

function newObjRow(overrides = {}) {
  return { _id: Date.now() + Math.random(), sede_id: "", sede_nombre: "", porcentaje: "", ...overrides };
}

const iStyle = {
  border: `1px solid ${T.border}`, borderRadius: 5, padding: "5px 8px",
  fontSize: 13, fontFamily: T.font, background: "#fff", color: T.text,
  width: "100%", boxSizing: "border-box",
};

export default function PantallaObjetivos({ pais = "" }) {
  const [mes,  setMes]  = useState(MES_DEF);
  const [anio, setAnio] = useState(ANO_DEF);

  const [objetivos, setObjetivos] = useState([newObjRow()]);
  const [sedes,     setSedes]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [dirty,     setDirty]     = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(async (m, a, p) => {
    if (!p) return;
    setLoading(true);
    try {
      const [objs, socs, ccs] = await Promise.all([
        fetchObjetivos(m, a, p),
        fetchSociedadesNumbers(),
        fetchCentrosCostoNumbers(),
      ]);
      const socIds = socs.filter(s => s.pais === p).map(s => s.id);
      const sedesFiltradas = ccs.filter(c => !c.sociedad || socIds.includes(c.sociedad));
      setSedes(sedesFiltradas);
      setObjetivos(objs.length ? objs.map(o => ({ ...o, _id: o.id, porcentaje: String(o.porcentaje) })) : [newObjRow()]);
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

  const setObjetivo = (idx, key, val) => {
    setObjetivos(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      if (key === "sede_id") {
        const sede = sedes.find(s => s.id === val);
        return { ...r, sede_id: val, sede_nombre: sede?.nombre ?? val };
      }
      return { ...r, [key]: val };
    }));
    setDirty(true);
  };
  const addObjetivo = () => { setObjetivos(prev => [...prev, newObjRow()]); setDirty(true); };
  const delObjetivo = (idx) => { setObjetivos(prev => prev.filter((_, i) => i !== idx)); setDirty(true); };

  const handleCopiarMesAnterior = async () => {
    const mAnt = mes === 1 ? 12 : mes - 1;
    const aAnt = mes === 1 ? anio - 1 : anio;
    const objs = await fetchObjetivos(mAnt, aAnt, pais);
    if (!objs.length) { alert("No hay objetivos en el mes anterior."); return; }
    setObjetivos(objs.map(o => ({ ...newObjRow(), sede_id: o.sede_id, sede_nombre: o.sede_nombre, porcentaje: String(o.porcentaje) })));
    setDirty(true);
  };

  const handleGuardar = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await saveObjetivos(mes, anio, pais, objetivos.map(r => ({
        sede_id:    r.sede_id,
        sede_nombre: r.sede_nombre,
        porcentaje: parseFloat(r.porcentaje) || 0,
      })));
      setDirty(false);
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

  const thStyle = {
    padding: "7px 10px", textAlign: "left", fontWeight: 600,
    color: T.muted, fontSize: 11, letterSpacing: ".04em",
    borderBottom: `1px solid ${T.border}`,
  };

  return (
    <div style={{ padding: 24, fontFamily: T.font, color: T.text, maxWidth: 700 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, flexGrow: 1 }}>
          Objetivos por sede{pais ? ` — ${pais}` : ""}
        </h2>

        {/* Selector de mes */}
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

      {loading ? (
        <p style={{ color: T.muted, fontSize: 13 }}>Cargando…</p>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.bg }}>
                <th style={thStyle}>Sede</th>
                <th style={{ ...thStyle, width: 140 }}>% Staff</th>
                <th style={{ ...thStyle, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {objetivos.map((r, i) => (
                <tr key={r._id} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={{ padding: "6px 10px" }}>
                    {sedes.length > 0 ? (
                      <select
                        style={iStyle}
                        value={r.sede_id}
                        onChange={e => setObjetivo(i, "sede_id", e.target.value)}
                      >
                        <option value="">— Seleccionar sede —</option>
                        {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                      </select>
                    ) : (
                      <input
                        style={iStyle}
                        value={r.sede_nombre}
                        placeholder="Nombre de sede"
                        onChange={e => setObjetivo(i, "sede_nombre", e.target.value)}
                      />
                    )}
                  </td>
                  <td style={{ padding: "6px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        style={{ ...iStyle, textAlign: "right" }}
                        value={r.porcentaje}
                        placeholder="0"
                        onChange={e => setObjetivo(i, "porcentaje", e.target.value)}
                      />
                      <span style={{ color: T.muted, fontSize: 13, flexShrink: 0 }}>%</span>
                    </div>
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "center" }}>
                    <button onClick={() => delObjetivo(i)}
                      style={{ background: "none", border: "none", cursor: "pointer",
                        fontSize: 13, color: T.muted, padding: 2 }}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "8px 10px" }}>
            <button onClick={addObjetivo}
              style={{ background: "none", border: "none", cursor: "pointer",
                fontSize: 13, color: T.blue, fontFamily: T.font, padding: 0 }}>
              + Agregar sede
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
