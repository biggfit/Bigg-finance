import { Fragment, useState, useMemo, useEffect, useRef } from "react";
import { T, Btn, Input, Select, PageHeader, fmtDate, fmtMoney, MoneyField } from "./theme";
import ConfirmModal from "./ConfirmModal";
import {
  TIPO_CUENTA, MONEDA_SYM,
} from "../data/tesoreriaData";
import { CENTROS_COSTO } from "../data/numbersData";
import { ccActivos } from "./formUtils";
import {
  fetchMovTesoreria, fetchMovFranquicias, appendMovTesoreria, appendTransferencia, updateTransferencia, updatePagoTarjeta, deleteMovTesoreria, updateMovTesoreria, borrarPagoImputado,
  fetchEgresos, fetchIngresos, fetchPagosCobros,
  fetchCuentasBancarias, fetchCuentas, fetchCentrosCosto, fetchSaldoMercadoPago, esCuentaMercadoPago,
  appendGastoDirecto, esIgnorado, ignorarMovimiento, esCuentaCredito, fetchFinanciaciones,
  pagarTarjeta, fetchSocios, fetchSociosCC, fetchIntercoData, intercoLedger, primeCache, motivoNoBorrable,
  esIntercoDeclaradaManual, piezasIntercoDeclarada, deshacerIntercoDeclarada,
} from "../lib/numbersApi";
import { fetchLiquidacionesCerradas } from "../lib/sueldosApi";
import { fetchAll } from "../lib/sheetsApi";        // Franquicias (read-only)
import { derivarSaldos, sociedadNombreMap } from "./tesoreriaDerive";  // saldos + activo/pasivo (compartido con Reportes)
import IntercoLedgerTable from "./reportes/IntercoLedgerTable";  // tabla del ledger interco (compartida con Reportes)
import { clasificarActivo, clasificarPasivo } from "./reportes/balanceUtils";  // corriente vs financiación (misma regla que Posición financiera)
// ─── Helpers ──────────────────────────────────────────────────────────────────

// Tesorería muestra montos SIN decimales (pesos enteros). Local: no toca fmtSaldo global (pdf.js).
const fmtSaldo = (n, moneda) => {
  const sym = MONEDA_SYM[moneda] ?? moneda;
  const abs = Math.abs(Number(n) || 0);
  const neg = Number(n) < 0;
  return `${neg ? "-" : ""}${sym} ${abs.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
};

const TIPO_CFG = {
  PAGO:          { bg:"#fff7ed", color:"#f97316", label:"Pago"            },
  COBRO:         { bg:"#f0f9ff", color:"#0ea5e9", label:"Cobro"           },
  SUELDO:        { bg:"#e0e7ff", color:"#4f46e5", label:"Sueldo"          },
  EGRESO_GASTO:  { bg:"#fef9c3", color:"#ca8a04", label:"Gasto"           },
  EGRESO:        { bg:"#fef9c3", color:"#ca8a04", label:"Gasto"           },
  INGRESO:       { bg:"#dcfce7", color:"#16a34a", label:"Ingreso"         },
  PAGO_TARJETA:  { bg:"#ede9fe", color:"#7c3aed", label:"Pago de Tarjeta" },
  INTERCOMPANIA: { bg:"#f3e8ff", color:"#9333ea", label:"Intercompañía"   },
  TRANSFERENCIA: { bg:"#dbeafe", color:"#2563eb", label:"TRF Propias"     },
  SALDO_INICIAL: { bg:"#f3f4f6", color:"#6b7280", label:"Saldo inicial"   },
};
// La pata de CAJA de una interco (origen interco_recibida/enviada) se muestra "Interco", no Ingreso/Gasto: es plata
// que entró o salió por una interco, no un ingreso o gasto cualquiera (Martín 5/11/2026). Su costo FINC sigue "Gasto".
const INTERCO_CAJA_CFG = { bg:"#f3e8ff", color:"#9333ea", label:"Interco" };
const esIntercoCaja = (m) => m.origen === "interco_recibida" || m.origen === "interco_enviada";
// Estilo rojo para las líneas del extracto todavía SIN conciliar (mismo texto Gasto/Ingreso, otro color).
const TIPO_SIN_CONCILIAR = { bg:"#fee2e2", color:"#dc2626" };
const esSinConciliar = (m) => m.origen === "extracto" && !String(m.documento_id || "");

// Las patas de una TRF/CAMBIO/INTERCO/TARJETA comparten `documento_id` y, en las transferencias
// manuales, además el mismo stem de id (`<sharedId>-E` / `-I`). El stem = documento_id si está,
// si no el propio id sin el sufijo -E/-I. `patasDelPar` junta ambas patas por documento_id O por
// stem del id → así, aunque una pata haya quedado sin documento_id (par roto), igual se emparejan
// y no queda una contrapartida huérfana al borrar/editar.
const stemPar = (m) => String(m?.documento_id || "") || String(m?.id || "").replace(/-[EI]$/, "");
const patasDelPar = (mov, movs) => {
  const stem = stemPar(mov);
  if (!stem) return [mov];
  return (movs || []).filter(m =>
    String(m.documento_id || "") === stem ||
    String(m.id || "") === stem ||
    String(m.id || "").replace(/-[EI]$/, "") === stem);
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
function MovimientoModal({ sociedad, cuentasBancarias, initial = null, editMode = false, onClose, onSave }) {
  const _soc = (sociedad ?? "").toLowerCase();
  const cuentasSoc = cuentasBancarias.filter(c => (c.sociedad ?? "").toLowerCase() === _soc);
  const [form, setForm] = useState(initial || {
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
          <span style={{ fontSize:15, fontWeight:800, color:"#fff" }}>{editMode ? "Editar movimiento entre cuentas" : "Movimiento Entre Cuentas"}</span>
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
              style={{ width:"100%", background:"#eceff3", border:`1px solid ${T.cardBorder}`,
                borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
                fontFamily:T.font, outline:"none", resize:"vertical", minHeight:64, boxSizing:"border-box" }} />
          </div>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
            <button onClick={onClose} style={{
              background:"#dc2626", border:"none", borderRadius:8, padding:"9px 20px",
              fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer", fontFamily:T.font }}>Cancelar ✕</button>
            <button onClick={() => { onSave({ ...form, moneda: monedaSalida || form.moneda || "ARS" }); onClose(); }} disabled={!canSave} style={{
              background: canSave ? "#16a34a" : "#9ca3af", border:"none", borderRadius:8,
              padding:"9px 20px", fontSize:13, fontWeight:700, color:"#fff",
              cursor: canSave ? "pointer" : "default", fontFamily:T.font }}>{editMode ? "Guardar ✓" : "Crear ✓"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Pagar tarjeta ─────────────────────────────────────────────────────
// Paga el saldo de una cuenta-tarjeta (total o parcial) desde una caja/banco real.
// Genera el par PAGO_TARJETA: la caja real baja (salida real) y la cuenta-tarjeta sube (baja la deuda).
function PagarTarjetaModal({ sociedad, cuentas, initial = null, editMode = false, onClose, onSave }) {
  const _soc = (sociedad ?? "").toLowerCase();
  const cuentasSoc = cuentas.filter(c => (c.sociedad ?? "").toLowerCase() === _soc);
  const tarjetas   = cuentasSoc.filter(esCuentaCredito);
  const [form, setForm] = useState(initial || {
    fecha: new Date().toISOString().slice(0, 10), tarjeta: "", cuentaReal: "", monto: "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const tjt        = tarjetas.find(c => c.id === form.tarjeta);
  const monedaTjt  = tjt?.moneda ?? null;
  const deuda      = tjt ? Math.abs(Number(tjt.saldo) || 0) : 0;
  // Cajas/bancos reales de la MISMA moneda que la tarjeta (no otra tarjeta).
  const realesOpts = cuentasSoc
    .filter(c => !esCuentaCredito(c) && (!monedaTjt || c.moneda === monedaTjt))
    .map(c => ({ value: c.id, label: `${TIPO_CUENTA[c.tipo]?.icon ?? "💳"} ${c.nombre} (${c.moneda})` }));
  const tjtOpts    = tarjetas.map(c => ({ value: c.id, label: `💳 ${c.nombre} (${c.moneda}) · debe ${fmtMoney(Math.abs(Number(c.saldo) || 0), c.moneda)}` }));

  const monto    = Number(form.monto) || 0;
  const canSave  = form.fecha && form.tarjeta && form.cuentaReal && monto > 0;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:10, width:520, maxWidth:"97vw",
        boxShadow:"0 20px 60px rgba(0,0,0,.25)", overflow:"hidden" }} onClick={e => e.stopPropagation()}>
        <div style={{ background:"#dc2626", padding:"14px 22px", display:"flex",
          justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:15, fontWeight:800, color:"#fff" }}>{editMode ? "Editar pago de tarjeta" : "Pagar Tarjeta"}</span>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.6)", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>
        <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
          <Select label="Tarjeta a pagar" required value={form.tarjeta}
            onChange={v => { const t = tarjetas.find(c => c.id === v); set("tarjeta", v); set("cuentaReal", ""); set("monto", t ? String(Math.abs(Number(t.saldo) || 0)) : ""); }}
            options={tjtOpts} />
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Input label="Fecha" required type="date" value={form.fecha} onChange={v => set("fecha", v)} />
            <Input label={`Importe${monedaTjt ? " ("+monedaTjt+")" : ""}`} required type="number" value={form.monto} onChange={v => set("monto", v)} placeholder="0,00" />
          </div>
          {tjt && monto > deuda + 0.01 && (
            <div style={{ fontSize:11, color:"#b45309" }}>El importe supera la deuda ({fmtMoney(deuda, monedaTjt)}). ¿Seguro?</div>
          )}
          <Select label="Pagar desde (caja/banco)" required value={form.cuentaReal} onChange={v => set("cuentaReal", v)} options={realesOpts} />
          {monedaTjt === "USD" && (
            <div style={{ fontSize:11, color:T.muted }}>
              Para pagar en pesos: primero comprá los USD en <strong>Cambio de moneda</strong> (al TC de la tarjeta) y pagá desde la caja USD.
            </div>
          )}
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
            <button onClick={onClose} style={{ background:"#6b7280", border:"none", borderRadius:8,
              padding:"9px 20px", fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer", fontFamily:T.font }}>Cancelar</button>
            <button onClick={() => { onSave({ ...form, moneda: monedaTjt }); onClose(); }} disabled={!canSave} style={{
              background: canSave ? "#16a34a" : "#9ca3af", border:"none", borderRadius:8,
              padding:"9px 20px", fontSize:13, fontWeight:700, color:"#fff",
              cursor: canSave ? "pointer" : "default", fontFamily:T.font }}>{editMode ? "Guardar ✓" : "Pagar ✓"}</button>
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
    width:"100%", background:"#eceff3", border:`1px solid ${T.cardBorder}`,
    borderRadius:7, padding:"8px 10px", fontSize:13, color:T.text,
    fontFamily:T.font, outline:"none", boxSizing:"border-box",
  };
  const lbl = (text, req) => (
    <label style={{ fontSize:11, color:T.muted, fontWeight:700, display:"block",
      marginBottom:4, textTransform:"uppercase", letterSpacing:".06em" }}>
      {text}{req && <span style={{ color:"#ef4444", marginLeft:2 }}>*</span>}
    </label>
  );

  const _savingRef = useRef(false);
  const handleGuardar = async () => {
    if (_savingRef.current) return;
    _savingRef.current = true;
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
      _savingRef.current = false;
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
              {ccActivos(centrosCosto, form.cc).map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>

          {/* Subtotal + IVA */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div>
              {lbl("Subtotal", true)}
              <MoneyField value={form.subtotal}
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
                IVA: {sym} {iva.toLocaleString("es-AR", { maximumFractionDigits:0 })}
              </span>
              <strong>
                Total: {sym} {total.toLocaleString("es-AR", { maximumFractionDigits:0 })}
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
function EditarMovModal({ mov, cuentasBancarias, cuentasContables = [], centrosCosto = [], onClose, onSave }) {
  // Un gasto/ingreso contabilizado ES el devengado (sin comprobante) → se edita cuenta contable + centro
  // (lo que pega en el P&L), no solo la caja. Un pago/cobro/transferencia no muestra esos campos.
  const esGastoIngreso = ["EGRESO_GASTO", "INGRESO", "EGRESO"].includes(mov.tipo);
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
          {esGastoIngreso && (
            <>
              <Select label="Cuenta contable" value={form.cuenta_contable} onChange={v => set("cuenta_contable", v)}
                options={[{ value:"", label:"— Seleccioná —" }, ...cuentasContables.map(c => ({ value:c.nombre, label:c.nombre }))]} />
              <Select label="Centro de costo" value={form.centro_costo} onChange={v => set("centro_costo", v)}
                options={[{ value:"", label:"— Seleccioná —" }, ...ccActivos(centrosCosto, form.centro_costo).map(c => ({ value:c.id, label:c.nombre }))]} />
            </>
          )}
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
export function PaginaAging({ item, fechaCorte, headerColor, onBack }) {
  const hoy = fechaCorte ? new Date(fechaCorte + "T00:00:00") : new Date();
  // Toggle Aging ↔ Movimientos: si el item trae un ledger (ej. financiaciones), se puede ver el extracto
  // de la cuenta de pasivo (apertura + cuotas por fecha con saldo corriente), como en un banco.
  const hayLedger = !!(item.ledger && ((item.ledger.entries?.length) || item.ledger.opening));
  // Tarjeta de crédito: es un saldo corriente, no facturas con vencimiento → abre en el extracto y no ofrece
  // el aging (agrupaba consumos ya pagados por comercio y los bucketizaba por fecha de compra).
  const soloLedger = !!item.esTarjeta && hayLedger;
  const [verLedger, setVerLedger] = useState(soloLedger);

  const grouped = {};
  for (const doc of (item.docs ?? [])) {
    const key = doc.contraparte || "Sin nombre";
    if (!grouped[key]) grouped[key] = { avencer:0, d0_30:0, d31_60:0, d61_90:0, dmas90:0, total:0 };
    const vto  = doc.vto ? new Date(doc.vto + (doc.vto.length === 10 ? "T00:00:00" : "")) : null;
    // vto inválido o ausente → "a vencer" (NO +90). Antes un Date inválido daba NaN y caía en el else = dmas90.
    const dias = (vto && !isNaN(vto)) ? Math.floor((hoy - vto) / 86400000) : -1;
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
  // CC comercial del grupo: las filas son cuentas/comprobantes, no proveedores/clientes.
  const contraparteLabel = item.ccGrupo ? "Cuenta" : (headerColor === "#16a34a" ? "Cliente" : "Proveedor");
  const fmt    = v => v > 0 ? fmtSaldo(v, mon) : <span style={{ color:T.dim }}>—</span>;
  const thS    = { padding:"10px 16px", fontSize:11, fontWeight:800, color:"rgba(255,255,255,.85)",
                   textAlign:"right", letterSpacing:".04em", textTransform:"uppercase", whiteSpace:"nowrap" };
  const tdS    = { padding:"10px 16px", fontSize:13, textAlign:"right", fontFamily:"var(--mono)",
                   color:T.text, whiteSpace:"nowrap" };
  const tdRed  = { ...tdS, color:"#dc2626", fontWeight:700 };

  // Sin tope de ancho: es una grilla densa y cada píxel de más es una columna menos de scroll horizontal.
  return (
    <div style={{ padding:"28px 32px" }} className="fade">
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
            {item.ccGrupo ? "Cuenta corriente · por fecha" : soloLedger ? "Extracto · saldo corriente" : `Detalle por ${contraparteLabel.toLowerCase()}`}
            {fechaCorte && <span style={{ marginLeft:8 }}>· Al {fmtDate(fechaCorte)}</span>}
          </div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:16 }}>
          {hayLedger && !soloLedger && (
            <button onClick={() => setVerLedger(v => !v)}
              style={{ background: verLedger ? headerColor : "#f3f4f6", border:`1px solid ${verLedger ? headerColor : T.cardBorder}`,
                borderRadius:8, padding:"7px 14px", fontSize:12.5, fontWeight:800,
                color: verLedger ? "#fff" : T.muted, cursor:"pointer", fontFamily:T.font, whiteSpace:"nowrap" }}>
              {verLedger ? "Ver por vencimiento" : "Ver movimientos"}
            </button>
          )}
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end" }}>
            <span style={{ fontSize:11, color:T.muted, textTransform:"uppercase",
              letterSpacing:".06em", fontWeight:700 }}>{verLedger && hayLedger ? "Saldo" : "Total pendiente"}</span>
            <span style={{ fontSize:22, fontFamily:"var(--mono)", fontWeight:900,
              color: headerColor, whiteSpace:"nowrap" }}>{fmtSaldo(verLedger && hayLedger ? (item.ledger.final ?? totRow.total) : totRow.total, mon)}</span>
          </div>
        </div>
      </div>

      {/* CC del grupo: extracto por fecha con saldo corriente · si no, Movimientos o Aging */}
      {item.ccGrupo ? (() => {
        const docsOrd = [...(item.docs || [])].sort((a, b) => String(a.fecha || "").localeCompare(String(b.fecha || "")));
        const fmtF = f => { const s = String(f || ""); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split("-").reverse().join("/") : (s || "—"); };
        let run = 0, totP = 0, totC = 0;
        // Saldo corriente en orden cronológico; se muestra al revés (más reciente arriba, más viejo abajo).
        const filas = docsOrd.map(d => {
          const esPagar = d.side === "pagar";
          run += esPagar ? d.monto : -d.monto;
          if (esPagar) totP += d.monto; else totC += d.monto;
          return { ...d, esPagar, saldo: run };
        }).reverse();
        return (
          <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:headerColor }}>
                  <th style={{ ...thS, textAlign:"left" }}>Fecha</th>
                  <th style={{ ...thS, textAlign:"left" }}>Cuenta</th>
                  <th style={{ ...thS, textAlign:"left" }}>N° Factura</th>
                  <th style={thS}>A pagar</th>
                  <th style={thS}>A cobrar</th>
                  <th style={{ ...thS, color:"#fff" }}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {filas.length === 0 && <tr><td colSpan={6} style={{ padding:16, fontSize:13, color:T.muted, textAlign:"center" }}>Sin comprobantes.</td></tr>}
                {filas.map((d, i) => (
                    <tr key={i} style={{ borderBottom:`1px solid ${T.cardBorder}`, background:i % 2 === 0 ? T.card : "#fafbfc" }}>
                      <td style={{ padding:"9px 16px", fontSize:12.5, color:T.muted, whiteSpace:"nowrap" }}>{fmtF(d.fecha)}</td>
                      <td style={{ padding:"9px 16px", fontSize:13, color:T.text }}>{d.cuenta || "—"}</td>
                      <td style={{ padding:"9px 16px", fontSize:12.5, color:T.muted, fontFamily:"var(--mono)" }}>{d.nroComp || "—"}</td>
                      <td style={tdS}>{d.esPagar ? fmtSaldo(d.monto, mon) : <span style={{ color:T.dim }}>—</span>}</td>
                      <td style={{ ...tdS, color: d.esPagar ? undefined : "#16a34a" }}>{d.esPagar ? <span style={{ color:T.dim }}>—</span> : fmtSaldo(d.monto, mon)}</td>
                      <td style={{ ...tdS, fontWeight:800 }}>{fmtSaldo(d.saldo, mon)}</td>
                    </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background:"#f3f4f6", borderTop:`2px solid ${headerColor}` }}>
                  <td style={{ padding:"10px 16px", fontSize:13, fontWeight:800, color:T.text }} colSpan={3}>Saldo</td>
                  <td style={{ ...tdS, fontWeight:800 }}>{fmtSaldo(totP, mon)}</td>
                  <td style={{ ...tdS, fontWeight:800, color:"#16a34a" }}>{fmtSaldo(totC, mon)}</td>
                  <td style={{ ...tdS, fontWeight:900, color:headerColor }}>{fmtSaldo(run, mon)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })() : verLedger && hayLedger ? (() => {
        const led = item.ledger;
        const rowsL = [...(led.entries || [])].reverse();   // más reciente arriba
        const fmtF = f => { const s = String(f || ""); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split("-").reverse().join("/") : s; };
        const sgn = v => (v >= 0 ? "+ " : "− ") + fmtSaldo(Math.abs(v), mon);
        return (
          <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:headerColor }}>
                  <th style={{ ...thS, textAlign:"left" }}>Fecha</th>
                  <th style={{ ...thS, textAlign:"left" }}>Concepto</th>
                  <th style={thS}>Monto</th>
                  <th style={{ ...thS, color:"#fff" }}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {rowsL.length === 0 && <tr><td colSpan={4} style={{ padding:16, fontSize:13, color:T.muted, textAlign:"center" }}>Sin movimientos (solo saldo de apertura).</td></tr>}
                {rowsL.map((e, i) => (
                  <tr key={i} style={{ borderBottom:`1px solid ${T.cardBorder}`, background:i % 2 === 0 ? T.card : "#fafbfc" }}>
                    <td style={{ padding:"9px 16px", fontSize:12.5, color:T.muted, whiteSpace:"nowrap", verticalAlign:"top" }}>{fmtF(e.fecha)}</td>
                    <td style={{ padding:"9px 16px", fontSize:13, color: e.pend ? T.muted : T.text }}>
                      <div>{e.concepto}</div>
                      {e.sub && <div style={{ fontSize:11, color:T.dim, marginTop:2 }}>{e.sub}</div>}
                    </td>
                    <td style={{ ...tdS, color: e.delta >= 0 ? "#16a34a" : "#dc2626", fontWeight:700 }}>{e.delta === 0 ? <span style={{ color:T.dim }}>—</span> : sgn(e.delta)}</td>
                    <td style={{ ...tdS, fontWeight:800 }}>{fmtSaldo(e.saldo, mon)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background:"#f3f4f6", borderTop:`2px solid ${T.cardBorder}` }}>
                  <td style={{ padding:"9px 16px", fontSize:12.5, fontWeight:800, color:T.muted }} colSpan={2}>Saldo de apertura</td>
                  <td style={tdS} />
                  <td style={{ ...tdS, fontWeight:900 }}>{fmtSaldo(led.opening || 0, mon)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })() : (
      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
        borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
          <colgroup>
            <col style={{ width:"22%" }} />
            {["","","","","",""].map((_, i) => <col key={i} style={{ width:"13%" }} />)}
          </colgroup>
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
                <td style={{ padding:"10px 16px", fontSize:13, color:T.text, fontWeight:600,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={r.contraparte}>
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
      )}
    </div>
  );
}

// Extracto de una posición interco (como una cuenta de tesorería): saldo de apertura + cada movimiento
// por fecha con su +/− y saldo corriente. Más reciente arriba, apertura abajo de todo.
export function PaginaIntercoLedger({ item, ledger, onBack, onGoToMov }) {
  const mon = item.moneda ?? "ARS";
  const nosDeben = (ledger.final ?? 0) >= 0;   // + = nos deben (activo) / − = les debemos
  const headerColor = nosDeben ? "#16a34a" : "#dc2626";
  const nMovs = (ledger.entries ?? []).length;
  return (
    <div style={{ padding: "28px 32px" }} className="fade">
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <button onClick={onBack} style={{ background: "#f3f4f6", border: `1px solid ${T.cardBorder}`, borderRadius: 8, padding: "6px 14px", fontSize: 13, fontWeight: 700, color: T.muted, cursor: "pointer", fontFamily: T.font, display: "flex", alignItems: "center", gap: 6 }}>← Volver</button>
        <div style={{ width: 4, height: 28, borderRadius: 2, background: headerColor }} />
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 900, color: T.text, margin: 0, letterSpacing: "-.02em" }}>{item.label}</h1>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>Cuenta corriente intercompañía · {nMovs} movimiento{nMovs !== 1 ? "s" : ""}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>Saldo actual</span>
            <span style={{ fontSize: 22, fontFamily: "var(--mono)", fontWeight: 900, color: headerColor, whiteSpace: "nowrap" }}>{fmtSaldo(ledger.final ?? 0, mon)}</span>
          </div>
          <span style={{ fontSize: 10, color: T.muted }}>{nosDeben ? "nos deben" : "debemos"}</span>
        </div>
      </div>
      <IntercoLedgerTable entries={ledger.entries} moneda={mon} headerColor={headerColor} opening={ledger.opening ?? 0} onGoToMov={onGoToMov} />
    </div>
  );
}

// ─── Tab: Saldos (Martín 5/11/2026: una tesorería, no un balance) ───────────────────────────────────
// Orden por liquidez, de "cuánta plata hay" a "qué viene": HOY (disponible: bancos, cajas e inversiones) →
// ESTE MES (a cobrar y a pagar corriente) → FINANCIACIÓN (anticipos, créditos, planes, socios e intercompañía).
// Monedas en COLUMNAS: las filas se ordenan por sociedad (como se concilia) y cada moneda se lee en su columna; el
// total por moneda queda en la fila de subtotal, sin tarjetas aparte. Nada se agrupa de verdad: cada cuenta es una
// fila con click a sus movimientos; en cobrar/pagar el botón es la CELDA (Franquiciados ARS y Franquiciados USD son
// dos antigüedades distintas). Los bloques se pliegan y el estado se recuerda en el navegador (por usuario).
// Es el MISMO componente para la Tesorería de cada sociedad (Numbers) y para la consolidada (Reportes).

const MON_ORDEN = ["ARS", "USD", "EUR", "COP"];
const ordenarMonedas = (arr) => [...new Set(arr)].sort((a, b) => ((MON_ORDEN.indexOf(a) + 1) || 99) - ((MON_ORDEN.indexOf(b) + 1) || 99));
const LS_SALDOS_PLEGADOS = "tesoreria.saldos.plegados";
const BLOQUES_SALDOS = ["hoy", "mes", "fin"];
const esCero = (n) => Math.abs(Number(n) || 0) < 0.5;

// Datos EN VIVO de Mercado Pago para una cuenta (pill al lado del nombre). Read-only; MP no expone el saldo por API:
//  - acreditado    = liberado del 1° del mes a hoy → plata que YA entró y aún NO está en Numbers.
//  - a_acreditarse = por liberarse (futuro). MP real ≈ saldo contable + acreditado.
function mpPill(cuenta, mpLive) {
  if (!mpLive) return null;
  if (mpLive.loading) return { txt: "MP: …", title: "Datos en vivo de Mercado Pago", neg: false };
  if (mpLive.error) return null;   // sin token / API caída → no mostramos nada (no rompe)
  const mon = mpLive.moneda || cuenta.moneda;
  const estimado = (Number(cuenta.saldo) || 0) + (Number(mpLive.acreditado) || 0);
  const title = [
    `Acreditado del mes (ya entró, aún no conciliado en Numbers): ${fmtSaldo(Number(mpLive.acreditado) || 0, mon)}`,
    `Por acreditarse (aún no libera; NO suma al PN): ${fmtSaldo(Number(mpLive.a_acreditarse) || 0, mon)}`,
    `MP real ≈ saldo contable + acreditado: ${fmtSaldo(estimado, mon)}`,
    `(dato en vivo de hoy — no es parte del Balance/PN)`,
    (mpLive.proximos?.length ? "Próximas liberaciones:\n" + mpLive.proximos.slice(0, 6).map(p => `  ${fmtDate(p.fecha)}: ${fmtSaldo(p.monto, mon)}`).join("\n") : ""),
    (mpLive.truncado ? "(⚠ hay más cobros que el tope; acreditado parcial)" : ""),
  ].filter(Boolean).join("\n");
  return { txt: `MP real ≈ ${fmtSaldo(estimado, mon)}`, title, neg: estimado < 0 };
}

// Celda de importe (una moneda). `signo` fuerza color (interco: + nos deben / − les debemos).
function CeldaMonto({ valor, moneda, onClick, title, fuerte = false, color }) {
  const v = Number(valor) || 0;
  const vacia = valor == null || valor === "";
  const col = color || (v < 0 ? T.red : vacia || esCero(v) ? T.dim : T.text);
  return (
    <td onClick={onClick} title={onClick ? (title || `Ver detalle en ${moneda}`) : undefined}
      style={{ padding: "7px 12px", textAlign: "right", fontFamily: "var(--mono)", fontSize: 12.5, whiteSpace: "nowrap",
        fontWeight: fuerte ? 800 : 600, color: col, cursor: onClick ? "pointer" : "default",
        textDecoration: "none" }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.textDecoration = "underline"; }}
      onMouseLeave={e => { e.currentTarget.style.textDecoration = "none"; }}>
      {vacia ? "" : fmtSaldo(v, moneda)}
    </td>
  );
}

// Las tres tablas de Saldos (cuentas, este mes, financiación) comparten anchos: layout fijo + una columna de ancho fijo por
// moneda, la de etiqueta se queda con el resto. Así USD queda bajo USD en todos los bloques (Martín 5/11/2026).
const COL_MON = 150;
const TABLA_SALDOS = { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" };
const ColsSaldos = ({ monedas }) => <colgroup><col />{monedas.map(m => <col key={m} style={{ width: COL_MON }} />)}</colgroup>;
const thMon = { padding: "6px 12px", textAlign: "right", fontSize: 10, fontWeight: 800, letterSpacing: ".08em", color: T.dim, whiteSpace: "nowrap" };
const tdLabel = { padding: "7px 18px", fontSize: 13, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 360 };
const trLine = { borderBottom: `1px solid ${T.cardBorder}` };   // la tabla lleva border-collapse → el borde del <tr> se dibuja en todas sus celdas
const trSub  = { background: "#fafbfc", borderTop: `2px solid ${T.cardBorder}` };

// Bloque plegable = UNA tabla: el header oscuro es su primera fila (título en la columna de etiqueta, el código de cada
// moneda en su columna) → las monedas quedan clavadas sobre sus importes sin fila gris aparte (Martín 5/11/2026).
// Los hijos (TablaCuentas / TablaItems) ponen tbody + tfoot; plegado esconde el tbody y deja el pie a la vista.
function BloqueSaldos({ titulo, detalle, plegado, onToggle, monedas, children }) {
  return (
    <>
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow,
      overflow: "hidden", marginBottom: 16 }}>
      <table style={TABLA_SALDOS}>
        <ColsSaldos monedas={monedas} />
        <thead>
          <tr onClick={onToggle} style={{ background: T.tableHead, cursor: "pointer", userSelect: "none" }}>
            <th style={{ padding: "9px 18px", textAlign: "left", fontWeight: 400 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span style={{ fontSize: 9, color: T.tableHeadText, display: "inline-block", flexShrink: 0, transform: plegado ? "rotate(0deg)" : "rotate(90deg)", transition: "transform .12s" }}>▶</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: T.tableHeadText, letterSpacing: ".10em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{titulo}</span>
              </div>
            </th>
            {monedas.map(m => <th key={m} style={{ ...thMon, padding: "9px 12px", fontSize: 11, letterSpacing: ".10em", color: T.tableHeadText }}>{m}</th>)}
          </tr>
        </thead>
        {children}
      </table>
    </div>
    {/* La ayuda va abajo como nota, AFUERA de la tarjeta, no en el header (Martín 5/11). */}
    {!plegado && detalle && <div style={{ padding: "0 18px", margin: "-10px 0 16px", fontSize: 10.5, color: T.dim }}>* {detalle}</div>}
    </>
  );
}

// Tabla HOY: una fila por cuenta (bancos, cajas e inversiones), agrupadas por sociedad cuando hay `_soc` (consolidado),
// bancos → Mercado Pago → cajas → inversiones y por saldo; las que están en cero van en gris (se ven todas). Pie: disponible.
function TablaCuentas({ cuentas, monedas, mpLive, onCuentaClick, plegado = false }) {
  const conSoc = cuentas.some(c => c.__soc);
  const grupos = [];
  for (const c of cuentas) {
    const k = conSoc ? (c.__soc || "—") : "";
    let g = grupos.find(x => x.soc === k); if (!g) { g = { soc: k, cuentas: [] }; grupos.push(g); }
    g.cuentas.push(c);
  }
  // Orden dentro de cada sociedad (Martín 5/11): bancos tradicionales → Mercado Pago → cajas → inversiones; y por saldo.
  const rango = c => esCuentaMercadoPago(c) ? 1 : c.tipo === "banco" ? 0 : c.tipo === "caja" ? 2 : 3;
  for (const g of grupos) g.cuentas.sort((a, b) => rango(a) - rango(b) || (Number(b.saldo) || 0) - (Number(a.saldo) || 0));
  const tot = {};
  for (const c of cuentas) tot[c.moneda] = (tot[c.moneda] || 0) + (Number(c.saldo) || 0);
  return (
    <>
      {!plegado && <tbody>
        {grupos.map(g => (
          <Fragment key={g.soc}>
            {conSoc && (
              <tr style={trLine}><td colSpan={monedas.length + 1} style={{ padding: "9px 18px 3px", fontSize: 11, fontWeight: 700, color: T.muted }}>{g.soc}</td></tr>
            )}
            {g.cuentas.map(c => {
              const cfg = TIPO_CUENTA[c.tipo] ?? { icon: "💳" };
              const mp = esCuentaMercadoPago(c) ? mpPill(c, mpLive) : null;
              return (
                <tr key={c.id} style={{ ...trLine, cursor: onCuentaClick ? "pointer" : "default" }}
                  onClick={onCuentaClick ? () => onCuentaClick(c) : undefined}
                  onMouseEnter={e => { if (onCuentaClick) e.currentTarget.style.background = "#f0f9ff"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = ""; }}>
                  <td style={tdLabel}>
                    {/* la celda sigue siendo celda (bordes y anchos de la tabla); el flex va adentro */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span style={{ fontSize: 13, flexShrink: 0 }}>{cfg.icon}</span>
                      <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nombre}</span>
                      {c.tipo === "inversion" && <span style={{ fontSize: 10, color: T.dim, fontWeight: 600, flexShrink: 0 }}>inversión</span>}
                      {mp && (
                        <span title={mp.title} style={{ fontSize: 10.5, fontWeight: 700, color: mp.neg ? "#b91c1c" : "#059669",
                          background: mp.neg ? "#fef2f2" : "#ecfdf5", border: `1px solid ${mp.neg ? "#fecaca" : "#a7f3d0"}`,
                          borderRadius: 5, padding: "1px 7px", cursor: "help", whiteSpace: "nowrap", flexShrink: 0 }}>{mp.txt}</span>
                      )}
                    </div>
                  </td>
                  {monedas.map(m => <CeldaMonto key={m} valor={c.moneda === m ? (Number(c.saldo) || 0) : null} moneda={m} />)}
                </tr>
              );
            })}
          </Fragment>
        ))}
        {cuentas.length === 0 && (
          <tr><td colSpan={monedas.length + 1} style={{ padding: 16, fontSize: 12, color: T.dim, textAlign: "center" }}>Sin cuentas registradas</td></tr>
        )}
      </tbody>}
      <tfoot>
        <tr style={{ ...trSub, borderTop: `2px solid ${T.cardBorder}` }}>
          <td style={{ ...tdLabel, fontSize: 12, fontWeight: 800, color: T.text }}>Disponible</td>
          {monedas.map(m => <CeldaMonto key={m} valor={tot[m] ?? null} moneda={m} fuerte />)}
        </tr>
      </tfoot>
    </>
  );
}

// Tabla de categorías (a cobrar / a pagar / interco): una fila por label, una celda por moneda = el item de esa moneda
// (click → su antigüedad / ledger). `secciones` = [{ titulo, color, items, signo? }]. Las líneas `_info` (MP a acreditarse)
// se muestran en cursiva y no suman.
function TablaItems({ secciones, monedas, onItemClick, pie = [], plegado = false }) {
  const totales = (items, signo) => {   // con `signo` (interco) el total lleva el mismo signo que las celdas
    const t = {};
    for (const it of items) { if (it._info) continue; t[it.moneda] = (t[it.moneda] || 0) + (signo ? signo(it) : (Number(it.saldo) || 0)); }
    return t;
  };
  // Fila de total con el tono de su sección (verde cobrar / rojo pagar) para que corte con las categorías.
  // Va al final de su sección y, con el bloque plegado y sin pie propio, es lo único que queda a la vista.
  const filaTotal = sec => {
    if (!sec.totalLabel || !sec.items.some(it => !it._info)) return null;
    const tot = totales(sec.items, sec.signo);
    return (
      <tr key={"tot:" + sec.titulo} style={{ ...trSub, background: sec.color === T.green ? T.greenBg : sec.color === T.red ? T.redBg : "#f3f4f6" }}>
        <td style={{ ...tdLabel, fontSize: 12.5, fontWeight: 800, color: sec.signo ? T.text : sec.color }}>{sec.totalLabel}</td>
        {monedas.map(m => <CeldaMonto key={m} valor={tot[m] ?? null} moneda={m} color={sec.signo ? undefined : sec.color} />)}
      </tr>
    );
  };
  return (
    <>
      {!plegado && <tbody>
        {secciones.map(sec => {
          const filaDe = it => it._fila ?? it.label;   // interco consolidado: misma contraparte desde varias sociedades → una fila por sociedad
          const labels = [...new Set(sec.items.map(filaDe))];
          return (
            <Fragment key={sec.titulo}>
              {/* Jerarquía por sangría (Martín 5/11): el título al margen, las categorías un paso adentro. Sin bandas. */}
              <tr style={trLine}><td colSpan={monedas.length + 1} style={{ padding: "10px 18px 4px", fontSize: 12, fontWeight: 800, color: sec.color }}>{sec.titulo}</td></tr>
              {labels.length === 0 && (
                <tr style={trLine}><td colSpan={monedas.length + 1} style={{ padding: "7px 36px", fontSize: 12, color: T.dim }}>Sin pendientes</td></tr>
              )}
              {labels.map(label => {
                const deLabel = sec.items.filter(it => filaDe(it) === label);
                const info = deLabel.every(it => it._info);
                return (
                  <tr key={label} style={trLine}>
                    <td title={info ? deLabel[0]?.title : undefined} style={{ ...tdLabel, paddingLeft: 36, fontStyle: info ? "italic" : "normal", color: info ? T.dim : T.text }}>
                      {label}
                    </td>
                    {monedas.map(m => {
                      const its = deLabel.filter(x => x.moneda === m);
                      if (!its.length) return <CeldaMonto key={m} valor={null} moneda={m} />;
                      const v = its.reduce((a, it) => a + (sec.signo ? sec.signo(it) : (Number(it.saldo) || 0)), 0);
                      const it = its[0];
                      return <CeldaMonto key={m} valor={v} moneda={m} color={it._info ? T.dim : (sec.signo ? (v < 0 ? T.red : T.green) : sec.color)}
                        onClick={!it._info && onItemClick ? () => onItemClick(it) : undefined} title={`${label} · ${sec.tituloClick || "ver antigüedad"} en ${m}`} />;
                    })}
                  </tr>
                );
              })}
              {filaTotal(sec)}
            </Fragment>
          );
        })}
      </tbody>}
      {(pie.length > 0 || plegado) && (
        <tfoot>
          {pie.map(p => (
            <tr key={p.label} style={{ ...trSub, borderTop: `2px solid ${T.cardBorder}` }}>
              <td style={{ ...tdLabel, fontSize: 12, fontWeight: 800, color: T.text }}>{p.label}</td>
              {monedas.map(m => <CeldaMonto key={m} valor={p.valores[m] ?? null} moneda={m} fuerte />)}
            </tr>
          ))}
          {plegado && pie.length === 0 && secciones.map(filaTotal)}
        </tfoot>
      )}
    </>
  );
}

export function TabSaldos({ cuentas, aCobrar, aPagar, interco = [], filtroMoneda, mpLive, onCuentaClick, onItemClick }) {
  const [plegados, setPlegados] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem(LS_SALDOS_PLEGADOS) || "null"); if (v && typeof v === "object") return v; } catch { /* sin storage */ }
    return { fin: true };   // Financiación plegada por defecto: deuda real, pero no se gestiona día a día
  });
  useEffect(() => { try { localStorage.setItem(LS_SALDOS_PLEGADOS, JSON.stringify(plegados)); } catch { /* sin storage */ } }, [plegados]);
  const toggle = (k) => setPlegados(p => ({ ...p, [k]: !p[k] }));
  const todos = (v) => setPlegados(Object.fromEntries(BLOQUES_SALDOS.map(k => [k, v])));
  const todoPlegado = BLOQUES_SALDOS.every(k => plegados[k]);

  const filtrar = arr => filtroMoneda === "ALL" ? arr : arr.filter(c => c.moneda === filtroMoneda);
  // Disponible = bancos + cajas + inversiones (la deuda de tarjeta no es disponible: queda en a pagar).
  const disponibles = filtrar(cuentas.filter(c => c.tipo === "banco" || c.tipo === "caja" || c.tipo === "inversion"))
    .map(c => ({ ...c, __soc: c._soc || "" }));

  // MP a acreditarse = dato EN VIVO de hoy (ventas ya cobradas pero aún no asentadas; se asientan en el cierre
  // mensual). Línea informativa en A cobrar (`_info`): NO suma al total ni al PN.
  const mpMoneda = mpLive?.moneda || "ARS";
  const aCobrarMP = (mpLive && !mpLive.loading && !mpLive.error && Number(mpLive.a_acreditarse) > 0
      && (filtroMoneda === "ALL" || filtroMoneda === mpMoneda))
    ? [{ label: "Mercado Pago — a acreditarse", moneda: mpMoneda, saldo: Number(mpLive.a_acreditarse),
         _info: true, title: "En vivo de hoy · ventas cobradas por liberarse. No suma al PN (se asienta en el cierre mensual)." }]
    : [];
  const cobrar = filtrar(aCobrar), pagar = filtrar(aPagar), intercoF = filtrar(interco);
  // Corriente vs financiación: misma regla que la Posición financiera (balanceUtils).
  const cobrarMes = [...cobrar.filter(it => clasificarActivo(it) === "cxc"), ...aCobrarMP];
  const cobrarFin = cobrar.filter(it => clasificarActivo(it) !== "cxc");
  // Impuestos: en la Posición financiera cuentan como deuda financiable (no corriente), pero en tesorería se pagan
  // todos los meses → acá van en "Este mes". El resto sigue la misma regla que la Posición financiera.
  const esPagarMes = it => { const g = clasificarPasivo(it).grupo; return g === "operativo" || g === "finCorriente" || /impuesto/i.test(it?.label || ""); };
  const pagarMes = pagar.filter(esPagarMes), pagarFin = pagar.filter(it => !esPagarMes(it));

  const monedas = filtroMoneda === "ALL"
    ? ordenarMonedas([...disponibles, ...cobrar, ...pagar, ...intercoF].map(x => x.moneda).filter(Boolean))
    : [filtroMoneda];

  // Pie de "Este mes": disponible + a cobrar − a pagar, por moneda.
  const sumar = (items, signo = 1) => { const t = {}; for (const it of items) { if (it._info) continue; t[it.moneda] = (t[it.moneda] || 0) + signo * (Number(it.saldo) || 0); } return t; };
  const dispo = sumar(disponibles), cobM = sumar(cobrarMes), pagM = sumar(pagarMes, -1);
  const neto = {}; for (const m of monedas) { const v = (dispo[m] || 0) + (cobM[m] || 0) + (pagM[m] || 0); if (dispo[m] != null || cobM[m] != null || pagM[m] != null) neto[m] = v; }

  const signoInterco = it => it.headerColor === "#16a34a" ? (Number(it.saldo) || 0) : -(Number(it.saldo) || 0);   // + nos deben / − les debemos
  // Interco: el label es la CONTRAPARTE. En el consolidado la misma contraparte puede tener posiciones desde varias
  // sociedades nuestras → una fila por sociedad ("Wellness · desde Beta"); el nombre sale de las cuentas (traen _soc).
  const socNom = new Map(cuentas.filter(c => c._soc).map(c => [String(c.sociedad), c._soc]));
  const variasSoc = new Set(intercoF.map(it => String(it.sociedadId ?? ""))).size > 1;
  const intercoRows = intercoF.map(it => {
    const desde = variasSoc ? socNom.get(String(it.sociedadId)) : "";
    return { ...it, _fila: String(it.label ?? "").replace(/^Intercompañía · /, "") + (desde ? ` · desde ${desde}` : "") };
  });
  const sinNada = disponibles.length + cobrar.length + pagar.length + intercoF.length === 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 14, marginBottom: 8 }}>
        <span onClick={() => todos(false)} style={{ fontSize: 11, color: T.muted, cursor: "pointer", textDecoration: "underline" }}>Desplegar todo</span>
        <span onClick={() => todos(true)}  style={{ fontSize: 11, color: T.muted, cursor: "pointer", textDecoration: "underline" }}>Plegar todo</span>
      </div>
      {sinNada && <div style={{ padding: 18, fontSize: 12, color: T.dim, textAlign: "center" }}>Sin saldos para mostrar</div>}

      <BloqueSaldos titulo="Hoy · disponible" detalle="bancos, cajas e inversiones · click en la cuenta abre sus movimientos" monedas={monedas}
        plegado={!!plegados.hoy} onToggle={() => toggle("hoy")}>
        <TablaCuentas cuentas={disponibles} monedas={monedas} mpLive={mpLive} onCuentaClick={onCuentaClick} plegado={!!plegados.hoy} />
      </BloqueSaldos>

      {/* Sin "Este mes" (Martín 5/11): no es un corte temporal, es la naturaleza del pasivo/activo la que lo pone acá. */}
      <BloqueSaldos titulo="A cobrar y a pagar" detalle="créditos y deudas corrientes: lo operativo, impuestos y financiación de corto plazo · el resto va en Financiación" monedas={monedas}
        plegado={!!plegados.mes} onToggle={() => toggle("mes")}>
        <TablaItems monedas={monedas} onItemClick={onItemClick} plegado={!!plegados.mes}
          secciones={[
            { titulo: "A cobrar", color: T.green, items: cobrarMes, totalLabel: "Total a cobrar" },
            { titulo: "A pagar",  color: T.red,   items: pagarMes,  totalLabel: "Total a pagar" },
          ]}
          pie={[{ label: "Disponible + a cobrar − a pagar", valores: neto }]} />
      </BloqueSaldos>

      <BloqueSaldos titulo="Financiación" detalle="anticipos, créditos, planes de pago, socios e intercompañía" monedas={monedas}
        plegado={!!plegados.fin} onToggle={() => toggle("fin")}>
        <TablaItems monedas={monedas} onItemClick={onItemClick} plegado={!!plegados.fin}
          secciones={[
            { titulo: "Nos deben", color: T.green, items: cobrarFin, totalLabel: "Total nos deben" },
            { titulo: "Debemos", color: T.red, items: pagarFin, totalLabel: "Total debemos" },
            // Consolidado con todas las sociedades: el interco se netea y no hay posiciones → la sección no se muestra.
            ...(intercoRows.length ? [{ titulo: "Intercompañía (+ nos deben / − debemos)", color: T.muted, items: intercoRows, signo: signoInterco,
              tituloClick: "ver el ledger", totalLabel: "Neto intercompañía" }] : []),
          ]} />
      </BloqueSaldos>
      {todoPlegado && <div style={{ fontSize: 11, color: T.dim, textAlign: "center", marginTop: -6 }}>Todo plegado · abrí un bloque con la flechita</div>}
    </div>
  );
}

// ─── Dropdown por fila ────────────────────────────────────────────────────────
function RowMenu({ onEditar, onVerDetalle, onEliminar, onIgnorar }) {
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
          {onEditar && item("Editar", onEditar)}
          {onVerDetalle && item("Ver detalle", onVerDetalle)}
          {(onEditar || onVerDetalle) && (onIgnorar || onEliminar) && <div style={{ height:1, background:T.cardBorder, margin:"3px 0" }} />}
          {onIgnorar && item("Ignorar (no contabilizar)", onIgnorar, "#b45309")}
          {onEliminar && item("Eliminar", onEliminar, T.red)}
        </div>
      )}
    </>
  );
}

// ─── Tab: Movimientos ─────────────────────────────────────────────────────────
export function TabMovimientos({ movimientos, cuentas, filtroCuenta, filtroRef, onLimpiarFiltro, onEliminar, onEditar, onEditarDoc, onEditarInterco, onEditarCambio, onEditarPar, onIgnorar, onNuevoMov, centrosCosto = [], resetSignal = 0 }) {
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

  // Memo: de acá cuelgan sorted → saldoByRow → buscado → ordenado; sin memo, cada render re-ordenaba
  // toda la tabla y recalculaba el saldo corriente.
  const rows = useMemo(() => (filtroRef
    ? movimientos.filter(m => String(m.documento_id || "") === filtroRef || String(m.id || "") === filtroRef)
    : filtroCuenta
    ? movimientos.filter(m => m.cuenta_bancaria === filtroCuenta)
    : movimientos).filter(m => !esIgnorado(m)),   // ocultar las líneas descartadas del ledger
  [movimientos, filtroRef, filtroCuenta]);

  // Orden: fecha descendente; a igual fecha, el último cargado primero (el orden de `rows` = orden
  // de la hoja = orden de alta, así que desempatamos por índice descendente).
  const sorted = useMemo(() =>
    rows
      .map((m, i) => [m, i])
      .sort((a, b) => (b[0].fecha ?? "").localeCompare(a[0].fecha ?? "") || b[1] - a[1])
      .map(([m]) => m)
  , [rows]);

  // Saldo corriente por cuenta (acumulado en orden cronológico ascendente; `sorted` es descendente).
  // La última fila cronológica de una cuenta = su saldo total (coincide con la pestaña Saldos).
  const saldoByRow = useMemo(() => {
    const acc = {}, map = new Map();
    for (let i = sorted.length - 1; i >= 0; i--) {
      const m = sorted[i];
      const k = m.cuenta_bancaria || "";
      acc[k] = (acc[k] ?? 0) + (Number(m.monto) || 0);
      map.set(m, acc[k]);
    }
    return map;
  }, [sorted]);

  const cuentaNombre = filtroCuenta ? (cuentaMap[filtroCuenta] ?? filtroCuenta) : null;

  // Filtros de visualización. NO tocan `sorted` (ese sigue en orden cronológico real, que es lo que
  // necesita saldoByRow). El rango de FECHAS lo aplica el padre (movsHastaFecha → prop `movimientos`);
  // acá quedan la búsqueda y el filtro de la columna Importe (signo + rango), estilo Excel.
  const [busqueda, setBusqueda] = useState("");
  const [signo,    setSigno]    = useState("todos");   // "todos" | "pos" (ingresos) | "neg" (egresos)
  const [montoMin, setMontoMin] = useState("");   // filtra por |importe| ≥ min
  const [montoMax, setMontoMax] = useState("");   // filtra por |importe| ≤ max
  const [importeMenu, setImporteMenu] = useState(false);   // popover de la columna Importe (orden + filtro)
  const importeFiltrado = signo !== "todos" || montoMin !== "" || montoMax !== "";
  const limpiarImporte = () => { setSigno("todos"); setMontoMin(""); setMontoMax(""); };
  const inpStyle = { fontSize:12, color:T.text, background:T.card, border:`1px solid ${T.cardBorder}`,
    borderRadius:6, padding:"5px 8px", fontFamily:T.font, boxSizing:"border-box" };
  const ordBtnStyle = (on) => ({ flex:1, fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:T.font,
    borderRadius:6, padding:"6px 8px", border:`1px solid ${on ? T.accentDark : T.cardBorder}`,
    background: on ? T.accentDark : "#eceff3", color: on ? T.accent : T.muted });
  const buscado = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const min = montoMin !== "" ? Number(montoMin) : null;
    const max = montoMax !== "" ? Number(montoMax) : null;
    return sorted.filter(m => {
      if (q && !((m.concepto ?? "").toLowerCase().includes(q) ||
          String(m.cuenta_contable || m.cuenta || "").replace(/^CUENTA_/, "").toLowerCase().includes(q))) return false;
      const monto = Number(m.monto) || 0;
      if (signo === "pos" && monto < 0) return false;
      if (signo === "neg" && monto >= 0) return false;
      const abs = Math.abs(monto);
      if (min != null && abs < min) return false;
      if (max != null && abs > max) return false;
      return true;
    });
  }, [sorted, busqueda, signo, montoMin, montoMax]);

  // Orden de columnas: clickeás un header para ordenar por esa columna (asc/desc). Por defecto,
  // fecha descendente (igual que antes). Accede al valor comparable de cada columna por fila.
  const [sortKey, setSortKey] = useState("fecha");
  const [sortDir, setSortDir] = useState("desc");
  const ordenado = useMemo(() => {
    const sortValue = (m, key) => {
      switch (key) {
        case "tipo":     return (TIPO_CFG[m.tipo]?.label ?? m.tipo ?? "");
        case "fecha":    return m.fecha ?? "";
        case "cuenta":   return cuentaMap[m.cuenta_bancaria] ?? m.cuenta_bancaria ?? "";
        case "concepto": return m.concepto ?? "";
        case "ctaCont":  return String(m.cuenta_contable || m.cuenta || "").replace(/^CUENTA_/, "");
        case "centro":   return m.centro_costo ? (ccMap[m.centro_costo] ?? m.centro_costo) : "";
        case "moneda":   return m.moneda ?? "";
        case "importe":  return Number(m.monto) || 0;
        case "saldo":    return saldoByRow.get(m) ?? 0;
        case "registro": return m.registrado_por ?? "";
        default:         return "";
      }
    };
    const dir = sortDir === "asc" ? 1 : -1;
    return [...buscado].sort((a, b) => {
      const va = sortValue(a, sortKey), vb = sortValue(b, sortKey);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [buscado, sortKey, sortDir, cuentaMap, ccMap, saldoByRow]);
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "fecha" ? "desc" : "asc"); }
  };
  // "Borrar filtros" del toolbar (padre) → limpia búsqueda + filtro de importe + vuelve al orden por defecto.
  // resetSignal arranca en 0 (no dispara en el primer render); el padre lo incrementa al clickear.
  useEffect(() => {
    if (!resetSignal) return;
    setBusqueda(""); setSigno("todos"); setMontoMin(""); setMontoMax(""); setImporteMenu(false);
    setSortKey("fecha"); setSortDir("desc");
  }, [resetSignal]);

  // Paginado: la tabla puede tener cientos/miles de filas y sin límite el scroll se vuelve interminable.
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [filtroCuenta, filtroRef, pageSize, busqueda, signo, montoMin, montoMax, sortKey, sortDir]);
  const totalPages = Math.max(1, Math.ceil(ordenado.length / pageSize));
  const pageClamped = Math.min(page, totalPages - 1);
  const desde = pageClamped * pageSize;
  const visible = ordenado.slice(desde, desde + pageSize);

  if (rows.length === 0) {
    return (
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          gap:10, marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            {(cuentaNombre || filtroRef) && <>
              <span style={{ fontSize:13, fontWeight:700, color:T.text }}>{filtroRef ? <>🔗 <span style={{ fontFamily:"var(--mono)" }}>#{filtroRef}</span></> : `🏦 ${cuentaNombre}`}</span>
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
            {filtroRef
              ? `El movimiento #${filtroRef} no está en los libros de esta sociedad — vive en la contabilidad de la sociedad que lo cargó.`
              : cuentaNombre
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
          {(cuentaNombre || filtroRef) && <>
            <span style={{ fontSize:13, fontWeight:700, color:T.text }}>{filtroRef ? <>🔗 <span style={{ fontFamily:"var(--mono)" }}>#{filtroRef}</span></> : `🏦 ${cuentaNombre}`}</span>
            <button onClick={onLimpiarFiltro} style={{
              fontSize:11, color:T.muted, background:"#f3f4f6",
              border:`1px solid ${T.cardBorder}`, borderRadius:6,
              padding:"2px 10px", cursor:"pointer", fontFamily:T.font }}>✕ Ver todas</button>
          </>}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por concepto o cuenta contable…" style={{
              fontSize:12, color:T.text, background:T.card, border:`1px solid ${T.cardBorder}`,
              borderRadius:6, padding:"5px 10px", fontFamily:T.font, width:240 }} />
          {busqueda && (
            <button onClick={() => setBusqueda("")} style={{
              fontSize:11, color:T.muted, background:"#f3f4f6",
              border:`1px solid ${T.cardBorder}`, borderRadius:6,
              padding:"2px 10px", cursor:"pointer", fontFamily:T.font }}>✕</button>
          )}
          <span style={{ fontSize:11, color:T.muted }}>Filas por página</span>
          <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} style={{
            fontSize:12, color:T.text, background:T.card, border:`1px solid ${T.cardBorder}`,
            borderRadius:6, padding:"3px 8px", cursor:"pointer", fontFamily:T.font }}>
            {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
        borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden" }}>
        <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:860 }}>
          <thead>
            <tr style={{ background:T.tableHead }}>
              <th style={{ width:36 }} />
              {[
                ["Tipo", "tipo"], ["Fecha", "fecha"], ["Cuenta", "cuenta"], ["Concepto", "concepto"],
                ["Cta. Contable", "ctaCont"], ["C. Costo", "centro"], ["Moneda", "moneda"],
                ["Importe", "importe"], ["Saldo", "saldo"], ["Registró", "registro"],
              ].map(([h, key]) => key === "importe" ? (
                // Columna Importe: header estilo Excel — click abre un menú con orden (▲▼) y filtro (signo + rango).
                <th key={h} style={{ position:"relative", padding:"10px 14px", fontSize:11, fontWeight:700,
                  letterSpacing:".08em", textTransform:"uppercase", color:T.tableHeadText, whiteSpace:"nowrap", textAlign:"right" }}>
                  <button onClick={() => setImporteMenu(o => !o)} title="Ordenar y filtrar" style={{
                    background:"transparent", border:"none", cursor:"pointer", color:"inherit", fontFamily:T.font,
                    fontSize:11, fontWeight:700, letterSpacing:".08em", textTransform:"uppercase",
                    display:"inline-flex", alignItems:"center", gap:4 }}>
                    {h}
                    {sortKey === "importe" && (sortDir === "asc" ? " ▲" : " ▼")}
                    <span style={{ color: importeFiltrado ? T.accentDark : T.tableHeadText, fontWeight:900,
                      opacity: importeFiltrado ? 1 : .55 }}>▾</span>
                  </button>
                  {importeMenu && (
                    <>
                      <div onClick={() => setImporteMenu(false)} style={{ position:"fixed", inset:0, zIndex:60 }} />
                      <div style={{ position:"absolute", right:8, top:"100%", marginTop:4, zIndex:61, background:T.card,
                        border:`1px solid ${T.cardBorder}`, borderRadius:8, boxShadow:"0 10px 30px rgba(0,0,0,.18)",
                        padding:12, width:236, textAlign:"left", textTransform:"none", letterSpacing:"normal", cursor:"default" }}>
                        <div style={{ fontSize:10, fontWeight:800, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", marginBottom:6 }}>Ordenar</div>
                        <div style={{ display:"flex", gap:6, marginBottom:12 }}>
                          <button onClick={() => { setSortKey("importe"); setSortDir("asc"); }} style={ordBtnStyle(sortKey==="importe" && sortDir==="asc")}>▲ Menor</button>
                          <button onClick={() => { setSortKey("importe"); setSortDir("desc"); }} style={ordBtnStyle(sortKey==="importe" && sortDir==="desc")}>▼ Mayor</button>
                        </div>
                        <div style={{ fontSize:10, fontWeight:800, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", marginBottom:6 }}>Mostrar</div>
                        <select value={signo} onChange={e => setSigno(e.target.value)} style={{ ...inpStyle, width:"100%", cursor:"pointer", marginBottom:12 }}>
                          <option value="todos">Todos</option>
                          <option value="pos">Ingresos (+)</option>
                          <option value="neg">Egresos (−)</option>
                        </select>
                        <div style={{ fontSize:10, fontWeight:800, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", marginBottom:6 }}>Importe (valor absoluto)</div>
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:12 }}>
                          <MoneyField value={montoMin} onChange={e => setMontoMin(e.target.value)} placeholder="mín" style={{ ...inpStyle, width:"50%" }} />
                          <span style={{ fontSize:11, color:T.muted }}>a</span>
                          <MoneyField value={montoMax} onChange={e => setMontoMax(e.target.value)} placeholder="máx" style={{ ...inpStyle, width:"50%" }} />
                        </div>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <button onClick={limpiarImporte} disabled={!importeFiltrado} style={{ fontSize:11, fontWeight:700,
                            cursor: importeFiltrado ? "pointer" : "default", fontFamily:T.font, borderRadius:6, padding:"5px 12px",
                            border:`1px solid ${T.cardBorder}`, background:"#f3f4f6", color: importeFiltrado ? T.muted : T.dim }}>Limpiar</button>
                          <button onClick={() => setImporteMenu(false)} style={{ fontSize:11, fontWeight:700, cursor:"pointer",
                            fontFamily:T.font, borderRadius:6, padding:"5px 14px", border:"none", background:T.accentDark, color:T.accent }}>Listo</button>
                        </div>
                      </div>
                    </>
                  )}
                </th>
              ) : (
                <th key={h} onClick={() => toggleSort(key)} title="Ordenar" style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                  letterSpacing:".08em", textTransform:"uppercase", color:T.tableHeadText, cursor:"pointer", userSelect:"none",
                  whiteSpace:"nowrap", textAlign: (h === "Importe" || h === "Saldo") ? "right" : "left" }}>
                  {h}{sortKey === key && (sortDir === "asc" ? " ▲" : " ▼")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordenado.length === 0 && (
              <tr><td colSpan={11} style={{ padding:"32px 14px", textAlign:"center", color:T.dim, fontSize:13 }}>
                Sin resultados con los filtros aplicados
              </td></tr>
            )}
            {visible.map((m, i) => {
              const base   = esIntercoCaja(m) ? INTERCO_CAJA_CFG : TIPO_CFG[m.tipo] ?? { bg:"#f3f4f6", color:"#374151", label:m.tipo };
              const cfg    = esSinConciliar(m) ? { ...base, ...TIPO_SIN_CONCILIAR } : base;
              const monto  = Number(m.monto) || 0;
              const nombre = cuentaMap[m.cuenta_bancaria] ?? m.cuenta_bancaria ?? "—";
              // "Editar" de un PAGO/COBRO = editar el pago en el detalle de su comprobante (donde vive
              // el editor bueno: fecha/monto/medio/borrar). Se rutea por el prefijo del documento_id.
              const doc = String(m.documento_id || "");
              const editarDoc = (m.tipo === "PAGO"  && doc.startsWith("EG-")) ? ["egresos",  doc]
                              : (m.tipo === "COBRO" && doc.startsWith("IN-")) ? ["ingresos", doc]
                              : null;
              // Todo lo que tiene editor local en Tesorería abre el modal flotante: gasto/ingreso
              // contabilizado (cuenta+centro+monto) y pago/cobro (fecha/monto/medio/concepto in-place).
              // Un pago/cobro además ofrece "Ver detalle" → detalle del comprobante que salda (editarDoc).
              const esContab = m.origen === "gasto_directo" || doc.startsWith("CONTAB-");
              const editaModal = m.origen === "manual" || esContab || !!editarDoc;
              // Transferencia interco de núcleo (2 patas): "Editar" abre el módulo Intercompañía con esa
              // transferencia pre-cargada (edita ambas patas). No usa el modal local.
              const editarInterco = m.origen === "intercompania" && doc ? doc : null;
              // Cambio de moneda (2 patas): "Editar" abre el módulo Cambio de moneda pre-cargado.
              const editarCambio  = m.origen === "cambio" && doc ? doc : null;
              // Transferencia propia / pago de tarjeta (2 patas, local): "Editar" abre su modal pre-cargado.
              const editarPar     = (m.tipo === "TRANSFERENCIA" || m.tipo === "PAGO_TARJETA") ? m : null;
              return (
                <tr key={m.id ?? i} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                  background: i % 2 === 0 ? T.card : "#fafbfc" }}>
                  <td style={{ padding:"8px 6px 8px 10px", verticalAlign:"middle" }}>
                    {(onEditar || onEditarDoc || onEliminar) && (
                      <RowMenu
                        onEditar={
                          editarInterco && onEditarInterco ? () => onEditarInterco(editarInterco)
                          : editarCambio && onEditarCambio  ? () => onEditarCambio(editarCambio)
                          : editarPar && onEditarPar        ? () => onEditarPar(editarPar)
                          : editaModal                      ? () => onEditar?.(m)
                          : undefined
                        }
                        onVerDetalle={editarDoc && onEditarDoc ? () => onEditarDoc(editarDoc[0], editarDoc[1]) : undefined}
                        onIgnorar={esSinConciliar(m) ? () => onIgnorar?.(m) : undefined}
                        onEliminar={esSinConciliar(m) ? undefined : () => onEliminar?.(m)}
                      />
                    )}
                  </td>
                  <td style={{ padding:"10px 14px" }}>
                    <span style={{ display:"inline-block", padding:"2px 9px", borderRadius:999,
                      fontSize:11, fontWeight:700, background:cfg.bg, color:cfg.color,
                      whiteSpace:"nowrap" }}>{cfg.label ?? m.tipo}</span>
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:13, color:T.text, whiteSpace:"nowrap" }}>
                    {fmtDate(m.fecha)}
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:T.muted }}>{nombre}</td>
                  <td style={{ padding:"10px 14px", fontSize:13, color:T.text }}>
                    <div style={{ maxWidth:280, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}
                      title={m.concepto || undefined}>{m.concepto ?? "—"}</div>
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:11, color:T.muted }}>
                    {String(m.cuenta_contable || m.cuenta || "").replace(/^CUENTA_/, "") || "—"}
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:11, color:T.muted }}>
                    {m.centro_costo ? (ccMap[m.centro_costo] ?? m.centro_costo) : "—"}
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:11, color:T.dim, fontWeight:600 }}>{m.moneda}</td>
                  <td style={{ padding:"10px 14px", fontSize:13, fontFamily:"var(--mono)", fontWeight:700,
                    color: monto < 0 ? T.red : T.green, textAlign:"right", whiteSpace:"nowrap" }}>
                    {fmtSaldo(monto, m.moneda)}
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:13, fontFamily:"var(--mono)", fontWeight:700,
                    color: (saldoByRow.get(m) ?? 0) < 0 ? T.red : T.text, textAlign:"right", whiteSpace:"nowrap" }}>
                    {fmtSaldo(saldoByRow.get(m) ?? 0, m.moneda)}
                  </td>
                  <td style={{ padding:"10px 14px", fontSize:12, color:T.muted, whiteSpace:"nowrap" }}>{m.registrado_por || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {totalPages > 1 && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"10px 14px", borderTop:`1px solid ${T.cardBorder}` }}>
            <span style={{ fontSize:12, color:T.muted }}>
              Mostrando {desde + 1}–{Math.min(desde + pageSize, ordenado.length)} de {ordenado.length}
            </span>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={pageClamped === 0}
                style={{ fontSize:12, color: pageClamped === 0 ? T.dim : T.text, background:"#f3f4f6",
                  border:`1px solid ${T.cardBorder}`, borderRadius:6, padding:"4px 12px",
                  cursor: pageClamped === 0 ? "not-allowed" : "pointer", fontFamily:T.font }}>← Anterior</button>
              <span style={{ fontSize:12, color:T.muted }}>Página {pageClamped + 1} de {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={pageClamped >= totalPages - 1}
                style={{ fontSize:12, color: pageClamped >= totalPages - 1 ? T.dim : T.text, background:"#f3f4f6",
                  border:`1px solid ${T.cardBorder}`, borderRadius:6, padding:"4px 12px",
                  cursor: pageClamped >= totalPages - 1 ? "not-allowed" : "pointer", fontFamily:T.font }}>Siguiente →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function PantallaTesoreria({ sociedad = "nako", onEditarDoc, onEditarInterco, onEditarCambio, openCuentaId = null, onCuentaOpened }) {
  const datePickerRef = useRef(null);
  const [movimientos,   setMovimientos]   = useState([]);
  const [egresos,       setEgresos]       = useState([]);
  const [ingresos,      setIngresos]      = useState([]);
  const [pagosCobros,   setPagosCobros]   = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [activeTab,        setActiveTab]        = useState("saldos");
  const [filtroMoneda,     setFiltroMoneda]     = useState("ALL");
  const [fechaCorte,       setFechaCorte]       = useState("");   // "Hasta" del rango / "Al día" en Saldos (recorta ledger y saldo al día)
  const [fechaDesde,       setFechaDesde]       = useState("");   // "Desde" del rango — solo afecta el ledger de Movimientos (no el saldo al día)
  const [resetFiltros,     setResetFiltros]     = useState(0);    // señal → TabMovimientos limpia sus filtros internos (búsqueda/importe/orden)
  // "Borrar filtros": limpia los del padre (moneda + período) y avisa al hijo que limpie los suyos.
  const limpiarTodosFiltros = () => { setFiltroMoneda("ALL"); setFechaDesde(""); setFechaCorte(""); setResetFiltros(n => n + 1); };
  const [drillDownItem,    setDrillDownItem]    = useState(null);
  const [showMovModal,     setShowMovModal]     = useState(false);
  const [showNuevoMov,     setShowNuevoMov]     = useState(false);
  const [showPagarTjt,     setShowPagarTjt]     = useState(false);
  const [editTransfer,     setEditTransfer]     = useState(null);  // { salidaId, entradaId, initial }
  const [editTarjeta,      setEditTarjeta]      = useState(null);  // { realId, tarjetaId, initial }
  const [editingMov,       setEditingMov]       = useState(null);
  const [confirmAcc,       setConfirmAcc]       = useState(null);  // { title, message, confirmLabel, danger, run } — confirmación inline
  const [confirmBusy,      setConfirmBusy]      = useState(false);
  const [filtroCuenta,     setFiltroCuenta]     = useState(null);
  const [filtroRef,        setFiltroRef]        = useState(null);   // "ir al movimiento" desde el extracto interco
  const [cuentasBancarias, setCuentasBancarias] = useState([]);
  const [cuentasContables, setCuentasContables] = useState([]);
  const [centrosCosto,     setCentrosCosto]     = useState(CENTROS_COSTO);
  const [liqsSueldos,      setLiqsSueldos]      = useState([]);
  const [financiaciones,   setFinanciaciones]   = useState([]);
  const [socios,           setSocios]           = useState([]);   // maestro de socios (group-level)
  const [sociosCC,         setSociosCC]         = useState([]);   // cuenta corriente de socios no-cash
  const [franqData,        setFranqData]        = useState({ comps: {}, saldos: {}, franchises: [] });  // Franquicias (read-only)
  const [movsFranq,        setMovsFranq]        = useState([]);   // cobros de franquicia group-wide (CxC netea por empresa, no por caja)
  const [intercoData,      setIntercoData]      = useState(null);   // interco (movs+comps+centros+sociedades)
  const [mpLive,           setMpLive]           = useState(null);   // saldo MP en vivo (read-only): {loading, acreditado, a_acreditarse, moneda, proximos, error}

  // ── Fetch all data ────────────────────────────────────────────────────────
  const cargarMovimientos = async () => {
    setLoading(true);
    setError(null);
    try {
      // Liquidaciones vive en el backend de Sueldos → se dispara en paralelo al batch de Numbers.
      const liqsP = fetchLiquidacionesCerradas().catch(() => []);
      // Batch: trae las 7 hojas de Numbers en UNA llamada y precalienta la caché → los fetch de abajo
      // salen de caché (0 red). Best-effort: si falla, cada fetch pega solo (igual que antes).
      await primeCache([
        { resource: "nb_movimientos",       sociedad },
        { resource: "nb_comprobantes",      sociedad },
        { resource: "nb_financiaciones",    sociedad },
        { resource: "nb_cuentas_bancarias" },
        { resource: "nb_cuentas" },
        { resource: "nb_centros_costo" },
        { resource: "nb_socios" },
        { resource: "nb_socios_cc" },
      ]);
      const [movs, egs, ings, pcs, cbList, ctaList, fin, socs, socsCC] = await Promise.all([
        fetchMovTesoreria(sociedad),
        fetchEgresos(sociedad).catch(() => []),
        fetchIngresos(sociedad).catch(() => []),
        fetchPagosCobros(sociedad).catch(() => []),
        fetchCuentasBancarias().catch(() => []),
        fetchCuentas().catch(() => []),
        fetchFinanciaciones(sociedad).catch(() => []),
        fetchSocios().catch(() => []),
        fetchSociosCC().catch(() => []),
      ]);
      const liqsS = await liqsP;
      setMovimientos(Array.isArray(movs) ? movs : []);
      setEgresos(Array.isArray(egs) ? egs : []);
      setIngresos(Array.isArray(ings) ? ings : []);
      setPagosCobros(Array.isArray(pcs) ? pcs : []);
      setCuentasBancarias(Array.isArray(cbList) ? cbList : []);
      setCuentasContables(Array.isArray(ctaList) ? ctaList : []);
      setLiqsSueldos(Array.isArray(liqsS) ? liqsS : []);
      setFinanciaciones(Array.isArray(fin) ? fin : []);
      setSocios(Array.isArray(socs) ? socs : []);
      setSociosCC(Array.isArray(socsCC) ? socsCC : []);
      fetchCentrosCosto().then(data => {
        if (Array.isArray(data) && data.length > 0) setCentrosCosto(data);
      }).catch(() => {});
      // Franquicias (read-only) — fuera del Promise.all para NO bloquear Tesorería si ese backend tarda.
      fetchAll().then(franq => {
        if (franq && franq.comps) setFranqData(franq);
      }).catch(() => {});
      // Cobros de franquicia GROUP-WIDE: la CxC de franquiciados netea por empresa+moneda, sin importar
      // en qué caja (sociedad) entró el cobro → no alcanza con los movimientos de esta sociedad.
      fetchMovFranquicias().then(setMovsFranq).catch(() => {});
      // Intercompañía (read-only) — posiciones para el Activo/Pasivo.
      fetchIntercoData().then(d => { if (d) setIntercoData(d); }).catch(() => {});
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

  // ¿La sociedad activa tiene una cuenta Mercado Pago? Booleano derivado (no el array) para que el fetch MP
  // no se re-dispare en cada recarga de datos (cuentasBancarias cambia de referencia sin cambiar la respuesta).
  const tieneMP = useMemo(
    () => cuentasBancarias.some(c =>
      (c.sociedad ?? "").toLowerCase() === (sociedad ?? "").toLowerCase() && esCuentaMercadoPago(c)),
    [cuentasBancarias, sociedad]);

  // Saldo MP EN VIVO (read-only): solo si la sociedad tiene una cuenta Mercado Pago. Falla suave → el
  // bloque muestra "—" (sin token en local, o error de API) y no rompe el resto de Tesorería.
  useEffect(() => {
    // MP en vivo es una foto de HOY → solo tiene sentido en "Al día de hoy". Con una fecha de corte pasada
    // se esconde (no se puede reconstruir el acreditado/por-acreditarse a una fecha histórica).
    if (!tieneMP || fechaCorte) { setMpLive(null); return; }
    let vivo = true;
    setMpLive({ loading: true });
    fetchSaldoMercadoPago(sociedad)
      .then(d => { if (vivo) setMpLive({ ...d, loading: false }); })
      .catch(e => { if (vivo) setMpLive({ error: e.message, loading: false }); });
    return () => { vivo = false; };
  }, [sociedad, tieneMP, fechaCorte]);

  const sociedadesMap = useMemo(() => sociedadNombreMap(intercoData?.sociedades ?? []), [intercoData]);

  // ── Saldos + Activo/Pasivo (derivación compartida con Reportes › Consolidado) ──
  const { cuentas, aCobrar: aCobrarFull, aPagar: aPagarFull, interco: intercoItems } = useMemo(
    () => derivarSaldos({
      sociedad, fechaCorte,
      movimientos, egresos, ingresos, pagosCobros,
      cuentasBancarias, cuentasContables,
      liqsSueldos, financiaciones, socios, sociosCC, franqData, movsFranq,
      intercoData, sociedadesMap,
    }),
    [sociedad, fechaCorte, movimientos, egresos, ingresos, pagosCobros,
      cuentasBancarias, cuentasContables, liqsSueldos, financiaciones, socios, sociosCC, franqData, movsFranq,
      intercoData, sociedadesMap]
  );

  // El rango de fechas recorta el ledger de Movimientos. La cota superior (fechaCorte) es además el
  // "Al día" que usa derivarSaldos para el saldo al día (mismo criterio: (m.fecha ?? "") <= corte).
  // La cota inferior (fechaDesde) es solo para el ledger de Movimientos → NO afecta el saldo al día.
  const movsHastaFecha = useMemo(
    () => (fechaCorte || fechaDesde)
      ? movimientos.filter(m => {
          const f = m.fecha ?? "";
          if (fechaDesde && f < fechaDesde) return false;
          if (fechaCorte && f > fechaCorte) return false;
          return true;
        })
      : movimientos,
    [movimientos, fechaCorte, fechaDesde]
  );

  const monedas = useMemo(() => [...new Set(cuentas.map(c => c.moneda))], [cuentas]);
  const subtitle = `${cuentas.length} cuenta${cuentas.length !== 1 ? "s" : ""}`
    + (monedas.length ? ` · ${monedas.join(", ")}` : "");

  // ── Guardar movimiento entre cuentas ──────────────────────────────────────
  const handleGuardarMovimiento = async (form) => {
    try {
      const nombreCta = id => cuentasBancarias.find(c => c.id === id)?.nombre ?? id;
      await appendTransferencia({
        sociedad, fecha: form.fecha, moneda: form.moneda, monto: form.monto,
        cuentaSalida: form.cuentaSalida, cuentaEntrada: form.cuentaEntrada,
        conceptoSalida:  `Trf Cta Propia → ${nombreCta(form.cuentaEntrada)}`,
        conceptoEntrada: `Trf Cta Propia ← ${nombreCta(form.cuentaSalida)}`,
      });
      await cargarMovimientos();
    } catch (e) {
      alert("Error al guardar: " + e.message);
    }
  };

  const handlePagarTarjeta = async (form) => {
    try {
      await pagarTarjeta({
        sociedad, fecha: form.fecha, monto: form.monto, moneda: form.moneda || "ARS",
        cuenta_real: form.cuentaReal, tarjeta_id: form.tarjeta,
      });
      await cargarMovimientos();
    } catch (e) {
      alert("Error al pagar tarjeta: " + (e?.message || e));
    }
  };

  // ── Editar un PAR local (transferencia propia / pago de tarjeta): abre el mismo modal con el que
  //    se creó, pre-cargado; al guardar, actualiza las 2 patas en su lugar. ──────────────────────
  const abrirEditarPar = (m) => {
    const patas = patasDelPar(m, movimientos);   // por documento_id O stem del id (tolera par roto)
    if (m.tipo === "TRANSFERENCIA") {
      const salida = patas.find(p => Number(p.monto) < 0), entrada = patas.find(p => Number(p.monto) > 0);
      if (!salida || !entrada) return;
      setEditTransfer({ salidaId: salida.id, entradaId: entrada.id, initial: {
        fecha: salida.fecha, monto: String(Math.abs(Number(salida.monto) || 0)), moneda: salida.moneda || "ARS",
        cuentaSalida: salida.cuenta_bancaria || "", cuentaEntrada: entrada.cuenta_bancaria || "", observacion: "" } });
    } else if (m.tipo === "PAGO_TARJETA") {
      const real = patas.find(p => Number(p.monto) < 0), tjt = patas.find(p => Number(p.monto) > 0);
      if (!real || !tjt) return;
      setEditTarjeta({ realId: real.id, tarjetaId: tjt.id, initial: {
        fecha: real.fecha, tarjeta: tjt.cuenta_bancaria || "", cuentaReal: real.cuenta_bancaria || "",
        monto: String(Math.abs(Number(real.monto) || 0)) } });
    }
  };

  const handleEditTransfer = async (form) => {
    if (!editTransfer) return;
    try {
      const nombreCta = id => cuentasBancarias.find(c => c.id === id)?.nombre ?? id;
      await updateTransferencia({
        salidaId: editTransfer.salidaId, entradaId: editTransfer.entradaId,
        fecha: form.fecha, moneda: form.moneda, monto: form.monto,
        cuentaSalida: form.cuentaSalida, cuentaEntrada: form.cuentaEntrada,
        conceptoSalida:  `Trf Cta Propia → ${nombreCta(form.cuentaEntrada)}`,
        conceptoEntrada: `Trf Cta Propia ← ${nombreCta(form.cuentaSalida)}`,
      });
      setEditTransfer(null);
      await cargarMovimientos();
    } catch (e) { alert("Error al guardar: " + e.message); }
  };

  const handleEditTarjeta = async (form) => {
    if (!editTarjeta) return;
    try {
      await updatePagoTarjeta({
        realId: editTarjeta.realId, tarjetaId: editTarjeta.tarjetaId,
        fecha: form.fecha, monto: form.monto, moneda: form.moneda || "ARS",
        cuenta_real: form.cuentaReal, tarjeta_cuenta: form.tarjeta,
      });
      setEditTarjeta(null);
      await cargarMovimientos();
    } catch (e) { alert("Error al guardar: " + (e?.message || e)); }
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
  // Confirmación inline (ConfirmModal) en vez de window.confirm, que Chrome puede bloquear en silencio
  // (deja el borrado sin efecto). Se arma un { title, message, confirmLabel, danger, run } y se ejecuta
  // desde el modal (doConfirmAcc). Igual criterio que en Egresos/Ingresos.
  const handleEliminarMov = (mov) => {
    // Movimiento que creó otro módulo y solo ese módulo deshace (ej. el neteo de una compra financiada en
    // plan): se informa con el mismo modal (window.alert lo puede bloquear Chrome) y no se borra.
    const motivo = motivoNoBorrable(mov);
    if (motivo) {
      setConfirmAcc({ title: "Este movimiento no se borra desde acá", message: `"${mov.concepto ?? mov.id}": ${motivo}`, confirmLabel: "Entendido", danger: false, run: async () => {} });
      return;
    }
    // Un PAGO/COBRO que vino del motor de conciliación (origen="extracto") ES la línea del banco: no se
    // borra (destruiría el movimiento real y su nro. de operación) → se desimputa y vuelve a la
    // conciliación, dejando la factura "a pagar/cobrar".
    if ((mov.tipo === "PAGO" || mov.tipo === "COBRO") && mov.origen === "extracto") {
      const kind = mov.tipo === "COBRO" ? "cobro" : "pago";
      setConfirmAcc({
        title: `¿Quitar este ${kind} de la factura?`,
        message: `Este ${kind} vino del extracto bancario. No se borra el movimiento del banco: se despega de la factura y vuelve a la conciliación.`,
        confirmLabel: "Sí, quitar",
        run: async () => { await borrarPagoImputado(mov); await cargarMovimientos(); },
      });
      return;
    }
    // Pata de caja de una interco. Declarada a mano (IRCV-/ISND-): se deshace ENTERA → esta fila, su costo de
    // transferencia y el desatado de la pata parkeada de la contraparte, que vuelve a pendientes de Interco para
    // redeclararla. Si nació del extracto es la línea del banco: no se borra desde acá.
    if (esIntercoCaja(mov)) {
      if (!esIntercoDeclaradaManual(mov)) {
        setConfirmAcc({ title: "Este movimiento no se borra desde acá", message: `"${mov.concepto ?? mov.id}" es la línea del banco aceptada como interco. Se deshace desde Conciliación, no desde Tesorería.`, confirmLabel: "Entendido", danger: false, run: async () => {} });
        return;
      }
      piezasIntercoDeclarada(mov).then(pz => {
        const quien = mov.contraparte_nombre || mov.contraparte_id || "la contraparte";
        const lineas = [
          `Es la pata de caja de una interco con ${quien} (${fmtSaldo(Number(mov.monto) || 0, mov.moneda)}, ${fmtDate(mov.fecha)}).`,
          `Se borra este movimiento${pz.costo ? ` y su costo de transferencia (${fmtSaldo(Number(pz.costo.monto) || 0, pz.costo.moneda)})` : ""}.`,
          pz.pata
            ? `La pata de ${quien} (${fmtSaldo(Number(pz.pata.monto) || 0, pz.pata.moneda)}, ${fmtDate(pz.pata.fecha)}) se desata y vuelve a Conciliaciones › Interco como pendiente, para declararla de nuevo.`
            : "No se encontró una pata parkeada atada a este movimiento: no queda nada pendiente del otro lado.",
        ];
        setConfirmAcc({
          title: "¿Eliminar esta interco?",
          message: lineas.join("\n"),
          confirmLabel: "Sí, eliminar",
          run: async () => { await deshacerIntercoDeclarada(mov, pz); await cargarMovimientos(); },
        });
      }).catch(e => setConfirmAcc({ title: "No se pudo leer la interco", message: String(e?.message || e), confirmLabel: "Entendido", danger: false, run: async () => {} }));
      return;
    }
    // Transferencia/interco/cambio = PAR de patas con el mismo documento_id. Hay que borrar AMBAS,
    // o la contrapartida queda huérfana y sigue sumando al saldo (la transferencia se "duplica").
    // Solo se juntan las patas cargadas en la sociedad activa (interco cross-sociedad borra su lado).
    const PAREADO = ["TRANSFERENCIA", "INTERCOMPANIA", "CAMBIO", "PAGO_TARJETA"];
    const patas = PAREADO.includes(mov.tipo)
      ? patasDelPar(mov, movimientos)   // por documento_id O stem del id (tolera par roto)
      : [mov];
    const extra = patas.length > 1 ? ` y su contrapartida (${patas.length} movimientos)` : "";
    setConfirmAcc({
      title: "¿Eliminar movimiento?",
      message: `"${mov.concepto ?? mov.id}"${extra}.`,
      confirmLabel: "Sí, eliminar",
      run: async () => {
        // En SERIE: el GAS borra por índice de fila y sin lock → dos `del` en paralelo pueden borrar la fila equivocada
        // (ver deshacerIntercoDeclarada en numbersApi).
        for (const m of patas) await deleteMovTesoreria(m.id);
        const ids = new Set(patas.map(m => m.id));
        setMovimientos(prev => prev.filter(m => !ids.has(m.id)));
      },
    });
  };

  // ── Ignorar una línea de extracto (no contabilizar) ───────────────────────
  // Solo para líneas crudas del banco todavía sin conciliar: NO se borran (se recrean al re-subir)
  // → soft-mark documento_id="IGN-", sale del ledger pero sobrevive el dedup. Reversible en Conciliación.
  const handleIgnorarMov = (mov) => {
    setConfirmAcc({
      title: "¿Ignorar esta línea?",
      message: `"${mov.concepto ?? mov.id}" (${fmtSaldo(Number(mov.monto) || 0, mov.moneda)}).\nSale del listado pero no se borra; podés restaurarla desde Conciliación.`,
      confirmLabel: "Sí, ignorar",
      danger: false,
      run: async () => {
        await ignorarMovimiento(mov);
        setMovimientos(prev => prev.map(m => m.id === mov.id ? { ...m, documento_id: "IGN-" + mov.id } : m));
      },
    });
  };

  // Ejecuta la acción del ConfirmModal (eliminar / desimputar / ignorar). Un solo lugar con busy + error.
  const doConfirmAcc = async () => {
    if (!confirmAcc?.run) return;
    setConfirmBusy(true);
    try { await confirmAcc.run(); setConfirmAcc(null); }
    catch (e) { alert("Error: " + (e?.message || e)); }
    finally { setConfirmBusy(false); }
  };

  // ── Al clickear una cuenta en Saldos → ir a Movimientos filtrado ──────────
  const handleCuentaClick = (cuenta) => {
    setFiltroCuenta(cuenta.id);
    setActiveTab("movimientos");
  };

  // ── Deep-link desde el detalle de un comprobante (medio de pago) → filtrar esa caja ──
  useEffect(() => {
    if (!openCuentaId) return;
    setFiltroCuenta(openCuentaId);
    setActiveTab("movimientos");
    onCuentaOpened?.();
  }, [openCuentaId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drill-down como página completa ──────────────────────────────────────
  if (drillDownItem) {
    // Interco → extracto con saldo corriente (como una cuenta). El resto → aging por contraparte.
    if (drillDownItem.intercoLedger && intercoData) {
      const ledger = intercoLedger(intercoData, {
        sociedad: drillDownItem.sociedadId ?? sociedad,
        contraparte: drillDownItem.contraparteId,
        moneda: drillDownItem.moneda,
      });
      return <PaginaIntercoLedger item={drillDownItem} ledger={ledger} onBack={() => setDrillDownItem(null)}
        onGoToMov={e => { setDrillDownItem(null); setFiltroCuenta(null); setFiltroRef(e?.ref || null); setActiveTab("movimientos"); }} />;
    }
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
    { id: "movimientos", label: `Movimientos${movsHastaFecha.length ? ` (${movsHastaFecha.length})` : ""}` },
  ];

  return (
    <div style={{ padding: "28px 32px" }} className="fade tesoreria-screen">
      <style>{`
        .tesoreria-screen button:focus-visible {
          outline: 2px solid ${T.accent};
          outline-offset: 2px;
        }
      `}</style>

      {/* Header: título + pestañas a la misma altura, acciones a la derecha */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: T.text, margin: 0, letterSpacing: "-.02em" }}>Tesorería</h1>
          <div role="tablist" aria-label="Vista de tesorería"
            style={{ display: "inline-flex", gap: 2, background: "#f3f4f6", borderRadius: 10, padding: 3 }}>
            {TESORERIA_TABS.map(tab => {
              const active = activeTab === tab.id;
              return (
                <button key={tab.id} type="button" role="tab" aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    background: active ? T.accentDark : "transparent",
                    border: "none", borderRadius: 8,
                    color: active ? T.accent : T.muted,
                    fontFamily: T.font, fontSize: 13,
                    fontWeight: active ? 800 : 500,
                    padding: "7px 18px", cursor: "pointer",
                    transition: "all .15s ease", outline: "none",
                    boxShadow: active ? T.shadow : "none",
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#e5e7eb"; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" onClick={() => setShowNuevoMov(true)} style={{ ...tesoreriaActionBtn.base, ...tesoreriaActionBtn.gasto }}>
            + Gasto directo
          </button>
          <button type="button" onClick={() => setShowMovModal(true)} style={{ ...tesoreriaActionBtn.base, ...tesoreriaActionBtn.transfer }}>
            + Movimiento entre cuentas
          </button>
          {cuentas.some(esCuentaCredito) && (
            <button type="button" onClick={() => setShowPagarTjt(true)} style={{ ...tesoreriaActionBtn.base, background:"#dc2626", color:"#fff", border:"none" }}>
              💳 Pagar tarjeta
            </button>
          )}
        </div>
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
                background: on ? T.accentDark : "#eceff3",
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

        {activeTab === "movimientos" ? (
          // En Movimientos: rango Desde/Hasta (Hasta = fechaCorte, comparte el "al día"; Desde solo recorta el ledger).
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase",
              letterSpacing: ".08em" }}>Período</span>
            <input type="date" value={fechaDesde} max={fechaCorte || undefined} onChange={e => setFechaDesde(e.target.value)}
              style={{ border: `1px solid ${T.cardBorder}`, borderRadius: 8, padding: "5px 10px",
                fontSize: 12, fontFamily: T.font, background: "#eceff3", color: T.text }} />
            <span style={{ fontSize: 11, color: T.muted }}>a</span>
            <input type="date" value={fechaCorte} min={fechaDesde || undefined} onChange={e => setFechaCorte(e.target.value)}
              style={{ border: `1px solid ${T.cardBorder}`, borderRadius: 8, padding: "5px 10px",
                fontSize: 12, fontFamily: T.font, background: "#eceff3", color: T.text }} />
            {(fechaDesde || fechaCorte) && (
              <button type="button" onClick={() => { setFechaDesde(""); setFechaCorte(""); }} title="Quitar rango"
                style={{ background: "transparent", border: "none", color: T.muted,
                  fontSize: 16, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
            )}
          </div>
        ) : (
          // En Saldos: fecha única "Al día" (saldo a esa fecha) — sin cambios.
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase",
              letterSpacing: ".08em" }}>Al día</span>
            <button type="button" onClick={() => { datePickerRef.current?.showPicker?.(); datePickerRef.current?.click(); }}
              style={{
                border: `1px solid ${T.cardBorder}`, borderRadius: 8, padding: "6px 12px",
                fontSize: 12, fontFamily: T.font, background: "#eceff3",
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
        )}

        {/* Borrar filtros: limpia todo (moneda, período y, en Movimientos, búsqueda/importe/orden de la tabla) */}
        <button type="button" onClick={limpiarTodosFiltros} title="Quitar todos los filtros"
          style={{ marginLeft: "auto", border: `1px solid ${T.cardBorder}`, borderRadius: 8, padding: "6px 14px",
            fontSize: 12, fontWeight: 700, fontFamily: T.font, background: "#f3f4f6", color: T.muted,
            cursor: "pointer", whiteSpace: "nowrap" }}>✕ Borrar filtros</button>
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
              aCobrar={aCobrarFull}
              aPagar={aPagarFull}
              interco={intercoItems}
              filtroMoneda={filtroMoneda}
              mpLive={mpLive}
              onCuentaClick={handleCuentaClick}
              onItemClick={setDrillDownItem}
            />
          )}
          {activeTab === "movimientos" && (
            <TabMovimientos
              movimientos={movsHastaFecha}
              cuentas={cuentas}
              filtroCuenta={filtroCuenta}
              filtroRef={filtroRef}
              onLimpiarFiltro={() => { setFiltroCuenta(null); setFiltroRef(null); }}
              onEliminar={handleEliminarMov}
              onEditar={m => setEditingMov(m)}
              onEditarDoc={onEditarDoc}
              onEditarInterco={onEditarInterco}
              onEditarCambio={onEditarCambio}
              onEditarPar={abrirEditarPar}
              onIgnorar={handleIgnorarMov}
              onNuevoMov={() => setShowNuevoMov(true)}
            centrosCosto={centrosCosto}
            resetSignal={resetFiltros}
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
      {showPagarTjt && (
        <PagarTarjetaModal
          sociedad={sociedad}
          cuentas={cuentas}
          onClose={() => setShowPagarTjt(false)}
          onSave={handlePagarTarjeta}
        />
      )}
      {editTransfer && (
        <MovimientoModal
          sociedad={sociedad}
          cuentasBancarias={cuentasBancarias}
          initial={editTransfer.initial}
          editMode
          onClose={() => setEditTransfer(null)}
          onSave={handleEditTransfer}
        />
      )}
      {editTarjeta && (
        <PagarTarjetaModal
          sociedad={sociedad}
          cuentas={cuentas}
          initial={editTarjeta.initial}
          editMode
          onClose={() => setEditTarjeta(null)}
          onSave={handleEditTarjeta}
        />
      )}
      {editingMov && (
        <EditarMovModal
          mov={editingMov}
          cuentasBancarias={cuentasBancarias}
          cuentasContables={cuentasContables}
          centrosCosto={centrosCosto}
          onClose={() => setEditingMov(null)}
          onSave={handleEditarMovManual}
        />
      )}
      <ConfirmModal open={!!confirmAcc} title={confirmAcc?.title} message={confirmAcc?.message}
        confirmLabel={confirmAcc?.confirmLabel ?? "Sí"} danger={confirmAcc?.danger ?? true}
        busy={confirmBusy} onConfirm={doConfirmAcc} onCancel={() => setConfirmAcc(null)} />
    </div>
  );
}
