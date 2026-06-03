import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { MONTHS, AVAILABLE_YEARS, makeType } from "../lib/helpers";
import { sendMailFr } from "../lib/sheetsApi";

// ─── helpers ────────────────────────────────────────────────────────────────
const fmtMoney = (n, cur = "ARS") => {
  if (!n && n !== 0) return "—";
  const abs = Math.abs(n);
  const sym = cur === "USD" ? "U$D " : cur === "EUR" ? "€ " : "$ ";
  return sym + abs.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};
// Solo el número, sin símbolo de moneda (para filas de tabla)
const fmtNum = (n) => {
  if (!n && n !== 0) return "—";
  return Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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
    if (fr.paysFee === false) continue; // sedes propias — no pagan fee
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

// ─── Email HTML builder ───────────────────────────────────────────────────────
function buildEmailHtml({ rows, month, year, prev, tcActual, tcPrevRef }) {
  const mesLabel  = MONTHS[month];
  const prevLabel = MONTHS[prev.month];
  const fmtU = n => n ? 'U$D ' + Math.round(n).toLocaleString('es-AR') : '—';
  const fmtN = n => n ? Math.round(n).toLocaleString('es-AR') : '—'; // sin símbolo, para filas de tabla
  const fmtP = p => p == null ? '—' : (p >= 0 ? '+' : '') + p.toFixed(1) + '%';

  const EU_PAISES = ['España', 'Portugal'];
  const rowsARG   = rows.filter(r => r.pais === 'Argentina');
  const rowsLATAM = rows.filter(r => r.pais !== 'Argentina' && !EU_PAISES.includes(r.pais));
  const rowsEU    = rows.filter(r => EU_PAISES.includes(r.pais));

  const pagando  = rows.filter(r => r.hasOpened && !r.sinFeeMes);
  const abiertas = rows.filter(r => r.hasOpened);
  const totMes   = rows.reduce((s,r) => s + (r.feeMes_USD  || 0), 0);
  const totPrev  = rows.reduce((s,r) => s + (r.feePrev_USD || 0), 0);
  const varAgr   = totPrev > 0 ? ((totMes - totPrev) / totPrev) * 100 : null;
  const varColor = varAgr == null ? '#ffffff' : varAgr > 0 ? '#10d97a' : '#ff5570';
  const promUSD  = pagando.length > 0 ? pagando.reduce((s,r) => s + (r.feeMes_USD || 0), 0) / pagando.length : 0;
  const ytdUSD   = rows.reduce((s,r) => s + (r.feeYTD_USD  || 0), 0);

  const regFee  = reg => reg.reduce((s,r) => s + (r.feeMes_USD  || 0), 0);
  const regYTD  = reg => reg.reduce((s,r) => s + (r.feeYTD_USD  || 0), 0);
  const regVar  = reg => {
    const m = reg.reduce((s,r) => s + (r.feeMes_USD  || 0), 0);
    const p = reg.reduce((s,r) => s + (r.feePrev_USD || 0), 0);
    return p > 0 ? ((m - p) / p) * 100 : null;
  };
  const regProm = reg => {
    const pag = reg.filter(r => !r.sinFeeMes && r.hasOpened);
    return pag.length > 0 ? pag.reduce((s,r) => s + (r.feeMes_USD || 0), 0) / pag.length : null;
  };
  const regPag = reg =>
    reg.filter(r => !r.sinFeeMes && r.hasOpened).length + ' / ' + reg.filter(r => r.hasOpened).length;

  const arsC = tcActual?.arsUSD  > 0 ? tcActual.arsUSD  : null;
  const arsP = tcPrevRef?.arsUSD > 0 ? tcPrevRef.arsUSD : null;
  const eurC = tcActual?.eurUSD  > 0 ? tcActual.eurUSD  : null;
  const eurP = tcPrevRef?.eurUSD > 0 ? tcPrevRef.eurUSD : null;
  const tcLine = [
    (arsC || arsP) ? 'ARS/USD: $' + (arsC ? Math.round(arsC).toLocaleString('es-AR') : '—') + ' (' + mesLabel + ') · $' + (arsP ? Math.round(arsP).toLocaleString('es-AR') : '—') + ' (' + prevLabel + ')' : null,
    (eurC || eurP) ? 'EUR/USD: ' + (eurC ? eurC.toFixed(2) : '—') + ' (' + mesLabel + ') · ' + (eurP ? eurP.toFixed(2) : '—') + ' (' + prevLabel + ')' : null,
  ].filter(Boolean).join(' &nbsp;|&nbsp; ');

  const bd = items => items.map(([l, v]) =>
    '<tr><td style="font-size:9px;color:#555;padding:1px 4px;text-align:left;">' + l +
    '</td><td style="font-size:9px;color:#888;font-family:monospace;padding:1px 4px;text-align:right;">' + v + '</td></tr>'
  ).join('');

  const kpi = (label, val, color, items, border) =>
    '<td class="kpi-cell" style="text-align:center;padding:10px 5px;' + (border !== false ? 'border-right:1px solid #2a2a2a;' : '') + 'vertical-align:top;white-space:nowrap;">' +
    '<div style="font-size:8px;color:#666;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;white-space:nowrap;">' + label + '</div>' +
    '<div class="kpi-val" style="font-size:15px;font-weight:700;color:' + (color || '#fff') + ';font-family:monospace;margin-bottom:' + (items ? '4' : '0') + 'px;white-space:nowrap;">' + val + '</div>' +
    (items ? '<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 auto;">' + bd(items) + '</table>' : '') +
    '</td>';

  const tableRows = rows.map((r, i) => {
    const vl = r.feePrev === 0 && r.feeMes > 0 ? 'Nuevo' : r.varPct == null ? '—' : fmtP(r.varPct);
    const vc = vl === 'Nuevo' ? '#adff19' : r.varPct == null ? '#666' : r.varPct > 0 ? '#10d97a' : r.varPct < 0 ? '#ff5570' : '#fff';
    const bg = i % 2 === 0 ? '#161616' : '#1a1a1a';
    return '<tr style="background:' + bg + ';">' +
      '<td style="padding:7px 12px;font-size:12px;color:' + (r.hasOpened ? '#fff' : '#555') + ';font-weight:600;">' + r.sede + '</td>' +
      '<td style="padding:7px 12px;font-size:12px;color:#888;">' + r.pais + '</td>' +
      '<td style="padding:7px 12px;font-size:12px;color:' + (r.sinFeeMes ? '#555' : '#fff') + ';font-family:monospace;text-align:right;">' + (r.sinFeeMes ? '—' : fmtN(r.feeMes_USD)) + '</td>' +
      '<td style="padding:7px 12px;font-size:12px;color:' + vc + ';font-family:monospace;text-align:center;font-weight:700;">' + vl + '</td>' +
      '<td style="padding:7px 12px;font-size:12px;color:#888;font-family:monospace;text-align:right;">' + (r.feeYTD_USD ? fmtN(r.feeYTD_USD) : '—') + '</td>' +
      '</tr>';
  }).join('');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>@media only screen and (max-width:600px){.kpi-cell{padding:6px 3px !important;}.kpi-val{font-size:12px !important;}table[class="kpi-row"] td{display:block;width:100% !important;border-right:none !important;border-bottom:1px solid #2a2a2a;}}</style>' +
    '</head>' +
    '<body style="margin:0;padding:0;background:#111111;font-family:Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:0;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;">' +

    // Header
    '<tr><td style="background:#111;padding:22px 32px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td><div style="font-size:24px;font-weight:900;color:#adff19;letter-spacing:-1px;">BIGG</div>' +
    '<div style="font-size:10px;color:#888;margin-top:3px;text-transform:uppercase;letter-spacing:.1em;">Reporte de Fee &mdash; ' + mesLabel + ' ' + year + '</div></td>' +
    '<td align="right"><div style="font-size:10px;color:#555;">Distribución interna</div></td>' +
    '</tr></table></td></tr>' +

    // KPIs
    '<tr><td style="background:#181818;border-bottom:1px solid #2a2a2a;">' +
    '<table class="kpi-row" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    kpi('Pagan Fee', pagando.length + ' / ' + abiertas.length, '#fff',
      [['ARG', regPag(rowsARG)], ['LATAM', regPag(rowsLATAM)], ['Europa', regPag(rowsEU)]]) +
    kpi('Fee ' + mesLabel, fmtU(totMes), '#fff',
      [['ARG', fmtU(regFee(rowsARG))], ['LATAM', fmtU(regFee(rowsLATAM))], ['Europa', fmtU(regFee(rowsEU))]]) +
    kpi('Var % vs ' + prevLabel, fmtP(varAgr), varColor,
      [['ARG', fmtP(regVar(rowsARG))], ['LATAM', fmtP(regVar(rowsLATAM))], ['Europa', fmtP(regVar(rowsEU))]]) +
    kpi('Promedio / sede', fmtU(promUSD), '#fff',
      [['ARG', regProm(rowsARG) != null ? fmtU(regProm(rowsARG)) : '—'],
       ['LATAM', regProm(rowsLATAM) != null ? fmtU(regProm(rowsLATAM)) : '—'],
       ['Europa', regProm(rowsEU) != null ? fmtU(regProm(rowsEU)) : '—']]) +
    kpi('YTD Ene–' + mesLabel, fmtU(ytdUSD), '#fff',
      [['ARG', fmtU(regYTD(rowsARG))], ['LATAM', fmtU(regYTD(rowsLATAM))], ['Europa', fmtU(regYTD(rowsEU))]], false) +
    '</tr></table></td></tr>' +

    // Table
    '<tr><td style="background:#111;">' +
    '<table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr style="background:#0d0d0d;">' +
    '<th style="padding:8px 12px;text-align:left;color:#888;font-size:10px;font-weight:600;border-bottom:2px solid #2a2a2a;">Sede</th>' +
    '<th style="padding:8px 12px;text-align:left;color:#888;font-size:10px;font-weight:600;border-bottom:2px solid #2a2a2a;">País</th>' +
    '<th style="padding:8px 12px;text-align:right;color:#888;font-size:10px;font-weight:600;border-bottom:2px solid #2a2a2a;">Fee ' + mesLabel + '<br><span style="font-size:8px;font-weight:400;color:#555;">U$D · ' + year + '</span></th>' +
    '<th style="padding:8px 12px;text-align:center;color:#888;font-size:10px;font-weight:600;border-bottom:2px solid #2a2a2a;">Var %<br><span style="font-size:8px;font-weight:400;color:#555;">vs ' + prevLabel + '</span></th>' +
    '<th style="padding:8px 12px;text-align:right;color:#888;font-size:10px;font-weight:600;border-bottom:2px solid #2a2a2a;">Fee YTD<br><span style="font-size:8px;font-weight:400;color:#555;">Ene–' + mesLabel + ' · U$D</span></th>' +
    '</tr>' + tableRows + '</table></td></tr>' +

    // Footer con TC
    '<tr><td style="background:#0d0d0d;padding:16px 32px;border-top:1px solid #2a2a2a;">' +
    (tcLine ? '<div style="font-size:10px;color:#555;font-family:monospace;margin-bottom:10px;"><span style="font-size:9px;font-weight:700;color:#444;text-transform:uppercase;letter-spacing:.06em;">TC Ref.&nbsp;&nbsp;</span>' + tcLine + '</div>' : '') +
    '<div style="font-size:11px;color:#888;margin-bottom:6px;">Ante cualquier consulta, no dude en contactarse con <a href="mailto:mbergara@bigg.fit" style="color:#adff19;text-decoration:none;font-weight:600;">mbergara@bigg.fit</a>.</div>' +
    '<div style="font-size:10px;color:#444;">Generado por BIGG Finance · ' + new Date().toLocaleDateString('es-AR') + '</div>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';
}

export default function ReporteFeeModal({ franchises, comps, tiposCambio = {}, defaultMonth, defaultYear, onClose }) {
  const def = prevMonth(defaultMonth, defaultYear);
  const [month,        setMonth]        = useState(def.month);
  const [year,         setYear]         = useState(def.year);
  const [sortCol,      setSortCol]      = useState("feeMesUSD");
  const [sortDir,      setSortDir]      = useState("desc");
  const [filterSedes,  setFilterSedes]  = useState(new Set());
  const [filterPaises, setFilterPaises] = useState(new Set());
  const [showSendPanel, setShowSendPanel] = useState(false);
  const [sendEmails,    setSendEmails]    = useState(() => { try { return localStorage.getItem("bigg_feeReportEmails") || ""; } catch { return ""; } });
  const [sendState,     setSendState]     = useState("idle"); // "idle"|"sending"|"sent"|"error"

  const prev = prevMonth(month, year);

  // ¿Hay TC cargado para el mes seleccionado?
  const tcKey     = `${year}-${String(month+1).padStart(2,'0')}`;
  const prevKey   = `${prev.year}-${String(prev.month+1).padStart(2,'0')}`;
  const tcActual  = tiposCambio[tcKey]  ?? null;
  const tcPrevRef = tiposCambio[prevKey] ?? null;
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

  const handleSendReport = async () => {
    if (!sendEmails.trim()) return;
    setSendState("sending");
    try {
      try { localStorage.setItem("bigg_feeReportEmails", sendEmails); } catch {}
      const html = buildEmailHtml({ rows, month, year, prev, tcActual, tcPrevRef });
      await sendMailFr({
        to: sendEmails.trim(),
        subject: `Reporte de Fee — ${MONTHS[month]} ${year}`,
        htmlBody: html,
      });
      setSendState("sent");
    } catch {
      setSendState("error");
    }
  };

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
            <button
              onClick={() => { setShowSendPanel(s => !s); setSendState("idle"); }}
              style={{ fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 6,
                background: showSendPanel ? "rgba(173,255,25,.15)" : "transparent",
                color: showSendPanel ? "var(--accent)" : "var(--text2)",
                border: `1px solid ${showSendPanel ? "var(--accent)" : "var(--border2)"}`,
                cursor: "pointer" }}
            >
              ✉ Enviar
            </button>
            <button className="ghost" style={{ fontSize: 13, padding: "4px 10px" }} onClick={onClose}>✕ Cerrar</button>
          </div>
        </div>

        {/* Panel de envío */}
        {showSendPanel && (() => {
          const recipientCount = sendEmails.trim().split(",").filter(e => e.trim()).length;
          return (
            <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", background: "rgba(173,255,25,.03)" }}>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", letterSpacing: ".07em", display: "block", marginBottom: 6 }}>
                    DESTINATARIOS — separados por coma
                  </label>
                  <textarea
                    value={sendEmails}
                    onChange={e => { setSendEmails(e.target.value); setSendState("idle"); }}
                    placeholder="director@bigg.fit, cfo@bigg.fit"
                    rows={2}
                    style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border2)", borderRadius: 7,
                      padding: "8px 12px", color: "var(--text)", fontSize: 12, resize: "none",
                      boxSizing: "border-box", fontFamily: "inherit" }}
                  />
                  {/* Resumen del reporte */}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 18 }}>
                  <button
                    onClick={handleSendReport}
                    disabled={!sendEmails.trim() || sendState === "sending"}
                    className="btn"
                    style={{ padding: "8px 22px", fontSize: 12, whiteSpace: "nowrap",
                      opacity: !sendEmails.trim() ? 0.5 : 1 }}
                  >
                    {sendState === "sending" ? "Enviando…" : "✉ Enviar reporte"}
                  </button>
                  <button onClick={() => setShowSendPanel(false)} className="ghost" style={{ fontSize: 11, padding: "5px 12px" }}>
                    Cancelar
                  </button>
                </div>
              </div>
              {sendState === "sent" && (
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--green)", fontWeight: 600 }}>
                  ✓ Reporte enviado a {recipientCount} destinatario{recipientCount !== 1 ? "s" : ""}
                </div>
              )}
              {sendState === "error" && (
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--red)" }}>
                  ⚠ Error al enviar. Verificá los destinatarios e intentá de nuevo.
                </div>
              )}
            </div>
          );
        })()}

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

          const EU_PAISES_KPI = ["España", "Portugal"];
          const rowsARG   = rows.filter(r => r.pais === "Argentina");
          const rowsLATAM = rows.filter(r => r.pais !== "Argentina" && !EU_PAISES_KPI.includes(r.pais));
          const rowsEU    = rows.filter(r => EU_PAISES_KPI.includes(r.pais));

          const feeARG_kpi   = rowsARG.reduce((s,r)   => s + (r.feeMes_USD || 0), 0);
          const feeLATAM_kpi = rowsLATAM.reduce((s,r) => s + (r.feeMes_USD || 0), 0);
          const feeEU_kpi    = rowsEU.reduce((s,r)    => s + (r.feeMes_USD || 0), 0);

          // Var % por región
          const varReg = (regRows) => {
            const m = regRows.reduce((s,r) => s + (r.feeMes_USD  || 0), 0);
            const p = regRows.reduce((s,r) => s + (r.feePrev_USD || 0), 0);
            if (!p) return null;
            const v = ((m - p) / p) * 100;
            return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
          };

          // Promedio por región (solo sedes que pagaron)
          const promReg = (regRows) => {
            const pag = regRows.filter(r => !r.sinFeeMes && r.hasOpened);
            if (!pag.length) return null;
            return pag.reduce((s,r) => s + (r.feeMes_USD || 0), 0) / pag.length;
          };

          // YTD por región
          const ytdARG   = rowsARG.reduce((s,r)   => s + (r.feeYTD_USD || 0), 0);
          const ytdLATAM = rowsLATAM.reduce((s,r) => s + (r.feeYTD_USD || 0), 0);
          const ytdEU    = rowsEU.reduce((s,r)    => s + (r.feeYTD_USD || 0), 0);

          // Pagan fee por región (pagando / total activas con historial)
          const pagARG   = rowsARG.filter(r   => !r.sinFeeMes && r.hasOpened).length;
          const pagLATAM = rowsLATAM.filter(r => !r.sinFeeMes && r.hasOpened).length;
          const pagEU    = rowsEU.filter(r    => !r.sinFeeMes && r.hasOpened).length;
          const totARG   = rowsARG.filter(r   => r.hasOpened).length;
          const totLATAM = rowsLATAM.filter(r => r.hasOpened).length;
          const totEU    = rowsEU.filter(r    => r.hasOpened).length;

          const numMeses = month + 1; // Ene=0 → 1 mes, Mayo=4 → 5 meses

          const kpis = [
            {
              label: "Pagan fee",
              value: `${pagando.length} / ${abiertas.length}`,
              sub: null,
              breakdown: [
                ["ARG",    `${pagARG} / ${totARG}`],
                ["LATAM",  `${pagLATAM} / ${totLATAM}`],
                ["Europa", `${pagEU} / ${totEU}`],
              ],
              bdMono: false,
            },
            {
              label: `Fee ${MONTHS[month]}`,
              value: fmtMoney(totMesUSD, "USD"),
              sub: null,
              breakdown: [["ARG", feeARG_kpi], ["LATAM", feeLATAM_kpi], ["Europa", feeEU_kpi]],
            },
            {
              label: `Var % vs ${MONTHS[prev.month]}`,
              value: varLabel,
              valueColor: varColor,
              sub: null,
              breakdown: [
                ["ARG",    varReg(rowsARG)],
                ["LATAM",  varReg(rowsLATAM)],
                ["Europa", varReg(rowsEU)],
              ],
              bdMono: false,
            },
            {
              label: "Promedio por sede",
              value: fmtMoney(promUSD, "USD"),
              sub: null,
              breakdown: [
                ["ARG",    promReg(rowsARG)   != null ? promReg(rowsARG)   : null],
                ["LATAM",  promReg(rowsLATAM) != null ? promReg(rowsLATAM) : null],
                ["Europa", promReg(rowsEU)    != null ? promReg(rowsEU)    : null],
              ],
            },
            {
              label: `YTD Ene–${MONTHS[month]}`,
              value: fmtMoney(ytdUSD, "USD"),
              sub: null,
              breakdown: [["ARG", ytdARG], ["LATAM", ytdLATAM], ["Europa", ytdEU]],
            },
          ];

          return (
            <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
              {kpis.map(({ label, value, sub, valueColor, breakdown, bdMono }) => (
                <div key={label} style={{ flex: 1, padding: "10px 14px", borderRight: "1px solid var(--border)", textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: "var(--text2)", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: valueColor ?? "var(--text)" }}>{value}</div>
                  {sub && <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 2, fontFamily: "monospace" }}>{sub}</div>}
                  {breakdown && (
                    <div style={{ marginTop: 7, borderTop: "1px solid var(--border)", paddingTop: 5 }}>
                      {breakdown.map(([lbl, val]) => {
                        const display = val == null ? "—"
                          : bdMono === false ? String(val)
                          : typeof val === "number" ? fmtMoney(val, "USD")
                          : String(val);
                        return (
                          <div key={lbl} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2, padding: "0 2px" }}>
                            <span style={{ fontSize: 9, color: "var(--text2)", opacity: .7 }}>{lbl}</span>
                            <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text2)" }}>{display}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })()}

        {/* TC Referencia strip */}
        {(() => {
          const arsC = tcActual?.arsUSD  > 0 ? tcActual.arsUSD  : null;
          const arsP = tcPrevRef?.arsUSD > 0 ? tcPrevRef.arsUSD : null;
          const eurC = tcActual?.eurUSD  > 0 ? tcActual.eurUSD  : null;
          const eurP = tcPrevRef?.eurUSD > 0 ? tcPrevRef.eurUSD : null;
          if (!arsC && !arsP && !eurC && !eurP) return null;

          const deltaArsPct = arsC && arsP ? ((arsC - arsP) / arsP) * 100 : null;
          const deltaEurPct = eurC && eurP ? ((eurC - eurP) / eurP) * 100 : null;
          const fmtARS = (v) => v ? "$ " + Math.round(v).toLocaleString("es-AR") : "—";
          const fmtEUR = (v) => v ? v.toFixed(2) : "—";
          const fmtD   = (d) => d == null ? null : (d >= 0 ? "+" : "") + d.toFixed(1) + "%";

          const Item = ({ label, valC, valP, delta, fmt }) => (
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11 }}>
              <span style={{ color: "var(--text2)", fontWeight: 700, fontSize: 10, minWidth: 52 }}>{label}</span>
              <span style={{ fontFamily: "monospace", color: "var(--text)", fontWeight: 600 }}>{fmt(valC)}</span>
              <span style={{ fontSize: 9, color: "var(--text2)", opacity: .7 }}>{MONTHS[month]}</span>
              <span style={{ color: "var(--border2)" }}>·</span>
              <span style={{ fontFamily: "monospace", color: "var(--text2)" }}>{fmt(valP)}</span>
              <span style={{ fontSize: 9, color: "var(--text2)", opacity: .7 }}>{MONTHS[prev.month]}</span>
              {delta != null && (
                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text2)", marginLeft: 2 }}>
                  ({fmtD(delta)})
                </span>
              )}
            </div>
          );

          return (
            <div style={{ padding: "7px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 28, background: "rgba(0,0,0,.12)", flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, color: "var(--text2)", fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", whiteSpace: "nowrap", opacity: .6 }}>TC ref.</span>
              {(arsC || arsP) && <Item label="ARS/USD" valC={arsC} valP={arsP} delta={deltaArsPct} fmt={fmtARS} />}
              {(arsC || arsP) && (eurC || eurP) && <span style={{ color: "var(--border)", fontSize: 14, opacity: .4 }}>|</span>}
              {(eurC || eurP) && <Item label="EUR/USD" valC={eurC} valP={eurP} delta={deltaEurPct} fmt={fmtEUR} />}
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
                            ? <span style={{ color: "var(--text2)" }}>0</span>
                            : fmtNum(r.feeMes_USD)}
                      </td>
                      <td style={{ ...tdS, textAlign: "center", fontWeight: 600, color: varColor, fontFamily: "inherit" }}>
                        {varLabel}
                      </td>
                      <td style={{ ...tdS, color: "var(--text2)" }}>
                        {r.feeYTD_USD ? fmtNum(r.feeYTD_USD) : "—"}
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
