// Posición financiera — derivación PURA (sin React) sobre un balance as-of {cuentas, aCobrar, aPagar, intercoAct,
// intercoPas} (lo que devuelve deriveAsOf en TabTesoreriaConsolidada). La cascada del board (orden Martín 24/9:
// primero lo CORRIENTE, la deuda que se refinancia al final):
//
//   Disponible (caja + bancos + inversiones, con su signo)
//   + Cuentas por cobrar − Cuentas por pagar operativas (incluye tarjetas, neto de saldo a favor)
//   − Inversores y financieros (corriente)
//   = POSICIÓN CORRIENTE  (lo que queda si cobro y pago todo lo corriente)
//   − No corriente neto (créditos y préstamos, planes de pago, impuestos, socios, anticipos y cobros a cuenta de
//                        clientes − préstamos a socios − intercompañía neto ∓ CC comercial del grupo)
//   = POSICIÓN NETA TOTAL  (≡ Patrimonio Neto del Balance: mismas fórmulas, otra agrupación → control cruzado)
//
// `suma(items, fecha, pred)` es el sumador de la vista (nativo en una moneda o consolidado en USD al TC del mes de
// `fecha`, ver crearSumador en balanceUtils). Pasarle un sumador nativo por moneda da la misma cascada en nativo.
import { clasificarPasivo, clasificarActivo } from "./balanceUtils";

const tipoDe = c => String(c?.tipo || "").toLowerCase();
const saldoDe = c => Number(c?.saldo) || 0;
const nz = v => Math.abs(v) > 0.5;

// Suma por label dentro de un grupo → Map label → valor (para las líneas de detalle). `labelOf` permite agrupar
// varios items bajo un mismo label (todas las tarjetas → "Tarjetas de crédito").
function porLabel(items, fecha, suma, pred, labelOf = it => it.label) {
  const m = new Map();
  for (const L of new Set(items.filter(pred).map(labelOf))) {
    const v = suma(items, fecha, it => labelOf(it) === L && pred(it));
    if (nz(v)) m.set(L, v);
  }
  return m;
}
const TARJETAS = "Tarjetas de crédito";
const SUELDOS = "Sueldos y cargas sociales";
const esItemTarjeta = it => !!it?.esTarjeta || /^tarjeta/i.test(it?.label || "");
// Label de la línea operativa: tarjetas juntas, sueldos + cargas sociales juntos (Martín 24/9), el resto tal cual.
const labelOperativo = it => esItemTarjeta(it) ? TARJETAS : /sueldo|carga/i.test(it?.label || "") ? SUELDOS : it.label;
// Label de la línea no corriente: impuestos + planes de pago juntos (Martín 24/9), el resto tal cual.
const IMPUESTOS = "Impuestos y planes de pago";
const labelNoCorriente = it => /impuesto|planes? de pago/i.test(it?.label || "") ? IMPUESTOS : it.label;

export function armarPosicion(bal, suma, fecha) {
  const cuentas = bal?.cuentas || [], aCobrar = bal?.aCobrar || [], aPagar = bal?.aPagar || [];
  const intercoAct = bal?.intercoAct || [], intercoPas = bal?.intercoPas || [];
  const noTarjeta = c => tipoDe(c) !== "tarjeta";     // las tarjetas ya viven en aPagar/aCobrar como items

  // ── Liquidez: el saldo de cada caja/banco/inversión tal cual (los negativos —descubierto, MP del mes sin asentar—
  //    restan acá, igual que en el Balance) ──
  const caja        = suma(cuentas, fecha, c => tipoDe(c) === "caja");
  const inversiones = suma(cuentas, fecha, c => tipoDe(c) === "inversion");
  const bancos      = suma(cuentas, fecha, c => noTarjeta(c) && tipoDe(c) !== "caja" && tipoDe(c) !== "inversion");
  const disponible = caja + bancos + inversiones;

  // ── Pasivo por grupo ──
  const gP = it => clasificarPasivo(it).grupo;
  const cxpOp     = suma(aPagar, fecha, it => gP(it) === "operativo");
  const anticipos = suma(aPagar, fecha, it => gP(it) === "anticipo");
  const finCorr   = suma(aPagar, fecha, it => gP(it) === "finCorriente");
  const noCorr    = suma(aPagar, fecha, it => gP(it) === "noCorriente");
  const ccGrupoPas = suma(aPagar, fecha, it => gP(it) === "ccGrupo");
  const desconocidos = new Set(aPagar.filter(it => clasificarPasivo(it).desconocido && nz(saldoDe(it))).map(it => it.label));

  // ── Activo por grupo ──
  const gA = it => clasificarActivo(it);
  const cxc = suma(aCobrar, fecha, it => gA(it) === "cxc");
  const prestamosSocios = suma(aCobrar, fecha, it => gA(it) === "prestamoSocios");
  const favorTarjeta = suma(aCobrar, fecha, it => gA(it) === "favorTarjeta");
  const ccGrupoAct = suma(aCobrar, fecha, it => gA(it) === "ccGrupo");

  // ── Intercompañía (solo cuando el set de sociedades no es "Todas": con Todas se netea a cero) ──
  const intercoNosDeben = suma(intercoAct, fecha), intercoLesDebemos = suma(intercoPas, fecha);
  const intercoNeto = intercoNosDeben - intercoLesDebemos;   // > 0 nos deben → reduce la deuda

  // ── Corriente ──
  const cxpOpNeto = cxpOp - favorTarjeta;                    // tarjetas (dentro de operativo) neto de saldo a favor
  const ccGrupoNeto = ccGrupoAct - ccGrupoPas;
  const capitalTrabajo = cxc - cxpOpNeto - finCorr;
  const posCorriente = disponible + capitalTrabajo;

  // ── No corriente (deuda que se refinancia + anticipos de clientes + CC comercial entre sociedades; Martín 24/9) ──
  const deudaNoCorrNeta = noCorr + anticipos - prestamosSocios - intercoNeto - ccGrupoNeto;
  const posicionNeta = posCorriente - deudaNoCorrNeta;

  // PN del Balance con las MISMAS fórmulas que BalanceView (activo = caja + no-caja-no-tarjeta + aCobrar + intercoAct;
  // pasivo = aPagar + intercoPas). Si la cascada clasifica cada item en exactamente un grupo, diferencia = 0.
  const pnBalance = suma(cuentas, fecha, noTarjeta) + suma(aCobrar, fecha) + intercoNosDeben - suma(aPagar, fecha) - intercoLesDebemos;

  return {
    caja, bancos, inversiones, disponible,
    cxc, cxpOp, cxpOpNeto, anticipos, finCorr, favorTarjeta, ccGrupoAct, ccGrupoPas, ccGrupoNeto, capitalTrabajo,
    posCorriente,
    noCorr, prestamosSocios, intercoNosDeben, intercoLesDebemos, intercoNeto, deudaNoCorrNeta,
    posicionNeta, pnBalance, diferencia: posicionNeta - pnBalance,
    det: {
      cxc:         porLabel(aCobrar, fecha, suma, it => gA(it) === "cxc"),
      // Operativo: todas las tarjetas en UNA línea, neta del saldo a favor; sueldos + cargas sociales juntos.
      operativo:   (() => {
        const m = porLabel(aPagar, fecha, suma, it => gP(it) === "operativo", labelOperativo);
        const tarj = (m.get(TARJETAS) || 0) - favorTarjeta;
        if (nz(tarj)) m.set(TARJETAS, tarj); else m.delete(TARJETAS);
        return m;
      })(),
      anticipo:    porLabel(aPagar, fecha, suma, it => gP(it) === "anticipo"),
      finCorriente: porLabel(aPagar, fecha, suma, it => gP(it) === "finCorriente"),
      noCorriente: porLabel(aPagar, fecha, suma, it => gP(it) === "noCorriente", labelNoCorriente),
    },
    desconocidos,
  };
}

// Cuentas con saldo negativo a la fecha (para el aviso de "foto provisoria": Mercado Pago del mes sin asentar, etc.).
export function cuentasNegativas(bal, pred = () => true) {
  return (bal?.cuentas || []).filter(c => tipoDe(c) !== "tarjeta" && saldoDe(c) < -0.5 && pred(c));
}
