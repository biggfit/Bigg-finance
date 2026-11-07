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
import { FONDEADAS, resultadoFondeada, traducirFilas } from "./fondeadasDerive";

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

// Cesiones sobre una SOCIEDAD (Wellness): `socios` = los inversores terceros con su % (`pctTerceros` = lo que se
// distribuye afuera: línea de Distribución del P&L del grupo y provisión por socio); `grupo` = las cesiones de sociedades
// del grupo (Bigg Fit 12,96 %), que se muestran pero quedan en BIGG (no restan ni se provisionan).
export function cesionesSociedadDe(participaciones = [], sociedades = []) {
  const socIds = new Set((sociedades || []).map(s => String(s.id).toLowerCase()));
  const por = new Map();
  for (const r of participaciones || []) {
    if (r.tipo !== "cesion") continue;
    const alc = String(r.alcance || "").toLowerCase();
    if (!socIds.has(alc)) continue;
    const pct = (Number(r.participacion) || 0) / 100;
    if (!pct) continue;
    if (!por.has(alc)) {
      const s = sociedades.find(x => String(x.id).toLowerCase() === alc);
      por.set(alc, { sociedad: alc, nombre: s?.nombre || alc, moneda: s?.moneda || "ARS", socios: [], pctTerceros: 0, grupo: [], pctGrupo: 0 });
    }
    const c = por.get(alc);
    const fila = { socio_id: String(r.id), socio_nombre: r.nombre || String(r.id), pct, base: r.base || "resultado_neto" };
    if (socIds.has(String(r.id).toLowerCase())) { c.grupo.push(fila); c.pctGrupo += pct; }
    else { c.socios.push(fila); c.pctTerceros += pct; }
  }
  return [...por.values()];
}

// Filas virtuales de nb_socios_cc para el año: apertura al 30/6 (saldo acumulado de la cola del P&L a junio: carry-in
// 31/12 + ene-jun provisionado − facturado) y una provisión por mes desde julio (negativa = le debemos; en un mes de
// pérdida es positiva: comparten la pérdida, decisión 14/7). `inRows`/`egRows` = filas del P&L en ARS con histórico.
// Además (T5), por cada cesión sobre una sociedad en desarrollo (Wellness): la parte de cada inversor del resultado neto
// del mes (resultadoFondeada Con IVA en la moneda de la sociedad, filas traducidas con el TC del mes), desde julio y solo meses
// cerrados; en pérdida sale positiva (comparten). Son filas a nombre de cada socio, en esa sociedad.
export function provisionCesionRows({ cesiones = [], cesionesSoc = [], inRows = [], egRows = [], year, ccs = [], tiposCambio = null }) {
  const rows = [];
  const mesAper = +GO_LIVE_APERTURA.slice(5, 7) - 1;   // junio (0-based)
  // Solo meses cerrados: el mes en curso no se provisiona hasta que cierra (en el año actual, hasta el mes anterior).
  const hoy = new Date();
  const hasta = year < hoy.getFullYear() ? 11 : year > hoy.getFullYear() ? -1 : hoy.getMonth() - 1;
  const finDe = m => `${year}-${String(m + 1).padStart(2, "0")}-${String(new Date(year, m + 1, 0).getDate()).padStart(2, "0")}`;
  for (const c of cesionesSoc || []) {
    const cfg = Object.values(FONDEADAS).find(f => f.empresa === c.sociedad);
    if (!cfg || !c.socios.length) continue;
    // Con IVA (da lo mismo: desde el 6/11 el resultado de una fondeada no cambia con el toggle).
    const r = resultadoFondeada(traducirFilas(inRows, tiposCambio, c.moneda), traducirFilas(egRows, tiposCambio, c.moneda), ccs, cfg, year, c.moneda, false);
    if (!r) continue;
    const desde = year === 2026 ? mesAper + 1 : 0;   // go-live: desde julio 2026
    for (let m = desde; m <= hasta; m++) {
      const res = Number(r.res[m]) || 0;
      if (Math.abs(res) < 0.5) continue;
      for (const s of c.socios) {
        const v = s.pct * res;
        if (Math.abs(v) < 0.5) continue;
        rows.push({ socio_id: s.socio_id, socio_nombre: s.socio_nombre, sociedad: c.sociedad, moneda: c.moneda, virtual: true, alcance: c.sociedad,
          id: `PROV-${c.sociedad}-${s.socio_id}-${year}-${String(m + 1).padStart(2, "0")}`, fecha: finDe(m), tipo: "dividendo_declarado", monto: -v,
          label: "Distribución del resultado", nota: `${(s.pct * 100).toLocaleString("es-AR", { maximumFractionDigits: 2 })} % del resultado neto de ${c.nombre} · ${MESES_CORTOS[m]} ${year} (resultado ${Math.round(res).toLocaleString("es-AR")})` });
      }
    }
  }
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
