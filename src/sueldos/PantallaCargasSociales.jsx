import { useState, useEffect, useRef } from "react";
import { fetchCargasSociales, saveCargasSociales, pagarCargasSociales } from "../lib/sueldosApi";

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
const FORM_VACIO = {
  sociedad_id: "", sociedad_nombre: "",
  monto_total: "",
  distribucion: {},
  fecha_vto: "",
};

function fmtMoney(n) {
  return "$" + Math.round(n).toLocaleString("es-AR");
}

export default function PantallaCargasSociales({ mes: mesProp, anio: anioProp, pais = "" }) {
  const [mes,  setMes]  = useState(mesProp  ?? MES_DEF);
  const [anio, setAnio] = useState(anioProp ?? ANO_DEF);
  const [cargas,  setCargas]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [paganado, setPagando]  = useState(null);

  useEffect(() => { load(); }, [mes, anio]);

  async function load() {
    setLoading(true);
    try { setCargas(await fetchCargasSociales(mes, anio)); } finally { setLoading(false); }
  }

  const totalMes = cargas.reduce((s, c) => s + c.monto_total, 0);

  return (
    <div style={{ padding: 24, fontFamily: T.font, color: T.text, maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Cargas sociales</h2>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", alignItems: "center" }}>
          <select value={mes} onChange={e => setMes(Number(e.target.value))}
            style={{ border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: T.font }}>
            {MESES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
          <input type="number" value={anio} onChange={e => setAnio(Number(e.target.value))}
            style={{ border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, width: 80, fontFamily: T.font }} />
          <button onClick={() => setShowForm(true)} style={{
            background: T.blue, color: "#fff", border: "none", borderRadius: 7,
            padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>+ Cargar F931</button>
        </div>
      </div>

      {/* Total */}
      {cargas.length > 0 && (
        <div style={{
          background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8,
          padding: "12px 16px", marginBottom: 16, display: "flex", gap: 24,
        }}>
          <span style={{ fontSize: 13, color: T.muted }}>Total del mes:</span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{fmtMoney(totalMes)}</span>
          <span style={{ fontSize: 13, color: T.muted, marginLeft: "auto" }}>
            {cargas.filter(c => c.pagado).length} de {cargas.length} pagadas
          </span>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <p style={{ color: T.muted, fontSize: 13 }}>Cargando…</p>
      ) : cargas.length === 0 ? (
        <div style={{
          border: `1px dashed ${T.border}`, borderRadius: 8, padding: 40,
          textAlign: "center", color: T.muted, fontSize: 13,
        }}>
          No hay cargas sociales cargadas para {MESES[mes-1]} {anio}.<br />
          El contador las pasa aproximadamente el día 10.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {cargas.map(c => (
            <CargaCard
              key={c.id}
              carga={c}
              mes={mes}
              anio={anio}
              onPagar={async (datos) => {
                setPagando(c.id);
                try {
                  await pagarCargasSociales({ ...datos, id: c.id, mes, anio, ...c });
                  await load();
                } catch (e) {
                  alert("Error: " + e.message);
                } finally {
                  setPagando(null);
                }
              }}
              pagandoEste={paganado === c.id}
            />
          ))}
        </div>
      )}

      {/* Modal nuevo F931 */}
      {showForm && (
        <FormCargaSocial
          mes={mes} anio={anio}
          onClose={() => setShowForm(false)}
          onSaved={async () => { setShowForm(false); await load(); }}
        />
      )}
    </div>
  );
}

function CargaCard({ carga, mes, anio, onPagar, pagandoEste }) {
  const [showPago, setShowPago] = useState(false);
  const [form, setForm] = useState({ fecha: new Date().toISOString().slice(0,10), cuenta_bancaria_id: "", cuenta_bancaria_nombre: "" });

  const dist = Object.entries(carga.distribucion ?? {});

  return (
    <div style={{
      border: `1px solid ${carga.pagado ? "#bbf7d0" : T.border}`,
      borderRadius: 8, padding: 16, background: carga.pagado ? "#f0fdf4" : T.card,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{carga.sociedad_nombre || carga.sociedad_id}</span>
            {carga.pagado
              ? <span style={{ fontSize: 11, fontWeight: 600, color: T.green, background: "#dcfce7", padding: "2px 8px", borderRadius: 999 }}>✓ Pagado</span>
              : <span style={{ fontSize: 11, fontWeight: 600, color: "#92400e", background: "#fef3c7", padding: "2px 8px", borderRadius: 999 }}>Pendiente</span>}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{fmtMoney(carga.monto_total)}</div>
          {carga.fecha_vto && (
            <div style={{ fontSize: 12, color: T.muted }}>Vencimiento: {carga.fecha_vto}</div>
          )}
          {dist.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: T.muted }}>
              Distribución por CC:{" "}
              {dist.map(([ccId, val]) => (
                <span key={ccId} style={{ marginRight: 8 }}>
                  {val.cc_nombre || ccId}: {val.porcentaje?.toFixed(1)}% = {fmtMoney(val.monto)}
                </span>
              ))}
            </div>
          )}
        </div>
        {!carga.pagado && (
          <button onClick={() => setShowPago(v => !v)} style={{
            background: T.green, color: "#fff", border: "none", borderRadius: 7,
            padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>Registrar pago</button>
        )}
      </div>

      {showPago && !carga.pagado && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.border}`, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Fecha de pago</label>
            <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
              style={{ border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: "'Inter', sans-serif" }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Cuenta bancaria</label>
            <input value={form.cuenta_bancaria_nombre}
              onChange={e => setForm(f => ({ ...f, cuenta_bancaria_nombre: e.target.value, cuenta_bancaria_id: e.target.value }))}
              placeholder="Nombre de la cuenta"
              style={{ border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: "'Inter', sans-serif", width: 180 }} />
          </div>
          <button onClick={() => onPagar(form)} disabled={pagandoEste} style={{
            background: pagandoEste ? T.dim : T.green, color: "#fff", border: "none",
            borderRadius: 7, padding: "8px 16px", fontSize: 13, fontWeight: 600,
            cursor: pagandoEste ? "not-allowed" : "pointer",
          }}>
            {pagandoEste ? "Procesando…" : "Confirmar pago"}
          </button>
        </div>
      )}
    </div>
  );
}

function FormCargaSocial({ mes, anio, onClose, onSaved }) {
  const [form, setForm]     = useState({ ...FORM_VACIO });
  const [saving, setSaving] = useState(false);
  const savingRef           = useRef(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!form.sociedad_nombre.trim()) { alert("Ingresá la sociedad."); return; }
    if (!form.monto_total)            { alert("Ingresá el monto total."); return; }
    savingRef.current = true; setSaving(true);
    try {
      await saveCargasSociales({
        mes, anio,
        sociedad_id:      form.sociedad_id || form.sociedad_nombre,
        sociedad_nombre:  form.sociedad_nombre,
        monto_total:      parseFloat(form.monto_total) || 0,
        distribucion:     form.distribucion,
        fecha_vto:        form.fecha_vto,
        pagado:           false,
      });
      await onSaved();
    } catch (e) {
      alert("Error: " + e.message);
      setSaving(false);
    } finally { savingRef.current = false; }
  };

  const inputStyle = {
    border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px",
    fontSize: 13, fontFamily: T.font, width: "100%", boxSizing: "border-box",
  };
  const labelStyle = { fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 4, display: "block" };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.35)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{
        background: T.card, borderRadius: 12, padding: 28, width: 420,
        boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: T.font,
      }}>
        <h3 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 700 }}>
          Cargar F931 — {MESES[mes-1]} {anio}
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Sociedad</label>
            <input style={inputStyle} value={form.sociedad_nombre}
              onChange={e => set("sociedad_nombre", e.target.value)} placeholder="Ej: Hektor" />
          </div>
          <div>
            <label style={labelStyle}>Monto total (ARS)</label>
            <input style={inputStyle} type="number" value={form.monto_total}
              onChange={e => set("monto_total", e.target.value)} placeholder="0" />
          </div>
          <div>
            <label style={labelStyle}>Fecha de vencimiento</label>
            <input style={inputStyle} type="date" value={form.fecha_vto}
              onChange={e => set("fecha_vto", e.target.value)} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            border: `1px solid ${T.border}`, background: T.card, borderRadius: 7,
            padding: "8px 16px", fontSize: 13, cursor: "pointer", fontFamily: T.font,
          }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{
            background: saving ? T.dim : T.blue, color: "#fff", border: "none",
            borderRadius: 7, padding: "8px 20px", fontSize: 13, fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer", fontFamily: T.font,
          }}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
