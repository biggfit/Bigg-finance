// Conciliación "Correo" — bandeja CONSOLIDADA de facturas parkeadas desde el mail (subtipo EGRESO_BORRADOR).
// Read-only sobre Gmail (el lector parkea aparte); acá el equipo revisa y CONTABILIZA (crea el EGRESO real) o
// IGNORA. Consolidado: todas las sociedades, columna Sociedad editable. Nada automático.
import { useState, useMemo, useEffect, useRef } from "react";
import { T, PageHeader, fmtDate, fmtMoney } from "../theme";
import {
  fetchCorreoBorradores, contabilizarBorrador, ignorarBorrador,
  fetchSociedades, fetchCuentas, fetchCentrosCosto, fetchProveedores,
  fetchEgresos, fetchMovTesoreria,
} from "../../lib/numbersApi";
import NuevoEgresoModal from "../NuevoEgresoModal";
import { formatNroComp } from "../formUtils";

const arr = x => Array.isArray(x) ? x : [];
const metaRef   = nota => (String(nota || "").match(/mail_ref=([^\s;]+)/) || [])[1] || "";
const metaFecha = nota => (String(nota || "").match(/fecha_correo=([^\s;]+)/) || [])[1] || "";
const gmailUrl  = ref => ref ? `https://mail.google.com/mail/u/0/#all/${ref}` : null;
const toNum = v => { const n = parseFloat(String(v ?? "").replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3},)/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };

export default function TabCorreo({ onPend } = {}) {
  const [borradores, setBorradores] = useState([]);
  const [sociedades, setSociedades] = useState([]);
  const [cuentas,    setCuentas]    = useState([]);
  const [centros,    setCentros]    = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [egresos,    setEgresos]    = useState([]);   // EGRESO reales (para flag "posible duplicado")
  const [movs,       setMovs]       = useState([]);   // para flag "débito pendiente en banco"
  const [edits,      setEdits]      = useState({});
  const [busy,       setBusy]       = useState(null);
  const [menuOpen,   setMenuOpen]   = useState(null);  // id_comp del dropdown abierto
  const [editar,     setEditar]     = useState(null);  // row abierto en NuevoEgresoModal
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const menuRef = useRef(null);

  async function cargar() {
    setLoading(true); setError(null);
    try {
      const [brs, socs, ctas, ccs, provs, egs, mvs] = await Promise.all([
        fetchCorreoBorradores().catch(() => []),
        fetchSociedades().catch(() => []),
        fetchCuentas().catch(() => []),
        fetchCentrosCosto().catch(() => []),
        fetchProveedores().catch(() => []),
        fetchEgresos().catch(() => []),
        fetchMovTesoreria().catch(() => []),
      ]);
      setBorradores(arr(brs)); setSociedades(arr(socs)); setCuentas(arr(ctas));
      setCentros(arr(ccs)); setProveedores(arr(provs)); setEgresos(arr(egs)); setMovs(arr(mvs));
      onPend?.(arr(brs).length);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const h = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(null); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);

  const cuentasEgreso = useMemo(() => cuentas.filter(c => {
    const t = (c.tipo ?? "").toLowerCase();
    return !(t === "venta" || t === "ventas" || t === "ingreso" || t === "ingresos");
  }), [cuentas]);

  // Débitos del banco todavía sin conciliar (origen extracto, salida, sin documento) → para marcar la fila.
  const pendientesDebito = useMemo(() =>
    movs.filter(m => m.origen === "extracto" && !String(m.documento_id || "") && toNum(m.monto) < 0),
    [movs]);
  const pagoPendiente = (row) => pendientesDebito.find(m => Math.abs(Math.abs(toNum(m.monto)) - toNum(row.total)) < 0.5) || null;
  // Posible duplicado: ya existe un EGRESO real del mismo proveedor por el mismo monto.
  const posibleDup = (row) => egresos.some(e => String(e.proveedorId || "") === String(row.proveedorId || "")
    && row.proveedorId && Math.abs(toNum(e.total) - toNum(row.total)) < 0.01);

  const ed = (row) => edits[row.id] || { sociedad: row.sociedad || "", cuentaId: row.cuentaId || "", centro: "", fechaServicio: row.fecha || "", nroComp: row.nroComp || "" };
  const setEd = (id, patch) => setEdits(e => ({ ...e, [id]: { ...(edits[id] || {}), ...patch } }));

  const payloadDe = (row, e) => {
    const cuentaNombre = (cuentas.find(c => c.id === e.cuentaId)?.nombre) || e.cuentaId;
    const linea = (row.lineas && row.lineas[0]) || {};
    return {
      sociedad: e.sociedad, fecha: e.fechaServicio || row.fecha || "", vto: row.vto || "",
      proveedor: row.proveedor, proveedorId: row.proveedorId,
      cuenta: cuentaNombre, cuentaId: e.cuentaId, moneda: row.moneda || "ARS",
      nroComp: e.nroComp || "", nota: row.nota || "",
      lineas: [{ cc: e.centro, subtotal: linea.subtotal ?? row.total, ivaRate: linea.ivaRate ?? 0 }],
    };
  };

  const contabilizar = async (row) => {
    const e = ed(row);
    if (!e.sociedad || !e.cuentaId || !e.centro) return;
    setBusy(row.id); setMenuOpen(null);
    try { await contabilizarBorrador(row.id, payloadDe(row, e)); await cargar(); }
    catch (err) { alert("Error al contabilizar: " + (err?.message || err)); }
    finally { setBusy(null); }
  };

  const ignorar = async (row) => {
    setMenuOpen(null);
    if (!confirm(`¿Ignorar la factura de ${row.proveedor} ($${Math.round(row.total)})? No se contabiliza.`)) return;
    setBusy(row.id);
    try { await ignorarBorrador(row.id, "correo"); await cargar(); }
    catch (err) { alert("Error: " + (err?.message || err)); }
    finally { setBusy(null); }
  };

  // "Abrir para editar" → NuevoEgresoModal precargado (para repartir en varios centros).
  const initialDe = (row) => {
    const e = ed(row);
    const linea = (row.lineas && row.lineas[0]) || {};
    return {
      _duplicate: true,   // se trata como comprobante NUEVO (el id COR- no es un egreso real)
      proveedorId: row.proveedorId, proveedor: row.proveedor,
      cuentaId: e.cuentaId || row.cuentaId, cuenta: (cuentas.find(c => c.id === (e.cuentaId || row.cuentaId))?.nombre) || row.cuenta,
      moneda: row.moneda || "ARS",
      fecha: e.fechaServicio || row.fecha || "",
      vto: row.vto || "",
      nroComp: e.nroComp || row.nroComp || "",
      nota: row.nota || "",
      lineas: [{ cc: e.centro || "", subtotal: linea.subtotal ?? row.total, ivaRate: linea.ivaRate ?? 0 }],
    };
  };
  const guardarEditado = async (payload) => {
    if (!editar) return;
    await contabilizarBorrador(editar.id, payload);
    setEditar(null);
    await cargar();
  };

  const thS = { padding:"10px 12px", fontSize:11, fontWeight:800, color:"rgba(255,255,255,.9)",
    textAlign:"left", letterSpacing:".04em", textTransform:"uppercase", whiteSpace:"nowrap" };
  const sel = { background:"#fff", border:`1px solid ${T.cardBorder}`, borderRadius:6, padding:"5px 7px",
    fontSize:12, color:T.text, fontFamily:T.font, outline:"none", maxWidth:150 };
  const num = (bold) => ({ padding:"9px 12px", fontSize:13, fontWeight: bold?800:600, color:T.text,
    fontFamily:"var(--mono)", textAlign:"right", whiteSpace:"nowrap" });
  const chip = (bg, col) => ({ fontSize:10, fontWeight:700, background:bg, color:col, borderRadius:5, padding:"1px 6px", whiteSpace:"nowrap" });

  if (editar) {
    return (
      <NuevoEgresoModal asPage sociedad={ed(editar).sociedad || editar.sociedad}
        proveedores={proveedores} cuentas={cuentas} centrosCosto={centros}
        initialData={initialDe(editar)}
        onClose={() => setEditar(null)} onSave={guardarEditado} />
    );
  }

  const item = (label, onClick, color, disabled) => (
    <button onClick={() => { if (!disabled) { setMenuOpen(null); onClick(); } }} disabled={disabled}
      style={{ display:"block", width:"100%", textAlign:"left", padding:"8px 14px", background:"transparent",
        border:"none", fontSize:13, color: disabled ? T.dim : (color || T.text), cursor: disabled?"default":"pointer", fontFamily:T.font }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = "#f3f4f6"; }}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{label}</button>
  );

  return (
    <div className="fade" style={{ padding:"28px 32px" }}>
      <PageHeader
        title="Correo — facturas"
        subtitle="Facturas leídas del mail (pagos@bigg.fit), parkeadas sin contabilizar. Revisá y Contabilizá (crea la factura/CxP en su sociedad) o Ignorá. Consolidado: todas las sociedades. El mail no se toca." />


      {loading && <div style={{ padding:"50px", textAlign:"center", color:T.muted, fontSize:14 }}>Cargando bandeja de correo…</div>}
      {error && !loading && (
        <div role="alert" style={{ background:T.redBg, border:`1px solid ${T.red}`, borderRadius:T.radius, padding:"16px 20px", color:"#991b1b", fontSize:13 }}>{error}</div>
      )}

      {!loading && !error && (borradores.length === 0 ? (
        <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius, padding:"56px 24px", textAlign:"center" }}>
          <div style={{ fontSize:28, marginBottom:10 }}>📭</div>
          <div style={{ fontSize:14, color:T.muted }}>No hay facturas por contabilizar en la bandeja.</div>
        </div>
      ) : (
        <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius, boxShadow:T.shadow, overflow:"visible" }}>
          <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", minWidth:1360 }}>
            <thead><tr style={{ background:"#0e7490" }}>
              {[["Proveedor","left"],["N°","left"],["Fecha correo","left"],["Sociedad","left"],["Fecha servicio","left"],["Vto","left"],
                ["Cuenta contable","left"],["Centro","left"],["Subtotal","right"],["IVA","right"],["Total","right"],["",""]]
                .map(([h,a],i) => <th key={i} style={{ ...thS, textAlign:a }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {borradores.map((row, i) => {
                const e = ed(row);
                const ref = metaRef(row.nota);
                const linea = (row.lineas && row.lineas[0]) || {};
                const listo = e.sociedad && e.cuentaId && e.centro;
                const enCurso = busy === row.id;
                const pago = pagoPendiente(row);
                const dup  = posibleDup(row);
                // Vto: si el pago ya se debitó en el banco, mostramos esa fecha; si no, la de la factura.
                const vtoMostrar = pago ? pago.fecha : row.vto;
                return (
                  <tr key={row.id} style={{ borderBottom:`1px solid ${T.cardBorder}`, background: i%2===0 ? T.card : "#fafbfc" }}>
                    <td style={{ padding:"9px 12px", whiteSpace:"nowrap" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, fontWeight:700, color:T.text }}>
                        <span>{row.proveedor || "—"}</span>
                        {pago && <span style={{ fontSize:13, cursor:"help" }} title={`Pago ya realizado — falta matchearlo contra esta factura.\nDébito en Banco: ${pago.cuenta_bancaria} · ${pago.fecha} · ${fmtMoney(Math.abs(toNum(pago.monto)), row.moneda||"ARS")}`}>💳</span>}
                        {dup && <span style={{ fontSize:13, cursor:"help" }} title="Posible duplicado: ya hay un EGRESO del mismo proveedor por el mismo monto.">⚠️</span>}
                      </div>
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      <input value={e.nroComp} onChange={ev => setEd(row.id, { nroComp: formatNroComp(ev.target.value) })}
                        placeholder="FC-A 0001-00001234" style={{ ...sel, maxWidth:130 }} />
                    </td>
                    <td style={{ padding:"9px 12px", fontSize:12, color:T.muted, whiteSpace:"nowrap" }}>{metaFecha(row.nota) ? fmtDate(metaFecha(row.nota)) : "—"}</td>
                    <td style={{ padding:"9px 12px" }}>
                      <select value={e.sociedad} onChange={ev => setEd(row.id, { sociedad: ev.target.value })}
                        style={{ ...sel, borderColor: e.sociedad ? T.cardBorder : "#f59e0b", background: e.sociedad ? "#fff" : "#fffbeb" }}>
                        <option value="">⚠ Falta sociedad</option>
                        {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                      </select>
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      <input type="date" value={e.fechaServicio} onChange={ev => setEd(row.id, { fechaServicio: ev.target.value })}
                        style={{ ...sel, maxWidth:140 }} />
                    </td>
                    <td style={{ padding:"9px 12px", fontSize:12, color: pago ? "#059669" : T.muted, whiteSpace:"nowrap", fontWeight: pago ? 700 : 400 }}
                      title={pago ? "Fecha del pago ya debitado en el banco" : "Vencimiento de la factura"}>
                      {vtoMostrar ? fmtDate(vtoMostrar) : "—"}
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      <select value={e.cuentaId} onChange={ev => setEd(row.id, { cuentaId: ev.target.value })} style={sel}>
                        <option value="">— cuenta —</option>
                        {cuentasEgreso.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      <select value={e.centro} onChange={ev => setEd(row.id, { centro: ev.target.value })}
                        style={{ ...sel, borderColor: e.centro ? T.cardBorder : "#f59e0b", background: e.centro ? "#fff" : "#fffbeb" }}>
                        <option value="">⚠ centro</option>
                        {centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </td>
                    <td style={num(false)}>{fmtMoney(linea.subtotal ?? row.total, row.moneda || "ARS")}</td>
                    <td style={{ ...num(false), color:T.muted }}>{(linea.iva_monto || 0) > 0 ? fmtMoney(linea.iva_monto, row.moneda || "ARS") : "—"}</td>
                    <td style={num(true)}>{fmtMoney(row.total, row.moneda || "ARS")}</td>
                    <td style={{ padding:"9px 10px", whiteSpace:"nowrap", textAlign:"right" }}>
                      <button onClick={(ev) => {
                          if (menuOpen?.id === row.id) { setMenuOpen(null); return; }
                          const r = ev.currentTarget.getBoundingClientRect();
                          setMenuOpen({ id: row.id, top: r.bottom + 4, left: Math.max(8, r.right - 210) });
                        }} disabled={enCurso}
                        style={{ background: menuOpen?.id===row.id ? "#e5e7eb" : "#f3f4f6", border:`1px solid ${T.cardBorder}`,
                          borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:13, color:T.muted, fontFamily:T.font }}>
                        {enCurso ? "…" : "⋯"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      ))}

      {/* Dropdown de acciones — position:fixed para no cortarse dentro del contenedor con overflow. */}
      {menuOpen && (() => {
        const row = borradores.find(r => r.id === menuOpen.id);
        if (!row) return null;
        const e = ed(row); const ref = metaRef(row.nota);
        const listo = e.sociedad && e.cuentaId && e.centro;
        return (
          <div ref={menuRef} style={{ position:"fixed", top:menuOpen.top, left:menuOpen.left, zIndex:9999,
            background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:8, boxShadow:"0 8px 24px rgba(0,0,0,.15)", minWidth:200, overflow:"hidden" }}>
            {item("Contabilizar ✓", () => contabilizar(row), "#16a34a", !listo)}
            {item("Abrir para editar (varios centros)", () => setEditar(row))}
            {ref && item("Ver mail", () => window.open(gmailUrl(ref), "_blank"))}
            <div style={{ height:1, background:T.cardBorder, margin:"3px 0" }} />
            {item("Ignorar", () => ignorar(row), T.red)}
          </div>
        );
      })()}
    </div>
  );
}
