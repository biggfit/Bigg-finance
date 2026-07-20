import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchCategorias, saveCategorias,
  fetchAllConceptos,
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

const CONCEPTOS_DEFAULT = [
  "BOTANICO",
  "BIGG COACH",
  "COACH SENIOR",
  "CDP FRONT DESK",
  "CDP COACHES",
  "ONE SHOT",
  "COMISIÓN X REFERIDO",
  "DOMINGO",
  "YOGA",
  "RUNNING",
];

function newRow(overrides = {}) {
  return { _id: Date.now() + Math.random(), concepto: "", monto: "", ...overrides };
}

const iStyle = {
  border: `1px solid ${T.border}`, borderRadius: 5, padding: "5px 8px",
  fontSize: 13, fontFamily: T.font, background: "#fff", color: T.text,
  width: "100%", boxSizing: "border-box",
};

export default function PantallaCategorias({ pais = "" }) {
  const [mes,  setMes]  = useState(MES_DEF);
  const [anio, setAnio] = useState(ANO_DEF);

  const [tarifas,   setTarifas]   = useState([newRow()]);
  const [conceptos, setConceptos] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [dirty,     setDirty]     = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(async (m, a, p) => {
    if (!p) return;
    setLoading(true);
    try {
      const [cats, conceptosHist] = await Promise.all([
        fetchCategorias(m, a, p),
        fetchAllConceptos(p),
      ]);
      const merged = [...new Set([...CONCEPTOS_DEFAULT, ...conceptosHist])].sort();
      setConceptos(merged);
      setTarifas(cats.length ? cats.map(c => ({ ...c, _id: c.id, monto: String(c.monto) })) : [newRow()]);
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

  const setTarifa = (idx, key, val) => {
    setTarifas(prev => prev.map((r, i) => i === idx ? { ...r, [key]: val } : r));
    setDirty(true);
  };
  const addTarifa = () => { setTarifas(prev => [...prev, newRow()]); setDirty(true); };
  const delTarifa = (idx) => { setTarifas(prev => prev.filter((_, i) => i !== idx)); setDirty(true); };

  const handleCopiarMesAnterior = async () => {
    const mAnt = mes === 1 ? 12 : mes - 1;
    const aAnt = mes === 1 ? anio - 1 : anio;
    const cats = await fetchCategorias(mAnt, aAnt, pais);
    if (!cats.length) { alert("No hay tarifas en el mes anterior."); return; }
    setTarifas(cats.map(c => ({ ...newRow(), concepto: c.concepto, monto: String(c.monto) })));
    setDirty(true);
  };

  const handleGuardar = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await saveCategorias(mes, anio, pais, tarifas.map(r => ({ concepto: r.concepto, monto: parseFloat(r.monto) || 0 })));
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

  const sectionTitle = (title) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: ".08em",
      textTransform: "uppercase", marginBottom: 10, marginTop: 24 }}>
      {title}
    </div>
  );

  const thStyle = { padding: "7px 10px", textAlign: "left", fontWeight: 600,
    color: T.muted, fontSize: 11, letterSpacing: ".04em",
    borderBottom: `1px solid ${T.border}` };

  return (
    <div style={{ padding: 24, fontFamily: T.font, color: T.text, maxWidth: 700 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, flexGrow: 1 }}>Categorías</h2>

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
        <>
          {/* ── Tarifas ── */}
          {sectionTitle("Tarifas")}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: T.bg }}>
                  <th style={thStyle}>Concepto</th>
                  <th style={{ ...thStyle, width: 140 }}>Valor $</th>
                  <th style={{ ...thStyle, width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {tarifas.map((r, i) => (
                  <tr key={r._id} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td style={{ padding: "6px 10px" }}>
                      <input
                        style={iStyle}
                        list="conceptos-list"
                        value={r.concepto}
                        placeholder="Ej: BIGG COACH"
                        onChange={e => setTarifa(i, "concepto", e.target.value)}
                      />
                    </td>
                    <td style={{ padding: "6px 10px" }}>
                      <input
                        style={{ ...iStyle, textAlign: "right" }}
                        value={r.monto}
                        placeholder="0"
                        onChange={e => setTarifa(i, "monto", e.target.value)}
                      />
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "center" }}>
                      <button onClick={() => delTarifa(i)}
                        style={{ background: "none", border: "none", cursor: "pointer",
                          fontSize: 13, color: T.dim, padding: 2 }}>🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: "8px 10px" }}>
              <button onClick={addTarifa}
                style={{ background: "none", border: "none", cursor: "pointer",
                  fontSize: 13, color: T.blue, fontFamily: T.font, padding: 0 }}>
                + Agregar concepto
              </button>
            </div>
          </div>

          <datalist id="conceptos-list">
            {conceptos.map(c => <option key={c} value={c} />)}
          </datalist>
        </>
      )}
    </div>
  );
}
