import * as XLSX from "xlsx";
import { toISO, num } from "./galicia";   // fecha + número robusto (compartidos entre parsers)

// Extracto Santander ("Últimos Movimientos"). Header típico:
//   Fecha | Suc. Origen | Desc. Sucursal | Cod. Operativo | Referencia | Concepto | Importe | Saldo
// El header NO está en la primera fila (arriba hay título + nº de cuenta), y el Importe viene
// con signo (− débito / + crédito). Mapeamos por posición de columna según el header (robusto
// ante columnas de más o reordenadas).

const SANTANDER_HEADERS = ["Fecha", "Concepto", "Importe", "Saldo"];
const idxOf = (h, name) => h.findIndex(c => String(c).trim().toLowerCase() === name.toLowerCase());
const esHeader = (r) => Array.isArray(r) && SANTANDER_HEADERS.every(col => r.some(c => String(c).trim().toLowerCase() === col.toLowerCase()));
const esFecha = v => typeof v === "number"
  || /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(String(v).trim())
  || /^\d{4}-\d{2}-\d{2}/.test(String(v).trim());

export function isSantanderFormat(rows) {
  return Array.isArray(rows) && rows.some(esHeader);
}

// Busca, entre todas las hojas, la que tiene el header del extracto Santander.
function findExtracto(wb) {
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    const headerIdx = rows.findIndex(esHeader);
    if (headerIdx >= 0) return { rows, headerIdx, header: rows[headerIdx] };
  }
  return null;
}

/**
 * Parsea un .xlsx de extracto Santander. Retorna Promise<{ lineas, fuente, total }>
 * con el mismo formato de línea que parseGalicia (para clasificarLineas / ingestarExtracto).
 */
export function parseSantander(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const found = findExtracto(wb);
        if (!found) {
          reject(new Error("El archivo no tiene una hoja con formato de extracto Santander (Fecha/Concepto/Importe/Saldo)"));
          return;
        }
        const { rows, headerIdx, header } = found;
        const iF   = idxOf(header, "Fecha");
        const iCon = idxOf(header, "Concepto");
        const iImp = idxOf(header, "Importe");
        const iSal = idxOf(header, "Saldo");
        const iCod = idxOf(header, "Cod. Operativo");
        const iRef = idxOf(header, "Referencia");

        const lineas = rows
          .slice(headerIdx + 1)
          // Fila válida = tiene fecha Y concepto. Descarta el pie con el timestamp de
          // generación (serial en Fecha, resto vacío) y las filas en blanco.
          .filter(r => esFecha(r[iF]) && String(r[iCon] ?? "").trim() !== "")
          .map((r, idx) => {
            const importe  = num(r[iImp]);                 // con signo: − débito / + crédito
            const concepto = String(r[iCon] || "").trim();
            const cuit     = (concepto.match(/\b\d{11}\b/) || [""])[0];   // CUIT embebido en la glosa (si hay)
            return {
              idx,
              fecha:        toISO(r[iF]),
              descripcion:  concepto,
              debito:       importe < 0 ? -importe : 0,
              credito:      importe > 0 ?  importe : 0,
              monto:        importe,
              concepto,
              codigoConcepto: iCod >= 0 ? String(r[iCod] ?? "").trim() : "",
              grupoConcepto:  "",
              grupoCodigo:    "",
              ley1: "", ley2: "", ley3: "", ley4: "",
              contraparte:  "",
              cuit,
              banco:        "",
              nroComp:      iRef >= 0 ? String(r[iRef] ?? "").trim() : "",
              saldo:        num(r[iSal]),
            };
          });

        resolve({ lineas, fuente: "santander", total: lineas.length });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Error al leer el archivo"));
    reader.readAsArrayBuffer(file);
  });
}
