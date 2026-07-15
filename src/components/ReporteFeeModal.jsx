import { useState, useMemo, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { MONTHS, AVAILABLE_YEARS, makeType, computeSaldoReal, countryToCurrency } from "../lib/helpers";
import { todayDmy } from "../data/franchisor";
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

// Monto de un comprobante; con neto=true usa amountNeto (sin IVA) cuando está cargado.
// El fee de Argentina se factura con IVA 21% (ventas de Bigg Eye vienen netas), así que para
// comparar contra el % de contrato se usa el neto. Donde no hay IVA (USD/EUR), amountNeto viene
// vacío → cae en amount, que ya es neto. Sin hardcodear país.
function compMonto(c, neto) {
  if (neto && c.amountNeto !== "" && c.amountNeto != null) return Number(c.amountNeto) || 0;
  return Number(c.amount) || 0;
}
function sumFee(frComps, year, month, neto = false) {
  const factType = makeType("FACTURA", "FEE");
  const ncType   = makeType("NC",      "FEE");
  return frComps
    .filter(c => c.month === month && c.year === year && (c.type === factType || c.type === ncType))
    .reduce((s, c) => s + (c.type === ncType ? -compMonto(c, neto) : compMonto(c, neto)), 0);
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
function buildRows(franchises, comps, year, month, tiposCambio = {}, saldoInicial = {}, ventasEye = {}) {
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

    // ── DSO nominal en meses: Deuda total (ÑAKO + BIGG FIT) / Promedio mensual YTD ──
    // graceUntil = hoy: los PAGO ya recibidos (aunque fechados el mes siguiente) descuentan
    // la deuda del período — "deuda a la fecha de envío", no "deuda al cierre del mes".
    const hoy = todayDmy();
    const saldoNako = computeSaldoReal(fr.id, year, month, comps, saldoInicial, feeCurrency, null, "ÑAKO SRL", null, hoy);
    const saldoBigg = computeSaldoReal(fr.id, year, month, comps, saldoInicial, feeCurrency, null, "BIGG FIT LLC", null, hoy);
    const deuda_USD = Math.max(0, feeToUSD(saldoNako + saldoBigg, feeCurrency, tc));
    const mesesYTD      = month + 1; // Ene=0 → 1 mes, May=4 → 5 meses
    const feePromedio   = feeYTD_USD > 0 ? feeYTD_USD / mesesYTD : feePrev_USD;
    const saludRatio    = feePromedio > 0 ? deuda_USD / feePromedio : null;

    // ── Facturado vs contrato: % efectivo cobrado (fee/ventas) vs % de contrato (maestro) ──
    // Ventas de Bigg Eye vienen en moneda local → a USD igual que el fee (mismo TC).
    const royaltyContrato = parseFloat(fr.royaltyPct ?? "7") || 7;
    const sinVentasEye    = fr.biggEyeId == null;
    const ventasMes       = ventasEye[fr.id]?.ventas;
    // Las ventas de Bigg Eye vienen en la moneda de OPERACIÓN del país (CLP/PEN/…), que
    // puede diferir de la moneda del fee (Chile/Perú facturan el fee en USD). Convertir con esa.
    const ventasCurrency  = countryToCurrency(fr.country);
    const ventas_USD      = ventasMes != null ? feeToUSD(ventasMes, ventasCurrency, tc) : null;
    // % cobrado vs contrato: fee NETO de IVA (Argentina factura con IVA; las ventas vienen netas).
    const feeMesNeto_USD  = feeToUSD(sumFee(frComps, year, month, true), feeCurrency, tc);
    const pctCobrado      = (ventas_USD && ventas_USD > 0) ? (feeMesNeto_USD / ventas_USD) * 100 : null;

    rows.push({
      sede: fr.name, sociedad: fr.sociedad ?? "—", pais: fr.country ?? "—",
      moneda: feeCurrency, feeMes, feePrev,
      feeMes_USD, feePrev_USD, feeYTD_USD, varPct,
      deuda_USD, saludRatio,
      royaltyContrato, ventas_USD, pctCobrado, sinVentasEye, feeMesNeto_USD,
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
        padding: "9px 12px", fontSize: 13, fontWeight: 600,
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
      padding: "7px 10px", fontSize: 12, fontWeight: 600,
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
    '<tr><td style="font-size:11px;color:#666;padding:2px 4px;text-align:left;">' + l +
    '</td><td style="font-size:11px;color:#aaa;font-family:monospace;padding:2px 4px;text-align:right;">' + v + '</td></tr>'
  ).join('');

  const kpi = (label, val, color, items, border) =>
    '<td class="kpi-cell" style="text-align:center;padding:20px 12px;' + (border !== false ? 'border-right:1px solid #2a2a2a;' : '') + 'vertical-align:top;white-space:nowrap;">' +
    '<div style="font-size:11px;color:#777;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;white-space:nowrap;">' + label + '</div>' +
    '<div class="kpi-val" style="font-size:30px;font-weight:700;color:' + (color || '#fff') + ';font-family:monospace;margin-bottom:' + (items ? '10' : '0') + 'px;white-space:nowrap;line-height:1.1;">' + val + '</div>' +
    (items ? '<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 auto;">' + bd(items) + '</table>' : '') +
    '</td>';

  // Colores: light mode por defecto, dark mode via media query
  const C = {
    bodyBg:   '#f4f4f4',
    kpiBg:    '#ffffff', kpiBorder: '#e0e0e0',
    kpiLabel: '#666666', kpiVal:    '#111111', kpiSub: '#888888',
    tableBg:  '#ffffff',
    thBg:     '#f0f0f0', thText:    '#444444', thBorder: '#cccccc',
    rowEven:  '#ffffff', rowOdd:    '#f7f7f7', rowBorder: '#eeeeee',
    tdMain:   '#111111', tdSec:     '#555555', tdMuted: '#999999',
    green:    '#16a34a', red:       '#dc2626', orange:  '#d97706',
    footerBg: '#f0f0f0', footerText:'#666666', footerMuted:'#999999',
  };

  const tableRows = rows.map((r, i) => {
    const vl = r.feePrev === 0 && r.feeMes > 0 ? 'Nuevo' : r.varPct == null ? '—' : fmtP(r.varPct);
    const vc = vl === 'Nuevo' ? '#65a30d' : r.varPct == null ? C.tdMuted : r.varPct > 0 ? C.green : r.varPct < 0 ? C.red : C.tdMain;
    const bg = i % 2 === 0 ? C.rowEven : C.rowOdd;
    const dsoColor = !r.hasOpened || r.deuda_USD === 0 ? C.green
      : r.saludRatio < 1  ? C.green
      : r.saludRatio < 3  ? C.orange
      : C.red;
    const dsoLabel = !r.hasOpened || r.deuda_USD === 0
      ? '✓'
      : 'U$D ' + fmtN(r.deuda_USD) + (r.saludRatio != null ? ' (' + (r.saludRatio < 1 ? '&lt;1' : r.saludRatio.toFixed(1)) + ')' : '');
    const cobradoLabel = r.sinVentasEye ? 's/d' : r.pctCobrado == null ? '—' : r.pctCobrado.toFixed(1) + '%';
    const cobradoColor = r.sinVentasEye || r.pctCobrado == null ? C.tdMuted
      : Math.abs(r.pctCobrado - r.royaltyContrato) <= 0.3 ? C.green
      : r.pctCobrado < r.royaltyContrato ? C.red
      : C.orange;
    const contratoLabel = r.royaltyContrato ? r.royaltyContrato + '%' : '—';
    return '<tr class="em-row" style="background:' + bg + ';border-bottom:1px solid ' + C.rowBorder + ';">' +
      '<td style="padding:8px 12px;font-size:13px;color:' + (r.hasOpened ? C.tdMain : C.tdMuted) + ';font-weight:600;">' + r.sede + '</td>' +
      '<td style="padding:8px 12px;font-size:13px;color:' + C.tdSec + ';">' + r.pais + '</td>' +
      '<td style="padding:8px 12px;font-size:13px;color:' + (r.sinFeeMes ? C.tdMuted : C.tdMain) + ';font-family:monospace;text-align:right;">' + (r.sinFeeMes ? '—' : fmtN(r.feeMes_USD)) + '</td>' +
      '<td style="padding:8px 12px;font-size:13px;color:' + cobradoColor + ';font-family:monospace;text-align:center;font-weight:700;">' + cobradoLabel + '</td>' +
      '<td style="padding:8px 12px;font-size:13px;color:' + C.tdSec + ';font-family:monospace;text-align:center;">' + contratoLabel + '</td>' +
      '<td style="padding:8px 12px;font-size:13px;color:' + vc + ';font-family:monospace;text-align:center;font-weight:700;">' + vl + '</td>' +
      '<td style="padding:8px 12px;font-size:13px;color:' + C.tdMain + ';font-family:monospace;text-align:right;font-weight:700;">' + (r.feeYTD_USD ? fmtN(r.feeYTD_USD) : '—') + '</td>' +
      '<td style="padding:8px 12px;font-size:13px;color:' + dsoColor + ';font-family:monospace;text-align:center;font-weight:700;">' + dsoLabel + '</td>' +
      '</tr>';
  }).join('');

  // Fila de Total — mismo cálculo que el <tfoot> del modal.
  const tot = rows.reduce((a, r) => ({
    fee:    a.fee    + (r.feeMes_USD     || 0),
    prev:   a.prev   + (r.feePrev_USD    || 0),
    ytd:    a.ytd    + (r.feeYTD_USD     || 0),
    deuda:  a.deuda  + (r.deuda_USD      || 0),
    neto:   a.neto   + (r.feeMesNeto_USD || 0),
    ventas: a.ventas + (r.ventas_USD     || 0),
  }), { fee: 0, prev: 0, ytd: 0, deuda: 0, neto: 0, ventas: 0 });
  const totVarPct   = tot.prev > 0 ? ((tot.fee - tot.prev) / tot.prev) * 100 : null;
  const totPct      = tot.ventas > 0 ? (tot.neto / tot.ventas) * 100 : null;
  const totVarColor = totVarPct == null ? C.tdMuted : totVarPct > 0 ? C.green : totVarPct < 0 ? C.red : C.tdMain;
  const totVarLabel = totVarPct == null ? '—' : (totVarPct >= 0 ? '+' : '') + totVarPct.toFixed(1) + '%';
  const totalRow =
    '<tr style="background:' + C.tableBg + ';border-top:2px solid ' + C.thBorder + ';">' +
    '<td style="padding:8px 12px;font-size:13px;font-weight:700;color:' + C.tdMain + ';">Total</td>' +
    '<td style="padding:8px 12px;font-size:13px;font-weight:700;color:' + C.tdSec + ';">' + rows.length + ' sedes</td>' +
    '<td style="padding:8px 12px;font-size:13px;font-weight:700;color:' + C.tdMain + ';font-family:monospace;text-align:right;">' + fmtN(tot.fee) + '</td>' +
    '<td style="padding:8px 12px;font-size:13px;font-weight:700;color:' + C.tdMain + ';font-family:monospace;text-align:center;">' + (totPct != null ? totPct.toFixed(1) + '%' : '—') + '</td>' +
    '<td style="padding:8px 12px;font-size:13px;font-weight:700;color:' + C.tdSec + ';font-family:monospace;text-align:center;">—</td>' +
    '<td style="padding:8px 12px;font-size:13px;font-weight:700;color:' + totVarColor + ';font-family:monospace;text-align:center;">' + totVarLabel + '</td>' +
    '<td style="padding:8px 12px;font-size:13px;font-weight:700;color:' + C.tdMain + ';font-family:monospace;text-align:right;">' + fmtN(tot.ytd) + '</td>' +
    '<td style="padding:8px 12px;font-size:13px;font-weight:700;color:' + C.tdMain + ';font-family:monospace;text-align:center;">' + (tot.deuda > 0 ? 'U$D ' + fmtN(tot.deuda) : '✓') + '</td>' +
    '</tr>';

  const darkStyle =
    '@media (prefers-color-scheme:dark){' +
    '.em-wrap{background:#111111 !important;}' +
    '.em-kpi{background:#181818 !important;border-color:#2a2a2a !important;}' +
    '.em-kpi-cell{border-color:#2a2a2a !important;}' +
    '.em-kpi-label{color:#777 !important;}' +
    '.em-kpi-val{color:#ffffff !important;}' +
    '.em-kpi-sub{color:#aaa !important;}' +
    '.em-table-wrap{background:#111 !important;}' +
    '.em-th{background:#0d0d0d !important;color:#888 !important;border-color:#2a2a2a !important;}' +
    '.em-row{background:#161616 !important;}' +
    '.em-row:nth-child(even){background:#1a1a1a !important;}' +
    '.em-td-main{color:#ffffff !important;}' +
    '.em-td-sec{color:#888888 !important;}' +
    '.em-footer{background:#0d0d0d !important;border-color:#2a2a2a !important;}' +
    '.em-footer-text{color:#888 !important;}' +
    '.em-footer-muted{color:#444 !important;}' +
    '}';

  const mobileStyle =
    '@media only screen and (max-width:600px){' +
    '.kpi-cell{padding:8px 4px !important;}' +
    '.kpi-val{font-size:16px !important;}' +
    '}';

  const kpiL = (label, val, color, items, border) =>
    '<td class="kpi-cell em-kpi-cell" style="text-align:center;padding:20px 12px;' + (border !== false ? 'border-right:1px solid ' + C.kpiBorder + ';' : '') + 'vertical-align:top;white-space:nowrap;">' +
    '<div class="em-kpi-label" style="font-size:11px;color:' + C.kpiLabel + ';text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">' + label + '</div>' +
    '<div class="kpi-val em-kpi-val" style="font-size:30px;font-weight:700;color:' + (color === '#fff' ? C.kpiVal : color) + ';font-family:monospace;margin-bottom:' + (items ? '10' : '0') + 'px;white-space:nowrap;line-height:1.1;">' + val + '</div>' +
    (items ? '<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 auto;">' +
      items.map(([l, v]) =>
        '<tr><td class="em-kpi-sub" style="font-size:11px;color:' + C.kpiSub + ';padding:2px 4px;text-align:left;">' + l +
        '</td><td class="em-kpi-sub" style="font-size:11px;color:' + C.kpiSub + ';font-family:monospace;padding:2px 4px;text-align:right;">' + v + '</td></tr>'
      ).join('') + '</table>' : '') +
    '</td>';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' + darkStyle + mobileStyle + '</style>' +
    '</head>' +
    '<body class="em-wrap" style="margin:0;padding:0;background:' + C.bodyBg + ';font-family:Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" bgcolor="' + C.bodyBg + '"><tr><td style="padding:0;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;">' +

    // Header — siempre oscuro (logo BIGG)
    '<tr><td bgcolor="#111111" style="background:#111111;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#111111" style="background:#111111;"><tr>' +
    '<td bgcolor="#111111" style="background:#111111;padding:22px 32px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td><div style="font-size:24px;font-weight:900;color:#adff19;letter-spacing:-1px;">BIGG</div>' +
    '<div style="font-size:10px;color:#888888;margin-top:3px;text-transform:uppercase;letter-spacing:.1em;">Reporte de Fee &mdash; ' + mesLabel + ' ' + year + '</div></td>' +
    '<td align="right"><div style="font-size:10px;color:#666666;">Distribución interna</div></td>' +
    '</tr></table>' +
    '</td></tr></table></td></tr>' +

    // KPIs
    '<tr><td class="em-kpi" style="background:' + C.kpiBg + ';border-bottom:1px solid ' + C.kpiBorder + ';">' +
    '<table class="kpi-row" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    kpiL('Pagan Fee', pagando.length + ' / ' + abiertas.length, '#fff',
      [['ARG', regPag(rowsARG)], ['LATAM', regPag(rowsLATAM)], ['Europa', regPag(rowsEU)]]) +
    kpiL('Fee ' + mesLabel, fmtU(totMes), '#fff',
      [['ARG', fmtU(regFee(rowsARG))], ['LATAM', fmtU(regFee(rowsLATAM))], ['Europa', fmtU(regFee(rowsEU))]]) +
    kpiL('Var % vs ' + prevLabel, fmtP(varAgr), varColor === '#10d97a' ? C.green : varColor === '#ff5570' ? C.red : C.kpiVal,
      [['ARG', fmtP(regVar(rowsARG))], ['LATAM', fmtP(regVar(rowsLATAM))], ['Europa', fmtP(regVar(rowsEU))]]) +
    kpiL('Promedio / sede', fmtU(promUSD), '#fff',
      [['ARG', regProm(rowsARG) != null ? fmtU(regProm(rowsARG)) : '—'],
       ['LATAM', regProm(rowsLATAM) != null ? fmtU(regProm(rowsLATAM)) : '—'],
       ['Europa', regProm(rowsEU) != null ? fmtU(regProm(rowsEU)) : '—']]) +
    kpiL('YTD Ene–' + mesLabel, fmtU(ytdUSD), '#fff',
      [['ARG', fmtU(regYTD(rowsARG))], ['LATAM', fmtU(regYTD(rowsLATAM))], ['Europa', fmtU(regYTD(rowsEU))]], false) +
    '</tr></table></td></tr>' +

    // Table
    '<tr><td class="em-table-wrap" style="background:' + C.tableBg + ';">' +
    '<table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr>' +
    '<th class="em-th" style="padding:8px 12px;text-align:left;color:' + C.thText + ';font-size:14px;font-weight:600;background:' + C.thBg + ';border-bottom:2px solid ' + C.thBorder + ';">Sede</th>' +
    '<th class="em-th" style="padding:8px 12px;text-align:left;color:' + C.thText + ';font-size:14px;font-weight:600;background:' + C.thBg + ';border-bottom:2px solid ' + C.thBorder + ';">País</th>' +
    '<th class="em-th" style="padding:8px 12px;text-align:right;color:' + C.thText + ';font-size:14px;font-weight:600;background:' + C.thBg + ';border-bottom:2px solid ' + C.thBorder + ';">Fee ' + mesLabel + '<br><span style="font-size:9px;font-weight:400;color:' + C.tdMuted + ';">U$D · ' + year + '</span></th>' +
    '<th class="em-th" style="padding:8px 12px;text-align:center;color:' + C.thText + ';font-size:14px;font-weight:600;background:' + C.thBg + ';border-bottom:2px solid ' + C.thBorder + ';">% Cobrado</th>' +
    '<th class="em-th" style="padding:8px 12px;text-align:center;color:' + C.thText + ';font-size:14px;font-weight:600;background:' + C.thBg + ';border-bottom:2px solid ' + C.thBorder + ';">% Contrato</th>' +
    '<th class="em-th" style="padding:8px 12px;text-align:center;color:' + C.thText + ';font-size:14px;font-weight:600;background:' + C.thBg + ';border-bottom:2px solid ' + C.thBorder + ';">Var %<br><span style="font-size:9px;font-weight:400;color:' + C.tdMuted + ';">vs ' + prevLabel + '</span></th>' +
    '<th class="em-th" style="padding:8px 12px;text-align:right;color:' + C.thText + ';font-size:14px;font-weight:600;background:' + C.thBg + ';border-bottom:2px solid ' + C.thBorder + ';">Fee YTD<br><span style="font-size:9px;font-weight:400;color:' + C.tdMuted + ';">Ene–' + mesLabel + ' · U$D</span></th>' +
    '<th class="em-th" style="padding:8px 12px;text-align:center;color:' + C.thText + ';font-size:14px;font-weight:600;background:' + C.thBg + ';border-bottom:2px solid ' + C.thBorder + ';">Deuda (DSO)</th>' +
    '</tr>' + tableRows + totalRow + '</table></td></tr>' +

    // Footer
    '<tr><td class="em-footer" style="background:' + C.footerBg + ';padding:16px 32px;border-top:1px solid ' + C.kpiBorder + ';">' +
    (tcLine ? '<div class="em-footer-muted" style="font-size:10px;color:' + C.footerMuted + ';font-family:monospace;margin-bottom:10px;"><span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">TC Ref.&nbsp;&nbsp;</span>' + tcLine + '</div>' : '') +
    '<div class="em-footer-text" style="font-size:11px;color:' + C.footerText + ';margin-bottom:6px;">Ante cualquier consulta, no dude en contactarse con <a href="mailto:lpini@bigg.fit" style="color:#16a34a;text-decoration:none;font-weight:600;">lpini@bigg.fit</a>.</div>' +
    '<div class="em-footer-muted" style="font-size:10px;color:' + C.footerMuted + ';">Generado por BIGG Finance · ' + new Date().toLocaleDateString('es-AR') + '</div>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';
}

export default function ReporteFeeModal({ franchises, comps, saldoInicial = {}, tiposCambio = {}, defaultMonth, defaultYear, onClose }) {
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
  const [ventasEye,     setVentasEye]     = useState({});     // { [frId]: { ventas, error } } — ventas del mes desde Bigg Eye
  const [eyeLoading,    setEyeLoading]    = useState(false);
  const [eyeErrors,     setEyeErrors]     = useState([]);
  const reportRef = useRef(null);

  const prev = prevMonth(month, year);

  // Trae automáticamente las ventas del mes desde Bigg Eye (una llamada por sede con biggEyeId).
  // Se re-ejecuta al cambiar mes/año. Sirve para el % efectivo cobrado (fee/ventas) vs el % de contrato.
  useEffect(() => {
    let cancelled = false;
    const targets = franchises.filter(fr => fr.activa !== false && fr.paysFee !== false && fr.biggEyeId != null);
    if (targets.length === 0) { setVentasEye({}); setEyeErrors([]); return; }
    setEyeLoading(true);
    setEyeErrors([]);
    const m1 = month + 1;
    Promise.allSettled(
      targets.map(fr =>
        fetch(`/api/bigg-eye?location_id=${fr.biggEyeId}&month=${m1}&year=${year}`)
          .then(r => r.json())
          .then(data => ({ fr, ...data }))
      )
    ).then(results => {
      if (cancelled) return;
      const map = {}, errs = [];
      results.forEach((res, i) => {
        const fr = targets[i];
        if (res.status === "fulfilled" && res.value.error == null && res.value.ventas != null) {
          map[fr.id] = { ventas: res.value.ventas };
        } else {
          const msg = res.status === "rejected" ? res.reason?.message : res.value?.error;
          map[fr.id] = { ventas: null, error: msg || "error" };
          if (msg) errs.push(`${fr.name}: ${msg}`);
        }
      });
      setVentasEye(map);
      setEyeErrors(errs);
      setEyeLoading(false);
    });
    return () => { cancelled = true; };
  }, [franchises, month, year]);

  // ¿Hay TC cargado para el mes seleccionado?
  const tcKey     = `${year}-${String(month+1).padStart(2,'0')}`;
  const prevKey   = `${prev.year}-${String(prev.month+1).padStart(2,'0')}`;
  const tcActual  = tiposCambio[tcKey]  ?? null;
  const tcPrevRef = tiposCambio[prevKey] ?? null;
  const tcMissing = !tcActual || !(tcActual.arsUSD > 0);

  const baseRows = useMemo(
    () => buildRows(franchises, comps, year, month, tiposCambio, saldoInicial, ventasEye),
    [franchises, comps, year, month, tiposCambio, saldoInicial, ventasEye]
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
        else if (sortCol === "pctCobrado") cmp = (a.pctCobrado ?? -Infinity) - (b.pctCobrado ?? -Infinity);
        else if (sortCol === "royaltyContrato") cmp = (a.royaltyContrato ?? 0) - (b.royaltyContrato ?? 0);
        else if (sortCol === "varPct")    cmp = (a.varPct ?? -Infinity) - (b.varPct ?? -Infinity);
        else if (sortCol === "feeYTD")    cmp = a.feeYTD_USD - b.feeYTD_USD;
        else if (sortCol === "deuda")     cmp = (a.deuda_USD ?? 0) - (b.deuda_USD ?? 0);
        return cmp * dir;
      });
  }, [baseRows, filterSedes, filterPaises, sortCol, sortDir]);

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  }

  const anyFilter = filterSedes.size > 0 || filterPaises.size > 0;

  const handleSendReport = async () => {
    const to = sendEmails.split(",").map(s => s.trim()).filter(Boolean).join(",");
    if (!to) return;
    setSendState("sending");
    try {
      try { localStorage.setItem("bigg_feeReportEmails", sendEmails); } catch {}
      const html = buildEmailHtml({ rows, month, year, prev, tcActual, tcPrevRef });
      await sendMailFr({
        to,
        subject: `Reporte de Fee — ${MONTHS[month]} ${year}`,
        htmlBody: html,
      });
      setSendState("sent");
    } catch (e) {
      console.error("Error enviando reporte:", e);
      setSendState("error");
    }
  };

  const sel = { fontSize: 12, padding: "4px 9px", background: "var(--bg)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)" };
  const tdS = { padding: "8px 12px", fontSize: 13, verticalAlign: "middle", whiteSpace: "nowrap", textAlign: "right", fontFamily: "monospace" };
  const sortProps = { sortCol, sortDir, onSort: toggleSort };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, width: "min(98vw, 1120px)", maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 12px 60px rgba(0,0,0,.45)" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 24px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontSize: 18 }}>📊</span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Reporte de Fee</div>
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
                <div key={label} style={{ flex: 1, padding: "16px 16px", borderRight: "1px solid var(--border)", textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "var(--text2)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{label}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "monospace", color: valueColor ?? "var(--text)", lineHeight: 1.1 }}>{value}</div>
                  {sub && <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 3, fontFamily: "monospace" }}>{sub}</div>}
                  {breakdown && (
                    <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 7 }}>
                      {breakdown.map(([lbl, val]) => {
                        const display = val == null ? "—"
                          : bdMono === false ? String(val)
                          : typeof val === "number" ? fmtMoney(val, "USD")
                          : String(val);
                        return (
                          <div key={lbl} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3, padding: "0 2px" }}>
                            <span style={{ fontSize: 11, color: "var(--text2)", opacity: .8 }}>{lbl}</span>
                            <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text2)" }}>{display}</span>
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
              <span style={{ fontSize: 9, color: "var(--text2)", opacity: .7 }}>{MONTHS[month]}</span>
              <span style={{ fontFamily: "monospace", color: "var(--text)", fontWeight: 600 }}>{fmt(valC)}</span>
              <span style={{ color: "var(--border2)" }}>·</span>
              <span style={{ fontSize: 9, color: "var(--text2)", opacity: .7 }}>{MONTHS[prev.month]}</span>
              <span style={{ fontFamily: "monospace", color: "var(--text2)" }}>{fmt(valP)}</span>
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

        {/* Banner de carga de ventas Bigg Eye (para el % cobrado) */}
        {eyeLoading && (
          <div style={{ flexShrink: 0, borderBottom: "1px solid var(--border)" }}>
            <style>{`@keyframes feeEyeBar{0%{left:-40%}100%{left:100%}}@keyframes feeEyePulse{0%,100%{opacity:.4}50%{opacity:1}}`}</style>
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 24px", fontSize: 12, color: "var(--accent)", background: "rgba(173,255,25,.06)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--lime)", animation: "feeEyePulse 1s ease-in-out infinite", flexShrink: 0 }} />
              <span>Trayendo ventas de BIGG Eye para calcular el <b>% cobrado</b>…</span>
            </div>
            <div style={{ position: "relative", height: 2, background: "var(--border)", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, height: "100%", width: "40%", background: "var(--lime)", animation: "feeEyeBar 1.1s ease-in-out infinite" }} />
            </div>
          </div>
        )}

        {!eyeLoading && eyeErrors.length > 0 && (
          <div style={{ padding: "5px 24px", fontSize: 10, color: "var(--text2)", background: "rgba(0,0,0,.12)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}
               title={eyeErrors.join("\n")}>
            ⚠ {eyeErrors.length} sede{eyeErrors.length !== 1 ? "s" : ""} sin ventas de Bigg Eye este mes
          </div>
        )}

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
                    Fee {MONTHS[month]}
                  </SortTh>
                  <SortTh col="pctCobrado" align="center" {...sortProps}>
                    % Cobrado
                  </SortTh>
                  <SortTh col="royaltyContrato" align="center" {...sortProps}>
                    % Contrato
                  </SortTh>
                  <SortTh col="varPct" align="center" {...sortProps}>
                    Var % vs {MONTHS[prev.month]}
                  </SortTh>
                  <SortTh col="feeYTD" {...sortProps}>
                    Fee YTD
                  </SortTh>
                  <SortTh col="deuda" align="center" {...sortProps}>
                    Deuda (DSO)
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
                      <td style={{ ...tdS, textAlign: "center", fontWeight: 700 }}>
                        {r.sinVentasEye ? (
                          <span style={{ color: "var(--text2)", fontSize: 10 }} title="Sin Bigg Eye ID — ventas no disponibles">s/d</span>
                        ) : r.pctCobrado == null ? (
                          <span style={{ color: "var(--text2)", fontWeight: 400 }}>{eyeLoading ? "…" : "—"}</span>
                        ) : (() => {
                          const diff = r.pctCobrado - r.royaltyContrato;
                          const col = Math.abs(diff) <= 0.3 ? "var(--green)" : diff < 0 ? "var(--red)" : "var(--orange)";
                          return <span style={{ color: col }}>{r.pctCobrado.toFixed(1)}%</span>;
                        })()}
                      </td>
                      <td style={{ ...tdS, textAlign: "center", color: "var(--text2)" }}>
                        {r.royaltyContrato ? `${r.royaltyContrato}%` : "—"}
                      </td>
                      <td style={{ ...tdS, textAlign: "center", fontWeight: 600, color: varColor, fontFamily: "inherit" }}>
                        {varLabel}
                      </td>
                      <td style={{ ...tdS, color: "var(--text2)" }}>
                        {r.feeYTD_USD ? fmtNum(r.feeYTD_USD) : "—"}
                      </td>
                      <td style={{ ...tdS, textAlign: "center" }}>
                        {!r.hasOpened ? (
                          <span style={{ color: "var(--text2)" }}>—</span>
                        ) : r.deuda_USD === 0 && r.saludRatio === null ? (
                          <span style={{ color: "var(--green)", fontWeight: 700 }}>✓</span>
                        ) : (() => {
                          const dsoColor = r.saludRatio === null ? "var(--text2)"
                            : r.saludRatio < 1.5 ? "var(--green)"
                            : r.saludRatio < 3   ? "var(--orange)"
                            : "var(--red)";
                          return (
                            <span style={{ fontWeight: 700, color: dsoColor, fontSize: 11 }}>
                              {r.deuda_USD > 0 ? `U$D ${fmtNum(r.deuda_USD)}` : "✓"}
                              {r.saludRatio !== null && r.deuda_USD > 0 && (
                                <span style={{ fontWeight: 400, fontSize: 9, opacity: 0.85, marginLeft: 4 }}>
                                  ({r.saludRatio < 1 ? "<1" : r.saludRatio.toFixed(1)})
                                </span>
                              )}
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {(() => {
                  const tot = rows.reduce((a, r) => ({
                    fee:    a.fee    + (r.feeMes_USD     || 0),
                    prev:   a.prev   + (r.feePrev_USD    || 0),
                    ytd:    a.ytd    + (r.feeYTD_USD     || 0),
                    deuda:  a.deuda  + (r.deuda_USD      || 0),
                    neto:   a.neto   + (r.feeMesNeto_USD || 0),
                    ventas: a.ventas + (r.ventas_USD     || 0),
                  }), { fee: 0, prev: 0, ytd: 0, deuda: 0, neto: 0, ventas: 0 });
                  const totVar = tot.prev > 0 ? ((tot.fee - tot.prev) / tot.prev) * 100 : null;
                  const totPct = tot.ventas > 0 ? (tot.neto / tot.ventas) * 100 : null;
                  const varColor = totVar == null ? "var(--text2)" : totVar > 0 ? "var(--green)" : totVar < 0 ? "var(--red)" : "var(--text2)";
                  const ft = { ...tdS, borderTop: "2px solid var(--border)", background: "var(--bg)", fontWeight: 700 };
                  return (
                    <tr>
                      <td style={{ ...ft, textAlign: "left", fontFamily: "inherit" }}>Total</td>
                      <td style={{ ...ft, textAlign: "left", color: "var(--text2)", fontFamily: "inherit" }}>{rows.length} sedes</td>
                      <td style={ft}>{fmtNum(tot.fee)}</td>
                      <td style={{ ...ft, textAlign: "center" }}>{totPct != null ? totPct.toFixed(1) + "%" : "—"}</td>
                      <td style={{ ...ft, textAlign: "center", color: "var(--text2)" }}>—</td>
                      <td style={{ ...ft, textAlign: "center", color: varColor, fontFamily: "inherit" }}>
                        {totVar == null ? "—" : (totVar >= 0 ? "+" : "") + totVar.toFixed(1) + "%"}
                      </td>
                      <td style={ft}>{fmtNum(tot.ytd)}</td>
                      <td style={{ ...ft, textAlign: "center" }}>{tot.deuda > 0 ? `U$D ${fmtNum(tot.deuda)}` : "✓"}</td>
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
