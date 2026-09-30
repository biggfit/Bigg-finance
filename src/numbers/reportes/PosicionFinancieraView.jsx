// Reportes › Posición financiera — EL número del board (Martín 24/9/2026): cuánta plata hay disponible, qué queda si
// cobro y pago todo lo corriente, y cuánta deuda refinanciable hay detrás. Orden Martín: primero lo CORRIENTE.
//   Disponible → + CxC − CxP operativa (incl. tarjetas) − Inversores y financieros ± CC grupo
//   = POSICIÓN CORRIENTE → − No corriente neto (créditos, planes, socios, anticipos de clientes − préstamos a socios − interco)
//   = POSICIÓN NETA TOTAL (≡ Patrimonio Neto del Balance; control cruzado abajo).
// Columnas cierre anterior · corte · variación, como el Balance. Una moneda nativa o "Todas" = consolidado USD al TC del
// mes de cada fecha. Default de fecha = último cierre de mes: la foto a HOY es provisoria (las ventas de Mercado Pago del
// mes se asientan al cierre, así MP queda negativo hasta entonces). Debajo, la misma cascada por sociedad (Núcleo /
// Fondeadas) para responder "fondeo ≠ resultado". Compromisos 30/60/90 (cuotas de planes + sueldos): v2.
import { Fragment, useMemo, useState } from "react";
import { T, fmtDate } from "../theme";
import { esCuentaMercadoPago } from "../../lib/numbersApi";
import { sumSaldo, fmtBal, crearTraductor, crearSumador, AvisosTC, ordenarDetalle, KpiTile,
  hoyISO, finMesAnterior, esFinDeMes } from "./balanceUtils";
import { armarPosicion, cuentasNegativas } from "./posicionDerive";

const nz = v => Math.abs(v) > 0.5;
const MONEDAS_ORDEN = ["ARS", "USD", "EUR", "COP"];
const fmtNativo = (v, mo) => `${mo} ${fmtBal(v)}`;

export function PosicionFinancieraView({ deriveAsOf, filtroMoneda, fechaCorte, tiposCambio = null, socsIncluidas = [], sociedades = [], esTodas = true }) {
  const hoy = hoyISO();
  const corte = fechaCorte || hoy;
  const esHoy = corte >= hoy;
  const prev = finMesAnterior(corte);
  const consolidado = !filtroMoneda || filtroMoneda === "ALL";
  const mon = consolidado ? "USD" : filtroMoneda;
  const [verNativos, setVerNativos] = useState(false);
  const [open, setOpen] = useState({ cxc: false, cxp: false, finc: true, nocorr: true });
  const toggle = k => setOpen(o => ({ ...o, [k]: !o[k] }));

  const balCorte = useMemo(() => deriveAsOf(corte), [deriveAsOf, corte]);
  const balPrev  = useMemo(() => deriveAsOf(prev),  [deriveAsOf, prev]);

  const { aUSD, tcPara, faltaTC, tcSuplente } = crearTraductor(tiposCambio);
  const suma = crearSumador({ consolidado, mon, aUSD });
  const posC = useMemo(() => armarPosicion(balCorte, suma, corte), [balCorte, consolidado, mon, tiposCambio]);   // eslint-disable-line react-hooks/exhaustive-deps
  const posP = useMemo(() => armarPosicion(balPrev,  suma, prev),  [balPrev,  consolidado, mon, tiposCambio]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Nativos por moneda (solo en consolidado, para la sub-fila "por moneda"): misma cascada con un sumador nativo.
  const monedas = useMemo(() => {
    const st = new Set();
    [balCorte, balPrev].forEach(b => [b.cuentas, b.aCobrar, b.aPagar, b.intercoAct, b.intercoPas].forEach(a => a.forEach(it => it.moneda && st.add(it.moneda))));
    return MONEDAS_ORDEN.filter(m => st.has(m)).concat([...st].filter(m => !MONEDAS_ORDEN.includes(m)));
  }, [balCorte, balPrev]);
  const nativos = useMemo(() => {
    if (!consolidado || !verNativos) return null;
    const out = {};
    for (const mo of monedas) out[mo] = armarPosicion(balCorte, (items, _f, pred) => sumSaldo(items, mo, pred), corte);
    return out;
  }, [consolidado, verNativos, monedas, balCorte, corte]);

  // ── Filas de la cascada: cada una sabe leer su valor de un `pos` (USD o nativo). Detalle ordenado de MAYOR a menor
  //    por el valor al corte (Martín 24/9), intercompañía al final. ──
  //    Cada fila lleva `signo`: lo que resta se MUESTRA en negativo, así la cascada se lee sumando hacia abajo (Martín).
  const labelsDe = (grupo, signo = 1) => ordenarDetalle([...new Set([...posC.det[grupo].keys(), ...posP.det[grupo].keys()])].map(L => ({ label: L })))
    .map(x => ({ key: `${grupo}:${x.label}`, label: x.label, get: p => p.det[grupo].get(x.label) || 0, indent: 44, signo }))
    .sort((a, b) => (/^Intercompañía/.test(a.label) ? 1 : 0) - (/^Intercompañía/.test(b.label) ? 1 : 0) || Math.abs(b.get(posC)) - Math.abs(a.get(posC)));
  const filas = [];
  filas.push({ kind: "banda", label: "Liquidez" });
  filas.push({ key: "caja", label: "Caja", get: p => p.caja });
  filas.push({ key: "bancos", label: "Bancos", get: p => p.bancos });
  if (nz(posC.inversiones) || nz(posP.inversiones)) filas.push({ key: "inv", label: "Inversiones", get: p => p.inversiones });
  filas.push({ key: "disp", label: "= Disponible", get: p => p.disponible, kind: "total", color: "#16a34a" });

  filas.push({ kind: "banda", label: "Operación · corriente (a cobrar y a pagar)" });
  filas.push({ key: "cxc", label: "+ Cuentas por cobrar", get: p => p.cxc, kind: "sub", k: "cxc" });
  if (open.cxc) filas.push(...labelsDe("cxc"));
  filas.push({ key: "cxp", label: "− Cuentas por pagar operativas (incluye tarjetas)", get: p => p.cxpOpNeto, kind: "sub", k: "cxp", signo: -1 });
  if (open.cxp) filas.push(...labelsDe("operativo", -1));   // tarjetas ya vienen en una línea, netas del saldo a favor
  if (nz(posC.finCorr) || nz(posP.finCorr)) {
    filas.push({ key: "finc", label: "− Inversores y financieros (corriente)", get: p => p.finCorr, kind: "sub", k: "finc", signo: -1 });
    if (open.finc) filas.push(...labelsDe("finCorriente", -1));
  }
  filas.push({ key: "ct", label: "= Capital de trabajo (a cobrar − a pagar corriente)", get: p => p.capitalTrabajo, kind: "total", color: T.text });
  filas.push({ key: "pcorr", label: "= POSICIÓN CORRIENTE (disponible + capital de trabajo)", get: p => p.posCorriente, kind: "hero" });

  filas.push({ kind: "banda", label: "No corriente (deuda que se refinancia: créditos, planes, impuestos; anticipos de clientes)", k: "nocorr" });
  if (open.nocorr) {
    filas.push(...labelsDe("noCorriente", -1));
    filas.push(...labelsDe("anticipo", -1));
    if (nz(posC.prestamosSocios) || nz(posP.prestamosSocios)) filas.push({ key: "pSoc", label: "Préstamos a socios (nos deben)", get: p => p.prestamosSocios, indent: 44 });
    if (!esTodas || nz(posC.intercoNeto) || nz(posP.intercoNeto)) filas.push({ key: "ic", label: "Intercompañía neto (nos deben − les debemos)", get: p => p.intercoNeto, indent: 44 });
    if (nz(posC.ccGrupoNeto) || nz(posP.ccGrupoNeto)) filas.push({ key: "ccg", label: "CC comercial entre sociedades (nos deben − les debemos)", get: p => p.ccGrupoNeto, indent: 44 });
  }
  filas.push({ key: "deuda", label: "− No corriente neto", get: p => p.deudaNoCorrNeta, kind: "total", color: "#dc2626", signo: -1 });

  const val = (f, c) => (f.signo ?? 1) * (c === "var" ? f.get(posC) - f.get(posP) : f.get(c === "corte" ? posC : posP));
  const valNat = (f, mo) => (f.signo ?? 1) * f.get(nativos[mo]);
  const COLS = ["prev", "corte", "var"];
  const colLabel = c => c === "prev" ? `Cierre ${fmtDate(prev.slice(0, 8) + String(new Date(+prev.slice(0, 4), +prev.slice(5, 7), 0).getDate()).padStart(2, "0"))}`
    : c === "corte" ? (esHoy ? "Hoy (provisorio)" : `Al ${fmtDate(corte)}`) : (esHoy ? "Variación (mes en curso)" : "Variación");

  const tcTxt = (() => {
    if (!consolidado) return null;
    const tc = tcPara(corte);
    if (!tc) return "Sin tipo de cambio cargado para el mes del corte ni los anteriores.";
    const parts = [tc.arsUSD ? `1 USD = ${Math.round(tc.arsUSD).toLocaleString("es-AR")} ARS` : null, tc.eurUSD ? `1 EUR = ${tc.eurUSD.toFixed(2)} USD` : null, tc.copUSD ? `1 USD = ${Math.round(tc.copUSD).toLocaleString("es-AR")} COP` : null].filter(Boolean);
    return `TC usado para el corte (${tc.yearMonth}): ${parts.join(" · ")}. Cada columna usa el TC de su propio mes.`;
  })();

  // Cuentas negativas a hoy (MP del mes sin asentar es el caso típico) → aviso de foto provisoria.
  const socNombre = id => sociedades.find(s => String(s.id) === String(id))?.nombre || "";
  const negativas = esHoy ? cuentasNegativas(balCorte) : [];
  const negMP = negativas.filter(esCuentaMercadoPago);

  const th = { padding: "9px 12px", fontSize: 11, fontWeight: 800, color: T.tableHeadText, textAlign: "right", whiteSpace: "nowrap" };
  const cell = (v, { bold = false, color = null, size = 13 } = {}) => ({ padding: "8px 12px", fontSize: size, textAlign: "right", fontFamily: "var(--mono)", fontWeight: bold ? 800 : 500, color: color || (v < 0 ? "#dc2626" : T.text), whiteSpace: "nowrap" });

  return (
    <div className="fade">
      <AvisosTC tcSuplente={tcSuplente} faltaTC={faltaTC} />

      {esHoy && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "9px 16px", marginBottom: 12, fontSize: 12.5, color: "#92400e", lineHeight: 1.5 }}>
          <b>Foto a hoy, provisoria.</b> Las ventas de Mercado Pago del mes se asientan al cierre, así que hasta entonces MP puede quedar negativo y el mes en curso incompleto.
          {negMP.length > 0 && <> Hoy en negativo: <b>{negMP.map(c => `${c.nombre}${socNombre(c.sociedad) ? ` · ${socNombre(c.sociedad)}` : ""} (${fmtNativo(Number(c.saldo) || 0, c.moneda)})`).join(", ")}</b>.</>}
          {" "}Para la foto firme elegí <b>Último cierre</b> arriba.
        </div>
      )}
      {posC.desconocidos.size > 0 && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "8px 14px", marginBottom: 12, fontSize: 12, color: "#92400e" }}>
          Pasivos sin clasificar (van a Cuentas por pagar operativas): <b>{[...posC.desconocidos].join(", ")}</b>. Revisá la cuenta de pasivo en Maestros › Plan de cuentas.
        </div>
      )}
      {nz(posC.diferencia) && (
        <div role="alert" style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "8px 14px", marginBottom: 12, fontSize: 12.5, color: "#991b1b", fontWeight: 600 }}>
          Control: la Posición neta total difiere del Patrimonio Neto del Balance en {fmtBal(posC.diferencia)} — hay items que no cayeron en ningún grupo.
        </div>
      )}

      {/* ── KPI ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <KpiTile label="Disponible" value={posC.disponible} delta={posC.disponible - posP.disponible} />
        <KpiTile label="Posición corriente" value={posC.posCorriente} delta={posC.posCorriente - posP.posCorriente} destacado
          sub="Disponible + a cobrar − a pagar corriente" />
        <KpiTile label="No corriente neto (resta)" value={-posC.deudaNoCorrNeta} delta={-(posC.deudaNoCorrNeta - posP.deudaNoCorrNeta)}
          sub="Créditos, planes de pago, impuestos, socios, anticipos" />
        <KpiTile label="Posición neta total" value={posC.posicionNeta} delta={posC.posicionNeta - posP.posicionNeta}
          sub={`= Patrimonio Neto del Balance${nz(posC.diferencia) ? ` (dif. ${fmtBal(posC.diferencia)})` : ""}`} />
      </div>

      {/* ── Cascada ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: T.muted, letterSpacing: ".08em", textTransform: "uppercase" }}>
          Cascada{consolidado ? " · USD consolidado" : ` · ${mon}`}{socsIncluidas.length ? ` · ${socsIncluidas.length} sociedad${socsIncluidas.length > 1 ? "es" : ""}` : ""}
        </span>
        {consolidado && monedas.length > 0 && (
          <button type="button" onClick={() => setVerNativos(v => !v)} style={{
            background: verNativos ? T.accentDark : "#eceff3", color: verNativos ? T.accent : T.muted,
            border: `1px solid ${verNativos ? T.accentDark : T.cardBorder}`, borderRadius: 999,
            padding: "4px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
            {verNativos ? "Ocultar nativos por moneda" : "Ver nativos por moneda"}
          </button>
        )}
      </div>
      <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 380 + COLS.length * 140 }}>
          <thead>
            <tr style={{ background: T.tableHead }}>
              <th style={{ ...th, textAlign: "left", letterSpacing: ".04em", textTransform: "uppercase", padding: "9px 14px" }}>Concepto</th>
              {COLS.map(c => <th key={c} style={th}>{colLabel(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => {
              if (f.kind === "banda") {
                const clickable = !!f.k;
                return (
                  <tr key={`b${i}`} style={{ background: T.tableHead, cursor: clickable ? "pointer" : "default" }} onClick={clickable ? () => toggle(f.k) : undefined}>
                    <td colSpan={COLS.length + 1} style={{ padding: "7px 14px", fontSize: 11, fontWeight: 800, color: T.tableHeadText, letterSpacing: ".08em", textTransform: "uppercase", userSelect: "none" }}>
                      {clickable && <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{open[f.k] ? "▼" : "▶"}</span>}{f.label}
                    </td>
                  </tr>
                );
              }
              if (f.kind === "hero") {
                return (
                  <tr key={f.key} style={{ background: T.accentDark, color: T.accent, borderTop: `2px solid ${T.cardBorder}` }}>
                    <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 900 }}>{f.label}</td>
                    {COLS.map(c => <td key={c} style={{ ...cell(val(f, c), { bold: true, size: 14 }), color: T.accent, fontWeight: 900 }}>{fmtBal(val(f, c))}</td>)}
                  </tr>
                );
              }
              const isSub = f.kind === "sub", isTot = f.kind === "total";
              const indent = f.indent ?? (isTot ? 14 : 28);
              return (<Fragment key={f.key}>
                <tr style={{ borderTop: `1px solid ${T.cardBorder}`, background: isSub ? "#f8fafc" : "transparent", cursor: isSub ? "pointer" : "default" }}
                  onClick={isSub ? () => toggle(f.k) : undefined}>
                  <td style={{ padding: `8px 14px 8px ${indent}px`, fontSize: 13, color: f.color || T.text, fontWeight: (isSub || isTot) ? 800 : 500, whiteSpace: "nowrap", userSelect: "none" }}>
                    {isSub && <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{open[f.k] ? "▼" : "▶"}</span>}{f.label}
                  </td>
                  {COLS.map(c => <td key={c} style={cell(val(f, c), { bold: isSub || isTot, color: f.color })}>{fmtBal(val(f, c))}</td>)}
                </tr>
                {nativos && (
                  <tr style={{ background: "#fbfcfd" }}>
                    <td style={{ padding: `2px 14px 7px ${indent + 14}px`, fontSize: 11, color: T.dim, fontFamily: "var(--mono)" }} colSpan={COLS.length + 1}>
                      {monedas.map(mo => nz(valNat(f, mo)) ? fmtNativo(valNat(f, mo), mo) : null).filter(Boolean).join("   ·   ") || "—"}
                    </td>
                  </tr>
                )}
              </Fragment>);
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "#0e7490", color: "#fff", borderTop: `2px solid ${T.cardBorder}` }}>
              <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 900 }}>= POSICIÓN NETA TOTAL</td>
              {COLS.map(c => { const v = c === "var" ? posC.posicionNeta - posP.posicionNeta : (c === "corte" ? posC : posP).posicionNeta; return <td key={c} style={{ ...cell(v, { bold: true, size: 14 }), color: "#fff", fontWeight: 900 }}>{fmtBal(v)}</td>; })}
            </tr>
            {nativos && (
              <tr style={{ background: "#0c5f75", color: "rgba(255,255,255,.8)" }}>
                <td colSpan={COLS.length + 1} style={{ padding: "3px 14px 8px 28px", fontSize: 11, fontFamily: "var(--mono)" }}>
                  {monedas.map(mo => nz(nativos[mo].posicionNeta) ? fmtNativo(nativos[mo].posicionNeta, mo) : null).filter(Boolean).join("   ·   ") || "—"}
                </td>
              </tr>
            )}
            {(nz(posC.diferencia) || nz(posP.diferencia)) && (<>
              <tr style={{ background: "#083344", color: "#fff" }}>
                <td style={{ padding: "8px 14px", fontSize: 12.5, fontWeight: 700 }}>Patrimonio Neto según Balance</td>
                {COLS.map(c => { const v = c === "var" ? posC.pnBalance - posP.pnBalance : (c === "corte" ? posC : posP).pnBalance; return <td key={c} style={{ ...cell(v, { bold: true }), color: "#fff" }}>{fmtBal(v)}</td>; })}
              </tr>
              <tr style={{ background: "#083344", color: "#fca5a5" }}>
                <td style={{ padding: "8px 14px", fontSize: 12.5, fontWeight: 700 }}>Diferencia (items sin grupo)</td>
                {COLS.map(c => { const v = c === "var" ? posC.diferencia - posP.diferencia : (c === "corte" ? posC : posP).diferencia; return <td key={c} style={{ ...cell(v, { bold: true }), color: "#fca5a5" }}>{fmtBal(v)}</td>; })}
              </tr>
            </>)}
          </tfoot>
        </table>
      </div>
      {/* Explicación de lectura, DEBAJO de la cascada (Martín 24/9: arriba molestaba). */}
      <div style={{ fontSize: 11, color: T.muted, margin: "8px 0 18px", lineHeight: 1.5 }}>
        {consolidado
          ? <><b>Consolidado del grupo en USD</b>: cada saldo traducido al tipo de cambio del mes de su fecha. Elegí una moneda arriba para ver la posición nativa de esa moneda. </>
          : <>Posición en <b>{mon}</b>: solo lo que existe en esa moneda (circuito cerrado, como el Balance). </>}
        {tcTxt ? <>{tcTxt} </> : null}
        {!esFinDeMes(corte) && !esHoy ? <>El corte no es fin de mes: la variación compara contra el cierre anterior con un mes parcial. </> : null}
        <br />
        Caja y Bancos llevan el saldo de cada cuenta con su signo (un banco en descubierto resta). Cuentas por pagar operativas = proveedores, sueldos y cargas sociales, franquiciados y tarjetas de crédito; aparte, inversores y financieros (corriente).
        No corriente = créditos y préstamos, impuestos y planes de pago (deuda financiable), socios, anticipos de clientes y la cuenta corriente comercial entre sociedades; se le restan los préstamos a socios y el neto intercompañía. La Posición neta total es el Patrimonio Neto del Balance.
      </div>

      {/* ── Apertura por sociedad (Núcleo / Fondeadas) ── */}
      <AperturaSociedades balCorte={balCorte} suma={suma} corte={corte} socsIncluidas={socsIncluidas} posTotal={posC} consolidado={consolidado} mon={mon} />

      <div style={{ fontSize: 11, color: T.dim, marginTop: 10, fontStyle: "italic" }}>
        Próximamente: compromisos de los próximos 30 / 60 / 90 días (cuotas de planes de pago y sueldos a pagar).
      </div>
    </div>
  );
}

// Misma cascada por sociedad a la fecha de corte. La CC comercial entre sociedades va en "No corriente" (como en la
// cascada); el intercompañía se netea a nivel del set y aparece solo como fila de conciliación.
function AperturaSociedades({ balCorte, suma, corte, socsIncluidas, posTotal, consolidado, mon }) {
  const porSoc = balCorte?.porSociedad;
  if (!porSoc || !socsIncluidas.length) return null;
  const esNucleo = s => /cleo/i.test(String(s.anillo || ""));
  const grupos = [
    { label: "Núcleo", socs: socsIncluidas.filter(esNucleo) },
    { label: "Fondeadas / Inversión", socs: socsIncluidas.filter(s => !esNucleo(s)) },
  ].filter(g => g.socs.length);
  const filaDe = (s) => {
    const d = porSoc.get(s.id) || { cuentas: [], aCobrar: [], aPagar: [] };
    const p = armarPosicion({ ...d, intercoAct: [], intercoPas: [] }, suma, corte);
    // Con signo (lo que resta, en negativo): Disponible + A cobrar + A pagar = Posición corriente; + No corriente = Posición neta.
    return { disponible: p.disponible, cxc: p.cxc, cxp: -(p.cxpOpNeto + p.finCorr), pcorr: p.posCorriente, deuda: -p.deudaNoCorrNeta, neta: p.posicionNeta };
  };
  const COLS = [["disponible", "Disponible"], ["cxc", "+ A cobrar"], ["cxp", "− A pagar corriente"], ["pcorr", "= Posición corriente"], ["deuda", "− No corriente"], ["neta", "= Posición neta"]];
  const sumar = rows => COLS.reduce((acc, [k]) => ({ ...acc, [k]: rows.reduce((s, r) => s + r[k], 0) }), {});
  const filasG = grupos.map(g => { const rows = g.socs.map(s => ({ s, r: filaDe(s) })); return { ...g, rows, sub: sumar(rows.map(x => x.r)) }; });
  const total = sumar(filasG.map(g => g.sub));
  const interco = posTotal.intercoNeto;
  const th = { padding: "9px 12px", fontSize: 11, fontWeight: 800, color: T.tableHeadText, textAlign: "right", whiteSpace: "nowrap" };
  const td = (k, v, bold = false, color = null) => <td key={k} style={{ padding: "8px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--mono)", fontWeight: bold ? 800 : 500, color: color || (v < 0 ? "#dc2626" : T.text), whiteSpace: "nowrap" }}>{v == null ? "" : fmtBal(v)}</td>;
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: T.muted, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 6 }}>
        Por sociedad · al {fmtDate(corte)} · {consolidado ? "USD consolidado" : mon}
      </div>
      <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 260 + COLS.length * 120 }}>
          <thead>
            <tr style={{ background: T.tableHead }}>
              <th style={{ ...th, textAlign: "left", letterSpacing: ".04em", textTransform: "uppercase", padding: "9px 14px" }}>Sociedad</th>
              {COLS.map(([k, L]) => <th key={k} style={{ ...th, ...(k === "pcorr" ? { color: T.accent, background: T.accentDark } : {}) }}>{L}</th>)}
            </tr>
          </thead>
          <tbody>
            {filasG.map(g => (<Fragment key={g.label}>
              <tr style={{ background: T.tableHead }}>
                <td colSpan={COLS.length + 1} style={{ padding: "6px 14px", fontSize: 10.5, fontWeight: 800, color: T.tableHeadText, letterSpacing: ".08em", textTransform: "uppercase" }}>{g.label}</td>
              </tr>
              {g.rows.map(({ s, r }) => (
                <tr key={s.id} style={{ borderTop: `1px solid ${T.cardBorder}` }}>
                  <td style={{ padding: "8px 14px 8px 28px", fontSize: 13, color: T.text, whiteSpace: "nowrap" }}>{s.bandera ? `${s.bandera} ` : ""}{s.nombre}</td>
                  {COLS.map(([k]) => td(k, r[k], k === "pcorr" || k === "neta"))}
                </tr>
              ))}
              {g.rows.length > 1 && (
                <tr style={{ borderTop: `1px solid ${T.cardBorder}`, background: "#f8fafc" }}>
                  <td style={{ padding: "8px 14px", fontSize: 13, fontWeight: 800, color: T.text }}>Subtotal {g.label}</td>
                  {COLS.map(([k]) => td(k, g.sub[k], true))}
                </tr>
              )}
            </Fragment>))}
          </tbody>
          <tfoot>
            {nz(interco) && (<>
              <tr style={{ borderTop: `2px solid ${T.cardBorder}` }}>
                <td style={{ padding: "8px 14px", fontSize: 13, fontWeight: 700, color: T.text }}>Suma de sociedades</td>
                {COLS.map(([k]) => td(k, total[k], true))}
              </tr>
              <tr style={{ borderTop: `1px solid ${T.cardBorder}` }}>
                <td style={{ padding: "8px 14px 8px 28px", fontSize: 12.5, color: T.muted }}>+ Intercompañía con sociedades fuera del set (nos deben − les debemos)</td>
                {COLS.map(([k]) => td(k, k === "deuda" ? interco : k === "neta" ? interco : null))}
              </tr>
            </>)}
            <tr style={{ background: "#0e7490", color: "#fff", borderTop: `2px solid ${T.cardBorder}` }}>
              <td style={{ padding: "10px 14px", fontSize: 13.5, fontWeight: 900 }}>= Total del set</td>
              {COLS.map(([k]) => td(k, total[k] + (k === "deuda" || k === "neta" ? interco : 0), true, "#fff"))}
            </tr>
          </tfoot>
        </table>
      </div>
      {nz((total.neta + interco) - posTotal.posicionNeta) && (
        <div style={{ fontSize: 11.5, color: "#991b1b", marginTop: 6 }}>Control: la suma por sociedad ({fmtBal(total.neta + interco)}) no ata con la Posición neta total ({fmtBal(posTotal.posicionNeta)}).</div>
      )}
    </div>
  );
}
