// Cesión de utilidades por negocio, DERIVADA (T4 tanda C, Martín 6/11/2026: "provisionar no tiene que ser un botón,
// tiene que ser un cálculo por diferencia"). Nada se escribe: la provisión mensual (pct × resultado final neto del
// centro) y el saldo con los socios al 30/6 salen del P&L con la misma cola que el P&L Sede (computeCesion), y se
// presentan como filas VIRTUALES de nb_socios_cc (tipo apertura / dividendo_declarado, `virtual: true`) a nombre del
// socio-cesión (ej. BN-SOCIOS en hektor). Así las leen sin cambios la pantalla de Participaciones (dividendos, saldo
// CC), el Balance y la Posición financiera (pasivo "Socios (les debemos)") y Del resultado al patrimonio (fila
// "Dividendos declarados"). Las FACTURAS de los cesionarios (cuenta "Inversores" en el centro) bajan esa deuda:
// retirosCesion en numbersApi. Saldo CC = apertura + provisiones − facturado.
import { CESION, CESION_CUENTA, _nkSede, buildPnLSede, computeSubtotalsSede, computeCesion } from "./pnlDerive";
import { GO_LIVE_APERTURA, MESES_CORTOS } from "./balanceUtils";

// Config por cesión sobre un CENTRO (las cesiones sobre sociedades, Wellness, llevan su CC real y no se provisionan
// acá): % desde la tabla (nb_socios) con CESION.pct de respaldo para Barrio Norte; carry-in al 31/12/2025 de CESION.
export function cesionesDe(participaciones = [], centros = []) {
  const out = [];
  for (const r of participaciones || []) {
    if (r.tipo !== "cesion") continue;
    const cc = (centros || []).find(c => String(c.id).toLowerCase() === String(r.alcance || "").toLowerCase());
    if (!cc) continue;
    const esBN = _nkSede(cc.nombre).includes(_nkSede(CESION.matchNombre));
    const pct = Number(r.participacion) > 0 ? Number(r.participacion) / 100 : (esBN ? CESION.pct : 0);
    if (!pct) continue;
    out.push({
      ...(esBN ? CESION : { apertura: 0, aperturaYear: 2026, matchNombre: cc.nombre }), pct,
      alcance: String(cc.id), nombre: String(cc.nombre || cc.id).replace(/^\d+\s*-\s*/, ""),
      sociedad: cc.empresa || cc.sociedad || "", socio_id: String(r.id), socio_nombre: r.nombre || String(r.id), base: r.base || "resultado_final",
    });
  }
  return out;
}

// Filas virtuales de nb_socios_cc para el año: apertura al 30/6 (saldo acumulado de la cola del P&L a junio: carry-in
// 31/12 + ene-jun provisionado − facturado) y una provisión por mes desde julio (negativa = le debemos; en un mes de
// pérdida es positiva: comparten la pérdida, decisión 14/7). `inRows`/`egRows` = filas del P&L en ARS con histórico.
export function provisionCesionRows({ cesiones = [], inRows = [], egRows = [], year }) {
  const rows = [];
  const mesAper = +GO_LIVE_APERTURA.slice(5, 7) - 1;   // junio (0-based)
  for (const ces of cesiones || []) {
    const neto = computeSubtotalsSede(buildPnLSede(inRows, egRows, [ces.alcance], year, "ARS", true));
    const bruto = buildPnLSede(inRows, egRows, [ces.alcance], year, "ARS", false);
    const k = Object.keys(bruto.sinClasificar || {}).find(x => _nkSede(x) === _nkSede(CESION_CUENTA));
    const cola = computeCesion(neto.resFinal, k ? bruto.sinClasificar[k] : [], ces, year);
    const base = { socio_id: ces.socio_id, socio_nombre: ces.socio_nombre, sociedad: ces.sociedad, moneda: "ARS", virtual: true, alcance: ces.alcance };
    const pctTxt = `${Math.round(ces.pct * 100)} %`;
    const saldoAper = cola.saldoAcum[mesAper];
    if (year === ces.aperturaYear && saldoAper != null && Math.abs(saldoAper) > 0.5) {
      rows.push({ ...base, id: `PROV-APER-${ces.alcance}-${GO_LIVE_APERTURA}`, fecha: GO_LIVE_APERTURA, tipo: "apertura", monto: -saldoAper,
        label: "Saldo al 30/6 (cesión)", nota: `Cesión ${pctTxt} · ${ces.nombre}: saldo con los socios al 30/6/${year} (31/12/${year - 1} + ene-jun, provisión − facturado)` });
    }
    // Solo meses cerrados: el mes en curso no se provisiona hasta que cierra (en el año actual, hasta el mes anterior).
    const hoy = new Date();
    const hasta = year < hoy.getFullYear() ? 11 : year > hoy.getFullYear() ? -1 : hoy.getMonth() - 1;
    const desde = year === ces.aperturaYear ? mesAper + 1 : 0;
    for (let m = desde; m <= hasta; m++) {
      const v = Number(cola.acreditado[m]) || 0;
      if (Math.abs(v) < 0.5) continue;
      const ym = `${year}-${String(m + 1).padStart(2, "0")}`;
      const fin = new Date(year, m + 1, 0).getDate();
      rows.push({ ...base, id: `PROV-${ces.alcance}-${ym}`, fecha: `${ym}-${String(fin).padStart(2, "0")}`, tipo: "dividendo_declarado", monto: -v,
        label: "Provisión de la cesión", nota: `Provisión ${pctTxt} · ${ces.nombre} · ${MESES_CORTOS[m]} ${year} (resultado final ${Math.round(Number(neto.resFinal[m]) || 0).toLocaleString("es-AR")})` });
    }
  }
  return rows;
}
