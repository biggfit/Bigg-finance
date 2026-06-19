'use strict';
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// ── helpers ──────────────────────────────────────────────────────────────────

const KNOWN_SEDES = [
  '01 - Recoleta',
  '02 - Palermo Chico',
  '03 - Belgrano',
  '04 - Plaza Libertad',
  '05 - Barrio Norte',
  '07 - Botanico',
  '12 - Tigre Loco',
  'HQ - Administracion',
  'HQ - BI',
  'HQ - Gerencia General',
  'HQ - Impuestos',
  'HQ - Infraestructura IT',
  'HQ - Marketing',
  'HQ - Sport',
  'HQ - Tecnologia',
  'HQ - Ventas y Operaciones',
];

// Sort longest first so greedy match works
const SEDES_SORTED = [...KNOWN_SEDES].sort((a, b) => b.length - a.length);

function parseSedes(productosStr) {
  if (!productosStr) return [];
  let text = productosStr.trim();
  const found = new Set();
  for (const sede of SEDES_SORTED) {
    if (text.toLowerCase().includes(sede.toLowerCase())) {
      found.add(sede);
    }
  }
  return [...found];
}

function getSociedadFromMedio(medio) {
  if (!medio) return '';
  const m = medio.toLowerCase();
  if (m.includes('hektor')) return 'hektor';
  if (m.includes('ñako') || m.includes('nako')) return 'nako';
  if (m.includes('eventos')) return 'eventos';
  return '';
}

function formatDate(excelSerial) {
  if (!excelSerial) return '';
  // Excel date serial → JS date
  if (typeof excelSerial === 'number') {
    const d = new Date((excelSerial - 25569) * 86400 * 1000);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dy = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${dy}`;
  }
  // Already a string
  return String(excelSerial);
}

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// ── Step 1: build sociedad lookup from Paid file ──────────────────────────────

const paidWb = XLSX.readFile('C:/Users/lpini/Downloads/Listado de Compras 30-04-2026 1256 Hs.xlsx');
const paidWs = paidWb.Sheets[paidWb.SheetNames[0]];
const paidData = XLSX.utils.sheet_to_json(paidWs, { header: 1 });
const paidHeaders = paidData[0];

const pMedioIdx = paidHeaders.indexOf('Medio de Pago');
const pProvIdx = paidHeaders.indexOf('Proveedor');

// For each provider collect count of each sociedad label
const provSociedadCounts = {}; // { prov: { sociedad: count } }

for (let i = 1; i < paidData.length; i++) {
  const row = paidData[i];
  const prov = String(row[pProvIdx] || '').trim();
  const medio = String(row[pMedioIdx] || '').trim();
  const soc = getSociedadFromMedio(medio);
  if (!provSociedadCounts[prov]) provSociedadCounts[prov] = {};
  if (!provSociedadCounts[prov][soc]) provSociedadCounts[prov][soc] = 0;
  provSociedadCounts[prov][soc]++;
}

// Resolve: prefer non-blank, then most frequent
const provLookup = {};
for (const [prov, counts] of Object.entries(provSociedadCounts)) {
  const nonBlank = Object.entries(counts).filter(([k]) => k !== '');
  if (nonBlank.length === 0) {
    provLookup[prov] = '';
  } else {
    nonBlank.sort((a, b) => b[1] - a[1]);
    provLookup[prov] = nonBlank[0][0];
  }
}

// ── Step 2: process Pending file ──────────────────────────────────────────────

const pendWb = XLSX.readFile('C:/Users/lpini/Downloads/Listado de Compras 30-04-2026 1055 Hs.xlsx');
const pendWs = pendWb.Sheets[pendWb.SheetNames[0]];
const pendData = XLSX.utils.sheet_to_json(pendWs, { header: 1 });
const pendHeaders = pendData[0];

const H = (name) => pendHeaders.indexOf(name);
const idxId        = H('Id');
const idxEmision   = H('Emisión');
const idxVenc      = H('Vencimiento');
const idxProv      = H('Proveedor');
const idxCat       = H('Categoría');
const idxPV        = H('Punto de Venta');
const idxNF        = H('N° de Factura');
const idxIVA21     = H('IVA - 21%');
const idxIVA27     = H('IVA - 27%');
const idxAPagar    = H('A Pagar');
const idxProductos = H('Productos');

const outputRows = [];

for (let i = 1; i < pendData.length; i++) {
  const row = pendData[i];
  const aPagar = num(row[idxAPagar]);
  if (aPagar <= 0) continue; // safety guard

  const prov = String(row[idxProv] || '').trim();
  const cat  = String(row[idxCat]  || '').trim();
  const productos = String(row[idxProductos] || '').trim();
  const iva21Total = num(row[idxIVA21]);
  const iva27Total = num(row[idxIVA27]);
  const fecha = formatDate(row[idxEmision]);
  const vto   = formatDate(row[idxVenc]);
  const origenId = row[idxId] !== undefined ? String(row[idxId]) : '';

  // nro_comp
  const pv = String(row[idxPV] || '').trim();
  const nf = String(row[idxNF] || '').trim();
  const nroComp = (pv && pv !== '-' && nf && nf !== '-') ? `${pv}-${nf}` : '';

  // Currency
  const moneda = prov.toLowerCase().includes('usd') ? 'USD' : 'ARS';

  // Parse sedes (deduplicated)
  const sedes = parseSedes(productos);
  const numSedes = sedes.length || 1;

  // Determine IVA mode: both, 21only, 27only, none
  const hasBoth = iva21Total > 0 && iva27Total > 0;
  const has21   = iva21Total > 0 && iva27Total === 0;
  const has27   = iva27Total > 0 && iva21Total === 0;

  // For each sede, build lines
  const totalPerSede = aPagar / numSedes;
  const iva21PerSede = iva21Total / numSedes;
  const iva27PerSede = iva27Total / numSedes;

  const sedeList = sedes.length > 0 ? sedes : [''];

  for (const sede of sedeList) {
    const isHQ = sede.startsWith('HQ');

    let sociedadForSede;
    if (!isHQ && sede !== '') {
      sociedadForSede = 'hektor';
    } else {
      // HQ or unknown: use lookup
      sociedadForSede = provLookup[prov] !== undefined ? provLookup[prov] : '';
    }

    if (hasBoth) {
      // Two sub-lines per sede proportional split
      const totalIva = iva21Total + iva27Total;
      const w21 = iva21Total / totalIva;
      const w27 = iva27Total / totalIva;
      const total21 = totalPerSede * w21;
      const total27 = totalPerSede * w27;
      const iva21Spl = iva21PerSede;
      const iva27Spl = iva27PerSede;

      outputRows.push({
        sociedad: sociedadForSede,
        contraparte_nombre: prov,
        fecha,
        vto,
        moneda,
        total: +total21.toFixed(2),
        subtotal: +(total21 - iva21Spl).toFixed(2),
        iva_rate: 21,
        iva_monto: +iva21Spl.toFixed(2),
        cuenta_contable: cat,
        centro_costo: sede,
        nro_comp: nroComp,
        nota: '',
        origen_id: origenId,
      });
      outputRows.push({
        sociedad: sociedadForSede,
        contraparte_nombre: prov,
        fecha,
        vto,
        moneda,
        total: +total27.toFixed(2),
        subtotal: +(total27 - iva27Spl).toFixed(2),
        iva_rate: 27,
        iva_monto: +iva27Spl.toFixed(2),
        cuenta_contable: cat,
        centro_costo: sede,
        nro_comp: nroComp,
        nota: '',
        origen_id: origenId,
      });
    } else if (has21) {
      outputRows.push({
        sociedad: sociedadForSede,
        contraparte_nombre: prov,
        fecha,
        vto,
        moneda,
        total: +totalPerSede.toFixed(2),
        subtotal: +(totalPerSede - iva21PerSede).toFixed(2),
        iva_rate: 21,
        iva_monto: +iva21PerSede.toFixed(2),
        cuenta_contable: cat,
        centro_costo: sede,
        nro_comp: nroComp,
        nota: '',
        origen_id: origenId,
      });
    } else if (has27) {
      outputRows.push({
        sociedad: sociedadForSede,
        contraparte_nombre: prov,
        fecha,
        vto,
        moneda,
        total: +totalPerSede.toFixed(2),
        subtotal: +(totalPerSede - iva27PerSede).toFixed(2),
        iva_rate: 27,
        iva_monto: +iva27PerSede.toFixed(2),
        cuenta_contable: cat,
        centro_costo: sede,
        nro_comp: nroComp,
        nota: '',
        origen_id: origenId,
      });
    } else {
      outputRows.push({
        sociedad: sociedadForSede,
        contraparte_nombre: prov,
        fecha,
        vto,
        moneda,
        total: +totalPerSede.toFixed(2),
        subtotal: +totalPerSede.toFixed(2),
        iva_rate: 0,
        iva_monto: 0,
        cuenta_contable: cat,
        centro_costo: sede,
        nro_comp: nroComp,
        nota: '',
        origen_id: origenId,
      });
    }
  }
}

// ── Step 3: write XLSX with openpyxl-style formatting via raw XML ─────────────
// We'll use SheetJS to build the workbook, then patch in styles manually.

const COLS = [
  'sociedad','contraparte_nombre','fecha','vto','moneda',
  'total','subtotal','iva_rate','iva_monto',
  'cuenta_contable','centro_costo','nro_comp','nota','origen_id'
];

// Stats
const totalRows = outputRows.length;
const resolved = outputRows.filter(r => r.sociedad !== '').length;
const blank    = outputRows.filter(r => r.sociedad === '').length;
const blankProviders = [...new Set(outputRows.filter(r => r.sociedad === '').map(r => r.contraparte_nombre))];

console.log('=== STATS ===');
console.log('Total output rows:', totalRows);
console.log('Sociedad resolved:', resolved);
console.log('Sociedad blank:   ', blank);
console.log('Providers with blank sociedad:');
blankProviders.forEach(p => console.log(' -', p));

// Write JSON for the formatter
fs.writeFileSync('C:/Users/lpini/AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/92cc0fbf-6e2f-49e2-afec-68b03cda2635/b7ab4f56-0f0f-4dda-bb71-e572c279eebf/skills/xlsx/bigg_data.json', JSON.stringify({ cols: COLS, rows: outputRows }));
console.log('Data written to bigg_data.json');
