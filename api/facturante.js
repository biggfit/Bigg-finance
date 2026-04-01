// api/facturante.js — Vercel Serverless Function
//
// Emite comprobantes electrónicos ante AFIP vía Facturante SOAP API (WCF).
// Las credenciales se leen desde variables de entorno (nunca expuestas al browser).
//
// Variables de entorno requeridas (Vercel Dashboard → Settings → Environment Variables):
//   FACTURANTE_EMPRESA   →  ID de empresa (integer)
//   FACTURANTE_HASH      →  Hash de autenticación
//   FACTURANTE_USUARIO   →  Usuario
//   FACTURANTE_ENDPOINT  →  URL del servicio (testing o producción)

import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';

const ENDPOINT  = process.env.FACTURANTE_ENDPOINT;
const EMPRESA   = process.env.FACTURANTE_EMPRESA;
const HASH      = process.env.FACTURANTE_HASH;
const USUARIO   = process.env.FACTURANTE_USUARIO;

// ─── WCF NAMESPACES (from WSDL) ─────────────────────────────────────────────

const NS_OP  = 'http://www.facturante.com.API';                              // operation namespace
const NS_DC  = 'http://schemas.datacontract.org/2004/07/FacturanteMVC.API';  // DataContract namespace
const NS_DTO = 'http://schemas.datacontract.org/2004/07/FacturanteMVC.API.DTOs'; // DTO namespace

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

// TipoComprobante codes for CrearComprobante (con IVA) — string codes de Facturante
const TIPO_COMPROBANTE_CON_IVA = {
  'FACTURA|RI': 'FA',  // Factura A  — Responsable Inscripto
  'FACTURA|EX': 'FB',  // Factura B  — Exento / Consumidor Final
  'NC|RI':      'NCA', // Nota de Crédito A
  'NC|EX':      'NCB', // Nota de Crédito B
};

// TipoComprobante codes for CrearComprobanteSinImpuestos — string codes
const TIPO_COMPROBANTE_SIN_IVA = {
  'FACTURA': 'F',
  'NC':      'NC',
  'ND':      'ND',
};

// TratamientoImpositivo del cliente receptor (for CrearComprobante)
const TRAT_IMPOSITIVO = {
  'Responsable Inscripto': 1,
  'Exento':                4,
  'Consumidor Final':      5,
  'Monotributista':        6,
};

// ─── SOAP BUILDERS (WCF DataContract format) ─────────────────────────────────

function buildAuthXml() {
  return `<a:Autenticacion>
        <b:Empresa>${parseInt(EMPRESA, 10)}</b:Empresa>
        <b:Hash>${escXml(HASH)}</b:Hash>
        <b:Usuario>${escXml(USUARIO)}</b:Usuario>
      </a:Autenticacion>`;
}

function buildClienteSinIVAXml(franchise, condPago) {
  const cuitClean = String(franchise.cuit ?? '').replace(/[-\s]/g, '');
  return `<a:Cliente>
        <b:CodigoPostal>${escXml(franchise.billingZip ?? '')}</b:CodigoPostal>
        <b:CondicionPago>${condPago}</b:CondicionPago>
        <b:DireccionFiscal>${escXml(franchise.domicilio ?? franchise.billingAddress ?? '')}</b:DireccionFiscal>
        <b:Localidad>${escXml(franchise.billingCity ?? '')}</b:Localidad>
        <b:MailFacturacion>${escXml(franchise.emailFactura ?? '')}</b:MailFacturacion>
        <b:NroDocumento>${cuitClean}</b:NroDocumento>
        <b:Provincia>${escXml(franchise.billingState ?? '')}</b:Provincia>
        <b:RazonSocial>${escXml(franchise.razonSocial ?? '')}</b:RazonSocial>
      </a:Cliente>`;
}

function buildClienteConIVAXml(franchise, condPago) {
  const cuitClean = String(franchise.cuit ?? '').replace(/[-\s]/g, '');
  return `<a:Cliente>
        <b:CodigoPostal>${escXml(franchise.billingZip ?? '')}</b:CodigoPostal>
        <b:CondicionPago>${condPago}</b:CondicionPago>
        <b:DireccionFiscal>${escXml(franchise.domicilio ?? franchise.billingAddress ?? '')}</b:DireccionFiscal>
        <b:Localidad>${escXml(franchise.billingCity ?? '')}</b:Localidad>
        <b:MailFacturacion>${escXml(franchise.emailFactura ?? '')}</b:MailFacturacion>
        <b:NroDocumento>${cuitClean}</b:NroDocumento>
        <b:Provincia>${escXml(franchise.billingState ?? '')}</b:Provincia>
        <b:RazonSocial>${escXml(franchise.razonSocial ?? '')}</b:RazonSocial>
        <b:TipoDocumento>6</b:TipoDocumento><!-- 6 = CUIT en catálogo Facturante -->
        <b:TratamientoImpositivo>${TRAT_IMPOSITIVO[franchise.condIVA] ?? 1}</b:TratamientoImpositivo>
      </a:Cliente>`;
}

function buildEncabezadoSinIVAXml(tipoStr, franchisor, comp, contado, fechaVtoPago) {
  const fecha      = isoDateTime(comp.date);
  const prefijo    = String(franchisor.puntoVenta ?? '1');
  const condVenta  = contado ? 1 : 2;
  const periodo    = calcPeriodoServicio(comp);
  // FechaVtoPago obligatoria cuando FechaServDesde/Hasta presentes (AFIP error 10035)
  const vtoPagoVal = fechaVtoPago ?? fecha;
  const vtoPagoXml = `<b:FechaVtoPago>${vtoPagoVal}</b:FechaVtoPago>`;
  return `<a:Encabezado>
        <b:Bienes>2</b:Bienes>
        <b:CondicionVenta>${condVenta}</b:CondicionVenta>
        <b:EnviarComprobante>true</b:EnviarComprobante>
        <b:FechaHora>${fecha}</b:FechaHora>
        <b:FechaServDesde>${periodo.desde}</b:FechaServDesde>
        <b:FechaServHasta>${periodo.hasta}</b:FechaServHasta>
        ${vtoPagoXml}
        <b:Moneda>2</b:Moneda>
        <b:Observaciones>${escXml(comp.ref ?? '')}</b:Observaciones>
        <b:Prefijo>${escXml(prefijo)}</b:Prefijo>
        <b:TipoComprobante>${escXml(tipoStr)}</b:TipoComprobante>
        <b:TipoDeCambio>1</b:TipoDeCambio>
      </a:Encabezado>`;
}

// NCA referencia FA, NCB referencia FB
const NC_TIPO_REFERENCIA = { 'NCA': 'FA', 'NCB': 'FB' };

/** Encabezado para FA — usa ComprobanteEncabezado (CrearComprobante) */
function buildEncabezadoConIVAXml(tipoStr, franchisor, comp, contado, fechaVtoPago) {
  const fecha      = isoDateTime(comp.date);
  const prefijo    = String(franchisor.puntoVenta ?? '1');
  const condVenta  = contado ? 1 : 2;
  const periodo    = calcPeriodoServicio(comp);
  const neto       = Number(comp.amountNeto ?? comp.amount ?? 0);
  const total      = Number(comp.amount ?? (neto * 1.21));
  const vtoPagoVal = fechaVtoPago ?? fecha;

  return `<a:Encabezado>
        <b:Bienes>2</b:Bienes>
        <b:CondicionVenta>${condVenta}</b:CondicionVenta>
        <b:EnviarComprobante>true</b:EnviarComprobante>
        <b:FechaHora>${fecha}</b:FechaHora>
        <b:FechaServDesde>${periodo.desde}</b:FechaServDesde>
        <b:FechaServHasta>${periodo.hasta}</b:FechaServHasta>
        <b:FechaVtoPago>${vtoPagoVal}</b:FechaVtoPago>
        <b:Moneda>2</b:Moneda>
        <b:Observaciones>${escXml(comp.ref ?? '')}</b:Observaciones>
        <b:Prefijo>${escXml(prefijo)}</b:Prefijo>
        <b:TipoComprobante>${escXml(tipoStr)}</b:TipoComprobante>
        <b:TipoDeCambio>1</b:TipoDeCambio>
      </a:Encabezado>`;
}

/**
 * Encabezado para NC — usa ComprobanteEncabezadoFull (CrearComprobanteFull)
 * que SÍ tiene el campo Asociados para CbteAsoc.
 * @param {{ numero, prefijo }} refAfip  - datos AFIP de la FA referenciada
 * @param {string} refDate               - fecha de la FA referenciada (dd/mm/yyyy)
 */
function buildEncabezadoConIVAFullXml(tipoStr, franchisor, comp, refAfip, refDate, contado, fechaVtoPago) {
  const fecha      = isoDateTime(comp.date);
  const prefijo    = String(franchisor.puntoVenta ?? '1');
  const condVenta  = contado ? 1 : 2;
  const periodo    = calcPeriodoServicio(comp);
  const neto       = Number(comp.amountNeto ?? comp.amount ?? 0);
  const total      = Number(comp.amount ?? (neto * 1.21));
  const vtoPagoVal = fechaVtoPago ?? fecha;

  // Bloque Asociados con campos WSDL correctos: FechaEmision, Numero, PuntoVenta, Tipo
  let asociado = '<b:Asociados i:nil="true"/>';
  if (refAfip?.numero > 0) {
    const fechaEmision = isoDateTime(refDate ?? comp.date);
    const refTipo      = NC_TIPO_REFERENCIA[tipoStr] ?? 'FA';
    const refPtoVenta  = parseInt(String(refAfip.prefijo ?? franchisor.puntoVenta ?? '100'), 10);
    asociado = `<b:Asociados>
          <b:ComprobanteAsociado>
            <b:FechaEmision>${fechaEmision}</b:FechaEmision>
            <b:Numero>${refAfip.numero}</b:Numero>
            <b:PuntoVenta>${refPtoVenta}</b:PuntoVenta>
            <b:Tipo>${escXml(refTipo)}</b:Tipo>
          </b:ComprobanteAsociado>
        </b:Asociados>`;
  }

  return `<a:Encabezado>
        ${asociado}
        <b:Bienes>2</b:Bienes>
        <b:CondicionVenta>${condVenta}</b:CondicionVenta>
        <b:EnviarComprobante>true</b:EnviarComprobante>
        <b:FechaHora>${fecha}</b:FechaHora>
        <b:FechaServDesde>${periodo.desde}</b:FechaServDesde>
        <b:FechaServHasta>${periodo.hasta}</b:FechaServHasta>
        <b:FechaVtoPago>${vtoPagoVal}</b:FechaVtoPago>
        <b:Moneda>2</b:Moneda>
        <b:Observaciones>${escXml(comp.ref ?? '')}</b:Observaciones>
        <b:Prefijo>${escXml(prefijo)}</b:Prefijo>
        <b:TipoComprobante>${escXml(tipoStr)}</b:TipoComprobante>
        <b:TipoDeCambio>1</b:TipoDeCambio>
      </a:Encabezado>`;
}

/** Items para CrearComprobanteFull — usa ComprobanteItemFull (sin campo Total) */
function buildItemsConIVAFullXml(comp) {
  const neto = Number(comp.amountNeto ?? comp.amount ?? 0);
  return `<a:Items>
        <b:ComprobanteItemFull>
          <b:Cantidad>1</b:Cantidad>
          <b:Detalle>${escXml(comp.ref ?? 'Servicio')}</b:Detalle>
          <b:Gravado>true</b:Gravado>
          <b:IVA>21.000</b:IVA>
          <b:PrecioUnitario>${neto.toFixed(2)}</b:PrecioUnitario>
        </b:ComprobanteItemFull>
      </a:Items>`;
}

function buildItemsSinIVAXml(comp) {
  const total = Number(comp.amount ?? 0);
  return `<a:Items>
        <b:ComprobanteItemSinImpuestos>
          <b:Cantidad>1</b:Cantidad>
          <b:Detalle>${escXml(comp.ref ?? 'Servicio')}</b:Detalle>
          <b:PrecioUnitario>${total.toFixed(2)}</b:PrecioUnitario>
        </b:ComprobanteItemSinImpuestos>
      </a:Items>`;
}

function buildItemsConIVAXml(comp) {
  const neto  = Number(comp.amountNeto ?? comp.amount ?? 0);
  const total = Number(comp.amount ?? (neto * 1.21));
  return `<a:Items>
        <b:ComprobanteItem>
          <b:Cantidad>1</b:Cantidad>
          <b:Detalle>${escXml(comp.ref ?? 'Servicio')}</b:Detalle>
          <b:Gravado>true</b:Gravado>
          <b:IVA>21.000</b:IVA>
          <b:PrecioUnitario>${neto.toFixed(2)}</b:PrecioUnitario>
          <b:Total>${total.toFixed(2)}</b:Total>
        </b:ComprobanteItem>
      </a:Items>`;
}

function buildEnvelope(operacion, requestBody) {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <${operacion} xmlns="${NS_OP}">
      <request xmlns:a="${NS_DC}" xmlns:b="${NS_DTO}" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
      ${requestBody}
      </request>
    </${operacion}>
  </s:Body>
</s:Envelope>`;
}

// ─── SOAP CALL ────────────────────────────────────────────────────────────────

function soapCall(endpoint, soapAction, envelope) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(endpoint); } catch (e) { return reject(new Error('FACTURANTE_ENDPOINT inválido')); }

    const body = Buffer.from(envelope, 'utf8');
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':   'text/xml; charset=utf-8',
        'SOAPAction':     `"${NS_OP}/IComprobantes/${soapAction}"`,
        'Content-Length':  body.length,
      },
    };

    const timer = setTimeout(() => reject(new Error('timeout')), 15000);

    const doRequest = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = doRequest(options, (upstream) => {
      upstream.setEncoding('utf8');
      let data = '';
      upstream.on('data', chunk => { data += chunk; });
      upstream.on('end', () => {
        clearTimeout(timer);
        resolve({ status: upstream.statusCode, body: data });
      });
    });

    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.write(body);
    req.end();
  });
}

// ─── XML PARSERS ──────────────────────────────────────────────────────────────

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([^<]*)<`));
  return m ? m[1].trim() : null;
}

function parseResponse(xml) {
  const estado       = extractTag(xml, 'Estado');
  const mensaje      = extractTag(xml, 'Mensaje');
  const idComp       = extractTag(xml, 'IdComprobante');
  return { estado, mensaje, idComprobante: idComp ? parseInt(idComp, 10) : null };
}

// ─── DETALLE COMPROBANTE ──────────────────────────────────────────────────────

/**
 * Llama a DetalleComprobanteFull y devuelve los campos relevantes.
 * @returns {{ urlPdf, numero, prefijo }} — numero=null si AFIP aún no lo procesó
 */
async function getDetalleComprobante(idComprobante) {
  const requestBody = `
    <a:Autenticacion>
      <b:Empresa>${parseInt(EMPRESA, 10)}</b:Empresa>
      <b:Hash>${escXml(HASH)}</b:Hash>
      <b:Usuario>${escXml(USUARIO)}</b:Usuario>
    </a:Autenticacion>
    <a:IdComprobante>${idComprobante}</a:IdComprobante>`;

  const envelope = buildEnvelope('DetalleComprobanteFull', requestBody);
  try {
    const { status, body } = await soapCall(ENDPOINT, 'DetalleComprobanteFull', envelope);
    if (status !== 200) return {};
    const numeroRaw = extractTag(body, 'Numero');
    return {
      urlPdf:  extractTag(body, 'URLPDF') || null,
      numero:  numeroRaw ? (parseInt(numeroRaw, 10) || null) : null,
      prefijo: extractTag(body, 'Prefijo') || null,
    };
  } catch {
    return {};
  }
}

async function getUrlPdf(idComprobante) {
  const det = await getDetalleComprobante(idComprobante);
  return det.urlPdf ?? null;
}

/**
 * Espera hasta que AFIP asigne el número secuencial al comprobante (polling).
 * Retorna { numero, prefijo } o null si no se obtuvo en los reintentos.
 */
async function pollAfipNumero(idComprobante, maxAttempts = 8, delayMs = 2500) {
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, delayMs));
    const det = await getDetalleComprobante(idComprobante);
    if (det.numero > 0) return { numero: det.numero, prefijo: det.prefijo };
  }
  return null;
}

/**
 * Fetchea el PDF desde la URL de Facturante y lo devuelve como Buffer.
 */
function fetchPdfBuffer(pdfUrl) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(pdfUrl); } catch { return reject(new Error('URL PDF inválida')); }

    const doRequest = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const timer = setTimeout(() => reject(new Error('timeout PDF')), 15000);

    const req = doRequest({
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'GET',
    }, (upstream) => {
      const chunks = [];
      upstream.on('data', chunk => chunks.push(chunk));
      upstream.on('end', () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.end();
  });
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function escXml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

function isoDateTime(dmy) {
  if (!dmy) return new Date().toISOString();
  const parts = String(dmy).split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`;
  return dmy.includes('T') ? dmy : `${dmy.slice(0, 10)}T00:00:00`;
}

/**
 * Devuelve FechaServDesde y FechaServHasta: primer y último día del mes del comprobante.
 * comp.month es 0-indexed (0=Enero), comp.year es el año completo.
 * Fallback: deriva de comp.date (dd/mm/yyyy).
 */
function calcPeriodoServicio(comp) {
  let month, year;
  if (comp.month != null && comp.year != null) {
    month = parseInt(comp.month, 10); // 0-indexed
    year  = parseInt(comp.year,  10);
  } else if (comp.date) {
    const parts = String(comp.date).split('/');
    month = parseInt(parts[1], 10) - 1; // dd/mm/yyyy → 0-indexed
    year  = parseInt(parts[2], 10);
  } else {
    const now = new Date();
    month = now.getMonth();
    year  = now.getFullYear();
  }
  const mm       = String(month + 1).padStart(2, '0');
  const lastDay  = new Date(year, month + 1, 0).getDate(); // día 0 del mes siguiente = último día del mes actual
  return {
    desde: `${year}-${mm}-01T00:00:00`,
    hasta: `${year}-${mm}-${String(lastDay).padStart(2, '0')}T00:00:00`,
  };
}

/**
 * Calcula la fecha de vencimiento: día 10 del mes siguiente a la fecha de factura.
 * @param {string} dmy  - fecha en formato dd/mm/yyyy
 * @returns {string}     - ISO datetime "yyyy-MM-10T00:00:00"
 */
function calcFechaVtoPago(dmy) {
  if (!dmy) return null;
  const parts = String(dmy).split('/');
  if (parts.length !== 3) return null;
  const month   = parseInt(parts[1], 10); // 1-12
  const year    = parseInt(parts[2], 10);
  const nextMon = month === 12 ? 1 : month + 1;
  const nextYr  = month === 12 ? year + 1 : year;
  return `${nextYr}-${String(nextMon).padStart(2, '0')}-10T00:00:00`;
}

/**
 * Días entre la fecha de factura y el día 10 del mes siguiente (mínimo 1).
 * Se usa como valor de CondicionPago en el bloque Cliente.
 */
function calcCondicionPagoDias(dmy) {
  if (!dmy) return 30;
  const vto  = calcFechaVtoPago(dmy);
  if (!vto) return 30;
  const inv  = new Date(isoDateTime(dmy).slice(0, 10));
  const due  = new Date(vto.slice(0, 10));
  const days = Math.ceil((due - inv) / 86400000);
  return Math.max(1, days);
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  if (!ENDPOINT || !EMPRESA || !HASH || !USUARIO) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'Variables FACTURANTE_* no configuradas' }));
  }

  let rawBody = '';
  await new Promise((resolve) => {
    req.on('data', chunk => { rawBody += chunk; });
    req.on('end',  resolve);
  });

  let payload;
  try { payload = JSON.parse(rawBody); } catch {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'JSON inválido' }));
  }

  const { action, franchisor, franchise, comp, referenciaIdComprobante, referenciaDate } = payload;

  if (action === 'anular') {
    res.statusCode = 501;
    return res.end(JSON.stringify({ error: 'Anulación no implementada aún' }));
  }

  // ── Acción: getPdf ─────────────────────────────────────────────────────────
  if (action === 'getPdf') {
    const { idComprobante } = payload;
    if (!idComprobante) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: 'idComprobante requerido' }));
    }
    const urlPdf = await getUrlPdf(idComprobante);
    if (!urlPdf) {
      return res.end(JSON.stringify({ ok: false, error: 'PDF aún no disponible' }));
    }
    try {
      const pdfBuffer = await fetchPdfBuffer(urlPdf);
      res.setHeader('Content-Type', 'application/pdf');
      res.statusCode = 200;
      return res.end(pdfBuffer);
    } catch (err) {
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  if (action !== 'emitir') {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: `Acción desconocida: ${action}` }));
  }

  const doc    = String(comp.type ?? '').split('|')[0]; // "FACTURA" o "NC"
  const usaIVA = franchise.applyIVA === true;

  // ── Condición de pago ──────────────────────────────────────────────────────
  // comp.contado = true  → factura ya pagada (pago a cuenta), vence al contado
  // comp.contado = false → vence el día 10 del mes siguiente
  // Las NC siempre heredan la condición de la factura original → contado
  const contado       = comp.contado === true || doc === 'NC';
  const fechaVtoPago  = contado ? null : calcFechaVtoPago(comp.date);
  const condPago      = contado ? 1 : calcCondicionPagoDias(comp.date);

  // Para NC: obtener el número AFIP real de la FA referenciada via DetalleComprobanteFull
  // (no parseamos el invoice label — usamos el ID interno de Facturante para lookup directo)
  let refAfip = null;
  if (doc === 'NC' && referenciaIdComprobante) {
    refAfip = await getDetalleComprobante(referenciaIdComprobante);
    if (!refAfip?.numero || refAfip.numero <= 0) {
      return res.end(JSON.stringify({
        ok:    false,
        error: 'La FA referenciada aún no fue procesada por AFIP. Esperá unos segundos e intentá de nuevo.',
      }));
    }
  }

  let operacion, requestBody, tipoComprobante;

  if (usaIVA) {
    // CrearComprobante — con IVA, tipos enteros
    operacion = 'CrearComprobante';
    const cat = franchise.condIVA === 'Responsable Inscripto' ? 'RI' : 'EX';
    tipoComprobante = TIPO_COMPROBANTE_CON_IVA[`${doc}|${cat}`];

    if (!tipoComprobante) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: `Tipo no soportado: ${doc} / ${franchise.condIVA}` }));
    }

    if (doc === 'NC') {
      // NC: usa CrearComprobanteFull que sí tiene campo Asociados en ComprobanteEncabezadoFull
      operacion = 'CrearComprobanteFull';
      requestBody = `
        ${buildAuthXml()}
        ${buildClienteConIVAXml(franchise, condPago)}
        ${buildEncabezadoConIVAFullXml(tipoComprobante, franchisor, comp, refAfip, referenciaDate, contado, fechaVtoPago)}
        ${buildItemsConIVAFullXml(comp)}`;
    } else {
      requestBody = `
        ${buildAuthXml()}
        ${buildClienteConIVAXml(franchise, condPago)}
        ${buildEncabezadoConIVAXml(tipoComprobante, franchisor, comp, contado, fechaVtoPago)}
        ${buildItemsConIVAXml(comp)}`;
    }
  } else {
    // CrearComprobanteSinImpuestos — sin IVA, tipos string
    operacion = 'CrearComprobanteSinImpuestos';
    const tipoStr = TIPO_COMPROBANTE_SIN_IVA[doc];
    tipoComprobante = tipoStr;

    if (!tipoStr) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: `Tipo no soportado para SinImpuestos: ${doc}` }));
    }

    requestBody = `
      ${buildAuthXml()}
      ${buildClienteSinIVAXml(franchise, condPago)}
      ${buildEncabezadoSinIVAXml(tipoStr, franchisor, comp, contado, fechaVtoPago)}
      ${buildItemsSinIVAXml(comp)}`;
  }

  const envelope = buildEnvelope(operacion, requestBody);

  // Debug: loguear el XML enviado (solo en dev / cuando hay un NC)
  if (doc === 'NC') console.log('[facturante] NC envelope:\n', envelope);

  try {
    const { status, body } = await soapCall(ENDPOINT, operacion, envelope);
    if (doc === 'NC') console.log('[facturante] NC response:\n', body);

    if (status !== 200) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ ok: false, error: `Facturante HTTP ${status}`, raw: body.slice(0, 500) }));
    }

    const parsed = parseResponse(body);

    // Success: idComprobante present and mensaje does not indicate error
    const isSuccess = parsed.idComprobante != null && parsed.idComprobante > 0;
    if (!isSuccess) {
      // Extraer todos los mensajes de error disponibles para debug
      const codigo  = extractTag(body, 'Codigo');
      const detalle = extractTag(body, 'Detalle') ?? extractTag(body, 'MensajeError') ?? extractTag(body, 'Descripcion');
      const errMsg  = [parsed.mensaje, detalle].filter(Boolean).join(' — ') || 'Error de Facturante';
      return res.end(JSON.stringify({
        ok:     false,
        error:  errMsg,
        estado: parsed.estado,
        codigo,
      }));
    }

    // Esperar a que AFIP asigne el número secuencial real (necesario para CbteAsoc de futuras NC)
    const afip = await pollAfipNumero(parsed.idComprobante);

    return res.end(JSON.stringify({
      ok:             true,
      idComprobante:  parsed.idComprobante,
      afipNumero:     afip?.numero ?? null,   // número secuencial AFIP (ej. 10)
      afipPrefijo:    afip?.prefijo ?? null,  // prefijo/punto de venta (ej. "0100")
      tipoComprobante,
      puntoVenta:     franchisor.puntoVenta,
      mensaje:        parsed.mensaje,
    }));

  } catch (err) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}
