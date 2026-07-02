// ─── BIGG Numbers — Cuenta corriente de SOCIOS (dividendos + préstamos) ────────
// Módulo especial group-level (transversal a las sociedades). Un socio es una contraparte
// bidireccional: saldo neto deudor (nos debe → Activo) o acreedor (le debemos → Pasivo).
// NUNCA toca el P&L — es balance puro (reparto de patrimonio / cuenta particular).
// Dos modos: tablero de los 5 socios + detalle/status por socio con su ledger.
import { useState, useEffect, useMemo } from "react";
import { T, PageHeader, Btn, Badge, Select, Input, fmtMoney, fmtDate } from "./theme";
import {
  fetchSocios, fetchSociosCC, fetchMovSocios, fetchSociedades, fetchCuentasBancarias,
  appendMovSocio, declararDividendo, aperturaSocio, repartirDividendo, SOCIO_SIGNO_CAJA,
} from "../lib/numbersApi";

// Parser de montos: el punto SIEMPRE es separador de miles y la coma es decimal (formato AR).
// Los valores numéricos del Sheet llegan como number (se devuelven tal cual); solo los strings
// (input del usuario formateado) pasan por el strip de puntos.
const num = v => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  return Number(s.replace(/\./g, "").replace(",", ".")) || 0;
};
const hoy = () => new Date().toISOString().slice(0, 10);

// Formatea mientras se escribe con separador de miles (punto) y coma decimal (formato AR).
// Guarda el string formateado; num() lo parsea bien al grabar ("365.625,50" → 365625.5).
const fmtMiles = (s) => {
  const str = String(s ?? "").replace(/[^\d,]/g, "");   // solo dígitos y coma (descarta puntos de miles)
  const parts = str.split(",");
  const intFmt = (parts[0] || "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return parts.length > 1 ? `${intFmt},${parts.slice(1).join("").slice(0, 2)}` : intFmt;
};

// Tipos de movimiento. cash=true → sale de una cuenta (deriva sociedad+moneda). multi=declaración.
const TIPO_MOV = {
  prestamo:            { label: "Préstamo a socio",             cash: true,  salida: true,  desc: "Le prestás plata a un socio (queda como deudor)." },
  devolucion:          { label: "Devolución del socio",          cash: true,  salida: false, desc: "El socio te devuelve plata (baja lo que te debe)." },
  aporte:              { label: "Aporte del socio",              cash: true,  salida: false, desc: "El socio pone plata en la empresa (le debemos)." },
  dividendo_pago:      { label: "Pago de dividendo",             cash: true,  salida: true,  desc: "Le pagás un dividendo ya declarado (cancela el pasivo)." },
  dividendo_declarado: { label: "Declarar dividendo",            cash: false, multi: true,   desc: "Declarás un dividendo a repartir entre los socios (no mueve caja)." },
  apertura:            { label: "Saldo de apertura (pre go-live)", cash: false, apertura: true, desc: "Cargás un saldo previo al go-live sin mover caja." },
};
const ORDEN_TIPOS = ["prestamo", "devolucion", "aporte", "dividendo_declarado", "dividendo_pago", "apertura"];

const inputStyle = {
  width: "100%", background: "#eceff3", border: `1px solid ${T.cardBorder}`,
  borderRadius: 8, padding: "8px 12px", fontSize: 13, color: T.text,
  fontFamily: T.font, outline: "none", boxSizing: "border-box",
};
function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: T.muted, fontWeight: 600, display: "block", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

// Layout de la tabla: Socio | Nos debe | Le debemos | Saldo neto
const GRID = "1.6fr 1fr 1fr 1fr";
// Celda de importes por moneda (chips = [[moneda, valor], …]). neto = muestra el signo con color;
// abs = un solo color (columna nos debe / le debemos).
function MonCell({ chips, color, abs = false, neto = false, bold = false }) {
  const base = { textAlign: "right", fontFamily: T.mono, fontSize: 13, fontWeight: bold ? 800 : 400 };
  if (!chips || chips.length === 0) return <span style={{ ...base, color: T.dim }}>—</span>;
  if (neto) return (
    <span style={base}>{chips.map(([m, v], i) => (
      <span key={m} style={{ color: v >= 0 ? T.green : T.red }}>{i ? " · " : ""}{v < 0 ? "−" : ""}{fmtMoney(v, m)}</span>
    ))}</span>
  );
  return <span style={{ ...base, color }}>{chips.map(([m, v]) => fmtMoney(v, m)).join(" · ")}</span>;
}

// Ledger de un socio: une nb_socios_cc (no-cash) + nb_movimientos (caja). delta firmado
// (+ nos debe / − le debemos). Ordenado por fecha para el saldo corriente.
function socioLedger(socioId, ccRows, movs) {
  const out = [];
  for (const r of ccRows) {
    if (String(r.socio_id) !== String(socioId)) continue;
    out.push({
      fecha: r.fecha, sociedad: r.sociedad, moneda: r.moneda || "ARS",
      label: r.tipo === "apertura" ? "Apertura" : "Dividendo declarado",
      delta: num(r.monto), concepto: r.nota || "",
    });
  }
  for (const m of movs) {
    if (String(m.contraparte_id) !== String(socioId)) continue;
    const signo = SOCIO_SIGNO_CAJA[m.socio_tipo] ?? 0;
    if (!signo) continue;
    out.push({
      fecha: m.fecha, sociedad: m.sociedad, moneda: m.moneda || "ARS",
      label: TIPO_MOV[m.socio_tipo]?.label || m.socio_tipo,
      delta: signo * Math.abs(num(m.monto)), concepto: m.concepto || "",
    });
  }
  out.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  return out;
}

// Saldo neto por socio y moneda → { [socioId]: { ARS, USD, EUR } } (+ nos debe / − le debemos).
function saldosPorSocio(socios, ccRows, movs) {
  const acc = {};
  const add = (sid, mon, d) => { if (!sid) return; (acc[sid] ??= {}); acc[sid][mon] = (acc[sid][mon] || 0) + d; };
  for (const r of ccRows) add(r.socio_id, r.moneda || "ARS", num(r.monto));
  for (const m of movs) {
    const signo = SOCIO_SIGNO_CAJA[m.socio_tipo] ?? 0;
    if (signo) add(m.contraparte_id, m.moneda || "ARS", signo * Math.abs(num(m.monto)));
  }
  return acc;
}

const saldoChips = (porMon) => Object.entries(porMon || {}).filter(([, v]) => Math.abs(v) > 0.01);

export default function PantallaSocios() {
  const [socios, setSocios]     = useState([]);
  const [ccRows, setCcRows]     = useState([]);
  const [movs, setMovs]         = useState([]);
  const [sociedades, setSociedades] = useState([]);
  const [bancos, setBancos]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [sel, setSel]           = useState(null);      // socio_id del detalle (null = tablero)
  const [modal, setModal]       = useState(null);      // { tipo, socioId? }
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState("");

  async function load() {
    setLoading(true);
    try {
      const [s, cc, mv, soc, ban] = await Promise.all([
        fetchSocios(), fetchSociosCC(), fetchMovSocios(), fetchSociedades(), fetchCuentasBancarias(),
      ]);
      setSocios(s || []); setCcRows(cc || []); setMovs(mv || []);
      setSociedades(soc || []); setBancos(ban || []);
    } catch (e) { setErr(String(e.message || e)); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const saldos   = useMemo(() => saldosPorSocio(socios, ccRows, movs), [socios, ccRows, movs]);
  const totales  = useMemo(() => {
    const deben = {}, debemos = {}, neto = {};
    for (const porMon of Object.values(saldos)) {
      for (const [m, v] of Object.entries(porMon)) {
        if (Math.abs(v) < 0.01) continue;
        neto[m] = (neto[m] || 0) + v;
        if (v > 0) deben[m] = (deben[m] || 0) + v;
        else debemos[m] = (debemos[m] || 0) + (-v);
      }
    }
    return { deben, debemos, neto };
  }, [saldos]);
  const socioSel = socios.find(s => String(s.id) === String(sel));
  const sociedadNombre = id => sociedades.find(x => String(x.id) === String(id))?.nombre || id || "—";

  async function onGuardado() { setModal(null); await load(); }

  if (loading) return <div style={{ padding: 40, color: T.dim, fontSize: 13 }}>Cargando…</div>;

  return (
    <div style={{ padding: "28px 32px" }}>
      {sel ? (
        <DetalleSocio
          socio={socioSel} porMon={saldos[sel] || {}}
          ledger={socioLedger(sel, ccRows, movs)} sociedadNombre={sociedadNombre}
          onBack={() => setSel(null)}
          onNuevo={() => setModal({ tipo: null, socioId: sel })}
        />
      ) : (
        <>
          <PageHeader
            title="Socios"
            subtitle="Cuenta corriente de socios — dividendos y préstamos (balance, no afecta P&L)"
            action={<Btn variant="accent" onClick={() => setModal({ tipo: null })}>+ Nuevo movimiento</Btn>}
          />
          {err && <div style={{ background: T.redBg, color: T.red, padding: "8px 12px", borderRadius: 8, fontSize: 12, marginBottom: 14 }}>{err}</div>}
          <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: GRID, padding: "10px 18px", background: T.tableHead, color: T.tableHeadText, fontSize: 11, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase" }}>
              <span>Socio</span><span style={{ textAlign: "right" }}>Nos deben</span><span style={{ textAlign: "right" }}>Les debemos</span><span style={{ textAlign: "right" }}>Saldo neto</span>
            </div>
            {socios.length === 0 && (
              <div style={{ padding: 24, color: T.dim, fontSize: 13, textAlign: "center" }}>
                No hay socios cargados. Creá el maestro <code>nb_socios</code> y cargá los socios (con su % de participación).
              </div>
            )}
            {socios.map(s => {
              const chips = saldoChips(saldos[s.id]);
              const deben   = chips.filter(([, v]) => v > 0);
              const debemos = chips.filter(([, v]) => v < 0);
              return (
                <div key={s.id} onClick={() => setSel(s.id)}
                  style={{ display: "grid", gridTemplateColumns: GRID, padding: "12px 18px", borderTop: `1px solid ${T.cardBorder}`, cursor: "pointer", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, color: T.text, fontSize: 13 }}>{s.nombre}</span>
                  <MonCell chips={deben} color={T.green} abs />
                  <MonCell chips={debemos} color={T.red} abs />
                  <MonCell chips={chips} neto />
                </div>
              );
            })}
            {socios.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: GRID, padding: "12px 18px", borderTop: `2px solid ${T.tableHead}`, alignItems: "center", background: "#f8fafc" }}>
                <span style={{ fontWeight: 900, color: T.text, fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em" }}>Total</span>
                <MonCell chips={saldoChips(totales.deben)} color={T.green} abs bold />
                <MonCell chips={saldoChips(totales.debemos)} color={T.red} abs bold />
                <MonCell chips={saldoChips(totales.neto)} neto bold />
              </div>
            )}
          </div>
        </>
      )}

      {modal && (
        <MovimientoModal
          modal={modal} socios={socios} sociedades={sociedades} bancos={bancos}
          busy={busy} setBusy={setBusy}
          onClose={() => setModal(null)} onGuardado={onGuardado}
        />
      )}
    </div>
  );
}

function DetalleSocio({ socio, porMon, ledger, sociedadNombre, onBack, onNuevo }) {
  if (!socio) return null;
  const chips = saldoChips(porMon);
  // saldo corriente por moneda mientras recorro el ledger
  const runByMon = {};
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <button onClick={onBack} style={{ ...inputStyle, width: "auto", cursor: "pointer", padding: "6px 14px", fontWeight: 700 }}>← Socios</button>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: T.text, margin: 0 }}>{socio.nombre}</h1>
        {socio.participacion ? <Badge estado="p" cfg={{ p: { label: `${num(socio.participacion)}%`, bg: T.purpleBg, color: T.purple } }} /> : null}
        <div style={{ marginLeft: "auto" }}><Btn variant="accent" onClick={onNuevo}>+ Nuevo movimiento</Btn></div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {chips.length === 0 && <div style={{ color: T.dim, fontSize: 13 }}>Sin saldo.</div>}
        {chips.map(([m, v]) => (
          <div key={m} style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, padding: "10px 18px", boxShadow: T.shadow }}>
            <div style={{ fontSize: 10, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em" }}>
              {v > 0 ? "Nos debe" : "Le debemos"} · {m}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: T.mono, color: v > 0 ? T.green : T.red }}>{fmtMoney(v, m)}</div>
          </div>
        ))}
      </div>

      <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "90px 1.3fr 1fr 130px 150px", padding: "10px 18px", background: T.tableHead, color: T.tableHeadText, fontSize: 11, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase" }}>
          <span>Fecha</span><span>Movimiento</span><span>Sociedad</span><span style={{ textAlign: "right" }}>Importe</span><span style={{ textAlign: "right" }}>Saldo</span>
        </div>
        {ledger.length === 0 && <div style={{ padding: 20, color: T.dim, fontSize: 13, textAlign: "center" }}>Sin movimientos.</div>}
        {ledger.map((e, i) => {
          runByMon[e.moneda] = (runByMon[e.moneda] || 0) + e.delta;
          const run = runByMon[e.moneda];
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "90px 1.3fr 1fr 130px 150px", padding: "10px 18px", borderTop: `1px solid ${T.cardBorder}`, alignItems: "center", fontSize: 12.5 }}>
              <span style={{ color: T.muted }}>{fmtDate(e.fecha)}</span>
              <span style={{ color: T.text, fontWeight: 600 }}>
                {e.label}
                {e.concepto ? <span style={{ display: "block", color: T.dim, fontWeight: 400, fontSize: 11, marginTop: 2 }}>{e.concepto}</span> : null}
              </span>
              <span style={{ color: T.muted }}>{sociedadNombre(e.sociedad)}</span>
              <span style={{ textAlign: "right", fontFamily: T.mono, whiteSpace: "nowrap", color: e.delta >= 0 ? T.green : T.red }}>{e.delta >= 0 ? "+" : "−"}{fmtMoney(e.delta, e.moneda)}</span>
              <span style={{ textAlign: "right", fontFamily: T.mono, whiteSpace: "nowrap", color: run >= 0 ? T.text : T.red }}>{fmtMoney(run, e.moneda)} {run >= 0 ? "" : "(deb.)"}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function MovimientoModal({ modal, socios, sociedades, bancos, busy, setBusy, onClose, onGuardado }) {
  const [tipo, setTipo]   = useState(modal.tipo || "");
  const [err, setErr]     = useState("");
  // campos comunes
  const [socioId, setSocioId]     = useState(modal.socioId || "");
  const [cuentaId, setCuentaId]   = useState("");
  const [sociedad, setSociedad]   = useState("");
  const [moneda, setMoneda]       = useState("");
  const [monto, setMonto]         = useState("");
  const [fecha, setFecha]         = useState(hoy());
  const [nota, setNota]           = useState("");
  const [direccion, setDireccion] = useState("deudor");
  // declaración multi-socio
  const [total, setTotal]     = useState("");
  const [lineas, setLineas]   = useState([]);

  const meta = TIPO_MOV[tipo] || {};
  const cta  = bancos.find(b => String(b.id) === String(cuentaId));
  // Al elegir cuenta (tipos con caja), derivamos sociedad + moneda
  const socEfectiva = meta.cash ? (cta?.sociedad || "") : sociedad;
  const monEfectiva = meta.cash ? (cta?.moneda || "") : moneda;

  useEffect(() => {
    if (tipo === "dividendo_declarado") {
      setLineas(socios.filter(s => s.activo !== false).map(s => ({ socio_id: s.id, socio_nombre: s.nombre, sociedad: "", monto: "" })));
    }
    if (tipo === "apertura") setFecha("2026-06-30");
  }, [tipo]); // eslint-disable-line

  const aplicarReparto = () => {
    const rep = repartirDividendo(num(total), socios);
    const byId = Object.fromEntries(rep.map(r => [r.socio_id, r.monto]));
    setLineas(ls => ls.map(l => ({ ...l, monto: byId[l.socio_id] != null ? byId[l.socio_id].toLocaleString("es-AR") : l.monto })));
  };

  async function guardar() {
    setErr(""); setBusy(true);
    try {
      if (tipo === "dividendo_declarado") {
        const ls = lineas.map(l => ({ ...l, sociedad: l.sociedad || sociedad, monto: num(l.monto) })).filter(l => l.monto > 0);
        if (!ls.length) throw new Error("Cargá al menos un importe.");
        if (ls.some(l => !l.sociedad)) throw new Error("Elegí la sociedad de cada socio con importe (o el default de arriba).");
        await declararDividendo({ sociedad, moneda: moneda || "ARS", fecha, nota, lineas: ls });
      } else if (tipo === "apertura") {
        if (!socioId) throw new Error("Elegí el socio.");
        if (!sociedad) throw new Error("Elegí la sociedad.");
        if (num(monto) <= 0) throw new Error("Importe inválido.");
        const s = socios.find(x => String(x.id) === String(socioId));
        await aperturaSocio({ socio_id: socioId, socio_nombre: s?.nombre || "", sociedad, moneda: moneda || "ARS", monto: num(monto), direccion, fecha, nota });
      } else if (meta.cash) {
        if (!socioId) throw new Error("Elegí el socio.");
        if (!cuentaId) throw new Error("Elegí la cuenta origen.");
        if (num(monto) <= 0) throw new Error("Importe inválido.");
        const s = socios.find(x => String(x.id) === String(socioId));
        await appendMovSocio({ socio_id: socioId, socio_nombre: s?.nombre || "", socio_tipo: tipo, sociedad: socEfectiva, cuenta_bancaria: cuentaId, moneda: monEfectiva, monto: num(monto), fecha, nota });
      } else {
        throw new Error("Elegí un tipo de movimiento.");
      }
      await onGuardado();
    } catch (e) { setErr(String(e.message || e)); }
    setBusy(false);
  }

  const socioOpts    = socios.filter(s => s.activo !== false).map(s => ({ value: s.id, label: s.nombre }));
  const sociedadOpts = sociedades.map(s => ({ value: s.id, label: s.nombre }));
  const cuentaOpts   = bancos.map(b => ({ value: b.id, label: `${b.nombre} · ${b.moneda || "ARS"}${b.banco ? ` · ${b.banco}` : ""}` }));

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.card, borderRadius: 14, padding: 20, width: "100%", maxWidth: tipo === "dividendo_declarado" ? 600 : 560, maxHeight: "92vh", overflow: "auto", boxShadow: T.shadowMd }}>
        <div style={{ fontSize: 17, fontWeight: 900, color: T.text, marginBottom: 4 }}>Nuevo movimiento de socio</div>
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 18 }}>Todo esto es balance — nunca afecta el P&L.</div>

        <Field label="Tipo">
          <select value={tipo} onChange={e => setTipo(e.target.value)} style={inputStyle}>
            <option value="">— Elegí el tipo —</option>
            {ORDEN_TIPOS.map(k => <option key={k} value={k}>{TIPO_MOV[k].label}</option>)}
          </select>
        </Field>
        {meta.desc && <div style={{ fontSize: 12, color: T.dim, margin: "8px 0 4px" }}>{meta.desc}</div>}

        {tipo && (
          <div style={{ display: "grid", gap: 11, marginTop: 12 }}>
            {/* DECLARAR DIVIDENDO (multi-socio) */}
            {tipo === "dividendo_declarado" ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <Field label="Sociedad (default)"><select value={sociedad} onChange={e => { const v = e.target.value; setSociedad(v); setLineas(ls => ls.map(x => ({ ...x, sociedad: v }))); }} style={inputStyle}><option value="">—</option>{sociedadOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
                  <Field label="Moneda"><select value={moneda} onChange={e => setMoneda(e.target.value)} style={inputStyle}><option value="ARS">ARS</option><option value="USD">USD</option><option value="EUR">EUR</option></select></Field>
                  <Field label="Fecha"><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inputStyle} /></Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "end" }}>
                  <Field label="Monto total (opcional → reparte por %)"><input type="text" inputMode="numeric" value={total} onChange={e => setTotal(fmtMiles(e.target.value))} style={inputStyle} placeholder="0" /></Field>
                  <Btn variant="ghost" onClick={aplicarReparto}>Repartir por %</Btn>
                </div>
                <div style={{ border: `1px solid ${T.cardBorder}`, borderRadius: 8, overflow: "hidden" }}>
                  {lineas.map((l, i) => (
                    <div key={l.socio_id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px", gap: 10, alignItems: "center", padding: "7px 12px", borderTop: i ? `1px solid ${T.cardBorder}` : "none" }}>
                      <span style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{l.socio_nombre}</span>
                      <select value={l.sociedad || ""} onChange={e => { const v = e.target.value; setLineas(ls => ls.map((x, j) => j === i ? { ...x, sociedad: v } : x)); }} style={{ ...inputStyle, fontSize: 12, padding: "6px 8px" }}>
                        <option value="">— sociedad —</option>
                        {sociedadOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <input type="text" inputMode="numeric" value={l.monto} placeholder="0" onChange={e => { const v = fmtMiles(e.target.value); setLineas(ls => ls.map((x, j) => j === i ? { ...x, monto: v } : x)); }} style={{ ...inputStyle, textAlign: "right", padding: "6px 8px" }} />
                    </div>
                  ))}
                </div>
              </>
            ) : tipo === "apertura" ? (
              <>
                <Field label="Socio"><select value={socioId} onChange={e => setSocioId(e.target.value)} style={inputStyle}><option value="">—</option>{socioOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Sociedad"><select value={sociedad} onChange={e => setSociedad(e.target.value)} style={inputStyle}><option value="">—</option>{sociedadOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
                  <Field label="Moneda"><select value={moneda} onChange={e => setMoneda(e.target.value)} style={inputStyle}><option value="ARS">ARS</option><option value="USD">USD</option><option value="EUR">EUR</option></select></Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <Field label="Dirección"><select value={direccion} onChange={e => setDireccion(e.target.value)} style={inputStyle}><option value="deudor">Nos debe (activo)</option><option value="acreedor">Le debemos (pasivo)</option></select></Field>
                  <Field label="Importe"><input type="text" inputMode="numeric" value={monto} onChange={e => setMonto(fmtMiles(e.target.value))} style={{ ...inputStyle, textAlign: "right" }} placeholder="0" /></Field>
                  <Field label="Fecha"><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inputStyle} /></Field>
                </div>
              </>
            ) : (
              /* TIPOS CON CAJA */
              <>
                <Field label="Socio"><select value={socioId} onChange={e => setSocioId(e.target.value)} style={inputStyle}><option value="">—</option>{socioOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
                <Field label="Cuenta origen (define sociedad y moneda)">
                  <select value={cuentaId} onChange={e => setCuentaId(e.target.value)} style={inputStyle}><option value="">—</option>{cuentaOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                </Field>
                {cta && <div style={{ fontSize: 11, color: T.dim, marginTop: -6 }}>{meta.salida ? "Sale de" : "Entra a"} {sociedades.find(s => String(s.id) === String(cta.sociedad))?.nombre || cta.sociedad} · {cta.moneda || "ARS"}</div>}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Importe"><input type="text" inputMode="numeric" value={monto} onChange={e => setMonto(fmtMiles(e.target.value))} style={{ ...inputStyle, textAlign: "right" }} placeholder="0" /></Field>
                  <Field label="Fecha"><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inputStyle} /></Field>
                </div>
              </>
            )}
            <Field label="Nota (opcional)"><input value={nota} onChange={e => setNota(e.target.value)} style={inputStyle} placeholder="Detalle…" /></Field>
          </div>
        )}

        {err && <div style={{ background: T.redBg, color: T.red, padding: "8px 12px", borderRadius: 8, fontSize: 12, marginTop: 14 }}>{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn variant="accent" onClick={guardar} disabled={busy || !tipo}>{busy ? "Guardando…" : "Guardar"}</Btn>
        </div>
      </div>
    </div>
  );
}
