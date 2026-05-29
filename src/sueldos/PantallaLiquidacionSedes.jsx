import { useState, useEffect, useRef, useMemo } from "react";
import {
  fetchLegajos, fetchLiquidaciones, saveLiquidacion, deleteLiquidacion,
  fetchNovedades, appendNovedad, deleteNovedad,
  fetchPagos, appendPago,
  calcTotalBruto, ROLES_SEDES,
} from "../lib/sueldosApi";

const T = {
  bg:     "#f8fafc",
  card:   "#ffffff",
  border: "#e2e8f0",
  text:   "#1e293b",
  muted:  "#64748b",
  dim:    "#94a3b8",
  blue:   "#2563eb",
  blueLt: "#eff6ff",
  red:    "#dc2626",
  green:  "#16a34a",
  greenLt:"#f0fdf4",
  yellow: "#ca8a04",
  font:   "'Inter', system-ui, sans-serif",
};

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const CONCEPTOS_COACH = [
  { key: "horas",        label: "Horas" },
  { key: "cdp",          label: "CDP convertidas" },
  { key: "one_shot",     label: "One-shot" },
  { key: "objetivos",    label: "Objetivos grupales" },
  { key: "feriados",     label: "Feriados" },
  { key: "programacion", label: "Programación" },
  { key: "bonos",        label: "Bonos" },
];

function fmtMoney(n) {
  if (!n && n !== 0) return "—";
  return "$" + Math.round(n).toLocaleString("es-AR");
}

const hoy = new Date();

export default function PantallaLiquidacionSedes() {
  const [mes,  setMes]  = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());

  const [legajos,      setLegajos]      = useState([]);
  const [liquidaciones, setLiquidaciones] = useState([]);
  const [novedades,    setNovedades]    = useState([]);
  const [pagos,        setPagos]        = useState([]);
  const [loading,      setLoading]      = useState(true);

  const [editandoId, setEditandoId]     = useState(null);  // id de liquidación en edición inline
  const [showNovedad, setShowNovedad]   = useState(null);  // legajo_id para agregar novedad
  const [showPago,    setShowPago]      = useState(null);  // legajo_id para registrar pago
  const [saving,      setSaving]        = useState(false);

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
      setLegajos(legs.filter(l => ROLES_SEDES.includes(l.rol) && l.activo));
      setLiquidaciones(liqs.filter(l => ROLES_SEDES.includes(l.rol)));
      setNovedades(novs);
      setPagos(pags);
    } finally {
      setLoading(false);
    }
  }

  // Inicializar liquidación para todos los legajos de sedes que no tengan registro aún
  async function handleInicializar() {
    const idsConLiq = new Set(liquidaciones.map(l => l.legajo_id));
    const nuevos = legajos.filter(l => !idsConLiq.has(l.id));
    if (nuevos.length === 0) { alert("Todos los empleados de sedes ya tienen liquidación para este período."); return; }
    setSaving(true);
    try {
      await Promise.all(nuevos.map(leg => saveLiquidacion({
        mes, anio,
        legajo_id:       leg.id,
        legajo_nombre:   leg.nombre,
        sociedad_id:     leg.sociedad_id,
        sociedad_nombre: leg.sociedad_nombre,
        sede_id:         leg.sede_id,
        sede_nombre:     leg.sede_nombre,
        rol:             leg.rol,
        tipo_contratacion: leg.tipo_contratacion,
        sueldo_base:     leg.blanco_neto,
        horas_monto_unit: leg.tarifa_hora,
        estado:          "borrador",
      })));
      await load();
    } finally { setSaving(false); }
  }

  // Enriquecer liquidaciones con novedades y pagos
  const liquidacionesEnriquecidas = useMemo(() => {
    return liquidaciones.map(liq => {
      const novsMias = novedades.filter(n => n.legajo_id === liq.legajo_id);
      const pagosMios = pagos.filter(p => p.legajo_id === liq.legajo_id);
      const totalNovExtra = novsMias.filter(n => n.tipo === "extra").reduce((s, n) => s + n.monto, 0);
      const totalRend     = novsMias.filter(n => n.tipo === "rendicion").reduce((s, n) => s + n.monto, 0);
      const totalAnticipo = novsMias.filter(n => n.tipo === "anticipo").reduce((s, n) => s + n.monto, 0);
      const totalPagado   = pagosMios.reduce((s, p) => s + p.monto, 0);
      const enriquecida = {
        ...liq,
        total_novedades_extra: totalNovExtra,
        total_rendiciones:     totalRend,
        total_anticipos:       totalAnticipo,
        novedades:             novsMias,
        pagos:                 pagosMios,
        total_pagado:          totalPagado,
      };
      enriquecida.total_bruto = calcTotalBruto(enriquecida);
      enriquecida.pendiente   = enriquecida.total_bruto - totalPagado;
      return enriquecida;
    });
  }, [liquidaciones, novedades, pagos]);

  // Totales del mes
  const totales = useMemo(() => ({
    bruto:   liquidacionesEnriquecidas.reduce((s, l) => s + l.total_bruto, 0),
    blanco:  liquidacionesEnriquecidas.reduce((s, l) => s + l.blanco_neto, 0),
    efectivo:liquidacionesEnriquecidas.reduce((s, l) => s + l.efectivo, 0),
    pagado:  liquidacionesEnriquecidas.reduce((s, l) => s + l.total_pagado, 0),
  }), [liquidacionesEnriquecidas]);

  if (loading) return <div style={{ padding: 40, color: T.muted, fontFamily: T.font, fontSize: 13 }}>Cargando…</div>;

  return (
    <div style={{ padding: 24, fontFamily: T.font, color: T.text }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Liquidación — Sedes</h2>
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

      {/* Resumen del mes */}
      {liquidacionesEnriquecidas.length > 0 && (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20,
        }}>
          {[
            { label: "Total bruto", value: totales.bruto, color: T.text },
            { label: "Blanco (haberes)", value: totales.blanco, color: T.blue },
            { label: "Efectivo", value: totales.efectivo, color: T.yellow },
            { label: "Total pagado", value: totales.pagado, color: T.green },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background: T.card, border: `1px solid ${T.border}`, borderRadius: 8,
              padding: "12px 16px",
            }}>
              <div style={{ fontSize: 11, color: T.muted, fontWeight: 600, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color }}>{fmtMoney(value)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabla de liquidaciones */}
      {liquidacionesEnriquecidas.length === 0 ? (
        <div style={{
          border: `1px dashed ${T.border}`, borderRadius: 8, padding: 40,
          textAlign: "center", color: T.muted, fontSize: 13,
        }}>
          No hay liquidación para {MESES[mes-1]} {anio}.<br />
          Hacé clic en "↻ Inicializar período" para crear los registros a partir de los legajos activos.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.bg }}>
                {["Empleado","Rol","Sede","Base","Variable","Novedades","Total","Pagado","Pendiente",""].map(h => (
                  <th key={h} style={{
                    padding: "8px 10px", textAlign: "left", fontWeight: 600,
                    color: T.muted, fontSize: 11, letterSpacing: ".04em",
                    borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {liquidacionesEnriquecidas.map((liq, i) => (
                <FilaLiquidacion
                  key={liq.id}
                  liq={liq}
                  idx={i}
                  editando={editandoId === liq.id}
                  onEditar={() => setEditandoId(liq.id)}
                  onCancelarEdicion={() => setEditandoId(null)}
                  onSaved={async (updated) => {
                    await saveLiquidacion({ ...liq, ...updated });
                    setEditandoId(null);
                    await load();
                  }}
                  onAgregarNovedad={() => setShowNovedad(liq.legajo_id)}
                  onEliminarNovedad={async (novId) => {
                    await deleteNovedad(novId);
                    await load();
                  }}
                  onRegistrarPago={() => setShowPago(liq.legajo_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
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
        <ModalPago
          mes={mes} anio={anio}
          liq={liquidacionesEnriquecidas.find(l => l.legajo_id === showPago)}
          onClose={() => setShowPago(null)}
          onSaved={async () => { setShowPago(null); await load(); }}
        />
      )}
    </div>
  );
}

// ── Fila de liquidación (edición inline de cantidades y montos unit) ──────────

function FilaLiquidacion({ liq, idx, editando, onEditar, onCancelarEdicion, onSaved, onAgregarNovedad, onEliminarNovedad, onRegistrarPago }) {
  const [draft, setDraft] = useState({});

  useEffect(() => {
    if (editando) setDraft({ ...liq });
  }, [editando]);

  const setD = (k, v) => setDraft(d => {
    const next = { ...d, [k]: v === "" ? 0 : Number(v) };
    // Recalcular total del concepto al cambiar cant o unit
    CONCEPTOS_COACH.forEach(({ key }) => {
      next[`${key}_total`] = (next[`${key}_cant`] || 0) * (next[`${key}_monto_unit`] || 0);
    });
    next.sueldo_base = next.sueldo_base ?? liq.sueldo_base;
    return next;
  });

  const esCoach = ["COACH", "COACH_SENIOR"].includes(liq.rol);
  const variable = esCoach
    ? CONCEPTOS_COACH.reduce((s, { key }) => s + (liq[`${key}_total`] || 0), 0)
    : 0;

  const novsExtra = liq.novedades?.filter(n => n.tipo !== "anticipo") ?? [];
  const anticipos = liq.novedades?.filter(n => n.tipo === "anticipo") ?? [];

  const estadoColor = liq.estado === "cerrado" ? T.green : T.yellow;
  const pendienteColor = liq.pendiente <= 0 ? T.green : T.red;

  const tdStyle = { padding: "9px 10px", verticalAlign: "top" };
  const numStyle = { textAlign: "right" };

  return (
    <>
      <tr style={{ background: idx % 2 === 0 ? T.card : T.bg, borderBottom: `1px solid ${T.border}` }}>
        <td style={tdStyle}>
          <div style={{ fontWeight: 600 }}>{liq.legajo_nombre}</div>
          <div style={{ fontSize: 11, color: T.muted }}>{liq.tipo_contratacion === "monotributista" ? "Monotrib." : "Dep."}</div>
        </td>
        <td style={tdStyle}>
          <span style={{ fontSize: 11, background: "#dbeafe", color: "#1e40af", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>
            {liq.rol}
          </span>
        </td>
        <td style={{ ...tdStyle, color: T.muted }}>{liq.sede_nombre || "—"}</td>
        <td style={{ ...tdStyle, ...numStyle }}>{fmtMoney(liq.sueldo_base)}</td>
        <td style={{ ...tdStyle, ...numStyle }}>{fmtMoney(variable)}</td>
        <td style={tdStyle}>
          {novsExtra.length > 0 ? (
            <div style={{ fontSize: 12, color: T.muted }}>
              {novsExtra.map(n => (
                <div key={n.id} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ flex: 1 }}>{n.descripcion}: {fmtMoney(n.tipo === "rendicion" ? n.monto : n.monto)}</span>
                  <button onClick={() => onEliminarNovedad(n.id)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: T.dim, fontSize: 11 }}>✕</button>
                </div>
              ))}
            </div>
          ) : <span style={{ color: T.dim, fontSize: 12 }}>—</span>}
          {anticipos.length > 0 && (
            <div style={{ fontSize: 12, color: T.red }}>
              {anticipos.map(n => <div key={n.id}>Anticipo: −{fmtMoney(n.monto)}</div>)}
            </div>
          )}
        </td>
        <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{fmtMoney(liq.total_bruto)}</td>
        <td style={{ ...tdStyle, ...numStyle, color: T.green }}>{fmtMoney(liq.total_pagado)}</td>
        <td style={{ ...tdStyle, ...numStyle, color: pendienteColor, fontWeight: 600 }}>
          {fmtMoney(liq.pendiente)}
        </td>
        <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
          <button onClick={onEditar} title="Editar cantidades"
            style={{ background: "transparent", border: `1px solid #93c5fd`, borderRadius: 5, padding: "3px 7px", cursor: "pointer", fontSize: 11, color: T.blue, marginRight: 3 }}>
            ✏️
          </button>
          <button onClick={onAgregarNovedad} title="Agregar novedad"
            style={{ background: "transparent", border: `1px solid #86efac`, borderRadius: 5, padding: "3px 7px", cursor: "pointer", fontSize: 11, color: T.green, marginRight: 3 }}>
            +
          </button>
          <button onClick={onRegistrarPago} title="Registrar pago"
            style={{ background: "transparent", border: `1px solid #fde68a`, borderRadius: 5, padding: "3px 7px", cursor: "pointer", fontSize: 11, color: T.yellow }}>
            💳
          </button>
        </td>
      </tr>

      {/* Fila de edición inline */}
      {editando && (
        <tr style={{ background: "#eff6ff" }}>
          <td colSpan={10} style={{ padding: "12px 10px" }}>
            <EditarConceptos
              draft={draft}
              esCoach={esCoach}
              onChange={setD}
              onSave={() => onSaved(draft)}
              onCancel={onCancelarEdicion}
            />
          </td>
        </tr>
      )}

      {/* Fila de pagos registrados */}
      {liq.pagos?.length > 0 && (
        <tr style={{ background: T.greenLt }}>
          <td colSpan={10} style={{ padding: "6px 10px 6px 30px", fontSize: 12, color: T.green }}>
            Pagos registrados:{" "}
            {liq.pagos.map(p => (
              <span key={p.id} style={{ marginRight: 12 }}>
                {p.tipo_componente}: {fmtMoney(p.monto)} ({p.fecha})
              </span>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

function EditarConceptos({ draft, esCoach, onChange, onSave, onCancel }) {
  const inputStyle = {
    border: `1px solid #93c5fd`, borderRadius: 5, padding: "4px 6px",
    fontSize: 12, width: 80, textAlign: "right", fontFamily: "'Inter', sans-serif",
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.muted }}>Base:</span>
        <input style={inputStyle} type="number" value={draft.sueldo_base ?? 0}
          onChange={e => onChange("sueldo_base", e.target.value)} />
      </div>
      {esCoach && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8, marginBottom: 10 }}>
          {CONCEPTOS_COACH.map(({ key, label }) => (
            <div key={key} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
              <span style={{ minWidth: 110, color: T.muted }}>{label}:</span>
              <input style={inputStyle} type="number" value={draft[`${key}_cant`] ?? 0}
                onChange={e => onChange(`${key}_cant`, e.target.value)} placeholder="cant" />
              <span style={{ color: T.dim }}>×</span>
              <input style={inputStyle} type="number" value={draft[`${key}_monto_unit`] ?? 0}
                onChange={e => onChange(`${key}_monto_unit`, e.target.value)} placeholder="$/u" />
              <span style={{ color: T.muted, minWidth: 60, textAlign: "right" }}>
                = {fmtMoney((draft[`${key}_cant`] || 0) * (draft[`${key}_monto_unit`] || 0))}
              </span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onSave} style={{
          background: T.blue, color: "#fff", border: "none", borderRadius: 6,
          padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}>Guardar</button>
        <button onClick={onCancel} style={{
          border: `1px solid ${T.border}`, background: T.card, borderRadius: 6,
          padding: "6px 14px", fontSize: 12, cursor: "pointer",
        }}>Cancelar</button>
      </div>
    </div>
  );
}

// ── Modal: agregar novedad ────────────────────────────────────────────────────

function ModalNovedad({ mes, anio, legajo, onClose, onSaved }) {
  const [form, setForm] = useState({ tipo: "extra", descripcion: "", monto: "", cuenta_contable_nombre: "" });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!form.descripcion.trim()) { alert("Ingresá una descripción."); return; }
    if (!form.monto) { alert("Ingresá el monto."); return; }
    savingRef.current = true; setSaving(true);
    try {
      await appendNovedad({
        mes, anio,
        legajo_id:              legajo.id,
        legajo_nombre:          legajo.nombre,
        tipo:                   form.tipo,
        descripcion:            form.descripcion,
        monto:                  parseFloat(form.monto) || 0,
        cuenta_contable_nombre: form.cuenta_contable_nombre,
      });
      await onSaved();
    } catch (e) {
      alert("Error: " + e.message);
      setSaving(false);
    } finally { savingRef.current = false; }
  };

  const inputStyle = { border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: T.font, width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: T.card, borderRadius: 12, padding: 24, width: 380, boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: T.font }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Novedad — {legajo.nombre}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Tipo</label>
            <select style={inputStyle} value={form.tipo} onChange={e => set("tipo", e.target.value)}>
              <option value="extra">Extra / bonus</option>
              <option value="anticipo">Anticipo (resta del total)</option>
              <option value="rendicion">Rendición de gastos</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Descripción</label>
            <input style={inputStyle} value={form.descripcion} onChange={e => set("descripcion", e.target.value)} placeholder="Ej: Comisión referidos" />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Monto (ARS)</label>
            <input style={inputStyle} type="number" value={form.monto} onChange={e => set("monto", e.target.value)} />
          </div>
          {form.tipo === "rendicion" && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Cuenta contable del gasto</label>
              <input style={inputStyle} value={form.cuenta_contable_nombre} onChange={e => set("cuenta_contable_nombre", e.target.value)} placeholder="Ej: Viáticos y transporte" />
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ border: `1px solid ${T.border}`, background: T.card, borderRadius: 7, padding: "7px 14px", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{
            background: saving ? T.dim : T.blue, color: "#fff", border: "none",
            borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
          }}>
            {saving ? "Guardando…" : "Agregar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: registrar pago ─────────────────────────────────────────────────────

function ModalPago({ mes, anio, liq, onClose, onSaved }) {
  const [form, setForm] = useState({
    tipo_componente:       "haberes",
    monto:                 liq?.blanco_neto ?? "",
    fecha:                 new Date().toISOString().slice(0, 10),
    cuenta_bancaria_nombre:"",
    cuenta_bancaria_id:    "",
    concepto:              "",
  });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Pre-llenar monto según tipo de componente
  const handleTipo = (tipo) => {
    let monto = "";
    if (tipo === "haberes")   monto = liq?.blanco_neto ?? "";
    if (tipo === "efectivo")  monto = liq?.efectivo ?? "";
    set("tipo_componente", tipo);
    if (monto) set("monto", monto);
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!form.monto)                     { alert("Ingresá el monto."); return; }
    if (!form.cuenta_bancaria_nombre)    { alert("Ingresá la cuenta bancaria."); return; }
    savingRef.current = true; setSaving(true);
    try {
      await appendPago({
        mes, anio,
        legajo_id:              liq.legajo_id,
        legajo_nombre:          liq.legajo_nombre,
        sociedad_id:            liq.sociedad_id,
        sociedad_nombre:        liq.sociedad_nombre,
        tipo_componente:        form.tipo_componente,
        monto:                  parseFloat(form.monto) || 0,
        fecha:                  form.fecha,
        cuenta_bancaria_id:     form.cuenta_bancaria_id || form.cuenta_bancaria_nombre,
        cuenta_bancaria_nombre: form.cuenta_bancaria_nombre,
        concepto:               form.concepto,
      });
      await onSaved();
    } catch (e) {
      alert("Error al registrar pago: " + e.message);
      setSaving(false);
    } finally { savingRef.current = false; }
  };

  const inputStyle = { border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: T.font, width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: T.card, borderRadius: 12, padding: 24, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: T.font }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>Registrar pago — {liq?.legajo_nombre}</h3>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: T.muted }}>
          Total calculado: {fmtMoney(liq?.total_bruto)} · Pagado: {fmtMoney(liq?.total_pagado)} · Pendiente: {fmtMoney(liq?.pendiente)}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Tipo de pago</label>
            <select style={inputStyle} value={form.tipo_componente} onChange={e => handleTipo(e.target.value)}>
              <option value="haberes">Haberes (blanco / transferencia)</option>
              <option value="efectivo">Efectivo</option>
              <option value="monotributista">Factura monotributo</option>
              <option value="rendicion">Rendición de gastos</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Monto (ARS)</label>
            <input style={inputStyle} type="number" value={form.monto} onChange={e => set("monto", e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Fecha</label>
            <input style={inputStyle} type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Cuenta bancaria</label>
            <input style={inputStyle} value={form.cuenta_bancaria_nombre}
              onChange={e => set("cuenta_bancaria_nombre", e.target.value)} placeholder="Ej: Galicia ARS Hektor" />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Concepto (opcional)</label>
            <input style={inputStyle} value={form.concepto} onChange={e => set("concepto", e.target.value)} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ border: `1px solid ${T.border}`, background: T.card, borderRadius: 7, padding: "7px 14px", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
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
