import { useState, useEffect, useMemo, Fragment } from "react";
import { T } from "../theme";
import {
  fetchCuentasBancarias, fetchCuentas, fetchCentrosCosto, fetchGastos,
  esCuentaCredito, ingestarResumenTarjeta, fetchPendientesTarjeta,
  aceptarMovimiento, ignorarMovimiento, fetchBancoReglas, fetchMovTesoreria, metaVal,
} from "../../lib/numbersApi";
import { fetchLegajos } from "../../lib/sueldosApi";
import { parseTarjetaPdf } from "../parsers/tarjetaPdf";

// ── Helpers de prefill (mismo criterio que la pantalla Resumen TC) ──────────────
const num = v => Number(v) || 0;
const normCom = s => String(s || "").toUpperCase().replace(/\s+/g, " ").trim();
const normNom = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
const overlapNom = (a, b) => { const wb = new Set(b.split(" ").filter(w => w.length > 2)); return a.split(" ").filter(w => w.length > 2 && wb.has(w)).length; };
const nameScore = (a, b) => a === b ? 4 : (a.includes(b) || b.includes(a)) ? 2 : overlapNom(a, b) >= 2 ? 1.5 : 0;
// Nombre base de una tarjeta (sin token de moneda) para emparejar sus cuentas ARS/USD.
const baseTarjeta = s => String(s || "").replace(/\b(ARS|USD|EUR)\b|\$|u\$d|us\$/gi, "").replace(/\s+/g, " ").trim();

const cell = { width: "100%", background: "#fff", border: `1px solid ${T.cardBorder}`, borderRadius: 6, padding: "5px 7px", fontSize: 12, color: T.text, fontFamily: T.font, outline: "none", boxSizing: "border-box" };
// Campo imputado (mismo criterio que Banco): VERDE si está completo, ÁMBAR si falta.
const fld = (lleno, w = 150) => ({ ...cell, width: w, color: "#111827",
  background: lleno ? "#dcfce7" : "#fff7ed", border: `1px solid ${lleno ? "#4ade80" : "#fb923c"}` });
// Formato es-AR con decimales solo cuando existen (los centavos importan, sobre todo en USD).
const money = (n, mon) => n ? `${mon === "USD" ? "U$D" : "$"} ${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : "—";

// Mundo Tarjeta de Conciliaciones: el resumen es "un extracto más". Se sube el PDF, cada consumo
// entra como PENDIENTE (nb_movimientos, origen "tarjeta") con su propuesta ya puesta, y se van
// AUTORIZANDO uno por uno (→ gasto contra la cuenta-tarjeta). Reusa el motor de conciliación.
export default function MundoTarjeta({ sociedad }) {
  const [cuentasBanc, setCuentasBanc] = useState([]);
  const [cuentas, setCuentas]   = useState([]);   // plan de cuentas contables
  const [centros, setCentros]   = useState([]);
  const [legajos, setLegajos]   = useState([]);
  const [histLineas, setHistLineas] = useState([]);   // consumos previos → memoria por comercio
  const [cardPagosFC, setCardPagosFC] = useState([]); // FCs ya pagadas con la tarjeta → reconocer por monto (no recargar)
  const [pendientes, setPend]   = useState([]);
  const [reglas, setReglas]     = useState([]);       // nb_banco_reglas (usamos las match_tipo="comercio")
  const [edits, setEdits]       = useState({});       // { movId: { cuenta_contable, centro_costo } }
  const [tarjetaId, setTarjetaId] = useState("");
  const [pdfMsg, setPdfMsg]     = useState("");
  const [cuadre, setCuadre]     = useState(null);   // { faltaARS, faltaUSD, totalARS, totalUSD } si el PDF trae TOTAL A PAGAR
  const [busy, setBusy]         = useState(false);
  const [prog, setProg]         = useState(null);   // { done, total } mientras autoriza en lote
  const [filtroCuenta, setFiltroCuenta] = useState("");   // filtrar la bandeja por cuenta (autorizar por lote)
  const [loading, setLoading]   = useState(true);

  // Tarjetas = cuentas bancarias tipo "tarjeta" de la sociedad.
  const tarjetas = useMemo(() => cuentasBanc.filter(c =>
    esCuentaCredito(c) && (c.sociedad ?? "").toLowerCase() === (sociedad ?? "").toLowerCase()), [cuentasBanc, sociedad]);
  const tarjetaFamilias = useMemo(() => {
    const seen = new Map();
    for (const c of tarjetas) { const b = baseTarjeta(c.nombre) || c.nombre; if (!seen.has(b)) seen.set(b, { id: c.id, nombre: b }); }
    return [...seen.values()];
  }, [tarjetas]);
  const tarjetaIds = useMemo(() => new Set(tarjetas.map(c => c.id)), [tarjetas]);
  const tarjetaSel = tarjetas.find(c => c.id === tarjetaId);

  const cuentaNombreDe = id => cuentas.find(c => c.id === id)?.nombre || id;

  useEffect(() => {
    fetchCuentasBancarias().then(c => setCuentasBanc(Array.isArray(c) ? c : [])).catch(() => {});
    fetchCuentas().then(c => setCuentas(Array.isArray(c) ? c : [])).catch(() => {});
    fetchCentrosCosto().then(c => setCentros(Array.isArray(c) ? c : [])).catch(() => {});
    fetchLegajos().then(l => setLegajos(Array.isArray(l) ? l : [])).catch(() => {});
    fetchBancoReglas().then(r => setReglas(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  // Reglas por COMERCIO (Maestros › Reglas de banco, match_tipo="comercio"): comercio → cuenta/centro.
  // Se ordenan por largo desc para que gane la coincidencia más específica (prefijo/contiene).
  const reglasComercio = useMemo(() => (reglas || [])
    .filter(r => String(r.match_tipo) === "comercio" && r.activo !== false && r.match_valor)
    .map(r => ({ valor: String(r.match_valor).toUpperCase().replace(/\s+/g, " ").trim(), cuentaId: r.cuenta_contable || "", centroId: r.centro_costo || "" }))
    .sort((a, b) => b.valor.length - a.valor.length), [reglas]);
  const matchRegla = (comercio) => {
    const c = String(comercio || "").toUpperCase().replace(/\s+/g, " ").trim();
    if (!c) return null;
    return reglasComercio.find(r => c === r.valor || c.startsWith(r.valor) || c.includes(r.valor)) || null;
  };

  const recargarPend = () =>
    fetchPendientesTarjeta(sociedad).then(p => setPend(Array.isArray(p) ? p : [])).finally(() => setLoading(false));

  useEffect(() => { setLoading(true); recargarPend(); /* eslint-disable-next-line */ }, [sociedad]);

  // Al cambiar de sociedad/tarjetas: memoria de comercios (consumos previos) + pagos de FC hechos
  // con la tarjeta (para reconocerlos por monto en el resumen y NO recargarlos → sin doble conteo).
  useEffect(() => {
    if (!tarjetas.length) { setHistLineas([]); setCardPagosFC([]); return; }
    fetchGastos(sociedad).then(gs => setHistLineas((Array.isArray(gs) ? gs : []).filter(g => tarjetaIds.has(g.cuentaBancaria)))).catch(() => {});
    fetchMovTesoreria(sociedad).then(ms => setCardPagosFC((Array.isArray(ms) ? ms : [])
      .filter(m => tarjetaIds.has(m.cuenta_bancaria) && m.tipo === "PAGO" && m.documento_id))).catch(() => {});
  }, [sociedad, tarjetas, tarjetaIds]);

  const memoria = useMemo(() => {
    const porComercio = {}, centroPorComercio = {};
    for (const g of histLineas) {
      const com = normCom(g.nota);
      if (com && g.cuenta_contable) porComercio[com] = { cuenta: g.cuenta_contable, cuentaId: cuentas.find(c => c.nombre === g.cuenta_contable)?.id || "" };
      if (com && g.cc)              centroPorComercio[com] = g.cc;
    }
    return { porComercio, centroPorComercio };
  }, [histLineas, cuentas]);

  // Centro del legajo del titular (fallback cuando la memoria no encontró nada).
  const legajosNorm = useMemo(() => legajos.map(l => ({ sede_id: l.sede_id, _norm: normNom(l.nombre) })).filter(l => l.sede_id && l._norm), [legajos]);
  const centroIds   = useMemo(() => new Set(centros.map(c => c.id)), [centros]);
  const centroDeLegajo = (titular) => {
    const t = normNom(titular); if (!t) return "";
    let best = null, score = 0;
    for (const l of legajosNorm) { const s = nameScore(t, l._norm); if (s > score) { score = s; best = l; } }
    if (score < 1.5) {
      const toks = t.split(" ").filter(w => w.length > 3);
      const ape  = toks[toks.length - 1];
      const cand = ape ? legajosNorm.filter(l => l._norm.split(" ").includes(ape)) : [];
      if (cand.length === 1) { best = cand[0]; score = 1.5; }
    }
    return (score >= 1.5 && best && centroIds.has(best.sede_id)) ? best.sede_id : "";
  };

  // Cuenta-tarjeta de la moneda pedida, dentro de la familia de la seleccionada (Visa ARS / Visa USD).
  const cardAccountFor = (moneda) => {
    if (tarjetaSel && tarjetaSel.moneda === moneda) return tarjetaSel;
    const base = baseTarjeta(tarjetaSel?.nombre);
    return tarjetas.find(c => c.moneda === moneda && baseTarjeta(c.nombre) === base)
        || tarjetas.find(c => c.moneda === moneda) || null;
  };

  async function onPdf(file) {
    if (!file) return;
    if (!tarjetaId) { setPdfMsg("Elegí primero la tarjeta."); return; }
    setPdfMsg("Leyendo PDF…"); setBusy(true);
    try {
      const r = await parseTarjetaPdf(file);
      if (!r.lineas.length) { setPdfMsg("No pude leer líneas del PDF — cargalas a mano o probá otro."); setBusy(false); return; }
      const hd = r.header || {};
      const periodo = hd.periodo || "";
      const fecha   = hd.fechaCierre || new Date().toISOString().slice(0, 10);
      // Cuadre por titular contra los subtotales "Total Consumos de X" del propio PDF (control
      // confiable — NO el "TOTAL A PAGAR", que incluye saldo anterior y pagos). Si algún grupo no
      // cuadra, el parser se comió renglones de ese titular → se avisa (no carga en silencio).
      const off = (r.controles || []).filter(c => Math.abs(c.pdfARS - c.parsedARS) > 1 || Math.abs(c.pdfUSD - c.parsedUSD) > 0.5);
      setCuadre(off.length ? off.map(c => ({
        titular: c.titular || "Sin titular",
        faltaARS: c.pdfARS - c.parsedARS, faltaUSD: c.pdfUSD - c.parsedUSD,
      })) : null);
      // Reconocer por MONTO las FCs ya pagadas con la tarjeta: esas líneas del resumen NO se
      // recargan (el pago ya existe como PAGO linkeado a la FC) → sin doble conteo. Cada pago
      // matchea una sola línea.
      const pool = cardPagosFC.map(m => ({ monto: Math.abs(num(m.monto)), used: false }));
      let reconocidas = 0;
      const lineas = [];
      for (const x of r.lineas) {
        const moneda = x.moneda === "USD" ? "USD" : "ARS";
        const monto  = Math.abs(num(x.monto));
        const hit = pool.find(p => !p.used && Math.abs(p.monto - monto) <= 0.5);
        if (hit) { hit.used = true; reconocidas++; continue; }   // ya es un pago de FC → no recargar
        const card = cardAccountFor(moneda);
        const reg = matchRegla(x.comercio);   // regla por comercio (Maestros): cuenta + centro default
        const c  = memoria.porComercio[normCom(x.comercio)];
        // Cuenta: regla por comercio → memoria → vacío. Centro: regla por comercio → legajo del titular → memoria.
        const cuentaNom = (reg?.cuentaId ? cuentaNombreDe(reg.cuentaId) : "") || c?.cuenta || "";
        const cc = reg?.centroId || centroDeLegajo(x.titular) || memoria.centroPorComercio[normCom(x.comercio)] || "";
        lineas.push({
          comercio: x.comercio, titular: x.titular || "", moneda, monto,
          cuenta_contable: cuentaNom, centro_costo: cc,
          cuenta_bancaria: card?.id || "", fecha: x.fecha || fecha,
        });
      }
      const rutear = lineas.filter(l => l.cuenta_bancaria);
      const sinCuenta = lineas.length - rutear.length;
      const res = await ingestarResumenTarjeta({ sociedad, tarjeta: tarjetaSel?.nombre || "", periodo, fecha, lineas: rutear });
      await recargarPend();
      setPdfMsg(`✓ ${res.creados} consumo(s) cargados a la bandeja`
        + (res.borradas ? ` · reemplazó ${res.borradas} de una carga anterior` : "")
        + (res.yaAutorizadas ? ` · ${res.yaAutorizadas} ya autorizados (no se recargan)` : "")
        + (reconocidas ? ` · ${reconocidas} ya eran pago de FC con la tarjeta` : "")
        + (sinCuenta ? ` · ⚠️ ${sinCuenta} sin cuenta-tarjeta de esa moneda (creala en Maestros)` : "")
        + ". Revisá cuenta/centro y autorizá.");
    } catch (e) { setPdfMsg("Error al leer el PDF: " + (e?.message || e)); }
    setBusy(false);
  }

  const setEdit = (id, k, v) => setEdits(e => ({ ...e, [id]: { ...e[id], [k]: v } }));
  const cuentaDe = m => edits[m.id]?.cuenta_contable ?? m.cuenta_contable ?? "";
  const centroDe = m => edits[m.id]?.centro_costo ?? m.centro_costo ?? "";
  const completa = m => !!cuentaDe(m);   // cuenta obligatoria (centro recomendado)

  async function autorizar(m) {
    if (!completa(m)) return;
    setBusy(true);
    try {
      await aceptarMovimiento(m, { cuenta_contable: cuentaDe(m), centro_costo: centroDe(m) });
      await recargarPend();
    } catch (e) { alert("No se pudo autorizar: " + (e?.message || e)); }
    setBusy(false);
  }
  async function ignorar(m) {
    if (!window.confirm(`¿Ignorar "${m.concepto}" (${money(m.monto, m.moneda)})? No se contabiliza.`)) return;
    setBusy(true);
    try { await ignorarMovimiento(m, "tarjeta"); await recargarPend(); }
    catch (e) { alert("No se pudo ignorar: " + (e?.message || e)); }
    setBusy(false);
  }
  async function autorizarTodas() {
    const listas = pendFiltrados.filter(completa);
    if (!listas.length) return;
    setBusy(true); setProg({ done: 0, total: listas.length });
    try {
      let done = 0;
      for (const m of listas) { await aceptarMovimiento(m, { cuenta_contable: cuentaDe(m), centro_costo: centroDe(m) }); setProg({ done: ++done, total: listas.length }); }
      await recargarPend();
    } catch (e) { alert("Error al autorizar en lote: " + (e?.message || e)); }
    setProg(null); setBusy(false);
  }

  // Filtro por cuenta → autorizar de a lotes (ej. todas las de "Representación").
  const cuentasBandeja = useMemo(() => [...new Set(pendientes.map(cuentaDe).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [pendientes, edits]);
  const pendFiltrados = useMemo(() => pendientes.filter(m => !filtroCuenta || cuentaDe(m) === filtroCuenta), [pendientes, filtroCuenta, edits]);

  // Cortes por titular (como el resumen): cada grupo con su subtotal en pesos y dólares.
  const gruposTit = useMemo(() => {
    const order = [], by = new Map();
    for (const m of pendFiltrados) {
      const k = metaVal(m.referencia, "tit") || "";
      if (!by.has(k)) { by.set(k, []); order.push(k); }
      by.get(k).push(m);
    }
    const abs = m => Math.abs(Number(m.monto) || 0);
    return order.map(tit => {
      const rows = by.get(tit);
      return {
        tit, rows,
        p: rows.reduce((s, m) => s + ((m.moneda || "ARS") !== "USD" ? abs(m) : 0), 0),
        d: rows.reduce((s, m) => s + ((m.moneda || "ARS") === "USD" ? abs(m) : 0), 0),
      };
    });
  }, [pendFiltrados]);
  const totP = gruposTit.reduce((s, g) => s + g.p, 0);
  const totD = gruposTit.reduce((s, g) => s + g.d, 0);

  const listasCount = pendFiltrados.filter(completa).length;
  const cuentaOpts = useMemo(() => cuentas.slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))), [cuentas]);
  const centroOpts = useMemo(() => centros.slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))), [centros]);

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Header: título + control de carga en una sola línea (mismo layout que Banco) */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: T.text, margin: 0 }}>
          Conciliaciones <span style={{ fontSize: 13, fontWeight: 700, color: T.muted }}>· Tarjeta</span>
        </h2>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <select value={tarjetaId} onChange={e => setTarjetaId(e.target.value)} style={{ ...cell, width: 210, background: "#fff" }}>
            <option value="">{tarjetaFamilias.length ? "— elegí la tarjeta —" : "(sin tarjetas)"}</option>
            {tarjetaFamilias.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
          <label style={{ background: tarjetaId && !busy ? T.accentDark : "#cbd5e1", color: tarjetaId && !busy ? T.accent : "#fff", borderRadius: 999, padding: "8px 16px", fontSize: 12.5, fontWeight: 700, cursor: tarjetaId && !busy ? "pointer" : "default", fontFamily: T.font, whiteSpace: "nowrap" }}>
            {busy ? "Procesando…" : "⬆ Subir resumen"}
            <input type="file" accept=".pdf" disabled={!tarjetaId || busy} style={{ display: "none" }} onChange={e => { onPdf(e.target.files[0]); e.target.value = ""; }} />
          </label>
        </div>
      </div>
      {pdfMsg && <div style={{ fontSize: 11.5, marginBottom: 10, textAlign: "right", color: pdfMsg.startsWith("✓") ? T.green : (pdfMsg.startsWith("Error") || pdfMsg.startsWith("No pude")) ? T.red : T.muted }}>{pdfMsg}</div>}

      {/* Cuadre por titular vs los subtotales del PDF: si no cuadra, el lector se comió renglones */}
      {cuadre && (
        <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12.5, color: "#92400e" }}>
          ⚠️ <b>El parseo no cuadra con los subtotales del PDF</b> — faltan renglones (agregalos a mano o revisá el PDF):
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {cuadre.map((c, i) => (
              <li key={i}>{c.titular}: faltan{Math.abs(c.faltaARS) > 1 ? ` ${money(c.faltaARS, "ARS")}` : ""}{Math.abs(c.faltaUSD) > 0.5 ? ` ${money(c.faltaUSD, "USD")}` : ""}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Bandeja */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: T.muted }}>
          {pendientes.length} consumo(s) sin autorizar{filtroCuenta ? ` · ${pendFiltrados.length} de "${filtroCuenta}"` : ""}
        </span>
        {cuentasBandeja.length > 0 && (
          <select value={filtroCuenta} onChange={e => setFiltroCuenta(e.target.value)} style={{ ...cell, width: 210 }} title="Filtrar por cuenta para autorizar de a lotes">
            <option value="">Todas las cuentas</option>
            {cuentasBandeja.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {listasCount > 0 && (
          <button onClick={autorizarTodas} disabled={busy}
            style={{ marginLeft: "auto", background: T.accent, border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 800, color: "#000", cursor: busy ? "default" : "pointer", fontFamily: T.font, opacity: busy ? .6 : 1 }}>
            {prog ? `Autorizando… ${prog.done}/${prog.total}` : `✓ Autorizar ${listasCount} completa${listasCount > 1 ? "s" : ""}`}
          </button>
        )}
      </div>

      {/* Barra de progreso mientras autoriza en lote */}
      {prog && prog.total > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ height: 8, background: "#e5e7eb", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round((prog.done / prog.total) * 100)}%`, background: T.accent, transition: "width .2s" }} />
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>Autorizando {prog.done} de {prog.total}… no cierres ni cambies de sociedad.</div>
        </div>
      )}

      {loading ? (
        <div style={{ color: T.muted, fontSize: 13, padding: "24px 4px" }}>Cargando…</div>
      ) : pendientes.length === 0 ? (
        <div style={{ color: T.muted, fontSize: 13, padding: "24px 4px" }}>No hay consumos pendientes. Elegí una tarjeta y subí el resumen.</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 10, boxShadow: T.shadow }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: T.text }}>
            <thead>
              <tr style={{ background: T.tableHead, color: T.tableHeadText, position: "sticky", top: 0, zIndex: 1 }}>
                {["Comercio", "Titular", "Cuenta *", "Centro", "ARS", "USD", ""].map((c, i) => (
                  <th key={i} style={{ padding: "8px 10px", textAlign: (i === 4 || i === 5) ? "right" : "left", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gruposTit.map(g => (
                <Fragment key={g.tit || "(sin titular)"}>
                  {g.rows.map(m => {
                    const esUSD = (m.moneda || "ARS") === "USD";
                    return (
                      <tr key={m.id} style={{ borderTop: `1px solid ${T.cardBorder}` }}>
                        <td style={{ padding: "5px 10px", minWidth: 200 }}>{m.concepto || metaVal(m.referencia, "com")}</td>
                        <td style={{ padding: "5px 10px", color: T.muted, whiteSpace: "nowrap" }}>{g.tit || "—"}</td>
                        <td style={{ padding: "4px 8px" }}>
                          <select value={cuentaDe(m)} onChange={e => setEdit(m.id, "cuenta_contable", e.target.value)}
                            style={fld(!!cuentaDe(m), 160)}>
                            <option value="">— cuenta —</option>
                            {cuentaOpts.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: "4px 8px" }}>
                          <select value={centroDe(m)} onChange={e => setEdit(m.id, "centro_costo", e.target.value)} style={fld(!!centroDe(m), 150)}>
                            <option value="">— centro —</option>
                            {centroOpts.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "right", fontFamily: T.mono }}>{esUSD ? "—" : money(m.monto, "ARS")}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right", fontFamily: T.mono }}>{esUSD ? money(m.monto, "USD") : "—"}</td>
                        <td style={{ padding: "4px 8px", whiteSpace: "nowrap", textAlign: "right" }}>
                          <button onClick={() => autorizar(m)} disabled={!completa(m) || busy}
                            style={{ background: completa(m) ? T.accent : "#e5e7eb", border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 800, color: completa(m) ? "#000" : T.muted, cursor: completa(m) && !busy ? "pointer" : "default", fontFamily: T.font }}>
                            Autorizar
                          </button>
                          <button onClick={() => ignorar(m)} disabled={busy} title="No contabilizar"
                            style={{ marginLeft: 6, background: "transparent", border: `1px solid ${T.cardBorder}`, borderRadius: 7, padding: "6px 9px", fontSize: 12, color: T.muted, cursor: busy ? "default" : "pointer", fontFamily: T.font }}>
                            Ignorar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: `1px solid ${T.cardBorder}`, background: "#e6eaf0", fontWeight: 700 }}>
                    <td colSpan={4} style={{ padding: "6px 10px", fontSize: 11.5 }}>Total {g.tit || "Sin titular"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: T.mono }}>{g.p ? money(g.p, "ARS") : "—"}</td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: T.mono }}>{g.d ? money(g.d, "USD") : "—"}</td>
                    <td />
                  </tr>
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${T.cardBorder}`, background: "#fafafa", fontWeight: 800 }}>
                <td colSpan={4} style={{ padding: "8px 10px" }}>Total general</td>
                <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: T.mono }}>{totP ? money(totP, "ARS") : "—"}</td>
                <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: T.mono }}>{totD ? money(totD, "USD") : "—"}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
