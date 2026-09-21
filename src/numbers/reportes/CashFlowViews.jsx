// Cash Flow dentro de Tesorería consolidada (misma carga, mismos filtros y mismo motor de saldos que Balance/EEPN).
//  · CashFlowDirectoView  — "Por qué se movió la caja": método directo por naturaleza (cashflowDerive.computeCashFlow).
//  · ResultadoACajaView   — "Del resultado a la caja": método INDIRECTO real. Resultado devengado (buildDevengado,
//    mismo perímetro/moneda que el Balance) ± variación de cada rubro del Balance entre cierres (deriveAsOf) + cambio de
//    moneda = variación de caja. Sin residuo mágico: lo que no cierra queda como "Sin explicar" (la misma fila del
//    puente P&L↔PN) y, como control cruzado, se compara la variación por SALDOS con la variación por MOVIMIENTOS del
//    Cash Flow directo (fuentes distintas → deberían coincidir).
// Rediseño 19/9/2026 pedido por Martín ("necesito entender si tengo caja positiva o negativa y por qué").
import { useState, useMemo, Fragment } from "react";
import { T } from "../theme";
import { buildDevengado } from "./TabDevengado";
import { MESES_CORTOS, sumSaldo, fmtBal, crearTraductor, AvisosTC, ordenarDetalle } from "./balanceUtils";
import { CF_ACT, CF_CONCEPTO_ORDEN } from "./cashflowDerive";

// ── Tabla mensual compartida (Concepto | meses | TOTAL de meses cerrados). El mes en curso va en gris. ──
const thBase = { padding: "9px 12px", fontSize: 11, fontWeight: 800, color: T.tableHeadText, textAlign: "right", whiteSpace: "nowrap" };
function TablaMensual({ meses, mesEnCurso, minBase = 360, colW = 110, children, onToggleAll, allOpen }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: minBase + (meses.length + 1) * colW }}>
        <thead>
          <tr style={{ background: T.tableHead }}>
            <th onClick={onToggleAll} style={{ padding: "9px 14px", fontSize: 11, fontWeight: 800, color: T.tableHeadText, textAlign: "left", letterSpacing: ".04em", textTransform: "uppercase", cursor: onToggleAll ? "pointer" : "default", userSelect: "none" }}>
              {onToggleAll && <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{allOpen ? "▼" : "▶"}</span>}Concepto
            </th>
            {meses.map(m => <th key={m} style={{ ...thBase, opacity: m === mesEnCurso ? .55 : 1 }}>{MESES_CORTOS[m]}{m === mesEnCurso ? " · en curso" : ""}</th>)}
            <th style={{ ...thBase, borderLeft: "1px solid rgba(255,255,255,.15)" }}>Total{mesEnCurso != null && meses.includes(mesEnCurso) ? " cerrados" : ""}</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
const num = (v, { bold = false, color = null, dim = false } = {}) => ({
  padding: "8px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--mono)", fontWeight: bold ? 800 : 500,
  color: color || (dim ? T.dim : (v < 0 ? "#dc2626" : T.text)), whiteSpace: "nowrap",
});
// Fila genérica: `get(m)` por mes; `total` = "suma" (meses cerrados) | "primero" | "ultimo" | null.
function Fila({ label, get, meses, cerrados, mesEnCurso, indent = 28, bold = false, color = null, bg = null, total = "suma", sub = null }) {
  const tot = total === "suma" ? cerrados.reduce((s, m) => s + get(m), 0)
    : total === "primero" ? (meses.length ? get(meses[0]) : 0)
    : total === "ultimo" ? (cerrados.length ? get(cerrados[cerrados.length - 1]) : 0) : null;
  return (
    <tr style={{ borderTop: `1px solid ${T.cardBorder}`, background: bg || "transparent" }}>
      <td style={{ padding: `8px 14px 8px ${indent}px`, fontSize: 13, color: color || T.text, fontWeight: bold ? 800 : 500, whiteSpace: "nowrap" }}>
        {label}{sub && <div style={{ fontSize: 10.5, color: T.muted, fontWeight: 500, whiteSpace: "normal", maxWidth: 420 }}>{sub}</div>}
      </td>
      {meses.map(m => <td key={m} style={{ ...num(get(m), { bold, color, dim: m === mesEnCurso }), opacity: m === mesEnCurso ? .6 : 1 }}>{fmtBal(get(m))}</td>)}
      <td style={{ ...num(tot ?? 0, { bold: true, color }), borderLeft: `1px solid ${T.cardBorder}` }}>{tot == null ? "" : fmtBal(tot)}</td>
    </tr>
  );
}
// Banda de sección colapsable con valores (total de la sección por mes).
function Banda({ label, get, meses, cerrados, mesEnCurso, open, onToggle, tono = "oscuro" }) {
  const bg = tono === "oscuro" ? T.tableHead : "#f8fafc", fg = tono === "oscuro" ? T.tableHeadText : T.text;
  const tot = cerrados.reduce((s, m) => s + get(m), 0);
  return (
    <tr style={{ background: bg, cursor: onToggle ? "pointer" : "default" }} onClick={onToggle}>
      <td style={{ padding: "8px 14px", fontSize: 11.5, fontWeight: 800, color: fg, letterSpacing: ".06em", textTransform: "uppercase", userSelect: "none", whiteSpace: "nowrap" }}>
        {onToggle && <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{open ? "▼" : "▶"}</span>}{label}
      </td>
      {meses.map(m => <td key={m} style={{ ...num(get(m), { bold: true, color: fg }), opacity: m === mesEnCurso ? .55 : 1 }}>{fmtBal(get(m))}</td>)}
      <td style={{ ...num(tot, { bold: true, color: fg }), borderLeft: "1px solid rgba(255,255,255,.15)" }}>{fmtBal(tot)}</td>
    </tr>
  );
}
// Fila de resultado (verde/rojo por signo de cada celda).
function FilaResultado({ label, get, meses, cerrados, mesEnCurso, strong = false, total = "suma", bgOk = "#f0fdf4", bgBad = "#fff1f2" }) {
  const tot = total === "suma" ? cerrados.reduce((s, m) => s + get(m), 0) : (cerrados.length ? get(cerrados[cerrados.length - 1]) : 0);
  const col = v => v > 0.5 ? "#15803d" : v < -0.5 ? "#dc2626" : T.dim;
  return (
    <tr style={{ background: tot >= 0 ? bgOk : bgBad, borderTop: `2px solid ${col(tot)}` }}>
      <td style={{ padding: "10px 14px", fontSize: strong ? 14 : 13, fontWeight: 900, color: col(tot), whiteSpace: "nowrap" }}>{label}</td>
      {meses.map(m => <td key={m} style={{ ...num(get(m), { bold: true, color: col(get(m)) }), fontSize: strong ? 14 : 13, opacity: m === mesEnCurso ? .6 : 1 }}>{fmtBal(get(m))}</td>)}
      <td style={{ ...num(tot, { bold: true, color: col(tot) }), fontSize: strong ? 14 : 13, borderLeft: `1px solid ${T.cardBorder}` }}>{fmtBal(tot)}</td>
    </tr>
  );
}
function Chip({ label, v, strong = false }) {
  const col = strong ? (v >= 0 ? "#15803d" : "#dc2626") : T.text;
  return (
    <div style={{ flex: "1 1 150px", minWidth: 150, background: T.card, border: `1px solid ${strong ? col : T.cardBorder}`, borderRadius: 10, padding: "10px 14px", boxShadow: T.shadow }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, fontFamily: "var(--mono)", color: col, marginTop: 3 }}>{fmtBal(v)}</div>
    </div>
  );
}
function Aviso({ children, tono = "warn" }) {
  const s = tono === "warn" ? { bg: "#fffbeb", bd: "#fde68a", fg: "#92400e" } : { bg: "#f0fdf4", bd: "#bbf7d0", fg: "#166534" };
  return <div style={{ fontSize: 12, color: s.fg, background: s.bg, border: `1px solid ${s.bd}`, borderRadius: 8, padding: "7px 12px", marginBottom: 8 }}>{children}</div>;
}

// ── Vista A: "Por qué se movió la caja" (directo, por naturaleza) ──
export function CashFlowDirectoView({ cf, consolidado, mon, avisosTC = null }) {
  const [open, setOpen] = useState({ operativo: true, inversion: true, financiacion: true, cambio: true, control: true });
  const toggle = k => setOpen(o => ({ ...o, [k]: !o[k] }));
  if (!cf) return null;
  const meses = cf.activeMonths, mesEnCurso = cf.mesEnCurso;
  const cerrados = meses.filter(m => m !== mesEnCurso);
  const sum = (arr) => cerrados.reduce((s, m) => s + (arr[m] || 0), 0);
  const tot = (k) => cf.actTot[k] || new Array(12).fill(0);
  const ctrl = cf.porAct.control || {};
  const alertas = Object.entries(ctrl).map(([c, vals]) => ({ c, v: sum(vals), meses: cerrados.filter(m => Math.abs(vals[m]) > 0.5) })).filter(a => Math.abs(a.v) > 0.5 || a.meses.length);
  const keysAll = CF_ACT.map(a => a.key); const allOpen = keysAll.every(k => open[k]);
  const p = { meses, cerrados, mesEnCurso };
  return (
    <div className="fade">
      <div style={{ fontSize: 12, color: T.muted, margin: "2px 0 10px", lineHeight: 1.5, maxWidth: 900 }}>
        {consolidado
          ? <><b>Consolidado del grupo en USD</b>: cada movimiento al tipo de cambio de su mes. Elegí una moneda arriba para ver la caja nativa de esa moneda.</>
          : <>Caja en <b>{mon}</b>: solo las cuentas de esa moneda.</>}
        {" "}Cada bloque responde una pregunta: ¿el negocio genera o consume plata? (Operación) · ¿qué se fondeó? · ¿qué plata entró que no es resultado? (Financiación) · ¿cuánta plata cambió de moneda? Los totales son de <b>meses cerrados</b>; el mes en curso va en gris.
      </div>
      {avisosTC}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <Chip label="Operación" v={sum(tot("operativo"))} />
        <Chip label="Fondeo e inversión" v={sum(tot("inversion"))} />
        <Chip label="Financiación" v={sum(tot("financiacion"))} />
        <Chip label="Cambio de moneda" v={sum(tot("cambio"))} />
        <Chip label="Variación de caja" v={sum(cf.flujoNeto)} strong />
      </div>
      {alertas.map(a => (
        <Aviso key={a.c}><b>{a.c}</b>: {fmtBal(a.v)} en meses cerrados ({a.meses.map(m => MESES_CORTOS[m]).join(", ")}). Debería dar cero: {/sin par/i.test(a.c) ? "hay transferencias entre cuentas propias con una sola pata (revisar en Conciliación)." : "hay líneas del extracto sin imputar todavía (Conciliación)."}</Aviso>
      ))}
      <TablaMensual meses={meses} mesEnCurso={mesEnCurso} onToggleAll={() => { const v = !allOpen; setOpen(Object.fromEntries(keysAll.map(k => [k, v]))); }} allOpen={allOpen}>
        <Fila label="Saldo de caja al inicio del mes" get={m => cf.saldoInicioMes[m]} {...p} indent={14} color={T.muted} total="primero" />
        {CF_ACT.map(({ key, label }) => {
          const conceptos = Object.entries(cf.porAct[key] || {});
          if (key === "control" && conceptos.every(([, v]) => v.every(x => Math.abs(x) < 0.5))) return null;
          const ord = CF_CONCEPTO_ORDEN[key] || []; const rank = n => { const i = ord.indexOf(n); return i === -1 ? 99 : i; };
          conceptos.sort((a, b) => rank(a[0]) - rank(b[0]));
          return (
            <Fragment key={key}>
              <Banda label={label} get={m => tot(key)[m]} {...p} open={open[key]} onToggle={conceptos.length ? () => toggle(key) : null} />
              {open[key] && conceptos.map(([nombre, vals]) => <Fila key={nombre} label={nombre} get={m => vals[m]} {...p} />)}
            </Fragment>
          );
        })}
        <FilaResultado label="Variación de caja del mes" get={m => cf.flujoNeto[m]} {...p} strong />
        <Fila label="Saldo de caja al cierre del mes" get={m => cf.saldoFinal[m]} {...p} indent={14} bold total="ultimo" bg="#f3f4f6" />
      </TablaMensual>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 8, lineHeight: 1.5, maxWidth: 900 }}>
        <b>Operación</b> se abre por naturaleza del cobro o pago (clientes, franquicias, sueldos, impuestos, tarjeta, proveedores), no por centro de costo.
        <b> Fondeo</b> = plata a centros de una sociedad fuera de las elegidas + movimientos intercompañía sin su par adentro.
        <b> Financiación</b> = plata que entra o sale sin ser resultado (planes y préstamos, anticipos de clientes, socios).
        <b> Cambio de moneda</b>: en una moneda sola es la pata que entra o sale de esa moneda; en el consolidado, el neto de las dos patas al TC del mes.
        Para ver cómo el resultado se convirtió en esta caja, usá <b>Del resultado a la caja</b>.
      </div>
    </div>
  );
}

// ── Vista B: "Del resultado a la caja" (indirecto real, desde el Balance) ──
// `eepn` = { year, GO, upto, balMes } del padre (deriveAsOf a fin de cada mes; GO-1 = apertura 30/6).
export function ResultadoACajaView({ eepn, consolidado, mon, tiposCambio = null, pnl = null, socSet, movimientos = [], cfDirecto = null }) {
  const [open, setOpen] = useState({ act: true, pas: true });
  const data = useMemo(() => {
    if (!eepn) return null;
    const { year, GO, upto, balMes } = eepn;
    const { aUSD, faltaTC, tcSuplente } = crearTraductor(tiposCambio);
    const finDeMes = (m) => `${year}-${String(m + 1).padStart(2, "0")}-31`;
    const bd = m => balMes[m] || { cuentas: [], aCobrar: [], aPagar: [], intercoAct: [], intercoPas: [] };
    const monedasDe = (arrs) => { const st = new Set(); arrs.forEach(a => a.forEach(it => it.moneda && st.add(it.moneda))); return [...st]; };
    const suma = (arr, m, pred = () => true) => consolidado
      ? monedasDe([arr]).reduce((s, mo) => s + aUSD(sumSaldo(arr, mo, pred), mo, finDeMes(m)), 0)
      : sumSaldo(arr, mon, pred);
    const meses = []; for (let m = GO; m <= upto; m++) meses.push(m);
    const hoy = new Date(); const mesEnCurso = hoy.getFullYear() === year ? hoy.getMonth() : null;
    const cerrados = meses.filter(m => m !== mesEnCurso);
    const cash = m => suma(bd(m).cuentas, m, c => (c.tipo || "") !== "tarjeta");
    const dCaja = m => cash(m) - cash(m - 1);
    // Resultado devengado del mes: misma función y perímetro (socSet) que el Devengado y el Balance.
    const res = new Array(12).fill(0);
    if (pnl && year === 2026) {
      const monedasPnL = consolidado ? [...new Set([...(pnl.inRows || []), ...(pnl.egRows || [])].map(r => r.moneda || "ARS"))] : [mon];
      for (const mo of monedasPnL) {
        const dev = buildDevengado(pnl.inRows || [], pnl.egRows || [], { cuentaMap: pnl.cuentaMap, ccMap: pnl.ccMap, year, moneda: mo, socSet, ccSet: null, sinIva: false });
        for (const m of meses) { const v = dev.resultado[m] || 0; res[m] += consolidado ? aUSD(v, mo, `${year}-${String(m + 1).padStart(2, "0")}-01`) : v; }
      }
    }
    // Cambio de moneda del mes (origen "cambio"): nativo = la pata de esta moneda; consolidado = las dos patas al TC.
    const cambio = new Array(12).fill(0);
    for (const mv of movimientos || []) {
      if (mv.origen !== "cambio" || !socSet.has(String(mv.sociedad || "").toLowerCase())) continue;
      const f = String(mv.fecha || "").slice(0, 10); if (f.slice(0, 4) !== String(year)) continue;
      const m = +f.slice(5, 7) - 1; const mo = mv.moneda || "ARS";
      if (consolidado) cambio[m] += aUSD(Number(mv.monto) || 0, mo, f); else if (mo === mon) cambio[m] += Number(mv.monto) || 0;
    }
    // Rubros del Balance: variación entre cierres. Activo (no caja): sube → consumió caja (−Δ). Pasivo: sube → aportó caja (+Δ).
    const uniq = (arrName) => { const s = new Set(); for (let m = GO - 1; m <= upto; m++) bd(m)[arrName].forEach(it => s.add(it.label)); return [...s]; };
    const sumLbl = (arrName, m, L) => suma(bd(m)[arrName], m, it => it.label === L);
    const actRows = ordenarDetalle([
      ...uniq("aCobrar").map(L => ({ label: L, get: m => -(sumLbl("aCobrar", m, L) - sumLbl("aCobrar", m - 1, L)) })),
      { label: "Intercompañía (nos deben)", get: m => -(suma(bd(m).intercoAct, m) - suma(bd(m - 1).intercoAct, m - 1)) },
    ]);
    const pasRows = ordenarDetalle([
      ...uniq("aPagar").map(L => ({ label: L, get: m => sumLbl("aPagar", m, L) - sumLbl("aPagar", m - 1, L) })),
      { label: "Intercompañía (les debemos)", get: m => suma(bd(m).intercoPas, m) - suma(bd(m - 1).intercoPas, m - 1) },
    ]);
    const nz = r => meses.some(m => Math.abs(r.get(m)) > 0.5);
    const act = actRows.filter(nz), pas = pasRows.filter(nz);
    const actTot = m => act.reduce((s, r) => s + r.get(m), 0);
    const pasTot = m => pas.reduce((s, r) => s + r.get(m), 0);
    const explicado = m => res[m] + cambio[m] + actTot(m) + pasTot(m);
    const sinExplicar = m => dCaja(m) - explicado(m);
    const directo = m => cfDirecto ? (cfDirecto.flujoNeto[m] || 0) : null;
    return { year, meses, cerrados, mesEnCurso, cash, dCaja, res, cambio, act, pas, actTot, pasTot, explicado, sinExplicar, directo, faltaTC, tcSuplente, hayPnl: !!pnl && year === 2026 };
  }, [eepn, consolidado, mon, tiposCambio, pnl, socSet, movimientos, cfDirecto]);

  if (!data) return null;
  const { meses, cerrados, mesEnCurso, cash, dCaja, res, cambio, act, pas, actTot, pasTot, explicado, sinExplicar, directo, faltaTC, tcSuplente, hayPnl } = data;
  const p = { meses, cerrados, mesEnCurso };
  const sum = get => cerrados.reduce((s, m) => s + get(m), 0);
  const difDirecto = m => directo(m) == null ? 0 : dCaja(m) - directo(m);
  const okDirecto = cerrados.every(m => Math.abs(difDirecto(m)) < 1);
  const labelCambio = consolidado ? "Resultado por cambio de moneda (TC operado vs TC maestro)" : "Cambio de moneda (plata que entró o salió de esta moneda)";
  return (
    <div className="fade">
      <div style={{ fontSize: 12, color: T.muted, margin: "2px 0 10px", lineHeight: 1.5, maxWidth: 900 }}>
        Cómo el <b>resultado devengado</b> (el mismo del Devengado y del Balance, {consolidado ? "consolidado en USD" : mon}) se convierte en <b>caja</b>: se le suma lo que entró sin ser resultado y se le resta lo que el resultado cuenta pero todavía no se cobró o ya se pagó. Cada fila es la variación de un rubro del Balance entre un cierre y el siguiente. Una fila <span style={{ color: "#dc2626", fontWeight: 700 }}>negativa</span> consumió caja; una positiva la aportó.
      </div>
      <AvisosTC tcSuplente={tcSuplente} faltaTC={faltaTC} />
      {!hayPnl && <Aviso>No llegó el P&L (filas devengadas) a esta vista: el resultado se muestra en cero.</Aviso>}
      {cfDirecto && !okDirecto && (
        <Aviso>La variación de caja por <b>saldos</b> (Balance) y por <b>movimientos</b> (Cash Flow directo) no coinciden en algún mes cerrado: ver la fila de control abajo. Suele ser una cuenta bancaria inactiva con saldo, una cuenta que no está en Maestros, o una diferencia de tipo de cambio dentro del mes (consolidado).</Aviso>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <Chip label="Resultado devengado" v={sum(m => res[m])} />
        <Chip label="Activos (cobros pendientes, adelantos)" v={sum(actTot)} />
        <Chip label="Pasivos (pagos pendientes, financiación)" v={sum(pasTot)} />
        <Chip label={consolidado ? "Cambio de moneda (resultado)" : "Cambio de moneda"} v={sum(m => cambio[m])} />
        <Chip label="Variación de caja" v={sum(dCaja)} strong />
      </div>
      <TablaMensual meses={meses} mesEnCurso={mesEnCurso} minBase={420}>
        <Fila label="Saldo de caja al inicio del mes" get={m => cash(m - 1)} {...p} indent={14} color={T.muted} total="primero" />
        <Fila label="Resultado devengado del mes (P&L)" get={m => res[m]} {...p} indent={14} bold bg="#f8fafc" />
        <Fila label={`(+) ${labelCambio}`} get={m => cambio[m]} {...p} indent={14} />
        <Banda label="Plata que el resultado ya cuenta pero no está en caja (activos)" get={actTot} {...p} open={open.act} onToggle={() => setOpen(o => ({ ...o, act: !o.act }))} />
        {open.act && act.map(r => <Fila key={r.label} label={r.label} get={r.get} {...p} indent={40} sub={null} />)}
        <Banda label="Plata que está en caja pero el resultado no cuenta (pasivos)" get={pasTot} {...p} open={open.pas} onToggle={() => setOpen(o => ({ ...o, pas: !o.pas }))} />
        {open.pas && pas.map(r => <Fila key={r.label} label={r.label} get={r.get} {...p} indent={40} />)}
        <Fila label="= Variación de caja explicada" get={explicado} {...p} indent={14} bold bg="#f3f4f6" />
        <FilaResultado label="Variación de caja del mes (saldos del Balance)" get={dCaja} {...p} strong />
        <Fila label={consolidado ? "Diferencia de conversión + sin explicar" : "Sin explicar"} get={sinExplicar} {...p} indent={14} bold
          color={consolidado ? T.muted : undefined} bg={consolidado ? "#f8fafc" : (Math.abs(sum(sinExplicar)) > 0.5 ? "#fef2f2" : "#f0fdf4")} />
        <Fila label="Saldo de caja al cierre del mes" get={m => cash(m)} {...p} indent={14} bold total="ultimo" bg="#f3f4f6" />
        {cfDirecto && (<>
          <Banda label="Control cruzado · dos fuentes distintas" get={() => 0} {...p} tono="claro" />
          <Fila label="Variación de caja según movimientos (Cash Flow directo)" get={m => directo(m) || 0} {...p} indent={28} />
          <Fila label="Diferencia saldos − movimientos (debe dar cero)" get={difDirecto} {...p} indent={28} bold color={okDirecto ? "#15803d" : "#dc2626"} />
        </>)}
      </TablaMensual>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 8, lineHeight: 1.5, maxWidth: 900 }}>
        <b>Activos</b>: si Clientes sube, vendiste y no cobraste (resta caja); si baja, cobraste ventas de meses anteriores (suma). Igual con franquiciados, adelantos y pagos a cuenta.
        <b> Pasivos</b>: si Proveedores, Sueldos, Impuestos o Financiaciones suben, el gasto ya está en el resultado pero la plata sigue en caja (suma); si bajan, pagaste deuda vieja (resta). Anticipos de clientes y socios son plata que entró sin ser resultado.
        {consolidado
          ? <> En USD cada saldo va al TC de su cierre, así que el resto incluye la <b>diferencia de conversión</b>. Para la conciliación exacta elegí una moneda.</>
          : <> <b>Sin explicar</b> es la misma fila del puente resultado ↔ PN: caja sin imputar, pagos sin comprobante o timing entre sociedades.</>}
      </div>
    </div>
  );
}
