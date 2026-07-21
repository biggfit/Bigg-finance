// api/mercadopago.js — Vercel Serverless Function
//
// Saldo EN VIVO de una cuenta de Mercado Pago (visibilidad de caja durante el mes).
// v1 READ-ONLY: solo consulta el balance del comercio (disponible + a liberar). No emite pagos ni transferencias.
//
// Query params:
//   sociedad — id de sociedad (nako | hektor | ...) → elige el token de esa cuenta MP
//
// Token (server-only, NUNCA con prefijo VITE → no viaja al bundle):
//   MP_ACCESS_TOKEN_<SOCIEDAD>  (ej. MP_ACCESS_TOKEN_NAKO / _HEKTOR) — uno por cuenta MP
//   MP_ACCESS_TOKEN             — fallback si no hay uno por sociedad
//   Es el Access Token de PRODUCCIÓN del propio comercio (MP → Credenciales de producción).
//
// Devuelve:
//   { disponible, a_liberar, moneda, _source }   ·   { error } si algo falla
//
// Nota: el Access Token puede crear pagos/refunds (mueve plata) pero NO permite retirar el saldo por API
// (MP no expone cash-out). Este endpoint solo LEE el balance.

const MP_API = "https://api.mercadopago.com";

async function mpGet(path, token) {
  const res = await fetch(`${MP_API}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* deja data en null */ }
  return { ok: res.ok, status: res.status, data, raw: text.slice(0, 200) };
}

// El env var name no admite guiones → sanitizar la sociedad (segui-fit → SEGUI_FIT).
function tokenDeSociedad(sociedad) {
  const key = String(sociedad || "").toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return (key && process.env[`MP_ACCESS_TOKEN_${key}`]) || process.env.MP_ACCESS_TOKEN || null;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { sociedad } = req.query;
  const token = tokenDeSociedad(sociedad);   // leído por request (evita caching de env)
  if (!token) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: `MP_ACCESS_TOKEN${sociedad ? "_" + String(sociedad).toUpperCase() : ""} no configurado` }));
    return;
  }

  try {
    // 1) user_id del token (necesario para el endpoint clásico de balance)
    const me = await mpGet("/users/me", token);
    if (!me.ok || !me.data?.id) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: `MP /users/me falló (${me.status}): ${me.raw}` }));
      return;
    }
    const userId = me.data.id;

    // 2) balance — endpoint clásico; si no responde, fallback a /v1/account/balance
    let bal = await mpGet(`/users/${userId}/mercadopago_account/balance`, token);
    let source = "mercadopago_account/balance";
    if (!bal.ok || bal.data == null) {
      bal = await mpGet(`/v1/account/balance`, token);
      source = "v1/account/balance";
    }
    if (!bal.ok || bal.data == null) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: `MP balance falló (${bal.status}): ${bal.raw}` }));
      return;
    }

    const d = bal.data;
    const num = (v) => Number(v) || 0;
    res.statusCode = 200;
    res.end(JSON.stringify({
      disponible: num(d.available_balance),
      a_liberar:  num(d.unavailable_balance),
      moneda:     d.currency_id || "ARS",
      _source:    source,
    }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}
