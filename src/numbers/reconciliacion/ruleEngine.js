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
      return {
        regla_id: r.id,
        tipo: r.tipo || "",
        cuenta_contable: r.cuenta_contable || "",
        centro_costo: r.centro_costo || "",
        cuenta_destino: r.cuenta_destino || "",
        proveedor_id: r.proveedor_id || "",
        accion: r.accion || "auto",
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
