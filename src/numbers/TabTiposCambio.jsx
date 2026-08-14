// ─── Maestros › Tipos de Cambio ───────────────────────────────────────────────
// Maestro ÚNICO del TC del grupo (hoja nb_tipos_cambio): una fila por mes, tasas
// contra USD. Se edita ACÁ y lo consumen los dos lados — el consolidado en USD de
// Numbers y Franquicias (fee en USD + facturación en moneda local). Antes vivía en
// el maestro de Franquicias; se movió para que no hubiera dos fuentes del mismo dato.
//
// Convención de valor: unidades de moneda local por 1 USD (arsUSD 1560 = 1560 ARS/U$D).
import { useState, useEffect, useMemo, useRef } from "react";
import { T, Btn } from "./theme";
import { fetchTiposCambio, saveTipoCambio, TC_FIELDS } from "../lib/numbersApi";

const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// Grilla de carga. El orden de acá es el que ve el usuario; el de la hoja no importa
// (todo se lee/escribe por nombre de header).
const CAMPOS = [
  { key:"arsUSD", label:"ARS / U$D", placeholder:"ej. 1560",  step:"1"      },
  { key:"eurUSD", label:"€ / U$D",   placeholder:"ej. 1.15",  step:"0.0001" },
  { key:"copUSD", label:"COP / U$D", placeholder:"ej. 3450",  step:"1"      },
  { key:"uyuUSD", label:"UYU / U$D", placeholder:"ej. 40",    step:"0.01"   },
  { key:"pygUSD", label:"PYG / U$D", placeholder:"ej. 5950",  step:"1"      },
  { key:"clpUSD", label:"CLP / U$D", placeholder:"ej. 925",   step:"1"      },
  { key:"penUSD", label:"PEN / U$D", placeholder:"ej. 3.39",  step:"0.0001" },
];

const ymDe    = (year, monthIdx) => `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
const cargados = (tc) => TC_FIELDS.filter(f => Number(tc?.[f]) > 0).length;

export default function TabTiposCambio() {
  const [tiposCambio, setTiposCambio] = useState({});
  const [loading,     setLoading]     = useState(true);
  const [bufs,        setBufs]        = useState({});          // { ym: { campo: string } } — solo meses tocados
  const [year,        setYear]        = useState(() => new Date().getFullYear());
  const [mesSel,      setMesSel]      = useState(() => new Date().getMonth());
  const [fetching,    setFetching]    = useState(false);
  const [guardando,   setGuardando]   = useState(false);
  const [toast,       setToast]       = useState(null);
  const toastTimer = useRef(null);

  const avisar = (msg, tipo = "ok") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, tipo });
    toastTimer.current = setTimeout(() => setToast(null), tipo === "err" ? 6000 : 3500);
  };
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const recargar = async () => {
    setLoading(true);
    try {
      setTiposCambio(await fetchTiposCambio());
    } catch (e) {
      avisar("Error al cargar los tipos de cambio: " + e.message, "err");
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { recargar(); }, []);   // carga inicial

  // Años a mostrar: los que tienen data + el actual + el próximo. Hardcodearlos (como estaba en
  // Franquicias) esconde los años viejos justo cuando el consolidado los necesita para la evolución.
  const years = useMemo(() => {
    const hoy = new Date().getFullYear();
    const enData = Object.keys(tiposCambio).map(ym => Number(ym.slice(0, 4))).filter(Boolean);
    const desde = Math.min(hoy, ...(enData.length ? enData : [hoy]));
    return Array.from({ length: (hoy + 1) - desde + 1 }, (_, i) => desde + i);
  }, [tiposCambio]);

  const selYm = ymDe(year, mesSel);
  const dirty = bufs[selYm] !== undefined;

  const getBuf = (ym) => {
    if (bufs[ym] !== undefined) return bufs[ym];
    const guardado = tiposCambio[ym] ?? {};
    return Object.fromEntries(CAMPOS.map(({ key }) =>
      [key, Number(guardado[key]) > 0 ? String(guardado[key]) : ""]));
  };
  const buf = getBuf(selYm);
  const setCampo = (ym, key, val) => setBufs(prev => ({ ...prev, [ym]: { ...getBuf(ym), [key]: val } }));
  const limpiarBuf = (ym) => setBufs(prev => { const n = { ...prev }; delete n[ym]; return n; });

  // Estado de cobertura del mes — lo que le importa al consolidado: no alcanza con que el mes
  // exista, tienen que estar TODAS las monedas. "parcial" es lo que hay que ir a completar.
  const estadoMes = (ym) => {
    const n = cargados(tiposCambio[ym]);
    return n === 0 ? "vacio" : n === TC_FIELDS.length ? "completo" : "parcial";
  };

  // Guardado manual: escribe EXACTO lo que está en los inputs (un campo vacío borra el valor —
  // es intención explícita del usuario). Distinto de "Traer tasas", que nunca borra.
  const guardar = async (ym) => {
    const b = getBuf(ym);
    setGuardando(true);
    try {
      await saveTipoCambio(ym, Object.fromEntries(CAMPOS.map(({ key }) => [key, parseFloat(b[key]) || 0])));
      limpiarBuf(ym);
      await recargar();
      avisar(`TC ${MESES[mesSel]} ${year} guardado`);
    } catch (e) {
      avisar("No se pudo guardar: " + e.message, "err");
    } finally {
      setGuardando(false);
    }
  };

  // ── Traer tasas automáticas ────────────────────────────────────────────────
  // Convención: último día hábil del mes (no el promedio ni el cierre del día de hoy).
  const traerTasas = async () => {
    const month = mesSel;                                   // 0-indexed
    const ym    = ymDe(year, month);

    setFetching(true);
    try {
      const hoy       = new Date();
      const esFuturo  = new Date(year, month + 1, 1) > hoy;
      const startDate = `${ym}-01`;
      const endDate   = esFuturo
        ? hoy.toISOString().slice(0, 10)
        : new Date(year, month + 1, 0).toISOString().slice(0, 10);

      const [blueRes, eurRes, clpRes, dolarapiRes, curApiRes] = await Promise.allSettled([
        // ARS blue — historial completo, se filtra por mes
        fetch("https://api.argentinadatos.com/v1/cotizaciones/dolares/blue").then(r => r.json()),
        // EUR/USD — histórico diario (BCE vía frankfurter)
        esFuturo ? Promise.resolve(null)
                 : fetch(`https://api.frankfurter.dev/v1/${startDate}..${endDate}?from=USD&to=EUR`).then(r => r.json()),
        // CLP/USD — histórico anual (Banco Central de Chile)
        fetch(`https://mindicador.cl/api/dolar/${year}`).then(r => r.json()),
        // Cotizaciones de hoy (fallback general)
        fetch("https://dolarapi.com/v1/cotizaciones").then(r => r.json()),
        // Currency API — cubre COP, UYU, PYG y PEN al día pedido
        fetch(`https://${endDate}.currency-api.pages.dev/v1/currencies/usd.json`).then(r => r.json()),
      ]);

      const cot        = dolarapiRes.status === "fulfilled" ? dolarapiRes.value : [];
      const usdOficial = cot?.find?.(c => c.moneda === "USD")?.venta;
      const uyuArs     = cot?.find?.(c => c.moneda === "UYU")?.venta;
      const eurArs     = cot?.find?.(c => c.moneda === "EUR")?.venta;
      const clpArs     = cot?.find?.(c => c.moneda === "CLP")?.venta;

      // último registro del mes = último día hábil con dato
      const ultimoDelMes = (recs, dateKey = "fecha") =>
        recs.filter(r => r[dateKey]?.startsWith(ym))
            .sort((a, b) => b[dateKey].localeCompare(a[dateKey]))[0] ?? null;

      // ARS blue
      let arsUSD, arsLabel = "cotización de hoy";
      if (blueRes.status === "fulfilled" && Array.isArray(blueRes.value)) {
        const rec = ultimoDelMes(blueRes.value.filter(r => r.venta > 0));
        if (rec) { arsUSD = Math.round(rec.venta); arsLabel = `ult. día hábil (${rec.fecha.slice(0, 10)})`; }
      }
      if (!arsUSD) {
        const b = await fetch("https://dolarapi.com/v1/dolares/blue").then(r => r.json()).catch(() => null);
        arsUSD = b?.venta;
      }

      // EUR/USD (frankfurter da EUR por USD → invertir)
      let eurUSD, eurLabel = "sin dato";
      if (eurRes.status === "fulfilled" && eurRes.value?.rates) {
        const fechas    = Object.keys(eurRes.value.rates).sort((a, b) => b.localeCompare(a));
        const eurPorUsd = eurRes.value.rates[fechas[0]]?.EUR;
        if (eurPorUsd) { eurUSD = (1 / eurPorUsd).toFixed(4); eurLabel = `ult. día hábil (${fechas[0]})`; }
      }
      if (!eurUSD && eurArs && usdOficial) { eurUSD = (eurArs / usdOficial).toFixed(4); eurLabel = "fallback"; }

      // CLP/USD (mindicador da CLP por USD directo)
      let clpUSD, clpLabel = "sin dato";
      if (clpRes.status === "fulfilled" && clpRes.value?.serie) {
        const rec = ultimoDelMes(clpRes.value.serie.filter(r => r.valor > 0), "fecha");
        if (rec) { clpUSD = String(Math.round(rec.valor)); clpLabel = `ult. día hábil (${rec.fecha.slice(0, 10)})`; }
      }
      if (!clpUSD && clpArs && usdOficial) { clpUSD = String(Math.round(usdOficial / clpArs)); clpLabel = "fallback"; }

      // COP / UYU / PYG / PEN — currency-api al último día del mes
      const curData  = curApiRes.status === "fulfilled" ? curApiRes.value?.usd : null;
      const curDate  = curApiRes.status === "fulfilled" ? (curApiRes.value?.date || endDate) : endDate;
      const curLabel = `ult. día hábil (${curDate})`;

      let copUSD, copLabel = "sin dato";
      if (curData?.cop > 0) { copUSD = String(Math.round(curData.cop)); copLabel = curLabel; }

      let uyuUSD, uyuLabel = "sin dato";
      if (curData?.uyu > 0)              { uyuUSD = curData.uyu.toFixed(2); uyuLabel = curLabel; }
      else if (uyuArs && usdOficial)     { uyuUSD = (usdOficial / uyuArs).toFixed(2); uyuLabel = "fallback"; }

      let pygUSD, pygLabel = "sin dato";
      if (curData?.pyg > 0) { pygUSD = String(Math.round(curData.pyg)); pygLabel = curLabel; }

      let penUSD, penLabel = "sin dato";
      if (curData?.pen > 0) { penUSD = curData.pen.toFixed(4); penLabel = curLabel; }

      const traidas = { arsUSD, eurUSD, copUSD, uyuUSD, pygUSD, clpUSD, penUSD };
      const conDato = Object.entries(traidas).filter(([, v]) => parseFloat(v) > 0);
      if (!conDato.length) { avisar("Ninguna API devolvió datos para ese mes", "err"); return; }

      // Se guardan SOLO las monedas que vinieron con dato: si una API falla, el valor que ya
      // estaba cargado queda intacto (antes se escribía 0 y borraba el histórico).
      await saveTipoCambio(ym, Object.fromEntries(conDato.map(([k, v]) => [k, parseFloat(v)])));
      limpiarBuf(ym);
      await recargar();

      const faltan = TC_FIELDS.filter(f => !(parseFloat(traidas[f]) > 0));
      avisar(
        `✓ ${MESES[month]} ${year} — ARS ${arsLabel} · EUR ${eurLabel} · COP ${copLabel} · UYU ${uyuLabel} · ` +
        `PYG ${pygLabel} · CLP ${clpLabel} · PEN ${penLabel}` +
        (faltan.length ? ` — sin dato: ${faltan.join(", ")} (quedaron como estaban)` : ""),
        faltan.length ? "warn" : "ok"
      );
    } catch (e) {
      avisar("Error al traer las tasas: " + e.message, "err");
    } finally {
      setFetching(false);
    }
  };

  // ── Cobertura global (lo que mira el consolidado) ──────────────────────────
  const cobertura = useMemo(() => {
    const meses = Object.keys(tiposCambio).sort();
    const incompletos = meses.filter(ym => estadoMes(ym) === "parcial");
    return { n: meses.length, desde: meses[0], hasta: meses[meses.length - 1], incompletos };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiposCambio]);

  const guardadoSel = tiposCambio[selYm];

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"auto", minHeight:0 }}>
      {/* Cobertura */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
        marginBottom:16, gap:12, flexShrink:0, flexWrap:"wrap" }}>
        <div style={{ fontSize:12, color:T.muted }}>
          {loading ? "Cargando…" : cobertura.n === 0 ? "Sin meses cargados" : (
            <>
              <b style={{ color:T.text }}>{cobertura.n} meses</b> cargados · {cobertura.desde} → {cobertura.hasta}
              {cobertura.incompletos.length > 0 && (
                <span style={{ color:T.orange, fontWeight:600 }}>
                  {" "}· {cobertura.incompletos.length} incompleto(s): {cobertura.incompletos.join(", ")}
                </span>
              )}
            </>
          )}
        </div>
        <div style={{ fontSize:11, color:T.dim }}>
          Maestro único del grupo — lo leen el consolidado en USD y Franquicias
        </div>
      </div>

      {/* Selector de año */}
      <div style={{ display:"flex", gap:6, marginBottom:12, flexShrink:0 }}>
        {years.map(y => (
          <button key={y} onClick={() => setYear(y)} style={{
            padding:"5px 16px", borderRadius:999, fontSize:12, fontWeight:700, cursor:"pointer",
            fontFamily:T.font,
            background: year === y ? T.accent : T.card,
            color:      year === y ? T.accentDark : T.muted,
            border:     year === y ? "none" : `1px solid ${T.cardBorder}`,
          }}>{y}</button>
        ))}
      </div>

      {/* Grilla de meses */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:6, marginBottom:18, flexShrink:0 }}>
        {MESES.map((lbl, idx) => {
          const ym     = ymDe(year, idx);
          const estado = estadoMes(ym);
          const sel    = mesSel === idx;
          const tocado = bufs[ym] !== undefined;
          const fondo  = sel ? T.accent
                       : estado === "completo" ? "rgba(22,163,74,.10)"
                       : estado === "parcial"  ? T.orangeBg
                       : T.card;
          const color  = sel ? T.accentDark
                       : estado === "completo" ? T.green
                       : estado === "parcial"  ? T.orange
                       : T.dim;
          return (
            <button key={idx} onClick={() => setMesSel(idx)} style={{
              padding:"9px 0", borderRadius:8, fontSize:12, cursor:"pointer", textAlign:"center",
              fontFamily:T.font, fontWeight: sel || estado !== "vacio" ? 700 : 400,
              background: fondo, color,
              border: sel ? "none" : `1px solid ${estado === "vacio" ? T.cardBorder : "transparent"}`,
            }}>
              {lbl}
              {!sel && (
                <div style={{ fontSize:9, marginTop:1, opacity:.8 }}>
                  {tocado ? "●" : estado === "completo" ? "✓" : estado === "parcial" ? `${cargados(tiposCambio[ym])}/${TC_FIELDS.length}` : " "}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Formulario del mes seleccionado */}
      <div style={{ background:T.card, border:`1px solid ${dirty ? T.accent : T.cardBorder}`,
        borderRadius:T.radius, padding:18, boxShadow:T.shadow, flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          marginBottom:16, gap:12, flexWrap:"wrap" }}>
          <div style={{ fontSize:14, fontWeight:800, color:T.text }}>
            {MESES[mesSel]} {year}
            {dirty && <span style={{ fontSize:11, fontWeight:600, color:T.orange, marginLeft:8 }}>● sin guardar</span>}
            {!dirty && guardadoSel && (
              <span style={{ fontSize:11, fontWeight:600, color:T.green, marginLeft:8 }}>
                ✓ guardado ({cargados(guardadoSel)}/{TC_FIELDS.length} monedas)
              </span>
            )}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:10, color:T.dim }}>último día hábil del mes · todas las monedas</span>
            <button onClick={traerTasas} disabled={fetching || guardando} style={{
              fontSize:12, padding:"6px 14px", borderRadius:999, fontFamily:T.font, fontWeight:700,
              cursor: fetching || guardando ? "default" : "pointer",
              background:"transparent", color: fetching ? T.dim : T.text,
              border:`1px solid ${T.cardBorder}`, opacity: fetching || guardando ? .5 : 1,
            }}>
              {fetching ? "Trayendo…" : "↓ Traer tasas"}
            </button>
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:16 }}>
          {CAMPOS.map(({ key, label, placeholder, step }) => (
            <div key={key} style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <label style={{ fontSize:11, color:T.muted, fontWeight:700, letterSpacing:".04em" }}>{label}</label>
              <input type="number" placeholder={placeholder} step={step}
                value={buf[key] ?? ""}
                onChange={e => setCampo(selYm, key, e.target.value)}
                style={{ width:"100%", fontSize:13, padding:"8px 12px", textAlign:"right", boxSizing:"border-box",
                  background:"#eceff3", borderRadius:8, color:T.text, fontFamily:T.mono,
                  border:`1px solid ${dirty ? T.accent : T.cardBorder}`, outline:"none" }} />
            </div>
          ))}
        </div>

        <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center", gap:12 }}>
          {dirty && (
            <button onClick={() => limpiarBuf(selYm)} style={{
              background:"transparent", border:"none", color:T.muted, fontSize:12,
              cursor:"pointer", fontFamily:T.font, fontWeight:600 }}>
              Descartar cambios
            </button>
          )}
          <Btn variant="accent" onClick={() => guardar(selYm)} disabled={!dirty || guardando}>
            {guardando ? "Guardando…" : `Guardar ${MESES[mesSel]} ${year}`}
          </Btn>
        </div>
      </div>

      {toast && (
        <div style={{ position:"fixed", bottom:24, right:24, zIndex:100, maxWidth:520,
          background: toast.tipo === "err" ? T.redBg : toast.tipo === "warn" ? T.orangeBg : T.greenBg,
          color:      toast.tipo === "err" ? T.red   : toast.tipo === "warn" ? T.orange   : T.green,
          border:`1px solid currentColor`, borderRadius:T.radius, padding:"12px 16px",
          fontSize:12, fontWeight:600, boxShadow:T.shadowMd, lineHeight:1.45 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
