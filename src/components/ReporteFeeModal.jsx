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

// ─── TC helpers ──────────────────────────────────────────────────────────────
function tcFor(tiposCambio, year, month) {
  const key = `${year}-${String(month + 1).padStart(2, "0")}`;
  return tiposCambio[key] ?? null;
}
/** Construye objeto TC desde Maestros; 0 en cualquier campo no cargado */
function mergeTc(rawTc) {
  return {
    arsUSD: rawTc?.arsUSD > 0 ? rawTc.arsUSD : 0,
    eurUSD: rawTc?.eurUSD > 0 ? rawTc.eurUSD : 0,
    uyuUSD: rawTc?.uyuUSD > 0 ? rawTc.uyuUSD : 0,
    pygUSD: rawTc?.pygUSD > 0 ? rawTc.pygUSD : 0,
    clpUSD: rawTc?.clpUSD > 0 ? rawTc.clpUSD : 0,
    penUSD: rawTc?.penUSD > 0 ? rawTc.penUSD : 0,
  };
}
/** Convierte importe en moneda local a USD usando el objeto TC */
function feeToUSD(amount, currency, tc) {
  if (!amount) return 0;
  if (currency === "ARS") return tc.arsUSD > 0 ? amount / tc.arsUSD : 0;
  if (currency === "EUR") return tc.eurUSD > 0 ? amount * tc.eurUSD : amount;
  if (currency === "UYU") return tc.uyuUSD > 0 ? amount / tc.uyuUSD : 0;
  if (currency === "PYG") return tc.pygUSD > 0 ? amount / tc.pygUSD : 0;
  if (currency === "CLP") return tc.clpUSD > 0 ? amount / tc.clpUSD : 0;
  if (currency === "PEN") return tc.penUSD > 0 ? amount / tc.penUSD : 0;
  return amount; // USD u otras pasan directo
}
function computeYTD_USD(frComps, year, upToMonth, feeCurrency, tiposCambio) {
  let total = 0;
  for (let m = 0; m <= upToMonth; m++) {
    const tc = mergeTc(tcFor(tiposCambio, year, m));
    total += feeToUSD(sumFee(frComps, year, m), feeCurrency, tc);
  }
  return total;
}

// ─── lógica del reporte ──────────────────────────────────────────────────────
function buildRows(franchises, comps, year, month, tiposCambio = {}) {
  const prev = prevMonth(month, year);

  const tc  = mergeTc(tcFor(tiposCambio, year, month));
  const tcp = mergeTc(tcFor(tiposCambio, prev.year, prev.month));

  const rows = [];
  for (const fr of franchises) {
    if (fr.activa === false) continue;
    const frComps  = comps[fr.id] ?? [];
    const feeType  = makeType("FACTURA", "FEE");
    const feeComps = frComps.filter(c => c.type === feeType && c.month === month && c.year === year);
    const feeMes   = sumFee(frComps, year, month);
    const feePrev  = sumFee(frComps, prev.year, prev.month);
    const feeCurrency = (feeComps[0]?.currency) ??
      frComps.find(c => c.type === makeType("FACTURA","FEE"))?.currency ??
      fr.feeMoneda ?? fr.currency ?? "ARS";

    const feeMes_USD  = feeToUSD(feeMes,  feeCurrency, tc);
    const feePrev_USD = feeToUSD(feePrev, feeCurrency, tcp);
    const feeYTD_USD  = computeYTD_USD(frComps, year, month, feeCurrency, tiposCambio);
    const varPct      = feePrev_USD > 0 ? ((feeMes_USD - feePrev_USD) / feePrev_USD) * 100 : null;

    rows.push({
      sede: fr.name, sociedad: fr.sociedad ?? "—", pais: fr.country ?? "—",
      moneda: feeCurrency, feeMes, feePrev,
      feeMes_USD, feePrev_USD, feeYTD_USD, varPct,
      sinFeeMes: feeMes === 0,
      hasOpened: frComps.length > 0,
      tcFound: tc !== null,
    });
  }
  return rows.sort((a, b) => {
    if (a.hasOpened !== b.hasOpened) return a.hasOpened ? -1 : 1;
    if (a.sinFeeMes !== b.sinFeeMes) return a.sinFeeMes ? 1 : -1;
    return b.feeMes_USD - a.feeMes_USD;
  });
}

// ─── descarga Excel ──────────────────────────────────────────────────────────
function downloadExcel(rows, year, month) {
  const prev = prevMonth(month, year);
  const wb   = XLSX.utils.book_new();
  // ── Hoja de detalle ──
  const HEADERS = [
    "Sede", "País",
    `Fee ${MONTHS[month]} U$D`,
    `Var % vs ${MONTHS[prev.month]}`,
    `Fee YTD Ene–${MONTHS[month]} U$D`,
  ];
  const data = [HEADERS, ...rows.map(r => {
    const varPct = r.feePrev_USD > 0 ? (r.feeMes_USD - r.feePrev_USD) / r.feePrev_USD : "";
    return [r.sede, r.pais, r.feeMes_USD || 0, varPct, r.feeYTD_USD || ""];
  })];
  const ws = XLSX.utils.aoa_to_sheet(data);
  rows.forEach((_, i) => {
    const row = i + 2;
    ["C","E"].forEach(col => { const c = ws[`${col}${row}`]; if (c?.t === "n") c.z = "#,##0"; });
    if (data[i+1][3] !== "")
      ws[XLSX.utils.encode_cell({ r: row-1, c: 3 })] = { v: data[i+1][3], t: "n", z: "0.0%" };
  });
  ws["!cols"] = [24, 14, 16, 14, 26].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, `${MONTHS[month]} ${year}`);

  // ── Hoja Resumen por sociedad ──
  const bySoc = {};
  for (const r of rows) { if (!bySoc[r.sociedad]) bySoc[r.sociedad] = []; bySoc[r.sociedad].push(r); }
  const resData = [
    ["Sociedad", "Sedes", `Fee ${MONTHS[month]} U$D`, `Var % vs ${MONTHS[prev.month]}`, "Fee YTD U$D"],
    ...Object.entries(bySoc).map(([soc, rs]) => {
      const totMes  = rs.reduce((s, r) => s + r.feeMes_USD,  0);
      const totPrev = rs.reduce((s, r) => s + r.feePrev_USD, 0);
      const varPct  = totPrev > 0 ? (totMes - totPrev) / totPrev : "";
      const totYTD  = rs.reduce((s, r) => s + r.feeYTD_USD,  0);
      return [soc, rs.length, totMes, varPct, totYTD];
    }),
  ];
  const wsRes = XLSX.utils.aoa_to_sheet(resData);
  // formato números en resumen
  Object.entries(bySoc).forEach((_, i) => {
    const row = i + 2;
    ["C","E"].forEach(col => { const c = wsRes[`${col}${row}`]; if (c?.t === "n") c.z = "#,##0.00"; });
    if (resData[i+1][3] !== "")
      wsRes[XLSX.utils.encode_cell({ r: row-1, c: 3 })] = { v: resData[i+1][3], t: "n", z: "0.0%" };
  });
  wsRes["!cols"] = [28, 8, 16, 16, 22].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wsRes, "Resumen");
  XLSX.writeFile(wb, `Reporte-Fee-${MONTHS[month]}-${year}.xlsx`);
}

// ─── FilterDropdown ───────────────────────────────────────────────────────────
// `selected`: Set de items visibles. Set vacío = todos visibles.
function FilterDropdown({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const allOn   = selected.size === 0;
  const active  = !allOn;

  function isChecked(opt) { return allOn || selected.has(opt); }

  function toggle(opt) {
    if (allOn) {
      // estábamos mostrando todo → desmarcar uno → mostrar todos excepto ese
      onChange(new Set(options.filter(o => o !== opt)));
    } else {
      const next = new Set(selected);
      if (next.has(opt)) {
        next.delete(opt);
        onChange(next.size === 0 ? new Set(options.filter(o => o !== opt)) : next);
      } else {
        next.add(opt);
        onChange(next.size === options.length ? new Set() : next);
      }
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          fontSize: 11, padding: "4px 10px", borderRadius: 5, cursor: "pointer",
          background: active ? "rgba(173,255,25,.12)" : "var(--bg)",
          border: `1px solid ${active ? "var(--lime)" : "var(--border2)"}`,
          color: active ? "var(--lime)" : "var(--text2)",
          display: "flex", alignItems: "center", gap: 5, fontWeight: active ? 600 : 400,
        }}
      >
        {label}
        {active && <span style={{ background: "var(--lime)", color: "#000", borderRadius: 3, fontSize: 9, padding: "1px 5px", fontWeight: 700 }}>{selected.size}</span>}
        <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 20 }} onClick={() => setOpen(false)} />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 21,
            background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8,
            minWidth: 200, maxHeight: 300, overflowY: "auto",
            boxShadow: "0 8px 32px rgba(0,0,0,.5)", padding: "6px 0",
          }}>
            <div style={{ padding: "4px 12px 6px", display: "flex", gap: 10, borderBottom: "1px solid var(--border)" }}>
              <button onClick={() => onChange(new Set())} style={{ fontSize: 10, color: "var(--lime)", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>
                ✓ Todos
              </button>
              <button onClick={() => onChange(new Set())} style={{ fontSize: 10, color: "var(--text2)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                Limpiar
              </button>
            </div>
            {options.map(opt => (
              <label
                key={opt}
                onClick={() => toggle(opt)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", cursor: "pointer", userSelect: "none" }}
              >
                <input
                  type="checkbox" readOnly
                  checked={isChecked(opt)}
                  style={{ accentColor: "var(--lime)", cursor: "pointer" }}
                />
                <span style={{ fontSize: 12, color: "var(--text)" }}>{opt}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
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
      }}
    >
      {children}
      <span style={{ marginLeft: 4, opacity: active ? 1 : 0.3, fontSize: 9 }}>
        {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </th>
  );
}

// ─── SortFilterTh — ordena al hacer click en el texto, filtra con el ▾ ───────
function SortFilterTh({ col, label, options, selected, onChange, sortCol, sortDir, onSort, align = "left" }) {
  const [open, setOpen] = useState(false);
  const active     = sortCol === col;
  const hasFilter  = selected.size > 0;
  const allOn      = selected.size === 0;

  function isChecked(opt) { return allOn || selected.has(opt); }
  function toggle(opt) {
    if (allOn) {
      onChange(new Set(options.filter(o => o !== opt)));
    } else {
      const next = new Set(selected);
      if (next.has(opt)) { next.delete(opt); onChange(next.size === 0 ? new Set(options.filter(o => o !== opt)) : next); }
      else { next.add(opt); onChange(next.size === options.length ? new Set() : next); }
    }
  }

  return (
    <th style={{
      padding: "7px 10px", fontSize: 10, fontWeight: 600,
      borderBottom: "2px solid var(--border)", whiteSpace: "nowrap",
      background: "var(--bg)", textAlign: align, userSelect: "none",
      color: active ? "var(--text)" : "var(--text2)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {/* zona de sort */}
        <span onClick={() => onSort(col)} style={{ cursor: "pointer", flex: 1 }}>
          {label}
          <span style={{ marginLeft: 4, opacity: active ? 1 : 0.3, fontSize: 9 }}>
            {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </span>
        {/* botón de filtro */}
        <div style={{ position: "relative" }}>
          <span
            onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
            style={{
              cursor: "pointer", fontSize: 10, borderRadius: 3, padding: "1px 4px",
              background: hasFilter ? "var(--lime)" : "transparent",
              color: hasFilter ? "#000" : "var(--text2)",
              fontWeight: hasFilter ? 700 : 400,
              border: `1px solid ${hasFilter ? "var(--lime)" : "var(--border2)"}`,
            }}
            title="Filtrar"
          >
            {hasFilter ? `${selected.size} ▾` : "▾"}
          </span>
          {open && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 20 }} onClick={() => setOpen(false)} />
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 21,
                background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8,
                minWidth: 200, maxHeight: 300, overflowY: "auto",
                boxShadow: "0 8px 32px rgba(0,0,0,.5)", padding: "6px 0",
              }}>
                <div style={{ padding: "4px 12px 6px", borderBottom: "1px solid var(--border)" }}>
                  <button onClick={() => onChange(new Set())} style={{ fontSize: 10, color: "var(--lime)", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>
                    ✓ Todos
                  </button>
                </div>
                {options.map(opt => (
                  <label key={opt} onClick={() => toggle(opt)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", cursor: "pointer", userSelect: "none" }}>
                    <input type="checkbox" readOnly checked={isChecked(opt)} style={{ accentColor: "var(--lime)", cursor: "pointer" }} />
                    <span style={{ fontSize: 12, color: "var(--text)" }}>{opt}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </th>
  );
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function ReporteFeeModal({ franchises, comps, tiposCambio = {}, defaultMonth, defaultYear, onClose }) {
  const def = prevMonth(defaultMonth, defaultYear);
  const [month,        setMonth]        = useState(def.month);
  const [year,         setYear]         = useState(def.year);
  const [sortCol,      setSortCol]      = useState("feeMesUSD");
  const [sortDir,      setSortDir]      = useState("desc");
  const [filterSedes,  setFilterSedes]  = useState(new Set());
  const [filterPaises, setFilterPaises] = useState(new Set());

  const prev = prevMonth(month, year);

  // ¿Hay TC cargado para el mes seleccionado?
  const tcKey     = `${year}-${String(month+1).padStart(2,'0')}`;
  const tcActual  = tiposCambio[tcKey] ?? null;
  const tcMissing = !tcActual || !(tcActual.arsUSD > 0);

  const baseRows = useMemo(
    () => buildRows(franchises, comps, year, month, tiposCambio),
    [franchises, comps, year, month, tiposCambio]
  );

  const allSedes  = useMemo(() => [...new Set(baseRows.map(r => r.sede))].sort((a,b) => a.localeCompare(b)), [baseRows]);
  const allPaises = useMemo(() => [...new Set(baseRows.map(r => r.pais))].sort((a,b) => a.localeCompare(b)), [baseRows]);

  const rows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return baseRows
      .filter(r =>
        (filterSedes.size  === 0 || filterSedes.has(r.sede)) &&
        (filterPaises.size === 0 || filterPaises.has(r.pais))
      )
      .sort((a, b) => {
        if (a.sinFeeMes !== b.sinFeeMes) return a.sinFeeMes ? 1 : -1;
        let cmp = 0;
        if      (sortCol === "sede")      cmp = a.sede.localeCompare(b.sede);
        else if (sortCol === "pais")      cmp = a.pais.localeCompare(b.pais);
        else if (sortCol === "feeMesUSD") cmp = a.feeMes_USD - b.feeMes_USD;
        else if (sortCol === "varPct")    cmp = (a.varPct ?? -Infinity) - (b.varPct ?? -Infinity);
        else if (sortCol === "feeYTD")    cmp = a.feeYTD_USD - b.feeYTD_USD;
        return cmp * dir;
      });
  }, [baseRows, filterSedes, filterPaises, sortCol, sortDir]);

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  }

  const anyFilter = filterSedes.size > 0 || filterPaises.size > 0;

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
            {tcMissing
              ? <span style={{ fontSize: 11, color: "#f5a623" }} title="Cargá el TC en Maestros para este mes">⚠ TC sin cargar</span>
              : <span style={{ fontSize: 11, color: "var(--lime, #adff19)", opacity: 0.8 }}>✓ TC {MONTHS[month]} {year}</span>
            }
            <button
              onClick={() => downloadExcel(rows, year, month)}
              disabled={rows.length === 0}
              style={{ fontSize: 12, fontWeight: 600, padding: "6px 16px", borderRadius: 6, background: rows.length ? "#fff" : "var(--bg)", color: rows.length ? "#111" : "var(--text2)", border: "1px solid #ccc", cursor: rows.length ? "pointer" : "not-allowed" }}
            >
              ↓ Excel
            </button>
            <button className="ghost" style={{ fontSize: 13, padding: "4px 10px" }} onClick={onClose}>✕ Cerrar</button>
          </div>
        </div>

        {/* KPIs */}
        {(() => {
          const pagando  = rows.filter(r => r.hasOpened && !r.sinFeeMes);
          const abiertas = rows.filter(r => r.hasOpened);

          const totMesUSD  = rows.reduce((s,r) => s + (r.feeMes_USD  || 0), 0);
          const totPrevUSD = rows.reduce((s,r) => s + (r.feePrev_USD || 0), 0);
          const varAgr     = totPrevUSD > 0 ? ((totMesUSD - totPrevUSD) / totPrevUSD) * 100 : null;
          const varLabel   = varAgr == null ? "—" : (varAgr >= 0 ? "+" : "") + varAgr.toFixed(1) + "%";
          const varColor   = varAgr == null ? "var(--text)" : varAgr > 0 ? "var(--green)" : varAgr < 0 ? "var(--red)" : "var(--text)";

          const promUSD = pagando.length > 0
            ? pagando.reduce((s,r) => s + (r.feeMes_USD || 0), 0) / pagando.length
            : 0;

          const ytdUSD = rows.reduce((s,r) => s + (r.feeYTD_USD || 0), 0);

          const kpis = [
            {
              label: "Pagan fee",
              value: `${pagando.length} / ${abiertas.length}`,
              sub: null,
            },
            {
              label: `Fee ${MONTHS[month]}`,
              value: fmtMoney(totMesUSD, "USD"),
              sub: null,
            },
            {
              label: `Var % vs ${MONTHS[prev.month]}`,
              value: varLabel,
              valueColor: varColor,
              sub: null,
            },
            {
              label: "Promedio por sede",
              value: fmtMoney(promUSD, "USD"),
              sub: `${pagando.length} sedes`,
            },
            {
              label: `YTD Ene–${MONTHS[month]}`,
              value: fmtMoney(ytdUSD, "USD"),
              sub: null,
            },
          ];

          return (
            <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
              {kpis.map(({ label, value, sub, valueColor }) => (
                <div key={label} style={{ flex: 1, padding: "10px 14px", borderRight: "1px solid var(--border)", textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: "var(--text2)", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: valueColor ?? "var(--text)" }}>{value}</div>
                  {sub && <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 2, fontFamily: "monospace" }}>{sub}</div>}
                </div>
              ))}
            </div>
          );
        })()}

        {/* Tabla */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {rows.length === 0 ? (
            <div style={{ padding: "48px 0", textAlign: "center", color: "var(--text2)", fontSize: 13 }}>
              {anyFilter ? "Ninguna sede coincide con los filtros aplicados." : "No hay sedes activas para mostrar."}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <tr>
                  <SortFilterTh col="sede" label="Sede" options={allSedes}  selected={filterSedes}  onChange={setFilterSedes}  {...sortProps} />
                  <SortFilterTh col="pais" label="País" options={allPaises} selected={filterPaises} onChange={setFilterPaises} {...sortProps} />
                  <SortTh col="feeMesUSD" {...sortProps}>
                    Fee {MONTHS[month]}<br/>
                    <span style={{ fontWeight: 400, fontSize: 9 }}>U$D · {year}</span>
                  </SortTh>
                  <SortTh col="varPct" align="center" {...sortProps}>
                    Var %<br/>
                    <span style={{ fontWeight: 400, fontSize: 9 }}>vs {MONTHS[prev.month]}</span>
                  </SortTh>
                  <SortTh col="feeYTD" {...sortProps}>
                    Fee YTD<br/>
                    <span style={{ fontWeight: 400, fontSize: 9 }}>Ene–{MONTHS[month]} · ARS→U$D</span>
                  </SortTh>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const varLabel = r.feePrev === 0 && r.feeMes > 0 ? "Nuevo"
                    : r.varPct == null ? "—"
                    : (r.varPct >= 0 ? "+" : "") + r.varPct.toFixed(1) + "%";
                  const varColor = r.varPct == null ? "var(--text2)"
                    : r.varPct > 0 ? "var(--green)"
                    : r.varPct < 0 ? "var(--red)"
                    : "var(--text2)";
                  return (
                    <tr key={r.sede} style={{
                      background: i % 2 === 0 ? "var(--bg)" : "var(--bg2)",
                      borderBottom: "1px solid var(--border)",
                      opacity: r.hasOpened ? 1 : 0.4,
                    }}>
                      <td style={{ ...tdS, textAlign: "left", fontWeight: 600, fontFamily: "inherit" }}>{r.sede}</td>
                      <td style={{ ...tdS, textAlign: "left", color: "var(--text2)", fontFamily: "inherit" }}>{r.pais}</td>
                      <td style={{ ...tdS, fontWeight: 700, color: r.sinFeeMes ? "var(--text2)" : "var(--text)" }}>
                        {!r.hasOpened
                          ? <span style={{ color: "var(--text2)", fontSize: 10 }}>Sin abrir</span>
                          : r.sinFeeMes
                            ? <span style={{ color: "var(--text2)" }}>$ 0</span>
                            : fmtMoney(r.feeMes_USD, "USD")}
                      </td>
                      <td style={{ ...tdS, textAlign: "center", fontWeight: 600, color: varColor, fontFamily: "inherit" }}>
                        {varLabel}
                      </td>
                      <td style={{ ...tdS, color: "var(--text2)" }}>
                        {r.feeYTD_USD ? fmtMoney(r.feeYTD_USD, "USD") : "—"}
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
