import { useState, useEffect, useMemo } from "react";
import { T, Btn, PageHeader, fmtDate, fmtMoney } from "./theme";
import { TIPO_CUENTA } from "../data/tesoreriaData";
import { fetchCambios, appendCambio, deleteCambio, fetchCuentasBancarias } from "../lib/numbersApi";

const HOY = new Date().toISOString().slice(0, 10);

const FORM_VACÍO = {
  fecha:          HOY,
  cuentaOrigenId:  "",
  montoOrigen:     "",
  cuentaDestinoId: "",
  montoDestino:    "",
  nota:            "",
};

const inputStyle = {
  width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e5e7eb",
  fontSize:13, fontFamily:T.font, background:"#fff", color:T.text, outline:"none",
  boxSizing:"border-box",
};
const labelStyle = { fontSize:11, fontWeight:700, color:T.muted, marginBottom:4, display:"block" };

export default function PantallaCambioMoneda({ sociedad }) {
  const [todosCambios, setTodosCambios] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showForm,     setShowForm]     = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [allCuentas,   setAllCuentas]   = useState([]);
  const [form,         setForm]         = useState(FORM_VACÍO);
  const [deleting,     setDeleting]     = useState(null);
  const [otrasOpen,    setOtrasOpen]    = useState(true);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const cuentas = useMemo(() =>
    allCuentas.filter(c => (c.sociedad ?? "").toLowerCase() === (sociedad ?? "").toLowerCase()),
    [allCuentas, sociedad]
  );

  const cambios      = useMemo(() => todosCambios.filter(c => (c.sociedad ?? "").toLowerCase() === (sociedad ?? "").toLowerCase()), [todosCambios, sociedad]);
  const cambiosOtros = useMemo(() =>
    todosCambios.filter(c => (c.sociedad ?? "").toLowerCase() !== (sociedad ?? "").toLowerCase()),
    [todosCambios, sociedad]
  );

  async function cargar() {
    setLoading(true);
    try {
      const [todos, cbs] = await Promise.all([
        fetchCambios(null), // sin filtro — trae todas las sociedades
        fetchCuentasBancarias(),
      ]);
      setTodosCambios(todos);
      setAllCuentas(cbs ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargar(); }, [sociedad]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctaOrigen  = cuentas.find(c => c.id === form.cuentaOrigenId);
  const ctaDestino = cuentas.find(c => c.id === form.cuentaDestinoId);
  const monedaOrigen  = ctaOrigen?.moneda  ?? "";
  const monedaDestino = ctaDestino?.moneda ?? "";

  const montoOrigenN  = Number(form.montoOrigen)  || 0;
  const montoDestinoN = Number(form.montoDestino) || 0;
  let tcLineA = null, tcLineB = null;
  if (montoOrigenN > 0 && montoDestinoN > 0 && monedaOrigen && monedaDestino) {
    const fwd = montoDestinoN / montoOrigenN;
    if (monedaOrigen !== "ARS") {
      tcLineA = `1 ${monedaOrigen} = ${fwd.toFixed(2)} ${monedaDestino}`;
      tcLineB = `1 ${monedaDestino} = ${(1/fwd).toFixed(4)} ${monedaOrigen}`;
    } else {
      tcLineA = `1 ${monedaDestino} = ${(1/fwd).toFixed(2)} ${monedaOrigen}`;
      tcLineB = `1 ${monedaOrigen} = ${fwd.toFixed(4)} ${monedaDestino}`;
    }
  }

  const canSave =
    form.fecha &&
    form.cuentaOrigenId &&
    form.cuentaDestinoId &&
    form.cuentaOrigenId !== form.cuentaDestinoId &&
    montoOrigenN > 0 &&
    montoDestinoN > 0;

  async function handleGuardar() {
    if (!canSave) return;
    setSaving(true);
    try {
      await appendCambio({
        sociedad,
        fecha:          form.fecha,
        cuentaOrigen:   form.cuentaOrigenId,
        monedaOrigen,
        montoOrigen:    montoOrigenN,
        cuentaDestino:  form.cuentaDestinoId,
        monedaDestino,
        montoDestino:   montoDestinoN,
        nota:           form.nota,
      });
      setForm(FORM_VACÍO);
      setShowForm(false);
      await cargar();
    } finally {
      setSaving(false);
    }
  }

  async function handleEliminar(cambio) {
    if (!window.confirm(`¿Eliminar esta operación de cambio?`)) return;
    setDeleting(cambio.id);
    try {
      await deleteCambio(cambio._ids);
      await cargar();
    } finally {
      setDeleting(null);
    }
  }

  // Label para cuenta en dropdown
  const ctaLabel = (c) => {
    const icon = TIPO_CUENTA[(c.tipo ?? "").toLowerCase()]?.icon ?? "💳";
    return `${icon} ${c.nombre} (${c.moneda})`;
  };

  // Nombre de cuenta para mostrar en tabla
  const ctaNombre = (id) => {
    const c = allCuentas.find(x => x.id === id);
    return c ? c.nombre : id;
  };

  return (
    <div className="fade" style={{ padding:"28px 32px", display:"flex", flexDirection:"column", minHeight:"calc(100vh - 60px)" }}>
      <PageHeader
        title="Cambio de moneda"
        action={
          <Btn onClick={() => { setShowForm(v => !v); setForm(FORM_VACÍO); }}
            style={{ background: showForm ? "#f3f4f6" : T.accent,
              color: showForm ? T.muted : "#000", border:"none" }}>
            {showForm ? "Cancelar" : "+ Nueva operación"}
          </Btn>
        }
      />

      {/* ── Formulario inline ── */}
      {showForm && (
        <div style={{ background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:12,
          padding:"20px 24px", marginBottom:24 }}>
          {/* Grilla unificada: fecha/TC | origen | → | destino */}
          <div style={{ display:"grid", gridTemplateColumns:"150px 1fr 40px 1fr", gap:12, alignItems:"end", marginBottom:16 }}>

            {/* Fecha */}
            <div>
              <label style={labelStyle}>Fecha</label>
              <input type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)}
                style={inputStyle} />
            </div>

            {/* Cuenta origen */}
            <div>
              <label style={labelStyle}>Entregás — cuenta origen</label>
              <select value={form.cuentaOrigenId} onChange={e => set("cuentaOrigenId", e.target.value)}
                style={inputStyle}>
                <option value="">Seleccionar cuenta…</option>
                {cuentas.map(c => (
                  <option key={c.id} value={c.id}>{ctaLabel(c)}</option>
                ))}
              </select>
            </div>

            {/* Flecha fila 1 */}
            <div style={{ textAlign:"center", paddingBottom:2, fontSize:18, color:T.muted }}>→</div>

            {/* Cuenta destino */}
            <div>
              <label style={labelStyle}>Recibís — cuenta destino</label>
              <select value={form.cuentaDestinoId} onChange={e => set("cuentaDestinoId", e.target.value)}
                style={inputStyle}>
                <option value="">Seleccionar cuenta…</option>
                {cuentas
                  .filter(c => c.id !== form.cuentaOrigenId)
                  .map(c => (
                    <option key={c.id} value={c.id}>{ctaLabel(c)}</option>
                  ))}
              </select>
            </div>

            {/* TC — debajo de Fecha */}
            <div>
              <label style={labelStyle}>Tipo de cambio</label>
              <div style={{ ...inputStyle, background:"#f3f4f6", color:T.muted,
                display:"flex", alignItems:"center", gap:6, height:36, whiteSpace:"nowrap", padding:"6px 8px" }}>
                {tcLineA
                  ? <><span style={{ fontSize:11, fontWeight:600 }}>{tcLineA}</span>
                      <span style={{ color:T.dim, fontSize:10 }}>·</span>
                      <span style={{ fontSize:10, color:T.dim }}>{tcLineB}</span></>
                  : <span>—</span>}
              </div>
            </div>

            {/* Monto entregado — debajo de cuenta origen */}
            <div>
              <label style={labelStyle}>
                Monto{monedaOrigen ? ` (${monedaOrigen})` : ""}
              </label>
              <input type="number" min="0" step="any" placeholder="0"
                value={form.montoOrigen} onChange={e => set("montoOrigen", e.target.value)}
                style={inputStyle} />
            </div>

            {/* Flecha fila 2 */}
            <div style={{ textAlign:"center", paddingBottom:2, fontSize:18, color:T.muted }}>→</div>

            {/* Monto recibido — debajo de cuenta destino */}
            <div>
              <label style={labelStyle}>
                Monto{monedaDestino ? ` (${monedaDestino})` : ""}
              </label>
              <input type="number" min="0" step="any" placeholder="0"
                value={form.montoDestino} onChange={e => set("montoDestino", e.target.value)}
                style={inputStyle} />
            </div>
          </div>

          {/* Nota */}
          <div style={{ marginBottom:16 }}>
            <label style={labelStyle}>Nota (opcional)</label>
            <input type="text" placeholder="Ej: Western Union, banco, efectivo…"
              value={form.nota} onChange={e => set("nota", e.target.value)}
              style={inputStyle} />
          </div>

          <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
            <Btn onClick={() => { setShowForm(false); setForm(FORM_VACÍO); }}
              style={{ background:"#f3f4f6", color:T.muted, border:"none" }}>
              Cancelar
            </Btn>
            <Btn onClick={handleGuardar} disabled={!canSave || saving}
              style={{ background: canSave ? T.accent : "#e5e7eb",
                color: canSave ? "#000" : T.dim, border:"none",
                opacity: saving ? .6 : 1 }}>
              {saving ? "Guardando…" : "Guardar"}
            </Btn>
          </div>
        </div>
      )}

      {/* ── Tabla sociedad activa ── */}
      {loading ? (
        <div style={{ color:T.muted, fontSize:13, padding:"40px 0", textAlign:"center" }}>Cargando…</div>
      ) : cambios.length === 0 ? (
        <div style={{ color:T.dim, fontSize:13, padding:"20px 0" }}>
          No hay operaciones de cambio registradas para esta sociedad.
        </div>
      ) : (
        <TablaCambios cambios={cambios} ctaNombre={ctaNombre} handleEliminar={handleEliminar} deleting={deleting} />
      )}

      {/* ── Otras sociedades ── */}
      {!loading && cambiosOtros.length > 0 && (
        <div style={{ marginTop:"auto", paddingTop:48 }}>
          <button onClick={() => setOtrasOpen(o => !o)} style={{
            display:"flex", alignItems:"center", gap:8,
            background:"none", border:"none", cursor:"pointer",
            padding:"4px 0 12px", fontFamily:T.font,
          }}>
            <span style={{ fontSize:11, fontWeight:700, color:T.dim, letterSpacing:".1em", textTransform:"uppercase" }}>
              Otras sociedades
            </span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
              style={{ transform: otrasOpen ? "rotate(180deg)" : "rotate(0deg)", transition:"transform .2s" }}>
              <path d="M3 4.5L6 7.5L9 4.5" stroke={T.dim} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {otrasOpen && (
            <div style={{ background:"#fff", borderRadius:12, padding:"4px 16px 16px", border:`1px solid ${T.cardBorder}`, boxShadow:"0 1px 4px rgba(0,0,0,.06)", overflowX:"auto" }}>
              <TablaCambios
                cambios={cambiosOtros}
                ctaNombre={ctaNombre}
                handleEliminar={handleEliminar}
                deleting={deleting}
                showSociedad
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TablaCambios({ cambios, ctaNombre, handleEliminar, deleting, showSociedad = false }) {
  const headers = showSociedad
    ? ["Sociedad","Fecha","Entregaste","","Recibiste","TC","Nota",""]
    : ["Fecha","Entregaste","","Recibiste","TC","Nota",""];
  return (
    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
      <thead>
        <tr style={{ borderBottom:`2px solid ${T.cardBorder}` }}>
          {headers.map((h,i) => (
            <th key={i} style={{ padding:"8px 12px", textAlign: i===headers.length-1?"center":"left",
              fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase",
              letterSpacing:".06em" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {cambios.map(c => {
          const tcNum = Number(c.tc);
          const tcStr = tcNum > 0
            ? (c.monedaOrigen !== "ARS"
                ? `1 ${c.monedaOrigen} = ${tcNum.toFixed(2)} ${c.monedaDestino}`
                : `1 ${c.monedaDestino} = ${tcNum.toFixed(2)} ${c.monedaOrigen}`)
            : "—";
          return (
            <tr key={c.id} style={{ borderBottom:`1px solid ${T.cardBorder}` }}
              onMouseEnter={e=>e.currentTarget.style.background="#f9fafb"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              {showSociedad && (
                <td style={{ padding:"10px 12px" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:T.muted, background:"#e5e7eb",
                    borderRadius:4, padding:"2px 7px", textTransform:"uppercase", letterSpacing:".04em" }}>
                    {c.sociedad}
                  </span>
                </td>
              )}
              <td style={{ padding:"10px 12px", color:T.muted }}>{fmtDate(c.fecha)}</td>
              <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>
                <span style={{ fontWeight:700, color:"#dc2626" }}>− {fmtMoney(c.montoOrigen, c.monedaOrigen)}</span>
                <span style={{ fontSize:11, color:T.dim, marginLeft:6 }}>{ctaNombre(c.cuentaOrigen)}</span>
              </td>
              <td style={{ padding:"10px 4px", color:T.dim, textAlign:"center" }}>→</td>
              <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>
                <span style={{ fontWeight:700, color:"#16a34a" }}>+ {fmtMoney(c.montoDestino, c.monedaDestino)}</span>
                <span style={{ fontSize:11, color:T.dim, marginLeft:6 }}>{ctaNombre(c.cuentaDestino)}</span>
              </td>
              <td style={{ padding:"10px 12px", color:T.muted, fontSize:12 }}>{tcStr}</td>
              <td style={{ padding:"10px 12px", color:T.dim, fontSize:12, maxWidth:180,
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {(c.nota ?? "").replace(/^Cambio [^·]+·\s*/, "") || "—"}
              </td>
              <td style={{ padding:"10px 12px", textAlign:"center" }}>
                <button
                  onClick={() => handleEliminar(c)}
                  disabled={deleting === c.id}
                  title="Eliminar operación"
                  style={{ background:"transparent", border:"none", cursor:"pointer",
                    color:"#ef4444", fontSize:15, padding:"2px 6px", borderRadius:6,
                    opacity: deleting === c.id ? .4 : 1 }}>
                  🗑
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
