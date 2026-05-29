import { useState, useEffect, useRef, useMemo } from "react";
import {
  fetchLegajos, fetchLiquidaciones, saveLiquidacion,
  fetchNovedades, appendNovedad, deleteNovedad,
  fetchPagos, appendPago,
  ROLES_HQ,
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
  greenLt:"#f0fdf4",
  yellow: "#ca8a04",
  purple: "#7c3aed",
  font:   "'Inter', system-ui, sans-serif",
};

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function fmtMoney(n) {
  if (!n && n !== 0) return "—";
  return "$" + Math.round(n).toLocaleString("es-AR");
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
        legajo_id:       leg.id,
        legajo_nombre:   leg.nombre,
        sociedad_id:     leg.sociedad_id,
        sociedad_nombre: leg.sociedad_nombre,
        sede_id:         leg.sede_id,
        sede_nombre:     leg.sede_nombre,
        rol:             leg.rol,
        tipo_contratacion: leg.tipo_contratacion,
        sueldo_base:     leg.blanco_neto,
        monto_haberes:   leg.blanco_neto,
        estado:          "borrador",
      })));
      await load();
    } finally { setSaving(false); }
  }

  const liqs = useMemo(() => {
    return liquidaciones.map(liq => {
      const novsMias  = novedades.filter(n => n.legajo_id === liq.legajo_id);
      const pagosMios = pagos.filter(p => p.legajo_id === liq.legajo_id);
      const totalNovExtra = novsMias.filter(n => n.tipo === "extra").reduce((s, n) => s + n.monto, 0);
      const totalRend     = novsMias.filter(n => n.tipo === "rendicion").reduce((s, n) => s + n.monto, 0);
      const totalAnticipo = novsMias.filter(n => n.tipo === "anticipo").reduce((s, n) => s + n.monto, 0);
      const totalPagado   = pagosMios.reduce((s, p) => s + p.monto, 0);
      const total_bruto = (liq.monto_haberes || 0) + (liq.monto_monotributo || 0) + (liq.monto_efectivo || 0) + totalNovExtra + totalRend - totalAnticipo;
      return { ...liq, novedades: novsMias, pagos: pagosMios, total_bruto, total_pagado: totalPagado, pendiente: total_bruto - totalPagado, total_novedades_extra: totalNovExtra, total_rendiciones: totalRend, total_anticipos: totalAnticipo };
    });
  }, [liquidaciones, novedades, pagos]);

  // Separar HQ_OWNER del resto
  const liqStaff = liqs.filter(l => l.rol === "HQ");
  const liqOwners = liqs.filter(l => l.rol === "HQ_OWNER");

  const totales = {
    bruto:  liqStaff.reduce((s, l) => s + l.total_bruto, 0),
    pagado: liqStaff.reduce((s, l) => s + l.total_pagado, 0),
  };
  const totalesOwner = {
    bruto:  liqOwners.reduce((s, l) => s + l.total_bruto, 0),
    pagado: liqOwners.reduce((s, l) => s + l.total_pagado, 0),
  };

  if (loading) return <div style={{ padding: 40, color: T.muted, fontFamily: T.font, fontSize: 13 }}>Cargando…</div>;

  return (
    <div style={{ padding: 24, fontFamily: T.font, color: T.text }}>
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
          borderRadius: 7, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer",
        }}>
          {saving ? "Procesando…" : "↻ Inicializar período"}
        </button>
      </div>

      {/* Sección HQ Staff */}
      <Seccion
        titulo="HQ Staff"
        liqs={liqStaff}
        totales={totales}
        editandoId={editandoId}
        onEditar={setEditandoId}
        onCancelarEdicion={() => setEditandoId(null)}
        onSaved={async (liq, draft) => { await saveLiquidacion({ ...liq, ...draft }); setEditandoId(null); await load(); }}
        onAgregarNovedad={setShowNovedad}
        onEliminarNovedad={async (id) => { await deleteNovedad(id); await load(); }}
        onRegistrarPago={setShowPago}
        emptyMsg={`No hay liquidación HQ para ${MESES[mes-1]} ${anio}. Usá "Inicializar período".`}
      />

      {/* Sección HQ Owner (sin cargas sociales) */}
      {(liqOwners.length > 0 || legajos.some(l => l.rol === "HQ_OWNER")) && (
        <div style={{ marginTop: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: T.purple }}>⬡ Socios / HQ Owner</h3>
            <span style={{ fontSize: 11, color: T.muted, background: "#f3e8ff", padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>
              Sin cargas sociales · Análisis separado
            </span>
          </div>
          <Seccion
            liqs={liqOwners}
            totales={totalesOwner}
            editandoId={editandoId}
            onEditar={setEditandoId}
            onCancelarEdicion={() => setEditandoId(null)}
            onSaved={async (liq, draft) => { await saveLiquidacion({ ...liq, ...draft }); setEditandoId(null); await load(); }}
            onAgregarNovedad={setShowNovedad}
            onEliminarNovedad={async (id) => { await deleteNovedad(id); await load(); }}
            onRegistrarPago={setShowPago}
            ownerStyle
            emptyMsg="No hay socios registrados como HQ_OWNER en los legajos."
          />
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

// ── Sección reutilizable ──────────────────────────────────────────────────────

function Seccion({ titulo, liqs, totales, editandoId, onEditar, onCancelarEdicion, onSaved, onAgregarNovedad, onEliminarNovedad, onRegistrarPago, ownerStyle, emptyMsg }) {
  const accentColor = ownerStyle ? T.purple : T.blue;

  return (
    <div>
      {titulo && <h3 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 700 }}>{titulo}</h3>}
      {liqs.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 }}>
          {[
            { label: "Total calculado", value: totales.bruto },
            { label: "Total pagado",    value: totales.pagado, color: T.green },
            { label: "Pendiente",       value: totales.bruto - totales.pagado, color: totales.bruto - totales.pagado > 0 ? T.red : T.green },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: color ?? T.text }}>{fmtMoney(value)}</div>
            </div>
          ))}
        </div>
      )}
      {liqs.length === 0 ? (
        <p style={{ color: T.muted, fontSize: 13 }}>{emptyMsg}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {liqs.map(liq => (
            <FilaHQ
              key={liq.id}
              liq={liq}
              editando={editandoId === liq.id}
              accentColor={accentColor}
              onEditar={() => onEditar(liq.id)}
              onCancelarEdicion={onCancelarEdicion}
              onSaved={(draft) => onSaved(liq, draft)}
              onAgregarNovedad={() => onAgregarNovedad(liq.legajo_id)}
              onEliminarNovedad={onEliminarNovedad}
              onRegistrarPago={() => onRegistrarPago(liq.legajo_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilaHQ({ liq, editando, accentColor, onEditar, onCancelarEdicion, onSaved, onAgregarNovedad, onEliminarNovedad, onRegistrarPago }) {
  const [draft, setDraft] = useState({});
  useEffect(() => { if (editando) setDraft({ ...liq }); }, [editando]);
  const setD = (k, v) => setDraft(d => ({ ...d, [k]: v === "" ? 0 : Number(v) }));

  const pendienteColor = liq.pendiente <= 0 ? T.green : T.red;
  const novsExtra = liq.novedades?.filter(n => n.tipo !== "anticipo") ?? [];

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, background: T.card, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{liq.legajo_nombre}</span>
            <span style={{ fontSize: 11, background: liq.rol === "HQ_OWNER" ? "#f3e8ff" : "#dbeafe", color: liq.rol === "HQ_OWNER" ? "#7e22ce" : "#1e40af", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>{liq.rol}</span>
            {liq.tipo_contratacion === "monotributista" && (
              <span style={{ fontSize: 11, background: "#f3e8ff", color: "#7e22ce", padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>Monotrib.</span>
            )}
            <span style={{ fontSize: 12, color: T.muted, marginLeft: 4 }}>{liq.sociedad_nombre}</span>
          </div>
          <div style={{ display: "flex", gap: 20, fontSize: 13 }}>
            <span>Haberes: <strong>{fmtMoney(liq.monto_haberes)}</strong></span>
            {liq.monto_monotributo > 0 && <span>Monotributo: <strong>{fmtMoney(liq.monto_monotributo)}</strong></span>}
            {liq.monto_efectivo > 0   && <span>Efectivo: <strong>{fmtMoney(liq.monto_efectivo)}</strong></span>}
            {novsExtra.length > 0     && <span style={{ color: T.green }}>+Novs: {fmtMoney(liq.total_novedades_extra + liq.total_rendiciones)}</span>}
            {liq.total_anticipos > 0  && <span style={{ color: T.red }}>−Anticipo: {fmtMoney(liq.total_anticipos)}</span>}
            <span style={{ fontWeight: 700 }}>Total: {fmtMoney(liq.total_bruto)}</span>
            <span style={{ color: T.green }}>Pagado: {fmtMoney(liq.total_pagado)}</span>
            <span style={{ color: pendienteColor, fontWeight: 600 }}>Pendiente: {fmtMoney(liq.pendiente)}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onEditar} style={{ background: "transparent", border: `1px solid #93c5fd`, borderRadius: 5, padding: "4px 8px", cursor: "pointer", fontSize: 12, color: T.blue }}>✏️</button>
          <button onClick={onAgregarNovedad} style={{ background: "transparent", border: `1px solid #86efac`, borderRadius: 5, padding: "4px 8px", cursor: "pointer", fontSize: 12, color: T.green }}>+ Nov.</button>
          <button onClick={onRegistrarPago} style={{ background: "transparent", border: `1px solid #fde68a`, borderRadius: 5, padding: "4px 8px", cursor: "pointer", fontSize: 12, color: T.yellow }}>💳 Pago</button>
        </div>
      </div>

      {/* Pagos registrados */}
      {liq.pagos?.length > 0 && (
        <div style={{ padding: "6px 16px 10px", borderTop: `1px solid ${T.border}`, background: T.greenLt }}>
          <span style={{ fontSize: 12, color: T.green, fontWeight: 600 }}>Pagos: </span>
          {liq.pagos.map(p => (
            <span key={p.id} style={{ fontSize: 12, color: T.muted, marginRight: 14 }}>
              {p.tipo_componente}: {fmtMoney(p.monto)} ({p.fecha})
            </span>
          ))}
        </div>
      )}

      {/* Edición inline */}
      {editando && (
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.border}`, background: "#eff6ff" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            {[
              { k: "monto_haberes",    label: "Haberes" },
              { k: "monto_monotributo", label: "Monotributo" },
              { k: "monto_efectivo",   label: "Efectivo" },
            ].map(({ k, label }) => (
              <div key={k}>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 3 }}>{label}</div>
                <input
                  type="number"
                  value={draft[k] ?? 0}
                  onChange={e => setD(k, e.target.value)}
                  style={{ border: `1px solid #93c5fd`, borderRadius: 5, padding: "5px 8px", fontSize: 13, width: 110, fontFamily: T.font }}
                />
              </div>
            ))}
            <button onClick={() => onSaved(draft)} style={{ background: T.blue, color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
            <button onClick={onCancelarEdicion} style={{ border: `1px solid ${T.border}`, background: T.card, borderRadius: 6, padding: "7px 14px", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Modal novedad (igual que Sedes) ──────────────────────────────────────────

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
              <option value="anticipo">Anticipo</option>
              <option value="rendicion">Rendición de gastos</option>
            </select>
          </div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Descripción</label><input style={inputStyle} value={form.descripcion} onChange={e => set("descripcion", e.target.value)} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Monto (ARS)</label><input style={inputStyle} type="number" value={form.monto} onChange={e => set("monto", e.target.value)} /></div>
          {form.tipo === "rendicion" && (
            <div><label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Cuenta contable</label><input style={inputStyle} value={form.cuenta_contable_nombre} onChange={e => set("cuenta_contable_nombre", e.target.value)} placeholder="Ej: Viáticos" /></div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ border: `1px solid ${T.border}`, background: T.card, borderRadius: 7, padding: "7px 14px", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{ background: saving ? T.dim : T.blue, color: "#fff", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Guardando…" : "Agregar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal pago HQ (multi-componente) ─────────────────────────────────────────

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
    if (tipo === "haberes")       monto = liq?.monto_haberes ?? "";
    if (tipo === "monotributista") monto = liq?.monto_monotributo ?? "";
    if (tipo === "efectivo")      monto = liq?.monto_efectivo ?? "";
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

  const inputStyle = { border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: T.font, width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: T.card, borderRadius: 12, padding: 24, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: T.font }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>Registrar pago — {liq?.legajo_nombre}</h3>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: T.muted }}>Pendiente: {fmtMoney(liq?.pendiente)}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Componente</label>
            <select style={inputStyle} value={form.tipo_componente} onChange={e => handleTipo(e.target.value)}>
              <option value="haberes">Haberes (recibo / transferencia)</option>
              <option value="monotributista">Factura monotributo</option>
              <option value="efectivo">Efectivo</option>
              <option value="rendicion">Rendición de gastos</option>
            </select>
          </div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Monto (ARS)</label><input style={inputStyle} type="number" value={form.monto} onChange={e => set("monto", e.target.value)} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Fecha</label><input style={inputStyle} type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Cuenta bancaria</label><input style={inputStyle} value={form.cuenta_bancaria_nombre} onChange={e => set("cuenta_bancaria_nombre", e.target.value)} /></div>
          <div><label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Concepto (opcional)</label><input style={inputStyle} value={form.concepto} onChange={e => set("concepto", e.target.value)} /></div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ border: `1px solid ${T.border}`, background: T.card, borderRadius: 7, padding: "7px 14px", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{ background: saving ? T.dim : T.green, color: "#fff", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Procesando…" : "Registrar y enviar a Tesorería"}
          </button>
        </div>
      </div>
    </div>
  );
}
