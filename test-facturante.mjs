// test-facturante.mjs
// Prueba directa al endpoint de testing de Facturante
// Ejecutar: node test-facturante.mjs

import { request as httpRequest } from 'http';

// ─── Credenciales testing ──────────────────────────────────────────────────────
const ENDPOINT = 'http://testing.facturante.com/api/comprobantes.svc';
const EMPRESA  = '4615';
const HASH     = 'T1T5OSgzVADodM';
const USUARIO  = 'nakotest@yopmail.com';

// ─── Datos de prueba ───────────────────────────────────────────────────────────
const FRANCHISOR = {
  razonSocial: 'ÑAKO SRL TEST',
  cuit:        '30712345678',
  puntoVenta:  '00100',   // Prefijo de testing
};

const FRANCHISE = {
  razonSocial:    'EMPRESA PRUEBA SA',
  cuit:           '30500000007',
  condIVA:        'Responsable Inscripto',
  applyIVA:       true,
  domicilio:      'Av. Corrientes 1234',
  billingCity:    'Buenos Aires',
  billingZip:     '1043',
  billingState:   'CABA',
  emailFactura:   'test@example.com',
};

const COMP = {
  type:        'FACTURA|FEE',
  date:        '26/03/2026',
  amountNeto:  10000,
  amountIVA:   2100,
  amount:      12100,
  ref:         'Fee Marzo 2026 - PRUEBA',
  currency:    'ARS',
};

// ─── Build envelope (mismo código que api/facturante.js) ──────────────────────
const NS_HTTP  = 'xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"';
const NS_XSI   = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const NS_FAC   = 'xmlns:fac="http://www.facturante.com.API"';
const NS_FAC1  = 'xmlns:fac1="http://schemas.datacontract.org/2004/07/FacturanteMVC.API"';
const NS_FAC2  = 'xmlns:fac2="http://schemas.datacontract.org/2004/07/FacturanteMVC.API.DTOs"';

const TRAT = { 'Responsable Inscripto': 2, 'Monotributista': 1, 'Consumidor Final': 3, 'Exento': 4 };
const MONEDA = { ARS: 2, USD: 3, EUR: 3 };

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function isoDate(dmy) {
  const [dd, mm, yy] = dmy.split('/');
  return `${yy}-${mm}-${dd}`;
}

const prefijo   = String(FRANCHISOR.puntoVenta).padStart(4, '0');
const fecha     = isoDate(COMP.date);
const neto      = COMP.amountNeto;
const iva       = COMP.amountIVA;
const total     = neto + iva;
const moneda    = MONEDA[COMP.currency] ?? 2;
const trat      = TRAT[FRANCHISE.condIVA] ?? 2;
const cuitClean = FRANCHISE.cuit.replace(/[-\s]/g, '');

const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope ${NS_HTTP} ${NS_XSI} ${NS_FAC} ${NS_FAC1} ${NS_FAC2}>
  <soapenv:Header/>
  <soapenv:Body>
    <fac:CrearComprobante>
      <fac:request>
        <fac1:Autenticacion>
          <fac2:Empresa>${EMPRESA}</fac2:Empresa>
          <fac2:Hash>${HASH}</fac2:Hash>
          <fac2:Usuario>${USUARIO}</fac2:Usuario>
        </fac1:Autenticacion>
        <fac1:Cliente>
          <fac2:CodigoPostal>${esc(FRANCHISE.billingZip)}</fac2:CodigoPostal>
          <fac2:CondicionPago>0</fac2:CondicionPago>
          <fac2:DireccionFiscal>${esc(FRANCHISE.domicilio)}</fac2:DireccionFiscal>
          <fac2:EnviarComprobante>false</fac2:EnviarComprobante>
          <fac2:Localidad>${esc(FRANCHISE.billingCity)}</fac2:Localidad>
          <fac2:MailFacturacion>${esc(FRANCHISE.emailFactura)}</fac2:MailFacturacion>
          <fac2:NroDocumento>${cuitClean}</fac2:NroDocumento>
          <fac2:PercibeIIBB>false</fac2:PercibeIIBB>
          <fac2:PercibeIVA>false</fac2:PercibeIVA>
          <fac2:Provincia>${esc(FRANCHISE.billingState)}</fac2:Provincia>
          <fac2:RazonSocial>${esc(FRANCHISE.razonSocial)}</fac2:RazonSocial>
          <fac2:TipoDocumento>6</fac2:TipoDocumento>
          <fac2:TratamientoImpositivo>${trat}</fac2:TratamientoImpositivo>
        </fac1:Cliente>
        <fac1:Encabezado>
          <fac2:Asociados xsi:nil="true" />
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
          <fac2:Observaciones>${esc(COMP.ref)}</fac2:Observaciones>
          <fac2:OrdenCompra xsi:nil="true" />
          <fac2:PercepcionIIBB>0</fac2:PercepcionIIBB>
          <fac2:PercepcionIVA>0</fac2:PercepcionIVA>
          <fac2:PorcentajeIIBB>0</fac2:PorcentajeIIBB>
          <fac2:Prefijo>${prefijo}</fac2:Prefijo>
          <fac2:Remito xsi:nil="true" />
          <fac2:SubTotal>${neto.toFixed(2)}</fac2:SubTotal>
          <fac2:SubTotalExcento>0</fac2:SubTotalExcento>
          <fac2:SubTotalNoAlcanzado>0</fac2:SubTotalNoAlcanzado>
          <fac2:TipoComprobante>FA</fac2:TipoComprobante>
          <fac2:TipoDeCambio>1</fac2:TipoDeCambio>
          <fac2:Total>${total.toFixed(3)}</fac2:Total>
          <fac2:TotalConDescuento>0</fac2:TotalConDescuento>
          <fac2:TotalNeto>${neto.toFixed(3)}</fac2:TotalNeto>
        </fac1:Encabezado>
        <fac1:Items>
          <fac2:ComprobanteItem>
            <fac2:Bonificacion>0</fac2:Bonificacion>
            <fac2:Cantidad>1</fac2:Cantidad>
            <fac2:Codigo xsi:nil="true" />
            <fac2:Detalle>${esc(COMP.ref)}</fac2:Detalle>
            <fac2:Gravado>true</fac2:Gravado>
            <fac2:IVA>21.000</fac2:IVA>
            <fac2:PrecioUnitario>${neto.toFixed(3)}</fac2:PrecioUnitario>
            <fac2:Total>${total.toFixed(3)}</fac2:Total>
          </fac2:ComprobanteItem>
        </fac1:Items>
      </fac:request>
    </fac:CrearComprobante>
  </soapenv:Body>
</soapenv:Envelope>`;

// ─── Call ──────────────────────────────────────────────────────────────────────
const url  = new URL(ENDPOINT);
const body = Buffer.from(envelope, 'utf8');

console.log('→ Llamando a', ENDPOINT);
console.log('  Prefijo:', prefijo, '| Moneda:', moneda, '| TratImp:', trat);
console.log('  Neto:', neto, '| IVA:', iva, '| Total:', total);
console.log('');

const req = httpRequest({
  hostname: url.hostname,
  path:     url.pathname,
  method:   'POST',
  headers: {
    'Content-Type':   'text/xml; charset=utf-8',
    'SOAPAction':     '"http://www.facturante.com.API/IComprobantes/CrearComprobante"',
    'Content-Length': body.length,
  },
}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('HTTP Status:', res.statusCode);
    console.log('');
    // Pretty print relevant parts
    const codigo  = data.match(/<[^:>]+:?Codigo[^>]*>([^<]*)</)?.[1];
    const estado  = data.match(/<[^:>]+:?Estado[^>]*>([^<]*)</)?.[1];
    const mensaje = data.match(/<[^:>]+:?Mensaje[^>]*>([^<]*)</)?.[1];
    const idComp  = data.match(/<[^:>]+:?IdComprobante[^>]*>([^<]*)</)?.[1];
    if (codigo !== undefined) {
      console.log('Codigo:        ', codigo);
      console.log('Estado:        ', estado);
      console.log('Mensaje:       ', mensaje);
      console.log('IdComprobante: ', idComp);
      if (codigo === '0') console.log('\n✅ ÉXITO — Comprobante emitido en testing!');
      else                console.log('\n❌ ERROR de Facturante');
    } else {
      console.log('Respuesta raw (primeros 2000 chars):');
      console.log(data.slice(0, 2000));
    }
  });
});

req.on('error', e => console.error('Error de red:', e.message));
req.write(body);
req.end();
