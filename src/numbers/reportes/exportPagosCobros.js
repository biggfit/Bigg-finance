// Exportación a Excel del detalle de Pagos y cobros (ExcelJS). Baja EXACTAMENTE las filas que quedaron
// después de los filtros de pantalla.
//
// Para qué existe: el estudio contable recibe el extracto del banco y no sabe contra qué factura va cada
// línea — por eso les crece la cuenta de "partidas pendientes de aplicación". Este archivo es el mismo
// extracto CON la factura aplicada al lado, más la identificación fiscal y el código de cuenta que ellos
// usan, así pueden asentar sin preguntar.
//
// Regla que no se rompe: UNA FILA POR MOVIMIENTO DE BANCO. Nunca se parte un movimiento en varios renglones
// aunque por dentro toque varios centros — si se partiera, el archivo dejaría de conciliar contra el banco,
// que es su única razón de ser. Por eso acá no hay centro de costo (un pago puede aplicar a una factura
// repartida en varios) ni apertura de la tarjeta (el resumen se manda aparte, crudo).
//
// El llamador resuelve los campos derivados (nombres de sociedad/cuenta bancaria, cód. de estudio, factura
// aplicada) porque los mapas viven en la pantalla; acá solo se serializa.
import { FMT_MONEY, FMT_DATE, isoADate, nuevoWorkbook, addTitulo, addTabla, descargarWorkbook } from "./xlsxUtils";

// Vacío —no 0— cuando el dato no existe: un 0 en "Total de la factura" se leería como "la factura era de
// cero", y lo que pasa es que ese movimiento no tiene factura (un cobro directo, una transferencia).
const num = v => (v == null || v === "") ? "" : Number(v) || 0;

function columnas(campo) {
  return [
    { h: "Fecha",           w: 12, get: r => isoADate(r.fecha), fmt: FMT_DATE },
    { h: "Sociedad",        w: 20, get: r => campo.sociedad?.(r) ?? "" },
    // De dónde salió o entró la plata. Es la columna con la que el estudio arma el extracto de cada cuenta.
    { h: "Cuenta bancaria", w: 22, get: r => campo.cuentaBancaria?.(r) ?? "" },
    { h: "Tipo",            w: 16, get: r => campo.tipo?.(r) ?? "" },
    { h: "Contraparte",     w: 34, get: r => campo.contraparte?.(r) ?? "" },
    // Identificación fiscal y código del estudio: salen del maestro de proveedores/clientes (el movimiento
    // no los guarda) y van pegados al nombre porque identifican a la misma contraparte.
    { h: "CUIT / NIF",      w: 16, get: r => campo.cuit?.(r) ?? "" },
    { h: "Cód. estudio",    w: 16, get: r => campo.codEstudio?.(r) ?? "" },
    // Domicilio fiscal de la contraparte (el estudio lo pidió el 7/10/2026). Hoy sale del maestro de
    // Franquicias para los franquiciados; proveedores y clientes lo tendrán cuando el maestro lleve la columna.
    { h: "Domicilio",       w: 34, get: r => campo.domicilio?.(r) ?? "" },
    { h: "Concepto",        w: 40, get: r => r.concepto || "" },
    // ── La factura aplicada. Vacío cuando el movimiento no cancela ninguna (cobro directo, gasto contado,
    //    transferencia, pago de tarjeta): no se completa con nada derivado.
    { h: "N° comp",         w: 20, get: r => campo.nroComp?.(r) ?? "" },
    // Solo el id de una factura de verdad. Los gastos contados y las conciliaciones llevan un documento_id
    // propio ("CONTAB-…") que no es un comprobante; bajarlo acá sería ruido para el estudio.
    { h: "ID comp",         w: 22, get: r => campo.idComp?.(r) ?? "" },
    { h: "Fecha fiscal",    w: 12, get: r => isoADate(campo.fechaFiscal?.(r)), fmt: FMT_DATE },
    // Nuestra cuenta contable, enfrentada al `Cód. estudio`: con las dos en la misma fila se puede mapear
    // nuestro plan de cuentas contra el de ellos.
    { h: "Cuenta contable", w: 28, get: r => campo.cuentaContable?.(r) ?? "" },
    { h: "Moneda",          w: 10, get: r => r.moneda || "ARS" },
    // Con signo, como el banco: negativo salió, positivo entró. Así la suma de la columna es la variación
    // de la cuenta en el período y se puede cruzar contra el saldo.
    { h: "Importe",         w: 16, get: r => num(r.monto), fmt: FMT_MONEY, num: true },
    { h: "Total factura",   w: 16, get: r => num(campo.totalFactura?.(r)), fmt: FMT_MONEY, num: true },
    { h: "Estado",          w: 12, get: r => campo.estado?.(r) ?? "" },
    // El saldo que traía el extracto en esa línea (solo en los movimientos importados del banco). Es lo que
    // convierte este archivo en algo conciliable: el estudio ata la última fila contra el saldo del banco.
    { h: "Saldo extracto",  w: 16, get: r => num(r.extracto_saldo), fmt: FMT_MONEY, num: true },
  ];
}

/**
 * @param rows     movimientos YA filtrados y ordenados (los de pantalla)
 * @param campo    resolvers: { sociedad, cuentaBancaria, tipo, contraparte, cuit, codEstudio, nroComp,
 *                 fechaFiscal, cuentaContable, totalFactura, estado } — cada uno (row) => string|number
 * @param totales  { [moneda]: importe } de pantalla, para la línea de resumen
 */
export async function exportarPagosCobrosExcel({ rows = [], campo = {}, totales = {}, rango = {} }) {
  const COLS = columnas(campo);

  const wb = nuevoWorkbook();
  const ws = wb.addWorksheet("Pagos y cobros");

  const periodo = rango.desde || rango.hasta
    ? `${rango.desde ? rango.desde.split("-").reverse().join("/") : "inicio"} → ${rango.hasta ? rango.hasta.split("-").reverse().join("/") : "hoy"}`
    : "todo el período";
  const totTxt = Object.entries(totales).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([mo, v]) => `${mo} ${v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ");
  addTitulo(ws, "Pagos y cobros (detalle)",
    [`${periodo} · ${rows.length} movimiento${rows.length === 1 ? "" : "s"}${totTxt ? ` · neto ${totTxt}` : ""}`], COLS.length);

  addTabla(ws, COLS, rows, { headerBg: "FF0E7490", autoFilter: true });

  await descargarWorkbook(wb, `Pagos_y_cobros_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
