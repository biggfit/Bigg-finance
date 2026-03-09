import { useState, useCallback } from "react";
import { useStore } from "../lib/context";
import { buildCuentaCorriente, COMP_TYPES, fmt, fmtS, downloadCSV } from "../lib/helpers";
import { dmyToIso, isoToDmy } from "../data/franchisor";
import { TypePill } from "./atoms";

// ─── CC MODAL ─────────────────────────────────────────────────────────────────
export default function CCModal({ franchise, onClose, onDelComp, onEditComp }) {
  const { comps, saldoInicial } = useStore();
  const { lines } = buildCuentaCorriente(franchise.id, comps, saldoInicial);
  const MOV_TYPES = new Set(["PAGO", "PAGO_PAUTA", "PAGO_ENVIADO"]);
  const [confirmId, setConfirmId] = useState(null);
  const [editId,    setEditId]    = useState(null);
  const [editBuf,   setEditBuf]   = useState({});

  const openEdit = (l) => {
    setEditId(l.id);
    setEditBuf({ date: l.date ?? "", nota: l.ref ?? l.nota ?? "", amount: l.amount ?? (l.debit > 0 ? l.debit : l.credit) });
    setConfirmId(null);
  };
  const saveEdit = () => {
    if (onEditComp && editId) onEditComp(franchise.id, editId, { date: editBuf.date, nota: editBuf.nota, ref: editBuf.nota, amount: parseFloat(String(editBuf.amount).replace(",", ".")) || 0 });
    setEditId(null);
  };

  const handleExportCSV = useCallback(() => {
    const rows = [["Fecha", "Tipo", "Descripción", "Débito", "Crédito", "Saldo"]];
    lines.forEach(l => rows.push([l.date ?? "—", COMP_TYPES[l.type]?.label ?? "Apertura", l.ref ?? l.nota ?? "—", (l.debit ?? 0).toFixed(2), (l.credit ?? 0).toFixed(2), l.saldo.toFixed(2)]));
    downloadCSV(rows, `CC_${franchise.name.replace(/ /g, "_")}.csv`);
  }, [lines, franchise.name]);

  const inpS = { padding: "3px 7px", fontSize: 11, borderRadius: 5, background: "var(--bg)", border: "1px solid var(--accent)", color: "var(--text)", fontFamily: "var(--font)" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.9)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="fade" style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 14, width: 920, maxWidth: "97vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{franchise.name}</div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 1 }}>Cuenta Corriente Completa · {franchise.currency}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ghost" onClick={handleExportCSV}>↓ CSV</button>
            <button className="ghost" onClick={onClose}>Cerrar</button>
          </div>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "9%" }} /><col style={{ width: "14%" }} /><col style={{ width: "27%" }} />
              <col style={{ width: "13%" }} /><col style={{ width: "13%" }} /><col style={{ width: "13%" }} />
              <col style={{ width: 68 }} />
            </colgroup>
            <thead style={{ position: "sticky", top: 0, background: "var(--bg2)" }}>
              <tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th style={{ textAlign: "right" }}>Débito</th><th style={{ textAlign: "right" }}>Crédito</th><th style={{ textAlign: "right" }}>Saldo</th><th></th></tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const canAct = MOV_TYPES.has(l.type) && l.id;
                const isEd = editId === l.id;
                return (
                  <tr key={i} style={{ background: isEd ? "rgba(173,255,25,.06)" : l.type === "apertura" ? "rgba(173,255,25,.03)" : "transparent" }}>
                    <td className="mono" style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {isEd ? <input type="date" value={dmyToIso(editBuf.date)} onChange={e => setEditBuf(b => ({ ...b, date: isoToDmy(e.target.value) }))} style={{ ...inpS, width: 112, colorScheme: "dark" }} /> : l.date ?? "—"}
                    </td>
                    <td style={{ overflow: "hidden" }}>{l.type === "apertura" ? <span className="pill" style={{ color: "var(--accent)", background: "rgba(173,255,25,.08)" }}>Apertura</span> : <TypePill type={l.type} />}</td>
                    <td style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden" }}>
                      {isEd ? <input value={editBuf.nota} onChange={e => setEditBuf(b => ({ ...b, nota: e.target.value }))} style={{ ...inpS, width: "100%" }} placeholder="Descripción..." /> : <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.ref ?? l.nota ?? "—"}</span>}
                    </td>
                    <td className="mono" style={{ textAlign: "right", fontSize: 12, color: "var(--muted)" }}>
                      {isEd && l.debit > 0 ? <input type="number" min="0" step="0.01" value={editBuf.amount} onChange={e => setEditBuf(b => ({ ...b, amount: e.target.value }))} style={{ ...inpS, width: 85, textAlign: "right" }} /> : l.debit > 0 ? fmt(l.debit, franchise.currency) : "—"}
                    </td>
                    <td className="mono" style={{ textAlign: "right", fontSize: 12, color: "var(--green)" }}>
                      {isEd && l.credit > 0 ? <input type="number" min="0" step="0.01" value={editBuf.amount} onChange={e => setEditBuf(b => ({ ...b, amount: e.target.value }))} style={{ ...inpS, width: 85, textAlign: "right" }} /> : l.credit > 0 ? fmt(l.credit, franchise.currency) : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}><span className="mono" style={{ fontSize: 12, fontWeight: 700, color: l.saldo > 0.01 ? "var(--red)" : l.saldo < -0.01 ? "var(--green)" : "var(--muted)" }}>{fmtS(l.saldo, franchise.currency)}</span></td>
                    <td style={{ textAlign: "right", paddingRight: 6 }}>
                      {isEd ? (
                        <span style={{ display: "flex", gap: 3, justifyContent: "flex-end" }}>
                          <button className="btn" style={{ fontSize: 10, padding: "2px 7px" }} onClick={saveEdit}>✓</button>
                          <button className="ghost" style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => setEditId(null)}>✕</button>
                        </span>
                      ) : canAct ? (
                        confirmId === l.id
                          ? <span style={{ display: "flex", gap: 3, justifyContent: "flex-end" }}>
                              <button className="del" style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => { onDelComp(franchise.id, l.id); setConfirmId(null); }}>✓ Borrar</button>
                              <button className="ghost" style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => setConfirmId(null)}>✕</button>
                            </span>
                          : <span style={{ display: "flex", gap: 3, justifyContent: "flex-end" }}>
                              <button className="ghost" style={{ fontSize: 12, padding: "2px 5px", opacity: .55 }} title="Editar" onClick={() => openEdit(l)}>✎</button>
                              <button className="del" style={{ opacity: .5 }} onClick={() => setConfirmId(l.id)}>✕</button>
                            </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
