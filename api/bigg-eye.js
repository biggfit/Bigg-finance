// api/bigg-eye.js — Vercel Serverless Function
//
// Obtiene las ventas netas mensuales de una sede desde la API de Bigg Eye.
// Lógica: GET /sales (suma `total`) − GET /credit_notes (suma `amount`)
//
// Query params requeridos:
//   location_id  — ID de la sede en Bigg Eye (número)
//   month        — mes 1-12
//   year         — año (ej: 2026)
//
// Devuelve:
//   { ventas: number, sales_total: number, credits_total: number, count: number, items: [...] }
//   { error: string }   — si algo falla

const BIGG_EYE_API = "https://api.bigg.fit";
const TOKEN        = process.env.BIGG_EYE_TOKEN;

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept:        "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Descarga todas las páginas de un endpoint paginado de Bigg Eye.
 * Asume que la respuesta tiene { data: [], next_page_url: string|null }
 * o bien devuelve un array directamente (no paginado).
 */
async function fetchAllPages(baseUrl) {
  const first = await fetchJson(baseUrl);

  // Si la respuesta es un array plano → no pagina
  if (Array.isArray(first)) return first;

  // Formato paginado Laravel: { data, next_page_url, ... }
  const rows = [...(first.data ?? [])];
  let nextUrl = first.next_page_url ?? null;
  while (nextUrl) {
    const page = await fetchJson(nextUrl);
    rows.push(...(page.data ?? []));
    nextUrl = page.next_page_url ?? null;
  }
  return rows;
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

  if (!TOKEN) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "BIGG_EYE_TOKEN no configurado" }));
    return;
  }

  // Rango del mes
  const pad     = (n) => String(n).padStart(2, "0");
  const start   = `${yr}-${pad(mo)}-01`;
  const lastDay = new Date(yr, mo, 0).getDate();
  const end     = `${yr}-${pad(mo)}-${pad(lastDay)}`;
  const qs      = `start=${start}&end=${end}&location_id=${locId}`;

  try {
    // Llamadas en paralelo: ventas y credit notes (con soporte de paginación)
    const [salesRows, creditsRows] = await Promise.all([
      fetchAllPages(`${BIGG_EYE_API}/sales?${qs}`),
      fetchAllPages(`${BIGG_EYE_API}/credit_notes?${qs}`),
    ]);

    // /sales → sumar campo `total` (precio final después de descuentos)
    const salesTotal = salesRows.reduce((s, r) => s + (parseFloat(r.total) || 0), 0);

    // /credit_notes → restar campo `amount`
    const creditsTotal = creditsRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

    const ventas = salesTotal - creditsTotal;

    // Items filtrados para el frontend (solo campos útiles)
    const items = salesRows.map((row) => ({
      id:            row.id,
      date:          row.created_at?.slice(0, 10) ?? null,
      customer:      row.customer_name ?? null,
      description:   row.description  ?? null,
      amount:        parseFloat(row.amount  ?? 0) || 0,
      discount:      parseFloat(row.discount_amount ?? 0) || 0,
      total:         parseFloat(row.total   ?? 0) || 0,
      currency:      row.currency ?? "ARS",
      is_debit:      row.is_debit !== false,
      full_refunded: row.full_refunded ?? false,
    }));

    res.statusCode = 200;
    res.end(JSON.stringify({
      ventas:        Math.round(ventas),
      sales_total:   Math.round(salesTotal),
      credits_total: Math.round(creditsTotal),
      count:         salesRows.length,
      items,
    }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}
