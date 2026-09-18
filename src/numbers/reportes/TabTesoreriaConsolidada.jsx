// Reportes › Consolidado — la foto de Tesorería sumando VARIAS sociedades.
// Reusa la derivación pura (derivarSaldos, una por sociedad) y los mismos componentes
// de presentación que Tesorería (TabSaldos/TabMovimientos/PaginaAging). Filtro de
// sociedades en la cabecera (arranca con todas). Datos propios (no scopeados a una sociedad).
import { useState, useMemo, useEffect, useRef } from "react";
import { T, fmtDate } from "../theme";
import {
  fetchSociedades,
  fetchMovTesoreria, fetchEgresos, fetchIngresos, fetchPagosCobros,
  fetchCuentasBancarias, fetchCuentas, fetchCentrosCosto,
  fetchFinanciaciones, fetchSocios, fetchSociosCC, fetchIntercoData, intercoLedger, primeCache,
} from "../../lib/numbersApi";
import { fetchLiquidacionesCerradas } from "../../lib/sueldosApi";
import { fetchAll } from "../../lib/sheetsApi";        // Franquicias (read-only)
import { derivarSaldos, franqFirst, intercoConsolidado, sociedadNombreMap } from "../tesoreriaDerive";
import { TabSaldos, TabMovimientos, PaginaAging, PaginaIntercoLedger } from "../PantallaTesoreria";
import { MultiSelect } from "../PantallaReportes";   // filtro de centro (reusado; solo acota CxC/CxP)
import { buildPuente, printPuente } from "./puenteDerive";   // DEV-ONLY diagnóstico (descartable)

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

// Suma el saldo de una lista de items para una moneda (con predicado opcional). Compartido Balance/EEPN.
const sumSaldo = (a, m, pred = () => true) => a.reduce((s, it) => s + ((it.moneda === m && pred(it)) ? (Number(it.saldo) || 0) : 0), 0);
// Clasificación del pasivo: corriente (operativo) vs otros (financiación/anticipos/socios). Compartido.
const esCorriente = l => /proveedor|sueldo|carga|impuesto|interuso|franquic|arancel/i.test(l || "");
// Formato de monto redondeado es-AR (— para cero, − para negativos). Compartido Balance/EEPN.
const fmtBal = (n) => { const v = Math.round(Number(n) || 0); return v === 0 ? "—" : (v < 0 ? "−" : "") + Math.abs(v).toLocaleString("es-AR"); };

export default function TabTesoreriaConsolidada() {
  const [sociedades, setSociedades] = useState([]);
  const [socSel,     setSocSel]     = useState([]);   // [] = todas
  const [socOpen,    setSocOpen]    = useState(false);
  const [activeTab,  setActiveTab]  = useState("saldos");
  const [filtroMoneda, setFiltroMoneda] = useState("ALL");
  const [centroSel,  setCentroSel]  = useState(new Set());   // ids de centro (minúsc.); vacío = todos. Solo acota CxC/CxP.
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
      setLoading(true); setError(null);
      try {
        // Liquidaciones vive en el backend de Sueldos → en paralelo al batch de Numbers.
        const liqsP = fetchLiquidacionesCerradas().catch(() => []);
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
          fetchSociedades().catch(() => []),
          fetchMovTesoreria().catch(() => []),
          fetchEgresos().catch(() => []),
          fetchIngresos().catch(() => []),
          fetchPagosCobros().catch(() => []),
          fetchCuentasBancarias().catch(() => []),
          fetchCuentas().catch(() => []),
          fetchCentrosCosto().catch(() => []),
          fetchFinanciaciones().catch(() => []),
          fetchSocios().catch(() => []),
          fetchSociosCC().catch(() => []),
        ]);
        const liqsS = await liqsP;
        if (cancelled) return;
        const activas = (Array.isArray(socs) ? socs : []).filter(s => {
          const a = s.activo;
          return !(a === false || a === 0 || a === "FALSE" || a === "false" || a === "0" || a === "");
        });
        setSociedades(activas);
        setData(d => ({
          ...d,
          movimientos: arr(movs), egresos: arr(egs), ingresos: arr(ings), pagosCobros: arr(pcs),
          cuentasBancarias: arr(cbList), cuentasContables: arr(ctaList), centrosCosto: arr(ccList),
          liqsSueldos: arr(liqsS), financiaciones: arr(fin), socios: arr(sos), sociosCC: arr(sosCC),
        }));
        // Franquicias (read-only) — fuera del Promise.all para no bloquear el consolidado.
        fetchAll().then(fr => { if (!cancelled && fr && fr.comps) setData(d => ({ ...d, franqData: fr })); }).catch(() => {});
        fetchIntercoData().then(ic => { if (!cancelled && ic) setIntercoData(ic); }).catch(() => {});
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const socsIncluidas = useMemo(
    () => socSel.length === 0 ? sociedades : sociedades.filter(s => socSel.includes(s.id)),
    [sociedades, socSel]
  );

  // Mapa id→nombre de TODAS las sociedades → `derivarSaldos` reconoce cuando el contraparte de un
  // comprobante es otra sociedad (no un cliente) y lo separa como CC comercial entre sociedades
  // (esContraparteSociedad), fuera de los buckets de cliente. Igual que la Tesorería por sociedad.
  const sociedadesMap = useMemo(() => sociedadNombreMap(sociedades), [sociedades]);

  // Opciones de centro para el filtro (agrupadas por sociedad/empresa, igual que el reporte de Devengado
  // para poder comparar con los mismos filtros). El valor es el id en minúsculas (lo que espera derivarSaldos).
  const ccGroups = useMemo(() => {
    const socName = new Map(sociedades.map(s => [String(s.id), s.nombre || String(s.id)]));
    // Cascada: solo los CECOs de las sociedades filtradas (por `empresa` del centro). Los HQ/transversales
    // (sin empresa) siempre entran. Si no hay filtro de sociedad, muestra todos.
    const selIds = new Set(socsIncluidas.map(s => String(s.id)));
    const byEmp = new Map();
    for (const c of (data.centrosCosto || [])) {
      const emp = (c.empresa ?? "").trim();
      if (emp && !selIds.has(emp)) continue;
      if (!byEmp.has(emp)) byEmp.set(emp, []);
      byEmp.get(emp).push({ value: String(c.id ?? "").trim().toLowerCase(), label: c.nombre || c.id });
    }
    return [...byEmp.entries()]
      .map(([emp, items]) => ({ key: emp || "_", label: socName.get(emp) || emp || "Transversal / HQ",
        items: items.sort((a, b) => a.label.localeCompare(b.label)) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data.centrosCosto, sociedades, socsIncluidas]);
  const _ccSel = centroSel.size ? centroSel : null;

  // ── Derivar por sociedad y consolidar ──
  const { cuentas, aCobrar, aPagar, interco, intercoAct, intercoPas, movimientos } = useMemo(() => {
    const idsSel = new Set(socsIncluidas.map(s => (s.id ?? "").toLowerCase()));
    const perSoc = socsIncluidas.map(s => derivarSaldos({ ...data, sociedad: s.id, fechaCorte, sociedadesMap, centroSel: _ccSel }));
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
  }, [data, socsIncluidas, fechaCorte, intercoData, sociedades, sociedadesMap, _ccSel]);

  const monedas = useMemo(() => [...new Set(cuentas.map(c => c.moneda))], [cuentas]);
  // DEV-ONLY (diagnóstico puente P&L→ΔPN, descartable — sacar antes de commitear)
  if (import.meta.env.DEV) { window.__consol = { data, intercoData, sociedades }; window.__buildPuente = buildPuente; window.__printPuente = printPuente; }

  // ── EEPN = el Balance con MESES en columnas: el balance derivado a fin de cada mes, misma estructura de
  //    líneas (caja/bancos/CxC · corriente/otros/PN), para ver cómo se mueve cada cuenta hasta el PN. ──
  const eepn = useMemo(() => {
    if (activeTab !== "evpn") return null;
    const idsSel = socsIncluidas.map(s => s.id);   // set de sociedades (no depende de la fecha)
    const deriveAsOf = (fecha) => {
      const perSoc = socsIncluidas.map(s => derivarSaldos({ ...data, sociedad: s.id, fechaCorte: fecha, sociedadesMap, centroSel: _ccSel }));
      // interco consolidado AS-OF (corta movimientos/comprobantes por la fecha) → evoluciona mes a mes.
      const ic = intercoData ? intercoConsolidado(intercoData, idsSel, sociedades, fecha) : { activo: [], pasivo: [] };
      return {
        cuentas: perSoc.flatMap(r => r.cuentas),
        aCobrar: mergeItems(perSoc.map(r => r.aCobrar)),
        aPagar:  mergeItems(perSoc.map(r => r.aPagar)),
        intercoAct: ic.activo, intercoPas: ic.pasivo,
      };
    };
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
      const hasta = finDeMes(m); const acc = { ARS: 0, USD: 0, EUR: 0 };
      for (const mv of cambios) if ((mv.fecha ?? "") <= hasta) { const c = mv.moneda || "ARS"; if (c in acc) acc[c] += Number(mv.monto) || 0; }
      cambioAcum[m] = acc;
    }
    // Etiquetas presentes (unión de todos los meses) para armar las filas de detalle.
    const uniq = (getArr, filt = () => true) => { const s = new Set(); for (let m = GO - 1; m <= upto; m++) getArr(balMes[m]).forEach(it => filt(it) && s.add(it.label)); return [...s]; };
    const cxcLabels  = uniq(b => b.aCobrar);
    const corrLabels = uniq(b => b.aPagar, it => esCorriente(it.label));
    const otrosLabels = uniq(b => b.aPagar, it => !esCorriente(it.label));
    return { year, GO, upto, balMes, cambioAcum, cxcLabels, corrLabels, otrosLabels };
  }, [activeTab, data, socsIncluidas, intercoData, sociedades, sociedadesMap, _ccSel]);

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
        onGoToMov={e => { setDrillDownItem(null); setFiltroCuenta(null); setFiltroRef(e?.ref || null); setActiveTab("movimientos"); }} />;
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
  ];
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

        <div style={{ width: 1, height: 24, background: T.cardBorder, flexShrink: 0 }} />

        {/* Centro de costo — SOLO acota CxC/CxP (caja/bancos/interco/fin no tienen centro). Para comparar
            el balance con el reporte de Devengado usando el mismo perímetro de centros. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em" }}>Centro</span>
          <MultiSelect groups={ccGroups} selected={centroSel} onChange={setCentroSel} searchable allLabel="Todos" width={200} />
          {centroSel.size > 0 && (
            <span title="El filtro de centro solo afecta CxC/CxP; caja/bancos/interco/financiaciones no tienen centro."
              style={{ fontSize: 15, color: T.muted, cursor: "help" }} aria-hidden>ⓘ</span>
          )}
        </div>

        {/* Fecha corte — solo Saldos/Balance (el EEPN es mensual, no usa corte) */}
        {activeTab !== "evpn" && (
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
        <BalanceView cuentas={cuentas} aCobrar={aCobrar} aPagar={aPagar}
          intercoAct={intercoAct} intercoPas={intercoPas} filtroMoneda={filtroMoneda} fechaCorte={fechaCorte} />
      )}
      {!loading && !error && activeTab === "evpn" && (
        <EEPNView eepn={eepn} filtroMoneda={filtroMoneda} />
      )}
      {!loading && !error && activeTab === "movimientos" && (
        <TabMovimientos movimientos={movimientos} cuentas={cuentas} filtroCuenta={filtroCuenta} filtroRef={filtroRef}
          onLimpiarFiltro={() => { setFiltroCuenta(null); setFiltroRef(null); }} centrosCosto={data.centrosCosto} />
      )}
    </div>
  );
}

const arr = x => Array.isArray(x) ? x : [];

const _MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

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

// ── Balance (Estado de Situación): Activo / Pasivo / PN por moneda, a partir de los saldos derivados
//    (mismas `cuentas/aCobrar/aPagar/interco` que la vista Saldos). PN = Activo − Pasivo (residual). ──
function BalanceView({ cuentas = [], aCobrar = [], aPagar = [], intercoAct = [], intercoPas = [], filtroMoneda, fechaCorte }) {
  const ALLMONS = ["ARS", "USD", "EUR", "COP"];
  const present = new Set();
  [cuentas, aCobrar, aPagar, intercoAct, intercoPas].forEach(a => a.forEach(it => it.moneda && present.add(it.moneda)));
  let mons = ALLMONS.filter(m => present.has(m));
  if (filtroMoneda && filtroMoneda !== "ALL") mons = mons.filter(m => m === filtroMoneda);
  if (mons.length === 0) mons = ["ARS"];

  const groupByLabel = (a) => {
    const map = new Map();
    for (const it of a) { if (!map.has(it.label)) map.set(it.label, {}); const r = map.get(it.label); r[it.moneda] = (r[it.moneda] || 0) + (Number(it.saldo) || 0); }
    return [...map.entries()].map(([label, byMon]) => ({ label, byMon }));
  };
  // Activo: Caja / Bancos / Cuentas por cobrar (CxC + interco nos-deben).
  const caja   = m => sumSaldo(cuentas, m, c => (c.tipo || "") === "caja");
  const bancos = m => sumSaldo(cuentas, m, c => { const t = (c.tipo || ""); return t !== "caja" && t !== "tarjeta"; });
  const cxcTot = m => sumSaldo(aCobrar, m) + sumSaldo(intercoAct, m);
  const activo = m => caja(m) + bancos(m) + cxcTot(m);
  // Pasivo: Corriente (proveedores/sueldos/cargas/impuestos/interusos/franquicias) vs Otros (financiación,
  // anticipos, tarjetas, socios, interco). El resto que no matchea corriente cae en "otros".
  const cxcRows = groupByLabel(aCobrar), cxpRows = groupByLabel(aPagar);
  const pagCorr  = cxpRows.filter(r => esCorriente(r.label));
  const pagOtros = cxpRows.filter(r => !esCorriente(r.label));
  const sumRows  = (rows, m) => rows.reduce((s, r) => s + (r.byMon[m] || 0), 0);
  const corrTot  = m => sumRows(pagCorr, m);
  const otrosTot = m => sumRows(pagOtros, m) + sumSaldo(intercoPas, m);
  const pasivo   = m => corrTot(m) + otrosTot(m);
  const pn       = m => activo(m) - pasivo(m);
  const hayIntA = intercoAct.some(x => Math.abs(Number(x.saldo) || 0) > 0.5);
  const hayIntP = intercoPas.some(x => Math.abs(Number(x.saldo) || 0) > 0.5);
  const details = {
    cxc:   [...cxcRows.map(r => ({ label: r.label, get: m => r.byMon[m] || 0 })), ...(hayIntA ? [{ label: "Intercompañía (nos deben)", get: m => sumSaldo(intercoAct, m) }] : [])],
    corr:  pagCorr.map(r => ({ label: r.label, get: m => r.byMon[m] || 0 })),
    otros: [...pagOtros.map(r => ({ label: r.label, get: m => r.byMon[m] || 0 })), ...(hayIntP ? [{ label: "Intercompañía (les debemos)", get: m => sumSaldo(intercoPas, m) }] : [])],
  };

  return (
    <div className="fade">
      <div style={{ fontSize: 12, color: T.muted, margin: "2px 0 12px" }}>
        Foto patrimonial {fechaCorte ? `al ${fmtDate(fechaCorte)}` : "a hoy"}: <b>Activo = Pasivo + Patrimonio Neto</b>. El PN sale por diferencia (Activo − Pasivo).
      </div>
      <BalanceTable cols={mons} colLabel={m => m} minBase={380} colW={120}
        getters={{ caja, bancos, cxcTot, activo, corrTot, otrosTot, pasivo, pn }} details={details} />
      <div style={{ fontSize: 11, color: T.muted, marginTop: 8 }}>
        Mismos saldos que la vista <b>Saldos</b>. Cambiá la <b>fecha</b> arriba para ver la foto a otra fecha (base del próximo paso: la variación del PN entre dos fechas).
      </div>
    </div>
  );
}

// ── Evolución del Patrimonio Neto (EEPN), mes a mes: el Balance con MESES en columnas (cada línea a fin de
//    cada mes, hasta el PN) + fila de variación. La variación del PN es el TEST del P&L (debería coincidir
//    con el Resultado del P&L de ese mes/moneda). Moneda elegida en el filtro. ──
function EEPNView({ eepn, filtroMoneda }) {
  if (!eepn) return null;
  const { GO, upto, balMes, cambioAcum, cxcLabels, corrLabels, otrosLabels } = eepn;
  const mon = (filtroMoneda && filtroMoneda !== "ALL") ? filtroMoneda : "ARS";
  const meses = []; for (let m = GO - 1; m <= upto; m++) meses.push(m);   // columna inicial = mes previo al go-live
  const bd = m => balMes[m] || { cuentas: [], aCobrar: [], aPagar: [], intercoAct: [], intercoPas: [] };
  const sumLbl = (arrName, m, L) => sumSaldo(bd(m)[arrName], mon, it => it.label === L);
  const caja   = m => sumSaldo(bd(m).cuentas, mon, c => (c.tipo || "") === "caja");
  const bancos = m => sumSaldo(bd(m).cuentas, mon, c => { const t = (c.tipo || ""); return t !== "caja" && t !== "tarjeta"; });
  const cxcTot = m => sumSaldo(bd(m).aCobrar, mon) + sumSaldo(bd(m).intercoAct, mon);
  const corrTot  = m => corrLabels.reduce((s, L) => s + sumLbl("aPagar", m, L), 0);
  const otrosTot = m => otrosLabels.reduce((s, L) => s + sumLbl("aPagar", m, L), 0) + sumSaldo(bd(m).intercoPas, mon);
  const activo = m => caja(m) + bancos(m) + cxcTot(m);
  const pasivo = m => corrTot(m) + otrosTot(m);
  const pn     = m => activo(m) - pasivo(m);
  const someNZ = get => meses.some(m => Math.abs(get(m)) > 0.5);
  const details = {
    cxc:   [...cxcLabels.map(L => ({ label: L, get: m => sumLbl("aCobrar", m, L) })), { label: "Intercompañía (nos deben)", get: m => sumSaldo(bd(m).intercoAct, mon) }].filter(d => someNZ(d.get)),
    corr:  corrLabels.map(L => ({ label: L, get: m => sumLbl("aPagar", m, L) })).filter(d => someNZ(d.get)),
    otros: [...otrosLabels.map(L => ({ label: L, get: m => sumLbl("aPagar", m, L) })), { label: "Intercompañía (les debemos)", get: m => sumSaldo(bd(m).intercoPas, mon) }].filter(d => someNZ(d.get)),
  };

  // ── Ajustes NO económicos que se separan de la variación del PN (cada uno: efecto acumulado en `mon`;
  //    la tabla muestra su Δ mensual y lo resta). Convención: `acum(m)` tal que restar su Δ limpia el PN.
  //    · Cambio de moneda: plata movida entre cajas (USD↔ARS) → acum = neto de cambios a fin de mes.
  //    (Anticipos: con carga correcta —apertura al go-live + consumo matcheado a la factura— cada leg del
  //     anticipo es PN-neutro, así que NO distorsiona la variación → no se ajusta.)
  const ajustes = [
    { label: "Cambio de moneda", acum: m => (cambioAcum?.[m]?.[mon] || 0) },
  ];

  return (
    <div className="fade">
      <BalanceTable cols={meses} colLabel={m => _MESES[m]} minBase={320} colW={92}
        getters={{ caja, bancos, cxcTot, activo, corrTot, otrosTot, pasivo, pn }} details={details}
        showVariacion ajustes={ajustes} ajusteLabel="= Variación sin cambio de moneda" />
    </div>
  );
}
