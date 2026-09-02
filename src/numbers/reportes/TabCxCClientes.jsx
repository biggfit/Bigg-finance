// Reportes › CxC consolidada por cliente — cuentas por cobrar de TODAS las sociedades, con antigüedad.
// Espejo de TabCxPProveedores (lado ingreso). Read-only, datos propios sin scope de sociedad.
// Reusa calcSaldoPendiente (mismo neteo que Tesorería/Ingresos) y la matemática de aging de PaginaAging.
import { useState, useMemo, useEffect, useRef } from "react";
import { T, fmtDate, fmtMoney } from "../theme";
import { fetchIngresos, fetchPagosCobros, fetchSociedades, calcSaldoPendiente, fetchCuentasBancarias, appendCobro } from "../../lib/numbersApi";
import { exportarCxPExcel } from "./exportCxP";
import RegistrarCobroModal from "../pagos/RegistrarCobroModal";

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

export default function TabCxCClientes({ onBack, onVerComprobante }) {
  const [ingresos,   setIngresos]   = useState([]);
  const [cobros,     setCobros]     = useState([]);
  const [sociedades, setSociedades] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [filtroMoneda, setFiltroMoneda] = useState("ARS");
  const [fechaCorte,   setFechaCorte]   = useState("");
  const [drill,        setDrill]        = useState(null);   // drill-down: {nombre, sociedadNombre|null, total, docs}
  const [menuOpen,     setMenuOpen]     = useState(false);  // menú ⋮
  const [hover,        setHover]        = useState(null);   // hover de fila: {key, soc} — soc "__ALL__" = todo el cliente
  const [cuentasBanc,  setCuentasBanc]  = useState([]);     // cuentas bancarias (para el modal de cobro)
  const [cobrar,       setCobrar]       = useState(null);   // comprobante a cobrar: {ingreso, saldo, cuentas}
  const [reloadKey,    setReloadKey]    = useState(0);      // fuerza recarga tras registrar un cobro
  const dateRef = useRef(null);
  const menuRef = useRef(null);

  // Cierre del menú ⋮ al hacer click afuera.
  useEffect(() => {
    if (!menuOpen) return;
    const h = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const [ings, pcs, socs, cbs] = await Promise.all([
          fetchIngresos().catch(() => []),       // todos los INGRESO, todas las sociedades
          fetchPagosCobros().catch(() => []),
          fetchSociedades().catch(() => []),
          fetchCuentasBancarias().catch(() => []),   // todas las cuentas (medios de cobro)
        ]);
        if (cancelled) return;
        setCuentasBanc(arr(cbs));
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
  }, [reloadKey]);

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
      const dias = (vto && !isNaN(vto)) ? Math.floor((hoy - vto) / 86400000) : -1;  // vto inválido → a vencer, no +90
      const banda = bandaDe(dias);
      const key = ing.clienteId || `N:${(ing.cliente || "").trim().toLowerCase()}`;
      let c = clis.get(key);
      if (!c) { c = { key, nombre: ing.cliente || "Sin cliente", total:0, lineasMap: new Map() }; clis.set(key, c); }
      // Una línea por sociedad dentro del cliente: el monto NO se junta, se separa por sociedad.
      const socId = String(ing.sociedad || "");
      let ln = c.lineasMap.get(socId);
      if (!ln) { ln = { sociedad: socId, avencer:0, d0_30:0, d31_60:0, d61_90:0, dmas90:0, total:0, docs:[] }; c.lineasMap.set(socId, ln); }
      ln[banda] += saldo;
      ln.total  += saldo;
      ln.docs.push({ sociedad: ing.sociedad, nroComp: ing.nroComp || "—", vto: ing.vto || "", saldo, dias, banda, ing });
      c.total   += saldo;
    }
    const rows = [...clis.values()].map(c => ({
      key: c.key, nombre: c.nombre, total: c.total,
      lineas: [...c.lineasMap.values()].sort((a, b) => b.total - a.total),   // sociedades del cliente, mayor primero
    })).sort((a, b) => b.total - a.total);
    const totales = rows.reduce((t, r) => {
      for (const ln of r.lineas) { for (const b of BANDAS) t[b.key] += ln[b.key]; }
      t.total += r.total; return t;
    }, { avencer:0, d0_30:0, d31_60:0, d61_90:0, dmas90:0, total:0 });
    return { rows, totales };
  }, [ingresos, cobros, filtroMoneda, fechaCorte]);

  const fmt = v => v > 0.01 ? fmtMoney(v, filtroMoneda) : <span style={{ color: T.dim }}>—</span>;
  const cellS = (bold, red) => ({ padding:"9px 14px", fontSize:13, textAlign:"right", whiteSpace:"nowrap",
    fontFamily:"var(--mono)", fontWeight: bold ? 800 : 600, color: red ? "#dc2626" : T.text });
  const thS = { padding:"10px 14px", fontSize:11, fontWeight:800, color:"rgba(255,255,255,.9)",
    textAlign:"right", letterSpacing:".04em", textTransform:"uppercase", whiteSpace:"nowrap" };
  const backBtn = { display:"inline-flex", alignItems:"center", gap:6, background:"#f3f4f6",
    border:`1px solid ${T.cardBorder}`, borderRadius:8, color:T.text, fontFamily:T.font,
    fontSize:13, fontWeight:700, padding:"6px 14px", cursor:"pointer" };
  const h1S = { fontSize:24, fontWeight:900, color:T.text, margin:0, letterSpacing:"-.02em" };

  // Chip de una sociedad (una por línea).
  const socChipUno = (id) => {
    if (!id) return <span style={{ color: T.dim }}>—</span>;
    const s = socMap.get(String(id));
    return (
      <span style={{ fontSize:11, fontWeight:700, color: T.text, background:"#eef1f4",
        border:`1px solid ${T.cardBorder}`, borderRadius:999, padding:"2px 9px", whiteSpace:"nowrap", display:"inline-block" }}>
        {s?.bandera ? s.bandera + " " : ""}{s?.nombre || id}
      </span>
    );
  };

  // Descarga a Excel: aplana las líneas (cliente × sociedad) con el nombre de sociedad resuelto.
  const bajarExcel = () => {
    setMenuOpen(false);
    const rowsX = rows.map(r => ({
      nombre: r.nombre, total: r.total,
      lineas: r.lineas.map(ln => ({ ...ln, sociedadNombre: socNombre(ln.sociedad) })),
    }));
    exportarCxPExcel({ tipo: "cxc", rows: rowsX, totales, moneda: filtroMoneda, fechaCorte });
  };

  // Abrir el modal de cobro (el MISMO de Ingresos) sobre un comprobante del detalle.
  const abrirCobro = (d) => {
    if (!d?.ing) return;
    const soc = String(d.ing.sociedad ?? "").toLowerCase();
    setCobrar({ ingreso: d.ing, saldo: d.saldo, cuentas: cuentasBanc.filter(c => (c.sociedad ?? "").toLowerCase() === soc) });
  };

  // Guardar el cobro → appendCobro (mismo registro que Ingresos) → recargar el reporte.
  const guardarCobro = async (data) => {
    const ing = cobrar?.ingreso;
    if (!ing) return;
    try {
      await appendCobro({
        documento_id:    data.ingresoId,
        sociedad:        ing.sociedad,
        fecha:           data.fecha,
        monto:           Number(data.monto),
        moneda:          ing.moneda ?? "ARS",
        cuenta_bancaria: data.medioCobro,
        cuenta:          ing.cuenta ?? "",
        referencia:      "",
        nota:            "",
      });
      setCobrar(null);
      setReloadKey(k => k + 1);
    } catch (e) {
      alert("Error al registrar el cobro: " + e.message);
    }
  };

  // ── Drill-down: comprobantes de un cliente ──
  if (drill) {
    const docs = [...drill.docs].sort((a, b) => (parseVto(a.vto)?.getTime() || 0) - (parseVto(b.vto)?.getTime() || 0));
    return (
      <div className="fade" style={{ padding:"4px 0" }}>
        {/* Header unificado: título + Volver (izq) · cliente + total pendiente (der), a la misma altura */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:16, marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <h1 style={h1S}>CxC por cliente</h1>
            <button onClick={() => setDrill(null)} style={backBtn}>← Volver</button>
          </div>
          <div style={{ minWidth:360 }}>
            {/* Fila 1: nombre (izq) + monto (der) — center para que no desalinee la barra roja del nombre */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:18 }}>
              <div style={{ display:"flex", alignItems:"center", gap:9, minWidth:0 }}>
                <div style={{ width:4, height:20, borderRadius:2, background:HEADER, flexShrink:0, alignSelf:"center" }} />
                <h2 style={{ fontSize:18, fontWeight:900, color:T.text, margin:0, letterSpacing:"-.01em", whiteSpace:"nowrap" }}>{drill.nombre}</h2>
              </div>
              <span style={{ fontSize:20, fontWeight:900, color:HEADER, fontFamily:"var(--mono)", whiteSpace:"nowrap" }}>{fmtMoney(drill.total, filtroMoneda)}</span>
            </div>
            {/* Fila 2: detalle bajo el nombre (izq) + "total pendiente" bajo el número (der) */}
            <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:18, marginTop:2 }}>
              <div style={{ fontSize:12, color:T.muted, paddingLeft:13 }}>
                {drill.sociedadNombre ? <span style={{ fontWeight:700, color:T.text }}>{drill.sociedadNombre}</span> : null}
                {drill.sociedadNombre ? " · " : ""}{docs.length} comprobante{docs.length !== 1 ? "s" : ""} pendiente{docs.length !== 1 ? "s" : ""} · {filtroMoneda}
                {fechaCorte && <span> · Al {fmtDate(fechaCorte)}</span>}
              </div>
              <span style={{ fontSize:10, color:T.muted, textTransform:"uppercase", letterSpacing:".06em", fontWeight:700, whiteSpace:"nowrap" }}>Total pendiente</span>
            </div>
          </div>
        </div>
        <div style={{ fontSize:12, color:T.muted, marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
          <span aria-hidden>💵</span> Tocá un comprobante para registrar el cobro.
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
                  <tr key={i} onClick={() => abrirCobro(d)} title="Registrar cobro"
                    style={{ borderBottom:`1px solid ${T.cardBorder}`, background: i%2===0 ? T.card : "#fafbfc", cursor:"pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#eef6ff"}
                    onMouseLeave={e => e.currentTarget.style.background = i%2===0 ? T.card : "#fafbfc"}>
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
        {cobrar && (
          <RegistrarCobroModal ingreso={cobrar.ingreso} saldoPendiente={cobrar.saldo} cuentas={cobrar.cuentas}
            sociedadNombre={socNombre(cobrar.ingreso.sociedad)}
            onVerComprobante={onVerComprobante ? () => onVerComprobante("ingresos", cobrar.ingreso.sociedad, cobrar.ingreso.id) : undefined}
            onClose={() => setCobrar(null)} onSave={guardarCobro} />
        )}
      </div>
    );
  }

  return (
    <div className="fade">
      {/* Header propio: título + volver a Reportes (el PageHeader global se omite para este reporte) */}
      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:24 }}>
        <h1 style={h1S}>CxC por cliente</h1>
        <button onClick={onBack} style={backBtn}>← Reportes</button>
      </div>

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

        {/* Menú ⋮ (Bajar a Excel) */}
        <div ref={menuRef} style={{ marginLeft:"auto", position:"relative" }}>
          <button type="button" onClick={() => setMenuOpen(o => !o)} title="Opciones" aria-haspopup="menu" aria-expanded={menuOpen}
            style={{ border:`1px solid ${T.cardBorder}`, borderRadius:8, background: menuOpen ? "#eceff3" : "#fff",
              width:34, height:34, cursor:"pointer", fontSize:18, color:T.muted, lineHeight:1,
              display:"inline-flex", alignItems:"center", justifyContent:"center" }}>⋮</button>
          {menuOpen && (
            <div role="menu" style={{ position:"absolute", top:"calc(100% + 6px)", right:0, minWidth:180, background:T.card,
              border:`1px solid ${T.cardBorder}`, borderRadius:10, boxShadow:"0 8px 24px rgba(0,0,0,.12)", padding:6, zIndex:30 }}>
            <button type="button" role="menuitem" onClick={bajarExcel} disabled={rows.length === 0}
              style={{ display:"flex", alignItems:"center", gap:9, width:"100%", textAlign:"left", background:"transparent",
                border:"none", borderRadius:7, padding:"9px 11px", fontSize:13, fontWeight:600, fontFamily:T.font,
                color: rows.length === 0 ? T.dim : T.text, cursor: rows.length === 0 ? "not-allowed" : "pointer" }}
              onMouseEnter={e => { if (rows.length) e.currentTarget.style.background = "#eceff3"; }}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span aria-hidden style={{ fontSize:15 }}>⬇️</span> Bajar a Excel
            </button>
            </div>
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
            <table style={{ width:"100%", borderCollapse:"collapse", minWidth:1040 }}>
              <colgroup>
                <col style={{ width:210 }} /><col style={{ width:132 }} />
                {[...BANDAS, { key:"total" }].map(b => <col key={b.key} />)}
              </colgroup>
              <thead><tr style={{ background:HEADER }}>
                <th style={{ ...thS, textAlign:"left" }}>Cliente</th>
                <th style={{ ...thS, textAlign:"left" }}>Sociedad</th>
                {BANDAS.map(b => <th key={b.key} style={thS}>{b.label}</th>)}
                <th style={thS}>Total</th>
              </tr></thead>
              <tbody>
                {rows.map((r, pi) => {
                  const bg = pi % 2 === 0 ? T.card : "#fafbfc";
                  // Click en el nombre → detalle de TODAS las sociedades del cliente.
                  const drillTodo = () => setDrill({ nombre: r.nombre, sociedadNombre: null, total: r.total, docs: r.lineas.flatMap(l => l.docs) });
                  return r.lineas.map((ln, li) => {
                    const ultima = li === r.lineas.length - 1;
                    const grupoHover = hover && hover.key === r.key && hover.soc === "__ALL__";   // hover del nombre → todo el grupo
                    const lineaHover = hover && hover.key === r.key && (hover.soc === "__ALL__" || hover.soc === ln.sociedad);
                    const lineBg = lineaHover ? "#eceff3" : bg;
                    const nameBg = grupoHover ? "#eceff3" : bg;
                    return (
                      <tr key={r.key + "|" + ln.sociedad}
                        onClick={() => setDrill({ nombre: r.nombre, sociedadNombre: socNombre(ln.sociedad), total: ln.total, docs: ln.docs })}
                        onMouseEnter={() => setHover({ key: r.key, soc: ln.sociedad })}
                        onMouseLeave={() => setHover(null)}
                        style={{ borderBottom: ultima ? `1px solid ${T.cardBorder}` : "1px solid #eef1f4", cursor:"pointer" }}>
                        {li === 0 && (
                          <td rowSpan={r.lineas.length} onClick={e => { e.stopPropagation(); drillTodo(); }}
                            onMouseEnter={() => setHover({ key: r.key, soc: "__ALL__" })}
                            style={{ padding:"9px 14px", fontSize:13, fontWeight:700, color:T.text, verticalAlign:"middle", background:nameBg }}>{r.nombre}</td>
                        )}
                        <td style={{ padding:"9px 14px", background:lineBg }}>{socChipUno(ln.sociedad)}</td>
                        <td style={{ ...cellS(false), background:lineBg }}>{fmt(ln.avencer)}</td>
                        <td style={{ ...cellS(false), background:lineBg }}>{fmt(ln.d0_30)}</td>
                        <td style={{ ...cellS(false), background:lineBg }}>{fmt(ln.d31_60)}</td>
                        <td style={{ ...cellS(false, true), background:lineBg }}>{fmt(ln.d61_90)}</td>
                        <td style={{ ...cellS(false, true), background:lineBg }}>{fmt(ln.dmas90)}</td>
                        <td style={{ ...cellS(true), background:lineBg }}>{fmtMoney(ln.total, filtroMoneda)}</td>
                      </tr>
                    );
                  });
                })}
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
