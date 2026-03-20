import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../lib/context";
import { compEmpresa, compCurrency, cmpDate, MONTHS, COMP_TYPES, computeSaldoPrevMes, getSaldoInicial, fmt0 } from "../lib/helpers";
import { COMPANIES, todayDmy, dmyToIso, isoToDmy } from "../data/franchisor";
import { RecordatorioDots } from "./TabSaldos";
import { buildCCHtml } from "../lib/pdf";
import { sendMailFr } from "../lib/sheetsApi";

// Último día del mes anterior al cutoff (DD/MM/YYYY → DD/MM/YYYY)
function prevMonthEnd(dmy) {
  const [, mm, yyyy] = dmy.split("/");
  const d = new Date(parseInt(yyyy), parseInt(mm) - 1, 0); // día 0 = último día del mes anterior
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// Primer día del mes del cutoff (DD/MM/YYYY → DD/MM/YYYY)
function monthStart(dmy) {
  const [, mm, yyyy] = dmy.split("/");
  return `01/${mm}/${yyyy}`;
}

// Columnas ordenables
const COLS = [
  { key: "name",      label: "SEDE",           align: "left",  color: "var(--muted)" },
  { key: "country",   label: "PAÍS",           align: "left",  color: "var(--muted)", filterable: true },
  { key: "saldoAnt",  label: "SALDO ANT.",     align: "right", color: "var(--accent)" },
  { key: "pagosNet",  label: "PAGOS / ENVÍOS", align: "right", color: "var(--green)" },
  { key: "saldoReal", label: "SALDO REAL",     align: "right", color: "var(--accent)" },
  { key: "actions",   label: "",               align: "right", color: "var(--muted)", noSort: true },
];

function SortIcon({ dir }) {
  if (!dir) return <span style={{ opacity: 0.25, marginLeft: 3, fontSize: 9 }}>⇅</span>;
  return <span style={{ marginLeft: 3, fontSize: 9 }}>{dir === "asc" ? "▲" : "▼"}</span>;
}

function CountryDropdown({ countries, value, onChange, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div ref={ref} style={{
      position: "absolute", top: "100%", left: 0, zIndex: 200,
      background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 6,
      boxShadow: "0 4px 16px rgba(0,0,0,.4)", minWidth: 140, padding: "4px 0",
    }}>
      <div
        style={{ padding: "6px 12px", fontSize: 11, cursor: "pointer", color: value === null ? "var(--text)" : "var(--muted)",
          fontWeight: value === null ? 700 : 400, display: "flex", alignItems: "center", gap: 6 }}
        onMouseDown={() => { onChange(null); onClose(); }}
      >
        {value === null && <span style={{ fontSize: 9 }}>✓</span>}
        Todos
      </div>
      {countries.map(c => (
        <div
          key={c}
          style={{ padding: "6px 12px", fontSize: 11, cursor: "pointer",
            color: value === c ? "var(--text)" : "var(--muted)",
            fontWeight: value === c ? 700 : 400,
            background: value === c ? "rgba(255,255,255,.06)" : "transparent",
            display: "flex", alignItems: "center", gap: 6 }}
          onMouseDown={() => { onChange(c); onClose(); }}
        >
          {value === c && <span style={{ fontSize: 9 }}>✓</span>}
          {c}
        </div>
      ))}
    </div>
  );
}

function RowDeudor({ fr, saldoAnt, pagosNet, saldoReal, i, f, onOpenFr, handleMail, dotsForFr }) {
  return (
    <tr style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.012)" }}>
      <td style={{ padding: "7px 12px" }}>
        <button className="ghost" style={{ fontWeight: 600, fontSize: 12, padding: "1px 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 175, display: "block" }}
          onClick={() => onOpenFr?.(fr.id)}>{fr.name}</button>
      </td>
      <td style={{ padding: "7px 8px", color: "var(--muted)", fontSize: 11, whiteSpace: "nowrap" }}>{fr.country ?? "—"}</td>
      <td className="mono" style={{ textAlign: "right", padding: "7px 12px", fontWeight: 600,
        color: saldoAnt > 0.01 ? "var(--red)" : saldoAnt < -0.01 ? "var(--green)" : "var(--muted)" }}>
        {Math.abs(saldoAnt) > 0.01 ? `${saldoAnt < 0 ? "-" : ""}${f(Math.abs(saldoAnt))}` : <span style={{ color: "var(--dim)" }}>—</span>}
      </td>
      <td className="mono" style={{ textAlign: "right", padding: "7px 12px", color: pagosNet > 0.01 ? "var(--green)" : pagosNet < -0.01 ? "var(--orange)" : "var(--dim)" }}>
        {Math.abs(pagosNet) > 0.01 ? `${pagosNet < 0 ? "-" : ""}${f(Math.abs(pagosNet))}` : "—"}
      </td>
      <td className="mono" style={{ textAlign: "right", padding: "7px 12px", fontWeight: 700,
        color: saldoReal > 0.01 ? "var(--red)" : saldoReal < -0.01 ? "var(--green)" : "var(--muted)" }}>
        {Math.abs(saldoReal) > 0.01 ? `${saldoReal < 0 ? "-" : ""}${f(Math.abs(saldoReal))}` : <span style={{ color: "var(--muted)" }}>—</span>}
      </td>
      <td style={{ padding: "7px 16px 7px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
          <button className="ghost" style={{ fontSize: 10, padding: "2px 7px" }} onClick={() => onOpenFr?.(fr.id)}>CC</button>
          <button onClick={() => handleMail([{ fr, saldoAnt }])} title="Enviar recordatorio"
            style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--border2)", borderRadius: 999,
                     padding: "2px 8px", fontSize: 11, color: "var(--muted)", cursor: "pointer",
                     fontFamily: "var(--font)", lineHeight: 1, flexShrink: 0 }}>
            ✉
          </button>
          <span style={{ minWidth: 44, display: "inline-flex", alignItems: "center" }}>
            <RecordatorioDots dots={dotsForFr(fr.id)} />
          </span>
        </span>
      </td>
    </tr>
  );
}

function SubtotalCells({ label, tot, f, color, grand }) {
  const fs = grand ? 14 : 13;
  const fw = grand ? 800 : 700;
  return (<>
    <td colSpan={2} style={{ padding: "8px 12px", fontWeight: fw, fontSize: fs, color: "var(--muted)" }}>{label}</td>
    <td className="mono" style={{ textAlign: "right", padding: "8px 12px", fontWeight: fw, fontSize: fs,
      color: tot.saldoAnt > 0.01 ? "var(--red)" : tot.saldoAnt < -0.01 ? "var(--green)" : "var(--muted)" }}>
      {Math.abs(tot.saldoAnt) > 0.01 ? `${tot.saldoAnt < 0 ? "-" : ""}${f(Math.abs(tot.saldoAnt))}` : "—"}
    </td>
    <td className="mono" style={{ textAlign: "right", padding: "8px 12px", fontWeight: fw, color: tot.pagosNet > 0.01 ? "var(--green)" : "var(--muted)" }}>
      {tot.pagosNet > 0.01 ? f(tot.pagosNet) : "—"}
    </td>
    <td className="mono" style={{ textAlign: "right", padding: "8px 12px", fontWeight: fw, fontSize: fs, color }}>
      {Math.abs(tot.saldoReal) > 0.01 ? `${tot.saldoReal < 0 ? "-" : ""}${f(Math.abs(tot.saldoReal))}` : "—"}
    </td>
    <td />
  </>);
}

const COLGROUP = (
  <colgroup>
    <col style={{ width: 155 }} />
    <col style={{ width: 85 }} />
    <col style={{ width: 115 }} />
    <col style={{ width: 115 }} />
    <col style={{ width: 115 }} />
    <col style={{ width: 120 }} />
  </colgroup>
);

function sumGroup(group) {
  return group.reduce((acc, r) => ({
    saldoAnt:  acc.saldoAnt  + r.saldoAnt,
    pagosNet:  acc.pagosNet  + r.pagosNet,
    saldoReal: acc.saldoReal + r.saldoReal,
  }), { saldoAnt: 0, pagosNet: 0, saldoReal: 0 });
}

const TabDeudores = memo(function TabDeudores({ franchises, filterCur, onOpenFr, cutoff, soloPendiente, selectedFrIds, showDeben, setShowDeben, showOtros, setShowOtros }) {
  const { comps, saldoInicial, activeCompany, recordatorios, addRecordatorioEntry } = useStore();
  const [sortCol, setSortCol] = useState("saldoReal");
  const [sortDir, setSortDir] = useState("desc");
  const [filterCountry, setFilterCountry] = useState(null);
  const [countryDropOpen, setCountryDropOpen] = useState(false);
  const [confirmRows, setConfirmRows] = useState(null);
  const [sendingMail, setSendingMail] = useState(false);
  const [mailResult, setMailResult] = useState(null);

  const filterCurrency = filterCur === "ALL" ? null : filterCur;
  const cur = filterCurrency ?? COMPANIES[activeCompany]?.currency ?? "ARS";
  const f = (v) => fmt0(v, cur);

  // Período del mail: mes/año del cutoff
  const [, cutoffMM, cutoffYYYY] = cutoff.split("/");
  const mailMonth = parseInt(cutoffMM, 10) - 1; // 0-based
  const mailYear  = parseInt(cutoffYYYY, 10);

  // Dots: recordatorios del mes calendario actual
  const dotsForFr = useCallback((frId) => {
    const nowM = new Date().getMonth(), nowY = new Date().getFullYear();
    return (recordatorios?.[String(frId)] ?? []).filter(r => {
      const fecha = r.fecha ?? "";
      let mm, yy;
      if (fecha.includes("/")) { const p = fecha.split("/"); mm = Number(p[1]); yy = Number(p[2]); }
      else if (fecha.includes("-")) { const iso = fecha.slice(0, 10).split("-"); yy = Number(iso[0]); mm = Number(iso[1]); }
      else return false;
      return mm - 1 === nowM && yy === nowY;
    });
  }, [recordatorios]);

  const handleMail = useCallback((rows) => setConfirmRows(rows), []);

  const doSendMail = useCallback(async () => {
    if (!confirmRows) return;
    setSendingMail(true);
    const ok = [], err = [];
    for (const d of confirmRows) {
      const to = d.fr.emailFactura ?? d.fr.emailComercial ?? "";
      if (!to) { err.push(`${d.fr.name} (sin email)`); continue; }
      try {
        // Ventana de 2 meses: desde el 1er día del mes anterior al cutoff, hasta el cutoff
        const prevMonthEndDate   = prevMonthEnd(cutoff);           // e.g. "28/02/2026"
        const prevMonthStartDate = monthStart(prevMonthEndDate);   // e.g. "01/02/2026"
        const aperturaDate       = prevMonthEnd(prevMonthEndDate); // e.g. "31/01/2026"

        // Saldo apertura = saldo al fin del mes antes de la ventana
        const [, prevMM, prevYYYY] = prevMonthStartDate.split("/");
        const prevMonth = parseInt(prevMM, 10) - 1;
        const prevYear  = parseInt(prevYYYY, 10);
        const sp = computeSaldoPrevMes(d.fr.id, prevYear, prevMonth, comps, saldoInicial, null, filterCurrency, activeCompany);

        // Movimientos en la ventana: 01/prev → cutoff
        const frComps = (comps[String(d.fr.id)] ?? [])
          .filter(c =>
            cmpDate(c.date, prevMonthStartDate) >= 0 &&
            cmpDate(c.date, cutoff) <= 0 &&
            compEmpresa(c) === activeCompany &&
            (!filterCurrency || compCurrency(c) === filterCurrency)
          )
          .sort((a, b) => cmpDate(a.date, b.date));

        let running = sp;
        const compsWithSaldo = frComps.map(c => {
          const sign = COMP_TYPES[c.type]?.sign ?? 0;
          running += sign * c.amount;
          return { ...c, saldo: running };
        });
        const ccLines = [
          { type: "apertura", debit: 0, credit: 0, saldo: sp, date: aperturaDate },
          ...compsWithSaldo.map(c => {
            const sign = COMP_TYPES[c.type]?.sign ?? 0;
            return sign >= 0 ? { ...c, debit: c.amount, credit: 0 } : { ...c, debit: 0, credit: c.amount };
          }),
        ];
        const ccHtml = buildCCHtml(d.fr.name, d.fr.razonSocial ?? null, ccLines, cur, mailMonth, mailYear);
        await sendMailFr({
          to,
          subject: `Estado de Cuenta ${d.fr.name} — ${MONTHS[mailMonth]} ${mailYear}`,
          htmlBody: ccHtml,
          attachments: [],
        });
        addRecordatorioEntry(d.fr.id, { fecha: todayDmy(), ccMes: mailMonth + 1, ccAnio: mailYear, to });
        ok.push(d.fr.name);
      } catch (e) { err.push(`${d.fr.name} (${e.message})`); }
    }
    setSendingMail(false);
    setConfirmRows(null);
    setMailResult({ ok, err });
  }, [confirmRows, comps, saldoInicial, activeCompany, cutoff, filterCurrency, cur, mailMonth, mailYear, addRecordatorioEntry]);

  const mesInicio = useMemo(() => monthStart(cutoff), [cutoff]);

  // Países disponibles (de las franquicias activas, ordenados)
  const countries = useMemo(() => {
    const set = new Set(franchises.map(fr => fr.country).filter(Boolean));
    return [...set].sort();
  }, [franchises]);

  const handleSort = (key) => {
    if (sortCol === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(key);
      setSortDir(key === "name" || key === "country" ? "asc" : "desc");
    }
  };

  const rows = useMemo(() => {
    const data = franchises
      .map(fr => {
        const key        = String(fr.id);
        const frCurrency = fr.currency ?? fr.moneda ?? "ARS";
        const si         = getSaldoInicial(saldoInicial, key, activeCompany, frCurrency, filterCurrency);

        // Acumuladores
        // Ant = hasta fin del mes anterior (todo incluido, PAGO_PAUTA cerrado con FC)
        // Mes = movimientos del mes seleccionado hasta cutoff
        let fAnt = 0, ncAnt = 0, pAnt = 0, ppAnt = 0, eAnt = 0;
        let fMes = 0, ncMes = 0, pMes = 0, ppMes = 0, eMes = 0;

        for (const c of (comps[key] ?? [])) {
          if (cmpDate(c.date, cutoff) > 0) continue;
          if (activeCompany && compEmpresa(c) !== activeCompany) continue;
          if (filterCurrency && compCurrency(c) !== filterCurrency) continue;
          const amt    = c.amount ?? 0;
          const t      = c.type ?? "";
          const enMes  = cmpDate(c.date, mesInicio) >= 0;

          if      (t.startsWith("FACTURA|")) { if (enMes) fMes  += amt; else fAnt  += amt; }
          else if (t.startsWith("NC|"))      { if (enMes) ncMes += amt; else ncAnt += amt; }
          else if (t === "PAGO")             { if (enMes) pMes  += amt; else pAnt  += amt; }
          else if (t === "PAGO_PAUTA")       { if (enMes) ppMes += amt; else ppAnt += amt; }
          else if (t === "PAGO_ENVIADO")     { if (enMes) eMes  += amt; else eAnt  += amt; }
        }

        // Saldo ant: todo incluido (PAGO_PAUTA del mes anterior ya tiene su FC)
        const saldoAnt  = si + fAnt - ncAnt - pAnt - ppAnt + eAnt;
        // Columna pagos/envíos: solo PAGO real del mes (sin PAGO_PAUTA)
        const pagosNet  = pMes - eMes;
        // Saldo real: balance al cutoff excluyendo ppMes (adelanto sin FC emitida aún)
        const saldoReal = saldoAnt + fMes - ncMes - pMes + eMes;

        const hasActivity = si !== 0 || Math.abs(saldoAnt) > 0.01 || Math.abs(pagosNet) > 0.01 || ppMes > 0.01;
        if (!hasActivity) return null;
        if (fr.activa === false && Math.abs(saldoReal) < 1) return null;
        if (selectedFrIds?.size > 0 && !selectedFrIds.has(fr.id)) return null;
        if (filterCountry && fr.country !== filterCountry) return null;
        return { fr, saldoAnt, pagosNet, saldoReal };
      })
      .filter(Boolean);

    return data.sort((a, b) => {
      let av, bv;
      if (sortCol === "name")         { av = a.fr.name?.toLowerCase() ?? ""; bv = b.fr.name?.toLowerCase() ?? ""; }
      else if (sortCol === "country") { av = a.fr.country?.toLowerCase() ?? ""; bv = b.fr.country?.toLowerCase() ?? ""; }
      else { av = a[sortCol] ?? 0; bv = b[sortCol] ?? 0; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [franchises, comps, saldoInicial, activeCompany, cutoff, mesInicio, filterCurrency, sortCol, sortDir, filterCountry, selectedFrIds]);

  // Si nos debían (saldoAnt > 0) y pagaron, van a NOS DEBEN aunque saldoReal ≤ 0
  // umbral 0.5: coincide con el redondeo de maximumFractionDigits:0 (< 0.5 muestra "$0")
  const { rowsDeben, rowsOtros, totDeben, totOtros, totGrand } = useMemo(() => {
    const visible = soloPendiente ? rows.filter(r => Math.abs(r.saldoReal) >= 0.5) : rows;
    const debe = visible.filter(r => r.saldoReal > 0.01 || r.saldoAnt > 0.01);
    const otros = visible.filter(r => r.saldoReal <= 0.01 && r.saldoAnt <= 0.01);
    return {
      rowsDeben: debe,
      rowsOtros: otros,
      totDeben:  sumGroup(debe),
      totOtros:  sumGroup(otros),
      totGrand:  sumGroup(visible),
    };
  }, [rows, soloPendiente]);

  const thBase = { padding: "8px 12px", fontWeight: 700, fontSize: 11, letterSpacing: ".06em", cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" };

  const thead = () => (
    <thead>
      <tr style={{ borderBottom: "2px solid var(--border2)", background: "var(--bg2)" }}>
        {COLS.map(col => (
          <th
            key={col.key}
            style={{
              ...thBase,
              position: "relative",
              textAlign: col.align,
              color: (sortCol === col.key || (col.filterable && filterCountry)) ? col.color : "var(--muted)",
              opacity: (sortCol === col.key || (col.filterable && filterCountry)) ? 1 : 0.75,
              paddingLeft: col.align === "left" ? (col.key === "country" ? 8 : 12) : undefined,
              paddingRight: col.align === "left" ? (col.key === "country" ? 8 : 12) : undefined,
            }}
            onClick={() => {
              if (col.noSort) return;
              if (col.filterable && countries.length > 1) {
                setCountryDropOpen(v => !v);
              } else {
                handleSort(col.key);
              }
            }}
          >
            {col.label}
            {col.filterable && countries.length > 1
              ? <span style={{ marginLeft: 3, fontSize: 9, opacity: filterCountry ? 1 : 0.4 }}>▾</span>
              : <SortIcon dir={sortCol === col.key ? sortDir : null} />
            }
            {filterCountry && col.filterable && (
              <span style={{ marginLeft: 2, fontSize: 9, color: "var(--accent)" }}>({filterCountry})</span>
            )}
            {col.filterable && countryDropOpen && countries.length > 1 && (
              <CountryDropdown
                countries={countries}
                value={filterCountry}
                onChange={setFilterCountry}
                onClose={() => setCountryDropOpen(false)}
              />
            )}
          </th>
        ))}
      </tr>
    </thead>
  );


  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

      {/* Modal confirmación envío */}
      {confirmRows && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div className="fade" style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 14, padding: 28, maxWidth: 460, width: "100%" }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>Confirmar envío</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
              Estás por enviar el estado de cuenta de <strong style={{ color: "var(--text)" }}>{MONTHS[mailMonth]} {mailYear}</strong> a:
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
        <div style={{ padding: "10px 14px", background: "rgba(173,255,25,.06)", border: "1px solid rgba(173,255,25,.2)", borderRadius: 8, fontSize: 12 }}>
          {mailResult.ok.length > 0 && <div style={{ color: "var(--green)" }}>✓ Enviado a: {mailResult.ok.join(", ")}</div>}
          {mailResult.err.length > 0 && <div style={{ color: "var(--red)", marginTop: 4 }}>✕ Error: {mailResult.err.join(", ")}</div>}
          <button className="ghost" style={{ fontSize: 10, marginTop: 6 }} onClick={() => setMailResult(null)}>Cerrar</button>
        </div>
      )}

      {/* Caja 1: NOS DEBEN */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div
          style={{ padding: "8px 16px", borderBottom: "1px solid var(--border2)", background: "rgba(255,85,112,.07)", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
          onClick={() => setShowDeben(v => !v)}
        >
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".08em", color: "var(--red)" }}>NOS DEBEN</span>
          {totDeben.saldoReal > 0.01 && (
            <span style={{ fontSize: 13, color: "var(--red)", fontWeight: 800 }}>{f(totDeben.saldoReal)}</span>
          )}
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>{rowsDeben.length} sedes</span>
          <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--muted)", opacity: 0.6 }}>{showDeben ? "▲" : "▼"}</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
            {COLGROUP}
            {thead()}
            <tbody>
              <tr style={{ borderBottom: "2px solid rgba(255,85,112,.4)", background: "rgba(255,85,112,.04)" }}>
                <SubtotalCells label="SUBTOTAL" tot={totDeben} f={f} color="var(--red)" />
              </tr>
              {showDeben && (rowsDeben.length === 0
                ? <tr><td colSpan={6} style={{ textAlign: "center", padding: 20, color: "var(--muted)", fontSize: 12 }}>Sin deudores</td></tr>
                : rowsDeben.map(({ fr, saldoAnt, pagosNet, saldoReal }, i) => (
                    <RowDeudor key={fr.id} fr={fr} saldoAnt={saldoAnt} pagosNet={pagosNet} saldoReal={saldoReal} i={i} f={f} onOpenFr={onOpenFr} handleMail={handleMail} dotsForFr={dotsForFr} />
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Caja 2: DEBEMOS (colapsable) */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div
          style={{ padding: "8px 16px", borderBottom: "1px solid var(--border2)", background: "rgba(16,217,122,.07)", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
          onClick={() => setShowOtros(v => !v)}
        >
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".08em", color: "var(--green)" }}>DEBEMOS</span>
          {Math.abs(totOtros.saldoReal) > 0.01 && (
            <span style={{ fontSize: 13, color: totOtros.saldoReal < 0 ? "var(--green)" : "var(--red)", fontWeight: 800 }}>
              {totOtros.saldoReal < 0 ? "-" : ""}{f(Math.abs(totOtros.saldoReal))}
            </span>
          )}
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>{rowsOtros.length} sedes</span>
          <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--muted)", opacity: 0.6 }}>{showOtros ? "▲" : "▼"}</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
            {COLGROUP}
            {thead()}
            <tbody>
              <tr style={{ borderBottom: "2px solid rgba(16,217,122,.4)", background: "rgba(16,217,122,.04)" }}>
                <SubtotalCells label="SUBTOTAL" tot={totOtros} f={f} color="var(--green)" />
              </tr>
              {showOtros && (rowsOtros.length === 0
                ? <tr><td colSpan={6} style={{ textAlign: "center", padding: 20, color: "var(--muted)", fontSize: 12 }}>Sin registros</td></tr>
                : rowsOtros.map(({ fr, saldoAnt, pagosNet, saldoReal }, i) => (
                    <RowDeudor key={fr.id} fr={fr} saldoAnt={saldoAnt} pagosNet={pagosNet} saldoReal={saldoReal} i={i} f={f} onOpenFr={onOpenFr} handleMail={handleMail} dotsForFr={dotsForFr} />
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Total General */}
      <div className="card" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          {COLGROUP}
          <tbody>
            <tr style={{ background: "rgba(255,255,255,.03)" }}>
              <SubtotalCells label="TOTAL GENERAL" tot={totGrand} f={f} color="var(--accent)" grand />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
});

export default TabDeudores;

