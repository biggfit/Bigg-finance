import * as XLSX from "xlsx";
import { toISO, num } from "./galicia";   // fecha + número robusto (compartidos entre parsers)

const norm = s => String(s ?? "").trim().toLowerCase();

// Columnas esperadas de la hoja depurada "Resumen para importar".
const COLS = {
  fecha:        ["fecha"],
  descripcion:  ["descripcion", "descripción"],
  monto:        ["monto"],
  saldo:        ["saldo"],
  contraparte:  ["contraparte"],
  cuit:         ["cuit"],
  tipo:         ["tipo"],
  cuenta:       ["cuenta"],
  centro_costo: ["centro_costo", "centro de costo", "centro"],
  nota:         ["nota"],
  iva_rate:     ["iva_rate", "iva rate", "alicuota iva"],
  iva_monto:    ["iva_monto", "iva monto", "iva"],
  nro_operacion:["nro_operacion", "nro operacion", "nro operación", "operacion", "operación", "id operacion", "nro_op", "op", "id de operacion"],
};

// Fila de encabezado dentro de una hoja (fecha + monto + tipo). -1 si no la tiene.
function headerRowOf(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const hdr = rows[i].map(norm);
    const has = k => COLS[k].some(alias => hdr.includes(alias));
    if (has("fecha") && has("monto") && has("tipo")) return i;
  }
  return -1;
}

// Escaneo de respaldo: recorre todas las hojas (para un archivo depurado suelto sin la hoja
// "Resumen para importar" nombrada). No se usa en el camino rápido.
function findHeaderAll(wb) {
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    const hr = headerRowOf(rows);
    if (hr >= 0) return { rows, headerRow: hr };
  }
  return null;
}

// Mapea cada columna lógica a su índice según el header (tolera orden y sinónimos).
function colIndex(hdr) {
  const idx = {};
  for (const key of Object.keys(COLS)) {
    idx[key] = hdr.findIndex(h => COLS[key].includes(h));
  }
  return idx;
}

/**
 * Parsea el .xlsx depurado de Mercado Pago (hoja "Resumen para importar").
 * Devuelve Promise<{ lineas, fuente, total }>. Cada línea trae los NOMBRES legibles de
 * cuenta/centro (la resolución a id la hace el importador contra los maestros vivos).
 */
export function parseMercadoPago(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buf = e.target.result;
        // Paso 1 (barato): solo los nombres de hoja, sin parsear celdas. Ubica "Resumen para
        // importar" para NO gastar tiempo/memoria leyendo las bases grandes del workbook completo.
        const names = XLSX.read(buf, { type: "array", bookSheets: true }).SheetNames || [];
        const target = names.find(n => /import/i.test(n) && /resumen/i.test(n));
        // Paso 2: parsear SOLO esa hoja. Si no se identifica por nombre (archivo depurado suelto
        // con otro nombre de pestaña), cae a leer todo y escanear.
        let found;
        if (target) {
          const wb = XLSX.read(buf, { type: "array", sheets: target });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[target], { header: 1, defval: "" });
          const hr = headerRowOf(rows);
          found = hr >= 0 ? { rows, headerRow: hr } : null;
        } else {
          found = findHeaderAll(XLSX.read(buf, { type: "array" }));
        }
        if (!found) { reject(new Error("No encontré la hoja 'Resumen para importar' con columnas fecha/monto/tipo")); return; }
        const { rows, headerRow } = found;
        const hdr = rows[headerRow].map(norm);
        const ci = colIndex(hdr);
        const cell = (r, k) => (ci[k] >= 0 ? r[ci[k]] : "");

        const lineas = rows
          .slice(headerRow + 1)
          .filter(r => cell(r, "fecha") !== "" && cell(r, "tipo") !== "")
          .map((r, idx) => ({
            idx,
            fecha:        toISO(cell(r, "fecha")),
            descripcion:  String(cell(r, "descripcion") || ""),
            monto:        num(cell(r, "monto")),
            saldo:        cell(r, "saldo") === "" ? "" : num(cell(r, "saldo")),
            contraparte:  String(cell(r, "contraparte") || ""),
            cuit:         String(cell(r, "cuit") || ""),
            tipo:         norm(cell(r, "tipo")),
            cuentaNombre: String(cell(r, "cuenta") || "").trim(),
            centroNombre: String(cell(r, "centro_costo") || "").trim(),
            nota:         String(cell(r, "nota") || ""),
            iva_rate:     num(cell(r, "iva_rate")),
            iva_monto:    num(cell(r, "iva_monto")),
            nro_operacion: String(cell(r, "nro_operacion") || "").trim(),
          }));

        resolve({ lineas, fuente: "mercadopago", total: lineas.length });
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error("Error al leer el archivo"));
    reader.readAsArrayBuffer(file);
  });
}
