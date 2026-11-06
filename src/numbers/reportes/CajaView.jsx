// Caja en pocas líneas (Martín 5/11/2026: "entro al cash flow y me cuesta entenderlo"). Mismo molde que Tesorería › Saldos:
// header negro con los meses como primera fila, layout fijo con una columna por mes, la ayuda como nota afuera de la
// tarjeta. Seis filas: Caja al inicio → La operación → Inversiones y fondeo → Financiación → Cambio de moneda →
// = Variación de caja → Caja al cierre (ata con Saldos). Cada bloque se abre por su naturaleza (los conceptos de
// cashflowDerive) y una celda de concepto abre los movimientos de ese mes debajo de la tabla.
// Lo que debería dar cero (extracto sin imputar, transferencias con una sola pata) va en una fila "Pendiente de
// conciliar" solo cuando no da cero, para que la caja al cierre siga atando.
import { useState, Fragment } from "react";
import { T, fmtDate } from "../theme";
import { MESES_CORTOS, fmtBal } from "./balanceUtils";
import { CF_CONCEPTO_ORDEN } from "./cashflowDerive";

const BLOQUES = [
  { key: "operativo",    label: "La operación",         nota: "cobros de clientes − sueldos − proveedores − impuestos" },
  { key: "inversion",    label: "Inversiones y fondeo", nota: "plata a negocios de otras sociedades e intercompañía" },
  { key: "financiacion", label: "Financiación",         nota: "préstamos, cuotas, anticipos de clientes y socios" },
  { key: "cambio",       label: "Cambio de moneda",     nota: null },
];

const COL_MES = 118, COL_TOT = 132;
const TABLA = { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" };
const trLine = { borderBottom: `1px solid ${T.cardBorder}` };
const tdLabel = { padding: "7px 18px", fontSize: 13, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const thMes = { padding: "9px 12px", textAlign: "right", fontSize: 11, fontWeight: 800, letterSpacing: ".10em", color: T.tableHeadText, whiteSpace: "nowrap" };

function Celda({ valor, fuerte = false, color, dim = false, onClick, title }) {
  const v = Number(valor) || 0;
  const col = color || (v < 0 ? T.red : Math.abs(v) < 0.5 ? T.dim : T.text);
  return (
    <td onClick={onClick} title={onClick ? title : undefined}
      style={{ padding: "7px 12px", textAlign: "right", fontFamily: "var(--mono)", fontSize: 12.5, whiteSpace: "nowrap",
        fontWeight: fuerte ? 800 : 600, color: col, opacity: dim ? .55 : 1, cursor: onClick ? "pointer" : "default" }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.textDecoration = "underline"; }}
      onMouseLeave={e => { e.currentTarget.style.textDecoration = "none"; }}>
      {fmtBal(v)}
    </td>
  );
}

// `get(m)` por mes; el total suma SOLO meses cerrados (el mes en curso se ve en gris y no entra).
function Fila({ label, get, meses, cerrados, mesEnCurso, style = {}, labelStyle = {}, fuerte = false, color, total = "suma", onCelda, sangria = 0, flecha = null, onToggle }) {
  const tot = total === "suma" ? cerrados.reduce((s, m) => s + get(m), 0)
    : total === "primero" ? (meses.length ? get(meses[0]) : 0)
    : total === "ultimo" ? (cerrados.length ? get(cerrados[cerrados.length - 1]) : 0) : null;
  return (
    <tr style={{ ...trLine, ...style }}>
      <td style={{ ...tdLabel, paddingLeft: 18 + sangria, fontWeight: fuerte ? 800 : 500, ...labelStyle, cursor: onToggle ? "pointer" : "default", userSelect: onToggle ? "none" : "auto" }}
        onClick={onToggle}>
        {flecha != null && <span style={{ display: "inline-block", width: 14, fontSize: 9, color: T.dim, transform: flecha ? "rotate(90deg)" : "none", transition: "transform .12s" }}>▶</span>}
        {label}
      </td>
      {meses.map(m => <Celda key={m} valor={get(m)} fuerte={fuerte} color={color} dim={m === mesEnCurso}
        onClick={onCelda ? () => onCelda(m) : undefined} title={onCelda ? `${label} · ${MESES_CORTOS[m]}: ver movimientos` : undefined} />)}
      <Celda valor={tot ?? 0} fuerte color={tot == null ? "transparent" : color} />
    </tr>
  );
}

export function CajaView({ cf, consolidado, mon, cuentasBancarias = [], docs = [], avisosTC = null }) {
  const [abiertos, setAbiertos] = useState({});
  const [drill, setDrill] = useState(null);   // { concepto, mes }
  if (!cf) return null;
  const meses = cf.activeMonths, mesEnCurso = cf.mesEnCurso;
  const cerrados = meses.filter(m => m !== mesEnCurso);
  const p = { meses, cerrados, mesEnCurso };
  const tot = k => cf.actTot[k] || new Array(12).fill(0);
  const conceptosDe = k => {
    const ord = CF_CONCEPTO_ORDEN[k] || []; const rank = n => { const i = ord.indexOf(n); return i === -1 ? 99 : i; };
    return Object.entries(cf.porAct[k] || {}).filter(([, v]) => v.some(x => Math.abs(x) > 0.5)).sort((a, b) => rank(a[0]) - rank(b[0]));
  };
  const control = tot("control");
  const hayControl = control.some(x => Math.abs(x) > 0.5);
  const toggle = k => setAbiertos(o => ({ ...o, [k]: !o[k] }));
  const nombreCuenta = (() => { const mp = new Map(cuentasBancarias.map(c => [String(c.id), c])); return id => mp.get(String(id))?.nombre || id; })();
  const titulo = consolidado ? "Caja · USD consolidado" : `Caja · ${mon}`;

  // Movimientos de un concepto en un mes (nativos, con su moneda), AGRUPADOS por comprobante: una factura cobrada en
  // 42 transferencias es UNA fila con el nombre del cliente, no 42 líneas con el texto del extracto del banco.
  const docMap = (() => { const mp = new Map(); for (const d of docs) { const id = String(d.id ?? ""); if (id && !mp.has(id)) mp.set(id, d); } return mp; })();
  const movsDrill = (() => {
    if (!drill) return [];
    const grupos = new Map();
    for (const m of (cf.detalle[drill.concepto] || [])) {
      if (parseInt(m.fecha.slice(5, 7), 10) - 1 !== drill.mes) continue;
      const docId = String(m.documento_id || "").replace(/-L\d+$/i, "");
      const doc = docId ? docMap.get(docId) : null;
      const key = docId ? `doc:${docId}:${m.moneda || ""}` : `mov:${m.id}`;
      let g = grupos.get(key);
      if (!g) {
        g = { key, n: 0, monto: 0, moneda: m.moneda || "", desde: m.fecha, hasta: m.fecha, cuentas: new Set(),
          nombre: doc ? (doc.cliente || doc.proveedor || m.contraparte || docId) : (m.contraparte || m.concepto || m.descripcion || "—"),
          detalle: doc ? `comprobante ${doc.nroComp ? doc.nroComp + " " : ""}del ${fmtDate(doc.fecha)}` : (docId ? `comprobante ${docId}` : "") };
        grupos.set(key, g);
      }
      g.n += 1; g.monto += Number(m.monto) || 0; g.cuentas.add(nombreCuenta(m.cuenta_bancaria));
      if (m.fecha < g.desde) g.desde = m.fecha; if (m.fecha > g.hasta) g.hasta = m.fecha;
    }
    return [...grupos.values()].sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto));
  })();

  return (
    <div className="fade">
      {avisosTC}
      <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflowX: "auto", marginBottom: 16 }}>
        <table style={{ ...TABLA, minWidth: 320 + meses.length * COL_MES + COL_TOT }}>
          <colgroup><col />{meses.map(m => <col key={m} style={{ width: COL_MES }} />)}<col style={{ width: COL_TOT }} /></colgroup>
          <thead>
            <tr style={{ background: T.tableHead }}>
              <th style={{ padding: "9px 18px", textAlign: "left", fontSize: 11, fontWeight: 800, color: T.tableHeadText, letterSpacing: ".10em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{titulo}</th>
              {meses.map(m => <th key={m} style={{ ...thMes, opacity: m === mesEnCurso ? .55 : 1 }}>{MESES_CORTOS[m].toUpperCase()}{m === mesEnCurso ? " · EN CURSO" : ""}</th>)}
              <th style={{ ...thMes, borderLeft: "1px solid rgba(255,255,255,.15)" }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            <Fila label="Caja al inicio" get={m => cf.saldoInicioMes[m]} {...p} total="primero" labelStyle={{ color: T.muted }} color={T.muted} />
            {BLOQUES.map(b => {
              const conceptos = conceptosDe(b.key);
              const abierto = !!abiertos[b.key] && conceptos.length > 0;
              return (
                <Fragment key={b.key}>
                  <Fila label={b.label} get={m => tot(b.key)[m]} {...p} fuerte flecha={conceptos.length ? abierto : null}
                    onToggle={conceptos.length ? () => toggle(b.key) : undefined} />
                  {abierto && conceptos.map(([nombre, vals]) => (
                    <Fila key={nombre} label={nombre} get={m => vals[m]} {...p} sangria={32} labelStyle={{ color: T.muted, fontSize: 12.5 }}
                      style={{ background: "#fafbfc" }} onCelda={m => setDrill(d => d && d.concepto === nombre && d.mes === m ? null : { concepto: nombre, mes: m })} />
                  ))}
                </Fragment>
              );
            })}
            {hayControl && (
              <Fila label="Pendiente de conciliar *" get={m => control[m]} {...p} labelStyle={{ color: T.orange }} color={T.orange} />
            )}
          </tbody>
          <tfoot>
            <Fila label="Variación de caja" get={m => cf.flujoNeto[m]} {...p} fuerte
              style={{ background: "#f3f4f6", borderTop: `2px solid ${T.cardBorder}` }} />
            <Fila label="Caja al cierre" get={m => cf.saldoFinal[m]} {...p} fuerte total="ultimo" style={{ background: "#f3f4f6" }} />
          </tfoot>
        </table>
      </div>
      <div style={{ padding: "0 18px", margin: "-8px 0 16px", fontSize: 10.5, color: T.dim, lineHeight: 1.6, maxWidth: 980 }}>
        {consolidado
          ? <>Caja de todas las monedas de las sociedades tildadas, cada movimiento al tipo de cambio de su mes. </>
          : <>Caja en {mon} de las sociedades tildadas: bancos, cajas y Mercado Pago de esa moneda, sin tarjetas. </>}
        {BLOQUES.filter(b => b.nota).map(b => <Fragment key={b.key}><b>{b.label}</b> = {b.nota} · </Fragment>)}
        <b>Cambio de moneda</b> = {consolidado ? "neto de las dos patas al TC del mes" : `lo que entró o salió de ${mon} por compra-venta de moneda`}.
        Los totales son de meses cerrados; el mes en curso va en gris. La caja al cierre ata con Tesorería › Saldos.
        {hayControl && <> <b>* Pendiente de conciliar</b>: líneas del extracto sin imputar o transferencias entre cuentas propias con una sola pata. Debería dar cero: se arregla en Conciliación.</>}
      </div>

      {drill && (
        <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 18px", background: "#f3f4f6", borderBottom: `1px solid ${T.cardBorder}` }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: T.text }}>{drill.concepto} · {MESES_CORTOS[drill.mes]} <span style={{ color: T.dim, fontWeight: 500 }}>· {movsDrill.length} {movsDrill.length === 1 ? "línea" : "líneas"} · {movsDrill.reduce((s, g) => s + g.n, 0)} movimientos</span></span>
            <button type="button" onClick={() => setDrill(null)} style={{ background: "transparent", border: "none", color: T.muted, fontSize: 16, cursor: "pointer", lineHeight: 1 }}>✕</button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {movsDrill.slice(0, 60).map(g => (
                <tr key={g.key} style={trLine}>
                  <td style={{ ...tdLabel, width: 110, color: T.muted, fontFamily: "var(--mono)", fontSize: 12 }}>{g.desde === g.hasta ? fmtDate(g.desde) : `${fmtDate(g.desde).slice(0, 5)} – ${fmtDate(g.hasta)}`}</td>
                  <td style={{ ...tdLabel, maxWidth: 520 }}>
                    {g.nombre}
                    {(g.detalle || g.n > 1) && <span style={{ color: T.dim, fontSize: 11.5, marginLeft: 8 }}>{g.detalle}{g.n > 1 ? `${g.detalle ? " · " : ""}${g.n} ${g.monto >= 0 ? "cobros" : "pagos"}` : ""}</span>}
                  </td>
                  <td style={{ ...tdLabel, color: T.muted, fontSize: 12 }}>{[...g.cuentas].join(", ")}</td>
                  <Celda valor={g.monto} />
                  <td style={{ padding: "7px 18px 7px 0", fontSize: 11, color: T.dim, width: 40 }}>{g.moneda}</td>
                </tr>
              ))}
              {movsDrill.length > 60 && <tr><td colSpan={5} style={{ ...tdLabel, color: T.dim, fontSize: 12 }}>… y {movsDrill.length - 60} más</td></tr>}
              {movsDrill.length === 0 && <tr><td colSpan={5} style={{ ...tdLabel, color: T.dim, fontSize: 12 }}>Sin movimientos</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
