import { useMemo, useState, useEffect } from "react";
import { T } from "../theme";
import { MONEDA_SYM } from "../../data/tesoreriaData";
import { normCat, ccKey, MultiSelect, selStyle, MESES, fmtSigned } from "../PantallaReportes";

// ─── Reporte de DEVENGADO CRUDO (diagnóstico) ─────────────────────────────────
// Objetivo: ver el devengado lo más simple posible (cuenta × mes) para cruzarlo
// contra la variación del balance, SIN el ruido del P&L de management (netos de
// contra, consolidación de sedes, cesión BN, fondeo dentro de capex). Toma las
// MISMAS fuentes económicas que el P&L (las combinadas `inConFranq`/`egConSueldos`,
// nativas por moneda, SIN fondeo), clasifica cada cuenta por su `categoria_pnl`,
// y pivotea. La suma de la fila "Resultado económico" es lo que tiene que atar
// contra la ΔPN de esa moneda/perímetro (fondeo va aparte = PN-neutro).

// Grupos de resultado, en el orden pedido: Ventas → Costo → Operativos →
// Financieros → Impuestos → Capex. "Sin clasificar" queda al final como alerta.
const GRUPOS = [
  { key: "ventas",         label: "Ventas" },
  { key: "costo_venta",    label: "Costo de ventas" },
  { key: "operativos",     label: "Gastos operativos" },
  { key: "financieros",    label: "Financieros" },
  { key: "impuestos",      label: "Impuestos" },
  { key: "capex",          label: "Capex / Inversión" },
  { key: "sin_clasificar", label: "⚠ Sin clasificar" },
];

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

// TODAS las fuentes de egreso guardan MAGNITUD POSITIVA del costo (comprobantes, sueldos, financiaciones,
// retenciones, histórico Y los movimientos de gasto: el writer hace `total = -monto` y el monto del egreso
// es negativo → queda positivo). Esas restan. Las únicas filas del lado egreso que SON ingreso (aportan +)
// son los movimientos contabilizados como ingreso o los interusos de gestión (pass-through ya firmado por el
// writer desde la óptica de la sede). Los ingresos de `inConFranq` siempre suman (una NC llega negativa → resta).
const EG_QUE_SUMA = new Set(["Ingreso", "Interuso gestión"]);
// Aporte al resultado (= a la variación del PN) de una fila. `sinIva` neta el IVA como el P&L (total − iva).
function pnAmount(row, ladoIngreso, sinIva) {
  const v = (Number(row.total) || 0) - (sinIva ? (Number(row.iva_monto) || 0) : 0);
  if (ladoIngreso) return v;                    // ingreso puro: suma (NC = negativo → resta)
  if (EG_QUE_SUMA.has(row._tipo)) return v;     // movimiento-ingreso / interuso de gestión: suma
  return -v;                                     // magnitud de costo → resta
}

// Go-live: el sistema es confiable de julio 2026 en adelante. Antes vive el histórico (Contagram), que no
// analizamos línea por línea → el devengado crudo arranca acá (mismo corte que el P&L).
const GO_LIVE = "2026-07-01";
const GO_LIVE_ANIO = 2026, GO_LIVE_MES = 6;   // julio (0-based)

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

function buildDevengado(inRows, egRows, { cuentaMap, ccMap, year, moneda, socSet, ccSet, sinIva }) {
  // grupo → Map(idCuenta → { id, nombre, meses:number[12] })
  const grupos = Object.fromEntries(GRUPOS.map(g => [g.key, new Map()]));
  const diag = { sinCuenta: 0, sinCentro: 0, sinCuentaMonto: 0, sinCentroMonto: 0 };
  // Maestro de cuentas indexado (cuentaMap viene con claves por id Y por nombre → deduplico por id).
  const cuentas = [...new Map([...cuentaMap.values()].filter(c => c?.id).map(c => [c.id, c])).values()];
  const byId = new Map(cuentas.map(c => [c.id, c]));
  const byNombre = new Map();
  for (const c of cuentas) { const k = (c.nombre ?? "").trim(); if (!byNombre.has(k)) byNombre.set(k, []); byNombre.get(k).push(c); }
  // Ventana de meses: desde julio (go-live, en 2026) hasta el mes EN CURSO. No proyectamos al futuro
  // (las financiaciones devengan cuotas futuras y el Botánico es recurrente → Oct+ mostraría solo costos
  // sin ingresos). Se reconcilian meses cerrados.
  const hoy = new Date();
  const firstM = year === GO_LIVE_ANIO ? GO_LIVE_MES : 0;
  const mesMax = year === hoy.getFullYear() ? hoy.getMonth() : 11;

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
      const idCta  = acc?.id || nombre;               // clave de agrupación (id real, o nombre si no resuelve)
      const catCuenta = normCat(acc?.categoria_pnl);
      const catCentro = normCat(ccRow?.categoria_pnl);
      const grupo = grupoDe(catCuenta, catCentro);

      const val = pnAmount(row, ladoIngreso, sinIva);
      if (!val) continue;

      const map = grupos[grupo];
      if (!map.has(idCta)) map.set(idCta, { id: acc?.id || "", nombre, meses: new Array(12).fill(0) });
      map.get(idCta).meses[m] += val;

      // Diagnóstico: asientos que pasan el filtro pero les falta cuenta o centro.
      if (!raw)  { diag.sinCuenta++;  diag.sinCuentaMonto  += Math.abs(val); }
      if (!cc)   { diag.sinCentro++;  diag.sinCentroMonto  += Math.abs(val); }
    }
  };
  add(inRows, true);
  add(egRows, false);

  const meses = Array.from({ length: Math.max(0, mesMax - firstM + 1) }, (_, i) => firstM + i);

  // Armar grupos con filas ordenadas (mayor |total| primero) + subtotales.
  const out = GRUPOS.map(g => {
    const map = grupos[g.key];
    const filas = [...map.values()]
      .map(({ id, nombre, meses: arr }) => ({ id, nombre, meses: arr, total: arr.reduce((a, b) => a + b, 0) }))
      .filter(f => f.total || f.meses.some(v => v))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    const sub = new Array(12).fill(0);
    for (const f of filas) for (let i = 0; i < 12; i++) sub[i] += f.meses[i];
    return { ...g, filas, sub, subTotal: sub.reduce((a, b) => a + b, 0) };
  });

  const resultado = new Array(12).fill(0);
  for (const g of out) for (let i = 0; i < 12; i++) resultado[i] += g.sub[i];

  return { grupos: out.filter(g => g.filas.length), meses, resultado,
    resultadoTotal: resultado.reduce((a, b) => a + b, 0), diag };
}

// ─── Componente ───────────────────────────────────────────────────────────────
export default function TabDevengado({
  inRows, egRows, cuentaMap, ccMap, ccs, socGroups, nucleoEmpresas, year, setYear, years,
}) {
  const [moneda, setMoneda]   = useState("ARS");
  // Default CON IVA: el neteo "sin IVA" (total − iva_monto por fila) NO es neutro en ARS, porque el IVA crédito
  // no viaja pegado al costo sino en una cuenta aparte ("IVA Compra") → netear sub-cuenta el resultado ~63M.
  // Con IVA, el crudo ata contra el P&L de management (y contra la ΔPN). En USD/EUR da igual (casi no hay IVA).
  const [sinIva, setSinIva]   = useState(false);
  const [selSoc, setSelSoc]   = useState(null);   // null = todavía sin tocar → usa núcleo
  const [selCC, setSelCC]     = useState(new Set());
  const [showDiag, setShowDiag] = useState(false);

  // Sociedades: default = núcleo (como el resto de los reportes del grupo).
  const socSel = selSoc ?? new Set(nucleoEmpresas);

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
      sinIva,
    }),
    [inRows, egRows, cuentaMap, ccMap, year, moneda, socSel, selCC, sinIva]
  );

  const sym = MONEDA_SYM[moneda] || moneda;
  const nMeses = data.meses.length;

  // Estilos de celda
  const cellR = { padding: "6px 12px", textAlign: "right", fontFamily: T.mono, fontSize: 12.5, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  const th = { padding: "8px 12px", fontSize: 10, fontWeight: 800, color: T.tableHeadText, textTransform: "uppercase",
    letterSpacing: ".06em", textAlign: "right", whiteSpace: "nowrap", background: T.tableHead, position: "sticky", top: 0, zIndex: 3 };
  const stickyL = { position: "sticky", left: 0, background: "inherit", zIndex: 2, boxShadow: "2px 0 4px rgba(0,0,0,.04)" };

  const valCol = v => v < 0 ? T.red : (v > 0 ? T.text : T.muted);
  const idCell = { padding: "6px 12px", textAlign: "left", fontFamily: T.mono, fontSize: 11, color: T.muted, whiteSpace: "nowrap" };

  return (
    <div>
      {/* ── Filtros de cabecera: Año · Sociedad (por anillo) · Centro · Moneda · Sin IVA ── */}
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
        <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: T.text, height: 36 }}>
          <input type="checkbox" checked={sinIva} onChange={e => setSinIva(e.target.checked)} style={{ accentColor: T.accentDark }} />
          Sin IVA
        </label>
      </div>

      {/* ── Diagnóstico: asientos sin cuenta / sin centro (los que "desaparecen" del perímetro) ── */}
      {(data.diag.sinCuenta > 0 || data.diag.sinCentro > 0) && (
        <div style={{ marginBottom: 16, background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "#92400e" }}>
          <b>⚠ Asientos incompletos en el perímetro filtrado:</b>{" "}
          {data.diag.sinCuenta > 0 && <span>{data.diag.sinCuenta} sin cuenta ({sym} {fmtSigned(data.diag.sinCuentaMonto)})</span>}
          {data.diag.sinCuenta > 0 && data.diag.sinCentro > 0 && " · "}
          {data.diag.sinCentro > 0 && <span>{data.diag.sinCentro} sin centro de costo ({sym} {fmtSigned(data.diag.sinCentroMonto)})</span>}
          <span style={{ color: "#b45309" }}> — estas líneas ensucian la comparación contra el balance.</span>
        </div>
      )}

      {/* ── Grilla cuenta × mes ── */}
      <div style={{ overflowX: "auto", border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, background: T.card }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 + nMeses * 76 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left", left: 0, zIndex: 4, ...stickyL }}>Cuenta</th>
              <th style={{ ...th, textAlign: "left" }}>ID</th>
              {data.meses.map(m => <th key={m} style={th}>{MESES[m]}</th>)}
              <th style={{ ...th, borderLeft: `2px solid ${T.cardBorder}` }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {data.grupos.map(g => (
              <GrupoBlock key={g.key} g={g} meses={data.meses} cellR={cellR} stickyL={stickyL} valCol={valCol} idCell={idCell} />
            ))}
            {/* Resultado económico */}
            <tr style={{ background: "#eef2ff", borderTop: `2px solid ${T.accentDark}` }}>
              <td style={{ ...cellR, ...stickyL, textAlign: "left", fontWeight: 900, fontSize: 13, color: T.text, background: "#eef2ff" }}>
                Resultado económico
              </td>
              <td style={{ ...idCell, background: "#eef2ff" }} />
              {data.meses.map(m => (
                <td key={m} style={{ ...cellR, fontWeight: 900, color: valCol(data.resultado[m]) }}>{fmtSigned(data.resultado[m])}</td>
              ))}
              <td style={{ ...cellR, fontWeight: 900, borderLeft: `2px solid ${T.cardBorder}`, color: valCol(data.resultadoTotal) }}>{fmtSigned(data.resultadoTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11.5, color: T.muted, marginTop: 12, lineHeight: 1.5 }}>
        Devengado crudo por moneda nativa (sin fondeo, sin traducción de moneda). El <b>Resultado económico</b> es
        lo que tiene que atar contra la variación del PN del balance de {sym} {moneda} en el mismo perímetro.
      </p>
    </div>
  );
}

const lbl = { display: "block", fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 };

// Bloque de un grupo: fila de subtotal (colapsable) + filas de cuenta.
function GrupoBlock({ g, meses, cellR, stickyL, valCol, idCell }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <tr style={{ background: "#f8fafc", borderTop: `1px solid ${T.cardBorder}`, cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
        <td style={{ ...cellR, ...stickyL, textAlign: "left", fontWeight: 800, fontSize: 12.5, color: T.text, background: "#f8fafc" }}>
          <span style={{ display: "inline-block", width: 14, color: T.muted }}>{open ? "▾" : "▸"}</span>{g.label}
        </td>
        <td style={{ ...idCell, background: "#f8fafc" }} />
        {meses.map(m => <td key={m} style={{ ...cellR, fontWeight: 800, color: valCol(g.sub[m]) }}>{fmtSigned(g.sub[m])}</td>)}
        <td style={{ ...cellR, fontWeight: 800, borderLeft: `2px solid ${T.cardBorder}`, color: valCol(g.subTotal) }}>{fmtSigned(g.subTotal)}</td>
      </tr>
      {open && g.filas.map(f => (
        <tr key={f.id || f.nombre} style={{ background: T.card }}>
          <td style={{ ...cellR, ...stickyL, textAlign: "left", fontWeight: 500, color: T.text, background: T.card, paddingLeft: 26 }}>{f.nombre}</td>
          <td style={{ ...idCell }} title={f.id}>{f.id || "—"}</td>
          {meses.map(m => <td key={m} style={{ ...cellR, color: valCol(f.meses[m]) }}>{fmtSigned(f.meses[m])}</td>)}
          <td style={{ ...cellR, borderLeft: `2px solid ${T.cardBorder}`, color: valCol(f.total) }}>{fmtSigned(f.total)}</td>
        </tr>
      ))}
    </>
  );
}
