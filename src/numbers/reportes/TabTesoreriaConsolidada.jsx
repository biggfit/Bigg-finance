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
  fetchFinanciaciones, fetchSocios, fetchSociosCC, fetchIntercoData,
} from "../../lib/numbersApi";
import { fetchLiquidacionesCerradas } from "../../lib/sueldosApi";
import { fetchAll } from "../../lib/sheetsApi";        // Franquicias (read-only)
import { derivarSaldos, franqFirst, intercoConsolidado } from "../tesoreriaDerive";
import { TabSaldos, TabMovimientos, PaginaAging } from "../PantallaTesoreria";

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

export default function TabTesoreriaConsolidada() {
  const [sociedades, setSociedades] = useState([]);
  const [socSel,     setSocSel]     = useState([]);   // [] = todas
  const [socOpen,    setSocOpen]    = useState(false);
  const [activeTab,  setActiveTab]  = useState("saldos");
  const [filtroMoneda, setFiltroMoneda] = useState("ALL");
  const [fechaCorte,   setFechaCorte]   = useState("");
  const [filtroCuenta, setFiltroCuenta] = useState(null);
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
        const [socs, movs, egs, ings, pcs, cbList, ctaList, ccList, liqsS, fin, sos, sosCC] = await Promise.all([
          fetchSociedades().catch(() => []),
          fetchMovTesoreria().catch(() => []),
          fetchEgresos().catch(() => []),
          fetchIngresos().catch(() => []),
          fetchPagosCobros().catch(() => []),
          fetchCuentasBancarias().catch(() => []),
          fetchCuentas().catch(() => []),
          fetchCentrosCosto().catch(() => []),
          fetchLiquidacionesCerradas().catch(() => []),
          fetchFinanciaciones().catch(() => []),
          fetchSocios().catch(() => []),
          fetchSociosCC().catch(() => []),
        ]);
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

  // ── Derivar por sociedad y consolidar ──
  const { cuentas, aCobrar, aPagar, interco, movimientos } = useMemo(() => {
    const idsSel = new Set(socsIncluidas.map(s => (s.id ?? "").toLowerCase()));
    const perSoc = socsIncluidas.map(s => derivarSaldos({ ...data, sociedad: s.id, fechaCorte }));
    // Interco NETEADO a nivel consolidado (núcleo↔núcleo interno se elimina; el resto se muestra).
    const ic = intercoData
      ? intercoConsolidado(intercoData, socsIncluidas.map(s => s.id), sociedades)
      : { activo: [], pasivo: [] };
    return {
      cuentas:  perSoc.flatMap(r => r.cuentas),
      aCobrar:  mergeItems(perSoc.map(r => r.aCobrar)),
      aPagar:   mergeItems(perSoc.map(r => r.aPagar)),
      interco:  [...ic.activo, ...ic.pasivo],   // bloque propio abajo de Inversiones
      movimientos: data.movimientos.filter(m => idsSel.has((m.sociedad ?? "").toLowerCase())),
    };
  }, [data, socsIncluidas, fechaCorte, intercoData, sociedades]);

  const monedas = useMemo(() => [...new Set(cuentas.map(c => c.moneda))], [cuentas]);

  const toggleSoc = id => setSocSel(prev => {
    const full = prev.length === 0 ? sociedades.map(s => s.id) : prev;
    const next = full.includes(id) ? full.filter(x => x !== id) : [...full, id];
    return next.length === sociedades.length ? [] : next;   // todas → []
  });

  if (drillDownItem) {
    return (
      <PaginaAging item={drillDownItem} fechaCorte={fechaCorte}
        headerColor={drillDownItem.headerColor ?? "#374151"} onBack={() => setDrillDownItem(null)} />
    );
  }

  const TABS = [
    { id: "saldos", label: "Saldos" },
    { id: "movimientos", label: `Movimientos${movimientos.length ? ` (${movimientos.length})` : ""}` },
  ];
  const nSel = socSel.length === 0 ? sociedades.length : socSel.length;

  return (
    <div className="fade">
      {/* ── Toolbar: sociedades + tabs + moneda + fecha ── */}
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
              {sociedades.map(s => {
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
          )}
        </div>

        <div style={{ width: 1, height: 24, background: T.cardBorder, flexShrink: 0 }} />

        {/* Tabs Saldos / Movimientos */}
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

        {/* Fecha corte */}
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
      {!loading && !error && activeTab === "movimientos" && (
        <TabMovimientos movimientos={movimientos} cuentas={cuentas} filtroCuenta={filtroCuenta}
          onLimpiarFiltro={() => setFiltroCuenta(null)} centrosCosto={data.centrosCosto} />
      )}
    </div>
  );
}

const arr = x => Array.isArray(x) ? x : [];
