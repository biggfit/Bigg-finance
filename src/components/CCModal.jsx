import { useState, useCallback } from "react";
import { useStore } from "../lib/context";
import { buildCuentaCorriente, COMP_TYPES, fmt, fmtS, downloadCSV } from "../lib/helpers";
import { COMPANIES } from "../data/franchisor";
import { dmyToIso, isoToDmy } from "../data/franchisor";
import { TypePill } from "./atoms";
import { buildCCHtml, fetchLogoDataUrl, blobToBase64, htmlToBase64, buildFacturaHtmlForMail } from "../lib/pdf";
import { generateInvoicePdfBlob } from "../lib/invoicePdf";
import { downloadFacturantePdfBlob } from "../lib/facturanteApi";
import { sendMailFr } from "../lib/sheetsApi";

// ─── CC MODAL — Historial completo tipo base de datos ────────────────────────
export default function CCModal({ franchise, onClose, onDelComp, onEditComp }) {
  const { comps, saldoInicial, activeCompany, franchisor } = useStore();
  // Franchise's own currency takes precedence over company default
  const frCurrency     = franchise.currency ?? franchise.moneda ?? null;
  const displayCurrency = frCurrency ?? COMPANIES[activeCompany]?.currency ?? "ARS";
  const { lines } = buildCuentaCorriente(franchise.id, comps, saldoInicial, frCurrency, null, activeCompany);
  const MOV_TYPES = new Set(["PAGO", "PAGO_PAUTA", "PAGO_ENVIADO"]);
  const [confirmId,  setConfirmId]  = useState(null);
  const [editId,     setEditId]     = useState(null);
  const [editBuf,    setEditBuf]    = useState({});
  const [mailStatus,   setMailStatus]   = useState(null); // null | "sending" | "ok" | "error"
  const [mailError,    setMailError]    = useState("");
  const [showConfirmCC, setShowConfirmCC] = useState(false);
  const to = franchise.emailFactura ?? franchise.emailComercial ?? "";

  const openEdit = (l) => {
    setEditId(l.id);
    setEditBuf({ date: l.date ?? "", nota: l.ref ?? l.nota ?? "", amount: l.amount ?? (l.debit > 0 ? l.debit : l.credit) });
    setConfirmId(null);
  };
  const saveEdit = () => {
    if (onEditComp && editId) onEditComp(franchise.id, editId, { date: editBuf.date, nota: editBuf.nota, ref: editBuf.nota, amount: parseFloat(String(editBuf.amount).replace(",", ".")) || 0 });
    setEditId(null);
  };

  // ── Enviar CC completa ───────────────────────────────────────────────────────
  const handleSendMail = useCallback(async (withPdfs = true) => {
    setShowConfirmCC(false);
    if (!to) { setMailError("Sin email configurado"); setMailStatus("error"); return; }
    setMailStatus("sending");
    setMailError("");
    try {
      const logoUrl     = franchisor?.ar?.logoUrl || franchisor?.usa?.logoUrl || franchisor?.es?.logoUrl || "/Logo.jpg";
      const logoDataUrl = await fetchLogoDataUrl(logoUrl);
      const ccHtml      = buildCCHtml(franchise.name, franchise.razonSocial ?? null, lines, displayCurrency, null, null, logoDataUrl, activeCompany);
      const today       = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });

      let factAdjs = [];
      if (withPdfs) {
        const isAR     = franchise.country === "Argentina";
        const frSlug   = franchise.name.replace(/ /g, "_");
        const docTypes = ["FACTURA", "NC", "FC_RECIBIDA"];
        const factsConInvoice = lines.filter(c => c.invoice && docTypes.some(d => c.type?.startsWith(d)));
        factAdjs = (await Promise.all(factsConInvoice.map(async (c) => {
          const label = (c.invoice ?? c.id).replace(/\//g, "-");
          if (isAR) {
            if (c.facturanteId) {
              try {
                const blob = await downloadFacturantePdfBlob(c.facturanteId);
                return { data: await blobToBase64(blob), mimeType: "application/pdf", name: `${label}_${frSlug}.pdf` };
              } catch { /* fallback */ }
            }
            const html = buildFacturaHtmlForMail(franchise, franchisor, c);
            return { data: htmlToBase64(html), mimeType: "application/octet-stream", name: `${label}_${frSlug}.html` };
          }
          const doc    = String(c.type ?? "").split("|")[0];
          const prefix = doc === "NC" ? "CreditNote" : doc === "FC_RECIBIDA" ? "FCRecibida" : "Invoice";
          const blob   = await generateInvoicePdfBlob(franchise, franchisor, c);
          return { data: await blobToBase64(blob), mimeType: "application/pdf", name: `${prefix}_${label}_${frSlug}.pdf` };
        }))).filter(Boolean);
      }

      await sendMailFr({ to, subject: `Cuenta Corriente ${franchise.name} — ${today}`, htmlBody: ccHtml, attachments: factAdjs });
      setMailStatus("ok");
    } catch (err) { setMailError(err.message ?? "Error"); setMailStatus("error"); }
  }, [franchise, franchisor, lines, displayCurrency, activeCompany, to]);


  const handleExportCSV = useCallback(() => {
    const rows = [["Fecha", "N° Comprobante", "Tipo", "Descripción", "Debe", "Haber", "Saldo"]];
    lines.forEach(l => {
      rows.push([
        l.date ?? "—",
        l.invoice ?? "—",
        COMP_TYPES[l.type]?.label ?? l.type,
        l.nota ?? l.ref ?? "—",
        l.debit  > 0 ? l.debit.toFixed(2)  : "",
        l.credit > 0 ? l.credit.toFixed(2) : "",
        l.saldo.toFixed(2),
      ]);
    });
    downloadCSV(rows, `CC_${franchise.name.replace(/ /g, "_")}.csv`);
  }, [lines, franchise.name]);

  const inpS = { padding: "3px 7px", fontSize: 11, borderRadius: 5, background: "var(--bg)", border: "1px solid var(--accent)", color: "var(--text)", fontFamily: "var(--font)" };
  const saldoColor = (s) => s > 0.01 ? "var(--red)" : s < -0.01 ? "var(--green)" : "var(--muted)";

  return (
    <>
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.92)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="fade" style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 14, width: 1060, maxWidth: "97vw", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>

        {/* ── Header ── */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{franchise.name} — Cuenta Corriente</div>
            <div style={{ color: "var(--muted)", fontSize: 10, marginTop: 1 }}>
              {franchise.razonSocial && <span>{franchise.razonSocial} · </span>}
              Historial completo · {activeCompany} · {displayCurrency}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {mailStatus === "ok"    && <span style={{ fontSize: 11, color: "var(--green)" }}>✓ Enviado</span>}
            {mailStatus === "error" && <span style={{ fontSize: 11, color: "var(--red)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={mailError}>✕ {mailError}</span>}
            <button className="ghost" onClick={handleExportCSV}>↓ CSV</button>
            <button
              className="ghost"
              onClick={() => to ? setShowConfirmCC(true) : (setMailError("Sin email configurado"), setMailStatus("error"))}
              disabled={mailStatus === "sending"}
              title={to || "Sin email configurado"}
              style={{ opacity: !to ? .4 : 1 }}
            >
              {mailStatus === "sending" ? "Enviando…" : "✉ Enviar CC"}
            </button>
            <button className="ghost" onClick={onClose}>Cerrar</button>
          </div>
        </div>

        {/* ── Tabla historial ── */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 88 }} />   {/* Fecha */}
              <col style={{ width: 140 }} />  {/* N° Comprobante */}
              <col style={{ width: 110 }} />  {/* Tipo */}
              <col />                          {/* Descripción — flex */}
              <col style={{ width: 120 }} />  {/* Debe */}
              <col style={{ width: 120 }} />  {/* Haber */}
              <col style={{ width: 120 }} />  {/* Saldo */}
              <col style={{ width: 68 }} />   {/* Acciones */}
            </colgroup>
            <thead style={{ position: "sticky", top: 0, background: "var(--bg2)", zIndex: 2 }}>
              <tr>
                <th>Fecha</th>
                <th>N° Comprobante</th>
                <th>Tipo</th>
                <th style={{ paddingLeft: 12 }}>Descripción</th>
                <th style={{ textAlign: "right" }}>Debe</th>
                <th style={{ textAlign: "right" }}>Haber</th>
                <th style={{ textAlign: "right" }}>Saldo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", padding: 32, color: "var(--muted)", fontSize: 13 }}>Sin movimientos</td></tr>
              )}
              {lines.map((l, i) => {
                const isApertura = l.type === "apertura";
                const canAct     = MOV_TYPES.has(l.type) && l.id;
                const isEd       = editId === l.id;
                return (
                  <tr key={i} style={{
                    background: isEd
                      ? "rgba(173,255,25,.06)"
                      : isApertura
                        ? "rgba(173,255,25,.04)"
                        : i % 2 === 0 ? "transparent" : "rgba(255,255,255,.012)",
                    borderBottom: "1px solid rgba(255,255,255,.04)",
                  }}>
                    {/* Fecha */}
                    <td className="mono" style={{ fontSize: 11, color: isApertura ? "var(--accent)" : "var(--muted)", whiteSpace: "nowrap", padding: "6px 8px", fontWeight: isApertura ? 700 : 400 }}>
                      {isEd
                        ? <input type="date" value={dmyToIso(editBuf.date)} onChange={e => setEditBuf(b => ({ ...b, date: isoToDmy(e.target.value) }))} style={{ ...inpS, width: 112, colorScheme: "dark" }} />
                        : l.date ?? "—"}
                    </td>
                    {/* N° Comprobante */}
                    <td className="mono" style={{ fontSize: 10, color: "var(--accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "6px 8px", fontWeight: 700, letterSpacing: ".03em" }}>
                      {isApertura
                        ? <span style={{ color: "var(--muted)", fontWeight: 400, fontStyle: "italic" }}>—</span>
                        : (l.invoice ?? <span style={{ color: "var(--dim)", fontWeight: 400 }}>—</span>)}
                    </td>
                    {/* Tipo */}
                    <td style={{ overflow: "hidden", padding: "6px 4px" }}>
                      {isApertura
                        ? <span className="pill" style={{ color: "var(--accent)", background: "rgba(173,255,25,.08)", fontSize: 9 }}>Saldo Ant.</span>
                        : <TypePill type={l.type} />}
                    </td>
                    {/* Descripción */}
                    <td style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "6px 8px 6px 12px" }}>
                      {isEd
                        ? <input value={editBuf.nota} onChange={e => setEditBuf(b => ({ ...b, nota: e.target.value }))} style={{ ...inpS, width: "100%" }} placeholder="Descripción..." />
                        : (l.nota ?? l.ref ?? (isApertura ? "Saldo inicial / apertura" : "—"))}
                    </td>
                    {/* Debe */}
                    <td className="mono" style={{ textAlign: "right", fontSize: 11, color: "var(--red)", fontWeight: l.debit > 0 ? 700 : 400, padding: "6px 8px", whiteSpace: "nowrap" }}>
                      {isEd && l.debit > 0
                        ? <input type="number" min="0" step="0.01" value={editBuf.amount} onChange={e => setEditBuf(b => ({ ...b, amount: e.target.value }))} style={{ ...inpS, width: 88, textAlign: "right" }} />
                        : l.debit > 0 ? fmt(l.debit, l.currency ?? displayCurrency) : <span style={{ color: "var(--dim)" }}>—</span>}
                    </td>
                    {/* Haber */}
                    <td className="mono" style={{ textAlign: "right", fontSize: 11, color: "var(--green)", fontWeight: l.credit > 0 ? 700 : 400, padding: "6px 8px", whiteSpace: "nowrap" }}>
                      {isEd && l.credit > 0
                        ? <input type="number" min="0" step="0.01" value={editBuf.amount} onChange={e => setEditBuf(b => ({ ...b, amount: e.target.value }))} style={{ ...inpS, width: 88, textAlign: "right" }} />
                        : l.credit > 0 ? fmt(l.credit, l.currency ?? displayCurrency) : <span style={{ color: "var(--dim)" }}>—</span>}
                    </td>
                    {/* Saldo */}
                    <td style={{ textAlign: "right", padding: "6px 8px", whiteSpace: "nowrap" }}>
                      <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: saldoColor(l.saldo) }}>
                        {fmtS(l.saldo, l.currency ?? displayCurrency)}
                      </span>
                    </td>
                    {/* Acciones */}
                    <td style={{ textAlign: "right", paddingRight: 8 }}>
                      {isEd ? (
                        <span style={{ display: "flex", gap: 3, justifyContent: "flex-end" }}>
                          <button className="btn"   style={{ fontSize: 10, padding: "2px 7px" }} onClick={saveEdit}>✓</button>
                          <button className="ghost" style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => setEditId(null)}>✕</button>
                        </span>
                      ) : canAct ? (
                        confirmId === l.id
                          ? <span style={{ display: "flex", gap: 3, justifyContent: "flex-end" }}>
                              <button className="del"   style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => { onDelComp(franchise.id, l.id); setConfirmId(null); }}>✓ Borrar</button>
                              <button className="ghost" style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => setConfirmId(null)}>✕</button>
                            </span>
                          : <span style={{ display: "flex", gap: 3, justifyContent: "flex-end" }}>
                              <button className="ghost" style={{ fontSize: 12, padding: "2px 5px", opacity: .55 }} title="Editar" onClick={() => openEdit(l)}>✎</button>
                              <button className="del"   style={{ opacity: .5 }} onClick={() => setConfirmId(l.id)}>✕</button>
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

    {/* ── Mini-modal: ¿adjuntar PDFs? ── */}
    {showConfirmCC && (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        onClick={e => e.target === e.currentTarget && setShowConfirmCC(false)}>
        <div className="fade" style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 14, padding: 28, maxWidth: 460, width: "100%" }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>Enviar estado de cuenta</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>
            Destinatario: <strong style={{ color: "var(--text)" }}>{to}</strong>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 20 }}>
            ¿Incluir las facturas del período como adjuntos?
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="ghost" onClick={() => setShowConfirmCC(false)}>Cancelar</button>
            <button className="ghost" style={{ whiteSpace: "nowrap" }} onClick={() => handleSendMail(true)}>✉ Con adjuntos</button>
            <button className="btn"   onClick={() => handleSendMail(false)} style={{ whiteSpace: "nowrap" }}>✉ Sin adjuntos</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
