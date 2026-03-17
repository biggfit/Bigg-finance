// api/bigg-eye.js — Vercel Serverless Function
//
// Obtiene las ventas mensuales de una sede desde la API de Bigg Eye.
//
// Query params requeridos:
//   location_id  — ID de la sede en Bigg Eye (número)
//   month        — mes 1-12
//   year         — año (ej: 2026)
//
// Devuelve:
//   { ventas: number }  — suma de total_sales del mes para esa sede
//   { error: string }   — si algo falla

const BIGG_EYE_API = "https://api.bigg.fit";
const TOKEN        = process.env.BIGG_EYE_TOKEN;

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

  // Calcular start / end del mes
  const pad   = (n) => String(n).padStart(2, "0");
  const start = `${yr}-${pad(mo)}-01`;
  // Último día del mes: día 0 del mes siguiente
  const lastDay = new Date(yr, mo, 0).getDate();
  const end     = `${yr}-${pad(mo)}-${pad(lastDay)}`;

  try {
    const url = `${BIGG_EYE_API}/sales?start=${start}&end=${end}&location_id=${locId}`;

    const response = await fetch(url, {
      headers: {
        Accept:        "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      res.statusCode = response.status;
      res.end(JSON.stringify({ error: `API error ${response.status}: ${text.slice(0, 200)}` }));
      return;
    }

    const data = await response.json();

    // La respuesta es un array de ventas; cada objeto tiene:
    //   total      — importe cobrado (ya con descuento aplicado)
    //   currency   — "ARS" | "USD" | etc.
    // Sumamos `total` de todos los registros del período.
    let ventas = 0;
    if (Array.isArray(data)) {
      for (const row of data) {
        ventas += parseFloat(row.total ?? 0) || 0;
      }
    } else if (typeof data === "object" && data !== null) {
      ventas = parseFloat(data.total ?? data.total_sales ?? 0) || 0;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ ventas: Math.round(ventas) }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}
