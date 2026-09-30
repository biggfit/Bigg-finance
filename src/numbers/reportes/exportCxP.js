// Exportación a Excel de CxP/CxC consolidada por proveedor/cliente (ExcelJS).
// Una fila por (entidad × sociedad) — el mismo desglose que se ve en pantalla — con las bandas de antigüedad.
// Genérico: `tipo` decide el rótulo de la entidad, el color del header y el título.
import { FMT_MONEY, solid, nuevoWorkbook, addTitulo, addTabla, descargarWorkbook } from "./xlsxUtils";

const BANDAS = [
  { key: "avencer", label: "A vencer" },
  { key: "d0_30",   label: "0-30" },
  { key: "d31_60",  label: "31-60" },
  { key: "d61_90",  label: "61-90" },
  { key: "dmas90",  label: "+90" },
];

// Config por tipo. headerBg espeja el color del header en pantalla (rojo CxP / verde CxC).
const CFG = {
  cxp: { entidad: "Proveedor", headerBg: "FFDC2626", titulo: "CxP consolidada por proveedor" },
  cxc: { entidad: "Cliente",   headerBg: "FF16A34A", titulo: "CxC consolidada por cliente" },
};

const BOLD = { bold: true, color: { argb: "FF0F172A" } };

// Columnas: entidad + sociedad + bandas + total. Cada fila es `{ nombre, ln }` (ver exportarCxPExcel).
const columnas = entidad => [
  { h: entidad,    w: 34, get: f => f.nombre, font: BOLD },
  { h: "Sociedad", w: 18, get: f => f.ln.sociedadNombre },
  ...BANDAS.map(b => ({ h: b.label, w: 15, get: f => (f.ln[b.key] > 0.01 ? f.ln[b.key] : null), fmt: FMT_MONEY, num: true })),
  { h: "Total",    w: 15, get: f => f.ln.total, fmt: FMT_MONEY, num: true, font: BOLD },
];

// `rows` = [{ nombre, total, lineas: [{ sociedadNombre, avencer, d0_30, d31_60, d61_90, dmas90, total }] }].
export async function exportarCxPExcel({ tipo = "cxp", rows, totales, moneda, fechaCorte }) {
  const cfg = CFG[tipo] || CFG.cxp;
  const wb = nuevoWorkbook();
  const ws = wb.addWorksheet(cfg.entidad, { views: [{ state: "frozen", xSplit: 1, ySplit: 0 }] });
  const COLS = columnas(cfg.entidad);
  const nCols = COLS.length;

  addTitulo(ws, cfg.titulo, [`Moneda ${moneda}` + (fechaCorte ? ` · Al ${fechaCorte}` : " · Hoy")], nCols);

  // Filas: una por (entidad × sociedad); el nombre se escribe solo en la primera línea de cada entidad.
  const filas = rows.flatMap(r => r.lineas.map((ln, li) => ({ nombre: li === 0 ? r.nombre : "", ln })));
  addTabla(ws, COLS, filas, { headerBg: cfg.headerBg, xSplit: 1 });

  // Total general
  const tot = ws.addRow(["Total", "", ...BANDAS.map(b => totales[b.key] || 0), totales.total || 0]);
  tot.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.fill = solid("FFF1F5F9");
    cell.font = { bold: true, color: { argb: "FF0F172A" } };
    cell.border = { top: { style: "thin", color: { argb: "FFCBD5E1" } } };
    if (col <= 2) cell.alignment = { horizontal: "left" };
    else { cell.alignment = { horizontal: "right" }; cell.numFmt = FMT_MONEY; }
  });

  const stamp = fechaCorte || new Date().toISOString().slice(0, 10);
  await descargarWorkbook(wb, `${tipo === "cxc" ? "CxC" : "CxP"}_${moneda}_${stamp}.xlsx`);
}
