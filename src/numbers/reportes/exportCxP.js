// Exportación a Excel de CxP/CxC consolidada por proveedor/cliente (ExcelJS).
// Una fila por (entidad × sociedad) — el mismo desglose que se ve en pantalla — con las bandas de antigüedad.
// Genérico: `tipo` decide el rótulo de la entidad, el color del header y el título.
import ExcelJS from "exceljs";

const FMT_MONEY = "#,##0.00;(#,##0.00)";   // dos decimales; negativos entre paréntesis

const BANDAS = [
  { key: "avencer", label: "A vencer" },
  { key: "d0_30",   label: "0-30" },
  { key: "d31_60",  label: "31-60" },
  { key: "d61_90",  label: "61-90" },
  { key: "dmas90",  label: "+90" },
];

const solid = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin  = { style: "thin", color: { argb: "FFE2E8F0" } };

// Config por tipo. headerBg espeja el color del header en pantalla (rojo CxP / verde CxC).
const CFG = {
  cxp: { entidad: "Proveedor", headerBg: "FFDC2626", titulo: "CxP consolidada por proveedor" },
  cxc: { entidad: "Cliente",   headerBg: "FF16A34A", titulo: "CxC consolidada por cliente" },
};

// `rows` = [{ nombre, total, lineas: [{ sociedadNombre, avencer, d0_30, d31_60, d61_90, dmas90, total }] }].
export async function exportarCxPExcel({ tipo = "cxp", rows, totales, moneda, fechaCorte }) {
  const cfg = CFG[tipo] || CFG.cxp;
  const wb = new ExcelJS.Workbook();
  wb.creator = "BIGG Numbers";
  const ws = wb.addWorksheet(cfg.entidad, { views: [{ state: "frozen", xSplit: 1, ySplit: 0 }] });
  const nCols = 2 + BANDAS.length + 1;   // entidad + sociedad + bandas + total

  // Título + meta
  ws.addRow([cfg.titulo]); ws.mergeCells(1, 1, 1, nCols);
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: "FF0F172A" } };
  const metaTxt = `Moneda ${moneda}` + (fechaCorte ? ` · Al ${fechaCorte}` : " · Hoy");
  const rm = ws.addRow([metaTxt]); ws.mergeCells(rm.number, 1, rm.number, nCols);
  ws.getCell(rm.number, 1).font = { italic: true, size: 10, color: { argb: "FF64748B" } };
  ws.addRow([]);

  // Encabezado
  const head = ws.addRow([cfg.entidad, "Sociedad", ...BANDAS.map(b => b.label), "Total"]);
  head.eachCell((cell, col) => {
    cell.fill = solid(cfg.headerBg);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: col <= 2 ? "left" : "right", vertical: "middle" };
    cell.border = { bottom: thin };
  });
  head.height = 20;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: head.number }];

  // Filas: una por (entidad × sociedad); el nombre se escribe solo en la primera línea de cada entidad.
  for (const r of rows) {
    r.lineas.forEach((ln, li) => {
      const celdas = BANDAS.map(b => (ln[b.key] > 0.01 ? ln[b.key] : null));
      const row = ws.addRow([li === 0 ? r.nombre : "", ln.sociedadNombre, ...celdasSafe(celdas), ln.total]);
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.border = { bottom: thin };
        if (col <= 2) cell.alignment = { horizontal: "left" };
        else { cell.alignment = { horizontal: "right" }; cell.numFmt = FMT_MONEY; }
        if (col === 1) cell.font = { bold: true, color: { argb: "FF0F172A" } };
        if (col === nCols) cell.font = { bold: true, color: { argb: "FF0F172A" } };
      });
    });
  }

  // Total general
  const tot = ws.addRow(["Total", "", ...BANDAS.map(b => totales[b.key] || 0), totales.total || 0]);
  tot.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.fill = solid("FFF1F5F9");
    cell.font = { bold: true, color: { argb: "FF0F172A" } };
    cell.border = { top: { style: "thin", color: { argb: "FFCBD5E1" } } };
    if (col <= 2) cell.alignment = { horizontal: "left" };
    else { cell.alignment = { horizontal: "right" }; cell.numFmt = FMT_MONEY; }
  });

  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 18;
  for (let c = 3; c <= nCols; c++) ws.getColumn(c).width = 15;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = fechaCorte || new Date().toISOString().slice(0, 10);
  a.href = url; a.download = `${tipo === "cxc" ? "CxC" : "CxP"}_${moneda}_${stamp}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// ExcelJS trata null como celda vacía sólo si no rompe el shift de columnas: mapea null→"" seguro.
const celdasSafe = arr => arr.map(v => (v == null ? "" : v));
