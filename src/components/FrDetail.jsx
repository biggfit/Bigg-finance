import { useState, useMemo, useCallback } from "react";
import { useStore } from "../lib/context";
import { computeSaldo, computeSaldoPrevMes, computePautaPendiente, COMP_TYPES, fmt, fmtS } from "../lib/helpers";
import { dmyToIso, isoToDmy, inPeriod, cmpDate } from "../data/franchisor";
import { Modal, TypePill } from "./atoms";
import AddCompModal from "./AddCompModal";
import CCModal from "./CCModal";

// ─── FRANCHISE DETAIL MODAL ───────────────────────────────────────────────────
export default function FrDetail({ franchise, month, year, onClose, onAddComp, onDelComp, onEditComp }) {
  const { comps, saldoInicial, franchises } = useStore();
  const [adding,    setAdding]    = useState(false);
  const [showCC,    setShowCC]    = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editBuf,   setEditBuf]   = useState({});

  const key = String(franchise.id);
  const frComps = useMemo(() => (comps[key] ?? []).filter(c => inPeriod(c, month, year)).sort((a, b) => cmpDate(a.date, b.date)), [comps, key, month, year]);
  const sp = useMemo(() => computeSaldoPrevMes(franchise.id, year, month, comps, saldoInicial), [franchise.id, year, month, comps, saldoInicial]);
  const sa = useMemo(() => computeSaldo(franchise.id, year, month, comps, saldoInicial), [franchise.id, year, month, comps, saldoInicial]);
  const pautaPend = useMemo(() => computePautaPendiente(franchise.id, comps, year, month), [franchise.id, comps, year, month]);
  const handleAdd = useCallback((comp) => onAddComp(franchise.id, comp), [franchise.id, onAddComp]);

  const openEdit = (c) => { setEditingId(c.id); setEditBuf({ date: c.date ?? "", nota: c.ref ?? c.nota ?? "", amount: c.amount ?? 0 }); };
  const saveEdit = () => {
    if (onEditComp && editingId) onEditComp(franchise.id, editingId, { date: editBuf.date, nota: editBuf.nota, ref: editBuf.nota, amount: parseFloat(String(editBuf.amount).replace(",", ".")) || 0 });
    setEditingId(null);
  };

  const inpS = { padding: "4px 8px", fontSize: 11, borderRadius: 5, background: "var(--bg)", border: "1px solid var(--accent)", color: "var(--text)", fontFamily: "var(--font)" };
  const summaryItems = useMemo(() => [
    ["Saldo anterior", sp, sp > 0.01 ? "var(--orange)" : sp < -0.01 ? "var(--cyan)" : "var(--muted)"],
    ["Devengado mes",  sa - sp, "var(--text)"],
    ["Saldo final",    sa, sa > 0.01 ? "var(--red)" : sa < -0.01 ? "var(--green)" : "var(--muted)"],
  ], [sp, sa]);

  return (
    <>
      {adding && <AddCompModal franchise={franchise} month={month} year={year} onClose={() => setAdding(false)} onAdd={handleAdd} />}
      {showCC  && <CCModal franchise={franchise} onClose={() => setShowCC(false)} onDelComp={onDelComp} onEditComp={onEditComp} />}
      <Modal title={franchise.name} subtitle={`${franchise.country} · ${franchise.currency}${franchise.cuit ? " · CUIT " + franchise.cuit : ""}${franchise.applyIVA ? " · IVA 21%" : ""}`} onClose={onClose} width={720}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 18 }}>
          {summaryItems.map(([l, v, c]) => (
            <div key={l} style={{ background: "var(--bg3)", borderRadius: 8, padding: "11px 14px", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".1em", marginBottom: 5 }}>{l.toUpperCase()}</div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: c }}>{fmtS(v, franchise.currency)}</div>
            </div>
          ))}
        </div>
        {pautaPend > 0 && (
          <div style={{ background: "rgba(34,211,238,.05)", border: "1px solid rgba(34,211,238,.15)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
            <span style={{ color: "var(--cyan)" }}>💰 Pauta cobrada pendiente de facturar: <strong>{fmt(pautaPend, franchise.currency)}</strong></span>
            <button className="ghost" style={{ fontSize: 10 }} onClick={() => setAdding(true)}>Emitir FC Pauta</button>
          </div>
        )}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".1em", fontWeight: 700, marginBottom: 10 }}>COMPROBANTES DEL MES</div>
          {frComps.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)", padding: "14px 0", textAlign: "center" }}>Sin comprobantes en este período</div>
          ) : (
            <div style={{ background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden" }}>
              {frComps.map((c, i) => {
                const isEd = editingId === c.id;
                return (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderBottom: i < frComps.length - 1 ? "1px solid var(--border)" : "none", background: isEd ? "rgba(173,255,25,.05)" : "transparent" }}>
                    {isEd ? (
                      <>
                        <input type="date" value={dmyToIso(editBuf.date)} onChange={e => setEditBuf(b => ({ ...b, date: isoToDmy(e.target.value) }))} style={{ ...inpS, width: 122, colorScheme: "dark" }} />
                        <TypePill type={c.type} />
                        <input type="number" min="0" step="0.01" value={editBuf.amount} onChange={e => setEditBuf(b => ({ ...b, amount: e.target.value }))} style={{ ...inpS, width: 110, textAlign: "right" }} />
                        <input value={editBuf.nota} onChange={e => setEditBuf(b => ({ ...b, nota: e.target.value }))} placeholder="Descripción..." style={{ ...inpS, flex: 1 }} />
                        <button className="btn"   style={{ fontSize: 10, padding: "3px 9px", flexShrink: 0 }} onClick={saveEdit}>✓</button>
                        <button className="ghost" style={{ fontSize: 10, padding: "3px 7px", flexShrink: 0 }} onClick={() => setEditingId(null)}>✕</button>
                      </>
                    ) : (
                      <>
                        <span className="mono" style={{ fontSize: 11, color: "var(--muted)", minWidth: 90 }}>{c.date}</span>
                        <TypePill type={c.type} />
                        <span className="mono" style={{ fontSize: 13, fontWeight: 700, minWidth: 140, color: COMP_TYPES[c.type]?.sign === +1 ? "var(--red)" : COMP_TYPES[c.type]?.sign === -1 ? "var(--green)" : "var(--cyan)" }}>
                          {COMP_TYPES[c.type]?.sign === +1 ? "+" : COMP_TYPES[c.type]?.sign === -1 ? "-" : ""}{fmt(c.amount, franchise.currency)}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.ref ?? c.nota ?? "—"}</span>
                        <button className="ghost" style={{ fontSize: 13, padding: "1px 5px", opacity: .55, flexShrink: 0 }} title="Editar" onClick={() => openEdit(c)}>✎</button>
                        <button className="del" onClick={() => onDelComp(franchise.id, c.id)}>✕</button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ghost" onClick={() => setAdding(true)}>+ Comprobante</button>
            <button className="ghost" onClick={() => setShowCC(true)}>📋 Cuenta corriente</button>
          </div>
          <button className="ghost" onClick={onClose}>Cerrar</button>
        </div>
      </Modal>
    </>
  );
}
