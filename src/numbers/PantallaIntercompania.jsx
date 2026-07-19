import { useState, useEffect, useMemo, useRef } from "react";
import { T, Btn, Input, Select, PageHeader, fmtMoney } from "./theme";
import { TIPO_CUENTA, SOCIEDADES } from "../data/tesoreriaData";
import { appendIntercompania, fetchCuentasBancarias, fetchIntercoData, lecturaInterco } from "../lib/numbersApi";
import { sociedadNombreMap } from "./tesoreriaDerive";

const HOY = new Date().toISOString().slice(0, 10);

const FORM_VACÍO = {
  fecha:        HOY,
  ctaOrigenId:  "",
  ctaDestinoId: "",
  monto:        "",
  nota:         "",
};

// Nombre corto de sociedad
const socNombre = (id) => SOCIEDADES.find(s => s.id === id)?.nombre ?? id;

export default function PantallaIntercompania({ sociedad, openNew, onOpenNewConsumed }) {
  const [allCuentas, setAllCuentas] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [form,       setForm]       = useState(FORM_VACÍO);
  const [intercoData, setIntercoData] = useState(null);   // fuente de las posiciones (CC viva)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Abrir el modal desde el "+" del sidebar (una sola vez por click).
  useEffect(() => {
    if (openNew) { setForm(FORM_VACÍO); setShowForm(true); onOpenNewConsumed?.(); }
  }, [openNew]); // eslint-disable-line react-hooks/exhaustive-deps

  async function cargar() {
    setLoading(true);
    try {
      const [cbs, ic] = await Promise.all([
        fetchCuentasBancarias(), fetchIntercoData().catch(() => null),
      ]);
      setAllCuentas(cbs ?? []);
      setIntercoData(ic);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { cargar(); }, [sociedad]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const ctaLabel = (c) => {
    const icon = TIPO_CUENTA[(c.tipo ?? "").toLowerCase()]?.icon ?? "💳";
    const soc  = SOCIEDADES.find(s => s.id === c.sociedad);
    return `${icon} ${c.nombre} (${soc?.nombre ?? c.sociedad})`;
  };

  // Cuentas destino: OTRA sociedad y MISMA moneda que el origen (la transferencia no convierte).
  const cuentasDestino = useMemo(() =>
    allCuentas.filter(c => c.sociedad !== ctaOrigen?.sociedad && (!moneda || c.moneda === moneda)),
    [allCuentas, ctaOrigen, moneda]
  );

  // Posiciones interco de ESTA sociedad (CC viva) — misma lectura que Reportes.
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
        title="Cuenta corriente intercompañía"
        action={
          <Btn onClick={() => { setForm(FORM_VACÍO); setShowForm(true); }}
            style={{ background: T.accent, color:"#000", border:"none" }}>
            + Nueva transferencia
          </Btn>
        }
      />

      {/* ── Modal: nueva transferencia interco ── */}
      {showForm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:500,
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
          onClick={() => { setShowForm(false); setForm(FORM_VACÍO); }}>
        <div className="fade" style={{ background:T.card, borderRadius:10, width:520, maxWidth:"97vw",
          boxShadow:"0 20px 60px rgba(0,0,0,.25)", overflow:"hidden" }} onClick={e => e.stopPropagation()}>
          <div style={{ background:"#0e7490", padding:"14px 22px", display:"flex",
            justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:15, fontWeight:800, color:"#fff" }}>Nueva transferencia intercompañía</span>
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
            <Select label="Salió de — cuenta" required value={form.ctaOrigenId}
              onChange={v => { set("ctaOrigenId", v); set("ctaDestinoId", ""); }}
              options={allCuentas.map(c => ({ value: c.id, label: ctaLabel(c) }))} />
            {form.ctaOrigenId && (
              <div style={{ fontSize:11, color:T.muted, marginTop:-8 }}>
                Solo se muestran cuentas en <strong>{moneda}</strong> para la entrada
              </div>
            )}
            <Select label="Entró a — cuenta" required value={form.ctaDestinoId}
              onChange={v => set("ctaDestinoId", v)}
              options={cuentasDestino.map(c => ({ value: c.id, label: ctaLabel(c) }))} />
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

      <div style={{ fontSize:12, color:T.muted, margin:"2px 0 12px", maxWidth:760 }}>
        Saldo vivo con cada sociedad: <b>saldo inicial</b> (apertura) + <b>movimientos</b> (transferencias) = <b>saldo</b>.
        En <span style={{ color:"#16a34a", fontWeight:700 }}>verde</span> lo que nos deben; en <span style={{ color:"#dc2626", fontWeight:700 }}>rojo</span> lo que les debemos.
        Si es inversión o crédito puente se define por el anillo, del lado del patrimonio.
      </div>

      {loading ? (
        <div style={{ color:T.muted, fontSize:13, padding:"40px 0", textAlign:"center" }}>Cargando…</div>
      ) : posiciones.length === 0 ? (
        <div style={{ color:T.dim, fontSize:13, padding:"20px 0" }}>
          No hay saldos intercompañía para esta sociedad.
        </div>
      ) : (
        <TablaCC posiciones={posiciones} nombreSoc={nombreSoc} />
      )}
    </div>
  );
}

// Cuenta corriente interco en UNA tabla: saldo inicial + movimientos + saldo (última columna).
// Valor firmado desde MI perspectiva: + nos deben (verde) / − les debemos (rojo).
function TablaCC({ posiciones, nombreSoc }) {
  const cell = (v, moneda, bold) => {
    if (Math.abs(v) < 0.01) return <span style={{ color:T.dim }}>—</span>;
    const pos = v > 0;
    return (
      <span style={{ fontFamily:"var(--mono)", fontWeight: bold ? 800 : 700, color: pos ? "#16a34a" : "#dc2626" }}>
        {pos ? "" : "− "}{fmtMoney(Math.abs(v), moneda)}
      </span>
    );
  };
  const cols = [
    { h:"Contraparte", a:"left" }, { h:"Moneda", a:"left" },
    { h:"Saldo inicial", a:"right" }, { h:"Movimientos", a:"right" }, { h:"Saldo", a:"right" },
  ];
  return (
    <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
      borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
        <thead>
          <tr style={{ background:T.tableHead }}>
            {cols.map((c, i) => (
              <th key={i} style={{ padding:"9px 14px", textAlign:c.a, fontSize:11, fontWeight:700,
                color:T.tableHeadText, textTransform:"uppercase", letterSpacing:".07em", whiteSpace:"nowrap" }}>{c.h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {posiciones.map((p, idx) => (
            <tr key={idx} style={{ borderBottom:`1px solid ${T.cardBorder}`,
              background: idx % 2 === 0 ? T.card : "#fafbfc" }}
              onMouseEnter={e => e.currentTarget.style.background = "#eceff3"}
              onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? T.card : "#fafbfc"}>
              <td style={{ padding:"10px 14px", fontWeight:600, color:T.text }}>{nombreSoc(p.contraparte)}</td>
              <td style={{ padding:"10px 14px", color:T.dim, fontWeight:600 }}>{p.moneda}</td>
              <td style={{ padding:"10px 14px", textAlign:"right", whiteSpace:"nowrap" }}>{cell(p.inicial, p.moneda)}</td>
              <td style={{ padding:"10px 14px", textAlign:"right", whiteSpace:"nowrap" }}>{cell(p.movimientos, p.moneda)}</td>
              <td style={{ padding:"10px 14px", textAlign:"right", whiteSpace:"nowrap" }}>{cell(p.neto, p.moneda, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
