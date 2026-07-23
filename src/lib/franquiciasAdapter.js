// ─── Adaptadores read-only Bigg Franquicias → Numbers ───────────────────────
// ÚNICO punto que consume los internals de Franquicias (compEmpresa/compCurrency/
// computeSaldoReal/COMP_TYPES). Las pantallas (Reportes, Tesorería) solo llaman a
// estas funciones — sin importar nada de Franquicias directamente.
//
// OJO — SWITCH futuro: hoy el saldo de CxC (franquiciasSaldosCxC) lee los cobros desde
// `comprobantes` de Franquicias. Cuando los movimientos financieros pasen SOLO a
// nb_movimientos, hay que reapuntar la fuente del saldo ACÁ (un solo lugar). Las facturas
// del P&L (franquiciasIngresoPnLRows) NO cambian: FACTURA|/NC| no son financieros.
import { compEmpresa, compCurrency, computeSaldoReal, COMP_TYPES } from "./helpers";
import { normCuit } from "./numbersApi";

// Fuente única: sociedad Numbers → empresa emisora de Franquicias (y su inversa).
export const SOCIEDAD_EMPRESA = {
  nako:     "ÑAKO SRL",
  biggfit:  "BIGG FIT LLC",
  wellness: "Gestión Deportiva y Wellness SL",
};
const EMPRESA_SOCIEDAD = Object.fromEntries(Object.entries(SOCIEDAD_EMPRESA).map(([k, v]) => [v, k]));

// Sufijo del tipo de comprobante (franquicias) → cuenta contable en el chart consolidado de Numbers.
// Confirmado con el usuario (13/7): FEE es "Regalias s/Ventas"; PAUTA es "Acciones de Mkt" (BIGG le
// vende pauta a los franquiciados); INTERUSOS es costo que pega en margen; SPONSORS/OTROS directo.
const FRANQ_CUENTA = { FEE: "Regalias s/Ventas", INTERUSOS: "Interusos", PAUTA: "Acciones de Mkt", SPONSORS: "Sponsor", SPONSOR: "Sponsor", OTROS: "Otros Ingresos" };
const MONEDAS = ["ARS", "USD", "EUR"];

// Tipos de GESTIÓN (interusos de sedes propias). A propósito NO están en COMP_TYPES:
// así todas las funciones de saldo de franquicia (computeSaldo/Real, buildCuentaCorriente,
// TabResumenMes) los ignoran solas — el doc de gestión NO deja CxC/CxP. El prefijo de doc
// propio conserva el signo: GFAC|<cuenta> (+, cargo) / GNC|<cuenta> (−, crédito/NC).
export const GESTION_TIPOS = { GFAC: { doc: "FACTURA", sign: +1 }, GNC: { doc: "NC", sign: -1 } };
export const esTipoGestion = (type) => String(type || "").split("|")[0] in GESTION_TIPOS;
// def unificada de un comprobante: COMP_TYPES (comercial) o el mapa de gestión.
function defComp(type) {
  if (COMP_TYPES[type]) return COMP_TYPES[type];
  const [pref, cuenta] = String(type || "").split("|");
  const g = GESTION_TIPOS[pref];
  return g ? { doc: g.doc, sign: g.sign, cuenta: cuenta || "INTERUSOS", gestion: true } : null;
}

// Documentos de franquicia (FACTURA/NC) que una franquicia cuyo CUIT es el de la sociedad activa me emitió
// → pendientes para reconocer en la Conciliación interco de esa sociedad (ej. Segui, que es sociedad Y
// franquicia). FACTURA (le debo: pauta/sponsoreo) → EGRESO/CxP; NC (a mi favor: interuso) → INGRESO/CxC.
// Mismo shape que un pendiente de venta interco; el dedup por interco_ref (id_comp "FR-…") lo aplica
// pendientesInterco. Reusa COMP_TYPES/compEmpresa/compCurrency/EMPRESA_SOCIEDAD (no re-deriva los internals).
export function franquiciasPendientesInterco(compsByFr, franchises, miCuit, miSociedad = "") {
  const cuit = normCuit(miCuit);
  const soc  = (miSociedad || "").toLowerCase();
  const out = [];
  for (const fr of (franchises ?? [])) {
    const esSede    = fr.esSedePropia === true;
    // Sede propia → parkea en su sociedad operadora (sedeSociedad), NO por CUIT (evita
    // que caiga también por el camino comercial y deje una CxP fantasma).
    // Franquicia normal (incl. Segui) → por CUIT, como siempre.
    const matchSede = esSede && soc && (fr.sedeSociedad || "").toLowerCase() === soc;
    const matchCuit = cuit && normCuit(fr.cuit) === cuit;
    if (esSede ? !matchSede : !matchCuit) continue;
    for (const c of (compsByFr?.[String(fr.id)] ?? [])) {
      const def = defComp(c.type);
      if (!def || (def.doc !== "FACTURA" && def.doc !== "NC")) continue;
      const monto = Math.abs(Number(c.amount) || 0);
      if (!monto) continue;
      const emisora = compEmpresa(c);
      out.push({
        id_comp: `FR-${c.id}`, origen: "franquicia",
        subtipo: def.doc === "NC" ? "INGRESO" : "EGRESO",             // NC (a mi favor) → ingreso; FACTURA → CxP
        concepto: def.cuenta || "", vendedor: EMPRESA_SOCIEDAD[emisora] ?? "", vendedorNombre: emisora,
        fecha: c.date, nroComp: c.invoice || "", moneda: compCurrency(c), total: monto,
        nota: c.nota || "",                                          // hint red bigg / gympass (gestión)
        ...(esSede ? {
          tratamiento: "gestion",                                    // → reconocerInterusoGestion (no CxP)
          sedeCentro:  fr.sedeCentro || "",
          sedeSociedad:(fr.sedeSociedad || "").toLowerCase(),
          sedeNombre:  fr.name || "",
        } : {}),
      });
    }
  }
  return out;
}

// Facturación a franquiciados → filas P&L de ingreso. Solo FACTURA|* (+) y NC|* (−);
// ignora FC_RECIBIDA y los financieros (doc null). Sociedad por empresa emisora; centro = HQ Ventas.
export function franquiciasIngresoPnLRows(compsByFr, sociedad, ventasCcId) {
  const soc = (sociedad ?? "").toLowerCase();
  const out = [];
  for (const list of Object.values(compsByFr ?? {})) {
    for (const c of (list ?? [])) {
      const def = defComp(c.type);   // incluye gestión (GFAC/GNC) → pata 1 del asiento de gestión (P&L del emisor)
      if (!def || (def.doc !== "FACTURA" && def.doc !== "NC")) continue;
      const cSoc = EMPRESA_SOCIEDAD[compEmpresa(c)] ?? null;
      if (soc && cSoc !== soc) continue;
      const monto = Math.abs(Number(c.amount) || 0);
      if (!monto) continue;
      const cuenta = FRANQ_CUENTA[String(def.cuenta || "OTROS").toUpperCase()] || "Otros Ingresos";
      const fecha  = (c.year != null && c.month != null) ? `${c.year}-${String(c.month + 1).padStart(2, "0")}-15` : "";
      out.push({ fecha, sociedad: cSoc, centro_costo: ventasCcId, cuenta_contable: cuenta, moneda: compCurrency(c), total: monto * def.sign });
    }
  }
  return out;
}

// Cobro/pago de franquicia anotado en nb_movimientos (Numbers) → fila con shape de
// comprobante financiero, para que computeSaldoReal lo cuente igual que un movimiento
// del "cuaderno viejo" de Franquicias. fr_tipo = PAGO | PAGO_PAUTA | PAGO_ENVIADO.
const FR_TIPO_DEFAULT = { COBRO: "PAGO", EGRESO: "PAGO_ENVIADO" };
export function movimientoToCompRow(mov) {
  const fecha = String(mov.fecha || "");                                  // ISO YYYY-MM-DD
  const [yyyy, mm] = fecha.split("-");                                     // para month/year (como parseComps)
  const date  = fecha.includes("-") ? fecha.split("-").reverse().join("/") : fecha;  // → DD/MM/YYYY
  return {
    id:       String(mov.id || ""),   // id de nb_movimientos → para poder borrar/editar
    _numbers: true,                    // marca: esta fila vive en nb_movimientos, no en comprobantes
    frId:     String(mov.contraparte_id || ""),
    type:     mov.fr_tipo || FR_TIPO_DEFAULT[mov.tipo] || "PAGO",
    amount:   Math.abs(Number(mov.monto) || 0),
    currency: mov.moneda || "ARS",
    empresa:  SOCIEDAD_EMPRESA[(mov.sociedad || "").toLowerCase()] || null,
    date,
    // month (0-11) / year — igual que parseComps, para computePautaPendiente/upToPeriod.
    month:    mm ? Number(mm) - 1 : undefined,
    year:     yyyy ? Number(yyyy) : undefined,
  };
}

// Une los movimientos financieros de franquicia de nb_movimientos al cuaderno `comps`
// (mapa {frId: [filas]}). No muda datos: devuelve una copia enriquecida. Fuente única del
// merge — la usan franquiciasSaldosCxC (Numbers) y App.jsx (app Franquicias).
export function enriquecerCompsConMovs(comps, movimientos = []) {
  const movsFr = (movimientos ?? []).filter(m =>
    m.origen === "franquicias" && m.contraparte_id &&
    !String(m.documento_id || "").startsWith("IGN-"));
  if (!movsFr.length) return comps;
  const out = { ...comps };
  for (const m of movsFr) {
    const row = movimientoToCompRow(m);
    if (!row.frId) continue;
    out[row.frId] = [...(out[row.frId] ?? []), row];
  }
  return out;
}

// Saldos de franquiciados → { activo, pasivo } (presentación BRUTA, sin netear):
//   saldo > 0 (nos deben)  → Activo "Franquiciados"
//   saldo < 0 (les debemos) → Pasivo "Franquiciados (saldo a favor)" (ingreso diferido)
// Por moneda — una empresa puede facturar en varias (ej. Bigg Fit en USD y EUR).
// DOS FUENTES, una CC: los cobros viejos viven en `comps` (Franquicias); los nuevos,
// anotados por Conciliación, llegan en `movimientos` (nb_movimientos) y se unen acá
// sin mudar datos. Mientras no haya cobros de franquicia en Numbers, el saldo da igual.
export function franquiciasSaldosCxC({ comps, saldos, franchises }, sociedad, year, month, movimientos = []) {
  const empresa = SOCIEDAD_EMPRESA[(sociedad ?? "").toLowerCase()];
  if (!empresa) return { activo: [], pasivo: [] };

  // Unir los cobros/pagos de franquicia de nb_movimientos al cuaderno de Franquicias.
  const compsCC = enriquecerCompsConMovs(comps, movimientos);

  const activo = [], pasivo = [];
  for (const moneda of MONEDAS) {
    const deben = [], debemos = [];
    let totA = 0, totP = 0;
    for (const fr of (franchises ?? [])) {
      if (fr.activa === false) continue;
      // Moneda por defecto de la franquicia (para saldos/comps SIN currency explícita): así no se cuentan
      // en las 3 monedas del loop. Un saldo/comp con currency propia sigue ganando (entry.currency ?? frCurrency).
      const frCur = fr.currencies?.[0] || "ARS";
      const saldo = computeSaldoReal(fr.id, year, month, compsCC, saldos, frCur, moneda, empresa);
      if (saldo > 0.01)       { deben.push({ contraparte: fr.name, vto: "", saldo, moneda }); totA += saldo; }
      else if (saldo < -0.01) { debemos.push({ contraparte: fr.name, vto: "", saldo: -saldo, moneda }); totP += -saldo; }
    }
    if (totA > 0.01) { deben.sort((a, b) => b.saldo - a.saldo);   activo.push({ label: "Franquiciados", moneda, saldo: totA, docs: deben, headerColor: "#16a34a" }); }
    if (totP > 0.01) { debemos.sort((a, b) => b.saldo - a.saldo); pasivo.push({ label: "Franquiciados (les debemos)", moneda, saldo: totP, docs: debemos, headerColor: "#dc2626" }); }
  }
  return { activo, pasivo };
}
