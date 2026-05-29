import { useState, useEffect, useRef, useMemo } from "react";
import {
  fetchLegajos, appendLegajo, updateLegajo, deleteLegajo,
  ROLES_SEDES, ROLES_HQ, TIPOS_CONTRATACION,
  fetchSociedadesNumbers, fetchCentrosCostoNumbers,
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

const TODOS_LOS_ROLES = [...ROLES_SEDES, ...ROLES_HQ];

const FORM_VACIO = {
  nombre: "", cuil: "", cbu: "", banco: "",
  sociedad_id: "", sociedad_nombre: "",
  sede_id: "", sede_nombre: "",
  rol: "COACH",
  tipo_contratacion: "relacion_dependencia",
  blanco_neto: "", tarifa_hora: "",
  activo: true,
  fecha_ingreso: "", fecha_alta: "",
  notas: "",
};

function chip(label, bg, color) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 999,
      fontSize: 11, fontWeight: 600, background: bg, color,
    }}>{label}</span>
  );
}

function rolChip(rol) {
  const isHQ = ROLES_HQ.includes(rol);
  return chip(rol, isHQ ? "#fef3c7" : "#dbeafe", isHQ ? "#92400e" : "#1e40af");
}

function tipoChip(tipo) {
  return tipo === "monotributista"
    ? chip("Monotrib.", "#f3e8ff", "#7e22ce")
    : chip("Dependencia", "#dcfce7", "#166534");
}

export default function PantallaLegajos() {
  const [legajos,    setLegajos]    = useState([]);
  const [sociedades, setSociedades] = useState([]);
  const [centrosCosto, setCentrosCosto] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [editing,    setEditing]    = useState(null);
  const [filtroRol,  setFiltroRol]  = useState("todos");
  const [filtroActivo, setFiltroActivo] = useState("activos");
  const [busqueda,   setBusqueda]   = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [legs, socs, ccs] = await Promise.all([
        fetchLegajos(),
        fetchSociedadesNumbers(),
        fetchCentrosCostoNumbers(),
      ]);
      setLegajos(legs);
      setSociedades(socs);
      setCentrosCosto(ccs);
    } finally { setLoading(false); }
  }

  const visibles = legajos.filter(l => {
    if (filtroActivo === "activos"   && !l.activo) return false;
    if (filtroActivo === "inactivos" && l.activo)  return false;
    if (filtroRol !== "todos" && l.rol !== filtroRol) return false;
    if (busqueda && !l.nombre.toLowerCase().includes(busqueda.toLowerCase())) return false;
    return true;
  });

  function handleNuevo() { setEditing(null); setShowForm(true); }
  function handleEditar(l) { setEditing(l); setShowForm(true); }

  async function handleEliminar(l) {
    if (!confirm(`¿Eliminar legajo de ${l.nombre}?`)) return;
    await deleteLegajo(l.id);
    await load();
  }

  if (showForm) {
    return (
      <FormLegajo
        initial={editing ?? FORM_VACIO}
        sociedades={sociedades}
        centrosCosto={centrosCosto}
        onClose={() => setShowForm(false)}
        onSaved={async () => { setShowForm(false); await load(); }}
      />
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: T.font, color: T.text, maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Legajos</h2>
        <span style={{ fontSize: 13, color: T.muted }}>({visibles.length} empleados)</span>
        <button
          onClick={handleNuevo}
          style={{
            marginLeft: "auto", background: T.blue, color: "#fff",
            border: "none", borderRadius: 7, padding: "8px 16px",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>
          + Nuevo legajo
        </button>
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre…"
          style={{
            border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px",
            fontSize: 13, fontFamily: T.font, width: 200,
          }}
        />
        <select
          value={filtroRol}
          onChange={e => setFiltroRol(e.target.value)}
          style={{ border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: T.font }}>
          <option value="todos">Todos los roles</option>
          <optgroup label="Sedes">{ROLES_SEDES.map(r => <option key={r} value={r}>{r}</option>)}</optgroup>
          <optgroup label="HQ">{ROLES_HQ.map(r => <option key={r} value={r}>{r}</option>)}</optgroup>
        </select>
        <select
          value={filtroActivo}
          onChange={e => setFiltroActivo(e.target.value)}
          style={{ border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: T.font }}>
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
          <option value="todos">Todos</option>
        </select>
      </div>

      {/* Tabla */}
      {loading ? (
        <p style={{ color: T.muted, fontSize: 13 }}>Cargando…</p>
      ) : visibles.length === 0 ? (
        <p style={{ color: T.muted, fontSize: 13 }}>No hay legajos con los filtros aplicados.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.bg }}>
                {["Nombre", "Rol", "Contratación", "Sociedad", "Centro de costo", "Blanco neto", "Ingreso", "Alta", ""].map(h => (
                  <th key={h} style={{
                    padding: "8px 12px", textAlign: "left", fontWeight: 600,
                    color: T.muted, fontSize: 11, letterSpacing: ".04em",
                    borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.map((l, i) => (
                <tr key={l.id} style={{ background: i % 2 === 0 ? T.card : T.bg, opacity: l.activo ? 1 : 0.5 }}>
                  <td style={{ padding: "9px 12px", fontWeight: 600 }}>{l.nombre}</td>
                  <td style={{ padding: "9px 12px" }}>{rolChip(l.rol)}</td>
                  <td style={{ padding: "9px 12px" }}>{tipoChip(l.tipo_contratacion)}</td>
                  <td style={{ padding: "9px 12px", color: T.muted }}>{l.sociedad_nombre || l.sociedad_id || "—"}</td>
                  <td style={{ padding: "9px 12px", color: T.muted }}>{l.sede_nombre || l.sede_id || "—"}</td>
                  <td style={{ padding: "9px 12px" }}>
                    {l.blanco_neto > 0
                      ? `$${l.blanco_neto.toLocaleString("es-AR")}`
                      : <span style={{ color: T.dim }}>Sin blanco</span>}
                  </td>
                  <td style={{ padding: "9px 12px", color: T.muted }}>{l.fecha_ingreso || "—"}</td>
                  <td style={{ padding: "9px 12px", color: T.muted }}>
                    {l.fecha_alta
                      ? l.fecha_alta
                      : l.fecha_ingreso
                        ? <span style={{ color: T.dim }}>= ingreso</span>
                        : "—"}
                  </td>
                  <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => handleEditar(l)}
                      style={{
                        background: "transparent", border: `1px solid #93c5fd`,
                        borderRadius: 5, padding: "3px 8px", cursor: "pointer",
                        fontSize: 12, color: T.blue, marginRight: 4,
                      }}>✏️</button>
                    <button
                      onClick={() => handleEliminar(l)}
                      style={{
                        background: "transparent", border: `1px solid #fca5a5`,
                        borderRadius: 5, padding: "3px 8px", cursor: "pointer",
                        fontSize: 12, color: T.red,
                      }}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Formulario ────────────────────────────────────────────────────────────────

function FormLegajo({ initial, sociedades, centrosCosto, onClose, onSaved }) {
  const [form, setForm]     = useState({ ...FORM_VACIO, ...initial });
  const [saving, setSaving] = useState(false);
  const savingRef           = useRef(false);
  const esEdicion           = !!initial?.id;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Al cambiar sociedad, limpiar sede si ya no pertenece a esa sociedad
  const handleSociedad = (socId) => {
    const soc = sociedades.find(s => s.id === socId);
    set("sociedad_id",     socId);
    set("sociedad_nombre", soc?.nombre ?? socId);
    set("sede_id",         "");
    set("sede_nombre",     "");
  };

  const handleSede = (ccId) => {
    const cc = centrosCosto.find(c => c.id === ccId);
    set("sede_id",     ccId);
    set("sede_nombre", cc?.nombre ?? ccId);
  };

  // Centros de costo filtrados por la sociedad seleccionada
  const ccFiltrados = useMemo(() => {
    if (!form.sociedad_id) return centrosCosto;
    return centrosCosto.filter(c =>
      !c.sociedad || c.sociedad === form.sociedad_id || c.sociedad === form.sociedad_nombre
    );
  }, [centrosCosto, form.sociedad_id, form.sociedad_nombre]);

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!form.nombre.trim()) { alert("El nombre es obligatorio."); return; }
    if (!form.rol)           { alert("Seleccioná un rol."); return; }
    savingRef.current = true;
    setSaving(true);
    try {
      const payload = {
        ...form,
        blanco_neto: parseFloat(form.blanco_neto) || 0,
        tarifa_hora: parseFloat(form.tarifa_hora) || 0,
        activo:      form.activo ? "true" : "false",
      };
      if (esEdicion) {
        await updateLegajo(initial.id, payload);
      } else {
        await appendLegajo(payload);
      }
      await onSaved();
    } catch (e) {
      alert("Error al guardar: " + e.message);
      setSaving(false);
    } finally {
      savingRef.current = false;
    }
  };

  const esHQ    = ROLES_HQ.includes(form.rol);
  const esCoach = ["COACH", "COACH_SENIOR"].includes(form.rol);

  const inputStyle = {
    border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px",
    fontSize: 13, fontFamily: T.font, width: "100%", boxSizing: "border-box",
  };
  const labelStyle = { fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 4, display: "block" };

  return (
    <div style={{ padding: 24, fontFamily: T.font, color: T.text, maxWidth: 680, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: T.muted }}>←</button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
          {esEdicion ? `Editar: ${initial.nombre}` : "Nuevo legajo"}
        </h2>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Nombre */}
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Nombre *</label>
          <input style={inputStyle} value={form.nombre} onChange={e => set("nombre", e.target.value)} />
        </div>

        {/* Rol */}
        <div>
          <label style={labelStyle}>Rol *</label>
          <select style={inputStyle} value={form.rol} onChange={e => set("rol", e.target.value)}>
            <optgroup label="Sedes">{ROLES_SEDES.map(r => <option key={r} value={r}>{r}</option>)}</optgroup>
            <optgroup label="HQ">{ROLES_HQ.map(r => <option key={r} value={r}>{r}</option>)}</optgroup>
          </select>
        </div>

        {/* Tipo contratación */}
        <div>
          <label style={labelStyle}>Relación con la empresa</label>
          <select style={inputStyle} value={form.tipo_contratacion} onChange={e => set("tipo_contratacion", e.target.value)}>
            {TIPOS_CONTRATACION.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <span style={{ fontSize: 11, color: T.dim, marginTop: 3, display: "block" }}>
            {form.tipo_contratacion === "monotributista"
              ? "La empresa recibe y paga su factura como egreso"
              : "Relación laboral formal — genera recibo de sueldo y cargas sociales"}
          </span>
        </div>

        {/* Sociedad */}
        <div>
          <label style={labelStyle}>Sociedad</label>
          <select
            style={inputStyle}
            value={form.sociedad_id}
            onChange={e => handleSociedad(e.target.value)}
          >
            <option value="">— Seleccionar —</option>
            {sociedades.map(s => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>

        {/* Sede / Centro de costo */}
        <div>
          <label style={labelStyle}>{esHQ ? "Centro de costo" : "Sede principal"}</label>
          <select
            style={inputStyle}
            value={form.sede_id}
            onChange={e => handleSede(e.target.value)}
          >
            <option value="">— Seleccionar —</option>
            {ccFiltrados.map(c => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          {ccFiltrados.length === 0 && form.sociedad_id && (
            <span style={{ fontSize: 11, color: T.dim, marginTop: 3, display: "block" }}>
              No hay centros de costo para esta sociedad en Numbers.
            </span>
          )}
        </div>

        {/* Sueldo total acordado */}
        <div>
          <label style={labelStyle}>Sueldo total acordado (ARS)</label>
          <input style={inputStyle} type="number" value={form.sueldo_total} onChange={e => set("sueldo_total", e.target.value)} placeholder="0" />
          <span style={{ fontSize: 11, color: T.dim, marginTop: 3, display: "block" }}>
            Lo que cobra en total (blanco + efectivo). Actualizalo cuando cambia.
          </span>
        </div>

        {/* Blanco neto */}
        <div>
          <label style={labelStyle}>
            Blanco neto (ARS)
            {!form.blanco_neto && !form.fecha_alta && <span style={{ color: T.dim, fontWeight: 400 }}> — sin blanco ni alta = todo efectivo</span>}
          </label>
          <input style={inputStyle} type="number" value={form.blanco_neto} onChange={e => set("blanco_neto", e.target.value)} placeholder="0" />
          {form.sueldo_total > 0 && form.blanco_neto > 0 && (
            <span style={{ fontSize: 11, color: T.muted, marginTop: 3, display: "block" }}>
              Efectivo implícito: ${Math.max(0, (parseFloat(form.sueldo_total) || 0) - (parseFloat(form.blanco_neto) || 0)).toLocaleString("es-AR")}
            </span>
          )}
        </div>

        {/* Tarifa hora (solo coaches) */}
        {esCoach && (
          <div>
            <label style={labelStyle}>Tarifa por hora (ARS)</label>
            <input style={inputStyle} type="number" value={form.tarifa_hora} onChange={e => set("tarifa_hora", e.target.value)} placeholder="0" />
          </div>
        )}

        {/* CUIL */}
        <div>
          <label style={labelStyle}>CUIL</label>
          <input style={inputStyle} value={form.cuil} onChange={e => set("cuil", e.target.value)} placeholder="20-12345678-9" />
        </div>

        {/* CBU */}
        <div>
          <label style={labelStyle}>CBU</label>
          <input style={inputStyle} value={form.cbu} onChange={e => set("cbu", e.target.value)} />
        </div>

        {/* Banco */}
        <div>
          <label style={labelStyle}>Banco</label>
          <input style={inputStyle} value={form.banco} onChange={e => set("banco", e.target.value)} placeholder="Ej: Galicia" />
        </div>

        {/* Fecha ingreso */}
        <div>
          <label style={labelStyle}>Fecha de ingreso</label>
          <input style={inputStyle} type="date" value={form.fecha_ingreso} onChange={e => set("fecha_ingreso", e.target.value)} />
        </div>

        {/* Fecha alta */}
        <div>
          <label style={labelStyle}>
            Fecha de alta
            <span style={{ color: T.dim, fontWeight: 400 }}> (cuando empieza a cobrar)</span>
          </label>
          <input style={inputStyle} type="date" value={form.fecha_alta} onChange={e => set("fecha_alta", e.target.value)} />
        </div>

        {/* Activo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox" id="activo" checked={form.activo}
            onChange={e => set("activo", e.target.checked)}
          />
          <label htmlFor="activo" style={{ fontSize: 13, cursor: "pointer" }}>Empleado activo</label>
        </div>

        {/* Notas */}
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Notas</label>
          <textarea
            style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
            value={form.notas} onChange={e => set("notas", e.target.value)}
          />
        </div>
      </div>

      {/* Acciones */}
      <div style={{ display: "flex", gap: 10, marginTop: 24, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{
          border: `1px solid ${T.border}`, background: T.card, borderRadius: 7,
          padding: "8px 16px", fontSize: 13, cursor: "pointer", fontFamily: T.font,
        }}>Cancelar</button>
        <button onClick={handleSave} disabled={saving} style={{
          background: saving ? T.dim : T.blue, color: "#fff", border: "none",
          borderRadius: 7, padding: "8px 20px", fontSize: 13, fontWeight: 600,
          cursor: saving ? "not-allowed" : "pointer", fontFamily: T.font,
        }}>
          {saving ? "Guardando…" : esEdicion ? "Guardar cambios" : "Crear legajo"}
        </button>
      </div>
    </div>
  );
}
