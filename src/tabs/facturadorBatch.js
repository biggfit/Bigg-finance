// ─── Helpers compartidos de los lotes del Facturador (fee desde CRM, CRM WhatsApp) ─────────
// Lo que antes vivía dentro de ModoCRM y que el lote de WhatsApp necesita igual: a qué sociedad
// factura cada país, en qué moneda, el TC de Maestros, y sobre todo el ciclo emitir → guardar →
// confirmar dudosos releyendo la hoja. Una sola copia para que las dos pantallas no diverjan.
import { COMPANIES } from "../lib/helpers";
import { emitirComprobante, invoiceFromResult } from "../lib/facturanteApi";
import { getNextInvoiceNum, fetchComps } from "../lib/sheetsApi";

// ── Importe formateado estilo AR ("1.234.567,89") ──────────────────────────
export function formatCurrencyInput(raw) {
  const digits = String(raw ?? "").replace(/[^\d,]/g, "");
  const [intPart, decPart] = digits.split(",");
  const intFormatted = (intPart ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (digits.includes(",")) return `${intFormatted},${(decPart ?? "").slice(0, 2)}`;
  return intFormatted;
}
export function parseCurrencyInput(formatted) {
  if (!formatted) return 0;
  return parseFloat(String(formatted).replace(/\./g, "").replace(",", ".")) || 0;
}
export const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

export const getInvoicePrefix = (activeCompany) =>
  COMPANIES[activeCompany]?.side === "es" ? "ESP" : "USA";

// TC por país: moneda local → USD. Estas son las monedas locales de los países LATAM.
// Sin valores por defecto a propósito: el TC sale de Maestros o no se factura. Un default
// hardcodeado acá es un TC viejo esperando a que alguien facture con él sin darse cuenta.
export const COUNTRY_CURRENCY = {
  "Paraguay":   { code: "PYG", label: "Guaraní",    sym: "₲",   tcField: "pygUSD" },
  "Chile":      { code: "CLP", label: "Peso CLP",   sym: "CL$", tcField: "clpUSD" },
  "Perú":       { code: "PEN", label: "Sol",        sym: "S/",  tcField: "penUSD" },
  "Panamá":     { code: "USD", label: "USD",        sym: "U$D", tcField: null     },
  "España":     { code: "EUR", label: "Euro",       sym: "€",   tcField: "eurUSD" },
  "Portugal":   { code: "EUR", label: "Euro",       sym: "€",   tcField: "eurUSD" },
  "Uruguay":    { code: "UYU", label: "Peso UYU",   sym: "U$",  tcField: "uyuUSD" },
  "Argentina":  { code: "ARS", label: "Peso ARS",   sym: "$",   tcField: null     },
};
export function getCountryCur(country) {
  return COUNTRY_CURRENCY[country] ?? { code: "USD", label: "USD", sym: "U$D", tcField: null };
}
/** Tasa local→USD guardada en tiposCambio para el mes dado (0-11), o null si falta. */
export function getTcRate(country, tiposCambio, year, month) {
  const cc = getCountryCur(country);
  if (!cc.tcField) return null; // USD/ARS no necesitan TC
  const key = `${year}-${String(month + 1).padStart(2, "0")}`;
  const tc  = tiposCambio[key];
  return tc?.[cc.tcField] > 0 ? tc[cc.tcField] : null;
}

// Los lotes facturan según el PAÍS de la sede (AR → ÑAKO, país EUR → la sociedad de España,
// resto → BIGG FIT LLC), nunca según las monedas habilitadas de la sede (esas son para
// comprobantes manuales tipo Pauta).
export function empresaEmisoraPorPais(country) {
  if (country === "Argentina") return "ÑAKO SRL";
  return getCountryCur(country).code === "EUR" ? "Gestión Deportiva y Wellness SL" : "BIGG FIT LLC";
}
export function monedaFacturacionPorPais(country) {
  if (country === "Argentina") return "ARS";
  return getCountryCur(country).code === "EUR" ? "EUR" : "USD";
}

// ── Lote CRM WhatsApp ───────────────────────────────────────────────────────
// IVA por sociedad emisora para FACTURA|CRM. Wellness en false para tratarlo igual que el fee actual
// (que sale sin IVA aunque la sociedad aplica IVA). Cambiar acá cuando Contabilidad lo defina.
export const CRM_WA_APLICA_IVA = { "ÑAKO SRL": true, "BIGG FIT LLC": false, "Gestión Deportiva y Wellness SL": false };

// Subtítulo del lote (lo muestra el encabezado del Facturador, al lado del título del modo).
export function subtituloCrmWhatsapp(activeCompany) {
  const cur = COMPANIES[activeCompany]?.currency ?? "USD";
  return `Costo en USD por sede → factura en ${cur} (${activeCompany})`
       + (cur === "ARS" ? " al TC oficial" : "")
       + (CRM_WA_APLICA_IVA[activeCompany] ? " + IVA 21%" : ", sin IVA")
       + " · aparte del fee";
}

/**
 * Emite y guarda un lote de comprobantes ya armados.
 * items: [{ fr, comp, meta, sinEmision }] — `comp` viene completo del caller (type, amount, neto/IVA,
 *   currency, empresa, date, month, year, ref, nota, applyIVA); `meta` se copia tal cual al log;
 *   `sinEmision` = asiento de gestión (sede propia): se guarda sin ARCA ni correlativo.
 * Devuelve log: [{ ...meta, invoice, facturanteStatus }]. Los estados son los mismos strings de
 * siempre: "ok" | "sin_numero_afip" | "ERROR: …" | "invoice_ok" | "sin_invoice: …" | "omitido" |
 * "gestion" | "verificando…" → "guardado (…)" | "GUARDADO_FALLIDO (…)" | "VERIFICAR (…)".
 *
 * Una escritura rechazada NO significa que la fila no se haya guardado: el POST puede llegar al
 * Apps Script, escribirse, y perderse la respuesta (timeout del proxy). Se anota como dudosa y se
 * confirma al final releyendo la hoja: dar por fallida una que sí entró es lo que lleva a cargarla
 * a mano y terminar con la factura duplicada.
 */
export async function emitirLote({ items, franchisor, activeCompany, onAddComp, skipFacturante = false, setBatchProg = () => {} }) {
  const log = [];
  const dudosos = [];
  const total = items.length;
  setBatchProg({ current: 0, total, name: "" });
  for (let idx = 0; idx < items.length; idx++) {
    const { fr, meta = {}, sinEmision = false } = items[idx];
    let comp = items[idx].comp;
    setBatchProg({ current: idx + 1, total, name: fr.name });
    const isAR = fr.country === "Argentina";
    let facturanteStatus = "omitido";
    if (sinEmision) {
      facturanteStatus = "gestion";
    } else if (!skipFacturante && isAR && activeCompany === "ÑAKO SRL") {
      try {
        const result = await emitirComprobante({
          franchisor: franchisor?.ar ?? franchisor,
          franchise:  fr,
          comp:       { ...comp, applyIVA: !!(COMPANIES[activeCompany]?.applyIVA) },
        });
        comp = { ...comp, invoice: invoiceFromResult(result), facturanteId: String(result.idComprobante) };
        facturanteStatus = result.afipNumero ? "ok" : "sin_numero_afip";
      } catch (err) {
        facturanteStatus = `ERROR: ${err.message}`;
        console.error("[Lote Facturante]", fr.name, err.message);
      }
    } else if (!skipFacturante && !isAR) {
      try {
        const res = await getNextInvoiceNum(fr.id, getInvoicePrefix(activeCompany));
        comp = { ...comp, invoice: res.label };
        facturanteStatus = "invoice_ok";
      } catch (e) {
        facturanteStatus = `sin_invoice: ${e.message}`;
      }
    }
    const saveResult = await onAddComp(fr.id, comp);
    const entry = { ...meta, facturanteStatus, invoice: comp.invoice ?? null };
    if (saveResult?.ok === false && comp.facturanteId) {
      entry.facturanteStatus = "verificando…";
      dudosos.push({ entry, facturanteId: String(comp.facturanteId) });
    }
    log.push(entry);
  }

  if (dudosos.length > 0) {
    try {
      const frescos = await fetchComps();
      const guardados = new Set(
        Object.values(frescos).flat().map(c => String(c.facturanteId ?? "")).filter(Boolean));
      for (const { entry, facturanteId } of dudosos) {
        entry.facturanteStatus = guardados.has(facturanteId)
          ? `guardado (se perdió la respuesta, ID=${facturanteId})`
          : `GUARDADO_FALLIDO (AFIP OK, ID=${facturanteId}) — cargar a mano en el sistema`;
      }
    } catch {
      // Sin relectura no se puede afirmar ninguna de las dos cosas: se pide revisar antes de cargar.
      for (const { entry, facturanteId } of dudosos) {
        entry.facturanteStatus = `VERIFICAR (AFIP OK, ID=${facturanteId}) — no se pudo releer la hoja; buscá la factura en la sede antes de cargarla a mano`;
      }
    }
  }

  setBatchProg(null);
  return log;
}
