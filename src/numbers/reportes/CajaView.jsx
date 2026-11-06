// Caja en pocas líneas (Martín 5/11/2026: "entro al cash flow y me cuesta entenderlo"). Mismo molde que Tesorería › Saldos:
// header negro con los meses como primera fila, layout fijo con una columna por mes, sin notas ni chips ("la tabla sola").
// Seis filas: Caja al inicio → La operación → Inversiones y fondeo → Financiación → Cambio de moneda → = Variación de caja
// → Caja al cierre (ata con Saldos). Cada bloque se abre por su naturaleza (los conceptos de cashflowDerive) y una celda
// de concepto abre los movimientos de ese mes debajo de la tabla. Lo que debería dar cero (extracto sin imputar,
// transferencias con una sola pata) va en una fila "Pendiente de conciliar" solo cuando no da cero, para que la caja al
// cierre siga atando.
import { useState, Fragment } from "react";
import { T, fmtDate } from "../theme";
import { MESES_CORTOS, AvisosTC } from "./balanceUtils";
import { CF_CONCEPTO_ORDEN } from "./cashflowDerive";
import { Celda, Fila, TablaMeses } from "./TablaMeses";
import { trLine, tdLabel } from "./tablaMesesEstilos";

const BLOQUES = [
  { key: "operativo",    label: "La operación" },
  { key: "inversion",    label: "Inversiones y fondeo" },
  { key: "financiacion", label: "Financiación" },
  { key: "cambio",       label: "Cambio de moneda" },
];

const cmpDesc = (a, b) => (a < b) - (a > b);   // ISO yyyy-mm-dd: comparación de strings, la más nueva primero

// Líneas del panel de detalle: los movimientos del concepto en ese mes, con QUIÉN está del otro lado.
//  · con comprobante de Numbers (`docs`): nombre del cliente/proveedor, número y fecha; los pagos/cobros de un mismo
//    comprobante se agrupan (Gympass paga su factura en 42 transferencias el mismo día → UNA línea);
//  · préstamos y planes (`financiaciones`, una fila por plan): el alta apunta al plan "FIN-xxxx" y cada cuota a
//    "FIN-<plan>#<n>" (en documento_id u origen_id) → acreedor y cuota;
//  · franquicias: el comprobante vive en el módulo de Franquicias; el movimiento trae el id de la franquicia en
//    contraparte_id → el nombre de la sede (no la razón social: acá lee Martín, no el estudio);
//  · lo demás, una línea por movimiento con lo que diga el movimiento (contraparte o texto del extracto).
function lineasDetalle(movs, { docs, franquicias, financiaciones, cuentasBancarias }) {
  const docMap = new Map(docs.map(d => [String(d.id ?? ""), d]));
  const planMap = new Map(financiaciones.map(f => [String(f.plan_id), f]));
  const frMap = new Map(franquicias.map(f => [String(f.id), f]));
  const ctaMap = new Map(cuentasBancarias.map(c => [String(c.id), c]));
  const finDe = ref => {
    if (!ref.startsWith("FIN-")) return null;
    const [plan, cuota] = ref.replace(/^FIN-FIN-/, "FIN-").split("#");
    const f = planMap.get(plan); if (!f) return null;
    const que = f.tipo === "plan_afip" ? `plan de pago${f.nro_plan ? " " + f.nro_plan : ""}` : "préstamo";
    return { nombre: f.acreedor_nombre || plan, detalle: cuota ? `${que} · cuota ${cuota}` : `alta ${que}` };
  };
  const frDe = m => {
    if (String(m.origen) !== "franquicias" || !m.contraparte_id) return null;
    const f = frMap.get(String(m.contraparte_id));
    return { nombre: f?.name || f?.razonSocial || `Franquicia ${m.contraparte_id}`, detalle: "franquicia" };
  };
  const grupos = new Map();
  for (const m of movs) {
    const docId = String(m.documento_id || "").replace(/-L\d+$/i, "");
    const doc = docId ? docMap.get(docId) : null;
    const key = docId ? `doc:${docId}:${m.moneda || ""}` : `mov:${m.id}`;
    let g = grupos.get(key);
    if (!g) {
      const quien = doc
        ? { nombre: doc.cliente || doc.proveedor || m.contraparte_nombre || docId, detalle: `comprobante ${doc.nroComp ? doc.nroComp + " " : ""}del ${fmtDate(doc.fecha)}` }
        : finDe(String(m.origen_id || docId)) || frDe(m)
        || { nombre: m.contraparte_nombre || m.concepto || m.descripcion || "—", detalle: docId ? `comprobante ${docId}` : "" };
      g = { key, n: 0, monto: 0, moneda: m.moneda || "", desde: m.fecha, hasta: m.fecha, cuentas: new Set(), ...quien };
      grupos.set(key, g);
    }
    g.n += 1; g.monto += Number(m.monto) || 0; g.cuentas.add(ctaMap.get(String(m.cuenta_bancaria))?.nombre || m.cuenta_bancaria);
    if (m.fecha < g.desde) g.desde = m.fecha; if (m.fecha > g.hasta) g.hasta = m.fecha;
  }
  // Por fecha, la más nueva arriba (Martín 5/11); a igual fecha, por importe.
  return [...grupos.values()].sort((a, b) => cmpDesc(a.desde, b.desde) || Math.abs(b.monto) - Math.abs(a.monto));
}

export function CajaView({ cf, consolidado, mon, cuentasBancarias = [], docs = [], franquicias = [], financiaciones = [] }) {
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
  const titulo = consolidado ? "Caja · USD consolidado" : `Caja · ${mon}`;
  const movsDrill = drill ? lineasDetalle(cf.detalle[drill.concepto]?.[drill.mes] ?? [], { docs, franquicias, financiaciones, cuentasBancarias }) : [];

  return (
    <div className="fade">
      <AvisosTC tcSuplente={cf.tcSuplente} faltaTC={cf.faltaTC} />
      <TablaMeses titulo={titulo} meses={meses} mesEnCurso={mesEnCurso}>
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
              <Fila label="Pendiente de conciliar" get={m => control[m]} {...p} labelStyle={{ color: T.orange }} color={T.orange} />
            )}
        </tbody>
        <tfoot>
            <Fila label="Variación de caja" get={m => cf.flujoNeto[m]} {...p} fuerte
              style={{ background: "#f3f4f6", borderTop: `2px solid ${T.cardBorder}` }} />
            <Fila label="Caja al cierre" get={m => cf.saldoFinal[m]} {...p} fuerte total="ultimo" style={{ background: "#f3f4f6" }} />
        </tfoot>
      </TablaMeses>

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
