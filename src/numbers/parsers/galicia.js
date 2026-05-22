import * as XLSX from "xlsx";

// Convierte serial de fecha Excel a YYYY-MM-DD (UTC-safe)
function excelDateToISO(serial) {
  const d = new Date((serial - 25569) * 86400 * 1000);
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

// Cabeceras esperadas del extracto Galicia (posiciones fijas)
const GALICIA_HEADERS = ["Fecha", "Descripción", "Débitos", "Créditos"];

export function isGaliciaFormat(rows) {
  if (!rows || rows.length < 2) return false;
  const h = rows[0];
  return GALICIA_HEADERS.every(col => h.some(c => String(c).trim() === col));
}

/**
 * Parsea un archivo .xlsx de extracto Galicia.
 * Retorna Promise<{ lineas, fuente, total }>
 * donde cada línea tiene: { idx, fecha, descripcion, debito, credito,
 *   monto (firmado), concepto, contraparte, cuit, banco, nroComp, saldo }
 */
export function parseGalicia(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb   = XLSX.read(e.target.result, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

        if (!isGaliciaFormat(rows)) {
          reject(new Error("El archivo no tiene el formato esperado de Galicia"));
          return;
        }

        const lineas = rows
          .slice(1)
          .filter(r => r[0] && typeof r[0] === "number")
          .map((r, idx) => {
            const debito  = Number(r[3]) || 0;
            const credito = Number(r[4]) || 0;
            return {
              idx,
              fecha:       excelDateToISO(r[0]),
              descripcion: String(r[1]  || ""),
              debito,
              credito,
              // Monto firmado: créditos positivos, débitos negativos
              monto:       credito > 0 ? credito : -debito,
              concepto:    String(r[6]  || ""),
              contraparte: String(r[10] || ""),
              cuit:        String(r[11] || ""),
              banco:       String(r[12] || ""),
              nroComp:     String(r[9]  || ""),
              saldo:       Number(r[15]) || 0,
              grupoConcepto: String(r[5] || ""),
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
// (sugerido auto-ignorar)
export function isBankFee(linea) {
  const g = linea.grupoConcepto.toLowerCase();
  return g.includes("impuesto") || g.includes("000901") || g.includes("000808");
}
