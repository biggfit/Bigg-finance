// api/bigg-eye-whatsapp.js — Vercel Serverless Function
//
// Costo mensual del servicio de WhatsApp del CRM por sede, para el lote "CRM WhatsApp" del
// Facturador de Franquicias (src/tabs/ModoCrmWhatsapp.jsx). Fuente: reporte 29 de BIGG Eye,
// "Consumo WhatsApp por franquicia" (el mismo de bigg-eye.vercel.app/reports), vía
// GET /report_json/29/?start_date&end_date — misma ruta y token que horas (12) y CDP (20).
// El reporte ya viene agregado por sede para toda la cuenta: UNA llamada por mes, sin location_id.
//
// Por sede devuelve dos importes en USD:
//   · franchise_charge_usd → "Cobro franquicia": lo que se le factura a la sede (null = no tiene el servicio).
//   · estimated_cost_usd   → "Costo estimado": prorrateo del costo real de Twilio/Meta (referencia, no se factura).
//
// Contrato:
//   GET /api/bigg-eye-whatsapp?month=1-12&year=YYYY
//   → 200 { costos: { "<location_id>": <cobro_usd> }, detalle: { "<location_id>": { nombre, categoria, cobro, costoEstimado } },
//           totales: { cobro, costoEstimado, sedes }, period: { start_date, end_date } }
//   → { error: string } ante cualquier problema

/* global process */
const BIGG_EYE_API = "https://api.bigg.fit";

async function fetchReport29(start, end, token, { retries = 2, retryDelayMs = 1500 } = {}) {
  const url = `${BIGG_EYE_API}/report_json/29/?start_date=${start}&end_date=${end}`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, retryDelayMs * attempt));
    try {
      const res  = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
      const text = await res.text();
      if (!res.ok) { lastErr = new Error(`BIGG Eye HTTP ${res.status}: ${text.slice(0, 160)}`); continue; }
      try { return JSON.parse(text); }
      catch { lastErr = new Error(`Respuesta no-JSON (${res.status}): ${text.slice(0, 160)}`); }
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("fetch falló sin detalle");
}

// El reporte puede venir como { franchises: [...] } (shape del MCP), envuelto en { data } o como array plano.
function filasDe(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.franchises)) return data.franchises;
  if (Array.isArray(data?.data?.franchises)) return data.data.franchises;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  const TOKEN = process.env.BIGG_EYE_TOKEN;   // en cada request, no a nivel de módulo (evita caching)
  const { month, year } = req.query || {};
  const mo = Number(month), yr = Number(year);
  if (!month || !year || isNaN(mo) || isNaN(yr) || mo < 1 || mo > 12) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Faltan parámetros: month (1-12) y year" }));
    return;
  }
  if (!TOKEN) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "BIGG_EYE_TOKEN no configurado" }));
    return;
  }

  const pad     = n => String(n).padStart(2, "0");
  const start   = `${yr}-${pad(mo)}-01`;
  const lastDay = new Date(yr, mo, 0).getDate();
  const end     = `${yr}-${pad(mo)}-${pad(lastDay)}`;

  try {
    const data  = await fetchReport29(start, end, TOKEN);
    const filas = filasDe(data);
    const costos = {}, detalle = {};
    let totCobro = 0, totCosto = 0, sedes = 0;
    for (const f of filas) {
      const id = f.location_id ?? f.locationId ?? f.id;
      if (id == null) continue;
      const cobro = Number(f.franchise_charge_usd ?? f.franchise_charge ?? 0) || 0;
      const costo = Number(f.estimated_cost_usd  ?? f.estimated_cost  ?? 0) || 0;
      detalle[String(id)] = { nombre: f.location_name ?? "", categoria: f.category ?? "", cobro, costoEstimado: costo };
      totCosto += costo;
      if (cobro > 0) { costos[String(id)] = cobro; totCobro += cobro; sedes++; }
    }
    res.statusCode = 200;
    res.end(JSON.stringify({
      costos, detalle,
      totales: { cobro: Math.round(totCobro * 100) / 100, costoEstimado: Math.round(totCosto * 100) / 100, sedes },
      period: { start_date: start, end_date: end },
      _raw_totals: data?.totals ?? null,
    }));
  } catch (err) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: `No se pudo leer el reporte de WhatsApp de BIGG Eye: ${err.message}` }));
  }
}
