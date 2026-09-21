// Dispatcher de resúmenes de tarjeta: extrae el texto UNA vez y elige el parser según el emisor.
//
// Galicia (VISA Business) trae todos los titulares en un solo PDF con cortes por titular, así que
// se sube de a uno. Amex emite UN RESUMEN POR TITULAR: los N archivos del ciclo son la misma
// tarjeta y se mergean en una sola ingesta, para que la bandeja quede completa y el cuadre se haga
// contra el total del ciclo y no contra un pedazo.
import { extractLines } from "./planPdf";
import { parseTarjetaLines } from "./tarjetaPdf";
import { parseAmexLines, esResumenAmex, mergeAmex } from "./amexPdf";

/**
 * @param {File[]} files
 * @returns {{ resultado, emisor: "amex"|"galicia", archivos: number }}
 * @throws si se suben varios PDFs que no son todos de Amex (Galicia va de a uno).
 */
export async function parseResumenes(files) {
  const lista = [...(files || [])];
  if (!lista.length) return null;

  const parsed = [];
  for (const file of lista) {
    const lines = await extractLines(file);
    parsed.push(esResumenAmex(lines)
      ? { emisor: "amex",    r: parseAmexLines(lines) }
      : { emisor: "galicia", r: parseTarjetaLines(lines) });
  }

  if (parsed.length === 1) return { resultado: parsed[0].r, emisor: parsed[0].emisor, archivos: 1 };

  if (!parsed.every(p => p.emisor === "amex")) {
    throw new Error("Se pueden subir varios PDFs juntos solo si son todos de Amex (uno por titular). Subí los de Galicia de a uno.");
  }
  return { resultado: mergeAmex(parsed.map(p => p.r)), emisor: "amex", archivos: parsed.length };
}
