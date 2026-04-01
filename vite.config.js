import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { request as httpsRequest } from 'https'
import fs from 'fs'

// Lee el .env.local antes de que Vite cargue sus propias vars
function readEnvLocal() {
  const vars = {};
  try {
    const lines = fs.readFileSync('.env.local', 'utf8').split('\n');
    for (const line of lines) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        if (key && !key.startsWith('#')) vars[key] = val;
      }
    }
  } catch {}
  return vars;
}

const localEnv  = readEnvLocal();
const sheetsUrl = localEnv['VITE_SHEETS_API_URL'];

// Inyectar todas las vars de .env.local en process.env para que los handlers
// de /api/* (que corren en Node dentro de Vite) puedan leerlas con process.env
Object.entries(localEnv).forEach(([k, v]) => {
  if (process.env[k] == null) process.env[k] = v;
});

// Proxy server-side que sigue los redirects de Google Apps Script
// (evita el bloqueo CORS que ocurre cuando el browser intenta seguirlos)
function proxyToSheets(targetUrl, method, body, res) {
  let url;
  try { url = new URL(targetUrl); } catch(e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Invalid redirect URL: ' + targetUrl }));
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
    // Seguir redirect (302) server-side — evita el problema de CORS en Workspace
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
      proxyToSheets(upstream.headers.location, 'GET', null, res);
      return;
    }
    res.setHeader('Content-Type', 'application/json');
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

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'sheets-proxy',
      configureServer(server) {
        if (!sheetsUrl) {
          console.log('[sheets-proxy] VITE_SHEETS_API_URL no encontrada — proxy desactivado');
          return;
        }
        console.log('[sheets-proxy] Proxy activo →', sheetsUrl);

        // Sin path en use() para evitar problemas de matching en connect/Vite 7
        server.middlewares.use((req, res, next) => {
          // ── Proxy /api/facturante → serverless handler local ──────────────
          if (req.url && req.url.startsWith('/api/facturante')) {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              import('./api/facturante.js').then(mod => {
                const mockReq = Object.assign(Object.create(req), {
                  on: (ev, cb) => { if (ev === 'data') cb(body); if (ev === 'end') cb(); return mockReq; },
                });
                let sent = false;
                const fakeRes = {
                  statusCode: 200,
                  setHeader: () => {},
                  end: (responseBody) => {
                    if (sent) return; sent = true;
                    res.setHeader('Content-Type', 'application/json');
                    res.statusCode = fakeRes.statusCode;
                    res.end(responseBody);
                  },
                };
                mod.default(mockReq, fakeRes).catch(err => {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                });
              }).catch(err => {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              });
            });
            return;
          }

          // ── Proxy /api/bigg-eye → MCP server de Bigg Eye ──────────────────
          if (req.url && req.url.startsWith('/api/bigg-eye')) {
            // En dev, importar y ejecutar el handler directamente
            import('./api/bigg-eye.js').then(mod => {
              // Parsear query string manualmente
              const urlObj = new URL('http://localhost' + req.url);
              const fakeReq = { query: Object.fromEntries(urlObj.searchParams), url: req.url, method: req.method };
              const chunks = [];
              let statusCode = 200;
              const fakeRes = {
                setHeader: () => {},
                statusCode: 200,
                end: (body) => {
                  res.setHeader('Content-Type', 'application/json');
                  res.statusCode = fakeRes.statusCode;
                  res.end(body);
                },
              };
              mod.default(fakeReq, fakeRes).catch(err => {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              });
            }).catch(err => {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            });
            return;
          }

          if (!req.url || !req.url.startsWith('/api/sheets')) {
            next();
            return;
          }
          console.log('[sheets-proxy] interceptado:', req.method, req.url);

          // Query string: req.url = "?resource=comps&token=..." (connect ya strippeó el prefix si usáramos path)
          // Pero aquí req.url = "/api/sheets?resource=..." así que lo sacamos:
          const qs     = req.url.replace('/api/sheets', '');
          const target = sheetsUrl + qs;

          if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end',  () => { proxyToSheets(target, 'POST', body, res); });
          } else {
            proxyToSheets(target, 'GET', null, res);
          }
        });
      },
    },
  ],
});
