import { useMemo, useState, useEffect } from "react";
import { T } from "../theme";
import { MONEDA_SYM } from "../../data/tesoreriaData";
import { normCat, ccKey, MESES, ING_CONTRA_HQ, CESION_CUENTA } from "./pnlDerive";
import { MultiSelect, selStyle, fmtSigned } from "./reportesUi";
import { crearTraductor } from "./balanceUtils";

// ─── Reporte de DEVENGADO CRUDO (diagnóstico) ─────────────────────────────────
// Objetivo: ver el devengado lo más simple posible (cuenta × mes) para cruzarlo
// contra la variación del balance, SIN el ruido del P&L de management (netos de
// contra, consolidación de sedes, cesión BN, fondeo dentro de capex). Toma las
// MISMAS fuentes económicas que el P&L (las combinadas `inConFranq`/`egConSueldos`,
// nativas por moneda, SIN fondeo), clasifica cada cuenta por su `categoria_pnl`,
// y pivotea. La suma de la fila "Resultado económico" es lo que tiene que atar
// contra la ΔPN de esa moneda/perímetro (fondeo va aparte = PN-neutro).
//
// Lectura (27/10, Martín): los retiros a inversores (cuenta "Inversores") se muestran en un bloque aparte
// DEBAJO de "Resultado antes de distribuciones" pero SIGUEN dentro del Resultado económico (es lo que ata
// contra el PN y lo que consume el Balance; decisión 23/9 de no tocarlos). Las contra-ventas a franquiciados
// (NC de Interusos, Pauta refacturada) se muestran dentro de Ventas como líneas negativas, igual que las neta
// el P&L BIGG (ING_CONTRA_HQ). El mes en curso se marca "parcial" y el Total suma solo meses cerrados.

// Grupos de resultado, en el orden pedido: Ventas → Costo → Operativos →
// Financieros → Impuestos → Inversiones no operativas → Capex. "Sin clasificar" queda al final como alerta.
// "distribuciones" va fuera de la lista normal: se dibuja después del subtotal "antes de distribuciones".
const GRUPOS = [
  { key: "ventas",         label: "Ventas" },
  { key: "costo_venta",    label: "Costo de ventas" },
  { key: "operativos",     label: "Gastos operativos" },
  { key: "financieros",    label: "Financieros" },
  { key: "impuestos",      label: "Impuestos" },
  { key: "inv_no_op",      label: "Inversiones no operativas" },
  { key: "capex",          label: "Capex / Inversión" },
  { key: "sin_clasificar", label: "⚠ Sin clasificar" },
  { key: "distribuciones", label: "Retiros a inversores (distribución)" },
];
const GRUPOS_RESULTADO = GRUPOS.filter(g => g.key !== "distribuciones");

// normCat de la cuenta (+ del centro para capex) → uno de los grupos de arriba.
// El centro con categoría "capex" manda (ej. Botánico), como en el P&L BIGG.
function grupoDe(catCuenta, catCentro) {
  if (catCentro === "capex") return "capex";
  switch (catCuenta) {
    case "ventas":            return "ventas";
    case "costo_venta":       return "costo_venta";
    case "gastos_operativos":
    case "r_y_d":
    case "sales_marketing":
    case "g_and_a":           return "operativos";
    case "gastos_financieros": return "financieros";
    case "impuestos":         return "impuestos";
    case "capex":             return "capex";
    default:                  return "sin_clasificar";
  }
}

// Cuentas que se presentan distinto de lo que dice su categoría, para que el resultado por cuenta se LEA
// (la suma no cambia). Devuelve null si no hay regla. `key` agrupa filas de ids distintos en una sola línea.
// - "Inversores" (CESION_CUENTA): retiros a inversores → bloque distribuciones (sigue dentro del resultado).
// - Lado ingreso de Interusos/Pauta/CRM (ING_CONTRA_HQ): son NC / refacturación a franquiciados → Ventas, en
//   negativo o positivo según venga, como las neta el P&L BIGG. En el lado egreso "Pauta" es la compra.
// - "Comision S/Resultado" (provisión de encargados) → operativos; "Inversiones / Gastos no Operativos" → su
//   propio grupo, como en el P&L de Sedes. Las dos no tienen categoría en Maestros: regla puente hasta cargarla.
function presentacionDe(nombre, ladoIngreso) {
  const n = nombre.trim();
  if (n === CESION_CUENTA) return { grupo: "distribuciones", key: "retiros", label: "Retiros a inversores" };
  if (ladoIngreso && ING_CONTRA_HQ.has(n)) {
    if (n === "Interusos") return { grupo: "ventas", key: "interusos-nc", label: "Interusos a franquiciados (NC)" };
    if (n === "Pauta")     return { grupo: "ventas", key: "pauta-refact", label: "Pauta refacturada a franquiciados" };
    if (n === "CRM")       return { grupo: "ventas", key: "crm-venta",    label: "CRM (venta)" };
  }
  if (!ladoIngreso && n === "Pauta") return { grupo: "operativos",  key: "pauta-compra", label: "Pauta (compra)" };
  if (!ladoIngreso && n === "CRM")   return { grupo: "costo_venta", key: "crm-costo",    label: "CRM (costo)" };
  if (/^comisi[oó]n s\/ ?resultado$/i.test(n))  return { grupo: "operativos", key: "comision-resultado", label: "Comisión s/Resultado (encargados)" };
  if (/^inversiones \/ gastos no operativos$/i.test(n)) return { grupo: "inv_no_op", key: "inv-no-op", label: n };
  return null;
}

// TODAS las fuentes de egreso guardan MAGNITUD POSITIVA del costo (comprobantes, sueldos, financiaciones,
// retenciones, histórico Y los movimientos de gasto: el writer hace `total = -monto` y el monto del egreso
// es negativo → queda positivo). Esas restan. Las únicas filas del lado egreso que SON ingreso (aportan +)
// son los movimientos contabilizados como ingreso o los interusos de gestión (pass-through ya firmado por el
// writer desde la óptica de la sede). Los ingresos de `inConFranq` siempre suman (una NC llega negativa → resta).
const EG_QUE_SUMA = new Set(["Ingreso", "Interuso gestión"]);
// Aporte al resultado (= a la variación del PN) de una fila. `sinIva` neta el IVA como el P&L (total − iva).
export function pnAmount(row, ladoIngreso, sinIva) {
  const v = (Number(row.total) || 0) - (sinIva ? (Number(row.iva_monto) || 0) : 0);
  if (ladoIngreso) return v;                    // ingreso puro: suma (NC = negativo → resta)
  if (EG_QUE_SUMA.has(row._tipo)) return v;     // movimiento-ingreso / interuso de gestión: suma
  return -v;                                     // magnitud de costo → resta
}

// Go-live: el sistema es confiable de julio 2026 en adelante. Antes vive el histórico (Contagram), que no
// analizamos línea por línea → el devengado crudo arranca acá (mismo corte que el P&L).
const GO_LIVE = "2026-07-01";
const GO_LIVE_ANIO = 2026, GO_LIVE_MES = 6;   // julio (0-based)

// Resultado devengado POR MES (misma función y perímetro `socSet` que este reporte), nativo en `mon` o consolidado
// en USD sumando cada moneda del P&L al TC del 1° del mes (`tiposCambio`). Lo usan el Balance ("De dónde viene el PN") y
// el Cash Flow indirecto ("Del resultado a la caja"): un solo loop, no dos copias. Meses fuera de [desde, hasta] = 0.
// Devuelve { res, retiros }: `res` = resultado del mes SIN los retiros a inversores; `retiros` = esos retiros (cuenta
// "Inversores", en negativo) para el puente Del resultado al patrimonio, donde bajan el patrimonio por su propia fila.
// `centrosConProvision`
// (Set de ccKey) = centros cuya cesión se provisiona (Barrio Norte): ahí la factura del cesionario cancela un pasivo
// ya registrado por la fila "Dividendos declarados" y NO vuelve a bajar el patrimonio → esos retiros no cuentan.
export function devengadoMensual(pnl, { year, consolidado, mon, socSet, tiposCambio = null, desde = GO_LIVE_MES, hasta = 11, centrosConProvision = null }) {
  const porMes = new Array(12).fill(0), retiros = new Array(12).fill(0);
  if (!pnl) return { res: porMes, retiros };
  const { aUSD } = crearTraductor(tiposCambio);
  const monedas = consolidado ? [...new Set([...(pnl.inRows || []), ...(pnl.egRows || [])].map(r => r.moneda || "ARS"))] : [mon];
  for (const mo of monedas) {
    const dev = buildDevengado(pnl.inRows || [], pnl.egRows || [], { cuentaMap: pnl.cuentaMap, ccMap: pnl.ccMap, year, moneda: mo, socSet, ccSet: null, sinIva: false });
    for (let m = desde; m <= hasta; m++) {
      // Sin los retiros a inversores: desde la tanda C de Participaciones (6/11/2026) la factura del cesionario cancela
      // la provisión (pasivo), no es resultado; el PN baja con la provisión (fila "Dividendos declarados" del puente).
      const v = (dev.resultadoAntes?.[m] ?? dev.resultado[m]) || 0;
      const f1 = `${year}-${String(m + 1).padStart(2, "0")}-01`;
      porMes[m] += consolidado ? aUSD(v, mo, f1) : v;
      let r = 0;
      for (const [cc, arr] of dev.distPorCentro || []) if (!centrosConProvision?.has(cc)) r += arr[m] || 0;
      retiros[m] += consolidado ? aUSD(r, mo, f1) : r;
    }
  }
  return { res: porMes, retiros };
}

// Resuelve la CUENTA real de una fila. Prioridad: el id que trae el comprobante (`cuenta_contable_id`);
// si no, por nombre en el maestro. Cuando un mismo NOMBRE tiene varias cuentas (colisión: "Pauta" y
// "Servicios" tienen una de Venta y una de Gasto), desempata por el LADO: ingreso → la cuenta de ventas,
// egreso → la de gasto. Así se separan (y clasifican bien) sin depender de que el nombre sea único.
function resolveCuenta(row, ladoIngreso, byId, byNombre) {
  const id = row.cuenta_contable_id;
  if (id && byId.has(id)) return byId.get(id);
  const nom = (row.cuenta_contable ?? "").trim();
  const cands = byNombre.get(nom);
  if (!cands || !cands.length) return null;
  if (cands.length === 1) return cands[0];
  const esVta = c => normCat(c.categoria_pnl) === "ventas";
  return cands.find(c => (ladoIngreso ? esVta(c) : !esVta(c))) || cands[0];
}

export function buildDevengado(inRows, egRows, { cuentaMap, ccMap, year, moneda, socSet, ccSet, sinIva }) {
  // grupo → Map(key → { id, nombre, meses:number[12] })
  const grupos = Object.fromEntries(GRUPOS.map(g => [g.key, new Map()]));
  const distPorCentro = new Map();   // retiros a inversores por centro (ccKey → [12]) → fila "Retiros de socios" del puente
  const diag = { sinCuenta: 0, sinCentro: 0, sinCuentaMonto: 0, sinCentroMonto: 0 };
  // Maestro de cuentas indexado (cuentaMap viene con claves por id Y por nombre → deduplico por id).
  const cuentas = [...new Map([...cuentaMap.values()].filter(c => c?.id).map(c => [c.id, c])).values()];
  const byId = new Map(cuentas.map(c => [c.id, c]));
  const byNombre = new Map();
  for (const c of cuentas) { const k = (c.nombre ?? "").trim(); if (!byNombre.has(k)) byNombre.set(k, []); byNombre.get(k).push(c); }
  // Ventana de meses: desde julio (go-live, en 2026) hasta el mes EN CURSO. No proyectamos al futuro
  // (las financiaciones devengan cuotas futuras y el Botánico es recurrente → Oct+ mostraría solo costos
  // sin ingresos). El mes en curso se muestra como PARCIAL (faltan ventas, sueldos…) y queda fuera del Total.
  const hoy = new Date();
  const firstM = year === GO_LIVE_ANIO ? GO_LIVE_MES : 0;
  const mesMax = year === hoy.getFullYear() ? hoy.getMonth() : 11;
  const mesParcial = year === hoy.getFullYear() ? hoy.getMonth() : null;

  const add = (rows, ladoIngreso) => {
    for (const row of (rows ?? [])) {
      const fecha = row.fecha ?? "";
      if (fecha < GO_LIVE) continue;                  // solo go-live en adelante
      if (fecha.slice(0, 4) !== String(year)) continue;
      if ((row.moneda ?? "ARS") !== moneda) continue;
      const cc = row.centro_costo ?? "";
      const ccRow = ccMap.get(ccKey(cc));
      // PERÍMETRO por la EMPRESA del CENTRO, no por la sociedad con la que se contabilizó la fila: un costo
      // de un centro de España/Colombia (fondeada) puede estar booked con una sociedad del núcleo y NO debe
      // entrar acá (es resultado de esa operación). Centro sin empresa (HQ/transversal, incl. franquicias) →
      // cae a la sociedad de la fila. Mismo criterio que buildPnLBigg (filtra por empresa del centro).
      const perim = (ccRow?.empresa ?? "").trim() || row.sociedad;
      if (socSet && !socSet.has(perim)) continue;
      if (ccSet && ccSet.size && !ccSet.has(ccKey(cc))) continue;
      const m = parseInt(fecha.slice(5, 7), 10) - 1;
      if (m < firstM || m > mesMax) continue;         // ventana go-live … mes en curso

      const raw   = (row.cuenta_contable ?? "").trim();
      const acc   = resolveCuenta(row, ladoIngreso, byId, byNombre);
      const nombre = acc?.nombre || raw || "Sin cuenta";
      const catCuenta = normCat(acc?.categoria_pnl);
      const catCentro = normCat(ccRow?.categoria_pnl);
      // Presentación por nombre manda sobre la categoría (salvo capex por centro, que es del P&L BIGG).
      const pres  = catCentro === "capex" ? null : presentacionDe(nombre, ladoIngreso);
      const grupo = pres?.grupo || grupoDe(catCuenta, catCentro);
      const key   = pres?.key || acc?.id || nombre;   // clave de agrupación (regla, id real, o nombre si no resuelve)
      const label = pres?.label || nombre;

      const val = pnAmount(row, ladoIngreso, sinIva);
      if (!val) continue;

      const map = grupos[grupo];
      if (!map.has(key)) map.set(key, { id: acc?.id || "", nombre: label, meses: new Array(12).fill(0) });
      map.get(key).meses[m] += val;
      if (grupo === "distribuciones") {
        const k = ccKey(cc);
        if (!distPorCentro.has(k)) distPorCentro.set(k, new Array(12).fill(0));
        distPorCentro.get(k)[m] += val;
      }

      // Diagnóstico: asientos que pasan el filtro pero les falta cuenta o centro.
      if (!raw)  { diag.sinCuenta++;  diag.sinCuentaMonto  += Math.abs(val); }
      if (!cc)   { diag.sinCentro++;  diag.sinCentroMonto  += Math.abs(val); }
    }
  };
  add(inRows, true);
  add(egRows, false);

  const meses = Array.from({ length: Math.max(0, mesMax - firstM + 1) }, (_, i) => firstM + i);
  const cerrados = meses.filter(m => m !== mesParcial);
  const totalDe = arr => cerrados.reduce((a, m) => a + (arr[m] || 0), 0);

  // Armar grupos con filas ordenadas (mayor |total| primero) + subtotales. El total es de meses CERRADOS.
  const armar = g => {
    const map = grupos[g.key];
    const filas = [...map.values()]
      .map(({ id, nombre, meses: arr }) => ({ id, nombre, meses: arr, total: totalDe(arr) }))
      .filter(f => f.meses.some(v => v))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    const sub = new Array(12).fill(0);
    for (const f of filas) for (let i = 0; i < 12; i++) sub[i] += f.meses[i];
    return { ...g, filas, sub, subTotal: totalDe(sub) };
  };
  const out = GRUPOS_RESULTADO.map(armar);
  const distribuciones = armar(GRUPOS.find(g => g.key === "distribuciones"));

  // Resultado antes de distribuciones (lo que se compara con el P&L BIGG) y Resultado económico (= ΔPN:
  // incluye los retiros, que para el balance son una salida de patrimonio como cualquier otra).
  const resultadoAntes = new Array(12).fill(0);
  for (const g of out) for (let i = 0; i < 12; i++) resultadoAntes[i] += g.sub[i];
  const resultado = resultadoAntes.map((v, i) => v + distribuciones.sub[i]);

  return { grupos: out.filter(g => g.filas.length), distribuciones, distPorCentro, meses, mesParcial, cerrados,
    resultadoAntes, resultadoAntesTotal: totalDe(resultadoAntes),
    resultado, resultadoTotal: totalDe(resultado), totalDe, diag };
}

// ─── Componente ───────────────────────────────────────────────────────────────
// `biggNativo(moneda)` (opcional) → { resGrupo[12], cesionBN[12] } del P&L BIGG en esa moneda, con IVA, para el
// puente en pantalla. Solo tiene sentido con el perímetro = núcleo completo y sin filtro de centro.
export default function TabDevengado({
  inRows, egRows, cuentaMap, ccMap, ccs, socGroups, nucleoEmpresas, year, setYear, years, biggNativo = null,
}) {
  const [moneda, setMoneda]   = useState("ARS");
  // Siempre CON IVA: netear `iva_monto` fila por fila NO es neutro acá (el IVA crédito vive en la cuenta aparte
  // "IVA Compra") → el resultado se movía ~63M ARS y dejaba de atar contra la ΔPN. El P&L BIGG sí tiene su
  // Sin IVA neutro por construcción (devuelve el IVA en dos líneas); este reporte no lo necesita.
  const [selSoc, setSelSoc]   = useState(null);   // null = todavía sin tocar → usa núcleo
  const [selCC, setSelCC]     = useState(new Set());

  // Sociedades: default = núcleo (como el resto de los reportes del grupo).
  const socSel = selSoc ?? new Set(nucleoEmpresas);
  // DEV-ONLY (diagnóstico puente P&L→ΔPN, descartable — sacar antes de commitear)
  if (import.meta.env.DEV) window.__pnl = { inRows, egRows, cuentaMap, ccMap, nucleoEmpresas };

  // Centros de costo para el filtro, agrupados por sociedad (empresa) para leerlos.
  const ccGroups = useMemo(() => {
    const socName = new Map();
    for (const g of (socGroups ?? [])) for (const it of g.items) socName.set(it.value, it.label);
    const byEmp = new Map();
    for (const c of (ccs ?? [])) {
      const emp = (c.empresa ?? "").trim();
      // Centros de la sociedad filtrada (o todas si no hay filtro). Los HQ/transversales (sin empresa)
      // siempre entran: son núcleo por definición (mismo criterio de perímetro que el cálculo).
      if (socSel.size && emp && !socSel.has(emp)) continue;
      if (!byEmp.has(emp)) byEmp.set(emp, []);
      byEmp.get(emp).push({ value: ccKey(c.id), label: c.nombre || c.id });
    }
    return [...byEmp.entries()]
      .map(([emp, items]) => ({ key: emp || "_", label: socName.get(emp) || emp || "Sin sociedad",
        items: items.sort((a, b) => a.label.localeCompare(b.label)) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [ccs, socGroups, socSel]);

  // Al cambiar la sociedad, el dropdown de centros se achica → podamos de la selección los centros que ya
  // no correspondan (si no, quedarían filtrando invisibles). Misma referencia si no hay cambios (evita render).
  const ccValidos = useMemo(() => new Set(ccGroups.flatMap(g => g.items.map(i => i.value))), [ccGroups]);
  useEffect(() => {
    setSelCC(prev => {
      if (!prev.size) return prev;
      const next = new Set([...prev].filter(v => ccValidos.has(v)));
      return next.size === prev.size ? prev : next;
    });
  }, [ccValidos]);

  const data = useMemo(
    () => buildDevengado(inRows, egRows, {
      cuentaMap, ccMap, year, moneda,
      socSet: socSel.size ? socSel : null,
      ccSet: selCC.size ? selCC : null,
      sinIva: false,
    }),
    [inRows, egRows, cuentaMap, ccMap, year, moneda, socSel, selCC]
  );

  // Puente al P&L BIGG: solo con el perímetro exacto del holding (núcleo completo, sin filtro de centro).
  const esNucleo = !selCC.size && socSel.size === nucleoEmpresas.size && [...nucleoEmpresas].every(s => socSel.has(s));
  const bigg = useMemo(() => (esNucleo && biggNativo) ? biggNativo(moneda) : null, [esNucleo, biggNativo, moneda]);
  const puente = useMemo(() => {
    if (!bigg) return null;
    const Z = () => new Array(12).fill(0);
    const cesion   = (bigg.cesionBN || Z()).map(v => -(Number(v) || 0));                 // resta
    const esperado = data.resultadoAntes.map((v, i) => v + cesion[i]);
    const real     = (bigg.resGrupo || Z()).map(v => Number(v) || 0);
    const dif      = esperado.map((v, i) => Math.round(v - real[i]));
    return { cesion, esperado, real, dif };
  }, [bigg, data]);

  const sym = MONEDA_SYM[moneda] || moneda;
  const nMeses = data.meses.length;
  const hayParcial = data.mesParcial != null && data.meses.includes(data.mesParcial);
  const totalLabel = hayParcial && data.cerrados.length
    ? `Total ${MESES[data.cerrados[0]]}–${MESES[data.cerrados[data.cerrados.length - 1]]}`
    : "Total";

  // Estilos de celda. Los números van en texto normal con su signo: el rojo queda para los subtotales
  // negativos, el resultado y el bloque Sin clasificar (si todo costo es rojo, el rojo no avisa nada).
  const cellR = { padding: "6px 12px", textAlign: "right", fontFamily: T.mono, fontSize: 12.5, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  const th = { padding: "8px 12px", fontSize: 10, fontWeight: 800, color: T.tableHeadText, textTransform: "uppercase",
    letterSpacing: ".06em", textAlign: "right", whiteSpace: "nowrap", background: T.tableHead, position: "sticky", top: 0, zIndex: 3 };
  const stickyL = { position: "sticky", left: 0, zIndex: 2, boxShadow: "2px 0 4px rgba(0,0,0,.04)" };
  const nameCell = { ...cellR, ...stickyL, textAlign: "left", fontFamily: T.font, fontSize: 13 };
  const colTotal = { borderLeft: `2px solid ${T.cardBorder}` };
  const mesStyle = m => (m === data.mesParcial ? { color: T.muted, background: "#fafafa" } : null);
  const vColor = (v, { alerta = false } = {}) => (!v ? T.muted : (alerta && v < 0) ? T.red : T.text);

  const filaTotal = ({ label, arr, total, strong = false, bg = T.bg, color = T.text, alerta = true, nota = null, border = `1px solid ${T.cardBorder}` }) => (
    <tr style={{ background: bg, borderTop: border }}>
      <td style={{ ...nameCell, fontWeight: strong ? 900 : 700, fontSize: strong ? 13.5 : 13, color, background: bg }}>
        {label}{nota && <span style={{ fontWeight: 500, color: strong ? color : T.muted, opacity: .8, marginLeft: 8, fontSize: 11.5 }}>{nota}</span>}
      </td>
      {data.meses.map(m => <td key={m} style={{ ...cellR, fontWeight: strong ? 900 : 700, ...mesStyle(m), color: strong ? color : vColor(arr[m], { alerta }), background: bg }}>{fmtSigned(arr[m])}</td>)}
      <td style={{ ...cellR, ...colTotal, fontWeight: strong ? 900 : 700, color: strong ? color : vColor(total, { alerta }) }}>{fmtSigned(total)}</td>
    </tr>
  );

  return (
    <div>
      {/* ── Filtros de cabecera: Año · Sociedad (por anillo) · Centro · Moneda ── */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap", alignItems: "flex-end",
        background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, padding: "12px 16px", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
        <div>
          <label style={lbl}>Año</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={selStyle}>
            {(years ?? [year]).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <MultiSelect label="Sociedad · anillo" groups={socGroups} selected={socSel}
          onChange={s => setSelSoc(s)} searchable allLabel="Todas" width={210} />
        <MultiSelect label="Centro de costo" groups={ccGroups} selected={selCC}
          onChange={setSelCC} searchable allLabel="Todos" width={220} />
        <div>
          <label style={lbl}>Moneda</label>
          <select value={moneda} onChange={e => setMoneda(e.target.value)} style={selStyle}>
            {Object.entries(MONEDA_SYM).map(([k, v]) => <option key={k} value={k}>{v} {k}</option>)}
          </select>
        </div>
        {hayParcial && (
          <div style={{ fontSize: 11.5, color: T.muted, alignSelf: "center", marginLeft: "auto" }}>
            <b style={{ color: T.text }}>{MESES[data.mesParcial]}</b> es el mes en curso: parcial, fuera del total.
          </div>
        )}
      </div>

      {/* ── Diagnóstico: asientos sin cuenta / sin centro (los que "desaparecen" del perímetro) ── */}
      {(data.diag.sinCuenta > 0 || data.diag.sinCentro > 0) && (
        <div style={{ marginBottom: 16, background: "#fef9c3", border: "1px solid #fde047", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#854d0e" }}>
          <b>⚠ Asientos incompletos en el perímetro filtrado:</b>{" "}
          {data.diag.sinCuenta > 0 && <span>{data.diag.sinCuenta} sin cuenta ({sym} {fmtSigned(data.diag.sinCuentaMonto)})</span>}
          {data.diag.sinCuenta > 0 && data.diag.sinCentro > 0 && " · "}
          {data.diag.sinCentro > 0 && <span>{data.diag.sinCentro} sin centro de costo ({sym} {fmtSigned(data.diag.sinCentroMonto)})</span>}
          <span> — estas líneas ensucian la comparación contra el balance.</span>
        </div>
      )}

      {/* ── Grilla cuenta × mes ── */}
      <div style={{ overflowX: "auto", border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, background: T.card }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 420 + (nMeses + 1) * 110 }}>
          <thead>
            <tr>
              <th style={{ ...th, ...stickyL, textAlign: "left", zIndex: 4, background: T.tableHead }}>Cuenta</th>
              {data.meses.map(m => (
                <th key={m} style={{ ...th, ...(m === data.mesParcial ? { color: "#c7d2a8" } : null) }}>
                  {MESES[m]}{m === data.mesParcial && <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: "none", marginLeft: 5 }}>· parcial</span>}
                </th>
              ))}
              <th style={{ ...th, ...colTotal }}>{totalLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.grupos.map(g => (
              <GrupoBlock key={g.key} g={g} meses={data.meses} cellR={cellR} nameCell={nameCell} colTotal={colTotal}
                mesStyle={mesStyle} vColor={vColor} alerta={g.key === "sin_clasificar"} />
            ))}

            {/* Resultado antes de distribuciones → retiros → Resultado económico (= ΔPN) */}
            {data.distribuciones.filas.length > 0 ? (
              <>
                {filaTotal({ label: "Resultado antes de distribuciones", arr: data.resultadoAntes, total: data.resultadoAntesTotal,
                  bg: "#e5e7eb", border: `2px solid ${T.accentDark}` })}
                <GrupoBlock g={data.distribuciones} meses={data.meses} cellR={cellR} nameCell={nameCell} colTotal={colTotal}
                  mesStyle={mesStyle} vColor={vColor} alerta={false} />
              </>
            ) : null}
            {filaTotal({ label: "Resultado económico", nota: "= variación del PN", arr: data.resultado, total: data.resultadoTotal,
              strong: true, bg: T.accentDark, color: T.accent, border: `2px solid ${T.accentDark}` })}

            {/* Puente al P&L BIGG (solo perímetro núcleo): antes de distribuciones − cesión BN 49% = Resultado del Grupo */}
            {puente && (
              <>
                {filaTotal({ label: "Resultado antes de distribuciones", arr: data.resultadoAntes, total: data.resultadoAntesTotal,
                  bg: T.card, alerta: false, border: `2px solid ${T.cardBorder}` })}
                {filaTotal({ label: "− Cesión Barrio Norte 49%", nota: "apropiación del socio, solo en el P&L BIGG",
                  arr: puente.cesion, total: data.totalDe(puente.cesion), bg: T.card, alerta: false, border: "none" })}
                {filaTotal({ label: "= Resultado del Grupo esperado", arr: puente.esperado, total: data.totalDe(puente.esperado), bg: T.bg, alerta: false })}
                {filaTotal({ label: "Resultado del Grupo · P&L BIGG", nota: `${moneda}, con IVA`, arr: puente.real, total: data.totalDe(puente.real), bg: T.bg, alerta: false, border: "none" })}
                {filaTotal({ label: "Diferencia sin explicar", nota: "control: tiene que ser 0",
                  arr: puente.dif, total: data.totalDe(puente.dif), bg: T.card, alerta: true, border: `1px solid ${T.cardBorder}` })}
              </>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11.5, color: T.muted, marginTop: 12, lineHeight: 1.5 }}>
        Devengado crudo por moneda nativa, con IVA (sin fondeo, sin traducción de moneda). El <b>Resultado económico</b> es
        lo que ata contra la variación del PN del balance de {sym} {moneda} en el mismo perímetro: incluye los retiros a
        inversores porque para el patrimonio son una salida más. El P&L BIGG los trata como distribución (no como gasto) y
        además le resta al grupo el 49% del resultado de Barrio Norte que es del socio: ese es todo el puente entre los dos.
        {hayParcial && <> El mes en curso se muestra parcial (faltan ventas, sueldos y cierres) y no entra en el total.</>}
      </p>
    </div>
  );
}

const lbl = { display: "block", fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 };

// Bloque de un grupo: fila de subtotal (colapsable) + filas de cuenta. El id de la cuenta queda como tooltip.
function GrupoBlock({ g, meses, cellR, nameCell, colTotal, mesStyle, vColor, alerta }) {
  const [open, setOpen] = useState(true);
  const bgSub = T.bg;
  return (
    <>
      <tr style={{ background: bgSub, borderTop: `1px solid ${T.cardBorder}`, cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
        <td style={{ ...nameCell, fontWeight: 800, color: alerta ? T.red : T.text, background: bgSub }}>
          <span style={{ display: "inline-block", width: 14, color: T.muted }}>{open ? "▾" : "▸"}</span>{g.label}
        </td>
        {meses.map(m => <td key={m} style={{ ...cellR, fontWeight: 800, ...mesStyle(m), color: vColor(g.sub[m], { alerta }), background: bgSub }}>{fmtSigned(g.sub[m])}</td>)}
        <td style={{ ...cellR, ...colTotal, fontWeight: 800, color: vColor(g.subTotal, { alerta }) }}>{fmtSigned(g.subTotal)}</td>
      </tr>
      {open && g.filas.map(f => (
        <tr key={f.id || f.nombre} style={{ background: T.card }}>
          <td style={{ ...nameCell, fontWeight: 500, color: alerta ? T.red : T.text, background: T.card, paddingLeft: 26 }} title={f.id || undefined}>{f.nombre}</td>
          {meses.map(m => <td key={m} style={{ ...cellR, ...mesStyle(m), color: vColor(f.meses[m], { alerta }) }}>{fmtSigned(f.meses[m])}</td>)}
          <td style={{ ...cellR, ...colTotal, color: vColor(f.total, { alerta }) }}>{fmtSigned(f.total)}</td>
        </tr>
      ))}
    </>
  );
}
