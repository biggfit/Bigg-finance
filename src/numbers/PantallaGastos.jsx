import { useState, useMemo, useEffect } from "react";
import { T, fmtMoney, fmtDate, PageHeader, Btn } from "./theme";
import { TIPO_CUENTA } from "../data/tesoreriaData";
import {
  fetchGastos, deleteGasto, appendGastoDirecto,
  fetchCuentasBancarias, fetchCuentas, fetchCentrosCosto, fetchProveedores,
} from "../lib/numbersApi";
import { CENTROS_COSTO as CENTROS_COSTO_STATIC } from "../data/numbersData";
import { makeResolveCC, makeResolveCB } from "./formUtils.jsx";
import FiltroFecha, { useFiltroFecha } from "./FiltroFecha";

// ─── Formulario: Nuevo Gasto Directo ─────────────────────────────────────────
function FormNuevoGasto({ sociedad, cuentasBancarias, cuentas, centrosCosto, proveedores, onClose, onSaved }) {
  const cuentasSoc = cuentasBancarias.filter(
    c => (c.sociedad ?? "").toLowerCase() === (sociedad ?? "").toLowerCase()
  );

  const cuentasGasto = useMemo(() => {
    const f = cuentas.filter(c => {
      const t = (c.tipo ?? "").toLowerCase();
      return t === "gasto" || t === "gastos" || t === "financiero" || t === "egresos";
    });
    return f.length > 0 ? f : cuentas;
  }, [cuentas]);

  const newRow = () => ({
    _id:             Date.now() + Math.random(),
    fecha:           new Date().toISOString().slice(0, 10),
    proveedorId:     "",
    cuenta_contable: "",
    cc:              "",
    subtotal:        "",
    ivaRate:         "0",
    medioPago:       "",
  });

  const [rows, setRows]     = useState([newRow()]);
  const [saving, setSaving] = useState(false);

  const upd = (id, k, v) => setRows(rs => rs.map(r => r._id === id ? { ...r, [k]: v } : r));
  const del = (id)         => setRows(rs => rs.length > 1 ? rs.filter(r => r._id !== id) : rs);

  const getMoneda = (medioPagoId) => cuentasSoc.find(c => c.id === medioPagoId)?.moneda ?? "ARS";
  const calcTotal = (r) => (Number(r.subtotal) || 0) * (1 + (Number(r.ivaRate) || 0) / 100);
  const isValid   = (r) => r.fecha && r.cuenta_contable && r.cc && r.medioPago && Number(r.subtotal) > 0;
  const validRows = rows.filter(isValid);
  const canSave   = validRows.length > 0;

  const handleGuardar = async () => {
    setSaving(true);
    try {
      await Promise.all(validRows.map(r => {
        const prov = proveedores.find(p => p.id === r.proveedorId);
        return appendGastoDirecto({
          sociedad,
          fecha:              r.fecha,
          cuenta_contable:    r.cuenta_contable,
          cuenta_contable_id: cuentasGasto.find(c => c.nombre === r.cuenta_contable)?.id ?? "",
          cc:                 r.cc,
          moneda:             getMoneda(r.medioPago),
          subtotal:           Number(r.subtotal) || 0,
          ivaRate:            Number(r.ivaRate) || 0,
          nota:               [r.cuenta_contable, cuentasSoc.find(c => c.id === r.medioPago)?.nombre].filter(Boolean).join(" · "),
          cuenta_bancaria:    r.medioPago,
          proveedor_id:       prov?.id ?? "",
          proveedor_nombre:   prov?.nombre ?? "",
        });
      }));
      onSaved();
    } catch (e) {
      alert("Error al guardar: " + e.message);
      setSaving(false);
    }
  };

  const ci = {
    width:"100%", background:"#fff", border:"1px solid #d1d5db", borderRadius:5,
    padding:"6px 8px", fontSize:12, color:T.text, fontFamily:T.font,
    outline:"none", boxSizing:"border-box",
  };

  return (
    <div className="fade" style={{ padding:"28px 32px" }}>
      {/* Header */}
      <div style={{ background:"#78350f", borderRadius:T.radius, padding:"14px 24px",
        display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div>
          <div style={{ fontSize:16, fontWeight:900, color:"#fbbf24" }}>Gastos Directos</div>
          <div style={{ fontSize:11, color:"rgba(251,191,36,.5)", marginTop:3 }}>
            Afectan P&amp;L y Tesorería · La moneda se toma de la caja/banco seleccionado
          </div>
        </div>
        <button onClick={onClose} style={{ background:"transparent", border:"none",
          color:"rgba(251,191,36,.7)", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:T.font }}>
          ← Volver
        </button>
      </div>

      {/* Tabla */}
      <div style={{ background:"#fff", border:`1px solid ${T.cardBorder}`, borderRadius:10,
        overflow:"hidden", boxShadow:T.shadow }}>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
            <colgroup>{[110, 0, 0, 0, 92, 66, 102, 0, 36].map((w, i) => (
              <col key={i} style={w ? { width:w } : {}} />
            ))}</colgroup>
            <thead>
              <tr style={{ background:"#78350f" }}>
                {[
                  ["Fecha","left"], ["Proveedor / Concepto","left"],
                  ["Cuenta Contable","left"], ["Centro de Costo","left"],
                  ["Subtotal","right"], ["IVA","center"],
                  ["Total","right"], ["Forma de Pago","left"], ["","left"],
                ].map(([h, align]) => (
                  <th key={h} style={{ padding:"10px 10px", fontSize:11, fontWeight:700,
                    color:"#fbbf24", textAlign:align, letterSpacing:".06em",
                    textTransform:"uppercase", whiteSpace:"nowrap", overflow:"hidden",
                    textOverflow:"ellipsis" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const total  = calcTotal(r);
                const moneda = getMoneda(r.medioPago);
                const sym    = moneda === "USD" ? "U$D" : moneda === "EUR" ? "€" : "$";
                return (
                  <tr key={r._id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                    background: i%2===0 ? "#fff" : "#f9fafb" }}>

                    <td style={{ padding:"6px 8px" }}>
                      <input type="date" value={r.fecha}
                        onChange={e => upd(r._id, "fecha", e.target.value)} style={ci} />
                    </td>

                    <td style={{ padding:"6px 8px" }}>
                      <select value={r.proveedorId}
                        onChange={e => upd(r._id, "proveedorId", e.target.value)} style={ci}>
                        <option value="">— Sin proveedor —</option>
                        {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                    </td>

                    <td style={{ padding:"6px 8px" }}>
                      <select value={r.cuenta_contable}
                        onChange={e => upd(r._id, "cuenta_contable", e.target.value)} style={ci}>
                        <option value="">— Cuenta —</option>
                        {cuentasGasto.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                      </select>
                    </td>

                    <td style={{ padding:"6px 8px" }}>
                      <select value={r.cc}
                        onChange={e => upd(r._id, "cc", e.target.value)} style={ci}>
                        <option value="">— Sin CC —</option>
                        {centrosCosto.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </td>

                    <td style={{ padding:"6px 8px" }}>
                      <input type="number" value={r.subtotal} placeholder="0,00"
                        onChange={e => upd(r._id, "subtotal", e.target.value)}
                        style={{ ...ci, textAlign:"right", fontFamily:"var(--mono)" }} />
                    </td>

                    <td style={{ padding:"6px 8px" }}>
                      <select value={r.ivaRate}
                        onChange={e => upd(r._id, "ivaRate", e.target.value)} style={ci}>
                        {["0","10.5","21","27"].map(v => <option key={v} value={v}>{v}%</option>)}
                      </select>
                    </td>

                    <td style={{ padding:"6px 12px", fontFamily:"var(--mono)", fontSize:12,
                      fontWeight:700, color: total > 0 ? "#111" : T.dim,
                      textAlign:"right", whiteSpace:"nowrap" }}>
                      {total > 0 ? `${sym} ${total.toLocaleString("es-AR", { minimumFractionDigits:2 })}` : "—"}
                    </td>

                    <td style={{ padding:"6px 8px" }}>
                      <select value={r.medioPago}
                        onChange={e => upd(r._id, "medioPago", e.target.value)} style={ci}>
                        <option value="">— Caja / Banco —</option>
                        {cuentasSoc.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.nombre}{c.moneda && c.moneda !== "ARS" ? ` (${c.moneda})` : ""}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td style={{ padding:"6px 4px", textAlign:"center" }}>
                      <button onClick={() => del(r._id)} style={{
                        background:"transparent", border:`1px solid #fca5a5`,
                        borderRadius:5, padding:"4px 7px", cursor:"pointer",
                        fontSize:12, color:"#dc2626", lineHeight:1 }}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Agregar fila */}
        <div style={{ padding:"8px 12px", borderTop:`1px dashed ${T.cardBorder}` }}>
          <button onClick={() => setRows(rs => [...rs, newRow()])}
            style={{ background:"transparent", border:`1.5px dashed ${T.cardBorder}`,
              borderRadius:6, padding:"5px 14px", fontSize:12, color:T.muted,
              cursor:"pointer", fontFamily:T.font, fontWeight:600,
              display:"flex", alignItems:"center", gap:6 }}>
            + Agregar fila
          </button>
        </div>
      </div>

      {/* Footer */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:14 }}>
        <div style={{ fontSize:12, color:T.muted }}>
          {validRows.length > 0
            ? <span style={{ color:"#16a34a", fontWeight:700 }}>
                ✓ {validRows.length} gasto{validRows.length !== 1 ? "s" : ""} listo{validRows.length !== 1 ? "s" : ""} para guardar
              </span>
            : <span>Completá al menos 1 fila (cuenta contable + centro de costo + forma de pago + subtotal)</span>
          }
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={onClose}
            style={{ background:"#dc2626", border:"none", borderRadius:8, padding:"9px 22px",
              fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer", fontFamily:T.font }}>
            ← Cancelar
          </button>
          <button onClick={handleGuardar} disabled={!canSave || saving}
            style={{ background: canSave && !saving ? "#ca8a04" : "#9ca3af", border:"none",
              borderRadius:8, padding:"9px 22px", fontSize:13, fontWeight:700, color:"#fff",
              cursor: canSave && !saving ? "pointer" : "default", fontFamily:T.font }}>
            {saving ? "Guardando…" : `Registrar ${validRows.length > 0 ? validRows.length : ""} Gasto${validRows.length !== 1 ? "s" : ""} ✓`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pantalla: Lista de Gastos ────────────────────────────────────────────────
export default function PantallaGastos({ sociedad = "nako", subView = null, onSubViewChange }) {
  const [gastos, setGastos]                     = useState([]);
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState(null);
  const filtroFecha = useFiltroFecha();
  const [cuentasBancarias, setCuentasBancarias] = useState([]);
  const [cuentas, setCuentas]                   = useState([]);
  const [centrosCosto, setCentrosCosto]         = useState(CENTROS_COSTO_STATIC);
  const [proveedores, setProveedores]           = useState([]);
  const [busqueda, setBusqueda]                 = useState("");

  const resolveCC = useMemo(() => makeResolveCC(centrosCosto), [centrosCosto]);
  const resolveCB = useMemo(() => makeResolveCB(cuentasBancarias), [cuentasBancarias]);

  const cargar = async () => {
    setLoading(true);
    setError(null);
    try {
      setGastos(await fetchGastos(sociedad));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargar();
    fetchCuentasBancarias().then(d => setCuentasBancarias(Array.isArray(d) ? d : [])).catch(()=>{});
    fetchCuentas().then(d => { if (Array.isArray(d) && d.length > 0) setCuentas(d); }).catch(()=>{});
    fetchCentrosCosto().then(d => { if (Array.isArray(d) && d.length > 0) setCentrosCosto(d); }).catch(()=>{});
    fetchProveedores().then(d => { if (Array.isArray(d)) setProveedores(d); }).catch(()=>{});
  }, [sociedad]); // eslint-disable-line

  // ── Derivados (siempre antes de cualquier early return — Rules of Hooks) ──────
  const rows = useMemo(() => {
    const q = busqueda.toLowerCase();
    return gastos.filter(g => {
      const matchQ = !q ||
        (g.proveedor ?? "").toLowerCase().includes(q) ||
        (g.cuenta_contable ?? "").toLowerCase().includes(q) ||
        (g.nota ?? "").toLowerCase().includes(q) ||
        resolveCC(g.cc).toLowerCase().includes(q) ||
        resolveCB(g.cuentaBancaria).toLowerCase().includes(q);
      return matchQ && filtroFecha.inRange(g.fecha);
    });
  }, [gastos, busqueda, resolveCC, resolveCB, filtroFecha.inRange]);

  const handleEliminar = async (gasto) => {
    if (!confirm("¿Eliminar este gasto?")) return;
    try {
      await deleteGasto(gasto.rowId, gasto._movId);
      setGastos(prev => prev.filter(g => g.id !== gasto.id));
    } catch (e) {
      alert("Error al eliminar: " + e.message);
    }
  };

  // ── Formulario nuevo gasto ───────────────────────────────────────────────────
  if (subView === "new-gasto") {
    return (
      <FormNuevoGasto
        sociedad={sociedad}
        cuentasBancarias={cuentasBancarias}
        cuentas={cuentas}
        centrosCosto={centrosCosto}
        proveedores={proveedores}
        onClose={() => onSubViewChange?.("gastos")}
        onSaved={async () => { onSubViewChange?.("gastos"); await cargar(); }}
      />
    );
  }

  if (loading) return (
    <div style={{ padding:"60px 32px", textAlign:"center", color:T.muted, fontSize:14 }}>
      Cargando gastos…
    </div>
  );

  if (error) return (
    <div style={{ padding:"40px 32px" }}>
      <div style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:8,
        padding:"16px 20px", color:"#dc2626", fontSize:13 }}>
        <strong>Error al conectar con Google Sheets:</strong> {error}
      </div>
    </div>
  );

  return (
    <div style={{ padding:"28px 32px", maxWidth:1100 }} className="fade">
      <PageHeader
        title="Gastos Directos"
        subtitle="Pagados en el momento · afectan P&L y Tesorería"
        action={<Btn variant="accent" onClick={() => onSubViewChange?.("new-gasto")}>+ Nuevo Gasto</Btn>}
      />

      {/* Buscador */}
      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
        padding:"10px 14px", marginBottom:14, boxShadow:T.shadow,
        display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por cuenta contable, CC, forma de pago, nota…"
          style={{ flex:1, minWidth:200, background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
            borderRadius:8, padding:"7px 12px", fontSize:13, color:T.text,
            outline:"none", fontFamily:T.font }}
        />
        <FiltroFecha {...filtroFecha} />
      </div>

      {/* Tabla */}
      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
        boxShadow:T.shadow, overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:700 }}>
          <thead>
            <tr style={{ background:T.tableHead }}>
              {["Fecha","Proveedor","Cuenta Contable","Centro de Costo","Monto","Forma de Pago",""].map(h => (
                <th key={h} style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                  letterSpacing:".08em", textTransform:"uppercase", color:T.tableHeadText,
                  textAlign: h === "Monto" ? "right" : "left", whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={7} style={{ padding:32, textAlign:"center", color:T.dim, fontSize:13 }}>
                  {gastos.length === 0 ? "Sin gastos registrados" : "Sin resultados"}
                </td></tr>
              : rows.map((g, i) => (
                <tr key={g.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                  background: i%2===0 ? T.card : "#fafbfc", transition:"background .1s" }}
                  onMouseEnter={ev => ev.currentTarget.style.background="#fffbeb"}
                  onMouseLeave={ev => ev.currentTarget.style.background = i%2===0 ? T.card : "#fafbfc"}>

                  <td style={{ padding:"9px 14px", fontSize:12, color:T.muted, whiteSpace:"nowrap" }}>
                    {fmtDate(g.fecha)}
                  </td>

                  <td style={{ padding:"9px 14px", fontSize:12, color:T.text, fontWeight:500,
                    maxWidth:160, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {g.proveedor || g.nota || <span style={{ color:T.dim }}>—</span>}
                  </td>

                  <td style={{ padding:"9px 14px", fontSize:12, color:T.text, fontWeight:500 }}>
                    {g.cuenta_contable || <span style={{ color:T.dim }}>—</span>}
                  </td>

                  <td style={{ padding:"9px 14px" }}>
                    {g.cc
                      ? <span style={{ fontSize:11, background:"#f3f4f6", color:T.muted,
                          borderRadius:6, padding:"2px 8px", fontWeight:600 }}>
                          {resolveCC(g.cc)}
                        </span>
                      : <span style={{ color:T.dim, fontSize:11 }}>—</span>}
                  </td>

                  <td style={{ padding:"9px 14px", textAlign:"right", fontFamily:"var(--mono)",
                    fontSize:12, fontWeight:700, color:"#dc2626", whiteSpace:"nowrap" }}>
                    {fmtMoney(g.total, g.moneda)}
                  </td>

                  <td style={{ padding:"9px 14px", fontSize:12, color:T.muted }}>
                    {g.cuentaBancaria
                      ? (() => {
                          const cb = cuentasBancarias.find(c => c.id === g.cuentaBancaria);
                          const icon = TIPO_CUENTA[(cb?.tipo ?? "").toLowerCase()]?.icon ?? "💳";
                          return `${icon} ${cb?.nombre ?? g.cuentaBancaria}`;
                        })()
                      : <span style={{ color:T.dim }}>—</span>}
                  </td>

                  <td style={{ padding:"9px 10px", textAlign:"center" }}>
                    <button
                      onClick={() => handleEliminar(g)}
                      title="Eliminar gasto"
                      style={{ background:"transparent", border:`1px solid #fca5a5`,
                        borderRadius:5, padding:"3px 8px", cursor:"pointer",
                        fontSize:12, color:"#dc2626", lineHeight:1, fontFamily:T.font }}>
                      🗑
                    </button>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}
