// ─── Quién emite un comprobante y por dónde sale ────────────────────────────────────────────
// Una sola regla para los cinco caminos que emiten (wizard manual, modal rápido de la ficha,
// import Excel, lotes CRM y pago a cuenta desde Pendientes). Estaba escrita cinco veces con tres
// criterios, y los que miraban el PAÍS de la sede se equivocaban: ÑAKO le factura la pauta en
// pesos a sedes del exterior (Pocitos) contra un CUIT argentino, así que ese comprobante tiene que
// salir por ARCA. Mirando el país caía al correlativo interno con número "USA-…", sin
// facturanteId e invisible para el panel de pendientes de AFIP.
//
// Lo que decide es la SOCIEDAD que emite (la activa), no la sede. Elegir la sociedad por país es
// otra regla — la del fee (empresaEmisoraPorPais) — y vive antes de llegar acá.
import { COMPANIES } from "../data/franchisor";

/**
 * @param {object}  p
 * @param {string}  p.empresa       sociedad que emite (la activa)
 * @param {string}  p.currency      moneda del comprobante
 * @param {string}  p.doc           "FACTURA" | "NC" | otro (FC recibida, movimientos)
 * @param {boolean} [p.esSedePropia] sede propia → asiento de gestión, sin ARCA ni número
 * @param {boolean} [p.refEsFiscal]  NC que anula una factura que sí salió fiscal: sale fiscal aunque
 *                                   la sede sea propia (si no, la factura queda viva anulada solo
 *                                   por un asiento interno)
 * @returns {{ destino: "arca"|"correlativo"|"gestion"|"ninguno", prefijo: "USA"|"ESP"|null, etiqueta: string }}
 *   arca        → se emite en Facturante
 *   correlativo → número interno `${prefijo}-<frId>-NNNN` (BIGG FIT LLC → USA, Wellness → ESP)
 *   gestion     → se guarda como GFAC|/GNC|, sin documento
 *   ninguno     → no es un documento emitido (o combinación sin canal: ÑAKO en otra moneda)
 */
export function reglaEmision({ empresa, currency, doc, esSedePropia = false, refEsFiscal = false }) {
  const esNC = doc === "NC";
  if (doc !== "FACTURA" && !esNC) return { destino: "ninguno", prefijo: null, etiqueta: "—" };
  if (esSedePropia && !refEsFiscal) {
    return { destino: "gestion", prefijo: null, etiqueta: `Asiento de gestión (${esNC ? "NC" : "factura"} interna, sin ARCA)` };
  }
  const side = COMPANIES[empresa]?.side;
  if (side === "ar") {
    // ÑAKO solo factura en pesos; en otra moneda no hay canal fiscal y un correlativo "USA-" con
    // ÑAKO como emisora es justamente el error que esta regla corrige. Hoy no se puede elegir otra
    // moneda para ÑAKO (COMPANIES.currencies), así que esto queda como red.
    return currency === "ARS"
      ? { destino: "arca", prefijo: null, etiqueta: `${esNC ? "NC" : "Factura"} ARCA (${empresa})` }
      : { destino: "ninguno", prefijo: null, etiqueta: `Sin canal de emisión para ${empresa} en ${currency}` };
  }
  if (side === "es") return { destino: "correlativo", prefijo: "ESP", etiqueta: `${esNC ? "Nota de Crédito" : "Factura"} (${empresa})` };
  return { destino: "correlativo", prefijo: "USA", etiqueta: `${esNC ? "Credit Note" : "Invoice"} (${empresa ?? "BIGG FIT LLC"})` };
}
