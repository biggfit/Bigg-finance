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
 * @param {string} [opts.referenciaInvoice] - Invoice label de la FA referenciada (ej "FA 0100-00000014", solo para NC)
 * @param {string} [opts.referenciaDate]   - Fecha de la FA referenciada (dd/mm/yyyy)
 *
 * @returns {{ ok, idComprobante, afipNumero, afipPrefijo, tipoComprobante, puntoVenta, mensaje }}
 * @throws  Error con mensaje legible si falla
 */
export async function emitirComprobante({ franchisor, franchise, comp, referenciaInvoice, referenciaDate }) {
  const res = await fetch(BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'emitir', franchisor, franchise, comp, referenciaInvoice, referenciaDate }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? data.mensaje ?? 'Error de Facturante');
  return data; // { ok, idComprobante, tipoComprobante, puntoVenta, mensaje }
}

/**
 * Descarga el PDF oficial de AFIP de un comprobante emitido por Facturante.
 * Devuelve un Blob PDF listo para descargar.
 * Lanza Error si el PDF aún no está disponible o hubo un problema.
 *
 * @param {number|string} idComprobante
 * @returns {Promise<Blob>}
 */
/**
 * Consulta el número AFIP de un comprobante ya emitido (facturanteId conocido).
 * Útil cuando la emisión se completó pero pollAfipNumero devolvió null.
 * @returns {{ numero: number, prefijo: string }}
 * @throws Error si aún no está disponible
 */
export async function fetchAfipNumero(idComprobante) {
  const res = await fetch(BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'getNumero', idComprobante }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? 'Número AFIP no disponible');
  return { numero: data.numero, prefijo: data.prefijo };
}

export async function downloadFacturantePdfBlob(idComprobante) {
  const res = await fetch(BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'getPdf', idComprobante }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('Content-Type') ?? '';
  if (!ct.includes('pdf')) {
    const data = await res.json();
    throw new Error(data.error ?? 'PDF no disponible');
  }
  return res.blob();
}

/**
 * Formatea el número de comprobante para mostrar en pantalla y guardar en Sheets.
 * Ej: tipoComprobante=1, afipNumero=4521, puntoVenta="0001" → "FA 0001-00004521"
 */
export function formatInvoiceLabel(tipoComprobante, afipNumero, puntoVenta) {
  // Supports both old numeric codes (legacy) and new string codes from Facturante API
  const legacyMap = { 1: 'FA', 3: 'FB', 6: 'NCA', 8: 'NCB' };
  const prefix = legacyMap[tipoComprobante] ?? String(tipoComprobante ?? 'FC').toUpperCase();
  const pv  = String(puntoVenta  ?? '1').padStart(4, '0');
  const num = String(afipNumero  ?? '0').padStart(8, '0');
  return `${prefix} ${pv}-${num}`;
}

/**
 * Convierte el resultado de emitirComprobante en un invoice label AFIP.
 * Devuelve undefined si AFIP aún no asignó número (afipNumero es null).
 * Nunca usa idComprobante (ID interno de Facturante) como número de factura.
 */
export function invoiceFromResult(result) {
  if (!result?.afipNumero) return undefined;
  return formatInvoiceLabel(result.tipoComprobante, result.afipNumero, result.afipPrefijo ?? result.puntoVenta);
}
