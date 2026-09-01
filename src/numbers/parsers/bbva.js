import * as XLSX from "xlsx";
import { toISO, num } from "./galicia";

// Extracto BBVA Colombia (Tigre Loco, COP). Cabecera real del banco:
//   FECHA VALOR, CONCEPTO, IMPORTE (COP), SALDO (COP)
// …con el sufijo de moneda opcional: hay export del mismo banco que titula la última columna
// simplemente "Saldo" (ver normH).
// El archivo de trabajo puede traer una hoja por mes (ej. JUN26/JUL26/AGO26) y columnas
// propias de seguimiento a la derecha (ej. ROSALES/PQ 93 = split manual de sede) → se
// ignoran, solo se toman las 4 columnas del banco. Todas las hojas con ese formato se
// concatenan en un solo resultado.
// CONCEPTO viene truncado por el banco (~16-20 caracteres) → el match de reglas es por
// substring, no por texto completo. Sin NIT de contraparte en el extracto (a diferencia
// de Galicia). Fecha DD-MM-AAAA (Colombia = día primero, como Caixa).
// Identidad de dedup = SALDO (COP), igual criterio que Galicia/Caixa (ver ingestarExtracto).

// El sufijo de moneda entre paréntesis es OPCIONAL: el mismo banco/cuenta exporta a veces
// "IMPORTE (COP)" / "SALDO (COP)" y a veces solo "Importe" / "Saldo". Comparar contra el nombre
// con sufijo hacía que el archivo no se reconociera y la carga se rechazara entera, aunque las
// 4 columnas estuvieran ahí. Por eso el header se normaliza sin el paréntesis final.
const BBVA_REQ = ["FECHA VALOR", "CONCEPTO", "IMPORTE", "SALDO"];

// trim + mayúsculas + espacios colapsados + sin sufijo "(COP)"/"(USD)"/… al final.
const normH = (c) => String(c).trim().toUpperCase().replace(/\s+/g, " ").replace(/\s*\([^)]*\)$/, "");

function findHeaderIdx(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = (rows[i] || []).map(normH);
    if (BBVA_REQ.every(col => h.includes(col))) return i;
  }
  return -1;
}

export function isBBVAFormat(rows) {
  return findHeaderIdx(rows) >= 0;
}

/** Parsea un .xlsx de extracto BBVA Colombia (una o varias hojas). Retorna Promise<{ lineas, fuente, total }>. */
export function parseBBVA(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const lineas = [];
        for (const name of wb.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
          const hi = findHeaderIdx(rows);
          if (hi < 0) continue;
          const H = rows[hi].map(normH);
          const col = (n) => H.indexOf(n);
          const ci = { fecha: col("FECHA VALOR"), concepto: col("CONCEPTO"), importe: col("IMPORTE"), saldo: col("SALDO") };

          rows.slice(hi + 1)
            .filter(r => String(r[ci.fecha] ?? "").trim() !== "" && /\d/.test(String(r[ci.importe] ?? "")))
            .forEach(r => {
              const concepto = String(r[ci.concepto] || "").trim();
              lineas.push({
                idx: lineas.length,
                fecha:          toISO(r[ci.fecha], true),   // BBVA CO = D/M
                descripcion:    concepto,
                monto:          num(r[ci.importe]),
                ley1:           concepto,
                contraparte:    concepto,
                ley2: "", ley3: "", ley4: "", cuit: "",
                codigoConcepto: "",
                saldo:          num(r[ci.saldo]),   // identidad estable → dedup (extracto_saldo)
              });
            });
        }
        if (!lineas.length) {
          reject(new Error("El archivo no tiene una hoja con formato de extracto BBVA (Fecha valor/Concepto/Importe/Saldo)"));
          return;
        }
        resolve({ lineas, fuente: "bbva", total: lineas.length });
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error("Error al leer el archivo"));
    reader.readAsArrayBuffer(file);
  });
}
