// Reportes › Consolidado — la foto de Tesorería sumando VARIAS sociedades.
// Reusa la derivación pura (derivarSaldos, una por sociedad) y los mismos componentes
// de presentación que Tesorería (TabSaldos/TabMovimientos/PaginaAging). Filtro de
// sociedades en la cabecera (arranca con todas). Datos propios (no scopeados a una sociedad).
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { T, fmtDate } from "../theme";
import {
  fetchSociedades,
  fetchMovTesoreria, fetchEgresos, fetchIngresos, fetchPagosCobros,
  fetchCuentasBancarias, fetchCuentas, fetchCentrosCosto,
  fetchFinanciaciones, fetchSocios, fetchSociosCC, fetchIntercoData, intercoLedger, primeCache,
  esCuentaCredito,
} from "../../lib/numbersApi";
import { fetchLiquidacionesCerradas } from "../../lib/sueldosApi";
import { fetchAll } from "../../lib/sheetsApi";        // Franquicias (read-only)
import { derivarSaldos, franqFirst, intercoConsolidado, sociedadNombreMap } from "../tesoreriaDerive";
import { buildDevengado } from "./TabDevengado";   // resultado por mes (misma función que el reporte Devengado) → conciliación del PN
import { TabSaldos, TabMovimientos, PaginaAging, PaginaIntercoLedger } from "../PantallaTesoreria";
import { buildPuente, printPuente } from "./puenteDerive";   // DEV-ONLY diagnóstico (descartable)
import { GO_LIVE_APERTURA, MESES_CORTOS as _MESES, sumSaldo, esCorriente, fmtBal, crearTraductor, AvisosTC, ordenarDetalle,
  hoyISO as _hoyISO, finMesAnterior as _finMesAnterior, esFinDeMes as _esFinDeMes } from "./balanceUtils";
import { computeCashFlow } from "./cashflowDerive";
import { CashFlowDirectoView, ResultadoACajaView } from "./CashFlowViews";

// Fusiona los items de Activo/Pasivo de varias sociedades por label+moneda (suma saldo, une docs).
function mergeItems(arrays) {
  const map = new Map();
  for (const it of arrays.flat()) {
    const key = `${it.label}||${it.moneda}`;
    if (!map.has(key)) map.set(key, { ...it, docs: [...(it.docs ?? [])] });
    else { const e = map.get(key); e.saldo += it.saldo; e.docs.push(...(it.docs ?? [])); }
  }
  return [...map.values()].sort(franqFirst);
}

// sumSaldo / esCorriente / fmtBal / crearTraductor / AvisosTC: en ./balanceUtils (compartidos con CashFlowViews).

// `pnl` = { inRows, egRows, cuentaMap, ccMap } del P&L (lo pasa PantallaReportes) → el Balance concilia el PN contra el
// resultado acumulado. `tiposCambio` = mapa YYYY-MM → tasas (nb_tipos_cambio) → Balance consolidado en USD con "Todas".
// Vistas del componente. El menú de Reportes lo monta DOS veces con distinto recorte (Martín 19/9):
//  · "Tesorería consolidada" (operar el día a día) = saldos + movimientos: ¿cuánta plata hay hoy y dónde?
//  · "Balance y Evolución del PN" (control y cierre) = balance + evpn: ¿cuánto vale la empresa y por qué cambió?
// Comparten motor, carga y filtros; por eso es un solo componente y no dos.
//  · "Cash Flow" (operar) = cf + flujo: ¿por qué se movió la caja? y ¿cómo el resultado se volvió caja? (19/9 noche)
const VISTAS_TODAS = ["saldos", "balance", "evpn", "movimientos", "cf", "flujo"];

// `socInicial`: "nucleo" → arranca con las sociedades del núcleo tildadas (el Cash Flow se mira así); null → todas.
// `monedaInicial`: moneda con la que abre ("ALL" = consolidado USD). El Cash Flow abre en ARS (Martín 19/9: la historia
// de la caja del núcleo —la operación consume pesos y se sostiene vendiendo USD— solo se ve en la moneda nativa).
export default function TabTesoreriaConsolidada({ pnl = null, tiposCambio = null, vistas = null, socInicial = null, monedaInicial = "ALL" } = {}) {
  const vistasOn = Array.isArray(vistas) && vistas.length ? vistas : VISTAS_TODAS;
  const [sociedades, setSociedades] = useState([]);
  const [socSel,     setSocSel]     = useState([]);   // [] = todas
  const [socOpen,    setSocOpen]    = useState(false);
  const [activeTab,  setActiveTab]  = useState(vistasOn[0]);
  const [filtroMoneda, setFiltroMoneda] = useState(monedaInicial || "ALL");
  const [fechaCorte,   setFechaCorte]   = useState("");
  const [filtroCuenta, setFiltroCuenta] = useState(null);
  const [filtroRef,    setFiltroRef]    = useState(null);   // "ir al movimiento" desde el extracto interco
  const [drillDownItem, setDrillDownItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const [data, setData] = useState({
    movimientos: [], egresos: [], ingresos: [], pagosCobros: [],
    cuentasBancarias: [], cuentasContables: [], centrosCosto: [],
    liqsSueldos: [], financiaciones: [], socios: [], sociosCC: [],
    franqData: { comps: {}, saldos: {}, franchises: [] },
  });
  // Interco aparte de `data` (NO se spreadea a derivarSaldos por-sociedad, para no duplicar;
  // se netea a nivel consolidado con intercoConsolidado).
  const [intercoData, setIntercoData] = useState(null);
  // Fuentes que NO cargaron (labels legibles) → aviso "no cargó X" con botón Recargar. Antes cada fetch hacía
  // `.catch(() => [])` y el Balance se dibujaba con movimientos/franquicias/interco vacíos sin ninguna señal.
  const [cargaFallida, setCargaFallida] = useState([]);
  // Fuentes secundarias (fuera del batch principal) todavía en vuelo → aviso suave, no bloqueante.
  const [secPend, setSecPend] = useState({ franq: true, interco: true });
  const [loadKey, setLoadKey] = useState(0);

  const socRef = useRef(null);
  const dateRef = useRef(null);

  useEffect(() => {
    if (!socOpen) return;
    const h = e => { if (socRef.current && !socRef.current.contains(e.target)) setSocOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [socOpen]);

  // ── Fetch todo, sin scope de sociedad (una sola pasada) ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null); setCargaFallida([]); setSecPend({ franq: true, interco: true });
      // Tolerante: si una fuente falla, las demás siguen; la falla queda anotada para avisar (no se traga).
      const fallas = [];
      const tol = (label, p) => p.catch(() => { fallas.push(label); return []; });
      try {
        // Liquidaciones vive en el backend de Sueldos → en paralelo al batch de Numbers.
        const liqsP = tol("liquidaciones de sueldos", fetchLiquidacionesCerradas());
        // Batch: 9 hojas group-wide de Numbers en UNA llamada → los fetch de abajo salen de caché.
        await primeCache([
          { resource: "nb_sociedades" },
          { resource: "nb_movimientos" },
          { resource: "nb_comprobantes" },
          { resource: "nb_cuentas_bancarias" },
          { resource: "nb_cuentas" },
          { resource: "nb_centros_costo" },
          { resource: "nb_financiaciones" },
          { resource: "nb_socios" },
          { resource: "nb_socios_cc" },
        ]);
        const [socs, movs, egs, ings, pcs, cbList, ctaList, ccList, fin, sos, sosCC] = await Promise.all([
          tol("sociedades",              fetchSociedades()),
          tol("movimientos",             fetchMovTesoreria()),
          tol("comprobantes de egreso",  fetchEgresos()),
          tol("comprobantes de ingreso", fetchIngresos()),
          tol("pagos y cobros",          fetchPagosCobros()),
          tol("cuentas bancarias",       fetchCuentasBancarias()),
          tol("plan de cuentas",         fetchCuentas()),
          tol("centros de costo",        fetchCentrosCosto()),
          tol("financiaciones",          fetchFinanciaciones()),
          tol("socios",                  fetchSocios()),
          tol("cuenta corriente de socios", fetchSociosCC()),
        ]);
        const liqsS = await liqsP;
        if (cancelled) return;
        if (fallas.length) setCargaFallida(f => [...f, ...fallas]);
        const activas = (Array.isArray(socs) ? socs : []).filter(s => {
          const a = s.activo;
          return !(a === false || a === 0 || a === "FALSE" || a === "false" || a === "0" || a === "");
        });
        setSociedades(activas);
        if (socInicial === "nucleo") {
          const nuc = activas.filter(s => /cleo/i.test(String(s.anillo || ""))).map(s => s.id);
          if (nuc.length && nuc.length < activas.length) setSocSel(nuc);
        }
        setData(d => ({
          ...d,
          movimientos: arr(movs), egresos: arr(egs), ingresos: arr(ings), pagosCobros: arr(pcs),
          cuentasBancarias: arr(cbList), cuentasContables: arr(ctaList), centrosCosto: arr(ccList),
          liqsSueldos: arr(liqsS), financiaciones: arr(fin), socios: arr(sos), sociosCC: arr(sosCC),
        }));
        // Franquicias (read-only) — fuera del Promise.all para no bloquear el consolidado.
        fetchAll()
          .then(fr => {
            if (cancelled) return;
            if (fr && fr.comps) setData(d => ({ ...d, franqData: fr }));
            else setCargaFallida(f => [...f, "franquicias"]);
          })
          .catch(() => { if (!cancelled) setCargaFallida(f => [...f, "franquicias"]); })
          .finally(() => { if (!cancelled) setSecPend(s => ({ ...s, franq: false })); });
        // Intercompañía: trae su propia lista de fuentes que no cargaron (`faltantes`) → se avisa igual.
        fetchIntercoData()
          .then(ic => {
            if (cancelled || !ic) return;
            setIntercoData(ic);
            if (ic.faltantes?.length) setCargaFallida(f => [...f, `intercompañía (${ic.faltantes.join(", ")})`]);
          })
          .catch(() => { if (!cancelled) setCargaFallida(f => [...f, "intercompañía"]); })
          .finally(() => { if (!cancelled) setSecPend(s => ({ ...s, interco: false })); });
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadKey]);

  const socsIncluidas = useMemo(
    () => socSel.length === 0 ? sociedades : sociedades.filter(s => socSel.includes(s.id)),
    [sociedades, socSel]
  );

  // Mapa id→nombre de TODAS las sociedades → `derivarSaldos` reconoce cuando el contraparte de un
  // comprobante es otra sociedad (no un cliente) y lo separa como CC comercial entre sociedades
  // (esContraparteSociedad), fuera de los buckets de cliente. Igual que la Tesorería por sociedad.
  const sociedadesMap = useMemo(() => sociedadNombreMap(sociedades), [sociedades]);


  // ── Derivar por sociedad y consolidar ──
  const { cuentas, aCobrar, aPagar, interco, intercoAct, intercoPas, movimientos } = useMemo(() => {
    const idsSel = new Set(socsIncluidas.map(s => (s.id ?? "").toLowerCase()));
    const perSoc = socsIncluidas.map(s => derivarSaldos({ ...data, sociedad: s.id, fechaCorte, sociedadesMap }));
    // Interco NETEADO a nivel consolidado (núcleo↔núcleo interno se elimina; el resto se muestra).
    const ic = intercoData
      ? intercoConsolidado(intercoData, socsIncluidas.map(s => s.id), sociedades, fechaCorte)
      : { activo: [], pasivo: [] };
    // En el consolidado, distintas sociedades pueden tener cuentas homónimas ("Galicia ARS") → sufijo con
    // la sociedad para distinguirlas (solo acá; en la Tesorería por sociedad sería redundante).
    const socName = id => sociedades.find(s => String(s.id) === String(id))?.nombre || String(id || "");
    return {
      cuentas:  perSoc.flatMap(r => r.cuentas).map(c => ({ ...c, _soc: socName(c.sociedad) })),
      aCobrar:  mergeItems(perSoc.map(r => r.aCobrar)),
      aPagar:   mergeItems(perSoc.map(r => r.aPagar)),
      interco:  [...ic.activo, ...ic.pasivo],   // bloque propio abajo de Inversiones
      intercoAct: ic.activo, intercoPas: ic.pasivo,   // separados → para el Balance (Activo/Pasivo)
      movimientos: data.movimientos.filter(m => idsSel.has((m.sociedad ?? "").toLowerCase())),
    };
  }, [data, socsIncluidas, fechaCorte, intercoData, sociedades, sociedadesMap]);

  const monedas = useMemo(() => [...new Set(cuentas.map(c => c.moneda))], [cuentas]);
  // DEV-ONLY (diagnóstico puente P&L→ΔPN, descartable — sacar antes de commitear)
  if (import.meta.env.DEV) { window.__consol = { data, intercoData, sociedades }; window.__buildPuente = buildPuente; window.__printPuente = printPuente; }

  // ── EEPN = el Balance con MESES en columnas: el balance derivado a fin de cada mes, misma estructura de
  //    líneas (caja/bancos/CxC · corriente/otros/PN), para ver cómo se mueve cada cuenta hasta el PN. ──
  // Balance derivado A UNA FECHA (as-of) para el set de sociedades elegido: lo usan el Balance (corte, cierre
  // anterior, apertura) y el EEPN (fin de cada mes). Interco consolidado también as-of.
  const deriveAsOf = useCallback((fecha) => {
    const idsSel = socsIncluidas.map(s => s.id);
    const perSoc = socsIncluidas.map(s => derivarSaldos({ ...data, sociedad: s.id, fechaCorte: fecha, sociedadesMap }));
    const ic = intercoData ? intercoConsolidado(intercoData, idsSel, sociedades, fecha) : { activo: [], pasivo: [] };
    return {
      cuentas: perSoc.flatMap(r => r.cuentas),
      aCobrar: mergeItems(perSoc.map(r => r.aCobrar)),
      aPagar:  mergeItems(perSoc.map(r => r.aPagar)),
      intercoAct: ic.activo, intercoPas: ic.pasivo,
    };
  }, [data, socsIncluidas, intercoData, sociedades, sociedadesMap]);

  const eepn = useMemo(() => {
    if (activeTab !== "evpn" && activeTab !== "flujo") return null;   // "flujo" (Resultado → Caja) usa los mismos cierres
    const idsSel = socsIncluidas.map(s => s.id);   // set de sociedades (no depende de la fecha)
    const year = new Date().getFullYear();
    const GO = year === 2026 ? 6 : 0;   // julio go-live (columna inicial = junio)
    const upto = Math.max(GO, new Date().getMonth());
    const finDeMes = (m) => `${year}-${String(m + 1).padStart(2, "0")}-31`;
    const balMes = {};
    for (let m = GO - 1; m <= upto; m++) balMes[m] = deriveAsOf(finDeMes(m));
    // Efecto de CAMBIO DE MONEDA acumulado a fin de cada mes, por moneda (movimientos origen "cambio").
    // Convertir USD↔ARS mueve plata entre cajas: NO es resultado económico, pero infla/desinfla el PN de
    // la moneda que se mira (la vista ve solo una pata). Se acumula aparte para separarlo de la variación.
    const idsLC = new Set(idsSel.map(x => String(x).toLowerCase()));
    const cambios = (data.movimientos || []).filter(mv => mv.origen === "cambio" && idsLC.has(String(mv.sociedad || "").toLowerCase()));
    const cambioAcum = {};
    for (let m = GO - 1; m <= upto; m++) {
      const hasta = finDeMes(m); const acc = { ARS: 0, USD: 0, EUR: 0, COP: 0 };
      for (const mv of cambios) if ((mv.fecha ?? "") <= hasta) { const c = mv.moneda || "ARS"; if (c in acc) acc[c] += Number(mv.monto) || 0; }
      cambioAcum[m] = acc;
    }
    // Etiquetas presentes (unión de todos los meses) para armar las filas de detalle.
    const uniq = (getArr, filt = () => true) => { const s = new Set(); for (let m = GO - 1; m <= upto; m++) getArr(balMes[m]).forEach(it => filt(it) && s.add(it.label)); return [...s]; };
    const cxcLabels  = uniq(b => b.aCobrar);
    const corrLabels = uniq(b => b.aPagar, it => esCorriente(it.label));
    const otrosLabels = uniq(b => b.aPagar, it => !esCorriente(it.label));
    return { year, GO, upto, balMes, cambioAcum, cxcLabels, corrLabels, otrosLabels };
  }, [activeTab, data, socsIncluidas, intercoData, sociedades, sociedadesMap, deriveAsOf]);

  // ── Cash Flow directo (método directo por naturaleza) sobre las MISMAS cajas y sociedades que el Balance: la
  //    sociedad de un movimiento es la de su CUENTA (como derivarSaldos) → la variación de caja ata con los saldos.
  //    Moneda: la elegida (nativo) o consolidado USD al TC del mes de cada movimiento ("Todas"). ──
  const cfDirecto = useMemo(() => {
    if (activeTab !== "cf" && activeTab !== "flujo") return null;
    const consolidado = filtroMoneda === "ALL";
    const { aUSD, faltaTC, tcSuplente } = crearTraductor(tiposCambio);
    const fx = consolidado ? (monto, mo, anio, mes) => aUSD(monto, mo, `${anio}-${String(mes).padStart(2, "0")}-01`) : null;
    const cf = computeCashFlow({
      rawMovs: data.movimientos, rawIn: pnl?.inRows || [], rawEg: pnl?.egRows || [], docs: [...data.egresos, ...data.ingresos],
      ccMap: pnl?.ccMap || new Map(data.centrosCosto.map(c => [String(c.id ?? "").trim().toLowerCase(), c])),
      cuentaMap: pnl?.cuentaMap || null,
      perimetro: new Set(socsIncluidas.map(s => s.id)),
      year: new Date().getFullYear(), moneda: consolidado ? "USD" : filtroMoneda, fx,
      tarjetaIds: new Set(data.cuentasBancarias.filter(esCuentaCredito).map(c => c.id)),
      cuentasBancarias: data.cuentasBancarias,
    });
    return { ...cf, faltaTC, tcSuplente };
  }, [activeTab, filtroMoneda, tiposCambio, data, pnl, socsIncluidas]);
  const socSetLC = useMemo(() => new Set(socsIncluidas.map(s => String(s.id).toLowerCase())), [socsIncluidas]);

  const toggleSoc = id => setSocSel(prev => {
    const full = prev.length === 0 ? sociedades.map(s => s.id) : prev;
    const next = full.includes(id) ? full.filter(x => x !== id) : [...full, id];
    return next.length === sociedades.length ? [] : next;   // todas → []
  });

  if (drillDownItem) {
    // Interco → estado de cuenta corriente con saldo (mismo modelo que la Tesorería por sociedad),
    // no un aging. Cada posición consolidada es un par (sociedad, contraparte) → su ledger directo.
    if (drillDownItem.intercoLedger && intercoData) {
      const ledger = intercoLedger(intercoData, {
        sociedad: drillDownItem.sociedadId,
        contraparte: drillDownItem.contraparteId,
        moneda: drillDownItem.moneda,
      });
      return <PaginaIntercoLedger item={drillDownItem} ledger={ledger} onBack={() => setDrillDownItem(null)}
        onGoToMov={vistasOn.includes("movimientos")
          ? (e => { setDrillDownItem(null); setFiltroCuenta(null); setFiltroRef(e?.ref || null); setActiveTab("movimientos"); })
          : undefined} />;
    }
    return (
      <PaginaAging item={drillDownItem} fechaCorte={fechaCorte}
        headerColor={drillDownItem.headerColor ?? "#374151"} onBack={() => setDrillDownItem(null)} />
    );
  }

  const TABS = [
    { id: "saldos", label: "Saldos" },
    { id: "balance", label: "Balance" },
    { id: "evpn", label: "Evolución PN" },
    { id: "movimientos", label: `Movimientos${movimientos.length ? ` (${movimientos.length})` : ""}` },
    { id: "cf",    label: "Por qué se movió la caja" },
    { id: "flujo", label: "Del resultado a la caja" },
  ].filter(t => vistasOn.includes(t.id));
  const nSel = socSel.length === 0 ? sociedades.length : socSel.length;

  return (
    <div className="fade">
      {/* ── Selector de vista — en la primera línea (a la altura del título), a la derecha ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -57, marginBottom: 22 }}>
        <div role="tablist" aria-label="Vista consolidada"
          style={{ display: "inline-flex", gap: 2, background: "#f3f4f6", borderRadius: 10, padding: 3 }}>
          {TABS.map(tab => {
            const active = activeTab === tab.id;
            return (
              <button key={tab.id} type="button" role="tab" aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                style={{ background: active ? T.accentDark : "transparent", border: "none", borderRadius: 8,
                  color: active ? T.accent : T.muted, fontFamily: T.font, fontSize: 13,
                  fontWeight: active ? 800 : 500, padding: "7px 18px", cursor: "pointer", transition: "all .15s" }}>
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Toolbar: sociedades + moneda + fecha ── */}
      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap", alignItems: "center",
        background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius,
        padding: "12px 16px", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>

        {/* Multi-select de sociedades */}
        <div ref={socRef} style={{ position: "relative" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase",
            letterSpacing: ".08em", marginRight: 8 }}>Sociedades</span>
          <button type="button" onClick={() => setSocOpen(o => !o)} style={{
            border: `1px solid ${T.cardBorder}`, borderRadius: 8, padding: "6px 12px", fontSize: 12,
            fontFamily: T.font, background: socOpen ? "#f0f2f5" : "#eceff3", color: T.text,
            cursor: "pointer", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 8, minWidth: 150 }}>
            <span style={{ flex: 1, textAlign: "left" }}>
              {socSel.length === 0 ? "Todas las sociedades" : `${nSel} sociedad${nSel > 1 ? "es" : ""}`}
            </span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.muted} strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: "transform .15s", transform: socOpen ? "rotate(180deg)" : "rotate(0)" }}>
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          {socOpen && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100,
              border: `1px solid ${T.cardBorder}`, borderRadius: 10, background: T.card,
              boxShadow: T.shadowMd, minWidth: 220, fontSize: 13, color: T.text,
              padding: "4px 0", maxHeight: 300, overflowY: "auto" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
                borderBottom: `1px solid ${T.cardBorder}`, cursor: "pointer", userSelect: "none", fontWeight: 600 }}>
                <input type="checkbox" checked={socSel.length === 0} onChange={() => setSocSel([])}
                  style={{ cursor: "pointer", accentColor: T.accentDark }} />
                Todas
              </label>
              {[{ label: "Núcleo", socs: sociedades.filter(s => /cleo/i.test(String(s.anillo || ""))) },
                { label: "Fondeadas / Inversión", socs: sociedades.filter(s => !/cleo/i.test(String(s.anillo || ""))) }]
                .filter(g => g.socs.length).map(g => (
                <div key={g.label}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px 3px", borderTop: `1px solid ${T.cardBorder}` }}>
                    <span style={{ fontSize: 9.5, fontWeight: 800, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em" }}>{g.label}</span>
                    <button type="button" onClick={() => setSocSel(g.socs.map(s => s.id))}
                      style={{ background: "transparent", border: "none", color: T.accentDark, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: T.font, padding: 0 }}>solo</button>
                  </div>
                  {g.socs.map(s => {
                    const checked = socSel.length === 0 || socSel.includes(s.id);
                    return (
                      <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px",
                        cursor: "pointer", userSelect: "none" }}
                        onMouseEnter={e => e.currentTarget.style.background = "#eceff3"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <input type="checkbox" checked={checked} onChange={() => toggleSoc(s.id)}
                          style={{ cursor: "pointer", accentColor: T.accentDark }} />
                        <span style={{ fontSize: 13 }}>{s.bandera ?? ""}</span>
                        {s.nombre}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ width: 1, height: 24, background: T.cardBorder, flexShrink: 0 }} />

        {/* Moneda */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase",
            letterSpacing: ".08em", marginRight: 4 }}>Moneda</span>
          {["ALL", ...monedas].map(m => {
            const on = filtroMoneda === m;
            return (
              <button key={m} type="button" onClick={() => setFiltroMoneda(m)} style={{
                background: on ? T.accentDark : "#eceff3", color: on ? T.accent : T.muted,
                border: `1px solid ${on ? T.accentDark : T.cardBorder}`, borderRadius: 999,
                padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
                {m === "ALL" ? "Todas" : m}
              </button>
            );
          })}
        </div>

        {/* Fecha corte — solo Saldos/Balance/Movimientos (EEPN y Cash Flow son mensuales, no usan corte) */}
        {!["evpn", "cf", "flujo"].includes(activeTab) && (
          <>
          <div style={{ width: 1, height: 24, background: T.cardBorder, flexShrink: 0 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase",
              letterSpacing: ".08em" }}>Al día</span>
            <button type="button" onClick={() => { dateRef.current?.showPicker?.(); dateRef.current?.click(); }}
              style={{ border: `1px solid ${T.cardBorder}`, borderRadius: 8, padding: "6px 12px", fontSize: 12,
                fontFamily: T.font, background: "#eceff3", color: fechaCorte ? T.text : T.dim, cursor: "pointer",
                whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6, minWidth: 124,
                justifyContent: "center", fontWeight: 600 }}>
              <span style={{ opacity: 0.75 }} aria-hidden>📅</span>
              {fechaCorte ? fmtDate(fechaCorte) : "Elegir fecha"}
            </button>
            <input ref={dateRef} type="date" value={fechaCorte} onChange={e => setFechaCorte(e.target.value)}
              style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }} />
            {fechaCorte && (
              <button type="button" onClick={() => setFechaCorte("")} title="Quitar fecha"
                style={{ background: "transparent", border: "none", color: T.muted, fontSize: 16,
                  cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
            )}
          </div>
          </>
        )}
      </div>

      {/* Aviso SUAVE: franquicias / intercompañía cargan fuera del batch principal → mientras falten, la CxC de
           franquiciados y la posición interco pueden completarse en unos segundos. No bloquea. */}
      {!loading && cargaFallida.length === 0 && (secPend.franq || secPend.interco) && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#eff6ff", border: "1px solid #bfdbfe",
          borderRadius: 10, padding: "9px 16px", marginBottom: 16, fontSize: 13, color: "#1e40af", fontWeight: 600, lineHeight: 1.4 }}>
          Cargando datos complementarios (<strong>{[secPend.franq && "franquicias", secPend.interco && "intercompañía"].filter(Boolean).join(" · ")}</strong>)…
          los saldos de franquiciados e intercompañía pueden completarse en unos segundos.
        </div>
      )}
      {/* Aviso: alguna fuente NO cargó (backend lento / 404) → los saldos y el PN pueden estar incompletos.
           Mejor decirlo que mostrar un Balance a medias en silencio. */}
      {cargaFallida.length > 0 && (
        <div role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "10px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: "#92400e", fontWeight: 600, lineHeight: 1.4 }}>
            ⚠ No cargó <strong>{cargaFallida.join(", ")}</strong> (backend lento). Los saldos, el Balance y el PN pueden estar incompletos — recargá.
          </div>
          <button type="button" onClick={() => setLoadKey(k => k + 1)} style={{
            flexShrink: 0, background: "#92400e", color: "#fff", border: "none", borderRadius: 999,
            padding: "6px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
            Recargar
          </button>
        </div>
      )}

      {loading && (
        <div style={{ padding: "60px 32px", textAlign: "center", color: T.muted, fontSize: 14 }}>
          Cargando consolidado…
        </div>
      )}
      {error && !loading && (
        <div role="alert" style={{ background: T.redBg, border: `1px solid ${T.red}`, borderRadius: T.radius,
          padding: "18px 22px", color: "#991b1b", fontSize: 13 }}>{error}</div>
      )}

      {!loading && !error && activeTab === "saldos" && (
        <TabSaldos cuentas={cuentas} aCobrar={aCobrar} aPagar={aPagar} interco={interco}
          filtroMoneda={filtroMoneda} onCuentaClick={c => { setFiltroCuenta(c.id); setActiveTab("movimientos"); }}
          onItemClick={setDrillDownItem} />
      )}
      {!loading && !error && activeTab === "balance" && (
        <BalanceView deriveAsOf={deriveAsOf} filtroMoneda={filtroMoneda} fechaCorte={fechaCorte}
          tiposCambio={tiposCambio} pnl={pnl} socsIncluidas={socsIncluidas} movimientos={data.movimientos} />
      )}
      {!loading && !error && activeTab === "evpn" && (
        <EEPNView eepn={eepn} filtroMoneda={filtroMoneda} tiposCambio={tiposCambio} />
      )}
      {!loading && !error && activeTab === "cf" && (
        <CashFlowDirectoView cf={cfDirecto} consolidado={filtroMoneda === "ALL"} mon={filtroMoneda}
          avisosTC={cfDirecto ? <AvisosTC tcSuplente={cfDirecto.tcSuplente} faltaTC={cfDirecto.faltaTC} /> : null} />
      )}
      {!loading && !error && activeTab === "flujo" && (
        <ResultadoACajaView eepn={eepn} consolidado={filtroMoneda === "ALL"} mon={filtroMoneda === "ALL" ? "USD" : filtroMoneda}
          tiposCambio={tiposCambio} pnl={pnl} socSet={socSetLC} movimientos={data.movimientos} cfDirecto={cfDirecto} />
      )}
      {!loading && !error && activeTab === "movimientos" && (
        <TabMovimientos movimientos={movimientos} cuentas={cuentas} filtroCuenta={filtroCuenta} filtroRef={filtroRef}
          onLimpiarFiltro={() => { setFiltroCuenta(null); setFiltroRef(null); }} centrosCosto={data.centrosCosto} />
      )}
    </div>
  );
}

const arr = x => Array.isArray(x) ? x : [];

// ── Tabla de Balance (Activo / Pasivo / PN) compartida por la vista Balance (columnas = monedas) y la
//    vista Evolución PN (columnas = meses). El padre arma columnas + getters + detalle; la tabla sólo
//    renderiza (bandas colapsables Activo/Pasivo, subgrupos CxC/Corriente/Otros, foot PN [+ variación]). ──
function BalanceTable({ cols, colLabel, minBase = 320, colW = 100, getters, details, showVariacion = false, ajustes = null, ajusteLabel = "= Variación ajustada" }) {
  const [open, setOpen] = useState({ activo: true, pasivo: true, cxc: true, corr: true, otros: true });
  const toggle = k => setOpen(o => ({ ...o, [k]: !o[k] }));
  const KEYS = ["activo", "pasivo", "cxc", "corr", "otros"];
  const allOpen = KEYS.every(k => open[k]);
  const toggleAll = () => { const v = !allOpen; setOpen(Object.fromEntries(KEYS.map(k => [k, v]))); };
  const { caja, bancos, cxcTot, activo, corrTot, otrosTot, pasivo, pn } = getters;

  const th = { padding: "9px 12px", fontSize: 11, fontWeight: 800, color: T.tableHeadText, textAlign: "right", whiteSpace: "nowrap" };
  const cell = (get, c, bold, color) => <td key={c} style={{ padding: "8px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--mono)", fontWeight: bold ? 800 : 500, color: color || (get(c) < 0 ? "#dc2626" : T.text), whiteSpace: "nowrap" }}>{fmtBal(get(c))}</td>;
  const Fila = ({ label, get, indent = 28, bold, color }) => (
    <tr style={{ borderTop: `1px solid ${T.cardBorder}` }}>
      <td style={{ padding: `8px 14px 8px ${indent}px`, fontSize: 13, color: color || T.text, fontWeight: bold ? 800 : 500, whiteSpace: "nowrap" }}>{label}</td>
      {cols.map(c => cell(get, c, bold, color))}
    </tr>
  );
  const Banda = ({ label, k }) => (
    <tr style={{ background: T.tableHead, cursor: "pointer" }} onClick={() => toggle(k)}>
      <td colSpan={cols.length + 1} style={{ padding: "7px 14px", fontSize: 11, fontWeight: 800, color: T.tableHeadText, letterSpacing: ".08em", textTransform: "uppercase", userSelect: "none" }}>
        <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{open[k] ? "▼" : "▶"}</span>{label}
      </td>
    </tr>
  );
  // Subgrupo con subtotal colapsable (Cuentas por cobrar / Corriente / Otros pasivos).
  const SubGrupo = ({ label, get, k, detail }) => (<>
    <tr style={{ borderTop: `1px solid ${T.cardBorder}`, background: "#f8fafc", cursor: "pointer" }} onClick={() => toggle(k)}>
      <td style={{ padding: "8px 14px 8px 26px", fontSize: 13, fontWeight: 700, color: T.text, whiteSpace: "nowrap", userSelect: "none" }}>
        <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{open[k] ? "▼" : "▶"}</span>{label}
      </td>
      {cols.map(c => cell(get, c, true))}
    </tr>
    {open[k] && detail.map(d => <Fila key={d.label} label={d.label} get={d.get} indent={44} />)}
  </>);

  return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: minBase + cols.length * colW }}>
        <thead>
          <tr style={{ background: T.tableHead }}>
            <th onClick={toggleAll} style={{ padding: "9px 14px", fontSize: 11, fontWeight: 800, color: T.tableHeadText, textAlign: "left", letterSpacing: ".04em", textTransform: "uppercase", cursor: "pointer", userSelect: "none" }}>
              <span style={{ marginRight: 6, fontSize: 9, opacity: .7 }}>{allOpen ? "▼" : "▶"}</span>Concepto
            </th>
            {cols.map(c => <th key={c} style={th}>{colLabel(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          <Banda label="Activo" k="activo" />
          {open.activo && <>
            <Fila label="Caja" get={caja} />
            <Fila label="Bancos" get={bancos} />
            <SubGrupo label="Cuentas por cobrar" get={cxcTot} k="cxc" detail={details.cxc} />
          </>}
          <Fila label="Total Activo" get={activo} indent={14} bold color="#16a34a" />

          <Banda label="Pasivo" k="pasivo" />
          {open.pasivo && <>
            <SubGrupo label="Cuentas por pagar (corriente)" get={corrTot} k="corr" detail={details.corr} />
            <SubGrupo label="Otros pasivos (financiación, anticipos, socios)" get={otrosTot} k="otros" detail={details.otros} />
          </>}
          <Fila label="Total Pasivo" get={pasivo} indent={14} bold color="#dc2626" />
        </tbody>
        <tfoot>
          <tr style={{ background: "#0e7490", color: "#fff", borderTop: `2px solid ${T.cardBorder}` }}>
            <td style={{ padding: "11px 14px", fontSize: 14, fontWeight: 900 }}>Patrimonio Neto</td>
            {cols.map(c => <td key={c} style={{ padding: "11px 12px", fontSize: 14, textAlign: "right", fontFamily: "var(--mono)", fontWeight: 900 }}>{fmtBal(pn(c))}</td>)}
          </tr>
          {showVariacion && (<>
            <tr style={{ background: "#083344", color: "#fff" }}>
              <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 800 }}>Variación del PN (vs mes anterior)</td>
              {cols.map((c, i) => {
                const v = i === 0 ? null : pn(c) - pn(cols[i - 1]);
                return <td key={c} style={{ padding: "10px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--mono)", fontWeight: 800, color: v == null ? "rgba(255,255,255,.4)" : v < 0 ? "#fca5a5" : "#86efac" }}>{v == null ? "—" : fmtBal(v)}</td>;
              })}
            </tr>
            {ajustes && ajustes.length > 0 && (<>
              {/* Separar los efectos NO económicos (cambio de moneda, anticipos): su Δ mensual, y el neto. */}
              {ajustes.map(aj => (
                <tr key={aj.label} style={{ background: "#0b2a36", color: "#cbd5e1" }}>
                  <td style={{ padding: "8px 14px 8px 26px", fontSize: 12, fontWeight: 600 }}>(−) {aj.label}</td>
                  {cols.map((c, i) => {
                    const e = i === 0 ? null : aj.acum(c) - aj.acum(cols[i - 1]);
                    return <td key={c} style={{ padding: "8px 12px", fontSize: 12, textAlign: "right", fontFamily: "var(--mono)", fontWeight: 600, color: e == null ? "rgba(255,255,255,.3)" : "#cbd5e1" }}>{e == null ? "—" : fmtBal(e)}</td>;
                  })}
                </tr>
              ))}
              <tr style={{ background: "#062a1f", color: "#fff", borderTop: `1px solid rgba(255,255,255,.15)` }}>
                <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 800 }}>{ajusteLabel}</td>
                {cols.map((c, i) => {
                  const v = i === 0 ? null : (pn(c) - pn(cols[i - 1])) - ajustes.reduce((s, aj) => s + (aj.acum(c) - aj.acum(cols[i - 1])), 0);
                  return <td key={c} style={{ padding: "10px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--mono)", fontWeight: 800, color: v == null ? "rgba(255,255,255,.4)" : v < 0 ? "#fca5a5" : "#86efac" }}>{v == null ? "—" : fmtBal(v)}</td>;
                })}
              </tr>
            </>)}
          </>)}
        </tfoot>
      </table>
    </div>
  );
}

// ── Balance (Estado de Situación) a una fecha, en UNA moneda ──
//   · Moneda elegida (ARS/USD/EUR/COP) → el balance nativo de esa moneda (circuito cerrado, como el EEPN).
//   · "Todas" → CONSOLIDADO DEL GRUPO EN USD: cada saldo se traduce al TC del mes de su fecha (nb_tipos_cambio,
//     misma convención que el P&L "USD · TC Real"). Sin TC de un mes/moneda → se avisa y esa parte no se suma.
//   · Columnas: cierre del mes anterior · fecha de corte · variación (misma historia que el EEPN).
//   · Debajo del PN, su explicación: PN apertura (30/6) + resultado acumulado (P&L, buildDevengado) − cambio de
//     moneda = PN explicado; la diferencia con el PN real es lo que queda sin explicar (el "puente" hecho reporte).
// Decisión Martín 19/9/2026 ("las monedas por columna me hacen ruido").
// GO_LIVE_APERTURA, crearTraductor, AvisosTC, ordenarDetalle, _hoyISO/_finMesAnterior/_esFinDeMes: en ./balanceUtils.

function BalanceView({ deriveAsOf, filtroMoneda, fechaCorte, tiposCambio = null, pnl = null, socsIncluidas = [], movimientos = [] }) {
  const corte = fechaCorte || _hoyISO();
  const prev  = _finMesAnterior(corte);
  const consolidado = !filtroMoneda || filtroMoneda === "ALL";
  const mon = consolidado ? "USD" : filtroMoneda;

  const balCorte = useMemo(() => deriveAsOf(corte), [deriveAsOf, corte]);
  const balPrev  = useMemo(() => deriveAsOf(prev),  [deriveAsOf, prev]);
  const balAper  = useMemo(() => deriveAsOf(GO_LIVE_APERTURA), [deriveAsOf]);

  const { aUSD, tcPara, faltaTC, tcSuplente } = crearTraductor(tiposCambio);
  const monedasDe = (bal) => { const st = new Set(); [bal.cuentas, bal.aCobrar, bal.aPagar, bal.intercoAct, bal.intercoPas].forEach(a => a.forEach(it => it.moneda && st.add(it.moneda))); return [...st]; };
  // Suma de una lista para la vista: nativa (una moneda) o consolidada (todas → USD al TC de `fecha`).
  const suma = (items, fecha, pred = () => true) => consolidado
    ? monedasDe({ cuentas: items, aCobrar: [], aPagar: [], intercoAct: [], intercoPas: [] }).reduce((s, mo) => s + aUSD(sumSaldo(items, mo, pred), mo, fecha), 0)
    : sumSaldo(items, mon, pred);

  const COLS = ["prev", "corte", "var"];
  const balDe = { prev: balPrev, corte: balCorte };
  const fechaDe = { prev, corte };
  const g = (fn) => (c) => c === "var" ? fn("corte") - fn("prev") : fn(c);
  const caja   = g(c => suma(balDe[c].cuentas, fechaDe[c], x => (x.tipo || "") === "caja"));
  const bancos = g(c => suma(balDe[c].cuentas, fechaDe[c], x => { const t = (x.tipo || ""); return t !== "caja" && t !== "tarjeta"; }));
  const cxcTot = g(c => suma(balDe[c].aCobrar, fechaDe[c]) + suma(balDe[c].intercoAct, fechaDe[c]));
  const activo = g(c => caja(c) + bancos(c) + cxcTot(c));
  const corrTot  = g(c => suma(balDe[c].aPagar, fechaDe[c], x => esCorriente(x.label)));
  const otrosTot = g(c => suma(balDe[c].aPagar, fechaDe[c], x => !esCorriente(x.label)) + suma(balDe[c].intercoPas, fechaDe[c]));
  const pasivo = g(c => corrTot(c) + otrosTot(c));
  const pn     = g(c => activo(c) - pasivo(c));

  // Detalle: unión de etiquetas presentes en las dos fechas.
  const labels = (arrName, pred = () => true) => [...new Set([...balPrev[arrName], ...balCorte[arrName]].filter(it => pred(it)).map(it => it.label))];
  const porLabel = (arrName, L) => g(c => suma(balDe[c][arrName], fechaDe[c], x => x.label === L));
  const nz = (get) => COLS.some(c => Math.abs(get(c)) > 0.5);
  const details = {
    cxc:   ordenarDetalle([...labels("aCobrar").map(L => ({ label: L, get: porLabel("aCobrar", L) })), { label: "Intercompañía (nos deben)", get: g(c => suma(balDe[c].intercoAct, fechaDe[c])) }].filter(d => nz(d.get))),
    corr:  ordenarDetalle(labels("aPagar", it => esCorriente(it.label)).map(L => ({ label: L, get: porLabel("aPagar", L) })).filter(d => nz(d.get))),
    otros: ordenarDetalle([...labels("aPagar", it => !esCorriente(it.label)).map(L => ({ label: L, get: porLabel("aPagar", L) })), { label: "Intercompañía (les debemos)", get: g(c => suma(balDe[c].intercoPas, fechaDe[c])) }].filter(d => nz(d.get))),
  };

  // ── Conciliación del PN: apertura + resultado acumulado − cambio de moneda = PN explicado ──
  const pnAper = (() => {
    const b = balAper, f = GO_LIVE_APERTURA;
    const act = suma(b.cuentas, f, x => (x.tipo || "") !== "tarjeta") + suma(b.aCobrar, f) + suma(b.intercoAct, f);
    const pas = suma(b.aPagar, f) + suma(b.intercoPas, f);
    return act - pas;
  })();
  const yCorte = +corte.slice(0, 4), mCorte = +corte.slice(5, 7) - 1;   // mes 0-based del corte
  const socSet = useMemo(() => new Set(socsIncluidas.map(s => String(s.id).toLowerCase())), [socsIncluidas]);
  const resultadoAcum = useMemo(() => {
    if (!pnl || yCorte !== 2026) return null;
    const monedasPnL = consolidado ? [...new Set([...(pnl.inRows || []), ...(pnl.egRows || [])].map(r => r.moneda || "ARS"))] : [mon];
    let tot = 0; const porMes = new Array(12).fill(0);
    for (const mo of monedasPnL) {
      const dev = buildDevengado(pnl.inRows || [], pnl.egRows || [], { cuentaMap: pnl.cuentaMap, ccMap: pnl.ccMap, year: yCorte, moneda: mo, socSet, ccSet: null, sinIva: false });
      for (let m = 6; m <= mCorte; m++) {   // julio (go-live) … mes del corte
        const v = dev.resultado[m] || 0;
        const vv = consolidado ? aUSD(v, mo, `${yCorte}-${String(m + 1).padStart(2, "0")}-01`) : v;
        porMes[m] += vv; tot += vv;
      }
    }
    return { tot, porMes };
  }, [pnl, yCorte, mCorte, consolidado, mon, socSet, tiposCambio]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Cambio de moneda: plata movida entre cajas de distinta moneda (origen "cambio"). En una moneda sola es la
  // pata que se ve; consolidado en USD, la diferencia entre las dos patas al TC del mes (costo de cambio).
  const cambioAcum = (() => {
    let acc = 0;
    for (const mv of movimientos || []) {
      if (mv.origen !== "cambio" || !socSet.has(String(mv.sociedad || "").toLowerCase())) continue;
      const f = String(mv.fecha || "").slice(0, 10);
      if (f <= GO_LIVE_APERTURA || f > corte) continue;
      const mo = mv.moneda || "ARS";
      if (consolidado) acc += aUSD(Number(mv.monto) || 0, mo, f);
      else if (mo === mon) acc += Number(mv.monto) || 0;
    }
    return acc;
  })();
  const pnCorte = pn("corte");
  // Identidad (misma que el puente): PN = PN apertura + Resultado + Cambio de moneda (la pata que entra/sale de ESTA
  // moneda no es resultado pero sí mueve su PN) + lo que falte explicar.
  const explicado = resultadoAcum ? pnAper + resultadoAcum.tot + cambioAcum : null;
  const sinExplicar = explicado == null ? null : pnCorte - explicado;

  const tcTxt = (() => {
    if (!consolidado) return null;
    const tc = tcPara(corte);
    if (!tc) return "Sin tipo de cambio cargado para el mes del corte ni los anteriores.";
    const parts = [tc.arsUSD ? `1 USD = ${Math.round(tc.arsUSD).toLocaleString("es-AR")} ARS` : null, tc.eurUSD ? `1 EUR = ${tc.eurUSD.toFixed(2)} USD` : null, tc.copUSD ? `1 USD = ${Math.round(tc.copUSD).toLocaleString("es-AR")} COP` : null].filter(Boolean);
    return `TC usado para el corte (${tc.yearMonth}): ${parts.join(" · ")}. Cada columna usa el TC de su propio mes.`;
  })();
  const colLabel = (c) => c === "prev" ? `Cierre ${fmtDate(prev.slice(0, 8) + String(new Date(+prev.slice(0, 4), +prev.slice(5, 7), 0).getDate()).padStart(2, "0"))}` : c === "corte" ? (fechaCorte ? `Al ${fmtDate(corte)}` : "Hoy") : "Variación";
  const rowS = (bold, color) => ({ padding: "8px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--mono)", fontWeight: bold ? 800 : 500, color: color || T.text, whiteSpace: "nowrap" });

  return (
    <div className="fade">
      <div style={{ fontSize: 12, color: T.muted, margin: "2px 0 12px", lineHeight: 1.5 }}>
        {consolidado
          ? <><b>Consolidado del grupo en USD</b>: cada saldo traducido al tipo de cambio del mes de su fecha. Elegí una moneda arriba para ver el balance nativo de esa moneda.</>
          : <>Balance en <b>{mon}</b>: solo lo que existe en esa moneda (circuito cerrado, como Evolución PN). "Todas" = consolidado del grupo en USD.</>}
        {" "}<b>Activo = Pasivo + Patrimonio Neto</b>; el PN sale por diferencia y abajo se explica.
      </div>
      {tcTxt && <div style={{ fontSize: 11, color: T.muted, marginBottom: 10 }}>{tcTxt}</div>}
      <AvisosTC tcSuplente={tcSuplente} faltaTC={faltaTC} />
      <BalanceTable cols={COLS} colLabel={colLabel} minBase={380} colW={140}
        getters={{ caja, bancos, cxcTot, activo, corrTot, otrosTot, pasivo, pn }} details={details} />

      {/* Conciliación del PN */}
      {resultadoAcum && (
        <div style={{ marginTop: 18, background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 12, overflow: "hidden", boxShadow: T.shadow }}>
          <div style={{ background: T.tableHead, color: T.tableHeadText, padding: "8px 14px", fontSize: 11, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>
            De dónde viene el Patrimonio Neto{fechaCorte ? ` al ${fmtDate(corte)}` : " a hoy"} · {consolidado ? "USD consolidado" : mon}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {[
                ["Patrimonio Neto de apertura (30/06/2026)", pnAper, false],
                [`+ Resultado acumulado julio → ${_MESES[mCorte]} (P&L devengado)`, resultadoAcum.tot, false],
                ["+ Cambio de moneda (plata que entró o salió de esta moneda)", cambioAcum, false],
                ["= Patrimonio Neto explicado", explicado, true],
                ["Patrimonio Neto del balance", pnCorte, true],
                [consolidado ? "Diferencia de conversión + sin explicar" : "Sin explicar", sinExplicar, true, true],
              ].map(([label, val, bold, esResto], i) => (
                <tr key={i} style={{ borderTop: `1px solid ${T.cardBorder}`, background: esResto ? (consolidado ? "#f8fafc" : (Math.abs(val) > 0.5 ? "#fef2f2" : "#f0fdf4")) : "transparent" }}>
                  <td style={{ padding: "8px 14px", fontSize: 13, color: T.text, fontWeight: bold ? 800 : 500 }}>{label}</td>
                  <td style={rowS(bold, esResto && !consolidado ? (Math.abs(val) > 0.5 ? "#dc2626" : "#16a34a") : (val < 0 ? "#dc2626" : T.text))}>{fmtBal(val)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: T.muted, padding: "8px 14px", lineHeight: 1.5 }}>
            {_esFinDeMes(corte) ? null : <>El corte no es fin de mes: el resultado incluye el mes de {_MESES[mCorte]} completo, así que el resto puede mostrar timing dentro del mes. </>}
            {consolidado
              ? <>En USD cada línea está al tipo de cambio de su mes (apertura a junio, resultados a su mes, el PN de hoy al TC del corte), así que el resto incluye la <b>diferencia de conversión</b> por la devaluación de cada moneda. Para la conciliación exacta elegí una moneda arriba.</>
              : <>Lo que queda sin explicar es caja sin imputar, pagos sin comprobante o timing entre sociedades; el detalle está en <b>Control de cierre · devengado</b>.</>}
          </div>
        </div>
      )}
      {!resultadoAcum && (
        <div style={{ fontSize: 11, color: T.muted, marginTop: 8 }}>
          Mismos saldos que la vista <b>Saldos</b>. Cambiá la <b>fecha</b> arriba para ver la foto a otra fecha.
        </div>
      )}
    </div>
  );
}

// ── Evolución del Patrimonio Neto (EEPN), mes a mes: el Balance con MESES en columnas (cada línea a fin de
//    cada mes, hasta el PN) + fila de variación. La variación del PN es el TEST del P&L (debería coincidir
//    con el Resultado del P&L de ese mes/moneda). Una moneda (chip) = circuito cerrado nativo. "Todas" =
//    CONSOLIDADO EN USD mes a mes (mismo criterio que el Balance: cada saldo al TC del cierre de su mes), con
//    una fila extra "Diferencia de conversión" = lo que el PN en USD se movió solo porque cambió el TC entre
//    un cierre y el siguiente (no es negocio). Hasta el 19/9/2026 "Todas" mostraba solo ARS sin decirlo. ──
function EEPNView({ eepn, filtroMoneda, tiposCambio = null }) {
  if (!eepn) return null;
  const { year, GO, upto, balMes, cambioAcum, cxcLabels, corrLabels, otrosLabels } = eepn;
  const consolidado = !filtroMoneda || filtroMoneda === "ALL";
  const mon = consolidado ? "USD" : filtroMoneda;
  const meses = []; for (let m = GO - 1; m <= upto; m++) meses.push(m);   // columna inicial = mes previo al go-live
  const bd = m => balMes[m] || { cuentas: [], aCobrar: [], aPagar: [], intercoAct: [], intercoPas: [] };
  const finDeMes = (m) => `${year}-${String(m + 1).padStart(2, "0")}-31`;
  const { aUSD, faltaTC, tcSuplente } = crearTraductor(tiposCambio);
  const monedasDe = (arrs) => { const st = new Set(); arrs.forEach(a => a.forEach(it => it.moneda && st.add(it.moneda))); return [...st]; };
  // Suma de una lista al cierre del mes m: nativa (una moneda) o consolidada en USD al TC de ese cierre.
  const suma = (arr, m, pred = () => true) => consolidado
    ? monedasDe([arr]).reduce((s, mo) => s + aUSD(sumSaldo(arr, mo, pred), mo, finDeMes(m)), 0)
    : sumSaldo(arr, mon, pred);
  const sumLbl = (arrName, m, L) => suma(bd(m)[arrName], m, it => it.label === L);
  const caja   = m => suma(bd(m).cuentas, m, c => (c.tipo || "") === "caja");
  const bancos = m => suma(bd(m).cuentas, m, c => { const t = (c.tipo || ""); return t !== "caja" && t !== "tarjeta"; });
  const cxcTot = m => suma(bd(m).aCobrar, m) + suma(bd(m).intercoAct, m);
  const corrTot  = m => corrLabels.reduce((s, L) => s + sumLbl("aPagar", m, L), 0);
  const otrosTot = m => otrosLabels.reduce((s, L) => s + sumLbl("aPagar", m, L), 0) + suma(bd(m).intercoPas, m);
  const activo = m => caja(m) + bancos(m) + cxcTot(m);
  const pasivo = m => corrTot(m) + otrosTot(m);
  const pn     = m => activo(m) - pasivo(m);
  const someNZ = get => meses.some(m => Math.abs(get(m)) > 0.5);
  const details = {
    cxc:   ordenarDetalle([...cxcLabels.map(L => ({ label: L, get: m => sumLbl("aCobrar", m, L) })), { label: "Intercompañía (nos deben)", get: m => suma(bd(m).intercoAct, m) }].filter(d => someNZ(d.get))),
    corr:  ordenarDetalle(corrLabels.map(L => ({ label: L, get: m => sumLbl("aPagar", m, L) })).filter(d => someNZ(d.get))),
    otros: ordenarDetalle([...otrosLabels.map(L => ({ label: L, get: m => sumLbl("aPagar", m, L) })), { label: "Intercompañía (les debemos)", get: m => suma(bd(m).intercoPas, m) }].filter(d => someNZ(d.get))),
  };

  // ── Ajustes NO económicos que se separan de la variación del PN (cada uno: efecto acumulado; la tabla muestra
  //    su Δ mensual y lo resta). Convención: `acum(m)` tal que restar su Δ limpia el PN.
  //    · Cambio de moneda: plata movida entre cajas de distinta moneda (origen "cambio"). Nativo: la pata que se ve.
  //      Consolidado: las dos patas al TC del mes (≈ spread/costo de cambio).
  //    · Diferencia de conversión (solo consolidado): PN nativo de cada moneda al cierre anterior, valuado al TC
  //      nuevo menos al TC viejo. Acumulado desde el go-live.
  const cambioAcumUSD = (m) => Object.entries(cambioAcum?.[m] || {}).reduce((s, [mo, v]) => s + aUSD(v, mo, finDeMes(m)), 0);
  const ajustes = [
    // Nativo: la pata del cambio que se ve en esta moneda (ajuste técnico). Consolidado: las dos patas al TC del mes
    // NO dan cero: la diferencia es el TC operado vs el TC maestro = RESULTADO por cambio de moneda, que el P&L todavía
    // no reconoce → se separa para que la variación limpia siga comparable con el P&L (Martín 19/9/2026).
    { label: consolidado ? "Resultado por cambio de moneda (TC operado vs TC maestro)" : "Cambio de moneda", acum: m => consolidado ? cambioAcumUSD(m) : (cambioAcum?.[m]?.[mon] || 0) },
  ];
  if (consolidado) {
    const monedasPN = monedasDe(meses.flatMap(m => [bd(m).cuentas, bd(m).aCobrar, bd(m).aPagar, bd(m).intercoAct, bd(m).intercoPas]));
    const pnNativo = (m, mo) => {
      const b = bd(m), act = sumSaldo(b.cuentas, mo, c => (c.tipo || "") !== "tarjeta") + sumSaldo(b.aCobrar, mo) + sumSaldo(b.intercoAct, mo);
      return act - sumSaldo(b.aPagar, mo) - sumSaldo(b.intercoPas, mo);
    };
    const convMes = (m) => m <= GO - 1 ? 0 : monedasPN.reduce((s, mo) => s + aUSD(pnNativo(m - 1, mo), mo, finDeMes(m)) - aUSD(pnNativo(m - 1, mo), mo, finDeMes(m - 1)), 0);
    const convAcum = {}; let acc = 0;
    for (const m of meses) { acc += convMes(m); convAcum[m] = acc; }
    ajustes.push({ label: "Diferencia de conversión (TC)", acum: m => convAcum[m] || 0 });
  }

  return (
    <div className="fade">
      <div style={{ fontSize: 12, color: T.muted, margin: "2px 0 12px", lineHeight: 1.5 }}>
        {consolidado
          ? <><b>Consolidado del grupo en USD</b>, mes a mes: cada saldo al tipo de cambio del cierre de su mes. La variación se limpia del resultado por cambio de moneda (lo que se ganó o perdió operando a un TC distinto del maestro, línea que el P&L aún no reconoce) y de la diferencia de conversión por TC; lo que queda es comparable con el P&L en "USD · TC Real". Elegí una moneda arriba para el circuito cerrado nativo.</>
          : <>Evolución en <b>{mon}</b>: solo lo que existe en esa moneda. La "Variación sin cambio de moneda" es la que debe coincidir con el Resultado del P&L de ese mes.</>}
      </div>
      <AvisosTC tcSuplente={tcSuplente} faltaTC={faltaTC} />
      <BalanceTable cols={meses} colLabel={m => _MESES[m]} minBase={320} colW={92}
        getters={{ caja, bancos, cxcTot, activo, corrTot, otrosTot, pasivo, pn }} details={details}
        showVariacion ajustes={ajustes} ajusteLabel={consolidado ? "= Variación sin cambio de moneda ni conversión" : "= Variación sin cambio de moneda"} />
    </div>
  );
}
