import * as XLSX from "xlsx";
import { toISO, num } from "./galicia";

// Extracto CaixaBank (Gestión Deportiva y Wellness, EUR). Cabecera:
//   Fecha, Fecha valor, Movimiento, Más datos, Importe, Saldo
// La contraparte cae a veces en "Movimiento" (NABALIA, PROSEGUR…) y a veces en "Más datos"
// (STRIPE, Comercia Global Payments, Princesa Fit…) → la glosa = "Movimiento · Más datos".
// Importe con signo (+ ingreso / − gasto). No trae código de concepto ni CIF → match por glosa.
// Identidad estable de cada línea = el SALDO corriente (como Galicia) → dedup en extracto_saldo.

const CAIXA_REQ = ["Movimiento", "Más datos", "Importe", "Saldo"];

// La cabecera puede no estar en la fila 0 (Caixa antepone 1-2 filas de título) → se busca.
function findHeaderIdx(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = (rows[i] || []).map(c => String(c).trim());
    if (CAIXA_REQ.every(col => h.includes(col))) return i;
  }
  return -1;
}

export function isCaixaFormat(rows) {
  return findHeaderIdx(rows) >= 0;
}

/** Parsea un .xls/.xlsx de extracto Caixa. Retorna Promise<{ lineas, fuente, total }>. */
export function parseCaixa(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        let rows = null, hi = -1;
        for (const name of wb.SheetNames) {
          const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
          const idx = findHeaderIdx(r);
          if (idx >= 0) { rows = r; hi = idx; break; }
        }
        if (!rows) {
          reject(new Error("El archivo no tiene formato de extracto Caixa (Fecha/Movimiento/Importe/Saldo)"));
          return;
        }
        const H = rows[hi].map(c => String(c).trim());
        const col = (n) => H.indexOf(n);
        const ci = { fecha: col("Fecha"), mov: col("Movimiento"), mas: col("Más datos"), imp: col("Importe"), saldo: col("Saldo") };

        const lineas = rows.slice(hi + 1)
          .filter(r => String(r[ci.fecha] ?? "").trim() !== "" && /\d/.test(String(r[ci.imp] ?? "")))
          .map((r, idx) => {
            const mov = String(r[ci.mov] || "").trim();   // ej "NABALIA ENERGIA 2" / "ON 357132059 2906"
            const mas = String(r[ci.mas] || "").trim();   // ej "Recibo de suministros" / "Comercia Global Payments"
            return {
              idx,
              fecha:          toISO(r[ci.fecha], true),   // Caixa (ES) = D/M
              descripcion:    mas ? `${mov} · ${mas}` : mov,   // glosa completa (matchea por Movimiento o Más datos)
              monto:          num(r[ci.imp]),
              ley1:           mas || mov,
              contraparte:    mas || mov,
              ley2: "", ley3: "", ley4: "", cuit: "",
              codigoConcepto: "",
              saldo:          num(r[ci.saldo]),   // identidad estable → dedup (extracto_saldo)
            };
          });

        resolve({ lineas, fuente: "caixa", total: lineas.length });
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error("Error al leer el archivo"));
    reader.readAsArrayBuffer(file);
  });
}
