// api/facturante.js — Vercel Serverless Function
//
// Emite comprobantes electrónicos ante AFIP vía Facturante SOAP API.
// Las credenciales se leen desde variables de entorno (nunca expuestas al browser).
//
// Variables de entorno requeridas (Vercel Dashboard → Settings → Environment Variables):
//   FACTURANTE_EMPRESA   →  ID de empresa (integer)
//   FACTURANTE_HASH      →  Hash de autenticación
//   FACTURANTE_USUARIO   →  Usuario
//   FACTURANTE_ENDPOINT  →  URL del servicio (testing o producción)

import { request as httpsRequest } from 'https';

const ENDPOINT  = process.env.FACTURANTE_ENDPOINT;
const EMPRESA   = process.env.FACTURANTE_EMPRESA;
const HASH      = process.env.FACTURANTE_HASH;
const USUARIO   = process.env.FACTURANTE_USUARIO;

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

// TipoComprobante: doc (FACTURA/NC) × condición IVA del cliente
const TIPO_COMPROBANTE = {
  'FACTURA|RI': 1,  // Factura A  — Responsable Inscripto
  'FACTURA|EX': 3,  // Factura B  — Exento / Consumidor Final
  'NC|RI':      6,  // Nota de Crédito A
  'NC|EX':      8,  // Nota de Crédito B
};

// TratamientoImpositivo del cliente receptor
// Verificar estos códigos contra la documentación de Facturante
const TRAT_IMPOSITIVO = {
  'Responsable Inscripto': 1,
  'Exento':                4,
  'Consumidor Final':      5,
  'Monotributista':        6,
};

// ─── SOAP BUILDERS ────────────────────────────────────────────────────────────

function buildAuth() {
  return `<Autenticacion>
      <Empresa>${EMPRESA}</Empresa>
      <Hash>${HASH}</Hash>
      <Usuario>${USUARIO}</Usuario>
    </Autenticacion>`;
}

function buildClienteConIVA(franchise) {
  const cuitClean = String(franchise.cuit ?? '').replace(/[-\s]/g, '');
  return `<Cliente>
      <NroDocumento>${cuitClean}</NroDocumento>
      <TipoDocumento>80</TipoDocumento>
      <RazonSocial>${escXml(franchise.razonSocial ?? '')}</RazonSocial>
      <DireccionFiscal>${escXml(franchise.domicilio ?? franchise.billingAddress ?? '')}</DireccionFiscal>
      <Localidad>${escXml(franchise.billingCity ?? '')}</Localidad>
      <CodigoPostal>${escXml(franchise.billingZip ?? '')}</CodigoPostal>
      <Provincia>${escXml(franchise.billingState ?? '')}</Provincia>
      <MailFacturacion>${escXml(franchise.emailFactura ?? '')}</MailFacturacion>
      <CondicionPago>0</CondicionPago>
      <TratamientoImpositivo>${TRAT_IMPOSITIVO[franchise.condIVA] ?? 1}</TratamientoImpositivo>
    </Cliente>`;
}

function buildClienteSinIVA(franchise) {
  const cuitClean = String(franchise.cuit ?? '').replace(/[-\s]/g, '');
  return `<Cliente>
      <NroDocumento>${cuitClean}</NroDocumento>
      <TipoDocumento>80</TipoDocumento>
      <RazonSocial>${escXml(franchise.razonSocial ?? '')}</RazonSocial>
      <DireccionFiscal>${escXml(franchise.domicilio ?? franchise.billingAddress ?? '')}</DireccionFiscal>
      <Localidad>${escXml(franchise.billingCity ?? '')}</Localidad>
      <CodigoPostal>${escXml(franchise.billingZip ?? '')}</CodigoPostal>
      <Provincia>${escXml(franchise.billingState ?? '')}</Provincia>
      <MailFacturacion>${escXml(franchise.emailFactura ?? '')}</MailFacturacion>
      <CondicionPago>0</CondicionPago>
    </Cliente>`;
}

function buildEncabezado(tipoComprobante, franchisor, comp, referenciaIdComprobante) {
  const fecha = isoDate(comp.date); // convierte DD/MM/YYYY → YYYY-MM-DD
  const prefijo = parseInt(franchisor.puntoVenta ?? '1', 10);

  const asociado = referenciaIdComprobante
    ? `<Asociados>
        <ComprobanteAsociado>
          <IdComprobante>${referenciaIdComprobante}</IdComprobante>
        </ComprobanteAsociado>
      </Asociados>`
    : '';

  return `<Encabezado>
      <FechaHora>${fecha}</FechaHora>
      <Prefijo>${prefijo}</Prefijo>
      <TipoComprobante>${tipoComprobante}</TipoComprobante>
      <CondicionVenta>1</CondicionVenta>
      <Moneda>PES</Moneda>
      <TipoDeCambio>1</TipoDeCambio>
      <Observaciones>${escXml(comp.ref ?? '')}</Observaciones>
      <EnviarComprobante>true</EnviarComprobante>
      ${asociado}
    </Encabezado>`;
}

function buildItemsConIVA(comp) {
  const neto = Number(comp.amountNeto ?? comp.amount ?? 0);
  const ivaRate = comp.applyIVA !== false ? 21 : 0;
  return `<Items>
      <ComprobanteItem>
        <Detalle>${escXml(comp.ref ?? 'Servicio')}</Detalle>
        <Cantidad>1</Cantidad>
        <PrecioUnitario>${neto.toFixed(2)}</PrecioUnitario>
        <IVA>${ivaRate}</IVA>
        <Gravado>${ivaRate > 0 ? 'true' : 'false'}</Gravado>
      </ComprobanteItem>
    </Items>`;
}

function buildItemsSinIVA(comp) {
  const total = Number(comp.amount ?? 0);
  return `<Items>
      <ComprobanteItemSinImpuestos>
        <Detalle>${escXml(comp.ref ?? 'Servicio')}</Detalle>
        <Cantidad>1</Cantidad>
        <PrecioUnitario>${total.toFixed(2)}</PrecioUnitario>
      </ComprobanteItemSinImpuestos>
    </Items>`;
}

function buildEnvelope(operacion, body) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:tns="http://tempuri.org/">
  <soap:Body>
    <tns:${operacion}>
      ${body}
    </tns:${operacion}>
  </soap:Body>
</soap:Envelope>`;
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
        'SOAPAction':     `"http://tempuri.org/IComprobantes/${soapAction}"`,
        'Content-Length': body.length,
      },
    };

    const timer = setTimeout(() => reject(new Error('timeout')), 15000);

    const req = httpsRequest(options, (upstream) => {
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
  // Busca el resultado dentro del elemento de respuesta
  const codigo       = extractTag(xml, 'Codigo');
  const estado       = extractTag(xml, 'Estado');
  const mensaje      = extractTag(xml, 'Mensaje');
  const idComp       = extractTag(xml, 'IdComprobante');
  return { codigo, estado, mensaje, idComprobante: idComp ? parseInt(idComp, 10) : null };
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
  // Already ISO
  return dmy.slice(0, 10);
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

  // Leer body
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

  // Decidir operación y construir envelope
  const usaIVA = franchise.applyIVA === true;
  const operacion = usaIVA ? 'CrearComprobante' : 'CrearComprobanteSinImpuestos';

  const cliente   = usaIVA ? buildClienteConIVA(franchise) : buildClienteSinIVA(franchise);
  const encabezado = buildEncabezado(tipoComprobante, franchisor, comp, referenciaIdComprobante);
  const items     = usaIVA ? buildItemsConIVA({ ...comp, applyIVA: true }) : buildItemsSinIVA(comp);

  const envelope = buildEnvelope(operacion, `
    ${buildAuth()}
    ${cliente}
    ${encabezado}
    ${items}
  `);

  try {
    const { status, body } = await soapCall(ENDPOINT, operacion, envelope);

    if (status !== 200) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ ok: false, error: `Facturante HTTP ${status}`, raw: body.slice(0, 500) }));
    }

    const parsed = parseResponse(body);

    // Códigos de error: Codigo != "0" o Estado contiene "Error"
    const isError = parsed.codigo && parsed.codigo !== '0';
    if (isError) {
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
      tipoComprobante,
      puntoVenta:     franchisor.puntoVenta,
      mensaje:        parsed.mensaje,
    }));

  } catch (err) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}
