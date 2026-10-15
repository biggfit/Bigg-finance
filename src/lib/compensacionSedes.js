// src/lib/compensacionSedes.js — agregaciones del reporte "Compensación · Sedes", puras.
//
// Sin imports (misma regla que aguinaldo.js: corre en Node para verificar contra la hoja; por eso
// MESES_CORTO, normTxt y los roles se repiten acá en vez de importarse). La pantalla inyecta `ambitoLiq`
// y pasa las liquidaciones ya parseadas (fetchLiquidacionesCerradas), los legajos, los objetivos por mes
// (fetchObjetivos) y las tarifas por mes (fetchCategorias).
//
// Definiciones (Martín, 14/10/2026):
//  - $/h BASE de un coach = tarifa pura: horas_total / horas_cant (solo horas regulares).
//  - $/h CON INCENTIVOS = (total_bruto + novedades) / (regulares + feriados + domingos + yoga + running).
//  - Incentivos = todo lo que no es base (base = horas a tarifa para coaches, sueldo fijo para fijos).
//  - Fijos (encargado, ventas, limpieza): sin $/h (no hay horas contratadas); promedio mensual.
//  - Se usan SOLO los campos CONGELADOS de la liquidación cerrada (no se recalcula con tarifas actuales).
//  - Fuera del reporte: roles HQ* (gente de HQ que dio alguna clase) y Huergo (sede y roles HUERGO_*).
//
// Flujo: filtrarSedes → mesesCerrados → filtrarSedePuesto → normalizarLiqs (desglose una sola vez, fijo
// contado una vez por legajo×mes) → rollupPersonaMes → porPuesto / porPersona / evolucionMensual;
// porSede y objetivosGrupales leen las filas normalizadas (reparto por sede).

// Un solo catálogo de roles: orden de presentación, etiqueta, tipo y grupo del selector de puesto.
// Un rol desconocido cobra por hora (coach).
export const ROLES = [
  { rol: "COACH_SENIOR", label: "Coach senior", tipo: "coach" },
  { rol: "COACH",        label: "Coach",        tipo: "coach" },
  { rol: "YOGA",         label: "Yoga",         tipo: "coach" },
  { rol: "ENCARGADO",    label: "Encargado",    tipo: "fijo", grupo: "Encargados", grupal: true },
  { rol: "VENTAS",       label: "Ventas",       tipo: "fijo", grupo: "Ventas",     grupal: true },
  { rol: "LIMPIEZA",     label: "Limpieza",     tipo: "fijo", grupo: "Limpieza",   grupal: false },
];
const ROL_INFO = new Map(ROLES.map(r => [r.rol, r]));
export const tipoRol  = (rol) => ROL_INFO.get(rol)?.tipo || "coach";
export const rolLabel = (rol) => ROL_INFO.get(rol)?.label || rol || "—";
const ordenRol = (rol) => { const i = ROLES.findIndex(r => r.rol === rol); return i < 0 ? 99 : i; };
const porOrdenRol = (a, b) => ordenRol(a.rol) - ordenRol(b.rol) || String(a.rol).localeCompare(String(b.rol));

export const MESES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
export const mesKey = (anio, mes) => `${anio}-${String(mes).padStart(2, "0")}`;
export const mesesConsecutivos = (a, b) => (b.anio * 12 + b.mes) - (a.anio * 12 + a.mes) === 1;
export const fmtPct = (x, signo = false) => (x == null ? "—" : `${signo && x > 0 ? "+" : ""}${Math.round(x * 100)} %`);
const num = (v) => Number(v) || 0;

// ── Una liquidación cerrada → lo que el reporte necesita, solo con los campos congelados ────────────
export function desglosarLiqCongelada(liq) {
  const horasRegular = num(liq.horas_cant);
  return {
    horasRegular,
    horasTotal: horasRegular + num(liq.feriados_cant) + num(liq.domingos_cant) + num(liq.yoga_cant) + num(liq.running_cant),
    fijo:       num(liq.sueldo_base),
    horasBase:  num(liq.horas_total),
    grupal:     num(liq.bonos_total),
    grupalPct:  num(liq.bonos_cant),
    total:      num(liq.total_bruto) + num(liq.total_novedades_extra),   // lo pagado manda (incluye novedades)
  };
}

// ── Alcance ───────────────────────────────────────────────────────────────────────────────────────
export const fueraDelReporte = ({ rol, sede_nombre }) =>
  /^(HQ|HUERGO)/i.test(rol || "") || /huergo/i.test(sede_nombre || "");
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
// esa sede) y puesto (grupos del selector; `grupal` = el grupo cobra objetivo grupal).
export const GRUPOS_PUESTO = [
  { key: "todos",   label: "Todos los puestos", grupal: true, match: () => true },
  { key: "coaches", label: "Coaches",           grupal: true, match: (rol) => tipoRol(rol) === "coach" },
  ...ROLES.filter(r => r.tipo === "fijo").map(r => ({ key: r.rol.toLowerCase(), label: r.grupo, grupal: r.grupal, match: (rol) => rol === r.rol })),
];
export function filtrarSedePuesto(liqsSedes, { meses = null, sede_id = "", puesto = "todos" } = {}) {
  const g = GRUPOS_PUESTO.find(x => x.key === puesto) || GRUPOS_PUESTO[0];
  return liqsSedes.filter(l =>
    (!meses || meses.has(mesKey(l.anio, l.mes))) && (!sede_id || String(l.sede_id ?? "") === String(sede_id)) && g.match(l.rol));
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
  const filas = liqsSedes.map(liq => ({ liq, d: desglosarLiqCongelada(liq), aviso: null }));
  const porPersonaMes = new Map();
  for (const f of filas) {
    const k = `${f.liq.legajo_id}|${mesKey(f.liq.anio, f.liq.mes)}`;
    if (!porPersonaMes.has(k)) porPersonaMes.set(k, []);
    porPersonaMes.get(k).push(f);
  }
  for (const grupo of porPersonaMes.values()) {
    const conFijo = grupo.filter(f => f.d.fijo > 0);
    if (conFijo.length < 2) continue;
    const mayor = conFijo.reduce((a, b) => (b.d.fijo > a.d.fijo ? b : a));
    for (const f of conFijo) if (f !== mayor) f.d = { ...f.d, total: f.d.total - f.d.fijo, fijo: 0 };
    mayor.aviso = "sueldo fijo en más de una sede (contado una vez)";
  }
  return filas;
}

// ── Acumulador común y ratios ───────────────────────────────────────────────────────────────────
const acc0 = () => ({ horasRegular: 0, horasTotal: 0, fijo: 0, horasBase: 0, total: 0 });
const acumular = (x, d) => { x.horasRegular += d.horasRegular; x.horasTotal += d.horasTotal; x.fijo += d.fijo; x.horasBase += d.horasBase; x.total += d.total; };
// `personasMes` = cantidad de persona×mes con sueldo (divisor de los promedios mensuales).
// tipo "mixto" (una sede entera): la base es fijo + horas a tarifa y no hay $/h propio.
function ratios(x, tipo, personasMes) {
  const esCoach = tipo === "coach";
  const base = tipo === "mixto" ? x.fijo + x.horasBase : esCoach ? x.horasBase : x.fijo;
  const porHoraBase       = esCoach && x.horasRegular > 0 ? x.horasBase / x.horasRegular : null;
  const porHoraIncentivos = esCoach && x.horasTotal > 0 ? x.total / x.horasTotal : null;
  return {
    ...x, personasMes, porHoraBase, porHoraIncentivos,
    mejoraPct:       porHoraBase && porHoraIncentivos ? porHoraIncentivos / porHoraBase - 1 : null,
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
    if (d.fijo > 0) a.rolFijo = l.rol;
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

// ── Por puesto (+ totales del período: sirve de KPIs) ──────────────────────────────────────────────
// `filas` es la lista a mostrar: roles coach, subtotal coaches (si hay más de un rol), roles fijos,
// subtotal fijos. Los subtotales llevan `_sub`.
export function porPuesto(personasMes) {
  const porTipo = (tipo) => personasMes.filter(p => p.tipo === tipo);
  const coaches = { rol: "__coaches", label: "Todos los coaches", ...agregar(porTipo("coach"), "coach") };
  const fijos   = { rol: "__fijos",   label: "Todos los fijos",   ...agregar(porTipo("fijo"),  "fijo") };
  const filas = [];
  for (const sub of [coaches, fijos]) {
    const roles = [...new Set(porTipo(sub.tipo).map(p => p.rol))].map(rol => ({ rol })).sort(porOrdenRol)
      .map(({ rol }) => ({ rol, label: rolLabel(rol), ...agregar(personasMes.filter(p => p.rol === rol), sub.tipo) }));
    filas.push(...roles);
    if (roles.length > 1) filas.push({ ...sub, _sub: true });
  }
  const total = coaches.total + fijos.total;
  return {
    filas, coaches, fijos, total,
    personas: new Set(personasMes.map(p => p.legajo_id)).size,
    pctIncentivos: total > 0 ? (total - coaches.horasBase - fijos.fijo) / total : 0,
    avisos: personasMes.filter(p => p.avisos.length).length,
  };
}

// ── Por sede (una persona multi-sede se reparte entre sus sedes) ─────────────────────────────────
export function porSede(filas) {
  const map = new Map();
  const nuevo = (extra) => ({ ...extra, ...acc0(), personas: new Set(), personasMes: new Set() });
  for (const { liq: l, d } of filas) {
    const k = String(l.sede_id ?? "");
    if (!map.has(k)) map.set(k, nuevo({ sede_id: k, sede_nombre: l.sede_nombre || k, coaches: acc0(), porRol: new Map() }));
    const s = map.get(k), tipo = tipoRol(l.rol);
    if (!s.porRol.has(l.rol)) s.porRol.set(l.rol, nuevo({ rol: l.rol, label: rolLabel(l.rol), tipo }));
    const r = s.porRol.get(l.rol), pm = `${l.legajo_id}|${mesKey(l.anio, l.mes)}`;
    for (const x of [s, r]) { acumular(x, d); x.personas.add(l.legajo_id); x.personasMes.add(pm); }
    if (tipo === "coach") acumular(s.coaches, d);
  }
  const cerrar = (x, tipo) => ({ ...ratios(x, tipo, x.personasMes.size), personas: x.personas.size, personasMes: x.personasMes.size });
  return [...map.values()].map(s => {
    const { coaches, porRol, ...sede } = s;
    const deCoaches = ratios(coaches, "coach", 0);   // $/h de la sede = el de sus coaches
    return {
      ...cerrar(sede, "mixto"),
      porHoraBase: deCoaches.porHoraBase, porHoraIncentivos: deCoaches.porHoraIncentivos,
      roles: [...porRol.values()].map(r => cerrar(r, r.tipo)).sort(porOrdenRol),
    };
  }).sort((a, b) => b.total - a.total);
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
const normTxt = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
export const tarifaDe = (categorias, concepto) =>
  num((categorias || []).find(c => normTxt(c.concepto) === normTxt(concepto))?.monto) || null;

export function evolucionMensual(personasMes, meses, tarifasPorMes = {}) {
  return meses.map(me => {
    const delMes = personasMes.filter(p => p.mesKey === me.key);
    return { ...me,
      coaches: agregar(delMes.filter(p => p.tipo === "coach"), "coach"),
      fijos:   agregar(delMes.filter(p => p.tipo === "fijo"),  "fijo"),
      tarifaSenior: tarifaDe(tarifasPorMes[me.key], "COACH SENIOR") };
  });
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
    if (d.grupal <= 0) continue;
    const c = celda(`${l.sede_id}|${mesKey(l.anio, l.mes)}`);
    c.monto += d.grupal; c.pctPagado = Math.max(c.pctPagado, d.grupalPct);
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
export function lecturas({ puesto, sedes, evolucion, objetivos, meses }) {
  const out = {};
  const c = puesto.coaches, f = puesto.fijos;
  const fraseCoaches = c.personas
    ? (c.porHoraBase
      ? `Los coaches cobran ${fp(c.porHoraBase)}/h de tarifa y ${fp(c.porHoraIncentivos)}/h con todos los incentivos (${fmtPct(c.mejoraPct, true)}), trabajando ${Math.round(c.horasPorMes)} h por mes en promedio.`
      : "Los coaches del período no tienen horas regulares liquidadas.")
    : "";
  const fraseFijos = f.personas
    ? `Los fijos cobran en promedio ${fp(f.promedioMensual)} por mes; ${fmtPct(f.pctIncentivos)} son incentivos.`
    : "";
  out.puesto = [fraseCoaches, fraseFijos].filter(Boolean).join(" ") || "Sin liquidaciones en el período.";
  if (sedes.length) {
    const max = sedes.reduce((a, b) => (a.pctIncentivos >= b.pctIncentivos ? a : b));
    const min = sedes.reduce((a, b) => (a.pctIncentivos <= b.pctIncentivos ? a : b));
    out.sede = `${sedes[0].sede_nombre} es la sede de mayor masa salarial (${fp(sedes[0].total)}). ` +
      `La proporción de incentivos va de ${fmtPct(min.pctIncentivos)} en ${min.sede_nombre} a ${fmtPct(max.pctIncentivos)} en ${max.sede_nombre}.`;
  }
  if (evolucion.length >= 2) {
    const a = evolucion[0].coaches, b = evolucion[evolucion.length - 1].coaches;
    out.evolucion = `De ${evolucion[0].label} a ${evolucion[evolucion.length - 1].label} la tarifa de los coaches pasó de ${fp(a.porHoraBase)}/h a ${fp(b.porHoraBase)}/h ` +
      `y el promedio con incentivos de ${fp(a.porHoraIncentivos)}/h a ${fp(b.porHoraIncentivos)}/h.`;
  } else if (evolucion.length === 1) {
    out.evolucion = `Un solo mes cerrado (${evolucion[0].label}); la evolución se completa con los próximos cierres.`;
  }
  if (objetivos.sedes.length && meses.length) {
    const todos = objetivos.sedes.filter(s => s.cumplidos === meses.length).map(s => s.sede_nombre);
    const ninguno = objetivos.sedes.filter(s => s.cumplidos === 0).map(s => s.sede_nombre);
    out.objetivos = (todos.length ? `${todos.join(", ")} cobraron objetivo grupal los ${meses.length} meses. ` : "") +
      (ninguno.length ? `${ninguno.join(", ")} no lo cobraron en ningún mes. ` : "") +
      `En total se pagaron ${fp(objetivos.total)} de objetivo grupal en el período.`;
  }
  return out;
}
