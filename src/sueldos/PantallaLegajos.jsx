import { useState, useEffect, useRef, useMemo } from "react";
import {
  fetchLegajos, appendLegajo, updateLegajo, deleteLegajo,
  ROLES_SEDES, ROLES_HQ, TIPOS_CONTRATACION, FP_TIPO_LABEL,
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
  nombre: "", cuil: "", email: "", cbu: "", numero_cuenta: "", banco: "",
  cbu_sec: "", numero_cuenta_sec: "", banco_sec: "",
  bigg_eye_id: "", horas_contratadas: "",
  sociedad_id: "", sociedad_nombre: "", pais: "",
  sede_id: "", sede_nombre: "",
  rol: "COACH",
  tipo_contratacion: "",
  blanco_neto: "", tarifa_hora: "",
  activo: true,
  fecha_ingreso: "", fecha_alta: "",
  notas: "",
  formas_pago: [],
};

const fmtFecha = (s) => {
  if (!s) return "—";
  const d = s.slice(0, 10); // "2021-02-22"
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y}`;
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
  if (tipo === "monotributista")      return chip("Monotrib.",   "#f3e8ff", "#7e22ce");
  if (tipo === "relacion_dependencia") return chip("Dependencia", "#dcfce7", "#166534");
  return <span style={{ color: "#94a3b8" }}>—</span>;
}

export default function PantallaLegajos({ pais = "" }) {
  const [legajos,    setLegajos]    = useState([]);
  const [sociedades, setSociedades] = useState([]);
  const [centrosCosto, setCentrosCosto] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [editing,    setEditing]    = useState(null);
  const [filtroRol,     setFiltroRol]     = useState("todos");
  const [filtroSociedad, setFiltroSociedad] = useState("todas");
  const [filtroActivo,  setFiltroActivo]  = useState("activos");
  const [busqueda,      setBusqueda]      = useState("");

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
    if (pais && l.pais && l.pais !== pais) return false;
    if (filtroActivo === "activos"   && !l.activo) return false;
    if (filtroActivo === "inactivos" && l.activo)  return false;
    if (filtroRol !== "todos" && l.rol !== filtroRol) return false;
    if (filtroSociedad !== "todas" && l.sociedad_id !== filtroSociedad) return false;
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
          value={filtroSociedad}
          onChange={e => setFiltroSociedad(e.target.value)}
          style={{ border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: T.font }}>
          <option value="todas">Todas las empresas</option>
          {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
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
                {["Nombre", "Rol", "Contratación", "Sociedad", "Centro de costo", "Ingreso", "Alta", ""].map(h => (
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
                  <td style={{ padding: "9px 12px", color: T.muted }}>{fmtFecha(l.fecha_ingreso)}</td>
                  <td style={{ padding: "9px 12px", color: T.muted }}>
                    {l.fecha_alta
                      ? fmtFecha(l.fecha_alta)
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

function Section({ title, hint, children, cols = 3 }) {
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: T.text, letterSpacing: ".01em" }}>{title}</h3>
        {hint && <span style={{ fontSize: 11, color: T.dim }}>{hint}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "12px 16px" }}>
        {children}
      </div>
    </div>
  );
}

// Input numérico con separador de miles (es-AR) que guarda el valor crudo.
function MoneyInput({ value, onChange, style, placeholder }) {
  const digits  = String(value ?? "").replace(/[^\d]/g, "");
  const display = digits === "" ? "" : Number(digits).toLocaleString("es-AR");
  return (
    <input
      style={style}
      type="text"
      inputMode="numeric"
      value={display}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value.replace(/[^\d]/g, ""))}
    />
  );
}

function FormLegajo({ initial, sociedades, centrosCosto, onClose, onSaved }) {
  const [form, setForm]     = useState({ ...FORM_VACIO, ...initial });
  const [saving, setSaving] = useState(false);
  const savingRef           = useRef(false);
  const esEdicion           = !!initial?.id;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Al cambiar sociedad, limpiar sede y auto-completar país
  const handleSociedad = (socId) => {
    const soc = sociedades.find(s => s.id === socId);
    set("sociedad_id",     socId);
    set("sociedad_nombre", soc?.nombre ?? socId);
    set("pais",            soc?.pais   ?? "");
    set("sede_id",         "");
    set("sede_nombre",     "");
  };

  const handleSede = (ccId) => {
    const cc = centrosCosto.find(c => c.id === ccId);
    set("sede_id",     ccId);
    set("sede_nombre", cc?.nombre ?? ccId);
  };

  // ── Líneas de la receta de pago ──
  const lineas = form.formas_pago ?? [];
  const fpAdd = () => set("formas_pago", [
    ...lineas,
    { id: `fp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      tipo: "deposito", importe: "", titular: "", banco: "", tipo_cuenta: "", cuenta: "", cbu: "", cuit: "", nota: "" },
  ]);
  const fpUpd = (id, k, v) => set("formas_pago", lineas.map(l => l.id === id ? { ...l, [k]: v } : l));
  const fpDel = (id) => set("formas_pago", lineas.filter(l => l.id !== id));
  const fpSum = lineas.reduce((s, l) => s + (parseFloat(l.importe) || 0), 0);

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
        horas_contratadas: parseFloat(form.horas_contratadas) || 0,
        activo:      form.activo ? "true" : "false",
        formas_pago: (form.formas_pago ?? []).map(l => ({ ...l, importe: parseFloat(l.importe) || 0 })),
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

  const esHQ = ROLES_HQ.includes(form.rol);

  const inputStyle = {
    border: `1px solid ${T.border}`, borderRadius: 6, padding: "5px 8px",
    fontSize: 12.5, fontFamily: T.font, width: "100%", boxSizing: "border-box",
  };
  const labelStyle = { fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 3, display: "block" };
  const fpTh    = { textAlign: "left", fontSize: 11, fontWeight: 600, color: T.muted, padding: "4px 6px", borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" };
  const fpTd    = { padding: "3px 4px", verticalAlign: "middle" };
  const fpInput = { border: `1px solid ${T.border}`, borderRadius: 5, padding: "5px 6px", fontSize: 12, fontFamily: T.font, width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ padding: "24px 32px", fontFamily: T.font, color: T.text, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: T.muted }}>←</button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
          {esEdicion ? `Editar: ${initial.nombre}` : "Nuevo legajo"}
        </h2>
        <label htmlFor="activo" style={{
          marginLeft: "auto", display: "flex", alignItems: "center", gap: 7,
          fontSize: 13, fontWeight: 600, cursor: "pointer",
          color: form.activo ? T.green : T.muted,
        }}>
          <input type="checkbox" id="activo" checked={form.activo} onChange={e => set("activo", e.target.checked)} />
          Empleado activo
        </label>
      </div>

      {/* Datos personales */}
      <Section title="Datos personales">
        <div>
          <label style={labelStyle}>Nombre *</label>
          <input style={inputStyle} value={form.nombre} onChange={e => set("nombre", e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>CUIL</label>
          <input style={inputStyle} value={form.cuil} onChange={e => set("cuil", e.target.value)} placeholder="20-12345678-9" />
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <input style={inputStyle} type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="nombre@bigg.com" />
        </div>
      </Section>

      {/* Datos de contratación */}
      <Section title="Datos de contratación">
        {/* Col 1: Rol + ID Bigg Eye */}
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Rol *</label>
            <select style={inputStyle} value={form.rol} onChange={e => set("rol", e.target.value)}>
              <optgroup label="Sedes">{ROLES_SEDES.map(r => <option key={r} value={r}>{r}</option>)}</optgroup>
              <optgroup label="HQ">{ROLES_HQ.map(r => <option key={r} value={r}>{r}</option>)}</optgroup>
            </select>
          </div>
          <div style={{ flex: "0 0 80px" }}>
            <label style={labelStyle} title="ID del rol/persona en Bigg Eye, para cruzar datos">ID Bigg Eye</label>
            <input style={inputStyle} value={form.bigg_eye_id} onChange={e => set("bigg_eye_id", e.target.value)} placeholder="—" />
          </div>
        </div>

        {/* Col 2: Hs/mes */}
        <div>
          <label style={labelStyle} title="Horas mensuales contratadas (base para coaches)">Hs/mes</label>
          <input style={inputStyle} type="number" value={form.horas_contratadas} onChange={e => set("horas_contratadas", e.target.value)} placeholder="0" />
        </div>

        {/* Col 3: Relación con la empresa */}
        <div>
          <label style={labelStyle}>Relación con la empresa</label>
          <select style={inputStyle} value={form.tipo_contratacion} onChange={e => set("tipo_contratacion", e.target.value)}>
            <option value="">— Sin definir —</option>
            {TIPOS_CONTRATACION.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>

        {/* Sociedad / Centro de costo — apilados */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={labelStyle}>Sociedad</label>
            <select style={inputStyle} value={form.sociedad_id} onChange={e => handleSociedad(e.target.value)}>
              <option value="">— Seleccionar —</option>
              {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{esHQ ? "Centro de costo" : "Sede principal"}</label>
            <select style={inputStyle} value={form.sede_id} onChange={e => handleSede(e.target.value)}>
              <option value="">— Seleccionar —</option>
              {ccFiltrados.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            {ccFiltrados.length === 0 && form.sociedad_id && (
              <span style={{ fontSize: 11, color: T.dim, marginTop: 3, display: "block" }}>
                No hay centros de costo para esta sociedad en Numbers.
              </span>
            )}
          </div>
        </div>

        {/* Fecha de ingreso / alta — apilados */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={labelStyle}>Fecha de ingreso</label>
            <input style={inputStyle} type="date" value={form.fecha_ingreso} onChange={e => set("fecha_ingreso", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>
              Fecha de alta
              <span style={{ color: T.dim, fontWeight: 400 }}> (empieza a cobrar)</span>
            </label>
            <input style={inputStyle} type="date" value={form.fecha_alta} onChange={e => set("fecha_alta", e.target.value)} />
          </div>
        </div>

        {/* Sueldo total / Blanco neto — apilados */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={labelStyle}>Sueldo total acordado (ARS)</label>
            <MoneyInput style={inputStyle} value={form.sueldo_total} onChange={v => set("sueldo_total", v)} placeholder="0" />
          </div>
          <div>
            <label style={labelStyle}>
              Blanco neto (ARS)
              {!form.blanco_neto && !form.fecha_alta && <span style={{ color: T.dim, fontWeight: 400 }}> — sin blanco ni alta = todo efectivo</span>}
            </label>
            <MoneyInput style={inputStyle} value={form.blanco_neto} onChange={v => set("blanco_neto", v)} placeholder="0" />
          </div>
        </div>
      </Section>

      {/* Datos bancarios */}
      <Section title="Datos bancarios" cols={1}>
        {/* Cuenta principal — una fila */}
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.text, display: "block", marginBottom: 4 }}>Cuenta principal</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <div>
              <label style={labelStyle}>Banco</label>
              <input style={inputStyle} value={form.banco} onChange={e => set("banco", e.target.value)} placeholder="Ej: Galicia" />
            </div>
            <div>
              <label style={labelStyle}>CBU</label>
              <input style={inputStyle} value={form.cbu} onChange={e => set("cbu", e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Número de cuenta</label>
              <input style={inputStyle} value={form.numero_cuenta} onChange={e => set("numero_cuenta", e.target.value)} placeholder="Ej: 003-123456/7" />
            </div>
          </div>
        </div>

        {/* Cuenta secundaria — fila de abajo */}
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.muted, display: "block", marginBottom: 4 }}>
            Cuenta secundaria <span style={{ fontWeight: 400, color: T.dim }}>(opcional)</span>
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <div>
              <label style={labelStyle}>Banco</label>
              <input style={inputStyle} value={form.banco_sec} onChange={e => set("banco_sec", e.target.value)} placeholder="Ej: Santander" />
            </div>
            <div>
              <label style={labelStyle}>CBU</label>
              <input style={inputStyle} value={form.cbu_sec} onChange={e => set("cbu_sec", e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Número de cuenta</label>
              <input style={inputStyle} value={form.numero_cuenta_sec} onChange={e => set("numero_cuenta_sec", e.target.value)} placeholder="Ej: 003-123456/7" />
            </div>
          </div>
        </div>
      </Section>

      {/* Notas */}
      <Section title="Notas" cols={1}>
        <textarea
          style={{ ...inputStyle, resize: "vertical", minHeight: 56 }}
          value={form.notas} onChange={e => set("notas", e.target.value)}
        />
      </Section>

      {/* Formas de pago (receta fija) — HQ */}
      {esHQ && (
        <div style={{ marginTop: 28, borderTop: `1px solid ${T.border}`, paddingTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Formas de pago</h3>
            <button onClick={fpAdd} style={{
              border: `1px solid ${T.blue}`, background: "#eff6ff", color: T.blue,
              borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: T.font,
            }}>＋ Agregar línea</button>
          </div>
          <p style={{ margin: "0 0 10px", fontSize: 11, color: T.dim }}>
            Receta fija de cómo cobra (haberes, depósitos, transferencias, efectivo). Al liquidar el mes se trae automáticamente; el origen del dinero se elige al pagar.
          </p>

          {lineas.length === 0 ? (
            <div style={{ fontSize: 12, color: T.dim, padding: "6px 0" }}>
              Sin líneas. Si no cargás ninguna, se asume haberes (blanco neto) + el resto en efectivo.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 720 }}>
                <thead>
                  <tr>
                    {["Tipo", "Importe", "Titular", "CUIT", "Banco", "Tipo cta", "Cuenta", "CBU", "Nota interna", ""].map((h, i) => (
                      <th key={i} style={fpTh}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lineas.map(l => {
                    const esEfectivo = l.tipo === "efectivo";
                    return (
                      <tr key={l.id}>
                        <td style={{ ...fpTd, minWidth: 110 }}>
                          <select style={fpInput} value={l.tipo} onChange={e => fpUpd(l.id, "tipo", e.target.value)}>
                            {Object.entries(FP_TIPO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </td>
                        <td style={{ ...fpTd, width: 100 }}>
                          <MoneyInput style={fpInput} value={l.importe} onChange={v => fpUpd(l.id, "importe", v)} placeholder="0" />
                        </td>
                        <td style={{ ...fpTd, minWidth: 140 }}>
                          <input style={fpInput} value={l.titular ?? ""} onChange={e => fpUpd(l.id, "titular", e.target.value)} disabled={esEfectivo} placeholder={esEfectivo ? "—" : "Nombre de la cuenta"} />
                        </td>
                        <td style={{ ...fpTd, width: 110 }}>
                          <input style={fpInput} value={l.cuit} onChange={e => fpUpd(l.id, "cuit", e.target.value)} disabled={esEfectivo} />
                        </td>
                        <td style={{ ...fpTd, width: 90 }}>
                          <input style={fpInput} value={l.banco} onChange={e => fpUpd(l.id, "banco", e.target.value)} disabled={esEfectivo} placeholder={esEfectivo ? "—" : ""} />
                        </td>
                        <td style={{ ...fpTd, width: 70 }}>
                          <input style={fpInput} value={l.tipo_cuenta} onChange={e => fpUpd(l.id, "tipo_cuenta", e.target.value)} disabled={esEfectivo} placeholder={esEfectivo ? "—" : "CA/CC"} />
                        </td>
                        <td style={{ ...fpTd, width: 100 }}>
                          <input style={fpInput} value={l.cuenta} onChange={e => fpUpd(l.id, "cuenta", e.target.value)} disabled={esEfectivo} />
                        </td>
                        <td style={{ ...fpTd, width: 130 }}>
                          <input style={fpInput} value={l.cbu} onChange={e => fpUpd(l.id, "cbu", e.target.value)} disabled={esEfectivo} />
                        </td>
                        <td style={{ ...fpTd, minWidth: 120 }}>
                          <input style={fpInput} value={l.nota} onChange={e => fpUpd(l.id, "nota", e.target.value)} placeholder="Ej: Alquiler" />
                        </td>
                        <td style={{ ...fpTd, width: 32, textAlign: "center" }}>
                          <button onClick={() => fpDel(l.id)} title="Quitar línea" style={{
                            background: "transparent", border: `1px solid #fca5a5`, borderRadius: 5,
                            padding: "3px 7px", cursor: "pointer", fontSize: 12, color: T.red, lineHeight: 1,
                          }}>🗑</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {lineas.length > 0 && (() => {
            const total = parseFloat(form.sueldo_total) || 0;
            const resto = total - fpSum;
            return (
              <div style={{ marginTop: 8, fontSize: 12, textAlign: "right", color: T.muted }}>
                Σ líneas: <strong>${fpSum.toLocaleString("es-AR")}</strong>
                {total > 0 && <> {" / "} total acordado: ${total.toLocaleString("es-AR")}</>}
                {total > 0 && Math.abs(resto) >= 1 && (
                  <span style={{ color: T.dim }}>
                    {resto > 0
                      ? ` · la diferencia (${"$" + resto.toLocaleString("es-AR")}) va por efectivo`
                      : ` · las líneas superan el total acordado en ${"$" + Math.abs(resto).toLocaleString("es-AR")}`}
                  </span>
                )}
              </div>
            );
          })()}
        </div>
      )}

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
