// api/bigg-eye.js — Vercel Serverless Function
//
// Obtiene las ventas mensuales de una sede desde Bigg Eye vía su servidor MCP.
//
// Query params requeridos:
//   location_id  — ID de la sede en Bigg Eye (número)
//   month        — mes 1-12
//   year         — año (ej: 2026)
//
// Devuelve:
//   { ventas: number }  — suma de total_sales del mes para esa sede
//   { error: string }   — si algo falla
//
// Estructura de respuesta de get_sales (MCP):
//   { sales: { results: [{ location_id, date, total_sales, type }] }, avg_ticket: {...}, same_moment: {...} }

const MCP_URL = "https://bigg-eye-mcp-server.mmiauro.workers.dev/mcp";

/**
 * Llama a una herramienta del servidor MCP vía Streamable HTTP (JSON-RPC 2.0).
 * Soporta tanto respuestas application/json como text/event-stream (SSE).
 */
async function callMcpTool(toolName, args) {
  // Paso 1: Initialize
  const initPayload = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "bigg-finance", version: "1.0" },
    },
  });

  const initRes = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: initPayload,
  });

  const sessionId = initRes.headers.get("mcp-session-id");
  const initText  = await initRes.text();
  const initData  = parseMcpResponse(initText);
  if (initData?.error) throw new Error("MCP init: " + JSON.stringify(initData.error));

  // Paso 2: Llamar la herramienta
  const callPayload = JSON.stringify({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: toolName, arguments: args },
  });

  const callHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) callHeaders["mcp-session-id"] = sessionId;

  const callRes  = await fetch(MCP_URL, { method: "POST", headers: callHeaders, body: callPayload });
  const callText = await callRes.text();
  const callData = parseMcpResponse(callText);

  if (callData?.error) throw new Error("MCP call: " + JSON.stringify(callData.error));

  // El contenido viene en result.content[0].text (texto JSON)
  const content = callData?.result?.content;
  if (!Array.isArray(content) || !content[0]?.text) {
    throw new Error("Respuesta MCP inesperada: " + callText.slice(0, 200));
  }

  return JSON.parse(content[0].text);
}

/** Parsea una respuesta que puede ser JSON puro o SSE (data: {...}). */
function parseMcpResponse(text) {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) return JSON.parse(t);
  // SSE: extraer la última línea "data: {...}"
  const lines = t.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (l.startsWith("data:")) {
      const json = l.slice(5).trim();
      if (json && json !== "[DONE]") return JSON.parse(json);
    }
  }
  throw new Error("No se pudo parsear respuesta MCP");
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { location_id, month, year } = req.query;
  if (!location_id || !month || !year) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Faltan parámetros: location_id, month, year" }));
    return;
  }

  const locId = Number(location_id);
  const mo    = Number(month);   // 1-12
  const yr    = Number(year);

  if (isNaN(locId) || isNaN(mo) || isNaN(yr) || mo < 1 || mo > 12) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Parámetros inválidos" }));
    return;
  }

  try {
    // get_sales devuelve TODOS los datos históricos de la sede;
    // filtramos por mes/año después de recibirlos.
    const data = await callMcpTool("get_sales", { location_id: locId });

    // Estructura: { sales: { results: [{ location_id, date, total_sales, type }] }, ... }
    const salesRows = data?.sales?.results ?? [];

    // Filtrar por mes/año y sumar total_sales
    const monthStr = String(mo).padStart(2, "0");
    const prefix   = `${yr}-${monthStr}-`;

    let ventas = 0;
    for (const row of salesRows) {
      if (String(row.date ?? "").startsWith(prefix)) {
        ventas += parseFloat(row.total_sales ?? 0) || 0;
      }
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ ventas: Math.round(ventas) }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}
