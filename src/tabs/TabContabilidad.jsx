import { memo, useState, useMemo } from "react";
import React from "react";
import { useStore } from "../lib/context";
import { computeSaldoPrevMes, COMP_TYPES, CUENTAS, CUENTA_LABEL, SKIP_CC_TYPES, fmt, fmtS } from "../lib/helpers";
import { inPeriod, cmpDate, dmyToIso, isoToDmy } from "../data/franchisor";

// ─── TAB: DETALLE — vista base de datos con filtros por columna ──────────────
// Para el filtro de Contabilidad filtramos por CUENTA (no por tipo de doc)
const getCuenta = (type) => {
  if (!type || !type.includes("|")) return type; // movimientos financieros
  return type.split("|")[1]; // "FACTURA|FEE" → "FEE"
};

const TabContabilidad = memo(function TabContabilidad({ franchises, month, year, onOpenFr, initialFilter, initialTipo, showAll, multiCurrency }) {
  const { comps, saldoInicial, editComp } = useStore();

  // ── Filtros ──────────────────────────────────────────────────────────────────
  const [fSede,      setFSede]      = useState("");
  const [fCuenta,    setFCuenta]    = useState(() => {
    if (!initialTipo) return new Set();
    const vals = Array.isArray(initialTipo) ? initialTipo : [getCuenta(initialTipo)];
    return new Set(vals);
  });
  const [fConcepto,  setFConcepto]  = useState("");
  const [sortCol,    setSortCol]    = useState("date");
  const [sortDir,    setSortDir]    = useState(1);
  const [editRowId,  setEditRowId]  = useState(null);
  const [editBufTC,  setEditBufTC]  = useState({});

  // ── Construir filas libro mayor ──────────────────────────────────────────────
  // Una fila por asiento contable, con saldo acumulado por franquicia
  const allRows = useMemo(() => {
    const out = [];
    for (const fr of franchises) {
      const key      = String(fr.id);
      const allComps = (comps[key] ?? []).filter(c => !SKIP_CC_TYPES.has(c.type));
      const frComps  = !showAll
        ? allComps.filter(c => inPeriod(c, month, year))
        : allComps;
      const sorted   = [...frComps].sort((a, b) => cmpDate(a.date, b.date));
      const sp       = !showAll
        ? computeSaldoPrevMes(fr.id, year, month, comps, saldoInicial)
        : (saldoInicial[key] ?? 0);

      // Calcular la fecha de cierre del período anterior
      const prevMonth = !showAll ? (month === 0 ? 11 : month - 1) : null;
      const prevYear  = !showAll ? (month === 0 ? year - 1 : year) : null;
      const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
      const DAYS_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];
      const prevLastDay = !showAll ? DAYS_IN_MONTH[prevMonth] : null;
      const aperturaDate    = !showAll ? `${prevLastDay}/${String(prevMonth + 1).padStart(2,"0")}/${prevYear}` : "31/12/2025";
      const aperturaLabel   = !showAll ? `${prevLastDay}/${String(prevMonth + 1).padStart(2,"0")}/${prevYear}` : "31/12/2025";
      const aperturaTipo    = !showAll ? `Saldo ${prevLastDay} ${MONTHS_ES[prevMonth]} ${prevYear}` : "Saldo 31/12/2025";
      const aperturaConcepto = !showAll ? `Saldo al ${prevLastDay}/${String(prevMonth + 1).padStart(2,"0")}/${prevYear}` : "Saldo al 31/12/2025";

      // Fila apertura
      out.push({
        frId: fr.id, frName: fr.name, currency: fr.currency,
        date: !showAll ? `${year}-${String(month).padStart(2,"0")}-00` : "00/00/0000",
        displayDate: aperturaLabel,
        tipo: "__apertura__", tipoLabel: aperturaTipo,
        cuenta: null,
        concepto: aperturaConcepto,
        ref: "—",
        debe: sp > 0 ? sp : 0,
        haber: sp < 0 ? Math.abs(sp) : 0,
        saldo: sp,
        isApertura: true,
      });

      let saldoAcum = sp;
      for (const c of sorted) {
        const sign  = COMP_TYPES[c.type]?.sign ?? 0;
        const debe  = sign === +1 ? c.amount : 0;
        const haber = sign === -1 ? c.amount : 0;
        saldoAcum  += debe - haber;
        out.push({
          frId: fr.id, frName: fr.name, currency: fr.currency,
          date: c.date,
          displayDate: c.date,
          tipo: c.type,
          tipoLabel: COMP_TYPES[c.type]?.label ?? c.type,
          cuenta: getCuenta(c.type),
          concepto: c.nota ?? "—",
          ref: c.ref ?? "—",
          debe, haber, saldo: saldoAcum,
          isApertura: false,
          compId: c.id,
        });
      }
    }
    return out;
  }, [franchises, comps, saldoInicial, month, year, showAll]);

  // ── Filtrar ──────────────────────────────────────────────────────────────────
  const cuentasPresentes = useMemo(() => {
    const s = new Set(allRows.filter(r => !r.isApertura && r.cuenta).map(r => r.cuenta));
    return [...s];
  }, [allRows]);

  const filtered = useMemo(() => {
    // ── 1. Aplicar filtros
    let rows = allRows;
    if (fSede)            rows = rows.filter(r => r.frName.toLowerCase().includes(fSede.toLowerCase()));
    if (fConcepto)        rows = rows.filter(r => r.isApertura || r.concepto.toLowerCase().includes(fConcepto.toLowerCase()));
    if (fCuenta.size > 0) rows = rows.filter(r => r.isApertura ? fCuenta.has("__apertura__") : fCuenta.has(r.cuenta));

    // ── 2. Ordenar cronológicamente (fecha, luego sede alfabético) para acumular
    rows = [...rows].sort((a, b) => cmpDate(a.date, b.date) || a.frName.localeCompare(b.frName));

    // ── 3. Calcular saldo individual por sede (para colorear) y acumulado global (para columna)
    const acumSede = {};
    let   acumGlobal = 0;
    rows = rows.map(r => {
      const sedeSaldo = (acumSede[r.frId] ?? 0) + r.debe - r.haber;
      acumSede[r.frId] = sedeSaldo;
      acumGlobal += r.debe - r.haber;
      return { ...r, saldo: acumGlobal, saldoSede: sedeSaldo };
    });

    // ── 4. Aplicar sort del usuario
    return [...rows].sort((a, b) => {
      if (sortCol === "date")  return sortDir * cmpDate(a.date, b.date) || a.frName.localeCompare(b.frName);
      if (sortCol === "sede")  return sortDir * a.frName.localeCompare(b.frName) || cmpDate(a.date, b.date);
      if (sortCol === "debe")  return sortDir * (b.debe - a.debe);
      if (sortCol === "haber") return sortDir * (b.haber - a.haber);
      if (sortCol === "saldo") return sortDir * (b.saldo - a.saldo);
      return 0;
    });
  }, [allRows, fSede, fCuenta, fConcepto, sortCol, sortDir]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => -d); else { setSortCol(col); setSortDir(1); }
  };
  const Arr = ({ col }) => <span style={{ color: "var(--muted)", fontSize: 9 }}>{sortCol === col ? (sortDir === 1 ? " ▲" : " ▼") : " ·"}</span>;

  const totalDebe  = filtered.filter(r => !r.isApertura).reduce((a, r) => a + r.debe,  0);
  const totalHaber = filtered.filter(r => !r.isApertura).reduce((a, r) => a + r.haber, 0);
  // saldo ya es acumulado global — el último valor cronológico es el total final
  const saldoFinalConsolidado = useMemo(() => {
    const cronRows = [...filtered].sort((a, b) => cmpDate(a.date, b.date) || a.frName.localeCompare(b.frName));
    return cronRows.length > 0 ? cronRows[cronRows.length - 1].saldo : 0;
  }, [filtered]);

  const [openFilter, setOpenFilter] = useState(null);
  const [filterPos, setFilterPos] = React.useState({ top: 0, left: 0 });
  const toggleFilter = (col, e) => {
    if (e) {
      const r = e.currentTarget.closest("th").getBoundingClientRect();
      setFilterPos({ top: r.bottom + 4, left: r.left });
    }
    setOpenFilter(f => f === col ? null : col);
  };

  const FilterPopover = ({ col, children }) => openFilter !== col ? null : (
    <div onClick={e => e.stopPropagation()} style={{
      position: "fixed", top: filterPos.top, left: filterPos.left, zIndex: 9999,
      background: "var(--bg2)", border: "1px solid var(--border2)",
      borderRadius: 8, padding: "10px 12px", minWidth: 210,
      boxShadow: "0 8px 32px rgba(0,0,0,.7)",
    }}>
      {children}
    </div>
  );

  return (
    <div className="fade" onClick={() => setOpenFilter(null)}>

      {/* ── Tabla libro mayor ─────────────────────────────────────────────────── */}
      <div className="card" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse" }}>
          <colgroup>
            <col style={{ width: 88 }} />   {/* Fecha */}
            <col style={{ width: 150 }} />  {/* Sede */}
            <col style={{ width: 120 }} />  {/* Cuenta */}
            <col />                          {/* Concepto — flex */}
            <col style={{ width: 130 }} />  {/* Debe */}
            <col style={{ width: 130 }} />  {/* Haber */}
            {!multiCurrency && <col style={{ width: 130 }} />}{/* Saldo */}
            <col style={{ width: 80 }} />   {/* Limpiar */}
          </colgroup>
          <thead style={{ position: "sticky", top: 0, background: "var(--bg2)", zIndex: 2 }}>
            <tr>
              <th onClick={() => toggleSort("date")} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>Fecha<Arr col="date" /></th>
              <th style={{ position: "relative" }}>
                <span onClick={() => toggleSort("sede")} style={{ cursor: "pointer", userSelect: "none" }}>Sede<Arr col="sede" /></span>
                <span onClick={e => { e.stopPropagation(); toggleFilter("sede", e); }}
                  style={{ marginLeft: 5, cursor: "pointer", opacity: fSede ? 1 : 0.4, color: fSede ? "var(--accent)" : "inherit", fontSize: 11 }}>⌕</span>
                <FilterPopover col="sede">
                  <input autoFocus placeholder="Buscar sede..." value={fSede} onChange={e => setFSede(e.target.value)}
                    style={{ width: "100%", padding: "5px 8px", fontSize: 12, borderRadius: 5, background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)", fontFamily: "var(--font)" }} />
                  {fSede && <button className="ghost" style={{ fontSize: 10, marginTop: 5 }} onClick={() => setFSede("")}>✕ limpiar</button>}
                </FilterPopover>
              </th>
              <th style={{ position: "relative" }}>
                <span>Cuenta</span>
                <span onClick={e => { e.stopPropagation(); toggleFilter("cuenta", e); }}
                  style={{ marginLeft: 5, cursor: "pointer", opacity: fCuenta.size > 0 ? 1 : 0.4, color: fCuenta.size > 0 ? "var(--accent)" : "inherit", fontSize: 11 }}>⌕</span>
                {fCuenta.size > 0 && <span style={{ marginLeft: 4, fontSize: 9, background: "var(--accent)", color: "#1e2022", borderRadius: 99, padding: "1px 5px", fontWeight: 800 }}>{fCuenta.size}</span>}
                <FilterPopover col="cuenta">
                  {(() => {
                    const ALL_OPTS = [...CUENTAS.map(c => [c, CUENTA_LABEL[c]]), ["PAGO","Pagos Recibidos"], ["PAGO_PAUTA","Pagos a Cuenta"], ["PAGO_ENVIADO","Trf. Enviadas"], ["__apertura__","Saldo Inicial"]];
                    const allVals = ALL_OPTS.map(([v]) => v);
                    const allSelected = allVals.every(v => fCuenta.has(v));
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {/* Select all / clear row */}
                        <div style={{ display: "flex", gap: 6, marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
                          <button className="ghost" style={{ fontSize: 10, flex: 1 }}
                            onClick={() => setFCuenta(allSelected ? new Set() : new Set(allVals))}>
                            {allSelected ? "✕ Ninguna" : "✓ Todas"}
                          </button>
                          {fCuenta.size > 0 && !allSelected && (
                            <button className="ghost" style={{ fontSize: 10, flex: 1 }}
                              onClick={() => setFCuenta(new Set())}>✕ Limpiar</button>
                          )}
                        </div>
                        {ALL_OPTS.map(([val, lbl]) => (
                          <label key={val} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, cursor: "pointer", padding: "4px 6px", borderRadius: 5, background: fCuenta.has(val) ? "rgba(173,255,25,.08)" : "transparent" }}>
                            <input type="checkbox" checked={fCuenta.has(val)} onChange={() => {
                              setFCuenta(prev => { const n = new Set(prev); n.has(val) ? n.delete(val) : n.add(val); return n; });
                            }} style={{ accentColor: "var(--accent)", cursor: "pointer" }} />
                            <span style={{ color: fCuenta.has(val) ? "var(--accent)" : "var(--text)" }}>{lbl}</span>
                          </label>
                        ))}
                      </div>
                    );
                  })()}
                </FilterPopover>
              </th>
              <th style={{ position: "relative", paddingLeft: 18 }}>
                <span>Descripción</span>
                <span onClick={e => { e.stopPropagation(); toggleFilter("concepto", e); }}
                  style={{ marginLeft: 5, cursor: "pointer", opacity: fConcepto ? 1 : 0.4, color: fConcepto ? "var(--accent)" : "inherit", fontSize: 11 }}>⌕</span>
                <FilterPopover col="concepto">
                  <input autoFocus placeholder="Buscar descripción..." value={fConcepto} onChange={e => setFConcepto(e.target.value)}
                    style={{ width: "100%", padding: "5px 8px", fontSize: 12, borderRadius: 5, background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)", fontFamily: "var(--font)" }} />
                  {fConcepto && <button className="ghost" style={{ fontSize: 10, marginTop: 5 }} onClick={() => setFConcepto("")}>✕ limpiar</button>}
                </FilterPopover>
              </th>
              <th onClick={() => toggleSort("debe")}  style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }}>Debe<Arr col="debe" /></th>
              <th onClick={() => toggleSort("haber")} style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }}>Haber<Arr col="haber" /></th>
              {!multiCurrency && <th onClick={() => toggleSort("saldo")} style={{ textAlign: "right", cursor: "pointer", userSelect: "none" }}>Saldo<Arr col="saldo" /></th>}
              <th style={{ textAlign: "right" }}>{(fSede || fCuenta.size > 0 || fConcepto) && (
                <button className="ghost" style={{ fontSize: 9, padding: "2px 5px", whiteSpace: "nowrap" }}
                  onClick={() => { setFSede(""); setFCuenta(new Set()); setFConcepto(""); }}>✕ limpiar</button>
              )}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 32, color: "var(--muted)", fontSize: 13 }}>Sin resultados</td></tr>
            )}
            {filtered.map((r, i) => {
              const isNewFr = i === 0 || filtered[i - 1].frId !== r.frId;
              const isEd = !r.isApertura && editRowId === r.compId && (r.tipo === "PAGO" || r.tipo === "PAGO_PAUTA" || r.tipo === "PAGO_ENVIADO");
              const inpS = { padding: "3px 6px", fontSize: 11, borderRadius: 5, background: "var(--bg)", border: "1px solid var(--accent)", color: "var(--text)", fontFamily: "var(--font)" };
              return (
                <tr key={`${r.frId}-${r.compId ?? "ap"}-${i}`} style={{
                  background: isEd ? "rgba(173,255,25,.06)" : r.isApertura
                    ? "rgba(173,255,25,.04)"
                    : i % 2 === 0 ? "transparent" : "rgba(255,255,255,.012)",
                  borderTop: isNewFr && i > 0 ? "2px solid var(--border2)" : undefined,
                }}>
                  {/* Fecha */}
                  <td className="mono" style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", padding: "6px 8px" }}>
                    {isEd
                      ? <input type="date" value={dmyToIso(editBufTC.date)} onChange={e => setEditBufTC(b => ({ ...b, date: isoToDmy(e.target.value) }))} style={{ ...inpS, width: 114, colorScheme: "dark" }} />
                      : r.isApertura ? <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 10 }}>{r.displayDate}</span> : r.displayDate}
                  </td>
                  {/* Sede */}
                  <td style={{ padding: "6px 4px", overflow: "hidden" }}>
                    <button className="ghost" style={{ fontSize: 11, padding: "1px 4px", fontWeight: isNewFr ? 700 : 400, color: isNewFr ? "var(--text)" : "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%", display: "block" }} onClick={() => onOpenFr(r.frId)}>{r.frName}</button>
                  </td>
                  {/* Tipo/Cuenta */}
                  <td style={{ padding: "6px 4px" }}>
                    {r.isApertura
                      ? <span className="pill" style={{ color: "var(--accent)", background: "rgba(173,255,25,.08)", fontSize: 9 }}>Saldo Ant.</span>
                      : <span className="pill" style={{ color: COMP_TYPES[r.tipo]?.color ?? "var(--muted)", background: `${COMP_TYPES[r.tipo]?.color ?? "#fff"}18`, fontSize: 9, whiteSpace: "nowrap" }}>{r.tipoLabel}</span>
                    }
                  </td>
                  {/* Descripción */}
                  <td style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "6px 8px 6px 18px" }}>
                    {isEd
                      ? <input value={editBufTC.concepto} onChange={e => setEditBufTC(b => ({ ...b, concepto: e.target.value }))} style={{ ...inpS, width: "100%" }} placeholder="Descripción..." />
                      : r.concepto}
                  </td>
                  {/* Debe */}
                  <td className="mono" style={{ textAlign: "right", fontSize: 12, color: "var(--red)", fontWeight: r.debe > 0 ? 700 : 400, padding: "6px 8px", whiteSpace: "nowrap" }}>
                    {isEd && r.debe > 0
                      ? <input type="number" min="0" step="0.01" value={editBufTC.amount} onChange={e => setEditBufTC(b => ({ ...b, amount: e.target.value }))} style={{ ...inpS, width: 88, textAlign: "right" }} />
                      : r.debe > 0 ? fmt(r.debe, r.currency) : <span style={{ color: "var(--dim)" }}>—</span>}
                  </td>
                  {/* Haber */}
                  <td className="mono" style={{ textAlign: "right", fontSize: 12, color: "var(--green)", fontWeight: r.haber > 0 ? 700 : 400, padding: "6px 8px", whiteSpace: "nowrap" }}>
                    {isEd && r.haber > 0
                      ? <input type="number" min="0" step="0.01" value={editBufTC.amount} onChange={e => setEditBufTC(b => ({ ...b, amount: e.target.value }))} style={{ ...inpS, width: 88, textAlign: "right" }} />
                      : r.haber > 0 ? fmt(r.haber, r.currency) : <span style={{ color: "var(--dim)" }}>—</span>}
                  </td>
                  {/* Saldo */}
                  {!multiCurrency && <td style={{ textAlign: "right", padding: "6px 8px", whiteSpace: "nowrap" }}>
                    <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: r.saldo > 0.01 ? "var(--red)" : r.saldo < -0.01 ? "var(--green)" : "var(--muted)" }}>
                      {fmtS(r.saldo, r.currency)}
                    </span>
                  </td>}
                  <td style={{ padding: "6px 4px", textAlign: "right" }}>
                    {isEd ? (
                      <span style={{ display: "flex", gap: 3, justifyContent: "flex-end" }}>
                        <button className="btn" style={{ fontSize: 10, padding: "2px 7px" }} onClick={() => {
                          if (editComp) editComp(editBufTC.frId, editRowId, { date: editBufTC.date, nota: editBufTC.concepto, ref: editBufTC.concepto, amount: parseFloat(String(editBufTC.amount).replace(",", ".")) || 0 });
                          setEditRowId(null);
                        }}>✓</button>
                        <button className="ghost" style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => setEditRowId(null)}>✕</button>
                      </span>
                    ) : !r.isApertura && r.compId && (r.tipo === "PAGO" || r.tipo === "PAGO_PAUTA" || r.tipo === "PAGO_ENVIADO") ? (
                      <button className="ghost" style={{ fontSize: 12, padding: "2px 5px", opacity: .5 }} title="Editar" onClick={() => {
                        setEditRowId(r.compId);
                        setEditBufTC({ date: r.displayDate, concepto: r.concepto === "—" ? "" : r.concepto, amount: r.debe > 0 ? r.debe : r.haber, frId: r.frId });
                      }}>✎</button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* Totales */}
          {filtered.some(r => !r.isApertura) && (
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--border2)", background: "rgba(255,255,255,.02)" }}>
                <td colSpan={3} style={{ fontSize: 11, color: "var(--muted)", padding: "8px 10px", fontWeight: 700 }}>
                  TOTALES — {filtered.filter(r => !r.isApertura).length} movimientos
                </td>
                <td style={{ padding: "8px 8px" }}>
                  {!multiCurrency && <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>SALDO FINAL</span>}
                </td>
                <td className="mono" style={{ textAlign: "right", color: "var(--red)", fontWeight: 800, fontSize: 13, padding: "8px 8px" }}>{fmt(totalDebe, franchises[0]?.currency ?? "ARS")}</td>
                <td className="mono" style={{ textAlign: "right", color: "var(--green)", fontWeight: 800, fontSize: 13, padding: "8px 8px" }}>{fmt(totalHaber, franchises[0]?.currency ?? "ARS")}</td>
                {!multiCurrency && <td style={{ textAlign: "right", padding: "8px 8px" }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: saldoFinalConsolidado > 0.01 ? "var(--red)" : saldoFinalConsolidado < -0.01 ? "var(--green)" : "var(--muted)" }}>
                    {fmtS(saldoFinalConsolidado, franchises[0]?.currency ?? "ARS")}
                  </span>
                </td>}
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
});

export default TabContabilidad;
