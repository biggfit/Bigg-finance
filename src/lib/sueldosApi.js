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

async function post(payload, base = BASE) {
  // Invalidar cache de la hoja afectada
  const sheet = payload.sheet ?? payload.resource ?? "";
  for (const k of _cache.keys()) {
    if (k.includes(`resource=${sheet}`) || k.includes(`/${sheet}`)) _cache.delete(k);
  }

  const res = await fetch(base, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ ...payload, token: TOKEN }),
  });
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data;
}

function newId(prefix = "SU") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

// ── LEGAJOS ───────────────────────────────────────────────────────────────────

export async function fetchLegajos() {
  const rows = await get("su_legajos");
  return (Array.isArray(rows) ? rows : []).map(r => ({
    id:                  r.id,
    nombre:              r.nombre ?? "",
    cuil:                r.cuil ?? "",
    cbu:                 r.cbu ?? "",
    banco:               r.banco ?? "",
    sociedad_id:         r.sociedad_id ?? "",
    sociedad_nombre:     r.sociedad_nombre ?? "",
    sede_id:             r.sede_id ?? "",
    sede_nombre:         r.sede_nombre ?? "",
    rol:                 r.rol ?? "",
    tipo_contratacion:   r.tipo_contratacion ?? "relacion_dependencia",
    blanco_neto:         Number(r.blanco_neto)   || 0,
    sueldo_total:        Number(r.sueldo_total)  || 0,
    tarifa_hora:         Number(r.tarifa_hora)   || 0,
    activo:              String(r.activo ?? "true").toLowerCase() !== "false",
    fecha_ingreso:       r.fecha_ingreso ?? "",
    fecha_alta:          r.fecha_alta ?? "",
    notas:               r.notas ?? "",
  }));
}

export async function appendLegajo(data) {
  const id = newId("LEG");
  await post({
    action: "add", sheet: "su_legajos",
    row: { id, ...data, created_at: new Date().toISOString() },
  });
  return id;
}

export async function updateLegajo(id, data) {
  await post({ action: "upd", sheet: "su_legajos", id, row: data });
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
    rol:                   r.rol ?? "",
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
    // HQ extras
    monto_haberes:         num(r.monto_haberes),
    monto_monotributo:     num(r.monto_monotributo),
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
  await post({ action: data.id ? "upd" : "add", sheet: "su_liquidaciones", id, row: { id, ...data } });
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
    nb_movimiento_id:         r.nb_movimiento_id ?? "",
    concepto:                 r.concepto ?? "",
    registrado_por:           r.registrado_por ?? "",
  }));
}

/**
 * Registra un pago real. Crea la fila en su_pagos Y un nb_movimientos en Numbers (Tesorería).
 */
export async function appendPago({
  mes, anio, legajo_id, legajo_nombre, sociedad_id, sociedad_nombre,
  tipo_componente, monto, fecha, cuenta_bancaria_id, cuenta_bancaria_nombre,
  centro_costo = "", concepto = "", registrado_por = "",
}) {
  // 1. Crear movimiento en Numbers
  const nb_concepto = concepto || `Sueldo ${legajo_nombre} ${mes}/${anio} · ${tipo_componente}`;
  const nbRow = {
    sociedad:        sociedad_id,
    fecha,
    tipo:            "SUELDO",
    cuenta_bancaria: cuenta_bancaria_id,
    moneda:          "ARS",
    monto:           -Math.abs(monto),
    concepto:        nb_concepto,
    centro_costo,
    origen:          "sueldos",
    created_at:      new Date().toISOString(),
  };
  const nbRes = await post({ action: "add", sheet: "nb_movimientos", row: nbRow }, BASE_NB);
  const nb_movimiento_id = nbRes?.id ?? "";

  // 2. Crear registro en su_pagos
  const id = newId("PAG");
  await post({
    action: "add", sheet: "su_pagos",
    row: {
      id, mes, anio, legajo_id, legajo_nombre,
      sociedad_id, sociedad_nombre,
      tipo_componente, monto, fecha,
      cuenta_bancaria_id, cuenta_bancaria_nombre,
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

// ── CONSTANTES ────────────────────────────────────────────────────────────────

export const ROLES_SEDES = ["COACH_SENIOR", "COACH", "ENCARGADO", "VENTAS", "LIMPIEZA"];
export const ROLES_HQ    = ["HQ", "HQ_OWNER"];

// Lo que importa es si la empresa recibe su factura (monotributista) o no.
// La situación impositiva personal del empleado es irrelevante para el módulo.
export const TIPOS_CONTRATACION = [
  { id: "relacion_dependencia", label: "Relación de dependencia" },
  { id: "monotributista",       label: "Factura a la empresa (monotributista)" },
];

// ── Datos maestros desde BIGG Numbers ────────────────────────────────────────

export async function fetchSociedadesNumbers() {
  const rows = await get("nb_sociedades", {}, BASE_NB);
  return (Array.isArray(rows) ? rows : []).map(r => ({
    id:     r.id ?? r.nombre,
    nombre: r.nombre ?? r.id,
  }));
}

export async function fetchCentrosCostoNumbers() {
  const rows = await get("nb_centros_costo", {}, BASE_NB);
  return (Array.isArray(rows) ? rows : []).map(r => ({
    id:       r.id ?? r.nombre,
    nombre:   r.nombre ?? r.id,
    sociedad: r.sociedad ?? "",
  }));
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
