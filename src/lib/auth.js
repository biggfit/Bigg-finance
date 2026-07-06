// src/lib/auth.js
// Sesión de usuario (atribución, NO barrera de seguridad — el token del GAS viaja
// en el bundle). Se persiste en localStorage: te logueás una vez por navegador y
// quedás logueado hasta "Cerrar sesión". Lo usan Root (gate) y las dos API layers
// (numbersApi/sueldosApi) para estampar `registrado_por` en cada asiento.

const KEY = "bigg_sesion";

// { id, nombre, rol, ts } | null
export function sesionActual() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); }
  catch { return null; }
}

export function setSesion(u) {
  const s = { id: u.id, nombre: u.nombre, rol: u.rol || "", ts: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage lleno / bloqueado */ }
  return s;
}

export function cerrarSesion() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}

// Nombre que se estampa como `registrado_por` en cada write.
export function nombreActual() {
  return sesionActual()?.nombre || "";
}

// Inicial para el avatar (ej. "M" de "Martin").
export function inicial(nombre) {
  return String(nombre || "?").trim().charAt(0).toUpperCase();
}

// Estampa `registrado_por` en el body de un post (add/add_batch) con el usuario logueado,
// sin pisar un valor explícito. Lo usan los post() de numbersApi y sueldosApi.
export function stamp(body) {
  const n = nombreActual();
  if (!n) return body;
  if (body.row) body.row.registrado_por ??= n;
  if (Array.isArray(body.rows)) for (const r of body.rows) if (r) r.registrado_por ??= n;
  return body;
}

// Firma para spread en un patch de edit: { registrado_por } si hay sesión, {} si no.
export const firma = () => { const n = nombreActual(); return n ? { registrado_por: n } : {}; };

// SHA-256 hex de la contraseña (Web Crypto — requiere contexto seguro: https/localhost).
// No es hashing de contraseñas "serio" (sin salt): alcanza para que el string no quede
// visible en la hoja. El hashing robusto va con la auth server-side futura.
export async function hashPassword(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(str)));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
