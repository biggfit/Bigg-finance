// src/lib/sueldosApi.js
// Data layer para el módulo de Sueldos.
// Backend: Google Apps Script → Google Sheet "BIGG Sueldos"
// Proxy local/Vercel: /api/sueldos

import { stamp } from "./auth";

const BASE    = "/api/sueldos";
const TOKEN   = import.meta.env.VITE_SHEETS_TOKEN ?? "";
const BASE_NB = "/api/numbers"; // para crear movimientos en Tesorería de Numbers

// ── Cache simple (TTL 30s) ────────────────────────────────────────────────────
const _cache   = new Map();
const _inflight = new Map();
const TTL = 30_000;

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL) { _cache.delete(key); return null; }
  return entry.data;
}

// ── Helpers HTTP ──────────────────────────────────────────────────────────────

async function get(sheet, params = {}, base = BASE, { retries = 2, retryDelayMs = 1200 } = {}) {
  const qs = new URLSearchParams({ resource: sheet, token: TOKEN, ...params }).toString();
  const key = `${base}?${qs}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  if (_inflight.has(key)) return _inflight.get(key);

  // GAS devuelve 500 con HTML de forma intermitente (rate-limit / lock). Sin reintento,
  // un solo fallo tumba el Promise.all del que carga la pantalla → "no hay datos" engañoso.
  const run = async () => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, retryDelayMs * attempt));
      try {
        const res  = await fetch(`${base}?${qs}`);
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); }
        catch { throw new Error(`Error del servidor (${res.status}): ${text.slice(0, 120)}`); }
        if (data?.error) throw new Error(data.error);
        _cache.set(key, { data, ts: Date.now() });
        return data;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  };

  const p = run().finally(() => _inflight.delete(key));
  _inflight.set(key, p);
  return p;
}

async function post(payload, base = BASE, { retries = 2, retryDelayMs = 1200 } = {}) {
  const sheet = payload.sheet ?? payload.resource ?? "";
  for (const k of _cache.keys()) {
    if (k.includes(`resource=${sheet}`) || k.includes(`/${sheet}`)) _cache.delete(k);
  }

  // Sello de autoría: firma cada asiento nuevo con el usuario logueado (ver auth.js).
  stamp(payload);

  for (let attempt = 0; ; attempt++) {
    const res  = await fetch(base, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ ...payload, token: TOKEN }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch {
      // GAS returned HTML (500 / quota error) — retry if attempts remain
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, retryDelayMs * (attempt + 1)));
        continue;
      }
      throw new Error(`Error del servidor (${res.status}): ${text.slice(0, 120)}`);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }
}

function newId(prefix = "SU") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

// Id de LOTE de pago: se genera UNA vez por acción de "Registrar pago" y se estampa
// en todos los movimientos de esa tanda → Conciliación matchea el débito del banco
// contra el total del lote (no del mes), evitando el doble conteo de la caja de sueldos.
export function nuevoLote() { return newId("LOTE"); }

// ── Formas de pago (receta de cobro por empleado) ─────────────────────────────
// Cada línea: { id, tipo, importe, banco, tipo_cuenta, cuenta, cbu, cuit, nota }
// tipo ∈ haberes | deposito | transferencia | efectivo
export const FP_TIPOS = ["haberes", "deposito", "transferencia_financiera", "monotributo", "efectivo"];
export const FP_TIPO_LABEL = {
  haberes: "Haberes",
  deposito: "Depósito",
  transferencia_financiera: "Trf. financiera",
  monotributo: "Monotributo",
  efectivo: "Efectivo",
};
export const FP_TIPO_COLOR = {
  haberes: "#1e293b",
  deposito: "#0369a1",
  transferencia_financiera: "#0d9488",
  monotributo: "#db2777",
  efectivo: "#ca8a04",
};

// Tipos que se pagan como transferencia (el usuario elige la sociedad de origen al pagar).
const FP_TRANSFER_TIPOS = ["transferencia_financiera", "monotributo"];
export const esTransferencia = (tipo) => FP_TRANSFER_TIPOS.includes(tipo);

// Cada tipo de línea cae en uno de los 4 baldes escalares persistidos (compatibilidad).
const FP_SCALAR_BUCKET = {
  haberes: "haberes",
  deposito: "deposito",
  transferencia_financiera: "transferencia",
  monotributo: "transferencia",
  efectivo: "efectivo",
};

function safeParseArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

// Convierte el array `formas_pago` a la columna `formas_pago_json` antes de
// escribir en Sheets (descarta el array para no mandar un objeto a la celda).
function withFormasPagoJson(data) {
  if (!("formas_pago" in data)) return { ...data };
  const { formas_pago, ...rest } = data;
  return { ...rest, formas_pago_json: JSON.stringify(formas_pago ?? []) };
}

// ── LEGAJOS ───────────────────────────────────────────────────────────────────

// Normaliza el valor del campo `rol` de Sheets al código interno.
// Sheets guarda "COACH SENIOR", "BIGG COACH", "Botanico", etc.
const ROL_SHEET_MAP = {
  // Valores en Sheets (legacy) → código interno
  "COACH SENIOR":  "COACH_SENIOR",
  "BIGG COACH":    "COACH",
  "BOTANICO":      "BOTANICO",
  "BOTÁNICO":      "BOTANICO",
  "YOGA":          "YOGA",
  // Códigos internos (ya normalizados) → pass-through
  "COACH_SENIOR":  "COACH_SENIOR",
  "COACH":         "COACH",
  "ENCARGADO":     "ENCARGADO",
  "VENTAS":        "VENTAS",
  "LIMPIEZA":      "LIMPIEZA",
  "HQ":            "HQ",
  "HQ_OWNER":      "HQ_OWNER",
  "HQ OWNER":      "HQ_OWNER",
  "HQ_EXT":        "HQ_EXT",
  "HQ EXT":        "HQ_EXT",
};
function normalizarRol(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  return ROL_SHEET_MAP[s.toUpperCase()] ?? ROL_SHEET_MAP[s] ?? s;
}

export async function fetchLegajos() {
  const rows = await get("su_legajos");
  return (Array.isArray(rows) ? rows : []).map(r => ({
    id:                  r.id,
    nombre:              r.nombre ?? "",
    cuil:                r.cuil ?? "",
    email:               r.email ?? "",
    cbu:                 r.cbu ?? "",
    numero_cuenta:       r.numero_cuenta ?? "",
    banco:               r.banco ?? "",
    cbu_sec:             r.cbu_sec ?? "",
    numero_cuenta_sec:   r.numero_cuenta_sec ?? "",
    banco_sec:           r.banco_sec ?? "",
    bigg_eye_id:         r.bigg_eye_id ?? "",
    sociedad_id:         r.sociedad_id ?? "",
    sociedad_nombre:     r.sociedad_nombre ?? "",
    sede_id:             r.sede_id ?? "",
    sede_nombre:         r.sede_nombre ?? "",
    pais:                r.pais ?? "",
    rol:                 normalizarRol(r.rol),
    tipo_contratacion:   r.tipo_contratacion ?? "",
    horas_contratadas:   Number(r.horas_contratadas) || 0,
    blanco_neto:         Number(r.blanco_neto)   || 0,
    sueldo_total:        Number(r.sueldo_total)  || 0,
    tarifa_hora:         Number(r.tarifa_hora)   || 0,
    activo:              String(r.activo ?? "true").toLowerCase() !== "false",
    fecha_ingreso:       r.fecha_ingreso ?? "",
    fecha_alta:          r.fecha_alta ?? "",
    notas:               r.notas ?? "",
    formas_pago:         safeParseArray(r.formas_pago_json),
  }));
}

export async function appendLegajo(data) {
  const socId   = data.sociedad_id ?? "hq";
  const prefix  = `LEG-${socId}-`;
  const existing = await fetchLegajos();
  const maxSeq  = existing
    .filter(l => l.id.startsWith(prefix))
    .map(l => parseInt(l.id.slice(prefix.length)) || 0)
    .reduce((max, n) => Math.max(max, n), 0);
  const id = `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
  await post({
    action: "add", sheet: "su_legajos",
    row: { id, ...withFormasPagoJson(data), created_at: new Date().toISOString() },
  });
  return id;
}

export async function updateLegajo(id, data) {
  await post({ action: "upd", sheet: "su_legajos", id, row: withFormasPagoJson(data) });
}

export async function deleteLegajo(id) {
  await post({ action: "del", sheet: "su_legajos", id });
}

// ── LIQUIDACIONES ─────────────────────────────────────────────────────────────

export async function fetchLiquidaciones(mes, anio) {
  const rows = await get("su_liquidaciones", { mes, anio });
  return parseLiquidacionesRows(rows);
}

function parseLiquidacion(r) {
  const num = (v) => Number(v) || 0;
  return {
    id:                    r.id,
    mes:                   r.mes,
    anio:                  r.anio,
    pais:                  r.pais ?? "",
    legajo_id:             r.legajo_id ?? "",
    legajo_nombre:         r.legajo_nombre ?? "",
    sociedad_id:           r.sociedad_id ?? "",
    sociedad_nombre:       r.sociedad_nombre ?? "",
    sede_id:               r.sede_id ?? "",
    sede_nombre:           r.sede_nombre ?? "",
    rol:                   normalizarRol(r.rol ?? ""),
    tipo_contratacion:     r.tipo_contratacion ?? "relacion_dependencia",
    sueldo_base:           num(r.sueldo_base),
    // Variables con cantidad × precio unitario
    horas_cant:            num(r.horas_cant),
    horas_monto_unit:      num(r.horas_monto_unit),
    horas_total:           num(r.horas_total),
    cdp_cant:              num(r.cdp_cant),
    cdp_monto_unit:        num(r.cdp_monto_unit),
    cdp_total:             num(r.cdp_total),
    one_shot_cant:         num(r.one_shot_cant),
    one_shot_monto_unit:   num(r.one_shot_monto_unit),
    one_shot_total:        num(r.one_shot_total),
    objetivos_cant:        num(r.objetivos_cant),
    objetivos_monto_unit:  num(r.objetivos_monto_unit),
    objetivos_total:       num(r.objetivos_total),
    feriados_cant:         num(r.feriados_cant),
    feriados_monto_unit:   num(r.feriados_monto_unit),
    feriados_total:        num(r.feriados_total),
    programacion_cant:     num(r.programacion_cant),
    programacion_monto_unit: num(r.programacion_monto_unit),
    programacion_total:    num(r.programacion_total),
    bonos_cant:            num(r.bonos_cant),
    bonos_monto_unit:      num(r.bonos_monto_unit),
    bonos_total:           num(r.bonos_total),
    // HQ — formas de pago
    formas_pago:           safeParseArray(r.formas_pago_json),
    monto_haberes:         num(r.monto_haberes),
    monto_deposito:        num(r.monto_deposito),
    monto_transferencia:   num(r.monto_transferencia ?? r.monto_monotributo), // fallback col vieja
    monto_efectivo:        num(r.monto_efectivo),
    // Sociedad desde la que se paga el monotributo, congelada al cerrar (haberes = sociedad
    // del legajo; efectivo = beta → no necesitan persistirse).
    sociedad_monotributo:  r.sociedad_monotributo ?? "",
    // Novedades
    total_novedades_extra: num(r.total_novedades_extra),
    total_rendiciones:     num(r.total_rendiciones),
    total_anticipos:       num(r.total_anticipos),
    // Totales
    total_bruto:           num(r.total_bruto),
    blanco_neto:           num(r.blanco_neto),
    efectivo:              num(r.efectivo),
    estado:                r.estado ?? "borrador",
  };
}

// ── Modelo de líneas de su_liquidaciones (refactor) ───────────────────────────
// Cada liquidación se persiste como N filas con un `id_liq` común y un `tipo`:
//   "concepto" (desglose del sueldo) | "pago" (reparto por forma×sociedad) | "novedad".
// _agruparPorLiq + liqFromLineas reconstruyen el objeto con los NOMBRES LEGACY, para
// que el resto de la app no cambie. La capa lee formato nuevo (líneas) Y viejo (fila gorda).

// concepto (label de la fila) → prefijo del campo legacy
const LIQ_CONCEPTO_CAMPO = {
  "Sueldo base":     "sueldo_base",
  "Horas":           "horas",
  "CDP":             "cdp",            // legacy (CDP único, antes del split coach/front)
  "CDP coach":       "cdp_coach",
  "CDP front desk":  "cdp_front",
  "One Shot":        "one_shot",
  "Objetivos":       "objetivos",
  "Objetivo grupal": "bonos",
  "Feriados":        "feriados",
  "Domingos":        "domingos",
  "Yoga":            "yoga",
  "Running":         "running",
  "Programaciones":  "programacion",   // legacy (la comisión del encargado pasó a ser novedad)
  "Redondeo":        "redondeo",       // aumento de sueldo por redondear el efectivo hacia arriba
};

function _agruparPorLiq(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.id_liq)) map.set(r.id_liq, []);
    map.get(r.id_liq).push(r);
  }
  return map;
}

// Reconstruye el objeto liquidación (shape legacy de parseLiquidacion) desde sus líneas.
function liqFromLineas(idLiq, lineas) {
  const num = (v) => Number(v) || 0;
  const h = lineas[0] || {};
  const out = {
    id: idLiq, mes: h.mes, anio: h.anio, pais: h.pais ?? "",
    legajo_id: h.legajo_id ?? "", legajo_nombre: h.legajo_nombre ?? "",
    sociedad_id: h.sociedad_id ?? "", sociedad_nombre: h.sociedad_nombre ?? "",
    sede_id: h.sede_id ?? "", sede_nombre: h.sede_nombre ?? "",
    rol: normalizarRol(h.rol ?? ""), tipo_contratacion: h.tipo_contratacion ?? "relacion_dependencia",
    sueldo_base: 0,
    horas_cant: 0, horas_monto_unit: 0, horas_total: 0,
    cdp_cant: 0, cdp_monto_unit: 0, cdp_total: 0,
    cdp_coach_cant: 0, cdp_coach_monto_unit: 0, cdp_coach_total: 0,
    cdp_front_cant: 0, cdp_front_monto_unit: 0, cdp_front_total: 0,
    one_shot_cant: 0, one_shot_monto_unit: 0, one_shot_total: 0,
    objetivos_cant: 0, objetivos_monto_unit: 0, objetivos_total: 0,
    feriados_cant: 0, feriados_monto_unit: 0, feriados_total: 0,
    domingos_cant: 0, domingos_monto_unit: 0, domingos_total: 0,
    yoga_cant: 0, yoga_monto_unit: 0, yoga_total: 0,
    running_cant: 0, running_monto_unit: 0, running_total: 0,
    programacion_cant: 0, programacion_monto_unit: 0, programacion_total: 0,
    bonos_cant: 0, bonos_monto_unit: 0, bonos_total: 0,
    redondeo_cant: 0, redondeo_monto_unit: 0, redondeo_total: 0,
    formas_pago: [],
    monto_haberes: 0, monto_deposito: 0, monto_transferencia: 0, monto_efectivo: 0,
    sociedad_monotributo: "",
    total_novedades_extra: 0, total_rendiciones: 0, total_anticipos: 0,
    novedades: [],
    total_bruto: 0, blanco_neto: num(h.blanco_neto), efectivo: 0,
    estado: h.estado ?? "borrador",
  };
  for (const l of lineas) {
    const monto = num(l.monto);
    if (l.tipo === "concepto") {
      const campo = LIQ_CONCEPTO_CAMPO[l.concepto];
      if (campo === "sueldo_base") out.sueldo_base += monto;
      else if (campo) {
        out[`${campo}_cant`]       += num(l.cantidad);
        out[`${campo}_monto_unit`]  = num(l.monto_unit);
        out[`${campo}_total`]      += monto;
      }
    } else if (l.tipo === "pago") {
      const bucket = FP_SCALAR_BUCKET[l.forma_pago] ?? "deposito";
      out[`monto_${bucket}`] += monto;
      out.formas_pago.push({ id: l.id, tipo: l.forma_pago, importe: monto, sociedad_id: l.sociedad_id ?? "" });
      if (l.forma_pago === "monotributo" && l.sociedad_id) out.sociedad_monotributo = l.sociedad_id;
      out.total_bruto += monto;
    } else if (l.tipo === "novedad") {
      out.total_novedades_extra += monto;
      out.novedades.push({
        id: l.id, monto, tipo: "extra", forma_pago: l.forma_pago ?? "efectivo",
        // cuenta = la cuenta contable (para el P&L); descripcion = la etiqueta de la novedad
        // (lo que se ve, ej. "Feriado X Día"). Fallback a concepto para datos legacy.
        cuenta_contable_nombre: l.cuenta_contable || l.concepto || "",
        cuenta_contable_id: l.cuenta_contable_id ?? "",
        descripcion: l.concepto ?? "",
      });
    }
  }
  return out;
}

// Devuelve objetos liquidación leyendo formato nuevo (líneas con id_liq) o viejo (fila gorda).
function parseLiquidacionesRows(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  const out = arr.filter(r => !r.id_liq).map(parseLiquidacion);   // legacy: idéntico a hoy
  const grupos = _agruparPorLiq(arr.filter(r => r.id_liq));
  for (const [idLiq, ls] of grupos) out.push(liqFromLineas(idLiq, ls));
  return out;
}

export async function deleteLiquidacion(id) {
  await post({ action: "del", sheet: "su_liquidaciones", id });
}

// ── Escritura por líneas (refactor su_liquidaciones) ──────────────────────────

// id de grupo determinístico (idempotente al re-cerrar). Incluye sede para que los
// coaches multi-sede (una liquidación por sede) tengan ids distintos.
export function idLiqDe(legajo_id, mes, anio, sede_id = "") {
  return `LIQ-${legajo_id}-${sede_id || "0"}-${anio}${String(mes).padStart(2, "0")}`;
}

// Sociedad desde la que se paga una forma (al construir las líneas `pago`/`novedad`).
export function sociedadDeFormaPago(forma, lineSoc, legajoSoc) {
  if (forma === "haberes")     return legajoSoc || "";
  if (forma === "monotributo") return lineSoc || legajoSoc || "";
  return "beta";  // deposito, efectivo, transferencia_financiera
}

// Construye una fila-línea con el header denormalizado (como nb_comprobantes).
export function lineaLiq(header, extra) {
  return {
    mes: header.mes, anio: header.anio, pais: header.pais ?? "",
    legajo_id: header.legajo_id, legajo_nombre: header.legajo_nombre ?? "",
    sociedad_id: header.sociedad_id ?? "", sociedad_nombre: header.sociedad_nombre ?? "",
    sede_id: header.sede_id ?? "", sede_nombre: header.sede_nombre ?? "",
    rol: header.rol ?? "", tipo_contratacion: header.tipo_contratacion ?? "",
    estado: header.estado ?? "borrador",
    tipo: "", concepto: "", cuenta_contable: "", cuenta_contable_id: "",
    forma_pago: "", cantidad: 0, monto_unit: 0, monto: 0,
    ...extra,
  };
}

// Borra todas las líneas de una liquidación. Usa del_comp; si el GAS no lo soporta,
// cae a borrar línea por línea.
export async function delLiquidacionComp(id_liq) {
  try {
    await post({ action: "del_comp", sheet: "su_liquidaciones", id_liq });
  } catch {
    const rows = await get("su_liquidaciones", {});
    const mias = (Array.isArray(rows) ? rows : []).filter(r => r.id_liq === id_liq);
    for (const r of mias) await post({ action: "del", sheet: "su_liquidaciones", id: r.id });
  }
}

// Reescribe una liquidación como N líneas (delete-all-then-re-add, secuencial:
// GAS pierde escrituras concurrentes). Devuelve los ids de línea en orden.
export async function saveLiquidacionLines(id_liq, lineas) {
  await delLiquidacionComp(id_liq);
  const created_at = new Date().toISOString();
  const rows = lineas.map((l, i) => ({
    id: `${id_liq}-L${String(i + 1).padStart(2, "0")}`, id_liq, ...l, created_at,
  }));
  if (!rows.length) return [];
  // Alta en lote (1 request). Si el GAS no soporta add_batch, cae a alta secuencial.
  try {
    await post({ action: "add_batch", sheet: "su_liquidaciones", rows });
  } catch {
    for (const row of rows) await post({ action: "add", sheet: "su_liquidaciones", row });
  }
  return rows.map(r => r.id);
}

// ── Devengado de sueldos para el P&L (Numbers) ────────────────────────────────
// Una liquidación CERRADA es gasto devengado. El P&L de Numbers la lee y la une a
// nb_comprobantes (Opción A: su_liquidaciones es la única fuente de verdad del sueldo).

// HQ escribe estado "cerrada"; Sedes "cerrado". El lector acepta ambos.
export const isCerrada = (estado) => {
  const s = String(estado ?? "").toLowerCase();
  return s === "cerrada" || s === "cerrado";
};

// Sociedad desde la que se paga cada forma (congelada al cerrar):
//   haberes → sociedad del legajo; monotributo → la elegida al cerrar (fallback legajo);
//   efectivo → "beta" (caja B).
export function sociedadDeForma(liq, bucket) {
  if (bucket === "haberes")                       return liq.sociedad_id || "";
  if (bucket === "efectivo" || bucket === "deposito") return "beta";
  return liq.sociedad_monotributo || liq.sociedad_id || "";  // monotributo
}

// Baldes de forma de pago que componen el devengado del sueldo (cubren el total_bruto).
// La cuenta contable es siempre "Sueldos" (el monotributo es sueldo, no honorarios);
// varía la sociedad. tipo_componente del pago → balde para la cuenta por pagar.
export const SALARY_BUCKETS = [
  { bucket: "haberes",     campo: "monto_haberes" },
  { bucket: "deposito",    campo: "monto_deposito" },
  { bucket: "monotributo", campo: "monto_transferencia" },
  { bucket: "efectivo",    campo: "monto_efectivo" },
];

export const pagoTipoABucket = (tipo) => {
  if (tipo === "haberes")  return "haberes";
  if (tipo === "deposito") return "deposito";
  if (tipo === "efectivo") return "efectivo";
  return "monotributo";  // monotributo | transferencia_financiera
};

// Devengado de una liquidación desglosado por (balde de forma, sociedad).
// HQ guarda líneas (formas_pago) con `sociedad_id` por línea de monotributo; Sedes usa
// los escalares monto_*. Única fuente de la derivación de sociedad por forma.
export function devengadoPorFormaYSociedad(liq) {
  const out = [];
  // Sueldo (cuenta "Sueldos"): por línea (HQ) o por escalares (Sedes).
  if (Array.isArray(liq.formas_pago) && liq.formas_pago.length) {
    for (const l of liq.formas_pago) {
      const total = Number(l.importe) || 0;
      if (total <= 0) continue;
      // Solo el monotributo elige sociedad; trf. financiera / depósito / efectivo → Beta;
      // haberes → sociedad del legajo.
      let sociedad;
      if (l.tipo === "monotributo")                    sociedad = l.sociedad_id || liq.sociedad_monotributo || liq.sociedad_id || "";
      else if (l.tipo === "transferencia_financiera")  sociedad = "beta";
      else if (l.tipo === "haberes")                   sociedad = liq.sociedad_id || "";
      else                                             sociedad = "beta";  // depósito, efectivo
      out.push({ bucket: pagoTipoABucket(l.tipo), sociedad, total, cuenta_contable: "Sueldos" });
    }
  } else {
    for (const { bucket, campo } of SALARY_BUCKETS) {
      const total = Number(liq[campo]) || 0;
      if (total > 0) out.push({ bucket, sociedad: sociedadDeForma(liq, bucket), total, cuenta_contable: "Sueldos" });
    }
  }
  // Novedades congeladas: cada una a SU cuenta contable (Autónomos, Monotributo…).
  for (const n of (liq.novedades || [])) {
    const total = Number(n.monto) || 0;
    if (total > 0) out.push({
      bucket: pagoTipoABucket(n.forma_pago),
      sociedad: sociedadDeFormaPago(n.forma_pago, "", liq.sociedad_id),
      total,
      cuenta_contable: n.cuenta_contable_nombre || "Sueldos",
    });
  }
  return out;
}

// Convierte una liquidación en filas estilo-comprobante para el P&L: una por (forma, sociedad)
// con monto > 0. centro_costo = sede del legajo (roles fijos) o sede de las horas (coaches).
export function liquidacionToPnLRows(liq) {
  const mes = Number(liq.mes) || 0, anio = Number(liq.anio) || 0;
  const ultimoDia = mes ? new Date(anio, mes, 0).getDate() : 28;
  const fecha = `${anio}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
  return devengadoPorFormaYSociedad(liq).map(({ bucket, sociedad, total, cuenta_contable }) => ({
    fecha,
    moneda:          "ARS",
    centro_costo:    liq.sede_id || "",
    cuenta_contable: cuenta_contable || "Sueldos",
    sociedad,
    total,
    bucket,
  }));
}

// Liquidaciones CERRADAS (HQ + Sedes comparten el sheet). Sin `anio` → todas.
export async function fetchLiquidacionesCerradas(anio) {
  const rows = await get("su_liquidaciones", anio ? { anio } : {});
  return parseLiquidacionesRows(rows)
    .filter(l => isCerrada(l.estado) && (anio == null || Number(l.anio) === Number(anio)));
}

// Alias beta↔b: sueldos deriva "beta" para efectivo/depósito; Numbers la registra "b".
export const normSoc = (s) => {
  const v = String(s ?? "").toLowerCase().trim();
  return (v === "b" || v === "beta") ? "beta" : v;
};

// Deuda viva de sueldos POR LEGAJO: devengado (liquidaciones cerradas) − pagado
// (nb_movimientos origen sueldos), neteado por legajo+mes+sociedad y agregado por legajo.
// La antigüedad (aging) se calcula en la pantalla con la fecha de hoy sobre `items`.
// `ambito` (hq/sedes) sale del rol de la liquidación → sirve para el deep-link al wizard.
// Neto por (legajo|mes-anio|sociedad) = devengado (liquidaciones cerradas) − pagado (movimientos).
// Incluye claves que SOLO tienen pago (adelanto sin liquidación aún) → quedan negativas.
function _netoSueldos(liqsCerradas, pagos, { pais } = {}) {
  const liqs = (liqsCerradas || []).filter(l => !pais || !l.pais || l.pais === pais);
  const neto = new Map();   // legajo|anio-mes|soc → { legajo_id, legajo, mes, anio, sociedad, ambito, monto }
  const ensure = (legajo_id, legajo, mes, anio, soc, ambito) => {
    const key = `${legajo_id}|${anio}-${mes}|${soc}`;
    let cur = neto.get(key);
    if (!cur) { cur = { legajo_id, legajo, mes, anio, sociedad: soc, ambito, monto: 0 }; neto.set(key, cur); }
    return cur;
  };
  for (const liq of liqs) {
    const mes = Number(liq.mes) || 0, anio = Number(liq.anio) || 0;
    const ambito = ROLES_HQ.includes(liq.rol) ? "hq" : "sedes";
    const legajo = liq.legajo_nombre || liq.legajo_id || "Sin nombre";
    for (const d of devengadoPorFormaYSociedad(liq))
      ensure(liq.legajo_id, legajo, mes, anio, normSoc(d.sociedad), ambito).monto += Number(d.total) || 0;
  }
  for (const p of (pagos || []))
    ensure(p.legajo_id, p.legajo_nombre || p.legajo_id || "Sin nombre",
           Number(p.mes) || 0, Number(p.anio) || 0, normSoc(p.sociedad_id), p.ambito || "sedes").monto -= Number(p.monto) || 0;
  return neto;
}

// Agrupa por legajo los netos que cumplen `keep(monto)`, devolviendo el monto vía `val(monto)`.
function _agruparSueldos(neto, keep, val) {
  const porLegajo = new Map();
  for (const v of neto.values()) {
    if (!keep(v.monto)) continue;
    const g = porLegajo.get(v.legajo_id) || { legajo_id: v.legajo_id, legajo: v.legajo, total: 0, items: [] };
    const m = val(v.monto);
    g.total += m;
    g.items.push({ mes: v.mes, anio: v.anio, sociedad: v.sociedad, ambito: v.ambito, monto: m });
    porLegajo.set(v.legajo_id, g);
  }
  return [...porLegajo.values()].sort((a, b) => b.total - a.total);
}

// Deuda viva de sueldos POR LEGAJO: parte POSITIVA del neto (devengado sin pagar → PASIVO).
export function pendienteSueldosPorLegajo(liqsCerradas, pagos, opts = {}) {
  return _agruparSueldos(_netoSueldos(liqsCerradas, pagos, opts), m => m > 0.5, m => m);
}

// Adelantos de sueldo POR LEGAJO: parte NEGATIVA del neto (pagado > devengado, o pago sin liquidación
// cerrada → ACTIVO). Espejo de pendienteSueldosPorLegajo: mantiene el PN correcto entre el adelanto
// y el cierre de la liquidación (la caja bajó, pero contra un activo, no contra el patrimonio).
export function adelantoSueldosPorLegajo(liqsCerradas, pagos, opts = {}) {
  return _agruparSueldos(_netoSueldos(liqsCerradas, pagos, opts), m => m < -0.5, m => -m);
}

// ── NOVEDADES ─────────────────────────────────────────────────────────────────

export async function fetchNovedades(mes, anio) {
  const rows = await get("su_novedades", { mes, anio });
  return (Array.isArray(rows) ? rows : []).map(r => ({
    id:                      r.id,
    mes:                     r.mes,
    anio:                    r.anio,
    legajo_id:               r.legajo_id ?? "",
    legajo_nombre:           r.legajo_nombre ?? "",
    // Sede (solo novedades de Sedes; las de HQ vienen vacías). Distingue ámbito HQ vs Sedes.
    sede_id:                 r.sede_id ?? "",
    sede_nombre:             r.sede_nombre ?? "",
    tipo:                    r.tipo ?? "extra",       // extra | anticipo | rendicion
    descripcion:             r.descripcion ?? "",
    monto:                   Number(r.monto) || 0,
    forma_pago:              r.forma_pago ?? "efectivo",
    cuenta_contable_id:      r.cuenta_contable_id ?? "",
    cuenta_contable_nombre:  r.cuenta_contable_nombre ?? "",
  }));
}

export async function appendNovedad(data) {
  const id = newId("NOV");
  await post({ action: "add", sheet: "su_novedades", row: { id, ...data, created_at: new Date().toISOString() } });
  return id;
}

export async function updateNovedad(id, data) {
  await post({ action: "upd", sheet: "su_novedades", id, row: data });
}

export async function deleteNovedad(id) {
  await post({ action: "del", sheet: "su_novedades", id });
}

// ── PAGOS ─────────────────────────────────────────────────────────────────────
// Un pago de sueldo ES un nb_movimientos (origen "sueldos"). No hay tabla su_pagos:
// se eliminó para evitar la doble escritura y la doble lectura (igual que proveedores,
// donde el pago es un nb_movimientos con documento_id contra su comprobante).

// Mapea una fila CRUDA de nb_movimientos (origen sueldos) al shape de "pago" que las
// pantallas ya esperan. La hoja guarda monto NEGATIVO (egreso de caja); acá lo
// devolvemos POSITIVO porque las sumas de "pagado" trabajan en positivo.
export function parsePagoFromMov(m) {
  return {
    id:                       m.id,
    nb_movimiento_id:         m.id,
    mes:                      m.mes,
    anio:                     m.anio,
    pais:                     m.pais ?? "",
    legajo_id:                m.legajo_id ?? "",
    legajo_nombre:            m.legajo_nombre ?? "",
    sociedad_id:              m.sociedad ?? "",
    sociedad_nombre:          m.sociedad_nombre ?? "",
    centro_costo:             m.centro_costo ?? "",
    // haberes | deposito | monotributo | transferencia_financiera | efectivo | rendicion
    tipo_componente:          m.tipo_componente ?? "haberes",
    monto:                    Math.abs(Number(m.monto) || 0),
    fecha:                    m.fecha ?? "",
    cuenta_bancaria_id:       m.cuenta_bancaria ?? "",
    cuenta_bancaria_nombre:   m.cuenta_bancaria_nombre ?? "",
    forma_pago_id:            m.forma_pago_id ?? "",
    concepto:                 m.concepto ?? "",
    nota:                     m.nota ?? "",
    registrado_por:           m.registrado_por ?? "",
    ambito:                   m.ambito ?? "",   // "hq" | "sedes" — separa pagos de un legajo con liquidación en ambos
  };
}

// Pagos de sueldo = movimientos de Numbers con origen "sueldos". El filtro mes/anio es
// el PERÍODO de la liquidación (columnas mes/anio del movimiento), no la fecha de pago.
function _pagosDeMovs(rows, { mes, anio } = {}) {
  return (Array.isArray(rows) ? rows : [])
    // Solo pagos de sueldo REALES (tipo SUELDO). El pago del F931 (pagarCargasSociales) también es
    // origen "sueldos" pero tipo PAGO y sin legajo/mes → si entrara acá generaría un "adelanto" fantasma.
    .filter(m => m.origen === "sueldos" && m.tipo === "SUELDO")
    .filter(m => mes  == null || Number(m.mes)  === Number(mes))
    .filter(m => anio == null || Number(m.anio) === Number(anio))
    .map(parsePagoFromMov);
}

export async function fetchPagos(mes, anio) {
  const rows = await get("nb_movimientos", {}, BASE_NB);
  return _pagosDeMovs(rows, { mes, anio });
}

// Pagos de sueldo (para la cuenta por pagar de sueldos en el Balance). Sin `anio` → todos.
export async function fetchPagosAnio(anio) {
  const rows = await get("nb_movimientos", {}, BASE_NB);
  return _pagosDeMovs(rows, anio != null ? { anio } : {});
}

/**
 * Registra un pago real como UN movimiento en Numbers (Tesorería). origen="sueldos".
 * Las columnas mes/anio/legajo_id/legajo_nombre/tipo_componente/ambito/forma_pago_id/nota
 * son las que antes vivían en su_pagos (ahora exclusivas del movimiento de sueldo).
 */
export async function appendPago({
  mes, anio, pais = "", legajo_id, legajo_nombre, sociedad_id, sociedad_nombre,
  tipo_componente, monto, fecha, cuenta_bancaria_id, cuenta_bancaria_nombre,
  cuenta_contable_id = "", cuenta_contable_nombre = "",
  forma_pago_id = "", lote_pago = "",
  centro_costo = "", concepto = "", nota = "", registrado_por = "", ambito = "",
}) {
  const nb_concepto = concepto || `Sueldo ${legajo_nombre} ${mes}/${anio} · ${tipo_componente}`;
  const nb_movimiento_id = newId("MOV");
  // Link estilo-proveedores contra la liquidación (sede solo aplica en Sedes).
  const documento_id = idLiqDe(legajo_id, mes, anio, ambito === "sedes" ? centro_costo : "");
  const nbRow = {
    id:              nb_movimiento_id,
    sociedad:        sociedad_id,
    fecha,
    tipo:            "SUELDO",
    cuenta_bancaria: cuenta_bancaria_id,
    cuenta_contable: cuenta_contable_id,
    moneda:          "ARS",
    monto:           -Math.abs(monto),
    documento_id,
    concepto:        nb_concepto,
    centro_costo,
    origen:          "sueldos",
    // ── Columnas de nómina (antes su_pagos) ──
    mes, anio, legajo_id, legajo_nombre,
    tipo_componente, forma_pago_id, lote_pago, ambito, nota,
    created_at:      new Date().toISOString(),
  };
  await post({ action: "add", sheet: "nb_movimientos", row: nbRow }, BASE_NB);
  return { id: nb_movimiento_id, nb_movimiento_id };
}

export async function deletePago(id, nb_movimiento_id) {
  const movId = nb_movimiento_id || id;
  if (movId) await post({ action: "del", sheet: "nb_movimientos", id: movId }, BASE_NB);
}

// ── CARGAS SOCIALES ───────────────────────────────────────────────────────────

export async function fetchCargasSociales(mes, anio) {
  const rows = await get("su_cargas_sociales", { mes, anio });
  return (Array.isArray(rows) ? rows : []).map(r => ({
    id:                  r.id,
    mes:                 r.mes,
    anio:                r.anio,
    sociedad_id:         r.sociedad_id ?? "",
    sociedad_nombre:     r.sociedad_nombre ?? "",
    monto_total:         Number(r.monto_total) || 0,
    distribucion:        (() => { try { return JSON.parse(r.distribucion_json || "{}"); } catch { return {}; } })(),
    fecha_vto:           r.fecha_vto ?? "",
    nb_comprobante_id:   r.nb_comprobante_id ?? "",
    nb_movimiento_id:    r.nb_movimiento_id ?? "",
    pagado:              String(r.pagado ?? "false").toLowerCase() === "true",
  }));
}

export async function saveCargasSociales(data) {
  const id = data.id ?? newId("CS");
  const row = {
    ...data,
    id,
    distribucion_json: JSON.stringify(data.distribucion ?? {}),
  };
  delete row.distribucion;
  await post({ action: data.id ? "upd" : "add", sheet: "su_cargas_sociales", id, row });
  return id;
}

/**
 * Registra el pago del F931. Crea nb_comprobantes + nb_movimientos en Numbers.
 */
export async function pagarCargasSociales({
  id, mes, anio, sociedad_id, sociedad_nombre, monto_total,
  fecha, cuenta_bancaria_id, cuenta_bancaria_nombre,
}) {
  const concepto = `F931 ${sociedad_nombre} ${mes}/${anio}`;

  // Egreso en Numbers (proveedor AFIP)
  const compRow = {
    sociedad:            sociedad_id,
    fecha,
    subtipo:             "EGRESO_FC",
    contraparte_id:      "AFIP",
    contraparte_nombre:  "AFIP",
    moneda:              "ARS",
    subtotal:            monto_total,
    iva_rate:            0,
    iva:                 0,
    total:               monto_total,
    nota:                concepto,
    estado:              "pagado",
    origen:              "sueldos",
    created_at:          new Date().toISOString(),
  };
  const compRes = await post({ action: "add", sheet: "nb_comprobantes", row: compRow }, BASE_NB);
  const nb_comprobante_id = compRes?.id ?? "";

  // Movimiento de tesorería
  const movRow = {
    sociedad:        sociedad_id,
    fecha,
    tipo:            "PAGO",
    cuenta_bancaria: cuenta_bancaria_id,
    moneda:          "ARS",
    monto:           -monto_total,
    concepto,
    documento_id:    nb_comprobante_id,
    origen:          "sueldos",
    created_at:      new Date().toISOString(),
  };
  const movRes = await post({ action: "add", sheet: "nb_movimientos", row: movRow }, BASE_NB);
  const nb_movimiento_id = movRes?.id ?? "";

  // Actualizar carga social como pagada
  await post({
    action: "upd", sheet: "su_cargas_sociales", id,
    row: { pagado: "true", nb_comprobante_id, nb_movimiento_id },
  });

  return { nb_comprobante_id, nb_movimiento_id };
}

// ── BIGG Eye ──────────────────────────────────────────────────────────────────

/**
 * Trae las horas de TODOS los check-ins de todas las sedes activas de Bigg Eye
 * para el mes/año indicado. Devuelve un array de
 * { coach_name, location_id, location_name, hours }.
 */
export async function fetchHorasDesdeEye(mes, anio, pais = "", locationIds = [], fresh = false) {
  const qs = new URLSearchParams({ month: mes, year: anio, ...(pais ? { pais } : {}) });
  if (locationIds.length > 0) qs.set("location_ids", locationIds.join(","));
  if (fresh) qs.set("fresh", "1");   // saltea cache, baja en vivo del worker por sede
  const res  = await fetch(`/api/bigg-eye-horas?${qs}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Trae las conversiones CDP y one-shots por coach desde Bigg Eye.
 * Devuelve { items: [{ coach_name, location_id, location_name, cdp_count, one_shot_count }] }
 */
export async function fetchCdpDesdeEye(mes, anio, pais = "", locationIds = [], fresh = false) {
  const qs = new URLSearchParams({ month: mes, year: anio, ...(pais ? { pais } : {}) });
  if (locationIds.length > 0) qs.set("location_ids", locationIds.join(","));
  if (fresh) qs.set("fresh", "1");   // saltea cache, baja en vivo del worker por sede
  const res  = await fetch(`/api/bigg-eye-cdp?${qs}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data;
}

// ── CONSTANTES ────────────────────────────────────────────────────────────────

export const ROLES_SEDES   = ["COACH_SENIOR", "COACH", "BOTANICO", "YOGA", "ENCARGADO", "VENTAS", "LIMPIEZA"];
export const ROLES_COACHES = ["COACH_SENIOR", "COACH", "BOTANICO", "YOGA"];
export const ROLES_FRONT   = ["ENCARGADO", "VENTAS"];
export const ROLES_LIMP    = ["LIMPIEZA"];
export const ROLES_HQ      = ["HQ", "HQ_OWNER", "HQ_EXT"];

// Mapeo rol → concepto en su_categorias
export const ROL_CONCEPTO = {
  COACH_SENIOR: "COACH SENIOR",
  COACH:        "BIGG COACH",
  BOTANICO:     "BOTÁNICO",
  YOGA:         "YOGA",
};

// Desglose por concepto de una liquidación (para la ficha de Resumen, solo lectura).
// Sedes persiste cantidades (horas_cant, cdp_cant) pero no sus importes → se recalculan
// con las tarifas de `categorias`, igual que calcTotal en la pantalla de liquidación.
// `total_bruto` guardado es el número autoritativo del total.
export function desglosarLiquidacion(liq, categorias = []) {
  const tarifa = (concepto) =>
    concepto ? (categorias.find(c => (c.concepto || "").toUpperCase() === String(concepto).toUpperCase())?.monto ?? 0) : 0;
  const isCoach  = ROLES_COACHES.includes(liq.rol);
  const tarifaHora = isCoach ? tarifa(ROL_CONCEPTO[liq.rol] ?? liq.rol) : 0;
  const tCdpCoach = tarifa("CDP COACHES");
  const tCdpFront = tarifa("CDP FRONT DESK");
  const tarifaOS      = tarifa("ONE SHOT");
  const tarifaDomingo = tarifa("DOMINGO");
  const tarifaYoga    = tarifa("YOGA");
  const tarifaRunning = tarifa("RUNNING");

  const horasCant     = Number(liq.horas_cant) || 0;
  const horasMonto    = horasCant * tarifaHora;
  // CDP en dos baldes (coach + front desk) + legacy "CDP" único (datos viejos).
  const cdpCoachCant  = Number(liq.cdp_coach_cant) || 0;
  const cdpFrontCant  = Number(liq.cdp_front_cant) || 0;
  const cdpLegacyCant = Number(liq.cdp_cant) || 0;
  const cdpCant       = cdpCoachCant + cdpFrontCant + cdpLegacyCant;
  const cdpMonto      = cdpCoachCant * tCdpCoach + cdpFrontCant * tCdpFront
                      + cdpLegacyCant * (isCoach ? tCdpCoach : tCdpFront);
  const oneShotCant   = Number(liq.one_shot_cant) || 0;
  const oneShotMonto  = Number(liq.one_shot_total) || 0;
  const asignaciones  = Number(liq.objetivos_total) || 0;
  const objGrupalPct  = Number(liq.bonos_cant) || 0;
  const objGrupalMonto = Number(liq.bonos_total) || 0;
  const feriadosCant  = Number(liq.feriados_cant) || 0;
  const feriadosMonto = Number(liq.feriados_total) || (feriadosCant * tarifaHora);
  const domingosCant  = Number(liq.domingos_cant) || 0;
  const domingosMonto = Number(liq.domingos_total) || (domingosCant * tarifaDomingo);
  const yogaCant      = Number(liq.yoga_cant) || 0;
  const yogaMonto     = Number(liq.yoga_total) || (yogaCant * tarifaYoga);
  const runningCant   = Number(liq.running_cant) || 0;
  const runningMonto  = Number(liq.running_total) || (runningCant * tarifaRunning);
  const redondeo      = Number(liq.redondeo_total) || 0;
  const programaciones = Number(liq.programacion_total) || 0;
  const fijo          = Number(liq.sueldo_base) || 0;

  const sueldoFijo     = fijo + horasMonto;
  const sueldoVariable = cdpMonto + oneShotMonto + asignaciones + objGrupalMonto
                       + feriadosMonto + domingosMonto + yogaMonto + runningMonto + redondeo + programaciones;
  const sueldoTotal    = sueldoFijo + sueldoVariable;
  // total_bruto (Σ líneas pago = sueldo) es la fuente de verdad; si no está, se reconstruye.
  const totalLiquidar  = Number(liq.total_bruto) || sueldoTotal;

  return {
    rol: liq.rol, tarifaHora, tCdpCoach, tCdpFront, tarifaOS, tarifaDomingo, tarifaYoga,
    fijo, horasCant, horasMonto,
    cdpCant, cdpMonto, cdpCoachCant, cdpFrontCant,
    oneShotCant, oneShotMonto,
    asignaciones, objGrupalPct, objGrupalMonto,
    feriadosCant, feriadosMonto, domingosCant, domingosMonto, yogaCant, yogaMonto,
    runningCant, runningMonto, tarifaRunning, redondeo, programaciones,
    sueldoFijo, sueldoVariable, sueldoTotal, totalLiquidar,
    monto_haberes:       Number(liq.monto_haberes) || 0,
    monto_transferencia: Number(liq.monto_transferencia) || 0,
    monto_efectivo:      Number(liq.monto_efectivo) || 0,
  };
}

// Lo que importa es si la empresa recibe su factura (monotributista) o no.
// La situación impositiva personal del empleado es irrelevante para el módulo.
export const TIPOS_CONTRATACION = [
  { id: "relacion_dependencia", label: "Relación de dependencia" },
  { id: "monotributista",       label: "Factura a la empresa (monotributista)" },
];

// ── Datos maestros desde BIGG Numbers ────────────────────────────────────────

const BANDERA = { AR: "🇦🇷", ES: "🇪🇸", CL: "🇨🇱", CO: "🇨🇴", COL: "🇨🇴", MX: "🇲🇽", UY: "🇺🇾", PE: "🇵🇪", BR: "🇧🇷" };

export async function fetchSociedadesNumbers() {
  const rows = await get("nb_sociedades", {}, BASE_NB);
  return (Array.isArray(rows) ? rows : []).map(r => ({
    id:      r.id ?? r.nombre,
    nombre:  r.nombre ?? r.id,
    pais:    r.pais ?? "AR",
    bandera: r.bandera || BANDERA[r.pais] || "🌐",
  }));
}

export async function fetchPaises() {
  const socs = await fetchSociedadesNumbers();
  const seen = new Set();
  return socs.filter(s => {
    if (seen.has(s.pais)) return false;
    seen.add(s.pais);
    return true;
  }).map(s => ({ pais: s.pais, bandera: s.bandera }));
}

export async function fetchCentrosCostoNumbers() {
  const rows = await get("nb_centros_costo", {}, BASE_NB);
  return (Array.isArray(rows) ? rows : []).map(r => ({
    id:            r.id ?? r.nombre,
    nombre:        r.nombre ?? r.id,
    sociedad:      r.sociedad ?? "",
    pais:          r.pais ?? "",
    bigg_eye_id:   r.bigg_eye_id ? Number(r.bigg_eye_id) : null,
  }));
}

export async function fetchCuentasContablesNumbers() {
  const rows = await get("nb_cuentas", {}, BASE_NB);
  return (Array.isArray(rows) ? rows : []).map(r => ({
    id:     r.id ?? "",
    nombre: r.nombre ?? r.id ?? "",
    tipo:   r.tipo ?? "",
  }));
}

export async function fetchCuentasBancariasNumbers() {
  const rows = await get("nb_cuentas_bancarias", {}, BASE_NB);
  return (Array.isArray(rows) ? rows : []).map(r => ({
    id:       r.id ?? r.nombre,
    nombre:   r.nombre ?? r.id,
    sociedad: r.sociedad ?? "",
    tipo:     r.tipo ?? "",
    moneda:   r.moneda ?? "ARS",
  }));
}

// ── Categorías ────────────────────────────────────────────────────────────────

export async function fetchCategorias(mes, anio, pais) {
  const rows = await get("su_categorias");
  return (Array.isArray(rows) ? rows : [])
    .filter(r => Number(r.mes) === Number(mes) && Number(r.anio) === Number(anio) && r.pais === pais)
    .map(r => ({ id: r.id, concepto: r.concepto ?? "", monto: Number(r.monto) || 0 }));
}

export async function fetchAllConceptos(pais) {
  const rows = await get("su_categorias");
  const filtered = (Array.isArray(rows) ? rows : []).filter(r => !pais || r.pais === pais);
  return [...new Set(filtered.map(r => r.concepto).filter(Boolean))].sort();
}

export async function saveCategorias(mes, anio, pais, rows) {
  const existing = await fetchCategorias(mes, anio, pais);
  for (const r of existing) {
    await post({ action: "del", sheet: "su_categorias", id: r.id });
  }
  for (const r of rows) {
    if (!r.concepto.trim()) continue;
    await post({ action: "add", sheet: "su_categorias", row: {
      id: newId("CAT"), mes, anio, pais,
      concepto: r.concepto.trim(),
      monto: Number(r.monto) || 0,
      created_at: new Date().toISOString(),
    }});
  }
}

// ── Objetivos ─────────────────────────────────────────────────────────────────

export async function fetchObjetivos(mes, anio, pais) {
  const rows = await get("su_objetivos");
  return (Array.isArray(rows) ? rows : [])
    .filter(r => Number(r.mes) === Number(mes) && Number(r.anio) === Number(anio) && r.pais === pais)
    .map(r => ({
      id:          r.id,
      sede_id:     r.sede_id     ?? "",
      sede_nombre: r.sede_nombre ?? "",
      porcentaje:  Number(r.porcentaje) || 0,
    }));
}

export async function saveObjetivos(mes, anio, pais, rows) {
  const existing = await fetchObjetivos(mes, anio, pais);
  for (const r of existing) {
    await post({ action: "del", sheet: "su_objetivos", id: r.id });
  }
  for (const r of rows) {
    if (!r.sede_id) continue;
    await post({ action: "add", sheet: "su_objetivos", row: {
      id: newId("OBJ"), mes, anio, pais,
      sede_id:     r.sede_id,
      sede_nombre: r.sede_nombre,
      porcentaje:  Number(r.porcentaje) || 0,
      created_at:  new Date().toISOString(),
    }});
  }
}

// ── Liquidación Sedes (reutiliza su_liquidaciones, filtra por pais + ROLES_SEDES) ──

// Mapea un objeto con nombres legacy (fila gorda raw o liqFromLineas) a la forma
// interna que usa la pantalla de Sedes (horas, q_cdp, asignado, c_grupo_pct, total…).
function mapRowToSedes(r) {
  return {
    id:              r.id,
    mes:             Number(r.mes),
    anio:            Number(r.anio),
    pais:            r.pais            ?? "",
    legajo_id:       r.legajo_id       ?? "",
    legajo_nombre:   r.legajo_nombre   ?? "",
    sociedad_id:     r.sociedad_id     ?? "",
    sociedad_nombre: r.sociedad_nombre ?? "",
    sede_id:         r.sede_id         ?? "",
    sede_nombre:     r.sede_nombre     ?? "",
    rol:             normalizarRol(r.rol),
    horas:           Number(r.horas_cant)      || 0,
    horas_feriados:  Number(r.feriados_cant)   || 0,
    horas_domingos:  Number(r.domingos_cant)   || 0,
    horas_yoga:      Number(r.yoga_cant)       || 0,
    horas_running:   Number(r.running_cant)    || 0,
    q_cdp_coach:         Number(r.cdp_coach_cant)    || 0,
    q_cdp_front:         Number(r.cdp_front_cant ?? r.cdp_cant) || 0,  // legacy "CDP" → front
    q_one_shot:          Number(r.one_shot_cant)     || 0,
    asignado:            Number(r.objetivos_total)   || 0,
    c_grupo_pct:         Number(r.bonos_cant)        || 0,   // % ingresado por el usuario
    redondeo:        Number(r.redondeo_total)  || 0,   // aumento por redondeo del efectivo (congelado al cerrar)
    sueldo_base:     Number(r.sueldo_base)     || 0,
    total:           Number(r.total_bruto)     || 0,
    monto_haberes:       Number(r.monto_haberes)       || 0,
    monto_deposito:      Number(r.monto_deposito)      || 0,
    monto_transferencia: Number(r.monto_transferencia) || 0,
    monto_efectivo:      Number(r.monto_efectivo)      || 0,
    estado:          r.estado ?? "borrador",
  };
}

export async function fetchLiquidacionesSedes(mes, anio, pais) {
  const rows = await get("su_liquidaciones", { mes, anio });
  const arr = Array.isArray(rows) ? rows : [];
  const allRoles = [...ROLES_COACHES, ...ROLES_FRONT, ...ROLES_LIMP];
  const enPeriodo = (r) => Number(r.mes) === Number(mes) && Number(r.anio) === Number(anio) && r.pais === pais;

  // Legacy (fila gorda): mapear directo si está en período y es rol Sedes.
  const out = arr
    .filter(r => !r.id_liq && enPeriodo(r) && allRoles.includes(normalizarRol(r.rol)))
    .map(mapRowToSedes);

  // Nuevo (líneas): agrupar por id_liq, proyectar y mapear a la forma Sedes.
  for (const [idLiq, ls] of _agruparPorLiq(arr.filter(r => r.id_liq && enPeriodo(r)))) {
    const liq = liqFromLineas(idLiq, ls);
    if (allRoles.includes(liq.rol)) out.push(mapRowToSedes(liq));
  }
  return out;
}

export async function deleteLiquidacionSede(id) {
  await post({ action: "del", sheet: "su_liquidaciones", id });
}

/** Calcula el total bruto de una liquidación de sedes sumando todos los conceptos. */
export function calcTotalBruto(liq) {
  return (
    (liq.sueldo_base        || 0) +
    (liq.horas_total        || 0) +
    (liq.cdp_total          || 0) +
    (liq.one_shot_total     || 0) +
    (liq.objetivos_total    || 0) +
    (liq.feriados_total     || 0) +
    (liq.programacion_total || 0) +
    (liq.bonos_total        || 0) +
    (liq.total_novedades_extra || 0) +
    (liq.total_rendiciones  || 0) -
    (liq.total_anticipos    || 0)
  );
}
