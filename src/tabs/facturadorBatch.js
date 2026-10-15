// ─── Helpers compartidos de los lotes del Facturador (fee desde CRM, CRM WhatsApp) ─────────
// Lo que antes vivía dentro de ModoCRM y que el lote de WhatsApp necesita igual: a qué sociedad
// factura cada país, en qué moneda, el TC de Maestros, y sobre todo el ciclo emitir → guardar →
// confirmar dudosos releyendo la hoja. Una sola copia para que las dos pantallas no diverjan.
import { COMPANIES } from "../lib/helpers";
import { emitirComprobante, invoiceFromResult } from "../lib/facturanteApi";
import { getNextInvoiceNum, fetchCompsFresh } from "../lib/sheetsApi";
import { reglaEmision } from "../lib/reglaEmision";

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

// Los lotes (fee, CRM WhatsApp) facturan según el PAÍS de la sede: Argentina → ÑAKO, el resto
// → BIGG FIT LLC, Europa incluida (en EUR): las franquicias firmaron con LLC. Wellness a esas
// sedes emite pauta e interusos de la red, nunca el fee. Entre el 3/8 y el 14/10/2026 esto mandaba
// los países EUR a Wellness: el lote de LLC dejó de listar España y el fee se cargó a mano.
// Nunca según las monedas habilitadas de la sede (esas son para comprobantes manuales tipo Pauta).
export function empresaEmisoraPorPais(country) {
  return country === "Argentina" ? "ÑAKO SRL" : "BIGG FIT LLC";
}
export function monedaFacturacionPorPais(country) {
  if (country === "Argentina") return "ARS";
  return getCountryCur(country).code === "EUR" ? "EUR" : "USD";
}

// ── Lote CRM WhatsApp ───────────────────────────────────────────────────────
// IVA por sociedad emisora para FACTURA|CRM. Wellness no emite este lote (empresaEmisoraPorPais
// manda Europa a BIGG FIT LLC); queda en false por si alguien lo corre con Wellness activa.
export const CRM_WA_APLICA_IVA = { "ÑAKO SRL": true, "BIGG FIT LLC": false, "Gestión Deportiva y Wellness SL": false };

// Subtítulo del lote (lo muestra el encabezado del Facturador, al lado del título del modo).
export function subtituloCrmWhatsapp(activeCompany) {
  const cur = COMPANIES[activeCompany]?.currency ?? "USD";
  return `Costo en USD por sede → factura en ${cur} (${activeCompany})`
       + (cur === "ARS" ? " al TC oficial" : "")
       + (CRM_WA_APLICA_IVA[activeCompany] ? " + IVA 21%" : ", sin IVA")
       + " · aparte del fee";
}

// ── ¿Entró igual? ─────────────────────────────────────────────────────────
// Un alta rechazada puede haberse escrito igual (el POST llega al Apps Script y se pierde la
// respuesta por el corte del proxy). Antes de darla por perdida se relee la hoja: darla por fallida
// cuando entró termina en cargarla a mano dos veces.

/**
 * Relee la hoja una vez (sin caché) y devuelve un comprobador `({ facturanteId, id }) => boolean`:
 * por facturanteId cuando lo hay (factura de ARCA, o número puesto sobre una fila existente), si
 * no por id de fila. null = no se pudo releer.
 */
export async function releerHoja() {
  try {
    const todos = Object.values(await fetchCompsFresh()).flat();
    const fids  = new Set(todos.map(c => String(c.facturanteId ?? "")).filter(Boolean));
    const ids   = new Set(todos.map(c => String(c.id)));
    return ({ facturanteId, id }) => facturanteId ? fids.has(String(facturanteId)) : ids.has(String(id));
  } catch {
    return null;
  }
}

/** Lo mismo para un solo comprobante: "si" | "no" | "?" (no se pudo releer). */
export async function emitidaEnHoja(ref) {
  const esta = await releerHoja();
  return esta == null ? "?" : esta(ref) ? "si" : "no";
}

/** Estado de log para un alta cuyo guardado no se confirmó, según lo que dijo la relectura. */
export function estadoNoGuardado(comp, enHoja) {
  const fid = comp.facturanteId ? String(comp.facturanteId) : null;
  const doc = fid ? `AFIP OK, ID=${fid}` : comp.invoice ? `número ${comp.invoice} asignado` : null;
  if (enHoja === "si") return `guardado (se perdió la respuesta${fid ? `, ID=${fid}` : ""})`;
  if (enHoja === "?") return `VERIFICAR (${doc ?? "sin número"}) — no se pudo releer la hoja; buscalo en la sede antes de cargarlo a mano`;
  return doc
    ? `GUARDADO_FALLIDO (${doc}) — cargar a mano en el sistema${fid ? "" : " con ese número"}`
    : "GUARDADO_FALLIDO — no se guardó; volvé a cargarlo";
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
    // La sociedad ya la eligió el lote por país (empresaEmisoraPorPais, regla del fee); si sale por
    // ARCA o por correlativo lo dice reglaEmision, igual que en el resto de los caminos.
    const regla = reglaEmision({ empresa: activeCompany, currency: comp.currency, doc: String(comp.type ?? "").split("|")[0] });
    let facturanteStatus = "omitido";
    if (sinEmision) {
      facturanteStatus = "gestion";
    } else if (!skipFacturante && regla.destino === "arca") {
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
    } else if (!skipFacturante && regla.destino === "correlativo") {
      try {
        const res = await getNextInvoiceNum(fr.id, regla.prefijo);
        comp = { ...comp, invoice: res.label };
        facturanteStatus = "invoice_ok";
      } catch (e) {
        facturanteStatus = `sin_invoice: ${e.message}`;
      }
    }
    const saveResult = await onAddComp(fr.id, comp);
    const entry = { ...meta, facturanteStatus, invoice: comp.invoice ?? null };
    // Cualquier alta rechazada, no solo las de ARCA: un correlativo USA-/ESP- que no se guardó deja
    // el número consumido, y sin esto figuraba como "invoice_ok".
    if (saveResult?.ok === false) {
      entry.facturanteStatus = "verificando…";
      dudosos.push({ entry, comp });
    }
    log.push(entry);
  }

  if (dudosos.length > 0) {
    const esta = await releerHoja();
    for (const { entry, comp } of dudosos) {
      entry.facturanteStatus = estadoNoGuardado(comp, esta == null ? "?" : esta(comp) ? "si" : "no");
    }
  }

  setBatchProg(null);
  return log;
}
