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
// ── Clasificación para la Posición financiera (contraparte de esCorriente) ──
// Deuda NO corriente (la que se refinancia, Martín 24/9): créditos y préstamos, planes de pago, socios e impuestos
// (la deuda impositiva es financiable → va con lo no corriente, aunque en el Balance siga siendo pasivo corriente).
export const esDeudaNoCorriente = l => /cr[eé]dito|pr[eé]stamo|planes? de pago|^socios|impuesto/i.test(l || "");
// Pasivo financiero CORRIENTE: inversores (retiros) y financieros. Las tarjetas de crédito son cuentas por pagar
// OPERATIVAS (Martín 24/9: "no son deuda financiera").
export const esFinCorriente = l => /financier|inversor/i.test(l || "");
// Anticipos y cobros a cuenta de clientes (plata de clientes que todavía no es venta) → van con lo NO corriente.
export const esAnticipo = l => /anticipo|cobros? a cuenta/i.test(l || "");
// Un item de aPagar → { grupo: ccGrupo | operativo | finCorriente | noCorriente | anticipo, desconocido }. El orden
// importa: la CC comercial del grupo lleva el NOMBRE de la sociedad (una "Créditos SA" no debe caer en deuda); las
// tarjetas llevan el nombre de la cuenta (flag estructural `esTarjeta`) y "Tarjeta de crédito" debe ganarle a
// "crédito". Lo que no matchea nada va a operativo y se avisa (desconocido) para corregir el label en Maestros.
export function clasificarPasivo(it) {
  if (it?.ccGrupo) return { grupo: "ccGrupo", desconocido: false };
  if (it?.esTarjeta || /^tarjeta/i.test(it?.label || "")) return { grupo: "operativo", desconocido: false };
  if (esFinCorriente(it?.label)) return { grupo: "finCorriente", desconocido: false };
  if (esDeudaNoCorriente(it?.label)) return { grupo: "noCorriente", desconocido: false };
  if (esAnticipo(it?.label)) return { grupo: "anticipo", desconocido: false };
  if (esCorriente(it?.label)) return { grupo: "operativo", desconocido: false };
  return { grupo: "operativo", desconocido: true };
}
// Un item de aCobrar → ccGrupo | prestamoSocios (activo "Socios": préstamo, no venta) | favorTarjeta | cxc.
export function clasificarActivo(it) {
  if (it?.ccGrupo) return "ccGrupo";
  if (/^socios/i.test(it?.label || "")) return "prestamoSocios";
  if (it?.esTarjeta) return "favorTarjeta";
  return "cxc";
}

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

// Sumador de una lista de items para la vista: nativo (una moneda) o consolidado (todas → USD al TC de `fecha`).
// Extraído de BalanceView para compartirlo con la Posición financiera (misma convención de traducción).
export function crearSumador({ consolidado, mon, aUSD }) {
  return (items, fecha, pred = () => true) => {
    if (!consolidado) return sumSaldo(items, mon, pred);
    const monedas = new Set(); for (const it of items) if (it.moneda) monedas.add(it.moneda);
    let s = 0; for (const mo of monedas) s += aUSD(sumSaldo(items, mo, pred), mo, fecha);
    return s;
  };
}

// Tile KPI con variación vs el período anterior. `invertir`: subir es malo (deuda) → rojo. `destacado`: el número
// headline (fondo oscuro de marca, texto flúo).
export function KpiTile({ label, value, delta = null, invertir = false, destacado = false, sub = null }) {
  const v = Number(value) || 0, d = delta == null ? null : Number(delta) || 0;
  const bueno = d == null ? null : (invertir ? d <= 0 : d >= 0);
  const fg = destacado ? T.accent : (v < 0 ? "#dc2626" : T.text);
  return (
    <div style={{ background: destacado ? T.accentDark : T.card, border: `1px solid ${destacado ? T.accentDark : T.cardBorder}`,
      borderRadius: T.radius, boxShadow: T.shadow, padding: "12px 18px", display: "flex", flexDirection: "column", gap: 3, minWidth: 190, flex: "1 1 190px" }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: destacado ? "rgba(255,255,255,.7)" : T.muted }}>{label}</span>
      <span style={{ fontSize: destacado ? 24 : 20, fontFamily: "var(--mono)", fontWeight: 900, color: fg, whiteSpace: "nowrap" }}>{fmtBal(v)}</span>
      {d != null && (
        <span style={{ fontSize: 11.5, fontFamily: "var(--mono)", fontWeight: 700, color: destacado ? (bueno ? "#bbf7d0" : "#fca5a5") : (bueno ? "#16a34a" : "#dc2626") }}>
          {d === 0 ? "sin variación" : `${d > 0 ? "▲ +" : "▼ "}${fmtBal(d)} vs cierre anterior`}
        </span>
      )}
      {sub && <span style={{ fontSize: 11, color: destacado ? "rgba(255,255,255,.6)" : T.dim }}>{sub}</span>}
    </div>
  );
}

// Orden de las líneas de detalle: alfabético dentro del subgrupo, intercompañía al final.
export const ordenarDetalle = (rows) => [...rows].sort((a, b) => (/^Intercompañía/.test(a.label) ? 1 : 0) - (/^Intercompañía/.test(b.label) ? 1 : 0) || a.label.localeCompare(b.label));
export const hoyISO = () => new Date().toISOString().slice(0, 10);
export const finMesAnterior = (iso) => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; return `${py}-${String(pm).padStart(2, "0")}-31`; };
export const esFinDeMes = (iso) => { const d = new Date(+iso.slice(0, 4), +iso.slice(5, 7), 0).getDate(); return +iso.slice(8, 10) >= d; };
// Último día REAL del mes de `iso` (válido como value de un <input type="date">; `finMesAnterior` devuelve "-31" y
// sirve solo para comparar strings).
export const ultimoDiaMes = (iso) => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); return `${y}-${String(m).padStart(2, "0")}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
// Fin del mes anterior con día real → default de fecha de la Posición financiera ("último cierre").
export const finMesAnteriorReal = (iso) => { const y = +iso.slice(0, 4), m = +iso.slice(5, 7); const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; return ultimoDiaMes(`${py}-${String(pm).padStart(2, "0")}-01`); };

// Estilos de celda compartidos por las tablas mensuales (Cash Flow / Resultado → Caja), a tono con BalanceTable.
export const celdaNum = (v, { bold = false, color = null, dim = false } = {}) => ({
  padding: "8px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--mono)", fontWeight: bold ? 800 : 500,
  color: color || (dim ? T.dim : (v < 0 ? "#dc2626" : T.text)), whiteSpace: "nowrap",
});
