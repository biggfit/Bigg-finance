import { useState, useCallback } from "react";
import { useStore } from "../lib/context";
import { buildCuentaCorriente, COMP_TYPES, fmt, fmtS, downloadCSV } from "../lib/helpers";
import { dmyToIso, isoToDmy } from "../data/franchisor";
import { TypePill } from "./atoms";

// ─── CC MODAL — Estado de cuenta tipo recordatorio ────────────────────────────
export default function CCModal({ franchise, onClose, onDelComp, onEditComp }) {
  const { comps, saldoInicial } = useStore();
  const { lines } = buildCuentaCorriente(franchise.id, comps, saldoInicial);
  const MOV_TYPES = new Set(["PAGO", "PAGO_PAUTA", "PAGO_ENVIADO"]);
  const [confirmId, setConfirmId] = useState(null);
  const [editId,    setEditId]    = useState(null);
  const [editBuf,   setEditBuf]   = useState({});

  // Separar apertura del resto
  const apertura  = lines.find(l => l.type === "apertura");
  const movs      = lines.filter(l => l.type !== "apertura");
  const saldoFinal = movs.length > 0 ? movs[movs.length - 1].saldo : (apertura?.saldo ?? 0);
  const fechaFinal = movs.length > 0 ? movs[movs.length - 1].date : apertura?.date ?? "—";

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
    const rows = [["Fecha", "N° Comprobante", "Tipo", "Importe", "Saldo"]];
    movs.forEach(l => {
      const importe = l.debit > 0 ? l.debit : -l.credit;
      rows.push([l.date ?? "—", l.invoice ?? "—", COMP_TYPES[l.type]?.label ?? l.type, importe.toFixed(2), l.saldo.toFixed(2)]);
    });
    downloadCSV(rows, `CC_${franchise.name.replace(/ /g, "_")}.csv`);
  }, [movs, franchise.name]);

  const inpS = { padding: "3px 7px", fontSize: 11, borderRadius: 5, background: "var(--bg)", border: "1px solid var(--accent)", color: "var(--text)", fontFamily: "var(--font)" };

  const saldoColor = (s) => s > 0.01 ? "var(--red)" : s < -0.01 ? "var(--green)" : "var(--muted)";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.9)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="fade" style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 14, width: 960, maxWidth: "97vw", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>

        {/* ── Header ── */}
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{franchise.name}</div>
            <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
              {franchise.razonSocial && <span>{franchise.razonSocial} · </span>}
              Estado de Cuenta · {franchise.currency}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ghost" onClick={handleExportCSV}>↓ CSV</button>
            <button className="ghost" onClick={onClose}>Cerrar</button>
          </div>
        </div>

        {/* ── Saldo Anterior ── */}
        {apertura && (
          <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "rgba(255,255,255,.02)", flexShrink: 0, display: "flex", alignItems: "baseline", gap: 16 }}>
            <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>
              Saldo anterior al {apertura.date}
            </span>
            <span className="mono" style={{ fontSize: 20, fontWeight: 800, color: saldoColor(apertura.saldo) }}>
              {fmtS(apertura.saldo, franchise.currency)}
            </span>
          </div>
        )}

        {/* ── Tabla de movimientos ── */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "10%" }} />  {/* Fecha */}
              <col style={{ width: "22%" }} />  {/* N° Comprobante */}
              <col style={{ width: "18%" }} />  {/* Tipo */}
              <col style={{ width: "18%" }} />  {/* Importe */}
              <col style={{ width: "18%" }} />  {/* Saldo */}
              <col style={{ width: 72 }} />     {/* Acciones */}
            </colgroup>
            <thead style={{ position: "sticky", top: 0, background: "var(--bg2)", zIndex: 2 }}>
              <tr>
                <th>Fecha</th>
                <th>N° Comprobante</th>
                <th>Tipo</th>
                <th style={{ textAlign: "right" }}>Importe</th>
                <th style={{ textAlign: "right" }}>Saldo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {movs.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", padding: 32, color: "var(--muted)", fontSize: 13 }}>Sin movimientos</td></tr>
              )}
              {movs.map((l, i) => {
                const canAct = MOV_TYPES.has(l.type) && l.id;
                const isEd   = editId === l.id;
                const importe = l.debit > 0 ? l.debit : -l.credit;
                return (
                  <tr key={i} style={{
                    background: isEd ? "rgba(173,255,25,.06)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,.012)",
                    borderBottom: "1px solid rgba(255,255,255,.04)"
                  }}>
                    {/* Fecha */}
                    <td className="mono" style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", padding: "8px 8px" }}>
                      {isEd
                        ? <input type="date" value={dmyToIso(editBuf.date)} onChange={e => setEditBuf(b => ({ ...b, date: isoToDmy(e.target.value) }))} style={{ ...inpS, width: 112, colorScheme: "dark" }} />
                        : l.date ?? "—"}
                    </td>
                    {/* N° Comprobante */}
                    <td className="mono" style={{ fontSize: 10, color: "var(--accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "8px 8px", fontWeight: 700, letterSpacing: ".03em" }}>
                      {l.invoice ?? <span style={{ color: "var(--dim)", fontWeight: 400 }}>—</span>}
                    </td>
                    {/* Tipo */}
                    <td style={{ overflow: "hidden", padding: "8px 4px" }}>
                      <TypePill type={l.type} />
                    </td>
                    {/* Importe */}
                    <td className="mono" style={{ textAlign: "right", fontSize: 12, fontWeight: 700, padding: "8px 8px", whiteSpace: "nowrap",
                      color: importe > 0 ? "var(--red)" : "var(--green)" }}>
                      {isEd
                        ? <input type="number" min="0" step="0.01" value={editBuf.amount} onChange={e => setEditBuf(b => ({ ...b, amount: e.target.value }))} style={{ ...inpS, width: 90, textAlign: "right" }} />
                        : fmt(Math.abs(importe), franchise.currency)}
                    </td>
                    {/* Saldo */}
                    <td style={{ textAlign: "right", padding: "8px 8px" }}>
                      <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: saldoColor(l.saldo) }}>
                        {fmtS(l.saldo, franchise.currency)}
                      </span>
                    </td>
                    {/* Acciones */}
                    <td style={{ textAlign: "right", paddingRight: 8 }}>
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

        {/* ── Saldo Final ── */}
        <div style={{ padding: "14px 24px", borderTop: "2px solid var(--border2)", background: "rgba(255,255,255,.02)", flexShrink: 0, display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: 16 }}>
          <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>
            Saldo adeudado al {fechaFinal}
          </span>
          <span className="mono" style={{ fontSize: 22, fontWeight: 800, color: saldoColor(saldoFinal) }}>
            {fmtS(saldoFinal, franchise.currency)}
          </span>
        </div>

      </div>
    </div>
  );
}
