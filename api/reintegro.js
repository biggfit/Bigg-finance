// api/reintegro.js — Vercel Serverless Function
//
// Proxea /api/reintegro hacia el Apps Script "BIGG Reintegros" (apps-script-reintegro.gs):
// el formulario público de reintegro (link personal permanente, sin login). Sigue los redirects
// server-side igual que api/monotributo.js. Sin caché: cada lectura ve la carga recién hecha.
//
// Variable de entorno (Vercel Dashboard → Settings → Environment Variables):
//   VITE_REINTEGRO_API_URL  →  URL /exec del Apps Script BIGG Reintegros
//
// Límite de Vercel: 4,5 MB por request → la página comprime fotos y limita los PDF a 3 MB.

import { request as httpsRequest } from 'https';

const REINT_URL = process.env.VITE_REINTEGRO_API_URL;

function proxy(targetUrl, method, body, res) {
  let url;
  try { url = new URL(targetUrl); } catch {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'URL inválida: ' + targetUrl }));
    return;
  }
  const req = httpsRequest({
    hostname: url.hostname,
    path:     url.pathname + url.search,
    method,
    headers:  method === 'POST'
      ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body || '') }
      : {},
  }, (upstream) => {
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
      proxy(upstream.headers.location, 'GET', null, res);
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

export default function handler(req, res) {
  if (!REINT_URL) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'VITE_REINTEGRO_API_URL no configurada' }));
    return;
  }
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end',  () => { proxy(REINT_URL + qs, 'POST', body, res); });
  } else {
    proxy(REINT_URL + qs, 'GET', null, res);
  }
}
