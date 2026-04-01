import { useState, useMemo, useCallback } from "react";
import { useStore } from "../lib/context";
import { computeSaldo, computeSaldoPrevMes, computePautaPendiente, compEmpresa, COMP_TYPES, fmt, fmtS } from "../lib/helpers";
import { dmyToIso, isoToDmy, inPeriod, cmpDate, COMPANIES, todayDmy } from "../data/franchisor";
import { TypePill } from "./atoms";
import AddCompModal from "./AddCompModal";
import CCModal from "./CCModal";
import { buildCCHtml, htmlToBase64, blobToBase64, buildFacturaHtmlForMail } from "../lib/pdf";
import { generateInvoicePdfBlob } from "../lib/invoicePdf";
import { downloadFacturantePdfBlob } from "../lib/facturanteApi";
import { sendMailFr } from "../lib/sheetsApi";
import { RecordatorioDots } from "../tabs/TabSaldos";

// ─── FRANCHISE DETAIL MODAL — Estado de cuenta mensual / recordatorio ─────────
export default function FrDetail({ franchise, month, year, onClose, onAddComp, onDelComp, onEditComp }) {
  const { comps, saldoInicial, activeCompany, franchisor, recordatorios, addRecordatorioEntry } = useStore();
  const [adding,      setAdding]      = useState(false);
  const [showCC,      setShowCC]      = useState(false);
  const [editingId,   setEditingId]   = useState(null);
  const [editBuf,     setEditBuf]     = useState({});
  const [localMonth,  setLocalMonth]  = useState(month);
  const [localYear,   setLocalYear]   = useState(year);
  const [mailStatus,  setMailStatus]  = useState(null); // null | "sending" | "ok" | "error"
  const [mailError,   setMailError]   = useState("");

  const goToPrev = () => {
    if (localMonth === 0) { setLocalMonth(11); setLocalYear(y => y - 1); }
    else setLocalMonth(m => m - 1);
  };
  const goToNext = () => {
    if (localMonth === 11) { setLocalMonth(0); setLocalYear(y => y + 1); }
    else setLocalMonth(m => m + 1);
  };

  const key     = String(franchise.id);
  const frComps = useMemo(() => (comps[key] ?? []).filter(c => inPeriod(c, localMonth, localYear) && compEmpresa(c) === activeCompany).sort((a, b) => cmpDate(a.date, b.date)), [comps, key, localMonth, localYear, activeCompany]);
  const sp      = useMemo(() => computeSaldoPrevMes(franchise.id, localYear, localMonth, comps, saldoInicial, null, null, activeCompany), [franchise.id, localYear, localMonth, comps, saldoInicial, activeCompany]);
  const sa      = useMemo(() => computeSaldo(franchise.id, localYear, localMonth, comps, saldoInicial, null, null, activeCompany), [franchise.id, localYear, localMonth, comps, saldoInicial, activeCompany]);
  const pautaPend = useMemo(() => computePautaPendiente(franchise.id, comps, localYear, localMonth, null, null, activeCompany), [franchise.id, comps, localYear, localMonth, activeCompany]);
  const handleAdd = useCallback((comp) => onAddComp(franchise.id, comp), [franchise.id, onAddComp]);

  const openEdit = (c) => { setEditingId(c.id); setEditBuf({ date: c.date ?? "", nota: c.ref ?? c.nota ?? "", amount: c.amount ?? 0, type: c.type ?? "" }); };
  const saveEdit = () => {
    if (onEditComp && editingId) onEditComp(franchise.id, editingId, { date: editBuf.date, nota: editBuf.nota, ref: editBuf.nota, amount: parseFloat(String(editBuf.amount).replace(",", ".")) || 0, type: editBuf.type || undefined });
    setEditingId(null);
  };

  // Calcular saldo corriente después de cada comprobante
  const compsWithSaldo = useMemo(() => {
    let running = sp;
    return frComps.map(c => {
      const sign = COMP_TYPES[c.type]?.sign ?? 0;
      running += sign * c.amount;
      return { ...c, saldo: running };
    });
  }, [frComps, sp]);

  // Fecha de cierre mes anterior
  const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const MONTH_NAMES   = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const prevMonth     = localMonth === 0 ? 11 : localMonth - 1;
  const prevYear      = localMonth === 0 ? localYear - 1 : localYear;
  const prevLastDay   = DAYS_IN_MONTH[prevMonth];
  const aperturaDate  = `${String(prevLastDay).padStart(2,"0")}/${String(prevMonth + 1).padStart(2,"0")}/${prevYear}`;
  const lastComp      = compsWithSaldo[compsWithSaldo.length - 1];

  // Moneda de visualización: derivada de la empresa activa
  const displayCurrency = COMPANIES[activeCompany]?.currency ?? franchise.currency;

  const inpS = { padding: "3px 7px", fontSize: 11, borderRadius: 5, background: "var(--bg)", border: "1px solid var(--accent)", color: "var(--text)", fontFamily: "var(--font)" };
  const saldoColor = (s) => s > 0.01 ? "var(--red)" : s < -0.01 ? "var(--green)" : "var(--muted)";

  const handleEmailCC = useCallback(async () => {
    const to = franchise.emailFactura ?? franchise.emailComercial ?? "";
    if (!to) { setMailError("Sin email configurado"); setMailStatus("error"); return; }
    setMailStatus("sending");
    setMailError("");
    try {
      const mesLabel = `${MONTH_NAMES[localMonth]} ${localYear}`;
      const frSlug   = franchise.name.replace(/ /g, "_");

      // CC del mes: línea de apertura + movimientos del período (misma estructura que buildCCHtml espera)
      const ccLines = [
        { type: "apertura", label: "Saldo anterior", debit: 0, credit: 0, saldo: sp, date: aperturaDate, currency: displayCurrency },
        ...compsWithSaldo.map(c => {
          const sign = COMP_TYPES[c.type]?.sign ?? 0;
          return sign >= 0
            ? { ...c, debit: c.amount, credit: 0 }
            : { ...c, debit: 0, credit: c.amount };
        }),
      ];
      const ccHtml = buildCCHtml(franchise.name, franchise.razonSocial ?? null, ccLines, displayCurrency, localMonth, localYear);

      // Facturas del mes con número emitido
      const isAR        = franchise.country === "Argentina";
      const factsDelMes = compsWithSaldo.filter(c => c.invoice && c.type?.startsWith("FACTURA"));
      const factAdjs    = await Promise.all(factsDelMes.map(async (c) => {
        const label = (c.invoice ?? c.id).replace(/\//g, "-");
        if (isAR) {
          // AR: intentar adjuntar PDF oficial de ARCA
          if (c.facturanteId) {
            try {
              const blob = await downloadFacturantePdfBlob(c.facturanteId);
              return { data: await blobToBase64(blob), mimeType: "application/pdf", name: `${label}_${frSlug}.pdf` };
            } catch (e) { console.error("[CC email] PDF download failed, fallback HTML:", e); }
          }
          const factHtml = buildFacturaHtmlForMail(franchise, franchisor, c);
          return { data: htmlToBase64(factHtml), mimeType: "application/octet-stream", name: `${label}_${frSlug}.html` };
        }
        // USA / ES: generar PDF y convertir a base64
        const blob = await generateInvoicePdfBlob(franchise, franchisor, c);
        return { data: await blobToBase64(blob), mimeType: "application/pdf", name: `Invoice_${label}_${frSlug}.pdf` };
      }));

      await sendMailFr({
        to,
        subject:  `Estado de Cuenta ${franchise.name} — ${mesLabel}`,
        htmlBody: ccHtml,
        attachments: factAdjs,
      });
      const hoy = todayDmy();
      addRecordatorioEntry(franchise.id, { fecha: hoy, ccMes: localMonth + 1, ccAnio: localYear, to });
      setMailStatus("ok");
    } catch (err) { setMailError(err.message ?? "Error"); setMailStatus("error"); }
  }, [franchise, franchisor, localMonth, localYear, sp, sa, compsWithSaldo, aperturaDate, displayCurrency, addRecordatorioEntry]);

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="fade" style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 14, width: 820, maxWidth: "97vw", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>

          {/* ── Header ── */}
          <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{franchise.name}</div>
              <div style={{ fontSize: 10, color: "var(--accent)", marginTop: 2, fontWeight: 700, letterSpacing: ".04em" }}>{activeCompany}</div>
            {franchise.razonSocial && (
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{franchise.razonSocial}</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="ghost" style={{ fontSize: 15, padding: "0 6px", lineHeight: 1.3 }} onClick={goToPrev}>‹</button>
              <span style={{ fontSize: 12, fontWeight: 700, minWidth: 80, textAlign: "center" }}>{MONTH_NAMES[localMonth]} {localYear}</span>
              <button className="ghost" style={{ fontSize: 15, padding: "0 6px", lineHeight: 1.3 }} onClick={goToNext}>›</button>
              <button className="ghost" onClick={() => setAdding(true)}>+ Comprobante</button>
              <button className="ghost" onClick={() => setShowCC(true)}>📋 CC</button>
              <button className="ghost" onClick={onClose}>Cerrar</button>
            </div>
          </div>

          {/* ── Saldo Acumulado (arriba, izquierda) ── */}
          <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--border)", background: "rgba(255,255,255,.02)", flexShrink: 0, display: "flex", justifyContent: "flex-start", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>
              Saldo acumulado al {aperturaDate}
            </span>
            <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: saldoColor(sp) }}>
              {fmtS(sp, displayCurrency)}
            </span>
          </div>

          {/* ── Alerta pauta pendiente ── */}
          {pautaPend > 0 && (
            <div style={{ padding: "8px 24px", background: "rgba(34,211,238,.05)", borderBottom: "1px solid rgba(34,211,238,.15)", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
              <span style={{ color: "var(--cyan)" }}>💰 Pauta cobrada pendiente de facturar: <strong>{fmt(pautaPend, displayCurrency)}</strong></span>
              <button className="ghost" style={{ fontSize: 10 }} onClick={() => setAdding(true)}>Emitir FC Pauta</button>
            </div>
          )}

          {/* ── Tabla de comprobantes ── */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "14%" }} />  {/* Fecha */}
                <col style={{ width: "21%" }} />  {/* N° Comprobante */}
                <col style={{ width: "19%" }} />  {/* Tipo */}
                <col style={{ width: "19%" }} />  {/* Importe */}
                <col style={{ width: "19%" }} />  {/* Saldo */}
                <col style={{ width: 68 }} />     {/* Acciones */}
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
                {compsWithSaldo.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: "center", padding: 32, color: "var(--muted)", fontSize: 13 }}>Sin comprobantes en este período</td></tr>
                )}
                {compsWithSaldo.map((c, i) => {
                  const isEd    = editingId === c.id;
                  const sign    = COMP_TYPES[c.type]?.sign ?? 0;
                  const importe = sign * c.amount;
                  return (
                    <tr key={c.id} style={{
                      background: isEd ? "rgba(173,255,25,.06)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,.012)",
                      borderBottom: "1px solid rgba(255,255,255,.04)"
                    }}>
                      {/* Fecha */}
                      <td className="mono" style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", padding: "8px 8px" }}>
                        {isEd
                          ? <input type="date" value={dmyToIso(editBuf.date)} onChange={e => setEditBuf(b => ({ ...b, date: isoToDmy(e.target.value) }))} style={{ ...inpS, width: "100%", boxSizing: "border-box", colorScheme: "dark" }} />
                          : c.date ?? "—"}
                      </td>
                      {/* N° Comprobante */}
                      <td className="mono" style={{ fontSize: 10, color: "var(--accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "8px 8px", fontWeight: 700, letterSpacing: ".03em" }}>
                        {c.invoice ?? <span style={{ color: "var(--dim)", fontWeight: 400 }}>—</span>}
                      </td>
                      {/* Tipo */}
                      <td style={{ overflow: "hidden", padding: "8px 4px" }}>
                        {isEd ? (
                          <select value={editBuf.type} onChange={e => setEditBuf(b => ({ ...b, type: e.target.value }))}
                            style={{ ...inpS, fontSize: 10, padding: "2px 4px", maxWidth: 140 }}>
                            {Object.entries(COMP_TYPES).map(([k, v]) => (
                              <option key={k} value={k}>{v.label}</option>
                            ))}
                          </select>
                        ) : (
                          <TypePill type={c.type} />
                        )}
                      </td>
                      {/* Importe */}
                      <td className="mono" style={{ textAlign: "right", fontSize: 12, fontWeight: 700, padding: "8px 8px", whiteSpace: "nowrap",
                        color: importe > 0 ? "var(--red)" : "var(--green)" }}>
                        {isEd
                          ? <input type="number" min="0" step="0.01" value={editBuf.amount} onChange={e => setEditBuf(b => ({ ...b, amount: e.target.value }))} style={{ ...inpS, width: 90, textAlign: "right" }} />
                          : fmt(Math.abs(importe), c.currency ?? displayCurrency)}
                      </td>
                      {/* Saldo */}
                      <td style={{ textAlign: "right", padding: "8px 8px" }}>
                        <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: saldoColor(c.saldo) }}>
                          {fmtS(c.saldo, displayCurrency)}
                        </span>
                      </td>
                      {/* Acciones */}
                      <td style={{ textAlign: "right", paddingRight: 8 }}>
                        {isEd ? (
                          <span style={{ display: "flex", gap: 3, justifyContent: "flex-end" }}>
                            <button className="btn"   style={{ fontSize: 10, padding: "2px 7px" }} onClick={saveEdit}>✓</button>
                            <button className="ghost" style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => setEditingId(null)}>✕</button>
                          </span>
                        ) : (
                          <span style={{ display: "flex", gap: 3, justifyContent: "flex-end" }}>
                            <button className="ghost" style={{ fontSize: 12, padding: "2px 5px", opacity: .55 }} title="Editar" onClick={() => openEdit(c)}>✎</button>
                            <button className="del"   style={{ opacity: .5 }} onClick={() => onDelComp(franchise.id, c.id)}>✕</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Saldo Final (abajo) ── */}
          <div style={{ padding: "14px 24px", borderTop: "2px solid var(--border2)", background: "rgba(255,255,255,.02)", flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                className="ghost"
                title={`Enviar estado de cuenta + facturas de ${MONTH_NAMES[localMonth]} ${localYear} a ${franchise.emailFactura ?? franchise.emailComercial ?? "—"}`}
                onClick={handleEmailCC}
                disabled={mailStatus === "sending"}
                style={{ fontSize: 16, opacity: (!franchise.emailFactura && !franchise.emailComercial) ? .3 : .8, padding: "4px 8px" }}
              >
                {mailStatus === "sending" ? "…" : "✉"}
              </button>
              {mailStatus === "ok"    && <span style={{ fontSize: 10, color: "var(--green)" }}>✓ Enviado</span>}
              {mailStatus === "error" && <span style={{ fontSize: 10, color: "var(--red)" }} title={mailError}>✕ {mailError}</span>}
              <RecordatorioDots dots={
                (recordatorios?.[String(franchise.id)] ?? []).filter(r =>
                  Number(r.ccMes) - 1 === localMonth && Number(r.ccAnio) === localYear
                )
              } />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700 }}>
                {sa < -0.01 ? "Saldo a favor al" : "Saldo adeudado al"} {lastComp?.date ?? aperturaDate}
              </span>
              <span className="mono" style={{ fontSize: 22, fontWeight: 800, color: saldoColor(sa) }}>
                {fmtS(sa, displayCurrency)}
              </span>
            </div>
          </div>  {/* ── /footer ── */}

        </div>
      </div>

      {adding && <AddCompModal franchise={franchise} month={localMonth} year={localYear} onClose={() => setAdding(false)} onAdd={handleAdd} />}
      {showCC && <CCModal franchise={franchise} onClose={() => setShowCC(false)} onDelComp={onDelComp} onEditComp={onEditComp} />}
    </>
  );
}
