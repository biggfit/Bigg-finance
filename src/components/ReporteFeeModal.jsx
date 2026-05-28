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

const fmtPct = (n) => (n == null ? "—" : `${n.toFixed(1)}%`);

// Mes anterior (maneja enero → diciembre del año anterior)
function prevMonth(month, year) {
  return month === 0
    ? { month: 11, year: year - 1 }
    : { month: month - 1, year };
}

// ─── lógica del reporte ──────────────────────────────────────────────────────
function buildRows(franchises, comps, year, month) {
  const rows = [];

  for (const fr of franchises) {
    if (fr.activa === false) continue;

    const frComps = comps[fr.id] ?? [];

    // Facturas de fee del mes
    const feeType  = makeType("FACTURA", "FEE");
    const feeComps = frComps.filter(c => c.type === feeType && c.month === month && c.year === year);
    const feeAmount = feeComps.reduce((s, c) => s + (c.amount || 0), 0);
    if (feeAmount === 0) continue;

    const feeCurrency = feeComps[0]?.currency ?? fr.feeMoneda ?? fr.currency ?? "ARS";

    // Fee de contrato
    const feeContrato = parseFloat(fr.feeImporte || "0") || null;

    // Descuento
    let descPct   = null;
    let descLabel = "Variable";
    if (feeContrato && feeContrato > 0) {
      descPct   = Math.max(0, (1 - feeAmount / feeContrato) * 100);
      descLabel = descPct > 0.5 ? fmtPct(descPct) : "Sin descuento";
    }

    // Estado de pago: busco pagos en el mes y el siguiente
    const pagos = frComps.filter(c => {
      if (c.type !== "PAGO" && c.type !== "PAGO_PAUTA") return false;
      const mDiff = (c.year - year) * 12 + (c.month - month);
      return mDiff >= 0 && mDiff <= 2;
    });
    const totalPagado = pagos.reduce((s, c) => s + (c.amount || 0), 0);
    const estadoPago  = pagos.length === 0
      ? "Sin pago"
      : Math.abs(totalPagado - feeAmount) <= Math.max(1, feeAmount * 0.03)
      ? "Pagado"
      : totalPagado >= feeAmount
      ? "Pagado (exceso)"
      : "Pago parcial";

    rows.push({
      sede:      fr.name,
      sociedad:  fr.sociedad  ?? "—",
      pais:      fr.country   ?? "—",
      moneda:    feeCurrency,
      feeContrato,
      feeAmount,
      descPct,
      descLabel,
      estadoPago,
    });
  }

  return rows.sort((a, b) =>
    a.sociedad.localeCompare(b.sociedad) ||
    a.pais.localeCompare(b.pais) ||
    a.sede.localeCompare(b.sede)
  );
}

// ─── descarga Excel ──────────────────────────────────────────────────────────
function downloadExcel(rows, year, month) {
  const wb   = XLSX.utils.book_new();
  const bySoc = {};
  for (const r of rows) {
    if (!bySoc[r.sociedad]) bySoc[r.sociedad] = [];
    bySoc[r.sociedad].push(r);
  }

  const HEADERS = ["Sede", "País", "Moneda", "Fee Contrato", "Fee Facturado", "Descuento", "Estado Pago"];

  for (const [soc, socRows] of Object.entries(bySoc)) {
    const data = [HEADERS, ...socRows.map(r => [
      r.sede,
      r.pais,
      r.moneda,
      r.feeContrato ?? "",
      r.feeAmount,
      r.descPct != null ? r.descPct / 100 : "",
      r.estadoPago,
    ])];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const numFmt = "#,##0.00";
    const pctFmt = "0.0%";
    socRows.forEach((_, i) => {
      const row = i + 2;
      const cellD = ws[`D${row}`]; if (cellD?.t === "n") cellD.z = numFmt;
      const cellE = ws[`E${row}`]; if (cellE?.t === "n") cellE.z = numFmt;
      if (data[i + 1][5] !== "") {
        ws[XLSX.utils.encode_cell({ r: row - 1, c: 5 })] = { v: data[i + 1][5], t: "n", z: pctFmt };
      }
    });
    ws["!cols"] = [24, 14, 8, 16, 16, 12, 14].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, soc.slice(0, 31));
  }

  // Hoja resumen
  const resData = [
    ["Sociedad", "Sedes", "Fee Total ARS", "Fee Total USD", "Fee Total EUR", "Con descuento", "Sin pago"],
    ...Object.entries(bySoc).map(([soc, rs]) => [
      soc,
      rs.length,
      rs.filter(r => r.moneda === "ARS").reduce((s, r) => s + r.feeAmount, 0),
      rs.filter(r => r.moneda === "USD").reduce((s, r) => s + r.feeAmount, 0),
      rs.filter(r => r.moneda === "EUR").reduce((s, r) => s + r.feeAmount, 0),
      rs.filter(r => r.descPct && r.descPct > 0.5).length,
      rs.filter(r => r.estadoPago === "Sin pago").length,
    ]),
  ];
  const wsRes = XLSX.utils.aoa_to_sheet(resData);
  wsRes["!cols"] = [28, 8, 16, 14, 14, 14, 10].map(w => ({ wch: w }));
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
  // Abrir siempre en el mes anterior
  const def = prevMonth(defaultMonth, defaultYear);
  const [month, setMonth] = useState(def.month);
  const [year,  setYear]  = useState(def.year);

  const rows  = useMemo(() => buildRows(franchises, comps, year, month), [franchises, comps, year, month]);
  const bySoc = useMemo(() => {
    const m = {};
    for (const r of rows) { if (!m[r.sociedad]) m[r.sociedad] = []; m[r.sociedad].push(r); }
    return m;
  }, [rows]);

  const conDescuento = rows.filter(r => r.descPct && r.descPct > 0.5).length;
  const sinPago      = rows.filter(r => r.estadoPago === "Sin pago").length;

  const sel = { fontSize: 12, padding: "4px 9px", background: "var(--bg)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)" };
  const thS = { padding: "7px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--text2)", borderBottom: "2px solid var(--border)", whiteSpace: "nowrap", background: "var(--bg)" };
  const tdS = { padding: "6px 10px", fontSize: 11, verticalAlign: "middle", whiteSpace: "nowrap" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 14, width: "min(98vw, 980px)", maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 12px 60px rgba(0,0,0,.45)" }}>

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
              onClick={() => downloadExcel(rows, year, month)}
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
            { label: "Sedes con fee",    value: rows.length },
            { label: "Total ARS",        value: fmtMoney(rows.filter(r => r.moneda === "ARS").reduce((s, r) => s + r.feeAmount, 0), "ARS") },
            { label: "Total USD",        value: fmtMoney(rows.filter(r => r.moneda === "USD").reduce((s, r) => s + r.feeAmount, 0), "USD") },
            { label: "Total EUR",        value: fmtMoney(rows.filter(r => r.moneda === "EUR").reduce((s, r) => s + r.feeAmount, 0), "EUR") },
            { label: "Con descuento",    value: conDescuento },
            { label: "Sin pago regist.", value: sinPago },
          ].map(({ label, value }) => (
            <div key={label} style={{ flex: 1, padding: "12px 16px", borderRight: "1px solid var(--border)", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "var(--text2)", marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace" }}>{value}</div>
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
                      const tot = socRows.filter(r => r.moneda === cur).reduce((s, r) => s + r.feeAmount, 0);
                      return tot > 0 ? <span key={cur} style={{ marginLeft: 12 }}>{fmtMoney(tot, cur)}</span> : null;
                    })}
                  </span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={thS}>Sede</th>
                      <th style={thS}>País</th>
                      <th style={{ ...thS, textAlign: "right" }}>Fee Contrato</th>
                      <th style={{ ...thS, textAlign: "right" }}>Fee Facturado</th>
                      <th style={{ ...thS, textAlign: "center" }}>Descuento</th>
                      <th style={{ ...thS, textAlign: "center" }}>Estado Pago</th>
                    </tr>
                  </thead>
                  <tbody>
                    {socRows.map((r, i) => {
                      const estadoColor = r.estadoPago === "Pagado" || r.estadoPago === "Pagado (exceso)" ? "green" : r.estadoPago === "Pago parcial" ? "yellow" : "red";
                      const dscColor    = !r.descPct || r.descPct <= 0.5 ? null : r.descPct > 20 ? "red" : "yellow";
                      return (
                        <tr key={r.sede} style={{ background: i % 2 === 0 ? "var(--bg)" : "var(--bg2)", borderBottom: "1px solid var(--border)" }}>
                          <td style={{ ...tdS, fontWeight: 600 }}>{r.sede}</td>
                          <td style={{ ...tdS, color: "var(--text2)" }}>{r.pais}</td>
                          <td style={{ ...tdS, textAlign: "right", fontFamily: "monospace", fontSize: 11, color: "var(--text2)" }}>
                            {r.feeContrato ? fmtMoney(r.feeContrato, r.moneda) : <span style={{ fontStyle: "italic" }}>Variable</span>}
                          </td>
                          <td style={{ ...tdS, textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "var(--red)" }}>
                            {fmtMoney(r.feeAmount, r.moneda)}
                          </td>
                          <td style={{ ...tdS, textAlign: "center" }}>
                            {dscColor
                              ? <Badge text={r.descLabel} color={dscColor} />
                              : <span style={{ color: "var(--text2)", fontSize: 10 }}>—</span>}
                          </td>
                          <td style={{ ...tdS, textAlign: "center" }}>
                            <Badge text={r.estadoPago} color={estadoColor} />
                          </td>
                        </tr>
                      );
                    })}
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
