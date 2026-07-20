// api/bigg-eye-cdp.js — Vercel Serverless Function
//
// Obtiene en una sola respuesta:
//   - cdp_count      : socios convertidos por coach (type=Members en BIGG Eye)
//   - one_shot_count : altas sin clase de prueba, por vendedor (report_id=20, cdp='One Shot')
//
// Arquitectura: cache manual primero → REST fallback (ambas fuentes en paralelo).
//
// Query params:
//   month        — mes 1-12
//   year         — año (ej: 2026)
//   pais         — código de país ("AR" | "ES" | "CL"). Opcional.
//   location_ids — IDs Bigg Eye separados por coma (desde nb_centros_costo.bigg_eye_id)
//
// Devuelve:
//   { items: [{ coach_name, location_id, location_name, cdp_count, one_shot_count }], _source }

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

async function fetchJsonDebug(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${TOKEN}` },
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data, raw: text.slice(0, 500) };
}

function extractRows(data) {
  if (Array.isArray(data))          return data;
  if (Array.isArray(data?.data))    return data.data;
  if (Array.isArray(data?.items))   return data.items;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function parseCount(r, ...keys) {
  for (const k of keys) {
    const v = Number(r[k]);
    if (!isNaN(v) && v > 0) return v;
  }
  return 0;
}

function isTestEntry(r) {
  const name = String(r.member_name ?? "").toLowerCase();
  return name.includes("test") || name.includes("testeo");
}

// Extrae array JSON de respuesta SSE o JSON plano (igual que bigg-eye-horas).
function parseJsonOrSse(text) {
  const tryExtract = (obj) => {
    const t = obj?.result?.content?.[0]?.text;
    if (t) { try { return JSON.parse(t); } catch { return null; } }
    if (Array.isArray(obj?.result)) return obj.result;
    return null;
  };
  if (text.trimStart().startsWith("data:")) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try { const r = tryExtract(JSON.parse(line.slice(5).trim())); if (r) return r; } catch {}
    }
    return null;
  }
  try { return tryExtract(JSON.parse(text)); } catch { return null; }
}

// Trae un report vía el MCP server de Cloudflare Workers (el REST /report del token está roto).
async function fetchViaWorkerMcp(report_id, location_id, start, end) {
  const MCP_URL = "https://bigg-eye-mcp-server.mmiauro.workers.dev/mcp";
  const args = { report_id, start_date: start, end_date: end };
  if (location_id != null) args.location_id = location_id;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "get_report", arguments: args } });
  for (const authHeader of [null, `Bearer ${TOKEN}`]) {
    try {
      const headers = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };
      if (authHeader) headers["Authorization"] = authHeader;
      const res  = await fetch(MCP_URL, { method: "POST", headers, body });
      const rows = parseJsonOrSse(await res.text());
      if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch {}
  }
  return null;
}

// ── Merge helper ──────────────────────────────────────────────────────────────
// Devuelve un Map keyed por `"nombre:location_id"` con { coach_name, location_id,
// location_name, cdp_count, one_shot_count }. Permite que el mismo nombre aparezca
// como coach (cdp) y como vendedor (one_shot) en la misma sede — se acumulan.
function buildItemMap(sedesById) {
  const map = new Map();
  // cdp_coach = CDP conducidas como coach (Fuente A); cdp_front = CDP cerradas como
  // vendedor/encargado (Fuente B). Se mantienen SEPARADAS porque pagan a distinta tarifa.
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
  const cacheKey    = `${yr}-${pad(mo)}-${pais ? pais.toUpperCase() : "ALL"}`;
  const cacheData   = getCache();
  const cachedItems = cacheData[cacheKey];
  if (Array.isArray(cachedItems) && cachedItems.length > 0) {
    const filtered = cachedItems.filter(r => sedesTargetIds.has(Number(r.location_id)));
    res.statusCode = 200;
    res.end(JSON.stringify({ items: filtered, _source: `cache:${cacheKey}` }));
    return;
  }

  // ── 1. REST API fallback — ambas fuentes en paralelo ────────────────────────
  const start   = `${yr}-${pad(mo)}-01`;
  const lastDay = new Date(yr, mo, 0).getDate();
  const end     = `${yr}-${pad(mo)}-${pad(lastDay)}`;

  // Fuente CDP: report 9 "Clases de prueba" (= la UI "Socios con Clase de Prueba").
  // Por cada socio que ASISTIÓ y CONVIRTIÓ: cdp_coach al coach (coach_cdp) y
  // cdp_front al vendedor que cerró (seller). One-shots: report 20 (cdp='One Shot').
  // Se traen por el MCP de Cloudflare Workers (el REST /report del token está roto).
  try {
    const [cdpRows, oneShotRows] = await Promise.all([
      fetchViaWorkerMcp(9,  null, start, end),
      fetchViaWorkerMcp(20, null, start, end),
    ]);
    const cdpResult     = { data: cdpRows || [],     status: 200, raw: "" };
    const oneShotResult = { data: oneShotRows || [], status: 200, raw: "" };

    const { map, upsert } = buildItemMap(sedesById);

    // CDP convertidas (report 9): coach (coach_cdp) + vendedor (seller), solo convertidos.
    // Dedup por socio: si tomó varias clases de prueba, cuenta 1 vez (= "Socios con CDP").
    const seenMember = new Set();
    for (const r of extractRows(cdpResult.data)) {
      const locId = Number(r.location_id);
      if (!sedesTargetIds.has(locId)) continue;
      const convertido = r.first_buy != null || r.member_id != null;
      if (!r.has_attended || !convertido) continue;
      const memberKey = `${r.member_id ?? r.prospect_id}:${locId}`;
      if (seenMember.has(memberKey)) continue;
      seenMember.add(memberKey);
      const locName = sedesById[locId]?.nombre ?? r.location_name ?? String(locId);
      const coach  = String(r.coach_cdp ?? "").trim();
      const seller = String(r.seller ?? "").trim();
      if (coach)  upsert(coach,  locId, locName, { cdp_coach: 1 });
      if (seller) upsert(seller, locId, locName, { cdp_front: 1 });
    }

    // One Shot (report 20): altas sin CDP, por vendedor.
    for (const r of extractRows(oneShotResult.data)) {
      const locId = Number(r.location_id);
      if (!sedesTargetIds.has(locId)) continue;
      if (isTestEntry(r)) continue;
      if (r.cdp !== "One Shot") continue;
      const name = String(r.seller_name ?? "").trim();
      if (!name) continue;
      upsert(name, locId, sedesById[locId]?.nombre ?? String(locId), { one_shot: 1 });
    }

    const items = Array.from(map.values())
      .filter(r => r.cdp_coach > 0 || r.cdp_front > 0 || r.one_shot_count > 0);

    const cdpCount = extractRows(cdpResult.data).length;
    res.statusCode = 200;
    res.end(JSON.stringify({
      items,
      _source: `report_id=9 vía MCP (${cdpCount} filas) + report_id=20 (one-shot)`,
      ...(cdpCount === 0 && { _debug: "report 9 vía MCP devolvió 0 filas" }),
    }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}
