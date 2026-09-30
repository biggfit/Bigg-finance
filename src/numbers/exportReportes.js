// Exportación del P&L a Excel CON DISEÑO (ExcelJS). Serializa las MISMAS filas/columnas que se ven en
// pantalla (las produce buildPnLSedeFilas en PantallaReportes) → la planilla sale idéntica al reporte, con
// los mismos colores/jerarquía: bandas de sección oscuras, resultados en verde, distribución en violeta,
// "sin clasificar" en ámbar, subtotales en negrita. El llamador arma las filas por vista y nos las pasa.
import { solid, thin, nuevoWorkbook, addTitulo, addEncabezado, setAnchos, descargarWorkbook } from "./reportes/xlsxUtils";

const FMT_NUM = "#,##0;(#,##0)";   // enteros; negativos entre paréntesis (costos)
const FMT_PCT = "0.0%";

// Paleta (ARGB, con alpha FF). Espeja el tema de la pantalla. (Título, meta, texto del header y grilla
// son los de xlsxUtils, compartidos con los otros exportadores.)
const C = {
  headerBg: "FF1E2937",
  bandaBg: "FF1F2937", bandaFg: "FFBEF264",          // sección (Ingresos / Gastos Op / Impuestos…)
  violetBg: "FFEDE9FE", violetFg: "FF6D28D9",         // distribución
  amberBg: "FFFFFBEB", amberFg: "FFB45309",           // sin clasificar
  grupoBg: "FFF1F5F9", grupoFg: "FF475569",           // subtotal de grupo
  subStrongBg: "FFCBD5E1", subBg: "FFF3F4F6",         // subtotales
  resultBg: "FFBBF7D0", resultFg: "FF065F46",         // resultados (Margen/Resultado/FCF)
  cesionBg: "FFFAF5FF", cesionFg: "FF6D28D9",         // filas de cuenta corriente
  cuentaFg: "FF0F172A",
};

// Valor numérico de una celda (fila × columna), con el MISMO signo que muestra la pantalla: los costos
// (polaridad −1) van en negativo → Excel los muestra entre paréntesis; ingresos/resultados con su signo.
// Columnas "var" = variación como fracción (formato %). Saldos (stock) en la col TOTAL = último mes con dato.
function cellVal(fila, col, lastM) {
  if (col.kind === "var") {
    if (fila.kind === "cesion" || !fila.cur) return null;
    const a = col.a(fila.cur, fila.prev), b = col.b(fila.cur, fila.prev);
    if (col.abs) return (fila.pol < 0 ? -1 : 1) * (a - b);   // Δ absoluto, con el signo del P&L (costos negativos → paréntesis)
    return b ? (a - b) / b : null;
  }
  let v;
  if (fila.stock && col.total) { let lm = lastM; while (lm > 0 && !(Number(fila.cur?.[lm]) || 0)) lm--; v = Number(fila.cur?.[lm]) || 0; }
  else v = col.get(fila.cur, fila.prev);
  v = Number(v) || 0;
  return fila.kind === "cesion" ? v : (fila.pol < 0 ? -v : v);
}

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
  // Esquema/agrupado nativo de Excel: el detalle (filas de cuenta) va a nivel 1 y arranca COLAPSADO; el
  // resumen (grupo/subtotal/banda) queda ARRIBA del grupo (summaryBelow: false) y lleva el [+] para desplegar.
  ws.properties.outlineLevelRow = 1;
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  // Columnas de la hoja: "Cuenta" + una por columna del reporte (estas van a la derecha, numéricas).
  const COLS = [{ h: "Cuenta", w: 38 }, ...cols.map(c => ({ h: c.header, w: 15, num: true }))];
  const nCols = COLS.length;

  addTitulo(ws, titulo, meta, nCols);
  addEncabezado(ws, COLS, { headerBg: C.headerBg, xSplit: 1 });

  // Filas (propias: bandas mergeadas, fill/font por tipo de fila, esquema colapsable)
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
        cell.numFmt = (cols[col - 2]?.kind === "var" && !cols[col - 2]?.abs) ? FMT_PCT : FMT_NUM;
      }
    });
    // Detalle de cuenta → nivel 1 del esquema, oculto de arranque (se despliega desde su resumen de arriba).
    if (f.kind === "cuenta") { r.outlineLevel = 1; r.hidden = true; }
  }

  setAnchos(ws, COLS);
}

// Descarga un workbook (una hoja por vista) con diseño. `hojas` = [{ sheetName, cols, filas, lastM, titulo, meta }].
export async function exportarPackReportes({ archivo, hojas }) {
  const wb = nuevoWorkbook();
  for (const h of hojas) construirHoja(wb, h);
  await descargarWorkbook(wb, archivo);
}
