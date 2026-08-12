// Cache-bust compartido — saltea la caché de borde (CDN de Vercel) cuando se necesita dato fresco.
//
// El proxy (api/*.js) le pone `Cache-Control: s-maxage` a las respuestas GET, así que el CDN de
// Vercel comparte cada lectura entre TODO el equipo (mismo token → misma URL → misma entrada). Eso
// hace que abrir una pantalla no le pegue N veces al Apps Script. La contra: un cambio recién
// guardado podría no verse hasta que la entrada del borde expire.
//
// Para eso está la "ventana de refresco": tras una escritura (post) o al tocar "Actualizar" se abre
// una ventana corta durante la cual ESTE navegador le agrega un token único a cada GET → el borde
// falla el match → pide directo al origen (GAS) → dato fresco. Pasada la ventana, vuelve a compartir
// la caché rápida con el resto del equipo. El token es estable DENTRO de la ventana, así que las
// ~10 lecturas que dispara una pantalla comparten una sola entrada mientras dura.
const KEY = "bigg_bust_until";

/** Token para saltar el borde, o "" si la ventana de refresco ya expiró. Estable dentro de la ventana. */
export function bustToken() {
  try {
    const until = Number(localStorage.getItem(KEY) || 0);
    return Date.now() < until ? String(until) : "";
  } catch { return ""; }
}

/** Abre una ventana de refresco: durante `ms` este navegador saltea la caché de borde. */
export function forzarRefresco(ms = 6000) {
  try { localStorage.setItem(KEY, String(Date.now() + ms)); } catch {}
}
