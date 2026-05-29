import { useState, useEffect, useRef, useMemo } from "react";
import {
  fetchLegajos, fetchLiquidaciones, saveLiquidacion, updateLegajo,
  fetchNovedades, appendNovedad, deleteNovedad,
  fetchPagos, appendPago,
  ROLES_HQ,
} from "../lib/sueldosApi";

const T = {
  bg:      "#f8fafc",
  card:    "#ffffff",
  border:  "#e2e8f0",
  text:    "#1e293b",
  muted:   "#64748b",
  dim:     "#94a3b8",
  blue:    "#2563eb",
  blueLt:  "#eff6ff",
  red:     "#dc2626",
  green:   "#16a34a",
  greenLt: "#f0fdf4",
  yellow:  "#ca8a04",
  purple:  "#7c3aed",
  font:    "'Inter', system-ui, sans-serif",
};

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
               "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function fmtMoney(n) {
  if (!n && n !== 0) return "—";
  return "$" + Math.round(n).toLocaleString("es-AR");
}

// Redondea al múltiplo de 500 más cercano
function redondear(n) {
  return Math.round(n / 500) * 500;
}

const hoy = new Date();

export default function PantallaLiquidacionHQ() {
  const [mes,  setMes]  = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());

  const [legajos,       setLegajos]       = useState([]);
  const [liquidaciones, setLiquidaciones] = useState([]);
  const [novedades,     setNovedades]     = useState([]);
  const [pagos,         setPagos]         = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);

  const [editandoId,  setEditandoId]  = useState(null);
  const [showNovedad, setShowNovedad] = useState(null);
  const [showPago,    setShowPago]    = useState(null);

  useEffect(() => { load(); }, [mes, anio]);

  async function load() {
    setLoading(true);
    try {
      const [legs, liqs, novs, pags] = await Promise.all([
        fetchLegajos(),
        fetchLiquidaciones(mes, anio),
        fetchNovedades(mes, anio),
        fetchPagos(mes, anio),
      ]);
      setLegajos(legs.filter(l => ROLES_HQ.includes(l.rol) && l.activo));
      setLiquidaciones(liqs.filter(l => ROLES_HQ.includes(l.rol)));
      setNovedades(novs);
      setPagos(pags);
    } finally { setLoading(false); }
  }

  async function handleInicializar() {
    const idsConLiq = new Set(liquidaciones.map(l => l.legajo_id));
    const nuevos = legajos.filter(l => !idsConLiq.has(l.id));
    if (nuevos.length === 0) { alert("Todos los empleados de HQ ya tienen liquidación."); return; }
    setSaving(true);
    try {
      await Promise.all(nuevos.map(leg => saveLiquidacion({
        mes, anio,
        legajo_id:         leg.id,
        legajo_nombre:     leg.nombre,
        sociedad_id:       leg.sociedad_id,
        sociedad_nombre:   leg.sociedad_nombre,
        sede_id:           leg.sede_id,
        sede_nombre:       leg.sede_nombre,
        rol:               leg.rol,
        tipo_contratacion: leg.tipo_contratacion,
        sueldo_base:       leg.sueldo_total || leg.blanco_neto,
        monto_haberes:     leg.blanco_neto,
        monto_efectivo:    Math.max(0, (leg.sueldo_total || 0) - (leg.blanco_neto || 0)),
        monto_monotributo: 0,
        estado:            "borrador",
      })));
      await load();
    } finally { setSaving(false); }
  }

  const liqs = useMemo(() => {
    return liquidaciones.map(liq => {
      const leg           = legajos.find(l => l.id === liq.legajo_id);
      const novsMias      = novedades.filter(n => n.legajo_id === liq.legajo_id);
      const pagosMios     = pagos.filter(p => p.legajo_id === liq.legajo_id);
      const totalNovExtra = novsMias.filter(n => n.tipo === "extra").reduce((s, n) => s + n.monto, 0);
      const totalRend     = novsMias.filter(n => n.tipo === "rendicion").reduce((s, n) => s + n.monto, 0);
      const totalAnticipo = novsMias.filter(n => n.tipo === "anticipo").reduce((s, n) => s + n.monto, 0);
      const totalPagado   = pagosMios.reduce((s, p) => s + p.monto, 0);
      const total_bruto   = (liq.monto_haberes || 0) + (liq.monto_monotributo || 0) + (liq.monto_efectivo || 0) + totalNovExtra + totalRend - totalAnticipo;
      return {
        ...liq,
        sueldo_total_legajo: leg?.sueldo_total || 0,
        blanco_neto_legajo:  leg?.blanco_neto  || 0,
        novedades: novsMias, pagos: pagosMios,
        total_bruto, total_pagado: totalPagado,
        pendiente: total_bruto - totalPagado,
        total_novedades_extra: totalNovExtra,
        total_rendiciones: totalRend,
        total_anticipos: totalAnticipo,
      };
    });
  }, [liquidaciones, novedades, pagos, legajos]);

  const liqStaff  = liqs.filter(l => l.rol === "HQ");
  const liqOwners = liqs.filter(l => l.rol === "HQ_OWNER");

  const totales = (arr) => ({
    bruto:  arr.reduce((s, l) => s + l.total_bruto,  0),
    pagado: arr.reduce((s, l) => s + l.total_pagado, 0),
  });

  const thStyle = {
    padding: "8px 12px", textAlign: "left", fontWeight: 600,
    color: T.muted, fontSize: 11, letterSpacing: ".04em",
    borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap",
    background: T.bg,
  };

  if (loading) return <div style={{ padding: 40, color: T.muted, fontFamily: T.font, fontSize: 13 }}>Cargando…</div>;

  return (
    <div style={{ padding: 24, fontFamily: T.font, color: T.text }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Liquidación — HQ</h2>
        <select value={mes} onChange={e => setMes(Number(e.target.value))}
          style={{ border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: T.font }}>
          {MESES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
        </select>
        <input type="number" value={anio} onChange={e => setAnio(Number(e.target.value))}
          style={{ border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, width: 80, fontFamily: T.font }} />
        <button onClick={handleInicializar} disabled={saving} style={{
          marginLeft: "auto", background: T.blue, color: "#fff", border: "none",
          borderRadius: 7, padding: "8px 16px", fontSize: 13, fontWeight: 600,
          cursor: saving ? "not-allowed" : "pointer",
        }}>
          {saving ? "Procesando…" : "↻ Inicializar período"}
        </button>
      </div>

      {liqs.length === 0 ? (
        <div style={{ border: `1px dashed ${T.border}`, borderRadius: 8, padding: 40, textAlign: "center", color: T.muted, fontSize: 13 }}>
          No hay liquidación HQ para {MESES[mes-1]} {anio}. Usá "Inicializar período".
        </div>
      ) : (
        <>
          {/* ── HQ Staff ── */}
          {liqStaff.length > 0 && (
            <TablaHQ
              titulo="HQ Staff"
              liqs={liqStaff}
              totales={totales(liqStaff)}
              editandoId={editandoId}
              onEditar={setEditandoId}
              onCancelarEdicion={() => setEditandoId(null)}
              onSaved={async (liq, draft, actualizarLegajo) => {
                await saveLiquidacion({ ...liq, ...draft });
                if (actualizarLegajo && draft.nuevo_total) {
                  const leg = legajos.find(l => l.id === liq.legajo_id);
                  if (leg) await updateLegajo(leg.id, { sueldo_total: draft.nuevo_total });
                }
                setEditandoId(null);
                await load();
              }}
              onAgregarNovedad={setShowNovedad}
              onEliminarNovedad={async (id) => { await deleteNovedad(id); await load(); }}
              onRegistrarPago={setShowPago}
              thStyle={thStyle}
            />
          )}

          {/* ── HQ Owner ── */}
          {liqOwners.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: T.purple }}>⬡ Socios / HQ Owner</h3>
                <span style={{ fontSize: 11, color: T.muted, background: "#f3e8ff", padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>
                  Sin cargas sociales · Análisis separado
                </span>
              </div>
              <TablaHQ
                liqs={liqOwners}
                totales={totales(liqOwners)}
                editandoId={editandoId}
                onEditar={setEditandoId}
                onCancelarEdicion={() => setEditandoId(null)}
                onSaved={async (liq, draft, actualizarLegajo) => {
                  await saveLiquidacion({ ...liq, ...draft });
                  if (actualizarLegajo && draft.nuevo_total) {
                    const leg = legajos.find(l => l.id === liq.legajo_id);
                    if (leg) await updateLegajo(leg.id, { sueldo_total: draft.nuevo_total });
                  }
                  setEditandoId(null);
                  await load();
                }}
                onAgregarNovedad={setShowNovedad}
                onEliminarNovedad={async (id) => { await deleteNovedad(id); await load(); }}
                onRegistrarPago={setShowPago}
                thStyle={thStyle}
                ownerStyle
              />
            </div>
          )}
        </>
      )}

      {/* Modal: agregar novedad */}
      {showNovedad && (
        <ModalNovedad
          mes={mes} anio={anio}
          legajo={legajos.find(l => l.id === showNovedad) ?? { id: showNovedad, nombre: showNovedad }}
          onClose={() => setShowNovedad(null)}
          onSaved={async () => { setShowNovedad(null); await load(); }}
        />
      )}

      {/* Modal: registrar pago */}
      {showPago && (
        <ModalPagoHQ
          mes={mes} anio={anio}
          liq={liqs.find(l => l.legajo_id === showPago)}
          onClose={() => setShowPago(null)}
          onSaved={async () => { setShowPago(null); await load(); }}
        />
      )}
    </div>
  );
}

// ── Tabla HQ ─────────────────────────────────────────────────────────────────

function TablaHQ({ titulo, liqs, totales, editandoId, onEditar, onCancelarEdicion, onSaved, onAgregarNovedad, onEliminarNovedad, onRegistrarPago, thStyle, ownerStyle }) {
  const pendiente = totales.bruto - totales.pagado;

  return (
    <div>
      {titulo && <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: ownerStyle ? "#7c3aed" : "#1e293b" }}>{titulo}</h3>}

      {/* Totales del grupo */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 }}>
        {[
          { label: "Total calculado", value: totales.bruto },
          { label: "Total pagado",    value: totales.pagado,  color: "#16a34a" },
          { label: "Pendiente",       value: pendiente,        color: pendiente > 0 ? "#dc2626" : "#16a34a" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: color ?? "#1e293b" }}>{fmtMoney(value)}</div>
          </div>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Nombre","Sueldo total","Haberes","Monotrib.","Efectivo","Novedades","Total","Pagado","Pendiente",""].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {liqs.map((liq, i) => (
              <FilaHQ
                key={liq.id}
                liq={liq}
                idx={i}
                editando={editandoId === liq.id}
                ownerStyle={ownerStyle}
                onEditar={() => onEditar(liq.id)}
                onCancelarEdicion={onCancelarEdicion}
                onSaved={onSaved}
                onAgregarNovedad={() => onAgregarNovedad(liq.legajo_id)}
                onEliminarNovedad={onEliminarNovedad}
                onRegistrarPago={() => onRegistrarPago(liq.legajo_id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Fila HQ con edición inline ────────────────────────────────────────────────

function FilaHQ({ liq, idx, editando, ownerStyle, onEditar, onCancelarEdicion, onSaved, onAgregarNovedad, onEliminarNovedad, onRegistrarPago }) {
  const [pct,    setPct]    = useState("");
  const [draft,  setDraft]  = useState({});
  const [saving, setSaving] = useState(false);
  const [actualizarLegajo, setActualizarLegajo] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (editando) {
      setDraft({
        monto_haberes:     liq.monto_haberes    || liq.blanco_neto_legajo || 0,
        monto_monotributo: liq.monto_monotributo || 0,
        monto_efectivo:    liq.monto_efectivo    || 0,
      });
      setPct("");
      setActualizarLegajo(false);
    }
  }, [editando]);

  // Calcular nuevo total cuando cambia el %
  const totalLegajo = liq.sueldo_total_legajo || (liq.monto_haberes || 0) + (liq.monto_efectivo || 0);
  const nuevoTotal  = pct !== "" ? redondear(totalLegajo * (1 + parseFloat(pct) / 100)) : null;

  // Cuando cambia el %, distribuir el nuevo total manteniendo haberes y ajustando efectivo
  useEffect(() => {
    if (nuevoTotal == null || !editando) return;
    const haberes = draft.monto_haberes || 0;
    setDraft(d => ({
      ...d,
      monto_efectivo: Math.max(0, nuevoTotal - haberes - (d.monto_monotributo || 0)),
      nuevo_total: nuevoTotal,
    }));
  }, [nuevoTotal]);

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      await onSaved(liq, draft, actualizarLegajo);
    } catch (e) {
      alert("Error: " + e.message);
      setSaving(false);
    } finally { savingRef.current = false; }
  };

  const totalFila    = (draft.monto_haberes || 0) + (draft.monto_monotributo || 0) + (draft.monto_efectivo || 0);
  const pendiente    = liq.pendiente;
  const novExtraTotal = (liq.total_novedades_extra || 0) + (liq.total_rendiciones || 0) - (liq.total_anticipos || 0);

  const tdStyle = (extra = {}) => ({
    padding: "9px 12px", borderBottom: `1px solid #e2e8f0`,
    background: idx % 2 === 0 ? "#fff" : "#f8fafc",
    verticalAlign: "top", ...extra,
  });

  const inputTd = {
    border: "1px solid #93c5fd", borderRadius: 5, padding: "4px 6px",
    fontSize: 12, width: 90, textAlign: "right", fontFamily: "'Inter',sans-serif",
  };

  return (
    <>
      <tr>
        {/* Nombre */}
        <td style={tdStyle()}>
          <div style={{ fontWeight: 600 }}>{liq.legajo_nombre}</div>
          {(ownerStyle || liq.tipo_contratacion === "monotributista") && (
            <div style={{ fontSize: 11, marginTop: 2 }}>
              {ownerStyle && (
                <span style={{ background: "#f3e8ff", color: "#7c3aed", padding: "1px 5px", borderRadius: 3, fontWeight: 600 }}>Owner</span>
              )}
              {liq.tipo_contratacion === "monotributista" && (
                <span style={{ marginLeft: ownerStyle ? 4 : 0, background: "#f3e8ff", color: "#7c3aed", padding: "1px 5px", borderRadius: 3, fontWeight: 600, fontSize: 10 }}>M</span>
              )}
            </div>
          )}
        </td>
        {/* Sueldo total */}
        <td style={tdStyle({ textAlign: "right", fontWeight: 600, color: "#64748b" })}>{fmtMoney(liq.sueldo_total_legajo)}</td>
        {/* Haberes */}
        <td style={tdStyle({ textAlign: "right" })}>{fmtMoney(liq.monto_haberes)}</td>
        {/* Monotrib */}
        <td style={tdStyle({ textAlign: "right", color: liq.monto_monotributo > 0 ? "#7c3aed" : "#94a3b8" })}>
          {liq.monto_monotributo > 0 ? fmtMoney(liq.monto_monotributo) : "—"}
        </td>
        {/* Efectivo */}
        <td style={tdStyle({ textAlign: "right", color: liq.monto_efectivo > 0 ? "#ca8a04" : "#94a3b8" })}>
          {liq.monto_efectivo > 0 ? fmtMoney(liq.monto_efectivo) : "—"}
        </td>
        {/* Novedades */}
        <td style={tdStyle({ textAlign: "right" })}>
          {novExtraTotal !== 0
            ? <span style={{ color: novExtraTotal > 0 ? "#16a34a" : "#dc2626" }}>{novExtraTotal > 0 ? "+" : ""}{fmtMoney(Math.abs(novExtraTotal))}</span>
            : <span style={{ color: "#94a3b8" }}>—</span>}
          {liq.novedades?.length > 0 && (
            <button onClick={() => onAgregarNovedad()} style={{ display: "block", marginTop: 2, background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#94a3b8", padding: 0, textDecoration: "underline" }}>
              {liq.novedades.length} nov.
            </button>
          )}
        </td>
        {/* Total */}
        <td style={tdStyle({ textAlign: "right", fontWeight: 700 })}>{fmtMoney(liq.total_bruto)}</td>
        {/* Pagado */}
        <td style={tdStyle({ textAlign: "right", color: "#16a34a" })}>{fmtMoney(liq.total_pagado)}</td>
        {/* Pendiente */}
        <td style={tdStyle({ textAlign: "right", fontWeight: 600, color: pendiente > 0 ? "#dc2626" : "#16a34a" })}>
          {fmtMoney(pendiente)}
        </td>
        {/* Acciones */}
        <td style={tdStyle({ whiteSpace: "nowrap" })}>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={onEditar} title="Editar"
              style={{ background: "transparent", border: "1px solid #93c5fd", borderRadius: 5, padding: "3px 7px", cursor: "pointer", fontSize: 11, color: "#2563eb" }}>✏️</button>
            <button onClick={onAgregarNovedad} title="Novedad"
              style={{ background: "transparent", border: "1px solid #86efac", borderRadius: 5, padding: "3px 7px", cursor: "pointer", fontSize: 11, color: "#16a34a" }}>+</button>
            <button onClick={onRegistrarPago} title="Pago"
              style={{ background: "transparent", border: "1px solid #fde68a", borderRadius: 5, padding: "3px 7px", cursor: "pointer", fontSize: 11, color: "#ca8a04" }}>💳</button>
          </div>
        </td>
      </tr>

      {/* Fila de pagos registrados */}
      {liq.pagos?.length > 0 && !editando && (
        <tr>
          <td colSpan={10} style={{ padding: "4px 12px 6px 28px", background: "#f0fdf4", fontSize: 12, color: "#16a34a", borderBottom: "1px solid #e2e8f0" }}>
            {liq.pagos.map(p => (
              <span key={p.id} style={{ marginRight: 14 }}>
                {p.tipo_componente}: {fmtMoney(p.monto)} ({p.fecha})
              </span>
            ))}
          </td>
        </tr>
      )}

      {/* Fila de edición */}
      {editando && (
        <tr>
          <td colSpan={10} style={{ background: "#eff6ff", padding: "14px 16px", borderBottom: `1px solid #bfdbfe` }}>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
              {/* Referencia del legajo */}
              <div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 4 }}>Sueldo en legajo</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>{fmtMoney(totalLegajo)}</div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>({fmtMoney(liq.blanco_neto_legajo)} blanco)</div>
              </div>

              {/* % de aumento */}
              <div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 4 }}>% de aumento</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="number"
                    value={pct}
                    onChange={e => setPct(e.target.value)}
                    placeholder="0"
                    style={{ ...inputTd, width: 60, border: "1px solid #2563eb" }}
                  />
                  <span style={{ fontSize: 12, color: "#64748b" }}>%</span>
                  {nuevoTotal != null && (
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#16a34a" }}>
                      → {fmtMoney(nuevoTotal)}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ width: 1, height: 40, background: "#bfdbfe", alignSelf: "center" }} />

              {/* Edición de componentes */}
              {[
                { k: "monto_haberes",     label: "Haberes" },
                { k: "monto_monotributo", label: "Monotrib." },
                { k: "monto_efectivo",    label: "Efectivo" },
              ].map(({ k, label }) => (
                <div key={k}>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 4 }}>{label}</div>
                  <input
                    type="number"
                    value={draft[k] ?? 0}
                    onChange={e => setDraft(d => ({ ...d, [k]: parseFloat(e.target.value) || 0 }))}
                    style={inputTd}
                  />
                </div>
              ))}

              <div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 4 }}>Nuevo total</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{fmtMoney(totalFila)}</div>
              </div>

              <div style={{ width: 1, height: 40, background: "#bfdbfe", alignSelf: "center" }} />

              {/* Acciones */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={actualizarLegajo}
                    onChange={e => setActualizarLegajo(e.target.checked)}
                  />
                  Actualizar sueldo en legajo
                </label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={handleSave} disabled={saving} style={{
                    background: saving ? "#94a3b8" : "#2563eb", color: "#fff", border: "none",
                    borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer",
                  }}>{saving ? "Guardando…" : "Guardar"}</button>
                  <button onClick={onCancelarEdicion} style={{
                    border: "1px solid #94a3b8", background: "#fff", borderRadius: 6,
                    padding: "7px 14px", fontSize: 12, cursor: "pointer", color: "#1e293b",
                  }}>Cancelar</button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Modal novedad ─────────────────────────────────────────────────────────────

function ModalNovedad({ mes, anio, legajo, onClose, onSaved }) {
  const [form, setForm] = useState({ tipo: "extra", descripcion: "", monto: "", cuenta_contable_nombre: "" });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!form.descripcion.trim() || !form.monto) { alert("Completá descripción y monto."); return; }
    savingRef.current = true; setSaving(true);
    try {
      await appendNovedad({ mes, anio, legajo_id: legajo.id, legajo_nombre: legajo.nombre, tipo: form.tipo, descripcion: form.descripcion, monto: parseFloat(form.monto) || 0, cuenta_contable_nombre: form.cuenta_contable_nombre });
      await onSaved();
    } catch (e) { alert("Error: " + e.message); setSaving(false); } finally { savingRef.current = false; }
  };

  const inputStyle = { border: "1px solid #e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "'Inter',sans-serif", width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 380, boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: "'Inter',sans-serif" }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Novedad — {legajo.nombre}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 3 }}>Tipo</label>
            <select style={inputStyle} value={form.tipo} onChange={e => set("tipo", e.target.value)}>
              <option value="extra">Extra / bonus</option>
              <option value="anticipo">Anticipo</option>
              <option value="rendicion">Rendición de gastos</option>
            </select>
          </div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 3 }}>Descripción</label><input style={inputStyle} value={form.descripcion} onChange={e => set("descripcion", e.target.value)} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 3 }}>Monto (ARS)</label><input style={inputStyle} type="number" value={form.monto} onChange={e => set("monto", e.target.value)} /></div>
          {form.tipo === "rendicion" && (
            <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 3 }}>Cuenta contable</label><input style={inputStyle} value={form.cuenta_contable_nombre} onChange={e => set("cuenta_contable_nombre", e.target.value)} placeholder="Ej: Viáticos" /></div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ border: "1px solid #94a3b8", background: "#fff", borderRadius: 7, padding: "7px 14px", fontSize: 13, cursor: "pointer", color: "#1e293b" }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{ background: saving ? "#94a3b8" : "#2563eb", color: "#fff", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Guardando…" : "Agregar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal pago HQ ─────────────────────────────────────────────────────────────

function ModalPagoHQ({ mes, anio, liq, onClose, onSaved }) {
  const [form, setForm] = useState({
    tipo_componente: "haberes",
    monto: liq?.monto_haberes ?? "",
    fecha: new Date().toISOString().slice(0, 10),
    cuenta_bancaria_nombre: "",
    concepto: "",
  });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleTipo = (tipo) => {
    let monto = "";
    if (tipo === "haberes")        monto = liq?.monto_haberes    ?? "";
    if (tipo === "monotributista") monto = liq?.monto_monotributo ?? "";
    if (tipo === "efectivo")       monto = liq?.monto_efectivo    ?? "";
    set("tipo_componente", tipo);
    if (monto) set("monto", monto);
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!form.monto || !form.cuenta_bancaria_nombre) { alert("Completá monto y cuenta bancaria."); return; }
    savingRef.current = true; setSaving(true);
    try {
      await appendPago({
        mes, anio,
        legajo_id: liq.legajo_id, legajo_nombre: liq.legajo_nombre,
        sociedad_id: liq.sociedad_id, sociedad_nombre: liq.sociedad_nombre,
        tipo_componente: form.tipo_componente,
        monto: parseFloat(form.monto) || 0,
        fecha: form.fecha,
        cuenta_bancaria_id: form.cuenta_bancaria_nombre,
        cuenta_bancaria_nombre: form.cuenta_bancaria_nombre,
        concepto: form.concepto,
      });
      await onSaved();
    } catch (e) { alert("Error: " + e.message); setSaving(false); } finally { savingRef.current = false; }
  };

  const inputStyle = { border: "1px solid #e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "'Inter',sans-serif", width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: "'Inter',sans-serif" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>Registrar pago — {liq?.legajo_nombre}</h3>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: "#64748b" }}>Pendiente: {fmtMoney(liq?.pendiente)}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 3 }}>Componente</label>
            <select style={inputStyle} value={form.tipo_componente} onChange={e => handleTipo(e.target.value)}>
              <option value="haberes">Haberes (recibo / transferencia)</option>
              <option value="monotributista">Factura monotributo</option>
              <option value="efectivo">Efectivo</option>
              <option value="rendicion">Rendición de gastos</option>
            </select>
          </div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 3 }}>Monto (ARS)</label><input style={inputStyle} type="number" value={form.monto} onChange={e => set("monto", e.target.value)} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 3 }}>Fecha</label><input style={inputStyle} type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 3 }}>Cuenta bancaria</label><input style={inputStyle} value={form.cuenta_bancaria_nombre} onChange={e => set("cuenta_bancaria_nombre", e.target.value)} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 3 }}>Concepto (opcional)</label><input style={inputStyle} value={form.concepto} onChange={e => set("concepto", e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ border: "1px solid #94a3b8", background: "#fff", borderRadius: 7, padding: "7px 14px", fontSize: 13, cursor: "pointer", color: "#1e293b" }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{ background: saving ? "#94a3b8" : "#16a34a", color: "#fff", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Procesando…" : "Registrar y enviar a Tesorería"}
          </button>
        </div>
      </div>
    </div>
  );
}
