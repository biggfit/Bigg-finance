// Exportación a Excel del detalle de Egresos / Ingresos (ExcelJS). Baja EXACTAMENTE las filas que quedaron
// después de los filtros de pantalla, más columnas que en la tabla no entran pero se necesitan para trabajar
// afuera: N° de comprobante, id interno del comprobante, código del estudio contable y fecha fiscal.
//
// Dos aperturas, porque son dos lecturas distintas del mismo dato:
//  · "ceco"    (management) — una fila por LÍNEA, con su centro de costo y su cuenta. Es lo que se ve en pantalla.
//  · "factura" (fiscal)     — una fila por COMPROBANTE, sin apertura de centro ni cuenta: al estudio le importa
//                             la factura, no cómo la repartimos por dentro.
//
// El llamador resuelve los campos derivados (nombres de sociedad/centro, tipo, cód. de estudio) porque los mapas
// viven en la pantalla; acá solo se serializa.
import ExcelJS from "exceljs";

const FMT_MONEY = "#,##0.00;(#,##0.00)";
const FMT_DATE  = "dd/mm/yyyy";

const solid = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin  = { style: "thin", color: { argb: "FFE2E8F0" } };

const CFG = {
  EGRESO:  { titulo: "Egresos (detalle)",  headerBg: "FFDC2626", archivo: "Egresos" },
  INGRESO: { titulo: "Ingresos (detalle)", headerBg: "FF16A34A", archivo: "Ingresos" },
};
const MODOS = {
  ceco:    { sufijo: "por centro de costo", archivo: "por_centro" },
  factura: { sufijo: "por factura",         archivo: "por_factura" },
};

// "YYYY-MM-DD" → Date a medianoche UTC. Tiene que ser UTC y no local: ExcelJS serializa el INSTANTE, así que
// una medianoche local se guarda corrida por el huso y el serial cae en el día anterior (verificado en una
// máquina en UTC+2: 17/09 salía 16/09 22:00). Con Date.UTC el serial es entero y el día es el correcto en
// cualquier zona horaria.
function isoADate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

// Una fila por comprobante: suma las líneas que pasaron el filtro (no el total original del comprobante — si
// filtraste por centro, lo que baja es lo que estás mirando). Las filas que NO son comprobantes (sueldos,
// financiaciones, histórico) no tienen id_comp: quedan una por registro, porque no hay factura que agrupar y
// descartarlas escondería gasto real.
function agruparPorFactura(rows) {
  const m = new Map();
  rows.forEach((r, i) => {
    const k = r.id_comp ? `C:${r.id_comp}` : `X:${r.id ?? i}`;
    if (!m.has(k)) m.set(k, { ...r, _total: 0, _subtotal: null, _iva: null });
    const acc = m.get(k);
    acc._total += Math.abs(Number(r.total) || 0);
    // Subtotal e IVA se acumulan solo si la línea los trae: así una factura queda con su neto y su IVA, y un
    // sueldo (que no tiene ni uno ni otro) queda en null → celda vacía, no un 0 que se leería como "IVA cero".
    if (r.subtotal   != null && r.subtotal   !== "") acc._subtotal = (acc._subtotal || 0) + Math.abs(Number(r.subtotal) || 0);
    if (r.iva_monto  != null && r.iva_monto  !== "") acc._iva      = (acc._iva      || 0) + Math.abs(Number(r.iva_monto) || 0);
  });
  return [...m.values()];
}

// Valor de una columna de plata: en el modo factura ya viene sumado (`kAgg`); en el modo por centro se lee de
// la línea. Vacío —no 0— cuando el dato no existe.
function montoCol(r, kAgg, kRaw) {
  if (kAgg in r) return r[kAgg] == null ? "" : r[kAgg];
  const v = r[kRaw];
  return (v == null || v === "") ? "" : Math.abs(Number(v) || 0);
}

function columnas(modo, contraLabel, campo) {
  const cols = [
    { h: "Fecha",        w: 12, get: r => isoADate(r.fecha),                     fmt: FMT_DATE },
    { h: "Fecha fiscal", w: 12, get: r => isoADate(r.fecha_fiscal || r.fecha),   fmt: FMT_DATE },
    { h: "Tipo",         w: 16, get: r => campo.tipo?.(r) ?? "" },
    { h: "Sociedad",     w: 20, get: r => campo.sociedad?.(r) ?? "" },
    { h: contraLabel,    w: 34, get: r => r.contraparte_nombre || "" },
    // Identificación fiscal y código del estudio: los dos salen del maestro de proveedores/clientes (el
    // comprobante no los guarda), y van pegados al nombre porque identifican a la misma contraparte.
    { h: "CUIT / NIF",   w: 16, get: r => campo.cuit?.(r) ?? "" },
    { h: "Cód. estudio", w: 16, get: r => campo.codEstudio?.(r) ?? "" },
    { h: "N° comp",      w: 18, get: r => r.nro_comp || "" },
    // Id interno del comprobante: permite volver al documento en el sistema y, en el modo por centro, armar
    // un dinámico por factura. Es la clave con la que agrupa el modo "factura". Vacío en las filas que no son
    // comprobantes (sueldos, financiaciones, histórico).
    { h: "ID comp",      w: 22, get: r => r.id_comp || "" },
  ];
  if (modo === "ceco") cols.push(
    { h: "Cuenta",    w: 28, get: r => r.cuenta_contable || "" },
    // Nuestro código de cuenta, al lado del nombre y enfrentado al del estudio (`Cód. estudio`): con los dos
    // en la misma fila se puede mapear nuestro plan contra el de ellos. Conviven dos formatos de id
    // (`CUENTA_<nombre>` viejo y `CTA-…` nuevo) y algunas filas no lo traen.
    { h: "ID cuenta", w: 22, get: r => r.cuenta_contable_id || "" },
    { h: "Centro",    w: 24, get: r => campo.centro?.(r) ?? "" },
  );
  cols.push(
    { h: "Moneda", w: 10, get: r => r.moneda || "ARS" },
    // Los tres en positivo, igual que en pantalla (el reporte ya dice si son egresos o ingresos). En el dato,
    // subtotal + IVA = total en 1.006 de 1.014 comprobantes; los que no, difieren por centavos de redondeo.
    { h: "Subtotal", w: 15, get: r => montoCol(r, "_subtotal", "subtotal"),  fmt: FMT_MONEY, num: true },
    { h: "IVA",      w: 13, get: r => montoCol(r, "_iva",      "iva_monto"), fmt: FMT_MONEY, num: true },
    { h: "Total",    w: 16, get: r => r._total ?? Math.abs(Number(r.total) || 0), fmt: FMT_MONEY, num: true },
  );
  return cols;
}

/**
 * @param tipo     "EGRESO" | "INGRESO"
 * @param modo     "ceco" (una fila por línea, con centro y cuenta) | "factura" (una fila por comprobante)
 * @param rows     filas YA filtradas y ordenadas (las de pantalla)
 * @param campo    resolvers: { tipo, sociedad, centro, codEstudio } — cada uno (row) => string
 * @param totales  { [moneda]: importe } de pantalla; no cambia entre modos (agrupar solo junta líneas)
 */
export async function exportarDetalleExcel({ tipo = "EGRESO", modo = "ceco", rows = [], campo = {}, totales = {}, contraLabel = "Contraparte", rango = {} }) {
  const cfg  = CFG[tipo] || CFG.EGRESO;
  const mcfg = MODOS[modo] || MODOS.ceco;
  const datos = modo === "factura" ? agruparPorFactura(rows) : rows;
  const COLS = columnas(modo, contraLabel, campo);

  const wb = new ExcelJS.Workbook();
  wb.creator = "BIGG Numbers";
  const ws = wb.addWorksheet(tipo === "INGRESO" ? "Ingresos" : "Egresos");

  ws.addRow([`${cfg.titulo} · ${mcfg.sufijo}`]); ws.mergeCells(1, 1, 1, COLS.length);
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: "FF0F172A" } };

  const periodo = rango.desde || rango.hasta
    ? `${rango.desde ? rango.desde.split("-").reverse().join("/") : "inicio"} → ${rango.hasta ? rango.hasta.split("-").reverse().join("/") : "hoy"}`
    : "todo el período";
  const unidad = modo === "factura" ? "comprobante" : "registro";
  const totTxt = Object.entries(totales).sort((a, b) => b[1] - a[1])
    .map(([mo, v]) => `${mo} ${v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ");
  const rm = ws.addRow([`${periodo} · ${datos.length} ${unidad}${datos.length === 1 ? "" : "s"}${totTxt ? ` · ${totTxt}` : ""}`]);
  ws.mergeCells(rm.number, 1, rm.number, COLS.length);
  ws.getCell(rm.number, 1).font = { italic: true, size: 10, color: { argb: "FF64748B" } };
  ws.addRow([]);

  const head = ws.addRow(COLS.map(c => c.h));
  head.eachCell((cell, col) => {
    cell.fill = solid(cfg.headerBg);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: COLS[col - 1].num ? "right" : "left", vertical: "middle" };
    cell.border = { bottom: thin };
  });
  head.height = 20;
  ws.views = [{ state: "frozen", ySplit: head.number }];
  ws.autoFilter = { from: { row: head.number, column: 1 }, to: { row: head.number, column: COLS.length } };

  for (const r of datos) {
    const row = ws.addRow(COLS.map(c => c.get(r) ?? ""));
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const c = COLS[col - 1];
      cell.border = { bottom: thin };
      cell.alignment = { horizontal: c.num ? "right" : "left" };
      if (c.fmt) cell.numFmt = c.fmt;
    });
  }

  COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${cfg.archivo}_${mcfg.archivo}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
