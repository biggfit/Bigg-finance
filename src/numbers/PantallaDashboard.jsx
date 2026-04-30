import { useState, useEffect, useMemo } from "react";
import { T, fmtMoney, fmtDate } from "./theme";
import {
  fetchEgresos, fetchIngresos, fetchPagosCobros,
  calcSaldoPendiente, calcEstadoEgreso, calcEstadoIngreso,
  fetchMovTesoreria, fetchCuentasBancarias,
} from "../lib/numbersApi";
import { TIPO_CUENTA } from "../data/tesoreriaData";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function diasHasta(fechaStr) {
  if (!fechaStr) return null;
  const d = new Date(fechaStr + "T00:00:00");
  return Math.ceil((d - new Date()) / 86400000);
}

// ─── Componentes ──────────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{ fontSize:11, fontWeight:700, letterSpacing:".08em",
      textTransform:"uppercase", color:T.muted, marginBottom:14 }}>
      {children}
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
      borderRadius:T.radius, boxShadow:T.shadow, ...style }}>
      {children}
    </div>
  );
}

function MpField({ sociedad }) {
  const storageKey = `mp_acred_${sociedad}`;
  const [monto, setMonto]   = useState(() => Number(localStorage.getItem(storageKey)) || 0);
  const [editing, setEditing] = useState(false);
  const [input, setInput]   = useState("");

  useEffect(() => {
    setMonto(Number(localStorage.getItem(`mp_acred_${sociedad}`)) || 0);
  }, [sociedad]);

  const save = () => {
    const v = Number(input) || 0;
    setMonto(v);
    localStorage.setItem(storageKey, String(v));
    setEditing(false);
  };

  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
      padding:"10px 14px", background:"#f0fdf4", borderRadius:8,
      borderLeft:`3px solid #22c55e` }}>
      <span style={{ fontSize:12, color:"#16a34a", fontWeight:700 }}>🏦 Mercado Pago</span>
      {editing ? (
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <input autoFocus type="number" value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            style={{ width:110, padding:"4px 8px", fontSize:12, fontFamily:T.mono,
              border:`1px solid #22c55e`, borderRadius:6, outline:"none" }} />
          <button onClick={save} style={{ background:"#16a34a", color:"#fff", border:"none",
            borderRadius:5, padding:"4px 10px", fontSize:11, cursor:"pointer", fontFamily:T.font }}>
            OK
          </button>
        </div>
      ) : (
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:13, fontFamily:T.mono, color:"#16a34a", fontWeight:700 }}>
            {monto > 0 ? fmtMoney(monto) : <span style={{ color:T.dim, fontStyle:"italic", fontSize:11 }}>sin dato</span>}
          </span>
          <button onClick={() => { setInput(monto ? String(monto) : ""); setEditing(true); }}
            title="Editar acreditación esperada"
            style={{ background:"none", border:"none", cursor:"pointer", color:T.dim,
              fontSize:13, lineHeight:1, padding:"2px 4px" }}>✏</button>
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function PantallaDashboard({ sociedad = "nako" }) {
  const [movs,     setMovs]     = useState([]);
  const [cuentas,  setCuentas]  = useState([]);
  const [egresos,  setEgresos]  = useState([]);
  const [ingresos, setIngresos] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [cajaOpen, setCajaOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [egs, ings, pcs, movimientos, cbs] = await Promise.all([
          fetchEgresos(sociedad),
          fetchIngresos(sociedad),
          fetchPagosCobros(sociedad).catch(() => []),
          fetchMovTesoreria(sociedad),
          fetchCuentasBancarias(),
        ]);
        if (cancelled) return;

        const pagos  = (pcs ?? []).filter(p => p.tipo === "PAGO_FC" || p.tipo === "EGRESO_GASTO");
        const cobros = (pcs ?? []).filter(p => p.tipo === "COBRO_FC");

        setEgresos((egs ?? []).map(doc => {
          const docPagos = pagos.filter(p => p.documento_id === doc.id);
          const saldo = calcSaldoPendiente(doc.total, docPagos);
          return { ...doc, importe: Number(doc.total) || 0, saldoPendiente: saldo,
                   estado: calcEstadoEgreso(saldo, doc.total, doc.vto) };
        }));
        setIngresos((ings ?? []).map(doc => {
          const docCobros = cobros.filter(c => c.documento_id === doc.id);
          const saldo = calcSaldoPendiente(doc.total, docCobros);
          return { ...doc, importe: Number(doc.total) || 0, saldoPendiente: saldo,
                   estado: calcEstadoIngreso(saldo, doc.total, doc.vto) };
        }));
        setMovs(movimientos ?? []);
        setCuentas((cbs ?? []).filter(c =>
          (c.sociedad ?? "").toLowerCase() === (sociedad ?? "").toLowerCase()
        ));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sociedad]);

  // ── Saldos por cuenta ──────────────────────────────────────────────────────
  const saldosCuenta = useMemo(() =>
    cuentas.map(c => ({
      ...c,
      saldo: movs.filter(m => m.cuenta_bancaria === c.id)
                 .reduce((s, m) => s + (Number(m.monto) || 0), 0),
    })),
    [cuentas, movs]
  );

  const totalARS = useMemo(() =>
    saldosCuenta.filter(c => c.moneda === "ARS").reduce((s, c) => s + c.saldo, 0),
    [saldosCuenta]
  );
  const totalUSD = useMemo(() =>
    saldosCuenta.filter(c => c.moneda === "USD").reduce((s, c) => s + c.saldo, 0),
    [saldosCuenta]
  );
  const totalEUR = useMemo(() =>
    saldosCuenta.filter(c => c.moneda === "EUR").reduce((s, c) => s + c.saldo, 0),
    [saldosCuenta]
  );

  // ── Pendientes ─────────────────────────────────────────────────────────────
  const porPagar  = useMemo(() => egresos.filter(e  => e.estado === "a_pagar"  || e.estado === "vencido"), [egresos]);
  const porCobrar = useMemo(() => ingresos.filter(i => i.estado === "a_cobrar" || i.estado === "vencido"), [ingresos]);

  const totalPorPagar  = porPagar.reduce((s, e)  => s + (e.saldoPendiente  ?? e.importe), 0);
  const totalPorCobrar = porCobrar.reduce((s, i) => s + (i.saldoPendiente ?? i.importe), 0);

  const totalPorPagarARS  = porPagar.filter(e => (e.moneda ?? "ARS") === "ARS").reduce((s, e) => s + (e.saldoPendiente ?? e.importe), 0);
  const totalPorPagarUSD  = porPagar.filter(e => (e.moneda ?? "") === "USD").reduce((s, e) => s + (e.saldoPendiente ?? e.importe), 0);
  const totalPorPagarEUR  = porPagar.filter(e => (e.moneda ?? "") === "EUR").reduce((s, e) => s + (e.saldoPendiente ?? e.importe), 0);
  const totalPorCobrarARS = porCobrar.filter(i => (i.moneda ?? "ARS") === "ARS").reduce((s, i) => s + (i.saldoPendiente ?? i.importe), 0);
  const totalPorCobrarUSD = porCobrar.filter(i => (i.moneda ?? "") === "USD").reduce((s, i) => s + (i.saldoPendiente ?? i.importe), 0);
  const totalPorCobrarEUR = porCobrar.filter(i => (i.moneda ?? "") === "EUR").reduce((s, i) => s + (i.saldoPendiente ?? i.importe), 0);

  const vencidosEg = porPagar.filter(e => e.estado === "vencido");
  const vencidosIn = porCobrar.filter(i => i.estado === "vencido");

  const proxVencimientos = useMemo(() =>
    [...porPagar]
      .filter(e => e.vto)
      .sort((a, b) => a.vto > b.vto ? 1 : -1)
      .slice(0, 8),
    [porPagar]
  );

  if (loading) return (
    <div style={{ padding:"60px 32px", textAlign:"center", color:T.muted, fontSize:14 }}>
      Cargando…
    </div>
  );

  return (
    <div style={{ padding:"28px 32px", maxWidth:900 }} className="fade">
      <h1 style={{ fontSize:24, fontWeight:900, color:T.text, margin:"0 0 28px", letterSpacing:"-.02em" }}>
        Dashboard
      </h1>

      {/* ── Bloque 1: Caja ─────────────────────────────────────────────────── */}
      <SectionLabel>Disponible en caja</SectionLabel>
      <Card style={{ marginBottom:24 }}>
        <div style={{ padding:"16px 24px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            <div style={{ flex:1 }}>
              {[
                { label:"ARS", total:totalARS },
                totalUSD !== 0 && { label:"USD", total:totalUSD },
                totalEUR !== 0 && { label:"EUR", total:totalEUR },
              ].filter(Boolean).map(({ label, total }, i, arr) => (
                <div key={label} style={{ display:"flex", justifyContent:"space-between",
                  alignItems:"center", padding:"10px 0",
                  borderBottom: i < arr.length - 1 ? `1px solid ${T.cardBorder}` : "none" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:T.muted,
                    background:"#f3f4f6", borderRadius:4, padding:"2px 7px", letterSpacing:".05em" }}>
                    {label}
                  </span>
                  <span style={{ fontSize:18, fontWeight:900, fontFamily:T.mono,
                    color: total < 0 ? T.red : T.text }}>
                    {fmtMoney(total, label)}
                  </span>
                </div>
              ))}
            </div>
            <button onClick={() => setCajaOpen(v => !v)} style={{
              flexShrink:0, background:"none", border:`1px solid ${T.cardBorder}`,
              borderRadius:8, padding:"7px 16px", fontSize:12, color:T.muted,
              cursor:"pointer", fontFamily:T.font, display:"flex", alignItems:"center", gap:6,
            }}>
              {cajaOpen ? "Ocultar" : "Ver cuentas"}
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                style={{ transform: cajaOpen ? "rotate(180deg)" : "none", transition:"transform .2s" }}>
                <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        {cajaOpen && saldosCuenta.length > 0 && (
          <div style={{ borderTop:`1px solid ${T.cardBorder}`, padding:"16px 28px 20px",
            display:"flex", flexWrap:"wrap", gap:12 }}>
            {saldosCuenta.map(c => {
              const icon = TIPO_CUENTA[(c.tipo ?? "").toLowerCase()]?.icon ?? "💳";
              return (
                <div key={c.id} style={{ background:"#f9fafb", borderRadius:8,
                  padding:"10px 16px", border:`1px solid ${T.cardBorder}`, minWidth:150 }}>
                  <div style={{ fontSize:11, color:T.muted, marginBottom:5 }}>{icon} {c.nombre}</div>
                  <div style={{ fontSize:16, fontWeight:800, fontFamily:T.mono,
                    color: c.saldo < 0 ? T.red : T.text }}>
                    {fmtMoney(c.saldo, c.moneda)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Bloque 2: Por pagar / Por cobrar ───────────────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:24 }}>

        {/* Por pagar */}
        <div>
          <SectionLabel>Por pagar</SectionLabel>
          <Card style={{ padding:"20px 24px" }}>
            <div style={{ display:"flex", flexDirection:"column", gap:0, marginBottom:14 }}>
              {[
                { label:"ARS", total:totalPorPagarARS },
                totalPorPagarUSD > 0 && { label:"USD", total:totalPorPagarUSD },
                totalPorPagarEUR > 0 && { label:"EUR", total:totalPorPagarEUR },
              ].filter(Boolean).map(({ label, total }, i, arr) => (
                <div key={label} style={{ display:"flex", justifyContent:"space-between",
                  alignItems:"center", padding:"10px 0",
                  borderBottom: i < arr.length - 1 ? `1px solid ${T.cardBorder}` : "none" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:T.muted,
                    background:"#f3f4f6", borderRadius:4, padding:"2px 7px", letterSpacing:".05em" }}>
                    {label}
                  </span>
                  <span style={{ fontSize:18, fontWeight:900, fontFamily:T.mono,
                    color: total > 0 ? T.red : T.text }}>
                    {fmtMoney(total, label)}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {vencidosEg.length > 0 && (
                <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px",
                  background:"#fff5f5", borderRadius:8, borderLeft:`3px solid ${T.red}` }}>
                  <span style={{ fontSize:12, color:T.red, fontWeight:700 }}>
                    ⚠ Vencido ({vencidosEg.length})
                  </span>
                  <span style={{ fontSize:12, fontFamily:T.mono, color:T.red, fontWeight:700 }}>
                    {fmtMoney(vencidosEg.reduce((s, e) => s + (e.saldoPendiente ?? e.importe), 0))}
                  </span>
                </div>
              )}
              <div style={{ display:"flex", justifyContent:"space-between",
                padding:"6px 0", borderBottom:`1px solid ${T.cardBorder}` }}>
                <span style={{ fontSize:12, color:T.muted }}>Comprobantes pendientes</span>
                <span style={{ fontSize:13, fontWeight:700 }}>{porPagar.length}</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0" }}>
                <span style={{ fontSize:12, color:T.muted }}>Al día</span>
                <span style={{ fontSize:13, fontWeight:700 }}>{porPagar.length - vencidosEg.length}</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Por cobrar */}
        <div>
          <SectionLabel>Por cobrar</SectionLabel>
          <Card style={{ padding:"20px 24px" }}>
            <div style={{ display:"flex", flexDirection:"column", gap:0, marginBottom:14 }}>
              {[
                { label:"ARS", total:totalPorCobrarARS },
                totalPorCobrarUSD > 0 && { label:"USD", total:totalPorCobrarUSD },
                totalPorCobrarEUR > 0 && { label:"EUR", total:totalPorCobrarEUR },
              ].filter(Boolean).map(({ label, total }, i, arr) => (
                <div key={label} style={{ display:"flex", justifyContent:"space-between",
                  alignItems:"center", padding:"10px 0",
                  borderBottom: i < arr.length - 1 ? `1px solid ${T.cardBorder}` : "none" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:T.muted,
                    background:"#f3f4f6", borderRadius:4, padding:"2px 7px", letterSpacing:".05em" }}>
                    {label}
                  </span>
                  <span style={{ fontSize:18, fontWeight:900, fontFamily:T.mono,
                    color: total > 0 ? T.green : T.text }}>
                    {fmtMoney(total, label)}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {vencidosIn.length > 0 && (
                <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px",
                  background:"#fff5f5", borderRadius:8, borderLeft:`3px solid ${T.red}` }}>
                  <span style={{ fontSize:12, color:T.red, fontWeight:700 }}>
                    ⚠ Vencido ({vencidosIn.length})
                  </span>
                  <span style={{ fontSize:12, fontFamily:T.mono, color:T.red, fontWeight:700 }}>
                    {fmtMoney(vencidosIn.reduce((s, i) => s + (i.saldoPendiente ?? i.importe), 0))}
                  </span>
                </div>
              )}
              <MpField sociedad={sociedad} />
              <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0" }}>
                <span style={{ fontSize:12, color:T.muted }}>Comprobantes pendientes</span>
                <span style={{ fontSize:13, fontWeight:700 }}>{porCobrar.length}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* ── Bloque 3: Próximos vencimientos ────────────────────────────────── */}
      {proxVencimientos.length > 0 && (
        <>
          <SectionLabel>Próximos vencimientos</SectionLabel>
          <Card style={{ overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <tbody>
                {proxVencimientos.map((e, i) => {
                  const dias = diasHasta(e.vto);
                  const vencido = dias !== null && dias <= 0;
                  const urgente = dias !== null && dias > 0 && dias <= 7;
                  return (
                    <tr key={e.id}
                      style={{ borderBottom: i < proxVencimientos.length - 1 ? `1px solid ${T.cardBorder}` : "none" }}>
                      <td style={{ padding:"11px 24px", width:100 }}>
                        <div style={{ fontSize:12, fontWeight:700,
                          color: vencido ? T.red : urgente ? T.orange : T.muted }}>
                          {fmtDate(e.vto)}
                        </div>
                      </td>
                      <td style={{ padding:"11px 8px", fontSize:13, color:T.text, fontWeight:600 }}>
                        {e.proveedor ?? "—"}
                      </td>
                      <td style={{ padding:"11px 8px", fontSize:12, color:T.muted }}>
                        {e.concepto ?? ""}
                      </td>
                      <td style={{ padding:"11px 24px", textAlign:"right" }}>
                        <span style={{ fontSize:13, fontFamily:T.mono, fontWeight:700, color:T.red }}>
                          {fmtMoney(e.saldoPendiente ?? e.importe, e.moneda)}
                        </span>
                      </td>
                      <td style={{ padding:"11px 20px 11px 0", textAlign:"right", width:70 }}>
                        {dias !== null && (
                          <span style={{ fontSize:10, fontWeight:700, borderRadius:4, padding:"3px 7px",
                            background: vencido ? "#fee2e2" : urgente ? "#fef3c7" : "#f3f4f6",
                            color: vencido ? T.red : urgente ? T.orange : T.muted }}>
                            {vencido ? `−${Math.abs(dias)}d` : dias === 0 ? "Hoy" : `en ${dias}d`}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
