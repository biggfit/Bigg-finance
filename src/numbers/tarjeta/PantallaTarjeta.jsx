import { useState, useEffect, useMemo, Fragment } from "react";
import { T, PageHeader } from "../theme";
import {
  fetchCuentasBancarias, fetchCuentas, fetchCentrosCosto, fetchMovTesoreria, esCuentaCredito,
} from "../../lib/numbersApi";
import { tarjetaLedger } from "../tesoreriaDerive";
import BandejaTarjeta from "./BandejaTarjeta";
import { baseTarjeta, agruparResumenes, nombrePeriodo } from "./tarjetaDerive";

// Formato es-AR: sin decimales si es entero, si no dos; signo visible (un ajuste-crédito resta).
const money = (n, mon) => {
  const v = Number(n) || 0;
  if (!v) return "—";
  const dec = Math.abs(v) % 1 ? 2 : 0;
  return `${v < 0 ? "-" : ""}${mon === "USD" ? "U$D" : "$"} ${Math.abs(v).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: 2 })}`;
};
const fmtF = f => { const s = String(f || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split("-").reverse().join("/") : (s || "—"); };
const fmtDM = f => { const s = String(f || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : ""; };

const cell = { background: "#fff", border: `1px solid ${T.cardBorder}`, borderRadius: 6, padding: "6px 8px", fontSize: 12.5, color: T.text, fontFamily: T.font, outline: "none" };
const thS  = (right) => ({ padding: "9px 12px", textAlign: right ? "right" : "left", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" });
const badge = (bg, color, text, title) => (
  <span title={title} style={{ fontSize: 10, fontWeight: 800, background: bg, color, borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap", letterSpacing: ".02em" }}>{text}</span>
);
// overflow auto: las columnas no se parten (nowrap) → cuando la pantalla es angosta la tabla se desplaza a lo ancho.
const cardBox = { background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflow: "auto", marginBottom: 16 };

// Egresos › Tarjeta de crédito. La tarjeta es una cuenta `tipo:"tarjeta"`; sus consumos viven en nb_movimientos.
// Tres vistas: RESÚMENES por período (consumos autorizados + pendientes, con totales por moneda), PENDIENTES (la
// bandeja con la carga del PDF, misma lógica de siempre, movida desde Conciliaciones › Tarjeta) y EXTRACTO (la
// cuenta-tarjeta con saldo corriente: consumos suben la deuda, pagos la bajan — el mismo ledger que Tesorería).
export default function PantallaTarjeta({ sociedad, subView = null, navPulse = 0 }) {
  const [cuentasBanc, setCuentasBanc] = useState([]);
  const [cuentas, setCuentas]   = useState([]);
  const [centros, setCentros]   = useState([]);
  const [data, setData]         = useState({ key: "", rows: [] });   // movimientos + clave de la carga que los trajo
  const [fam, setFam]           = useState("");      // familia de tarjeta elegida (nombre base, sin moneda); "" = la primera
  const [abierto, setAbierto]   = useState("");      // período desplegado en Resúmenes
  const [tab, setTab]           = useState(subView === "new-tarjeta" ? "pendientes" : "resumenes");
  const [cuentaExt, setCuentaExt] = useState("");    // cuenta-tarjeta del extracto (ARS / USD); "" = la primera
  const [reload, setReload]     = useState(0);

  useEffect(() => {
    fetchCuentasBancarias().then(c => setCuentasBanc(Array.isArray(c) ? c : [])).catch(() => {});
    fetchCuentas().then(c => setCuentas(Array.isArray(c) ? c : [])).catch(() => {});
    fetchCentrosCosto().then(c => setCentros(Array.isArray(c) ? c : [])).catch(() => {});
  }, []);

  // Movimientos de la sociedad (con `referencia` intacta: de ahí sale el período). Se recargan al autorizar o
  // subir un PDF en la bandeja (onChanged → reload) y al volver a entrar desde el menú (navPulse). "Cargando" se
  // deriva comparando la clave pedida con la de los datos que hay, sin setState sincrónico en el efecto.
  const key = `${sociedad}|${reload}|${navPulse}`;
  useEffect(() => {
    let vivo = true;
    fetchMovTesoreria(sociedad)
      .then(ms => { if (vivo) setData({ key, rows: Array.isArray(ms) ? ms : [] }); })
      .catch(() => { if (vivo) setData({ key, rows: [] }); });
    return () => { vivo = false; };
  }, [key, sociedad]);
  const loading = data.key !== key;
  const movs    = data.rows;

  const tarjetas = useMemo(() => cuentasBanc.filter(c =>
    esCuentaCredito(c) && (c.sociedad ?? "").toLowerCase() === (sociedad ?? "").toLowerCase()), [cuentasBanc, sociedad]);
  const familias = useMemo(() => {
    const seen = new Map();
    for (const c of tarjetas) { const b = baseTarjeta(c.nombre) || c.nombre; if (!seen.has(b)) seen.set(b, { nombre: b, cuentas: [] }); seen.get(b).cuentas.push(c); }
    return [...seen.values()];
  }, [tarjetas]);
  const famSel = familias.find(f => f.nombre === fam) || familias[0] || null;

  const cardIds   = useMemo(() => new Set((famSel?.cuentas || []).map(c => String(c.id))), [famSel]);
  const resumenes = useMemo(() => agruparResumenes(movs, cardIds), [movs, cardIds]);
  const totPend   = resumenes.reduce((s, r) => s + r.pendientes, 0);

  // Extracto: una cuenta por moneda dentro de la familia (la ARS primero).
  const cuentasExt = useMemo(() => [...(famSel?.cuentas || [])].sort((a, b) => (a.moneda === "ARS" ? -1 : 1) - (b.moneda === "ARS" ? -1 : 1)), [famSel]);
  const ctaExt     = cuentasExt.find(c => c.id === cuentaExt) || cuentasExt[0] || null;
  const ledger     = useMemo(() => {
    if (!ctaExt) return { opening: 0, entries: [], final: 0 };
    return tarjetaLedger(movs.filter(m => String(m.cuenta_bancaria) === String(ctaExt.id)));
  }, [movs, ctaExt]);

  // Cuenta/centro guardados como id o como nombre según la época → siempre mostrar el nombre.
  const cuentaNom = v => (v ? (cuentas.find(c => c.id === v || c.nombre === v)?.nombre || v) : "—");
  const centroNom = v => (v ? (centros.find(c => c.id === v || c.nombre === v)?.nombre || v) : "—");

  // Cuenta-tarjeta "principal" de la familia para la bandeja (la ARS si existe).
  const cardPrincipal = cuentasExt[0] || null;

  const TABS = [
    { id: "resumenes",  label: "Resúmenes" },
    { id: "pendientes", label: `Pendientes${totPend ? ` (${totPend})` : ""}` },
    { id: "extracto",   label: "Extracto" },
  ];
  const tablist = (
    <div role="tablist" aria-label="Vista de tarjeta" style={{ display: "inline-flex", gap: 2, background: "#f3f4f6", borderRadius: 10, padding: 3, marginBottom: 16 }}>
      {TABS.map(t => {
        const active = tab === t.id;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.id)}
            style={{ background: active ? T.accentDark : "transparent", border: "none", borderRadius: 8, color: active ? T.accent : T.muted,
              fontFamily: T.font, fontSize: 13, fontWeight: active ? 800 : 500, padding: "7px 18px", cursor: "pointer", transition: "all .15s ease", outline: "none",
              boxShadow: active ? T.shadow : "none" }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#e5e7eb"; }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
            {t.label}
          </button>
        );
      })}
    </div>
  );

  const selector = familias.length > 1 ? (
    <select value={famSel?.nombre || ""} onChange={e => { setFam(e.target.value); setAbierto(""); setCuentaExt(""); }} style={{ ...cell, minWidth: 200 }}>
      {familias.map(f => <option key={f.nombre} value={f.nombre}>{f.nombre}</option>)}
    </select>
  ) : null;

  // ── Vista Resúmenes ──────────────────────────────────────────────────────────
  const vistaResumenes = (
    <div style={cardBox}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, color: T.text }}>
        <thead>
          <tr style={{ background: T.tableHead, color: T.tableHeadText }}>
            <th style={thS()}>Período</th>
            <th style={thS()}>Ciclo</th>
            <th style={thS(true)}>Consumos</th>
            <th style={thS(true)}>ARS</th>
            <th style={thS(true)}>USD</th>
            <th style={thS(true)}>Sin autorizar</th>
            <th style={{ ...thS(), width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {loading && resumenes.length === 0 && (
            <tr><td colSpan={7} style={{ padding: 18, color: T.muted, fontSize: 13, textAlign: "center" }}>Cargando…</td></tr>
          )}
          {!loading && resumenes.length === 0 && (
            <tr><td colSpan={7} style={{ padding: 18, color: T.muted, fontSize: 13, textAlign: "center" }}>
              {tarjetas.length ? "Todavía no hay consumos de esta tarjeta. Subí el primer resumen en Pendientes." : "Esta sociedad no tiene cuentas de tipo tarjeta. Crealas en Maestros › Cuentas bancarias."}
            </td></tr>
          )}
          {resumenes.map((r, i) => {
            const idPer = r.periodo || "sin";   // el grupo "Sin resumen" tiene período vacío; "" = ninguno abierto
            const open = abierto === idPer;
            return (
              <Fragment key={idPer}>
                <tr onClick={() => setAbierto(open ? "" : idPer)}
                  style={{ borderTop: i ? `1px solid ${T.cardBorder}` : "none", cursor: "pointer", background: open ? "#f3f6e8" : (i % 2 ? "#fafbfc" : T.card) }}>
                  <td style={{ padding: "10px 12px", fontWeight: 700, whiteSpace: "nowrap" }}>
                    {r.periodo ? nombrePeriodo(r.periodo) : "Sin resumen"}
                    {r.periodo && <span style={{ fontSize: 11, color: T.dim, fontFamily: T.mono, marginLeft: 8 }}>{r.periodo}</span>}
                    {r.periodo && r.porFecha > 0 && <span style={{ marginLeft: 8 }}>{badge("#eef2ff", "#4338ca", `${r.porFecha} por fecha`, "Movimientos sin período de resumen (facturas pagadas con la tarjeta, consumos previos al tag): se cuelgan del ciclo cuyas fechas los contienen.")}</span>}
                    {!r.periodo && <span style={{ marginLeft: 8 }}>{badge("#eef2ff", "#4338ca", "fuera de todo ciclo", "Movimientos sin período de resumen cuya fecha no cae dentro de ningún ciclo cargado.")}</span>}
                  </td>
                  <td style={{ padding: "10px 12px", color: T.muted, fontFamily: T.mono, fontSize: 12, whiteSpace: "nowrap" }}
                    title="Fechas del primer y último consumo del período (el período es el mes de cierre que trae el PDF)">
                    {r.desde ? `${fmtDM(r.desde)} → ${fmtDM(r.hasta)}` : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: T.mono }}>{r.n}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: T.mono, fontWeight: 700 }}>{money(r.ars, "ARS")}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: T.mono, fontWeight: 700 }}>{money(r.usd, "USD")}</td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    {r.pendientes > 0 ? badge("#fff7ed", "#c2410c", `${r.pendientes} sin autorizar`) : <span style={{ color: T.dim }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 12px", color: T.muted, textAlign: "center" }}>{open ? "▾" : "▸"}</td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={7} style={{ padding: "0 0 12px", background: "#fafbfc" }}>
                      <div style={{ margin: "0 12px", border: `1px solid ${T.cardBorder}`, borderRadius: 8, overflow: "auto", background: "#fff" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: "#eef0f3", color: T.muted }}>
                              {["Fecha", "Comercio", "Titular", "Cuenta", "Centro", "ARS", "USD", ""].map((c, k) => (
                                <th key={k} style={thS(k === 5 || k === 6)}>{c}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {r.filas.map(f => {
                              const esUSD = (f.moneda || "ARS") === "USD";
                              return (
                                <tr key={f.id} style={{ borderTop: `1px solid ${T.cardBorder}`, color: f.pendiente ? T.muted : T.text, fontStyle: f.esAjuste ? "italic" : "normal" }}>
                                  <td style={{ padding: "6px 12px", whiteSpace: "nowrap", fontFamily: T.mono, color: T.muted }}>{fmtF(f.fecha)}</td>
                                  <td style={{ padding: "6px 12px", minWidth: 180 }}>{f.comercio || "—"}</td>
                                  <td style={{ padding: "6px 12px", whiteSpace: "nowrap", color: T.muted }}>{f.titular || "—"}</td>
                                  <td style={{ padding: "6px 12px" }}>{cuentaNom(f.cuenta_contable)}</td>
                                  <td style={{ padding: "6px 12px" }}>{centroNom(f.centro_costo)}</td>
                                  <td style={{ padding: "6px 12px", textAlign: "right", fontFamily: T.mono }}>{esUSD ? "—" : money(f.cargo, "ARS")}</td>
                                  <td style={{ padding: "6px 12px", textAlign: "right", fontFamily: T.mono }}>{esUSD ? money(f.cargo, "USD") : "—"}</td>
                                  <td style={{ padding: "6px 12px", whiteSpace: "nowrap", textAlign: "right" }}>
                                    {f.pendiente && badge("#fff7ed", "#c2410c", "sin autorizar")}
                                    {f.esPagoFC && badge("#ecfdf5", "#047857", "factura pagada con tarjeta", "Pago de una factura hecho con la tarjeta: el gasto vive en la factura.")}
                                    {f.esAjuste && badge("#fefce8", "#a16207", "ajuste")}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop: `2px solid ${T.cardBorder}`, background: "#fafafa", fontWeight: 800 }}>
                              <td colSpan={5} style={{ padding: "8px 12px" }}>Total {r.periodo ? nombrePeriodo(r.periodo) : "sin resumen"}</td>
                              <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: T.mono }}>{money(r.ars, "ARS")}</td>
                              <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: T.mono }}>{money(r.usd, "USD")}</td>
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  // ── Vista Pendientes (bandeja + carga del PDF) ───────────────────────────────
  const vistaPendientes = tarjetas.length > 0 ? (
    <div style={{ ...cardBox, overflow: "visible", padding: "16px 18px" }}>
      {abierto && abierto !== "sin" && (
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 10 }}>
          Mostrando solo {nombrePeriodo(abierto)} (el período abierto en Resúmenes) ·{" "}
          <button onClick={() => setAbierto("")} style={{ background: "transparent", border: "none", color: T.accentDark, fontSize: 12, cursor: "pointer", fontFamily: T.font, textDecoration: "underline", padding: 0 }}>ver todos</button>
        </div>
      )}
      <BandejaTarjeta sociedad={sociedad} tarjetaId={cardPrincipal?.id || ""} periodo={abierto === "sin" ? "" : abierto} onChanged={() => setReload(r => r + 1)} />
    </div>
  ) : (
    <div style={{ ...cardBox, padding: 18, color: T.muted, fontSize: 13 }}>Esta sociedad no tiene cuentas de tipo tarjeta. Crealas en Maestros › Cuentas bancarias.</div>
  );

  // ── Vista Extracto (saldo corriente de la cuenta-tarjeta) ───────────────────
  const mon = ctaExt?.moneda || "ARS";
  const filasExt = [...ledger.entries].reverse();   // más reciente arriba
  const vistaExtracto = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        {cuentasExt.length > 1 && cuentasExt.map(c => {
          const active = ctaExt?.id === c.id;
          return (
            <button key={c.id} type="button" onClick={() => setCuentaExt(c.id)}
              style={{ background: active ? T.accentDark : "#f3f4f6", color: active ? T.accent : T.muted, border: `1px solid ${active ? T.accentDark : T.cardBorder}`,
                borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
              {c.moneda}
            </button>
          );
        })}
        <span style={{ fontSize: 12, color: T.muted }}>{ctaExt?.nombre || ""}</span>
        <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span style={{ fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700 }}>
            {ledger.final > 0.005 ? "Deuda hoy" : ledger.final < -0.005 ? "Saldo a favor" : "Saldo"}
          </span>
          <span style={{ fontSize: 20, fontFamily: T.mono, fontWeight: 900, color: ledger.final > 0.005 ? T.red : ledger.final < -0.005 ? T.green : T.dim }}>
            {Math.abs(ledger.final) > 0.005 ? money(Math.abs(ledger.final), mon) : `${mon === "USD" ? "U$D" : "$"} 0`}
          </span>
        </div>
      </div>
      <div style={cardBox}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, color: T.text }}>
          <thead>
            <tr style={{ background: T.tableHead, color: T.tableHeadText }}>
              <th style={thS()}>Fecha</th>
              <th style={thS()}>Concepto</th>
              <th style={thS(true)}>Consumo</th>
              <th style={thS(true)}>Pago</th>
              <th style={thS(true)}>Deuda</th>
            </tr>
          </thead>
          <tbody>
            {loading && filasExt.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 18, color: T.muted, fontSize: 13, textAlign: "center" }}>Cargando…</td></tr>
            )}
            {!loading && filasExt.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 18, color: T.muted, fontSize: 13, textAlign: "center" }}>Sin movimientos en esta cuenta.</td></tr>
            )}
            {filasExt.map((e, i) => (
              <tr key={i} style={{ borderTop: i ? `1px solid ${T.cardBorder}` : "none", background: i % 2 ? "#fafbfc" : T.card, color: e.pend ? T.muted : T.text }}>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap", fontFamily: T.mono, color: T.muted, verticalAlign: "top" }}>{fmtF(e.fecha)}</td>
                <td style={{ padding: "8px 12px" }}>
                  <div>{e.concepto}</div>
                  {e.sub && <div style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>{e.sub}</div>}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: T.mono, whiteSpace: "nowrap" }}>{e.delta > 0 ? money(e.delta, mon) : <span style={{ color: T.dim }}>—</span>}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: T.mono, whiteSpace: "nowrap", color: T.green, fontWeight: 700 }}>{e.delta < 0 ? money(-e.delta, mon) : <span style={{ color: T.dim }}>—</span>}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: T.mono, whiteSpace: "nowrap", fontWeight: 800, color: e.saldo > 0.005 ? T.red : e.saldo < -0.005 ? T.green : T.dim }}>
                  {Math.abs(e.saldo) > 0.005 ? money(e.saldo, mon) : `${mon === "USD" ? "U$D" : "$"} 0`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <div style={{ padding: "28px 32px" }} className="fade">
      <PageHeader title="Tarjeta de crédito" action={selector} />
      {tablist}
      {tab === "resumenes" ? vistaResumenes : tab === "pendientes" ? vistaPendientes : vistaExtracto}
    </div>
  );
}
