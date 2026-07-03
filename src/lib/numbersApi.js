// ─── BIGG Numbers — API layer (Google Sheets via Apps Script) ────────────────
// Proxy: /api/numbers  →  Apps Script Web App  →  Sheet: BIGG Numbers
// Configurar en .env.local:
//   VITE_NUMBERS_API_URL=https://script.google.com/macros/s/.../exec

const CONFIGURED = !!import.meta.env.VITE_NUMBERS_API_URL;
const TOKEN      = import.meta.env.VITE_SHEETS_TOKEN;   // mismo token
const BASE       = "/api/numbers";

// ─── Helpers internos ────────────────────────────────────────────────────────

// Cache de GETs: evita refetch al navegar entre tabs y deduplica requests simultáneos
const _cache    = new Map(); // key → { data, ts }
const _inflight = new Map(); // key → Promise
const CACHE_TTL = 30_000;    // 30 segundos

function _invalidate(sheet) {
  for (const key of _cache.keys()) {
    if (key.startsWith(`resource=${sheet}`)) _cache.delete(key);
  }
}

async function get(resource, params = {}) {
  if (!CONFIGURED) throw new Error("VITE_NUMBERS_API_URL no configurada");
  const qs  = new URLSearchParams({ resource, token: TOKEN, ...params }).toString();
  const key = qs;

  // Devolver cache si es fresco
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  // Deduplicar: si ya hay un request en vuelo para la misma key, reutilizar
  if (_inflight.has(key)) return _inflight.get(key);

  const req = (async () => {
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(`${BASE}?${qs}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        _cache.set(key, { data, ts: Date.now() });
        return data;
      } catch (e) {
        lastErr = e;
        if (i < 2) await new Promise(r => setTimeout(r, (i + 1) * 600));
      }
    }
    throw lastErr;
  })();

  _inflight.set(key, req);
  req.finally(() => _inflight.delete(key));
  return req;
}

async function post(body) {
  if (!CONFIGURED) throw new Error("VITE_NUMBERS_API_URL no configurada");
  const res = await fetch(BASE, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ ...body, token: TOKEN }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  // Invalidar cache del sheet afectado
  if (body.sheet) _invalidate(body.sheet);
  return data;
}

// ─── Generador de IDs ────────────────────────────────────────────────────────

const pad  = (n, l = 5) => String(n).padStart(l, "0");

// Contador de sesión: garantiza unicidad aunque se generen varios ids en el mismo
// milisegundo (ej. loop de ingesta de 285 líneas) o al re-subir. El componente de
// tiempo agrega entropía entre sesiones; el `_seq` asegura que NUNCA se repita dentro
// de una. (Antes: solo Date.now()%100000 → colisionaba y dejaba filas con id duplicado.)
let _seq = 0;
function newId(prefix) {
  return `${prefix}-${pad(Date.now() % 100000)}-${_seq++}`;
}

/**
 * Convierte un valor numérico que puede venir de Sheets como string con coma decimal
 * (ej: "362591,17" → 362591.17, "1.234,56" → 1234.56).
 * Si no contiene coma, lo trata como formato estándar (punto decimal o entero).
 */
function toNum(v) {
  if (typeof v === "number") return v;
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).trim();
  // Formato argentino: coma como separador decimal → strip puntos de miles, reemplazar coma
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", ".")) || 0;
  return Number(s) || 0;
}

/** Formatea un ID largo para mostrar en tabla (últimos 5 dígitos del número) */
export function shortId(id) {
  if (!id) return "—";
  const parts = id.split("-");
  const prefix = parts[0];
  const num = parts[parts.length - 1];
  return `${prefix}-${num.slice(-5)}`;
}

// ─── EGRESOS ─────────────────────────────────────────────────────────────────
//
// Schema nb_comprobantes (una fila por imputación de CC):
//   id | id_comp | sociedad | fecha | vto | subtipo | contraparte_id | contraparte_nombre |
//   cuenta_contable | cuenta_contable_id | moneda | centro_costo |
//   subtotal | iva_rate | iva_monto | total | nro_comp | nota | created_at
//
// id_comp es el identificador del documento (puede repetirse si hay varias líneas de CC).
// id es único por fila (usado para edit/del individual).
// subtipo: "EGRESO_FC" | "INGRESO_FC" | "GASTO"

/**
 * Trae todos los egresos de una sociedad (EGRESO_FC + GASTO).
 * Devuelve documentos agrupados (un objeto con array `lineas`).
 */
export async function fetchEgresos(sociedad) {
  const rows = await get("nb_comprobantes", { sociedad });
  const egRows = rows.filter(r => (r.subtipo ?? "").toUpperCase() === "EGRESO");
  return _agruparPorComp(egRows, "EGRESO");
}

/**
 * Guarda un egreso nuevo (puede tener varias líneas de CC).
 * Escribe una fila por línea en nb_comprobantes.
 */
export async function appendEgreso(egreso) {
  const { lineas = [], ...header } = egreso;
  const id_comp    = header.id || newId("EG");
  const created_at = new Date().toISOString();

  for (let i = 0; i < lineas.length; i++) {
    const l   = lineas[i];
    const sub = Number(l.subtotal) || 0;
    const iva = sub * ((Number(l.ivaRate) || 0) / 100);
    await post({
      action: "add",
      sheet:  "nb_comprobantes",
      row: {
        id:                  `${id_comp}-L${pad(i + 1)}`,
        id_comp,
        sociedad:            header.sociedad,
        fecha:               header.fecha,
        vto:                 header.vto ?? "",
        subtipo:             "EGRESO",
        contraparte_id:      header.proveedorId ?? "",
        contraparte_nombre:  header.proveedor   ?? "",
        cuenta_contable:     header.cuenta      ?? "",
        cuenta_contable_id:  header.cuentaId    ?? "",
        moneda:              header.moneda ?? "ARS",
        centro_costo:        l.cc ?? "",
        subtotal:            sub,
        iva_rate:            Number(l.ivaRate) || 0,
        iva_monto:           iva,
        total:               sub + iva,
        nro_comp:            header.nroComp ?? "",
        nota:                header.nota    ?? "",
        created_at,
      },
    });
  }
  return { ok: true, id_comp };
}

/**
 * Resumen de tarjeta de crédito → un egreso (nb_comprobantes) POR MONEDA.
 * Cada línea lleva sus dimensiones: cuenta + centro + titular + comercio (nota) + moneda + monto.
 * Las líneas se agrupan por moneda; cada grupo es un id_comp (CxP) propio, escrito en UN add_batch.
 * Sin IVA discriminado: los impuestos del resumen son sus propias líneas (con su cuenta de impuesto).
 * La contraparte es la tarjeta (proveedor "^Tarjeta") → la CxP agrupa como "Tarjeta de crédito".
 */
export async function appendResumenTarjeta({ sociedad, tarjetaId = "", tarjeta = "", periodo = "", fecha, vto = "", lineas = [] }) {
  const created_at = new Date().toISOString();
  const porMoneda = {};
  for (const l of lineas) (porMoneda[l.moneda || "ARS"] ??= []).push(l);

  const ids = [];
  for (const [moneda, ls] of Object.entries(porMoneda)) {
    const id_comp = newId("TAR");
    const rows = ls.map((l, i) => {
      const monto = Number(l.monto) || 0;
      return {
        id: `${id_comp}-L${pad(i + 1)}`, id_comp,
        sociedad, fecha, vto, subtipo: "EGRESO",
        contraparte_id: tarjetaId, contraparte_nombre: tarjeta,
        cuenta_contable: l.cuenta ?? "", cuenta_contable_id: l.cuentaId ?? "",
        moneda, centro_costo: l.cc ?? "",
        subtotal: monto, iva_rate: 0, iva_monto: 0, total: monto,
        nro_comp: `${tarjeta} ${periodo}`.trim(), nota: l.comercio ?? "",
        titular: l.titular ?? "",
        created_at,
      };
    });
    await post({ action: "add_batch", sheet: "nb_comprobantes", rows });
    ids.push({ moneda, id_comp });
  }
  return { ok: true, ids };
}

/** Elimina todas las líneas de un egreso (por id_comp). */
export async function deleteEgreso(id_comp) {
  return post({ action: "del_comp", sheet: "nb_comprobantes", id_comp });
}

// ─── INGRESOS ────────────────────────────────────────────────────────────────

export async function fetchIngresos(sociedad) {
  const rows = await get("nb_comprobantes", { sociedad });
  const inRows = rows.filter(r => (r.subtipo ?? "").toUpperCase() === "INGRESO");
  return _agruparPorComp(inRows, "INGRESO");
}

export async function appendIngreso(ingreso) {
  const { lineas = [], ...header } = ingreso;
  const id_comp    = header.id || newId("IN");
  const created_at = new Date().toISOString();

  for (let i = 0; i < lineas.length; i++) {
    const l   = lineas[i];
    const sub = Number(l.subtotal) || 0;
    const iva = sub * ((Number(l.ivaRate) || 0) / 100);
    await post({
      action: "add",
      sheet:  "nb_comprobantes",
      row: {
        id:                  `${id_comp}-L${pad(i + 1)}`,
        id_comp,
        sociedad:            header.sociedad,
        fecha:               header.fecha,
        vto:                 header.vto ?? "",
        subtipo:             "INGRESO",
        contraparte_id:      header.clienteId ?? "",
        contraparte_nombre:  header.cliente   ?? "",
        cuenta_contable:     header.cuenta    ?? "",
        cuenta_contable_id:  header.cuentaId  ?? "",
        moneda:              header.moneda ?? "ARS",
        centro_costo:        l.cc ?? "",
        subtotal:            sub,
        iva_rate:            Number(l.ivaRate) || 0,
        iva_monto:           iva,
        total:               sub + iva,
        nro_comp:            header.nroComp ?? "",
        nota:                header.nota    ?? "",
        created_at,
      },
    });
  }
  return { ok: true, id_comp };
}

export async function deleteIngreso(id_comp) {
  return post({ action: "del_comp", sheet: "nb_comprobantes", id_comp });
}

// ─── PAGOS / COBROS ──────────────────────────────────────────────────────────
//
// Schema nb_movimientos (unifica pagos_cobros + mov_tesoreria):
//   id | sociedad | fecha | tipo | cuenta_bancaria | cuenta_destino |
//   cuenta_contable | centro_costo | moneda | monto | documento_id |
//   concepto | referencia | origen | created_at
//
// tipo:   "INGRESO" | "EGRESO" | "TRANSFERENCIA" | "PAGO" | "COBRO"
// monto:  firmado — PAGO/EGRESO = negativo, COBRO/INGRESO = positivo
// origen: "manual" | "pago" | "cobro"
// documento_id: id_comp del comprobante vinculado (solo para PAGO/COBRO)

/** Trae todos los pagos/cobros de una sociedad (filtra nb_movimientos por tipo). */
export async function fetchPagosCobros(sociedad) {
  const movs = await get("nb_movimientos", { sociedad });
  return movs.filter(m => m.tipo === "PAGO" || m.tipo === "COBRO" || m.tipo === "EGRESO_GASTO");
}

/**
 * Registra un pago contra un egreso.
 * Escribe directamente en nb_movimientos (monto negativo).
 */
export async function appendPago({ documento_id, sociedad, fecha, monto, moneda, cuenta_bancaria, cuenta = "", referencia, nota, centro_costo = "" }) {
  const id = newId("PAG");
  return post({
    action: "add", sheet: "nb_movimientos",
    row: {
      id, sociedad, fecha,
      tipo:            "PAGO",
      cuenta_bancaria,
      cuenta_destino:  "",
      cuenta_contable: cuenta,
      centro_costo,
      moneda,
      monto:           -Math.abs(monto),
      documento_id,
      concepto:        `Pago ${documento_id}`,
      referencia:      referencia ?? "",
      origen:          "pago",
      created_at:      new Date().toISOString(),
    },
  });
}

/** Registra un cobro contra un ingreso. Escribe en nb_movimientos (monto positivo). */
export async function appendCobro({ documento_id, sociedad, fecha, monto, moneda, cuenta_bancaria, cuenta = "", referencia, nota, centro_costo = "" }) {
  const id = newId("COB");
  return post({
    action: "add", sheet: "nb_movimientos",
    row: {
      id, sociedad, fecha,
      tipo:            "COBRO",
      cuenta_bancaria,
      cuenta_destino:  "",
      cuenta_contable: cuenta,
      centro_costo,
      moneda,
      monto:           Math.abs(monto),
      documento_id,
      concepto:        `Cobro ${documento_id}`,
      referencia:      referencia ?? "",
      origen:          "cobro",
      created_at:      new Date().toISOString(),
    },
  });
}

/** Saldo pendiente de un documento. Usa Math.abs porque PAGOs tienen monto negativo. */
export function calcSaldoPendiente(totalDoc, pagos = []) {
  const totalPagado = pagos.reduce((s, p) => s + Math.abs(Number(p.monto) || 0), 0);
  return Math.max(0, totalDoc - totalPagado);
}

function _hoy() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}
function _parseVto(vtoStr) {
  if (!vtoStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(vtoStr)) return new Date(vtoStr);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(vtoStr)) {
    const [d, m, y] = vtoStr.split("/");
    return new Date(`${y}-${m}-${d}`);
  }
  return null;
}

export function calcEstadoEgreso(saldo, totalDoc, vtoStr) {
  if (saldo <= 0) return "pagado";
  const vto = _parseVto(vtoStr);
  if (vto && vto < _hoy()) return "vencido";
  return "a_pagar";
}

export function calcEstadoIngreso(saldo, totalDoc, vtoStr) {
  if (saldo <= 0) return "cobrado";
  const vto = _parseVto(vtoStr);
  if (vto && vto < _hoy()) return "vencido";
  return "a_cobrar";
}

// ─── MOVIMIENTOS DE TESORERÍA ─────────────────────────────────────────────────

export async function fetchMovTesoreria(sociedad) {
  // Excluye en la FUENTE las líneas ignoradas (IGN-): así Tesorería, Reportes (Balance/Cash
  // Flow/PN) y Dashboard nunca las cuentan, sin tener que filtrar reporte por reporte.
  const rows = await get("nb_movimientos", { sociedad });
  return rows.filter(m => !esIgnorado(m));
}

export async function appendMovTesoreria({ sociedad, fecha, tipo, cuenta_bancaria, cuenta_destino = "", cuenta = "", concepto, moneda, monto, origen = "manual", origen_id = "", centro_costo = "" }) {
  const id = newId("MOV");
  return post({
    action: "add", sheet: "nb_movimientos",
    row: {
      id, sociedad, fecha, tipo,
      cuenta_bancaria,
      cuenta_destino,
      cuenta_contable: cuenta,
      centro_costo,
      moneda, monto,
      documento_id:    origen_id,
      concepto,
      referencia:      "",
      origen,
      created_at:      new Date().toISOString(),
    },
  });
}

export async function deleteMovTesoreria(id) {
  return post({ action: "del", sheet: "nb_movimientos", id });
}

/**
 * Pago de tarjeta (saldo corriente, admite parciales). Par de movimientos:
 *  - lado real: la caja/banco baja (−monto) → es la salida real de caja.
 *  - lado tarjeta: la cuenta-tarjeta sube (+monto) → baja la deuda.
 * tipo "PAGO_TARJETA" (no TRANSFERENCIA: el Cash Flow no lo filtra; el lado tarjeta se excluye por ser cuenta tipo tarjeta).
 * Si `mov_existente` viene (caso conciliación: la fila del extracto ya es el lado real), se edita esa fila
 * como lado real y solo se crea el lado tarjeta.
 */
export async function pagarTarjeta({ sociedad, fecha, monto, moneda, cuenta_real, tarjeta_id, nota = "", mov_existente = null }) {
  const m    = Math.abs(Number(monto) || 0);
  const pair = newId("PTJ");
  const concepto = nota || "Pago de tarjeta";
  if (mov_existente) {
    await updateMovTesoreria(mov_existente.id, {
      tipo: "PAGO_TARJETA", origen: "pago_tarjeta", documento_id: pair, concepto,
    });
  } else {
    await appendMovTesoreria({ sociedad, fecha, tipo: "PAGO_TARJETA", cuenta_bancaria: cuenta_real, moneda, monto: -m, concepto, origen: "pago_tarjeta", origen_id: pair });
  }
  await appendMovTesoreria({ sociedad, fecha, tipo: "PAGO_TARJETA", cuenta_bancaria: tarjeta_id, moneda, monto: m, concepto, origen: "pago_tarjeta", origen_id: pair });
  return { ok: true, pair };
}

export async function updateMovTesoreria(id, patch) {
  return post({ action: "edit", sheet: "nb_movimientos", id, patch });
}

// ─── PROVEEDORES ─────────────────────────────────────────────────────────────

export async function fetchProveedores() {
  return get("nb_proveedores");
}

export async function appendProveedor(prov) {
  return post({ action: "add", sheet: "nb_proveedores", row: { id: newId("PRV"), ...prov, activo: true, created_at: new Date().toISOString() } });
}

export async function updateProveedor(id, patch) {
  return post({ action: "edit", sheet: "nb_proveedores", id, patch });
}

export async function deleteProveedor(id) {
  return post({ action: "del", sheet: "nb_proveedores", id });
}

// ─── CUENTAS BANCARIAS / CAJAS ───────────────────────────────────────────────

export async function fetchCuentasBancarias() {
  return get("nb_cuentas_bancarias");
}

export async function appendCuentaBancaria(cuenta) {
  const id = newId("CB");
  await post({ action: "add", sheet: "nb_cuentas_bancarias", row: { id, ...cuenta, activo: true, created_at: new Date().toISOString() } });
  return { id };
}

export async function updateCuentaBancaria(id, patch) {
  return post({ action: "edit", sheet: "nb_cuentas_bancarias", id, patch });
}

export async function deleteCuentaBancaria(id) {
  return post({ action: "del", sheet: "nb_cuentas_bancarias", id });
}

export async function fetchAllSaldosIniciales() {
  const movs = await get("nb_movimientos", {});
  return (movs ?? []).filter(m => m.tipo === "SALDO_INICIAL");
}

export async function fetchSaldoInicialMovimiento(cuentaId) {
  const movs = await get("nb_movimientos", {});
  return (movs ?? []).find(m => m.tipo === "SALDO_INICIAL" && m.cuenta_bancaria === cuentaId) ?? null;
}

export async function updateSaldoInicial(rowId, monto, fecha) {
  const patch = fecha ? { monto, fecha } : { monto };
  return post({ action: "edit", sheet: "nb_movimientos", id: rowId, patch });
}

export async function deleteSaldoInicial(rowId) {
  return post({ action: "del", sheet: "nb_movimientos", id: rowId });
}

export async function appendSaldoInicial({ sociedad, cuentaId, moneda, monto, fecha }) {
  const id  = newId("SI");
  const fechaFinal = fecha || new Date().toISOString().slice(0, 10);
  return post({ action: "add", sheet: "nb_movimientos", row: {
    id, sociedad, fecha: fechaFinal, tipo: "SALDO_INICIAL",
    cuenta_bancaria: cuentaId, cuenta_destino: "",
    cuenta_contable: "", centro_costo: "",
    moneda, monto,
    documento_id: id, concepto: "Saldo inicial",
    referencia: "", origen: "maestros",
    created_at: new Date().toISOString(),
  }});
}

// ─── CUENTAS (Plan de Cuentas) ────────────────────────────────────────────────

export async function fetchCuentas() {
  return get("nb_cuentas");
}

export async function appendCuenta(cuenta) {
  return post({ action: "add", sheet: "nb_cuentas", row: { id: newId("CTA"), ...cuenta, activo: true, created_at: new Date().toISOString() } });
}

export async function updateCuenta(id, patch) {
  return post({ action: "edit", sheet: "nb_cuentas", id, patch });
}

export async function deleteCuenta(id) {
  return post({ action: "del", sheet: "nb_cuentas", id });
}

// ─── CLIENTES ────────────────────────────────────────────────────────────────

export async function fetchClientes() {
  return get("nb_clientes");
}

export async function appendCliente(cli) {
  return post({ action: "add", sheet: "nb_clientes", row: { id: newId("CLI"), ...cli, activo: true, created_at: new Date().toISOString() } });
}

export async function updateCliente(id, patch) {
  return post({ action: "edit", sheet: "nb_clientes", id, patch });
}

export async function deleteCliente(id) {
  return post({ action: "del", sheet: "nb_clientes", id });
}

// ─── SOCIEDADES ──────────────────────────────────────────────────────────────

export async function fetchSociedades() {
  return get("nb_sociedades");
}

export async function appendSociedad(soc) {
  const id = soc.id?.trim() || newId("SOC");
  return post({ action:"add", sheet:"nb_sociedades", row:{ ...soc, id, activo:true, created_at:new Date().toISOString() } });
}

export async function updateSociedad(id, patch) {
  return post({ action:"edit", sheet:"nb_sociedades", id, patch });
}

export async function deleteSociedad(id) {
  return post({ action:"del", sheet:"nb_sociedades", id });
}

// ─── CENTROS DE COSTO ────────────────────────────────────────────────────────

export async function fetchCentrosCosto() {
  return get("nb_centros_costo");
}

export async function appendCentroCosto(cc) {
  return post({ action: "add", sheet: "nb_centros_costo", row: { id: newId("CC"), ...cc, activo: true, created_at: new Date().toISOString() } });
}

export async function updateCentroCosto(id, patch) {
  return post({ action: "edit", sheet: "nb_centros_costo", id, patch });
}

export async function deleteCentroCosto(id) {
  return post({ action: "del", sheet: "nb_centros_costo", id });
}

// ─── REGLAS DE BANCO (motor de conciliación) ─────────────────────────────────
// Tabla de customizaciones: cada fila es una regla que clasifica una línea del
// extracto. match_tipo ∈ codigo|glosa|cuenta_servicio|cuit|alias ; scope por banco/sociedad/pais.
export async function fetchBancoReglas({ fresh = false } = {}) {
  if (fresh) _invalidate("nb_banco_reglas");   // ignora el cache de 30s → trae lo último editado
  return get("nb_banco_reglas");
}

export async function appendBancoRegla(regla) {
  return post({ action: "add", sheet: "nb_banco_reglas", row: { id: newId("BR"), ...regla, activo: true, created_at: new Date().toISOString() } });
}

export async function updateBancoRegla(id, patch) {
  return post({ action: "edit", sheet: "nb_banco_reglas", id, patch });
}

export async function deleteBancoRegla(id) {
  return post({ action: "del", sheet: "nb_banco_reglas", id });
}

// ─── GASTO DIRECTO ───────────────────────────────────────────────────────────
//
// Un gasto contado es devengado y caja a la vez → UNA sola fila en nb_movimientos
// (tipo=EGRESO_GASTO, origen="gasto_directo"), imputada (cuenta_contable=NOMBRE +
// centro_costo + IVA + contraparte). El P&L la lee vía adapter (PantallaReportes);
// el Cash Flow ya la leía. NO se crea comprobante (no hay doble escritura).

export async function appendGastoDirecto({ sociedad, fecha, cuenta_contable, cuenta_contable_id = "", cc = "", moneda = "ARS", subtotal, ivaRate = 0, nota = "", cuenta_bancaria, referencia = "", proveedor_id = "", proveedor_nombre = "" }) {
  const created_at = new Date().toISOString();
  const sub  = Number(subtotal) || 0;
  const rate = Number(ivaRate) || 0;       // entero (ej. 21), no fracción
  const iva  = sub * (rate / 100);
  const total = sub + iva;

  const id = newId("GD");
  await post({
    action: "add", sheet: "nb_movimientos",
    row: {
      id,
      sociedad, fecha,
      tipo:               "EGRESO_GASTO",
      cuenta_bancaria,
      cuenta_destino:     "",
      cuenta_contable,                       // NOMBRE (buildPnL busca por nombre)
      centro_costo:       cc,
      moneda,
      monto:              -total,            // bruto (lo que sale del banco)
      documento_id:       "CONTAB-" + id,    // marca devengado-vía-movimiento; si se reimputa a una FC se pisa con el id_comp y sale del P&L
      concepto:           nota || `Gasto directo: ${cuenta_contable}`,
      contraparte_id:     proveedor_id,
      contraparte_nombre: proveedor_nombre,
      iva_rate:           rate,
      iva_monto:          iva,
      referencia,
      origen:             "gasto_directo",
      created_at,
    },
  });

  return { ok: true, id };
}

// ─── CONCILIACIÓN v2: bandeja persistida ─────────────────────────────────────
// Al subir el extracto, cada línea entra como nb_movimientos PENDIENTE
// (origen="extracto", conciliado=""). Aceptar la pasa a conciliado.

// Un movimiento "ignorado" (descartado en la bandeja sin contabilizar): se marca con
// documento_id "IGN-…". Sale de pendientes y NO cuenta en Tesorería ni Cash Flow (evita
// el doble conteo, ej. el débito del pago de haberes que ya está en los movs origen=sueldos).
export const esIgnorado = m => String(m?.documento_id || "").startsWith("IGN-");

// Cuenta de crédito (tarjeta): saldo negativo = deuda. No es caja disponible; va al pasivo y se excluye del Cash Flow.
export const esCuentaCredito = c => (c?.tipo ?? "").toLowerCase() === "tarjeta";

// Ingesta: crea movimientos pendientes con dedupe (no duplica al re-subir).
const _saldoDe = m => { const x = String(m.referencia || "").match(/saldo=([^;]*)/); return x ? x[1] : ""; };

export async function ingestarExtracto({ sociedad, cuenta_bancaria, moneda = "ARS", lineas = [], onProgress } = {}) {
  const todos = await get("nb_movimientos", { sociedad });
  // dedupe contra TODOS los movimientos de la cuenta (pendientes, aceptados, splits de franquicia).
  // Clave por SALDO del extracto (running balance, único por línea) → robusta a edición de
  // monto y a splits; fallback a fecha|monto cuando no hay saldo.
  const keyOf = (fecha, monto, saldo) => saldo ? `${fecha}|${saldo}` : `${fecha}|${Number(monto) || 0}`;
  const existentes = todos.filter(m => String(m.cuenta_bancaria) === String(cuenta_bancaria));
  const seen = new Set(existentes.map(m => keyOf(m.fecha, m.monto, _saldoDe(m))));
  let dups = 0;
  // 1) Dedup del lado cliente + armado de filas. 2) Escritura en LOTE (add_batch, un viaje por
  // chunk) en vez de 1 POST por fila: mucho más rápido y resiliente — un extracto grande no se
  // corta a la mitad si el GAS se pone lento o la pestaña pasa a segundo plano. El dedup por clave
  // estable hace la operación idempotente: reintentar/re-subir solo completa lo que falta.
  const nuevas = [];
  for (const l of lineas) {
    const k = keyOf(l.fecha, l.monto, l.saldo);
    if (seen.has(k)) { dups++; continue; }
    seen.add(k);   // evita duplicar filas repetidas DENTRO del mismo archivo
    const p = l.propuesta || {};
    nuevas.push({ linea: l, row: {
      id: newId("EXT"), sociedad, fecha: l.fecha,
      tipo: (Number(l.monto) || 0) > 0 ? "INGRESO" : "EGRESO",
      cuenta_bancaria, cuenta_destino: p.cuenta_destino || "",
      cuenta_contable: p.cuenta_contable || "", centro_costo: p.centro_costo || "",
      moneda, monto: Number(l.monto) || 0, documento_id: "",
      iva_rate: Number(l.iva_rate) || 0, iva_monto: Number(l.iva_monto) || 0,
      concepto: l.descripcion || "",
      contraparte_id: "", contraparte_nombre: l.ley1 || l.contraparte || "",   // razón social del banco (Leyenda 1)
      referencia: `cod=${l.codigoConcepto || ""};tipo=${p.tipo || ""};regla=${p.regla_id || ""};prov=${p.proveedor_id || ""};fr=${p.franquicia_id || ""};frops=${(p.franquicia_opciones || []).join("|")};plan=${p.plan_id || ""};pcuota=${p.cuota_row_id || ""};op=${l.nro_operacion || ""};cuit=${l.ley2 || l.cuit || ""};saldo=${l.saldo || ""}`,
      origen: "extracto",
      created_at: new Date().toISOString(),
    }});
  }
  let creados = 0;
  const fallidas = [];   // líneas cuyo lote falló → se devuelven para reintentar solo esas
  const CHUNK = 100;
  for (let i = 0; i < nuevas.length; i += CHUNK) {
    const grupo = nuevas.slice(i, i + CHUNK);
    try {
      await post({ action: "add_batch", sheet: "nb_movimientos", rows: grupo.map(g => g.row) });
      creados += grupo.length;
    } catch (e) {
      grupo.forEach(g => fallidas.push(g.linea));
    }
    if (onProgress) onProgress(Math.min(i + CHUNK, nuevas.length), nuevas.length);
  }
  return { creados, dups, errores: fallidas.length, fallidas };
}

// Trae los movimientos del extracto que faltan conciliar.
// Estado por documento_id: vacío = pendiente; con valor = conciliado (linkeado a su asiento).
export async function fetchMovimientosPendientes(sociedad) {
  const rows = await get("nb_movimientos", { sociedad });
  return rows.filter(m => m.origen === "extracto" && !m.documento_id);
}

// Acepta un movimiento pendiente: lo IMPUTA in-place y lo deja conciliado.
// Una sola escritura (no crea comprobante): el movimiento es el hecho devengado+caja;
// el P&L lo lee vía adapter por documento_id que empieza con "CONTAB-".
export async function aceptarMovimiento(mov, prop = {}) {
  const tipo = prop.tipo || "";
  if (tipo === "transferencia_interna") {
    // SIEMPRE genera las DOS patas (interco entre sociedades o entre cuentas propias de la misma):
    // la línea del extracto + la contrapartida en la cuenta destino, con documento_id compartido
    // (signo opuesto) → quedan emparejadas (Tesorería refleja ambos lados al instante; interco se ve
    // cerrada en el módulo Intercompañía). Pendiente (a futuro): al subir el extracto de la cuenta
    // destino, esa línea es duplicado de esta contrapartida → deduplicar / Ignorar.
    const interco  = !!prop.interco;
    const destino  = prop.cuenta_destino || mov.cuenta_destino || "";
    const tipoMov  = interco ? "INTERCOMPANIA" : "TRANSFERENCIA";
    const sharedId = newId(interco ? "INTERCOMPANY" : "TRF");
    await post({ action: "edit", sheet: "nb_movimientos", id: mov.id, patch: {
      tipo: tipoMov, cuenta_destino: destino, documento_id: sharedId, referencia: "1",
    }});
    await post({ action: "add", sheet: "nb_movimientos", row: {
      id: `${sharedId}-E`, sociedad: prop.destino_sociedad || mov.sociedad, fecha: mov.fecha,
      tipo: tipoMov, cuenta_bancaria: destino, cuenta_destino: mov.cuenta_bancaria,
      cuenta_contable: "", centro_costo: "",
      moneda: prop.destino_moneda || mov.moneda || "ARS",
      monto: -(Number(mov.monto) || 0),   // signo opuesto al de la línea del extracto
      documento_id: sharedId, concepto: mov.concepto || (interco ? "Intercompañía" : "Transferencia interna"),
      referencia: "1", origen: interco ? "intercompania" : "transferencia",
      created_at: new Date().toISOString(),
    }});
    return;
  }
  const cuentaId = prop.cuenta_contable || mov.cuenta_contable || "";
  const esEgreso = (Number(mov.monto) || 0) < 0;
  return post({ action: "edit", sheet: "nb_movimientos", id: mov.id, patch: {
    tipo:               esEgreso ? "EGRESO_GASTO" : "INGRESO",   // unifica con el gasto directo manual
    cuenta_contable:    String(cuentaId).replace(/^CUENTA_/, ""),   // NOMBRE para el P&L
    centro_costo:       prop.centro_costo || mov.centro_costo || "",
    contraparte_id:     prop.proveedor_id || "",
    contraparte_nombre: prop.proveedor_nombre || mov.contraparte_nombre || "",
    documento_id:       "CONTAB-" + mov.id,
  }});
}

// Acepta un COBRO de franquiciado (1 o varias franquicias = split).
// partes: [{ franquicia_id, franquicia_nombre, fr_tipo, monto }]. La 1ª pisa el movimiento
// original (sale de pendientes al flipear origen→"franquicias"); el resto se agregan.
// NO crea comprobante ni lleva documento_id (es caja; el devengado vive en Franquicias).
// fr_tipo PAGO/PAGO_PAUTA = COBRO; PAGO_ENVIADO = EGRESO. El signo se hereda del monto original.
export async function aceptarCobroFranquicia(mov, partes = []) {
  if (!partes.length) return;
  const signo = (Number(mov.monto) || 0) < 0 ? -1 : 1;
  const tipoMov = ft => (ft === "PAGO_ENVIADO" ? "EGRESO" : "COBRO");
  const [p0, ...resto] = partes;
  await post({ action: "edit", sheet: "nb_movimientos", id: mov.id, patch: {
    tipo: tipoMov(p0.fr_tipo), origen: "franquicias", fr_tipo: p0.fr_tipo,
    contraparte_id: String(p0.franquicia_id || ""), contraparte_nombre: p0.franquicia_nombre || "",
    monto: signo * Math.abs(Number(p0.monto) || 0),
    cuenta_contable: "", centro_costo: "",
  }});
  for (const p of resto) {
    await post({ action: "add", sheet: "nb_movimientos", row: {
      id: newId("FRQ"), sociedad: mov.sociedad, fecha: mov.fecha,
      tipo: tipoMov(p.fr_tipo), cuenta_bancaria: mov.cuenta_bancaria, cuenta_destino: "",
      cuenta_contable: "", centro_costo: "", moneda: mov.moneda || "ARS",
      monto: signo * Math.abs(Number(p.monto) || 0), documento_id: "",
      concepto: mov.concepto || "", contraparte_id: String(p.franquicia_id || ""), contraparte_nombre: p.franquicia_nombre || "",
      fr_tipo: p.fr_tipo, referencia: mov.referencia || "", origen: "franquicias",
      created_at: new Date().toISOString(),
    }});
  }
}

// Imputa una línea del extracto a una factura de proveedor existente: la convierte en un
// PAGO linkeado a esa FC. Tesorería netea la CxP (match por documento_id); el P&L la excluye
// (no es "CONTAB-": el devengado ya está en el comprobante). Pago parcial = si |monto| < saldo
// de la FC, el remanente sigue pendiente. No crea fila nueva: edita la del extracto in-place.
export async function imputarPagoFC(mov, { documento_id, cuenta_contable = "", centro_costo = "", proveedor_id = "", proveedor_nombre = "" }) {
  return post({ action: "edit", sheet: "nb_movimientos", id: mov.id, patch: {
    tipo:               "PAGO",
    cuenta_contable:    String(cuenta_contable || "").replace(/^CUENTA_/, ""),
    centro_costo,
    contraparte_id:     proveedor_id,
    contraparte_nombre: proveedor_nombre || mov.contraparte_nombre || "",
    documento_id,                                       // id de la FC → netea CxP en Tesorería
    concepto:           mov.concepto || `Pago ${documento_id}`,
  }});
}

// Imputa un crédito del banco a una factura de VENTA (cobro). Simétrico a imputarPagoFC.
// Las retenciones (lo que el cliente retuvo) van como N líneas, una por cuenta contable
// (IIBB / Ganancias / IVA): cada una cierra parte de la CxC (netea por documento_id) y entra
// al P&L como resultado negativo (gasto) vía origen="retencion". NO son caja → cuenta_bancaria
// vacía (no tocan saldos de banco) y se excluyen del Cash Flow.
// retenciones: [{ cuenta, monto }]  (cuenta = id o nombre de cuenta contable)
// retencion_centro: centro de costo para las retenciones (normalmente "HQ - Impuestos" → van al
// P&L BIGG bajo Impuestos, no a la sede). El cobro (caja) usa centro_costo de la factura.
export async function imputarCobroIngreso(mov, { documento_id, cuenta_contable = "", centro_costo = "", cliente_id = "", cliente_nombre = "", retenciones = [], retencion_centro = "" }) {
  await post({ action: "edit", sheet: "nb_movimientos", id: mov.id, patch: {
    tipo:               "COBRO",
    cuenta_contable:    String(cuenta_contable || "").replace(/^CUENTA_/, ""),
    centro_costo,
    contraparte_id:     cliente_id,
    contraparte_nombre: cliente_nombre || mov.contraparte_nombre || "",
    documento_id,
    concepto:           mov.concepto || `Cobro ${documento_id}`,
  }});
  for (const r of retenciones) {
    const ret = Math.abs(Number(r?.monto) || 0);
    if (ret <= 0.01 || !r?.cuenta) continue;
    await post({ action: "add", sheet: "nb_movimientos", row: {
      id: newId("RET"), sociedad: mov.sociedad, fecha: mov.fecha,
      tipo: "COBRO", cuenta_bancaria: "", cuenta_destino: "",
      cuenta_contable: String(r.cuenta).replace(/^CUENTA_/, ""),
      centro_costo: retencion_centro || centro_costo, moneda: mov.moneda || "ARS",
      monto: ret, documento_id,
      concepto: `Retención s/ ${documento_id}`,
      contraparte_id: cliente_id, contraparte_nombre: cliente_nombre || "",
      origen: "retencion", created_at: new Date().toISOString(),
    }});
  }
}

// Ignora una línea del extracto: la descarta sin contabilizar. Soft-mark (no borra):
// la fila conserva su `saldo=` en referencia → el dedup la ve y NO la re-crea al re-subir.
// Reversible con restaurarMovimiento. motivo: texto libre (para haberes = "haberes:<lote>").
export async function ignorarMovimiento(mov, motivo = "") {
  const ref = String(mov.referencia || "").replace(/;?ign=[^;]*/g, "");
  return post({ action: "edit", sheet: "nb_movimientos", id: mov.id, patch: {
    documento_id: "IGN-" + mov.id,
    referencia: `${ref};ign=${motivo || "1"}`,
  }});
}

// Restaura una línea ignorada → vuelve a pendiente (documento_id vacío, sin marca ign=).
export async function restaurarMovimiento(mov) {
  const ref = String(mov.referencia || "").replace(/;?ign=[^;]*/g, "");
  return post({ action: "edit", sheet: "nb_movimientos", id: mov.id, patch: {
    documento_id: "", referencia: ref,
  }});
}

// Líneas del extracto ya ignoradas (para el panel "Ver ignorados" con opción Restaurar).
export async function fetchMovimientosIgnorados(sociedad) {
  const rows = await get("nb_movimientos", { sociedad });
  return rows.filter(m => m.origen === "extracto" && esIgnorado(m));
}

// Pagos de haberes ya registrados por Sueldos (nb_movimientos origen="sueldos"), para que
// Conciliación agrupe por lote_pago y matchee el débito del banco contra el total del lote.
export async function fetchPagosSueldos(sociedad) {
  const rows = await get("nb_movimientos", { sociedad });
  return rows.filter(m => m.origen === "sueldos" && m.tipo_componente === "haberes" && !esIgnorado(m));
}

/**
 * Trae todos los gastos directos de una sociedad (nb_movimientos origen="gasto_directo").
 * Una sola fila por gasto; sin join a comprobantes.
 */
export async function fetchGastos(sociedad) {
  const movRows = await get("nb_movimientos", { sociedad });
  return movRows
    .filter(m => m.origen === "gasto_directo")
    .map(m => {
      const total = Math.abs(toNum(m.monto));
      const iva   = toNum(m.iva_monto);
      return {
        id:              m.id,
        _movId:          m.id,
        fecha:           m.fecha ?? "",
        cuenta_contable: m.cuenta_contable ?? "",
        cc:              m.centro_costo ?? "",
        moneda:          m.moneda ?? "ARS",
        subtotal:        total - iva,
        ivaRate:         toNum(m.iva_rate),
        total,
        proveedor:       m.contraparte_nombre ?? "",
        nota:            m.concepto ?? "",
        cuentaBancaria:  m.cuenta_bancaria ?? "",
      };
    })
    .sort((a, b) => (b.fecha > a.fecha ? 1 : -1));
}

/** Elimina un gasto directo (solo el movimiento). */
export async function deleteGasto(movId) {
  await post({ action: "del", sheet: "nb_movimientos", id: movId });
}

/** Actualiza un gasto directo existente (solo el movimiento). */
export async function updateGastoDirecto(movId, { fecha, cuenta_contable, cuenta_contable_id = "", cc = "", moneda = "ARS", subtotal, ivaRate = 0, nota = "", cuenta_bancaria, referencia = "", proveedor_id = "", proveedor_nombre = "" }) {
  const sub   = Number(subtotal) || 0;
  const rate  = Number(ivaRate) || 0;
  const iva   = sub * (rate / 100);
  const total = sub + iva;
  await post({ action: "edit", sheet: "nb_movimientos", id: movId, patch: {
    fecha,
    cuenta_bancaria,
    cuenta_contable,
    centro_costo:       cc,
    moneda,
    monto:              -total,
    concepto:           nota || `Gasto directo: ${cuenta_contable}`,
    contraparte_id:     proveedor_id,
    contraparte_nombre: proveedor_nombre,
    iva_rate:           rate,
    iva_monto:          iva,
    referencia,
  }});
}

// ─── P&L — Líneas enriquecidas ────────────────────────────────────────────────
//
// Lee nb_comprobantes (ya tiene header + CC en cada fila) y filtra por subtipo.
// No necesita join — cada fila ya tiene cuenta_contable, centro_costo, total, fecha.

// subtipo: "EGRESO_FC" | "INGRESO_FC" | "GASTO" | null (todos)
// Para P&L de egresos pasar ["EGRESO_FC","GASTO"] para incluir gastos directos.
export async function fetchLineasEnriquecidas(sociedad, subtipo) {
  const rows = await get("nb_comprobantes", { sociedad });
  // Normalizar campos numéricos: Sheets puede devolver "362591,17" (coma decimal) → toNum → 362591.17
  const normalize = r => ({ ...r, total: toNum(r.total), subtotal: toNum(r.subtotal), iva_monto: toNum(r.iva_monto) });
  if (!subtipo) return rows.map(normalize);
  const subs = Array.isArray(subtipo) ? subtipo.map(s => s.toUpperCase()) : [subtipo.toUpperCase()];
  return rows.filter(r => subs.includes((r.subtipo ?? "").toUpperCase())).map(normalize);
}

// ─── Helpers de transformación ────────────────────────────────────────────────

/**
 * Agrupa filas de nb_comprobantes (una por línea de CC) en objetos con array `lineas`.
 * id_comp es el identificador del documento (puede repetirse); id es la clave de fila.
 */
function _agruparPorComp(rows, subtipo) {
  const map = new Map();
  for (const row of rows) {
    const key = row.id_comp;
    if (!map.has(key)) {
      map.set(key, {
        id:       row.id_comp,
        sociedad: row.sociedad,
        fecha:    row.fecha,
        vto:      row.vto,
        moneda:   row.moneda,
        nroComp:  row.nro_comp,
        cuenta:   row.cuenta_contable,
        cuentaId: row.cuenta_contable_id ?? "",
        nota:     row.nota,
        cc:       row.centro_costo,   // alias rápido de la primera línea
        subtipo:  row.subtipo ?? subtipo,
        ...(subtipo === "EGRESO" || subtipo === "GASTO" ? { proveedor: row.contraparte_nombre ?? "", proveedorId: row.contraparte_id ?? "" } : {}),
        ...(subtipo === "INGRESO" ? { cliente: row.contraparte_nombre, clienteId: row.contraparte_id ?? "" } : {}),
        lineas: [],
        total:  0,
      });
    }
    const comp = map.get(key);
    comp.lineas.push({
      id:          row.id,           // clave única de fila (para edit/del)
      cc:          row.centro_costo ?? "",
      cuenta:      row.cuenta_contable ?? "",      // por línea (resumen de tarjeta usa cuenta x línea)
      cuentaId:    row.cuenta_contable_id ?? "",
      titular:     row.titular ?? "",              // dimensión: quién gastó (extensión TC)
      comercio:    row.nota ?? "",                 // texto del comercio (TC)
      subtotal:    toNum(row.subtotal),
      ivaRate:     toNum(row.iva_rate),
      iva_monto:   toNum(row.iva_monto),
      total_linea: toNum(row.total),
    });
    comp.total += toNum(row.total);
    comp.importe = comp.total;
  }
  return Array.from(map.values());
}

// ── Helpers para movimientos en par (CAMBIO / INTERCOMPANIA) ─────────────────

// Agrupa movimientos por documento_id, identifica la salida (monto<0) y entrada (monto>0)
// y ordena por fecha desc. Usado por fetchCambios y fetchIntercompania.
function _pairMovs(movs, tipo) {
  const filtered = movs.filter(m => m.tipo === tipo);
  const groups   = new Map();
  for (const m of filtered) {
    const key = m.documento_id || m.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  return Array.from(groups.values())
    .map(pair => ({
      salida:  pair.find(m => Number(m.monto) < 0) ?? pair[0],
      entrada: pair.find(m => Number(m.monto) > 0) ?? pair[1],
      _ids:    pair.map(m => m.id),
    }))
    .sort((a, b) => ((b.salida?.fecha ?? "") > (a.salida?.fecha ?? "") ? 1 : -1));
}

async function _deleteMovRows(rowIds) {
  await Promise.all((rowIds ?? []).map(id => post({ action:"del", sheet:"nb_movimientos", id })));
}

// ── Cambio de moneda ─────────────────────────────────────────────────────────

export async function fetchCambios(sociedad) {
  const params = sociedad ? { sociedad } : {};
  const movs = await get("nb_movimientos", params);
  return _pairMovs(movs, "CAMBIO").map(({ salida, entrada, _ids }) => ({
    id:            salida?.documento_id ?? salida?.id,
    sociedad:      salida?.sociedad ?? "",
    fecha:         salida?.fecha ?? "",
    cuentaOrigen:  salida?.cuenta_bancaria ?? "",
    monedaOrigen:  salida?.moneda ?? "",
    montoOrigen:   Math.abs(Number(salida?.monto) || 0),
    cuentaDestino: entrada?.cuenta_bancaria ?? "",
    monedaDestino: entrada?.moneda ?? "",
    montoDestino:  Number(entrada?.monto) || 0,
    tc:            salida?.referencia ?? "",
    nota:          salida?.concepto ?? "",
    _ids,
  }));
}

export async function appendCambio({ sociedad, fecha, cuentaOrigen, monedaOrigen, montoOrigen, cuentaDestino, monedaDestino, montoDestino, nota = "" }) {
  const id = newId("CAM");
  // TC = cuántas unidades de la moneda LOCAL (ARS) vale 1 unidad de la moneda EXTRANJERA
  // Si el origen ya es la extranjera (USD→ARS): 1 USD = montoDestino/montoOrigen ARS
  // Si el destino es la extranjera  (ARS→USD): 1 USD = montoOrigen/montoDestino ARS
  const tc = monedaOrigen !== "ARS"
    ? (montoOrigen  > 0 ? (montoDestino / montoOrigen).toFixed(2) : "0")
    : (montoDestino > 0 ? (montoOrigen  / montoDestino).toFixed(2) : "0");
  const concepto   = `Cambio ${monedaOrigen}→${monedaDestino}${nota ? " · " + nota : ""}`;
  const created_at = new Date().toISOString();
  await post({ action:"add", sheet:"nb_movimientos", row: {
    id:`${id}-S`, sociedad, fecha, tipo:"CAMBIO",
    cuenta_bancaria:cuentaOrigen, cuenta_destino:cuentaDestino,
    cuenta_contable:"", centro_costo:"",
    moneda:monedaOrigen, monto:-Math.abs(montoOrigen),
    documento_id:id, concepto, referencia:tc, origen:"cambio", created_at,
  }});
  await post({ action:"add", sheet:"nb_movimientos", row: {
    id:`${id}-E`, sociedad, fecha, tipo:"CAMBIO",
    cuenta_bancaria:cuentaDestino, cuenta_destino:cuentaOrigen,
    cuenta_contable:"", centro_costo:"",
    moneda:monedaDestino, monto:Math.abs(montoDestino),
    documento_id:id, concepto, referencia:tc, origen:"cambio", created_at,
  }});
  return { ok:true, id };
}

export const deleteCambio = _deleteMovRows;

// ── Intercompañía ─────────────────────────────────────────────────────────────

export async function fetchIntercompania() {
  const movs = await get("nb_movimientos", {});
  return _pairMovs(movs, "INTERCOMPANIA").map(({ salida, entrada, _ids }) => {
    const notaRaw = salida?.concepto ?? "";
    return {
      id:            salida?.documento_id ?? salida?.id,
      fecha:         salida?.fecha ?? "",
      socOrigen:     salida?.sociedad ?? "",
      ctaOrigen:     salida?.cuenta_bancaria ?? "",
      monedaOrigen:  salida?.moneda ?? "",
      montoOrigen:   Math.abs(Number(salida?.monto) || 0),
      socDestino:    entrada?.sociedad ?? "",
      ctaDestino:    entrada?.cuenta_bancaria ?? "",
      monedaDestino: entrada?.moneda ?? "",
      montoDestino:  Number(entrada?.monto) || 0,
      tc:            salida?.referencia ?? "",
      tipo_op:       notaRaw.startsWith("Fondeo:") ? "fondeo" : "prestamo",
      nota:          notaRaw.replace(/^(Préstamo|Fondeo):[^·]+(·\s*)?/, ""),
      _ids,
    };
  });
}

export async function appendIntercompania({ fecha, tipoOp = "prestamo", socOrigen, ctaOrigen, monedaOrigen, montoOrigen, socDestino, ctaDestino, monedaDestino, montoDestino, nota = "" }) {
  const id         = newId("INTERCOMPANY");
  const tc         = montoOrigen > 0 ? (montoDestino / montoOrigen).toFixed(6) : "1";
  const tipoLabel  = tipoOp === "fondeo" ? "Fondeo" : "Préstamo";
  const concepto   = `${tipoLabel}: ${socOrigen} → ${socDestino}${nota ? " · " + nota : ""}`;
  const created_at = new Date().toISOString();
  await post({ action:"add", sheet:"nb_movimientos", row: {
    id:`${id}-S`, sociedad:socOrigen, fecha, tipo:"INTERCOMPANIA",
    cuenta_bancaria:ctaOrigen, cuenta_destino:ctaDestino,
    cuenta_contable:"", centro_costo:"",
    moneda:monedaOrigen, monto:-Math.abs(montoOrigen),
    documento_id:id, concepto, referencia:tc, origen:"intercompania", created_at,
  }});
  await post({ action:"add", sheet:"nb_movimientos", row: {
    id:`${id}-E`, sociedad:socDestino, fecha, tipo:"INTERCOMPANIA",
    cuenta_bancaria:ctaDestino, cuenta_destino:ctaOrigen,
    cuenta_contable:"", centro_costo:"",
    moneda:monedaDestino, monto:Math.abs(montoDestino),
    documento_id:id, concepto, referencia:tc, origen:"intercompania", created_at,
  }});
  return { ok:true, id };
}

export const deleteIntercompania = _deleteMovRows;

// ── Validación de duplicados ──────────────────────────────────────────────────

/**
 * Verifica si ya existe un comprobante con el mismo nro_comp + contraparteId + sociedad.
 * Retorna el id_comp duplicado si existe, null si no hay duplicado.
 * Solo aplica cuando nroComp es no-vacío.
 *
 * @param {string}      sociedad
 * @param {"EGRESO"|"INGRESO"} subtipo
 * @param {string}      nroComp
 * @param {string}      contraparteId  — proveedorId o clienteId
 * @param {string|null} excludeId      — id_comp a ignorar (para modo edición)
 */
export async function checkDuplicateComp(sociedad, subtipo, nroComp, contraparteId, excludeId = null) {
  const nro = (nroComp ?? "").trim();
  if (!nro) return null;
  const rows = await get("nb_comprobantes", { sociedad });
  const nroNorm = nro.toLowerCase();
  const seen = new Set();
  for (const r of rows) {
    const key = r.id_comp;
    if (seen.has(key)) continue;   // una fila por doc es suficiente
    seen.add(key);
    if (key === excludeId) continue;
    if ((r.subtipo ?? "").toUpperCase() !== subtipo.toUpperCase()) continue;
    if ((r.nro_comp ?? "").trim().toLowerCase() !== nroNorm) continue;
    if ((r.contraparte_id ?? "") !== (contraparteId ?? "")) continue;
    return key;                    // duplicado encontrado → retorna id_comp
  }
  return null;
}

// ── Reconciliación bancaria ───────────────────────────────────────────────────

/** Marca un movimiento como conciliado con una referencia del extracto bancario */
export async function marcarConciliado(id, extractoRef = "") {
  return post({ action: "edit", sheet: "nb_movimientos", id, patch: { conciliado: "true", extracto_ref: extractoRef } });
}

/** Desmarca un movimiento como conciliado */
export async function desmarcarConciliado(id) {
  return post({ action: "edit", sheet: "nb_movimientos", id, patch: { conciliado: "", extracto_ref: "" } });
}

// ── Cierres de período ────────────────────────────────────────────────────────
//
// Schema nb_cierres:
//   id | sociedad | año | mes | estado (cerrado|abierto) | cerrado_at | reabierto_at

export async function fetchCierres(sociedad) {
  return get("nb_cierres", { sociedad });
}

export async function cerrarPeriodo({ sociedad, año, mes }) {
  const id = newId("CIERRE");
  return post({
    action: "add",
    sheet:  "nb_cierres",
    row: {
      id,
      sociedad,
      año:        Number(año),
      mes:        Number(mes),
      estado:     "cerrado",
      cerrado_at: new Date().toISOString(),
      reabierto_at: "",
    },
  });
}

export async function reabrirPeriodo(id) {
  return post({
    action: "update",
    sheet:  "nb_cierres",
    id,
    fields: { estado: "abierto", reabierto_at: new Date().toISOString() },
  });
}

// ─── FINANCIACIONES — familia "cuotas" (planes AFIP + créditos) ───────────────
//
// Deuda amortizable en cuotas. UNA hoja plana nb_financiaciones, una fila por cuota
// (campos del plan repetidos, agrupados por plan_id) — misma convención que nb_comprobantes.
// Componentes como COLUMNAS, cada uno con destino fijo en el P&L (ver PantallaReportes):
//   capital → pasivo (no P&L) · interes → Gastos Financieros · iva → IVA ·
//   impuestos (sellos) → Impuestos · interes_resarc → Gastos Financieros (solo si pago tardío).
// NO partida doble: el cronograma devenga el resultado (mes a mes en el vto); la caja vive
// en nb_movimientos (la cuota pagada es una fila no-CONTAB- → excluida del P&L).
//
// Schema nb_financiaciones (una fila por cuota):
//   id | plan_id | nro_plan | tipo(plan_afip|prestamo) | acreedor_id | acreedor_nombre |
//   acreedor_cuit | sociedad | moneda | fecha_consolidacion | es_apertura | comprobante_origen |
//   cuenta_capital | centro_capital | cuenta_interes | centro_interes | cuenta_iva | centro_iva |
//   cuenta_impuestos | centro_impuestos | cuenta_bancaria | nro_cuota | vto |
//   vto_tardio | capital | interes | iva | impuestos | interes_resarc | total | total_tardio |
//   estado(pendiente|pagada|cancelada) | movimiento_id | fecha_pago | nota | created_at

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

function _finRowToCuota(r) {
  return {
    rowId:          r.id,
    nro_cuota:      Number(r.nro_cuota) || 0,
    vto:            r.vto ?? "",
    vto_tardio:     r.vto_tardio ?? "",
    capital:        toNum(r.capital),
    interes:        toNum(r.interes),
    iva:            toNum(r.iva),
    impuestos:      toNum(r.impuestos),
    interes_resarc: toNum(r.interes_resarc),
    total:          toNum(r.total),
    total_tardio:   toNum(r.total_tardio),
    estado:         r.estado || "pendiente",
    movimiento_id:  r.movimiento_id ?? "",
    fecha_pago:     r.fecha_pago ?? "",
  };
}

/** Agrupa las filas planas (una por cuota) en planes con su cronograma + derivados. */
export function agruparPlanes(rows = []) {
  const map = new Map();
  for (const r of rows) {
    const key = r.plan_id;
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        plan_id:             r.plan_id,
        nro_plan:            r.nro_plan ?? "",
        tipo:                r.tipo || "plan_afip",
        acreedor_id:         r.acreedor_id ?? "",
        acreedor_nombre:     r.acreedor_nombre ?? "",
        acreedor_cuit:       r.acreedor_cuit ?? "",
        sociedad:            r.sociedad ?? "",
        moneda:              r.moneda || "ARS",
        fecha_consolidacion: r.fecha_consolidacion ?? "",
        es_apertura:         String(r.es_apertura).toLowerCase() === "true",
        comprobante_origen:  r.comprobante_origen ?? "",
        cuenta_capital:      r.cuenta_capital ?? "",   centro_capital:   r.centro_capital ?? "",
        cuenta_interes:      r.cuenta_interes ?? "",   centro_interes:   r.centro_interes ?? "",
        cuenta_iva:          r.cuenta_iva ?? "",       centro_iva:       r.centro_iva ?? "",
        cuenta_impuestos:    r.cuenta_impuestos ?? "", centro_impuestos: r.centro_impuestos ?? "",
        cuenta_bancaria:     r.cuenta_bancaria ?? "",
        nota:                r.nota ?? "",
        cuotas:              [],
      });
    }
    map.get(key).cuotas.push(_finRowToCuota(r));
  }
  return Array.from(map.values()).map(p => {
    p.cuotas.sort((a, b) => a.nro_cuota - b.nro_cuota);
    const pagadas        = p.cuotas.filter(c => c.estado === "pagada");
    const capital_total  = p.cuotas.reduce((s, c) => s + c.capital, 0);
    const capital_pagado = pagadas.reduce((s, c) => s + c.capital, 0);
    const saldo          = Math.max(0, capital_total - capital_pagado);
    const prox           = p.cuotas.find(c => c.estado === "pendiente");
    return {
      ...p,
      capital_total, capital_pagado, saldo,
      n_cuotas:  p.cuotas.length,
      n_pagadas: pagadas.length,
      prox_vto:  prox?.vto ?? "",
      estado:    saldo <= 0.01 ? "saldado" : "vigente",
    };
  });
}

/** Trae las financiaciones de una sociedad, ya agrupadas por plan_id con derivados. */
export async function fetchFinanciaciones(sociedad) {
  const rows = await get("nb_financiaciones", sociedad ? { sociedad } : {});
  return agruparPlanes(rows);
}

/**
 * Pasivo de financiaciones por bucket (planes AFIP → impuestos, créditos → financiero).
 * Fuente ÚNICA para el pasivo que muestran Reportes→Balance y Tesorería (mismo número en los dos).
 * Devuelve { impuestos|financiero: { tot:{ARS,USD,EUR}, docs:[{acreedor,nro_plan,prox_vto,saldo,moneda}] } }.
 */
export function financiacionPasivoBuckets(planes, sociedad) {
  const soc = String(sociedad ?? "").toLowerCase();
  const mk  = () => ({ ARS: 0, USD: 0, EUR: 0 });
  const out = { impuestos: { tot: mk(), docs: [] }, financiero: { tot: mk(), docs: [] } };
  for (const p of (planes ?? [])) {
    if (soc && String(p.sociedad ?? "").toLowerCase() !== soc) continue;
    const saldo = Number(p.saldo) || 0;
    if (saldo <= 0) continue;
    const k   = p.tipo === "prestamo" ? "financiero" : "impuestos";
    const mon = p.moneda || "ARS";
    if (mon in out[k].tot) out[k].tot[mon] += saldo;
    out[k].docs.push({ acreedor: p.acreedor_nombre, nro_plan: p.nro_plan, prox_vto: p.prox_vto, saldo, moneda: mon });
  }
  return out;
}

/**
 * Genera un cronograma de cuotas (sistema francés: cuota fija, interés decreciente,
 * capital creciente). Puro (sin I/O): para previsualizar/editar en el modal. El usuario
 * sobreescribe a mano con los números exactos del PDF (AFIP/banco traen el detalle).
 */
export function generarCuotas({ capital_original, n_cuotas, tasaMensual = 0, ivaPct = 0, impuestoPct = 0, fecha_inicio, periodicidad = "mensual" }) {
  const n    = Math.max(1, Math.floor(Number(n_cuotas) || 0));
  const cap0 = Number(capital_original) || 0;
  const i    = (Number(tasaMensual) || 0) / 100;
  const cuotaFija = i > 0 ? cap0 * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1) : cap0 / n;
  const base = _parseVto(fecha_inicio) || new Date();
  const stepMeses = periodicidad === "trimestral" ? 3 : periodicidad === "bimestral" ? 2 : 1;
  const out = [];
  let saldo = cap0;     // remanente para calcular el interés
  let capAcum = 0;      // suma de capitales YA redondeados (para que la suma cuadre exacto)
  for (let k = 1; k <= n; k++) {
    const interes = round2(i > 0 ? saldo * i : 0);
    // La última cuota absorbe TODO el redondeo acumulado → Σ capital === capital_original exacto.
    const capital = k === n ? round2(cap0 - capAcum) : round2(i > 0 ? cuotaFija - interes : cap0 / n);
    capAcum = round2(capAcum + capital);
    saldo   = Math.max(0, round2(cap0 - capAcum));
    const iva       = round2(interes * ((Number(ivaPct) || 0) / 100));
    const impuestos = round2((capital + interes) * ((Number(impuestoPct) || 0) / 100));
    const d = new Date(base);
    d.setMonth(d.getMonth() + (k - 1) * stepMeses);
    out.push({
      nro_cuota: k,
      vto:       d.toISOString().slice(0, 10),
      vto_tardio: "",
      capital, interes, iva, impuestos,
      interes_resarc: 0,
      total:      round2(capital + interes + iva + impuestos),
      total_tardio: 0,
    });
  }
  return out;
}

/**
 * Crea una financiación: escribe N filas (una por cuota) en nb_financiaciones, secuencial
 * (GAS no reintenta). Para préstamo no-apertura registra además la fila de caja del alta
 * (+capital) vía appendMovTesoreria — entra a Cash Flow/saldo pero NO al P&L (documento_id
 * = plan_id, no "CONTAB-"). Plan AFIP no tiene alta de caja (el capital es el impuesto).
 */
export async function appendFinanciacion({ tipo = "plan_afip", nro_plan = "", acreedor_id = "", acreedor_nombre = "", acreedor_cuit = "", sociedad, moneda = "ARS", fecha_consolidacion, es_apertura = false, comprobante_origen = "", cuenta_capital = "", centro_capital = "", cuenta_interes = "", centro_interes = "", cuenta_iva = "", centro_iva = "", cuenta_impuestos = "", centro_impuestos = "", cuenta_bancaria = "", nota = "", cuotas = [] }) {
  const plan_id    = newId("FIN");
  const created_at = new Date().toISOString();

  if (tipo === "prestamo" && !es_apertura && cuenta_bancaria) {
    const capital_total = cuotas.reduce((s, c) => s + (Number(c.capital) || 0), 0);
    await appendMovTesoreria({
      sociedad, fecha: fecha_consolidacion, tipo: "INGRESO",
      cuenta_bancaria, concepto: `Alta préstamo ${nro_plan || plan_id}`,
      moneda, monto: Math.abs(capital_total),
      origen: "financiacion_alta", origen_id: plan_id, centro_costo: centro_capital || centro_interes || "",
    });
  }

  // Una sola escritura batch (un plan puede tener 70+ cuotas → 70 requests = HTTP 500/parcial).
  const rows = cuotas.map((c, k) => ({
    id: `${plan_id}-C${pad(k + 1)}`,
    plan_id, nro_plan, tipo,
    acreedor_id, acreedor_nombre, acreedor_cuit,
    sociedad, moneda, fecha_consolidacion,
    es_apertura:    es_apertura ? "true" : "",
    comprobante_origen,
    cuenta_capital, centro_capital, cuenta_interes, centro_interes, cuenta_iva, centro_iva, cuenta_impuestos, centro_impuestos, cuenta_bancaria,
    nro_cuota:      Number(c.nro_cuota) || 0,
    vto:            c.vto ?? "",
    vto_tardio:     c.vto_tardio ?? "",
    capital:        Number(c.capital) || 0,
    interes:        Number(c.interes) || 0,
    iva:            Number(c.iva) || 0,
    impuestos:      Number(c.impuestos) || 0,
    interes_resarc: Number(c.interes_resarc) || 0,
    total:          Number(c.total) || 0,
    total_tardio:   Number(c.total_tardio) || 0,
    estado:         "pendiente",
    movimiento_id:  "",
    fecha_pago:     "",
    nota,
    created_at,
  }));
  await post({ action: "add_batch", sheet: "nb_financiaciones", rows });
  return { ok: true, plan_id };
}

/**
 * Imputa una línea del extracto a una cuota: la convierte en PAGO (documento_id
 * FIN-<plan_id>#<nro>, no-CONTAB- → excluida del P&L) y marca la cuota pagada. El capital
 * baja el pasivo; interés/IVA/impuestos ya se devengaron mes a mes vía el cronograma.
 * El resarcitorio (si pagó tardío) lo deriva el adapter por fecha_pago > vto.
 */
export async function imputarCuota(mov, { plan_id, nro_cuota, row_id, concepto = "" }) {
  await post({ action: "edit", sheet: "nb_movimientos", id: mov.id, patch: {
    tipo: "PAGO", origen: "cuota",
    documento_id: `FIN-${plan_id}#${nro_cuota}`,
    concepto: concepto || mov.concepto || `Cuota ${nro_cuota} ${plan_id}`,
  }});
  await post({ action: "edit", sheet: "nb_financiaciones", id: row_id, patch: {
    estado: "pagada", movimiento_id: mov.id, fecha_pago: mov.fecha,
  }});
}

/**
 * Vincula el crédito del desembolso de un préstamo (línea del extracto) a la financiación.
 * Es caja (Cash Flow/saldo) pero NO P&L (documento_id = plan_id, no "CONTAB-").
 */
export async function registrarAltaPrestamo(mov, { plan_id, concepto = "" }) {
  return post({ action: "edit", sheet: "nb_movimientos", id: mov.id, patch: {
    tipo: "INGRESO", origen: "financiacion_alta",
    documento_id: plan_id,
    concepto: concepto || mov.concepto || `Alta préstamo ${plan_id}`,
  }});
}

/** Paga una cuota manualmente (sin línea de banco): registra el egreso de caja y marca pagada. */
export async function pagarCuota({ plan, cuota, fecha, cuenta_bancaria }) {
  await appendMovTesoreria({
    sociedad: plan.sociedad, fecha, tipo: "PAGO",
    cuenta_bancaria, concepto: `Cuota ${cuota.nro_cuota} ${plan.nro_plan || plan.plan_id}`,
    moneda: plan.moneda, monto: -Math.abs(Number(cuota.total) || 0),
    origen: "cuota", origen_id: `FIN-${plan.plan_id}#${cuota.nro_cuota}`,
  });
  await post({ action: "edit", sheet: "nb_financiaciones", id: cuota.rowId, patch: {
    estado: "pagada", fecha_pago: fecha,
  }});
}

/** Aplica un patch a TODAS las filas de un plan (campos de plan repetidos). */
export async function updateFinanciacion(plan_id, patch) {
  const rows = await get("nb_financiaciones", {});
  const ids  = rows.filter(r => r.plan_id === plan_id).map(r => r.id);
  for (const id of ids) await post({ action: "edit", sheet: "nb_financiaciones", id, patch });
}

/** Cancela las cuotas pendientes de un plan (precancelación); el pasivo baja a 0. */
export async function cancelarFinanciacion(plan_id) {
  const rows = await get("nb_financiaciones", {});
  const ids  = rows.filter(r => r.plan_id === plan_id && r.estado === "pendiente").map(r => r.id);
  for (const id of ids) await post({ action: "edit", sheet: "nb_financiaciones", id, patch: { estado: "cancelada" } });
}

/** Borra un plan entero (todas sus filas). */
export async function deleteFinanciacion(plan_id) {
  const rows = await get("nb_financiaciones", {});
  const ids  = rows.filter(r => r.plan_id === plan_id).map(r => r.id);
  for (const id of ids) await post({ action: "del", sheet: "nb_financiaciones", id });
}

// ─── SOCIOS (cuenta corriente: dividendos + préstamos) ─────────────────────────
//
// Módulo especial group-level (transversal a las sociedades). Un socio ES un franquiciado:
// contraparte bidireccional cuyo saldo neto puede ser deudor (nos debe → Activo) o acreedor
// (le debemos → Pasivo). NUNCA toca el P&L — dividendos y préstamos a socios son balance puro
// (reparto de patrimonio / cuenta particular), no gasto ni ingreso.
//
// DOS fuentes que netean (como franquiciados):
//   · CAJA  → nb_movimientos (origen="socios", contraparte_id=socio, socio_tipo, sociedad = la
//     que manda/recibe la plata). Autoridad del efectivo → Tesorería/Cash Flow lo ven.
//   · DEVENGO no-cash → nb_socios_cc (dividendo declarado + saldos de apertura). Sin caja.
// Maestro: nb_socios (group-level, con participacion % para el reparto del dividendo).
//
// socio_tipo (nb_movimientos): prestamo | devolucion | aporte | dividendo_pago
// tipo (nb_socios_cc):         dividendo_declarado | apertura
//
// Convención de signo del SALDO por socio (óptica de la empresa): + nos debe / − le debemos.
//   prestamo +  · devolucion −  · aporte −  · dividendo_pago +  · dividendo_declarado −
//   apertura = monto firmado (+ deudor / − acreedor)

export const SOCIO_SIGNO_CAJA = { prestamo: +1, devolucion: -1, aporte: -1, dividendo_pago: +1 };

export async function fetchSocios() {
  return get("nb_socios");
}
export async function appendSocio(socio) {
  return post({ action: "add", sheet: "nb_socios", row: { id: newId("SOC"), ...socio, activo: true, created_at: new Date().toISOString() } });
}
export async function updateSocio(id, patch) {
  return post({ action: "edit", sheet: "nb_socios", id, patch });
}
export async function deleteSocio(id) {
  return post({ action: "del", sheet: "nb_socios", id });
}

/** Filas no-cash del CC de socios (dividendos declarados + aperturas). */
export async function fetchSociosCC() {
  return get("nb_socios_cc");
}
/** Movimientos de caja de socios (nb_movimientos origen="socios", todas las sociedades). */
export async function fetchMovSocios() {
  const rows = await get("nb_movimientos", {});
  return rows.filter(m => m.origen === "socios");
}

// Reparte un total entre socios según participacion (%). Devuelve [{socio_id,socio_nombre,monto}].
// La última fila absorbe el redondeo → Σ === total exacto. Socios sin participacion → 0.
export function repartirDividendo(total, socios = []) {
  const activos = (socios || []).filter(s => s.activo !== false && (Number(s.participacion) || 0) > 0);
  const t = Math.abs(Number(total) || 0);
  let acum = 0;
  return activos.map((s, i) => {
    const monto = i === activos.length - 1
      ? round2(t - acum)
      : round2(t * (Number(s.participacion) || 0) / 100);
    acum = round2(acum + monto);
    return { socio_id: s.id, socio_nombre: s.nombre, monto };
  });
}

// Escribe una fila de caja de socio en nb_movimientos (préstamo/devolución/aporte/pago-dividendo).
// La cuenta origen ya definió sociedad+moneda en la UI. monto firmado por el tipo de mov de caja
// (préstamo/pago-dividendo salen → EGRESO; devolución/aporte entran → INGRESO). Sin cuenta_contable
// (no P&L). Devuelve el id.
export async function appendMovSocio({ socio_id, socio_nombre, socio_tipo, sociedad, cuenta_bancaria, moneda = "ARS", monto, fecha, nota = "" }) {
  const id  = newId("SOC");
  const m   = Math.abs(Number(monto) || 0);
  const esSalida = socio_tipo === "prestamo" || socio_tipo === "dividendo_pago";
  await post({ action: "add", sheet: "nb_movimientos", row: {
    id, sociedad, fecha, tipo: esSalida ? "EGRESO" : "INGRESO",
    cuenta_bancaria, cuenta_destino: "", cuenta_contable: "", centro_costo: "",
    moneda, monto: esSalida ? -m : m, documento_id: "",
    concepto: nota || `Socio: ${socio_nombre} (${socio_tipo})`,
    contraparte_id: String(socio_id || ""), contraparte_nombre: socio_nombre || "",
    socio_tipo, referencia: "", origen: "socios", created_at: new Date().toISOString(),
  }});
  return id;
}

// Declara un dividendo (NO cash) → N filas nb_socios_cc (una por socio con monto>0). Baja PN,
// sube el pasivo con cada socio (le debemos). La sociedad que distribuye es POR FILA
// (l.sociedad); `sociedad` es solo el default si una fila no la trae.
// lineas: [{socio_id, socio_nombre, sociedad, monto}].
export async function declararDividendo({ sociedad = "", moneda = "ARS", fecha, nota = "", lineas = [] }) {
  const created_at = new Date().toISOString();
  const rows = (lineas || [])
    .filter(l => (Number(l.monto) || 0) > 0)
    .map((l, i) => ({
      id: `${newId("SCC")}-${i}`, socio_id: l.socio_id, socio_nombre: l.socio_nombre,
      sociedad: l.sociedad || sociedad, fecha, tipo: "dividendo_declarado", moneda,
      monto: -Math.abs(Number(l.monto) || 0),   // − = le debemos
      nota, created_at,
    }));
  if (!rows.length) return { ok: true, n: 0 };
  await post({ action: "add_batch", sheet: "nb_socios_cc", rows });
  return { ok: true, n: rows.length };
}

// Saldo de apertura pre go-live (NO cash): 1 fila nb_socios_cc. direccion: "deudor" (nos debe →
// +) | "acreedor" (le debemos → −).
export async function aperturaSocio({ socio_id, socio_nombre, sociedad, moneda = "ARS", monto, direccion, fecha, nota = "" }) {
  const m    = Math.abs(Number(monto) || 0);
  const signo = direccion === "acreedor" ? -1 : +1;
  return post({ action: "add", sheet: "nb_socios_cc", row: {
    id: newId("SCC"), socio_id, socio_nombre, sociedad, fecha,
    tipo: "apertura", moneda, monto: signo * m,
    nota: nota || `Apertura pre go-live (${direccion})`, created_at: new Date().toISOString(),
  }});
}

// Saldos por socio → { activo:[], pasivo:[] } (presentación bruta, como franquiciados):
//   neto > 0 (nos debe)  → Activo "Socios"
//   neto < 0 (le debemos) → Pasivo "Socios (les debemos)"
// Une nb_socios_cc (no-cash) + nb_movimientos origen="socios" (caja), por socio y moneda.
// Si `sociedad` viene → filtra a esa (slice del Balance por sociedad); si null → group-level.
export function sociosSaldos(socios = [], ccRows = [], movs = [], { sociedad = null, soloMoneda = null } = {}) {
  const soc = sociedad ? String(sociedad).toLowerCase() : null;
  const nombreDe = id => (socios.find(s => String(s.id) === String(id))?.nombre) || id;
  // acc[socio_id][moneda] = neto (+ nos debe / − le debemos)
  const acc = {};
  const add = (sid, moneda, delta) => {
    if (!sid) return;
    (acc[sid] ??= {});
    acc[sid][moneda] = (acc[sid][moneda] || 0) + delta;
  };
  for (const r of (ccRows || [])) {
    if (soc && String(r.sociedad ?? "").toLowerCase() !== soc) continue;
    add(r.socio_id, r.moneda || "ARS", toNum(r.monto));   // ya viene firmado
  }
  for (const m of (movs || [])) {
    if (m.origen !== "socios") continue;
    if (soc && String(m.sociedad ?? "").toLowerCase() !== soc) continue;
    const signo = SOCIO_SIGNO_CAJA[m.socio_tipo] ?? 0;
    if (!signo) continue;
    add(m.contraparte_id, m.moneda || "ARS", signo * Math.abs(toNum(m.monto)));
  }
  const MON = ["ARS", "USD", "EUR"];
  const activo = [], pasivo = [];
  for (const moneda of MON) {
    if (soloMoneda && moneda !== soloMoneda) continue;
    const deben = [], debemos = [];
    let totA = 0, totP = 0;
    for (const [sid, porMon] of Object.entries(acc)) {
      const neto = porMon[moneda] || 0;
      if (neto > 0.01)       { deben.push({ contraparte: nombreDe(sid), vto: "", saldo: neto, moneda });    totA += neto; }
      else if (neto < -0.01) { debemos.push({ contraparte: nombreDe(sid), vto: "", saldo: -neto, moneda }); totP += -neto; }
    }
    if (totA > 0.01) { deben.sort((a, b) => b.saldo - a.saldo);   activo.push({ label: "Socios", moneda, saldo: totA, docs: deben, headerColor: "#7c3aed" }); }
    if (totP > 0.01) { debemos.sort((a, b) => b.saldo - a.saldo); pasivo.push({ label: "Socios (les debemos)", moneda, saldo: totP, docs: debemos, headerColor: "#7c3aed" }); }
  }
  return { activo, pasivo };
}

// ─── ANTICIPOS DE CLIENTES ────────────────────────────────────────────────────
//
// Cobro adelantado de un cliente: entra plata (caja) pero NO es ingreso → pasivo
// "ingresos diferidos". Se consume al FACTURAR (la factura reconoce el ingreso) cobrando
// "contra el anticipo": un movimiento sin caja que cierra la CxC de la factura y baja el
// saldo del anticipo. Todo vive en nb_movimientos (sin tabla nueva):
//   · alta    → origen="anticipo_alta",    tipo=COBRO, documento_id=self, contraparte=cliente
//   · consumo → origen="anticipo_consumo", tipo=COBRO, cuenta_bancaria="", documento_id=factura,
//               referencia="anticipo=<altaId>"
// Ninguno entra al P&L (no llevan "CONTAB-"); el ingreso lo aporta la factura (nb_comprobantes).

/** Agrupa los movimientos en anticipos (alta + sus consumos) con saldo derivado. Puro. */
export function agruparAnticipos(movs = []) {
  const consumos = {};   // altaId → [{id, factura_id, monto, fecha}]
  for (const m of movs) {
    if (m.origen !== "anticipo_consumo") continue;
    const ant = (String(m.referencia || "").match(/anticipo=([^;]+)/) || [])[1] || "";
    if (!ant) continue;
    (consumos[ant] ||= []).push({ id: m.id, factura_id: m.documento_id, monto: Math.abs(toNum(m.monto)), fecha: m.fecha });
  }
  return movs.filter(m => m.origen === "anticipo_alta").map(a => {
    const monto     = Math.abs(toNum(a.monto));
    const cons      = consumos[a.id] || [];
    const consumido = cons.reduce((s, c) => s + c.monto, 0);
    const saldo     = Math.max(0, monto - consumido);
    return {
      id: a.id, sociedad: a.sociedad, fecha: a.fecha, moneda: a.moneda || "ARS",
      cliente_id: a.contraparte_id || "", cliente_nombre: a.contraparte_nombre || "",
      monto, consumido, saldo,
      estado: saldo <= 0.01 ? "consumido" : "disponible",
      es_apertura: /anticipo_apertura=1/.test(a.referencia || ""),
      consumos: cons,
    };
  });
}

/** Trae los anticipos de una sociedad, agrupados con saldo + consumos. */
export async function fetchAnticipos(sociedad) {
  const movs = await get("nb_movimientos", sociedad ? { sociedad } : {});
  return agruparAnticipos(movs);
}

/**
 * Alta de un anticipo de cliente. Caja ↑ (salvo apertura: la plata ya está en el saldo inicial
 * → sin cuenta bancaria). Nace el pasivo; NO es ingreso (no toca el P&L).
 */
export async function appendAnticipo({ sociedad, cliente_id = "", cliente_nombre = "", fecha, monto, moneda = "ARS", cuenta_bancaria = "", es_apertura = false, nota = "" }) {
  const id = newId("ANT");
  return post({ action: "add", sheet: "nb_movimientos", row: {
    id, sociedad, fecha,
    tipo: "COBRO",
    cuenta_bancaria: es_apertura ? "" : cuenta_bancaria,
    cuenta_destino: "", cuenta_contable: "", centro_costo: "",
    moneda, monto: Math.abs(Number(monto) || 0),
    documento_id: id,                                   // self → no matchea ninguna factura
    concepto: `Anticipo ${cliente_nombre || ""}`.trim() + (nota ? ` · ${nota}` : ""),
    contraparte_id: cliente_id, contraparte_nombre: cliente_nombre,
    referencia: es_apertura ? "anticipo_apertura=1" : "",
    origen: "anticipo_alta",
    created_at: new Date().toISOString(),
  }});
}

/**
 * Cobra una factura de venta CONTRA un anticipo (sin caja): cierra la CxC de la factura
 * (documento_id) y baja el saldo del anticipo (referencia anticipo=<id>). Parcial OK.
 */
export async function cobrarContraAnticipo({ factura_id, anticipo_id, sociedad, fecha, monto, moneda = "ARS", cliente_id = "", cliente_nombre = "" }) {
  const id = newId("ANTC");
  return post({ action: "add", sheet: "nb_movimientos", row: {
    id, sociedad, fecha,
    tipo: "COBRO", cuenta_bancaria: "", cuenta_destino: "", cuenta_contable: "", centro_costo: "",
    moneda, monto: Math.abs(Number(monto) || 0),
    documento_id: factura_id,                           // netea la CxC de la factura
    concepto: `Cobro c/ anticipo ${factura_id}`,
    contraparte_id: cliente_id, contraparte_nombre: cliente_nombre,
    referencia: `anticipo=${anticipo_id}`,
    origen: "anticipo_consumo",
    created_at: new Date().toISOString(),
  }});
}

/** Borra un anticipo y sus consumos (re-abre las CxC que había cerrado). */
export async function deleteAnticipo(anticipo_id) {
  const movs = await get("nb_movimientos", {});
  const ids = movs.filter(m =>
    (m.origen === "anticipo_alta" && m.id === anticipo_id) ||
    (m.origen === "anticipo_consumo" && new RegExp(`anticipo=${anticipo_id}(;|$)`).test(m.referencia || ""))
  ).map(m => m.id);
  for (const id of ids) await post({ action: "del", sheet: "nb_movimientos", id });
}

/** Pasivo de anticipos (ingresos diferidos) por moneda + docs. Fuente única para Tesorería/Balance. */
export function anticipoPasivo(anticipos, sociedad) {
  const soc = String(sociedad ?? "").toLowerCase();
  const tot = { ARS: 0, USD: 0, EUR: 0 };
  const docs = [];
  for (const a of (anticipos ?? [])) {
    if (soc && String(a.sociedad ?? "").toLowerCase() !== soc) continue;
    if (a.saldo <= 0) continue;
    const mon = a.moneda || "ARS";
    if (mon in tot) tot[mon] += a.saldo;
    docs.push({ cliente: a.cliente_nombre, fecha: a.fecha, saldo: a.saldo, moneda: mon });
  }
  return { tot, docs };
}
