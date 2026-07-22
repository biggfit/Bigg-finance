// Reportes › CxC consolidada por cliente — cuentas por cobrar de TODAS las sociedades, con antigüedad.
// Espejo de TabCxPProveedores (lado ingreso). Read-only, datos propios sin scope de sociedad.
// Reusa calcSaldoPendiente (mismo neteo que Tesorería/Ingresos) y la matemática de aging de PaginaAging.
import { useState, useMemo, useEffect, useRef } from "react";
import { T, fmtDate, fmtMoney } from "../theme";
import { fetchIngresos, fetchPagosCobros, fetchSociedades, calcSaldoPendiente } from "../../lib/numbersApi";

const arr = x => Array.isArray(x) ? x : [];

// Vto → medianoche LOCAL (soporta YYYY-MM-DD y DD/MM/YYYY). Espeja numbersApi._parseVto (no exportado).
function parseVto(vtoStr) {
  if (!vtoStr) return null;
  let y, m, d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(vtoStr))       { [y, m, d] = vtoStr.split("-"); }
  else if (/^\d{2}\/\d{2}\/\d{4}$/.test(vtoStr)) { [d, m, y] = vtoStr.split("/"); }
  else return null;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

function bandaDe(dias) {
  if (dias < 0)   return "avencer";
  if (dias <= 30) return "d0_30";
  if (dias <= 60) return "d31_60";
  if (dias <= 90) return "d61_90";
  return "dmas90";
}

const BANDAS = [
  { key: "avencer", label: "A vencer" },
  { key: "d0_30",   label: "0-30" },
  { key: "d31_60",  label: "31-60" },
  { key: "d61_90",  label: "61-90" },
  { key: "dmas90",  label: "+90" },
];

const HEADER = "#16a34a";  // activo / clientes (verde, como el bloque A Cobrar)

export default function TabCxCClientes() {
  const [ingresos,   setIngresos]   = useState([]);
  const [cobros,     setCobros]     = useState([]);
  const [sociedades, setSociedades] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [filtroMoneda, setFiltroMoneda] = useState("ARS");
  const [fechaCorte,   setFechaCorte]   = useState("");
  const [drill,        setDrill]        = useState(null);   // fila de cliente en drill-down
  const dateRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const [ings, pcs, socs] = await Promise.all([
          fetchIngresos().catch(() => []),       // todos los INGRESO, todas las sociedades
          fetchPagosCobros().catch(() => []),
          fetchSociedades().catch(() => []),
        ]);
        if (cancelled) return;
        setIngresos(arr(ings));
        setCobros(arr(pcs).filter(p => p.tipo === "COBRO"));   // incluye retenciones (netean la CxC)
        setSociedades(arr(socs));
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const socMap = useMemo(() => {
    const m = new Map();
    for (const s of sociedades) m.set(String(s.id), { nombre: s.nombre || String(s.id), bandera: s.bandera || "" });
    return m;
  }, [sociedades]);
  const socNombre = id => socMap.get(String(id))?.nombre || String(id || "—");

  const monedas = useMemo(() => {
    const set = new Set(ingresos.map(e => e.moneda || "ARS"));
    return [...set].sort((a, b) => (a === "ARS" ? -1 : b === "ARS" ? 1 : a.localeCompare(b)));
  }, [ingresos]);

  // ── Cómputo: saldo por comprobante → agrupar por cliente con aging ──
  const { rows, totales } = useMemo(() => {
    const corte = fechaCorte || null;
    const hoy = corte ? parseVto(corte.split("-").reverse().join("/")) || new Date() : (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
    const cobrosByDoc = new Map();
    for (const p of cobros) {
      if (corte && (p.fecha ?? "") > corte) continue;
      const k = String(p.documento_id || "");
      if (!k) continue;
      (cobrosByDoc.get(k) || cobrosByDoc.set(k, []).get(k)).push(p);
    }
    const clis = new Map();
    for (const ing of ingresos) {
      if ((ing.moneda || "ARS") !== filtroMoneda) continue;
      if (corte && (ing.fecha ?? "") > corte) continue;
      const saldo = calcSaldoPendiente(ing.importe, cobrosByDoc.get(String(ing.id)) || []);
      if (saldo <= 0.01) continue;
      const vto  = parseVto(ing.vto);
      const dias = vto ? Math.floor((hoy - vto) / 86400000) : -1;
      const banda = bandaDe(dias);
      const key = ing.clienteId || `N:${(ing.cliente || "").trim().toLowerCase()}`;
      let c = clis.get(key);
      if (!c) { c = { key, nombre: ing.cliente || "Sin cliente", socs: new Set(),
        avencer:0, d0_30:0, d31_60:0, d61_90:0, dmas90:0, total:0, docs:[] }; clis.set(key, c); }
      c[banda] += saldo;
      c.total  += saldo;
      c.socs.add(String(ing.sociedad || ""));
      c.docs.push({ sociedad: ing.sociedad, nroComp: ing.nroComp || "—", vto: ing.vto || "", saldo, dias, banda });
    }
    const rows = [...clis.values()].sort((a, b) => b.total - a.total);
    const totales = rows.reduce((t, r) => {
      for (const b of BANDAS) t[b.key] += r[b.key];
      t.total += r.total; return t;
    }, { avencer:0, d0_30:0, d31_60:0, d61_90:0, dmas90:0, total:0 });
    return { rows, totales };
  }, [ingresos, cobros, filtroMoneda, fechaCorte]);

  const fmt = v => v > 0.01 ? fmtMoney(v, filtroMoneda) : <span style={{ color: T.dim }}>—</span>;
  const cellS = (bold, red) => ({ padding:"9px 14px", fontSize:13, textAlign:"right", whiteSpace:"nowrap",
    fontFamily:"var(--mono)", fontWeight: bold ? 800 : 600, color: red ? "#dc2626" : T.text });
  const thS = { padding:"10px 14px", fontSize:11, fontWeight:800, color:"rgba(255,255,255,.9)",
    textAlign:"right", letterSpacing:".04em", textTransform:"uppercase", whiteSpace:"nowrap" };

  const socChips = (socsSet) => {
    const ids = [...socsSet].filter(Boolean);
    if (ids.length === 0) return <span style={{ color: T.dim }}>—</span>;
    if (ids.length > 2) return <span style={{ fontSize:12, color: T.muted, fontWeight:600 }}>{ids.length} sociedades</span>;
    return (
      <span style={{ display:"inline-flex", gap:6, flexWrap:"wrap" }}>
        {ids.map(id => {
          const s = socMap.get(String(id));
          return (
            <span key={id} style={{ fontSize:11, fontWeight:700, color: T.text, background:"#eef1f4",
              border:`1px solid ${T.cardBorder}`, borderRadius:999, padding:"2px 9px", whiteSpace:"nowrap" }}>
              {s?.bandera ? s.bandera + " " : ""}{s?.nombre || id}
            </span>
          );
        })}
      </span>
    );
  };

  // ── Drill-down: comprobantes de un cliente ──
  if (drill) {
    const docs = [...drill.docs].sort((a, b) => (parseVto(a.vto)?.getTime() || 0) - (parseVto(b.vto)?.getTime() || 0));
    return (
      <div className="fade" style={{ padding:"4px 0" }}>
        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20 }}>
          <button onClick={() => setDrill(null)} style={{ background:"#f3f4f6", border:`1px solid ${T.cardBorder}`,
            borderRadius:8, padding:"6px 14px", fontSize:13, fontWeight:700, color:T.muted, cursor:"pointer", fontFamily:T.font }}>
            ← Volver
          </button>
          <div style={{ width:4, height:28, borderRadius:2, background:HEADER }} />
          <div>
            <h1 style={{ fontSize:20, fontWeight:900, color:T.text, margin:0, letterSpacing:"-.02em" }}>{drill.nombre}</h1>
            <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>
              {docs.length} comprobante{docs.length !== 1 ? "s" : ""} pendiente{docs.length !== 1 ? "s" : ""} · {filtroMoneda}
              {fechaCorte && <span style={{ marginLeft:8 }}>· Al {fmtDate(fechaCorte)}</span>}
            </div>
          </div>
          <div style={{ marginLeft:"auto", textAlign:"right" }}>
            <div style={{ fontSize:11, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", fontWeight:700 }}>Total pendiente</div>
            <div style={{ fontSize:20, fontWeight:900, color:HEADER, fontFamily:"var(--mono)" }}>{fmtMoney(drill.total, filtroMoneda)}</div>
          </div>
        </div>
        <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden" }}>
          <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", minWidth:640 }}>
            <thead><tr style={{ background:"#374151" }}>
              {["Sociedad","N° comprobante","Vencimiento","Días","Saldo"].map((h,i) => (
                <th key={h} style={{ ...thS, textAlign: i < 3 ? "left" : "right" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {docs.map((d, i) => {
                const vencido = d.dias >= 0 && d.vto;
                return (
                  <tr key={i} style={{ borderBottom:`1px solid ${T.cardBorder}`, background: i%2===0 ? T.card : "#fafbfc" }}>
                    <td style={{ padding:"9px 14px", fontSize:13, color:T.text }}>{socNombre(d.sociedad)}</td>
                    <td style={{ padding:"9px 14px", fontSize:13, color:T.muted, fontFamily:"var(--mono)" }}>{d.nroComp}</td>
                    <td style={{ padding:"9px 14px", fontSize:13, color:T.text }}>{d.vto ? fmtDate(d.vto) : "—"}</td>
                    <td style={cellS(false, vencido)}>
                      {d.vto ? (vencido ? `${d.dias} venc.` : `${-d.dias} rest.`) : "—"}
                    </td>
                    <td style={cellS(true, vencido)}>{fmtMoney(d.saldo, filtroMoneda)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade">
      {/* Toolbar: moneda + fecha de corte */}
      <div style={{ display:"flex", gap:16, margin:"4px 0 20px", flexWrap:"wrap", alignItems:"center",
        background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius, padding:"12px 16px", boxShadow:"0 1px 3px rgba(0,0,0,.04)" }}>
        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".08em", marginRight:4 }}>Moneda</span>
          {monedas.map(m => {
            const on = filtroMoneda === m;
            return (
              <button key={m} type="button" onClick={() => setFiltroMoneda(m)} style={{
                background: on ? T.accentDark : "#eceff3", color: on ? T.accent : T.muted,
                border:`1px solid ${on ? T.accentDark : T.cardBorder}`, borderRadius:999,
                padding:"5px 14px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:T.font }}>{m}</button>
            );
          })}
        </div>
        <div style={{ width:1, height:24, background:T.cardBorder }} />
        <div style={{ display:"flex", alignItems:"center", gap:8, position:"relative" }}>
          <span style={{ fontSize:10, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".08em" }}>Al día</span>
          <button type="button" onClick={() => { dateRef.current?.showPicker?.(); dateRef.current?.click(); }}
            style={{ border:`1px solid ${T.cardBorder}`, borderRadius:8, padding:"6px 12px", fontSize:12, fontFamily:T.font,
              background:"#eceff3", color: fechaCorte ? T.text : T.dim, cursor:"pointer", whiteSpace:"nowrap",
              display:"inline-flex", alignItems:"center", gap:6, minWidth:124, justifyContent:"center", fontWeight:600 }}>
            <span style={{ opacity:.75 }} aria-hidden>📅</span>
            {fechaCorte ? fmtDate(fechaCorte) : "Hoy"}
          </button>
          <input ref={dateRef} type="date" value={fechaCorte} onChange={e => setFechaCorte(e.target.value)}
            style={{ position:"absolute", opacity:0, pointerEvents:"none", width:0, height:0 }} />
          {fechaCorte && (
            <button type="button" onClick={() => setFechaCorte("")} title="Quitar fecha"
              style={{ background:"transparent", border:"none", color:T.muted, fontSize:16, cursor:"pointer", lineHeight:1, padding:4 }}>✕</button>
          )}
        </div>
      </div>

      {loading && <div style={{ padding:"60px 32px", textAlign:"center", color:T.muted, fontSize:14 }}>Cargando cuentas por cobrar…</div>}
      {error && !loading && (
        <div role="alert" style={{ background:T.redBg, border:`1px solid ${T.red}`, borderRadius:T.radius, padding:"18px 22px", color:"#991b1b", fontSize:13 }}>{error}</div>
      )}

      {!loading && !error && (
        rows.length === 0 ? (
          <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius, padding:"60px 24px", textAlign:"center" }}>
            <div style={{ fontSize:28, marginBottom:10 }}>✅</div>
            <div style={{ fontSize:14, color:T.muted }}>Sin cuentas por cobrar en {filtroMoneda}{fechaCorte ? ` al ${fmtDate(fechaCorte)}` : ""}.</div>
          </div>
        ) : (
          <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden" }}>
            <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", minWidth:920 }}>
              <thead><tr style={{ background:HEADER }}>
                <th style={{ ...thS, textAlign:"left" }}>Cliente</th>
                <th style={{ ...thS, textAlign:"left" }}>Sociedad(es)</th>
                {BANDAS.map(b => <th key={b.key} style={thS}>{b.label}</th>)}
                <th style={thS}>Total</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key} onClick={() => setDrill(r)}
                    style={{ borderBottom:`1px solid ${T.cardBorder}`, background: i%2===0 ? T.card : "#fafbfc", cursor:"pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#eceff3"}
                    onMouseLeave={e => e.currentTarget.style.background = i%2===0 ? T.card : "#fafbfc"}>
                    <td style={{ padding:"9px 14px", fontSize:13, fontWeight:700, color:T.text }}>{r.nombre}</td>
                    <td style={{ padding:"9px 14px" }}>{socChips(r.socs)}</td>
                    <td style={cellS(false)}>{fmt(r.avencer)}</td>
                    <td style={cellS(false)}>{fmt(r.d0_30)}</td>
                    <td style={cellS(false)}>{fmt(r.d31_60)}</td>
                    <td style={cellS(false, true)}>{fmt(r.d61_90)}</td>
                    <td style={cellS(false, true)}>{fmt(r.dmas90)}</td>
                    <td style={cellS(true)}>{fmtMoney(r.total, filtroMoneda)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ background:"#f3f4f6", borderTop:`2px solid ${T.cardBorder}` }}>
                <td style={{ padding:"10px 14px", fontSize:12, fontWeight:800, color:T.text, textTransform:"uppercase", letterSpacing:".04em" }}>Total ({rows.length})</td>
                <td />
                {BANDAS.map(b => <td key={b.key} style={cellS(true, b.key === "d61_90" || b.key === "dmas90")}>{fmt(totales[b.key])}</td>)}
                <td style={cellS(true)}>{fmtMoney(totales.total, filtroMoneda)}</td>
              </tr></tfoot>
            </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}
