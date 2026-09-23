import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { request as httpsRequest } from 'https'
import { pathToFileURL } from 'url'
import path from 'path'
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

const localEnv   = readEnvLocal();
const sheetsUrl  = localEnv['VITE_SHEETS_API_URL'];
const numbersUrl = localEnv['VITE_NUMBERS_API_URL'];
const sueldosUrl = localEnv['VITE_SUELDOS_API_URL'];

// Inyectar todas las vars de .env.local en process.env para que los handlers
// de /api/* (que corren en Node dentro de Vite) puedan leerlas con process.env
Object.entries(localEnv).forEach(([k, v]) => {
  if (process.env[k] == null) process.env[k] = v;
});

// ─── Caché de lecturas en DEV (paridad con el borde de Vercel) ───────────────
// En producción los handlers de /api/*.js le ponen `Cache-Control: s-maxage=30,
// stale-while-revalidate=60` a las respuestas GET, así el CDN de Vercel comparte cada lectura
// entre todo el equipo y abrir una pantalla casi nunca toca Google. En dev no hay CDN: cada
// navegación disparaba sus ~10 lecturas directo al Apps Script, que las serializa a 3-4 s cada
// una (ver getMulti en numbersApi.js) → la app tardaba decenas de segundos en levantar.
//
// Esto replica ese borde en memoria, dentro del dev server. El BYPASS es el mismo que en prod: el
// front le agrega `_cb` a cada GET durante la ventana de refresco que abre al guardar algo o al
// tocar "Actualizar" (src/lib/cacheBust.js) → esas lecturas saltean la caché y van al origen. Un
// POST además limpia todo, porque acaba de cambiar el dato.
//
// Solo GET 200 y solo respuestas sin `error` (cachear un fallo rompería el reintento del cliente).
// Vive en el proceso del dev server: se pierde al reiniciarlo, que es lo que uno espera.
// TTL de 5 min, no los 30 s del borde: en prod el CDN lo comparte todo un equipo y revalida por
// atrás (stale-while-revalidate), acá estás solo y una carga fría tarda más que eso — con 30 s las
// primeras hojas ya habrían expirado antes de que terminen de llegar las últimas. Es seguro porque
// toda escritura limpia la caché y "Actualizar" la saltea; el front ya usa 90 s / 10 min por su lado.
const DEV_CACHE_TTL   = 300_000;
const DEV_CACHE_BYTES = 128 * 1024 * 1024;   // techo de memoria (nb_movimientos solo pesa ~3 MB)
const devCache = new Map();                  // url completa → { body: Buffer, ts }
let devCacheBytes = 0;

function devCacheDel(k) {
  const v = devCache.get(k);
  if (v) { devCacheBytes -= v.body.length; devCache.delete(k); }
}

function devCacheGet(key) {
  const hit = devCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > DEV_CACHE_TTL) { devCacheDel(key); return null; }
  return hit.body;
}

function devCacheSet(key, body) {
  for (const [k, v] of devCache) if (Date.now() - v.ts > DEV_CACHE_TTL) devCacheDel(k);
  devCacheDel(key);
  devCache.set(key, { body, ts: Date.now() });
  devCacheBytes += body.length;
  // FIFO hasta volver bajo el techo (Map itera en orden de inserción → sale la más vieja)
  while (devCacheBytes > DEV_CACHE_BYTES && devCache.size > 1) devCacheDel(devCache.keys().next().value);
}

function devCacheClear() { devCache.clear(); devCacheBytes = 0; }

// ¿Esta lectura puede salir de caché? GET sin el cache-bust del front.
const devCacheable = (req, target) => req.method !== 'POST' && !target.includes('_cb=');

// Nombre legible para el log: "nb_movimientos", "__multi(nb_cuentas+3)" o la query cruda.
function etiquetaRecurso(qs) {
  try {
    const p = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);
    const r = p.get('resource') || qs;
    if (r !== '__multi') return r;
    const spec = JSON.parse(p.get('spec') || '[]');
    return spec.length ? `__multi(${spec[0].r}${spec.length > 1 ? `+${spec.length - 1}` : ''})` : '__multi';
  } catch { return qs; }
}

// Sirve la respuesta cacheada si la hay. Devuelve true si ya respondió.
function serveFromDevCache(target, res, etiqueta) {
  const body = devCacheGet(target);
  if (!body) return false;
  console.log(`[dev-cache] ⚡ ${etiqueta} (${Math.round(body.length / 1024)} KB, sin tocar Google)`);
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  res.end(body);
  return true;
}

// Proxy server-side que sigue los redirects de Google Apps Script
// (evita el bloqueo CORS que ocurre cuando el browser intenta seguirlos)
// `cacheKey` (opcional) = url a cachear si la respuesta es un GET 200 sin `error`; se propaga a
// través del redirect 302, igual que `cacheable` en api/numbers.js.
function proxyToSheets(targetUrl, method, body, res, cacheKey = null) {
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
    rejectUnauthorized: false,
  };

  const req = httpsRequest(options, (upstream) => {
    // Seguir redirect (302) server-side — Google Apps Script requiere GET en el redirect
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
      proxyToSheets(upstream.headers.location, 'GET', null, res, cacheKey);
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = upstream.statusCode;
    if (!cacheKey) { upstream.pipe(res); return; }
    // Con caché: hay que juntar el cuerpo para poder guardarlo (en vez de pipearlo al vuelo).
    const chunks = [];
    upstream.on('data', c => chunks.push(c));
    upstream.on('end', () => {
      const buf = Buffer.concat(chunks);
      // No cachear errores: el GAS devuelve 200 con {"error": "..."} y guardarlo dejaría la pantalla
      // rota durante todo el TTL, además de romper el reintento del cliente.
      let esError = upstream.statusCode !== 200;
      if (!esError) { try { esError = !!JSON.parse(buf.toString('utf8')).error; } catch { /* array de filas */ } }
      if (!esError) devCacheSet(cacheKey, buf);
      res.end(buf);
    });
    upstream.on('error', () => res.end(Buffer.concat(chunks)));
  });

  req.on('error', (err) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  });

  if (body) req.write(body);
  req.end();
}

export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
  },
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
        console.log(`[dev-cache] Caché de lecturas activa (${DEV_CACHE_TTL / 1000}s) — replica el borde de Vercel. "Actualizar" y las escrituras la saltean.`);

        // Sin path en use() para evitar problemas de matching en connect/Vite 7
        // ── Proxy /api/numbers → Apps Script BIGG Numbers ────────────────
        if (numbersUrl) {
          console.log('[numbers-proxy] Proxy activo →', numbersUrl);
          server.middlewares.use((req, res, next) => {
            if (!req.url || !req.url.startsWith('/api/numbers')) { next(); return; }
            const qs     = req.url.replace('/api/numbers', '');
            const target = numbersUrl + qs;
            if (req.method === 'POST') {
              devCacheClear();   // se escribió: lo cacheado ya no vale
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end',  () => { proxyToSheets(target, 'POST', body, res); });
            } else {
              const cacheable = devCacheable(req, target);
              if (cacheable && serveFromDevCache(target, res, etiquetaRecurso(qs))) return;
              proxyToSheets(target, 'GET', null, res, cacheable ? target : null);
            }
          });
        }

        // ── Proxy /api/sueldos → Apps Script BIGG Sueldos ────────────────
        if (sueldosUrl) {
          console.log('[sueldos-proxy] Proxy activo →', sueldosUrl);
          server.middlewares.use((req, res, next) => {
            if (!req.url || !req.url.startsWith('/api/sueldos')) { next(); return; }
            const qs     = req.url.replace('/api/sueldos', '');
            const target = sueldosUrl + qs;
            if (req.method === 'POST') {
              devCacheClear();
              let body = '';
              req.on('data', chunk => { body += chunk; });
              req.on('end',  () => { proxyToSheets(target, 'POST', body, res); });
            } else {
              const cacheable = devCacheable(req, target);
              if (cacheable && serveFromDevCache(target, res, etiquetaRecurso(qs))) return;
              proxyToSheets(target, 'GET', null, res, cacheable ? target : null);
            }
          });
        }

        server.middlewares.use((req, res, next) => {
          // ── Proxy /api/facturante → serverless handler local ──────────────
          if (req.url && req.url.startsWith('/api/facturante')) {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              const facturanteUrl = pathToFileURL(path.join(server.config.root, 'api/facturante.js')).href + `?t=${Date.now()}`;
              import(facturanteUrl).then(mod => {
                const mockReq = Object.assign(Object.create(req), {
                  on: (ev, cb) => { if (ev === 'data') cb(body); if (ev === 'end') cb(); return mockReq; },
                });
                let sent = false;
                let contentType = 'application/json';
                const fakeRes = {
                  statusCode: 200,
                  setHeader: (k, v) => { if (k.toLowerCase() === 'content-type') contentType = v; },
                  end: (responseBody) => {
                    if (sent) return; sent = true;
                    res.setHeader('Content-Type', contentType);
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

          // ── Proxy /api/bigg-eye-* y /api/mercadopago → handlers locales (Node en Vite) ──
          // IMPORTANTE: las rutas más específicas deben ir primero.
          if (req.url && (req.url.startsWith('/api/bigg-eye') || req.url.startsWith('/api/mercadopago'))) {
            const apiFile = req.url.startsWith('/api/mercadopago')
              ? 'api/mercadopago.js'
              : req.url.startsWith('/api/bigg-eye-horas')
              ? 'api/bigg-eye-horas.js'
              : req.url.startsWith('/api/bigg-eye-cdp')
              ? 'api/bigg-eye-cdp.js'
              : 'api/bigg-eye.js';
            // Ruta absoluta + timestamp → fuerza reimport en cada request,
            // así los cambios en /api/*.js se reflejan sin reiniciar el servidor.
            const absUrl = pathToFileURL(path.join(server.config.root, apiFile)).href + `?t=${Date.now()}`;

            import(absUrl).then(mod => {
              const urlObj  = new URL('http://localhost' + req.url);
              const fakeReq = { query: Object.fromEntries(urlObj.searchParams), url: req.url, method: req.method };
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
            devCacheClear();
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end',  () => { proxyToSheets(target, 'POST', body, res); });
          } else {
            const cacheable = devCacheable(req, target);
            if (cacheable && serveFromDevCache(target, res, etiquetaRecurso(qs))) return;
            proxyToSheets(target, 'GET', null, res, cacheable ? target : null);
          }
        });
      },
    },
  ],
});
