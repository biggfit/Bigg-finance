// Piezas compartidas de los exportadores a Excel (ExcelJS): formatos, estilos, el bloque de título + meta,
// la fila de encabezado, el loop de filas por columnas `{ h, w, get, fmt, num, font }`, los anchos y la
// descarga del workbook. Cada exportador conserva su lógica de negocio (qué filas, qué columnas, pies de
// totales, hojas múltiples); acá solo vive lo que los cuatro repetían igual.
//
// Los estilos se asignan en el MISMO orden que tenían los exportadores (fill → font → alignment → border en
// el encabezado; border → alignment → numFmt → font en las filas): la salida es celda por celda la de antes.
import ExcelJS from "exceljs";

export const FMT_MONEY = "#,##0.00;(#,##0.00)";   // dos decimales; negativos entre paréntesis
export const FMT_DATE  = "dd/mm/yyyy";

export const solid = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
export const thin  = { style: "thin", color: { argb: "FFE2E8F0" } };

// "YYYY-MM-DD" → Date a medianoche UTC. Tiene que ser UTC y no local: ExcelJS serializa el INSTANTE, así que
// una medianoche local se guarda corrida por el huso y el serial cae en el día anterior (verificado en una
// máquina en UTC+2: 17/09 salía 16/09 22:00). Con Date.UTC el serial es entero y el día es el correcto en
// cualquier zona horaria.
export function isoADate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

export function nuevoWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BIGG Numbers";
  return wb;
}

// Título (bold 14) + una fila mergeada por cada meta + una fila en blanco. `metas` acepta strings (itálica
// gris, el subtítulo de siempre) u objetos `{ texto, font }` para renglones con otro estilo (la cabecera
// Empresa/Período/Fecha del estudio). Sin `titulo` arranca directo por las metas.
export function addTitulo(ws, titulo, metas, nCols) {
  if (titulo) {
    const r = ws.addRow([titulo]); ws.mergeCells(r.number, 1, r.number, nCols);
    ws.getCell(r.number, 1).font = { bold: true, size: 14, color: { argb: "FF0F172A" } };
  }
  for (const m of (metas || [])) {
    const obj = typeof m === "string" ? { texto: m } : m;
    const r = ws.addRow([obj.texto]); ws.mergeCells(r.number, 1, r.number, nCols);
    ws.getCell(r.number, 1).font = obj.font || { italic: true, size: 10, color: { argb: "FF64748B" } };
  }
  ws.addRow([]);
}

// Fila de encabezado: fondo `headerBg`, texto blanco en negrita, alineada según `num` de cada columna,
// borde inferior, alto 20 y panel congelado debajo (con `xSplit` columnas fijas a la izquierda si se pide).
// `autoFilter` arma el filtro de Excel sobre el encabezado. Devuelve la fila.
export function addEncabezado(ws, COLS, { headerBg, xSplit, autoFilter } = {}) {
  const head = ws.addRow(COLS.map(c => c.h));
  head.eachCell((cell, col) => {
    cell.fill = solid(headerBg);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: COLS[col - 1].num ? "right" : "left", vertical: "middle" };
    cell.border = { bottom: thin };
  });
  head.height = 20;
  ws.views = xSplit
    ? [{ state: "frozen", xSplit, ySplit: head.number }]
    : [{ state: "frozen", ySplit: head.number }];
  if (autoFilter) ws.autoFilter = { from: { row: head.number, column: 1 }, to: { row: head.number, column: COLS.length } };
  return head;
}

// Una fila por elemento de `rows`, con el valor de `c.get(r)` (null/undefined → celda vacía ""), borde
// inferior, alineación por `num`, formato `fmt` y fuente `font` cuando la columna los trae.
export function addFilas(ws, COLS, rows) {
  for (const r of rows) {
    const row = ws.addRow(COLS.map(c => c.get(r) ?? ""));
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const c = COLS[col - 1];
      cell.border = { bottom: thin };
      cell.alignment = { horizontal: c.num ? "right" : "left" };
      if (c.fmt) cell.numFmt = c.fmt;
      if (c.font) cell.font = c.font;
    });
  }
}

export function setAnchos(ws, COLS) {
  COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
}

// Encabezado + filas + anchos, todo por `COLS`. Devuelve la fila de encabezado.
export function addTabla(ws, COLS, rows, opts) {
  const head = addEncabezado(ws, COLS, opts);
  addFilas(ws, COLS, rows);
  setAnchos(ws, COLS);
  return head;
}

// writeBuffer → Blob → link temporal → click → limpiar.
export async function descargarWorkbook(wb, nombreArchivo) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombreArchivo; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}
