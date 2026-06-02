// src/lib/sueldosApi.js
// Data layer para el módulo de Sueldos.
// Backend: Google Apps Script → Google Sheet "BIGG Sueldos"
// Proxy local/Vercel: /api/sueldos

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

async function get(sheet, params = {}, base = BASE) {
  const qs = new URLSearchParams({ resource: sheet, token: TOKEN, ...params }).toString();
  const key = `${base}?${qs}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  if (_inflight.has(key)) return _inflight.get(key);

  const p = fetch(`${base}?${qs}`)
    .then(r => r.json())
    .then(data => {
      _cache.set(key, { data, ts: Date.now() });
      _inflight.delete(key);
      return data;
    })
    .catch(e => { _inflight.delete(key); throw e; });

  _inflight.set(key, p);
  return p;
}

async function post(payload, base = BASE, { retries = 2, retryDelayMs = 1200 } = {}) {
  const sheet = payload.sheet ?? payload.resource ?? "";
  for (const k of _cache.keys()) {
    if (k.includes(`resource=${sheet}`) || k.includes(`/${sheet}`)) _cache.delete(k);
  }

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

// ── Formas de pago (receta de cobro por empleado) ─────────────────────────────
// Cada línea: { id, tipo, importe, banco, tipo_cuenta, cuenta, cbu, cuit, nota }
// tipo ∈ haberes | deposito | transferencia | efectivo
export const FP_TIPOS = ["haberes", "deposito", "transferencia", "transferencia_financiera", "monotributo", "efectivo"];
export const FP_TIPO_LABEL = {
  haberes: "Haberes",
  deposito: "Depósito",
  transferencia: "Transf. (nuestra)",
  transferencia_financiera: "Transf. financiera",
  monotributo: "Monotributo",
  efectivo: "Efectivo",
};
export const FP_TIPO_COLOR = {
  haberes: "#1e293b",
  deposito: "#0369a1",
  transferencia: "#7c3aed",
  transferencia_financiera: "#0d9488",
  monotributo: "#db2777",
  efectivo: "#ca8a04",
};

// Tipos que se pagan como transferencia (el usuario elige la sociedad de origen al pagar).
const FP_TRANSFER_TIPOS = ["transferencia", "transferencia_financiera", "monotributo"];
export const esTransferencia = (tipo) => FP_TRANSFER_TIPOS.includes(tipo);

// Cada tipo de línea cae en uno de los 4 baldes escalares persistidos (compatibilidad).
const FP_SCALAR_BUCKET = {
  haberes: "haberes",
  deposito: "deposito",
  transferencia: "transferencia",
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

// Suma los importes de las líneas agrupados por tipo de componente.
export function sumByTipo(lineas = []) {
  const acc = { haberes: 0, deposito: 0, transferencia: 0, efectivo: 0 };
  for (const l of lineas) {
    const bucket = FP_SCALAR_BUCKET[l.tipo] ?? "deposito";
    acc[bucket] += Number(l.importe) || 0;
  }
  acc.total = acc.haberes + acc.deposito + acc.transferencia + acc.efectivo;
  return acc;
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
  return (Array.isArray(rows) ? rows : []).map(parseLiquidacion);
}

function parseLiquidacion(r) {
  const num = (v) => Number(v) || 0;
  return {
    id:                    r.id,
    mes:                   r.mes,
    anio:                  r.anio,
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

export async function saveLiquidacion(data) {
  const id = data.id ?? newId("LIQ");
  const row = { id, ...withFormasPagoJson(data) };
  // Si vienen líneas de pago, derivar los escalares monto_* para compatibilidad
  // con PasoPagos, exports Galicia y su_pagos (fuente de verdad = las líneas).
  if ("formas_pago" in data) {
    const s = sumByTipo(data.formas_pago);
    row.monto_haberes       = s.haberes;
    row.monto_deposito      = s.deposito;
    row.monto_transferencia = s.transferencia;
    row.monto_efectivo      = s.efectivo;
  }
  await post({ action: data.id ? "upd" : "add", sheet: "su_liquidaciones", id, row });
  return id;
}

export async function deleteLiquidacion(id) {
  await post({ action: "del", sheet: "su_liquidaciones", id });
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
    tipo:                    r.tipo ?? "extra",       // extra | anticipo | rendicion
    descripcion:             r.descripcion ?? "",
    monto:                   Number(r.monto) || 0,
    cuenta_contable_id:      r.cuenta_contable_id ?? "",
    cuenta_contable_nombre:  r.cuenta_contable_nombre ?? "",
  }));
}

export async function appendNovedad(data) {
  const id = newId("NOV");
  await post({ action: "add", sheet: "su_novedades", row: { id, ...data, created_at: new Date().toISOString() } });
  return id;
}

export async function deleteNovedad(id) {
  await post({ action: "del", sheet: "su_novedades", id });
}

// ── PAGOS ─────────────────────────────────────────────────────────────────────

export async function fetchPagos(mes, anio) {
  const rows = await get("su_pagos", { mes, anio });
  return (Array.isArray(rows) ? rows : []).map(r => ({
    id:                       r.id,
    mes:                      r.mes,
    anio:                     r.anio,
    pais:                     r.pais ?? "",
    legajo_id:                r.legajo_id ?? "",
    legajo_nombre:            r.legajo_nombre ?? "",
    sociedad_id:              r.sociedad_id ?? "",
    sociedad_nombre:          r.sociedad_nombre ?? "",
    // haberes | monotributista | efectivo | rendicion
    tipo_componente:          r.tipo_componente ?? "haberes",
    monto:                    Number(r.monto) || 0,
    fecha:                    r.fecha ?? "",
    cuenta_bancaria_id:       r.cuenta_bancaria_id ?? "",
    cuenta_bancaria_nombre:   r.cuenta_bancaria_nombre ?? "",
    forma_pago_id:            r.forma_pago_id ?? "",
    nb_movimiento_id:         r.nb_movimiento_id ?? "",
    concepto:                 r.concepto ?? "",
    registrado_por:           r.registrado_por ?? "",
  }));
}

/**
 * Registra un pago real. Crea la fila en su_pagos Y un nb_movimientos en Numbers (Tesorería).
 */
export async function appendPago({
  mes, anio, pais = "", legajo_id, legajo_nombre, sociedad_id, sociedad_nombre,
  tipo_componente, monto, fecha, cuenta_bancaria_id, cuenta_bancaria_nombre,
  cuenta_contable_id = "", cuenta_contable_nombre = "",
  forma_pago_id = "",
  centro_costo = "", concepto = "", registrado_por = "",
}) {
  // 1. Crear movimiento en Numbers
  const nb_concepto = concepto || `Sueldo ${legajo_nombre} ${mes}/${anio} · ${tipo_componente}`;
  const nb_movimiento_id = newId("MOV");
  const nbRow = {
    id:              nb_movimiento_id,
    sociedad:        sociedad_id,
    fecha,
    tipo:            "SUELDO",
    cuenta_bancaria: cuenta_bancaria_id,
    cuenta_contable: cuenta_contable_id,
    moneda:          "ARS",
    monto:           -Math.abs(monto),
    concepto:        nb_concepto,
    centro_costo,
    origen:          "sueldos",
    created_at:      new Date().toISOString(),
  };
  await post({ action: "add", sheet: "nb_movimientos", row: nbRow }, BASE_NB);

  // 2. Crear registro en su_pagos
  const id = newId("PAG");
  await post({
    action: "add", sheet: "su_pagos",
    row: {
      id, mes, anio, pais, legajo_id, legajo_nombre,
      sociedad_id, sociedad_nombre,
      tipo_componente, monto, fecha,
      cuenta_bancaria_id, cuenta_bancaria_nombre,
      forma_pago_id,
      nb_movimiento_id, concepto: nb_concepto, registrado_por,
      created_at: new Date().toISOString(),
    },
  });

  return { id, nb_movimiento_id };
}

export async function deletePago(id, nb_movimiento_id) {
  await Promise.all([
    post({ action: "del", sheet: "su_pagos", id }),
    nb_movimiento_id
      ? post({ action: "del", sheet: "nb_movimientos", id: nb_movimiento_id }, BASE_NB)
      : null,
  ].filter(Boolean));
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
export async function fetchHorasDesdeEye(mes, anio, pais = "", locationIds = []) {
  const qs = new URLSearchParams({ month: mes, year: anio, ...(pais ? { pais } : {}) });
  if (locationIds.length > 0) qs.set("location_ids", locationIds.join(","));
  const res  = await fetch(`/api/bigg-eye-horas?${qs}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Trae las conversiones CDP y one-shots por coach desde Bigg Eye.
 * Devuelve { items: [{ coach_name, location_id, location_name, cdp_count, one_shot_count }] }
 */
export async function fetchCdpDesdeEye(mes, anio, pais = "", locationIds = []) {
  const qs = new URLSearchParams({ month: mes, year: anio, ...(pais ? { pais } : {}) });
  if (locationIds.length > 0) qs.set("location_ids", locationIds.join(","));
  const res  = await fetch(`/api/bigg-eye-cdp?${qs}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data;
}

// ── CONSTANTES ────────────────────────────────────────────────────────────────

export const ROLES_SEDES   = ["COACH_SENIOR", "COACH", "BOTANICO", "ENCARGADO", "VENTAS", "LIMPIEZA"];
export const ROLES_COACHES = ["COACH_SENIOR", "COACH", "BOTANICO"];
export const ROLES_FRONT   = ["ENCARGADO", "VENTAS"];
export const ROLES_LIMP    = ["LIMPIEZA"];
export const ROLES_HQ      = ["HQ", "HQ_OWNER", "HQ_EXT"];

// Mapeo rol → concepto en su_categorias
export const ROL_CONCEPTO = {
  COACH_SENIOR: "COACH SENIOR",
  COACH:        "BIGG COACH",
  BOTANICO:     "BOTÁNICO",
};

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

export async function fetchLiquidacionesSedes(mes, anio, pais) {
  const rows = await get("su_liquidaciones", { mes, anio });
  const allRoles = [...ROLES_COACHES, ...ROLES_FRONT, ...ROLES_LIMP];
  return (Array.isArray(rows) ? rows : [])
    .filter(r =>
      Number(r.mes) === Number(mes) &&
      Number(r.anio) === Number(anio) &&
      r.pais === pais &&
      allRoles.includes(r.rol)
    )
    .map(r => ({
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
      q_cdp:               Number(r.cdp_cant)          || 0,
      q_one_shot:          Number(r.one_shot_cant)     || 0,
      asignado:            Number(r.objetivos_total)   || 0,
      c_grupo_pct:         Number(r.bonos_cant)        || 0,   // % ingresado por el usuario
      comision_encargado:  Number(r.programacion_total)|| 0,
      sueldo_base:     Number(r.sueldo_base)     || 0,
      total:           Number(r.total_bruto)     || 0,
      monto_haberes:       Number(r.monto_haberes)       || 0,
      monto_deposito:      Number(r.monto_deposito)      || 0,
      monto_transferencia: Number(r.monto_transferencia) || 0,
      monto_efectivo:      Number(r.monto_efectivo)      || 0,
      estado:          r.estado ?? "borrador",
    }));
}

export async function upsertLiquidacionSede(row) {
  // Treat as new if id is missing OR has a "new-" prefix (local-only placeholder)
  const isNew = !row.id || String(row.id).startsWith("new-") || String(row._id ?? "").startsWith("new-");
  const data = {
    mes: row.mes, anio: row.anio, pais: row.pais,
    legajo_id: row.legajo_id, legajo_nombre: row.legajo_nombre,
    sociedad_id: row.sociedad_id, sociedad_nombre: row.sociedad_nombre,
    sede_id: row.sede_id, sede_nombre: row.sede_nombre,
    rol: row.rol,
    horas_cant:          Number(row.horas)              || 0,
    feriados_cant:       Number(row.horas_feriados)     || 0,
    cdp_cant:            Number(row.q_cdp)               || 0,
    one_shot_cant:       Number(row.q_one_shot)          || 0,
    one_shot_total:      Number(row.one_shot_total)      || 0,
    objetivos_total:     Number(row.asignado)            || 0,
    bonos_cant:          Number(row.c_grupo_pct)          || 0,   // % ingresado
    bonos_total:         Number(row.c_grupo_total)        || 0,   // $ calculado (lo pasa el caller)
    programacion_total:  Number(row.comision_encargado)  || 0,
    sueldo_base:         Number(row.sueldo_base)        || 0,
    total_bruto:         Number(row.total)              || 0,
    monto_haberes:       Number(row.monto_haberes)       || 0,
    monto_deposito:      Number(row.monto_deposito)      || 0,
    monto_transferencia: Number(row.monto_transferencia) || 0,
    monto_efectivo:      Number(row.monto_efectivo)      || 0,
    estado:              row.estado ?? "borrador",
  };
  if (isNew) {
    const id = newId("LIQ-S");
    await post({ action: "add", sheet: "su_liquidaciones", row: { id, ...data, created_at: new Date().toISOString() } });
    return id;   // caller stamps local state so re-saves do upd, not add
  } else {
    try {
      await post({ action: "upd", sheet: "su_liquidaciones", id: row.id, row: data });
    } catch (e) {
      // Row missing in Sheets (deleted, or never written due to a GAS race on a previous save).
      // Re-insert with the same id so future saves keep updating the same row.
      if (/no encontrado|not found/i.test(e.message)) {
        await post({ action: "add", sheet: "su_liquidaciones", row: { id: row.id, ...data, created_at: new Date().toISOString() } });
      } else {
        throw e;
      }
    }
    return row.id;
  }
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
