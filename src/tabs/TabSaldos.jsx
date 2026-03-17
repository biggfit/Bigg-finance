import { memo, useMemo, useCallback, useState } from "react";
import { useStore } from "../lib/context";

// ─── Dots: puntos por recordatorio enviado este mes ──────────────────────────
export function RecordatorioDots({ dots }) {
  if (!dots || dots.length === 0) return null;
  const visible = dots.slice(0, 3);
  const extra   = dots.length - 3;
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", marginLeft: 6 }}>
      {visible.map((d, i) => (
        <span key={i} title={`${d.fecha}${d.to ? ` → ${d.to}` : ""}`}
          style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", display: "inline-block", cursor: "default", flexShrink: 0 }} />
      ))}
      {extra > 0 && <span style={{ fontSize: 9, color: "var(--accent)", fontWeight: 800 }}>+{extra}</span>}
    </span>
  );
}
import { computeSaldo, computeSaldoPrevMes, computePautaPendiente, compEmpresa, compCurrency, makeType, MONTHS, fmt, downloadCSV, COMPANIES, COMP_TYPES, cmpDate } from "../lib/helpers";
import { inPeriod } from "../data/franchisor";
import { buildCCHtml } from "../lib/pdf";
import { sendMailFr } from "../lib/sheetsApi";

// ─── HOOK COMPARTIDO: agrega datos por franquicia ─────────────────────────────
export function useFrData(franchises, month, year, filterCurrency = null) {
  const { comps, saldoInicial, activeCompany } = useStore();
  return useMemo(() => franchises.map(fr => {
    const key    = String(fr.id);
    const allFc  = (comps[key] ?? []).filter(c =>
      inPeriod(c, month, year) &&
      compEmpresa(c) === activeCompany
    );
    const fc     = filterCurrency
      ? allFc.filter(c => compCurrency(c) === filterCurrency)
      : allFc;
    const sp     = computeSaldoPrevMes(fr.id, year, month, comps, saldoInicial, null, filterCurrency, activeCompany);
    const sa     = computeSaldo(fr.id, year, month, comps, saldoInicial, null, filterCurrency, activeCompany);
    // Por cuenta: neto = FACTURA - NC
    const netoCuenta = (cuenta) => {
      const facts = fc.filter(c => c.type === makeType("FACTURA", cuenta)).reduce((a, c) => a + c.amount, 0);
      const ncs   = fc.filter(c => c.type === makeType("NC",      cuenta)).reduce((a, c) => a + c.amount, 0);
      return { facts, ncs, neto: facts - ncs };
    };
    const fee           = netoCuenta("FEE");
    const interusos     = netoCuenta("INTERUSOS");
    const pauta         = netoCuenta("PAUTA");
    const sponsors      = netoCuenta("SPONSORS");
    const otrosIngresos = netoCuenta("OTROS_INGRESOS");
    const pagos         = fc.filter(c => c.type === "PAGO").reduce((a, c) => a + c.amount, 0);
    const pagosACuenta  = fc.filter(c => c.type === "PAGO_PAUTA").reduce((a, c) => a + c.amount, 0);
    const enviados      = fc.filter(c => c.type === "PAGO_ENVIADO").reduce((a, c) => a + c.amount, 0);
    // Pauta pendiente: cobros a cuenta acumulados históricamente sin factura emitida
    const pautaPendiente = computePautaPendiente(fr.id, comps, year, month, null, filterCurrency, activeCompany);
    return { fr, sp, sa, fee, interusos, pauta, sponsors, otrosIngresos, pagos, pagosACuenta, enviados, pautaPendiente };
  }), [franchises, comps, saldoInicial, month, year, filterCurrency, activeCompany]);
}

// ─── SALDOS TABLE ──────────────────────────────────────────────────────────────
export function SaldosTable({ title, data, accentColor, bgColor, borderColor, onOpenFr, month, year, amountFn, showMail = true, showCbu = false, displayCurrency }) {
  if (data.length === 0) return null;
  const getAmt = amountFn ?? (d => d.sa);
  const total  = data.reduce((a, d) => a + getAmt(d), 0);
  const { activeCompany } = useStore();
  const curLabel = displayCurrency ?? COMPANIES[activeCompany]?.currency ?? "ARS";
  const [selected,     setSelected]     = useState(new Set());
  const [confirmRows,  setConfirmRows]  = useState(null);
  const [sendingMail,  setSendingMail]  = useState(false);
  const [mailResult,   setMailResult]   = useState(null);

  const { comps, saldoInicial, recordatorios, addRecordatorioEntry } = useStore();

  // Dots del mes calendario actual para una franquicia
  const nowM = new Date().getMonth(), nowY = new Date().getFullYear();
  const dotsForFr = (frId) => (recordatorios?.[String(frId)] ?? [])
    .filter(r => {
      const [dd, mm, yy] = (r.fecha ?? "").split("/");
      return Number(mm) - 1 === nowM && Number(yy) === nowY;
    });

  const toggleOne = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(prev => prev.size === data.length ? new Set() : new Set(data.map(d => d.fr.id)));
  const allChecked  = selected.size === data.length && data.length > 0;
  const someChecked = selected.size > 0 && !allChecked;

  const handleMail = (rows) => setConfirmRows(rows);

  const doSendMail = async () => {
    if (!confirmRows) return;
    setSendingMail(true);
    const ok = [], err = [];
    const DAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
    for (const d of confirmRows) {
      const to = d.fr.emailFactura ?? d.fr.emailComercial ?? "";
      if (!to) { err.push(`${d.fr.name} (sin email)`); continue; }
      try {
        // Construir líneas CC del período
        const frComps = (comps[String(d.fr.id)] ?? [])
          .filter(c => inPeriod(c, month, year) && compEmpresa(c) === activeCompany)
          .sort((a, b) => cmpDate(a.date, b.date));
        const prevM = month === 0 ? 11 : month - 1;
        const prevY = month === 0 ? year - 1 : year;
        const aperturaDate = `${String(DAYS[prevM]).padStart(2,"0")}/${String(prevM+1).padStart(2,"0")}/${prevY}`;
        let running = d.sp;
        const compsWithSaldo = frComps.map(c => {
          const sign = COMP_TYPES[c.type]?.sign ?? 0;
          running += sign * c.amount;
          return { ...c, saldo: running };
        });
        const ccLines = [
          { type: "apertura", debit: 0, credit: 0, saldo: d.sp, date: aperturaDate },
          ...compsWithSaldo.map(c => {
            const sign = COMP_TYPES[c.type]?.sign ?? 0;
            return sign >= 0 ? { ...c, debit: c.amount, credit: 0 } : { ...c, debit: 0, credit: c.amount };
          }),
        ];
        const ccHtml = buildCCHtml(d.fr.name, d.fr.razonSocial ?? null, ccLines, curLabel, month, year);
        await sendMailFr({
          to,
          subject: `Estado de Cuenta ${d.fr.name} — ${MONTHS[month]} ${year}`,
          htmlBody: ccHtml,
          attachments: [],
        });
        const hoy = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
        addRecordatorioEntry(d.fr.id, { fecha: hoy, ccMes: month + 1, ccAnio: year, to });
        ok.push(d.fr.name);
      } catch (e) { err.push(`${d.fr.name} (${e.message})`); }
    }
    setSendingMail(false);
    setConfirmRows(null);
    setMailResult({ ok, err });
  };

  const handleCSV = (rows) => {
    const headers = showCbu
      ? ["Franquicia", "Moneda", "Saldo", "CBU", "Banco", "Alias"]
      : ["Franquicia", "Moneda", "Saldo"];
    const csvRows = [headers, ...rows.map(d => showCbu
      ? [d.fr.name, curLabel, Math.abs(getAmt(d)).toFixed(2), d.fr.cbu ?? "", d.fr.banco ?? "", d.fr.alias ?? ""]
      : [d.fr.name, curLabel, Math.abs(getAmt(d)).toFixed(2)]
    )];
    downloadCSV(csvRows, `BIGG_${title.replace(/[^a-zA-Z0-9]/g,"_")}_${MONTHS[month]}_${year}.csv`);
  };

  const selectedRows = data.filter(d => selected.has(d.fr.id));
  const actionRows   = selectedRows.length > 0 ? selectedRows : data;

  return (
    <div style={{ marginBottom: 28 }}>

      {/* Modal confirmación envío */}
      {confirmRows && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div className="fade" style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 14, padding: 28, maxWidth: 460, width: "100%" }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>Confirmar envío</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
              Estás por enviar el estado de cuenta de <strong style={{ color: "var(--text)" }}>{MONTHS[month]} {year}</strong> a:
            </div>
            <div style={{ marginBottom: 20, maxHeight: 180, overflowY: "auto" }}>
              {confirmRows.map(d => (
                <div key={d.fr.id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                  <span style={{ fontWeight: 700 }}>{d.fr.name}</span>
                  <span style={{ color: "var(--muted)" }}>{d.fr.emailFactura ?? d.fr.emailComercial ?? <span style={{ color: "var(--red)" }}>⚠ sin email</span>}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="ghost" onClick={() => setConfirmRows(null)} disabled={sendingMail}>Cancelar</button>
              <button className="btn" onClick={doSendMail} disabled={sendingMail}>
                {sendingMail ? "Enviando…" : `✉ Confirmar y enviar (${confirmRows.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resultado envío */}
      {mailResult && (
        <div style={{ marginBottom: 10, padding: "10px 14px", background: "rgba(173,255,25,.06)", border: "1px solid rgba(173,255,25,.2)", borderRadius: 8, fontSize: 12 }}>
          {mailResult.ok.length > 0 && <div style={{ color: "var(--green)" }}>✓ Enviado a: {mailResult.ok.join(", ")}</div>}
          {mailResult.err.length > 0 && <div style={{ color: "var(--red)", marginTop: 4 }}>✕ Error: {mailResult.err.join(", ")}</div>}
          <button className="ghost" style={{ fontSize: 10, marginTop: 6 }} onClick={() => setMailResult(null)}>Cerrar</button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ height: 3, width: 24, borderRadius: 2, background: accentColor }} />
        <span style={{ fontWeight: 800, fontSize: 13, color: accentColor, letterSpacing: ".08em", textTransform: "uppercase" }}>{title}</span>
        <span className="pill" style={{ color: accentColor, background: bgColor, border: `1px solid ${borderColor}` }}>{data.length} sede{data.length !== 1 ? "s" : ""}</span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: accentColor, marginLeft: "auto" }}>
          {Math.round(Math.abs(total)).toLocaleString("es-AR")} {curLabel}
        </span>
      </div>

      {/* Bulk action bar — visible when something selected */}
      {selected.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "6px 10px", background: `${accentColor}12`, border: `1px solid ${accentColor}30`, borderRadius: 7 }}>
          <span style={{ fontSize: 11, color: accentColor, fontWeight: 700 }}>{selected.size} seleccionada{selected.size !== 1 ? "s" : ""}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {showMail && <button className="ghost" style={{ fontSize: 10 }} onClick={() => handleMail(selectedRows)}>✉ Enviar masivo</button>}
            <button className="ghost" style={{ fontSize: 10 }} onClick={() => handleCSV(selectedRows)}>↓ CSV selección{showCbu ? " + CBU" : ""}</button>
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse" }}>
          <colgroup>
            <col style={{ width: 36 }} />    {/* checkbox */}
            <col />                           {/* sede */}
            <col style={{ width: 160 }} />   {/* importe */}
            <col style={{ width: 150 }} />   {/* recordatorio */}
            <col style={{ width: 110 }} />   {/* ver CC */}
          </colgroup>
          <thead>
            <tr>
              <th style={{ padding: "6px 8px" }}>
                <input type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = someChecked; }}
                  onChange={toggleAll} style={{ accentColor, cursor: "pointer" }} />
              </th>
              <th>Franquicia</th>
              <th style={{ textAlign: "right", paddingRight: 24 }}>Saldo</th>
              <th style={{ textAlign: "center" }}></th>
              <th style={{ textAlign: "right", paddingRight: 16 }}>
                <button className="ghost" style={{ fontSize: 9, padding: "2px 6px" }} onClick={() => handleCSV(actionRows)}>
                  ↓ CSV{showCbu ? " + CBU" : ""}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => {
              const checked = selected.has(d.fr.id);
              return (
                <tr key={d.fr.id} style={{ background: checked ? `${accentColor}08` : i % 2 === 0 ? "transparent" : "rgba(255,255,255,.013)" }}>
                  <td style={{ padding: "7px 8px", textAlign: "center" }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleOne(d.fr.id)}
                      style={{ accentColor, cursor: "pointer" }} />
                  </td>
                  <td style={{ fontWeight: 600, fontSize: 13, padding: "7px 8px" }}>
                    {d.fr.name}
                    <span style={{ marginLeft: 6, fontSize: 10, color: "var(--muted)", fontWeight: 400 }}>{curLabel}</span>
                  </td>
                  <td style={{ textAlign: "right", padding: "7px 24px 7px 8px" }}>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 800, color: accentColor }}>
                      {Math.round(Math.abs(getAmt(d))).toLocaleString("es-AR")}
                    </span>
                  </td>
                  <td style={{ padding: "7px 8px", textAlign: "center", whiteSpace: "nowrap" }}>
                    {showMail && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 120 }}>
                        <button onClick={() => handleMail([d])} title="Enviar recordatorio"
                          style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--border2)", borderRadius: 999, padding: "3px 10px", fontSize: 10, color: "var(--muted)", cursor: "pointer", fontFamily: "var(--font)", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
                          ✉ Enviar
                        </button>
                        <RecordatorioDots dots={dotsForFr(d.fr.id)} />
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", padding: "7px 16px 7px 8px" }}>
                    <button className="ghost" style={{ fontSize: 10 }} onClick={() => onOpenFr(d.fr.id)}>Ver CC →</button>
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

// ─── TAB: SALDOS ──────────────────────────────────────────────────────────────
const TabSaldos = memo(function TabSaldos({ franchises, month, year, onOpenFr, filterCur = "ALL" }) {
  const filterCurrency = filterCur === "ALL" ? null : filterCur;
  const { activeCompany } = useStore();
  const displayCurrency = filterCurrency ?? COMPANIES[activeCompany]?.currency ?? "ARS";
  const frData = useFrData(franchises, month, year, filterCurrency);

  const { deben, cobrar, pautaPend, alDia } = useMemo(() => {
    const deben     = [];
    const cobrar    = [];
    const pautaPend = [];
    const alDia     = [];
    for (const d of frData) {
      const cashDebt = Math.max(0, Math.abs(d.sa) - d.pautaPendiente);
      if (d.sa > 0.01) {
        deben.push(d);
      } else {
        if (cashDebt > 0.01)          cobrar.push(d);
        if (d.pautaPendiente > 0.01)  pautaPend.push(d);
        if (cashDebt <= 0.01 && d.pautaPendiente <= 0.01) alDia.push(d);
      }
    }
    return {
      deben:     deben.sort((a, b) => b.sa - a.sa),
      cobrar:    cobrar.sort((a, b) => (Math.abs(b.sa) - b.pautaPendiente) - (Math.abs(a.sa) - a.pautaPendiente)),
      pautaPend: pautaPend.sort((a, b) => b.pautaPendiente - a.pautaPendiente),
      alDia,
    };
  }, [frData]);

  const handleExportCSV = useCallback(() => {
    const rows = [["Franquicia","Moneda","Saldo Final","Estado"]];
    const cur = filterCurrency ?? COMPANIES[activeCompany]?.currency ?? "ARS";
    [...deben, ...cobrar, ...alDia].forEach(({ fr, sa }) =>
      rows.push([fr.name, cur, sa.toFixed(2), sa > 0.01 ? "NOS DEBEN" : sa < -0.01 ? "DEBEMOS" : "AL DÍA"])
    );
    downloadCSV(rows, `BIGG_Saldos_${MONTHS[month]}_${year}.csv`);
  }, [deben, cobrar, alDia, month, year, filterCurrency, activeCompany]);

  return (
    <div className="fade">
      <SaldosTable
        title={`Nos deben (${deben.length})`}
        data={deben}
        accentColor="var(--red)"
        bgColor="rgba(255,107,122,.08)"
        borderColor="rgba(255,107,122,.2)"
        onOpenFr={onOpenFr}
        month={month} year={year}
        displayCurrency={displayCurrency}
      />
      <SaldosTable
        title={`Debemos pagar (${cobrar.length})`}
        data={cobrar}
        accentColor="var(--green)"
        bgColor="rgba(126,217,160,.08)"
        borderColor="rgba(126,217,160,.2)"
        onOpenFr={onOpenFr}
        month={month} year={year}
        showMail={true}
        showCbu={true}
        amountFn={d => Math.max(0, Math.abs(d.sa) - d.pautaPendiente)}
        displayCurrency={displayCurrency}
      />
      <SaldosTable
        title={`Pagos a cuenta — pendiente de facturar (${pautaPend.length})`}
        data={pautaPend}
        accentColor="var(--cyan)"
        bgColor="rgba(34,211,238,.08)"
        borderColor="rgba(34,211,238,.2)"
        onOpenFr={onOpenFr}
        month={month} year={year}
        showMail={false}
        amountFn={d => d.pautaPendiente}
        displayCurrency={displayCurrency}
      />
      {alDia.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", marginTop: 8 }}>
          {alDia.length} sede{alDia.length !== 1 ? "s" : ""} al día · {alDia.map(d => d.fr.name).join(", ")}
        </div>
      )}
    </div>
  );
});

export default TabSaldos;
