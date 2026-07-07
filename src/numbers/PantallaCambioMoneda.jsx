import { useState, useEffect, useMemo, useRef } from "react";
import { T, Btn, Input, Select, PageHeader, fmtDate, fmtMoney } from "./theme";
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


export default function PantallaCambioMoneda({ sociedad, openNew, onOpenNewConsumed }) {
  const [todosCambios, setTodosCambios] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showForm,     setShowForm]     = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [allCuentas,   setAllCuentas]   = useState([]);
  const [form,         setForm]         = useState(FORM_VACÍO);
  const [deleting,     setDeleting]     = useState(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Abrir el modal desde el "+" del sidebar (una sola vez por click).
  useEffect(() => {
    if (openNew) { setForm(FORM_VACÍO); setShowForm(true); onOpenNewConsumed?.(); }
  }, [openNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const cuentas = useMemo(() =>
    allCuentas.filter(c => (c.sociedad ?? "").toLowerCase() === (sociedad ?? "").toLowerCase()),
    [allCuentas, sociedad]
  );

  const cambios = useMemo(() => todosCambios.filter(c => (c.sociedad ?? "").toLowerCase() === (sociedad ?? "").toLowerCase()), [todosCambios, sociedad]);

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

  const _savingRef = useRef(false);
  async function handleGuardar() {
    if (!canSave || _savingRef.current) return;
    _savingRef.current = true;
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
      _savingRef.current = false;
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
          <Btn onClick={() => { setForm(FORM_VACÍO); setShowForm(true); }}
            style={{ background: T.accent, color:"#000", border:"none" }}>
            + Nueva operación
          </Btn>
        }
      />

      {/* ── Modal: nueva operación ── */}
      {showForm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:500,
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
          onClick={() => { setShowForm(false); setForm(FORM_VACÍO); }}>
        <div className="fade" style={{ background:T.card, borderRadius:10, width:520, maxWidth:"97vw",
          boxShadow:"0 20px 60px rgba(0,0,0,.25)", overflow:"hidden" }} onClick={e => e.stopPropagation()}>
          <div style={{ background:"#0e7490", padding:"14px 22px", display:"flex",
            justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:15, fontWeight:800, color:"#fff" }}>Nueva operación de cambio</span>
            <button onClick={() => { setShowForm(false); setForm(FORM_VACÍO); }}
              style={{ background:"transparent", border:"none", color:"rgba(255,255,255,.6)",
                fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
          </div>
          <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
            <Input label="Fecha" required type="date" value={form.fecha} onChange={v => set("fecha", v)} />

            <Select label="Entregás — cuenta de salida" required value={form.cuentaOrigenId}
              onChange={v => set("cuentaOrigenId", v)}
              options={cuentas.map(c => ({ value: c.id, label: ctaLabel(c) }))} />
            <Input label={`Monto que entregás${monedaOrigen ? ` (${monedaOrigen})` : ""}`} required type="number"
              value={form.montoOrigen} onChange={v => set("montoOrigen", v)} placeholder="0,00" />

            <Select label="Recibís — cuenta de entrada" required value={form.cuentaDestinoId}
              onChange={v => set("cuentaDestinoId", v)}
              options={cuentas.filter(c => c.id !== form.cuentaOrigenId).map(c => ({ value: c.id, label: ctaLabel(c) }))} />
            <Input label={`Monto que recibís${monedaDestino ? ` (${monedaDestino})` : ""}`} required type="number"
              value={form.montoDestino} onChange={v => set("montoDestino", v)} placeholder="0,00" />

            {tcLineA && (
              <div style={{ background:"#f0f9ff", border:"1px solid #bae6fd", borderRadius:8,
                padding:"8px 12px", fontSize:12, color:"#0369a1", display:"flex", gap:8, alignItems:"center" }}>
                <span style={{ fontWeight:700 }}>{tcLineA}</span>
                <span style={{ color:T.dim }}>·</span>
                <span style={{ color:T.muted }}>{tcLineB}</span>
              </div>
            )}

            <div>
              <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>Observación</label>
              <textarea value={form.nota} onChange={e => set("nota", e.target.value)}
                placeholder="Ej: Western Union, banco, efectivo…"
                style={{ width:"100%", background:"#eceff3", border:`1px solid ${T.cardBorder}`,
                  borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
                  fontFamily:T.font, outline:"none", resize:"vertical", minHeight:60, boxSizing:"border-box" }} />
            </div>

            <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
              <button onClick={() => { setShowForm(false); setForm(FORM_VACÍO); }} style={{
                background:"#dc2626", border:"none", borderRadius:8, padding:"9px 20px",
                fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer", fontFamily:T.font }}>Cancelar ✕</button>
              <button onClick={handleGuardar} disabled={!canSave || saving} style={{
                background: canSave && !saving ? "#16a34a" : "#9ca3af", border:"none", borderRadius:8,
                padding:"9px 20px", fontSize:13, fontWeight:700, color:"#fff",
                cursor: canSave && !saving ? "pointer" : "default", fontFamily:T.font }}>
                {saving ? "Guardando…" : "Crear ✓"}</button>
            </div>
          </div>
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
              onMouseEnter={e=>e.currentTarget.style.background="#eceff3"}
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
