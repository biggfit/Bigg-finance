// Exportación del P&L a Excel CON DISEÑO (ExcelJS). Serializa las MISMAS filas/columnas que se ven en
// pantalla (las produce buildPnLSedeFilas en PantallaReportes) → la planilla sale idéntica al reporte, con
// los mismos colores/jerarquía: bandas de sección oscuras, resultados en verde, distribución en violeta,
// "sin clasificar" en ámbar, subtotales en negrita. El llamador arma las filas por vista y nos las pasa.
import ExcelJS from "exceljs";

const FMT_NUM = "#,##0;(#,##0)";   // enteros; negativos entre paréntesis (costos)
const FMT_PCT = "0.0%";

// Paleta (ARGB, con alpha FF). Espeja el tema de la pantalla.
const C = {
  headerBg: "FF1E2937", headerFg: "FFFFFFFF",
  bandaBg: "FF1F2937", bandaFg: "FFBEF264",          // sección (Ingresos / Gastos Op / Impuestos…)
  violetBg: "FFEDE9FE", violetFg: "FF6D28D9",         // distribución
  amberBg: "FFFFFBEB", amberFg: "FFB45309",           // sin clasificar
  grupoBg: "FFF1F5F9", grupoFg: "FF475569",           // subtotal de grupo
  subStrongBg: "FFCBD5E1", subBg: "FFF3F4F6",         // subtotales
  resultBg: "FFBBF7D0", resultFg: "FF065F46",         // resultados (Margen/Resultado/FCF)
  cesionBg: "FFFAF5FF", cesionFg: "FF6D28D9",         // filas de cuenta corriente
  cuentaFg: "FF0F172A", metaFg: "FF64748B", grid: "FFE2E8F0",
};

// Valor numérico de una celda (fila × columna), con el MISMO signo que muestra la pantalla: los costos
// (polaridad −1) van en negativo → Excel los muestra entre paréntesis; ingresos/resultados con su signo.
// Columnas "var" = variación como fracción (formato %). Saldos (stock) en la col TOTAL = último mes con dato.
function cellVal(fila, col, lastM) {
  if (col.kind === "var") {
    if (fila.kind === "cesion" || !fila.cur) return null;
    const a = col.a(fila.cur, fila.prev), b = col.b(fila.cur, fila.prev);
    return b ? (a - b) / b : null;
  }
  let v;
  if (fila.stock && col.total) { let lm = lastM; while (lm > 0 && !(Number(fila.cur?.[lm]) || 0)) lm--; v = Number(fila.cur?.[lm]) || 0; }
  else v = col.get(fila.cur, fila.prev);
  v = Number(v) || 0;
  return fila.kind === "cesion" ? v : (fila.pol < 0 ? -v : v);
}

const solid = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin  = { style: "thin", color: { argb: C.grid } };

// Estilo (fill + font) de una fila según su tipo. Devuelve null para filas de cuenta normales (sin fill).
function estiloFila(f) {
  if (f.kind === "banda") {
    if (f.violet) return { fill: solid(C.violetBg), font: { bold: true, color: { argb: C.violetFg } } };
    if (f.amber)  return { fill: solid(C.amberBg),  font: { bold: true, color: { argb: C.amberFg } } };
    return { fill: solid(C.bandaBg), font: { bold: true, color: { argb: C.bandaFg } } };
  }
  if (f.kind === "grupo")    return { fill: solid(C.grupoBg), font: { bold: true, color: { argb: C.grupoFg } } };
  if (f.kind === "subtotal") return { fill: solid(f.strong ? C.subStrongBg : C.subBg), font: { bold: true, color: { argb: C.cuentaFg } } };
  if (f.kind === "result")   return { fill: solid(C.resultBg), font: { bold: true, color: { argb: C.resultFg } } };
  if (f.kind === "cesion")   return { fill: solid(C.cesionBg), font: { bold: !!f.bold, color: { argb: C.cesionFg } } };
  return null;   // cuenta
}

function construirHoja(wb, { sheetName, cols, filas, lastM, titulo, meta }) {
  const ws = wb.addWorksheet((sheetName || "Hoja").slice(0, 31), {
    views: [{ state: "frozen", xSplit: 1, ySplit: 0 }],   // ySplit se ajusta abajo (header)
  });
  const nCols = cols.length + 1;

  // Título + meta
  if (titulo) {
    ws.addRow([titulo]);
    ws.mergeCells(1, 1, 1, nCols);
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: C.cuentaFg } };
  }
  for (const m of (meta || [])) {
    const r = ws.addRow([m]); ws.mergeCells(r.number, 1, r.number, nCols);
    ws.getCell(r.number, 1).font = { italic: true, size: 10, color: { argb: C.metaFg } };
  }
  ws.addRow([]);

  // Encabezado de columnas
  const head = ws.addRow(["Cuenta", ...cols.map(c => c.header)]);
  const headRow = head.number;
  head.eachCell((cell, col) => {
    cell.fill = solid(C.headerBg);
    cell.font = { bold: true, color: { argb: C.headerFg } };
    cell.alignment = { horizontal: col === 1 ? "left" : "right", vertical: "middle" };
    cell.border = { bottom: thin };
  });
  head.height = 20;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: headRow }];

  // Filas
  for (const f of filas) {
    if (f.kind === "spacer") { ws.addRow([]); continue; }
    if (f.kind === "banda")  {
      const r = ws.addRow([f.label]); ws.mergeCells(r.number, 1, r.number, nCols);
      const est = estiloFila(f); const cell = ws.getCell(r.number, 1);
      cell.fill = est.fill; cell.font = est.font;
      cell.alignment = { vertical: "middle" }; r.height = 17;
      continue;
    }
    const vals = cols.map(col => { const v = cellVal(f, col, lastM); return v == null ? "" : v; });
    const r = ws.addRow([f.label, ...vals]);
    const est = estiloFila(f);
    r.eachCell({ includeEmpty: true }, (cell, col) => {
      if (est) { cell.fill = est.fill; cell.font = est.font; }
      cell.border = { bottom: thin };
      if (col === 1) { cell.alignment = { horizontal: "left" }; }
      else {
        cell.alignment = { horizontal: "right" };
        cell.numFmt = cols[col - 2]?.kind === "var" ? FMT_PCT : FMT_NUM;
      }
    });
  }

  // Anchos
  ws.getColumn(1).width = 38;
  for (let c = 2; c <= nCols; c++) ws.getColumn(c).width = 15;
}

// Descarga un workbook (una hoja por vista) con diseño. `hojas` = [{ sheetName, cols, filas, lastM, titulo, meta }].
export async function exportarPackReportes({ archivo, hojas }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BIGG Numbers";
  for (const h of hojas) construirHoja(wb, h);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = archivo; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}
