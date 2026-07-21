// api/mercadopago.js — Vercel Serverless Function
//
// Visibilidad EN VIVO de Mercado Pago (READ-ONLY): "neto a acreditarse" = plata cobrada que todavía
// NO se liberó (money_release_date futuro). Da una mejor referencia de lo que hay/entra en la caja MP
// durante el mes (los cashouts MP→banco ya se ven por el extracto de Galicia; esto suma lo que falta ver).
//
// Por qué NO el saldo disponible: MP no expone el balance de la cuenta por API (endpoint 403/legacy).
// Lo accesible con el Access Token del comercio es /payments/search → de ahí derivamos lo a acreditarse.
//
// Query params:
//   sociedad — id de sociedad (nako | hektor | ...) → elige el token de esa cuenta MP
//   dias     — ventana futura de liberación a sumar (default 30)
//
// Token (server-only, NUNCA con prefijo VITE): MP_ACCESS_TOKEN_<SOCIEDAD> (fallback MP_ACCESS_TOKEN).
//   Access Token de PRODUCCIÓN del propio comercio. Solo se LEE (no emite pagos ni transferencias).
//
// Devuelve: { a_acreditarse, moneda, proximos:[{fecha, monto}], count, _source } · { error } si falla.

const MP_API = "https://api.mercadopago.com";

function isoAR(d) {
  // ISO con offset AR (-03:00), formato que acepta el search de MP.
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.000-03:00`;
}

function tokenDeSociedad(sociedad) {
  const key = String(sociedad || "").toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return (key && process.env[`MP_ACCESS_TOKEN_${key}`]) || process.env.MP_ACCESS_TOKEN || null;
}

async function mpSearch(qs, token) {
  const res = await fetch(`${MP_API}/v1/payments/search?${qs}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { /* noop */ }
  return { ok: res.ok, status: res.status, data, raw: text.slice(0, 200) };
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { sociedad, dias } = req.query;
  const token = tokenDeSociedad(sociedad);
  if (!token) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: `MP_ACCESS_TOKEN${sociedad ? "_" + String(sociedad).toUpperCase() : ""} no configurado` }));
    return;
  }

  const ventana = Math.max(1, Math.min(120, Number(dias) || 30));
  const ahora  = new Date();
  const inicio = new Date(ahora.getFullYear(), ahora.getMonth(), 1);        // 1° del mes en curso
  const hasta  = new Date(ahora.getTime() + ventana * 86400000);            // + ventana futura
  const begin = encodeURIComponent(isoAR(inicio));
  const end   = encodeURIComponent(isoAR(hasta));
  const nowMs = ahora.getTime();
  const inicioMs = inicio.getTime();
  // Una sola pasada por money_release_date [1° del mes → hoy+ventana]; separamos acreditado (liberado ≤ hoy)
  // de a_acreditarse (liberación futura). El acreditado del mes es la plata que ya entró y todavía NO está
  // en Numbers (se concilia a fin de mes) → explica por qué la caja MP da negativa (los cashouts sí están).
  // OJO doble conteo: las ventas de meses ANTERIORES que recién se liberan este mes ya están en el saldo de
  // apertura (que incluye "a liquidar") → se excluyen del acreditado por date_approved < 1° del mes.
  const base = `status=approved&range=money_release_date&begin_date=${begin}&end_date=${end}&sort=money_release_date&criteria=asc`;

  try {
    const LIMIT = 100, MAX_PAGES = 60;   // backstop: 6000 cobros
    let offset = 0, total = Infinity, count = 0, acreditado = 0, aAcreditarse = 0, moneda = "ARS", truncado = false;
    let acreditadoMesAnterior = 0;   // ventas previas liberadas este mes (ya en la apertura, informativo)
    const porFecha = new Map();

    for (let page = 0; page < MAX_PAGES && offset < total; page++) {
      const r = await mpSearch(`${base}&limit=${LIMIT}&offset=${offset}`, token);
      if (!r.ok || !r.data) {
        if (page === 0) { res.statusCode = 502; res.end(JSON.stringify({ error: `MP payments/search falló (${r.status}): ${r.raw}` })); return; }
        break;
      }
      total = r.data.paging?.total ?? 0;
      const rows = r.data.results || [];
      for (const p of rows) {
        const neto = Number(p?.transaction_details?.net_received_amount) || Number(p?.transaction_amount) || 0;
        count += 1;
        if (p.currency_id) moneda = p.currency_id;
        const rel = p.money_release_date ? new Date(p.money_release_date).getTime() : 0;
        const app = p.date_approved ? new Date(p.date_approved).getTime() : 0;
        if (rel && rel > nowMs) {
          aAcreditarse += neto;
          const fecha = String(p.money_release_date).slice(0, 10);
          porFecha.set(fecha, (porFecha.get(fecha) || 0) + neto);   // agenda futura (Dashboard/flujo)
        } else if (app && app < inicioMs) {
          acreditadoMesAnterior += neto;   // venta previa liberada este mes → ya está en la apertura, NO sumar
        } else {
          acreditado += neto;   // vendido y liberado este mes = plata nueva que no está en Numbers
        }
      }
      offset += LIMIT;
      if (rows.length < LIMIT) break;
      if (page === MAX_PAGES - 1 && offset < total) truncado = true;
    }

    const proximos = [...porFecha.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fecha, monto]) => ({ fecha, monto: Math.round(monto) }));

    res.statusCode = 200;
    res.end(JSON.stringify({
      acreditado:    Math.round(acreditado),      // vendido Y liberado este mes = plata nueva que falta en Numbers
      a_acreditarse: Math.round(aAcreditarse),     // por liberarse (futuro)
      acreditado_mes_anterior: Math.round(acreditadoMesAnterior),  // ventas previas liberadas este mes (ya en la apertura)
      moneda,
      proximos,
      count,
      ...(truncado && { truncado: true }),         // hubo más cobros que el tope de páginas
      _source: `payments/search · release [1°mes, hoy+${ventana}d] · acreditado=venta≥1°mes`,
    }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  }
}
