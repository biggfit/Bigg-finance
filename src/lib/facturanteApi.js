// ─── Facturante API client ────────────────────────────────────────────────────
// Llama al serverless function api/facturante.js que hace el SOAP real.
// Las credenciales nunca salen del servidor.

const BASE = '/api/facturante';

/**
 * Emite un comprobante electrónico ante AFIP vía Facturante.
 *
 * @param {object} opts
 * @param {object} opts.franchisor  - { cuit, razonSocial, condIVA, puntoVenta }
 * @param {object} opts.franchise   - { cuit, razonSocial, condIVA, applyIVA, domicilio, emailFactura, ... }
 * @param {object} opts.comp        - { type, date, amount, amountNeto, amountIVA, ref, currency }
 * @param {string} [opts.referenciaIdComprobante] - IdComprobante de la factura original (solo para NC)
 *
 * @returns {{ ok, idComprobante, tipoComprobante, puntoVenta, mensaje }}
 * @throws  Error con mensaje legible si falla
 */
export async function emitirComprobante({ franchisor, franchise, comp, referenciaIdComprobante }) {
  const res = await fetch(BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'emitir', franchisor, franchise, comp, referenciaIdComprobante }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? data.mensaje ?? 'Error de Facturante');
  return data; // { ok, idComprobante, tipoComprobante, puntoVenta, mensaje }
}

/**
 * Formatea el número de comprobante para mostrar en pantalla y guardar en Sheets.
 * Ej: tipoComprobante=1, idComprobante=4521, puntoVenta="0001" → "FA 0001-00004521"
 */
export function formatInvoiceLabel(tipoComprobante, idComprobante, puntoVenta) {
  // Supports both old numeric codes (legacy) and new string codes from Facturante API
  const legacyMap = { 1: 'FA', 3: 'FB', 6: 'NCA', 8: 'NCB' };
  const prefix = legacyMap[tipoComprobante] ?? String(tipoComprobante ?? 'FC').toUpperCase();
  const pv  = String(puntoVenta  ?? '1').padStart(4, '0');
  const num = String(idComprobante ?? '0').padStart(8, '0');
  return `${prefix} ${pv}-${num}`;
}
