// api/facturante.js — Vercel Serverless Function
//
// Emite comprobantes electrónicos ante AFIP vía Facturante SOAP API.
// Las credenciales se leen desde variables de entorno (nunca expuestas al browser).
//
// Variables de entorno requeridas (Vercel Dashboard → Settings → Environment Variables):
//   FACTURANTE_EMPRESA   →  CompanyId (integer)
//   FACTURANTE_HASH      →  Password / Hash de autenticación
//   FACTURANTE_USUARIO   →  Username (email)
//   FACTURANTE_ENDPOINT  →  URL del servicio
//                           Testing:    http://testing.facturante.com/api/comprobantes.svc
//                           Producción: https://www.facturante.com/api/comprobantes.svc

import { request as httpsRequest } from 'https';
import { request as httpRequest  } from 'http';

const ENDPOINT = process.env.FACTURANTE_ENDPOINT;
const EMPRESA  = process.env.FACTURANTE_EMPRESA;
const HASH     = process.env.FACTURANTE_HASH;
const USUARIO  = process.env.FACTURANTE_USUARIO;

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

// TipoComprobante string codes (Facturante docs)
const TIPO_COMPROBANTE = {
  'FACTURA|RI': 'FA',   // Factura A  — Responsable Inscripto
  'FACTURA|EX': 'FB',   // Factura B  — Exento / CF / Monotributista
  'NC|RI':      'NCA',  // Nota de Crédito A
  'NC|EX':      'NCB',  // Nota de Crédito B
};

// TratamientoImpositivo codes (Facturante docs)
const TRAT_IMPOSITIVO = {
  'Responsable Inscripto': 2,
  'Monotributista':        1,
  'Consumidor Final':      3,
  'Exento':                4,
  'IVA No Responsable':    5,
};

// Moneda codes (Facturante docs): 2=ARS, 3=USD
const MONEDA = { ARS: 2, PES: 2, USD: 3, EUR: 3 };

// ─── SOAP NAMESPACES ──────────────────────────────────────────────────────────

const NS_HTTP  = 'xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"';
const NS_HTTPS = 'xmlns:soapenv="http://www.w3.org/2003/05/soap-envelope"';
const NS_XSI   = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const NS_FAC   = 'xmlns:fac="http://www.facturante.com.API"';
const NS_FAC1  = 'xmlns:fac1="http://schemas.datacontract.org/2004/07/FacturanteMVC.API"';
const NS_FAC2  = 'xmlns:fac2="http://schemas.datacontract.org/2004/07/FacturanteMVC.API.DTOs"';

// ─── SOAP BUILDERS ────────────────────────────────────────────────────────────

function buildAuth() {
  return `<fac1:Autenticacion>
      <fac2:Empresa>${EMPRESA}</fac2:Empresa>
      <fac2:Hash>${HASH}</fac2:Hash>
      <fac2:Usuario>${USUARIO}</fac2:Usuario>
    </fac1:Autenticacion>`;
}

function buildCliente(franchise) {
  const cuitClean = String(franchise.cuit ?? '').replace(/[-\s]/g, '');
  const trat = TRAT_IMPOSITIVO[franchise.condIVA] ?? 2;
  return `<fac1:Cliente>
      <fac2:CodigoPostal>${escXml(franchise.billingZip ?? '')}</fac2:CodigoPostal>
      <fac2:CondicionPago>0</fac2:CondicionPago>
      <fac2:DireccionFiscal>${escXml(franchise.domicilio ?? franchise.billingAddress ?? '')}</fac2:DireccionFiscal>
      <fac2:EnviarComprobante>false</fac2:EnviarComprobante>
      <fac2:Localidad>${escXml(franchise.billingCity ?? '')}</fac2:Localidad>
      <fac2:MailFacturacion>${escXml(franchise.emailFactura ?? '')}</fac2:MailFacturacion>
      <fac2:NroDocumento>${cuitClean}</fac2:NroDocumento>
      <fac2:PercibeIIBB>false</fac2:PercibeIIBB>
      <fac2:PercibeIVA>false</fac2:PercibeIVA>
      <fac2:Provincia>${escXml(franchise.billingState ?? '')}</fac2:Provincia>
      <fac2:RazonSocial>${escXml(franchise.razonSocial ?? '')}</fac2:RazonSocial>
      <fac2:TipoDocumento>6</fac2:TipoDocumento>
      <fac2:TratamientoImpositivo>${trat}</fac2:TratamientoImpositivo>
    </fac1:Cliente>`;
}

function buildEncabezado(tipoComprobante, franchisor, comp, referenciaIdComprobante) {
  const fecha    = isoDate(comp.date);
  const prefijo  = String(franchisor.puntoVenta ?? '1').padStart(4, '0');
  const neto     = Number(comp.amountNeto ?? comp.amount ?? 0);
  const iva      = Number(comp.amountIVA  ?? 0);
  const total    = neto + iva;
  const moneda   = MONEDA[comp.currency ?? 'ARS'] ?? 2;

  const asociados = referenciaIdComprobante
    ? `<fac2:Asociados>
          <fac2:ComprobanteAsociado>
            <fac2:IdComprobante>${referenciaIdComprobante}</fac2:IdComprobante>
          </fac2:ComprobanteAsociado>
        </fac2:Asociados>`
    : '<fac2:Asociados xsi:nil="true" />';

  return `<fac1:Encabezado>
      ${asociados}
      <fac2:Bienes>1</fac2:Bienes>
      <fac2:CodigoPagoElectronico xsi:nil="true" />
      <fac2:CondicionVenta>1</fac2:CondicionVenta>
      <fac2:EnviarComprobante>true</fac2:EnviarComprobante>
      <fac2:FechaHora>${fecha}T00:00:00</fac2:FechaHora>
      <fac2:FechaServDesde xsi:nil="true" />
      <fac2:FechaServHasta xsi:nil="true" />
      <fac2:FechaVtoPago xsi:nil="true" />
      <fac2:ImporteImpuestosInternos>0</fac2:ImporteImpuestosInternos>
      <fac2:ImportePercepcionesMunic>0</fac2:ImportePercepcionesMunic>
      <fac2:Moneda>${moneda}</fac2:Moneda>
      <fac2:Observaciones>${escXml(comp.ref ?? '')}</fac2:Observaciones>
      <fac2:OrdenCompra xsi:nil="true" />
      <fac2:PercepcionIIBB>0</fac2:PercepcionIIBB>
      <fac2:PercepcionIVA>0</fac2:PercepcionIVA>
      <fac2:PorcentajeIIBB>0</fac2:PorcentajeIIBB>
      <fac2:Prefijo>${prefijo}</fac2:Prefijo>
      <fac2:Remito xsi:nil="true" />
      <fac2:SubTotal>${neto.toFixed(2)}</fac2:SubTotal>
      <fac2:SubTotalExcento>0</fac2:SubTotalExcento>
      <fac2:SubTotalNoAlcanzado>0</fac2:SubTotalNoAlcanzado>
      <fac2:TipoComprobante>${tipoComprobante}</fac2:TipoComprobante>
      <fac2:TipoDeCambio>1</fac2:TipoDeCambio>
      <fac2:Total>${total.toFixed(3)}</fac2:Total>
      <fac2:TotalConDescuento>0</fac2:TotalConDescuento>
      <fac2:TotalNeto>${neto.toFixed(3)}</fac2:TotalNeto>
    </fac1:Encabezado>`;
}

function buildItems(comp, applyIVA) {
  const neto  = Number(comp.amountNeto ?? comp.amount ?? 0);
  const iva   = Number(comp.amountIVA  ?? 0);
  const total = neto + iva;
  const ivaRate = applyIVA ? 21 : 0;
  return `<fac1:Items>
      <fac2:ComprobanteItem>
        <fac2:Bonificacion>0</fac2:Bonificacion>
        <fac2:Cantidad>1</fac2:Cantidad>
        <fac2:Codigo xsi:nil="true" />
        <fac2:Detalle>${escXml(comp.ref ?? 'Servicio')}</fac2:Detalle>
        <fac2:Gravado>${applyIVA ? 'true' : 'false'}</fac2:Gravado>
        <fac2:IVA>${ivaRate}.000</fac2:IVA>
        <fac2:PrecioUnitario>${neto.toFixed(3)}</fac2:PrecioUnitario>
        <fac2:Total>${total.toFixed(3)}</fac2:Total>
      </fac2:ComprobanteItem>
    </fac1:Items>`;
}

function buildEnvelope(operacion, body, endpoint) {
  const useHttps = endpoint.startsWith('https');
  const envNs    = useHttps ? NS_HTTPS : NS_HTTP;
  const header   = useHttps
    ? `<soapenv:Header>
      <Action xmlns="http://www.w3.org/2005/08/addressing">http://www.facturante.com.API/IComprobantes/${operacion}</Action>
      <To xmlns="http://www.w3.org/2005/08/addressing">${endpoint}</To>
    </soapenv:Header>`
    : '<soapenv:Header/>';

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope ${envNs} ${NS_XSI} ${NS_FAC} ${NS_FAC1} ${NS_FAC2}>
  ${header}
  <soapenv:Body>
    <fac:${operacion}>
      <fac:request>
        ${body}
      </fac:request>
    </fac:${operacion}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ─── SOAP CALL ────────────────────────────────────────────────────────────────

function soapCall(endpoint, operacion, envelope) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(endpoint); } catch { return reject(new Error('FACTURANTE_ENDPOINT inválido')); }

    const body    = Buffer.from(envelope, 'utf8');
    const useHttps = endpoint.startsWith('https');
    const soapAction = `http://www.facturante.com.API/IComprobantes/${operacion}`;

    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':   'text/xml; charset=utf-8',
        'SOAPAction':     `"${soapAction}"`,
        'Content-Length': body.length,
      },
    };

    const timer = setTimeout(() => reject(new Error('timeout')), 15000);
    const mod   = useHttps ? httpsRequest : httpRequest;

    const req = mod(options, (upstream) => {
      let data = '';
      upstream.on('data', chunk => { data += chunk; });
      upstream.on('end', () => { clearTimeout(timer); resolve({ status: upstream.statusCode, body: data }); });
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
  const codigo       = extractTag(xml, 'Codigo');
  const estado       = extractTag(xml, 'Estado');
  const mensaje      = extractTag(xml, 'Mensaje');
  const idComp       = extractTag(xml, 'IdComprobante');
  const tipoComp     = extractTag(xml, 'TipoComprobante');
  return { codigo, estado, mensaje, idComprobante: idComp ? parseInt(idComp, 10) : null, tipoComprobante: tipoComp };
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

function isoDate(dmy) {
  if (!dmy) return new Date().toISOString().slice(0, 10);
  const parts = String(dmy).split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return String(dmy).slice(0, 10);
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

  // Determinar tipo de comprobante
  const doc = String(comp.type ?? '').split('|')[0]; // "FACTURA" o "NC"
  const cat = franchise.condIVA === 'Responsable Inscripto' ? 'RI' : 'EX';
  const tipoComprobante = TIPO_COMPROBANTE[`${doc}|${cat}`];

  if (!tipoComprobante) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: `Tipo de comprobante no soportado: ${doc} / ${franchise.condIVA}` }));
  }

  const applyIVA = franchise.applyIVA === true;
  const body = `
    ${buildAuth()}
    ${buildCliente(franchise)}
    ${buildEncabezado(tipoComprobante, franchisor, comp, referenciaIdComprobante)}
    ${buildItems(comp, applyIVA)}
  `;
  const envelope = buildEnvelope('CrearComprobante', body, ENDPOINT);

  try {
    const { status, body: respBody } = await soapCall(ENDPOINT, 'CrearComprobante', envelope);

    if (status !== 200) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ ok: false, error: `Facturante HTTP ${status}`, raw: respBody.slice(0, 500) }));
    }

    const parsed = parseResponse(respBody);
    if (parsed.codigo && parsed.codigo !== '0') {
      return res.end(JSON.stringify({
        ok:     false,
        error:  parsed.mensaje ?? 'Error de Facturante',
        codigo: parsed.codigo,
        estado: parsed.estado,
      }));
    }

    return res.end(JSON.stringify({
      ok:             true,
      idComprobante:  parsed.idComprobante,
      tipoComprobante: parsed.tipoComprobante ?? tipoComprobante,
      puntoVenta:     franchisor.puntoVenta,
      mensaje:        parsed.mensaje,
    }));

  } catch (err) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}
