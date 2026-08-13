// ─── BIGG Numbers — API layer (Google Sheets via Apps Script) ────────────────
// Proxy: /api/numbers  →  Apps Script Web App  →  Sheet: BIGG Numbers
// Configurar en .env.local:
//   VITE_NUMBERS_API_URL=https://script.google.com/macros/s/.../exec

import { stamp, firma } from "./auth";
import { bustToken, forzarRefresco } from "./cacheBust";
import { fetchLegajos } from "./sueldosApi";   // solo lectura (mapa legajo→sociedad para interco de sueldos)

const CONFIGURED = !!import.meta.env.VITE_NUMBERS_API_URL;
const TOKEN      = import.meta.env.VITE_SHEETS_TOKEN;   // mismo token
const BASE       = "/api/numbers";

// ─── Helpers internos ────────────────────────────────────────────────────────

// Cache de GETs: evita refetch al navegar entre tabs y deduplica requests simultáneos.
// El backend (Apps Script) cobra ~2,5-4s FIJOS por request sin importar el tamaño de la hoja,
// y cada pantalla pide ~20 recursos (muchos repetidos) → la lentitud es la CANTIDAD de requests.
// Cache más largo = se re-piden mucho menos al navegar. Toda escritura invalida su hoja (_invalidate),
// así que las propias ediciones se ven al instante; solo lo que carga OTRO usuario tarda hasta el TTL.
const _cache    = new Map(); // key → { data, ts }
const _inflight = new Map(); // key → Promise
const CACHE_TTL        = 90_000;    // transaccional (movimientos/comprobantes/…): 90 s
const CACHE_TTL_MASTER = 600_000;   // maestros (casi nunca cambian en una sesión): 10 min
// Recursos "maestro" = catálogos estables; se re-piden en casi toda pantalla pero cambian rarísimo.
const MASTER_RES = new Set([
  "nb_cuentas", "nb_centros_costo", "nb_proveedores", "nb_clientes",
  "nb_sociedades", "nb_cuentas_bancarias", "nb_banco_reglas", "nb_usuarios",
]);
const ttlDe = resource => (MASTER_RES.has(resource) ? CACHE_TTL_MASTER : CACHE_TTL);

function _invalidate(sheet) {
  for (const key of _cache.keys()) {
    // Limpia la hoja Y cualquier batch (__multi) que pueda contenerla → tras escribir, el próximo
    // primeCache re-trae fresco (si no, un batch cacheado re-sembraría datos viejos por hasta el TTL).
    if (key.startsWith(`resource=${sheet}`) || key.startsWith("resource=__multi")) _cache.delete(key);
  }
}

async function get(resource, params = {}) {
  if (!CONFIGURED) throw new Error("VITE_NUMBERS_API_URL no configurada");
  // `_cb` (solo dentro de la ventana de refresco) hace que la URL cambie → el CDN de Vercel falla el
  // match y pide fresco al origen. Fuera de la ventana no va, así el equipo comparte la caché de borde.
  const cb  = bustToken();
  const qs  = new URLSearchParams({ resource, token: TOKEN, ...params, ...(cb ? { _cb: cb } : {}) }).toString();
  const key = qs;

  // Devolver cache si es fresco (TTL según sea maestro o transaccional)
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < ttlDe(resource)) return cached.data;

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

// Lee una hoja SIN cache (para la verificación de idempotencia en un reintento de escritura).
// `_nocache` único ⇒ salta también la caché de BORDE (el `no-store` del fetch solo evita la del
// navegador); leer stale acá podría concluir "la fila no entró" y re-agregarla → duplicado.
async function _fetchRowsRaw(sheet) {
  const qs  = new URLSearchParams({ resource: sheet, token: TOKEN, _nocache: `${Date.now()}.${Math.random()}` }).toString();
  const res = await fetch(`${BASE}?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return Array.isArray(data) ? data : (data.rows || data.data || []);
}

async function post(body) {
  if (!CONFIGURED) throw new Error("VITE_NUMBERS_API_URL no configurada");
  // Sello de autoría: estampa `registrado_por` en cada asiento nuevo (add/add_batch)
  // sin tocar los ~20 writers. GAS descarta la columna en las hojas sin ese header,
  // así que los maestros no se ven afectados. No pisa un valor explícito.
  stamp(body);

  // Reintento con espera ante cortes transitorios de red (el GAS es lento y a veces la respuesta se
  // pierde DESPUÉS de que la escritura ya entró → antes daba "error" con el dato ya guardado, o dejaba
  // una transferencia a medias). Un rechazo lógico del backend (data.error) NO se reintenta: es
  // definitivo. Los add/add_batch son idempotentes en el reintento: si las filas ya existen (id
  // explícito), no se re-agregan → cero duplicados. edit/del son idempotentes por naturaleza.
  const isAdd  = body.action === "add" || body.action === "add_batch";
  const addIds = body.action === "add"       ? [body.row?.id].filter(Boolean)
               : body.action === "add_batch" ? (body.rows || []).map(r => r?.id).filter(Boolean)
               : [];
  const totalRows = body.action === "add" ? 1 : (body.rows || []).length;

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    // En un reintento de un add: si la escritura anterior YA entró, no re-agregar (evita duplicados).
    if (attempt > 0 && isAdd) {
      // Solo se puede deduplicar con id explícito en TODAS las filas; si no, no se reintenta.
      if (!addIds.length || addIds.length !== totalRows) throw lastErr;
      try {
        const existentes = new Set((await _fetchRowsRaw(body.sheet)).map(r => String(r.id)));
        const faltan = addIds.filter(id => !existentes.has(String(id)));
        if (!faltan.length) { _invalidate(body.sheet); forzarRefresco(); return { ok: true, deduped: true }; }
        // Batch parcialmente escrito: no se puede re-mandar solo lo que falta sin duplicar lo que entró.
        if (faltan.length !== addIds.length) throw lastErr;
      } catch { throw lastErr; }   // ante la duda, no arriesgar un duplicado
    }
    try {
      const res = await fetch(BASE, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...body, token: TOKEN }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) { const e = new Error(data.error); e._serverReject = true; throw e; }
      if (body.sheet) _invalidate(body.sheet);
      // Abre la ventana de refresco: los próximos GET de este navegador saltan el borde por unos
      // segundos → ves tu propio cambio al instante (y de paso lo último del resto del equipo).
      forzarRefresco();
      return data;
    } catch (e) {
      lastErr = e;
      if (e._serverReject) throw e;   // rechazo del backend → reintentar no cambia nada
      if (attempt < 2) await new Promise(r => setTimeout(r, (attempt + 1) * 600));
    }
  }
  throw lastErr;
}

// ─── Batch de lectura (getMulti) ──────────────────────────────────────────────
// Trae VARIAS hojas del GAS en UNA sola llamada (el backend serializa los requests a ~3-4s c/u,
// así una pantalla de ~10 fetch pasaba de ~8 round-trips a 1). specs = [{ resource, sociedad? }].
// Devuelve { <resource>: filas[] }. Cachea/deduplica y respeta la ventana de refresco (_cb) igual que get().
export async function getMulti(specs = []) {
  if (!CONFIGURED) throw new Error("VITE_NUMBERS_API_URL no configurada");
  const spec = specs.map(x => (x.sociedad ? { r: x.resource, s: x.sociedad } : { r: x.resource }));
  const cb   = bustToken();
  const qs   = new URLSearchParams({ resource: "__multi", spec: JSON.stringify(spec), token: TOKEN, ...(cb ? { _cb: cb } : {}) }).toString();
  const key  = qs;

  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
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

// Precalienta la caché individual con UN solo batch: los get(resource, {sociedad?}) que dispare la
// pantalla justo después salen de caché (0 red). Best-effort: si el batch falla (GAS viejo, error),
// no siembra nada y la pantalla cae a las llamadas de a una — mismo comportamiento que antes.
// Las claves sembradas replican EXACTO las que arma get() (mismo orden de params + _cb) → hit garantizado.
export async function primeCache(specs = []) {
  if (!CONFIGURED || !specs.length) return;
  const cb = bustToken();
  let data;
  try { data = await getMulti(specs); }
  catch { return; }
  for (const s of specs) {
    const rows = data[s.resource];
    if (rows == null) continue;
    const key = new URLSearchParams({ resource: s.resource, token: TOKEN, ...(s.sociedad ? { sociedad: s.sociedad } : {}), ...(cb ? { _cb: cb } : {}) }).toString();
    _cache.set(key, { data: rows, ts: Date.now() });
  }
}

// ─── Generador de IDs ────────────────────────────────────────────────────────

const pad  = (n, l = 5) => String(n).padStart(l, "0");

// Contador de sesión: garantiza unicidad aunque se generen varios ids en el mismo
// milisegundo (ej. loop de ingesta de 285 líneas) o al re-subir. El componente de
// tiempo agrega entropía entre sesiones; el `_seq` asegura que NUNCA se repita dentro
// de una. (Antes: solo Date.now()%100000 → colisionaba y dejaba filas con id duplicado.)
// Salt aleatorio POR SESIÓN (3 chars base36): dos cargas/pestañas distintas pueden coincidir en
// Date.now()%100000 Y en _seq (ambas en su 1er id) → sin salt colisionaban y dejaban filas con id
// duplicado. Con el salt, la colisión entre sesiones es despreciable (~1/46k adicional).
const _salt = Math.floor(Math.random() * 46656).toString(36).padStart(3, "0");
let _seq = 0;
function newId(prefix) {
  return `${prefix}-${pad(Date.now() % 100000)}-${_salt}${_seq++}`;
}

/**
 * Convierte un valor numérico que puede venir de Sheets como string con coma decimal
 * (ej: "362591,17" → 362591.17, "1.234,56" → 1234.56).
 * Si no contiene coma, lo trata como formato estándar (punto decimal o entero).
 */
export function toNum(v) {
  if (typeof v === "number") return v;
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).trim();
  // Formato argentino: coma como separador decimal → strip puntos de miles, reemplazar coma
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", ".")) || 0;
  return Number(s) || 0;
}

/** Redondeo a centavos (2 decimales). Los montos monetarios se guardan y comparan redondeados
 *  para que no queden residuos de milésimas (ej. subtotal×1,21 = …,5814) que dejan una factura
 *  colgada en "A Pagar $0,00" y nunca cierran. */
export const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

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
  const rows = await get("nb_comprobantes", sociedad ? { sociedad } : {});
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
    const sub = round2(Number(l.subtotal) || 0);
    const iva = round2(sub * ((Number(l.ivaRate) || 0) / 100));
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
        total:               round2(sub + iva),
        nro_comp:            header.nroComp ?? "",
        nota:                header.nota    ?? "",
        created_at,
      },
    });
  }
  return { ok: true, id_comp };
}

// ── CARGAS SOCIALES (F931 / aportes sindicales / obligaciones por sociedad) ────
// Cada obligación mensual = un EGRESO en nb_comprobantes (CxP), con una línea por centro
// (prorrateo por haberes en blanco, calculado en la UI con baseHaberesPorCentro de sueldosApi).
// Proveedor y cuenta se eligen por asiento (AFIP/ARCA, UTEDYC, …). Sin hoja propia: el histórico
// se lee de nb_comprobantes. Se marcan con CS_TAG en la nota para poder listarlas en el módulo.
export const CS_TAG = "[CARGASOC]";

export async function appendCargaSocial({ sociedad, proveedorId = "", proveedor = "", cuenta, cuentaId = "", mes, anio, vep = "", vto = "", lineas = [], concepto = "" }) {
  const ud = new Date(Number(anio), Number(mes), 0).getDate();   // último día del mes → cae en el P&L de ese mes
  const fecha = `${anio}-${String(mes).padStart(2, "0")}-${String(ud).padStart(2, "0")}`;
  const nota = `${CS_TAG} ${concepto || `Cargas sociales ${mes}/${anio}`}`;
  const id_comp = newId("EG");
  const created_at = new Date().toISOString();
  const cta = String(cuenta || "").replace(/^CUENTA_/, "");
  // UNA sola escritura atómica (add_batch): todas las líneas de centro en un POST. Evita el
  // comprobante a medias que dejaba el loop secuencial de appendEgreso cuando el GAS se cuelga.
  const rows = lineas
    .filter(l => (Number(l.subtotal) || 0) !== 0)
    .map((l, i) => {
      const sub = round2(Number(l.subtotal) || 0);
      return {
        id: `${id_comp}-L${pad(i + 1)}`, id_comp, sociedad, fecha, vto,
        subtipo: "EGRESO",
        contraparte_id: proveedorId, contraparte_nombre: proveedor,
        cuenta_contable: cta, cuenta_contable_id: cuentaId,
        moneda: "ARS", centro_costo: l.cc,
        subtotal: sub, iva_rate: 0, iva_monto: 0, total: sub,
        nro_comp: vep,   // el VEP → N° de comprobante (para conciliar el débito del banco)
        nota, created_at,
      };
    });
  if (!rows.length) return { ok: true, id_comp, n: 0 };
  await post({ action: "add_batch", sheet: "nb_comprobantes", rows });
  return { ok: true, id_comp, n: rows.length };
}

// Lista las cargas sociales de un mes/anio leyendo nb_comprobantes (marca CS_TAG), agrupadas por
// comprobante, con distribución por centro y estado de pago (vía pagos que las referencian).
export async function fetchCargasSociales(mes, anio) {
  const [comps, pagos] = await Promise.all([get("nb_comprobantes", {}), fetchPagosCobros()]);
  const pagadoByComp = {};
  for (const p of (pagos || [])) if (p.tipo === "PAGO" && p.documento_id) pagadoByComp[p.documento_id] = (pagadoByComp[p.documento_id] || 0) + Math.abs(Number(p.monto) || 0);
  const byComp = {};
  for (const r of (comps || [])) {
    if (!String(r.nota || "").includes(CS_TAG)) continue;
    if (String(r.subtipo || "").toUpperCase() !== "EGRESO") continue;
    const f = String(r.fecha || "");
    if (f.slice(0, 4) !== String(anio) || Number(f.slice(5, 7)) !== Number(mes)) continue;
    const k = r.id_comp;
    if (!byComp[k]) byComp[k] = {
      id_comp: k, sociedad: r.sociedad, proveedor: r.contraparte_nombre || r.contraparte_id || "",
      proveedorId: r.contraparte_id || "", cuenta: r.cuenta_contable || "", vep: r.nro_comp || "",
      vto: r.vto || "", fecha: r.fecha || "", monto_total: 0, distribucion: {},
    };
    const t = toNum(r.total);
    byComp[k].monto_total += t;
    const cc = r.centro_costo || "";
    byComp[k].distribucion[cc] = (byComp[k].distribucion[cc] || 0) + t;
  }
  return Object.values(byComp).map(c => ({
    ...c,
    pagado: c.monto_total > 0 && calcSaldoPendiente(c.monto_total, [{ monto: pagadoByComp[c.id_comp] || 0 }]) <= 0.5,
  })).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

/** Elimina todas las líneas de un egreso (por id_comp).
 *  ROBUSTO: tras el del_comp, RE-LEE sin cache y borra por id cualquier fila que haya
 *  quedado con ese id_comp. Visto en prod: al re-guardar una edición, una línea vieja
 *  sobrevivía al del_comp → quedaba duplicada con la re-agregada. Este barrido garantiza
 *  slate limpio antes del re-alta (appendEgreso corre después en el flujo de edición). */
export async function deleteEgreso(id_comp) {
  await post({ action: "del_comp", sheet: "nb_comprobantes", id_comp });
  try {
    const restos = (await _fetchRowsRaw("nb_comprobantes")).filter(r => String(r.id_comp) === String(id_comp));
    for (const r of restos) if (r.id) await post({ action: "del", sheet: "nb_comprobantes", id: r.id });
  } catch { /* la verificación es best-effort; el del_comp principal ya corrió */ }
  return { ok: true };
}

/**
 * Sincroniza las líneas de un comprobante EXISTENTE contra su versión editada, línea a línea
 * (edit/add/del por índice) en vez de borrar todo y recrear. Si una escritura falla a mitad de
 * camino, el comprobante queda parcialmente actualizado — nunca vacío, a diferencia del viejo
 * patrón deleteEgreso()+appendEgreso() que perdía el comprobante entero ante cualquier fallo del
 * segundo paso (ver handleSave de Egresos/Ingresos). Mantiene el mismo id_comp, así que los
 * pagos/cobros ya vinculados (documento_id=id_comp) siguen apuntando al comprobante correcto.
 */
async function _syncLineasComprobante(id_comp, subtipo, header, lineas, idKey, nombreKey) {
  const rows = await get("nb_comprobantes", {});
  const actuales = rows
    .filter(r => String(r.id_comp) === String(id_comp))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const created_at = new Date().toISOString();
  const n = Math.max(lineas.length, actuales.length);

  for (let i = 0; i < n; i++) {
    const rowId = `${id_comp}-L${pad(i + 1)}`;
    if (i >= lineas.length) {
      await post({ action: "del", sheet: "nb_comprobantes", id: rowId });
      continue;
    }
    const l   = lineas[i];
    const sub = round2(Number(l.subtotal) || 0);
    const iva = round2(sub * ((Number(l.ivaRate) || 0) / 100));
    const row = {
      id: rowId, id_comp,
      sociedad:            header.sociedad,
      fecha:               header.fecha,
      vto:                 header.vto ?? "",
      subtipo,
      contraparte_id:      header[idKey]     ?? "",
      contraparte_nombre:  header[nombreKey] ?? "",
      cuenta_contable:     header.cuenta      ?? "",
      cuenta_contable_id:  header.cuentaId    ?? "",
      moneda:              header.moneda ?? "ARS",
      centro_costo:        l.cc ?? "",
      subtotal:            sub,
      iva_rate:            Number(l.ivaRate) || 0,
      iva_monto:           iva,
      total:               round2(sub + iva),
      nro_comp:            header.nroComp ?? "",
      nota:                header.nota    ?? "",
      created_at,
    };
    if (i < actuales.length) {
      await post({ action: "edit", sheet: "nb_comprobantes", id: rowId, patch: row });
    } else {
      await post({ action: "add", sheet: "nb_comprobantes", row });
    }
  }
  return { ok: true, id_comp };
}

/** Edita un egreso existente sin borrar-y-recrear (ver _syncLineasComprobante). */
export async function updateEgreso(id_comp, egreso) {
  const { lineas = [], ...header } = egreso;
  return _syncLineasComprobante(id_comp, "EGRESO", header, lineas, "proveedorId", "proveedor");
}

/**
 * Migra un comprobante (egreso o ingreso) a otra sociedad: cambia el campo `sociedad` en todas
 * sus líneas. La cuenta contable y el centro de costo son maestros group-level, así que siguen
 * válidos. `comp.lineas[].id` ya trae la clave de fila (ver _agruparPorComp), así que no hace
 * falta releer la hoja. Pensado para el caso "lo cargué en la sociedad equivocada" → sin pagos.
 */
export async function migrarComprobanteSociedad(comp, nuevaSociedad) {
  const ids = (comp?.lineas || []).map(l => l.id).filter(Boolean);
  await Promise.all(ids.map(id =>
    post({ action: "edit", sheet: "nb_comprobantes", id, patch: { sociedad: nuevaSociedad } })));
  return { ok: true, migradas: ids.length };
}

// ─── CORREO — bandeja consolidada de facturas desde el mail ─────────────────────
// El lector (asistido vía conector Gmail, o server-side a futuro; SIEMPRE read-only sobre Gmail) parkea cada
// factura como una fila subtipo="EGRESO_BORRADOR" en nb_comprobantes. Es INVISIBLE al ledger porque el P&L, la
// CxP (derivarSaldos) y Egresos filtran subtipo==="EGRESO". id_comp="COR-<mailId>" → dedup natural. El estado
// vive acá (NO en Gmail). Aceptar = crear el EGRESO real (con N líneas/centros) y borrar el borrador.
const CORREO_PREFIX = "COR-";

/** Facturas parkeadas (todas las sociedades) pendientes de contabilizar. Consolidado, sin scope de sociedad. */
export async function fetchCorreoBorradores() {
  const rows = await get("nb_comprobantes", {});
  const brs = rows.filter(r => (r.subtipo ?? "").toUpperCase() === "EGRESO_BORRADOR");
  return _agruparPorComp(brs, "EGRESO");   // mismo shape que un egreso (proveedor/vto/moneda/total)
}

/**
 * Parkea una factura leída del mail. Idempotente por id_comp=COR-<mailId>. Dedup: si ya existe una fila con ese
 * id_comp (borrador/ignorado), o un EGRESO real con el mismo nº+proveedor, NO duplica (devuelve dedup).
 */
export async function parkearFacturaCorreo({ mailId, threadId = "", remitente = "", fechaCorreo = "", proveedorId = "", proveedor = "", cuenta = "", cuentaId = "", sociedad = "", moneda = "ARS", total, ivaRate = 0, vto = "", nroComp = "", fechaServicio = "" }) {
  const id_comp = CORREO_PREFIX + mailId;
  const rows = await get("nb_comprobantes", {});
  if (rows.some(r => String(r.id_comp) === id_comp)) return { ok: true, dedup: "mail", id_comp };
  const nro = String(nroComp || "").trim();
  if (nro && rows.some(r => (r.subtipo ?? "").toUpperCase() === "EGRESO"
      && (r.nro_comp ?? "").trim() === nro && String(r.contraparte_id ?? "") === String(proveedorId)))
    return { ok: true, dedup: "fc", id_comp };
  // El total viene del mail (bruto). Si el proveedor discrimina IVA, se abre subtotal + iva_monto.
  const t   = round2(Number(total) || 0);
  const rate = Number(ivaRate) || 0;
  const sub  = rate > 0 ? round2(t / (1 + rate / 100)) : t;
  const iva  = round2(t - sub);
  await post({ action: "add", sheet: "nb_comprobantes", row: {
    id: `${id_comp}-L01`, id_comp,
    sociedad, fecha: fechaServicio || "", vto,       // fecha = fecha del servicio (período de la factura)
    subtipo: "EGRESO_BORRADOR",
    contraparte_id: proveedorId, contraparte_nombre: proveedor,
    cuenta_contable: cuenta, cuenta_contable_id: cuentaId,
    moneda, centro_costo: "",
    subtotal: sub, iva_rate: rate, iva_monto: iva, total: t,
    nro_comp: nro,
    nota: `mail_ref=${threadId || mailId};fecha_correo=${fechaCorreo};remitente=${remitente}`,
    created_at: new Date().toISOString(),
  }});
  return { ok: true, id_comp };
}

/** Aceptar un borrador → crea el EGRESO real (N líneas/centros vía appendEgreso) y borra el borrador. */
export async function contabilizarBorrador(id_comp, egreso) {
  const nota = (egreso.nota ? egreso.nota + " · " : "") + `desde_correo=${id_comp}`;
  const res = await appendEgreso({ ...egreso, id: undefined, nota });   // id nuevo (EG-), NO reusa el COR-
  await deleteEgreso(id_comp);
  return { ok: true, id_comp_nuevo: res.id_comp };
}

/** Aplica un patch a todas las filas de un borrador (por id_comp). Base de ignorar/restaurar. */
async function _patchBorrador(id_comp, patch) {
  const rows = await get("nb_comprobantes", {});
  const ids = rows.filter(r => String(r.id_comp) === String(id_comp)).map(r => r.id);
  await Promise.all(ids.map(id => post({ action: "edit", sheet: "nb_comprobantes", id, patch })));
  return { ok: true, n: ids.length };
}

/** Ignorar un borrador (queda EGRESO_IGNORADO: invisible al ledger, pero el id COR- recuerda que ya se vio). */
export const ignorarBorrador  = (id_comp, motivo = "") =>
  _patchBorrador(id_comp, { subtipo: "EGRESO_IGNORADO", nota: motivo ? `ign=${motivo}` : "" });

/** Restaurar un borrador ignorado → vuelve a la bandeja. */
export const restaurarBorrador = (id_comp) =>
  _patchBorrador(id_comp, { subtipo: "EGRESO_BORRADOR" });

// ─── INGRESOS ────────────────────────────────────────────────────────────────

export async function fetchIngresos(sociedad) {
  const rows = await get("nb_comprobantes", sociedad ? { sociedad } : {});
  const inRows = rows.filter(r => (r.subtipo ?? "").toUpperCase() === "INGRESO");
  return _agruparPorComp(inRows, "INGRESO");
}

export async function appendIngreso(ingreso) {
  const { lineas = [], ...header } = ingreso;
  const id_comp    = header.id || newId("IN");
  const created_at = new Date().toISOString();

  for (let i = 0; i < lineas.length; i++) {
    const l   = lineas[i];
    const sub = round2(Number(l.subtotal) || 0);
    const iva = round2(sub * ((Number(l.ivaRate) || 0) / 100));
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
        total:               round2(sub + iva),
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

/** Edita un ingreso existente sin borrar-y-recrear (ver _syncLineasComprobante, junto a updateEgreso). */
export async function updateIngreso(id_comp, ingreso) {
  const { lineas = [], ...header } = ingreso;
  return _syncLineasComprobante(id_comp, "INGRESO", header, lineas, "clienteId", "cliente");
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
  const movs = await get("nb_movimientos", sociedad ? { sociedad } : {});
  return movs.filter(m => m.tipo === "PAGO" || m.tipo === "COBRO" || m.tipo === "EGRESO_GASTO");
}

/**
 * Registra un pago contra un egreso.
 * Escribe directamente en nb_movimientos (monto negativo).
 */
export async function appendPago({ documento_id, sociedad, fecha, monto, moneda, cuenta_bancaria, cuenta = "", referencia, nota }) {
  const id = newId("PAG");
  return post({
    action: "add", sheet: "nb_movimientos",
    row: {
      id, sociedad, fecha,
      tipo:            "PAGO",
      cuenta_bancaria,
      cuenta_destino:  "",
      cuenta_contable: cuenta,
      centro_costo:    "",   // el centro vive en el comprobante (que puede tener varios); el pago no lo lleva. Cash Flow lo deriva de la FC linkeada.
      moneda,
      monto:           -Math.abs(monto),
      documento_id,
      concepto:        `Pago ${documento_id}`,
      nota:            nota ?? "",
      referencia:      referencia ?? "",
      origen:          "pago",
      created_at:      new Date().toISOString(),
    },
  });
}

/** Registra un cobro contra un ingreso. Escribe en nb_movimientos (monto positivo). */
export async function appendCobro({ documento_id, sociedad, fecha, monto, moneda, cuenta_bancaria, cuenta = "", referencia, nota }) {
  const id = newId("COB");
  return post({
    action: "add", sheet: "nb_movimientos",
    row: {
      id, sociedad, fecha,
      tipo:            "COBRO",
      cuenta_bancaria,
      cuenta_destino:  "",
      cuenta_contable: cuenta,
      centro_costo:    "",   // idem appendPago: el centro es del comprobante; Cash Flow lo deriva de la FC.
      moneda,
      monto:           Math.abs(monto),
      documento_id,
      concepto:        `Cobro ${documento_id}`,
      nota:            nota ?? "",
      referencia:      referencia ?? "",
      origen:          "cobro",
      created_at:      new Date().toISOString(),
    },
  });
}

// ── Imputar UNA transferencia del extracto a VARIAS facturas ───────────────────
// Santi paga N facturas de un proveedor (o cobra N ventas de un cliente) con una sola
// transferencia. Modelo: se crean N pagos/cobros REALES —cada uno contra su factura, con su
// monto— que suman el total, y la línea del extracto se IGNORA (queda como registro fiel del
// banco, fuera de caja; conserva su extracto_saldo → ancla de dedup al re-subir). Cada fila nueva
// lleva nota legible + `referencia=trf=<idExtracto>` para agruparlas y poder deshacerlas juntas.
// Orden: primero los pagos (el valor), la ignorada al final → si algo falla, la línea del extracto
// queda VISIBLE en la bandeja (no hay pérdida silenciosa de caja; se ignora con un click).
async function _imputarVariasDesdeExtracto(mov, partes, appendFn) {
  const total = Math.abs(Number(mov.monto) || 0);
  const suma  = (partes || []).reduce((s, p) => s + Math.abs(Number(p.monto) || 0), 0);
  if (!partes?.length) throw new Error("No hay facturas seleccionadas.");
  if (Math.abs(round2(suma) - round2(total)) > 0.5)
    throw new Error(`La suma de las partes (${suma.toLocaleString("es-AR")}) no coincide con la transferencia (${total.toLocaleString("es-AR")}).`);
  const grupo    = mov.id;
  const fechaTxt = String(mov.fecha || "").split("-").reverse().join("/");   // YYYY-MM-DD → DD/MM/YYYY
  const nota     = `Parte de transferencia $${total.toLocaleString("es-AR")} · ${fechaTxt}`;
  for (const p of partes) {
    await appendFn({
      documento_id:    p.documento_id,
      sociedad:        mov.sociedad,
      fecha:           mov.fecha,
      monto:           Math.abs(Number(p.monto) || 0),
      moneda:          mov.moneda || "ARS",
      cuenta_bancaria: mov.cuenta_bancaria,
      referencia:      `trf=${grupo}`,
      nota,
    });
  }
  await ignorarMovimiento(mov, `trf-multi:${grupo}`);   // último: si falla, el extracto queda pendiente y visible
  return { ok: true, n: partes.length };
}
export const pagarFacturasDesdeExtracto  = (mov, partes) => _imputarVariasDesdeExtracto(mov, partes, appendPago);
export const cobrarFacturasDesdeExtracto = (mov, partes) => _imputarVariasDesdeExtracto(mov, partes, appendCobro);

/** Saldo pendiente de un documento. Usa Math.abs porque PAGOs tienen monto negativo. */
export function calcSaldoPendiente(totalDoc, pagos = []) {
  const totalPagado = pagos.reduce((s, p) => s + Math.abs(Number(p.monto) || 0), 0);
  // Redondeo a centavos: evita que un residuo de milésimas (total ×1,21 con float) deje la
  // factura colgada en "A Pagar $0,00" y nunca cierre.
  return Math.max(0, round2(round2(totalDoc) - round2(totalPagado)));
}

function _hoy() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}
function _parseVto(vtoStr) {
  if (!vtoStr) return null;
  // Medianoche LOCAL (no UTC): new Date("YYYY-MM-DD") parsea a medianoche UTC → en AR (UTC-3) queda el día
  // anterior 21:00 y una factura que vence HOY caía como "vencido". _hoy() es medianoche local → alinear.
  let y, m, d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(vtoStr))       { [y, m, d] = vtoStr.split("-"); }
  else if (/^\d{2}\/\d{2}\/\d{4}$/.test(vtoStr)) { [d, m, y] = vtoStr.split("/"); }
  else return null;
  return new Date(Number(y), Number(m) - 1, Number(d));
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
  const rows = await get("nb_movimientos", sociedad ? { sociedad } : {});
  return rows.filter(m => !esIgnorado(m));
}

// Cobros/pagos de franquicia de TODO el grupo (no scopeado por sociedad): la CxC de franquiciados
// se saldan por franquiciado × empresa × moneda, independiente de en qué caja (sociedad) entró el
// cobro (ej. una venta de BIGG Fit LLC cobrada en efectivo a la caja de Beta). El slice por sociedad
// lo hace franquiciasSaldosCxC filtrando por empresa; necesita ver los cobros de todas las cajas.
export async function fetchMovFranquicias() {
  const rows = await get("nb_movimientos", {});
  return rows.filter(m => m.origen === "franquicias" && !esIgnorado(m));
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
 * Transferencia entre cuentas propias de la MISMA sociedad: par de movimientos con signo opuesto,
 * `documento_id` compartido y `tipo:"TRANSFERENCIA"` en ambas patas. Es la ÚNICA forma correcta de
 * escribir un movimiento entre cuentas: el Cash Flow excluye `tipo==="TRANSFERENCIA"` para no contar
 * la plata que solo se mueve entre cajas (un par EGRESO/INGRESO SÍ se colaría como salida/entrada).
 */
export async function appendTransferencia({ sociedad, fecha, moneda = "ARS", monto, cuentaSalida, cuentaEntrada, conceptoSalida = "", conceptoEntrada = "" }) {
  const abs = Math.abs(Number(monto) || 0);
  const sharedId = newId("TRF");
  const base = { sociedad, fecha, tipo: "TRANSFERENCIA", cuenta_contable: "", centro_costo: "",
    moneda, documento_id: sharedId, referencia: "1", origen: "transferencia",
    created_at: new Date().toISOString() };
  return post({ action: "add_batch", sheet: "nb_movimientos", rows: [
    { ...base, id: `${sharedId}-E`, cuenta_bancaria: cuentaSalida,  cuenta_destino: cuentaEntrada, monto: -abs, concepto: conceptoSalida },
    { ...base, id: `${sharedId}-I`, cuenta_bancaria: cuentaEntrada, cuenta_destino: cuentaSalida,  monto:  abs, concepto: conceptoEntrada },
  ]});
}

// Edita una transferencia entre cuentas propias EXISTENTE (par) en su lugar. Patchea ambas patas.
export async function updateTransferencia({ salidaId, entradaId, fecha, moneda, monto, cuentaSalida, cuentaEntrada, conceptoSalida = "", conceptoEntrada = "" }) {
  const abs = Math.abs(Number(monto) || 0);
  await post({ action:"edit", sheet:"nb_movimientos", id: salidaId,  patch: {
    fecha, moneda, cuenta_bancaria: cuentaSalida,  cuenta_destino: cuentaEntrada, monto: -abs, concepto: conceptoSalida } });
  await post({ action:"edit", sheet:"nb_movimientos", id: entradaId, patch: {
    fecha, moneda, cuenta_bancaria: cuentaEntrada, cuenta_destino: cuentaSalida,  monto:  abs, concepto: conceptoEntrada } });
  return { ok:true };
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

// Edita un pago de tarjeta EXISTENTE (par: caja real − / tarjeta +) en su lugar. Patchea ambas patas.
export async function updatePagoTarjeta({ realId, tarjetaId, fecha, monto, moneda, cuenta_real, tarjeta_cuenta, nota = "" }) {
  const m = Math.abs(Number(monto) || 0);
  const concepto = nota || "Pago de tarjeta";
  await post({ action:"edit", sheet:"nb_movimientos", id: realId, patch: {
    fecha, moneda, cuenta_bancaria: cuenta_real,   monto: -m, concepto } });
  await post({ action:"edit", sheet:"nb_movimientos", id: tarjetaId, patch: {
    fecha, moneda, cuenta_bancaria: tarjeta_cuenta, monto:  m, concepto } });
  return { ok:true };
}

// ─── PROVEEDORES ─────────────────────────────────────────────────────────────

export async function fetchProveedores() {
  return get("nb_proveedores");
}

export async function appendProveedor(prov) {
  const id = newId("PRV");
  const res = await post({ action: "add", sheet: "nb_proveedores", row: { id, ...prov, activo: true, created_at: new Date().toISOString() } });
  return { id, ...res };
}

export async function updateProveedor(id, patch) {
  return post({ action: "edit", sheet: "nb_proveedores", id, patch });
}

export async function deleteProveedor(id) {
  return post({ action: "del", sheet: "nb_proveedores", id });
}

// ─── USUARIOS DEL SISTEMA ────────────────────────────────────────────────────
// Maestro group-level para login + sello de autoría. `password_hash` = SHA-256
// (nunca plaintext); vacío = cuenta sin reclamar (el 1er login setea la clave).

export async function fetchUsuarios() {
  return get("nb_usuarios");
}

export async function appendUsuario(usuario) {
  const id = newId("USR");
  const res = await post({ action: "add", sheet: "nb_usuarios", row: { id, ...usuario, activo: true, created_at: new Date().toISOString() } });
  return { id, ...res };
}

export async function updateUsuario(id, patch) {
  return post({ action: "edit", sheet: "nb_usuarios", id, patch });
}

export async function deleteUsuario(id) {
  return post({ action: "del", sheet: "nb_usuarios", id });
}

// ─── CUENTAS BANCARIAS / CAJAS ───────────────────────────────────────────────

export async function fetchCuentasBancarias() {
  return get("nb_cuentas_bancarias");
}

// ¿La cuenta bancaria es de Mercado Pago? Predicado único (antes duplicado en Tesorería/Conciliación
// con drift: unos miraban banco, otros banco||nombre). Match sobre banco y nombre para no depender de cuál trae "MP".
export const esCuentaMercadoPago = (cuenta) =>
  /mercado\s*pago/i.test(cuenta?.banco || cuenta?.nombre || "");

// Saldo EN VIVO de Mercado Pago (read-only) vía el serverless /api/mercadopago. Devuelve
// { acreditado, a_acreditarse, acreditado_mes_anterior, moneda, proximos, count } o lanza si el endpoint
// falla (sin token → error). Fetch directo (no pasa por el proxy get()). Espejo de fetchHorasDesdeEye.
export async function fetchSaldoMercadoPago(sociedad) {
  const qs = new URLSearchParams(sociedad ? { sociedad } : {});
  const res  = await fetch(`/api/mercadopago?${qs}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return data;
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
  const rows = await get("nb_cuentas");
  // Orden alfabético por nombre → todos los desplegables de cuenta contable salen ordenados.
  return (Array.isArray(rows) ? rows : [])
    .sort((a, b) => String(a.nombre ?? a.id ?? "").localeCompare(String(b.nombre ?? b.id ?? ""), "es"));
}

export async function appendCuenta(cuenta) {
  const id = newId("CTA");
  const res = await post({ action: "add", sheet: "nb_cuentas", row: { id, ...cuenta, activo: true, created_at: new Date().toISOString() } });
  return { id, ...res };
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
  const id = newId("CLI");
  const res = await post({ action: "add", sheet: "nb_clientes", row: { id, ...cli, activo: true, created_at: new Date().toISOString() } });
  return { id, ...res };
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

// Alta de VARIOS gastos directos en UNA sola escritura (add_batch) → atómico, sin carrera de
// appends concurrentes en Sheets (un Promise.all de N filas perdía filas).
export async function appendGastosDirectos({ sociedad, items = [] }) {
  const created_at = new Date().toISOString();
  const rows = items.map(it => {
    const sub = Number(it.subtotal) || 0, rate = Number(it.ivaRate) || 0, iva = sub * (rate / 100), total = sub + iva;
    const id = newId("GD");
    return {
      id, sociedad, fecha: it.fecha, tipo: "EGRESO_GASTO", cuenta_bancaria: it.cuenta_bancaria, cuenta_destino: "",
      cuenta_contable: it.cuenta_contable, centro_costo: it.cc || "", moneda: it.moneda || "ARS",
      monto: -total, documento_id: "CONTAB-" + id, concepto: it.nota || `Gasto directo: ${it.cuenta_contable}`,
      contraparte_id: it.proveedor_id || "", contraparte_nombre: it.proveedor_nombre || "",
      iva_rate: rate, iva_monto: iva, referencia: it.referencia || "", origen: "gasto_directo", created_at,
    };
  });
  if (!rows.length) return { ok: true, n: 0 };
  await post({ action: "add_batch", sheet: "nb_movimientos", rows });
  return { ok: true, n: rows.length };
}

// ─── INGRESO DIRECTO ─────────────────────────────────────────────────────────
//
// Espejo del gasto directo para el lado ingreso: una cobranza sin factura (venta contada,
// reintegro, ingreso vario) es devengado y caja a la vez → UNA fila en nb_movimientos
// (tipo=INGRESO, origen="ingreso_directo"), imputada. El P&L la lee vía adapter (si la cuenta
// contable tiene categoria_pnl="ventas" cuenta como ingreso); Tesorería/Cash Flow ya la ven.
// Misma mecánica que `aceptarMovimiento` contabiliza un crédito sin FC desde Conciliación.
export async function appendIngresoDirecto({ sociedad, fecha, cuenta_contable, cuenta_contable_id = "", cc = "", moneda = "ARS", subtotal, ivaRate = 0, nota = "", cuenta_bancaria, referencia = "", proveedor_id = "", proveedor_nombre = "" }) {
  const created_at = new Date().toISOString();
  const sub  = Number(subtotal) || 0;
  const rate = Number(ivaRate) || 0;       // entero (ej. 21), no fracción
  const iva  = sub * (rate / 100);
  const total = sub + iva;

  const id = newId("ID");
  await post({
    action: "add", sheet: "nb_movimientos",
    row: {
      id,
      sociedad, fecha,
      tipo:               "INGRESO",
      cuenta_bancaria,
      cuenta_destino:     "",
      cuenta_contable,                       // NOMBRE (buildPnL busca por nombre)
      centro_costo:       cc,
      moneda,
      monto:              total,             // POSITIVO: entra a la caja
      documento_id:       "CONTAB-" + id,    // marca devengado-vía-movimiento (lo lee el P&L)
      concepto:           nota || `Ingreso directo: ${cuenta_contable}`,
      contraparte_id:     proveedor_id,
      contraparte_nombre: proveedor_nombre,
      iva_rate:           rate,
      iva_monto:          iva,
      referencia,
      origen:             "ingreso_directo",
      created_at,
    },
  });

  return { ok: true, id };
}

// Alta de VARIOS ingresos directos en UNA sola escritura (add_batch) → atómico, sin carrera de
// appends concurrentes en Sheets (el motivo por el que un Promise.all de N filas perdía filas).
export async function appendIngresosDirectos({ sociedad, items = [] }) {
  const created_at = new Date().toISOString();
  const rows = items.map(it => {
    const sub = Number(it.subtotal) || 0, rate = Number(it.ivaRate) || 0, iva = sub * (rate / 100), total = sub + iva;
    const id = newId("ID");
    return {
      id, sociedad, fecha: it.fecha, tipo: "INGRESO", cuenta_bancaria: it.cuenta_bancaria, cuenta_destino: "",
      cuenta_contable: it.cuenta_contable, centro_costo: it.cc || "", moneda: it.moneda || "ARS",
      monto: total, documento_id: "CONTAB-" + id, concepto: it.nota || `Ingreso directo: ${it.cuenta_contable}`,
      contraparte_id: it.proveedor_id || "", contraparte_nombre: it.proveedor_nombre || "",
      iva_rate: rate, iva_monto: iva, referencia: it.referencia || "", origen: "ingreso_directo", created_at,
    };
  });
  if (!rows.length) return { ok: true, n: 0 };
  await post({ action: "add_batch", sheet: "nb_movimientos", rows });
  return { ok: true, n: rows.length };
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

// Identidad ÚNICA de una línea del extracto = el SALDO (running balance). NO se incluye la fecha:
// el banco RE-FECHA una misma línea entre descargas (fecha valor vs operación, pendiente vs confirmada)
// → si la clave llevara fecha, la re-descarga duplicaría. El saldo es el cursor propio del banco: estable.
// Vive en la columna propia `extracto_saldo` (NO en `referencia`) → contabilizar una línea
// (aceptarMovimiento/imputarPagoFC, que reescriben `referencia`) ya NO borra la clave de dedup.
// Fallback para filas viejas: el `saldo=` que quedó embebido en `referencia`.
const _extractoRef = m => String(m.extracto_saldo || "") || String(_saldoDe(m) || "");
const _r2 = n => Math.round((Number(n) || 0) * 100);   // monto a centavos, para comparar sin ruido de float

// Ingesta del extracto = "matchear o crear" (ya NO "crear o ignorar"):
//  1) DEDUP: si la línea del banco ya existe (mismo `saldo` en `extracto_saldo`) → se saltea.
//  2) AUTO-MATCH: si hay un movimiento YA cargado por el tesorero/otro módulo (mismo monto + cuenta +
//     fecha ±ventana, todavía sin atar a una línea de banco) → se le ESTAMPA el `extracto_saldo` del banco
//     (queda conciliado; futuras re-subidas lo reconocen). NO crea fila, NO pide ignorar.
//  3) Si no hay match → crea la pendiente (como antes).
export async function ingestarExtracto({ sociedad, cuenta_bancaria, moneda = "ARS", lineas = [], onProgress } = {}) {
  const VENTANA_DIAS = 3;   // tolerancia de fecha para el auto-match (banco liquida ±días de la operación)
  const todos = await get("nb_movimientos", { sociedad });
  const dela  = todos.filter(m => String(m.cuenta_bancaria) === String(cuenta_bancaria));
  const seen  = new Set(dela.map(_extractoRef).filter(Boolean));   // dedup vs DB + dentro del archivo
  // Candidatos a auto-match: cargados por un humano/otro módulo, sin atar a línea de banco, no ignorados.
  // Se excluye origen="extracto" (esas YA son líneas de banco; las rotas sin ref se sanean aparte, no acá).
  // Precomputo ts/centavos una vez por candidato (evita re-parsear fechas L×C veces en el loop).
  const disponibles = dela
    .filter(m => !_extractoRef(m) && !esIgnorado(m) && m.origen !== "extracto")
    .map(m => ({ mov: m, ts: +new Date(m.fecha), cents: _r2(m.monto) }));
  const usados = new Set();
  const buscarMatch = (l) => {
    const lts = +new Date(l.fecha), lcents = _r2(l.monto);
    let best = null, bestD = Infinity;
    for (const c of disponibles) {
      if (usados.has(c.mov.id) || c.cents !== lcents) continue;
      const d = Math.abs((c.ts - lts) / 86400000);
      if (d <= VENTANA_DIAS && d < bestD) { best = c.mov; bestD = d; }
    }
    return best;
  };

  const nuevas = [], matches = []; let dups = 0;
  for (const l of lineas) {
    const ref = String(l.saldo);   // identidad estable = saldo (NO fecha: el banco re-fecha entre descargas)
    if (seen.has(ref)) { dups++; continue; }
    seen.add(ref);
    const m = buscarMatch(l);
    if (m) { usados.add(m.id); matches.push({ mov: m, ref, linea: l }); continue; }
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
      extracto_saldo: ref,   // ← clave de dedup en columna propia (inmune a que se reescriba `referencia`)
      referencia: `cod=${l.codigoConcepto || ""};tipo=${p.tipo || ""};regla=${p.regla_id || ""};prov=${p.proveedor_id || ""};cli=${p.cliente_id || ""};idest=${p.cuenta_destino || ""};fr=${p.franquicia_id || ""};frops=${(p.franquicia_opciones || []).join("|")};plan=${p.plan_id || ""};pcuota=${p.cuota_row_id || ""};op=${l.nro_operacion || ""};cuit=${l.ley2 || l.cuit || ""};saldo=${l.saldo || ""}`,
      origen: "extracto",
      created_at: new Date().toISOString(),
    }});
  }

  // 1) Estampar la ref del banco en los movimientos ya cargados que matchearon (quedan conciliados).
  let matcheados = 0;
  for (const x of matches) {
    try { await post({ action: "edit", sheet: "nb_movimientos", id: x.mov.id, patch: { extracto_saldo: x.ref } }); matcheados++; }
    catch (e) { /* si falla el match, la línea NO se creó → se puede reintentar re-subiendo */ }
  }
  // 2) Crear las líneas nuevas en LOTE (resiliente a GAS lento / pestaña en background).
  let creados = 0;
  const fallidas = [];
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
  return { creados, matcheados, dups, errores: fallidas.length, fallidas };
}

// Trae los movimientos del extracto que faltan conciliar.
// Estado por documento_id: vacío = pendiente; con valor = conciliado (linkeado a su asiento).
export async function fetchMovimientosPendientes(sociedad) {
  const rows = await get("nb_movimientos", { sociedad });
  return rows.filter(m => m.origen === "extracto" && !m.documento_id);
}

// ── RESUMEN DE TARJETA → bandeja (mundo Tarjeta de Conciliaciones) ───────────────
// El resumen es "un extracto más": precarga cada consumo como PENDIENTE en nb_movimientos
// (origen "tarjeta"), contra la cuenta-tarjeta de su moneda, con la propuesta (cuenta/centro)
// ya puesta. NO toca caja real ni P&L hasta que se AUTORIZA la línea (aceptarMovimiento →
// gasto contra la tarjeta, o imputarPagoFC → pago de una FC).
// REEMPLAZO idempotente: al subir, borra lo PENDIENTE de ese resumen (mismas cuentas-tarjeta +
// período, sin autorizar) y reingiere → "subir de nuevo" refleja el último parseo. NO dedup por
// contenido: un resumen tiene consumos repetidos legítimos (varios "OPENAI 20,00" en el mes) que
// NO se deben colapsar. Los ya AUTORIZADOS de ese período no se re-crean (se saltean por match).
const _normCom = s => String(s || "").toUpperCase().replace(/\s+/g, " ").trim();
// Lee un valor del blob `referencia` con formato "k=v;k2=v2;…" (ej. metaVal(ref,"per")). Reutilizable.
export const metaVal = (ref, k) => { const x = String(ref || "").match(new RegExp(`${k}=([^;]*)`)); return x ? x[1] : ""; };

export async function ingestarResumenTarjeta({ sociedad, tarjeta = "", periodo = "", fecha, lineas = [] } = {}) {
  const todos = await get("nb_movimientos", { sociedad });
  const cardIds = new Set(lineas.map(l => String(l.cuenta_bancaria)).filter(Boolean));
  const delMismoResumen = m => m.origen === "tarjeta" && cardIds.has(String(m.cuenta_bancaria))
    && (!periodo || metaVal(m.referencia, "per") === String(periodo));

  // 1) Borrar los PENDIENTES de este resumen (reemplazo). Los autorizados se conservan.
  let borradas = 0;
  for (const m of todos.filter(m => delMismoResumen(m) && !m.documento_id)) {
    await post({ action: "del", sheet: "nb_movimientos", id: m.id }); borradas++;
  }
  // 2) No re-crear consumos ya AUTORIZADOS de este período (pool por comercio|monto|moneda).
  const pool = todos.filter(m => delMismoResumen(m) && m.documento_id)
    .map(m => ({ k: `${metaVal(m.referencia, "com")}|${Math.abs(Number(m.monto) || 0)}|${m.moneda}`, used: false }));

  const nuevas = [];
  let yaAutorizadas = 0;
  for (const l of lineas) {
    const monto = Math.abs(Number(l.monto) || 0);
    if (!monto || !l.cuenta_bancaria) continue;
    const mon = l.moneda || "ARS";
    const hit = pool.find(p => !p.used && p.k === `${_normCom(l.comercio)}|${monto}|${mon}`);
    if (hit) { hit.used = true; yaAutorizadas++; continue; }
    nuevas.push({
      id: newId("TAR"), sociedad, fecha: l.fecha || fecha,
      tipo: "EGRESO", cuenta_bancaria: l.cuenta_bancaria, cuenta_destino: "",
      cuenta_contable: String(l.cuenta_contable || "").replace(/^CUENTA_/, ""),
      centro_costo: l.centro_costo || "",
      // Signo: consumo normal = siempre cargo (egreso, -monto). Una línea de AJUSTE (l.credito, ver
      // MundoTarjeta → diferencia contra el TOTAL A PAGAR real del resumen) puede ir para el otro lado
      // → conserva el signo pedido para que, al autorizarla, aceptarMovimiento la reconozca como INGRESO.
      moneda: mon, monto: l.credito ? monto : -monto, documento_id: "",
      iva_rate: 0, iva_monto: 0,
      concepto: l.comercio || "",
      contraparte_id: "", contraparte_nombre: l.comercio || "",
      referencia: `tc=${tarjeta};per=${periodo};com=${_normCom(l.comercio)};tit=${l.titular || ""}${l.ajuste ? ";ajuste=1" : ""}`,
      origen: "tarjeta", created_at: new Date().toISOString(),
    });
  }
  let creados = 0;
  const CHUNK = 100;
  for (let i = 0; i < nuevas.length; i += CHUNK) {
    await post({ action: "add_batch", sheet: "nb_movimientos", rows: nuevas.slice(i, i + CHUNK) });
    creados += Math.min(CHUNK, nuevas.length - i);
  }
  return { creados, borradas, yaAutorizadas };
}

// Consumos del resumen que faltan autorizar (bandeja del mundo Tarjeta).
export async function fetchPendientesTarjeta(sociedad) {
  const rows = await get("nb_movimientos", { sociedad });
  return rows.filter(m => m.origen === "tarjeta" && !m.documento_id);
}

// Campos comunes de la pata PARKEADA (interco_park) — una sola fuente para el contrato que leen
// lecturaInterco / intercoLedger / pendientesInterco (por origen + signo de la caja, sin P&L).
// Lo usan el conciliador (edit de la línea del extracto) y el alta manual parkearIntercoManual (add).
const intercoParkFields = ({ id, destino_sociedad = "", destino_nombre = "", cuenta_destino = "" }) => ({
  tipo: "INTERCOMPANIA",
  contraparte_id: destino_sociedad || "", contraparte_nombre: destino_nombre || "",
  cuenta_contable: "", centro_costo: "",
  cuenta_destino: cuenta_destino || "",   // hint: la cuenta del otro lado (no crea su pata)
  documento_id: "INTERPARK-" + id, origen: "interco_park", referencia: "1",
});

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
      ...firma(),   // firma de quién contabilizó la línea del extracto
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
  if (tipo === "interco_park") {
    // MATCHEAR O PARKEAR (modelo simétrico):
    if (prop.match_leg_id) {
      // Hay una interco parkeada de la contraparte (dirección opuesta) → CIERRO contra ella. Registro MI
      // caja (sin cuenta_contable → sin P&L) y NO creo posición nueva (la posición la tiene la pata que
      // parkeó primero, queda intacta). Marco esa pata como matcheada → sale de pendientes de ambos lados.
      const esEg = (Number(mov.monto) || 0) < 0;
      await Promise.all([   // dos filas distintas, sin dependencia entre sí
        post({ action: "edit", sheet: "nb_movimientos", id: mov.id, patch: {
          tipo: esEg ? "EGRESO" : "INGRESO",
          contraparte_id: prop.destino_sociedad || "", contraparte_nombre: prop.destino_nombre || "",
          cuenta_contable: "", centro_costo: "", cuenta_destino: prop.cuenta_destino || "",
          documento_id: "INTERRECV-" + mov.id, origen: "interco_recibida", referencia: "par=" + prop.match_leg_id,
          ...firma(),
        }}),
        post({ action: "edit", sheet: "nb_movimientos", id: prop.match_leg_id, patch: { referencia: "recibida=" + mov.id } }),
      ]);
      return;
    }
    // No hay contraparte parkeada → PARKEO: se registra SOLO mi pata (posición interco, lecturaInterco la
    // lee por origen). La otra sociedad la va a matchear/declarar cuando concilie su lado (espejo asistido).
    return post({ action: "edit", sheet: "nb_movimientos", id: mov.id, patch: {
      ...intercoParkFields({ id: mov.id, destino_sociedad: prop.destino_sociedad, destino_nombre: prop.destino_nombre, cuenta_destino: prop.cuenta_destino }),
      ...firma(),
    }});
  }
  if (tipo === "interco_recv") {
    // Lado RECEPTOR (ej. Wellness): la plata entró y la reconozco como fondeo de otra sociedad. Mete el
    // EUR real en mi caja/cuenta (la línea del extracto) SIN P&L y SIN crear posición nueva (la deuda en
    // USD ya la da la pata parkeada del emisor). El TC queda implícito. Costo de clearing → aparte (P&L).
    await post({ action: "edit", sheet: "nb_movimientos", id: mov.id, patch: {
      tipo: "INGRESO", cuenta_contable: "", centro_costo: "",
      contraparte_id: prop.origen_sociedad || "", contraparte_nombre: prop.origen_nombre || "",
      documento_id: "INTERRECV-" + mov.id, origen: "interco_recibida", referencia: "1",
      ...firma(),
    }});
    if (Number(prop.costo) > 0) await _addCostoFinanciero({
      sociedad: mov.sociedad, fecha: mov.fecha, monto: prop.costo,
      moneda: mov.moneda, centro: prop.costo_centro, origen_nombre: prop.origen_nombre });
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
    // Período P&L ≠ fecha de caja (ej. nómina devengada el mes anterior al pago) → se empaca en
    // `referencia` (sin columna nueva; movimientoToPnLRows en Reportes lo lee de ahí). Sin override,
    // `referencia` queda como estaba (no se pisa la metadata de la regla que clasificó la línea).
    ...(prop.periodo_contable ? { referencia: `${mov.referencia || ""};periodo=${prop.periodo_contable}` } : {}),
    ...firma(),
  }});
}

// Costo de transferencia/clearing de una interco (cuando la financiera lo informa). Egreso a `cuenta_contable`
// (default Perdidas Financieras; puede ser otra, ej. Cargas Sociales si la plata iba a sueldos).
// Con `cuenta_bancaria` → egreso PAGADO de esa caja (sale plata, no deja CxP). Sin ella ("") → P&L puro, sin caja.
async function _addCostoFinanciero({ sociedad, fecha, monto, moneda = "ARS", centro = "", origen_nombre = "", cuenta_bancaria = "", cuenta_contable = "Perdidas Financieras" }) {
  const id = newId("FINC");
  return post({ action: "add", sheet: "nb_movimientos", row: {
    id, sociedad, fecha, tipo: "EGRESO_GASTO", cuenta_bancaria,   // PAGADO desde la caja (sale plata → no deja CxP colgada)
    cuenta_contable: cuenta_contable || "Perdidas Financieras", centro_costo: centro,
    moneda, monto: -Math.abs(Number(monto) || 0),
    documento_id: "CONTAB-" + id, origen: "gasto_directo",
    concepto: `Costo transferencia interco${origen_nombre ? " · " + origen_nombre : ""}`,
    created_at: new Date().toISOString(), ...firma(),
  }});
}

// Declara MANUALMENTE una interco recibida (cuando entró a una CAJA/efectivo, sin extracto). Crea el
// movimiento del receptor (plata real, sin P&L, sin posición nueva) y, si viene de una pata parkeada,
// la marca como reconocida para que salga de la lista de pendientes. Costo de clearing → P&L (opcional).
export async function declararIntercoRecibida({ sociedad, cuenta_bancaria, fecha, origen_sociedad, origen_nombre = "",
    monto, moneda = "EUR", costo = 0, costo_centro = "", costo_cuenta = "", concepto = "", parked_leg_id = "" } = {}) {
  const id = newId("IRCV");
  // Las 3 escrituras son independientes (el id es local) → en paralelo.
  await Promise.all([
    post({ action: "add", sheet: "nb_movimientos", row: {
      id, sociedad, fecha, tipo: "INGRESO", cuenta_bancaria, cuenta_destino: "",
      cuenta_contable: "", centro_costo: "", moneda, monto: Math.abs(Number(monto) || 0),
      documento_id: "INTERRECV-" + id, origen: "interco_recibida",
      contraparte_id: origen_sociedad || "", contraparte_nombre: origen_nombre,
      concepto: concepto || `Interco recibida${origen_nombre ? " de " + origen_nombre : ""}`,
      referencia: "1", created_at: new Date().toISOString(), ...firma(),
    }}),
    // marca la pata parkeada como reconocida (sale de pendientes)
    parked_leg_id ? post({ action: "edit", sheet: "nb_movimientos", id: parked_leg_id, patch: { referencia: "recibida=" + id } }) : null,
    // Costo = egreso PAGADO de la misma caja → tu caja neta = monto − costo, y el gasto no queda colgado.
    // cuenta_contable elegible: si la plata iba a pagar sueldos, el costo es carga social encubierta (no financiero).
    Number(costo) > 0 ? _addCostoFinanciero({ sociedad, fecha, monto: costo, moneda, centro: costo_centro, origen_nombre, cuenta_bancaria, cuenta_contable: costo_cuenta }) : null,
  ]);
  return id;
}

// Declara MANUALMENTE una interco ENVIADA (lado emisor, cuando salió de una CAJA/efectivo sin extracto, o
// para cerrar desde el carril sin esperar al banco). Espejo de declararIntercoRecibida: crea el EGRESO real
// (plata que salió, sin P&L, sin posición nueva) y marca la pata parkeada como cerrada. Costo opcional → P&L.
// OJO doble conteo: si además aparece en el extracto, esa línea hay que neutralizarla (no aceptarla otra vez).
export async function declararIntercoEnviada({ sociedad, cuenta_bancaria, fecha, destino_sociedad, destino_nombre = "",
    monto, moneda = "USD", costo = 0, costo_centro = "", costo_cuenta = "", concepto = "", parked_leg_id = "" } = {}) {
  const id = newId("ISND");
  await Promise.all([
    post({ action: "add", sheet: "nb_movimientos", row: {
      id, sociedad, fecha, tipo: "EGRESO", cuenta_bancaria, cuenta_destino: "",
      cuenta_contable: "", centro_costo: "", moneda, monto: -Math.abs(Number(monto) || 0),
      documento_id: "INTERSND-" + id, origen: "interco_enviada",
      contraparte_id: destino_sociedad || "", contraparte_nombre: destino_nombre,
      concepto: concepto || `Interco enviada${destino_nombre ? " a " + destino_nombre : ""}`,
      referencia: "1", created_at: new Date().toISOString(), ...firma(),
    }}),
    parked_leg_id ? post({ action: "edit", sheet: "nb_movimientos", id: parked_leg_id, patch: { referencia: "recibida=" + id } }) : null,
    Number(costo) > 0 ? _addCostoFinanciero({ sociedad, fecha, monto: costo, moneda, centro: costo_centro, origen_nombre: destino_nombre, cuenta_bancaria, cuenta_contable: costo_cuenta }) : null,
  ]);
  return id;
}

// Patas parkeadas por OTRA sociedad hacia la activa, todavía sin declarar (lista de pendientes / semáforo).
// `movs` = nb_movimientos (de fetchIntercoData). Vínculo blando por sociedad; se saca al declarar (referencia recibida=).
// Match del modelo "matchear o parkear": ¿hay una interco parkeada por la CONTRAPARTE hacia mí, con
// dirección OPUESTA a mi línea, sin cerrar? Si existe, cierro contra ella (sin nueva posición) en vez de
// parkear otra. El match es por sociedad + signo opuesto (no por monto: son monedas distintas).
export function intercoMatchCandidato({ movs = [] } = {}, { sociedad, contraparte, monto } = {}) {
  if (!contraparte || !sociedad) return null;
  const miSigno = Math.sign(Number(monto) || 0);
  if (!miSigno) return null;
  return (movs || []).find(m =>
    m.origen === "interco_park" && String(m.sociedad) === String(contraparte)
    && String(m.contraparte_id) === String(sociedad) && !esIgnorado(m)
    && !/recibida=/.test(String(m.referencia || ""))
    && Math.sign(Number(m.monto) || 0) === -miSigno) || null;
}

// Interco de CC pendientes de liquidar con la sociedad activa, EN AMBAS DIRECCIONES (lo que la contraparte
// parkeó hacia mí, haya sido ella la que pagó=yo recibí, o la que recibió=yo envié). No es fondeo/devolución:
// es una cuenta corriente viva. Cada una trae la dirección y las cuentas (la de la contraparte + hint de la mía).
export function pendientesIntercoRecibir({ movs = [], sociedades = [] } = {}, { sociedad } = {}) {
  const nombreDe = new Map((sociedades || []).map(s => [String(s.id), s.nombre]));
  const soc = String(sociedad);
  return (movs || [])
    .filter(m => m.origen === "interco_park" && !esIgnorado(m) && !/recibida=/.test(String(m.referencia || ""))
      && (String(m.contraparte_id) === soc || String(m.sociedad) === soc))
    .map(m => {
      // Una sola pata parkeada por circuito, visible en DOS inboxes: el del que parkeó (mia=true, ya creó la
      // posición → solo espera) y el de la contraparte (mia=false → cierra). La perspectiva de la caja cambia
      // según de quién sea la fila: si es mía, m.monto es MI caja; si es de la contraparte, es la suya.
      const mia   = String(m.sociedad) === soc;
      const otra  = mia ? String(m.contraparte_id) : String(m.sociedad);
      const mnt   = Number(m.monto) || 0;
      // dir = desde MI perspectiva. Mía: pagué (monto<0)=envié / cobré=recibí. Ajena: la otra pagó=yo recibí.
      const dir   = mia ? (mnt < 0 ? "envie" : "recibi") : (mnt < 0 ? "recibi" : "envie");
      return {
        id: m.id, origen_sociedad: otra, origen_nombre: nombreDe.get(otra) || otra,
        fecha: m.fecha, monto: Math.abs(mnt), moneda: m.moneda || "USD", mia, dir,
        // cuenta_mia = mi caja real; cuenta_otro = la de la contraparte. En mi propia pata la real es
        // cuenta_bancaria y el hint del otro lado es cuenta_destino; en la ajena, al revés.
        cuenta_mia:  mia ? (m.cuenta_bancaria || "") : (m.cuenta_destino || ""),
        cuenta_otro: mia ? (m.cuenta_destino || "")  : (m.cuenta_bancaria || ""),
        concepto: m.concepto || "",
      };
    })
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
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
    ...firma(),
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

// Alta MANUAL de un movimiento financiero de franquicia (desde la app Franquicias) → una fila
// en nb_movimientos, mismo shape que aceptarCobroFranquicia. Cutover: desde el 1/7 los pagos /
// pagos a cuenta / transferencias de franquicia se escriben ACÁ, no en `comprobantes`.
// PAGO/PAGO_PAUTA = COBRO (+) ; PAGO_ENVIADO = EGRESO (−). Sin documento_id (caja, no devengado).
export async function appendMovFranquicia({ id, sociedad, fecha, fr_tipo, franquicia_id, franquicia_nombre = "", monto, moneda = "ARS", cuenta_bancaria = "", concepto = "" }) {
  const signo = fr_tipo === "PAGO_ENVIADO" ? -1 : 1;
  const tipo  = fr_tipo === "PAGO_ENVIADO" ? "EGRESO" : "COBRO";
  return post({ action: "add", sheet: "nb_movimientos", row: {
    id: id || newId("FRQ"), sociedad, fecha,
    tipo, cuenta_bancaria, cuenta_destino: "",
    cuenta_contable: "", centro_costo: "", moneda,
    monto: signo * Math.abs(Number(monto) || 0), documento_id: "",
    concepto, contraparte_id: String(franquicia_id || ""), contraparte_nombre: franquicia_nombre,
    fr_tipo, referencia: "", origen: "franquicias",
    created_at: new Date().toISOString(),
  }});
}

// Imputa una línea del extracto a una factura de proveedor existente: la convierte en un
// PAGO linkeado a esa FC. Tesorería netea la CxP (match por documento_id); el P&L la excluye
// (no es "CONTAB-": el devengado ya está en el comprobante). Pago parcial = si |monto| < saldo
// de la FC, el remanente sigue pendiente. No crea fila nueva: edita la del extracto in-place.
export async function imputarPagoFC(mov, { documento_id, cuenta_contable = "", proveedor_id = "", proveedor_nombre = "" }) {
  return post({ action: "edit", sheet: "nb_movimientos", id: mov.id, patch: {
    tipo:               "PAGO",
    cuenta_contable:    String(cuenta_contable || "").replace(/^CUENTA_/, ""),
    centro_costo:       "",   // el centro vive en la FC (que puede tener varios); el pago no lo copia. Cash Flow lo deriva del comprobante linkeado.
    contraparte_id:     proveedor_id,
    contraparte_nombre: proveedor_nombre || mov.contraparte_nombre || "",
    documento_id,                                       // id de la FC → netea CxP en Tesorería
    concepto:           mov.concepto || `Pago ${documento_id}`,
    ...firma(),
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
    centro_costo:       "",   // el cobro no lleva centro (la venta puede tener varios); Cash Flow lo deriva de la FC. `centro_costo` se conserva como param solo para el fallback del centro de retenciones (abajo).
    contraparte_id:     cliente_id,
    contraparte_nombre: cliente_nombre || mov.contraparte_nombre || "",
    documento_id,
    concepto:           mov.concepto || `Cobro ${documento_id}`,
    ...firma(),
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

// Registra retenciones sufridas sobre una factura de venta SIN cobro de caja (ej. al recibir la
// orden de pago, antes de cobrar, o como saldo de apertura). Cada retención = fila nb_movimientos
// origen="retencion" (tipo COBRO, sin cuenta_bancaria) que netea la CxC por documento_id y entra al
// P&L como costo. Misma forma de fila que imputarCobroIngreso, pero standalone (sin mov de banco).
export async function appendRetenciones({ sociedad, documento_id, fecha, moneda = "ARS", cliente_id = "", cliente_nombre = "", retenciones = [] }) {
  const rows = (retenciones || [])
    .filter(r => Math.abs(Number(r?.monto) || 0) > 0.01 && r?.cuenta)
    .map(r => ({
      id: newId("RET"), sociedad, fecha,
      tipo: "COBRO", cuenta_bancaria: "", cuenta_destino: "",
      cuenta_contable: String(r.cuenta).replace(/^CUENTA_/, ""),
      centro_costo: r.centro || "", moneda,
      monto: Math.abs(Number(r.monto) || 0), documento_id,
      concepto: `Retención s/ ${documento_id}`,
      contraparte_id: cliente_id, contraparte_nombre: cliente_nombre || "",
      origen: "retencion", created_at: new Date().toISOString(),
    }));
  if (!rows.length) return { ok: true, n: 0 };
  await post({ action: "add_batch", sheet: "nb_movimientos", rows });
  return { ok: true, n: rows.length };
}

// Ignora una línea del extracto: la descarta sin contabilizar. Soft-mark (no borra):
// la fila conserva su `saldo=` en referencia → el dedup la ve y NO la re-crea al re-subir.
// Reversible con restaurarMovimiento. motivo: texto libre (para haberes = "haberes:<lote>").
export async function ignorarMovimiento(mov, motivo = "") {
  const ref = String(mov.referencia || "").replace(/;?ign=[^;]*/g, "");
  return post({ action: "edit", sheet: "nb_movimientos", id: mov.id, patch: {
    documento_id: "IGN-" + mov.id,
    referencia: `${ref};ign=${motivo || "1"}`,
    ...firma(),
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
    // Gasto contado = alta manual (origen gasto_directo) O contabilizado desde Conciliación
    // (documento_id "CONTAB-…"). En ambos es una fila autocontenida imputada. Excluye INGRESO
    // (los créditos contabilizados no son gastos) y las ignoradas.
    .filter(m => !esIgnorado(m) && m.tipo !== "INGRESO" &&
      (m.origen === "gasto_directo" || String(m.documento_id || "").startsWith("CONTAB-")))
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
        registrado_por:  m.registrado_por ?? "",
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

/**
 * Trae todos los ingresos directos de una sociedad (nb_movimientos tipo=INGRESO imputados).
 * Alta manual (origen "ingreso_directo") O crédito sin FC contabilizado desde Conciliación
 * (tipo INGRESO + documento_id "CONTAB-…"). Espejo de fetchGastos.
 */
export async function fetchIngresosDirectos(sociedad) {
  const movRows = await get("nb_movimientos", { sociedad });
  return movRows
    .filter(m => !esIgnorado(m) && m.tipo === "INGRESO" &&
      (m.origen === "ingreso_directo" || String(m.documento_id || "").startsWith("CONTAB-")))
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
        registrado_por:  m.registrado_por ?? "",
      };
    })
    .sort((a, b) => (b.fecha > a.fecha ? 1 : -1));
}

/** Elimina un ingreso directo (solo el movimiento). */
export async function deleteIngresoDirecto(movId) {
  await post({ action: "del", sheet: "nb_movimientos", id: movId });
}

/** Actualiza un ingreso directo existente (solo el movimiento). */
export async function updateIngresoDirecto(movId, { fecha, cuenta_contable, cuenta_contable_id = "", cc = "", moneda = "ARS", subtotal, ivaRate = 0, nota = "", cuenta_bancaria, referencia = "", proveedor_id = "", proveedor_nombre = "" }) {
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
    monto:              total,
    concepto:           nota || `Ingreso directo: ${cuenta_contable}`,
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
  const rows = await get("nb_comprobantes", sociedad ? { sociedad } : {});
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
        registrado_por: row.registrado_por ?? "",   // quién cargó el comprobante (primera línea del grupo)
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

// Edita un cambio de moneda EXISTENTE (par S/E, distinta moneda) en su lugar. Patchea ambas patas y
// recomputa el TC. Misma convención de signo que appendCambio (salida −, entrada +).
export async function updateCambio({ salidaId, entradaId, fecha, cuentaOrigen, monedaOrigen, montoOrigen, cuentaDestino, monedaDestino, montoDestino, nota = "" }) {
  const tc = monedaOrigen !== "ARS"
    ? (montoOrigen  > 0 ? (montoDestino / montoOrigen).toFixed(2) : "0")
    : (montoDestino > 0 ? (montoOrigen  / montoDestino).toFixed(2) : "0");
  const concepto = `Cambio ${monedaOrigen}→${monedaDestino}${nota ? " · " + nota : ""}`;
  await post({ action:"edit", sheet:"nb_movimientos", id: salidaId, patch: {
    fecha, cuenta_bancaria: cuentaOrigen,  cuenta_destino: cuentaDestino, moneda: monedaOrigen, monto: -Math.abs(montoOrigen),  concepto, referencia: tc } });
  await post({ action:"edit", sheet:"nb_movimientos", id: entradaId, patch: {
    fecha, cuenta_bancaria: cuentaDestino, cuenta_destino: cuentaOrigen,  moneda: monedaDestino, monto:  Math.abs(montoDestino), concepto, referencia: tc } });
  return { ok:true };
}

export const deleteCambio = _deleteMovRows;

// ── Intercompañía ─────────────────────────────────────────────────────────────

// Interco de UNA sola pata (apertura o parkeo): no son transferencias de dos patas; viven solo en el
// mapa de posiciones (lecturaInterco). Se excluyen del pareo de INTERCOMPANIA.
const esIntercoUnaPata = m => m.origen === "interco_apertura" || m.origen === "interco_park";

export async function fetchIntercompania() {
  const movs = (await get("nb_movimientos", {})).filter(m => !esIntercoUnaPata(m));
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

export async function appendIntercompania({ fecha, socOrigen, ctaOrigen, monedaOrigen, montoOrigen, socDestino, ctaDestino, monedaDestino, montoDestino, nota = "" }) {
  const id         = newId("INTERCOMPANY");
  const tc         = montoOrigen > 0 ? (montoDestino / montoOrigen).toFixed(6) : "1";
  // Interco = transferencia con saldo vivo; la clasificación (inversión / crédito puente) se deriva del anillo (patrimonio), no acá.
  const concepto   = `Transferencia interco: ${socOrigen} → ${socDestino}${nota ? " · " + nota : ""}`;
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

// Edita una transferencia interco EXISTENTE (par de 2 patas del núcleo) en su lugar: patchea la pata
// de salida (salidaId, monto −) y la de entrada (entradaId, monto +) con los datos nuevos, recomputando
// concepto + TC. NO borra ni recrea (ids estables, sin ventana con el par a medias). Misma moneda ambas patas.
export async function updateIntercompania({ salidaId, entradaId, fecha, socOrigen, ctaOrigen, socDestino, ctaDestino, moneda, monto, nota = "" }) {
  const m        = Math.abs(Number(monto) || 0);
  const concepto = `Transferencia interco: ${socOrigen} → ${socDestino}${nota ? " · " + nota : ""}`;
  await post({ action:"edit", sheet:"nb_movimientos", id: salidaId, patch: {
    fecha, sociedad: socOrigen, cuenta_bancaria: ctaOrigen, cuenta_destino: ctaDestino,
    moneda, monto: -m, concepto, referencia: "1",
  }});
  await post({ action:"edit", sheet:"nb_movimientos", id: entradaId, patch: {
    fecha, sociedad: socDestino, cuenta_bancaria: ctaDestino, cuenta_destino: ctaOrigen,
    moneda, monto: m, concepto, referencia: "1",
  }});
  return { ok:true };
}

// Alta MANUAL de una interco de UNA sola pata (PARKEAR), sin necesidad de una línea de extracto.
// Para cross-moneda / fondeo (USD→EUR/COP): registro SOLO mi lado (mi caja, mi moneda) con el MISMO
// shape que produce el conciliador (aceptarMovimiento branch interco_park). La otra sociedad declara
// su pata en su moneda cuando concilia. Sin cuenta_contable → NO toca P&L; la posición la lee
// lecturaInterco por origen="interco_park" + el signo de la caja.
// monto FIRMADO: <0 salió de mi caja (les puse plata → soy acreedor) · >0 entró (me pusieron → soy deudor).
export async function parkearIntercoManual({ sociedad, fecha, cuenta_bancaria, moneda, monto, destino_sociedad, destino_nombre = "", cuenta_destino = "", nota = "" }) {
  const id  = newId("INTERPARK");
  const m   = Number(monto) || 0;
  const dst = destino_nombre || destino_sociedad;
  const concepto = `Interco ${m < 0 ? "→" : "←"} ${dst}${nota ? " · " + nota : ""}`;
  await post({ action:"add", sheet:"nb_movimientos", row: {
    id, sociedad, fecha, cuenta_bancaria, moneda, monto: m,
    ...intercoParkFields({ id, destino_sociedad, destino_nombre, cuenta_destino }),
    concepto, nota, created_at: new Date().toISOString(),
    ...firma(),
  }});
  return { ok:true, id };
}

export const deleteIntercompania = _deleteMovRows;

// Saldos de APERTURA interco (go-live): filas `origen="interco_apertura"` en nb_movimientos,
// cargadas una vez a mano/por script y editables desde la hoja. Sin caja ni P&L
// (cuenta_bancaria y cuenta_contable vacías). monto firmado desde la tenedora
// (+ = nos deben / − = les debemos). Las levanta lecturaInterco (fuente 3, abajo).

// ── LECTURA intercompañía (el corazón del módulo — LECTURA, no escribe) ──────────
// Trae TODO lo necesario para leer lo intercompany (todas las sociedades).
export async function fetchIntercoData() {
  const [movs, comps, centros, clientes, sociedades, legajos] = await Promise.all([
    get("nb_movimientos", {}).catch(() => []),
    get("nb_comprobantes", {}).catch(() => []),
    get("nb_centros_costo", {}).catch(() => []),
    get("nb_clientes", {}).catch(() => []),
    get("nb_sociedades", {}).catch(() => []),
    fetchLegajos().catch(() => []),   // para derivar la interco de sueldos (legajo → sociedad empleadora)
  ]);
  // Mapa legajo → sociedad empleadora: cuando la caja que paga un sueldo (mov.sociedad) ≠ la sociedad
  // del legajo, hubo fondeo cross-society (ej. Beta paga el efectivo de un coach de Segui). lecturaInterco lo lee.
  const legajoSoc = {};
  for (const l of (Array.isArray(legajos) ? legajos : [])) {
    if (l?.id) legajoSoc[String(l.id)] = String(l.sociedad_id || "");
  }
  return {
    movs:       Array.isArray(movs) ? movs : [],
    comps:      Array.isArray(comps) ? comps : [],
    centros:    Array.isArray(centros) ? centros : [],
    clientes:   Array.isArray(clientes) ? clientes : [],
    sociedades: Array.isArray(sociedades) ? sociedades : [],
    legajoSoc,
  };
}

// Normaliza CUIT a solo dígitos sin ceros a la izquierda (para matchear). Reutilizable.
export const normCuit = s => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");

// PENDIENTES de la mirada Interco (carril de Conciliaciones): ventas que OTRA sociedad
// registró con MI sociedad como cliente (match por CUIT), que yo todavía NO reconocí con mi
// compra. Reconocer crea una compra en mi sociedad con nota "interco_ref=<id_comp de la venta>".
// Fuente: comprobantes INGRESO (ventas) de otras sociedades cuyo cliente tiene MI CUIT.
export function pendientesInterco({ comps = [], clientes = [], sociedades = [], franqPend = [], movs = [] } = {}, { sociedad } = {}) {
  const miCuit = normCuit((sociedades.find(s => String(s.id) === String(sociedad)) || {}).cuit);
  // Los pendientes de franquicia de sede propia (gestión) se rutean por sociedad, no por CUIT →
  // no dependen de miCuit. Las ventas interco por CUIT sí; si no tengo CUIT, solo devuelvo franqPend.
  const cliById = new Map(clientes.map(c => [String(c.id), c]));
  const socNombre = id => (sociedades.find(s => String(s.id) === String(id))?.nombre) || id;
  // Ya reconocidas: compras en MI sociedad con nota interco_ref=<id_comp> (comercial en nb_comprobantes)
  // + asientos de gestión en MI sociedad (origen interuso_gestion en nb_movimientos, misma nota).
  const reconocidos = new Set();
  const addRef = (nota) => { const m = String(nota || "").match(/interco_ref=([^\s;|]+)/); if (m) reconocidos.add(m[1]); };
  for (const c of comps) { if (String(c.sociedad) === String(sociedad)) addRef(c.nota); }
  for (const m of movs) { if (m.origen === "interuso_gestion" && String(m.sociedad) === String(sociedad)) addRef(m.nota); }
  if (!miCuit) return franqPend.filter(v => !reconocidos.has(v.id_comp))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  // Ventas interco hacia mí, agrupadas por id_comp (una venta = varias líneas)
  const ventas = new Map();
  for (const c of comps) {
    if (String(c.subtipo || "").toUpperCase() !== "INGRESO") continue;
    if (String(c.sociedad) === String(sociedad)) continue;             // no mis propias ventas
    const cuit = normCuit(cliById.get(String(c.contraparte_id))?.cuit);
    if (!cuit || cuit !== miCuit) continue;                            // el cliente NO soy yo
    const key = c.id_comp || c.id;
    if (!ventas.has(key)) ventas.set(key, {
      id_comp: key, vendedor: c.sociedad, vendedorNombre: socNombre(c.sociedad),
      fecha: c.fecha, nroComp: c.nro_comp, moneda: c.moneda || "ARS", total: 0, subtotal: 0, iva_monto: 0, iva_rate: 0,
    });
    const v = ventas.get(key);
    v.total += toNum(c.total);
    v.subtotal += toNum(c.subtotal);
    v.iva_monto += toNum(c.iva_monto);
    if (!v.iva_rate) v.iva_rate = toNum(c.iva_rate);   // rate de la factura (uniforme por comprobante)
  }
  // Sin desglose cargado (ventas viejas): subtotal = total, IVA 0 → el reconocer no inventa IVA.
  for (const v of ventas.values()) if (!(v.subtotal > 0)) { v.subtotal = v.total; v.iva_monto = 0; v.iva_rate = 0; }
  // franqPend = pendientes de documentos de franquicia emitidos a mí (ej. Segui), ya con forma de pendiente
  // y armados por la pantalla (que tiene el mundo Franquicias). Mismo dedup por interco_ref (id_comp "FR-…").
  return [...ventas.values(), ...franqPend].filter(v => !reconocidos.has(v.id_comp))
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

// Reconocer una venta interco = registrar MI compra (factura de proveedor / CxP) en mi sociedad,
// con MIS cuenta+centro, contraparte = la sociedad vendedora, y link `interco_ref=<id_comp venta>`
// (así el pendiente desaparece y no se re-crea). Queda como FC por pagar (EGRESO sin pago).
export async function reconocerVentaInterco({ sociedad, ventaIdComp, vendedorId = "", vendedorNombre = "", cuenta_contable, cuenta_contable_id = "", centro_costo = "", total, subtotal, iva_rate, iva_monto, moneda = "ARS", fecha, nroComp = "", subtipo = "EGRESO" }) {
  // subtipo="EGRESO" (default): lo que le compro/debo a la contraparte → CxP. subtipo="INGRESO": un crédito a
  // mi favor (ej. NC de interuso que Ñako me emite) → lo reconozco como venta/ingreso a mi cuenta → CxC.
  const id_comp = newId(subtipo === "INGRESO" ? "IN" : "EG");
  const t = toNum(total);
  // Hereda la discriminación de IVA de la factura original (la que emitió la otra sociedad) → así la
  // compra reconocida toma bien el crédito fiscal. Sin desglose → subtotal = total, IVA 0 (como antes).
  const sub  = toNum(subtotal) > 0 ? toNum(subtotal) : t;
  const ivaM = toNum(iva_monto) || 0;
  const ivaR = toNum(iva_rate)  || 0;
  await post({ action: "add", sheet: "nb_comprobantes", row: {
    id: `${id_comp}-L1`, id_comp, sociedad, fecha,
    subtipo,
    contraparte_id: vendedorId, contraparte_nombre: vendedorNombre,
    cuenta_contable: String(cuenta_contable || "").replace(/^CUENTA_/, ""),
    cuenta_contable_id: String(cuenta_contable_id || ""),
    centro_costo, subtotal: sub, iva_rate: ivaR, iva_monto: ivaM, total: t,
    moneda, nro_comp: nroComp, nota: `interco_ref=${ventaIdComp}`,
    created_at: new Date().toISOString(),
  }});
  return { ok: true, id_comp };
}

// Reconocer un INTERUSO DE GESTIÓN (sede propia) = pata 2 del asiento de gestión: escribe UNA
// fila en nb_movimientos SIN caja (cuenta_bancaria="") en la sociedad de la sede, imputada a la
// cuenta+centro elegidos. NO crea comprobante → NO deja CxC/CxP; NO mueve caja (cuenta_bancaria
// vacía → invisible a Tesorería/Cash Flow); NO es interco (lecturaInterco no lee este origen).
// Solo pega en el P&L de la sede (vía movimientoToPnLRows). La pata 1 (Ñako) ya la toma el adapter
// franquiciasIngresoPnLRows desde la NC/FC emitida. subtipo del pendiente: INGRESO (NC → ingreso a
// la sede, +) / EGRESO (FACTURA → cargo a la sede, −). Dedup por interco_ref=<id_comp del pendiente>.
export async function reconocerInterusoGestion(pend, { cuenta, centro = "" } = {}) {
  const t = toNum(pend.total);
  const esIngreso = String(pend.subtipo || "").toUpperCase() === "INGRESO";
  // Desglose de IVA (nocional): monto = total bruto; se guarda iva_monto/iva_rate para que el P&L
  // sin-IVA pueda netear y no reportar el interuso inflado. Si no vino desglose, iva=0 (neto=total).
  const iva  = toNum(pend.iva);
  const neto = toNum(pend.neto) || (t - iva);
  const ivaRate = neto > 0 && iva > 0 ? Math.round((iva / neto) * 100) : 0;
  const id = newId("GEST");
  const f = String(pend.fecha || "");
  const fechaIso = /^\d{1,2}\/\d{1,2}\/\d{4}/.test(f)
    ? (() => { const [d, m, y] = f.split("/"); return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`; })()
    : f;
  await post({ action: "add", sheet: "nb_movimientos", row: {
    id, sociedad: pend.sedeSociedad || "", fecha: fechaIso,
    tipo: esIngreso ? "INGRESO" : "EGRESO",
    cuenta_bancaria: "",                                                  // ← sin caja
    cuenta_contable: String(cuenta || "").replace(/^CUENTA_/, ""),
    centro_costo: centro || pend.sedeCentro || "",
    moneda: pend.moneda || "ARS",
    monto: esIngreso ? t : -t,
    iva_rate: ivaRate, iva_monto: iva,
    contraparte_id: pend.vendedor || "", contraparte_nombre: pend.vendedorNombre || "",
    documento_id: `GEST-${id}`, origen: "interuso_gestion",
    concepto: ["Gestión", pend.sedeNombre, pend.concepto].filter(Boolean).join(" · "),
    nota: `interco_ref=${pend.id_comp}${pend.nota ? " · " + pend.nota : ""}`,
    created_at: new Date().toISOString(),
  }});
  return { ok: true, id };
}

// Revertir un asiento de gestión reconocido: borra la fila de nb_movimientos → la NC/FC vuelve a
// aparecer como pendiente en el inbox interco (el dedup por interco_ref ya no la encuentra). No hay
// caja que deshacer (el asiento era no-cash). Reversible.
export async function revertirInterusoGestion(movId) {
  await post({ action: "del", sheet: "nb_movimientos", id: movId });
  return { ok: true };
}

// Deriva las posiciones intercompañía por (sociedad, contraparte, moneda) leyendo TODAS
// las fuentes (no solo transferencias). Convención: quien PONE la plata queda ACREEDOR
// (le deben → neto +); quien la recibe queda DEUDOR (debe → neto −).
// Fuentes:
//   1. FONDEO (principal): un gasto de la sociedad A imputado a un centro cuya `empresa`
//      es la sociedad B (A ≠ B) → A le puso plata a B. (comprobantes de gasto + gastos
//      directos / conciliación contabilizada en nb_movimientos)
//   2. Préstamos/transferencias del núcleo (pares INTERCOMPANIA).
// Si `sociedad` viene → solo las posiciones de esa sociedad (mirada propia).
export function lecturaInterco({ movs = [], comps = [], centros = [], sociedades = [], legajoSoc = {} } = {}, { sociedad = null } = {}) {
  const empresaDe = new Map((centros || []).map(c => [String(c.id), c.empresa]));
  // Sociedades del núcleo (por anillo) → para decidir si un interuso de gestión cross-society deja
  // posición: núcleo↔núcleo NO (Hektor); hacia una fondeada/externa SÍ (Wellness).
  const nucleo = new Set((sociedades || []).filter(s => /n[úu]cleo/i.test(String(s.anillo || ""))).map(s => String(s.id)));
  const acc = {};  // acc[sociedad][contraparte][moneda] = neto
  const accIni = {};  // solo el componente de APERTURA (saldo inicial), misma clave
  const add = (s, c, moneda, delta) => {
    s = String(s || ""); c = String(c || "");
    if (!s || !c || s === c) return;
    ((acc[s] ??= {})[c] ??= {});
    acc[s][c][moneda] = (acc[s][c][moneda] || 0) + delta;
  };
  const addIni = (s, c, moneda, delta) => {
    s = String(s || ""); c = String(c || "");
    if (!s || !c || s === c) return;
    ((accIni[s] ??= {})[c] ??= {});
    accIni[s][c][moneda] = (accIni[s][c][moneda] || 0) + delta;
  };
  const fondeo = (A, centroId, moneda, monto) => {
    const B = empresaDe.get(String(centroId || ""));
    if (!A || !B || String(A) === String(B)) return;
    // Núcleo↔núcleo: que A pague un gasto imputado a un CECO de B (ambas del núcleo) NO es interco —
    // no se movió plata entre las entidades. Queda solo como gasto en ese CECO + salida de caja de A.
    // La posición interco del núcleo existe SOLO por transferencias/préstamos reales (pares
    // INTERCOMPANIA, fuente 2). Hacia una fondeada/externa (anillo 2/3) el fondeo SÍ deja posición
    // (inversión/activo). Mismo criterio que ya aplica el interuso de gestión (fuente 5).
    if (nucleo.size && nucleo.has(String(A)) && nucleo.has(String(B))) return;
    const m = Math.abs(toNum(monto));
    if (m < 0.01) return;
    add(A, B, moneda || "ARS", +m);   // A acreedor (le puso plata a B)
    add(B, A, moneda || "ARS", -m);   // B deudor
  };
  // 1a. Fondeo vía comprobantes de gasto
  for (const r of comps) {
    const sub = String(r.subtipo || "").toUpperCase();
    if (sub !== "EGRESO" && sub !== "GASTO" && sub !== "EGRESO_FC") continue;
    fondeo(r.sociedad, r.centro_costo, r.moneda, r.total);
  }
  // 1b. Fondeo vía gastos directos / conciliación contabilizada (nb_movimientos)
  for (const m of movs) {
    if (esIgnorado(m)) continue;
    // Solo EGRESOS fondean (A puso plata en el centro de B → A acreedor). Un INGRESO/COBRO contabilizado
    // al centro de otra sociedad es lo opuesto (A cobró plata de B); fondeo() usa Math.abs y siempre pone a
    // A como acreedor, así que invertiría el signo. Espeja el filtro de la fuente 1a (comps) y de fetchGastos.
    const tipo = String(m.tipo || "").toUpperCase();
    if (tipo === "INGRESO" || tipo === "COBRO") continue;
    const esGasto = m.origen === "gasto_directo" || String(m.documento_id || "").startsWith("CONTAB-");
    if (!esGasto) continue;
    fondeo(m.sociedad, m.centro_costo, m.moneda, m.monto);
  }
  // 2. Préstamos / transferencias del núcleo (pares INTERCOMPANIA). Las aperturas son de UNA
  //    pata (documento_id único) → caen como singleton y el guard !salida||!entrada las saltea.
  for (const { salida, entrada } of _pairMovs(movs, "INTERCOMPANIA")) {
    if (!salida || !entrada) continue;
    add(salida.sociedad,  entrada.sociedad, salida.moneda  || "ARS", +Math.abs(toNum(salida.monto)));
    add(entrada.sociedad, salida.sociedad,  entrada.moneda || "ARS", -Math.abs(toNum(entrada.monto)));
  }
  // 3. Saldos de APERTURA interco (go-live, sin caja) — una fila por posición, monto firmado.
  for (const m of movs) {
    if (m.origen !== "interco_apertura" || esIgnorado(m)) continue;
    const A = m.sociedad, B = m.contraparte_id, mm = toNum(m.monto);
    if (!A || !B || String(A) === String(B) || Math.abs(mm) < 0.01) continue;
    add(A, B, m.moneda || "ARS", mm);      addIni(A, B, m.moneda || "ARS", mm);
    add(B, A, m.moneda || "ARS", -mm);     addIni(B, A, m.moneda || "ARS", -mm);
  }
  // 4. Interco PARKEADAS (una sola pata, CON caja) — fuera de núcleo / cruzada de moneda. El signo
  //    lo da la caja: salida (pagué, monto<0) → soy acreedor (+); entrada (recibí) → soy deudor (−).
  for (const m of movs) {
    if (m.origen !== "interco_park" || esIgnorado(m)) continue;
    const A = m.sociedad, B = m.contraparte_id, contrib = -toNum(m.monto);
    if (!A || !B || String(A) === String(B) || Math.abs(contrib) < 0.01) continue;
    add(A, B, m.moneda || "ARS", contrib);
    add(B, A, m.moneda || "ARS", -contrib);
  }
  // 5. Interusos de GESTIÓN cross-society (sede propia de OTRA sociedad, ej. BIGG Fit LLC → sede de
  //    Wellness por Gympass). NO dejan CxC comercial (son movimientos no-caja), pero SÍ suman a la
  //    posición interco. Monto firmado desde la óptica de la sede: INGRESO (+) = el emisor le debe a
  //    la sede (baja lo que la sociedad de la sede le debe al emisor); EGRESO (−) = la sede le debe al
  //    emisor. Los de MISMA sociedad (A, clearing España interno) tienen sociedad == contraparte → el
  //    guard s===c de add() los saltea (netean en el P&L de esa sociedad, sin crear posición).
  for (const m of movs) {
    if (m.origen !== "interuso_gestion" || esIgnorado(m)) continue;
    const A = String(m.sociedad || ""), B = String(m.contraparte_id || ""), mm = toNum(m.monto);
    if (!A || !B || A === B || Math.abs(mm) < 0.01) continue;
    if (!nucleo.size) continue;              // sin datos de anillo no arriesgo posiciones espurias
    if (nucleo.has(A) && nucleo.has(B)) continue;   // núcleo↔núcleo (ej. Ñako→sede Hektor) = gestión pura, sin posición
    add(A, B, m.moneda || "ARS", +mm);
    add(B, A, m.moneda || "ARS", -mm);
  }
  // 6. SUELDOS pagados por cuenta de otra sociedad (fondeo POR PAGADO, no devengado). La caja que
  //    pagó (m.sociedad) frenteó el sueldo de un legajo cuya sociedad empleadora es otra → fondeo.
  //    Ej.: Beta paga el efectivo de un coach de Segui → Beta acreedor / Segui deudor. Los haberes
  //    tienen m.sociedad = la del legajo → A===B → sin posición (Segui pagó su propio blanco).
  //    núcleo↔núcleo se saltea (efectivo de un coach del núcleo pagado con Beta = caja negra, no interco).
  //    Sin datos de anillo no arriesgo posiciones espurias (mismo criterio que la fuente 5).
  if (nucleo.size) for (const m of movs) {
    if (m.origen !== "sueldos" || esIgnorado(m)) continue;
    const A = String(m.sociedad || ""), B = String(legajoSoc[String(m.legajo_id || "")] || "");
    if (!A || !B || A === B) continue;
    if (nucleo.has(A) && nucleo.has(B)) continue;   // ambas del núcleo → sin posición
    const monto = Math.abs(toNum(m.monto));
    if (monto < 0.01) continue;
    add(A, B, m.moneda || "ARS", +monto);   // A (la caja que pagó) acreedor
    add(B, A, m.moneda || "ARS", -monto);   // B (la sociedad empleadora) deudor
  }
  const soc = sociedad ? String(sociedad).toLowerCase() : null;
  const out = [];
  for (const [s, porC] of Object.entries(acc)) {
    if (soc && s.toLowerCase() !== soc) continue;
    for (const [c, porMon] of Object.entries(porC))
      for (const [moneda, neto] of Object.entries(porMon))
        if (Math.abs(neto) >= 0.01) {
          const inicial = accIni[s]?.[c]?.[moneda] || 0;   // componente de apertura (saldo inicial)
          out.push({ sociedad: s, contraparte: c, moneda, neto, inicial, movimientos: neto - inicial });
        }
  }
  return out;
}

// Fondeo del NÚCLEO a las FONDEADAS (anillo 2: España/Colombia/Puertos), POR MES, en una moneda/año —
// "la plata que puse este mes en cada negocio". Mismos criterios y convención de signo que lecturaInterco
// (quien pone la plata = acreedor → invertido = +), pero resuelto por fecha (mes) y filtrado a
// núcleo→fondeada (excluye Segui = externa/anillo 3, y núcleo↔núcleo). Devuelve { [fondeadaId]: number[12] }
// (positivo = invertido ese mes; negativo = te devolvieron). Σ meses = el `neto` de lecturaInterco para esa
// posición. Read-only. Nota: por-moneda (sin FX); consolidación a una moneda = a futuro.
export function fondeoFondeadasMensual({ movs = [], comps = [], centros = [], sociedades = [] } = {}, { year = null, moneda = "ARS", desde = null } = {}) {
  const empresaDe = new Map((centros || []).map(c => [String(c.id), String(c.empresa || "")]));
  const nucleo   = new Set((sociedades || []).filter(s => /n[úu]cleo/i.test(String(s.anillo || ""))).map(s => String(s.id)));
  const fondeada = new Set((sociedades || []).filter(s => /fondead/i.test(String(s.anillo || ""))).map(s => String(s.id)));
  const out = {};
  // Registra un aporte del núcleo A hacia la fondeada B (add(A,B,delta) de lecturaInterco), bucketeado por mes.
  const rec = (A, B, fecha, mon, delta) => {
    A = String(A || ""); B = String(B || "");
    if (!nucleo.has(A) || !fondeada.has(B) || A === B) return;
    if ((mon || "ARS") !== moneda) return;
    const f = String(fecha || "");
    if (year && f.slice(0, 4) !== String(year)) return;
    // Es el FLUJO del mes (lo que puse ese mes), no el acumulado: la apertura (30/6, pre-go-live) es la
    // posición inicial, no un movimiento → se excluye lo anterior a `desde`.
    if (desde && f < desde) return;
    const m = parseInt(f.slice(5, 7), 10) - 1;
    if (m < 0 || m > 11 || Math.abs(delta) < 0.01) return;
    (out[B] ??= new Array(12).fill(0))[m] += delta;
  };
  // 1a/1b. Fondeo vía gasto (A paga un gasto imputado a un CECO de B): comprobantes + gastos directos/CONTAB.
  for (const r of comps) {
    const sub = String(r.subtipo || "").toUpperCase();
    if (sub !== "EGRESO" && sub !== "GASTO" && sub !== "EGRESO_FC") continue;
    rec(r.sociedad, empresaDe.get(String(r.centro_costo || "")), r.fecha, r.moneda, Math.abs(toNum(r.total)));
  }
  for (const m of movs) {
    if (esIgnorado(m)) continue;
    const tipo = String(m.tipo || "").toUpperCase();
    if (tipo === "INGRESO" || tipo === "COBRO") continue;
    const esGasto = m.origen === "gasto_directo" || String(m.documento_id || "").startsWith("CONTAB-");
    if (!esGasto) continue;
    rec(m.sociedad, empresaDe.get(String(m.centro_costo || "")), m.fecha, m.moneda, Math.abs(toNum(m.monto)));
  }
  // 2. Pares INTERCOMPANIA (transferencias del núcleo): ambas patas, cada una con su fecha.
  for (const { salida, entrada } of _pairMovs(movs, "INTERCOMPANIA")) {
    if (!salida || !entrada) continue;
    rec(salida.sociedad,  entrada.sociedad, salida.fecha,  salida.moneda,  +Math.abs(toNum(salida.monto)));
    rec(entrada.sociedad, salida.sociedad,  entrada.fecha, entrada.moneda, -Math.abs(toNum(entrada.monto)));
  }
  // 3. Apertura interco (30/6, monto firmado). 4. Interco parkeadas (contrib = −monto). 5. Interusos de gestión.
  for (const m of movs) {
    if (esIgnorado(m)) continue;
    if (m.origen === "interco_apertura")      rec(m.sociedad, m.contraparte_id, m.fecha, m.moneda, toNum(m.monto));
    else if (m.origen === "interco_park")     rec(m.sociedad, m.contraparte_id, m.fecha, m.moneda, -toNum(m.monto));
    else if (m.origen === "interuso_gestion") rec(m.sociedad, m.contraparte_id, m.fecha, m.moneda, toNum(m.monto));
  }
  return out;
}

// Extracto (ledger) de la posición interco de UNA sociedad contra UNA contraparte+moneda: cada
// movimiento por fecha con su +/− y saldo corriente, más el saldo de apertura. Mismas reglas y
// convención de signo que lecturaInterco (quien pone la plata = acreedor) → el saldo final coincide
// con el `neto` de esa posición. Read-only, no toca datos.
export function intercoLedger({ movs = [], comps = [], centros = [], sociedades = [], legajoSoc = {} } = {}, { sociedad, contraparte, moneda = "ARS" } = {}) {
  const S = String(sociedad || "").toLowerCase();
  const C = String(contraparte || "").toLowerCase();
  const empresaDe = new Map((centros || []).map(c => [String(c.id), c.empresa]));
  const nombreCentro = new Map((centros || []).map(c => [String(c.id), c.nombre]));
  const nombreSoc = new Map((sociedades || []).map(s => [String(s.id), s.nombre || s.id]));
  const nucleo = new Set((sociedades || []).filter(s => /n[úu]cleo/i.test(String(s.anillo || ""))).map(s => String(s.id)));
  const mine = (s, c, mon) => String(s || "").toLowerCase() === S && String(c || "").toLowerCase() === C && (mon || "ARS") === moneda;
  const cc = id => nombreCentro.get(String(id || "")) || "";
  const soc = id => nombreSoc.get(String(id || "")) || String(id || "");
  const entries = [];
  let opening = 0;
  // meta = { prov/tipo, cuenta, centro (nombre), ref (id para ubicarlo en la base) } — todo opcional.
  const push = (fecha, concepto, delta, meta = {}) => { if (Math.abs(delta) >= 0.01) entries.push({ fecha: String(fecha || ""), concepto: concepto || "—", delta, ...meta }); };
  // Emite las dos direcciones de un hecho: si la posición mía es (A→B) suma +amount; si es (B→A) resta.
  const pair = (A, B, mon, fecha, concepto, amount, meta) => {
    if (mine(A, B, mon)) push(fecha, concepto, +amount, meta);
    if (mine(B, A, mon)) push(fecha, concepto, -amount, meta);
  };
  // 1a. Fondeo vía comprobantes de gasto (A paga el centro de B → A acreedor).
  for (const r of comps) {
    const sub = String(r.subtipo || "").toUpperCase();
    if (sub !== "EGRESO" && sub !== "GASTO" && sub !== "EGRESO_FC") continue;
    const B = empresaDe.get(String(r.centro_costo || "")); if (!B) continue;
    const A = r.sociedad, m = Math.abs(toNum(r.total)); if (m < 0.01 || String(A) === String(B)) continue;
    if (nucleo.size && nucleo.has(String(A)) && nucleo.has(String(B))) continue;   // núcleo↔núcleo = gasto en el CECO, no interco
    const flujo = `Pago ${soc(A)} x ${soc(B)}`;   // A (pagador) pagó por B (dueño del centro)
    const meta = { prov: r.proveedor || r.contraparte_nombre || r.contraparte || "", cuenta: r.cuenta_contable || "", centro: cc(r.centro_costo), ref: r.id_comp || r.id || "", docSoc: String(A), refKind: "comp" };
    pair(A, B, r.moneda, r.fecha, flujo, m, meta);
  }
  // 1b. Fondeo vía gastos directos / conciliación contabilizada (nb_movimientos).
  for (const m of movs) {
    if (esIgnorado(m)) continue;
    const tipo = String(m.tipo || "").toUpperCase(); if (tipo === "INGRESO" || tipo === "COBRO") continue;
    const esGasto = m.origen === "gasto_directo" || String(m.documento_id || "").startsWith("CONTAB-"); if (!esGasto) continue;
    const B = empresaDe.get(String(m.centro_costo || "")); if (!B) continue;
    const A = m.sociedad, val = Math.abs(toNum(m.monto)); if (val < 0.01 || String(A) === String(B)) continue;
    if (nucleo.size && nucleo.has(String(A)) && nucleo.has(String(B))) continue;   // núcleo↔núcleo = gasto en el CECO, no interco
    const flujo = `Pago ${soc(A)} x ${soc(B)}`;   // A (pagador) pagó por B (dueño del centro)
    const meta = { prov: m.contraparte_nombre || "", cuenta: m.cuenta_contable || "", centro: cc(m.centro_costo), ref: m.documento_id || m.id || "", docSoc: String(A), refKind: "mov" };
    pair(A, B, m.moneda, m.fecha, flujo, val, meta);
  }
  // 2. Préstamos / transferencias del núcleo (pares INTERCOMPANIA).
  for (const { salida, entrada } of _pairMovs(movs, "INTERCOMPANIA")) {
    if (!salida || !entrada) continue;
    const ref = salida.documento_id || salida.id || "";
    if (mine(salida.sociedad, entrada.sociedad, salida.moneda)) push(salida.fecha, salida.concepto || "Transferencia enviada", +Math.abs(toNum(salida.monto)), { tipo: "Transferencia", ref });
    if (mine(entrada.sociedad, salida.sociedad, entrada.moneda)) push(entrada.fecha, entrada.concepto || "Transferencia recibida", -Math.abs(toNum(entrada.monto)), { tipo: "Transferencia", ref });
  }
  // 3. Saldos de APERTURA → saldo inicial (no es un movimiento del extracto).
  for (const m of movs) {
    if (m.origen !== "interco_apertura" || esIgnorado(m)) continue;
    const A = m.sociedad, B = m.contraparte_id, mm = toNum(m.monto); if (Math.abs(mm) < 0.01) continue;
    if (mine(A, B, m.moneda)) opening += mm;
    if (mine(B, A, m.moneda)) opening += -mm;
  }
  // 4. Interco PARKEADAS (una pata, con caja). Signo por la caja: salida (pagué) → acreedor.
  for (const m of movs) {
    if (m.origen !== "interco_park" || esIgnorado(m)) continue;
    const A = m.sociedad, B = m.contraparte_id, contrib = -toNum(m.monto); if (Math.abs(contrib) < 0.01) continue;
    const meta = { tipo: "Interco parkeada", cuenta: m.cuenta_contable || "", centro: cc(m.centro_costo), ref: m.documento_id || m.id || "" };
    pair(A, B, m.moneda, m.fecha, m.concepto || "Interco parkeada", contrib, meta);
  }
  // 5. Interusos de gestión cross-society (no núcleo↔núcleo).
  for (const m of movs) {
    if (m.origen !== "interuso_gestion" || esIgnorado(m)) continue;
    const A = String(m.sociedad || ""), B = String(m.contraparte_id || ""), mm = toNum(m.monto);
    if (!A || !B || A === B || Math.abs(mm) < 0.01) continue;
    if (!nucleo.size || (nucleo.has(A) && nucleo.has(B))) continue;
    const meta = { tipo: "Interuso gestión", cuenta: m.cuenta_contable || "", centro: cc(m.centro_costo), ref: m.documento_id || m.id || "" };
    pair(A, B, m.moneda, m.fecha, m.concepto || "Interuso gestión", mm, meta);
  }
  // 6. SUELDOS pagados por cuenta de otra sociedad (por pagado). Espeja la fuente 6 de lecturaInterco.
  if (nucleo.size) for (const m of movs) {
    if (m.origen !== "sueldos" || esIgnorado(m)) continue;
    const A = String(m.sociedad || ""), B = String(legajoSoc[String(m.legajo_id || "")] || "");
    if (!A || !B || A === B || (nucleo.has(A) && nucleo.has(B))) continue;
    const monto = Math.abs(toNum(m.monto)); if (monto < 0.01) continue;
    const meta = { tipo: "Sueldo", prov: m.legajo_nombre || "", cuenta: m.cuenta_contable || "Sueldos", centro: cc(m.centro_costo), ref: m.documento_id || m.id || "" };
    pair(A, B, m.moneda, m.fecha, m.concepto || `Sueldo ${m.legajo_nombre || ""}`.trim(), monto, meta);
  }
  const key = f => { const s = String(f || ""); if (/^\d{4}-/.test(s)) return s.slice(0, 10); const [d, mm, y] = s.split("/"); return y ? `${y}-${String(mm).padStart(2, "0")}-${String(d).padStart(2, "0")}` : s; };
  entries.sort((a, b) => key(a.fecha).localeCompare(key(b.fecha)));
  let run = opening;
  for (const e of entries) { run += e.delta; e.saldo = run; }
  return { opening, entries, final: run, moneda };
}

// ── Integridad referencial de maestros ────────────────────────────────────────
// Cuenta cuántos registros (comprobantes + movimientos) referencian a un maestro, para decidir
// antes de borrar: si tiene usos → soft-delete (activo:false); si no → borrado físico seguro.
// Sheets no tiene FKs, así que el chequeo es client-side sobre las dos tablas transaccionales.
export async function contarUsosMaestro({ contraparteId = "", centroId = "", sociedadId = "" } = {}) {
  const [comps, movs] = await Promise.all([
    get("nb_comprobantes", {}).catch(() => []),
    get("nb_movimientos", {}).catch(() => []),
  ]);
  const cp = String(contraparteId || ""), cc = String(centroId || ""), so = String(sociedadId || "");
  const hit = r =>
    (cp && String(r.contraparte_id || "") === cp) ||
    (cc && String(r.centro_costo || "") === cc) ||
    (so && String(r.sociedad || "") === so);
  return [...(Array.isArray(comps) ? comps : []), ...(Array.isArray(movs) ? movs : [])].filter(hit).length;
}

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
    // Pasivo vivo = capital de cuotas PENDIENTES (excluye pagadas Y canceladas). En un plan normal
    // (sin canceladas) equivale a capital_total − capital_pagado; al precancelar, las cuotas en estado
    // "cancelada" dejan de sumar al saldo (antes seguían contando y el pasivo no bajaba).
    const saldo          = p.cuotas.filter(c => c.estado === "pendiente").reduce((s, c) => s + c.capital, 0);
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

// Ledger (extracto) del PASIVO de financiaciones de un bucket (plan_afip / prestamo) en una moneda:
// el saldo es el capital adeudado. Apertura = capital original (o remanente al go-live en aperturas);
// cada cuota PAGADA lo baja (−capital) por su fecha de pago; las PENDIENTES se muestran como evento
// (delta 0, el capital ya estaba en la apertura) para ver si la cuota del mes se devengó/está por pagar.
// `final` = capital pendiente (coincide con el saldo del bucket). Espeja el shape de intercoLedger.
export function financiacionLedger(planes = [], { tipo = null, moneda = "ARS" } = {}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const fmtN = v => (Number(v) || 0).toLocaleString("es-AR", { maximumFractionDigits: 2 });
  const sel = (planes || []).filter(p =>
    (p.moneda || "ARS") === moneda &&
    (tipo == null || (tipo === "plan_afip" ? p.tipo === "plan_afip" : p.tipo !== "plan_afip")));
  let opening = 0;
  const entries = [];
  for (const p of sel) {
    const acr = p.acreedor_nombre || p.nro_plan || "—";
    const N = p.n_cuotas || (p.cuotas || []).length;
    for (const c of (p.cuotas || [])) {
      if (c.estado === "cancelada") continue;
      opening += c.capital;                              // capital no cancelado = deuda de apertura
      if (c.estado === "pagada") {
        entries.push({ fecha: c.fecha_pago || c.vto, delta: -c.capital,
          concepto: `${acr} · Cuota ${c.nro_cuota}/${N} pagada`,
          sub: `capital ${fmtN(c.capital)} · interés ${fmtN(c.interes)}` });
      } else {
        const dev = c.vto && String(c.vto) <= hoy;       // vencida = ya devengada (P&L por vto)
        entries.push({ fecha: c.vto, delta: 0, pend: true,
          concepto: `${acr} · Cuota ${c.nro_cuota}/${N} ${dev ? "devengada · pendiente de pago" : "programada"}`,
          sub: `capital ${fmtN(c.capital)} · interés ${fmtN(c.interes)}` });
      }
    }
  }
  entries.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  let saldo = opening;
  for (const e of entries) { saldo += e.delta; e.saldo = saldo; }
  return { opening, entries, final: saldo };
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
    // Sumar meses sin overflow: base día 31 + 1 mes NO debe saltar a marzo. Clampeamos al último día del
    // mes destino (setMonth desbordaría: new Date(2026,1,31)=3-mar).
    const mesDestino = base.getMonth() + (k - 1) * stepMeses;
    const d = new Date(base.getFullYear(), mesDestino, 1);
    const ultDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(base.getDate(), ultDia));
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
