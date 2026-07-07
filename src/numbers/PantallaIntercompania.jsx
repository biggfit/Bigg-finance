import { useState, useEffect, useMemo, useRef } from "react";
import { T, Btn, Input, Select, PageHeader, fmtDate, fmtMoney } from "./theme";
import { TIPO_CUENTA, SOCIEDADES } from "../data/tesoreriaData";
import { fetchIntercompania, appendIntercompania, deleteIntercompania, fetchCuentasBancarias,
  fetchIntercoData, lecturaInterco } from "../lib/numbersApi";
import { sociedadNombreMap } from "./tesoreriaDerive";

const HOY = new Date().toISOString().slice(0, 10);

const FORM_VACÍO = {
  fecha:         HOY,
  ctaOrigenId:   "",
  ctaDestinoId:  "",
  monto:         "",
  tipoOp:        "prestamo",
  nota:          "",
};

const TIPO_OP_CFG = {
  prestamo: { label: "Préstamo",        bg: "#dbeafe", color: "#1d4ed8" },
  fondeo:   { label: "Fondeo / Inv.",   bg: "#ffedd5", color: "#c2410c" },
};

// Nombre corto de sociedad
const socNombre = (id) => SOCIEDADES.find(s => s.id === id)?.nombre ?? id;

export default function PantallaIntercompania({ sociedad, openNew, onOpenNewConsumed }) {
  const [todos,      setTodos]      = useState([]);
  const [allCuentas, setAllCuentas] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [form,       setForm]       = useState(FORM_VACÍO);
  const [deleting,   setDeleting]   = useState(null);
  const [intercoData, setIntercoData] = useState(null);   // para las posiciones (nos deben / les debemos)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Abrir el modal desde el "+" del sidebar (una sola vez por click).
  useEffect(() => {
    if (openNew) { setForm(FORM_VACÍO); setShowForm(true); onOpenNewConsumed?.(); }
  }, [openNew]); // eslint-disable-line react-hooks/exhaustive-deps

  async function cargar() {
    setLoading(true);
    try {
      const [ops, cbs, ic] = await Promise.all([
        fetchIntercompania(), fetchCuentasBancarias(), fetchIntercoData().catch(() => null),
      ]);
      setTodos(ops);
      setAllCuentas(cbs ?? []);
      setIntercoData(ic);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargar(); }, [sociedad]); // eslint-disable-line react-hooks/exhaustive-deps

  const mias = useMemo(
    () => todos.filter(op => op.socOrigen === sociedad || op.socDestino === sociedad),
    [todos, sociedad]
  );

  // Cuenta seleccionada como origen. La transferencia interco es SIEMPRE en la MISMA moneda
  // (mando USD → reciben USD): si hay que convertir pesos↔USD, eso es un Cambio de moneda aparte.
  const ctaOrigen  = allCuentas.find(c => c.id === form.ctaOrigenId);
  const ctaDestino = allCuentas.find(c => c.id === form.ctaDestinoId);
  const moneda     = ctaOrigen?.moneda ?? "";
  const montoN     = Number(form.monto) || 0;

  const canSave =
    form.fecha &&
    form.ctaOrigenId &&
    form.ctaDestinoId &&
    form.ctaOrigenId !== form.ctaDestinoId &&
    montoN > 0;

  const _savingRef = useRef(false);
  async function handleGuardar() {
    if (!canSave || _savingRef.current) return;
    _savingRef.current = true;
    setSaving(true);
    try {
      await appendIntercompania({
        fecha:         form.fecha,
        tipoOp:        form.tipoOp,
        socOrigen:     ctaOrigen.sociedad,
        ctaOrigen:     form.ctaOrigenId,
        monedaOrigen:  moneda,
        montoOrigen:   montoN,
        socDestino:    ctaDestino.sociedad,
        ctaDestino:    form.ctaDestinoId,
        monedaDestino: moneda,   // misma moneda en ambas patas
        montoDestino:  montoN,
        nota:          form.nota,
      });
      setForm(FORM_VACÍO);
      setShowForm(false);
      await cargar();
    } finally {
      _savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleEliminar(op) {
    if (!window.confirm("¿Eliminar esta operación intercompañía?")) return;
    setDeleting(op.id);
    try {
      await deleteIntercompania(op._ids);
      await cargar();
    } finally {
      setDeleting(null);
    }
  }

  const ctaLabel = (c) => {
    const icon = TIPO_CUENTA[(c.tipo ?? "").toLowerCase()]?.icon ?? "💳";
    const soc  = SOCIEDADES.find(s => s.id === c.sociedad);
    return `${icon} ${c.nombre} (${soc?.nombre ?? c.sociedad})`;
  };

  const ctaNombre = (id) => {
    const c = allCuentas.find(x => x.id === id);
    return c ? c.nombre : id;
  };


  // Cuentas destino: OTRA sociedad y MISMA moneda que el origen (la transferencia no convierte).
  const cuentasDestino = useMemo(() =>
    allCuentas.filter(c => c.sociedad !== ctaOrigen?.sociedad && (!moneda || c.moneda === moneda)),
    [allCuentas, ctaOrigen, moneda]
  );

  // Posiciones interco de ESTA sociedad (nos deben / les debemos) — la misma lectura que Reportes.
  const nombreSoc = useMemo(() => {
    const m = sociedadNombreMap(intercoData?.sociedades ?? []);
    return id => m.get(String(id)) || socNombre(id);
  }, [intercoData]);
  const posiciones = useMemo(
    () => (intercoData ? lecturaInterco(intercoData, { sociedad }) : []).filter(p => Math.abs(p.neto) > 0.01),
    [intercoData, sociedad]
  );

  return (
    <div className="fade" style={{ padding:"28px 32px", display:"flex", flexDirection:"column", minHeight:"calc(100vh - 60px)" }}>
      <PageHeader
        title="Transferencias Intercompañía"
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
            <span style={{ fontSize:15, fontWeight:800, color:"#fff" }}>Nueva operación intercompañía</span>
            <button onClick={() => { setShowForm(false); setForm(FORM_VACÍO); }}
              style={{ background:"transparent", border:"none", color:"rgba(255,255,255,.6)",
                fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
          </div>
          <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Input label="Fecha" required type="date" value={form.fecha} onChange={v => set("fecha", v)} />
              <Input label={`Monto${moneda ? ` (${moneda})` : ""}`} required type="number"
                value={form.monto} onChange={v => set("monto", v)} placeholder="0,00" />
            </div>
            <Select label="Financia — cuenta de salida" required value={form.ctaOrigenId}
              onChange={v => { set("ctaOrigenId", v); set("ctaDestinoId", ""); }}
              options={allCuentas.map(c => ({ value: c.id, label: ctaLabel(c) }))} />
            {form.ctaOrigenId && (
              <div style={{ fontSize:11, color:T.muted, marginTop:-8 }}>
                Solo se muestran cuentas en <strong>{moneda}</strong> para la entrada
              </div>
            )}
            <Select label="Recibe — cuenta de entrada" required value={form.ctaDestinoId}
              onChange={v => set("ctaDestinoId", v)}
              options={cuentasDestino.map(c => ({ value: c.id, label: ctaLabel(c) }))} />
            <Select label="Tipo de operación" value={form.tipoOp} onChange={v => set("tipoOp", v)}
              options={[{ value:"prestamo", label:"Préstamo" }, { value:"fondeo", label:"Fondeo / Inversión" }]} />
            <div>
              <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>Observación</label>
              <textarea value={form.nota} onChange={e => set("nota", e.target.value)}
                placeholder="Ej: cobertura de nómina, apertura Colombia…"
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

      {loading ? (
        <div style={{ color:T.muted, fontSize:13, padding:"40px 0", textAlign:"center" }}>Cargando…</div>
      ) : (posiciones.length === 0 && mias.length === 0) ? (
        <div style={{ color:T.dim, fontSize:13, padding:"20px 0" }}>
          No hay saldos ni operaciones intercompañía para esta sociedad.
        </div>
      ) : (
        <>
          {/* ── Posiciones (saldo neto: nos deben / les debemos) ── */}
          {posiciones.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize:11, fontWeight:800, color:T.muted, letterSpacing:".06em",
                textTransform:"uppercase", marginBottom:8 }}>Posiciones</div>
              <TablaPosiciones posiciones={posiciones} nombreSoc={nombreSoc} />
            </div>
          )}

          {/* ── Operaciones (transferencias / préstamos registrados) ── */}
          {mias.length > 0 && (
            <div>
              <div style={{ fontSize:11, fontWeight:800, color:T.muted, letterSpacing:".06em",
                textTransform:"uppercase", marginBottom:8 }}>Operaciones</div>
              <TablaICP ops={mias} ctaNombre={ctaNombre} sociedad={sociedad}
                handleEliminar={handleEliminar} deleting={deleting} />
            </div>
          )}
        </>
      )}

    </div>
  );
}

// Tabla de posiciones netas (estilo Ingresos/Egresos). saldo>0 = nos deben, <0 = les debemos.
function TablaPosiciones({ posiciones, nombreSoc }) {
  return (
    <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
      borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
        <thead>
          <tr style={{ background:T.tableHead }}>
            {[{ h:"Contraparte", a:"left" }, { h:"Moneda", a:"left" }, { h:"Saldo", a:"right" }, { h:"Situación", a:"left" }].map((c, i) => (
              <th key={i} style={{ padding:"9px 14px", textAlign:c.a, fontSize:11, fontWeight:700,
                color:T.tableHeadText, textTransform:"uppercase", letterSpacing:".07em", whiteSpace:"nowrap" }}>{c.h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {posiciones.map((p, idx) => {
            const nosDeben = p.neto > 0;
            return (
              <tr key={idx} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                background: idx % 2 === 0 ? T.card : "#fafbfc" }}
                onMouseEnter={e => e.currentTarget.style.background = "#eceff3"}
                onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? T.card : "#fafbfc"}>
                <td style={{ padding:"10px 14px", fontWeight:600, color:T.text }}>{nombreSoc(p.contraparte)}</td>
                <td style={{ padding:"10px 14px", color:T.dim, fontWeight:600 }}>{p.moneda}</td>
                <td style={{ padding:"10px 14px", textAlign:"right", whiteSpace:"nowrap",
                  fontFamily:"var(--mono)", fontWeight:700, color: nosDeben ? "#16a34a" : "#dc2626" }}>
                  {fmtMoney(Math.abs(p.neto), p.moneda)}
                </td>
                <td style={{ padding:"10px 14px" }}>
                  <span style={{ fontSize:11, fontWeight:700, borderRadius:4, padding:"2px 8px",
                    background: nosDeben ? "#dcfce7" : "#fee2e2", color: nosDeben ? "#16a34a" : "#dc2626" }}>
                    {nosDeben ? "nos deben" : "les debemos"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


function TablaICP({ ops, ctaNombre, sociedad, handleEliminar, deleting }) {
  // Alineación por columna: los montos a la derecha (header + celda), el resto a la izquierda.
  const cols = [
    { h:"Fecha", align:"left" }, { h:"Tipo", align:"left" },
    { h:"Financió", align:"left" }, { h:"Monto", align:"right" },
    { h:"Recibió", align:"left" }, { h:"Monto", align:"right" },
    { h:"TC", align:"left" }, { h:"Nota", align:"left" }, { h:"", align:"center" },
  ];

  return (
    <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
      borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
        <thead>
          <tr style={{ background:T.tableHead }}>
            {cols.map((c, i) => (
              <th key={i} style={{ padding:"9px 14px", textAlign:c.align,
                fontSize:11, fontWeight:700, color:T.tableHeadText, textTransform:"uppercase",
                letterSpacing:".07em", whiteSpace:"nowrap" }}>{c.h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ops.map((op, idx) => {
            const esOrigen  = op.socOrigen  === sociedad;
            const esDestino = op.socDestino === sociedad;
            const tcNum = Number(op.tc);
            const tcStr = tcNum > 0 && op.monedaOrigen !== op.monedaDestino
              ? `1 ${op.monedaOrigen} = ${tcNum.toFixed(2)} ${op.monedaDestino}`
              : "—";
            const cfg = TIPO_OP_CFG[op.tipo_op] ?? TIPO_OP_CFG.prestamo;

            return (
              <tr key={op.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                background: idx % 2 === 0 ? T.card : "#fafbfc" }}
                onMouseEnter={e => e.currentTarget.style.background = "#eceff3"}
                onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? T.card : "#fafbfc"}>
                <td style={{ padding:"10px 14px", color:T.muted, whiteSpace:"nowrap" }}>{fmtDate(op.fecha)}</td>
                <td style={{ padding:"10px 14px" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:cfg.color,
                    background:cfg.bg, borderRadius:4, padding:"2px 7px", whiteSpace:"nowrap" }}>
                    {cfg.label}
                  </span>
                </td>
                <td style={{ padding:"10px 14px", whiteSpace:"nowrap" }}>
                  <span style={{ fontWeight:600, color: esOrigen ? "#dc2626" : T.text }}>
                    {socNombre(op.socOrigen)}
                  </span>
                  <span style={{ fontSize:11, color:T.dim, marginLeft:6 }}>{ctaNombre(op.ctaOrigen)}</span>
                </td>
                <td style={{ padding:"10px 14px", textAlign:"right", whiteSpace:"nowrap",
                  fontFamily:"var(--mono)", fontWeight:700, color: esOrigen ? "#dc2626" : T.muted }}>
                  {esOrigen ? "− " : ""}{fmtMoney(op.montoOrigen, op.monedaOrigen)}
                </td>
                <td style={{ padding:"10px 14px", whiteSpace:"nowrap" }}>
                  <span style={{ fontWeight:600, color: esDestino ? "#16a34a" : T.text }}>
                    {socNombre(op.socDestino)}
                  </span>
                  <span style={{ fontSize:11, color:T.dim, marginLeft:6 }}>{ctaNombre(op.ctaDestino)}</span>
                </td>
                <td style={{ padding:"10px 14px", textAlign:"right", whiteSpace:"nowrap",
                  fontFamily:"var(--mono)", fontWeight:700, color: esDestino ? "#16a34a" : T.muted }}>
                  {esDestino ? "+ " : ""}{fmtMoney(op.montoDestino, op.monedaDestino)}
                </td>
                <td style={{ padding:"10px 14px", color:T.muted, fontSize:12, whiteSpace:"nowrap" }}>{tcStr}</td>
                <td style={{ padding:"10px 14px", color:T.dim, fontSize:12, maxWidth:180,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {op.nota || "—"}
                </td>
                <td style={{ padding:"10px 14px", textAlign:"center" }}>
                  <button
                    onClick={() => handleEliminar(op)}
                    disabled={deleting === op.id}
                    title="Eliminar operación"
                    style={{ background:"transparent", border:"none", cursor:"pointer",
                      color:"#ef4444", fontSize:15, padding:"2px 6px", borderRadius:6,
                      opacity: deleting === op.id ? .4 : 1 }}>
                    🗑
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
