// src/lib/aguinaldo.js — cálculo del aguinaldo (SAC), puro.
//
// NO importa sueldosApi (que evalúa import.meta.env) para poder correrse en Node y verificar
// contra la hoja. La pantalla inyecta `devengadoDe` (= devengadoPorFormaYSociedad) y
// `esCuentaBase` (= flag `base_aguinaldo` de nb_cuentas, por nombre).
//
// Reglas (Martín, 14/10/2026):
//  - Base = MEJOR MES del semestre: 50 % de la mayor base remunerativa mensual.
//  - Remunerativo = SOLO por cuenta contable (flag base_aguinaldo). Nada por concepto.
//  - Proporcional a MESES CON SUELDO (no a días ni a fechas): un mes cuenta si la persona tiene
//    liquidación cerrada con base > 0 ese mes en ese ámbito. Los meses del semestre que todavía
//    no están cerrados para nadie (típicamente diciembre al calcular) se ASUMEN con sueldo si la
//    persona cobró el último mes cerrado y no tiene baja antes.
//  - Dado de baja al mes de pago (fecha_baja anterior, o inactivo) → NO cobra: la liquidación
//    final ya incluyó el proporcional.
//  - Reparto haberes/efectivo: lo decide Martín por semestre; acá solo un DEFAULT editable.
//  - El aguinaldo entra como NOVEDADES del mes de pago con cuenta "Aguinaldos".
//  - Este año no se provisiona mes a mes: `calcularAguinaldo` queda reutilizable para 2027.

export const SEMESTRES = {
  1: { meses: [1, 2, 3, 4, 5, 6],    mesPago: 6,  label: "1º semestre", corto: "Jun" },
  2: { meses: [7, 8, 9, 10, 11, 12], mesPago: 12, label: "2º semestre", corto: "Dic" },
};
export const CUENTA_AGUINALDO = { id: "CUENTA_Aguinaldos", nombre: "Aguinaldos" };
// Cuentas base FIJAS (Martín, 14/10): lo imputado a estas cuentas es remunerativo. Se suman las que se
// tilden como "Base para aguinaldo" en Maestros, si las hubiera.
export const CUENTAS_BASE_FIJAS = ["Sueldos", "Comisiones", "Incentivos", "Comision S/Resultado"];
export const MESES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// Normalizador de texto compartido (sueldosApi lo re-exporta como claveNorm).
export const normTxt = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
export const esCuentaAguinaldo = (id, nombre) =>
  String(id ?? "") === CUENTA_AGUINALDO.id || normTxt(nombre) === normTxt(CUENTA_AGUINALDO.nombre);
export const esNovedadAguinaldo = (n) => esCuentaAguinaldo(n?.cuenta_contable_id, n?.cuenta_contable_nombre);
export const semestreDeMes = (mes) => (Number(mes) <= 6 ? 1 : 2);
export const descripcionAguinaldo = (anio, semestre, forma) =>
  `Aguinaldo ${SEMESTRES[semestre].label} ${anio}${forma ? ` (${forma})` : ""}`;

// Ámbito de una novedad: HQ = sin sede, Sedes = con sede. Una sola definición para las pantallas de
// Novedades (HQ/Sedes) y Aguinaldo; las de aguinaldo (cuenta Aguinaldos) viven en su propia pantalla.
export const ambitoNovedad = (n) => (n?.sede_id ? "sedes" : "hq");
export const novedadesDeAmbito = (novs, ambito) =>
  (novs || []).filter(n => n.tipo === "extra" && ambitoNovedad(n) === ambito && !esNovedadAguinaldo(n));

// ¿El legajo está vigente en el mes? Entra si su alta (o ingreso, si no hay alta) es anterior al fin
// del mes y si no tiene baja o la baja es posterior al inicio del mes. Sin fechas → vigente (como
// siempre). La usan Liquidación HQ/Sedes para sembrar el mes (vía sueldosApi, que la re-exporta) y
// acá para los avisos y para asumir los meses todavía no cerrados.
export function legajoVigenteEnMes(leg, mes, anio) {
  const m = Number(mes), a = Number(anio);
  if (!m || !a) return true;
  const mm  = String(m).padStart(2, "0");
  const ini = `${a}-${mm}-01`;
  const fin = `${a}-${mm}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
  const alta = String(leg?.fecha_alta || leg?.fecha_ingreso || "").slice(0, 10);
  const baja = String(leg?.fecha_baja || "").slice(0, 10);
  if (alta && alta > fin) return false;
  if (baja && baja < ini) return false;
  return true;
}
export const mesesVigentesPorFecha = (legajo, anio, semestre) =>
  SEMESTRES[semestre].meses.filter(m => legajoVigenteEnMes(legajo, m, anio));

// Base remunerativa de UN mes (todas las liquidaciones cerradas de la persona ese mes y ámbito;
// en Sedes puede haber varias, una por sede). Devuelve el detalle por cuenta para mostrarlo.
export function baseMensual(liqsDelMes, { devengadoDe, esCuentaBase }) {
  const porCuenta = new Map();
  const formas = {};
  const sedes  = [];
  let base = 0, haberes = 0;
  for (const liq of liqsDelMes) {
    let totLiq = 0;
    for (const it of devengadoDe(liq)) {
      const monto  = Number(it.total) || 0;
      const cuenta = it.cuenta_contable || "Sueldos";
      const es     = !!esCuentaBase(cuenta);
      const acc = porCuenta.get(cuenta) || { cuenta, base: es, monto: 0 };
      acc.monto += monto;
      porCuenta.set(cuenta, acc);
      if (es) {
        base += monto;
        formas[it.bucket] = (formas[it.bucket] || 0) + monto;
        if (it.bucket === "haberes") haberes += monto;
      }
      totLiq += monto;
    }
    sedes.push({ sede_id: liq.sede_id ?? "", sede_nombre: liq.sede_nombre ?? "", total: totLiq });
  }
  return { base, haberes, formas, cuentas: [...porCuenta.values()], sedes };
}

// Forma de pago del resto (lo que no va por haberes): efectivo si el mejor mes tuvo efectivo;
// si no, la forma no-haberes más grande de ese mes (monotributistas de HQ → monotributo).
function formaResto(formas = {}) {
  if ((formas.efectivo || 0) > 0) return "efectivo";
  const otras = Object.entries(formas).filter(([b]) => b !== "haberes" && b !== "efectivo").sort((a, b) => b[1] - a[1]);
  if (!otras.length) return "efectivo";
  const bucket = otras[0][0];
  return bucket === "deposito" ? "deposito" : "monotributo";   // bucket monotributo = monotributo | transferencia
}

/**
 * calcularAguinaldo
 * @param legajo        { id, nombre, sede_id, activo, fecha_alta, fecha_ingreso, fecha_baja }
 * @param liqs          liquidaciones cerradas parseadas, anotadas con `_ambito` ("hq" | "sedes")
 * @param anio, semestre (1 | 2), ambito ("hq" | "sedes")
 * @param mesesCerrados Set de meses del semestre que tienen alguna liquidación cerrada en el ámbito
 *                      (los que faltan se asumen con sueldo si corresponde)
 * @param devengadoDe   liq → [{ bucket, sociedad, total, cuenta_contable }]
 * @param esCuentaBase  nombreCuenta → bool
 */
export function calcularAguinaldo({ legajo, liqs, anio, semestre, ambito, mesesCerrados, devengadoDe, esCuentaBase }) {
  const S = SEMESTRES[semestre];
  const porMes = new Map();
  for (const l of liqs) {
    if (l.legajo_id !== legajo.id || Number(l.anio) !== Number(anio) || l._ambito !== ambito) continue;
    const m = Number(l.mes);
    if (!S.meses.includes(m)) continue;
    if (!porMes.has(m)) porMes.set(m, []);
    porMes.get(m).push(l);
  }
  const meses = [...porMes.entries()].sort((a, b) => a[0] - b[0])
    .map(([mes, ls]) => ({ mes, ...baseMensual(ls, { devengadoDe, esCuentaBase }) }));
  const conSueldo = meses.filter(m => m.base > 0).map(m => m.mes);

  // Meses del semestre que todavía no se cerraron para nadie: se asumen con sueldo si la persona
  // cobró el último mes cerrado y sigue vigente por fecha (ej. diciembre al calcular en diciembre).
  const cerrados = [...(mesesCerrados || [])].filter(m => S.meses.includes(Number(m))).map(Number);
  const ultimoCerrado = cerrados.length ? Math.max(...cerrados) : 0;
  const cobroUltimo = conSueldo.includes(ultimoCerrado);
  const asumidos = S.meses.filter(m => m > ultimoCerrado && cobroUltimo && legajoVigenteEnMes(legajo, m, anio));
  const mesesSinSueldo = S.meses.filter(m => m <= ultimoCerrado && !conSueldo.includes(m));
  const cantidad   = conSueldo.length + asumidos.length;
  const proporcion = cantidad / S.meses.length;

  let mejorMes = null;
  for (const m of meses) if (m.base > 0 && (!mejorMes || m.base >= mejorMes.base)) mejorMes = m;

  const out = {
    legajo_id: legajo.id, legajo_nombre: legajo.nombre, ambito, anio, semestre,
    meses, mesesConSueldo: conSueldo, mesesAsumidos: asumidos, mesesSinSueldo,
    cantidad, totalMeses: S.meses.length,
    mejorMes, aguinaldo: 0, haberesDefault: 0, restoForma: "efectivo", sedeDestino: null,
    motivo: "", avisos: [],
  };
  // Dado de baja al mes de pago → no cobra (la liquidación final ya lo cubrió; Martín, 14/10): no
  // vigente por fecha en el mes de pago, o inactivo sin fecha (con aviso para que la carguen).
  if (!legajoVigenteEnMes(legajo, S.mesPago, anio) || legajo.activo === false) {
    out.motivo = `dado de baja antes de ${MESES_CORTO[S.mesPago - 1]} (liquidación final)`;
    if (legajo.activo === false && !legajo.fecha_baja) out.avisos.push("inactivo sin fecha de baja");
    return out;
  }
  if (!meses.length)  { out.motivo = "sin liquidaciones cerradas"; return out; }
  if (!mejorMes)      { out.motivo = "sin base remunerativa";      return out; }

  out.aguinaldo = Math.round(0.5 * mejorMes.base * proporcion);
  // Default de haberes: 50 % del blanco (línea haberes) del mejor mes, proporcional. Editable en pantalla.
  out.haberesDefault = Math.min(out.aguinaldo, Math.round(0.5 * mejorMes.haberes * proporcion));
  out.restoForma = formaResto(mejorMes.formas);

  if (ambito === "sedes") {
    const casa = mejorMes.sedes.find(s => s.sede_id && String(s.sede_id) === String(legajo.sede_id ?? ""));
    const mayor = [...mejorMes.sedes].sort((a, b) => b.total - a.total)[0];
    const dest = casa || mayor;
    out.sedeDestino = dest ? { sede_id: dest.sede_id, sede_nombre: dest.sede_nombre } : null;
  }

  const vig = mesesVigentesPorFecha(legajo, anio, semestre);
  if (vig.length !== cantidad) out.avisos.push(`vigente por fecha en ${vig.length} meses, con sueldo en ${cantidad}`);
  if (asumidos.length) out.avisos.push(`se asume con sueldo en ${asumidos.map(m => MESES_CORTO[m - 1]).join(", ")} (sin cerrar)`);
  return out;
}

// Filas (forma de una novedad, sin id ni cuenta: la pantalla pone la cuenta Aguinaldos al guardar)
// que representan el aguinaldo calculado: haberes + resto.
export function filasNovedadAguinaldo(res, haberes) {
  const total = Number(res.aguinaldo) || 0;
  if (total <= 0) return [];
  const hab   = Math.max(0, Math.min(total, Math.round(Number(haberes) || 0)));
  const resto = total - hab;
  const base = {
    legajo_id: res.legajo_id, legajo_nombre: res.legajo_nombre,
    sede_id: res.sedeDestino?.sede_id ?? "", sede_nombre: res.sedeDestino?.sede_nombre ?? "",
  };
  const out = [];
  if (hab   > 0) out.push({ ...base, forma_pago: "haberes",       monto: hab,   descripcion: descripcionAguinaldo(res.anio, res.semestre, "haberes") });
  if (resto > 0) out.push({ ...base, forma_pago: res.restoForma,  monto: resto, descripcion: descripcionAguinaldo(res.anio, res.semestre, res.restoForma) });
  return out;
}
