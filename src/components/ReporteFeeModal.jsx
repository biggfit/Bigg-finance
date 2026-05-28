import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { MONTHS, AVAILABLE_YEARS, makeType } from "../lib/helpers";

// ─── helpers ────────────────────────────────────────────────────────────────
const fmtMoney = (n, cur = "ARS") => {
  if (!n && n !== 0) return "—";
  const abs = Math.abs(n);
  const sym = cur === "USD" ? "U$D " : cur === "EUR" ? "€ " : "$ ";
  return sym + abs.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function prevMonth(month, year) {
  return month === 0 ? { month: 11, year: year - 1 } : { month: month - 1, year };
}

function sumFee(frComps, year, month) {
  const factType = makeType("FACTURA", "FEE");
  const ncType   = makeType("NC",      "FEE");
  return frComps
    .filter(c => c.month === month && c.year === year && (c.type === factType || c.type === ncType))
    .reduce((s, c) => s + (c.type === ncType ? -(c.amount || 0) : (c.amount || 0)), 0);
}

function sumFeeYTD(frComps, year, upToMonth) {
  const factType = makeType("FACTURA", "FEE");
  const ncType   = makeType("NC",      "FEE");
  return frComps
    .filter(c => c.year === year && c.month <= upToMonth && (c.type === factType || c.type === ncType))
    .reduce((s, c) => s + (c.type === ncType ? -(c.amount || 0) : (c.amount || 0)), 0);
}

// ─── lógica del reporte ──────────────────────────────────────────────────────
function buildRows(franchises, comps, year, month) {
  const prev = prevMonth(month, year);
  const rows = [];

  for (const fr of franchises) {
    if (fr.activa === false) continue;

    const frComps = comps[fr.id] ?? [];
    const feeType = makeType("FACTURA", "FEE");

    // Fee del mes seleccionado
    const feeComps  = frComps.filter(c => c.type === feeType && c.month === month && c.year === year);
    const feeMes    = feeComps.reduce((s, c) => s + (c.amount || 0), 0);

    // Fee del mes anterior al seleccionado
    const feePrev   = sumFee(frComps, prev.year, prev.month);

    // YTD: enero hasta el mes seleccionado (mismo año)
    const feeYTD    = sumFeeYTD(frComps, year, month);

    // Incluir todas las sedes activas, tengan o no fee facturado

    const feeCurrency = (feeComps[0]?.currency) ??
      frComps.find(c => c.type === makeType("FACTURA","FEE"))?.currency ??
      fr.feeMoneda ?? fr.currency ?? "ARS";

    rows.push({
      sede:        fr.name,
      sociedad:    fr.sociedad ?? "—",
      pais:        fr.country  ?? "—",
      moneda:      feeCurrency,
      feeYTD,
      feePrev,
      feeMes,
      sinFeeMes:   feeMes === 0,   // flag para estilo y conteo
    });
  }

  return rows.sort((a, b) =>
    a.sociedad.localeCompare(b.sociedad) ||
    // primero las que tienen fee, después las que tienen cero
    (a.sinFeeMes === b.sinFeeMes ? b.feeMes - a.feeMes : a.sinFeeMes ? 1 : -1)
  );
}

// ─── descarga Excel ──────────────────────────────────────────────────────────
function downloadExcel(rows, year, month, cotiz = 1200) {
  const prev  = prevMonth(month, year);
  const wb    = XLSX.utils.book_new();
  const bySoc = {};
  for (const r of rows) {
    if (!bySoc[r.sociedad]) bySoc[r.sociedad] = [];
    bySoc[r.sociedad].push(r);
  }

  const HEADERS = [
    "Sede", "País", "Moneda",
    `Fee ${MONTHS[month]} ${year}`,
    `Var % vs ${MONTHS[prev.month]}`,
    `Fee YTD Ene–${MONTHS[month]} (ARS→U$D @ ${cotiz})`,
  ];

  for (const [soc, socRows] of Object.entries(bySoc)) {
    const data = [HEADERS, ...socRows.map(r => {
      const varPct = r.feePrev > 0 ? (r.feeMes - r.feePrev) / r.feePrev : "";
      const ytdUSD = r.feeYTD ? (r.moneda === "ARS" ? r.feeYTD / cotiz : r.feeYTD) : "";
      return [r.sede, r.pais, r.moneda, r.feeMes || "", varPct, ytdUSD];
    })];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const numFmt = "#,##0.00";
    socRows.forEach((_, i) => {
      const row = i + 2;
      const cellD = ws[`D${row}`]; if (cellD?.t === "n") cellD.z = numFmt;
      const cellF = ws[`F${row}`]; if (cellF?.t === "n") cellF.z = numFmt;
      if (data[i+1][4] !== "") ws[XLSX.utils.encode_cell({r: row-1, c: 4})] = { v: data[i+1][4], t: "n", z: "0.0%" };
    });
    ws["!cols"] = [24, 14, 8, 18, 14, 26].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, soc.slice(0, 31));
  }

  // Resumen
  const resData = [
    ["Sociedad", "Sedes", `${MONTHS[month]} USD`, `${MONTHS[month]} EUR`, `${MONTHS[month]} ARS`, `YTD USD equiv.`],
    ...Object.entries(bySoc).map(([soc, rs]) => [
      soc, rs.length,
      rs.filter(r => r.moneda === "USD").reduce((s, r) => s + r.feeMes, 0),
      rs.filter(r => r.moneda === "EUR").reduce((s, r) => s + r.feeMes, 0),
      rs.filter(r => r.moneda === "ARS").reduce((s, r) => s + r.feeMes, 0),
      rs.reduce((s, r) => s + (r.moneda === "ARS" ? r.feeYTD / cotiz : r.feeYTD), 0),
    ]),
  ];
  const wsRes = XLSX.utils.aoa_to_sheet(resData);
  wsRes["!cols"] = [28, 8, 14, 14, 18, 16].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wsRes, "Resumen");

  XLSX.writeFile(wb, `Reporte-Fee-${MONTHS[month]}-${year}.xlsx`);
}

// ─── BADGE ───────────────────────────────────────────────────────────────────
function Badge({ text, color }) {
  const colors = {
    green:  { bg: "rgba(74,222,128,.12)",  text: "var(--green)" },
    yellow: { bg: "rgba(250,204,21,.12)",  text: "#facc15" },
    red:    { bg: "rgba(248,113,113,.12)", text: "var(--red)" },
    gray:   { bg: "rgba(148,163,184,.12)", text: "var(--text2)" },
  };
  const c = colors[color] ?? colors.gray;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, borderRadius: 4, padding: "2px 7px", background: c.bg, color: c.text }}>
      {text}
    </span>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function ReporteFeeModal({ franchises, comps, defaultMonth, defaultYear, onClose }) {
  const def = prevMonth(defaultMonth, defaultYear);
  const [month,    setMonth]    = useState(def.month);
  const [year,     setYear]     = useState(def.year);
  const [cotiz,    setCotiz]    = useState(1200);   // ARS → USD para YTD

  const prev = prevMonth(month, year);

  const rows  = useMemo(() => buildRows(franchises, comps, year, month), [franchises, comps, year, month]);
  const bySoc = useMemo(() => {
    const m = {};
    for (const r of rows) { if (!m[r.sociedad]) m[r.sociedad] = []; m[r.sociedad].push(r); }
    return m;
  }, [rows]);

  const sel = { fontSize: 12, padding: "4px 9px", background: "var(--bg)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)" };
  const thS = { padding: "7px 10px", fontSize: 10, fontWeight: 600, color: "var(--text2)", borderBottom: "2px solid var(--border)", whiteSpace: "nowrap", background: "var(--bg)", textAlign: "right" };
  const tdS = { padding: "6px 10px", fontSize: 11, verticalAlign: "middle", whiteSpace: "nowrap", textAlign: "right", fontFamily: "monospace" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, width: "min(98vw, 1040px)", maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 12px 60px rgba(0,0,0,.45)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 24px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontSize: 18 }}>📊</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Reporte de Fee</div>
            <div style={{ fontSize: 11, color: "var(--text2)" }}>Uso interno · todas las sociedades</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <select value={month} onChange={e => setMonth(+e.target.value)} style={sel}>
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <select value={year} onChange={e => setYear(+e.target.value)} style={sel}>
              {AVAILABLE_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <label style={{ fontSize: 11, color: "var(--text2)", display: "flex", alignItems: "center", gap: 5 }}>
              U$D 1 =
              <input
                type="number" value={cotiz}
                onChange={e => setCotiz(Math.max(1, +e.target.value || 1))}
                style={{ width: 72, fontSize: 12, padding: "3px 7px", background: "var(--bg)", border: "1px solid var(--border2)", borderRadius: 5, color: "var(--text)", textAlign: "right" }}
              />
              ARS
            </label>
            <button
              onClick={() => downloadExcel(rows, year, month, cotiz)}
              disabled={rows.length === 0}
              style={{ fontSize: 12, fontWeight: 600, padding: "6px 16px", borderRadius: 6, background: rows.length ? "var(--lime)" : "var(--bg)", color: rows.length ? "#000" : "var(--text2)", border: "none", cursor: rows.length ? "pointer" : "not-allowed" }}
            >
              ↓ Excel
            </button>
            <button className="ghost" style={{ fontSize: 13, padding: "4px 10px" }} onClick={onClose}>✕ Cerrar</button>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
          {[
            { label: "Pagan fee", value: `${rows.filter(r => !r.sinFeeMes).length} / ${rows.length}` },
            { label: `YTD ARS`,      value: fmtMoney(rows.filter(r => r.moneda === "ARS").reduce((s, r) => s + r.feeYTD, 0), "ARS") },
            { label: `YTD USD`,      value: fmtMoney(rows.filter(r => r.moneda === "USD").reduce((s, r) => s + r.feeYTD, 0), "USD") },
            { label: `YTD EUR`,      value: fmtMoney(rows.filter(r => r.moneda === "EUR").reduce((s, r) => s + r.feeYTD, 0), "EUR") },
            { label: `${MONTHS[month]} ARS`, value: fmtMoney(rows.filter(r => r.moneda === "ARS").reduce((s, r) => s + r.feeMes, 0), "ARS") },
            { label: `${MONTHS[month]} USD`, value: fmtMoney(rows.filter(r => r.moneda === "USD").reduce((s, r) => s + r.feeMes, 0), "USD") },
          ].map(({ label, value }) => (
            <div key={label} style={{ flex: 1, padding: "10px 14px", borderRight: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "var(--text2)", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace" }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Tabla */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {rows.length === 0 ? (
            <div style={{ padding: "48px 0", textAlign: "center", color: "var(--text2)", fontSize: 13 }}>
              No hay facturas de fee para {MONTHS[month]} {year}
            </div>
          ) : (
            Object.entries(bySoc).map(([soc, socRows]) => (
              <div key={soc}>
                <div style={{ padding: "8px 16px", fontSize: 10, fontWeight: 700, color: "var(--lime)", letterSpacing: "0.08em", textTransform: "uppercase", background: "rgba(173,255,25,.04)", borderBottom: "1px solid var(--border)", borderTop: "1px solid var(--border)" }}>
                  {soc} — {socRows.length} sede{socRows.length !== 1 ? "s" : ""}
                  <span style={{ float: "right", color: "var(--text2)", fontWeight: 400 }}>
                    {["ARS","USD","EUR"].map(cur => {
                      const tot = socRows.filter(r => r.moneda === cur).reduce((s, r) => s + r.feeMes, 0);
                      return tot > 0 ? <span key={cur} style={{ marginLeft: 12 }}>{MONTHS[month]}: {fmtMoney(tot, cur)}</span> : null;
                    })}
                  </span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...thS, textAlign: "left" }}>Sede</th>
                      <th style={{ ...thS, textAlign: "left" }}>País</th>
                      <th style={{ ...thS, color: "var(--text)" }}>Fee {MONTHS[month]}<br/><span style={{ fontWeight: 400, fontSize: 9 }}>{year}</span></th>
                      <th style={{ ...thS, textAlign: "center" }}>Var %<br/><span style={{ fontWeight: 400, fontSize: 9 }}>vs {MONTHS[prev.month]}</span></th>
                      <th style={thS}>Fee YTD<br/><span style={{ fontWeight: 400, fontSize: 9 }}>Ene–{MONTHS[month]} · ARS→U$D</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {socRows.map((r, i) => {
                      // Variación % vs mes anterior
                      const varPct = r.feePrev > 0
                        ? ((r.feeMes - r.feePrev) / r.feePrev) * 100
                        : r.feeMes > 0 ? null : null; // null = nuevo o sin dato
                      const varLabel = r.feePrev === 0 && r.feeMes > 0
                        ? "Nuevo"
                        : varPct == null ? "—"
                        : (varPct >= 0 ? "+" : "") + varPct.toFixed(1) + "%";
                      const varColor = varPct == null ? "var(--text2)"
                        : varPct > 0 ? "var(--green)"
                        : varPct < 0 ? "var(--red)"
                        : "var(--text2)";
                      // YTD: ARS → USD, resto como está
                      const ytdDisplay = r.moneda === "ARS"
                        ? fmtMoney(r.feeYTD / cotiz, "USD")
                        : fmtMoney(r.feeYTD, r.moneda);
                      return (
                      <tr key={r.sede} style={{
                        background: i % 2 === 0 ? "var(--bg)" : "var(--bg2)",
                        borderBottom: "1px solid var(--border)",
                        opacity: r.sinFeeMes ? 0.5 : 1,
                      }}>
                        <td style={{ ...tdS, textAlign: "left", fontWeight: 600, fontFamily: "inherit" }}>{r.sede}</td>
                        <td style={{ ...tdS, textAlign: "left", color: "var(--text2)", fontFamily: "inherit" }}>{r.pais}</td>
                        <td style={{ ...tdS, fontWeight: 700, color: r.sinFeeMes ? "var(--text2)" : "var(--red)" }}>
                          {r.sinFeeMes ? "$ 0,00" : fmtMoney(r.feeMes, r.moneda)}
                        </td>
                        <td style={{ ...tdS, textAlign: "center", fontWeight: 600, color: varColor, fontFamily: "inherit" }}>
                          {varLabel}
                        </td>
                        <td style={{ ...tdS, color: "var(--text2)" }}>
                          {r.feeYTD ? ytdDisplay : "—"}
                        </td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
}
