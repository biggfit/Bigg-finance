// Parser del resumen de tarjeta de crédito Galicia (VISA Business) → líneas de consumo.
// Reusa extractLines (genérico, de planPdf.js). Validado contra un resumen real (8 págs).
// Layout: tras "DETALLE DEL CONSUMO", una fila por consumo
//   FECHA(DD-MM-YY) [marca */K/E/F] DESCRIPCIÓN [cuota NN/NN] COMPROBANTE(6díg) IMPORTE
// Los consumos se agrupan por titular; cada grupo cierra con
//   "TARJETA NNNN Total Consumos de <NOMBRE> <tot pesos> <tot dólares>"
// → el titular se autocompleta a las líneas del grupo. Moneda: USD si la línea trae
// USD/EUR/COP (consumo en el exterior, importe billed en la columna DÓLARES), si no ARS.
// Pagos e impuestos (SU PAGO, DEV.IMP RG) están ANTES del detalle → se ignoran.
import { extractLines } from "./planPdf";

const arNum = s => { const n = parseFloat(String(s).replace(/\./g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
const DATE  = /^(\d{2}-\d{2}-\d{2})\b/;
const AMT   = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;

// Fechas del ciclo de facturación: mes ALFABÉTICO ("08-Jun-26"). Los consumos usan
// mes numérico ("05-05-26") → este formato es único de la cabecera, sin ambigüedad.
const MESES = { ENE: "01", FEB: "02", MAR: "03", ABR: "04", MAY: "05", JUN: "06", JUL: "07", AGO: "08", SEP: "09", SET: "09", OCT: "10", NOV: "11", DIC: "12" };
const CICLO = /\b(\d{2})-([A-Za-z]{3})-(\d{2})\b/g;
const cicloISO = m => { const mes = MESES[m[2].toUpperCase()]; return mes ? `20${m[3]}-${mes}-${m[1]}` : ""; };

// Cabecera del resumen: Nº, fecha de cierre y vencimiento (del ciclo de facturación).
// El ciclo lista 6 fechas en orden fijo: cierre ant · vto ant · CIERRE ACTUAL · VTO ACTUAL · próx cierre · próx vto.
function parseHeader(lines) {
  const text = lines.join(" ");
  const ciclo = [...text.matchAll(CICLO)].map(cicloISO).filter(Boolean);
  const nro = (text.match(/Resumen\s*N[º°o]?\s*([A-Z0-9]+)/i) || [])[1] || "";
  const fechaCierre = ciclo[2] || "";          // 3ª fecha = cierre actual
  const vto         = ciclo[3] || "";          // 4ª fecha = vencimiento actual
  const periodo     = fechaCierre ? fechaCierre.slice(0, 7) : "";   // "2026-05"
  return { nroResumen: nro, fechaCierre, vto, periodo };
}

export async function parseTarjetaPdf(file) {
  const lines = await extractLines(file);
  const header = parseHeader(lines);
  const out = [];
  let pending = [];
  let inDetalle = false;
  const flush = (titular) => { for (const l of pending) l.titular = titular; out.push(...pending); pending = []; };

  for (const ln of lines) {
    if (/DETALLE DEL CONSUMO/i.test(ln)) { inDetalle = true; continue; }
    const tot = ln.match(/Total Consumos de (.+?)\s+-?[\d.]+,\d{2}/i);
    if (tot) { flush(tot[1].trim()); continue; }
    if (!inDetalle) continue;

    const dm = ln.match(DATE);
    if (!dm) continue;
    const amts = ln.match(AMT);
    if (!amts || !amts.length) continue;
    const monto = arNum(amts[amts.length - 1]);          // último importe = el billed (su columna)
    if (!monto) continue;
    // El código de moneda extranjera suele venir PEGADO al ref del banco (in1TTXB3BUSD) → sin \b.
    const moneda = /USD|EUR|COP/i.test(ln) ? "USD" : "ARS";

    let desc = ln.replace(DATE, "").trim()
      .replace(/^[*KEF]\s+/, "")                          // marca de la 2ª columna
      .split(AMT)[0]                                      // cortar antes del primer importe
      .replace(/\bin[0-9][\w]*\b/gi, "")                  // ref del banco (in1TTXB3BUSD…)
      .replace(/\b(USD|EUR|COP)\b/gi, "")
      .replace(/\b\d{2}\/\d{2}\b/g, "")                   // cuota NN/NN
      .replace(/\b\d{5,}\b/g, "")                         // comprobante / refs largas
      .replace(/\s+/g, " ").trim();

    pending.push({ fecha: dm[1], comercio: desc.slice(0, 60), monto, moneda });
  }
  flush("");                                             // grupo final sin "Total Consumos"
  return { lineas: out, header };
}
