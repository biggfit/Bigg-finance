// ─── Transporte HTTP compartido: GET-con-reintento ────────────────────────────
// Las capas de datos que pegan al Apps Script vía proxy (sheetsApi, sueldosApi) comparten
// el mismo problema: el GAS + el proxy devuelven 404/500/HTML de forma INTERMITENTE
// (rate-limit / lock / timeout; algunos fetch pesan cientos de KB y tardan varios segundos).
// Sin reintento, un solo fallo deja el dataset VACÍO en silencio y la pantalla aparece sin datos.
//
// Este helper encapsula SÓLO el transporte (fetch + reintento + parseo tolerante a HTML). NO
// cachea ni deduplica requests en vuelo: eso lo maneja cada capa, que tiene sus propias keys/TTL.
//
// - Lee como texto y parsea a JSON a mano, para poder distinguir un cuerpo de error HTML de un
//   JSON válido (res.json() tiraría un error genérico sin el status/cuerpo).
// - Un rechazo lógico del backend (`data.error`) también reintenta (puede ser transitorio: lock).
// - Backoff lineal: retryDelayMs * nº de intento.
export async function fetchJsonWithRetry(url, { retries = 3, retryDelayMs = 1000, init, parseErr } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, retryDelayMs * attempt));
    try {
      const res  = await fetch(url, init);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch {
        throw new Error(parseErr ? parseErr(res.status, text) : `HTTP ${res.status}: ${String(text).slice(0, 120)}`);
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
