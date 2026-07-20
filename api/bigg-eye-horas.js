// api/bigg-eye-horas.js — Vercel Serverless Function
//
// Obtiene las horas trabajadas por coach desde el Report 12 de Bigg Eye,
// solo para las sedes que operamos (IDs hardcodeados por país).
//
// Query params:
//   month  — mes 1-12
//   year   — año (ej: 2026)
//   pais   — código de país ("AR" | "ES" | "CL"). Si se omite, trae todas.
//
// Devuelve:
//   { items: [{ coach_name, location_id, location_name, hours }],
//     locations_count: N, total_locations: N, rejected_count: N }

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join }  from "path";

const BIGG_EYE_API = "https://api.bigg.fit";
const TOKEN        = process.env.BIGG_EYE_TOKEN;

// Cache manual generada vía MCP (se regenera manualmente cada mes al liquidar).
// Ubicada en api/bigg-eye-horas-cache.json junto a este archivo.
let _cache = null;
function getCache() {
  if (_cache) return _cache;
  try {
    const dir  = dirname(fileURLToPath(import.meta.url));
    const raw  = readFileSync(join(dir, "bigg-eye-horas-cache.json"), "utf8");
    _cache = JSON.parse(raw);
  } catch { _cache = {}; }
  return _cache;
}

// IDs de location en Bigg Eye para cada sede operada, con su nombre legible.
const SEDES_POR_PAIS = {
  AR: [
    { id:  1, nombre: "Recoleta"          },
    { id:  8, nombre: "Barrio Norte"      },
    { id:  3, nombre: "Belgrano Av Cabildo" },
    { id:  6, nombre: "Plaza Libertad"    },
    { id: 42, nombre: "Palermo Rosedal"   },
    { id:  2, nombre: "Palermo Chico"     },
    { id: 32, nombre: "Botánico"          },
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

async function fetchJson(url) {
  const res  = await fetch(url, {
    headers: {
      Accept:        "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`API error ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); }
  catch { throw new Error(`Respuesta no-JSON (${res.status}): ${text.slice(0, 200)}`); }
}

// Igual que fetchJson pero también devuelve el texto crudo para debug
async function fetchJsonDebug(url) {
  const res  = await fetch(url, {
    headers: {
      Accept:        "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data, raw: text.slice(0, 500) };
}

// Extrae un array JSON de una respuesta que puede ser SSE (text/event-stream)
// o JSON plano. Las respuestas SSE tienen líneas "data: {...}".
function parseJsonOrSse(text) {
  // Si empieza con "data:", es SSE
  if (text.trimStart().startsWith("data:")) {
    const lines = text.split("\n");
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      try {
        const obj = JSON.parse(line.slice(5).trim());
        // El resultado viene en result.content[0].text (tools/call response)
        const textContent = obj?.result?.content?.[0]?.text;
        if (textContent) return JSON.parse(textContent);
        // O directamente en result (si el server devuelve el array directo)
        if (Array.isArray(obj?.result)) return obj.result;
      } catch {}
    }
    return null;
  }
  // JSON plano
  try {
    const obj = JSON.parse(text);
    const textContent = obj?.result?.content?.[0]?.text;
    if (textContent) return JSON.parse(textContent);
    if (Array.isArray(obj?.result)) return obj.result;
  } catch {}
  return null;
}

// Llama al Cloudflare Workers MCP server para invocar get_report.
// Retorna array de rows con { coach_name, hours, location_id, location_name }
// o null si falla.
async function fetchViaWorkerMcp(location_id, start, end) {
  const MCP_URL = "https://bigg-eye-mcp-server.mmiauro.workers.dev/mcp";

  const args = { report_id: 12, start_date: start, end_date: end };
  if (location_id != null) args.location_id = location_id;

  const toolsCallBody = JSON.stringify({
    jsonrpc: "2.0", id: 1,
    method: "tools/call",
    params: { name: "get_report", arguments: args },
  });

  // El servidor MCP puede ser stateless (no requiere initialize) o stateful.
  // Probamos 3 variantes de auth: sin auth, Bearer BIGG_EYE_TOKEN, Bearer app-secret.
  // El secreto de la app NO se hardcodea: viene de la env var APP_SECRET (Vercel).
  const AUTH_VARIANTS = [
    null,                            // sin auth — el servidor puede ser público
    `Bearer ${TOKEN}`,               // el mismo token del API
    process.env.APP_SECRET ? `Bearer ${process.env.APP_SECRET}` : null, // secreto de la app (env)
  ];

  for (const authHeader of AUTH_VARIANTS) {
    try {
      const headers = {
        "Content-Type": "application/json",
        "Accept":       "application/json, text/event-stream",
      };
      if (authHeader) headers["Authorization"] = authHeader;

      // Intento 1: tools/call directo (servidor stateless)
      const directRes = await fetch(MCP_URL, {
        method: "POST", headers, body: toolsCallBody,
      });
      const directText = await directRes.text();
      const directRows = parseJsonOrSse(directText);
      if (Array.isArray(directRows) && directRows.length > 0) return directRows;

      // Intento 2: initialize → obtener session ID → tools/call
      const initRes = await fetch(MCP_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0", id: 0,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "bigg-finance", version: "1.0" },
          },
        }),
      });
      const sessionId = initRes.headers.get("Mcp-Session-Id");
      if (!initRes.ok && initRes.status >= 500) continue;

      const sessionHeaders = { ...headers };
      if (sessionId) sessionHeaders["Mcp-Session-Id"] = sessionId;

      const callRes = await fetch(MCP_URL, {
        method: "POST", headers: sessionHeaders, body: toolsCallBody,
      });
      const callText = await callRes.text();
      const rows = parseJsonOrSse(callText);
      if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch {}
  }

  return null;
}

// ── Mapeo de filas del reporte 12 nuevo (clase × día × asistió) ────────────────
// El reporte ahora desglosa por CLASE (BIGG CLASS / YOGA / RUNNING) × tipo de día
// (regulares / feriado / domingo) + Asistió (Presentes / Ausentes). Los nombres de campo
// del MCP no están 100% confirmados → mapeo TOLERANTE (prueba variantes). Compat hacia atrás:
// si la fila no trae desglose nuevo, se toma `hours` como BIGG CLASS regulares.
const numh = (v) => { const n = Number(String(v ?? "").toString().replace(",", ".")); return isFinite(n) ? n : 0; };
const pick = (r, ...keys) => { for (const k of keys) if (r[k] != null && r[k] !== "") return r[k]; return undefined; };
function clasificarClase(raw) {
  const s = String(raw ?? "").toUpperCase();
  if (s.includes("YOGA")) return "YOGA";
  if (s.includes("RUNNING") || s.includes("RUN")) return "RUNNING";
  return "BIGG CLASS";
}
function esPresente(r) {
  const v = pick(r, "has_attended", "asistio", "asistió", "attended", "presente", "asistencia");
  if (v == null) return true;                 // sin dato → contar (compat)
  if (typeof v === "boolean") return v;       // report 12: has_attended (bool)
  const s = String(v).toLowerCase();
  return s.startsWith("pres") || s === "true" || s === "1" || s === "si" || s === "sí";
}
// rows → líneas normalizadas (una por coach×sede×clase×asistió), filtradas a las sedes operadas.
function eyeLineasDe(rows, sedesTargetIds, sedesById) {
  const out = [];
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const locId = Number(r.location_id);
    if (!sedesTargetIds.has(locId)) continue;
    const reg = numh(pick(r, "hs_regulares", "regulares", "horas_regulares", "regular_hours", "hs_regular", "horas_regular"));
    const fer = numh(pick(r, "hs_feriado", "feriado", "horas_feriado", "holiday_hours", "hs_feriados", "feriados"));
    const dom = numh(pick(r, "hs_domingo", "domingo", "horas_domingo", "sunday_hours", "hs_domingos", "domingos"));
    const tieneDesglose = pick(r, "hs_regulares", "regulares", "horas_regulares", "regular_hours", "hs_feriado", "feriado", "hs_domingo", "domingo", "clase", "class") != null;
    const regFinal = tieneDesglose ? reg : numh(pick(r, "hours", "hs_total", "total_horas"));
    if (regFinal === 0 && fer === 0 && dom === 0) continue;
    const sede = sedesById[locId];
    out.push({
      coach_name:    String(r.coach_name ?? "").trim(),
      location_id:   locId,
      location_name: sede?.nombre ?? r.location_name ?? String(locId),
      clase:         clasificarClase(pick(r, "parent_class_name", "clase", "class", "tipo_clase", "class_type", "class_name")),
      asistio:       esPresente(r) ? "Presentes" : "Ausentes",
      regulares:     regFinal, feriado: fer, domingo: dom,
      hours:         regFinal + fer + dom,   // compat con consumidores viejos
    });
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // location_ids: comma-separated BIGG Eye IDs sent by the frontend (from nb_centros_costo)
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

  // Build sedesTarget from query param (frontend sends bigg_eye_ids from nb_centros_costo)
  // Fallback to SEDES_POR_PAIS only if no location_ids provided (backward compat)
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
  const start   = `${yr}-${pad(mo)}-01`;
  const lastDay = new Date(yr, mo, 0).getDate();
  const end     = `${yr}-${pad(mo)}-${pad(lastDay)}`;

  // Mes en formato YYYY-MM (el MCP usa date_month con este formato)
  const dateMes = `${yr}-${pad(mo)}`;

  // ── 0. Cache manual (datos precargados vía MCP, se regeneran cada mes) ──────
  const cacheKey   = `${yr}-${pad(mo)}-${pais ? pais.toUpperCase() : "ALL"}`;
  const cacheData  = getCache();
  const cachedItems = cacheData[cacheKey];
  if (Array.isArray(cachedItems) && cachedItems.length > 0) {
    // Si se pasa pais pero hay cache sin pais específico, ya vienen filtrados.
    // Filtrar adicionalmente por sedesTarget en caso de mismatch.
    const sedesTargetIdsCache = new Set(sedesTarget.map(s => s.id));
    const sedesByIdCache = Object.fromEntries(sedesTarget.map(s => [s.id, s]));
    // eyeLineasDe normaliza tanto la caché nueva (con clase/desglose) como la vieja (hours).
    const filtered = eyeLineasDe(cachedItems, sedesTargetIdsCache, sedesByIdCache);
    res.statusCode = 200;
    res.end(JSON.stringify({
      items:           filtered,
      locations_count: sedesTarget.length,
      total_locations: sedesTarget.length,
      location_names:  sedesTarget.map(s => `${s.id}:${s.nombre}`),
      rejected_count:  0,
      rejected_msgs:   [],
      _sample_url:     `cache:${cacheKey}`,
      _sample_resp:    { raw: `${filtered.length} coaches desde cache MCP` },
    }));
    return;
  }

  // ── 1. REST API + MCP fallback (si no hay cache para este mes) ───────────
  // Set de location_ids operados para filtrar client-side
  const sedesTargetIds = new Set(sedesTarget.map(s => s.id));
  const sedesById      = Object.fromEntries(sedesTarget.map(s => [s.id, s]));

  // Candidatos de URL para probar SIN filtro de location_id.
  // El token no tiene acceso al report con location_id filter →
  // buscamos todas las sedes y filtramos por nuestros IDs client-side.
  const CANDIDATES = [
    // Sin location_id — el más probable que devuelva algo
    `${BIGG_EYE_API}/report?id=12&start_date=${start}&end_date=${end}`,
    `${BIGG_EYE_API}/report?id=12&date_month=${dateMes}`,
    `${BIGG_EYE_API}/report?id=12&start=${start}&end=${end}`,
  ];

  // Función auxiliar para extraer rows de la respuesta JSON
  function extractRows(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.results)) return data.results;
    return [];
  }

  try {
    // Probar los formatos de URL sin location_id
    const probes = await Promise.all(CANDIDATES.map(url => fetchJsonDebug(url)));
    const working = probes.findIndex(p => {
      const rows = extractRows(p.data);
      return rows.length > 0;
    });

    const probesSummary = CANDIDATES.map((url, i) => ({
      url,
      status: probes[i].status,
      type:   Array.isArray(probes[i].data) ? `array(${probes[i].data?.length})` : typeof probes[i].data,
      raw:    probes[i].raw?.slice(0, 150),
    }));

    // — — — Fallback: Cloudflare Workers MCP server — — —
    if (working === -1) {
      // REST sin location_id no devolvió datos. Intentar el MCP server de Cloudflare Workers.
      let mcpRows = [];
      try {
        // Fetch sin location_id (null) para obtener todos
        const rows = await fetchViaWorkerMcp(null, start, end);
        if (Array.isArray(rows)) mcpRows = rows;
      } catch {}

      const mcpItems = eyeLineasDe(mcpRows, sedesTargetIds, sedesById);

      if (mcpItems.length > 0) {
        res.statusCode = 200;
        res.end(JSON.stringify({
          items:           mcpItems,
          locations_count: sedesTarget.length,
          total_locations: sedesTarget.length,
          location_names:  sedesTarget.map(s => `${s.id}:${s.nombre}`),
          rejected_count:  0, rejected_msgs: [],
          _sample_url:     "vía MCP Cloudflare Workers",
          _sample_resp:    { raw: `${mcpItems.length} items desde MCP server` },
        }));
        return;
      }

      // Todo fallido — devolver debug con estado de las 3 capas
      const restDebug = probesSummary.map(p => `${p.url.split('?')[0]}?... → ${p.status} ${p.raw?.slice(0,60)}`).join(' | ');
      res.statusCode = 200;
      res.end(JSON.stringify({ items: [], locations_count: 0, total_locations: sedesTarget.length,
        location_names: [], rejected_count: 0, rejected_msgs: [],
        _sample_url: "ninguno funcionó (REST + MCP)",
        _sample_resp: { raw: `REST: ${restDebug}` } }));
      return;
    }

    // Hay una URL que funciona — normalizar a líneas por clase/día y filtrar a nuestras sedes
    const allRows = extractRows(probes[working].data);
    const items = eyeLineasDe(allRows, sedesTargetIds, sedesById);

    res.statusCode = 200;
    res.end(JSON.stringify({
      items,
      locations_count:  sedesTarget.length,
      total_locations:  sedesTarget.length,
      location_names:   sedesTarget.map(s => `${s.id}:${s.nombre}`),
      rejected_count:   0,
      rejected_msgs:    [],
      _sample_url:  CANDIDATES[working],
      _sample_resp: { raw: `URL que funcionó: ${CANDIDATES[working]} · ${allRows.length} rows totales → ${items.length} de nuestras sedes` },
    }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}
