// Valuación del grupo (Martín 10/11/2026). NO es un valor de mercado: es un número que todos los meses se calcula
// IGUAL, para ver si el grupo sube o baja ("no tiene que ser un número real, tiene que ser un número que todos los
// meses se valúe igual"). Tablero aparte: nunca una línea del P&L ni del Balance. En el fondo es EBITDA × múltiplo
// (Martín 10/11): todo sobre el P&L del grupo en USD a TC real, SIN IVA y SIN la línea de impuestos, promediando solo
// desde julio 2026 (go-live: antes el histórico no separa bien el IVA; al principio falta un mes de aguinaldos, "no
// importa"). La ventana crece mes a mes hasta 12 y de ahí en más es móvil. Reglas:
//   · cada sede argentina                                     → resultado promedio (hasta 12 meses) × 36
//   · Barrio Norte                                            → igual, por la parte de BIGG (51 %)
//   · sede con menos de 12 meses de historia (Botánico, Running) → promedio de los últimos 3 meses × 36
//   · Rosedal (gerenciamiento) y Huergo                       → × 0: son servicios que nos pueden revocar (Martín
//                                                               10/11); quedan a la vista, con su promedio, sin valor
//   · Red BIGG neta de HQ: la Red menos la Estructura HQ y los financieros, en UNA sola fila (Martín 10/11: "juntá
//     todo Red BIGG, HQ y todo el resto, en una sola fila"; los impuestos quedan afuera)      → promedio × 60
//   · España y Colombia (pierden)                             → lo que pusimos, al cierre: la participación aportada
//                                                               (tabla de Participaciones) + el saldo interco del
//                                                               núcleo con la sociedad (apertura + todo lo posterior)
// Sin React. Nada se escribe: sale del P&L del grupo (holdingDe / buildPnLGrupoFilas) y de lecturaInterco.
import { lecturaInterco, tcDelMes, montoAMoneda } from "../../lib/numbersApi";
import { participacionesAsOf } from "./balanceUtils";

export const VAL = { desde: "2026-07", ventana: 12, ventanaNueva: 3, mesesNegocio: 36, mesesServicio: 0, mesesResto: 60 };
const num = v => Number(v) || 0;
const Z12 = () => new Array(12).fill(0);
const [DESDE_Y, DESDE_M] = VAL.desde.split("-").map(Number);

// Meses que se valúan: los CERRADOS del año (el mes en curso no: un mes parcial movería el promedio), desde VAL.desde.
export function mesesValuacion(year, hoy = new Date()) {
  const hasta = year < hoy.getFullYear() ? 11 : year > hoy.getFullYear() ? -1 : hoy.getMonth() - 1;
  const desde = year < DESDE_Y ? 12 : year === DESDE_Y ? DESDE_M - 1 : 0;
  const meses = []; for (let m = desde; m <= hasta; m++) meses.push(m);
  return meses;
}
// Índice de VAL.desde dentro de la serie de 24 meses (año anterior + año) de `year`.
const desdeIdxDe = year => Math.max(0, (DESDE_Y - (year - 1)) * 12 + (DESDE_M - 1));

// Valor mes a mes de una línea: promedio × múltiplo × parte. `prev`/`cur` = resultado mensual del año anterior y del
// año (24 meses seguidos); `desdeIdx` = primer mes de la serie que cuenta (lo anterior se ignora). El promedio toma
// hasta 12 meses hacia atrás; si la línea tiene menos de 12 meses de historia propia (desde su primer mes con dato,
// aunque sea anterior a `desdeIdx`), se usan los últimos 3 (`corta`). `valorAntes` = diciembre del año anterior.
export function valuarSerie(prev, cur, multiplo, parte = 1, desdeIdx = 0) {
  const s = [...(prev || Z12()), ...(cur || Z12())].map(num);
  const first = s.findIndex(v => Math.abs(v) > 0.5);
  const en = i => {
    if (first < 0 || first > i || i < desdeIdx) return { promedio: 0, ventana: 0, corta: false };
    const corta = i - first + 1 < VAL.ventana;
    const ini = Math.max(desdeIdx, first, i - (corta ? VAL.ventanaNueva : VAL.ventana) + 1);
    let t = 0; for (let k = ini; k <= i; k++) t += s[k];
    return { promedio: t / (i - ini + 1), ventana: i - ini + 1, corta };
  };
  const pts = Array.from({ length: 13 }, (_, j) => en(11 + j));   // j=0 → dic del año anterior; j=1..12 → ene..dic
  const valorDe = p => p.promedio * multiplo * parte;
  const mes = pts.slice(1);
  return { valor: mes.map(valorDe), valorAntes: valorDe(pts[0]), promedio: mes.map(p => p.promedio), ventana: mes.map(p => p.ventana), corta: mes.map(p => p.corta) };
}

// "Lo que pusimos" en cada sociedad fuera del núcleo, al cierre de cada mes, en USD. Dos piezas, las mismas que el
// Balance del núcleo: (1) la participación aportada por sociedades del núcleo (nb_socios.aportado, participacionesAsOf:
// en España el grueso de lo puesto se pasó a participación de Bigg Fit) y (2) la posición interco del núcleo contra
// esa sociedad (lecturaInterco al corte: apertura + movimientos; acreedor = +). Cada moneda al TC de ESE mes.
// Devuelve [{ key, label, valor[12], valorAntes }] (valorAntes = diciembre anterior).
export function puestoEnFondeadas({ intercoData, participaciones = [], nucleo, fondeadas = [], year, hasta = 11, tiposCambio }) {
  if (!intercoData) return [];
  const lc = v => String(v ?? "").toLowerCase();
  const nuc = new Set([...(nucleo || [])].map(lc));
  const alCorte = (y, m) => {   // m 0-based
    const tc = tcDelMes(tiposCambio, y, m + 1), corte = `${y}-${String(m + 1).padStart(2, "0")}-31`;
    const out = {};
    const sumar = (soc, monto, moneda) => {
      const usd = montoAMoneda(monto, moneda, tc, "USD");
      if (usd != null) out[lc(soc)] = (out[lc(soc)] || 0) + usd;
    };
    for (const p of lecturaInterco(intercoData, { corte })) if (nuc.has(lc(p.sociedad))) sumar(p.contraparte, p.neto, p.moneda);
    for (const it of participacionesAsOf(participaciones, intercoData.sociedades || [], [...nuc], corte)) sumar(it.invertida, it.saldo, it.moneda);
    return out;
  };
  const antes = alCorte(year - 1, 11);
  const porMes = Array.from({ length: 12 }, (_, m) => m <= hasta ? alCorte(year, m) : {});
  return fondeadas.map(f => ({ key: f.key, label: f.label, valor: porMes.map(o => o[lc(f.empresa)] || 0), valorAntes: antes[lc(f.empresa)] || 0 }));
}

// Arma las filas del tablero. `sedes` = [{ label, isBN, cur[12], prev[12] }] (Resultado Final de cada sede);
// `lineas` = [{ key, label, cur, prev, servicio, impuestos }] ya con su signo de aporte al resultado (estructura y
// financieros en negativo; `servicio` = contrato revocable, fila propia con VAL.mesesServicio; `impuestos` = no entra);
// `puesto` = salida de puestoEnFondeadas. `year` ubica VAL.desde dentro de las series.
export function armarValuacion({ year, sedes = [], parteBN = 1, lineas = [], puesto = [] }) {
  const filas = [], desde = desdeIdxDe(year);
  for (const s of sedes) {
    const parte = s.isBN ? parteBN : 1;
    const v = valuarSerie(s.prev, s.cur, VAL.mesesNegocio, parte, desde);
    if (!v.ventana.some(Boolean)) continue;   // centro sin ningún mes con resultado
    filas.push({ grupo: "sedes", key: `sede:${s.label}`, label: String(s.label).replace(/^\d+\s*-\s*/, ""), parte, multiplo: VAL.mesesNegocio, ...v });
  }
  for (const p of puesto) filas.push({ grupo: "puesto", key: `puesto:${p.key}`, label: p.label, valor: p.valor, valorAntes: p.valorAntes });
  for (const l of lineas.filter(x => x.servicio))
    filas.push({ grupo: "negocios", key: l.key, label: l.label, detalle: "servicio revocable", parte: 1, multiplo: VAL.mesesServicio, ...valuarSerie(l.prev, l.cur, VAL.mesesServicio, 1, desde) });
  // Lo que no es un negocio ni un servicio (Red BIGG, Estructura HQ, Financieros) va sumado en una sola fila: la Red
  // neta de lo que cuesta sostenerla. Separadas, Red y Estructura se anulaban entre sí y confundían la lectura. Los
  // impuestos quedan afuera (Martín 10/11: "al final teóricamente es EBITDA por múltiplo").
  const resto = lineas.filter(x => !x.servicio && !x.impuestos);
  if (resto.length) {
    const sumar = campo => Z12().map((_, m) => resto.reduce((t, l) => t + num(l[campo]?.[m]), 0));
    filas.push({ grupo: "resto", key: "red_hq", label: "Red BIGG neta de HQ", detalle: "Red − estructura HQ y financieros, sin impuestos", parte: 1,
      multiplo: VAL.mesesResto, ...valuarSerie(sumar("prev"), sumar("cur"), VAL.mesesResto, 1, desde) });
  }
  const total = Z12().map((_, m) => filas.reduce((t, f) => t + num(f.valor[m]), 0));
  const totalAntes = filas.reduce((t, f) => t + num(f.valorAntes), 0);
  return { filas, total, totalAntes };
}
