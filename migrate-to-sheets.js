/**
 * migrate-to-sheets.js
 *
 * Exporta REAL_COMPROBANTES y REAL_SALDO_INICIAL al formato CSV
 * listo para importar a Google Sheets.
 *
 * Uso:
 *   node migrate-to-sheets.js
 *
 * Genera:
 *   migration_comprobantes.csv  → pegar en la tab "comprobantes"
 *   migration_saldos.csv        → pegar en la tab "saldos"
 *
 * Columnas de comprobantes (en este orden):
 *   frId | id | type | fecha_emision | currency | amountNeto | amountIVA | amount | invoice | nota | ref | loteId
 */

import { writeFileSync } from 'fs';
import { REAL_COMPROBANTES } from './src/data/comprobantes.js';
import { REAL_SALDO_INICIAL } from './src/data/saldos.js';
import { REAL_FRANCHISES } from './src/data/franchises.js';
import { DEFAULT_FRANCHISOR } from './src/data/franchisor.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convierte "DD/MM/YYYY" → "YYYY-MM-DD". Devuelve "" si la fecha es inválida. */
function toIsoDate(ddmmyyyy) {
  if (!ddmmyyyy) return '';
  const parts = String(ddmmyyyy).split('/');
  if (parts.length !== 3) return '';
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return '';
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

/** Escapa un valor para CSV: lo envuelve en comillas si tiene coma, comilla o salto de línea. */
function csvCell(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Genera una fila CSV a partir de un array de valores. */
function csvRow(values) {
  return values.map(csvCell).join(',');
}

// ── Comprobantes ─────────────────────────────────────────────────────────────

const COMP_HEADERS = [
  'frId', 'id', 'type', 'fecha_emision',
  'currency', 'amountNeto', 'amountIVA', 'amount',
  'invoice', 'nota', 'ref', 'loteId',
];

const compRows = [csvRow(COMP_HEADERS)];

for (const [frId, comps] of Object.entries(REAL_COMPROBANTES)) {
  for (const c of comps) {
    const row = [
      frId,
      c.id       ?? '',
      c.type     ?? '',
      toIsoDate(c.date),                             // date DD/MM/YYYY → YYYY-MM-DD
      c.currency ?? '',
      c.amountNeto !== undefined ? c.amountNeto : '',
      c.amountIVA  !== undefined ? c.amountIVA  : '',
      c.amount   ?? 0,
      c.invoice  ?? '',
      c.nota     ?? '',
      c.ref      ?? '',
      c.loteId   ?? '',
    ];
    compRows.push(csvRow(row));
  }
}

writeFileSync('migration_comprobantes.csv', compRows.join('\n'), 'utf8');
console.log(`✅  migration_comprobantes.csv  (${compRows.length - 1} comprobantes)`);

// ── Saldos ───────────────────────────────────────────────────────────────────

const SALDO_HEADERS = ['frId', 'amount'];

const saldoRows = [csvRow(SALDO_HEADERS)];

for (const [frId, amount] of Object.entries(REAL_SALDO_INICIAL)) {
  saldoRows.push(csvRow([frId, amount]));
}

writeFileSync('migration_saldos.csv', saldoRows.join('\n'), 'utf8');
console.log(`✅  migration_saldos.csv        (${saldoRows.length - 1} saldos)`);

// ── Franchises ────────────────────────────────────────────────────────────────

// Extraer todos los campos posibles del array (unión de keys de todas las franquicias)
const allFrKeys = Array.from(
  REAL_FRANCHISES.reduce((set, f) => { Object.keys(f).forEach(k => set.add(k)); return set; }, new Set())
);

// Ordenar: id y name primero (identificadores clave), luego activa, country, moneda/currency, y el resto
const ID_FIRST = ['id', 'name', 'activa', 'country', 'moneda', 'currency', 'sociedad'];
const FR_HEADERS = [
  ...ID_FIRST,
  ...allFrKeys.filter(k => !ID_FIRST.includes(k)),
];

const frRows = [csvRow(FR_HEADERS)];
for (const f of REAL_FRANCHISES) {
  frRows.push(csvRow(FR_HEADERS.map(h => f[h] ?? '')));
}

writeFileSync('migration_franchises.csv', frRows.join('\n'), 'utf8');
console.log(`✅  migration_franchises.csv    (${frRows.length - 1} franquicias)`);

// ── Franchisor ────────────────────────────────────────────────────────────────

// Schema combinado: una fila por "side" (ar / usa), con todos los campos de ambos
const FR_ISOR_HEADERS = [
  'side', 'name',
  // AR
  'razonSocial', 'cuit', 'condIVA', 'domicilio', 'localidad', 'provincia', 'cp',
  'telefono', 'email', 'puntoVenta', 'banco', 'cbu', 'alias',
  // USA
  'legalName', 'ein', 'address', 'city', 'state', 'zip', 'country',
  'bankName', 'routingNumber', 'accountNumber', 'swift',
  // Común
  'notaPie',
];

const ar  = DEFAULT_FRANCHISOR.ar;
const usa = DEFAULT_FRANCHISOR.usa;

const franchisorRows = [
  csvRow(FR_ISOR_HEADERS),
  csvRow(FR_ISOR_HEADERS.map(h => {
    if (h === 'side') return 'ar';
    if (h === 'name') return ar.razonSocial ?? '';
    return ar[h] ?? '';
  })),
  csvRow(FR_ISOR_HEADERS.map(h => {
    if (h === 'side') return 'usa';
    if (h === 'name') return usa.legalName ?? '';
    return usa[h] ?? '';
  })),
];

writeFileSync('migration_franchisor.csv', franchisorRows.join('\n'), 'utf8');
console.log(`✅  migration_franchisor.csv    (2 franquiciantes: ar, usa)`);

console.log('\nPróximos pasos:');
console.log('  1. Abrí tu Google Sheet');
console.log('  2. En la tab "comprobantes": Archivo → Importar → Subir migration_comprobantes.csv');
console.log('     Elegí "Reemplazar hoja actual" y separador "Coma"');
console.log('  3. En la tab "saldos": igual con migration_saldos.csv');
console.log('  4. Creá una tab nueva "franchises" e importá migration_franchises.csv');
console.log('  5. Creá una tab nueva "franchisor" e importá migration_franchisor.csv');
console.log('  6. Verificá que la fila 1 de cada tab tenga los headers correctos');
console.log('  7. Borrá los archivos CSV locales cuando estés listo\n');
