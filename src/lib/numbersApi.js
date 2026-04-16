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

function newId(prefix) {
  return `${prefix}-${pad(Date.now() % 100000)}`;
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
  const egRows = rows.filter(r => { const s = (r.subtipo ?? "").toUpperCase(); return s === "EGRESO" || s === "GASTO"; });
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
  return get("nb_movimientos", { sociedad });
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
  return post({ action: "add", sheet: "nb_cuentas_bancarias", row: { id: newId("CB"), ...cuenta, activo: true, created_at: new Date().toISOString() } });
}

export async function updateCuentaBancaria(id, patch) {
  return post({ action: "edit", sheet: "nb_cuentas_bancarias", id, patch });
}

export async function deleteCuentaBancaria(id) {
  return post({ action: "del", sheet: "nb_cuentas_bancarias", id });
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

// ─── GASTO DIRECTO ───────────────────────────────────────────────────────────
//
// Un gasto directo se paga en el momento → genera:
//   1. Una fila en nb_comprobantes  (subtipo=GASTO)  → aparece en P&L
//   2. Una fila en nb_movimientos   (tipo=EGRESO_GASTO) → aparece en Cash Flow

export async function appendGastoDirecto({ sociedad, fecha, cuenta_contable, cuenta_contable_id = "", cc = "", moneda = "ARS", subtotal, ivaRate = 0, nota = "", cuenta_bancaria, referencia = "" }) {
  const id_comp    = newId("GD");
  const created_at = new Date().toISOString();
  const sub = Number(subtotal) || 0;
  const iva = sub * ((Number(ivaRate) || 0) / 100);
  const total = sub + iva;

  // 1. Comprobante
  await post({
    action: "add", sheet: "nb_comprobantes",
    row: {
      id:                  `${id_comp}-L001`,
      id_comp,
      sociedad, fecha,
      vto:                 fecha,
      subtipo:             "GASTO",
      contraparte_id:      "",
      contraparte_nombre:  "",
      cuenta_contable,
      cuenta_contable_id,
      moneda,
      centro_costo:        cc,
      subtotal:            sub,
      iva_rate:            Number(ivaRate) || 0,
      iva_monto:           iva,
      total,
      nro_comp:            "",
      nota,
      created_at,
    },
  });

  // 2. Movimiento de tesorería
  await post({
    action: "add", sheet: "nb_movimientos",
    row: {
      id:              newId("GD-MOV"),
      sociedad, fecha,
      tipo:            "EGRESO_GASTO",
      cuenta_bancaria,
      cuenta_destino:  "",
      cuenta_contable,
      centro_costo:    cc,
      moneda,
      monto:           -total,
      documento_id:    id_comp,
      concepto:        nota || `Gasto directo: ${cuenta_contable}`,
      referencia,
      origen:          "gasto_directo",
      created_at,
    },
  });

  return { ok: true, id_comp };
}

// ─── P&L — Líneas enriquecidas ────────────────────────────────────────────────
//
// Lee nb_comprobantes (ya tiene header + CC en cada fila) y filtra por subtipo.
// No necesita join — cada fila ya tiene cuenta_contable, centro_costo, total, fecha.

// subtipo: "EGRESO_FC" | "INGRESO_FC" | "GASTO" | null (todos)
// Para P&L de egresos pasar ["EGRESO_FC","GASTO"] para incluir gastos directos.
export async function fetchLineasEnriquecidas(sociedad, subtipo) {
  const rows = await get("nb_comprobantes", { sociedad });
  if (!subtipo) return rows;
  const subs = Array.isArray(subtipo) ? subtipo.map(s => s.toUpperCase()) : [subtipo.toUpperCase()];
  return rows.filter(r => subs.includes((r.subtipo ?? "").toUpperCase()));
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
      subtotal:    Number(row.subtotal)  || 0,
      ivaRate:     Number(row.iva_rate)  || 0,
      iva_monto:   Number(row.iva_monto) || 0,
      total_linea: Number(row.total)     || 0,
    });
    comp.total += Number(row.total) || 0;
    comp.importe = comp.total;
  }
  return Array.from(map.values());
}
