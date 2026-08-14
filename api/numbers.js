// api/numbers.js — Vercel Serverless Function
//
// Proxea /api/numbers hacia Google Apps Script siguiendo los redirects
// server-side para evitar el bloqueo CORS de cuentas Google Workspace.
//
// Variables de entorno requeridas (Vercel Dashboard → Settings → Environment Variables):
//   VITE_NUMBERS_API_URL  →  URL del Apps Script de BIGG Numbers (exec)
//   VITE_SHEETS_TOKEN     →  token secreto

import { request as httpsRequest } from 'https';

const NUMBERS_URL = process.env.VITE_NUMBERS_API_URL;

/** Hace la petición HTTPS siguiendo redirects server-side (sin restricciones CORS).
 *  `cacheable` = la petición ORIGINAL fue GET (un POST redirige a GET internamente, pero su
 *  resultado NUNCA debe cachearse) → se propaga tal cual a través del redirect. */
function proxyToSheets(targetUrl, method, body, res, cacheable) {
  let url;
  try { url = new URL(targetUrl); } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'URL inválida: ' + targetUrl }));
    return;
  }

  const options = {
    hostname: url.hostname,
    path:     url.pathname + url.search,
    method,
    headers:  method === 'POST'
      ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body || '') }
      : {},
  };

  const req = httpsRequest(options, (upstream) => {
    // Seguir redirect 302 server-side
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
      proxyToSheets(upstream.headers.location, 'GET', null, res, cacheable);
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = upstream.statusCode;
    // Caché de borde (CDN Vercel): comparte la lectura entre todo el equipo por 30s. Solo GET 200
    // (nunca POST, redirects ni errores — cachear un 500/error rompería el reintento del cliente).
    res.setHeader('Cache-Control',
      cacheable && upstream.statusCode === 200
        ? 'public, s-maxage=30, stale-while-revalidate=60'
        : 'no-store');
    upstream.pipe(res);
  });

  req.on('error', (err) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  });

  if (body) req.write(body);
  req.end();
}

/** Handler de Vercel — recibe las peticiones del browser y las proxea. */
export default function handler(req, res) {
  if (!NUMBERS_URL) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'VITE_NUMBERS_API_URL no configurada en Vercel' }));
    return;
  }

  // Preservar la query string (resource=...&token=...) al redirigir
  const qs     = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const target = NUMBERS_URL + qs;

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end',  ()      => { proxyToSheets(target, 'POST', body, res, false); });
  } else {
    proxyToSheets(target, 'GET', null, res, true);
  }
}
