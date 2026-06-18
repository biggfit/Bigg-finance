// Parser de PDF de plan de pago AFIP/ARCA (y best-effort para otros) → cronograma de cuotas.
// Los PDF de AFIP son texto digital (no escaneados) → pdfjs extrae el texto de forma confiable.
// El resultado se vuelca en el editor de cuotas (editable) para que el usuario revise/corrija.
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const arNum = s => {
  if (s === "-" || s == null) return 0;
  const n = parseFloat(String(s).replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};
const toISO = d => { const m = String(d || "").match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };

// Extrae las líneas de texto del PDF, reconstruidas por coordenada Y (filas) y ordenadas por X.
// Genérico y reusable (lo usa también parsers/tarjetaPdf.js).
export async function extractLines(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map();   // y redondeado → items
    for (const it of tc.items) {
      const str = it.str;
      if (!str || !str.trim()) continue;
      const y = Math.round(it.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s: str });
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {  // PDF: Y crece hacia arriba
      const line = rows.get(y).sort((a, b) => a.x - b.x).map(o => o.s).join(" ").replace(/\s+/g, " ").trim();
      if (line) lines.push(line);
    }
  }
  await pdf.destroy?.();
  return lines;
}

// Monto AR en cualquiera de los dos formatos que mezcla ARCA en un mismo PDF:
//   con puntos de miles → "136.255,91"   ·   sin separador → "352809,37"
// (o un guión suelto = 0). El alternante con puntos va primero por ser el más específico.
const NUM_RE  = /-?\d{1,3}(?:\.\d{3})+,\d{2}|-?\d+,\d{2}|(?<![\d.,])-(?![\d])/g;
const DATE_RE = /(\d{2}\/\d{2}\/\d{4})/;

/**
 * Parsea un PDF de plan AFIP/ARCA. Devuelve { nro_plan, fecha_consolidacion, cuotas, formato }.
 * cuotas: [{ nro_cuota, vto, vto_tardio, capital, interes, iva, impuestos, interes_resarc, total, total_tardio }]
 * Formato ARCA: columnas Capital | Interés Financiero | Interés Resarcitorio | Total | Vto.
 * Cada cuota tiene 2 filas (vto normal / vto tardío con resarcitorio); la 2ª se adjunta a la 1ª.
 */
export async function parsePlanPdf(file) {
  const lines = await extractLines(file);
  const text  = lines.join("\n");
  const nro_plan = (text.match(/N[uú]mero de Plan[:\s]*([A-Za-z0-9.\-]+)/i) || [])[1] || "";
  const fecha_consolidacion = toISO((text.match(/Consolidaci[oó]n[:\s]*([0-9/]{8,10})/i) || [])[1] || "");

  const cuotas = [];
  for (const ln of lines) {
    if (!DATE_RE.test(ln)) continue;
    const date = ln.match(DATE_RE)[1];
    const nums = (ln.match(NUM_RE) || []).map(arNum);
    if (nums.length < 2) continue;
    const esPagoCuenta = /pago a cuenta/i.test(ln);
    const mCuota = ln.match(/^\s*(\d{1,3})\s+\d/);   // fila primaria: "Nº  capital…"
    if (esPagoCuenta || mCuota) {
      // Fila primaria ARCA: [capital, interés financiero, interés resarcitorio(=0), total]
      const capital = nums[0] || 0;
      const interes = nums.length >= 4 ? nums[1] : 0;
      const total   = nums[nums.length - 1] || round2(capital + interes);
      cuotas.push({
        nro_cuota: esPagoCuenta ? 0 : Number(mCuota[1]),
        vto: toISO(date), vto_tardio: "",
        capital, interes, iva: 0, impuestos: 0, interes_resarc: 0,
        total, total_tardio: 0,
      });
    } else if (cuotas.length) {
      // Fila secundaria (vto tardío): [interés financiero, interés resarcitorio, total] → adjuntar a la previa
      const prev = cuotas[cuotas.length - 1];
      if (prev.vto_tardio) continue;             // ya tiene su tardío
      prev.vto_tardio     = toISO(date);
      prev.interes_resarc = nums.length >= 2 ? nums[nums.length - 2] : 0;
      prev.total_tardio   = nums[nums.length - 1] || 0;
    }
  }
  // Solo confiamos en el parseo si el PDF es un plan AFIP/ARCA (este parser está tuneado a ese
  // layout). Si no lo reconocemos, devolvemos cuotas vacías → el usuario carga manual / generador,
  // en vez de auto-rellenar con filas heurísticas posiblemente erróneas (ej. PDF de banco).
  const esArca = /ARCA|AFIP|Mis Facilidades|N[uú]mero de Plan/i.test(text);
  return { nro_plan, fecha_consolidacion, cuotas: esArca ? cuotas : [], formato: esArca ? "arca" : "generico" };
}
