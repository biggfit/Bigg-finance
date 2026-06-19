import { useState, useEffect, useMemo, Fragment } from "react";
import { T, PageHeader, Btn, fmtMoney } from "./theme";
import {
  fetchCuentas, fetchCentrosCosto, fetchCuentasBancarias,
  appendGastoDirecto, fetchGastos, fetchMovTesoreria, esCuentaCredito,
} from "../lib/numbersApi";
import { fetchLegajos } from "../lib/sueldosApi";
import { parseTarjetaPdf } from "./parsers/tarjetaPdf";

const inputStyle = {
  width: "100%", background: "#eceff3", border: "1px solid #d3d9e0",
  borderRadius: 8, padding: "8px 12px", fontSize: 13, color: T.text,
  fontFamily: T.font, outline: "none", boxSizing: "border-box",
};
const cellStyle = { ...inputStyle, padding: "5px 7px", fontSize: 12, borderRadius: 6 };
// Celda de monto: box justificado a la derecha que ocupa el ancho. Si el consumo es en la otra moneda, se oculta el box.
const moneyBox   = { ...cellStyle, width: "100%", textAlign: "right" };
const moneyMuted = { ...moneyBox, background: "transparent", border: "1px solid transparent", color: T.muted };

// Formato es-AR: puntos de miles, coma decimal. El estado guarda el número canónico (punto decimal).
const nfAR = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
function MoneyCell({ value, onChange, placeholder, muted }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const display = focused ? draft : (value === "" || value == null ? "" : nfAR.format(Number(value)));
  return (
    <input
      type="text" inputMode="decimal" value={display} placeholder={placeholder}
      style={muted ? moneyMuted : moneyBox}
      onFocus={() => { setDraft(value === "" || value == null ? "" : String(value).replace(".", ",")); setFocused(true); }}
      onBlur={() => setFocused(false)}
      onChange={e => { const raw = e.target.value; setDraft(raw); onChange(raw.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "")); }}
    />
  );
}
const num = v => Number(v) || 0;
// Clave de memoria: normaliza comercio/titular para que matcheen mes a mes (mayúsculas, espacios colapsados).
const normCom = s => String(s || "").toUpperCase().replace(/\s+/g, " ").trim();

// Fuzzy-match titular ↔ legajo (mismo criterio que el roster de Sedes, umbral 1.5).
const normNom = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
const overlapNom = (a, b) => { const wb = new Set(b.split(" ").filter(w => w.length > 2)); return a.split(" ").filter(w => w.length > 2 && wb.has(w)).length; };
const nameScore = (a, b) => a === b ? 4 : (a.includes(b) || b.includes(a)) ? 2 : overlapNom(a, b) >= 2 ? 1.5 : 0;
const nuevaLinea = (over = {}) => ({ comercio: "", titular: "", cuenta: "", cuentaId: "", cc: "", pesos: "", dolares: "", yaContab: false, fcDoc: "", ...over });
// Nombre base de una tarjeta (sin el token de moneda) para emparejar las cuentas ARS/USD de una misma tarjeta.
const baseTarjeta = s => String(s || "").replace(/\b(ARS|USD|EUR)\b|\$|u\$d|us\$/gi, "").replace(/\s+/g, " ").trim();

// Resumen de tarjeta. Al subir el PDF: reconoce las FCs ya pagadas con la tarjeta (no las recarga) y
// carga los consumos sin factura como gasto directo contra la cuenta-tarjeta (una cuenta tipo "tarjeta") de su moneda.
export default function PantallaResumenTarjeta({ sociedad }) {
  const [cuentasBanc, setCuentasBanc] = useState([]);   // cuentas bancarias (la tarjeta es una cuenta tipo "tarjeta")
  const [cuentas, setCuentas]         = useState([]);
  const [centros, setCentros]         = useState([]);
  const [h, setH] = useState({ tarjetaId: "", tarjeta: "", periodo: "", fecha: new Date().toISOString().slice(0, 10), vto: "" });
  const [lineas, setLineas] = useState([nuevaLinea()]);
  const [histLineas, setHistLineas] = useState([]);   // consumos de tarjeta anteriores (memoria)
  const [cardPagosFC, setCardPagosFC] = useState([]); // FCs ya pagadas con la tarjeta (para reconocer en el resumen)
  const [legajos, setLegajos] = useState([]);          // para sugerir el centro del legajo del titular
  const [busy, setBusy]     = useState(false);
  const [pdfMsg, setPdfMsg] = useState("");
  const [okMsg, setOkMsg]   = useState("");

  useEffect(() => {
    fetchCuentasBancarias().then(c => setCuentasBanc(Array.isArray(c) ? c : [])).catch(() => {});
    fetchCuentas().then(c => setCuentas(Array.isArray(c) ? c : [])).catch(() => {});
    fetchCentrosCosto().then(c => setCentros(Array.isArray(c) ? c : [])).catch(() => {});
    fetchLegajos().then(l => setLegajos(Array.isArray(l) ? l : [])).catch(() => {});
  }, []);

  // Tarjetas = cuentas bancarias tipo "tarjeta" de la sociedad.
  const tarjetas = useMemo(() => cuentasBanc.filter(c =>
    esCuentaCredito(c) &&
    (c.sociedad ?? "").toLowerCase() === (sociedad ?? "").toLowerCase()), [cuentasBanc, sociedad]);
  const tarjetaIds = useMemo(() => new Set(tarjetas.map(c => c.id)), [tarjetas]);
  // Una entrada por tarjeta (no por moneda): "Tarjeta Galicia Visa" en vez de ARS + USD por separado.
  // El ruteo por moneda lo hace cardAccountFor al guardar.
  const tarjetaFamilias = useMemo(() => {
    const seen = new Map();
    for (const c of tarjetas) { const b = baseTarjeta(c.nombre) || c.nombre; if (!seen.has(b)) seen.set(b, { id: c.id, nombre: b }); }
    return [...seen.values()];
  }, [tarjetas]);

  // Memoria + reconocimiento (cuando cambia la sociedad o las tarjetas):
  //  - histLineas: consumos directos previos en cuentas-tarjeta → autocompletar cuenta/centro.
  //  - cardPagosFC: pagos de FC hechos con la tarjeta (PAGO con documento_id) → reconocer en el resumen.
  useEffect(() => {
    if (!tarjetas.length) { setHistLineas([]); setCardPagosFC([]); return; }
    fetchGastos(sociedad)
      .then(gs => setHistLineas((Array.isArray(gs) ? gs : []).filter(g => tarjetaIds.has(g.cuentaBancaria))))
      .catch(() => {});
    fetchMovTesoreria(sociedad)
      .then(ms => setCardPagosFC((Array.isArray(ms) ? ms : [])
        .filter(m => tarjetaIds.has(m.cuenta_bancaria) && m.tipo === "PAGO" && m.documento_id && !String(m.referencia || "").includes("res="))))
      .catch(() => {});
  }, [sociedad, tarjetas, tarjetaIds]);

  const cuentaOpts = useMemo(() => cuentas.map(c => c.nombre).filter(Boolean), [cuentas]);
  const cuentaIdDe = (nombre) => cuentas.find(c => c.nombre === nombre)?.id ?? "";

  // De la memoria (consumos directos previos en la tarjeta): cuenta ← por comercio (=nota); centro ← por comercio.
  const memoria = useMemo(() => {
    const porComercio = {}, centroPorComercio = {};
    for (const g of histLineas) {
      const com = normCom(g.nota);
      if (com && g.cuenta_contable) porComercio[com] = { cuenta: g.cuenta_contable, cuentaId: cuentaIdDe(g.cuenta_contable) };
      if (com && g.cc)              centroPorComercio[com] = g.cc;
    }
    return { porComercio, centroPorComercio };
  }, [histLineas, cuentas]);

  // Centro del legajo del titular (fallback cuando la memoria no encontró nada).
  const legajosNorm = useMemo(() => legajos.map(l => ({ sede_id: l.sede_id, _norm: normNom(l.nombre) })).filter(l => l.sede_id && l._norm), [legajos]);
  const centroIds   = useMemo(() => new Set(centros.map(c => c.id)), [centros]);
  const centroDeLegajo = (titular) => {
    const t = normNom(titular); if (!t) return "";
    let best = null, score = 0;
    for (const l of legajosNorm) { const s = nameScore(t, l._norm); if (s > score) { score = s; best = l; } }
    // Fallback por apellido único: cubre apodos (banco "GUILLERMO MAZZONI" = legajo "Gigio Mazzoni").
    // El último token suele ser el apellido; si un solo legajo lo lleva, no hay ambigüedad.
    if (score < 1.5) {
      const toks = t.split(" ").filter(w => w.length > 3);
      const ape  = toks[toks.length - 1];
      const cand = ape ? legajosNorm.filter(l => l._norm.split(" ").includes(ape)) : [];
      if (cand.length === 1) { best = cand[0]; score = 1.5; }
    }
    return (score >= 1.5 && best && centroIds.has(best.sede_id)) ? best.sede_id : "";
  };

  const set = (k, v) => setH(s => ({ ...s, [k]: v }));
  const pickTarjeta = (id) => { const c = tarjetas.find(x => String(x.id) === String(id)); setH(s => ({ ...s, tarjetaId: id, tarjeta: c?.nombre || "" })); };
  // Cuenta-tarjeta de la moneda pedida, dentro de la misma "familia" que la seleccionada (ej. Visa ARS / Visa USD).
  const cardAccountFor = (moneda) => {
    const sel = tarjetas.find(c => c.id === h.tarjetaId);
    if (sel && sel.moneda === moneda) return sel;
    const base = baseTarjeta(sel?.nombre);
    return tarjetas.find(c => c.moneda === moneda && baseTarjeta(c.nombre) === base)
        || tarjetas.find(c => c.moneda === moneda) || null;
  };

  const updLinea = (i, k, v) => setLineas(ls => ls.map((l, idx) => idx !== i ? l : (k === "cuenta" ? { ...l, cuenta: v, cuentaId: cuentaIdDe(v) } : { ...l, [k]: v })));
  const addLinea = () => setLineas(ls => [...ls, nuevaLinea()]);
  const rmLinea  = (i) => setLineas(ls => ls.filter((_, idx) => idx !== i));

  async function onPdf(file) {
    if (!file) return;
    setPdfMsg("Leyendo PDF…");
    try {
      const r = await parseTarjetaPdf(file);
      if (!r.lineas.length) { setPdfMsg("No pude leer líneas del PDF — cargalas a mano."); return; }
      let conMemoria = 0, reconocidas = 0;
      // Pool de pagos de FC ya hechos con la tarjeta, para reconocer (cada uno matchea una sola línea).
      const pool = cardPagosFC.map(m => ({ monto: Math.abs(Number(m.monto) || 0), doc: m.documento_id, used: false }));
      const nuevas = r.lineas.map(x => {
        const monto = Math.abs(Number(x.monto) || 0);
        const hit = pool.find(p => !p.used && Math.abs(p.monto - monto) <= 0.5);
        if (hit) {  // ya está contabilizada (FC pagada con la tarjeta) → no se recarga
          hit.used = true; reconocidas++;
          return nuevaLinea({ comercio: x.comercio, titular: x.titular || "", yaContab: true, fcDoc: hit.doc,
            [x.moneda === "USD" ? "dolares" : "pesos"]: x.monto });
        }
        const c  = memoria.porComercio[normCom(x.comercio)];
        const cc = memoria.centroPorComercio[normCom(x.comercio)] || centroDeLegajo(x.titular) || "";
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
        + (reconocidas ? ` · ${reconocidas} ya contabilizadas (pago de FC con tarjeta) → no se recargan` : "")
        + (conMemoria ? ` · ${conMemoria} con cuenta/centro precargados` : "")
        + (hdMsg.length ? ` · cabecera: ${hdMsg.join(", ")}` : "")
        + ". Revisá y completá lo que falte.");
    } catch (e) { setPdfMsg("Error al leer el PDF: " + (e?.message || e)); }
  }

  // "Aplicar a todas las vacías": setea un valor en las líneas que aún no lo tienen.
  const aplicarTodas = (k, v) => { if (!v) return; setLineas(ls => ls.map(l => l[k] ? l : (k === "cuenta" ? { ...l, cuenta: v, cuentaId: cuentaIdDe(v) } : { ...l, [k]: v }))); };

  // Cortes por titular (como el resumen): cada grupo lleva su subtotal en pesos y dólares.
  const gruposTit = useMemo(() => {
    const order = [], by = new Map();
    lineas.forEach((l, idx) => { const k = l.titular || ""; if (!by.has(k)) { by.set(k, []); order.push(k); } by.get(k).push(idx); });
    return order.map(tit => {
      const idxs = by.get(tit);
      return { tit, idxs, p: idxs.reduce((s, i) => s + num(lineas[i].pesos), 0), d: idxs.reduce((s, i) => s + num(lineas[i].dolares), 0) };
    });
  }, [lineas]);

  // Líneas a GUARDAR = consumos sin factura (no reconocidos) con monto + cuenta. Las "ya contabilizadas" se saltean.
  const lineasOk = lineas.filter(l => !l.yaContab && (num(l.pesos) !== 0 || num(l.dolares) !== 0) && l.cuenta);
  // Totales de TODAS las líneas cargadas (no solo las ya imputadas) → para cruzar contra el resumen.
  const totPesos   = useMemo(() => lineas.reduce((s, l) => s + num(l.pesos), 0), [lineas]);
  const totDolares = useMemo(() => lineas.reduce((s, l) => s + num(l.dolares), 0), [lineas]);
  const canSave = h.tarjetaId && h.fecha && lineasOk.length > 0 && lineasOk.every(l => l.cc) && !busy;

  async function guardar() {
    if (!canSave) return;
    setBusy(true); setOkMsg("");
    try {
      // Cada consumo sin factura = un gasto directo contra la cuenta-tarjeta de su moneda (sube la deuda de la tarjeta).
      let n = 0, faltaCuenta = "";
      for (const l of lineasOk) {
        const moneda = num(l.dolares) ? "USD" : "ARS";
        const monto  = num(l.dolares) || num(l.pesos);
        const card   = cardAccountFor(moneda);
        if (!card) { faltaCuenta = moneda; continue; }
        await appendGastoDirecto({
          sociedad, fecha: h.fecha, cuenta_bancaria: card.id,
          cuenta_contable: l.cuenta, cuenta_contable_id: l.cuentaId, cc: l.cc,
          moneda, subtotal: monto, ivaRate: 0,
          nota: [l.comercio, l.titular].filter(Boolean).join(" · "),
          referencia: `tc=${h.tarjeta} ${h.periodo}`.trim(),
        });
        n++;
      }
      setOkMsg(`✓ ${n} consumo(s) cargados como gasto en la tarjeta.`
        + (faltaCuenta ? ` ⚠️ Faltó la cuenta-tarjeta en ${faltaCuenta} (creala en Maestros).` : "")
        + ` Las líneas ya contabilizadas (pagos de FC) no se recargaron.`);
      setLineas([nuevaLinea()]); setH(s => ({ ...s, periodo: "" }));
    } catch (e) { alert("Error al guardar: " + (e?.message || e)); }
    setBusy(false);
  }

  return (
    <div className="fade" style={{ padding: "28px 32px" }}>
      <PageHeader title="Resumen de tarjeta" subtitle="Subí el PDF: las FCs ya pagadas con la tarjeta se reconocen y no se recargan; los consumos sin factura se cargan como gasto contra la cuenta-tarjeta." />

      <SectionCard title="Datos del resumen" cols="1.5fr 1fr 1fr 1fr">
        <Field label="Tarjeta *">
          <select value={h.tarjetaId} onChange={e => pickTarjeta(e.target.value)} style={inputStyle}>
            <option value="">{tarjetaFamilias.length ? "— elegir tarjeta —" : "(sin tarjetas: alta una cuenta tipo \"tarjeta\" en Maestros)"}</option>
            {tarjetaFamilias.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
          <div style={{ fontSize: 10.5, color: T.muted, marginTop: 3 }}>Pesos y dólares se rutean a la cuenta de cada moneda automáticamente.</div>
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
            {gruposTit.map(g => (
              <Fragment key={g.tit || "(sin titular)"}>
                {g.idxs.map(i => {
                  const l = lineas[i];
                  const esP = num(l.pesos) !== 0, esD = num(l.dolares) !== 0;   // moneda activa de la línea
                  return (
                  <tr key={i} style={{ borderTop: `1px solid ${T.cardBorder}`, background: l.yaContab ? "#f0fdf4" : undefined, opacity: l.yaContab ? 0.85 : 1 }}>
                    <td style={{ padding: "4px 8px" }}><input value={l.comercio} onChange={e => updLinea(i, "comercio", e.target.value)} style={{ ...cellStyle, minWidth: 230 }} /></td>
                    <td style={{ padding: "4px 8px" }}><input value={l.titular} onChange={e => updLinea(i, "titular", e.target.value)} style={{ ...cellStyle, minWidth: 150 }} /></td>
                    {l.yaContab ? (
                      <td colSpan={2} style={{ padding: "4px 8px", fontSize: 11.5, color: T.green, fontWeight: 700 }}>
                        ✓ Ya contabilizada (pago de FC con tarjeta) — no se recarga
                      </td>
                    ) : (<>
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
                    </>)}
                    <td style={{ padding: "4px 3px", width: 108, minWidth: 108, maxWidth: 108 }}><MoneyCell value={l.pesos} onChange={v => updLinea(i, "pesos", v)} placeholder={esD ? "" : "$"} muted={esD} /></td>
                    <td style={{ padding: "4px 3px", width: 108, minWidth: 108, maxWidth: 108 }}><MoneyCell value={l.dolares} onChange={v => updLinea(i, "dolares", v)} placeholder={esP ? "" : "U$D"} muted={esP} /></td>
                    <td style={{ padding: "4px 8px", textAlign: "center" }}>
                      <button onClick={() => rmLinea(i)} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 15 }}>×</button>
                    </td>
                  </tr>
                  );
                })}
                <tr style={{ borderTop: `1px solid ${T.cardBorder}`, background: "#e6eaf0", fontWeight: 700, color: T.text }}>
                  <td colSpan={4} style={{ padding: "6px 10px", fontSize: 11.5 }}>Total Consumos de {g.tit || "Sin titular"}</td>
                  <td style={{ padding: "6px 7px", textAlign: "right", fontFamily: T.mono }}>{g.p ? fmtMoney(g.p, "ARS") : "—"}</td>
                  <td style={{ padding: "6px 7px", textAlign: "right", fontFamily: T.mono }}>{g.d ? fmtMoney(g.d, "USD") : "—"}</td>
                  <td />
                </tr>
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: `2px solid ${T.cardBorder}`, background: "#fafafa", fontWeight: 700, color: T.text }}>
              <td colSpan={4} style={{ padding: "8px 10px" }}>
                <button onClick={addLinea} style={{ background: "none", border: "none", color: T.blue, cursor: "pointer", fontSize: 12, fontFamily: T.font, fontWeight: 700 }}>+ Agregar línea</button>
              </td>
              <td style={{ padding: "8px 7px", textAlign: "right", fontFamily: T.mono }}>{totPesos ? fmtMoney(totPesos, "ARS") : "—"}</td>
              <td style={{ padding: "8px 7px", textAlign: "right", fontFamily: T.mono }}>{totDolares ? fmtMoney(totDolares, "USD") : "—"}</td>
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
