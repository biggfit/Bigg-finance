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
// dayFirst: en el caso AMBIGUO (ambos ≤12) interpreta D/M (bancos ES/AR: Caixa, Mercado Pago) en vez de
// M/D (Galicia, que baja US). Los casos inequívocos (un componente >12) se resuelven solos, sin depender del flag.
export function toISO(v, dayFirst = false) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return excelDateToISO(v);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    let mon, day;
    if (a > 12)        { day = a; mon = b; }   // 1º > 12 → D/M inequívoco
    else if (b > 12)   { mon = a; day = b; }   // 2º > 12 → M/D inequívoco
    else if (dayFirst) { day = a; mon = b; }   // ambiguo → D/M (ES/AR)
    else               { mon = a; day = b; }   // ambiguo → M/D (Galicia US)
    return `${y}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return s;
}

// Número robusto (compartido por los parsers): si ya es number lo devuelve; si es texto
// acepta formato AR/EU (miles con punto, decimal con coma) o formato con punto decimal. Vacío → 0.
// Contabilidad: un importe entre paréntesis es NEGATIVO (ej. Santander CSV: "(50.208,05)" = −50208,05).
export function num(v) {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim();
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }   // (123,45) → negativo
  const norm = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(norm.replace(/[^0-9.\-]/g, "")) || 0;
  return neg ? -Math.abs(n) : n;
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

// El .csv crudo del banco (";" + campos entre comillas, decimales con coma "605478,00") se parsea
// A MANO — NO con XLSX.read: su autodetección de tipos para CSV interpreta mal el decimal con coma
// (lee "605478,00" como 60547800, corriendo la coma en vez de tratarla como separador decimal — así
// quedó un ingreso 100× inflado en ago-2026) y autoconvierte la fecha a un serial propio, salteando
// nuestra lógica de D/M. Parseando el texto tal cual, todo pasa por num()/toISO() (ya hechos para
// AR) sin que SheetJS adivine de más. El .xlsx "procesado" sigue por XLSX.read sin cambios.
function parseCSVLine(line) {
  const cells = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ";") { cells.push(cur); cur = ""; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}
function parseCSVText(text) {
  return text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/).filter(l => l.length > 0).map(parseCSVLine);
}

/**
 * Parsea un extracto Galicia — .csv crudo del banco (texto, ";") o .xlsx/.xls procesado.
 * Retorna Promise<{ lineas, fuente, total }>.
 */
export function parseGalicia(file) {
  const esCSV = /\.csv$/i.test(file.name || "");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const rows = esCSV ? parseCSVText(e.target.result) : findExtractoRows(XLSX.read(e.target.result, { type: "array" }));
        if (!rows || !isGaliciaFormat(rows)) {
          reject(new Error("El archivo no tiene una hoja con formato de extracto Galicia"));
          return;
        }

        const lineas = rows
          .slice(1)
          .filter(r => esFecha(r[0]))
          .map((r, idx) => {
            const debito  = num(r[3]);
            const credito = num(r[4]);
            const concepto = String(r[6] || "");
            const grupoConcepto = String(r[5] || "");
            const codigoConcepto = (concepto.match(/\d{4,}/) || [""])[0];
            const grupoCodigo    = (grupoConcepto.match(/\d{4,}/) || [""])[0];
            return {
              idx,
              // El .csv crudo viene DD/MM/AAAA (día primero, como todo extracto AR); el .xlsx
              // procesado ya trae la fecha como serial de Excel → toISO la resuelve sin ambigüedad
              // y el flag no aplica.
              fecha:       toISO(r[0], esCSV),
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
              saldo:       num(r[15]),
            };
          });

        resolve({ lineas, fuente: "galicia", total: lineas.length });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Error al leer el archivo"));
    if (esCSV) reader.readAsText(file, "utf-8"); else reader.readAsArrayBuffer(file);
  });
}

// Detecta si una línea es probablemente un impuesto/comisión bancaria
export function isBankFee(linea) {
  const g = (linea.grupoConcepto || "").toLowerCase();
  return g.includes("impuesto") || g.includes("000901") || g.includes("000808");
}
