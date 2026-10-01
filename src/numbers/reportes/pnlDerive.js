// Motores PUROS del P&L (sin React, sin theme): adaptadores de filas (movimientos, financiaciones), el P&L de
// sede (waterfall curado), el de Huergo (margen) y el del holding BIGG (buckets HQ + resultados por negocio).
// Los consumen PantallaReportes (render + Excel), TabDevengado, TabDetallePagosCobros, cashflowDerive y
// puenteDerive. Vivir acá corta el ciclo PantallaReportes ↔ tabs (antes los tabs importaban de la pantalla).

const MESES    = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function normCat(raw) {
  const s = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (s === "ventas")                                          return "ventas";
  if (s === "costo_venta"  || s.includes("costo")
   || s === "gasto_por_venta" || s === "gastos_por_venta")    return "costo_venta";
  if (s === "gastos_operativos" || s === "gasto_operativo"
   || s === "gastos_operativo")                               return "gastos_operativos";
  if (s === "gastos_financieros" || s === "gasto_financiero"
   || s === "financiero"   || s === "financieros")            return "gastos_financieros";
  if (s === "impuestos"    || s === "impuesto")               return "impuestos";
  if (s === "capex"        || s === "inversiones")            return "capex";
  if (s === "r_y_d"  || s === "r&d"  || s === "ryd")         return "r_y_d";
  if (s === "sales_marketing" || s.includes("sales"))         return "sales_marketing";
  if (s === "g_and_a" || s === "g&a" || s === "gna")         return "g_and_a";
  return s;
}

// Match de id de centro de costo CASE-INSENSITIVE. El maestro tiene ids con caja inconsistente
// (ej. "CC-2026-88265" vs "cc-2026-88265") y el lookup sensible a mayúsculas hacía que un CECO no
// resolviera → la fila caía en la línea/bucket equivocado. Normalizar a minúsculas lo evita.
const ccKey = s => String(s ?? "").trim().toLowerCase();
const ccEnFiltro = (ccFilter, cc) => {
  const k = ccKey(cc);
  return Array.isArray(ccFilter) ? ccFilter.some(f => ccKey(f) === k) : ccKey(ccFilter) === k;
};

// Adapter: nb_movimientos imputados que SON el hecho económico (gasto contado /
// conciliación contabilizada) → mismo formato que las filas de nb_comprobantes.
// Marcador único: documento_id empieza con "CONTAB-" (devengado-vía-movimiento).
// Si una fila se reimputa como pago de una FC, su documento_id pasa al id_comp y
// SALE del P&L automáticamente (el devengado lo aporta el comprobante de la FC).
// El SIGNO del movimiento importa (no |monto|): el aporte al P&L depende de si el movimiento va
// en la dirección natural de su cuenta o es una reversión.
//   · Cuenta de INGRESO (categoría "ventas"): crédito (+) suma / débito (−) resta → devolución neta.
//   · Cuenta de resultado NEGATIVO (costo/gasto/impuesto/financiero): débito (−) suma como costo /
//     crédito (+) resta (reintegro, ej. Intereses Ganados en "Financieros" → mejora el resultado).
//   · Retención sufrida: siempre costo (se guarda con monto +) → valor absoluto.
// Requiere cuentaMap (nombre→cuenta) para leer la categoría de la cuenta.
// Período P&L = FECHA del movimiento, siempre (la misma con la que la caja/deuda lo ve). Hasta el 17/9/2026 se
// respetaba un override `periodo=YYYY-MM` empacado en `referencia` (consumos de tarjeta movidos de mes a mano):
// separaba el P&L del balance y rompía el cierre del PN. Los tags viejos que quedaron en la hoja se IGNORAN.
const periodoPnLDe = (m) => m.fecha;
function movimientoToPnLRows(movs, sociedad, cuentaMap) {
  const soc = (sociedad ?? "").toLowerCase();
  const out = [];
  for (const m of (movs ?? [])) {
    if (soc && (m.sociedad ?? "").toLowerCase() !== soc) continue;
    const raw = (m.cuenta_contable ?? "").trim();
    if (!raw) continue;
    // La fila puede traer el NOMBRE de la cuenta o (si el writer no supo convertirlo) su ID.
    // `cuentaMap` resuelve ambos → canonizamos a nombre acá, una sola vez, para que las tres
    // tablas (Sede, estructurado, BIGG) agrupen por la misma clave y no partan una cuenta en dos.
    const cuenta = cuentaMap?.get(raw);
    const nombre = cuenta?.nombre || raw;
    // Entra al P&L: gasto/ingreso contado-conciliado (CONTAB-), retención sufrida, o interuso de
    // gestión (asiento de gestión de sede propia, pata 2). La retención lleva documento_id de la
    // factura (netea la CxC), por eso se la reconoce por origen; el interuso de gestión NO tiene caja.
    if (!String(m.documento_id ?? "").startsWith("CONTAB-") && m.origen !== "retencion" && m.origen !== "interuso_gestion") continue;
    const monto = Number(m.monto) || 0;
    let total, _tipo;
    if (m.origen === "retencion") {
      total = Math.abs(monto);
      _tipo = "Retención";
    } else if (m.origen === "interuso_gestion") {
      // El writer ya firmó el monto desde la óptica de la sede (NC → ingreso +, FACTURA → cargo −)
      // sobre su línea de interusos → pass-through directo, sin re-signar por categoría.
      total = monto;
      _tipo = "Interuso gestión";
    } else {
      // Ingreso = ventas, o un INGRESO de cuenta financiera (ej. Intereses Ganados): son ingresos, no gastos
      // → no negar. (Antes solo "ventas" era ingreso y el interés ganado quedaba negativo.)
      const esFinancIn = m.tipo === "INGRESO" && String(cuenta?.categoria_pnl || "").toLowerCase().includes("financ");
      const esIngreso = normCat(cuenta?.categoria_pnl) === "ventas" || esFinancIn;
      total = esIngreso ? monto : -monto;
      _tipo = esIngreso ? "Ingreso" : "Gasto";
    }
    out.push({
      fecha:           periodoPnLDe(m),
      sociedad:        m.sociedad,
      centro_costo:    m.centro_costo ?? "",
      cuenta_contable: nombre,                        // canónico (nunca el id crudo)
      moneda:          m.moneda ?? "ARS",
      total,
      iva_monto:       Math.abs(Number(m.iva_monto) || 0),   // para la vista "sin IVA" (neto = total − iva)
      _tipo,                                          // para el detalle de Informes (tipo de egreso)
      contraparte_nombre: m.contraparte_nombre ?? "",
    });
  }
  return out;
}

// Adapter: financiaciones (planes AFIP + créditos) → filas P&L. Dos reconocimientos en
// distinta línea de tiempo (sin partida doble; la caja vive aparte en nb_movimientos):
//   · Capital del plan AFIP = el impuesto → 1 fila en el mes de consolidación (salvo apertura,
//     que ya está en Contagram). El capital de un préstamo NO entra (es deuda, no gasto).
//     EXCEPCIÓN `capital_en_cuotas`: el capital se devenga en el VENCIMIENTO de cada cuota, como el interés.
//     Caso: una rectificativa de meses ya cerrados que se reconoce para adelante en vez de hacer un pozo en
//     el mes de consolidación. Ojo: el pasivo de esos planes también nace cuota a cuota
//     (financiacionPasivoBuckets) — si se devengara el gasto de a poco pero la deuda entera de una, el PN
//     caería sin que el P&L lo explique y se rompería el cierre contra la variación del PN.
//   · Interés financiero + IVA + sellos de cada cuota → en el mes de su VENCIMIENTO (devengo
//     mes a mes, pagada o no). El resarcitorio (recargo por mora) se contabiliza por lo que la CAJA
//     pagó de más sobre el importe normal de la cuota: AFIP cobra el importe normal o el "tardío", y el
//     débito del banco dice cuál. (Antes: por fecha_pago > vto → 15 cuotas con vto domingo 16/8/2026
//     debitadas el martes 18/8 por el importe justo devengaban 66.269 de recargo que nadie cobró.)
function financiacionToPnLRows(planes, sociedad) {
  const soc = (sociedad ?? "").toLowerCase();
  const out = [];
  for (const p of (planes ?? [])) {
    if (soc && (p.sociedad ?? "").toLowerCase() !== soc) continue;
    const capitalEsGasto = p.tipo === "plan_afip" && !p.es_apertura && p.cuenta_capital;
    if (capitalEsGasto && !p.capital_en_cuotas) {
      const capTot = (p.cuotas ?? []).reduce((s, c) => s + (Number(c.capital) || 0), 0);
      if (capTot > 0) out.push({ fecha: p.fecha_consolidacion, sociedad: p.sociedad, centro_costo: p.centro_capital, cuenta_contable: p.cuenta_capital, moneda: p.moneda, total: capTot, _tipo: "Financiación", contraparte_nombre: p.acreedor_nombre ?? "" });
    }
    const base = { sociedad: p.sociedad, moneda: p.moneda, _tipo: "Financiación", contraparte_nombre: p.acreedor_nombre ?? "" };
    const push = (cuenta, centro, total, fecha) => { if (total > 0 && cuenta) out.push({ ...base, fecha, centro_costo: centro, cuenta_contable: cuenta, total }); };
    for (const c of (p.cuotas ?? [])) {
      if (c.estado === "cancelada") continue;
      if (capitalEsGasto && p.capital_en_cuotas) push(p.cuenta_capital, p.centro_capital, c.capital, c.vto);
      push(p.cuenta_interes,   p.centro_interes,   c.interes,   c.vto);
      push(p.cuenta_iva,       p.centro_iva,       c.iva,       c.vto);
      push(p.cuenta_impuestos, p.centro_impuestos, c.impuestos, c.vto);
      // Recargo por mora: DATO escrito en la cuota al saldarla (`recargo_pagado`, 23/9/2026) → fecha_pago.
      // Fallback (cuotas saldadas antes de esa fecha, sin el dato): pagado − importe normal de la cuota, derivado
      // de los movimientos. Sin pago en caja no hay recargo.
      const guardado = Number(c.recargo_pagado) || 0;
      const pagadoCuota = Number(c.pagado) || 0;
      const derivado = pagadoCuota > 0 ? Math.round((pagadoCuota - (Number(c.total) || 0)) * 100) / 100 : 0;
      const recargo = guardado > 0.5 ? guardado : derivado;
      if (recargo > 0.5) {
        const fechaRec = (guardado > 0.5 && c.fecha_pago) ? c.fecha_pago
          : ((c.pagos ?? []).map(x => x.fecha).sort().pop() || c.fecha_pago || c.vto);
        push(p.cuenta_interes, p.centro_interes, recargo, fechaRec);   // resarcitorio efectivamente cobrado
      }
    }
  }
  return out;
}

// Go-live: el P&L arranca el 1/7/2026. Todo lo anterior es migración de saldos iniciales de Contagram
// (metida en cualquier cuenta/centro) y NO es resultado del período → se excluye de TODOS los P&L. Los
// saldos iniciales de verdad viven como filas SALDO_INICIAL en nb_movimientos (Balance/Tesorería, nunca P&L).
const PNL_INICIO = "2026-07-01";

// ─── P&L SEDES: estructura fija (waterfall estable) + mapeo cuenta→línea (curado) ──
// El "qué cuenta va en cada línea" vive acá a propósito: es el P&L de management de la sede,
// curado. Cuentas fuera de este mapeo con movimientos → bloque "Sin clasificar" al pie
// (control de fugas: líneas mapeadas + sin clasificar = todo, nada se esconde).
// Los nombres son los del maestro nb_cuentas (1/10/2026: el histórico de España/Colombia se unificó sobre
// él y salieron de acá 13 nombres sin cuenta ni filas).
// Paleta sobria: los subgrupos van todos en gris pizarra neutro; el color con significado
// (verde/rojo) se reserva para las líneas de resultado. Las bandas de sección aportan la estructura.
const SEDE_HDR = "#475569";   // slate — encabezados de subgrupo y montos de cuenta
const SEDE_GRUPOS = [
  { key: "vta_cf",    label: "Ventas consumidor final",  color: SEDE_HDR, cuentas: ["Ventas Mercado Pago", "Ing.Stripe", "Ing. Datafono", "Depositos", "Ventas en Efectivo", "Otros Ingresos"] },
  { key: "int_bigg",  label: "Interusos red BIGG",       color: SEDE_HDR, cuentas: ["Interusos"] },
  { key: "int_corp",  label: "Interusos corporativos",   color: SEDE_HDR, cuentas: ["Coorporativos"] },
  { key: "cvar",      label: "Costos Variables",         color: SEDE_HDR, cuentas: ["Fee Facturación", "Aranceles y Otros Financieros", "IIBB", "Imp. Cred. y Deb.", "Gastos Financieros"] },
  { key: "gp_pers",   label: "Personal",                 color: SEDE_HDR, cuentas: ["Sueldos", "Incentivos", "Comisiones", "Otros Gastos Salariales", "Aguinaldos", "Costos Salariales", "IRPF"] },
  { key: "gp_ocup",   label: "Ocupación",                color: SEDE_HDR, cuentas: ["Alquiler", "Expensas", "ABL", "Servicios"] },
  // "CRM" (1/10/2026): servicio WhatsApp del CRM que HQ le cobra a la sede propia (asiento de gestión). Va en
  // Mkt y Pauta por ahora, como herramienta comercial; Martín lo revisa más adelante.
  { key: "gp_mkt",    label: "Mkt y Pauta",              color: SEDE_HDR, cuentas: ["Acciones de Mkt", "Pauta", "CRM"] },
  { key: "gp_otros",  label: "Otros Gastos de la Sede",  color: SEDE_HDR, cuentas: ["Honorarios Profesionales", "Equipamiento y Mantenimiento", "Limpieza", "Otros Gastos del Centro", "Gastos Menores de Caja"] },
  { key: "com_res",   label: "Comisión por resultados",  color: SEDE_HDR, cuentas: ["Comision S/Resultado"] },
  { key: "inv_no_op", label: "Inversiones no operativas", color: SEDE_HDR, cuentas: ["Inversiones / Gastos no Operativos"] },
];
// Los 4 grupos que forman "Total Gastos Operativos" de la sede. Una sola lista para el subtotal y para el
// detalle por cuenta de la estructura → no pueden quedar desalineados.
const SEDE_OPEX_GRUPOS = ["gp_pers", "gp_ocup", "gp_mkt", "gp_otros"];
const _nkSede = s => (s ?? "").trim().toLowerCase();
// Cuentas que se OCULTAN si están vacías (todo el año en cero). Ing.Stripe / Ing. Datafono / IRPF son
// naturales de España → en el resto de las sedes vienen en 0 y ensucian; en España, donde sí hay dato, se
// muestran solas.
const SEDE_OCULTAR_SI_VACIA = new Set([_nkSede("Ing.Stripe"), _nkSede("Ing. Datafono"), _nkSede("IRPF"),
  _nkSede("Ventas Mercado Pago"), _nkSede("Depositos"), _nkSede("Ventas en Efectivo")]);
const SEDE_CUENTA_A_GRUPO = (() => {
  const m = new Map();
  for (const g of SEDE_GRUPOS) for (const c of g.cuentas) m.set(_nkSede(c), g.key);
  return m;
})();
// Cuentas que SON de ingreso por definición (ventas + interusos), aunque el maestro no las tenga
// categorizadas. El histórico las rutea al lado ingreso → mantienen su SIGNO NATURAL (los interusos ya
// vienen neteados; sin esto caían como egreso y el motor les invertía el signo, ej. "Interusos Genericos").
const SEDE_ING_ACCTS = new Set(
  SEDE_GRUPOS.filter(g => ["vta_cf", "int_bigg", "int_corp"].includes(g.key))
    .flatMap(g => g.cuentas.map(_nkSede))
);
const grupoSede = (key) => SEDE_GRUPOS.find(g => g.key === key);
// Alias de cuenta → línea del P&L Sede: cuentas que deben plegarse a una línea existente (mismo grupo y misma
// fila). Ej.: "Mantenimiento" se contabiliza dentro de "Equipamiento y Mantenimiento".
// "Gastos Bancarios" y "Licencias de Software y Sistemas Contables" ya son `categoria_pnl: "Gastos
// Operativos"` (o sea, el P&L del holding las toma bien), pero no estaban en ningún grupo de ACÁ →
// caían en "Sin clasificar", que se muestra al pie pero NO suma a totGastosOp ni al resultado. Se
// pliegan a "Otros Gastos del Centro" para que entren al subtotal de la sede.
const SEDE_CUENTA_ALIAS = {
  "mantenimiento": "Equipamiento y Mantenimiento",
  "gastos bancarios": "Otros Gastos del Centro",
  "licencias de software y sistemas contables": "Otros Gastos del Centro",
};
const aliasCuentaSede = (nombre) => SEDE_CUENTA_ALIAS[_nkSede(nombre)] || nombre;

// ─── Cesión de utilidades (apropiación del resultado, DEBAJO de Resultado Final) ────────────────
// Hektor cede el 49% del resultado de Barrio Norte a una contraparte (NO es gasto: es reparto del
// resultado). Los retiros se imputan a la cuenta "Inversores" (hoy caen en "Sin clasificar"). v1 read-only:
// muestra acreditado (pct×resFinal) − retirado (mov. "Inversores") = saldo de cuenta corriente acumulado.
// apertura = saldo heredado con la contraparte al CIERRE del año anterior a `aperturaYear` (deuda; >0 = le
// debemos). Es un CARRY-IN: entra al inicio de `aperturaYear` y la CC acumula los 12 meses (acreditado −
// retirado) desde enero. Ej.: saldo socios BN al 31/12/2025 = 7.840.230 → siembra 2026 y corre hasta hoy.
const CESION = { matchNombre: "Barrio Norte", pct: 0.49, contraparte: "", apertura: 7_840_230, aperturaYear: 2026 };
const CESION_CUENTA = "Inversores";   // cuenta contable donde se imputan los retiros

// Comisión de encargados (2,5% s/ Resultado Operativo): SOLO estas sedes core AR. Botánico, Rosedal,
// España y Colombia NO cobran. Ids de centro (case-insensitive) — la base calculada se arma sólo con estos.
const COM_ENC_RATE = 0.025;
const SEDES_COMISION_CC = new Set(["cc-2026-88265", "cc-2026-88266", "cc-2026-88267", "cc-2026-88268", "cc-2026-88269"]);

// Helper puro: dado el resFinal[12] de la sede y los retiros[12] (cuenta "Inversores"), arma la cola.
function computeCesion(resFinal = [], retiros = [], { pct, apertura = 0, aperturaYear }, year) {
  const acreditado = Array.from({ length: 12 }, (_, m) => (Number(resFinal[m]) || 0) * pct);
  // El retiro es un egreso (viene con signo negativo): tomamos la magnitud pagada, que REDUCE lo que se debe.
  const retirado   = Array.from({ length: 12 }, (_, m) => Math.abs(Number(retiros[m]) || 0));
  // Carry-in: en `aperturaYear` la CC arranca con el saldo heredado al 1/1 (que ya incluye todo lo previo) y
  // acumula los 12 meses (acreditado − retirado) desde enero. Años previos al ancla: sin CC (null).
  // >0 = le debemos · <0 = adelantado.  (v1: años posteriores a `aperturaYear` reinician en 0, sin carry-forward.)
  const saldoAcum = new Array(12).fill(null);
  const saldoPrev = new Array(12).fill(null);   // saldo pendiente al inicio del mes (= saldo acumulado del mes anterior)
  if (year >= aperturaYear) {
    let acc = year === aperturaYear ? (Number(apertura) || 0) : 0;
    for (let m = 0; m < 12; m++) { saldoPrev[m] = acc; acc += acreditado[m] - retirado[m]; saldoAcum[m] = acc; }
  }
  return { acreditado, retirado, saldoAcum, saldoPrev };
}

// Monto de una fila del P&L: bruto (con IVA) o NETO (sin IVA → resultado real / EBITDA). El neto resta
// el iva_monto de la fila (facturas y movimientos imputados lo traen; sueldos/otros sin IVA → neto = total).
const montoPnL = (row, sinIva) => {
  const total = Number(row.total) || 0;
  return sinIva ? total - (Number(row.iva_monto) || 0) : total;
};

// Grupos de INGRESO del P&L Sede (los que suman en totIngresos) → su IVA es débito (ventas); el resto, crédito.
const SEDE_ING_KEYS = new Set(["vta_cf", "int_bigg", "int_corp"]);

// La consolidación FX se resuelve pre-traduciendo las filas a la moneda destino ANTES de llamar acá
// (ver traducirFilasFx): este builder corre siempre en modo nativo (filtra por `moneda`).
function buildPnLSede(inRows, egRows, ccFilter, year, moneda, sinIva = false) {
  // Pre-poblar cada grupo con sus cuentas configuradas en 0 → se muestran aunque no tengan monto.
  const grupos = {};
  for (const g of SEDE_GRUPOS) { grupos[g.key] = {}; for (const c of g.cuentas) grupos[g.key][c] = new Array(12).fill(0); }
  const sinClasificar = {};
  // IVA stripped por línea (solo Sin IVA), para que el holding lo sume: líneas de ingreso → débito, de costo → crédito.
  const ivaDeb = new Array(12).fill(0), ivaCred = new Array(12).fill(0);
  const add = (rows) => {
    for (const row of rows) {
      if (!row.fecha || (row.fecha < PNL_INICIO && !row._historico) || row.fecha.slice(0,4) !== String(year)) continue;
      if ((row.moneda ?? "ARS") !== moneda) continue;
      if (ccFilter !== "todos" && !ccEnFiltro(ccFilter, row.centro_costo)) continue;
      const m = parseInt(row.fecha.slice(5,7), 10) - 1;
      if (m < 0 || m > 11) continue;
      const nombre = aliasCuentaSede((row.cuenta_contable ?? "").trim() || "Sin cuenta");
      const gkey   = SEDE_CUENTA_A_GRUPO.get(_nkSede(nombre));
      const bucket = gkey ? grupos[gkey] : sinClasificar;
      if (!bucket[nombre]) bucket[nombre] = new Array(12).fill(0);
      // Un COMPROBANTE cuyo subtipo no coincide con la naturaleza del grupo es CONTRA: un EGRESO (factura de
      // compra) en una cuenta de INGRESO (ej. Interusos) RESTA; un INGRESO en una cuenta de costo, resta. Así
      // el interuso netea (+ cobrado / − pagado, clearing de la sede). Los movimientos (sin subtipo) mantienen
      // su signo — ya vienen firmados desde movimientoToPnLRows (un reintegro en cuenta de costo llega negativo;
      // un ingreso financiero, ej. Intereses Ganados, llega positivo y cae en Sin clasificar, de donde la cola
      // "Resultado Financiero" de fondeadas/Rosedal lo toma con signo natural: + ganancia). NO re-firmar acá.
      const st = String(row.subtipo || "").toUpperCase();
      const esEg = st === "EGRESO", esIn = st === "INGRESO", enIng = SEDE_ING_KEYS.has(gkey);
      const contra = !!gkey && ((esEg && enIng) || (esIn && !enIng));
      bucket[nombre][m] += montoPnL(row, sinIva) * (contra ? -1 : 1);
      // IVA: comprobante ingreso → débito, egreso → crédito; movimiento (sin subtipo) → por grupo.
      if (sinIva && gkey) ((esIn ? true : esEg ? false : enIng) ? ivaDeb : ivaCred)[m] += Number(row.iva_monto) || 0;
    }
  };
  add(inRows); add(egRows);
  return { grupos, sinClasificar, ivaDeb, ivaCred };
}

const sumGrupoSede = (g) => MESES.map((_, m) => Object.values(g).reduce((s, arr) => s + (arr[m] || 0), 0));
// "Ventas" de la sede (decisión: SOLO ventas — Stripe/Datafono/vía Banco/Efectivo — sin interusos ni Otros
// Ingresos). Suma el grupo vta_cf excluyendo "Otros Ingresos". Define si una sede está ACTIVA en el mes
// (ventas > 0) para el reparto de la estructura en partes iguales (España).
// Rellena los meses `null` de un factor mensual (nadie activo ese mes): con el primer mes siguiente que sí tenga
// valor (costo de apertura → a las sedes que abren); si no hay hacia adelante, con el último anterior (cierre);
// si no hay ninguno en el año, con `sinDato` (partes iguales entre todas las sedes).
function rellenarMesesSinActivas(factores, sinDato) {
  const out = [...factores];
  let ultimo = null;
  for (let m = 11; m >= 0; m--) { if (out[m] != null) ultimo = out[m]; else if (ultimo != null) out[m] = ultimo; }   // hacia adelante
  ultimo = null;
  for (let m = 0; m < 12; m++)  { if (out[m] != null) ultimo = out[m]; else out[m] = ultimo ?? sinDato; }              // hacia atrás / sin dato
  return out;
}
const VENTAS_EXCL_PRORR = new Set([_nkSede("Otros Ingresos")]);
const sumVentasSede = (pnl) => MESES.map((_, m) =>
  Object.entries(pnl.grupos.vta_cf).reduce((s, [n, arr]) =>
    VENTAS_EXCL_PRORR.has(_nkSede(n)) ? s : s + (Number(arr[m]) || 0), 0));

function computeSubtotalsSede(pnl) {
  const { grupos, sinClasificar } = pnl;
  const st = {};
  for (const g of SEDE_GRUPOS) st[g.key] = sumGrupoSede(grupos[g.key]);
  const totIngresos   = MESES.map((_, m) => st.vta_cf[m] + st.int_bigg[m] + st.int_corp[m]);
  const margenContrib = MESES.map((_, m) => totIngresos[m] - st.cvar[m]);
  const totGastosOp   = MESES.map((_, m) => SEDE_OPEX_GRUPOS.reduce((s, gk) => s + (st[gk][m] || 0), 0));
  const resOp         = MESES.map((_, m) => margenContrib[m] - totGastosOp[m]);
  const resFinal      = MESES.map((_, m) => resOp[m] - st.com_res[m] - st.inv_no_op[m]);
  const months = new Set();
  const curMonth = new Date().getMonth();
  for (let i = 0; i <= curMonth; i++) months.add(i);
  const scan = (obj) => Object.values(obj).forEach(arr => arr.forEach((v,i) => { if (v) months.add(i); }));
  Object.values(grupos).forEach(scan); scan(sinClasificar);
  return { st, totIngresos, margenContrib, totGastosOp, resOp, resFinal,
           ivaDeb: pnl.ivaDeb || new Array(12).fill(0), ivaCred: pnl.ivaCred || new Array(12).fill(0),
           activeMonths: [...months].sort((a,b) => a-b) };
}

function buildPnLHuergo(inRows, egRows, ccFilter, year, moneda, sinIva = false) {
  const ingresos = {}, costos = {};
  const ivaDeb = new Array(12).fill(0), ivaCred = new Array(12).fill(0);   // ingreso → débito, costo → crédito
  const add = (rows, bucket, esIng) => {
    for (const row of rows) {
      if (!row.fecha || (row.fecha < PNL_INICIO && !row._historico) || row.fecha.slice(0, 4) !== String(year)) continue;
      if ((row.moneda ?? "ARS") !== moneda) continue;
      if (!ccEnFiltro(ccFilter, row.centro_costo)) continue;
      const m = parseInt(row.fecha.slice(5, 7), 10) - 1; if (m < 0 || m > 11) continue;
      const nombre = (row.cuenta_contable ?? "").trim() || "Sin cuenta";
      (bucket[nombre] ??= new Array(12).fill(0))[m] += montoPnL(row, sinIva);
      if (sinIva) (esIng ? ivaDeb : ivaCred)[m] += Number(row.iva_monto) || 0;
    }
  };
  add(inRows, ingresos, true); add(egRows, costos, false);
  return { ingresos, costos, ivaDeb, ivaCred };
}
function computeSubtotalsHuergo(pnl) {
  const sumB = obj => MESES.map((_, m) => Object.values(obj).reduce((s, a) => s + (a[m] || 0), 0));
  const totIng = sumB(pnl.ingresos), totCos = sumB(pnl.costos);
  const margen = totIng.map((v, m) => v - totCos[m]);
  const months = new Set(); const curM = new Date().getMonth();
  for (let i = 0; i <= curM; i++) months.add(i);
  [pnl.ingresos, pnl.costos].forEach(o => Object.values(o).forEach(a => a.forEach((v, i) => { if (v) months.add(i); })));
  return { totIng, totCos, margen, ivaDeb: pnl.ivaDeb || new Array(12).fill(0), ivaCred: pnl.ivaCred || new Array(12).fill(0),
           activeMonths: [...months].sort((a, b) => a - b) };
}

// ─── P&L BIGG CONSOLIDADO (sedes propias + HQ + franquicias) — Etapa 1: hasta Margen Bruto ──
// DATA-DRIVEN: el subgrupo sale de columnas que el usuario mantiene en Maestros, sin listas de cuentas
// hardcodeadas. Dos dimensiones:
//   · FAMILIA ← `operacion`/`grupo` del centro (nb_centros_costo): propios / gerenciamiento / wre / hq.
//   · SECCIÓN ← `categoria_pnl` de la cuenta (nb_cuentas): "Ventas"=ingreso · "Costo por Venta"=Gastos
//     por Ventas · (Gastos Operativos/Financieros/Impuestos = debajo de Margen Bruto → Etapa 2).
//   · Dentro de sedes propias, Venta vs Interuso ← `categoria_pnl_sede` ("Ventas" vs "Otros Ingresos").
// El lado (ingreso/costo) de una fila de egRows se deduce de su categoria_pnl (la venta de sede llega
// firmada como ingreso dentro de egRows). Las franquicias (inRows) son siempre ingreso.
// Solo los buckets que el holding consolida LÍNEA POR LÍNEA. Lo que ya entra por su propio motor (resultado de
// sedes propias, fee de gerenciamiento, margen WRE/Huergo) se descarta en buildPnLBigg (`porOtroMotor`): antes se
// acumulaba en cinco buckets que nadie leía y se "omitía" después por nombre.
const BIGG_GRUPOS = [
  { key: "hq",     label: "Ingreso HQ" },
  { key: "gpv",    label: "Gastos por Ventas" },
  // Debajo de Margen Bruto (Etapa 2): gastos por CENTRO de costo, seccionados por categoría de la cuenta.
  { key: "ghq",    label: "Gastos HQ" },               // filas = centros HQ (Sport, Tecnología, …)
  { key: "fin",    label: "Financieros" },             // Intereses Ganados − Pérdidas Financieras
  { key: "imp",    label: "Impuestos" },               // IVA, Ganancias, Plan AFIP…
  { key: "capex",  label: "Inversiones / Capex" },      // compra de operaciones: centro con categoria_pnl="capex" → DEBAJO del Resultado del Grupo
];
// Orden de las cuentas dentro de cada subgrupo (display; las que no figuran van al final, alfabéticas).
// Hardcodeado a propósito: es presentación, bajo riesgo (un nombre que no matchea solo se ordena último).
const BIGG_ORDEN = [
  "Access Fees", "Regalias s/Ventas", "CRM", "Equipamientos", "Coorporativos (Gympass)",
  "Coorporativos", "APP (Gympass)", "Sponsor", "Pauta", "Otros Ingresos",
];

// Familia del centro (dimensión que separa los subgrupos). Devuelve null si no clasifica.
function familiaCentro(cc) {
  if (!cc) return null;
  const grupo = (cc.grupo ?? "").toLowerCase();
  const op    = (cc.operacion ?? "").trim();
  if (grupo === "hq") return "hq";
  if (grupo === "inversiones") return "wre";           // Puertos (hasta que tenga operacion propia)
  if (/^propios/i.test(op)) return "propios";
  if (op === "Sedes Administradas") return "gerenciamiento";
  if (op === "Wellness Real Estate") return "wre";
  return null;
}
// Familias cuyo resultado entra al holding por SU motor (resSedesAR / feeGer / resWRE), no línea por línea.
const FAM_OTRO_MOTOR = new Set(["propios", "gerenciamiento", "wre"]);
// Centro de Huergo: su opex entra por el margen WRE (buildPnLHuergo), no por "Gastos HQ".
const HUERGO_CENTRO = "11 - Huergo";

// Consolida SOLO anillo 1 (Núcleo): la operación propia + los fees que gana el núcleo operando lo de
// otros. Las fondeadas (anillo 2: España/Colombia/Puertos) y administradas (anillo 3: Rosedal) NO se
// consolidan línea por línea — su P&L es de esa sociedad; al núcleo solo le entra el fee (cargado en
// una sociedad núcleo). Un centro sin `empresa` (HQ/transversal) cuenta como núcleo.
function buildPnLBigg(inRows, egRows, ccMap, cuentaMap, nucleoEmpresas, year, moneda, sinIva = false) {
  const grupos = {}; for (const g of BIGG_GRUPOS) grupos[g.key] = {};
  const sinClasificar = {};
  // IVA embebido (solo modo sin IVA): débito de ventas y crédito de compras, con signo "de caja"
  // (crédito compras = entra, + ; débito ventas = sale, −). Suman al resultado igual que hoy (el neto
  // restituye el IVA → Resultado del Grupo da IGUAL con/sin IVA), pero se muestran con su signo natural.
  const ivaDeb = new Array(12).fill(0), ivaCred = new Array(12).fill(0);
  const add = (rows, forcedSide) => {
    for (const row of rows) {
      if (!row.fecha || (row.fecha < PNL_INICIO && !row._historico) || row.fecha.slice(0, 4) !== String(year)) continue;
      if ((row.moneda ?? "ARS") !== moneda) continue;
      const m = parseInt(row.fecha.slice(5, 7), 10) - 1;
      if (m < 0 || m > 11) continue;
      const cc = ccMap.get(ccKey(row.centro_costo));
      const emp = (cc?.empresa ?? "").trim();
      if (emp && !nucleoEmpresas.has(emp)) continue;   // fuera del núcleo (anillo 2/3) → no consolida
      const fam = familiaCentro(cc);
      const cuenta = (row.cuenta_contable ?? "").trim() || "Sin cuenta";
      const meta = cuentaMap?.get(cuenta);
      const catPnl  = normCat(meta?.categoria_pnl);                            // "ventas" | "costo_venta" | …
      const catRaw  = (meta?.categoria_pnl ?? "").toLowerCase();               // crudo, para financieros/impuestos
      let gkey = null, rowKey = cuenta, val = montoPnL(row, sinIva), neg = false;
      // Filas que viajan por egRows pero YA vienen firmadas como resultado por su adaptador (mismo set que
      // EG_QUE_SUMA del Devengado): movimiento-ingreso (_tipo "Ingreso", ej. Intereses Ganados +) e interuso de
      // gestión (pata 2 del asiento de sede propia, + ingreso / − cargo). No se re-firman como "costo".
      const yaFirmado = forcedSide !== "ingreso" && (row._tipo === "Ingreso" || row._tipo === "Interuso gestión");
      // ¿Lo consolida OTRO motor? Entonces no entra línea por línea (ni su IVA): sede propia (toda: su resultado
      // es la línea "Sedes Propias Argentina"), egreso de WRE/Gerenciamiento que no sea venta (su margen/fee ya
      // resta esos costos; rutearlo a gpv lo restaba dos veces), fee de operación cargada como venta HQ (ya es
      // línea de operación) y el opex de Huergo (va en el margen WRE). Hasta el 1/10/2026 estas filas caían en
      // buckets que nadie leía o se omitían después por nombre — pero el IVA de Huergo sí se acumulaba (doble).
      let porOtroMotor = fam === "propios"
        || ((fam === "wre" || fam === "gerenciamiento") && forcedSide !== "ingreso" && catPnl !== "ventas");
      if (normCat(cc?.categoria_pnl) === "capex") {
        // Centro tagueado capex (ej. "HQ - Capex"): compra de operaciones → sección propia DEBAJO del
        // Resultado del Grupo, fuera de OPEX/sede. Lo decide el CENTRO (no la cuenta), y gana sobre todo.
        gkey = "capex"; porOtroMotor = false;
      } else if (porOtroMotor) {
        // nada: se descarta abajo
      } else if (ING_CONTRA_HQ.has(cuenta)) {
        gkey = "hq";                                      // netea en Ingresos
        rowKey = ING_CONTRA_HQ.get(cuenta) || cuenta;     // MISMA fila que su ingreso par → una sola línea neta
        // El costo (egreso) RESTA al ingreso. Una fila ya firmada (interuso de gestión) pasa tal cual: hasta el
        // 22/9/2026 se le daba vuelta el signo → Coorporativos jul 2026 quedaba 583.646 abajo del Devengado.
        if (forcedSide !== "ingreso" && !yaFirmado) { val = -val; neg = true; }
      } else if (catPnl === "costo_venta") {
        gkey = "gpv";                                     // COSTO por venta → Gastos por Ventas: Interusos, Fee Fact.
        if (forcedSide === "ingreso") { val = -val; neg = true; }   // lado ingreso de una cuenta intermediada = contra → neto en gpv
      } else if (forcedSide === "ingreso" || catPnl === "ventas") {
        // VENTA → Ingresos HQ. Las de ger/wre entran por su motor; sin familia → Sin clasificar.
        if (fam === "hq") gkey = "hq"; else if (FAM_OTRO_MOTOR.has(fam)) porOtroMotor = true;
      } else if (catRaw.includes("financ")) {
        gkey = "fin";                                     // Financieros: filas = CUENTA (Intereses Ganados / Pérdidas Fin.)
      } else if (catRaw.includes("impuesto") || BIGG_ORDEN_IMP.includes(cuenta)) {
        gkey = "imp";                                     // Impuestos: filas = CUENTA (IVA / Ganancias / Plan AFIP…).
        // BIGG_ORDEN_IMP captura las que no tienen categoria en el maestro (ej. "IVA Inversiones") y si no caerían a OPEX.
      } else {
        gkey = "ghq";                                     // Gastos HQ (operativos): filas = CENTRO
        rowKey = cc?.nombre ?? cuenta;
      }
      // Un INGRESO que viaja por egRows (movimiento conciliado con cuenta de costo/financiera, ej. "Intereses
      // Ganados" tipo INGRESO: movimientoToPnLRows lo marca _tipo "Ingreso" con total +) y cae en un bucket de
      // COSTO entra como CRÉDITO (−): en esos buckets positivo = resta al resultado. Sin esto el interés ganado
      // se RESTABA (y se mostraba entre paréntesis) en vez de sumar — 22/9/2026, jul −2.236.180 / ago −1.227.484
      // en el Resultado del Grupo. El histórico ya venía con signo negativo para estas cuentas → no se toca.
      if (gkey === "hq" && BIGG_FEE_CUENTAS.includes(rowKey)) porOtroMotor = true;   // fee ger/WRE: ya es línea de operación
      if (gkey === "ghq" && rowKey === HUERGO_CENTRO) porOtroMotor = true;          // opex Huergo: va en el margen WRE
      if (porOtroMotor) continue;
      let credito = false;
      if (yaFirmado && BIGG_BUCKETS_COSTO.has(gkey)) { val = -val; credito = true; }
      const bucket = gkey ? grupos[gkey] : sinClasificar;
      if (!bucket[rowKey]) bucket[rowKey] = new Array(12).fill(0);
      bucket[rowKey][m] += val;
      // IVA stripped (solo Sin IVA) SOLO de los buckets HQ que consolida el holding (hq/gpv/ghq/fin/imp) —
      // sede/WRE/gerenciamiento reportan su IVA por su propio motor, no acá. Se clasifica por el signo con
      // que la línea entra al Resultado del Grupo: revenue (+) → débito ventas, costo (−) → crédito compras.
      // Así Σ(débito) − Σ(crédito) = impacto de HQ en el resultado, y el puente cierra por construcción.
      if (sinIva && HQ_IVA_BUCKETS.has(gkey)) {
        const contribSign = gkey === "hq" ? (neg ? -1 : 1) : gkey === "gpv" ? (neg ? 1 : -1) : (credito ? 1 : -1);
        (contribSign > 0 ? ivaDeb : ivaCred)[m] += Number(row.iva_monto) || 0;
      }
    }
  };
  add(inRows, "ingreso"); add(egRows, null);
  return { grupos, sinClasificar, ivaDeb, ivaCred };
}

// Buckets HQ que el holding consolida línea por línea (para acumular su IVA acá; sede/WRE/ger lo hacen aparte).
const HQ_IVA_BUCKETS = new Set(["hq", "gpv", "ghq", "fin", "imp"]);
// Buckets donde POSITIVO = costo (restan al resultado). Un ingreso que cae acá debe entrar negativo (crédito).
const BIGG_BUCKETS_COSTO = new Set(["gpv", "ghq", "fin", "imp", "capex"]);

// Orden de los centros dentro de "Gastos HQ" (display).
const BIGG_ORDEN_GHQ = ["HQ - Sport", "HQ - Tecnologia", "HQ - Ventas y Operaciones",
  "HQ - Marketing", "HQ - BI", "HQ - Design", "HQ - Gerencia General", "HQ - Administracion",
  "HQ - Recursos Humanos", "HQ - Infraestructura IT"];
const BIGG_ORDEN_GPV = ["Interusos", "Acciones de Mkt", "Fee Facturación"];
// Comparador de cuentas: por `order` (índice explícito) y luego alfabético; sin `order`, alfabético.
const ordCmp = (order) => ([a], [b]) => {
  if (order) { const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b); }
  return a.localeCompare(b);
};
// Ingreso intermediado que netea DENTRO de Ingresos (no en Gastos por Ventas): su costo entra como
// contra (−) EN LA MISMA FILA que su ingreso par → una sola línea neta. Ej.: "Interusos" (costo) se
// suma a la fila "Coorporativos" → Coorporativos − Interusos. "Pauta" es igual: la venta a franquiciados
// (ingreso) netea la compra a JMC/Meta/Google (egreso) en la fila "Pauta". Margen y resultados NO cambian.
// "CRM" (1/10/2026) idem: lo que se les factura a las sedes por el WhatsApp del CRM (ingreso, desde
// Franquicias) netea lo que BIGG le paga a Meta por ese servicio (egreso en la cuenta "CRM" de gasto)
// → la fila "CRM" muestra solo el markup.
// Mapa: cuenta contra → fila de ingreso donde netea.
const ING_CONTRA_HQ = new Map([["Interusos", "Coorporativos"], ["Pauta", "Pauta"], ["CRM", "CRM"]]);
const BIGG_ORDEN_FIN = ["Intereses Ganados", "Perdidas Financieras"];
const BIGG_ORDEN_IMP = ["Plan Facilidades AFIP", "IVA", "IVA Compra", "Ganancias", "Otros Impuestos"];

// Cuentas de fee (gerenciamiento/WRE) que NO van en "Ingresos HQ" (ya son líneas de operación → no duplicar).
const BIGG_FEE_CUENTAS = ["Fee de Gestion y Adm", "Fee de Gestion y Adm (Huergo)"];

// P&L de HOLDING: arma el waterfall de management a partir de los RESULTADOS por negocio (resSedesAR/feeGer/
// resWRE, ya netos y pre-fin/pre-imp) + los grupos de HQ/financieros/impuestos que ya barrió buildPnLBigg.
// Convención de signo: igual que computeSubtotalsBigg (ingresos +, gastos/fin/imp positivos y se RESTAN).
function computeSubtotalsHolding(pnl, { resSedesAR, feeGer, resWRE }) {
  const Z = () => new Array(12).fill(0);
  // Cada negocio operativo llega como objeto { res, ivaDeb, ivaCred } (su resultado neto + el IVA que le sacó
  // a sus líneas). El holding suma esos IVA como cualquier otra línea → el empate Con/Sin sale por construcción.
  const cRes = c => (c && c.res) || Z(), cDeb = c => (c && c.ivaDeb) || Z(), cCred = c => (c && c.ivaCred) || Z();
  const sar = cRes(resSedesAR), fg = cRes(feeGer), wre = cRes(resWRE);
  const sumG = obj => MESES.map((_, m) => Object.values(obj || {}).reduce((s, a) => s + (a[m] || 0), 0));
  // Fees de operación y opex de Huergo ya no llegan acá: buildPnLBigg los descarta (entran por su motor).
  const hqAccounts  = pnl.grupos.hq;                             // ingresos HQ
  const ghqAccounts = pnl.grupos.ghq;                            // opex HQ por centro
  const gpvAccounts = pnl.grupos.gpv;                            // costo por venta HQ: Interusos, Fee Fact., compra Pauta
  const impuestos = sumG(pnl.grupos.imp);   // tributos reales (IVA saldo, Ganancias, etc.)
  const capexAccounts = pnl.grupos.capex;   // compra de operaciones: abajo del resultado, NO es gasto operativo
  const capex = sumG(capexAccounts);
  const ingHQ = sumG(hqAccounts), gpv = sumG(gpvAccounts), opexHQ = sumG(ghqAccounts),
        financieros = sumG(pnl.grupos.fin);
  const resOperaciones = MESES.map((_, m) => sar[m] + fg[m] + wre[m]);
  const resOpMasIngHQ  = MESES.map((_, m) => resOperaciones[m] + ingHQ[m]);   // Total Ingresos (waterfall corriente)
  const margen         = MESES.map((_, m) => resOpMasIngHQ[m] - gpv[m]);      // Margen de Contribución
  const resOpGrupo     = MESES.map((_, m) => margen[m] - opexHQ[m]);
  const resAntesImp    = MESES.map((_, m) => resOpGrupo[m] - financieros[m]);
  const resGrupoNeto   = MESES.map((_, m) => resAntesImp[m] - impuestos[m]);   // sin las líneas de IVA
  // IVA (solo modo Sin IVA): las líneas operativas van NETAS; las dos líneas de IVA devuelven el IVA embebido
  // → el Resultado del Grupo da IGUAL que Con IVA por construcción (sacar el IVA línea por línea y sumarlo
  // abajo = identidad). Débito (ventas, +) y Crédito (compras, −) son la columna REAL de IVA del núcleo
  // (cruzable AFIP): se suman de cada negocio (Sedes con el 49% de Barrio Norte cedido, Huergo, Gerenciamiento)
  // + HQ. No hay plug ni ancla: Débito − Crédito = el IVA que efectivamente se le sacó al resultado.
  const D = MESES.map((_, m) => cDeb(resSedesAR)[m] + cDeb(feeGer)[m] + cDeb(resWRE)[m] + (pnl.ivaDeb || Z())[m]);
  const C = MESES.map((_, m) => cCred(resSedesAR)[m] + cCred(feeGer)[m] + cCred(resWRE)[m] + (pnl.ivaCred || Z())[m]);
  const ivaDeb  = D;                    // mostrado sumando (+)
  const ivaCred = C.map(v => -v);       // mostrado restando (−)
  const resGrupo = MESES.map((_, m) => resGrupoNeto[m] + D[m] - C[m]);
  const resFinal = MESES.map((_, m) => resGrupo[m] - capex[m]);   // Resultado Final = después de inversiones/capex
  const months = new Set(); const cur = new Date().getMonth();
  for (let i = 0; i <= cur; i++) months.add(i);
  [sar, fg, wre, ingHQ, gpv, opexHQ, financieros, impuestos, capex].forEach(a => a.forEach((v, i) => { if (v) months.add(i); }));
  return { sar, fg, wre, hqAccounts, ghqAccounts, gpvAccounts, capexAccounts, ingHQ, gpv, opexHQ, financieros, impuestos, capex,
           ivaDeb, ivaCred,
           resOperaciones, resOpMasIngHQ, margen, resOpGrupo, resAntesImp, resGrupo, resFinal, activeMonths: [...months].sort((a, b) => a - b) };
}

export {
  BIGG_ORDEN,
  BIGG_ORDEN_FIN,
  BIGG_ORDEN_GHQ,
  BIGG_ORDEN_GPV,
  BIGG_ORDEN_IMP,
  CESION,
  CESION_CUENTA,
  COM_ENC_RATE,
  ING_CONTRA_HQ,
  MESES,
  PNL_INICIO,
  SEDES_COMISION_CC,
  SEDE_GRUPOS,
  SEDE_HDR,
  SEDE_ING_ACCTS,
  SEDE_OCULTAR_SI_VACIA,
  SEDE_OPEX_GRUPOS,
  VENTAS_EXCL_PRORR,
  _nkSede,
  buildPnLBigg,
  buildPnLHuergo,
  buildPnLSede,
  ccKey,
  computeCesion,
  computeSubtotalsHolding,
  computeSubtotalsHuergo,
  computeSubtotalsSede,
  familiaCentro,
  financiacionToPnLRows,
  grupoSede,
  montoPnL,
  movimientoToPnLRows,
  normCat,
  ordCmp,
  rellenarMesesSinActivas,
  sumVentasSede,
};
