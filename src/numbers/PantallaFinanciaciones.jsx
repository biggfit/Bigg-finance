import { useState, useEffect, useMemo, Fragment } from "react";
import { T, Badge, PageHeader, Btn, CompactCard, fmtMoney, fmtDate } from "./theme";
import {
  fetchFinanciaciones, appendFinanciacion, generarCuotas,
  pagarCuota, cancelarFinanciacion, deleteFinanciacion,
  fetchCuentas, fetchCentrosCosto, fetchCuentasBancarias, fetchProveedores,
  fetchAnticipos, appendAnticipo, deleteAnticipo, fetchClientes, fetchIngresos, shortId,
} from "../lib/numbersApi";
import { parsePlanPdf } from "./parsers/planPdf";

// ─── Config por tipo (planes AFIP vs créditos comparten todo, cambian labels/default) ──
const TIPOS = {
  plan_afip: { label: "Planes", nuevoLabel: "Nuevo plan de pago", acreedorLabel: "Organismo (AFIP / ARCA)", capitalEsGasto: true },
  prestamo:  { label: "Préstamos", nuevoLabel: "Nuevo crédito",   acreedorLabel: "Banco / acreedor",          capitalEsGasto: false },
};
const ESTADO_FIN = {
  vigente: { label: "Vigente", bg: T.blueBg,  color: T.blue },
  saldado: { label: "Saldado", bg: T.greenBg, color: T.green },
};
const ESTADO_CUOTA = {
  pendiente: { label: "Pendiente", bg: "#f3f4f6", color: "#374151" },
  pagada:    { label: "Pagada",    bg: T.greenBg, color: T.green },
  cancelada: { label: "Cancelada", bg: "#f3f4f6", color: T.dim },
};
const ESTADO_ANT = {
  disponible: { label: "Disponible", bg: T.blueBg,  color: T.blue },
  consumido:  { label: "Consumido",  bg: T.greenBg, color: T.green },
};
const DEF_INTERES = "Perdidas Financieras";   // nombre exacto de la cuenta (sin acento)
const DEF_IVA     = "IVA";

// Componentes de la cuota que pegan al P&L, cada uno con su cuenta + centro de costo propios
// (ej. capital → "Impuestos", interés → "Financieros"). soloPlan = solo aplica a planes AFIP.
const COMPONENTES = [
  { key: "capital",   label: "Capital (impuesto)",   cuentaK: "cuenta_capital",   centroK: "centro_capital",   soloPlan: true },
  { key: "interes",   label: "Interés financiero (+ resarcitorio)", cuentaK: "cuenta_interes", centroK: "centro_interes" },
  { key: "iva",       label: "IVA",                  cuentaK: "cuenta_iva",       centroK: "centro_iva" },
  { key: "impuestos", label: "Sellos / otros imp.",  cuentaK: "cuenta_impuestos", centroK: "centro_impuestos" },
];

function SectionCard({ title, children, cols = "1fr 1fr 1fr" }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, padding: 18, boxShadow: T.shadow, marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: T.dim, marginBottom: 12 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 14 }}>{children}</div>
    </div>
  );
}

const num = v => Number(v) || 0;

// Totaliza un saldo POR MONEDA (no mezclar ARS/USD/EUR). Devuelve [[moneda, total], …] no-cero.
const montosPorMoneda = (items, getSaldo) => {
  const t = {};
  for (const it of items) { const m = it.moneda || "ARS"; t[m] = (t[m] || 0) + getSaldo(it); }
  return Object.entries(t).filter(([, v]) => Math.abs(v) > 0.01);
};

// ─── input chico para celdas del cronograma ───────────────────────────────────
function Cell({ value, onChange, type = "number", w = 96 }) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)}
      style={{ width: w, background: "#eceff3", border: `1px solid ${T.cardBorder}`,
        borderRadius: 6, padding: "5px 7px", fontSize: 12, color: T.text,
        fontFamily: T.font, outline: "none", boxSizing: "border-box", textAlign: type === "number" ? "right" : "left" }} />
  );
}
function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: T.muted, fontWeight: 600, display: "block", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}
const inputStyle = {
  width: "100%", background: "#eceff3", border: `1px solid ${T.cardBorder}`,
  borderRadius: 8, padding: "8px 12px", fontSize: 13, color: T.text,
  fontFamily: T.font, outline: "none", boxSizing: "border-box",
};

export default function PantallaFinanciaciones({ sociedad }) {
  const [tab, setTab]         = useState("plan_afip");
  const [planes, setPlanes]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView]       = useState({ mode: "list" });   // list | alta | detalle
  const [cuentas, setCuentas] = useState([]);
  const [centros, setCentros] = useState([]);
  const [bancos,  setBancos]  = useState([]);
  const [proveedores, setProveedores] = useState([]);

  function reload() {
    setLoading(true);
    fetchFinanciaciones(sociedad).then(setPlanes).catch(() => setPlanes([])).finally(() => setLoading(false));
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [sociedad]);
  useEffect(() => {
    fetchCuentas().then(setCuentas).catch(() => {});
    fetchCentrosCosto().then(setCentros).catch(() => {});
    fetchCuentasBancarias().then(setBancos).catch(() => {});
    fetchProveedores().then(setProveedores).catch(() => {});
  }, []);

  const planesTab = useMemo(() => planes.filter(p => p.tipo === tab), [planes, tab]);
  const bancosSoc = useMemo(() => bancos.filter(b => !b.sociedad || b.sociedad === sociedad), [bancos, sociedad]);
  const deudaMon = useMemo(() => montosPorMoneda(planesTab, p => p.saldo), [planesTab]);

  if (view.mode === "alta") {
    return <AltaFinanciacion tipo={tab} sociedad={sociedad} cuentas={cuentas} centros={centros} bancos={bancosSoc} proveedores={proveedores}
      onCancel={() => setView({ mode: "list" })}
      onSaved={() => { setView({ mode: "list" }); reload(); }} />;
  }
  if (view.mode === "detalle") {
    return <DetalleFinanciacion plan={view.plan} bancos={bancosSoc}
      onBack={() => setView({ mode: "list" })}
      onChanged={() => { reload(); setView({ mode: "list" }); }} />;
  }

  const PILLS = [["plan_afip", "Planes"], ["prestamo", "Préstamos"], ["anticipo", "Anticipos"]];

  return (
    <div className="fade" style={{ padding: "28px 32px" }}>
      <PageHeader title="Financiaciones" subtitle="Planes de pago AFIP, créditos tomados y anticipos de clientes"
        action={tab !== "anticipo" ? <Btn variant="accent" onClick={() => setView({ mode: "alta" })}>+ {tab === "plan_afip" ? "Nuevo plan" : "Nuevo crédito"}</Btn> : null} />

      {/* Sub-tabs Planes / Préstamos / Anticipos */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {PILLS.map(([k, label]) => {
          const active = tab === k;
          return (
            <button key={k} onClick={() => { setTab(k); setView({ mode: "list" }); }} style={{
              border: "none", borderRadius: 999, padding: "7px 18px", cursor: "pointer",
              fontFamily: T.font, fontSize: 13, fontWeight: 700,
              background: active ? T.accentDark : "#fff", color: active ? T.accent : T.muted,
              boxShadow: active ? "none" : `inset 0 0 0 1px ${T.cardBorder}`,
            }}>{label}</button>
          );
        })}
      </div>

      {tab === "anticipo" ? <TabAnticipos sociedad={sociedad} bancos={bancosSoc} /> : <>

      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        {(deudaMon.length ? deudaMon : [["ARS", 0]]).map(([m, v]) => (
          <CompactCard key={m} label={`Deuda vigente${deudaMon.length > 1 ? " " + m : ""}`} value={fmtMoney(v, m)} color={v > 0 ? T.red : T.green} />
        ))}
        <CompactCard label={TIPOS[tab].label} value={String(planesTab.length)} />
      </div>

      {loading ? (
        <div style={{ color: T.dim, fontSize: 13, padding: "40px 0", textAlign: "center" }}>Cargando…</div>
      ) : planesTab.length === 0 ? (
        <div style={{ color: T.dim, fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          No hay {TIPOS[tab].label.toLowerCase()} cargados.
        </div>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, overflow: "hidden", boxShadow: T.shadow }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.tableHead, color: T.tableHeadText }}>
                {["Estado", "Acreedor", "Nº Plan", "Cuenta capital", "Capital", "Pagado", "Saldo", "Próx. vto", "Cuotas", ""].map((h, i) => (
                  <th key={i} style={{ padding: "9px 12px", textAlign: "center", fontSize: 11, fontWeight: 700, letterSpacing: ".04em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {planesTab.map(p => (
                <tr key={p.plan_id} style={{ borderTop: `1px solid ${T.cardBorder}`, cursor: "pointer" }}
                  onClick={() => setView({ mode: "detalle", plan: p })}
                  onMouseEnter={e => e.currentTarget.style.background = "#fafafa"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "9px 12px", textAlign: "center" }}><Badge estado={p.estado} cfg={ESTADO_FIN} /></td>
                  <td style={{ padding: "9px 12px", textAlign: "center", fontWeight: 600, color: T.text }}>{p.acreedor_nombre || "—"}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center", color: T.muted, fontFamily: T.mono, fontSize: 12 }}>{p.nro_plan || "—"}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center", color: T.muted, fontSize: 12 }}>{String(p.cuenta_capital || "").replace(/^CUENTA_/, "") || "—"}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: T.mono, color: T.text, fontWeight: 600 }}>{fmtMoney(p.capital_total, p.moneda)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: T.mono, color: T.green }}>{fmtMoney(p.capital_pagado, p.moneda)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: T.mono, fontWeight: 700, color: p.saldo > 0 ? T.red : T.green }}>{fmtMoney(p.saldo, p.moneda)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center", color: T.muted }}>{fmtDate(p.prox_vto)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "center", color: T.muted }}>{p.n_pagadas}/{p.n_cuotas}</td>
                  <td style={{ padding: "9px 12px", color: T.dim, textAlign: "right" }}>›</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ANTICIPOS DE CLIENTES — alta + lista + detalle (consumos vs FCs)
// ════════════════════════════════════════════════════════════════════════════
function TabAnticipos({ sociedad, bancos }) {
  const [anticipos, setAnticipos] = useState([]);
  const [clientes, setClientes]   = useState([]);
  const [ingresos, setIngresos]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [alta, setAlta]           = useState(false);
  const [detalle, setDetalle]     = useState(null);

  function reload() {
    setLoading(true);
    fetchAnticipos(sociedad).then(setAnticipos).catch(() => setAnticipos([])).finally(() => setLoading(false));
  }
  useEffect(() => { reload(); fetchIngresos(sociedad).then(setIngresos).catch(() => {}); /* eslint-disable-next-line */ }, [sociedad]);
  useEffect(() => { fetchClientes().then(setClientes).catch(() => {}); }, []);
  const ingById = useMemo(() => new Map(ingresos.map(i => [i.id, i])), [ingresos]);

  const saldoMon = useMemo(() => montosPorMoneda(anticipos, a => a.saldo), [anticipos]);

  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 18, alignItems: "center" }}>
        {(saldoMon.length ? saldoMon : [["ARS", 0]]).map(([m, v]) => (
          <CompactCard key={m} label={`Saldo disponible${saldoMon.length > 1 ? " " + m : ""}`} value={fmtMoney(v, m)} color={T.blue} />
        ))}
        <CompactCard label="Anticipos" value={String(anticipos.length)} />
        <div style={{ marginLeft: "auto" }}><Btn variant="accent" onClick={() => setAlta(true)}>+ Nuevo anticipo</Btn></div>
      </div>

      {loading ? (
        <div style={{ color: T.dim, fontSize: 13, padding: "40px 0", textAlign: "center" }}>Cargando…</div>
      ) : anticipos.length === 0 ? (
        <div style={{ color: T.dim, fontSize: 13, padding: "40px 0", textAlign: "center" }}>No hay anticipos cargados.</div>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, overflow: "hidden", boxShadow: T.shadow }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.tableHead, color: T.tableHeadText }}>
                {["Estado", "Cliente", "Fecha", "Recibido", "Consumido", "Saldo", ""].map((h, i) => (
                  <th key={i} style={{ padding: "9px 12px", textAlign: i >= 3 && i <= 5 ? "right" : "left", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {anticipos.map(a => (
                <tr key={a.id} style={{ borderTop: `1px solid ${T.cardBorder}`, cursor: "pointer" }}
                  onClick={() => setDetalle(a)}
                  onMouseEnter={e => e.currentTarget.style.background = "#fafafa"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "9px 12px" }}><Badge estado={a.estado} cfg={ESTADO_ANT} /></td>
                  <td style={{ padding: "9px 12px", fontWeight: 600, color: T.text }}>{a.cliente_nombre || "—"}{a.es_apertura ? <span style={{ fontSize: 10, color: T.dim }}> · apertura</span> : ""}</td>
                  <td style={{ padding: "9px 12px", color: T.muted }}>{fmtDate(a.fecha)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: T.mono, color: T.text }}>{fmtMoney(a.monto, a.moneda)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: T.mono, color: T.muted }}>{fmtMoney(a.consumido, a.moneda)}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: T.mono, fontWeight: 700, color: a.saldo > 0 ? T.blue : T.green }}>{fmtMoney(a.saldo, a.moneda)}</td>
                  <td style={{ padding: "9px 12px", color: T.dim, textAlign: "right" }}>›</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {alta && <AltaAnticipo sociedad={sociedad} bancos={bancos} clientes={clientes}
        onCancel={() => setAlta(false)} onSaved={() => { setAlta(false); reload(); }} />}
      {detalle && <DetalleAnticipo anticipo={detalle} ingById={ingById} onBack={() => setDetalle(null)} onChanged={() => { setDetalle(null); reload(); }} />}
    </>
  );
}

function AltaAnticipo({ sociedad, bancos, clientes, onCancel, onSaved }) {
  const [f, setF] = useState({ cliente_id: "", monto: "", moneda: "ARS", fecha: new Date().toISOString().slice(0, 10), cuenta_bancaria: bancos[0]?.id || "", es_apertura: false, nota: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  // dedup por id (el maestro de clientes tiene ids repetidos → keys duplicadas en el select)
  const clientesOpts = useMemo(() => {
    const seen = new Set();
    return [...clientes].filter(c => c && c.activo !== false && !seen.has(c.id) && seen.add(c.id))
      .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || "")));
  }, [clientes]);
  const canSave = f.cliente_id && num(f.monto) > 0 && f.fecha && (f.es_apertura || f.cuenta_bancaria) && !busy;
  async function guardar() {
    if (!canSave) return;
    setBusy(true);
    try {
      const cli = clientes.find(c => String(c.id) === String(f.cliente_id));
      await appendAnticipo({ sociedad, cliente_id: f.cliente_id, cliente_nombre: cli?.nombre || "", fecha: f.fecha, monto: num(f.monto), moneda: f.moneda, cuenta_bancaria: f.cuenta_bancaria, es_apertura: f.es_apertura, nota: f.nota });
      onSaved();
    } catch (e) { alert("Error: " + (e?.message || e)); setBusy(false); }
  }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: T.radius, padding: 22, width: 440, boxShadow: T.shadowMd }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 800, color: T.text }}>Nuevo anticipo de cliente</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Cliente *">
              <select value={f.cliente_id} onChange={e => set("cliente_id", e.target.value)} style={inputStyle}>
                <option value="">— elegir cliente —</option>
                {clientesOpts.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Monto *"><input type="number" value={f.monto} onChange={e => set("monto", e.target.value)} style={inputStyle} /></Field>
          <Field label="Moneda"><select value={f.moneda} onChange={e => set("moneda", e.target.value)} style={inputStyle}>{["ARS", "USD", "EUR"].map(m => <option key={m} value={m}>{m}</option>)}</select></Field>
          <Field label="Fecha *"><input type="date" value={f.fecha} onChange={e => set("fecha", e.target.value)} style={inputStyle} /></Field>
          <Field label="Cuenta de cobro">
            <select value={f.cuenta_bancaria} onChange={e => set("cuenta_bancaria", e.target.value)} disabled={f.es_apertura} style={{ ...inputStyle, opacity: f.es_apertura ? .5 : 1 }}>
              <option value="">— elegir —</option>
              {bancos.map(b => <option key={b.id} value={b.id}>{b.nombre || b.id}</option>)}
            </select>
          </Field>
          <div style={{ gridColumn: "1 / -1" }}><Field label="Nota"><input value={f.nota} onChange={e => set("nota", e.target.value)} style={inputStyle} /></Field></div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12, color: T.text, cursor: "pointer" }}>
          <input type="checkbox" checked={f.es_apertura} onChange={e => set("es_apertura", e.target.checked)} />
          Apertura (anticipo vivo al go-live): la plata ya entró antes del 1/7 → no suma caja, solo el pasivo remanente
        </label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
          <Btn variant="ghost" onClick={onCancel}>Cancelar</Btn>
          <Btn variant="accent" onClick={guardar} disabled={!canSave}>{busy ? "Guardando…" : "Guardar"}</Btn>
        </div>
      </div>
    </div>
  );
}

function DetalleAnticipo({ anticipo: a, ingById = new Map(), onBack, onChanged }) {
  const [busy, setBusy] = useState(false);
  async function doEliminar() {
    if (!confirm("¿Eliminar el anticipo? Si tenía cobros aplicados, esas facturas vuelven a quedar pendientes de cobro.")) return;
    setBusy(true);
    try { await deleteAnticipo(a.id); onChanged(); }
    catch (e) { alert("Error: " + (e?.message || e)); setBusy(false); }
  }
  return (
    <div className="fade">
      <button onClick={onBack} style={{ background: "none", border: "none", color: T.muted, fontSize: 13, cursor: "pointer", marginBottom: 12, fontFamily: T.font }}>‹ Volver</button>
      <PageHeader title={`Anticipo · ${a.cliente_nombre || "—"}`} subtitle={`${fmtDate(a.fecha)}${a.es_apertura ? " · apertura" : ""}`}
        action={<Btn variant="danger" onClick={doEliminar} disabled={busy}>Eliminar</Btn>} />
      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <CompactCard label="Recibido" value={fmtMoney(a.monto, a.moneda)} />
        <CompactCard label="Consumido" value={fmtMoney(a.consumido, a.moneda)} color={T.muted} />
        <CompactCard label="Saldo disponible" value={fmtMoney(a.saldo, a.moneda)} color={a.saldo > 0 ? T.blue : T.green} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, marginBottom: 8 }}>Facturas cobradas contra este anticipo</div>
      {a.consumos.length === 0 ? (
        <div style={{ color: T.dim, fontSize: 13, padding: "20px 0" }}>Todavía no se aplicó a ninguna factura.</div>
      ) : (
        <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, overflow: "hidden", boxShadow: T.shadow }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: T.tableHead, color: T.tableHeadText }}>
              {["Comprobante", "Fecha cobro", "Total factura", "Cobrado c/ anticipo"].map((h, i) => <th key={i} style={{ padding: "8px 12px", textAlign: i >= 2 ? "right" : "left", fontSize: 11, fontWeight: 700 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {a.consumos.map(c => {
                const ing = ingById.get(c.factura_id);
                return (
                  <tr key={c.id} style={{ borderTop: `1px solid ${T.cardBorder}` }}>
                    <td style={{ padding: "8px 12px" }}>
                      <div style={{ fontWeight: 600, color: T.text }}>{ing?.nroComp || shortId(c.factura_id)}</div>
                      <div style={{ fontSize: 10, color: T.dim }}>{ing?.cliente || ""}{ing?.cliente ? " · " : ""}<span style={{ fontFamily: T.mono }}>{c.factura_id}</span></div>
                    </td>
                    <td style={{ padding: "8px 12px", color: T.muted }}>{fmtDate(c.fecha)}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: T.mono, color: T.muted }}>{ing ? fmtMoney(ing.total ?? ing.importe, a.moneda) : "—"}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: T.mono, fontWeight: 600 }}>{fmtMoney(c.monto, a.moneda)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ALTA — header + editor de cronograma
// ════════════════════════════════════════════════════════════════════════════
function AltaFinanciacion({ tipo, sociedad, cuentas, centros, bancos, proveedores = [], onCancel, onSaved }) {
  const cfg = TIPOS[tipo];
  const [h, setH] = useState(() => {
    // Pre-cargamos centros buscándolos por nombre (capital/iva → Impuestos, interés/sellos → Financieros).
    const ccPorNombre = frag => centros.find(c => new RegExp(frag, "i").test(c.nombre || ""))?.id || "";
    const ccImpuestos = ccPorNombre("impuesto"), ccFinancieros = ccPorNombre("financ");
    return {
      acreedor_id: "", acreedor_nombre: "", acreedor_cuit: "", nro_plan: "", moneda: "ARS",
      fecha_consolidacion: new Date().toISOString().slice(0, 10),
      es_apertura: false,
      cuenta_capital: "",            centro_capital: ccImpuestos,   // vacía a propósito: el impuesto cambia por plan → se elige a mano
      cuenta_interes: DEF_INTERES,   centro_interes: ccFinancieros,
      cuenta_iva: DEF_IVA,           centro_iva: ccImpuestos,
      cuenta_impuestos: "",          centro_impuestos: ccFinancieros,
      cuenta_bancaria: "", nota: "",
    };
  });
  const [gen, setGen] = useState({ capital_original: "", n_cuotas: "12", tasaMensual: "", ivaPct: "", impuestoPct: "", periodicidad: "mensual" });
  const [cuotas, setCuotas] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState("");
  const set = (k, v) => setH(s => ({ ...s, [k]: v }));

  // Subir el PDF de AFIP → parsea el cronograma y prellena nº de plan / fecha de consolidación.
  // El resultado queda EDITABLE en la tabla de abajo (revisás y corregís lo que haga falta).
  async function onPdf(file) {
    if (!file) return;
    setPdfMsg("Leyendo PDF…");
    try {
      const r = await parsePlanPdf(file);
      if (!r.cuotas.length) { setPdfMsg("No pude leer cuotas del PDF — cargalas a mano o usá el generador."); return; }
      setCuotas(r.cuotas);
      setH(s => ({ ...s, nro_plan: s.nro_plan || r.nro_plan || "", fecha_consolidacion: r.fecha_consolidacion || s.fecha_consolidacion }));
      setPdfMsg(`✓ ${r.cuotas.length} cuotas leídas${r.nro_plan ? ` · plan ${r.nro_plan}` : ""}. Revisá los montos antes de guardar.`);
    } catch (e) {
      setPdfMsg("Error al leer el PDF: " + (e?.message || e));
    }
  }

  const cuentaOpts = useMemo(() => cuentas.map(c => c.nombre).filter(Boolean), [cuentas]);
  const provOpts = useMemo(() => [...proveedores].filter(p => p.activo !== false).sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""))), [proveedores]);
  const pickProveedor = (id) => {
    const p = proveedores.find(x => String(x.id) === String(id));
    setH(s => ({ ...s, acreedor_id: id, acreedor_nombre: p?.nombre || "", acreedor_cuit: p?.cuit || "" }));
  };

  function generar() {
    const rows = generarCuotas({
      capital_original: num(gen.capital_original), n_cuotas: num(gen.n_cuotas),
      tasaMensual: num(gen.tasaMensual), ivaPct: num(gen.ivaPct), impuestoPct: num(gen.impuestoPct),
      fecha_inicio: h.fecha_consolidacion, periodicidad: gen.periodicidad,
    });
    setCuotas(rows);
  }
  function updCuota(i, k, v) {
    setCuotas(cs => cs.map((c, idx) => {
      if (idx !== i) return c;
      const nc = { ...c, [k]: k === "vto" || k === "vto_tardio" ? v : num(v) };
      nc.total = round2(num(nc.capital) + num(nc.interes) + num(nc.iva) + num(nc.impuestos));
      nc.total_tardio = num(nc.interes_resarc) > 0 ? round2(nc.total + num(nc.interes_resarc)) : 0;
      return nc;
    }));
  }
  function addCuota() {
    setCuotas(cs => [...cs, { nro_cuota: cs.length + 1, vto: "", vto_tardio: "", capital: 0, interes: 0, iva: 0, impuestos: 0, interes_resarc: 0, total: 0, total_tardio: 0 }]);
  }
  function rmCuota(i) { setCuotas(cs => cs.filter((_, idx) => idx !== i).map((c, idx) => ({ ...c, nro_cuota: idx + 1 }))); }

  const totalCuotas  = useMemo(() => cuotas.reduce((s, c) => s + num(c.total), 0), [cuotas]);
  // Suma por componente del cronograma → define qué cuentas son obligatorias.
  const compSum = useMemo(() => {
    const s = { capital: 0, interes: 0, iva: 0, impuestos: 0 };
    for (const c of cuotas) { s.capital += num(c.capital); s.interes += num(c.interes); s.iva += num(c.iva); s.impuestos += num(c.impuestos); }
    return s;
  }, [cuotas]);
  // Una cuenta es obligatoria solo si el cronograma tiene importe para ese componente
  // (y, para el capital, solo si en este tipo el capital es gasto — el préstamo no).
  const compRequerido = comp => comp.key === "capital"
    ? cfg.capitalEsGasto && compSum.capital > 0
    : compSum[comp.key] > 0;
  const compsVisibles = COMPONENTES.filter(comp => !comp.soloPlan || cfg.capitalEsGasto);
  const faltanCuentas = compsVisibles.some(comp => compRequerido(comp) && !h[comp.cuentaK]);
  const cuotasOk = cuotas.length > 0 && cuotas.every(c => num(c.total) > 0 && c.vto);
  const canSave = h.acreedor_nombre.trim() && h.fecha_consolidacion && h.cuenta_bancaria && cuotasOk && !faltanCuentas && !busy;

  async function guardar() {
    if (!canSave) return;
    setBusy(true);
    try {
      await appendFinanciacion({ ...h, tipo, sociedad, cuotas });
      onSaved();
    } catch (e) {
      alert("Error al guardar: " + (e?.message || e));
      setBusy(false);
    }
  }

  return (
    <div className="fade" style={{ padding: "28px 32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <PageHeader title={cfg.nuevoLabel}
          subtitle={cfg.capitalEsGasto ? "El capital es el impuesto (gasto al consolidar); el interés se devenga mes a mes" : "El capital es deuda (no es gasto); solo el interés es resultado"} />
        <button onClick={onCancel} style={{ background: "none", border: "none", color: T.muted, fontSize: 13, cursor: "pointer", fontFamily: T.font, whiteSpace: "nowrap", flexShrink: 0 }}>‹ Volver</button>
      </div>

      {/* 1 · Datos del acreedor */}
      <SectionCard title="Datos del acreedor">
        <Field label={cfg.acreedorLabel + " *"}>
          <select value={h.acreedor_id} onChange={e => pickProveedor(e.target.value)} style={inputStyle}>
            <option value="">{provOpts.length ? "— elegir proveedor —" : "(sin proveedores)"}</option>
            {provOpts.map(p => <option key={p.id} value={p.id}>{p.nombre}{p.cuit ? ` · ${p.cuit}` : ""}</option>)}
          </select>
        </Field>
        <Field label="CUIT (del proveedor)">
          <input value={h.acreedor_cuit} readOnly style={{ ...inputStyle, background: "#f3f4f6", color: T.muted }} placeholder="viene del proveedor elegido" />
        </Field>
        <Field label="Nº de plan / préstamo"><input value={h.nro_plan} onChange={e => set("nro_plan", e.target.value)} style={inputStyle} placeholder="ej. V598374" /></Field>
      </SectionCard>

      {/* 2 · Fechas, moneda y caja */}
      <SectionCard title="Fechas, moneda y caja">
        <Field label="Fecha de consolidación *"><input type="date" value={h.fecha_consolidacion} onChange={e => set("fecha_consolidacion", e.target.value)} style={inputStyle} /></Field>
        <Field label="Moneda">
          <select value={h.moneda} onChange={e => set("moneda", e.target.value)} style={inputStyle}>
            {["ARS", "USD", "EUR"].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label={cfg.capitalEsGasto ? "Cuenta de débito *" : "Cuenta del desembolso *"}>
          <select value={h.cuenta_bancaria} onChange={e => set("cuenta_bancaria", e.target.value)} style={inputStyle}>
            <option value="">— elegir —</option>
            {bancos.map(b => <option key={b.id} value={b.id}>{b.nombre || b.id}</option>)}
          </select>
        </Field>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.text, cursor: "pointer" }}>
            <input type="checkbox" checked={h.es_apertura} onChange={e => set("es_apertura", e.target.checked)} />
            Apertura (plan vivo al go-live): el capital ya está contabilizado afuera → no impacta el P&L; solo carga el pasivo remanente + cuotas vigentes
          </label>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label="Nota"><input value={h.nota} onChange={e => set("nota", e.target.value)} style={inputStyle} /></Field>
        </div>
      </SectionCard>

      {/* 3 · Imputación contable por componente (cuenta + centro propios) */}
      <SectionCard title="Imputación contable — cuenta y centro por componente" cols="1.4fr 1.4fr 1.2fr">
        <div style={{ gridColumn: "1 / -1", fontSize: 11, color: T.muted, lineHeight: 1.5, marginBottom: 2 }}>
          La cuota tiene 5 componentes, pero el <b>interés resarcitorio</b> (recargo por mora) es costo financiero igual que el interés → se imputa a la <b>misma cuenta de Interés financiero</b>. Por eso hay 4 filas. Cubre también préstamos bancarios (capital · interés · IVA s/interés · sellos/IVAP).
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.muted }}>Componente</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.muted }}>Cuenta contable</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.muted }}>Centro de costo</div>
        {compsVisibles.map(comp => {
          const req   = compRequerido(comp);
          const falta = !h[comp.cuentaK];
          // rojo = obligatoria sin cargar · ámbar = opcional sin cargar · normal = cargada
          const tone  = falta ? (req ? T.red : "#b45309") : T.text;
          const selSt = falta
            ? { ...inputStyle, border: `1px solid ${req ? T.red : "#f59e0b"}`, background: req ? "#fef2f2" : "#fffbeb" }
            : inputStyle;
          return (
            <Fragment key={comp.key}>
              <div style={{ fontSize: 13, color: tone, alignSelf: "center", fontWeight: 600 }}>
                {comp.label}{req ? " *" : ""}
                {falta && <span style={{ fontSize: 10, marginLeft: 6, fontWeight: 700 }}>{req ? "falta" : "opcional"}</span>}
              </div>
              <select value={h[comp.cuentaK]} onChange={e => set(comp.cuentaK, e.target.value)} style={selSt}>
                <option value="">— {req ? "elegir" : "sin " + comp.key} —</option>
                {cuentaOpts.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <select value={h[comp.centroK]} onChange={e => set(comp.centroK, e.target.value)} style={inputStyle}>
                <option value="">— sin centro —</option>
                {centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Fragment>
          );
        })}
      </SectionCard>

      {/* Subir PDF del plan (AFIP) — método principal */}
      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: T.radius, padding: 14, marginBottom: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Cargar desde el PDF del plan</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>Subí el PDF de AFIP/ARCA y completa el cronograma solo. Después revisás los montos en la tabla.</div>
          {pdfMsg && <div style={{ fontSize: 11, marginTop: 6, color: pdfMsg.startsWith("✓") ? T.green : pdfMsg.startsWith("Error") || pdfMsg.startsWith("No pude") ? T.red : T.muted }}>{pdfMsg}</div>}
        </div>
        <label style={{ background: T.accentDark, color: T.accent, borderRadius: 999, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
          ⬆ Subir PDF
          <input type="file" accept=".pdf" style={{ display: "none" }} onChange={e => { onPdf(e.target.files[0]); e.target.value = ""; }} />
        </label>
      </div>

      {/* Generador de cronograma (alternativa manual) */}
      <div style={{ background: "#eceff3", border: `1px dashed ${T.cardBorder}`, borderRadius: T.radius, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, marginBottom: 10 }}>O generar a mano (sistema francés — después editás cada cuota)</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Capital total"><input type="number" value={gen.capital_original} onChange={e => setGen(s => ({ ...s, capital_original: e.target.value }))} style={{ ...inputStyle, width: 140 }} /></Field>
          <Field label="Nº cuotas"><input type="number" value={gen.n_cuotas} onChange={e => setGen(s => ({ ...s, n_cuotas: e.target.value }))} style={{ ...inputStyle, width: 80 }} /></Field>
          <Field label="Tasa mensual %"><input type="number" value={gen.tasaMensual} onChange={e => setGen(s => ({ ...s, tasaMensual: e.target.value }))} style={{ ...inputStyle, width: 100 }} /></Field>
          <Field label="IVA % s/interés"><input type="number" value={gen.ivaPct} onChange={e => setGen(s => ({ ...s, ivaPct: e.target.value }))} style={{ ...inputStyle, width: 100 }} /></Field>
          <Field label="Impuesto %"><input type="number" value={gen.impuestoPct} onChange={e => setGen(s => ({ ...s, impuestoPct: e.target.value }))} style={{ ...inputStyle, width: 90 }} /></Field>
          <Btn variant="ghost" onClick={generar}>Generar cuotas</Btn>
        </div>
      </div>

      {/* Editor de cronograma */}
      {cuotas.length > 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, overflow: "auto", boxShadow: T.shadow, marginBottom: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.tableHead, color: T.tableHeadText }}>
                {["#", "Vto", "Vto tardío", "Capital", "Interés", "IVA", "Impuestos", "Int. resarc.", "Total", ""].map((hh, i) => (
                  <th key={i} style={{ padding: "8px 10px", textAlign: i >= 3 ? "right" : "left", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{hh}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cuotas.map((c, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${T.cardBorder}` }}>
                  <td style={{ padding: "5px 10px", color: T.muted }}>{c.nro_cuota}</td>
                  <td style={{ padding: "5px 10px" }}><Cell type="date" w={130} value={c.vto} onChange={v => updCuota(i, "vto", v)} /></td>
                  <td style={{ padding: "5px 10px" }}><Cell type="date" w={130} value={c.vto_tardio} onChange={v => updCuota(i, "vto_tardio", v)} /></td>
                  <td style={{ padding: "5px 10px" }}><Cell value={c.capital} onChange={v => updCuota(i, "capital", v)} /></td>
                  <td style={{ padding: "5px 10px" }}><Cell value={c.interes} onChange={v => updCuota(i, "interes", v)} /></td>
                  <td style={{ padding: "5px 10px" }}><Cell value={c.iva} onChange={v => updCuota(i, "iva", v)} /></td>
                  <td style={{ padding: "5px 10px" }}><Cell value={c.impuestos} onChange={v => updCuota(i, "impuestos", v)} /></td>
                  <td style={{ padding: "5px 10px" }}><Cell value={c.interes_resarc} onChange={v => updCuota(i, "interes_resarc", v)} /></td>
                  <td style={{ padding: "5px 10px", textAlign: "right", fontFamily: T.mono, fontWeight: 600, color: T.text }}>{fmtMoney(c.total, h.moneda)}</td>
                  <td style={{ padding: "5px 10px", textAlign: "center" }}>
                    <button onClick={() => rmCuota(i)} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 15 }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${T.cardBorder}`, background: "#fafafa", fontWeight: 700, color: T.text }}>
                <td colSpan={3} style={{ padding: "8px 10px" }}>
                  <button onClick={addCuota} style={{ background: "none", border: "none", color: T.blue, cursor: "pointer", fontSize: 12, fontFamily: T.font, fontWeight: 700 }}>+ Agregar cuota</button>
                </td>
                <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: T.mono, color: T.text }}>{fmtMoney(compSum.capital, h.moneda)}</td>
                <td colSpan={4} />
                <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: T.mono, color: T.text }}>{fmtMoney(totalCuotas, h.moneda)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Btn variant="ghost" onClick={onCancel}>Cancelar</Btn>
        <Btn variant="accent" onClick={guardar} disabled={!canSave}>{busy ? "Guardando…" : "Guardar"}</Btn>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DETALLE — cronograma + acciones
// ════════════════════════════════════════════════════════════════════════════
function DetalleFinanciacion({ plan, bancos, onBack, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [pagoCuota, setPagoCuota] = useState(null);   // cuota a pagar manualmente

  async function doPagar(cuota, fecha, cuenta_bancaria) {
    setBusy(true);
    try { await pagarCuota({ plan, cuota, fecha, cuenta_bancaria }); onChanged(); }
    catch (e) { alert("Error: " + (e?.message || e)); setBusy(false); }
  }
  async function doCancelar() {
    if (!confirm("¿Cancelar las cuotas pendientes de este plan? El pasivo baja a 0.")) return;
    setBusy(true);
    try { await cancelarFinanciacion(plan.plan_id); onChanged(); }
    catch (e) { alert("Error: " + (e?.message || e)); setBusy(false); }
  }
  async function doEliminar() {
    if (!confirm("¿Eliminar el plan completo (todas sus cuotas)? No se puede deshacer.")) return;
    setBusy(true);
    try { await deleteFinanciacion(plan.plan_id); onChanged(); }
    catch (e) { alert("Error: " + (e?.message || e)); setBusy(false); }
  }

  const cuentaCapital = String(plan.cuenta_capital || "").replace(/^CUENTA_/, "");

  return (
    <div className="fade" style={{ padding: "28px 32px" }}>
      <button onClick={onBack} style={{ background: "none", border: "none", color: T.muted, fontSize: 13, cursor: "pointer", marginBottom: 12, fontFamily: T.font }}>‹ Volver</button>
      <PageHeader title={plan.acreedor_nombre || "Financiación"}
        subtitle={`${TIPOS[plan.tipo]?.label || ""} · Nº ${plan.nro_plan || "—"} · consolidado ${fmtDate(plan.fecha_consolidacion)}${plan.es_apertura ? " · apertura" : ""}${cuentaCapital ? ` · Capital → ${cuentaCapital}` : ""}`}
        action={<div style={{ display: "flex", gap: 8 }}>
          <Btn variant="ghost" onClick={doCancelar} disabled={busy}>Cancelar cuotas</Btn>
          <Btn variant="danger" onClick={doEliminar} disabled={busy}>Eliminar</Btn>
        </div>} />

      {plan.nota && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, fontSize: 13, color: T.muted }}>
          <span style={{ fontWeight: 700, color: T.text }}>Nota: </span>{plan.nota}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <CompactCard label="Capital total" value={fmtMoney(plan.capital_total, plan.moneda)} />
        <CompactCard label="Pagado" value={fmtMoney(plan.capital_pagado, plan.moneda)} color={T.green} />
        <CompactCard label="Saldo (pasivo)" value={fmtMoney(plan.saldo, plan.moneda)} color={plan.saldo > 0 ? T.red : T.green} />
        <CompactCard label="Cuotas" value={`${plan.n_pagadas}/${plan.n_cuotas}`} />
      </div>

      <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, overflow: "auto", boxShadow: T.shadow }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.tableHead, color: T.tableHeadText }}>
              {["#", "Vto", "Capital", "Interés", "IVA", "Impuestos", "Total", "Estado", ""].map((hh, i) => (
                <th key={i} style={{ padding: "8px 10px", textAlign: i >= 2 && i <= 6 ? "right" : "left", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{hh}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.cuotas.map(c => (
              <tr key={c.rowId} style={{ borderTop: `1px solid ${T.cardBorder}` }}>
                <td style={{ padding: "7px 10px", color: T.muted }}>{c.nro_cuota === 0 ? "PC" : c.nro_cuota}</td>
                <td style={{ padding: "7px 10px", color: T.text }}>{fmtDate(c.vto)}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: T.mono, color: T.text }}>{fmtMoney(c.capital, plan.moneda)}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: T.mono, color: T.text }}>{fmtMoney(c.interes, plan.moneda)}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: T.mono, color: T.dim }}>{c.iva ? fmtMoney(c.iva, plan.moneda) : "—"}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: T.mono, color: T.dim }}>{c.impuestos ? fmtMoney(c.impuestos, plan.moneda) : "—"}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: T.mono, fontWeight: 600, color: T.text }}>{fmtMoney(c.total, plan.moneda)}</td>
                <td style={{ padding: "7px 10px" }}><Badge estado={c.estado} cfg={ESTADO_CUOTA} /></td>
                <td style={{ padding: "7px 10px", textAlign: "right" }}>
                  {c.estado === "pendiente" && (
                    <button onClick={() => setPagoCuota(c)} style={{ background: "none", border: `1px solid ${T.cardBorder}`, borderRadius: 6, color: T.blue, cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "3px 9px", fontFamily: T.font }}>Pagar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagoCuota && (
        <PagoCuotaModal cuota={pagoCuota} plan={plan} bancos={bancos} busy={busy}
          onCancel={() => setPagoCuota(null)}
          onConfirm={(fecha, banco) => doPagar(pagoCuota, fecha, banco)} />
      )}
    </div>
  );
}

function PagoCuotaModal({ cuota, plan, bancos, busy, onCancel, onConfirm }) {
  const [fecha, setFecha] = useState(cuota.vto || new Date().toISOString().slice(0, 10));
  const [banco, setBanco] = useState(bancos[0]?.id || "");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: T.radius, padding: 22, width: 380, boxShadow: T.shadowMd }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800, color: T.text }}>Pagar cuota {cuota.nro_cuota}</h3>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: T.muted }}>{fmtMoney(cuota.total, plan.moneda)} · {plan.nro_plan || plan.acreedor_nombre}</p>
        <p style={{ fontSize: 11, color: T.dim, margin: "0 0 14px" }}>Registra el egreso de caja y marca la cuota pagada. (Si el débito ya está en el extracto, mejor imputalo desde Conciliación.)</p>
        <Field label="Fecha de pago"><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inputStyle} /></Field>
        <div style={{ marginTop: 12 }}>
          <Field label="Cuenta de débito">
            <select value={banco} onChange={e => setBanco(e.target.value)} style={inputStyle}>
              <option value="">— elegir —</option>
              {bancos.map(b => <option key={b.id} value={b.id}>{b.nombre || b.id}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
          <Btn variant="ghost" onClick={onCancel}>Cancelar</Btn>
          <Btn variant="accent" onClick={() => onConfirm(fecha, banco)} disabled={busy || !banco}>{busy ? "…" : "Confirmar pago"}</Btn>
        </div>
      </div>
    </div>
  );
}

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
