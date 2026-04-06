import { useState, useCallback } from "react";
import { Modal } from "./atoms";
import { useStore } from "../lib/context";
import { CURRENCIES, DOCS, CUENTAS, CUENTA_LABEL, MOV_TYPES, TIPOS_MOVIMIENTO, SYM, fmt, uid, makeType, COMPANIES } from "../lib/helpers";
import { getCompanyCurrencies } from "../data/franchisor";

// ─── ADD COMP MODAL ───────────────────────────────────────────────────────────
const TAX = 0.21;

const isoToDmy = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

export default function AddCompModal({ franchise, month, year, onClose, onAdd }) {
  const { activeCompany, franchisor } = useStore();
  const allowedCurrencies = getCompanyCurrencies(activeCompany, franchisor);
  const [doc,      setDoc]      = useState("FACTURA");
  const [cuenta,   setCuenta]   = useState("FEE");
  const [mode,     setMode]     = useState("comprobante"); // "comprobante"|"fc_recibida"|"movimiento"
  const [movType,  setMovType]  = useState("PAGO");
  const [currency, setCurrency] = useState(() => {
    const def = COMPANIES[activeCompany]?.currency ?? franchise.currency ?? "ARS";
    return allowedCurrencies.includes(def) ? def : (allowedCurrencies[0] ?? "ARS");
  });
  const [date,     setDate]     = useState(`${year}-${String(month + 1).padStart(2, "0")}-28`);
  const [amount,   setAmount]   = useState("");
  const [ref,      setRef]      = useState("");
  const [nota,     setNota]     = useState("");

  const isMov      = mode === "movimiento";
  const isFcRec    = mode === "fc_recibida";
  const type       = isMov ? movType : isFcRec ? makeType("FC_RECIBIDA", cuenta) : makeType(doc, cuenta);
  const showIVA    = (mode === "comprobante" || mode === "fc_recibida") && (COMPANIES[activeCompany]?.applyIVA ?? franchise.applyIVA);
  const amountNum  = parseFloat(String(amount).replace(",", ".")) || 0;
  const totalFinal = showIVA ? amountNum * (1 + TAX) : amountNum;
  const sym        = SYM[currency] ?? currency;

  const inputS = { padding: "9px 12px", fontSize: 14, borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)", fontFamily: "var(--font)", width: "100%", boxSizing: "border-box" };
  const labelS = { fontSize: 10, fontWeight: 700, color: "var(--muted)", letterSpacing: ".08em", display: "block", marginBottom: 6 };

  const handleAdd = useCallback(() => {
    onAdd({ id: uid(), type, date: isoToDmy(date), amount: totalFinal, amountNeto: amountNum, ref, nota, month, year, currency, empresa: activeCompany });
    onClose();
  }, [type, date, totalFinal, amountNum, ref, nota, month, year, currency, activeCompany, onAdd, onClose]);

  const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  return (
    <Modal title={`Nuevo comprobante — ${franchise.name}`} subtitle={`${MONTH_NAMES[month]} ${year}`} onClose={onClose} width={540}>

      {/* ── Comprobante / FC Recibida / Movimiento toggle ── */}
      <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1.5px solid var(--border2)", marginBottom: 18 }}>
        {[
          ["🧾 Comprobante",  "comprobante",  "var(--red)"],
          ["📥 FC Recibida",  "fc_recibida",  "var(--blue)"],
          ["💸 Movimiento",   "movimiento",   "var(--green)"],
        ].map(([lbl, v, clr], i) => (
          <div key={v} onClick={() => setMode(v)} style={{
            flex: 1, padding: "9px 12px", cursor: "pointer", fontWeight: 800, fontSize: 12, textAlign: "center",
            background: mode === v ? `color-mix(in srgb, ${clr} 14%, transparent)` : "transparent",
            color: mode === v ? clr : "var(--muted)",
            borderRight: i < 2 ? "1px solid var(--border2)" : "none",
            transition: "all .12s",
          }}>{lbl}</div>
        ))}
      </div>

      {/* ── Fila principal: 2 columnas ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 14, marginBottom: 16, alignItems: "start" }}>

        {/* Columna izquierda: Fecha + Cuenta/TipoMov */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelS}>FECHA</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ ...inputS, cursor: "pointer", colorScheme: "dark", fontWeight: 700 }} />
          </div>
          {isMov ? (
            <div>
              <label style={labelS}>TIPO DE MOVIMIENTO</label>
              <select value={movType} onChange={e => setMovType(e.target.value)} style={{ ...inputS, fontWeight: 700, fontSize: 13 }}>
                {TIPOS_MOVIMIENTO.map(t => <option key={t} value={t}>{MOV_TYPES[t].label}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label style={labelS}>CUENTA</label>
              <select value={cuenta} onChange={e => setCuenta(e.target.value)} style={{ ...inputS, fontWeight: 700, fontSize: 13 }}>
                {CUENTAS.map(c => <option key={c} value={c}>{CUENTA_LABEL[c]}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Columna derecha: Tipo doc (solo comprobante) + Moneda + Importe */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {mode === "comprobante" && (
            <div>
              <label style={labelS}>TIPO DE DOCUMENTO</label>
              <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1.5px solid var(--border2)" }}>
                {DOCS.map((d, i) => (
                  <div key={d} onClick={() => setDoc(d)} style={{
                    flex: 1, padding: "9px 12px", cursor: "pointer", fontWeight: 800, fontSize: 13, textAlign: "center",
                    background: doc === d ? (d === "FACTURA" ? "rgba(255,85,112,.18)" : "rgba(16,217,122,.18)") : "transparent",
                    color: doc === d ? (d === "FACTURA" ? "var(--red)" : "var(--green)") : "var(--muted)",
                    borderRight: i < DOCS.length - 1 ? "1px solid var(--border2)" : "none",
                    transition: "all .12s",
                  }}>
                    {d === "FACTURA" ? "🧾 Factura" : "📋 NC"}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "start" }}>
            <div>
              <label style={labelS}>MONEDA</label>
              <div style={{ display: "flex", gap: 6 }}>
                {CURRENCIES.map(cur => {
                  const allowed = allowedCurrencies.includes(cur);
                  return (
                    <button key={cur} onClick={() => allowed && setCurrency(cur)} style={{
                      padding: "8px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                      cursor: allowed ? "pointer" : "not-allowed", border: "none", fontFamily: "var(--font)",
                      background: currency === cur ? "var(--accent)" : "var(--bg)",
                      color: currency === cur ? "#1e2022" : allowed ? "var(--muted)" : "var(--dim)",
                      outline: currency === cur ? "none" : "1px solid var(--border2)",
                      opacity: allowed ? 1 : 0.3,
                    }} title={allowed ? cur : `${cur} no habilitado para ${activeCompany}`}>{cur}</button>
                  );
                })}
              </div>
            </div>
            <div>
              <label style={labelS}>{showIVA ? "NETO (SIN IVA)" : "IMPORTE"}</label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: 13, pointerEvents: "none" }}>{sym}</span>
                <input type="number" min="0" step="0.01" value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0,00" inputMode="decimal"
                  style={{ ...inputS, paddingLeft: 28, textAlign: "right", fontWeight: 700 }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── IVA breakdown ── */}
      {showIVA && amountNum > 0 && (
        <div style={{ display: "flex", gap: 0, border: "1px solid var(--border2)", borderRadius: 8, overflow: "hidden", marginBottom: 16 }}>
          {[["NETO", amountNum, "var(--text)"], ["IVA 21%", amountNum * TAX, "var(--blue)"], ["TOTAL", totalFinal, "var(--accent)"]].map(([l, v, c], i) => (
            <div key={l} style={{
              flex: 1, padding: "8px 14px", textAlign: "center",
              borderRight: i < 2 ? "1px solid var(--border2)" : "none",
              background: i === 2 ? "rgba(173,255,25,.05)" : "transparent",
            }}>
              <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700, letterSpacing: ".06em", marginBottom: 4 }}>{l}</div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: c }}>{sym} {fmt(v, currency)}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Alertas por tipo ── */}
      {type === "PAGO_PAUTA"   && <div style={{ background: "rgba(34,211,238,.05)", border: "1px solid rgba(34,211,238,.15)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "var(--cyan)" }}>Cobro anticipado — queda pendiente hasta emitir la factura de pauta.</div>}
      {type === "PAGO_ENVIADO" && <div style={{ background: "rgba(255,85,112,.05)", border: "1px solid rgba(255,85,112,.15)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "var(--red)" }}>BIGG transfiere fondos al franquiciado. Aumenta la deuda de BIGG.</div>}

      {/* ── Referencia + Descripción ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
        <div>
          <label style={labelS}>REFERENCIA / NRO. COMPROBANTE</label>
          <input type="text" placeholder="Ej: FC-A 0001-00004521 / CAE..." value={ref} onChange={e => setRef(e.target.value)} style={inputS} />
        </div>
        <div>
          <label style={labelS}>DESCRIPCIÓN</label>
          <input type="text" placeholder="Ej: Fee enero, Fotos en local, Interusos..." value={nota} onChange={e => setNota(e.target.value)} style={inputS} />
        </div>
      </div>

      {/* ── Acciones ── */}
      <div style={{ display: "flex", gap: 10 }}>
        <button className="ghost" style={{ flex: 1, height: 44 }} onClick={onClose}>Cancelar</button>
        <button className="btn" style={{ flex: 3, height: 44, fontSize: 14 }} disabled={amountNum <= 0} onClick={handleAdd}>✓ Registrar</button>
      </div>
    </Modal>
  );
}
