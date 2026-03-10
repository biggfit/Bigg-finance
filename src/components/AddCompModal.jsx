import { useState, useCallback } from "react";
import { Field, Modal } from "./atoms";
import { CURRENCIES, DOCS, CUENTAS, CUENTA_LABEL, MOV_TYPES, TIPOS_MOVIMIENTO, SYM, fmt, uid, makeType } from "../lib/helpers";

// ─── ADD COMP MODAL ───────────────────────────────────────────────────────────
const TAX = 0.21;

export default function AddCompModal({ franchise, month, year, onClose, onAdd }) {
  const [doc,      setDoc]      = useState("FACTURA");
  const [cuenta,   setCuenta]   = useState("FEE");
  const [isMov,    setIsMov]    = useState(false);
  const [movType,  setMovType]  = useState("PAGO");
  const [currency, setCurrency] = useState(franchise.currency);
  const [date,     setDate]     = useState(`${year}-${String(month + 1).padStart(2, "0")}-28`);
  const [amount,   setAmount]   = useState(0);
  const [ref,      setRef]      = useState("");
  const [nota,     setNota]     = useState("");

  // Al cambiar entre Comprobante/Movimiento, resetear moneda al default de la franquicia
  const handleSetIsMov = (v) => { setIsMov(v); setCurrency(franchise.currency); };

  const type         = isMov ? movType : makeType(doc, cuenta);
  // FACTURA/NC siempre en moneda de la franquicia; pagos pueden ser en cualquier moneda
  const effectiveCur = isMov ? currency : franchise.currency;
  const showIVA      = !isMov && franchise.applyIVA;
  const totalConIVA  = showIVA ? amount * (1 + TAX) : amount;

  const handleAdd = useCallback(() => {
    onAdd({ id: uid(), type, date, amount: totalConIVA, amountNeto: amount, ref, nota, month, year, currency: effectiveCur });
    onClose();
  }, [type, date, totalConIVA, amount, ref, nota, month, year, effectiveCur, onAdd, onClose]);

  return (
    <Modal title={`Nuevo comprobante — ${franchise.name}`} subtitle={`${franchise.months ?? ""}${month !== undefined ? ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"][month] : ""} ${year}`} onClose={onClose} width={520}>
      {/* Comprobante vs Movimiento */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        {[["🧾 Comprobante", false],["💸 Movimiento", true]].map(([lbl, v]) => (
          <div key={String(v)} onClick={() => handleSetIsMov(v)} style={{
            padding: "8px 10px", borderRadius: 8, cursor: "pointer", textAlign: "center",
            background: isMov === v ? "rgba(173,255,25,.1)" : "var(--bg)",
            border: `1.5px solid ${isMov === v ? "var(--accent)" : "var(--border)"}`,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: isMov === v ? "var(--accent)" : "var(--muted)" }}>{lbl}</span>
          </div>
        ))}
      </div>
      {!isMov ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          <Field label="Documento">
            <select value={doc} onChange={e => setDoc(e.target.value)} style={{ width: "100%", padding: "8px 10px" }}>
              {DOCS.map(d => <option key={d} value={d}>{d === "FACTURA" ? "Factura" : "NC"}</option>)}
            </select>
          </Field>
          <Field label="Cuenta">
            <select value={cuenta} onChange={e => setCuenta(e.target.value)} style={{ width: "100%", padding: "8px 10px" }}>
              {CUENTAS.map(c => <option key={c} value={c}>{CUENTA_LABEL[c]}</option>)}
            </select>
          </Field>
        </div>
      ) : (
        <Field label="Tipo de movimiento">
          <select value={movType} onChange={e => setMovType(e.target.value)} style={{ width: "100%", padding: "8px 10px" }}>
            {TIPOS_MOVIMIENTO.map(t => <option key={t} value={t}>{MOV_TYPES[t].label}</option>)}
          </select>
        </Field>
      )}
      <Field label="Fecha">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: "100%", padding: "8px 10px" }} />
      </Field>
      {/* Selector de moneda — solo para movimientos (pagos). Comprobantes siempre en moneda de la franquicia */}
      {isMov && (
        <Field label="Moneda del pago">
          <div style={{ display: "flex", gap: 6 }}>
            {CURRENCIES.map(cur => (
              <button key={cur} onClick={() => setCurrency(cur)} style={{
                padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "none", fontFamily: "var(--font)",
                background: currency === cur ? "var(--accent)" : "var(--bg)",
                color: currency === cur ? "#1e2022" : "var(--muted)",
                outline: currency === cur ? "none" : "1px solid var(--border2)",
              }}>{cur}</button>
            ))}
          </div>
          {currency !== franchise.currency && (
            <div style={{ fontSize: 10, color: "var(--cyan)", marginTop: 4 }}>
              Moneda distinta a la de facturación ({franchise.currency}). El saldo de la franquicia no se verá afectado hasta asignar tipo de cambio.
            </div>
          )}
        </Field>
      )}
      <Field label={`Monto neto (${effectiveCur})`}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>{SYM[effectiveCur]}</span>
          <input type="number" min="0" value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} style={{ width: 200, padding: "8px 10px" }} />
        </div>
      </Field>
      {showIVA && amount > 0 && (
        <div style={{ background: "rgba(251,191,36,.05)", border: "1px solid rgba(251,191,36,.15)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12 }}>
          <div style={{ color: "var(--gold)", fontWeight: 700, marginBottom: 4 }}>IVA 21% — Argentina</div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}><span>Neto</span><span className="mono">{fmt(amount, effectiveCur)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}><span>IVA</span><span className="mono">{fmt(amount * TAX, effectiveCur)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginTop: 4 }}><span>Total</span><span className="mono" style={{ color: "var(--accent)" }}>{fmt(totalConIVA, effectiveCur)}</span></div>
        </div>
      )}
      {type === "PAGO_PAUTA"   && <div style={{ background: "rgba(34,211,238,.05)", border: "1px solid rgba(34,211,238,.15)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "var(--cyan)" }}>Cobro anticipado — queda pendiente hasta emitir la factura de pauta.</div>}
      {type === "PAGO_ENVIADO" && <div style={{ background: "rgba(255,85,112,.05)", border: "1px solid rgba(255,85,112,.15)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "var(--red)" }}>BIGG transfiere fondos al franquiciado. Aumenta la deuda de BIGG.</div>}
      <Field label="Referencia / Nro. comprobante">
        <input type="text" placeholder="Ej: FC-A 0001-00004521 / CAE..." value={ref} onChange={e => setRef(e.target.value)} style={{ width: "100%", padding: "8px 10px" }} />
      </Field>
      <Field label="Descripción">
        <input type="text" placeholder="Ej: Fee enero, Fotos en local, Interusos..." value={nota} onChange={e => setNota(e.target.value)} style={{ width: "100%", padding: "8px 10px" }} />
      </Field>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
        <button className="ghost" onClick={onClose}>Cancelar</button>
        <button className="btn" disabled={amount <= 0} onClick={handleAdd}>Registrar</button>
      </div>
    </Modal>
  );
}
