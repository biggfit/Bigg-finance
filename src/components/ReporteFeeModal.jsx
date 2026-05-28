import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { MONTHS, AVAILABLE_YEARS, makeType } from "../lib/helpers";

// ─── helpers ────────────────────────────────────────────────────────────────
const fmtMoney = (n, cur = "ARS") => {
  if (!n && n !== 0) return "—";
  const abs = Math.abs(n);
  const sym = cur === "USD" ? "U$D " : cur === "EUR" ? "€ " : "$ ";
  return sym + abs.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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

    const frComps   = comps[fr.id] ?? [];
    const feeType   = makeType("FACTURA", "FEE");
    const feeComps  = frComps.filter(c => c.type === feeType && c.month === month && c.year === year);
    const feeMes    = sumFee(frComps, year, month);
    const feePrev   = sumFee(frComps, prev.year, prev.month);
    const feeYTD    = sumFeeYTD(frComps, year, month);
    const varPct    = feePrev > 0 ? ((feeMes - feePrev) / feePrev) * 100 : null;

    const feeCurrency = (feeComps[0]?.currency) ??
      frComps.find(c => c.type === makeType("FACTURA","FEE"))?.currency ??
      fr.feeMoneda ?? fr.currency ?? "ARS";

    rows.push({
      sede:      fr.name,
      sociedad:  fr.sociedad ?? "—",
      pais:      fr.country  ?? "—",
      moneda:    feeCurrency,
      feeYTD,
      feePrev,
      feeMes,
      varPct,
      sinFeeMes: feeMes === 0,
    });
  }

  // orden default: sedes con fee desc, sin fee al fondo
  return rows.sort((a, b) =>
    (a.sinFeeMes === b.sinFeeMes ? b.feeMes - a.feeMes : a.sinFeeMes ? 1 : -1)
  );
}

// ─── descarga Excel ──────────────────────────────────────────────────────────
function downloadExcel(rows, year, month, cotiz = 1200) {
  const prev = prevMonth(month, year);
  const wb   = XLSX.utils.book_new();

  // Hoja única con todas las sedes
  const HEADERS = [
    "Sede", "País",
    `Fee ${MONTHS[month]} U$D`,
    `Fee ${MONTHS[month]} ARS`,
    `Var % vs ${MONTHS[prev.month]}`,
    `Fee YTD Ene–${MONTHS[month]} (ARS→U$D @ ${cotiz})`,
  ];

  const data = [HEADERS, ...rows.map(r => {
    const varPct    = r.feePrev > 0 ? (r.feeMes - r.feePrev) / r.feePrev : "";
    const feeMesUSD = r.moneda === "ARS" ? r.feeMes / cotiz : (r.moneda === "USD" ? r.feeMes : r.feeMes);
    const feeMesARS = r.moneda === "ARS" ? r.feeMes : "";
    const ytdUSD    = r.feeYTD ? (r.moneda === "ARS" ? r.feeYTD / cotiz : r.feeYTD) : "";
    return [r.sede, r.pais, feeMesUSD, feeMesARS, varPct, ytdUSD];
  })];

  const ws = XLSX.utils.aoa_to_sheet(data);
  const numFmt = "#,##0";
  rows.forEach((r, i) => {
    const row = i + 2;
    ["C","D","F"].forEach(col => {
      const cell = ws[`${col}${row}`];
      if (cell?.t === "n") cell.z = numFmt;
    });
    if (data[i+1][4] !== "") {
      ws[XLSX.utils.encode_cell({ r: row - 1, c: 4 })] = { v: data[i+1][4], t: "n", z: "0.0%" };
    }
  });
  ws["!cols"] = [24, 14, 16, 18, 14, 26].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, `${MONTHS[month]} ${year}`);

  // Resumen por sociedad
  const bySoc = {};
  for (const r of rows) {
    if (!bySoc[r.sociedad]) bySoc[r.sociedad] = [];
    bySoc[r.sociedad].push(r);
  }
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

// ─── SortTh ──────────────────────────────────────────────────────────────────
function SortTh({ col, children, sortCol, sortDir, onSort, align = "right" }) {
  const active = sortCol === col;
  return (
    <th
      onClick={() => onSort(col)}
      style={{
        padding: "7px 10px", fontSize: 10, fontWeight: 600,
        borderBottom: "2px solid var(--border)", whiteSpace: "nowrap",
        background: "var(--bg)", textAlign: align,
        cursor: "pointer", userSelect: "none",
        color: active ? "var(--text)" : "var(--text2)",
        transition: "color .15s",
      }}
    >
      {children}
      <span style={{ marginLeft: 4, opacity: active ? 1 : 0.3, fontSize: 9 }}>
        {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </th>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function ReporteFeeModal({ franchises, comps, defaultMonth, defaultYear, onClose }) {
  const def = prevMonth(defaultMonth, defaultYear);
  const [month,   setMonth]   = useState(def.month);
  const [year,    setYear]    = useState(def.year);
  const [cotiz,   setCotiz]   = useState(1200);
  const [sortCol, setSortCol] = useState("feeMes");
  const [sortDir, setSortDir] = useState("desc");

  const prev = prevMonth(month, year);

  const baseRows = useMemo(() => buildRows(franchises, comps, year, month), [franchises, comps, year, month]);

  // Ordenamiento con click en header — sedes sin fee siempre al fondo
  const rows = useMemo(() => {
    const toUSD = (r) => r.moneda === "ARS" ? r.feeMes / cotiz : r.feeMes;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...baseRows].sort((a, b) => {
      if (a.sinFeeMes !== b.sinFeeMes) return a.sinFeeMes ? 1 : -1;
      let cmp = 0;
      if      (sortCol === "sede")        cmp = a.sede.localeCompare(b.sede);
      else if (sortCol === "pais")        cmp = a.pais.localeCompare(b.pais);
      else if (sortCol === "feeMesUSD")   cmp = toUSD(a) - toUSD(b);
      else if (sortCol === "feeMesARS")   cmp = a.feeMes - b.feeMes;
      else if (sortCol === "varPct")   cmp = (a.varPct ?? -Infinity) - (b.varPct ?? -Infinity);
      else if (sortCol === "feeYTD")   cmp = a.feeYTD - b.feeYTD;
      return cmp * dir;
    });
  }, [baseRows, sortCol, sortDir]);

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  }

  const sel = { fontSize: 12, padding: "4px 9px", background: "var(--bg)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)" };
  const tdS = { padding: "6px 10px", fontSize: 11, verticalAlign: "middle", whiteSpace: "nowrap", textAlign: "right", fontFamily: "monospace" };
  const sortProps = { sortCol, sortDir, onSort: toggleSort };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, width: "min(98vw, 1120px)", maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 12px 60px rgba(0,0,0,.45)" }}>

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
            { label: "YTD ARS",           value: fmtMoney(rows.filter(r => r.moneda === "ARS").reduce((s, r) => s + r.feeYTD, 0), "ARS") },
            { label: "YTD USD",           value: fmtMoney(rows.filter(r => r.moneda === "USD").reduce((s, r) => s + r.feeYTD, 0), "USD") },
            { label: "YTD EUR",           value: fmtMoney(rows.filter(r => r.moneda === "EUR").reduce((s, r) => s + r.feeYTD, 0), "EUR") },
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
              No hay sedes activas para mostrar
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <tr>
                  <SortTh col="sede" align="left"  {...sortProps}>Sede</SortTh>
                  <SortTh col="pais" align="left"  {...sortProps}>País</SortTh>
                  <SortTh col="feeMesUSD" {...sortProps}>
                    Fee {MONTHS[month]}<br/>
                    <span style={{ fontWeight: 400, fontSize: 9 }}>U$D · {year}</span>
                  </SortTh>
                  <SortTh col="feeMesARS" {...sortProps}>
                    Fee {MONTHS[month]}<br/>
                    <span style={{ fontWeight: 400, fontSize: 9 }}>ARS · {year}</span>
                  </SortTh>
                  <SortTh col="varPct" align="center" {...sortProps}>
                    Var %<br/>
                    <span style={{ fontWeight: 400, fontSize: 9 }}>vs {MONTHS[prev.month]}</span>
                  </SortTh>
                  <SortTh col="feeYTD"               {...sortProps}>
                    Fee YTD<br/>
                    <span style={{ fontWeight: 400, fontSize: 9 }}>Ene–{MONTHS[month]} · ARS→U$D</span>
                  </SortTh>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const varLabel = r.feePrev === 0 && r.feeMes > 0
                    ? "Nuevo"
                    : r.varPct == null ? "—"
                    : (r.varPct >= 0 ? "+" : "") + r.varPct.toFixed(1) + "%";
                  const varColor = r.varPct == null ? "var(--text2)"
                    : r.varPct > 0  ? "var(--green)"
                    : r.varPct < 0  ? "var(--red)"
                    : "var(--text2)";

                  const ytdDisplay = r.moneda === "ARS"
                    ? fmtMoney(r.feeYTD / cotiz, "USD")
                    : fmtMoney(r.feeYTD, r.moneda);

                  return (
                    <tr key={r.sede} style={{
                      background: i % 2 === 0 ? "var(--bg)" : "var(--bg2)",
                      borderBottom: "1px solid var(--border)",
                      opacity: r.sinFeeMes ? 0.45 : 1,
                    }}>
                      <td style={{ ...tdS, textAlign: "left", fontWeight: 600, fontFamily: "inherit" }}>{r.sede}</td>
                      <td style={{ ...tdS, textAlign: "left", color: "var(--text2)", fontFamily: "inherit" }}>{r.pais}</td>
                      {/* Fee USD */}
                      <td style={{ ...tdS, fontWeight: 700, color: r.sinFeeMes ? "var(--text2)" : "var(--text)" }}>
                        {r.sinFeeMes
                          ? <span style={{ color: "var(--text2)" }}>—</span>
                          : r.moneda === "ARS"
                            ? fmtMoney(r.feeMes / cotiz, "USD")
                            : fmtMoney(r.feeMes, r.moneda)
                        }
                      </td>
                      {/* Fee ARS — solo Argentina */}
                      <td style={{ ...tdS, color: "var(--text2)", fontWeight: 400 }}>
                        {r.moneda === "ARS" && !r.sinFeeMes
                          ? fmtMoney(r.feeMes, "ARS")
                          : ""
                        }
                      </td>
                      <td style={{ ...tdS, textAlign: "center", fontWeight: 600, color: varColor, fontFamily: "inherit" }}>
                        {varLabel}
                      </td>
                      <td style={{ ...tdS, color: "var(--text2)" }}>
                        {r.feeYTD ? ytdDisplay : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}
