import { useState, useEffect, useMemo } from "react";
import { T, Btn, PageHeader, fmtDate, fmtMoney } from "./theme";
import { TIPO_CUENTA, SOCIEDADES } from "../data/tesoreriaData";
import { fetchIntercompania, appendIntercompania, deleteIntercompania, fetchCuentasBancarias } from "../lib/numbersApi";

const HOY = new Date().toISOString().slice(0, 10);

const FORM_VACÍO = {
  fecha:         HOY,
  ctaOrigenId:   "",
  montoOrigen:   "",
  ctaDestinoId:  "",
  montoDestino:  "",
  tipoOp:        "prestamo",
  nota:          "",
};

const TIPO_OP_CFG = {
  prestamo: { label: "Préstamo",        bg: "#dbeafe", color: "#1d4ed8" },
  fondeo:   { label: "Fondeo / Inv.",   bg: "#ffedd5", color: "#c2410c" },
};

const inputStyle = {
  width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e5e7eb",
  fontSize:13, fontFamily:T.font, background:"#fff", color:T.text, outline:"none",
  boxSizing:"border-box",
};
const labelStyle = { fontSize:11, fontWeight:700, color:T.muted, marginBottom:4, display:"block" };

// Nombre corto de sociedad
const socNombre = (id) => SOCIEDADES.find(s => s.id === id)?.nombre ?? id;

export default function PantallaIntercompania({ sociedad }) {
  const [todos,      setTodos]      = useState([]);
  const [allCuentas, setAllCuentas] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [form,       setForm]       = useState(FORM_VACÍO);
  const [deleting,   setDeleting]   = useState(null);
  const [otrasOpen,  setOtrasOpen]  = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function cargar() {
    setLoading(true);
    try {
      const [ops, cbs] = await Promise.all([fetchIntercompania(), fetchCuentasBancarias()]);
      setTodos(ops);
      setAllCuentas(cbs ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargar(); }, [sociedad]); // eslint-disable-line react-hooks/exhaustive-deps

  const { mias, otras } = useMemo(() => {
    const m = [], o = [];
    for (const op of todos) {
      (op.socOrigen === sociedad || op.socDestino === sociedad ? m : o).push(op);
    }
    return { mias: m, otras: o };
  }, [todos, sociedad]);

  // Cuenta seleccionada como origen
  const ctaOrigen  = allCuentas.find(c => c.id === form.ctaOrigenId);
  const ctaDestino = allCuentas.find(c => c.id === form.ctaDestinoId);
  const monedaOrigen  = ctaOrigen?.moneda  ?? "";
  const monedaDestino = ctaDestino?.moneda ?? "";

  // TC calculado para mostrar
  const montoOrigenN  = Number(form.montoOrigen)  || 0;
  const montoDestinoN = Number(form.montoDestino) || 0;
  let tcLineA = null, tcLineB = null;
  if (montoOrigenN > 0 && montoDestinoN > 0 && monedaOrigen && monedaDestino && monedaOrigen !== monedaDestino) {
    const fwd = montoDestinoN / montoOrigenN;
    tcLineA = `1 ${monedaOrigen} = ${fwd.toFixed(2)} ${monedaDestino}`;
    tcLineB = `1 ${monedaDestino} = ${(1 / fwd).toFixed(4)} ${monedaOrigen}`;
  }

  const canSave =
    form.fecha &&
    form.ctaOrigenId &&
    form.ctaDestinoId &&
    form.ctaOrigenId !== form.ctaDestinoId &&
    montoOrigenN > 0 &&
    montoDestinoN > 0;

  async function handleGuardar() {
    if (!canSave) return;
    setSaving(true);
    try {
      await appendIntercompania({
        fecha:         form.fecha,
        tipoOp:        form.tipoOp,
        socOrigen:     ctaOrigen.sociedad,
        ctaOrigen:     form.ctaOrigenId,
        monedaOrigen,
        montoOrigen:   montoOrigenN,
        socDestino:    ctaDestino.sociedad,
        ctaDestino:    form.ctaDestinoId,
        monedaDestino,
        montoDestino:  montoDestinoN,
        nota:          form.nota,
      });
      setForm(FORM_VACÍO);
      setShowForm(false);
      await cargar();
    } finally {
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

  // Saldos netos por contraparte y moneda, separados por tipo_op
  const saldos = useMemo(() => {
    const map = {}; // key: `${contraparte}|${moneda}|${tipo_op}`
    for (const op of mias) {
      const contraparte = op.socOrigen === sociedad ? op.socDestino : op.socOrigen;
      const [moneda, monto] = op.socOrigen === sociedad
        ? [op.monedaOrigen,  -op.montoOrigen]   // yo envié
        : [op.monedaDestino,  op.montoDestino];  // yo recibí
      const key = `${contraparte}|${moneda}|${op.tipo_op}`;
      map[key] = (map[key] ?? 0) + monto;
    }
    return Object.entries(map)
      .filter(([, v]) => Math.abs(v) > 0.001)
      .map(([key, neto]) => {
        const [contraparte, moneda, tipo_op] = key.split("|");
        return { contraparte, moneda, tipo_op, neto };
      })
      .sort((a, b) => a.tipo_op.localeCompare(b.tipo_op) || a.contraparte.localeCompare(b.contraparte));
  }, [mias, sociedad]);

  // Cuentas disponibles para destino (diferente sociedad al origen)
  const cuentasDestino = useMemo(() =>
    allCuentas.filter(c => c.sociedad !== ctaOrigen?.sociedad),
    [allCuentas, ctaOrigen]
  );

  return (
    <div className="fade" style={{ padding:"28px 32px", display:"flex", flexDirection:"column", minHeight:"calc(100vh - 60px)" }}>
      <PageHeader
        title="Transferencias Intercompañía"
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

          {/* Grilla: fecha/TC | origen | → | destino */}
          <div style={{ display:"grid", gridTemplateColumns:"150px 1fr 40px 1fr", gap:12, alignItems:"end", marginBottom:16 }}>

            {/* Fecha */}
            <div>
              <label style={labelStyle}>Fecha</label>
              <input type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)}
                style={inputStyle} />
            </div>

            {/* Cuenta origen */}
            <div>
              <label style={labelStyle}>Financia — cuenta origen</label>
              <select value={form.ctaOrigenId} onChange={e => { set("ctaOrigenId", e.target.value); set("ctaDestinoId", ""); }}
                style={inputStyle}>
                <option value="">Seleccionar cuenta…</option>
                {allCuentas.map(c => (
                  <option key={c.id} value={c.id}>{ctaLabel(c)}</option>
                ))}
              </select>
            </div>

            {/* Flecha fila 1 */}
            <div style={{ textAlign:"center", paddingBottom:2, fontSize:18, color:T.muted }}>→</div>

            {/* Cuenta destino */}
            <div>
              <label style={labelStyle}>Recibe — cuenta destino</label>
              <select value={form.ctaDestinoId} onChange={e => set("ctaDestinoId", e.target.value)}
                style={inputStyle}>
                <option value="">Seleccionar cuenta…</option>
                {cuentasDestino.map(c => (
                  <option key={c.id} value={c.id}>{ctaLabel(c)}</option>
                ))}
              </select>
            </div>

            {/* TC read-only — debajo de Fecha */}
            <div>
              <label style={labelStyle}>Tipo de cambio</label>
              <div style={{ ...inputStyle, background:"#f3f4f6", color:T.muted,
                display:"flex", alignItems:"center", gap:6, height:36, whiteSpace:"nowrap", padding:"6px 8px" }}>
                {tcLineA
                  ? <><span style={{ fontSize:11, fontWeight:600 }}>{tcLineA}</span>
                      <span style={{ color:T.dim, fontSize:10 }}>·</span>
                      <span style={{ fontSize:10, color:T.dim }}>{tcLineB}</span></>
                  : <span style={{ fontSize:12, color:T.dim }}>
                      {monedaOrigen && monedaDestino && monedaOrigen === monedaDestino ? "Misma moneda" : "—"}
                    </span>}
              </div>
            </div>

            {/* Monto origen */}
            <div>
              <label style={labelStyle}>Monto{monedaOrigen ? ` (${monedaOrigen})` : ""}</label>
              <input type="number" min="0" step="any" placeholder="0"
                value={form.montoOrigen} onChange={e => set("montoOrigen", e.target.value)}
                style={inputStyle} />
            </div>

            {/* Flecha fila 2 */}
            <div style={{ textAlign:"center", paddingBottom:2, fontSize:18, color:T.muted }}>→</div>

            {/* Monto destino */}
            <div>
              <label style={labelStyle}>Monto{monedaDestino ? ` (${monedaDestino})` : ""}</label>
              <input type="number" min="0" step="any" placeholder="0"
                value={form.montoDestino} onChange={e => set("montoDestino", e.target.value)}
                style={inputStyle} />
            </div>
          </div>

          {/* Tipo + Nota */}
          <div style={{ display:"grid", gridTemplateColumns:"200px 1fr", gap:12, marginBottom:16 }}>
            <div>
              <label style={labelStyle}>Tipo de operación</label>
              <select value={form.tipoOp} onChange={e => set("tipoOp", e.target.value)} style={inputStyle}>
                <option value="prestamo">Préstamo</option>
                <option value="fondeo">Fondeo / Inversión</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Nota (opcional)</label>
              <input type="text" placeholder="Ej: cobertura de nómina, apertura Colombia…"
                value={form.nota} onChange={e => set("nota", e.target.value)}
                style={inputStyle} />
            </div>
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

      {/* ── Saldos netos ── */}
      {!loading && saldos.length > 0 && (
        <ResumenSaldos saldos={saldos} />
      )}

      {/* ── Tabla sociedad activa ── */}
      {loading ? (
        <div style={{ color:T.muted, fontSize:13, padding:"40px 0", textAlign:"center" }}>Cargando…</div>
      ) : mias.length === 0 ? (
        <div style={{ color:T.dim, fontSize:13, padding:"20px 0" }}>
          No hay operaciones intercompañía registradas para esta sociedad.
        </div>
      ) : (
        <TablaICP ops={mias} ctaNombre={ctaNombre} sociedad={sociedad}
          handleEliminar={handleEliminar} deleting={deleting} />
      )}

      {/* ── Otras sociedades ── */}
      {!loading && otras.length > 0 && (
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
            <div style={{ background:"#fff", borderRadius:12, padding:"4px 16px 16px",
              border:`1px solid ${T.cardBorder}`, boxShadow:"0 1px 4px rgba(0,0,0,.06)", overflowX:"auto" }}>
              <TablaICP ops={otras} ctaNombre={ctaNombre} sociedad={null}
                handleEliminar={handleEliminar} deleting={deleting} showSociedad />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SaldoChip({ s }) {
  const positivo = s.neto > 0;
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
      padding:"6px 12px", borderRadius:8,
      background: positivo ? "#f0fdf4" : "#fff7f7",
      border: `1px solid ${positivo ? "#bbf7d0" : "#fecaca"}` }}>
      <span style={{ fontSize:12, fontWeight:600, color:T.text }}>{socNombre(s.contraparte)}</span>
      <span style={{ fontSize:13, fontWeight:700, color: positivo ? "#16a34a" : "#dc2626", marginLeft:16 }}>
        {positivo ? "+" : ""}{fmtMoney(Math.abs(s.neto), s.moneda)}
        <span style={{ fontSize:10, fontWeight:400, color:T.muted, marginLeft:4 }}>
          {positivo ? "me deben" : "les debo"}
        </span>
      </span>
    </div>
  );
}

function ResumenSaldos({ saldos }) {
  const prestamos = saldos.filter(s => s.tipo_op === "prestamo");
  const fondeos   = saldos.filter(s => s.tipo_op === "fondeo");

  return (
    <div style={{ display:"grid", gridTemplateColumns: fondeos.length > 0 ? "1fr 1fr" : "1fr",
      gap:16, marginBottom:24 }}>
      {prestamos.length > 0 && (
        <div style={{ background:"#fff", border:`1px solid ${T.cardBorder}`, borderRadius:12, padding:"14px 16px" }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#1d4ed8", letterSpacing:".08em",
            textTransform:"uppercase", marginBottom:10 }}>Préstamos</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {prestamos.map((s,i) => <SaldoChip key={i} s={s} />)}
          </div>
        </div>
      )}
      {fondeos.length > 0 && (
        <div style={{ background:"#fff", border:`1px solid ${T.cardBorder}`, borderRadius:12, padding:"14px 16px" }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#c2410c", letterSpacing:".08em",
            textTransform:"uppercase", marginBottom:10 }}>Fondeos / Inversiones</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {fondeos.map((s,i) => <SaldoChip key={i} s={s} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function TablaICP({ ops, ctaNombre, sociedad, handleEliminar, deleting, showSociedad = false }) {
  const headers = ["Fecha", "Tipo", "Financió →", "Monto", "→ Recibió", "Monto", "TC", "Nota", ""];

  return (
    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
      <thead>
        <tr style={{ borderBottom:`2px solid ${T.cardBorder}` }}>
          {headers.map((h, i) => (
            <th key={i} style={{ padding:"8px 12px", textAlign: i === headers.length - 1 ? "center" : "left",
              fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".06em" }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ops.map(op => {
          const esOrigen  = op.socOrigen  === sociedad;
          const esDestino = op.socDestino === sociedad;
          const tcNum = Number(op.tc);
          const tcStr = tcNum > 0 && op.monedaOrigen !== op.monedaDestino
            ? `1 ${op.monedaOrigen} = ${tcNum.toFixed(2)} ${op.monedaDestino}`
            : "—";
          const cfg = TIPO_OP_CFG[op.tipo_op] ?? TIPO_OP_CFG.prestamo;

          return (
            <tr key={op.id} style={{ borderBottom:`1px solid ${T.cardBorder}` }}
              onMouseEnter={e => e.currentTarget.style.background = "#f9fafb"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <td style={{ padding:"10px 12px", color:T.muted }}>{fmtDate(op.fecha)}</td>
              <td style={{ padding:"10px 12px" }}>
                <span style={{ fontSize:11, fontWeight:700, color:cfg.color,
                  background:cfg.bg, borderRadius:4, padding:"2px 7px" }}>
                  {cfg.label}
                </span>
              </td>
              <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>
                <span style={{ fontWeight:600, color: esOrigen ? "#dc2626" : T.text }}>
                  {socNombre(op.socOrigen)}
                </span>
                <span style={{ fontSize:11, color:T.dim, marginLeft:6 }}>{ctaNombre(op.ctaOrigen)}</span>
              </td>
              <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>
                <span style={{ fontWeight:700, color: esOrigen ? "#dc2626" : T.muted }}>
                  {esOrigen ? "− " : ""}{fmtMoney(op.montoOrigen, op.monedaOrigen)}
                </span>
              </td>
              <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>
                <span style={{ fontWeight:600, color: esDestino ? "#16a34a" : T.text }}>
                  {socNombre(op.socDestino)}
                </span>
                <span style={{ fontSize:11, color:T.dim, marginLeft:6 }}>{ctaNombre(op.ctaDestino)}</span>
              </td>
              <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>
                <span style={{ fontWeight:700, color: esDestino ? "#16a34a" : T.muted }}>
                  {esDestino ? "+ " : ""}{fmtMoney(op.montoDestino, op.monedaDestino)}
                </span>
              </td>
              <td style={{ padding:"10px 12px", color:T.muted, fontSize:12 }}>{tcStr}</td>
              <td style={{ padding:"10px 12px", color:T.dim, fontSize:12, maxWidth:180,
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                {op.nota || "—"}
              </td>
              <td style={{ padding:"10px 12px", textAlign:"center" }}>
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
  );
}
