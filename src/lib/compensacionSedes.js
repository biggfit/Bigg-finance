// src/lib/compensacionSedes.js — agregaciones del reporte "Compensación · Sedes", puras.
//
// Sin imports (misma regla que aguinaldo.js: corre en Node para verificar contra la hoja; por eso
// MESES_CORTO, normTxt y los roles se repiten acá en vez de importarse). La pantalla inyecta `ambitoLiq`
// y pasa las liquidaciones ya parseadas (fetchLiquidacionesCerradas), los legajos, los objetivos por mes
// (fetchObjetivos) y las tarifas por mes (fetchCategorias).
//
// Definiciones (Martín, 14/10 y 20/10/2026):
//  - Dos mundos: COACHES (cobran por hora) y FRONT DESK (encargados y ventas, sueldo fijo).
//  - La ESCALERA muestra cómo sube el sueldo escalón por escalón, de la base a lo pagado. Unidad:
//    $/h para coaches (todas las horas), $ por persona·mes para Front Desk.
//  - Base de un coach = TODAS sus horas a tarifa (la tarifa pura). Domingos, feriados, yoga y running
//    entran como el PLUS sobre la tarifa. Base de Front Desk = sueldo fijo.
//  - Novedades en cuatro grupos: comisión por resultado, clases especiales, referidos, otras. Clases especiales
//    (running, custom, programaciones) y otras (reemplazos, feriados, eventos) pagan trabajo cuyas horas NO están
//    cargadas: para coaches quedan FUERA del $/h (solo en el total y el sueldo promedio). Martín, 20/10.
//  - Se usan SOLO los campos CONGELADOS de la liquidación cerrada (no se recalcula con tarifas actuales).
//  - Fuera del reporte: Limpieza (100 % fijo, sin incentivos), roles HQ* y Huergo (sede y roles HUERGO_*).
//
// Flujo: filtrarSedes → mesesCerrados → filtrarSedeMundo → normalizarLiqs (desglose una sola vez, fijo
// contado una vez por legajo×mes) → rollupPersonaMes → porPuesto / porPersona / evolucionMensual → escalera;
// porSede y objetivosGrupales leen las filas normalizadas (reparto por sede).

// Un solo catálogo de roles: orden de presentación, etiqueta y tipo. Un rol desconocido cobra por hora.
export const ROLES = [
  { rol: "COACH_SENIOR", label: "Coach senior", tipo: "coach" },
  { rol: "COACH",        label: "BIGG coach",   tipo: "coach" },
  { rol: "YOGA",         label: "Yoga",         tipo: "coach" },
  { rol: "ENCARGADO",    label: "Encargado",    tipo: "fijo" },
  { rol: "VENTAS",       label: "Ventas",       tipo: "fijo" },
];
const ROL_INFO = new Map(ROLES.map(r => [r.rol, r]));
export const tipoRol  = (rol) => ROL_INFO.get(rol)?.tipo || "coach";
export const rolLabel = (rol) => ROL_INFO.get(rol)?.label || rol || "—";
const ordenRol = (rol) => { const i = ROLES.findIndex(r => r.rol === rol); return i < 0 ? 99 : i; };
const porOrdenRol = (a, b) => ordenRol(a.rol) - ordenRol(b.rol) || String(a.rol).localeCompare(String(b.rol));

// Los dos mundos del reporte. `unidad` dice contra qué se divide la escalera.
export const MUNDOS = [
  { key: "coaches", label: "Coaches",    tipo: "coach", unidad: "hora",    todosLabel: "Todos los coaches" },
  { key: "front",   label: "Front Desk", tipo: "fijo",  unidad: "persona", todosLabel: "Todo Front Desk" },
];
export const mundoDe = (key) => MUNDOS.find(m => m.key === key) || MUNDOS[0];
const baseDe = (tipo) => (tipo === "coach" ? "tarifa" : "fijo");

// Conceptos finos que se desglosan de cada liquidación (`m`). Se agrupan en ESCALONES para mostrar.
const CONCEPTOS = ["fijo", "tarifa", "adicionales", "cdp", "oneShot", "objetivos", "grupal", "novComision", "novClases", "novReferidos", "novOtras", "ajustes"];
const m0 = () => Object.fromEntries(CONCEPTOS.map(k => [k, 0]));

// Escalones de la escalera (Martín, 20/10: tarifa, CDP, grupal, asignados, referidos y otros con todo el resto).
// `de` = conceptos que suma. `label` puede depender del mundo. `fueraRatio`: para coaches no entra al $/h (va
// después de la línea "$/h con incentivos", como "además cobró"); para Front Desk se pliega en "otros".
export const ESCALONES = [
  { key: "fijo",      corto: "Fijo",      label: "Sueldo fijo",                                           de: ["fijo"] },
  { key: "tarifa",    corto: "Tarifa",    label: { coach: "Todas las horas a tarifa", fijo: "Clases dadas" }, de: ["tarifa"] },
  { key: "cdp",       corto: "CDP",       label: "CDP (clases de prueba convertidas)",                     de: ["cdp"] },
  { key: "grupal",    corto: "Grupal",    label: "Objetivo grupal",                                       de: ["grupal"] },
  { key: "asignados", corto: "Asignados", label: "Asignados (objetivos individuales)",                     de: ["objetivos"] },
  { key: "referidos", corto: "Referidos", label: "Referidos (novedad)",                                   de: ["novReferidos"] },
  { key: "otros",     corto: "Otros",     label: "Otros: plus por domingos y feriados, one shot, comisión por resultado, redondeo y ajustes",
    de: ["adicionales", "oneShot", "novComision", "ajustes"] },
  { key: "fuera",     corto: "Fuera",     label: "Clases especiales (running, custom, programaciones), reemplazos, feriados y eventos (novedades)",
    de: ["novClases", "novOtras"], fueraRatio: true },
];
const fueraRatio = (tipo, key) => tipo === "coach" && !!ESCALONES.find(e => e.key === key)?.fueraRatio;
export const labelEscalon = (e, tipo) => (typeof e.label === "string" ? e.label : e.label[tipo]);
// Monto de un escalón en un acumulado `m`. Para Front Desk, lo `fueraRatio` se pliega en "otros".
export function montoEscalon(m, e, tipo) {
  const sum = (keys) => keys.reduce((s, k) => s + (m[k] || 0), 0);
  if (e.fueraRatio && tipo !== "coach") return 0;
  return sum(e.de) + (e.key === "otros" && tipo !== "coach" ? sum(ESCALONES.find(x => x.fueraRatio).de) : 0);
}

export const MESES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const mesKey = (anio, mes) => `${anio}-${String(mes).padStart(2, "0")}`;
export const mesesConsecutivos = (a, b) => (b.anio * 12 + b.mes) - (a.anio * 12 + a.mes) === 1;
export const fmtPct = (x, signo = false) => (x == null ? "—" : `${signo && x > 0 ? "+" : ""}${Math.round(x * 100)} %`);
const num = (v) => Number(v) || 0;
const normTxt = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

// ── Novedades: cuatro grupos, por cuenta contable y, si no alcanza, por el texto cargado ──────────
export function clasificarNovedad(n) {
  const cta = normTxt(n.cuenta_contable_nombre), txt = normTxt(n.descripcion);
  if (/referid/.test(txt)) return "novReferidos";
  if (/resultado/.test(cta) || /comisi/.test(txt)) return "novComision";
  if (/honorarios/.test(cta) || /running|custom|programaci|clase|yoga|evento/.test(txt)) return "novClases";
  return "novOtras";
}

// ── Una liquidación cerrada → lo que el reporte necesita, solo con los campos congelados ────────────
// `m` = monto por concepto; `ajustes` absorbe redondeo y cualquier diferencia entre conceptos y lo pagado.
// `tarifaFallback`: tarifa de la persona ese mes (otra sede) para una liq que solo tiene domingos/feriados.
const tarifaLiq = (liq) => (num(liq.horas_cant) > 0 ? num(liq.horas_total) / num(liq.horas_cant) : num(liq.horas_monto_unit) || null);
export function desglosarLiqCongelada(liq, tarifaFallback = 0) {
  const horasRegular = num(liq.horas_cant);
  const horasAdic = num(liq.feriados_cant) + num(liq.domingos_cant) + num(liq.yoga_cant) + num(liq.running_cant);
  const tarifa = tarifaLiq(liq) ?? tarifaFallback;
  const adicionales = num(liq.feriados_total) + num(liq.domingos_total) + num(liq.yoga_total) + num(liq.running_total) + num(liq.programacion_total);
  const m = m0();
  m.fijo        = num(liq.sueldo_base);
  m.tarifa      = num(liq.horas_total) + tarifa * horasAdic;    // todas las horas a tarifa
  m.adicionales = adicionales - tarifa * horasAdic;             // solo el plus sobre la tarifa
  m.cdp         = num(liq.cdp_total) + num(liq.cdp_coach_total) + num(liq.cdp_front_total);
  m.oneShot     = num(liq.one_shot_total);
  m.objetivos   = num(liq.objetivos_total);
  m.grupal      = num(liq.bonos_total);
  for (const n of liq.novedades || []) m[clasificarNovedad(n)] += num(n.monto);
  const total = num(liq.total_bruto) + num(liq.total_novedades_extra);   // lo pagado manda (incluye novedades)
  m.ajustes = total - Object.values(m).reduce((s, v) => s + v, 0);
  return { horasRegular, horasTotal: horasRegular + horasAdic, m, total, grupalPct: num(liq.bonos_cant) };
}

// ── Alcance ───────────────────────────────────────────────────────────────────────────────────────
export const fueraDelReporte = ({ rol, sede_nombre }) =>
  /^(HQ|HUERGO|LIMPIEZA)/i.test(rol || "") || /huergo/i.test(sede_nombre || "");
export function filtrarSedes(liqs, { pais, anio, ambitoDe }) {
  return (liqs || []).filter(l =>
    ambitoDe(l) === "sedes" && !fueraDelReporte(l) && (!pais || !l.pais || l.pais === pais) && (anio == null || num(l.anio) === num(anio)));
}

// Meses con alguna liquidación cerrada, ordenados. Se excluye el mes calendario en curso (cierres
// parciales) salvo que sea el único.
export function mesesCerrados(liqsSedes, { excluirMesActual = null } = {}) {
  const map = new Map();
  for (const l of liqsSedes) {
    const k = mesKey(l.anio, l.mes);
    if (!map.has(k)) map.set(k, { key: k, mes: num(l.mes), anio: num(l.anio), label: `${MESES_CORTO[num(l.mes) - 1]} ${l.anio}` });
  }
  const out = [...map.values()].sort((a, b) => a.anio - b.anio || a.mes - b.mes);
  const ka = excluirMesActual ? mesKey(excluirMesActual.anio, excluirMesActual.mes) : null;
  return ka && out.length > 1 ? out.filter(e => e.key !== ka) : out;
}

// Filtros de la vista: período (Set de keys de mes), sede (una persona multi-sede muestra solo lo de
// esa sede) y mundo (tipo de rol).
export function filtrarSedeMundo(liqsSedes, { meses = null, sede_id = "", tipo = "coach" } = {}) {
  return liqsSedes.filter(l =>
    (!meses || meses.has(mesKey(l.anio, l.mes))) && (!sede_id || String(l.sede_id ?? "") === String(sede_id)) && tipoRol(l.rol) === tipo);
}
export function sedesDisponibles(liqsSedes) {
  const m = new Map();
  for (const l of liqsSedes) { const k = String(l.sede_id ?? ""); if (k && !m.has(k)) m.set(k, l.sede_nombre || k); }
  return [...m.entries()].map(([sede_id, sede_nombre]) => ({ sede_id, sede_nombre })).sort((a, b) => a.sede_nombre.localeCompare(b.sede_nombre, "es"));
}

// ── Normalización: una fila por liquidación, desglosada una sola vez ─────────────────────────────
// El fijo se cuenta UNA vez por persona y mes: Liquidación Sedes estampa sueldo_base en todas las sedes
// del legajo. Si aparece en más de una, queda en la de mayor fijo, se descuenta del total de las otras
// y se avisa. Así todos los agregados (por puesto, por sede, por persona) cierran entre sí.
export function normalizarLiqs(liqsSedes) {
  const porPersonaMes = new Map();
  for (const liq of liqsSedes) {
    const k = `${liq.legajo_id}|${mesKey(liq.anio, liq.mes)}`;
    if (!porPersonaMes.has(k)) porPersonaMes.set(k, []);
    porPersonaMes.get(k).push({ liq, d: null, aviso: null });
  }
  for (const grupo of porPersonaMes.values()) {
    const tarifa = Math.max(0, ...grupo.map(f => tarifaLiq(f.liq) || 0));
    for (const f of grupo) f.d = desglosarLiqCongelada(f.liq, tarifa);
  }
  const filas = [...porPersonaMes.values()].flat();
  for (const grupo of porPersonaMes.values()) {
    const conFijo = grupo.filter(f => f.d.m.fijo > 0);
    if (conFijo.length < 2) continue;
    const mayor = conFijo.reduce((a, b) => (b.d.m.fijo > a.d.m.fijo ? b : a));
    for (const f of conFijo) if (f !== mayor) f.d = { ...f.d, total: f.d.total - f.d.m.fijo, m: { ...f.d.m, fijo: 0 } };
    mayor.aviso = "sueldo fijo en más de una sede (contado una vez)";
  }
  return filas;
}

// ── Acumulador común y ratios ───────────────────────────────────────────────────────────────────
const acc0 = () => ({ horasRegular: 0, horasTotal: 0, total: 0, m: m0() });
const acumular = (x, d) => {
  x.horasRegular += d.horasRegular; x.horasTotal += d.horasTotal; x.total += d.total;
  for (const k in d.m) x.m[k] += d.m[k];
};
// `personasMes` = cantidad de persona×mes con sueldo (divisor de los promedios mensuales).
// `unidad` = divisor de la escalera: horas totales (coach) o persona×mes (fijo).
// `baseUnidad` → `finalUnidad` es el "de dónde a dónde" del mundo: $/h de tarifa → $/h con incentivos (sin los
// escalones `fueraRatio`), o fijo por mes → total por mes.
function ratios(x, tipo, personasMes) {
  const unidad = tipo === "coach" ? x.horasTotal : personasMes;
  const base = x.m[baseDe(tipo)];
  const enRatio = x.total - ESCALONES.filter(e => fueraRatio(tipo, e.key)).reduce((s, e) => s + montoEscalon(x.m, e, tipo), 0);
  const baseUnidad = unidad ? base / unidad : null, finalUnidad = unidad ? enRatio / unidad : null;
  return {
    ...x, personasMes, unidad, baseUnidad, finalUnidad,
    mejoraPct:       baseUnidad && finalUnidad ? finalUnidad / baseUnidad - 1 : null,
    promedioMensual: personasMes ? x.total / personasMes : 0,
    horasPorMes:     personasMes ? x.horasTotal / personasMes : 0,
    pctIncentivos:   x.total > 0 ? (x.total - base) / x.total : 0,
  };
}

// ── Una fila por legajo × mes (suma sus sedes) ──────────────────────────────────────────────────────
export function rollupPersonaMes(filas, legajos = []) {
  const legById = new Map((legajos || []).map(l => [l.id, l]));
  const map = new Map(), aux = new Map();
  for (const { liq: l, d, aviso } of filas) {
    const k = `${l.legajo_id}|${mesKey(l.anio, l.mes)}`;
    if (!map.has(k)) {
      map.set(k, { legajo_id: l.legajo_id, nombre: l.legajo_nombre || legById.get(l.legajo_id)?.nombre || l.legajo_id,
        mesKey: mesKey(l.anio, l.mes), ...acc0(), avisos: [] });
      aux.set(k, { rolFijo: null, rolHoras: null, maxHoras: -1 });
    }
    const p = map.get(k), a = aux.get(k);
    acumular(p, d);
    if (aviso) p.avisos.push(aviso);
    // Rol de la persona en el mes: el de la liq con sueldo fijo; si no, el de más horas regulares.
    if (d.m.fijo > 0) a.rolFijo = l.rol;
    if (d.horasRegular > a.maxHoras) { a.maxHoras = d.horasRegular; a.rolHoras = l.rol; }
  }
  return [...map.entries()].map(([k, p]) => {
    const a = aux.get(k);
    const rol = a.rolFijo || a.rolHoras || legById.get(p.legajo_id)?.rol || "";
    return { ...p, rol, tipo: tipoRol(rol) };
  }).sort((a, b) => a.mesKey.localeCompare(b.mesKey) || a.nombre.localeCompare(b.nombre, "es"));
}

// Agregado de filas persona×mes de un mismo tipo.
function agregar(personasMes, tipo) {
  const x = acc0(), personas = new Set();
  for (const p of personasMes) { acumular(x, p); personas.add(p.legajo_id); }
  return { tipo, personas: personas.size, ...ratios(x, tipo, personasMes.length) };
}

// ── Por puesto (+ total del mundo: sirve de KPIs) ─────────────────────────────────────────────────
// `filas` es la lista a mostrar: un rol por fila y, si hay más de uno, el total con `_sub`.
export function porPuesto(personasMes, mundo) {
  const total = { rol: "__todos", label: mundo.todosLabel, ...agregar(personasMes, mundo.tipo) };
  const filas = [...new Set(personasMes.map(p => p.rol))].map(rol => ({ rol })).sort(porOrdenRol)
    .map(({ rol }) => ({ rol, label: rolLabel(rol), ...agregar(personasMes.filter(p => p.rol === rol), mundo.tipo) }));
  if (filas.length > 1) filas.push({ ...total, _sub: true });
  return { filas, total, avisos: personasMes.filter(p => p.avisos.length).length };
}

// ── Escalera: de la base a lo pagado, escalón por escalón ────────────────────────────────────────
// `columnas` son agregados (por puesto, por mes…) con `m`, `total`, `unidad` y `personasMes`. Devuelve los
// escalones presentes (monto ≠ 0 en alguna columna), en orden, y por columna el monto, el acumulado y ambos por
// unidad. El primer escalón es la base del mundo; los `fueraRatio` (coaches) van al final y no entran al
// acumulado por unidad: se muestran por persona y mes.
export function escalera(columnas, tipo) {
  const pasos = ESCALONES.filter(e => columnas.some(c => Math.round(montoEscalon(c.m, e, tipo)) !== 0))
    .map(e => ({ key: e.key, corto: e.corto, label: labelEscalon(e, tipo), base: e.key === baseDe(tipo), fueraRatio: fueraRatio(tipo, e.key), def: e }));
  return {
    pasos,
    columnas: columnas.map(c => {
      let acum = 0;
      return { ...c, pasos: pasos.map(p => {
        const monto = montoEscalon(c.m, p.def, tipo);
        if (!p.fueraRatio) acum += monto;
        return { key: p.key, monto, acum, porUnidad: c.unidad ? monto / c.unidad : null, acumUnidad: c.unidad ? acum / c.unidad : null,
          porPersonaMes: c.personasMes ? monto / c.personasMes : null, pctTotal: c.total ? monto / c.total : 0 };
      }) };
    }),
  };
}

// ── Por sede (una persona multi-sede se reparte entre sus sedes) ─────────────────────────────────
export function porSede(filas, tipo) {
  const map = new Map();
  const nuevo = (extra) => ({ ...extra, ...acc0(), personas: new Set(), personasMes: new Set() });
  for (const { liq: l, d } of filas) {
    const k = String(l.sede_id ?? "");
    if (!map.has(k)) map.set(k, nuevo({ sede_id: k, sede_nombre: l.sede_nombre || k, porRol: new Map() }));
    const s = map.get(k);
    if (!s.porRol.has(l.rol)) s.porRol.set(l.rol, nuevo({ rol: l.rol, label: rolLabel(l.rol) }));
    const r = s.porRol.get(l.rol), pm = `${l.legajo_id}|${mesKey(l.anio, l.mes)}`;
    for (const x of [s, r]) { acumular(x, d); x.personas.add(l.legajo_id); x.personasMes.add(pm); }
  }
  const cerrar = (x) => ({ ...ratios(x, tipo, x.personasMes.size), personas: x.personas.size, personasMes: x.personasMes.size });
  return [...map.values()].map(({ porRol, ...sede }) => ({
    ...cerrar(sede), roles: [...porRol.values()].map(cerrar).sort(porOrdenRol),
  })).sort((a, b) => b.total - a.total);
}

// ── Por persona ──────────────────────────────────────────────────────────────────────────────────
export function porPersona(personasMes) {
  const map = new Map();
  for (const p of personasMes) {
    if (!map.has(p.legajo_id)) map.set(p.legajo_id, { legajo_id: p.legajo_id, nombre: p.nombre, rol: p.rol, tipo: p.tipo, label: rolLabel(p.rol), meses: 0, ...acc0() });
    const x = map.get(p.legajo_id); acumular(x, p); x.meses++;
  }
  return [...map.values()].map(x => ({ ...x, ...ratios(x, x.tipo, x.meses) }))
    .sort((a, b) => porOrdenRol(a, b) || b.promedioMensual - a.promedioMensual);
}

// ── Evolución mensual ────────────────────────────────────────────────────────────────────────────
// Tarifa de un concepto en el array de categorías del mes (match sin acentos ni mayúsculas).
export const tarifaDe = (categorias, concepto) =>
  num((categorias || []).find(c => normTxt(c.concepto) === normTxt(concepto))?.monto) || null;

export function evolucionMensual(personasMes, meses, tipo, tarifasPorMes = {}) {
  return meses.map(me => ({ ...me,
    ...agregar(personasMes.filter(p => p.mesKey === me.key), tipo),
    tarifaSenior: tipo === "coach" ? tarifaDe(tarifasPorMes[me.key], "COACH SENIOR") : null,
  }));
}

// ── Objetivo grupal: sede × mes ──────────────────────────────────────────────────────────────────
// Fuente del % = su_objetivos (0 / sin fila = no se cumplió), cruzado con el % pagado en las
// liquidaciones (bonos_cant) y el monto.
export function objetivosGrupales(filas, objetivosPorMes = {}, meses = []) {
  const sedes = new Map(), celdas = {};
  const addSede = (id, nombre) => { const k = String(id ?? ""); if (k && !sedes.has(k)) sedes.set(k, { sede_id: k, sede_nombre: nombre || k }); };
  const celda = (k) => (celdas[k] ??= { pctConfig: null, pctPagado: 0, monto: 0 });
  for (const { liq: l, d } of filas) {
    addSede(l.sede_id, l.sede_nombre);
    if (d.m.grupal <= 0) continue;
    const c = celda(`${l.sede_id}|${mesKey(l.anio, l.mes)}`);
    c.monto += d.m.grupal; c.pctPagado = Math.max(c.pctPagado, d.grupalPct);
  }
  for (const me of meses) {
    for (const o of (objetivosPorMes[me.key] || [])) {
      if (fueraDelReporte(o)) continue;
      addSede(o.sede_id, o.sede_nombre);
      celda(`${o.sede_id}|${me.key}`).pctConfig = num(o.porcentaje);
    }
  }
  const totalMes = {};
  for (const [k, c] of Object.entries(celdas)) {
    c.pct = c.pctConfig ?? c.pctPagado;
    c.cumplido = c.pct > 0 || c.monto > 0;
    c.inconsistente = c.pctConfig != null && c.pctPagado > 0 && c.pctConfig !== c.pctPagado;
    const mk = k.split("|")[1]; totalMes[mk] = (totalMes[mk] || 0) + c.monto;
  }
  const lista = [...sedes.values()].sort((a, b) => a.sede_nombre.localeCompare(b.sede_nombre, "es"))
    .map(s => ({ ...s, cumplidos: meses.filter(me => celdas[`${s.sede_id}|${me.key}`]?.cumplido).length }));
  return { sedes: lista, celdas, totalMes, total: Object.values(totalMes).reduce((s, v) => s + v, 0) };
}

// ── Lecturas: una frase por visual, sin superlativos ──────────────────────────────────────────────
const fp = (n) => "$" + Math.round(num(n)).toLocaleString("es-AR");
export function lecturas({ mundo, puesto, esc, sedes, evolucion, objetivos, meses }) {
  const out = {};
  const coach = mundo.tipo === "coach", u = coach ? "/h" : " por mes";
  const t = puesto.total;
  if (t.personas) {
    const quien = coach ? "Los coaches" : "Front Desk";
    out.puesto = `${quien}: ${fp(t.baseUnidad)}${u} de ${coach ? "tarifa" : "fijo"} y ${fp(t.finalUnidad)}${u} con todos los incentivos (${fmtPct(t.mejoraPct, true)})` +
      (coach ? `, trabajando ${Math.round(t.horasPorMes)} h por mes en promedio.` : `; ${fmtPct(t.pctIncentivos)} de lo cobrado son incentivos.`);
    const col = esc.columnas[esc.columnas.length - 1];
    const mayor = col?.pasos.filter(p => p.key !== baseDe(mundo.tipo) && !fueraRatio(mundo.tipo, p.key)).reduce((a, b) => (b.monto > (a?.monto ?? -Infinity) ? b : a), null);
    if (mayor) {
      const e = esc.pasos.find(p => p.key === mayor.key);
      out.escalera = `El escalón que más suma es ${e.label.toLowerCase()}: ${fp(mayor.porUnidad)}${u}, ${fmtPct(mayor.pctTotal)} de lo pagado.`;
    }
  } else out.puesto = "Sin liquidaciones en el período.";
  if (sedes.length) {
    const max = sedes.reduce((a, b) => (a.pctIncentivos >= b.pctIncentivos ? a : b));
    const min = sedes.reduce((a, b) => (a.pctIncentivos <= b.pctIncentivos ? a : b));
    out.sede = `${sedes[0].sede_nombre} es la sede de mayor masa salarial (${fp(sedes[0].total)}). ` +
      `La proporción de incentivos va de ${fmtPct(min.pctIncentivos)} en ${min.sede_nombre} a ${fmtPct(max.pctIncentivos)} en ${max.sede_nombre}.`;
  }
  if (evolucion.length >= 2) {
    const a = evolucion[0], b = evolucion[evolucion.length - 1], base = coach ? "la tarifa" : "el fijo";
    const baseIgual = Math.round(a.baseUnidad) === Math.round(b.baseUnidad);
    out.evolucion = `De ${a.label} a ${b.label}, ${baseIgual ? `con ${base} en ${fp(a.baseUnidad)}${u},` : `${base} pasó de ${fp(a.baseUnidad)}${u} a ${fp(b.baseUnidad)}${u} y`} ` +
      `el promedio con incentivos ${baseIgual ? "pasó" : ""} de ${fp(a.finalUnidad)}${u} a ${fp(b.finalUnidad)}${u}.`;
  } else if (evolucion.length === 1) {
    out.evolucion = `Un solo mes cerrado (${evolucion[0].label}); la evolución se completa con los próximos cierres.`;
  }
  if (objetivos.sedes.length && meses.length) {
    const todos = objetivos.sedes.filter(s => s.cumplidos === meses.length).map(s => s.sede_nombre);
    const ninguno = objetivos.sedes.filter(s => s.cumplidos === 0).map(s => s.sede_nombre);
    out.objetivos = (todos.length ? `${todos.join(", ")} cobraron objetivo grupal ${meses.length > 1 ? `los ${meses.length} meses` : "este mes"}. ` : "") +
      (ninguno.length ? `${ninguno.join(", ")} no lo cobraron${meses.length > 1 ? " en ningún mes" : ""}. ` : "") +
      `En total se pagaron ${fp(objetivos.total)} de objetivo grupal.`;
  }
  return out;
}
