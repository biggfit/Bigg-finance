// Helpers compartidos por las vistas de Tesorería consolidada (Balance, Evolución PN, Cash Flow, Resultado → Caja).
// Viven aparte para que TabTesoreriaConsolidada y CashFlowViews los importen sin ciclos.
import { T } from "../theme";
import { tcDelMes, montoAUSD } from "../../lib/numbersApi";

export const GO_LIVE_APERTURA = "2026-06-30";
export const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// Suma el saldo de una lista de items para una moneda (con predicado opcional).
export const sumSaldo = (a, m, pred = () => true) => a.reduce((s, it) => s + ((it.moneda === m && pred(it)) ? (Number(it.saldo) || 0) : 0), 0);
// Clasificación del pasivo: corriente (operativo) vs otros (financiación/anticipos/socios).
export const esCorriente = l => /proveedor|sueldo|carga|impuesto|interuso|franquic|arancel/i.test(l || "");
// Formato de monto redondeado es-AR (— para cero, − para negativos).
export const fmtBal = (n) => { const v = Math.round(Number(n) || 0); return v === 0 ? "—" : (v < 0 ? "−" : "") + Math.abs(v).toLocaleString("es-AR"); };

// Traductor a USD: TC del mes de la fecha; si ese mes no tiene TC (típico: el mes en curso), usa el último disponible
// hacia atrás (hasta 3 meses) y lo registra en `tcSuplente`; si tampoco hay, lo registra en `faltaTC` y devuelve 0
// (NO suma monedas sin traducir).
export function crearTraductor(tiposCambio) {
  const faltaTC = new Set(), tcSuplente = new Set();
  const tcPara = (fecha) => {
    let y = +fecha.slice(0, 4), m = +fecha.slice(5, 7);
    for (let i = 0; i < 4; i++) {
      const tc = tcDelMes(tiposCambio, y, m);
      if (tc) { if (i > 0) tcSuplente.add(`${fecha.slice(0, 7)} → ${tc.yearMonth}`); return tc; }
      m -= 1; if (m === 0) { m = 12; y -= 1; }
    }
    return null;
  };
  const aUSD = (monto, moneda, fecha) => {
    const v = montoAUSD(monto, moneda, tcPara(fecha));
    if (v == null) { if (Math.abs(monto) > 0.005) faltaTC.add(`${moneda} ${fecha.slice(0, 7)}`); return 0; }
    return v;
  };
  return { aUSD, tcPara, faltaTC, tcSuplente };
}

// Avisos de TC (suplente / faltante).
export function AvisosTC({ tcSuplente, faltaTC }) {
  return (<>
    {tcSuplente.size > 0 && (
      <div style={{ fontSize: 11, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 12px", marginBottom: 10 }}>
        Sin tipo de cambio cargado para {[...tcSuplente].map(x => x.split(" → ")[0]).filter((v, i, a) => a.indexOf(v) === i).join(", ")}: se usa el último disponible ({[...new Set([...tcSuplente].map(x => x.split(" → ")[1]))].join(", ")}). Cargalo en Maestros › Tipos de cambio.
      </div>
    )}
    {faltaTC.size > 0 && (
      <div role="alert" style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#92400e", marginBottom: 10 }}>
        Falta tipo de cambio para: {[...faltaTC].join(", ")}. Esos saldos no están sumados en el consolidado.
      </div>
    )}
  </>);
}

// Orden de las líneas de detalle: alfabético dentro del subgrupo, intercompañía al final.
export const ordenarDetalle = (rows) => [...rows].sort((a, b) => (/^Intercompañía/.test(a.label) ? 1 : 0) - (/^Intercompañía/.test(b.label) ? 1 : 0) || a.label.localeCompare(b.label));
export const hoyISO = () => new Date().toISOString().slice(0, 10);
export const finMesAnterior = (iso) => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; return `${py}-${String(pm).padStart(2, "0")}-31`; };
export const esFinDeMes = (iso) => { const d = new Date(+iso.slice(0, 4), +iso.slice(5, 7), 0).getDate(); return +iso.slice(8, 10) >= d; };

// Estilos de celda compartidos por las tablas mensuales (Cash Flow / Resultado → Caja), a tono con BalanceTable.
export const celdaNum = (v, { bold = false, color = null, dim = false } = {}) => ({
  padding: "8px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--mono)", fontWeight: bold ? 800 : 500,
  color: color || (dim ? T.dim : (v < 0 ? "#dc2626" : T.text)), whiteSpace: "nowrap",
});
