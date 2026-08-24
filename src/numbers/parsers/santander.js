import * as XLSX from "xlsx";
import { toISO, num } from "./galicia";   // fecha + número robusto (compartidos entre parsers)

// Extracto Santander ("Últimos Movimientos"). Header típico:
//   Fecha | Suc. Origen | Desc. Sucursal | Cod. Operativo | Referencia | Concepto | Importe | Saldo
// El header NO está en la primera fila (arriba hay título + nº de cuenta). Formato AR: fecha DD/MM/YYYY
// e Importe firmado con débito ENTRE PARÉNTESIS y miles/decimal es-AR (ej. "(50.208,05)" = −50208,05).
//
// CLAVE — el CSV NO se parsea con XLSX: XLSX reinterpreta "50.208,05" como 50.208 (punto = decimal US) y
// la fecha "03/08/2026" como un serial equivocado (46088 → "3/7/26"). Se rompen números Y fechas. Por eso
// el CSV se parte como texto plano (delimitado por ";") y las celdas quedan como el string original;
// num() (galicia) entiende paréntesis + es-AR, y toISO(dayFirst) evita invertir día/mes.
// El .xlsx (guarda números/fechas nativos) sí se lee con XLSX.

const SANTANDER_HEADERS = ["Fecha", "Concepto", "Importe", "Saldo"];
const idxOf = (h, name) => h.findIndex(c => String(c).trim().toLowerCase() === name.toLowerCase());
const esHeader = (r) => Array.isArray(r) && SANTANDER_HEADERS.every(col => r.some(c => String(c).trim().toLowerCase() === col.toLowerCase()));
const esFecha = v => typeof v === "number"
  || /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(String(v).trim())
  || /^\d{4}-\d{2}-\d{2}/.test(String(v).trim());

export function isSantanderFormat(rows) {
  return Array.isArray(rows) && rows.some(esHeader);
}

// CSV es-AR: delimitado por ";" (la "," es decimal, no separador). Cada celda queda como string crudo.
function rowsFromCsv(text) {
  const delim = text.includes(";") ? ";" : ",";
  return text.split(/\r?\n/).map(l => l.split(delim).map(c => c.trim().replace(/^"|"$/g, "")));
}

// .xlsx: busca entre las hojas la que tiene el header. raw:false → texto formateado (por las dudas del
// número es-AR); en un xlsx real las fechas ya son serial y toISO las resuelve por número.
function rowsFromXlsx(wb) {
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false });
    if (rows.some(esHeader)) return rows;
  }
  return null;
}

/**
 * Parsea un extracto Santander (.csv o .xlsx). Retorna Promise<{ lineas, fuente, total }>
 * con el mismo formato de línea que parseGalicia (para clasificarLineas / ingestarExtracto).
 */
export function parseSantander(file) {
  return new Promise((resolve, reject) => {
    const esCsv = /\.csv$/i.test(file?.name || "");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let rows;
        if (esCsv) {
          // Santander AR exporta en Latin-1 (windows-1252) → decodificar así preserva los acentos.
          const text = new TextDecoder("windows-1252").decode(new Uint8Array(e.target.result));
          rows = rowsFromCsv(text);
        } else {
          rows = rowsFromXlsx(XLSX.read(e.target.result, { type: "array" }));
        }
        if (!rows) {
          reject(new Error("El archivo no tiene formato de extracto Santander (Fecha/Concepto/Importe/Saldo)"));
          return;
        }
        const headerIdx = rows.findIndex(esHeader);
        if (headerIdx < 0) {
          reject(new Error("El archivo no tiene formato de extracto Santander (Fecha/Concepto/Importe/Saldo)"));
          return;
        }
        const header = rows[headerIdx];
        const iF   = idxOf(header, "Fecha");
        const iCon = idxOf(header, "Concepto");
        const iImp = idxOf(header, "Importe");
        const iSal = idxOf(header, "Saldo");
        const iCod = idxOf(header, "Cod. Operativo");
        const iRef = idxOf(header, "Referencia");

        const lineas = rows
          .slice(headerIdx + 1)
          // Fila válida = tiene fecha Y concepto. Descarta el pie con el timestamp de
          // generación (fecha+hora, resto vacío) y las filas en blanco.
          .filter(r => esFecha(r[iF]) && String(r[iCon] ?? "").trim() !== "")
          .map((r, idx) => {
            const importe  = num(r[iImp]);                 // con signo: − débito (paréntesis) / + crédito
            const concepto = String(r[iCon] || "").trim();
            const cuit     = (concepto.match(/\b\d{11}\b/) || [""])[0];   // CUIT embebido en la glosa (si hay)
            return {
              idx,
              fecha:        toISO(r[iF], true),   // AR: DD/MM/YYYY (dayFirst)
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
