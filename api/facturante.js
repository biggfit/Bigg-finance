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
  const fecha   = isoDateTime(comp.date);
  const prefijo = String(franchisor.puntoVenta ?? '1');
  const condVenta = contado ? 1 : 2; // 1=Contado, 2=Cuenta Corriente
  const vtoPagoXml = (!contado && fechaVtoPago)
    ? `<b:FechaVtoPago>${fechaVtoPago}</b:FechaVtoPago>`
    : '';
  return `<a:Encabezado>
        <b:Bienes>2</b:Bienes>
        <b:CondicionVenta>${condVenta}</b:CondicionVenta>
        <b:EnviarComprobante>true</b:EnviarComprobante>
        <b:FechaHora>${fecha}</b:FechaHora>
        ${vtoPagoXml}
        <b:Moneda>2</b:Moneda>
        <b:Observaciones>${escXml(comp.ref ?? '')}</b:Observaciones>
        <b:Prefijo>${escXml(prefijo)}</b:Prefijo>
        <b:TipoComprobante>${escXml(tipoStr)}</b:TipoComprobante>
        <b:TipoDeCambio>1</b:TipoDeCambio>
      </a:Encabezado>`;
}

function buildEncabezadoConIVAXml(tipoInt, franchisor, comp, referenciaIdComprobante, contado, fechaVtoPago) {
  const fecha   = isoDateTime(comp.date);
  const prefijo = String(franchisor.puntoVenta ?? '1');
  const condVenta = contado ? 1 : 2; // 1=Contado, 2=Cuenta Corriente

  const asociado = referenciaIdComprobante
    ? `<b:Asociados>
          <b:ComprobanteAsociado>
            <b:IdComprobante>${referenciaIdComprobante}</b:IdComprobante>
          </b:ComprobanteAsociado>
        </b:Asociados>`
    : '';

  const vtoPagoXml = (!contado && fechaVtoPago)
    ? `<b:FechaVtoPago>${fechaVtoPago}</b:FechaVtoPago>`
    : '';

  return `<a:Encabezado>
        ${asociado}
        <b:Bienes>2</b:Bienes>
        <b:CondicionVenta>${condVenta}</b:CondicionVenta>
        <b:EnviarComprobante>true</b:EnviarComprobante>
        <b:FechaHora>${fecha}</b:FechaHora>
        ${vtoPagoXml}
        <b:Moneda>2</b:Moneda>
        <b:Observaciones>${escXml(comp.ref ?? '')}</b:Observaciones>
        <b:Prefijo>${escXml(prefijo)}</b:Prefijo>
        <b:TipoComprobante>${tipoInt}</b:TipoComprobante>
        <b:TipoDeCambio>1</b:TipoDeCambio>
      </a:Encabezado>`;
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
  const neto = Number(comp.amountNeto ?? comp.amount ?? 0);
  return `<a:Items>
        <b:ComprobanteItem>
          <b:Cantidad>1</b:Cantidad>
          <b:Detalle>${escXml(comp.ref ?? 'Servicio')}</b:Detalle>
          <b:Gravado>true</b:Gravado>
          <b:IVA>21</b:IVA>
          <b:PrecioUnitario>${neto.toFixed(2)}</b:PrecioUnitario>
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

  const { action, franchisor, franchise, comp, referenciaIdComprobante } = payload;

  if (action === 'anular') {
    res.statusCode = 501;
    return res.end(JSON.stringify({ error: 'Anulación no implementada aún' }));
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

    requestBody = `
      ${buildAuthXml()}
      ${buildClienteConIVAXml(franchise, condPago)}
      ${buildEncabezadoConIVAXml(tipoComprobante, franchisor, comp, referenciaIdComprobante, contado, fechaVtoPago)}
      ${buildItemsConIVAXml(comp)}`;
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

  try {
    const { status, body } = await soapCall(ENDPOINT, operacion, envelope);

    if (status !== 200) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ ok: false, error: `Facturante HTTP ${status}`, raw: body.slice(0, 500) }));
    }

    const parsed = parseResponse(body);

    // Success: idComprobante present and mensaje does not indicate error
    const isSuccess = parsed.idComprobante != null && parsed.idComprobante > 0;
    if (!isSuccess) {
      return res.end(JSON.stringify({
        ok:     false,
        error:  parsed.mensaje ?? 'Error de Facturante',
        estado: parsed.estado,
      }));
    }

    return res.end(JSON.stringify({
      ok:             true,
      idComprobante:  parsed.idComprobante,
      tipoComprobante,
      puntoVenta:     franchisor.puntoVenta,
      mensaje:        parsed.mensaje,
    }));

  } catch (err) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}
