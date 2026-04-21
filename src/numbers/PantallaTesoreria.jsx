import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { T, Btn, Input, Select, PageHeader, fmtDate } from "./theme";
import {
  TIPO_CUENTA, MONEDA_SYM, fmtSaldo,
} from "../data/tesoreriaData";
import { CENTROS_COSTO } from "../data/numbersData";
import {
  fetchMovTesoreria, appendMovTesoreria, deleteMovTesoreria, updateMovTesoreria,
  fetchEgresos, fetchIngresos, fetchPagosCobros, calcSaldoPendiente,
  fetchCuentasBancarias, fetchCuentas, fetchCentrosCosto,
  appendGastoDirecto,
} from "../lib/numbersApi";
// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIPO_CFG = {
  PAGO_FC:       { bg:"#fff7ed", color:"#f97316", label:"Pago FC"     },
  COBRO_FC:      { bg:"#f0f9ff", color:"#0ea5e9", label:"Cobro FC"    },
  EGRESO_GASTO:  { bg:"#fef9c3", color:"#ca8a04", label:"Gasto"       },
  TRANSFERENCIA: { bg:"#dbeafe", color:"#2563eb", label:"Transferencia"},
};

/** Botones de barra — misma geometría; variante por intención */
const tesoreriaActionBtn = {
  base: {
    borderRadius: 8,
    padding: "9px 18px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: T.font,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    transition: "box-shadow .15s, background .15s, border-color .15s",
  },
  gasto: {
    background: "#9a3412",
    color: "#fff",
    border: "1px solid #7c2d12",
    boxShadow: "0 1px 3px rgba(0,0,0,.08)",
  },
  transfer: {
    background: T.card,
    color: "#0f766e",
    border: `1px solid #0d9488`,
    boxShadow: "0 1px 2px rgba(0,0,0,.05)",
  },
};

// ─── Modal: Movimiento entre cuentas ─────────────────────────────────────────
function MovimientoModal({ sociedad, cuentasBancarias, onClose, onSave }) {
  const _soc = (sociedad ?? "").toLowerCase();
  const cuentasSoc = cuentasBancarias.filter(c => (c.sociedad ?? "").toLowerCase() === _soc);
  const [form, setForm] = useState({
    fecha: new Date().toISOString().slice(0, 10),
    monto: "", moneda: "ARS", cuentaSalida: "", cuentaEntrada: "", observacion: "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const canSave = form.fecha && form.monto && form.cuentaSalida && form.cuentaEntrada;

  const cuentasOptions = cuentasSoc.map(c => ({
    value: c.id,
    label: `${TIPO_CUENTA[c.tipo]?.icon ?? "💳"} ${c.nombre} (${c.moneda})`,
    moneda: c.moneda,
  }));

  // La cuenta de salida determina la moneda; la entrada debe ser de la misma moneda
  const monedaSalida  = cuentasOptions.find(c => c.value === form.cuentaSalida)?.moneda ?? null;
  const optsEntrada   = cuentasOptions.filter(c => c.value !== form.cuentaSalida && (monedaSalida ? c.moneda === monedaSalida : true));

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:10, width:520,
        maxWidth:"97vw", boxShadow:"0 20px 60px rgba(0,0,0,.25)", overflow:"hidden" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ background:"#0e7490", padding:"14px 22px", display:"flex",
          justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:15, fontWeight:800, color:"#fff" }}>Movimiento Entre Cuentas</span>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.6)", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>

        <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Input label="Fecha" required type="date" value={form.fecha} onChange={v => set("fecha", v)} />
            <Input label="Importe" required type="number" value={form.monto} onChange={v => set("monto", v)} placeholder="0,00" />
          </div>
          <Select label="Cuenta de salida" required value={form.cuentaSalida}
            onChange={v => { set("cuentaSalida", v); set("cuentaEntrada", ""); }}
            options={cuentasOptions} />
          {monedaSalida && (
            <div style={{ fontSize:11, color:T.muted, marginTop:-8 }}>
              Solo se muestran cuentas en <strong>{monedaSalida}</strong> para la entrada
            </div>
          )}
          <Select label="Cuenta de entrada" required value={form.cuentaEntrada} onChange={v => set("cuentaEntrada", v)}
            options={optsEntrada} />
          <div>
            <label style={{ fontSize:11, color:T.muted, fontWeight:700, display:"block",
              marginBottom:4, textTransform:"uppercase", letterSpacing:".06em" }}>Observación</label>
            <textarea value={form.observacion} onChange={e => set("observacion", e.target.value)}
              placeholder="Concepto del movimiento..."
              style={{ width:"100%", background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
                borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
                fontFamily:T.font, outline:"none", resize:"vertical", minHeight:64, boxSizing:"border-box" }} />
          </div>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
            <button onClick={onClose} style={{
              background:"#dc2626", border:"none", borderRadius:8, padding:"9px 20px",
              fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer", fontFamily:T.font }}>Cancelar ✕</button>
            <button onClick={() => { onSave(form); onClose(); }} disabled={!canSave} style={{
              background: canSave ? "#16a34a" : "#9ca3af", border:"none", borderRadius:8,
              padding:"9px 20px", fontSize:13, fontWeight:700, color:"#fff",
              cursor: canSave ? "pointer" : "default", fontFamily:T.font }}>Crear ✓</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Gasto Directo ─────────────────────────────────────────────────────
function GastoDirectoModal({ sociedad, cuentasBancarias, cuentasContables = [], centrosCosto = [], onClose, onSaved }) {
  const _soc       = (sociedad ?? "").toLowerCase();
  const cuentasSoc = cuentasBancarias.filter(c => (c.sociedad ?? "").toLowerCase() === _soc);

  const cuentasGasto = useMemo(() => {
    const f = cuentasContables.filter(c => {
      const t = (c.tipo ?? "").toLowerCase();
      return t === "gasto" || t === "gastos" || t === "financiero" || t === "egresos";
    });
    return f.length > 0 ? f : cuentasContables;
  }, [cuentasContables]);

  const [form, setForm] = useState({
    fecha:           new Date().toISOString().slice(0, 10),
    medioPago:       "",   // cuenta bancaria
    proveedor:       "",   // concepto / proveedor (→ nota)
    cuenta_contable: "",
    cc:              "",
    subtotal:        "",
    ivaRate:         "0",
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const moneda  = cuentasSoc.find(c => c.id === form.medioPago)?.moneda ?? "ARS";
  const sym     = moneda === "USD" ? "U$D" : moneda === "EUR" ? "€" : "$";
  const sub     = Number(form.subtotal) || 0;
  const iva     = sub * ((Number(form.ivaRate) || 0) / 100);
  const total   = sub + iva;
  const canSave = form.fecha && form.medioPago && form.cuenta_contable && form.cc && sub > 0;

  const fi = { // field input style
    width:"100%", background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
    borderRadius:7, padding:"8px 10px", fontSize:13, color:T.text,
    fontFamily:T.font, outline:"none", boxSizing:"border-box",
  };
  const lbl = (text, req) => (
    <label style={{ fontSize:11, color:T.muted, fontWeight:700, display:"block",
      marginBottom:4, textTransform:"uppercase", letterSpacing:".06em" }}>
      {text}{req && <span style={{ color:"#ef4444", marginLeft:2 }}>*</span>}
    </label>
  );

  const handleGuardar = async () => {
    setSaving(true);
    try {
      await appendGastoDirecto({
        sociedad, fecha: form.fecha,
        cuenta_contable:    form.cuenta_contable,
        cuenta_contable_id: cuentasGasto.find(c => c.nombre === form.cuenta_contable)?.id ?? "",
        cc:              form.cc,
        moneda,
        subtotal:        sub,
        ivaRate:         Number(form.ivaRate) || 0,
        nota:            form.proveedor || form.cuenta_contable,
        cuenta_bancaria: form.medioPago,
      });
      onSaved();
    } catch (e) {
      alert("Error al guardar: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:10, width:540,
        maxWidth:"97vw", boxShadow:"0 20px 60px rgba(0,0,0,.25)", overflow:"hidden" }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ background:"#78350f", padding:"14px 22px", display:"flex",
          justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:"#fbbf24" }}>Gasto Directo</div>
            <div style={{ fontSize:11, color:"rgba(251,191,36,.6)", marginTop:2 }}>
              Afecta P&L y Tesorería · La moneda se toma de la caja/banco seleccionado
            </div>
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(251,191,36,.6)", fontSize:20, cursor:"pointer", lineHeight:1, outline:"none" }}>✕</button>
        </div>

        {/* Campos — mismo orden que Egresos › Gastos Rápidos */}
        <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>

          {/* Fecha + Forma de Pago */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div>
              {lbl("Fecha", true)}
              <input type="date" value={form.fecha}
                onChange={e => set("fecha", e.target.value)} style={fi} />
            </div>
            <div>
              {lbl("Forma de Pago", true)}
              <select value={form.medioPago}
                onChange={e => set("medioPago", e.target.value)} style={{ ...fi, cursor:"pointer" }}>
                <option value="">— Caja / Banco —</option>
                {cuentasSoc.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}{c.moneda && c.moneda !== "ARS" ? ` (${c.moneda})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Proveedor / Concepto */}
          <div>
            {lbl("Proveedor / Concepto")}
            <input type="text" value={form.proveedor}
              onChange={e => set("proveedor", e.target.value)}
              placeholder="Proveedor o descripción del gasto…"
              style={fi} />
          </div>

          {/* Cuenta Contable */}
          <div>
            {lbl("Cuenta Contable (P&L)", true)}
            <select value={form.cuenta_contable}
              onChange={e => set("cuenta_contable", e.target.value)}
              style={{ ...fi, cursor:"pointer" }}>
              <option value="">— Cuenta —</option>
              {cuentasGasto.map(c => (
                <option key={c.id} value={c.nombre}>{c.nombre}</option>
              ))}
            </select>
          </div>

          {/* Centro de Costo */}
          <div>
            {lbl("Centro de Costo", true)}
            <select value={form.cc}
              onChange={e => set("cc", e.target.value)}
              style={{ ...fi, cursor:"pointer" }}>
              <option value="">— Sin CC —</option>
              {centrosCosto.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>

          {/* Subtotal + IVA */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div>
              {lbl("Subtotal", true)}
              <input type="number" value={form.subtotal}
                onChange={e => set("subtotal", e.target.value)}
                placeholder="0,00"
                style={{ ...fi, textAlign:"right", fontFamily:"var(--mono)" }} />
            </div>
            <div>
              {lbl("IVA %")}
              <select value={form.ivaRate}
                onChange={e => set("ivaRate", e.target.value)}
                style={{ ...fi, cursor:"pointer" }}>
                {["0","10.5","21","27"].map(v => (
                  <option key={v} value={v}>{v}%</option>
                ))}
              </select>
            </div>
          </div>

          {/* Total calculado */}
          {total > 0 && (
            <div style={{ background:"#fef9c3", border:"1px solid #fde68a", borderRadius:7,
              padding:"8px 14px", fontSize:13, color:"#78350f",
              display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ color:"#92400e" }}>
                IVA: {sym} {iva.toLocaleString("es-AR", { minimumFractionDigits:2 })}
              </span>
              <strong>
                Total: {sym} {total.toLocaleString("es-AR", { minimumFractionDigits:2 })}
              </strong>
            </div>
          )}

          {/* Botones */}
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, paddingTop:4 }}>
            <button onClick={onClose} style={{ background:"#f3f4f6", border:"none", borderRadius:8,
              padding:"9px 20px", fontSize:13, fontWeight:700, color:T.muted,
              cursor:"pointer", fontFamily:T.font, outline:"none" }}>Cancelar</button>
            <button onClick={handleGuardar} disabled={!canSave || saving} style={{
              background: canSave && !saving ? "#78350f" : "#9ca3af",
              border:"none", borderRadius:8, padding:"9px 20px", fontSize:13, fontWeight:700,
              color: canSave && !saving ? "#fbbf24" : "#fff",
              cursor: canSave && !saving ? "pointer" : "default",
              fontFamily:T.font, outline:"none" }}>
              {saving ? "Guardando…" : "Registrar Gasto ✓"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Editar movimiento existente ─────────────────────────────────────────────
function EditarMovModal({ mov, cuentasBancarias, onClose, onSave }) {
  const [form, setForm] = useState({
    fecha:           mov.fecha ?? new Date().toISOString().slice(0, 10),
    monto:           String(Math.abs(Number(mov.monto) || 0)),
    moneda:          mov.moneda ?? "ARS",
    cuenta_bancaria: mov.cuenta_bancaria ?? "",
    cuenta_contable: mov.cuenta_contable ?? mov.cuenta ?? "",
    concepto:        mov.concepto ?? "",
    centro_costo:    mov.centro_costo ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const tipoLabel = TIPO_CFG[mov.tipo]?.label ?? mov.tipo ?? "Movimiento";
  const tipoBg    = TIPO_CFG[mov.tipo]?.color ?? T.blue;

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(form); }
    catch (e) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const cuentasOptions = cuentasBancarias.map(c => ({
    value: c.id,
    label: `${TIPO_CUENTA[c.tipo]?.icon ?? "💳"} ${c.nombre} (${c.moneda})`,
  }));

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:10, width:440,
        maxWidth:"97vw", boxShadow:"0 20px 60px rgba(0,0,0,.25)", overflow:"hidden" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ background:tipoBg, padding:"14px 22px", display:"flex",
          justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontSize:15, fontWeight:800, color:"#fff" }}>Editar — {tipoLabel}</div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.6)", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>
        <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Input label="Fecha" required type="date" value={form.fecha} onChange={v => set("fecha", v)} />
            <Select label="Moneda" value={form.moneda} onChange={v => set("moneda", v)}
              options={Object.entries(MONEDA_SYM).map(([k, sym]) => ({ value:k, label:`${sym} ${k}` }))} />
          </div>
          <Input label="Monto" required type="number" value={form.monto}
            onChange={v => set("monto", v)} placeholder="0,00" />
          <Select label="Cuenta" value={form.cuenta_bancaria} onChange={v => set("cuenta_bancaria", v)}
            options={[{ value:"", label:"— Seleccioná —" }, ...cuentasOptions]} />
          <Input label="Concepto" value={form.concepto} onChange={v => set("concepto", v)} />
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, paddingTop:4 }}>
            <button onClick={onClose} style={{ background:"#f3f4f6", border:"none", borderRadius:8,
              padding:"9px 20px", fontSize:13, fontWeight:700, color:T.muted,
              cursor:"pointer", fontFamily:T.font }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{
              background: saving ? "#9ca3af" : tipoBg, border:"none", borderRadius:8,
              padding:"9px 20px", fontSize:13, fontWeight:700, color:"#fff",
              cursor: saving ? "default" : "pointer", fontFamily:T.font }}>
              {saving ? "Guardando…" : "Guardar ✓"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Bloque A Cobrar / A Pagar ────────────────────────────────────────────────
// ─── Modal de aging por contraparte ──────────────────────────────────────────
function PaginaAging({ item, fechaCorte, headerColor, onBack }) {
  const hoy = fechaCorte ? new Date(fechaCorte + "T00:00:00") : new Date();

  const grouped = {};
  for (const doc of (item.docs ?? [])) {
    const key = doc.contraparte || "Sin nombre";
    if (!grouped[key]) grouped[key] = { avencer:0, d0_30:0, d31_60:0, d61_90:0, dmas90:0, total:0 };
    const vto  = doc.vto ? new Date(doc.vto + (doc.vto.length === 10 ? "T00:00:00" : "")) : null;
    const dias = vto ? Math.floor((hoy - vto) / 86400000) : -1;
    const g    = grouped[key];
    g.total += doc.saldo;
    if      (dias <  0)  g.avencer += doc.saldo;
    else if (dias <= 30) g.d0_30   += doc.saldo;
    else if (dias <= 60) g.d31_60  += doc.saldo;
    else if (dias <= 90) g.d61_90  += doc.saldo;
    else                 g.dmas90  += doc.saldo;
  }

  const rows = Object.entries(grouped)
    .map(([contraparte, v]) => ({ contraparte, ...v }))
    .sort((a, b) => b.total - a.total);

  const totRow = rows.reduce((acc, r) => ({
    avencer: acc.avencer + r.avencer, d0_30: acc.d0_30 + r.d0_30,
    d31_60: acc.d31_60 + r.d31_60,   d61_90: acc.d61_90 + r.d61_90,
    dmas90: acc.dmas90 + r.dmas90,   total: acc.total + r.total,
  }), { avencer:0, d0_30:0, d31_60:0, d61_90:0, dmas90:0, total:0 });

  const mon    = item.moneda ?? "ARS";
  const contraparteLabel = headerColor === "#16a34a" ? "Cliente" : "Proveedor";
  const fmt    = v => v > 0 ? fmtSaldo(v, mon) : <span style={{ color:T.dim }}>—</span>;
  const thS    = { padding:"10px 16px", fontSize:11, fontWeight:800, color:"rgba(255,255,255,.85)",
                   textAlign:"right", letterSpacing:".04em", textTransform:"uppercase", whiteSpace:"nowrap" };
  const tdS    = { padding:"10px 16px", fontSize:13, textAlign:"right", fontFamily:"var(--mono)",
                   color:T.text, whiteSpace:"nowrap" };
  const tdRed  = { ...tdS, color:"#dc2626", fontWeight:700 };

  return (
    <div style={{ padding:"28px 32px", maxWidth:1100 }} className="fade">
      {/* Header con back */}
      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:24 }}>
        <button onClick={onBack} style={{ background:"#f3f4f6", border:`1px solid ${T.cardBorder}`,
          borderRadius:8, padding:"6px 14px", fontSize:13, fontWeight:700, color:T.muted,
          cursor:"pointer", fontFamily:T.font, display:"flex", alignItems:"center", gap:6 }}>
          ← Volver
        </button>
        <div style={{ width:4, height:28, borderRadius:2, background:headerColor }} />
        <div>
          <h1 style={{ fontSize:20, fontWeight:900, color:T.text, margin:0, letterSpacing:"-.02em" }}>
            {item.label}
          </h1>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>
            Detalle por {contraparteLabel.toLowerCase()}
            {fechaCorte && <span style={{ marginLeft:8 }}>· Al {fmtDate(fechaCorte)}</span>}
          </div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", flexDirection:"column", alignItems:"flex-end" }}>
          <span style={{ fontSize:11, color:T.muted, textTransform:"uppercase",
            letterSpacing:".06em", fontWeight:700 }}>Total pendiente</span>
          <span style={{ fontSize:22, fontFamily:"var(--mono)", fontWeight:900,
            color: headerColor }}>{fmtSaldo(totRow.total, mon)}</span>
        </div>
      </div>

      {/* Tabla */}
      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
        borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:headerColor }}>
              <th style={{ ...thS, textAlign:"left" }}>{contraparteLabel}</th>
              <th style={thS}>A Vencer</th>
              <th style={thS}>0–30d</th>
              <th style={thS}>31–60d</th>
              <th style={thS}>61–90d</th>
              <th style={thS}>&gt;90d</th>
              <th style={{ ...thS, color:"#fff" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                background: i % 2 === 0 ? T.card : "#fafbfc" }}>
                <td style={{ padding:"10px 16px", fontSize:13, color:T.text, fontWeight:600 }}>
                  {r.contraparte}
                </td>
                <td style={tdS}>{fmt(r.avencer)}</td>
                <td style={r.d0_30  > 0 ? tdRed : tdS}>{fmt(r.d0_30)}</td>
                <td style={r.d31_60 > 0 ? tdRed : tdS}>{fmt(r.d31_60)}</td>
                <td style={r.d61_90 > 0 ? tdRed : tdS}>{fmt(r.d61_90)}</td>
                <td style={r.dmas90 > 0 ? tdRed : tdS}>{fmt(r.dmas90)}</td>
                <td style={{ ...tdS, fontWeight:800 }}>{fmtSaldo(r.total, mon)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background:"#f3f4f6", borderTop:`2px solid ${headerColor}` }}>
              <td style={{ padding:"10px 16px", fontSize:13, fontWeight:800, color:T.text }}>Total</td>
              <td style={tdS}>{fmt(totRow.avencer)}</td>
              <td style={totRow.d0_30  > 0 ? tdRed : tdS}>{fmt(totRow.d0_30)}</td>
              <td style={totRow.d31_60 > 0 ? tdRed : tdS}>{fmt(totRow.d31_60)}</td>
              <td style={totRow.d61_90 > 0 ? tdRed : tdS}>{fmt(totRow.d61_90)}</td>
              <td style={totRow.dmas90 > 0 ? tdRed : tdS}>{fmt(totRow.dmas90)}</td>
              <td style={{ ...tdS, fontWeight:900, color:headerColor }}>{fmtSaldo(totRow.total, mon)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function BalanceBlock({ title, items, headerColor, onItemClick }) {
  // totals per moneda
  const totals = {};
  for (const it of items) {
    totals[it.moneda] = (totals[it.moneda] ?? 0) + it.saldo;
  }

  return (
    <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
      borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden", flex:1, minWidth:0,
      display:"flex", flexDirection:"column" }}>
      <div style={{ background:headerColor, padding:"10px 18px", display:"flex",
        justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:14, fontWeight:800, color:"#fff" }}>{title}</span>
        <span style={{ fontSize:11, color:"rgba(255,255,255,.65)" }}>
          {items.length} cuenta{items.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div style={{ overflowY:"auto", maxHeight:200, flex:1 }}>
        {items.length === 0 ? (
          <div style={{ padding:"18px", fontSize:12, color:T.dim, textAlign:"center" }}>
            Sin pendientes
          </div>
        ) : items.map((item, i) => (
          <div key={i} onClick={() => onItemClick?.(item)}
            style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
              padding:"8px 18px", borderBottom:`1px solid ${T.cardBorder}`,
              cursor: onItemClick ? "pointer" : "default", transition:"background .1s" }}
            onMouseEnter={e => { if (onItemClick) e.currentTarget.style.background="#f9fafb"; }}
            onMouseLeave={e => { e.currentTarget.style.background=""; }}>
            <span style={{ fontSize:13, color:T.text, flex:1, overflow:"hidden",
              textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.label}</span>
            <span style={{ fontSize:11, background:"#f3f4f6", color:T.dim, borderRadius:4,
              padding:"1px 6px", fontWeight:600, marginLeft:8, flexShrink:0,
              width:36, textAlign:"center" }}>{item.moneda}</span>
            <span style={{ fontSize:13, fontFamily:"var(--mono)", fontWeight:700,
              color: headerColor, flexShrink:0, width:110, textAlign:"right" }}>
              {fmtSaldo(item.saldo, item.moneda)}
            </span>
          </div>
        ))}
      </div>
      <div style={{ padding:"10px 18px", borderTop:`2px solid ${headerColor}`,
        background:"#fafbfc",
        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:12, fontWeight:800, color:T.text }}>Total {title}</span>
        <div style={{ display:"flex", gap:10 }}>
          {Object.entries(totals).map(([mon, tot]) => (
            <span key={mon} style={{ fontSize:13, fontFamily:"var(--mono)", fontWeight:800,
              color: headerColor }}>
              {fmtSaldo(tot, mon)}
            </span>
          ))}
          {Object.keys(totals).length === 0 && (
            <span style={{ fontSize:12, color:T.dim }}>$ 0,00</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tarjeta de cuenta individual ────────────────────────────────────────────
function CuentaRow({ cuenta, onClick }) {
  const tipoCfg = TIPO_CUENTA[cuenta.tipo] ?? { icon:"💳", color:T.muted };
  const saldo   = Number(cuenta.saldo) || 0;
  return (
    <div onClick={onClick} style={{ display:"flex", alignItems:"center", gap:12,
      padding:"10px 18px", borderBottom:`1px solid ${T.cardBorder}`,
      cursor: onClick ? "pointer" : "default",
      transition:"background .1s",
    }}
    onMouseEnter={e => { if (onClick) e.currentTarget.style.background="#f0f9ff"; }}
    onMouseLeave={e => { e.currentTarget.style.background=""; }}>
      <div style={{ flex:1, fontSize:13, color:T.text, fontWeight:500,
        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
        {cuenta.nombre}
        {cuenta.banco && (
          <span style={{ fontSize:11, color:T.dim, fontWeight:400, marginLeft:5 }}>
            {cuenta.banco}
          </span>
        )}
      </div>
      <span style={{ fontSize:11, background:"#f3f4f6", color:T.dim,
        borderRadius:4, padding:"2px 7px", fontWeight:700, flexShrink:0,
        width:36, textAlign:"center" }}>{cuenta.moneda}</span>
      <span style={{ fontSize:13, fontFamily:"var(--mono)", fontWeight:700,
        color: saldo < 0 ? T.red : saldo === 0 ? T.dim : T.text,
        width:110, textAlign:"right", flexShrink:0 }}>
        {fmtSaldo(saldo, cuenta.moneda)}
      </span>
    </div>
  );
}

// ─── Grupo de cuentas (Bancos / Cajas / Inversiones) ─────────────────────────
function GrupoBlock({ icon, label, cuentas, onCuentaClick }) {
  // Agrupar por moneda para el subtotal
  const porMoneda = {};
  for (const c of cuentas) {
    if (!porMoneda[c.moneda]) porMoneda[c.moneda] = 0;
    porMoneda[c.moneda] += Number(c.saldo) || 0;
  }

  return (
    <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
      borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden",
      display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"9px 18px", background:T.tableHead,
        display:"flex", justifyContent:"space-between", alignItems:"center",
        borderBottom:`1px solid ${T.cardBorder}` }}>
        <span style={{ fontSize:11, fontWeight:800, color:T.tableHeadText,
          letterSpacing:".10em", textTransform:"uppercase" }}>{label}</span>
        <span style={{ fontSize:11, color:T.dim, fontStyle:"italic" }}>
          {cuentas.length} cuenta{cuentas.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div style={{ flex:1 }}>
        {cuentas.length === 0 ? (
          <div style={{ padding:"16px 18px", fontSize:12, color:T.dim, textAlign:"center" }}>
            Sin cuentas registradas
          </div>
        ) : cuentas.map(c => (
          <CuentaRow key={c.id} cuenta={c}
            onClick={onCuentaClick ? () => onCuentaClick(c) : undefined} />
        ))}
      </div>
      <div style={{ padding:"9px 18px", background:"#fafbfc",
        borderTop:`2px solid ${T.cardBorder}`,
        display:"flex", justifyContent:"space-between", alignItems:"center",
        flexWrap:"nowrap", gap:8 }}>
        <span style={{ fontSize:12, fontWeight:700, color:T.muted, flexShrink:0 }}>Subtotal {label}</span>
        <div style={{ display:"flex", gap:8, flexShrink:0 }}>
          {Object.entries(porMoneda).map(([mon, tot]) => (
            <div key={mon} style={{ display:"flex", alignItems:"center", gap:5,
              background:"#f3f4f6", border:`1px solid ${T.cardBorder}`,
              borderRadius:6, padding:"2px 8px" }}>
              <span style={{ fontSize:10, fontWeight:800, color:T.dim,
                letterSpacing:".04em" }}>{mon}</span>
              <span style={{ fontSize:12, fontFamily:"var(--mono)", fontWeight:700,
                color: tot < 0 ? T.red : T.text }}>
                {fmtSaldo(tot, mon)}
              </span>
            </div>
          ))}
          {Object.keys(porMoneda).length === 0 && (
            <span style={{ fontSize:12, color:T.dim }}>$ 0,00</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Resumen de saldos por moneda ─────────────────────────────────────────────
function ResumenMonedas({ cuentas }) {
  const porMoneda = {};
  for (const c of cuentas) {
    if (!porMoneda[c.moneda]) porMoneda[c.moneda] = 0;
    porMoneda[c.moneda] += Number(c.saldo) || 0;
  }
  const monedas = Object.keys(porMoneda);
  if (monedas.length === 0) return null;

  return (
    <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:20 }}>
      {monedas.map(m => {
        const saldo = porMoneda[m];
        return (
          <div key={m} style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
            borderRadius:T.radius, boxShadow:T.shadow, padding:"12px 20px",
            display:"flex", flexDirection:"column", gap:4, minWidth:160 }}>
            <span style={{ fontSize:10, fontWeight:800, color:T.muted,
              letterSpacing:".12em", textTransform:"uppercase" }}>Disponible {m}</span>
            <span style={{ fontSize:18, fontFamily:"var(--mono)", fontWeight:900,
              color: saldo < 0 ? T.red : saldo === 0 ? T.dim : T.text }}>
              {fmtSaldo(saldo, m)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab: Saldos ─────────────────────────────────────────────────────────────
function TabSaldos({ cuentas, aCobrar, aPagar, filtroMoneda, onCuentaClick, onItemClick }) {
  const filtrar = arr => filtroMoneda === "ALL" ? arr : arr.filter(c => c.moneda === filtroMoneda);
  const bancos      = filtrar(cuentas.filter(c => c.tipo === "banco"));
  const cajas       = filtrar(cuentas.filter(c => c.tipo === "caja"));
  const inversiones = filtrar(cuentas.filter(c => c.tipo === "inversion"));

  const aCobrarFilt = filtroMoneda === "ALL" ? aCobrar : aCobrar.filter(i => i.moneda === filtroMoneda);
  const aPagarFilt  = filtroMoneda === "ALL" ? aPagar  : aPagar.filter(i => i.moneda === filtroMoneda);

  return (
    <div>
      {/* A Cobrar + A Pagar */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
        <BalanceBlock title="Activo"  items={aCobrarFilt} headerColor="#16a34a" onItemClick={onItemClick} />
        <BalanceBlock title="Pasivo"  items={aPagarFilt}  headerColor="#dc2626" onItemClick={onItemClick} />
      </div>

      {/* Bancos | Caja en paralelo, Inversiones abajo */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
        <GrupoBlock icon="💵" label="Caja"   cuentas={cajas}  onCuentaClick={onCuentaClick} />
        <GrupoBlock icon="🏦" label="Bancos" cuentas={bancos} onCuentaClick={onCuentaClick} />
      </div>
      <GrupoBlock icon="📈" label="Inversiones" cuentas={inversiones} onCuentaClick={onCuentaClick} />
    </div>
  );
}

// ─── Dropdown por fila ────────────────────────────────────────────────────────
function RowMenu({ onEditar, onEliminar }) {
  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState({ top:0, left:0 });
  const btnRef  = useRef(null);
  const menuRef = useRef(null);

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const handler = e => {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          btnRef.current  && !btnRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const item = (label, onClick, color) => (
    <button onClick={() => { onClick(); setOpen(false); }} style={{
      display:"block", width:"100%", textAlign:"left", padding:"8px 14px",
      background:"transparent", border:"none", fontSize:13, color: color ?? T.text,
      cursor:"pointer", fontFamily:T.font,
    }}
    onMouseEnter={e => e.currentTarget.style.background="#f3f4f6"}
    onMouseLeave={e => e.currentTarget.style.background="transparent"}>
      {label}
    </button>
  );

  return (
    <>
      <button ref={btnRef} onClick={handleToggle} style={{
        background: open ? "#e5e7eb" : "#f3f4f6",
        border:`1px solid ${T.cardBorder}`, borderRadius:6,
        padding:"3px 8px", cursor:"pointer", fontSize:12, color:T.muted,
        fontFamily:T.font, lineHeight:1,
      }}>▾</button>

      {open && (
        <div ref={menuRef} style={{
          position:"fixed", top:pos.top, left:pos.left, zIndex:9999,
          background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:8,
          boxShadow:"0 8px 24px rgba(0,0,0,.15)", minWidth:150, overflow:"hidden",
        }}>
          {item("Editar",    onEditar ?? (() => {}))}
          {<div style={{ height:1, background:T.cardBorder, margin:"3px 0" }} />}
          {item("Eliminar",  onEliminar ?? (() => {}), T.red)}
        </div>
      )}
    </>
  );
}

// ─── Tab: Movimientos ─────────────────────────────────────────────────────────
function TabMovimientos({ movimientos, cuentas, filtroCuenta, onLimpiarFiltro, onEliminar, onEditar, onNuevoMov, centrosCosto = [] }) {
  const cuentaMap = useMemo(() => {
    const m = {};
    for (const c of cuentas) m[c.id] = c.nombre;
    return m;
  }, [cuentas]);

  const ccMap = useMemo(() => {
    const m = {};
    for (const c of centrosCosto) m[c.id] = c.nombre;
    return m;
  }, [centrosCosto]);

  const rows = filtroCuenta
    ? movimientos.filter(m => m.cuenta_bancaria === filtroCuenta)
    : movimientos;

  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const fa = a.fecha ?? ""; const fb = b.fecha ?? "";
    return fb.localeCompare(fa);
  }), [rows]);

  const cuentaNombre = filtroCuenta ? (cuentaMap[filtroCuenta] ?? filtroCuenta) : null;

  if (rows.length === 0) {
    return (
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          gap:10, marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            {cuentaNombre && <>
              <span style={{ fontSize:13, fontWeight:700, color:T.text }}>🏦 {cuentaNombre}</span>
              <button onClick={onLimpiarFiltro} style={{
                fontSize:11, color:T.muted, background:"#f3f4f6",
                border:`1px solid ${T.cardBorder}`, borderRadius:6,
                padding:"2px 10px", cursor:"pointer", fontFamily:T.font }}>✕ Ver todas</button>
            </>}
          </div>
        </div>
        <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
          borderRadius:T.radius, padding:"60px 24px", textAlign:"center" }}>
          <div style={{ fontSize:28, marginBottom:10 }}>📋</div>
          <div style={{ fontSize:14, color:T.muted }}>
            {cuentaNombre
              ? `Sin movimientos para ${cuentaNombre}`
              : "Sin movimientos registrados — usá el botón para agregar el primero"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
        gap:10, marginBottom:16 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {cuentaNombre && <>
            <span style={{ fontSize:13, fontWeight:700, color:T.text }}>🏦 {cuentaNombre}</span>
            <button onClick={onLimpiarFiltro} style={{
              fontSize:11, color:T.muted, background:"#f3f4f6",
              border:`1px solid ${T.cardBorder}`, borderRadius:6,
              padding:"2px 10px", cursor:"pointer", fontFamily:T.font }}>✕ Ver todas</button>
          </>}
        </div>
      </div>

      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
        borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:T.tableHead }}>
              <th style={{ width:36 }} />
              {["Tipo","Fecha","Cuenta","Concepto","Cta. Contable","C. Costo","Moneda","Importe"].map(h => (
                <th key={h} style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                  letterSpacing:".08em", textTransform:"uppercase", color:T.tableHeadText,
                  textAlign: h === "Importe" ? "right" : "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((m, i) => {
              const cfg    = TIPO_CFG[m.tipo] ?? { bg:"#f3f4f6", color:"#374151" };
              const monto  = Number(m.monto) || 0;
              const nombre = cuentaMap[m.cuenta_bancaria] ?? m.cuenta_bancaria ?? "—";
              return (
                <tr key={m.id ?? i} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                  background: i % 2 === 0 ? T.card : "#fafbfc" }}>
                  <td style={{ padding:"8px 6px 8px 10px", verticalAlign:"middle" }}>
                    <RowMenu
                      onEditar={m.origen === "manual" ? () => onEditar?.(m) : undefined}
                      onEliminar={() => onEliminar?.(m)}
                    />
                  </td>
                  <td style={{ padding:"10px 14px" }}>
                    <span style={{ display:"inline-block", padding:"2px 9px", borderRadius:999,
                      fontSize:11, fontWeight:700, background:cfg.bg, color:cfg.color,
                      whiteSpace:"nowrap" }}>{m.tipo}</span>
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:13, color:T.text, whiteSpace:"nowrap" }}>
                    {fmtDate(m.fecha)}
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:T.muted }}>{nombre}</td>
                  <td style={{ padding:"10px 14px", fontSize:13, color:T.text }}>{m.concepto ?? "—"}</td>
                  <td style={{ padding:"10px 14px", fontSize:11, color:T.muted }}>{m.cuenta ?? "—"}</td>
                  <td style={{ padding:"10px 14px", fontSize:11, color:T.muted }}>
                    {m.centro_costo ? (ccMap[m.centro_costo] ?? m.centro_costo) : "—"}
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:11, color:T.dim, fontWeight:600 }}>{m.moneda}</td>
                  <td style={{ padding:"10px 14px", fontSize:13, fontFamily:"var(--mono)", fontWeight:700,
                    color: monto < 0 ? T.red : T.green, textAlign:"right", whiteSpace:"nowrap" }}>
                    {fmtSaldo(monto, m.moneda)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function PantallaTesoreria({ sociedad = "nako" }) {
  const datePickerRef = useRef(null);
  const [movimientos,   setMovimientos]   = useState([]);
  const [egresos,       setEgresos]       = useState([]);
  const [ingresos,      setIngresos]      = useState([]);
  const [pagosCobros,   setPagosCobros]   = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [activeTab,        setActiveTab]        = useState("saldos");
  const [filtroMoneda,     setFiltroMoneda]     = useState("ALL");
  const [fechaCorte,       setFechaCorte]       = useState("");
  const [drillDownItem,    setDrillDownItem]    = useState(null);
  const [showMovModal,     setShowMovModal]     = useState(false);
  const [showNuevoMov,     setShowNuevoMov]     = useState(false);
  const [editingMov,       setEditingMov]       = useState(null);
  const [filtroCuenta,     setFiltroCuenta]     = useState(null);
  const [cuentasBancarias, setCuentasBancarias] = useState([]);
  const [cuentasContables, setCuentasContables] = useState([]);
  const [centrosCosto,     setCentrosCosto]     = useState(CENTROS_COSTO);

  // ── Fetch all data ────────────────────────────────────────────────────────
  const cargarMovimientos = async () => {
    setLoading(true);
    setError(null);
    try {
      const [movs, egs, ings, pcs, cbList, ctaList] = await Promise.all([
        fetchMovTesoreria(sociedad),
        fetchEgresos(sociedad).catch(() => []),
        fetchIngresos(sociedad).catch(() => []),
        fetchPagosCobros(sociedad).catch(() => []),
        fetchCuentasBancarias().catch(() => []),
        fetchCuentas().catch(() => []),
      ]);
      setMovimientos(Array.isArray(movs) ? movs : []);
      setEgresos(Array.isArray(egs) ? egs : []);
      setIngresos(Array.isArray(ings) ? ings : []);
      setPagosCobros(Array.isArray(pcs) ? pcs : []);
      setCuentasBancarias(Array.isArray(cbList) ? cbList : []);
      setCuentasContables(Array.isArray(ctaList) ? ctaList : []);
      fetchCentrosCosto().then(data => {
        if (Array.isArray(data) && data.length > 0) setCentrosCosto(data);
      }).catch(() => {});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setFiltroCuenta(null);
    cargarMovimientos();
  }, [sociedad]);

  // ── Cuentas con saldo calculado desde movimientos ─────────────────────────
  const cuentas = useMemo(() => {
    return cuentasBancarias
      .filter(c => (c.sociedad ?? "").toLowerCase() === (sociedad ?? "").toLowerCase())
      .map(cuenta => {
        const movsCuenta = movimientos.filter(m =>
          m.cuenta_bancaria === cuenta.id &&
          (!fechaCorte || (m.fecha ?? "") <= fechaCorte)
        );
        const saldo = movsCuenta.reduce((s, m) => s + (Number(m.monto) || 0), 0);
        return { ...cuenta, tipo: (cuenta.tipo ?? "").toLowerCase(), saldo };
      });
  }, [sociedad, movimientos, cuentasBancarias, fechaCorte]);

  const monedas = useMemo(() => [...new Set(cuentas.map(c => c.moneda))], [cuentas]);
  const subtitle = `${cuentas.length} cuenta${cuentas.length !== 1 ? "s" : ""}`
    + (monedas.length ? ` · ${monedas.join(", ")}` : "");

  // ── Cuentas a cobrar / a pagar (agrupadas por cuenta + moneda) ─────────────
  const cuentaById     = useMemo(() => new Map(cuentasContables.map(c => [c.id, c])),     [cuentasContables]);
  const cuentaByNombre = useMemo(() => new Map(cuentasContables.map(c => [(c.nombre ?? "").toLowerCase(), c])), [cuentasContables]);

  // Helper: busca en nb_cuentas por id, nombre exacto, o nombre normalizado (guiones→espacios)
  const _resolveCuenta = useCallback((cuentaById, cuentaByNombre, id, nombre) => {
    const norm = s => (s ?? "").toLowerCase().replace(/_/g, " ").trim();
    return cuentaById.get(id ?? "")
      || cuentaByNombre.get((nombre ?? "").toLowerCase())
      || cuentaByNombre.get(norm(id))
      || cuentaByNombre.get(norm(nombre))
      || null;
  }, []);

  const aCobrar = useMemo(() => {
    const corte  = fechaCorte || null;
    const cobros = pagosCobros.filter(p => p.tipo === "COBRO_FC" && (!corte || (p.fecha ?? "") <= corte));
    const grouped = {};
    for (const ing of ingresos) {
      if (corte && (ing.fecha ?? "") > corte) continue;
      const pagosDoc = cobros.filter(c => c.documento_id === ing.id);
      const saldo    = calcSaldoPendiente(ing.importe, pagosDoc);
      if (saldo <= 0) continue;
      const cuentaDef = _resolveCuenta(cuentaById, cuentaByNombre, ing.cuentaId, ing.cuenta);
      const label     = cuentaDef?.cuenta_pasivo || ing.cuenta || "Sin cuenta";
      const key       = `${label}||${ing.moneda ?? "ARS"}`;
      if (!grouped[key]) grouped[key] = { label, moneda: ing.moneda ?? "ARS", saldo: 0, docs: [], headerColor:"#16a34a" };
      grouped[key].saldo += saldo;
      grouped[key].docs.push({ contraparte: ing.cliente || ing.proveedor || "Sin nombre", vto: ing.vto, saldo, moneda: ing.moneda ?? "ARS" });
    }
    return Object.values(grouped).sort((a, b) => b.saldo - a.saldo);
  }, [ingresos, pagosCobros, cuentaById, cuentaByNombre, fechaCorte, _resolveCuenta]);

  const aPagar = useMemo(() => {
    const corte  = fechaCorte || null;
    const pagos  = pagosCobros.filter(p => (p.tipo === "PAGO_FC" || p.tipo === "EGRESO_GASTO") && (!corte || (p.fecha ?? "") <= corte));
    const pasivoLabel    = { proveedores:"Proveedores", sueldos:"Sueldos", impuestos:"Impuestos", financiero:"Financiero", ventas:"Ventas" };
    const grouped = {};
    for (const eg of egresos) {
      if (corte && (eg.fecha ?? "") > corte) continue;
      const pagosDoc = pagos.filter(p => p.documento_id === eg.id);
      const saldo    = calcSaldoPendiente(eg.importe, pagosDoc);
      if (saldo <= 0) continue;
      const cuentaDef = _resolveCuenta(cuentaById, cuentaByNombre, eg.cuentaId, eg.cuenta);
      const bucket    = (cuentaDef?.cuenta_pasivo ?? "").toLowerCase() || "proveedores";
      const label     = pasivoLabel[bucket] ?? cuentaDef?.cuenta_pasivo ?? "Proveedores";
      const key       = `${label}||${eg.moneda ?? "ARS"}`;
      if (!grouped[key]) grouped[key] = { label, moneda: eg.moneda ?? "ARS", saldo: 0, docs: [], headerColor:"#dc2626" };
      grouped[key].saldo += saldo;
      grouped[key].docs.push({ contraparte: eg.proveedor || "Sin proveedor", vto: eg.vto, saldo, moneda: eg.moneda ?? "ARS" });
    }
    return Object.values(grouped).sort((a, b) => b.saldo - a.saldo);
  }, [egresos, pagosCobros, cuentaById, cuentaByNombre, fechaCorte, _resolveCuenta]);

  // ── Guardar movimiento entre cuentas ──────────────────────────────────────
  const handleGuardarMovimiento = async (form) => {
    try {
      const monto = Math.abs(Number(form.monto));
      await Promise.all([
        appendMovTesoreria({
          sociedad, fecha: form.fecha, tipo: "EGRESO",
          cuenta_bancaria: form.cuentaSalida,
          concepto: `Transferencia → ${cuentasBancarias.find(c => c.id === form.cuentaEntrada)?.nombre ?? form.cuentaEntrada}`,
          moneda: form.moneda, monto: -monto, origen: "manual",
        }),
        appendMovTesoreria({
          sociedad, fecha: form.fecha, tipo: "INGRESO",
          cuenta_bancaria: form.cuentaEntrada,
          concepto: `Transferencia ← ${cuentasBancarias.find(c => c.id === form.cuentaSalida)?.nombre ?? form.cuentaSalida}`,
          moneda: form.moneda, monto, origen: "manual",
        }),
      ]);
      await cargarMovimientos();
    } catch (e) {
      alert("Error al guardar: " + e.message);
    }
  };

  // ── Editar movimiento manual (solo campos básicos, para TRANSFERENCIA) ───────
  const handleEditarMovManual = async (form) => {
    if (!editingMov) return;
    try {
      const monto = Math.abs(Number(form.monto));
      await updateMovTesoreria(editingMov.id, {
        fecha:           form.fecha,
        cuenta_bancaria: form.cuenta_bancaria ?? editingMov.cuenta_bancaria,
        cuenta_contable: form.cuenta_contable ?? "",
        concepto:        form.concepto,
        moneda:          form.moneda,
        monto:           editingMov.monto < 0 ? -monto : monto,
        centro_costo:    form.centro_costo ?? "",
      });
      setEditingMov(null);
      await cargarMovimientos();
    } catch (e) {
      alert("Error al guardar: " + e.message);
    }
  };

  // ── Eliminar un movimiento ────────────────────────────────────────────────
  const handleEliminarMov = async (mov) => {
    if (!confirm(`¿Eliminar movimiento "${mov.concepto ?? mov.id}"?`)) return;
    try {
      await deleteMovTesoreria(mov.id);
      setMovimientos(prev => prev.filter(m => m.id !== mov.id));
    } catch (e) {
      alert("Error al eliminar: " + e.message);
    }
  };

  // ── Al clickear una cuenta en Saldos → ir a Movimientos filtrado ──────────
  const handleCuentaClick = (cuenta) => {
    setFiltroCuenta(cuenta.id);
    setActiveTab("movimientos");
  };

  // ── Drill-down como página completa ──────────────────────────────────────
  if (drillDownItem) {
    return (
      <PaginaAging
        item={drillDownItem}
        fechaCorte={fechaCorte}
        headerColor={drillDownItem.headerColor ?? "#374151"}
        onBack={() => setDrillDownItem(null)}
      />
    );
  }

  const yearTag = new Date().getFullYear();
  const TESORERIA_TABS = [
    { id: "saldos", label: "Saldos" },
    { id: "movimientos", label: `Movimientos${movimientos.length ? ` (${movimientos.length})` : ""}` },
  ];

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1300 }} className="fade tesoreria-screen">
      <style>{`
        .tesoreria-screen button:focus-visible {
          outline: 2px solid ${T.accent};
          outline-offset: 2px;
        }
      `}</style>

      <PageHeader
        title="Tesorería"
        action={(
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setShowNuevoMov(true)} style={{
              ...tesoreriaActionBtn.base, ...tesoreriaActionBtn.gasto,
            }}>
              + Gasto directo
            </button>
            <button type="button" onClick={() => setShowMovModal(true)} style={{
              ...tesoreriaActionBtn.base, ...tesoreriaActionBtn.transfer,
            }}>
              + Movimiento entre cuentas
            </button>
          </div>
        )}
      />


      {/* Pestañas píldora — igual que Reportes */}
      <div
        role="tablist"
        aria-label="Vista de tesorería"
        style={{
          display: "inline-flex", gap: 2, marginBottom: 20,
          background: "#f3f4f6", borderRadius: 10, padding: 3,
        }}
      >
        {TESORERIA_TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: active ? T.accentDark : "transparent",
                border: "none", borderRadius: 8,
                color: active ? T.accent : T.muted,
                fontFamily: T.font, fontSize: 13,
                fontWeight: active ? 800 : 500,
                padding: "7px 18px", cursor: "pointer",
                transition: "all .15s ease",
                outline: "none",
                boxShadow: active ? T.shadow : "none",
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#e5e7eb"; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Barra de filtros — tarjeta como toolbar de Reportes */}
      <div style={{
        display: "flex", gap: 16, marginBottom: 22, flexWrap: "wrap", alignItems: "center",
        background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
        padding: "12px 16px", boxShadow: "0 1px 3px rgba(0,0,0,.04)",
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase",
            letterSpacing: ".08em", marginRight: 4,
          }}>Moneda</span>
          {["ALL", ...monedas].map(m => {
            const on = filtroMoneda === m;
            return (
              <button key={m} type="button" onClick={() => setFiltroMoneda(m)} style={{
                background: on ? T.accentDark : "#f9fafb",
                color: on ? T.accent : T.muted,
                border: `1px solid ${on ? T.accentDark : T.cardBorder}`,
                borderRadius: 999,
                padding: "5px 14px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: T.font,
                transition: "background .12s, color .12s",
              }}>{m === "ALL" ? "Todas" : m}</button>
            );
          })}
        </div>

        <div style={{ width: 1, height: 24, background: T.cardBorder, flexShrink: 0 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase",
            letterSpacing: ".08em" }}>Al día</span>
          <button type="button" onClick={() => { datePickerRef.current?.showPicker?.(); datePickerRef.current?.click(); }}
            style={{
              border: `1px solid ${T.cardBorder}`, borderRadius: 8, padding: "6px 12px",
              fontSize: 12, fontFamily: T.font, background: "#f9fafb",
              color: fechaCorte ? T.text : T.dim, cursor: "pointer", whiteSpace: "nowrap",
              display: "inline-flex", alignItems: "center", gap: 6,
              minWidth: 124, justifyContent: "center", fontWeight: 600,
            }}>
            <span style={{ opacity: 0.75 }} aria-hidden>📅</span>
            {fechaCorte ? fmtDate(fechaCorte) : "Elegir fecha"}
          </button>
          <input ref={datePickerRef} type="date" value={fechaCorte}
            onChange={e => setFechaCorte(e.target.value)}
            style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }} />
          {fechaCorte && (
            <button type="button" onClick={() => setFechaCorte("")} title="Quitar fecha"
              style={{
                background: "transparent", border: "none", color: T.muted,
                fontSize: 16, cursor: "pointer", lineHeight: 1, padding: 4,
              }}>✕</button>
          )}
        </div>
      </div>

      {loading && (
        <div style={{ padding: "60px 32px", textAlign: "center", color: T.muted, fontSize: 14 }}>
          Cargando tesorería…
        </div>
      )}

      {error && !loading && (
        <div role="alert" style={{
          background: T.redBg, border: `1px solid ${T.red}`, borderRadius: T.radius,
          padding: "18px 22px", marginBottom: 22,
          display: "flex", gap: 14, alignItems: "flex-start",
        }}>
          <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden>⚠</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, color: T.red, fontSize: 15, marginBottom: 6 }}>
              No se pudo cargar la tesorería
            </div>
            <div style={{ color: "#991b1b", fontSize: 13, lineHeight: 1.5 }}>
              {error}
            </div>
            {String(error).includes("VITE_NUMBERS_API_URL") && (
              <div style={{
                marginTop: 14, paddingTop: 14,
                borderTop: `1px solid rgba(220,38,38,.2)`,
                fontSize: 12, color: T.muted, lineHeight: 1.5,
              }}>
                Revisá <code style={{ background: "#fff", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>.env.local</code>
                {" "}y definí{" "}
                <code style={{ background: "#fff", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>VITE_NUMBERS_API_URL</code>
                {" "}con la URL del script de Google Apps Script.
              </div>
            )}
          </div>
        </div>
      )}

      {!loading && !error && (
        <>
          {activeTab === "saldos" && (
            <TabSaldos
              cuentas={cuentas}
              aCobrar={aCobrar}
              aPagar={aPagar}
              filtroMoneda={filtroMoneda}
              onCuentaClick={handleCuentaClick}
              onItemClick={setDrillDownItem}
            />
          )}
          {activeTab === "movimientos" && (
            <TabMovimientos
              movimientos={movimientos}
              cuentas={cuentas}
              filtroCuenta={filtroCuenta}
              onLimpiarFiltro={() => setFiltroCuenta(null)}
              onEliminar={handleEliminarMov}
              onEditar={m => setEditingMov(m)}
              onNuevoMov={() => setShowNuevoMov(true)}
            centrosCosto={centrosCosto}
            />
          )}
        </>
      )}

      {showMovModal && (
        <MovimientoModal
          sociedad={sociedad}
          cuentasBancarias={cuentasBancarias}
          onClose={() => setShowMovModal(false)}
          onSave={handleGuardarMovimiento}
        />
      )}
      {showNuevoMov && (
        <GastoDirectoModal
          sociedad={sociedad}
          cuentasBancarias={cuentasBancarias}
          cuentasContables={cuentasContables}
          centrosCosto={centrosCosto}
          onClose={() => setShowNuevoMov(false)}
          onSaved={async () => { setShowNuevoMov(false); await cargarMovimientos(); }}
        />
      )}
      {editingMov && (
        <EditarMovModal
          mov={editingMov}
          cuentasBancarias={cuentasBancarias}
          onClose={() => setEditingMov(null)}
          onSave={handleEditarMovManual}
        />
      )}
    </div>
  );
}
