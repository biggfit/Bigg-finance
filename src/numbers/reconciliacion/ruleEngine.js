// Motor de reglas de conciliación.
// Dada una línea del extracto, las reglas (nb_banco_reglas) y el maestro de
// proveedores (nb_proveedores), devuelve una "propuesta" de imputación.
//
// Jerarquía de match (de más estable a menos): código de concepto →
// nº de cuenta/suministro → CUIT → alias/glosa. Si ninguna regla pega, se
// intenta reconocer el proveedor por aliasBanco/CUIT. Si nada, queda sin clasificar.

const normTxt = s => String(s ?? "").toLowerCase().trim();
// Para nº de cuenta/CUIT: solo dígitos, sin ceros a la izquierda (el Sheet los come).
const normNum = s => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");

function reglaAplica(r, ctx) {
  if (r.activo === false || r.activo === "false") return false;
  if (r.banco    && ctx.banco    && normTxt(r.banco)    !== normTxt(ctx.banco))    return false;
  if (r.sociedad && ctx.sociedad && normTxt(r.sociedad) !== normTxt(ctx.sociedad)) return false;
  if (r.pais     && ctx.pais     && normTxt(r.pais)     !== normTxt(ctx.pais))     return false;
  return true;
}

function matchRegla(r, linea) {
  const val = String(r.match_valor ?? "").trim();
  if (!val) return false;
  switch (r.match_tipo) {
    case "codigo":
      return normNum(val) === normNum(linea.codigoConcepto) || normNum(val) === normNum(linea.grupoCodigo);
    case "cuenta_servicio": {
      const target = normNum(val);
      return [linea.ley2, linea.ley3, linea.ley4].some(t => normNum(t) === target && target);
    }
    case "cuit":
      return normNum(val) === normNum(linea.ley2 || linea.cuit);
    case "glosa":
      return normTxt(linea.descripcion).includes(normTxt(val));
    case "alias":
      return normTxt(linea.ley1).includes(normTxt(val)) || normTxt(linea.descripcion).includes(normTxt(val));
    default:
      return false;
  }
}

// Reconoce franquiciado(s) por CUIT (Leyenda 2 del extracto) contra el master.
// Un CUIT puede mapear a varias franquicias (multi-sede) → se devuelven todas.
function reconocerFranquiciados(linea, franquicias) {
  const cuit = normNum(linea.ley2 || linea.cuit);
  if (!cuit) return [];
  return (franquicias || []).filter(f => f.activa !== false && normNum(f.cuit) === cuit);
}

// Reconoce una transferencia con una sociedad propia (intercompany) por CUIT (Leyenda 2).
// Requiere `cuit` en nb_sociedades. Devuelve la cuenta destino de esa sociedad (misma moneda).
function reconocerSociedadPropia(linea, sociedades, cuentas, sociedadActual, moneda) {
  const cuit = normNum(linea.ley2 || linea.cuit);
  if (!cuit) return null;
  const soc = (sociedades || []).find(s => normNum(s.cuit) === cuit && String(s.id) !== String(sociedadActual));
  if (!soc) return null;
  const ctas = (cuentas || []).filter(c => String(c.sociedad) === String(soc.id));
  const destino = ctas.find(c => (c.moneda || "ARS") === (moneda || "ARS")) || ctas[0];
  return { cuenta_destino: destino?.id || "", nombre: soc.nombre };
}

// Reconoce el pago de una cuota de financiación (planes AFIP / créditos). Solo débitos.
// Match fuerte por Nº de plan en la glosa/leyendas; si no, por CUIT del acreedor + ventana
// de monto. La cuota se identifica por importe: acepta `total` (en término) o `total_tardio`
// (con resarcitorio) → marca esTardio. cuotasPendientes: lista plana de cuotas pendientes.
export function reconocerCuota(linea, cuotasPendientes, moneda) {
  if (!cuotasPendientes?.length) return null;
  const monto = Math.abs(Number(linea.monto) || 0);
  if (monto <= 0 || (Number(linea.monto) || 0) > 0) return null;   // solo débitos
  const cuit = normNum(linea.ley2 || linea.cuit);
  const hay  = [linea.descripcion, linea.ley1, linea.ley2, linea.ley3, linea.ley4].map(normTxt).join(" ");
  const tol  = Math.max(500, monto * 0.02);
  let best = null;
  for (const c of cuotasPendientes) {
    if (moneda && c.moneda && c.moneda !== moneda) continue;
    const planNum = normNum(c.nro_plan);
    const byPlan  = planNum && planNum.length >= 4 && normNum(hay).includes(planNum);
    const byCuit  = cuit && c.acreedor_cuit && normNum(c.acreedor_cuit) === cuit;
    if (!byPlan && !byCuit) continue;
    const dT   = Math.abs(monto - (Number(c.total) || 0));
    const dTT  = (Number(c.total_tardio) || 0) > 0 ? Math.abs(monto - Number(c.total_tardio)) : Infinity;
    const diff = Math.min(dT, dTT);
    // Ventana de monto: por CUIT es estricta; por Nº de plan es amplia (cuotas variables de
    // crédito) pero NO ilimitada → un débito de $31k con nº de plan en la glosa NO se pega a
    // una cuota de $2,5M (era un impuesto IIBB con "Cuota N°18" en el texto).
    const maxDiff = byPlan ? Math.max(tol, monto * 0.5) : tol;
    if (diff > maxDiff) continue;
    const score = (byPlan ? 0 : 1e9) + diff;         // prioriza match por nº de plan
    if (!best || score < best.score) best = { c, esTardio: dTT < dT, byPlan, score };
  }
  // SIN fallback por monto: sólo se propone una cuota si hay señal real (Nº de plan en la glosa
  // o CUIT en la leyenda). El match por importe suelto era peligroso — un débito ajeno (ej. IIBB
  // del banco de $24.078) coincidía con una cuota de plan de $24.077,83 y proponía consumirla,
  // desordenando el plan. Decisión del usuario: preferir SIN propuesta antes que una que consuma
  // una cuota por error. Si un débito de cuota no trae plan/CUIT, se imputa a mano desde el ⋯.
  if (!best) return null;
  const { c, esTardio, byPlan } = best;
  return {
    regla_id: "", tipo: "cuota_financiacion",
    cuenta_contable: "", centro_costo: "", cuenta_destino: "", proveedor_id: "",
    plan_id: c.plan_id, nro_cuota: c.nro_cuota, cuota_row_id: c.row_id, esTardio,
    accion: "escala",
    motivo: `Cuota ${c.nro_cuota} · ${c.acreedor_nombre || c.nro_plan || "plan"}${esTardio ? " (tardío)" : ""}`,
    confianza: byPlan ? "alta" : "media",
  };
}

function reconocerProveedor(linea, proveedores) {
  const ley1 = normTxt(linea.ley1), desc = normTxt(linea.descripcion), cuit = normNum(linea.ley2 || linea.cuit);
  for (const p of proveedores) {
    if (p.cuit && cuit && normNum(p.cuit) === cuit) return p;
    const alias = String(p.aliasBanco || "").split(";").map(a => normTxt(a)).filter(Boolean);
    if (alias.some(a => a.length >= 3 && (ley1.includes(a) || desc.includes(a)))) return p;
  }
  return null;
}

/**
 * Clasifica una línea. ctx = { banco, sociedad, pais } de la cuenta bancaria.
 * Devuelve { regla_id, tipo, cuenta_contable, centro_costo, cuenta_destino,
 *            proveedor_id, accion, motivo, confianza }.
 */
export function clasificarLinea(linea, reglas, proveedores = [], ctx = {}) {
  const aplicables = (reglas || [])
    .filter(r => reglaAplica(r, ctx))
    .sort((a, b) => (Number(a.prioridad) || 99) - (Number(b.prioridad) || 99));

  for (const r of aplicables) {
    if (matchRegla(r, linea)) {
      // Regla que reconoce un CLIENTE (ej. cobro recurrente de Gympass por glosa) → el crédito
      // es un cobro contra la factura de ese cliente. Siempre escala (el humano elige la/s FC,
      // los montos varían mes a mes). Espeja a `proveedor_id` (que reconoce proveedor → pago).
      const cliente_id = r.cliente_id || "";
      return {
        regla_id: r.id,
        tipo: r.tipo || (cliente_id ? "cobro_cliente" : ""),
        cuenta_contable: r.cuenta_contable || "",
        centro_costo: r.centro_costo || "",
        cuenta_destino: r.cuenta_destino || "",
        proveedor_id: r.proveedor_id || "",
        cliente_id,
        accion: cliente_id ? "escala" : (r.accion || "auto"),
        motivo: `Regla ${r.id} (${r.match_tipo}: ${r.match_valor})`,
        confianza: "alta",
      };
    }
  }

  // Intercompany: CUIT de una sociedad propia → transferencia interna (gana sobre proveedor/franquicia).
  const inter = reconocerSociedadPropia(linea, ctx.sociedades, ctx.cuentas, ctx.sociedad, ctx.moneda);
  if (inter) {
    return {
      regla_id: "", tipo: "transferencia_interna",
      cuenta_contable: "", centro_costo: "", cuenta_destino: inter.cuenta_destino, proveedor_id: "",
      accion: "auto", motivo: `Intercompany: ${inter.nombre}`, confianza: "alta",
    };
  }

  // Cuota de financiación (plan AFIP / crédito): match por Nº de plan o CUIT+monto.
  const cuota = reconocerCuota(linea, ctx.cuotasPendientes, ctx.moneda);
  if (cuota) return cuota;

  // Franquiciado por CUIT (antes que proveedor: un CUIT de franquicia gana).
  const frs = reconocerFranquiciados(linea, ctx.franquicias);
  if (frs.length > 0) {
    return {
      regla_id: "", tipo: "cobro_franquicia",
      cuenta_contable: "", centro_costo: "", cuenta_destino: "", proveedor_id: "",
      franquicia_id: String(frs[0].id),
      franquicia_opciones: frs.map(f => String(f.id)),
      accion: "escala",
      motivo: frs.length === 1 ? `Franquicia: ${frs[0].name}` : `${frs.length} franquicias con ese CUIT`,
      confianza: "alta",
    };
  }

  const prov = reconocerProveedor(linea, proveedores);
  if (prov) {
    return {
      regla_id: "",
      tipo: "pago_proveedor",
      cuenta_contable: prov.cuentaDefault || "",
      centro_costo: prov.ccDefault || "",
      cuenta_destino: "",
      proveedor_id: prov.id,
      accion: "escala", // necesita confirmar/matchear comprobante
      motivo: `Proveedor reconocido: ${prov.nombre}`,
      confianza: "media",
    };
  }

  return { regla_id: "", tipo: "sin_clasificar", cuenta_contable: "", centro_costo: "",
    cuenta_destino: "", proveedor_id: "", accion: "escala",
    motivo: "Sin regla ni proveedor — revisar", confianza: "baja" };
}

/** Clasifica todas las líneas. Devuelve cada línea con `.propuesta`. */
export function clasificarLineas(lineas, reglas, proveedores, ctx) {
  return (lineas || []).map(l => ({ ...l, propuesta: clasificarLinea(l, reglas, proveedores, ctx) }));
}
