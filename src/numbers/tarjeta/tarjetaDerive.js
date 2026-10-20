// Derivaciones puras de la tarjeta de crédito (sin React, sin I/O).
// La tarjeta es una cuenta `tipo:"tarjeta"` de nb_cuentas_bancarias; sus consumos son filas de nb_movimientos
// sobre esa cuenta. Cada consumo cargado desde el PDF lleva en `referencia` el tag `per=YYYY-MM` (período del
// resumen que lo facturó). Acá se agrupan esos movimientos en "resúmenes" para la pantalla Egresos › Tarjeta.
import { metaVal } from "../../lib/numbersApi";

// Nombre base de una tarjeta (sin token de moneda) para emparejar sus cuentas ARS/USD ("Tarjeta Galicia Visa").
export const baseTarjeta = s => String(s || "").replace(/\b(ARS|USD|EUR)\b|\$|u\$d|us\$/gi, "").replace(/\s+/g, " ").trim();

// Período del resumen al que pertenece el movimiento: el tag `per=` si lo trae (consumos del PDF). Si no
// (factura pagada con la tarjeta, consumo previo al tag, ajuste de pago), el mes de su fecha.
export const tienePeriodo = m => !!metaVal(m?.referencia, "per");
export const periodoDe    = m => metaVal(m?.referencia, "per") || String(m?.fecha || "").slice(0, 7);

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const nombrePeriodo = (per) => {
  const m = String(per || "").match(/^(\d{4})-(\d{2})$/);
  return m ? `${MESES[Number(m[2]) - 1] || m[2]} ${m[1]}` : String(per || "—");
};

/**
 * Agrupa los movimientos de las cuentas-tarjeta `cardIds` en resúmenes por período.
 * Entra todo lo que es CONSUMO de la tarjeta: consumos del PDF (autorizados o pendientes), facturas pagadas con
 * la tarjeta (PAGO sobre la cuenta-tarjeta), ajustes. Queda afuera el PAGO_TARJETA: es el pago del resumen (caja
 * ↔ deuda), vive en Tesorería.
 * `cargo` = lo que suma al resumen: un consumo (monto negativo) es cargo positivo; un crédito/ajuste resta.
 * @returns [{ periodo, filas, n, ars, usd, pendientes, porFecha }] ordenado del más reciente al más viejo.
 */
export function agruparResumenes(movs = [], cardIds = new Set()) {
  // Qué NO es un consumo del resumen (vive en el extracto, no acá): el pago del resumen, la deuda inicial de la
  // apertura, el ajuste por pago en exceso (referencia `ajuste=1;pago=…`, lo genera pagarTarjeta) y los pares de
  // tesorería asentados contra la cuenta-tarjeta (cambio de moneda para pagar la parte en USD, transferencias, interco).
  const TESORERIA = new Set(["PAGO_TARJETA", "SALDO_INICIAL", "CAMBIO", "TRANSFERENCIA", "INTERCOMPANIA"]);
  const esDeTesoreria = m => TESORERIA.has(m.tipo) || !!metaVal(m.referencia, "pago");
  const cardMovs = movs.filter(m => cardIds.has(String(m.cuenta_bancaria)) && !esDeTesoreria(m));
  const fila = m => ({
    ...m, cargo: -(Number(m.monto) || 0),
    pendiente: m.origen === "tarjeta" && !m.documento_id,
    porFecha:  !tienePeriodo(m),
    esPagoFC:  m.tipo === "PAGO",
    esAjuste:  metaVal(m.referencia, "ajuste") === "1",
    titular:   metaVal(m.referencia, "tit") || "",
    comercio:  m.concepto || metaVal(m.referencia, "com") || "",
  });
  const nuevo = per => ({ periodo: per, filas: [], n: 0, ars: 0, usd: 0, pendientes: 0, porFecha: 0, desde: "", hasta: "" });
  const sumar = (g, f) => {
    g.filas.push(f); g.n++;
    if ((f.moneda || "ARS") === "USD") g.usd += f.cargo; else g.ars += f.cargo;
    if (f.pendiente) g.pendientes++;
    if (f.porFecha)  g.porFecha++;
  };
  const fechaDe = m => String(m.fecha || "").slice(0, 10);

  // 1) Los consumos del PDF arman los resúmenes y su ciclo real (primer y último consumo).
  const by = new Map();
  for (const m of cardMovs) {
    if (!tienePeriodo(m)) continue;
    const per = periodoDe(m);
    const g = by.get(per) || nuevo(per);
    const f = fechaDe(m);
    if (f && (!g.desde || f < g.desde)) g.desde = f;
    if (f && (!g.hasta || f > g.hasta)) g.hasta = f;
    sumar(g, fila(m));
    by.set(per, g);
  }
  // 2) Lo que no trae período (factura pagada con la tarjeta, consumo previo al tag) se cuelga del ciclo cuyo rango
  //    de fechas lo contiene (el más reciente si se solapan). Si ninguno lo contiene → "Sin resumen", al final.
  const ciclos = [...by.values()].sort((a, b) => b.periodo.localeCompare(a.periodo));
  for (const m of cardMovs) {
    if (tienePeriodo(m)) continue;
    const f = fechaDe(m);
    const g = ciclos.find(c => c.desde && f >= c.desde && f <= c.hasta) || by.get("") || nuevo("");
    sumar(g, fila(m));
    by.set(g.periodo, g);
  }
  return [...by.values()]
    .map(g => ({ ...g, filas: g.filas.sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || ""))) }))
    .sort((a, b) => b.periodo.localeCompare(a.periodo));   // "" (Sin resumen) ordena último
}
