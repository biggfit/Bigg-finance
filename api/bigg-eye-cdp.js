// api/bigg-eye-cdp.js — Vercel Serverless Function
//
// Incentivos de venta por persona y sede para Liquidación Sedes ("Cargar CDP"):
//   - cdp_coach      : altas con clase de prueba, al COACH que dio la CDP
//   - cdp_front      : altas con clase de prueba, al VENDEDOR que cerró
//   - one_shot_count : altas sin clase de prueba, al VENDEDOR que cerró
//
// Fuente única: report 20 "Nuevas cuentas" (= reporte de altas de BIGG Eye), una fila
// por alta, filtrado por FECHA DE CONVERSIÓN (conversion_date). Regla de negocio
// (Martín, 23/9/2026): la CDP se paga en el mes en que se convierte la venta; pasado el
// último día del mes el número no se mueve. Antes se usaba el report 9 "Clases de
// prueba", que vive en el mes de la CLASE y cambiaba retroactivamente con compras
// posteriores. El coach viene en `coach_cdp` (agregado por BI el 23/9; alias `coach_name`).
//
// Arquitectura: cache manual primero → REST fallback.
//
// Query params:
//   month        — mes 1-12
//   year         — año (ej: 2026)
//   pais         — código de país ("AR" | "ES" | "CL"). Opcional.
//   location_ids — IDs Bigg Eye separados por coma (desde nb_centros_costo.bigg_eye_id)
//   fresh        — "1": saltea la cache y baja en vivo
//   sin_rematriculados — "1": excluye altas type=re-registration (por defecto se cuentan)
//
// Devuelve:
//   { items: [{ coach_name, location_id, location_name, cdp_coach, cdp_front, one_shot_count }], _source }

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const BIGG_EYE_API = "https://api.bigg.fit";
const TOKEN = process.env.BIGG_EYE_TOKEN;

// Cache manual — regenerar cada mes al liquidar (mismo ciclo que bigg-eye-horas-cache.json).
let _cache = null;
function getCache() {
  if (_cache) return _cache;
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(dir, "bigg-eye-cdp-cache.json"), "utf8");
    _cache = JSON.parse(raw);
  } catch { _cache = {}; }
  return _cache;
}

// Fallback de nombres de sedes (para cuando no se recibe location_ids del frontend).
const SEDES_POR_PAIS = {
  AR: [
    { id:  1, nombre: "Recoleta"            },
    { id:  8, nombre: "Barrio Norte"        },
    { id:  3, nombre: "Belgrano Av Cabildo" },
    { id:  6, nombre: "Plaza Libertad"      },
    { id: 42, nombre: "Palermo Rosedal"     },
    { id:  2, nombre: "Palermo Chico"       },
    { id: 32, nombre: "Botánico"            },
  ],
  ES: [
    { id: 50, nombre: "Chamberí" },
    { id: 52, nombre: "Orense"   },
    { id: 53, nombre: "Alcalá"   },
    { id: 57, nombre: "Chueca"   },
  ],
  CL: [
    { id: 56, nombre: "Parque de la 93" },
    { id: 26, nombre: "Rosales"         },
  ],
};

function extractRows(data) {
  if (Array.isArray(data))          return data;
  if (Array.isArray(data?.data))    return data.data;
  if (Array.isArray(data?.items))   return data.items;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

// Fetch REST report_json/<id>/ por sede — la ruta que funciona con el token.
// start/end inclusivos (YYYY-MM-DD). Devuelve array de filas.
async function fetchReportJson(id, locId, start, end) {
  const url = `${BIGG_EYE_API}/report_json/${id}/?location_id=${locId}&start_date=${start}&end_date=${end}`;
  const res = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return extractRows(data);
}

function isTestEntry(r) {
  const name = String(r.member_name ?? "").toLowerCase();
  return name.includes("test") || name.includes("testeo");
}

// ── Merge helper ──────────────────────────────────────────────────────────────
// Map keyed por `"nombre:location_id"` con { coach_name, location_id, location_name,
// cdp_coach, cdp_front, one_shot_count }. La misma persona puede sumar como coach
// (cdp_coach) y como vendedor (cdp_front / one_shot) en la misma sede — se acumulan.
// cdp_coach y cdp_front se mantienen SEPARADOS porque pagan a distinta tarifa.
function buildItemMap() {
  const map = new Map();
  const upsert = (name, locId, locName, { cdp_coach = 0, cdp_front = 0, one_shot = 0 }) => {
    const key = `${name}:${locId}`;
    const existing = map.get(key);
    if (existing) {
      existing.cdp_coach      += cdp_coach;
      existing.cdp_front      += cdp_front;
      existing.one_shot_count += one_shot;
    } else {
      map.set(key, {
        coach_name:     name,
        location_id:    locId,
        location_name:  locName,
        cdp_coach,
        cdp_front,
        one_shot_count: one_shot,
      });
    }
  };
  return { map, upsert };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { month, year, pais, location_ids } = req.query;

  if (!month || !year) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Faltan parámetros: month, year" }));
    return;
  }
  if (!TOKEN) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "BIGG_EYE_TOKEN no configurado" }));
    return;
  }

  const mo  = Number(month);
  const yr  = Number(year);
  const pad = (n) => String(n).padStart(2, "0");

  if (isNaN(mo) || isNaN(yr) || mo < 1 || mo > 12) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Parámetros inválidos" }));
    return;
  }

  // Construir sedesTarget desde query param o fallback a SEDES_POR_PAIS
  let sedesTarget;
  if (location_ids) {
    sedesTarget = location_ids.split(",")
      .map(s => Number(s.trim()))
      .filter(Boolean)
      .map(id => {
        const known = Object.values(SEDES_POR_PAIS).flat().find(s => s.id === id);
        return { id, nombre: known?.nombre ?? String(id) };
      });
  } else {
    sedesTarget = pais
      ? (SEDES_POR_PAIS[pais.toUpperCase()] ?? [])
      : Object.values(SEDES_POR_PAIS).flat();
  }

  const sedesTargetIds = new Set(sedesTarget.map(s => s.id));
  const sedesById      = Object.fromEntries(sedesTarget.map(s => [s.id, s]));

  // ── 0. Cache manual ──────────────────────────────────────────────────────────
  const fresh       = req.query.fresh === "1" || req.query.fresh === "true";  // "Cargar CDP": saltea cache, baja en vivo
  const cacheKey    = `${yr}-${pad(mo)}-${pais ? pais.toUpperCase() : "ALL"}`;
  const cacheData   = getCache();
  const cachedItems = cacheData[cacheKey];
  const cacheFiltered = Array.isArray(cachedItems)
    ? cachedItems.filter(r => sedesTargetIds.has(Number(r.location_id)))
    : [];
  if (!fresh && cacheFiltered.length > 0) {
    res.statusCode = 200;
    res.end(JSON.stringify({ items: cacheFiltered, _source: `cache:${cacheKey}` }));
    return;
  }

  // ── 1. REST — report 20 por sede, mes calendario completo ───────────────────
  // Rango INCLUSIVO del 1° al último día del mes (antes se cortaba en el 1° del mes
  // siguiente inclusive y el día 1 se contaba dos veces).
  const start   = `${yr}-${pad(mo)}-01`;
  const lastDay = new Date(Date.UTC(yr, mo, 0)).getUTCDate();
  const end     = `${yr}-${pad(mo)}-${pad(lastDay)}`;
  const sinRematriculados = req.query.sin_rematriculados === "1" || req.query.sin_rematriculados === "true";

  try {
    const per = await Promise.all(
      sedesTarget.map(s => fetchReportJson(20, s.id, start, end).catch(() => []))
    );
    const rows = per.flat();

    const { map, upsert } = buildItemMap();
    const sinCoach = [];
    const otrosCdp = new Set();

    for (const r of rows) {
      const locId = Number(r.location_id);
      if (!sedesTargetIds.has(locId)) continue;
      if (isTestEntry(r)) continue;
      if (sinRematriculados && r.type === "re-registration") continue;

      const locName = sedesById[locId]?.nombre ?? String(locId);
      const seller  = String(r.seller_name ?? "").trim();
      const cdp     = String(r.cdp ?? "").trim();

      if (cdp === "One Shot") {
        // Alta sin clase de prueba: solo al vendedor. (Los re-matriculados traen un
        // coach_cdp = coach asignado del socio viejo; NO es una CDP, se ignora.)
        if (seller) upsert(seller, locId, locName, { one_shot: 1 });
      } else if (cdp === "Trial Class") {
        // Alta con clase de prueba: front al vendedor que cerró + coach que dio la CDP.
        const coach = String(r.coach_cdp ?? r.coach_name ?? "").trim();
        if (seller) upsert(seller, locId, locName, { cdp_front: 1 });
        if (coach)  upsert(coach,  locId, locName, { cdp_coach: 1 });
        else        sinCoach.push(`${r.member_name ?? r.customer_id} (${locName})`);
      } else {
        otrosCdp.add(cdp || "(vacío)");
      }
    }

    const items = Array.from(map.values())
      .filter(r => r.cdp_coach > 0 || r.cdp_front > 0 || r.one_shot_count > 0);

    // En vivo no devolvió nada. Si hay cache del mes, devolverlo (no dejar la pantalla vacía).
    if (items.length === 0 && cacheFiltered.length > 0) {
      res.statusCode = 200;
      res.end(JSON.stringify({ items: cacheFiltered, _source: `cache-fallback:${cacheKey}` }));
      return;
    }

    const debug = {};
    if (rows.length === 0)  debug.aviso           = "report 20 en vivo devolvió 0 filas";
    if (sinCoach.length)    debug.sin_coach       = sinCoach;
    if (otrosCdp.size)      debug.cdp_desconocido = [...otrosCdp];

    res.statusCode = 200;
    res.end(JSON.stringify({
      items,
      _source: `report 20 (altas) por fecha de conversión ${start}..${end} (${rows.length} filas)`,
      ...(Object.keys(debug).length && { _debug: debug }),
    }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}
