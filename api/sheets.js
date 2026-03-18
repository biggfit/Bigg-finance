// api/sheets.js — Vercel Serverless Function
//
// Proxea /api/sheets hacia Google Apps Script siguiendo los redirects
// server-side para evitar el bloqueo CORS de cuentas Google Workspace.
//
// Variables de entorno requeridas (Vercel Dashboard → Settings → Environment Variables):
//   VITE_SHEETS_API_URL  →  URL del Apps Script (exec)
//   VITE_SHEETS_TOKEN    →  token secreto (solo lo usa el browser; aquí lo pasamos tal cual)

import { request as httpsRequest } from 'https';

const SHEETS_URL = process.env.VITE_SHEETS_API_URL;

/** Hace la petición HTTPS siguiendo redirects server-side (sin restricciones CORS). */
function proxyToSheets(targetUrl, method, body, res) {
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
      proxyToSheets(upstream.headers.location, 'GET', null, res);
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

  if (body) req.write(body);
  req.end();
}

/** Handler de Vercel — recibe las peticiones del browser y las proxea. */
export default function handler(req, res) {
  if (!SHEETS_URL) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'VITE_SHEETS_API_URL no configurada en Vercel' }));
    return;
  }

  // Preservar la query string (resource=comps&token=...) al redirigir
  const qs     = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const target = SHEETS_URL + qs;

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end',  ()      => { proxyToSheets(target, 'POST', body, res); });
  } else {
    proxyToSheets(target, 'GET', null, res);
  }
}
