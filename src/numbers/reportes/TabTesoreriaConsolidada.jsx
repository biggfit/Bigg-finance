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
  fetchFinanciaciones, fetchSocios, fetchParticipaciones, fetchSociosCC, fetchIntercoData, intercoLedger, primeCache,
  esCuentaCredito,
} from "../../lib/numbersApi";
import { fetchLiquidacionesCerradas } from "../../lib/sueldosApi";
import { tolerante } from "../../lib/http";
import { fetchAll } from "../../lib/sheetsApi";        // Franquicias (read-only)
import { derivarSaldos, franqFirst, intercoConsolidado, sociedadNombreMap } from "../tesoreriaDerive";
import { TabSaldos, TabMovimientos, PaginaAging, PaginaIntercoLedger } from "../PantallaTesoreria";
import { buildPuente, printPuente } from "./puenteDerive";   // DEV-ONLY diagnóstico (descartable)
import { GO_LIVE_APERTURA, MESES_CORTOS as _MESES, esCorriente, fmtBal, crearTraductor, crearSumador, AvisosTC, ordenarDetalle, participacionesAsOf,
  hoyISO as _hoyISO, finMesAnteriorReal as _finMesAnteriorReal } from "./balanceUtils";
import { finDeMes } from "./mesesUtils";
import { computeCashFlow } from "./cashflowDerive";
import { CajaView } from "./CajaView";
import { PatrimonioView } from "./PatrimonioView";
import { PosicionFinancieraView } from "./PosicionFinancieraView";
import { cesionesDe, cesionesSociedadDe, provisionCesionRows } from "./cesionDerive";   // provisiones derivadas del P&L (T4 tanda C / T5)

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

// esCorriente / fmtBal / crearTraductor / crearSumador / AvisosTC: en ./balanceUtils (compartidos con CajaView / PosicionFinancieraView).

// `pnl` = { inRows, egRows, cuentaMap, ccMap } del P&L (lo pasa PantallaReportes, memoizado) → provisión de la cesión
// (Balance/Posición) y resultado contable (Del resultado al patrimonio). `tiposCambio` = mapa YYYY-MM → tasas
// (nb_tipos_cambio) → consolidado en USD con "Todas".
// Vistas del componente. El menú de Reportes lo monta varias veces, cada pantalla con su recorte (`vistas`):
//  · "Tesorería consolidada" (operar el día a día) = saldos + movimientos: ¿cuánta plata hay hoy y dónde?
//  · "Balance" = balance: qué tiene y qué debe cada sociedad al cierre de cada mes (Evolución mensual / Mensual).
//  · "Del resultado al patrimonio" (Control de cierre) = evpn: por qué cambió el patrimonio cada mes, en pocas líneas
//    (PatrimonioView). Usa los MISMOS cierres mensuales que el Balance.
// Comparten motor, carga y filtros; por eso es un solo componente y no varios.
//  · "Cash Flow" = cf: la Caja en pocas líneas (CajaView, Martín 5/11/2026). La vista indirecta "Del resultado a la caja"
//    se retiró: lo que explicaba (sin explicar, control cruzado) pasa a "Del resultado al patrimonio".
//  · "Posición financiera" (reporte propio, Martín 24/9) = posicion: disponible − deuda financiera = posición financiera
//    neta; + CxC − CxP = posición neta (≡ PN). Abre en el último cierre de mes.
const VISTAS_TODAS = ["saldos", "balance", "evpn", "movimientos", "cf", "posicion"];
const VISTAS_MENSUALES = new Set(["balance", "evpn"]);          // se arman con los cierres de cada mes (eepn)
const VISTAS_SIN_FECHA = new Set(["balance", "evpn", "cf"]);    // mensuales: el selector de fecha de corte no aplica

// `socInicial`: "nucleo" → arranca con las sociedades del núcleo tildadas (el Cash Flow se mira así); null → todas.
// `monedaInicial`: moneda con la que abre ("ALL" = consolidado USD). El Cash Flow abre en ARS (Martín 19/9: la historia
// de la caja del núcleo —la operación consume pesos y se sostiene vendiendo USD— solo se ve en la moneda nativa).
// `fechaInicial`: fecha de corte con la que abre ("" = hoy). `contentRef`: ref del padre que envuelve SOLO el contenido de
// la vista (para la foto "Copiar imagen", sin toolbar ni pestañas). `onMeta`: avisa al padre vista/fecha/moneda (caption).
export default function TabTesoreriaConsolidada({ pnl = null, tiposCambio = null, vistas = null, socInicial = null, monedaInicial = "ALL",
  fechaInicial = "", contentRef = null, onMeta = null } = {}) {
  const vistasOn = Array.isArray(vistas) && vistas.length ? vistas : VISTAS_TODAS;
  const [sociedades, setSociedades] = useState([]);
  const [socSel,     setSocSel]     = useState([]);   // [] = todas
  const [socOpen,    setSocOpen]    = useState(false);
  const [activeTab,  setActiveTab]  = useState(vistasOn[0]);
  const [vistaBalance, setVistaBalance] = useState("evolucion");   // Balance: "evolucion" | "mensual" (molde del P&L)
  const [mesBalance,   setMesBalance]   = useState(null);          // mes de la vista Mensual (null = último cierre)
  const [filtroMoneda, setFiltroMoneda] = useState(monedaInicial || "ALL");
  const [fechaCorte,   setFechaCorte]   = useState(fechaInicial || "");
  const [filtroCuenta, setFiltroCuenta] = useState(null);
  const [filtroRef,    setFiltroRef]    = useState(null);   // "ir al movimiento" desde el extracto interco
  const [drillDownItem, setDrillDownItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const [data, setData] = useState({
    movimientos: [], egresos: [], ingresos: [], pagosCobros: [],
    cuentasBancarias: [], cuentasContables: [], centrosCosto: [],
    liqsSueldos: [], financiaciones: [], socios: [], sociosCC: [], participaciones: [],
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
      const tol = tolerante(fallas);
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
        const [socs, movs, egs, ings, pcs, cbList, ctaList, ccList, fin, sos, sosCC, partic] = await Promise.all([
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
          tol("participaciones",         fetchParticipaciones()),   // nb_socios crudo: aportes entre sociedades del grupo
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
          liqsSueldos: arr(liqsS), financiaciones: arr(fin), socios: arr(sos), sociosCC: arr(sosCC), participaciones: arr(partic),
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


  // ── Caché de derivarSaldos por (sociedad, fecha): la derivación de UNA sociedad no depende del set elegido ni de las
  //    otras fechas → togglear sociedades, cambiar moneda o de vista no recalcula lo ya derivado; Saldos, Balance, EEPN
  //    y Posición financiera comparten la misma derivación. Se vacía al cambiar los datos. Regla: NADIE muta lo
  //    cacheado (mergeItems copia los items; el sufijo _soc copia las cuentas). ──
  // Provisión de la cesión (Barrio Norte 49 %), derivada del P&L (`pnl` = filas en ARS con histórico): filas virtuales
  // de nb_socios_cc que se suman a la CC real → pasivo "Socios (les debemos)" de Hektor en Balance/Posición y fila
  // "Dividendos declarados" en Del resultado al patrimonio. Sin `pnl` (Tesorería sola) no hay provisión.
  const provisiones = useMemo(() => pnl
    ? provisionCesionRows({ cesiones: cesionesDe(data.participaciones, data.centrosCosto), cesionesSoc: cesionesSociedadDe(data.participaciones, sociedades),
        inRows: pnl.inRows || [], egRows: pnl.egRows || [], year: new Date().getFullYear(), ccs: data.centrosCosto, tiposCambio })
    : [], [pnl, data.participaciones, data.centrosCosto, sociedades, tiposCambio]);
  const dataDeriv = useMemo(() => provisiones.length ? { ...data, sociosCC: [...(data.sociosCC || []), ...provisiones] } : data, [data, provisiones]);
  const derivCache = useMemo(() => new Map(), [dataDeriv, sociedadesMap]);
  const derivarSocAsOf = useCallback((socId, fecha) => {
    const k = `${socId}||${fecha || ""}`;
    let r = derivCache.get(k);
    if (!r) { r = derivarSaldos({ ...dataDeriv, sociedad: socId, fechaCorte: fecha, sociedadesMap }); derivCache.set(k, r); }
    return r;
  }, [derivCache, dataDeriv, sociedadesMap]);

  // ── Derivar por sociedad y consolidar ──
  const { cuentas, aCobrar, aPagar, interco, intercoAct, intercoPas, movimientos } = useMemo(() => {
    const idsSel = new Set(socsIncluidas.map(s => (s.id ?? "").toLowerCase()));
    const perSoc = socsIncluidas.map(s => derivarSocAsOf(s.id, fechaCorte));
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
  }, [data, socsIncluidas, fechaCorte, intercoData, sociedades, derivarSocAsOf]);

  const monedas = useMemo(() => [...new Set(cuentas.map(c => c.moneda))], [cuentas]);
  // DEV-ONLY (diagnóstico puente P&L→ΔPN, descartable — sacar antes de commitear)
  if (import.meta.env.DEV) { window.__consol = { data, intercoData, sociedades }; window.__buildPuente = buildPuente; window.__printPuente = printPuente; }

  // ── EEPN = el Balance con MESES en columnas: el balance derivado a fin de cada mes, misma estructura de
  //    líneas (caja/bancos/CxC · corriente/otros/PN), para ver cómo se mueve cada cuenta hasta el PN. ──
  // Balance derivado A UNA FECHA (as-of) para el set de sociedades elegido: lo usan el Balance (corte, cierre
  // anterior, apertura) y el EEPN (fin de cada mes). Interco consolidado también as-of.
  // Devuelve además `porSociedad` (Map id → derivación de esa sociedad) → la Posición financiera abre por sociedad.
  // `participaciones` = lo aportado por una sociedad del set a otra del grupo que NO está en el set (activo de la
  // inversora; con las dos adentro se elimina). Por sociedad, cada una mirada sola (la invertida nunca es ella misma).
  const deriveAsOf = useCallback((fecha) => {
    const idsSel = socsIncluidas.map(s => s.id);
    const porSociedad = new Map(socsIncluidas.map(s => [s.id, { ...derivarSocAsOf(s.id, fecha),
      participaciones: participacionesAsOf(data.participaciones, sociedades, [s.id], fecha) }]));
    const perSoc = [...porSociedad.values()];
    const ic = intercoData ? intercoConsolidado(intercoData, idsSel, sociedades, fecha) : { activo: [], pasivo: [] };
    return {
      cuentas: perSoc.flatMap(r => r.cuentas),
      aCobrar: mergeItems(perSoc.map(r => r.aCobrar)),
      aPagar:  mergeItems(perSoc.map(r => r.aPagar)),
      intercoAct: ic.activo, intercoPas: ic.pasivo,
      participaciones: participacionesAsOf(data.participaciones, sociedades, idsSel, fecha),
      porSociedad,
    };
  }, [derivarSocAsOf, socsIncluidas, intercoData, sociedades, data.participaciones]);

  // Avisar al padre qué se está mirando (caption de la foto "Copiar imagen").
  useEffect(() => { onMeta?.({ vista: activeTab, fecha: fechaCorte || _hoyISO(), moneda: filtroMoneda }); }, [onMeta, activeTab, fechaCorte, filtroMoneda]);

  const eepn = useMemo(() => {
    if (!VISTAS_MENSUALES.has(activeTab)) return null;   // Balance mes a mes + Del resultado al patrimonio
    const idsSel = socsIncluidas.map(s => s.id);   // set de sociedades (no depende de la fecha)
    const year = new Date().getFullYear();
    const GO = year === 2026 ? 6 : 0;   // julio go-live (columna inicial = junio)
    const upto = Math.max(GO, new Date().getMonth());
    const balMes = {};
    for (let m = GO - 1; m <= upto; m++) balMes[m] = deriveAsOf(finDeMes(year, m));
    // Efecto de CAMBIO DE MONEDA acumulado a fin de cada mes, por moneda (movimientos origen "cambio").
    // Convertir USD↔ARS mueve plata entre cajas: NO es resultado económico, pero infla/desinfla el PN de
    // la moneda que se mira (la vista ve solo una pata). Se acumula aparte para separarlo de la variación.
    const idsLC = new Set(idsSel.map(x => String(x).toLowerCase()));
    const cambios = (data.movimientos || []).filter(mv => mv.origen === "cambio" && idsLC.has(String(mv.sociedad || "").toLowerCase()));
    const cambioAcum = {};
    for (let m = GO - 1; m <= upto; m++) {
      const hasta = finDeMes(year, m); const acc = { ARS: 0, USD: 0, EUR: 0, COP: 0 };
      for (const mv of cambios) if ((mv.fecha ?? "") <= hasta) { const c = mv.moneda || "ARS"; if (c in acc) acc[c] += Number(mv.monto) || 0; }
      cambioAcum[m] = acc;
    }
    return { year, GO, upto, balMes, cambioAcum };
  }, [activeTab, data, socsIncluidas, intercoData, sociedades, sociedadesMap, deriveAsOf]);

  // Meses que el Balance puede mirar en vista Mensual (julio … mes en curso) y el último cierre, que es el default.
  const balMeses = useMemo(() => {
    if (!eepn) return null;
    const enCurso = new Date().getFullYear() === eepn.year ? new Date().getMonth() : null;
    const elegibles = []; for (let m = eepn.GO; m <= eepn.upto; m++) elegibles.push(m);
    const ultimo = [...elegibles].reverse().find(m => m !== enCurso) ?? elegibles[elegibles.length - 1] ?? eepn.GO - 1;
    return { elegibles, enCurso, ultimo };
  }, [eepn]);
  const mesBalanceEff = balMeses ? ((mesBalance != null && balMeses.elegibles.includes(mesBalance)) ? mesBalance : balMeses.ultimo) : null;

  const socSetLC = useMemo(() => new Set(socsIncluidas.map(s => String(s.id).toLowerCase())), [socsIncluidas]);

  // ── Caja (método directo por naturaleza) sobre las MISMAS cajas y sociedades que el Balance: la
  //    sociedad de un movimiento es la de su CUENTA (como derivarSaldos) → la variación de caja ata con los saldos.
  //    Moneda: la elegida (nativo) o consolidado USD al TC del mes de cada movimiento ("Todas"). ──
  // Comprobantes para la Caja (centro/cuenta del pago y nombre del cliente/proveedor en el detalle): una sola lista estable.
  const docsCaja = useMemo(() => [...data.egresos, ...data.ingresos], [data.egresos, data.ingresos]);
  const cfDirecto = useMemo(() => {
    if (activeTab !== "cf") return null;
    const consolidado = filtroMoneda === "ALL";
    const { aUSD, faltaTC, tcSuplente } = crearTraductor(tiposCambio);
    const fx = consolidado ? (monto, mo, anio, mes) => aUSD(monto, mo, `${anio}-${String(mes).padStart(2, "0")}-01`) : null;
    const cf = computeCashFlow({
      rawMovs: data.movimientos, rawIn: pnl?.inRows || [], rawEg: pnl?.egRows || [], docs: docsCaja,
      ccMap: pnl?.ccMap || new Map(data.centrosCosto.map(c => [String(c.id ?? "").trim().toLowerCase(), c])),
      cuentaMap: pnl?.cuentaMap || null,
      perimetro: new Set(socsIncluidas.map(s => s.id)),
      year: new Date().getFullYear(), moneda: consolidado ? "USD" : filtroMoneda, fx,
      tarjetaIds: new Set(data.cuentasBancarias.filter(esCuentaCredito).map(c => c.id)),
      cuentasBancarias: data.cuentasBancarias,
    });
    return { ...cf, faltaTC, tcSuplente };
  }, [activeTab, filtroMoneda, tiposCambio, data, pnl, socsIncluidas, docsCaja]);

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
    { id: "evpn", label: "Del resultado al patrimonio" },
    { id: "movimientos", label: `Movimientos${movimientos.length ? ` (${movimientos.length})` : ""}` },
    { id: "cf",    label: "Por qué se movió la caja" },
    { id: "posicion", label: "Posición financiera" },
  ].filter(t => vistasOn.includes(t.id));
  const nSel = socSel.length === 0 ? sociedades.length : socSel.length;
  const ultimoCierre = _finMesAnteriorReal(_hoyISO());

  // Pastillas de un grupo de botones (las pestañas de la pantalla y las vistas del Balance comparten el molde).
  const pastillas = (items, activo, onSel, ariaLabel) => (
    <div role="tablist" aria-label={ariaLabel}
      style={{ display: "inline-flex", gap: 2, background: "#f3f4f6", borderRadius: 10, padding: 3 }}>
      {items.map(it => {
        const active = activo === it.id;
        return (
          <button key={it.id} type="button" role="tab" aria-selected={active} onClick={() => onSel(it.id)}
            style={{ background: active ? T.accentDark : "transparent", border: "none", borderRadius: 8,
              color: active ? T.accent : T.muted, fontFamily: T.font, fontSize: 13,
              fontWeight: active ? 800 : 500, padding: "7px 18px", cursor: "pointer", transition: "all .15s" }}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
  const tabsPills = TABS.length > 1 ? pastillas(TABS, activeTab, setActiveTab, "Vista consolidada") : null;
  // Arriba a la derecha: las pestañas de la pantalla o, en el Balance (pantalla de una sola pestaña), su VISTA, como
  // en los P&L (Evolución mensual / Mensual; Martín 10/11/2026).
  const arribaDerecha = tabsPills || (activeTab === "balance" ? pastillas(VISTAS_BALANCE, vistaBalance, setVistaBalance, "Vista del Balance") : null);

  return (
    <div className="fade">
      {/* ── Primera línea (a la altura del título), a la derecha: las pestañas de la pantalla o la vista del Balance.
           Sin nada que elegir no se pinta (no tapa el "← Reportes"). ── */}
      {arribaDerecha && (
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -57, marginBottom: 22 }}>
        {arribaDerecha}
      </div>
      )}

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

        {/* Mes — Balance en vista Mensual: el cierre que se compara contra el del mes anterior. */}
        {activeTab === "balance" && vistaBalance === "mensual" && balMeses && (
          <>
          <div style={{ width: 1, height: 24, background: T.cardBorder, flexShrink: 0 }} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 10, fontWeight: 700, color: T.muted,
            textTransform: "uppercase", letterSpacing: ".08em" }}>
            Mes
            <select value={mesBalanceEff} onChange={e => setMesBalance(Number(e.target.value))}
              style={{ border: `1px solid ${T.cardBorder}`, borderRadius: 8, padding: "6px 10px", fontSize: 12.5, fontFamily: T.font,
                background: "#eceff3", color: T.text, cursor: "pointer", fontWeight: 600 }}>
              {balMeses.elegibles.map(m => <option key={m} value={m}>{_MESES[(m + 12) % 12]}{m === balMeses.enCurso ? " · hoy" : ""}</option>)}
            </select>
          </label>
          </>
        )}

        {/* Fecha corte — solo Saldos/Movimientos/Posición (Balance, Patrimonio y Caja son mensuales, no usan corte) */}
        {!VISTAS_SIN_FECHA.has(activeTab) && (
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
            {fechaCorte && activeTab !== "posicion" && (
              <button type="button" onClick={() => setFechaCorte("")} title="Quitar fecha"
                style={{ background: "transparent", border: "none", color: T.muted, fontSize: 16,
                  cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
            )}
            {/* Posición financiera: atajos "Último cierre" (foto firme) / "Hoy" (provisoria: MP del mes sin asentar). */}
            {activeTab === "posicion" && [["cierre", "Último cierre", ultimoCierre], ["hoy", "Hoy", ""]].map(([k, label, val]) => {
              const on = (fechaCorte || "") === val;
              return (
                <button key={k} type="button" onClick={() => setFechaCorte(val)} style={{
                  background: on ? T.accentDark : "#eceff3", color: on ? T.accent : T.muted,
                  border: `1px solid ${on ? T.accentDark : T.cardBorder}`, borderRadius: 999,
                  padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
                  {label}
                </button>
              );
            })}
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

      {/* Contenido de la vista (lo que entra en la foto "Copiar imagen": sin toolbar ni pestañas). */}
      <div ref={contentRef}>
      {!loading && !error && activeTab === "posicion" && (
        <PosicionFinancieraView deriveAsOf={deriveAsOf} filtroMoneda={filtroMoneda} fechaCorte={fechaCorte}
          tiposCambio={tiposCambio} socsIncluidas={socsIncluidas} sociedades={sociedades} esTodas={socSel.length === 0} />
      )}
      {!loading && !error && activeTab === "saldos" && (
        <TabSaldos cuentas={cuentas} aCobrar={aCobrar} aPagar={aPagar} interco={interco}
          filtroMoneda={filtroMoneda} onCuentaClick={c => { setFiltroCuenta(c.id); setActiveTab("movimientos"); }}
          onItemClick={setDrillDownItem} />
      )}
      {!loading && !error && activeTab === "balance" && (
        <BalanceView eepn={eepn} filtroMoneda={filtroMoneda} tiposCambio={tiposCambio} vista={vistaBalance} mes={mesBalanceEff} mesEnCurso={balMeses?.enCurso ?? null} />
      )}
      {!loading && !error && activeTab === "evpn" && (
        <PatrimonioView eepn={eepn} filtroMoneda={filtroMoneda} tiposCambio={tiposCambio} pnl={pnl} socSet={socSetLC} sociosCC={dataDeriv.sociosCC} participaciones={data.participaciones} />
      )}
      {!loading && !error && activeTab === "cf" && (
        <CajaView cf={cfDirecto} consolidado={filtroMoneda === "ALL"} mon={filtroMoneda} cuentasBancarias={data.cuentasBancarias}
          docs={docsCaja} franquicias={data.franqData.franchises} financiaciones={data.financiaciones} />
      )}
      {!loading && !error && activeTab === "movimientos" && (
        <TabMovimientos movimientos={movimientos} cuentas={cuentas} filtroCuenta={filtroCuenta} filtroRef={filtroRef}
          onLimpiarFiltro={() => { setFiltroCuenta(null); setFiltroRef(null); }} centrosCosto={data.centrosCosto} />
      )}
      </div>
    </div>
  );
}

const arr = x => Array.isArray(x) ? x : [];

// ── Tabla de Balance (Activo / Pasivo / PN). El padre (BalanceView) arma columnas + getters + detalle + formato por
//    columna; la tabla sólo renderiza (bandas colapsables Activo/Pasivo, subgrupos CxC/Corriente/Otros, pie con el PN). ──
function BalanceTable({ cols, colLabel, minBase = 320, colW = 100, getters, details, fmt = (c, v) => fmtBal(v) }) {
  const [open, setOpen] = useState({ activo: true, pasivo: true, cxc: true, corr: true, otros: true });
  const toggle = k => setOpen(o => ({ ...o, [k]: !o[k] }));
  const KEYS = ["activo", "pasivo", "cxc", "corr", "otros"];
  const allOpen = KEYS.every(k => open[k]);
  const toggleAll = () => { const v = !allOpen; setOpen(Object.fromEntries(KEYS.map(k => [k, v]))); };
  const { caja, bancos, cxcTot, partic = null, activo, corrTot, otrosTot, pasivo, pn } = getters;
  const hayPartic = !!partic && cols.some(c => Math.abs(partic(c)) > 0.5);

  const th = { padding: "9px 12px", fontSize: 11, fontWeight: 800, color: T.tableHeadText, textAlign: "right", whiteSpace: "nowrap" };
  const cell = (get, c, bold, color) => <td key={c} style={{ padding: "8px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--mono)", fontWeight: bold ? 800 : 500, color: color || (get(c) < 0 ? "#dc2626" : T.text), whiteSpace: "nowrap" }}>{fmt(c, get(c))}</td>;
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
            {hayPartic && <Fila label="Participaciones en negocios" get={partic} />}
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
            {cols.map(c => <td key={c} style={{ padding: "11px 12px", fontSize: 14, textAlign: "right", fontFamily: "var(--mono)", fontWeight: 900 }}>{fmt(c, pn(c))}</td>)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Balance (Estado de Situación) MES A MES, en UNA moneda (Martín 10/11/2026) ──
//   Dos vistas, con el molde del P&L ("copialo de P&L"):
//   · Evolución mensual: la apertura (30/6) y el cierre de cada mes en columnas; el mes en curso = a hoy.
//   · Mensual: el cierre del mes elegido contra el del mes anterior, con Δ y Var%.
//   Moneda elegida (ARS/USD/EUR/COP) → el balance nativo de esa moneda (circuito cerrado). "Todas" → CONSOLIDADO DEL
//   GRUPO EN USD: cada cierre traducido al TC de su mes (nb_tipos_cambio, misma convención que el P&L "USD · TC Real").
//   Los cierres vienen de `eepn.balMes` (deriveAsOf a fin de cada mes): los MISMOS que usa Del resultado al patrimonio,
//   que es el reporte que explica por qué cambia el PN. Por eso acá ya no va el recuadro "De dónde viene el PN" ni el
//   selector de fecha libre (la foto a un día puntual sigue en Posición financiera). La vista y el mes los maneja el
//   padre: el toggle va arriba a la derecha (como en los P&L) y el mes en la barra.
const VISTAS_BALANCE = [{ id: "evolucion", label: "Evolución mensual" }, { id: "mensual", label: "Mensual" }];
const fmtPct = v => v == null ? "—" : `${v < 0 ? "−" : ""}${Math.abs(v * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;   // mismo signo menos que fmtBal
function BalanceView({ eepn, filtroMoneda, tiposCambio = null, vista = "evolucion", mes = null, mesEnCurso = null }) {
  if (!eepn) return null;
  const { year, GO, upto, balMes } = eepn;
  const consolidado = !filtroMoneda || filtroMoneda === "ALL";
  const mon = consolidado ? "USD" : filtroMoneda;
  const meses = []; for (let m = GO - 1; m <= upto; m++) meses.push(m);   // columnas de Evolución (la 1ª = apertura)
  const M = mes ?? upto;   // mes de la vista Mensual: lo resuelve el padre (balMeses: último cierre por defecto)
  const nombreMes = m => _MESES[(m + 12) % 12];
  const bd = m => balMes[m] || { cuentas: [], aCobrar: [], aPagar: [], intercoAct: [], intercoPas: [], participaciones: [] };

  const { aUSD, faltaTC, tcSuplente } = crearTraductor(tiposCambio);
  // Suma de una lista al cierre del mes m: nativa (una moneda) o consolidada (todas → USD al TC de ese cierre).
  const sumar = crearSumador({ consolidado, mon, aUSD });
  const suma = (items, m, pred) => sumar(items, finDeMes(year, m), pred);

  // Columnas: en Evolución la clave ES el mes; en Mensual son "mes" · "ant" · "delta" · "pct" sobre el mes elegido.
  // `g` convierte una función por mes en un getter por columna (con un mes numérico devuelve el valor de ese mes, así
  // que los totales se componen de sus partes).
  const COLS = vista === "evolucion" ? meses : ["mes", "ant", "delta", "pct"];
  const g = fn => c => {
    if (typeof c === "number") return fn(c);
    const a = fn(M), b = fn(M - 1);
    return c === "mes" ? a : c === "ant" ? b : c === "delta" ? a - b : (Math.abs(b) < 0.5 ? null : (a - b) / Math.abs(b));
  };
  const caja   = g(m => suma(bd(m).cuentas, m, x => (x.tipo || "") === "caja"));
  const bancos = g(m => suma(bd(m).cuentas, m, x => { const t = (x.tipo || ""); return t !== "caja" && t !== "tarjeta"; }));
  const cxcTot = g(m => suma(bd(m).aCobrar, m) + suma(bd(m).intercoAct, m));
  const partic = g(m => suma(bd(m).participaciones || [], m));   // participaciones en negocios (T4 tanda B)
  const activo = g(m => caja(m) + bancos(m) + cxcTot(m) + partic(m));
  const corrTot  = g(m => suma(bd(m).aPagar, m, x => esCorriente(x.label)));
  const otrosTot = g(m => suma(bd(m).aPagar, m, x => !esCorriente(x.label)) + suma(bd(m).intercoPas, m));
  const pasivo = g(m => corrTot(m) + otrosTot(m));
  const pn     = g(m => activo(m) - pasivo(m));

  // Detalle: unión de etiquetas presentes en los meses que se están mirando.
  const mesesVista = vista === "evolucion" ? meses : [M - 1, M];
  const labels = (arrName, pred = () => true) => [...new Set(mesesVista.flatMap(m => bd(m)[arrName] || []).filter(pred).map(it => it.label))];
  const porLabel = (arrName, L) => g(m => suma(bd(m)[arrName] || [], m, x => x.label === L));
  const nz = get => mesesVista.some(m => Math.abs(get(m)) > 0.5);
  const details = {
    cxc:   ordenarDetalle([...labels("aCobrar").map(L => ({ label: L, get: porLabel("aCobrar", L) })), { label: "Intercompañía (nos deben)", get: g(m => suma(bd(m).intercoAct, m)) }].filter(d => nz(d.get))),
    corr:  ordenarDetalle(labels("aPagar", it => esCorriente(it.label)).map(L => ({ label: L, get: porLabel("aPagar", L) })).filter(d => nz(d.get))),
    otros: ordenarDetalle([...labels("aPagar", it => !esCorriente(it.label)).map(L => ({ label: L, get: porLabel("aPagar", L) })), { label: "Intercompañía (les debemos)", get: g(m => suma(bd(m).intercoPas, m)) }].filter(d => nz(d.get))),
  };

  const colLabel = c => typeof c === "number"
    ? (c === GO - 1 ? `${nombreMes(c)} · apertura` : c === mesEnCurso ? `${nombreMes(c)} · hoy` : nombreMes(c))
    : c === "mes" ? (M === mesEnCurso ? `${nombreMes(M)} · hoy` : nombreMes(M)) : c === "ant" ? (M - 1 === GO - 1 ? `${nombreMes(M - 1)} · apertura` : nombreMes(M - 1)) : c === "delta" ? "Δ" : "Var%";
  const fmt = (c, v) => c === "pct" ? fmtPct(v) : fmtBal(v);

  return (
    <div className="fade">
      <div style={{ fontSize: 12, color: T.muted, margin: "-6px 0 12px", lineHeight: 1.5 }}>
        {consolidado
          ? <><b>Consolidado en USD</b>: cada cierre al tipo de cambio de su mes.</>
          : <>Balance en <b>{mon}</b>: solo lo que existe en esa moneda.</>}
      </div>
      <AvisosTC tcSuplente={tcSuplente} faltaTC={faltaTC} />
      <BalanceTable cols={COLS} colLabel={colLabel} minBase={380} colW={vista === "evolucion" ? 118 : 140} fmt={fmt}
        getters={{ caja, bancos, cxcTot, partic, activo, corrTot, otrosTot, pasivo, pn }} details={details} />
    </div>
  );
}
