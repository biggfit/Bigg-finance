// Del resultado al patrimonio (Martín 5/11/2026: el puente Resultado ↔ ΔPN "es muy difícil de leer como reporte").
// Reemplaza a la Evolución del PN: en vez del Balance con meses en columnas, la cascada corta que explica por qué el
// patrimonio cambió cada mes, con el mismo molde que la Caja (TablaMeses):
//   Patrimonio al inicio → + Resultado contable → − Dividendos declarados → − Retiros de socios → ± Cambio de moneda
//   → ± Diferencia de conversión (solo consolidado) → ± Sin explicar → = Variación del patrimonio → Patrimonio al cierre.
// Piezas: cierres mensuales del Balance (`eepn.balMes`, deriveAsOf a fin de cada mes), resultado devengado por mes
// (devengadoMensual, misma función que el Devengado), cambio de moneda acumulado (`eepn.cambioAcum`) y la
// conversión por TC entre cierres. "Sin explicar" es el residuo: dinero en tránsito que cruza el mes, timing entre
// sociedades, imputaciones pendientes. Debería tender a cero; es la fila que hay que mirar.
// Receta validada a mano para sep-2026, núcleo en USD (20/10): 37.043 libros − 2.312 cambio − 2.034 conversión
// − 9.768 sin explicar (9.042 € Wellness → Bigg Fit en tránsito 29/9 → 1/10) = 22.929 ΔPN.
import { T } from "../theme";
import { sumSaldo, crearTraductor, AvisosTC } from "./balanceUtils";
import { finDeMes as finDeMesDe } from "./mesesUtils";
import { devengadoMensual } from "./TabDevengado";
import { Fila, TablaMeses } from "./TablaMeses";

export function PatrimonioView({ eepn, filtroMoneda, tiposCambio = null, pnl = null, socSet, sociosCC = [], participaciones = [] }) {
  if (!eepn) return null;
  const { year, GO, upto, balMes, cambioAcum } = eepn;
  const consolidado = !filtroMoneda || filtroMoneda === "ALL";
  const mon = consolidado ? "USD" : filtroMoneda;
  const meses = []; for (let m = GO; m <= upto; m++) meses.push(m);
  const hoy = new Date(); const mesEnCurso = hoy.getFullYear() === year ? hoy.getMonth() : null;
  const cerrados = meses.filter(m => m !== mesEnCurso);
  const p = { meses, cerrados, mesEnCurso };
  const { aUSD, faltaTC, tcSuplente } = crearTraductor(tiposCambio);
  const finDeMes = m => finDeMesDe(year, m);
  const bd = m => balMes[m] || { cuentas: [], aCobrar: [], aPagar: [], intercoAct: [], intercoPas: [], participaciones: [] };
  const monedasDe = arrs => { const st = new Set(); arrs.forEach(a => a.forEach(it => it.moneda && st.add(it.moneda))); return [...st]; };
  // Suma de una lista al cierre del mes m: nativa (una moneda) o consolidada en USD al TC de ese cierre (como el Balance).
  const suma = (arr, m, pred = () => true) => consolidado
    ? monedasDe([arr]).reduce((s, mo) => s + aUSD(sumSaldo(arr, mo, pred), mo, finDeMes(m)), 0)
    : sumSaldo(arr, mon, pred);
  const pn = m => {
    const b = bd(m);
    return suma(b.cuentas, m, c => (c.tipo || "") !== "tarjeta") + suma(b.aCobrar, m) + suma(b.intercoAct, m) + suma(b.participaciones || [], m)
      - suma(b.aPagar, m) - suma(b.intercoPas, m);
  };
  const dPN = m => pn(m) - pn(m - 1);

  // Resultado del mes según los libros (devengado crudo, mismo perímetro y moneda que el Balance).
  // Además, los retiros de socios del mes (cuenta "Inversores": Rosedal reparte a sus socios y a Ñako): no son
  // resultado pero bajan el patrimonio → fila propia (antes caían en "Sin explicar", Martín 10/11/2026). Los centros
  // con cesión provisionada (Barrio Norte) no entran: ahí el patrimonio ya bajó por "Dividendos declarados".
  const { res, retiros } = (pnl && year === 2026)
    ? devengadoMensual(pnl, { year, consolidado, mon, socSet, tiposCambio, desde: GO, hasta: upto, participaciones })
    : { res: new Array(12).fill(0), retiros: new Array(12).fill(0) };
  const retirosDe = m => retiros[m];

  // Cambio de moneda (origen "cambio"): nativo = la pata que entra o sale de esta moneda (mueve su PN sin ser
  // resultado); consolidado = las dos patas al TC del mes = resultado por operar a un TC distinto del maestro.
  const cambioAcumDe = m => consolidado
    ? Object.entries(cambioAcum?.[m] || {}).reduce((s, [mo, v]) => s + aUSD(v, mo, finDeMes(m)), 0)
    : (cambioAcum?.[m]?.[mon] || 0);
  const cambio = m => cambioAcumDe(m) - cambioAcumDe(m - 1);

  // Diferencia de conversión (solo consolidado): el PN nativo de cada moneda al cierre anterior, valuado al TC nuevo
  // menos al TC viejo. No es negocio: es el dólar moviéndose.
  const conv = (() => {
    if (!consolidado) return () => 0;
    const monedasPN = monedasDe(meses.flatMap(m => [bd(m).cuentas, bd(m).aCobrar, bd(m).aPagar, bd(m).intercoAct, bd(m).intercoPas, bd(m).participaciones || []]));
    const pnNativo = (m, mo) => {
      const b = bd(m);
      return sumSaldo(b.cuentas, mo, c => (c.tipo || "") !== "tarjeta") + sumSaldo(b.aCobrar, mo) + sumSaldo(b.intercoAct, mo) + sumSaldo(b.participaciones || [], mo)
        - sumSaldo(b.aPagar, mo) - sumSaldo(b.intercoPas, mo);
    };
    return m => monedasPN.reduce((s, mo) => s + aUSD(pnNativo(m - 1, mo), mo, finDeMes(m)) - aUSD(pnNativo(m - 1, mo), mo, finDeMes(m - 1)), 0);
  })();

  // Dividendos declarados (nb_socios_cc): bajan el PN sin pasar por el resultado. Monto negativo = se lo debemos.
  const dividendos = m => {
    let acc = 0;
    for (const r of sociosCC || []) {
      if (r.tipo !== "dividendo_declarado" || !socSet.has(String(r.sociedad || "").toLowerCase())) continue;
      const f = String(r.fecha || "").slice(0, 10);
      if (f.slice(0, 4) !== String(year) || +f.slice(5, 7) - 1 !== m) continue;
      const mo = r.moneda || "ARS", v = Number(r.monto) || 0;
      if (consolidado) acc += aUSD(v, mo, f); else if (mo === mon) acc += v;
    }
    return acc;
  };
  const sinExplicar = m => dPN(m) - res[m] - dividendos(m) - retirosDe(m) - cambio(m) - conv(m);
  const hayDividendos = meses.some(m => Math.abs(dividendos(m)) > 0.5);
  const hayRetiros = meses.some(m => Math.abs(retirosDe(m)) > 0.5);
  const haySinExplicar = cerrados.some(m => Math.abs(sinExplicar(m)) > 0.5);
  const titulo = consolidado ? "Patrimonio · USD consolidado" : `Patrimonio · ${mon}`;

  return (
    <div className="fade">
      <AvisosTC tcSuplente={tcSuplente} faltaTC={faltaTC} />
      <TablaMeses titulo={titulo} meses={meses} mesEnCurso={mesEnCurso}>
        <tbody>
          <Fila label="Patrimonio al inicio" get={m => pn(m - 1)} {...p} total="primero" labelStyle={{ color: T.muted }} color={T.muted} />
          {/* "Resultado contable" (antes "Resultado en los libros", Martín 10/11/2026: se confundía con el P&L): el
              devengado de la sociedad tal como está contabilizado, el mismo de "Resultado devengado por cuenta". */}
          <Fila label="Resultado contable" get={m => res[m]} {...p} fuerte />
          {hayDividendos && <Fila label="Dividendos declarados" get={dividendos} {...p} />}
          {hayRetiros && <Fila label="Retiros de socios" get={retirosDe} {...p} />}
          <Fila label={consolidado ? "Resultado por cambio de moneda" : "Cambio de moneda"} get={cambio} {...p} />
          {consolidado && <Fila label="Diferencia de conversión" get={conv} {...p} />}
          <Fila label="Sin explicar" get={sinExplicar} {...p} labelStyle={{ color: haySinExplicar ? T.orange : T.dim }} color={haySinExplicar ? T.orange : T.dim} />
        </tbody>
        <tfoot>
          <Fila label="Variación del patrimonio" get={dPN} {...p} fuerte style={{ background: "#f3f4f6", borderTop: `2px solid ${T.cardBorder}` }} />
          <Fila label="Patrimonio al cierre" get={pn} {...p} fuerte total="ultimo" style={{ background: "#f3f4f6" }} />
        </tfoot>
      </TablaMeses>
    </div>
  );
}
