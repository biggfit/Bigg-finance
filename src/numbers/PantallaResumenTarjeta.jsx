import { useState, useEffect, useMemo } from "react";
import { T, PageHeader, Btn, fmtMoney } from "./theme";
import {
  fetchProveedores, fetchCuentas, fetchCentrosCosto, appendResumenTarjeta, fetchEgresos,
} from "../lib/numbersApi";
import { parseTarjetaPdf } from "./parsers/tarjetaPdf";

const inputStyle = {
  width: "100%", background: "#f9fafb", border: `1px solid ${T.cardBorder}`,
  borderRadius: 8, padding: "8px 12px", fontSize: 13, color: T.text,
  fontFamily: T.font, outline: "none", boxSizing: "border-box",
};
const cellStyle = { ...inputStyle, padding: "5px 7px", fontSize: 12, borderRadius: 6 };
const num = v => Number(v) || 0;
// Clave de memoria: normaliza comercio/titular para que matcheen mes a mes (mayúsculas, espacios colapsados).
const normCom = s => String(s || "").toUpperCase().replace(/\s+/g, " ").trim();
const nuevaLinea = (over = {}) => ({ comercio: "", titular: "", cuenta: "", cuentaId: "", cc: "", pesos: "", dolares: "", ...over });

// Resumen de tarjeta → un egreso por moneda. Cada línea: comercio + titular + cuenta + centro + moneda + monto.
// Reusa la maquinaria de egresos (CxP / conciliación / P&L). La tarjeta es un proveedor "^Tarjeta".
export default function PantallaResumenTarjeta({ sociedad }) {
  const [proveedores, setProveedores] = useState([]);
  const [cuentas, setCuentas]         = useState([]);
  const [centros, setCentros]         = useState([]);
  const [h, setH] = useState({ tarjetaId: "", tarjeta: "", periodo: "", fecha: new Date().toISOString().slice(0, 10), vto: "" });
  const [lineas, setLineas] = useState([nuevaLinea()]);
  const [histLineas, setHistLineas] = useState([]);   // líneas de resúmenes TC anteriores (memoria)
  const [busy, setBusy]     = useState(false);
  const [pdfMsg, setPdfMsg] = useState("");
  const [okMsg, setOkMsg]   = useState("");

  useEffect(() => {
    fetchProveedores().then(p => setProveedores(Array.isArray(p) ? p : [])).catch(() => {});
    fetchCuentas().then(c => setCuentas(Array.isArray(c) ? c : [])).catch(() => {});
    fetchCentrosCosto().then(c => setCentros(Array.isArray(c) ? c : [])).catch(() => {});
  }, []);

  // Memoria: líneas de resúmenes de tarjeta ya cargados (proveedor "^Tarjeta") → autocompletar cuenta/centro.
  useEffect(() => {
    fetchEgresos(sociedad)
      .then(egs => setHistLineas((Array.isArray(egs) ? egs : [])
        .filter(e => /^tarjeta/i.test(e.proveedor || ""))
        .flatMap(e => e.lineas || [])))
      .catch(() => {});
  }, [sociedad]);

  const tarjetas  = useMemo(() => proveedores.filter(p => /^tarjeta/i.test(p.nombre || "") && p.activo !== false), [proveedores]);
  const cuentaOpts = useMemo(() => cuentas.map(c => c.nombre).filter(Boolean), [cuentas]);
  const cuentaIdDe = (nombre) => cuentas.find(c => c.nombre === nombre)?.id ?? "";

  // De la memoria: cuenta ← por comercio; centro ← por comercio y, en su defecto, por titular. El último uso gana.
  const memoria = useMemo(() => {
    const porComercio = {}, centroPorComercio = {}, porTitular = {};
    for (const l of histLineas) {
      const com = normCom(l.comercio), tit = normCom(l.titular);
      if (com && l.cuenta) porComercio[com] = { cuenta: l.cuenta, cuentaId: l.cuentaId || "" };
      if (com && l.cc)     centroPorComercio[com] = l.cc;
      if (tit && l.cc)     porTitular[tit] = l.cc;
    }
    return { porComercio, centroPorComercio, porTitular };
  }, [histLineas]);

  const set = (k, v) => setH(s => ({ ...s, [k]: v }));
  const pickTarjeta = (id) => { const p = proveedores.find(x => String(x.id) === String(id)); setH(s => ({ ...s, tarjetaId: id, tarjeta: p?.nombre || "" })); };

  const updLinea = (i, k, v) => setLineas(ls => ls.map((l, idx) => idx !== i ? l : (k === "cuenta" ? { ...l, cuenta: v, cuentaId: cuentaIdDe(v) } : { ...l, [k]: v })));
  const addLinea = () => setLineas(ls => [...ls, nuevaLinea()]);
  const rmLinea  = (i) => setLineas(ls => ls.filter((_, idx) => idx !== i));

  async function onPdf(file) {
    if (!file) return;
    setPdfMsg("Leyendo PDF…");
    try {
      const r = await parseTarjetaPdf(file);
      if (!r.lineas.length) { setPdfMsg("No pude leer líneas del PDF — cargalas a mano."); return; }
      let conMemoria = 0;
      const nuevas = r.lineas.map(x => {
        const c  = memoria.porComercio[normCom(x.comercio)];
        const cc = memoria.centroPorComercio[normCom(x.comercio)] || memoria.porTitular[normCom(x.titular)] || "";
        if (c || cc) conMemoria++;
        return nuevaLinea({
          comercio: x.comercio, titular: x.titular || "",
          cuenta: c?.cuenta || "", cuentaId: c?.cuentaId || "", cc,
          [x.moneda === "USD" ? "dolares" : "pesos"]: x.monto,
        });
      });
      setLineas(nuevas);
      // Cabecera del PDF: precargar período, fecha de cierre y vencimiento si los trae.
      const hd = r.header || {};
      const hdMsg = [];
      if (hd.fechaCierre || hd.vto || hd.periodo) {
        setH(s => ({ ...s, periodo: hd.periodo || s.periodo, fecha: hd.fechaCierre || s.fecha, vto: hd.vto || s.vto }));
        if (hd.fechaCierre) hdMsg.push(`cierre ${hd.fechaCierre}`);
        if (hd.vto) hdMsg.push(`vto ${hd.vto}`);
      }
      setPdfMsg(`✓ ${r.lineas.length} líneas leídas`
        + (conMemoria ? ` · ${conMemoria} con cuenta/centro precargados de meses anteriores` : "")
        + (hdMsg.length ? ` · cabecera: ${hdMsg.join(", ")}` : "")
        + ". Revisá montos y completá lo que falte.");
    } catch (e) { setPdfMsg("Error al leer el PDF: " + (e?.message || e)); }
  }

  // "Aplicar a todas las vacías": setea un valor en las líneas que aún no lo tienen.
  const aplicarTodas = (k, v) => { if (!v) return; setLineas(ls => ls.map(l => l[k] ? l : (k === "cuenta" ? { ...l, cuenta: v, cuentaId: cuentaIdDe(v) } : { ...l, [k]: v }))); };

  const lineasOk = lineas.filter(l => (num(l.pesos) !== 0 || num(l.dolares) !== 0) && l.cuenta);
  const totPesos   = useMemo(() => lineasOk.reduce((s, l) => s + num(l.pesos), 0), [lineas]);
  const totDolares = useMemo(() => lineasOk.reduce((s, l) => s + num(l.dolares), 0), [lineas]);
  const canSave = h.tarjetaId && h.fecha && lineasOk.length > 0 && lineasOk.every(l => l.cc) && !busy;

  async function guardar() {
    if (!canSave) return;
    setBusy(true); setOkMsg("");
    try {
      // El importe va en la columna Pesos o Dólares → la moneda sale de cuál tiene valor.
      const payload = lineasOk.map(l => ({
        cuenta: l.cuenta, cuentaId: l.cuentaId, cc: l.cc, titular: l.titular, comercio: l.comercio,
        moneda: num(l.dolares) ? "USD" : "ARS", monto: num(l.dolares) || num(l.pesos),
      }));
      const r = await appendResumenTarjeta({ sociedad, tarjetaId: h.tarjetaId, tarjeta: h.tarjeta, periodo: h.periodo, fecha: h.fecha, vto: h.vto, lineas: payload });
      setOkMsg(`✓ Resumen guardado (${r.ids.map(x => x.moneda).join(" + ")}). Aparece en Egresos → Compras como CxP "Tarjeta de crédito".`);
      setLineas([nuevaLinea()]); setH(s => ({ ...s, periodo: "" }));
    } catch (e) { alert("Error al guardar: " + (e?.message || e)); }
    setBusy(false);
  }

  return (
    <div className="fade" style={{ padding: "28px 32px" }}>
      <PageHeader title="Resumen de tarjeta" subtitle="Cargá el resumen de la TC: una línea por consumo, con su cuenta, centro, titular y moneda. Se contabiliza como compra (CxP) por moneda." />

      <SectionCard title="Datos del resumen" cols="1.5fr 1fr 1fr 1fr">
        <Field label="Tarjeta *">
          <select value={h.tarjetaId} onChange={e => pickTarjeta(e.target.value)} style={inputStyle}>
            <option value="">{tarjetas.length ? "— elegir tarjeta —" : "(sin tarjetas: alta como proveedor \"Tarjeta …\")"}</option>
            {tarjetas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Field>
        <Field label="Período"><input value={h.periodo} onChange={e => set("periodo", e.target.value)} placeholder="2026-06" style={inputStyle} /></Field>
        <Field label="Fecha de cierre *"><input type="date" value={h.fecha} onChange={e => set("fecha", e.target.value)} style={inputStyle} /></Field>
        <Field label="Vencimiento"><input type="date" value={h.vto} onChange={e => set("vto", e.target.value)} style={inputStyle} /></Field>
      </SectionCard>

      {/* Subir PDF */}
      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: T.radius, padding: 14, marginBottom: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Cargar desde el PDF del resumen</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>Subí el PDF y se pre-cargan las líneas (best-effort). Después asignás cuenta/centro/titular y revisás moneda. Si no parsea, cargá a mano.</div>
          {pdfMsg && <div style={{ fontSize: 11, marginTop: 6, color: pdfMsg.startsWith("✓") ? T.green : pdfMsg.startsWith("Error") || pdfMsg.startsWith("No pude") ? T.red : T.muted }}>{pdfMsg}</div>}
        </div>
        <label style={{ background: T.accentDark, color: T.accent, borderRadius: 999, padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
          ⬆ Subir PDF
          <input type="file" accept=".pdf" style={{ display: "none" }} onChange={e => { onPdf(e.target.files[0]); e.target.value = ""; }} />
        </label>
      </div>

      {/* Tabla editable de líneas */}
      <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, overflow: "auto", boxShadow: T.shadow, marginBottom: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.tableHead, color: T.tableHeadText }}>
              {["Comercio", "Titular", "Cuenta", "Centro", "Pesos", "Dólares", ""].map((c, i) => (
                <th key={i} style={{ padding: "8px 10px", textAlign: (i === 4 || i === 5) ? "right" : "left", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${T.cardBorder}` }}>
                <td style={{ padding: "4px 8px" }}><input value={l.comercio} onChange={e => updLinea(i, "comercio", e.target.value)} style={{ ...cellStyle, minWidth: 230 }} /></td>
                <td style={{ padding: "4px 8px" }}><input value={l.titular} onChange={e => updLinea(i, "titular", e.target.value)} style={{ ...cellStyle, minWidth: 150 }} /></td>
                <td style={{ padding: "4px 8px" }}>
                  <select value={l.cuenta} onChange={e => updLinea(i, "cuenta", e.target.value)} style={{ ...cellStyle, width: 150, minWidth: 150, maxWidth: 150, color: l.cuenta ? T.text : T.red }}>
                    <option value="">— cuenta —</option>
                    {cuentaOpts.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
                <td style={{ padding: "4px 8px" }}>
                  <select value={l.cc} onChange={e => updLinea(i, "cc", e.target.value)} style={{ ...cellStyle, width: 150, minWidth: 150, maxWidth: 150, color: l.cc ? T.text : T.red }}>
                    <option value="">— centro —</option>
                    {centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </td>
                <td style={{ padding: "4px 8px" }}><input type="number" value={l.pesos} onChange={e => updLinea(i, "pesos", e.target.value)} placeholder="$" style={{ ...cellStyle, width: 88, textAlign: "right" }} /></td>
                <td style={{ padding: "4px 8px" }}><input type="number" value={l.dolares} onChange={e => updLinea(i, "dolares", e.target.value)} placeholder="U$D" style={{ ...cellStyle, width: 88, textAlign: "right" }} /></td>
                <td style={{ padding: "4px 8px", textAlign: "center" }}>
                  <button onClick={() => rmLinea(i)} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 15 }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `2px solid ${T.cardBorder}`, background: "#fafafa", fontWeight: 700, color: T.text }}>
              <td colSpan={4} style={{ padding: "8px 10px" }}>
                <button onClick={addLinea} style={{ background: "none", border: "none", color: T.blue, cursor: "pointer", fontSize: 12, fontFamily: T.font, fontWeight: 700 }}>+ Agregar línea</button>
              </td>
              <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: T.mono }}>{totPesos ? fmtMoney(totPesos, "ARS") : "—"}</td>
              <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: T.mono }}>{totDolares ? fmtMoney(totDolares, "USD") : "—"}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Aplicar a todas las vacías */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 16, fontSize: 12, color: T.muted }}>
        <span>Aplicar a las vacías:</span>
        <select onChange={e => { aplicarTodas("cuenta", e.target.value); e.target.value = ""; }} style={{ ...cellStyle, width: 170 }}>
          <option value="">cuenta…</option>{cuentaOpts.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select onChange={e => { aplicarTodas("cc", e.target.value); e.target.value = ""; }} style={{ ...cellStyle, width: 150 }}>
          <option value="">centro…</option>{centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>

      {okMsg && <div style={{ fontSize: 13, color: T.green, marginBottom: 12 }}>{okMsg}</div>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Btn variant="accent" onClick={guardar} disabled={!canSave}>{busy ? "Guardando…" : "Guardar resumen"}</Btn>
      </div>
    </div>
  );
}

function SectionCard({ title, children, cols = "1fr 1fr 1fr" }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, padding: 18, boxShadow: T.shadow, marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: T.dim, marginBottom: 12 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 14 }}>{children}</div>
    </div>
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
