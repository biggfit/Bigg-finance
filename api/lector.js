// api/lector.js — Vercel Serverless Function
//
// Proxea /api/lector hacia el Apps Script "BIGG Lector de Correo" de la casilla que se pida
// (apps-script-lector-correo.gs: un proyecto por casilla, corre dentro de pagos.es@ / pagos@).
// Sigue los redirects server-side igual que api/numbers.js. Sin caché: cada click es una corrida.
//
// Query: ?buzon=es|ar&accion=leer|estado|reset&token=...   (`buzon` elige la URL; el resto pasa tal cual)
//
// Variables de entorno (Vercel Dashboard → Settings → Environment Variables):
//   VITE_LECTOR_ES_URL  →  URL /exec del Apps Script del lector en pagos.es@bigg.fit
//   VITE_LECTOR_AR_URL  →  (cuando exista) URL /exec del lector en pagos@bigg.fit

import { request as httpsRequest } from 'https';

const URLS = { es: process.env.VITE_LECTOR_ES_URL, ar: process.env.VITE_LECTOR_AR_URL };

function proxy(targetUrl, res) {
  let url;
  try { url = new URL(targetUrl); } catch {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'URL inválida: ' + targetUrl }));
    return;
  }
  const req = httpsRequest({ hostname: url.hostname, path: url.pathname + url.search, method: 'GET', headers: {} }, (upstream) => {
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
      proxy(upstream.headers.location, res);
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = upstream.statusCode;
    upstream.pipe(res);
  });
  req.on('error', (err) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  });
  req.end();
}

export default function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const buzon = u.searchParams.get('buzon') || 'es';
  const base = URLS[buzon];
  if (!base) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: `Lector del buzón "${buzon}" no configurado (falta VITE_LECTOR_${buzon.toUpperCase()}_URL en Vercel)` }));
    return;
  }
  u.searchParams.delete('buzon');
  proxy(base + u.search, res);
}
