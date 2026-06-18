// Parser best-effort de resumen de tarjeta de crédito → líneas de consumo.
// Reusa extractLines (genérico, de planPdf.js). El formato Galicia/Amex NO está validado aún:
// el resultado cae en una TABLA EDITABLE en la pantalla, así que si el parser falla en algunas
// filas el usuario las corrige/agrega a mano. Iterar contra el PDF real (mismo loop que el AFIP).
import { extractLines } from "./planPdf";

const arNum = s => { const n = parseFloat(String(s).replace(/\./g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
const DATE  = /(\d{2}\/\d{2}\/\d{2,4})/;
// monto AR (con o sin separador de miles)
const NUM_G = /-?\d{1,3}(?:\.\d{3})+,\d{2}|-?\d+,\d{2}/g;
const NUM_1 = /-?\d{1,3}(?:\.\d{3})+,\d{2}|-?\d+,\d{2}/;

/**
 * Devuelve { lineas: [{ fecha, comercio, monto, moneda }] }. moneda es una conjetura
 * (texto "U$S/USD/dólar" en la línea → USD, si no ARS); el usuario la ajusta en la tabla.
 */
export async function parseTarjetaPdf(file) {
  const lines = await extractLines(file);
  const out = [];
  for (const ln of lines) {
    if (!DATE.test(ln)) continue;
    const nums = ln.match(NUM_G);
    if (!nums || !nums.length) continue;
    const fecha = ln.match(DATE)[1];
    const monto = arNum(nums[nums.length - 1]);           // último importe de la fila = monto
    const comercio = ln.replace(DATE, "").split(NUM_1)[0].replace(/\s+/g, " ").trim();
    if (!monto || !comercio) continue;
    const moneda = /u\$s|usd|d[oó]lar/i.test(ln) ? "USD" : "ARS";
    out.push({ fecha, comercio: comercio.slice(0, 60), monto, moneda });
  }
  return { lineas: out };
}
