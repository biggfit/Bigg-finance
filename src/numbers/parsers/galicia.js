import * as XLSX from "xlsx";

// Convierte serial de fecha Excel a YYYY-MM-DD (UTC-safe).
// El banco exporta fecha-sola pero con fracción horaria (ej. 46145.9994 = 23:59:08,
// ~52s antes de medianoche) → redondeamos al día para no caer al día anterior.
export function excelDateToISO(serial) {
  const d = new Date((Math.round(serial) - 25569) * 86400 * 1000);
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

// Normaliza una fecha del extracto a YYYY-MM-DD.
// El crudo del banco la trae como TEXTO "M/D/AA" (ej "5/31/26"); los procesados
// a veces como serial Excel. Maneja ambos.
export function toISO(v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return excelDateToISO(v);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    // Si el 1º > 12 es D/M; si el 2º > 12 es M/D; ambiguo → M/D (como baja del banco)
    let mon, day;
    if (a > 12) { day = a; mon = b; }
    else        { mon = a; day = b; }
    return `${y}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return s;
}

// Cabeceras esperadas del extracto Galicia
const GALICIA_HEADERS = ["Fecha", "Descripción", "Débitos", "Créditos"];

export function isGaliciaFormat(rows) {
  if (!rows || rows.length < 2) return false;
  const h = rows[0];
  return GALICIA_HEADERS.every(col => h.some(c => String(c).trim() === col));
}

// Busca, entre todas las hojas del workbook, la que tiene el formato del extracto
// (sirve para el archivo crudo de 1 hoja y para los workbooks procesados multi-hoja).
function findExtractoRows(wb) {
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    if (isGaliciaFormat(rows)) return rows;
  }
  return null;
}

const esFecha = v => typeof v === "number" || /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(String(v).trim()) || /^\d{4}-\d{2}-\d{2}/.test(String(v).trim());

/**
 * Parsea un archivo .xlsx de extracto Galicia (crudo del banco o procesado).
 * Retorna Promise<{ lineas, fuente, total }>.
 */
export function parseGalicia(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const rows = findExtractoRows(wb);
        if (!rows) {
          reject(new Error("El archivo no tiene una hoja con formato de extracto Galicia"));
          return;
        }

        const lineas = rows
          .slice(1)
          .filter(r => esFecha(r[0]))
          .map((r, idx) => {
            const debito  = Number(r[3]) || 0;
            const credito = Number(r[4]) || 0;
            const concepto = String(r[6] || "");
            const grupoConcepto = String(r[5] || "");
            const codigoConcepto = (concepto.match(/\d{4,}/) || [""])[0];
            const grupoCodigo    = (grupoConcepto.match(/\d{4,}/) || [""])[0];
            return {
              idx,
              fecha:       toISO(r[0]),
              descripcion: String(r[1]  || ""),
              debito,
              credito,
              monto:       credito > 0 ? credito : -debito,
              concepto,
              codigoConcepto,
              grupoConcepto,
              grupoCodigo,
              ley1:        String(r[10] || ""),
              ley2:        String(r[11] || ""),
              ley3:        String(r[12] || ""),
              ley4:        String(r[13] || ""),
              contraparte: String(r[10] || ""),
              cuit:        String(r[11] || ""),
              banco:       String(r[12] || ""),
              nroComp:     String(r[9]  || ""),
              saldo:       Number(r[15]) || 0,
            };
          });

        resolve({ lineas, fuente: "galicia", total: lineas.length });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Error al leer el archivo"));
    reader.readAsArrayBuffer(file);
  });
}

// Detecta si una línea es probablemente un impuesto/comisión bancaria
export function isBankFee(linea) {
  const g = (linea.grupoConcepto || "").toLowerCase();
  return g.includes("impuesto") || g.includes("000901") || g.includes("000808");
}
