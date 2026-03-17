import { memo, useState, useMemo, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { useStore } from "../lib/context";
import { makeType, MONTHS, AVAILABLE_YEARS, DOCS, CUENTAS, CUENTA_LABEL, COMP_TYPES, SYM, uid, CURRENCIES, COMPANIES } from "../lib/helpers";
import { todayDmy } from "../data/franchisor";
import { TypePill } from "../components/atoms";
import PendientesPanel from "../components/PendientesPanel";
import { buildFacturaPDF, buildInvoicePDF, downloadTextAsPDF } from "../lib/pdf";
import { emitirComprobante, formatInvoiceLabel } from "../lib/facturanteApi";

// ─── TAB: EMISIÓN DE COMPROBANTES ────────────────────────────────────────────
const EMIT_MODE  = { SELECT: "select", MANUAL: "manual", CRM: "crm", EXCEL: "excel" };
const FACT_STAGE = { IDLE: "idle", PREVIEW: "preview", PROCESSING: "processing", DONE: "done" };

// ── helpers para importe formateado ────────────────────────────────────────
function formatCurrencyInput(raw, cur) {
  // raw es string con lo que el usuario tipea, devuelve string formateado
  const digits = raw.replace(/[^\d,]/g, "");
  const [intPart, decPart] = digits.split(",");
  const intFormatted = (intPart ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (digits.includes(",")) return `${intFormatted},${(decPart ?? "").slice(0, 2)}`;
  return intFormatted;
}
function parseCurrencyInput(formatted) {
  // "1.234.567,89" → 1234567.89
  if (!formatted) return 0;
  const clean = formatted.replace(/\./g, "").replace(",", ".");
  return parseFloat(clean) || 0;
}
// dmy "DD/MM/AAAA" ↔ ISO "AAAA-MM-DD" para input type=date
function dmyToInputDate(dmy) {
  if (!dmy || !dmy.includes("/")) return "";
  const [d, m, y] = dmy.split("/");
  return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
}
function inputDateToDmy(iso) {
  if (!iso || !iso.includes("-")) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Tipos que son movimientos financieros (solo afectan CC, sin documento)
const TIPOS_MOVIMIENTO  = ["PAGO","PAGO_PAUTA","PAGO_ENVIADO"];

// ── Modo Manual ─────────────────────────────────────────────────────────────
// ── Wizard emisión manual ────────────────────────────────────────────────────
// Pasos: 1-tipo  2-sede  3-formulario
function ModoManual({ month, year, onAddComp, onDone, franchisor, prefillFr, prefillComp }) {
  const { franchises, comps, activeCompany } = useStore();
  const activeCurrency = COMPANIES[activeCompany]?.currency ?? "ARS";
  const activeFr = franchises.filter(f => f.activa !== false).sort((a,b) => a.name.localeCompare(b.name, "es"));

  const todayIso = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`; };

  // wizard state
  const [step,      setStep]      = useState(prefillFr ? (prefillComp ? 3 : 2) : 1);
  const [wizType,   setWizType]   = useState(prefillComp ? "comprobante" : null); // "comprobante"|"movimiento"
  const [frSearch,  setFrSearch]  = useState(prefillFr ? prefillFr.name : "");
  const [frId,      setFrId]      = useState(prefillFr?.id != null ? String(prefillFr.id) : "");
  const [done,      setDone]      = useState(false);

  // comprobante state
  const IVA_RATE = 0.21;
  const parsePrefill = (t) => {
    if (!t) return { doc: "FACTURA", cuenta: "FEE" };
    if (t === "PAGO_PAUTA") return { doc: "FACTURA", cuenta: "PAUTA" };
    if (t.includes("|")) { const [d,c] = t.split("|"); return { doc: d, cuenta: c }; }
    if (t.startsWith("FACT_")) return { doc: "FACTURA", cuenta: t.replace("FACT_","") };
    if (t.startsWith("NC_"))   return { doc: "NC",      cuenta: t.replace("NC_","") };
    return { doc: "FACTURA", cuenta: "FEE" };
  };
  const prefill = parsePrefill(prefillComp?.type);
  const [doc,        setDoc]       = useState(prefill.doc);
  const [cuenta,     setCuenta]    = useState(prefill.cuenta);
  const [importeRaw, setImporteRaw] = useState(prefillComp?.amount ? formatCurrencyInput(String(prefillComp.amount), "ARS") : "");
  const [concepto,   setConcepto]  = useState(prefillComp ? `Factura por Pago a Cuenta ${MONTHS[prefillComp.month ?? month]} ${prefillComp.year ?? year}` : "");
  const [fechaIso,   setFechaIso]  = useState(todayIso);
  const [preview,    setPreview]   = useState(null);
  const [emitState, setEmitState] = useState("idle"); // "idle"|"emitting"|"error"
  const [emitError, setEmitError] = useState(null);
  const [refCompId, setRefCompId] = useState(null); // facturanteId of referenced invoice (NC only)

  // movimiento state
  const [movTipo,    setMovTipo]   = useState("PAGO");
  const [movImpRaw,  setMovImpRaw] = useState("");
  const [movConcepto,setMovConcepto] = useState("");
  const [movFecha,   setMovFecha]  = useState(todayIso);
  const [currency,    setCurrency]    = useState(activeCurrency);
  const [movCurrency, setMovCurrency] = useState(activeCurrency);

  const fr     = activeFr.find(f => f.id === parseInt(frId));
  const isAR   = fr?.country === "Argentina";
  const applyIVA = !!(fr?.applyIVA);
  const sym    = SYM[currency] ?? "$";

  const importeNeto  = parseCurrencyInput(importeRaw);
  const importeIVA   = applyIVA ? importeNeto * IVA_RATE : 0;
  const importeTotal = importeNeto + importeIVA;
  const tipo         = makeType(doc, cuenta);
  const movImporte   = parseCurrencyInput(movImpRaw);

  const fmtBig = (v) => v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const filteredFr = frSearch.trim()
    ? activeFr.filter(f => f.name.toLowerCase().includes(frSearch.toLowerCase()))
    : activeFr;

  const inputS = { padding: "9px 12px", fontSize: 14, borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)", fontFamily: "var(--font)", width: "100%", boxSizing: "border-box" };
  const labelS = { fontSize: 10, fontWeight: 700, color: "var(--muted)", letterSpacing: ".08em", display: "block", marginBottom: 6 };

  const goBack = () => {
    if (step === 3) { setStep(2); setPreview(null); }
    else if (step === 2) { setStep(1); setFrId(""); setFrSearch(""); }
    else onDone();
  };

  // ── breadcrumb ──
  const Crumb = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
      <button className="ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={goBack}>← Volver</button>
      <div style={{ width: 1, height: 14, background: "var(--border2)" }} />
      {wizType && (
        <span className="pill" style={{
          fontSize: 10, padding: "2px 8px",
          color: wizType === "comprobante" ? "var(--blue)" : "var(--green)",
          background: wizType === "comprobante" ? "rgba(96,165,250,.12)" : "rgba(16,217,122,.12)"
        }}>
          {wizType === "comprobante" ? "🧾 Comprobante" : "💸 Movimiento"}
        </span>
      )}
      {fr && <span style={{ fontSize: 12, fontWeight: 700 }}>{fr.name}</span>}
      {fr && <span style={{ fontSize: 11, color: "var(--muted)" }}>{currency}</span>}
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", gap: 6 }}>
        {[1,2,3].map(s => (
          <div key={s} style={{
            width: s <= step ? 20 : 6, height: 6, borderRadius: 3,
            background: s < step ? "var(--accent)" : s === step ? "var(--accent)" : "var(--border2)",
            opacity: s === step ? 1 : s < step ? .5 : .25,
            transition: "all .2s",
          }} />
        ))}
      </div>
    </div>
  );

  // ── done ──
  if (done) return (
    <div className="fade" style={{ textAlign: "center", padding: "60px 0" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
      <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>
        {wizType === "comprobante" ? "Comprobante generado" : "Movimiento registrado"}
      </div>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 28 }}>
        Para <strong>{fr?.name}</strong> — registrado en CC
      </div>
      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <button className="ghost" onClick={() => { setStep(1); setWizType(null); setFrId(""); setFrSearch(""); setImporteRaw(""); setMovImpRaw(""); setConcepto(""); setMovConcepto(""); setPreview(null); setDone(false); }}>+ Nuevo</button>
        <button className="btn" onClick={onDone}>Volver al inicio</button>
      </div>
    </div>
  );

  // ── PASO 1: tipo ──
  if (step === 1) return (
    <div className="fade">
      <Crumb />
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>¿Qué querés registrar?</div>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Paso 1 de 3</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {[
          { k: "comprobante", icon: "🧾", label: "Comprobante", color: "var(--blue)", bg: "rgba(96,165,250,.06)", border: "rgba(96,165,250,.2)",
            lines: ["Factura o Nota de Crédito", "Con IVA — genera documento descargable"] },
          { k: "movimiento",  icon: "💸", label: "Movimiento financiero", color: "var(--green)", bg: "rgba(16,217,122,.06)", border: "rgba(16,217,122,.2)",
            lines: ["Pago recibido, pago a cuenta", "Sin impuestos — se imputa directo a CC"] },
        ].map(opt => (
          <div key={opt.k} onClick={() => { setWizType(opt.k); setStep(2); }}
            style={{ background: opt.bg, border: `1.5px solid ${opt.border}`, borderRadius: 14, padding: "28px 24px", cursor: "pointer", transition: "all .15s" }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 24px rgba(0,0,0,.18)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = ""; }}
          >
            <div style={{ fontSize: 36, marginBottom: 14 }}>{opt.icon}</div>
            <div style={{ fontWeight: 800, fontSize: 17, color: opt.color, marginBottom: 10 }}>{opt.label}</div>
            {opt.lines.map((l,i) => <div key={i} style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>{l}</div>)}
            <div style={{ marginTop: 18, fontSize: 11, color: opt.color, fontWeight: 700 }}>Seleccionar →</div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── PASO 2: sede ──
  if (step === 2) return (
    <div className="fade">
      <Crumb />
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>¿Para qué sede?</div>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Paso 2 de 3</div>
      </div>
      <input
        autoFocus
        value={frSearch}
        onChange={e => setFrSearch(e.target.value)}
        placeholder="Buscar sede..."
        style={{ ...inputS, marginBottom: 12, fontSize: 15 }}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, maxHeight: 420, overflowY: "auto" }}>
        {filteredFr.map(f => (
          <div key={f.id} onClick={() => { setFrId(String(f.id)); setStep(3); }}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border2)", cursor: "pointer", background: "var(--bg)", transition: "all .1s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--bg2)"; e.currentTarget.style.borderColor = "var(--accent)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "var(--bg)"; e.currentTarget.style.borderColor = "var(--border2)"; }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>{f.name}</span>
            <span style={{ fontSize: 10, color: "var(--muted)", background: "var(--bg2)", borderRadius: 4, padding: "2px 6px" }}>{f.country}</span>
          </div>
        ))}
        {filteredFr.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13, padding: 12 }}>Sin resultados</div>}
      </div>
    </div>
  );

  // ── PASO 3: formulario ──
  // — comprobante —
  if (step === 3 && wizType === "comprobante") {
    const symComp = SYM[currency] ?? "$";
    const handlePreview = () => {
      if (!tipo || importeNeto <= 0) return;
      const mesComp  = parseInt(fechaIso.split("-")[1]) - 1;
      const anioComp = parseInt(fechaIso.split("-")[0]);
      const autoConcepto = `${doc === "FACTURA" ? "Factura" : "NC"} - ${CUENTA_LABEL[cuenta] ?? cuenta} - ${MONTHS[mesComp]} ${anioComp}`;
      const notaFinal = concepto || autoConcepto;
      setPreview({
        id: uid(), type: tipo, date: inputDateToDmy(fechaIso),
        amount: importeTotal, amountNeto: importeNeto, amountIVA: importeIVA,
        ref: notaFinal, nota: notaFinal,
        month: mesComp, year: anioComp,
        currency,
      });
    };
    const usaFacturante = isAR && currency === "ARS" && (doc === "FACTURA" || doc === "NC");

    const doConfirm = async (skipFacturante = false) => {
      if (!preview) return;
      let enriched = { ...preview };

      if (usaFacturante && !skipFacturante) {
        setEmitState("emitting");
        setEmitError(null);
        try {
          const result = await emitirComprobante({
            franchisor: franchisor?.ar ?? franchisor,
            franchise:  fr,
            comp:       { ...preview, applyIVA: applyIVA },
            referenciaIdComprobante: refCompId ?? undefined,
          });
          enriched = {
            ...preview,
            invoice:      formatInvoiceLabel(result.tipoComprobante, result.idComprobante, result.puntoVenta),
            facturanteId: String(result.idComprobante),
          };
          setEmitState("idle");
        } catch (err) {
          setEmitState("error");
          setEmitError(err.message ?? "Error al emitir ante AFIP");
          return; // no continúa — usuario decide reintentar o guardar igual
        }
      }

      onAddComp(fr.id, enriched);
      const pdfText = isAR ? buildFacturaPDF(fr, franchisor, enriched) : buildInvoicePDF(fr, franchisor, enriched);
      downloadTextAsPDF(pdfText, `${isAR ? "Factura" : "Invoice"}_${fr.name}_${MONTHS[preview.month]}_${preview.year}.html`);
      setDone(true);
    };
    const handleConfirm = () => doConfirm(false);
    const mesComp   = parseInt(fechaIso.split("-")[1]) - 1;
    const anioComp  = parseInt(fechaIso.split("-")[0]);
    const autoConcepto = `${doc === "FACTURA" ? "Factura" : "NC"} - ${CUENTA_LABEL[cuenta] ?? cuenta} - ${MONTHS[mesComp]} ${anioComp}`;

    return (
      <div className="fade">
        <Crumb />

        {/* 2 columnas: izq = Fecha + Cuenta / der = Tipo doc + Moneda + Importe */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 14, marginBottom: 16, alignItems: "start" }}>
          {/* Columna izquierda: Fecha + Cuenta (mismo ancho) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelS}>FECHA</label>
              <input type="date" value={fechaIso} onChange={e => { setFechaIso(e.target.value); setPreview(null); }}
                style={{ ...inputS, cursor: "pointer", colorScheme: "dark", fontWeight: 700 }} />
            </div>
            <div>
              <label style={labelS}>CUENTA</label>
              <select value={cuenta} onChange={e => { setCuenta(e.target.value); setPreview(null); }}
                style={{ ...inputS, fontWeight: 700, fontSize: 13 }}>
                {CUENTAS.map(c => <option key={c} value={c}>{CUENTA_LABEL[c]}</option>)}
              </select>
            </div>
          </div>
          {/* Columna derecha: Tipo doc + Moneda/Importe */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelS}>TIPO DE DOCUMENTO</label>
              <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1.5px solid var(--border2)" }}>
                {DOCS.map(d => (
                  <div key={d} onClick={() => { setDoc(d); setPreview(null); }} style={{
                    flex: 1, padding: "9px 18px", cursor: "pointer", fontWeight: 800, fontSize: 13,
                    background: doc === d ? (d === "FACTURA" ? "rgba(255,85,112,.18)" : "rgba(16,217,122,.18)") : "transparent",
                    color: doc === d ? (d === "FACTURA" ? "var(--red)" : "var(--green)") : "var(--muted)",
                    borderRight: d === "FACTURA" ? "1px solid var(--border2)" : "none",
                    transition: "all .12s", textAlign: "center",
                  }}>
                    {d === "FACTURA" ? "🧾 Factura" : "📋 NC"}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "start" }}>
              <div>
                <label style={labelS}>MONEDA</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {CURRENCIES.map(cur => (
                    <button key={cur} onClick={() => { setCurrency(cur); setPreview(null); }} style={{
                      padding: "8px 14px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "none", fontFamily: "var(--font)",
                      background: currency === cur ? "var(--accent)" : "var(--bg)",
                      color: currency === cur ? "#1e2022" : "var(--muted)",
                      outline: currency === cur ? "none" : "1px solid var(--border2)",
                    }}>{cur}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={labelS}>{applyIVA ? "NETO (sin IVA)" : "IMPORTE"}</label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: 13, pointerEvents: "none" }}>{symComp}</span>
                  <input value={importeRaw}
                    onChange={e => { if (!e.target.value) { setImporteRaw(""); setPreview(null); return; } setImporteRaw(formatCurrencyInput(e.target.value.replace(/[^\d,]/g,""), currency)); setPreview(null); }}
                    placeholder="0,00" inputMode="decimal"
                    style={{ ...inputS, paddingLeft: 26, textAlign: "right", fontWeight: 700 }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Fila 3: Descripción + IVA breakdown (siempre visible si applyIVA) */}
        <div style={{ display: "grid", gridTemplateColumns: applyIVA ? "1fr auto" : "1fr", gap: 14, marginBottom: 20, alignItems: "end" }}>
          <div>
            <label style={labelS}>DESCRIPCIÓN <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— editable</span></label>
            <input value={concepto || autoConcepto}
              onChange={e => { setConcepto(e.target.value); setPreview(null); }}
              onFocus={e => { if (!concepto) setConcepto(autoConcepto); }}
              style={inputS} />
          </div>
          {applyIVA && (
            <div style={{ display: "flex", gap: 0, border: "1px solid var(--border2)", borderRadius: 8, overflow: "hidden", alignSelf: "end" }}>
              {[["NETO", importeNeto, "var(--text)"], ["IVA 21%", importeIVA, "var(--blue)"], ["TOTAL", importeTotal, "var(--accent)"]].map(([l, v, c], i) => (
                <div key={l} style={{
                  padding: "8px 16px", textAlign: "center",
                  borderRight: i < 2 ? "1px solid var(--border2)" : "none",
                  background: i === 2 ? "rgba(173,255,25,.05)" : "transparent",
                }}>
                  <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700, letterSpacing: ".06em", marginBottom: 4 }}>{l}</div>
                  <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: c, whiteSpace: "nowrap" }}>{symComp} {fmtBig(v)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview inline */}
        {preview && (
          <div style={{ marginBottom: 20, background: "rgba(16,217,122,.05)", border: "1px solid rgba(16,217,122,.2)", borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: "var(--muted)", letterSpacing: ".1em", marginBottom: 10 }}>CONFIRMACIÓN</div>
            {[
              ["Tipo",        COMP_TYPES[preview.type]?.label],
              ["Importe",     applyIVA ? `${symComp} ${fmtBig(preview.amountNeto)} neto + IVA = ${symComp} ${fmtBig(preview.amount)}` : `${symComp} ${fmtBig(preview.amount)}`],
              ["Moneda",      preview.currency],
              ["Fecha",       preview.date],
              ["Descripción", preview.nota],
              ["Documento",   isAR ? "Factura AR (ÑAKO SRL)" : "Invoice (BIGG FIT LLC)"],
            ].map(([k,v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, borderBottom: "1px solid var(--border)", paddingBottom: 4, marginBottom: 4 }}>
                <span style={{ color: "var(--muted)" }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span>
              </div>
            ))}
            {/* NC reference picker — only for AR + ARS + NC */}
            {isAR && currency === "ARS" && doc === "NC" && (() => {
              const frComps = (comps[String(fr?.id)] ?? [])
                .filter(c => c.type?.startsWith("FACTURA") && c.facturanteId);
              if (frComps.length === 0) return null;
              return (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                  <label style={{ fontSize: 9, fontWeight: 800, color: "var(--cyan)", letterSpacing: ".1em", display: "block", marginBottom: 6 }}>FACTURA DE REFERENCIA (OPCIONAL)</label>
                  <select value={refCompId ?? ""} onChange={e => setRefCompId(e.target.value || null)}
                    style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border2)", borderRadius: 6, padding: "6px 10px", color: "var(--text)", fontSize: 12 }}>
                    <option value="">Sin referencia</option>
                    {frComps.map(c => (
                      <option key={c.id} value={c.facturanteId}>{c.invoice ?? c.facturanteId} — {c.date}</option>
                    ))}
                  </select>
                </div>
              );
            })()}
          </div>
        )}

        {emitState === "error" && (
          <div style={{ marginBottom: 12, padding: "10px 14px", background: "rgba(255,85,112,.08)", border: "1px solid rgba(255,85,112,.25)", borderRadius: 8, fontSize: 12 }}>
            <div style={{ color: "var(--red)", fontWeight: 700, marginBottom: 6 }}>⚠ Error AFIP: {emitError}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => doConfirm(false)}>Reintentar</button>
              <button className="ghost" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => doConfirm(true)}>Guardar sin factura AFIP</button>
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 12 }}>
          {!preview
            ? <button className="btn" style={{ flex: 1, height: 48, fontSize: 15 }} disabled={importeNeto <= 0} onClick={handlePreview}>Vista previa →</button>
            : <>
                <button className="ghost" style={{ flex: 1, height: 48 }} onClick={() => setPreview(null)}>← Editar</button>
                {usaFacturante && (
                  <button className="ghost" style={{ flex: 2, height: 48, fontSize: 13 }} disabled={emitState === "emitting"} onClick={() => doConfirm(true)}>
                    Guardar sin emitir
                  </button>
                )}
                <button className="btn" style={{ flex: 3, height: 48, fontSize: 15 }} disabled={emitState === "emitting"} onClick={handleConfirm}>
                  {emitState === "emitting" ? "Emitiendo ante AFIP…" : `✓ Confirmar y generar ${isAR && currency === "ARS" ? "Factura AFIP" : isAR ? "Factura" : "Invoice"}`}
                </button>
              </>
          }
        </div>
      </div>
    );
  }

  // — movimiento —
  if (step === 3 && wizType === "movimiento") {
    const ct = COMP_TYPES[movTipo];
    const symMov = SYM[movCurrency] ?? "$";
    const mesMovComp  = parseInt(movFecha.split("-")[1]) - 1;
    const anioMovComp = parseInt(movFecha.split("-")[0]);
    const autoMovConcepto = `${ct?.label ?? movTipo} - ${MONTHS[mesMovComp]} ${anioMovComp}`;

    return (
      <div className="fade">
        <Crumb />

        {/* 2 columnas: izq = Fecha / der = Tipo + Moneda+Importe apilados */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 14, marginBottom: 16, alignItems: "start" }}>
          {/* Columna izquierda: Fecha */}
          <div>
            <label style={labelS}>FECHA</label>
            <input type="date" value={movFecha} onChange={e => setMovFecha(e.target.value)}
              style={{ ...inputS, cursor: "pointer", colorScheme: "dark", fontWeight: 700 }} />
          </div>
          {/* Columna derecha: Tipo + Moneda/Importe */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelS}>TIPO DE MOVIMIENTO</label>
              <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1.5px solid var(--border2)" }}>
                {TIPOS_MOVIMIENTO.map((k, i) => {
                  const t = COMP_TYPES[k]; const sel = movTipo === k;
                  const short = k === "PAGO" ? "Cobro" : k === "PAGO_PAUTA" ? "A cuenta" : "Trf. Enviada";
                  const sub   = k === "PAGO" ? "del franquiciado" : k === "PAGO_PAUTA" ? "pago a cuenta" : "al franquiciado";
                  return (
                    <div key={k} onClick={() => setMovTipo(k)} style={{
                      flex: 1, padding: "9px 4px 7px", cursor: "pointer", fontWeight: 800, fontSize: 11,
                      background: sel ? `${t.color}28` : "transparent",
                      color: sel ? t.color : "var(--muted)",
                      borderRight: i < TIPOS_MOVIMIENTO.length - 1 ? "1px solid var(--border2)" : "none",
                      borderBottom: `3px solid ${sel ? t.color : "transparent"}`,
                      transition: "all .12s", textAlign: "center",
                    }}>
                      <div>{short}</div>
                      <div style={{ fontSize: 9, fontWeight: 400, marginTop: 2, opacity: sel ? .85 : .5 }}>{sub}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "start" }}>
              <div>
                <label style={labelS}>MONEDA</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {CURRENCIES.map(cur => (
                    <button key={cur} onClick={() => setMovCurrency(cur)} style={{
                      padding: "8px 14px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "none", fontFamily: "var(--font)",
                      background: movCurrency === cur ? "var(--accent)" : "var(--bg)",
                      color: movCurrency === cur ? "#1e2022" : "var(--muted)",
                      outline: movCurrency === cur ? "none" : "1px solid var(--border2)",
                    }}>{cur}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={labelS}>IMPORTE</label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: 13, pointerEvents: "none" }}>{symMov}</span>
                  <input value={movImpRaw}
                    onChange={e => { if (!e.target.value) { setMovImpRaw(""); return; } setMovImpRaw(formatCurrencyInput(e.target.value.replace(/[^\d,]/g,""), movCurrency)); }}
                    placeholder="0,00" inputMode="decimal"
                    style={{ ...inputS, paddingLeft: 26, textAlign: "right", fontWeight: 700 }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Fila 3: Referencia */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelS}>REFERENCIA <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— editable</span></label>
          <input value={movConcepto || autoMovConcepto}
            onChange={e => setMovConcepto(e.target.value)}
            onFocus={() => { if (!movConcepto) setMovConcepto(autoMovConcepto); }}
            placeholder="Nro. de transferencia, descripción..."
            style={inputS} />
        </div>

        <button className="btn" style={{ width: "100%", height: 48, fontSize: 15 }} disabled={movImporte <= 0}
          onClick={() => {
            if (movImporte <= 0) return;
            const nota = movConcepto || autoMovConcepto;
            const comp = {
              id: uid(), type: movTipo, date: inputDateToDmy(movFecha),
              amount: movImporte, ref: nota, nota,
              month: mesMovComp, year: anioMovComp,
              currency: movCurrency,
            };
            onAddComp(fr.id, comp);
            setDone(true);
          }}>
          ✓ Registrar movimiento
        </button>
      </div>
    );
  }

  return null;
}


// ── Modo CRM ────────────────────────────────────────────────────────────────
// TC por país: moneda local → USD. Estas son las monedas locales de los países LATAM
const COUNTRY_CURRENCY = {
  "Paraguay":   { code: "PYG", label: "Guaraní",    sym: "₲",  defaultTc: "7500"  },
  "Chile":      { code: "CLP", label: "Peso CLP",   sym: "CL$", defaultTc: "950"   },
  "Perú":       { code: "PEN", label: "Sol",        sym: "S/",  defaultTc: "3.7"   },
  "Panamá":     { code: "USD", label: "USD",        sym: "U$D", defaultTc: "1"     },
  "España":     { code: "EUR", label: "Euro",       sym: "€",   defaultTc: "1.08"  },
  "Portugal":   { code: "EUR", label: "Euro",       sym: "€",   defaultTc: "1.08"  },
  "Uruguay":    { code: "UYU", label: "Peso UYU",   sym: "U$",  defaultTc: "39"    },
  "Argentina":  { code: "ARS", label: "Peso ARS",   sym: "$",   defaultTc: null    }, // ARS no necesita TC vs USD
};
function getCountryCur(country) {
  return COUNTRY_CURRENCY[country] ?? { code: "USD", label: "USD", sym: "U$D", defaultTc: "1" };
}

function ModoCRM({ month: monthProp, year: yearProp, onAddComp, onDone, franchisor }) {
  const { franchises, activeCompany } = useStore();
  const activeFr = useMemo(() => franchises.filter(f => f.activa !== false).sort((a,b) => a.name.localeCompare(b.name, "es")), [franchises]);
  const activeCurrency = COMPANIES[activeCompany]?.currency ?? "ARS";

  const [crmMonth, setCrmMonth] = useState(monthProp);
  const [crmYear,  setCrmYear]  = useState(yearProp);
  const [showTcPanel, setShowTcPanel] = useState(false);
  const [stage,      setStage]      = useState("edit");
  const [processed,  setProcessed]  = useState([]);
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmLoaded,  setCrmLoaded]  = useState(false);

  const [tcMap, setTcMap] = useState(() => {
    const map = {};
    activeFr.forEach(fr => {
      if (fr.country && fr.country !== "Argentina") {
        const cc = getCountryCur(fr.country);
        if (!map[fr.country] && cc.defaultTc) map[fr.country] = cc.defaultTc;
      }
    });
    return map;
  });

  const makeRows = () => activeFr.map(fr => ({
    frId: fr.id, frName: fr.name, currency: activeCurrency, country: fr.country,
    royaltyContrato: parseFloat(fr.royaltyPct ?? "7"),
    royaltyFactura:  parseFloat(fr.royaltyPct ?? "7"),
    ventas: "",
    biggEyeId: fr.biggEyeId ?? null,
  }));

  const [rows,     setRows]     = useState(makeRows);
  const [selected, setSelected] = useState(new Set());
  const [filters,  setFilters]  = useState({ frName: "", country: "" });
  const [openFilter, setOpenFilter] = useState(null);

  const updateRow = (idx, field, val) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r));

  const deleteRow = (idx) =>
    setRows(prev => prev.filter((_, i) => i !== idx));

  const deleteSelected = () => {
    setRows(prev => prev.filter((_, i) => !selected.has(i)));
    setSelected(new Set());
  };

  const resetRows = () => {
    setRows(makeRows());
    setSelected(new Set());
    setCrmLoaded(false);
  };

  const countriesWithTc = useMemo(() => {
    const seen = new Set();
    return activeFr
      .filter(fr => fr.country && fr.country !== "Argentina")
      .map(fr => fr.country)
      .filter(c => { if (seen.has(c)) return false; seen.add(c); return true; })
      .filter(c => getCountryCur(c).code !== "USD");
  }, [activeFr]);

  const tcCargados = countriesWithTc.filter(c => parseFloat(tcMap[c]) > 0).length;

  const [crmFetchErrors, setCrmFetchErrors] = useState([]);

  const handleDownloadCRM = async () => {
    setCrmLoading(true);
    setCrmFetchErrors([]);

    const month1 = crmMonth + 1; // crmMonth es 0-indexed, la API espera 1-12
    const errors = [];

    // Sedes con Bigg Eye ID configurado
    const rowsWithBE = rows.map((r, i) => ({ ...r, _i: i })).filter(r => r.biggEyeId != null);
    const rowsWithoutBE = rows.filter(r => r.biggEyeId == null).map(r => r.frName);

    if (rowsWithoutBE.length > 0) {
      errors.push(`${rowsWithoutBE.length} sede${rowsWithoutBE.length !== 1 ? "s" : ""} sin Bigg Eye ID — ingresar ventas manualmente`);
    }

    // Llamar a la API para cada sede con biggEyeId
    const results = await Promise.allSettled(
      rowsWithBE.map(r =>
        fetch(`/api/bigg-eye?location_id=${r.biggEyeId}&month=${month1}&year=${crmYear}`)
          .then(res => res.json())
          .then(data => ({ _i: r._i, frName: r.frName, ...data }))
      )
    );

    setRows(prev => {
      const next = [...prev];
      results.forEach((res, i) => {
        const origIdx = rowsWithBE[i]._i;
        if (res.status === "fulfilled" && res.value.error == null && res.value.ventas != null) {
          next[origIdx] = { ...next[origIdx], ventas: String(Math.round(res.value.ventas)) };
        } else {
          const msg = res.status === "rejected"
            ? res.reason?.message
            : res.value?.error;
          if (msg) errors.push(`${rowsWithBE[i].frName}: ${msg}`);
        }
      });
      return next;
    });

    setCrmFetchErrors(errors);
    setCrmLoading(false);
    setCrmLoaded(true);
  };

  const rowFee = (r) => {
    const v = parseFloat(String(r.ventas).replace(/\./g, "").replace(",", ".")) || 0;
    const feeLocal = v * (r.royaltyFactura / 100);
    if (r.country === "Argentina") return feeLocal;
    const cc = getCountryCur(r.country);
    if (cc.code === "USD") return feeLocal;
    const tc = parseFloat(tcMap[r.country] ?? "1") || 1;
    return feeLocal / tc;
  };

  const dtoDisplay = (r) => {
    if (r.royaltyContrato <= 0) return 0;
    return Math.round((1 - r.royaltyFactura / r.royaltyContrato) * 10000) / 100;
  };

  const ventasN = (r) => parseFloat(String(r.ventas).replace(/\./g, "").replace(",", ".")) || 0;
  const billableRows = rows.filter(r => ventasN(r) > 0);

  const filteredRows = useMemo(() =>
    rows.map((r, i) => ({ ...r, _origIdx: i })).filter(r =>
      (!filters.frName  || r.frName.toLowerCase().includes(filters.frName.toLowerCase())) &&
      (!filters.country || (r.country ?? "").toLowerCase().includes(filters.country.toLowerCase()))
    ),
    [rows, filters]
  );

  const allFilteredSelected = filteredRows.length > 0 && filteredRows.every(r => selected.has(r._origIdx));

  const handleConfirm = async () => {
    setStage("done");
    const log = [];
    for (const r of billableRows) {
      const fr = activeFr.find(f => f.id === r.frId);
      if (!fr) continue;
      const fee = rowFee(r);
      const dto = dtoDisplay(r);
      const isAR = fr.country === "Argentina";
      let comp = {
        id: uid(), type: makeType("FACTURA","FEE"), date: todayDmy(),
        amount: Math.max(0, Math.round(fee * 100) / 100),
        ref: `Fee ${MONTHS[crmMonth]} ${crmYear} — CRM`,
        nota: `Fee Royalty ${MONTHS[crmMonth]} ${crmYear}${dto > 0 ? ` (${dto}% dto.)` : ""}`,
        month: crmMonth, year: crmYear,
        currency: activeCurrency,
      };
      let facturanteStatus = "omitido";
      if (isAR && activeCompany === "ÑAKO SRL") {
        try {
          const result = await emitirComprobante({
            franchisor: franchisor?.ar ?? franchisor,
            franchise:  fr,
            comp:       { ...comp, applyIVA: !!fr.applyIVA },
          });
          comp = { ...comp, invoice: formatInvoiceLabel(result.tipoComprobante, result.idComprobante, result.puntoVenta), facturanteId: String(result.idComprobante) };
          facturanteStatus = "ok";
        } catch (err) {
          facturanteStatus = `sin_factura: ${err.message}`;
        }
      }
      onAddComp(r.frId, comp);
      const pdfText = isAR ? buildFacturaPDF(fr, franchisor, comp) : buildInvoicePDF(fr, franchisor, comp);
      downloadTextAsPDF(pdfText, `${isAR ? "Factura" : "Invoice"}_${fr.name}_${MONTHS[crmMonth]}_${crmYear}.html`);
      log.push({ frName: r.frName, fee, country: r.country, dto, facturanteStatus, invoice: comp.invoice });
    }
    setProcessed(log);
  };

  if (stage === "done") return (
    <div className="fade" style={{ textAlign: "center", padding: 40 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
      <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Lote CRM procesado</div>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        {processed.length} comprobante{processed.length !== 1 ? "s" : ""} · {MONTHS[crmMonth]} {crmYear}
      </div>
      <div className="card" style={{ textAlign: "left", maxWidth: 540, margin: "0 auto 20px" }}>
        {processed.map((p, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 14px", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
            <span>{p.frName}{p.invoice && <span className="mono" style={{ fontSize: 10, color: "var(--accent)", marginLeft: 8 }}>{p.invoice}</span>}</span>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {p.dto > 0 && <span className="pill" style={{ fontSize: 9, color: "var(--gold)", background: "rgba(251,191,36,.1)" }}>{p.dto}% dto.</span>}
              <span className="mono" style={{ fontWeight: 700, color: p.fee <= 0 ? "var(--muted)" : "var(--green)" }}>
                {p.country === "Argentina"
                  ? `$ ${p.fee.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : `U$D ${p.fee.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </span>
            </div>
          </div>
        ))}
      </div>
      <button className="btn" onClick={onDone}>Volver</button>
    </div>
  );

  const inS = { padding: "4px 8px", fontSize: 12, borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)", fontFamily: "var(--font)", textAlign: "right" };
  const selS = { padding: "5px 9px", fontSize: 12, borderRadius: 7, background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)", fontFamily: "var(--font)", cursor: "pointer" };

  const FilterPopover = ({ col, label }) => {
    const active = !!filters[col];
    return (
      <span style={{ position: "relative", display: "inline-block" }}>
        <span
          onClick={e => { e.stopPropagation(); setOpenFilter(openFilter === col ? null : col); }}
          style={{ cursor: "pointer", marginLeft: 4, color: active ? "var(--accent)" : "var(--muted)", fontSize: 11 }}
          title={"Filtrar " + label}
        >⌕</span>
        {openFilter === col && (
          <div onClick={e => e.stopPropagation()} style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 60,
            background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 8,
            padding: "8px 10px", minWidth: 160, boxShadow: "0 6px 20px rgba(0,0,0,.5)",
          }}>
            <input autoFocus value={filters[col]}
              onChange={e => setFilters(f => ({ ...f, [col]: e.target.value }))}
              onKeyDown={e => e.key === "Escape" && setOpenFilter(null)}
              placeholder={"Filtrar " + label + "…"}
              style={{ ...inS, width: "100%", textAlign: "left" }} />
            {filters[col] && (
              <button onClick={() => { setFilters(f => ({ ...f, [col]: "" })); setOpenFilter(null); }}
                style={{ marginTop: 6, fontSize: 10, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                ✕ Limpiar
              </button>
            )}
          </div>
        )}
      </span>
    );
  };

  return (
    <div className="fade" onClick={() => { setShowTcPanel(false); setOpenFilter(null); }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Desde CRM — ventas del mes</div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>
              {crmLoaded
                ? billableRows.length + " sede" + (billableRows.length !== 1 ? "s" : "") + " con ventas · " + rows.length + " total"
                : "Descargá las ventas para comenzar"}
            </div>
          </div>
          <button
            className={crmLoaded ? "ghost" : "btn"}
            style={{ fontSize: 12, padding: "6px 14px", display: "flex", alignItems: "center", gap: 6, opacity: crmLoading ? 0.6 : 1 }}
            onClick={handleDownloadCRM} disabled={crmLoading}>
            {crmLoading ? "⏳ Descargando…" : crmLoaded ? "↺ Re-descargar" : "⬇ Descargar ventas"}
          </button>
          {crmLoaded && (
            <button className="ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={resetRows} title="Restablecer todas las sedes">
              ↺ Reset lista
            </button>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* Período + TC */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }} onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 8, padding: "5px 10px" }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", letterSpacing: ".08em" }}>PERÍODO</span>
            <select value={crmMonth} onChange={e => setCrmMonth(parseInt(e.target.value))} style={selS}>
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <select value={crmYear} onChange={e => setCrmYear(parseInt(e.target.value))} style={{ ...selS, width: 78 }}>
              {AVAILABLE_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {countriesWithTc.length > 0 && (
            <div style={{ position: "relative" }}>
              <button className="ghost"
                style={{ fontSize: 12, padding: "6px 10px", display: "flex", alignItems: "center", gap: 5, border: showTcPanel ? "1px solid var(--cyan)" : undefined }}
                onClick={e => { e.stopPropagation(); setShowTcPanel(v => !v); }}>
                ⚙ TC
                <span style={{ background: tcCargados === countriesWithTc.length ? "var(--green)" : "var(--gold)", color: "#1e2022", borderRadius: 10, fontSize: 9, fontWeight: 800, padding: "1px 5px" }}>
                  {tcCargados}/{countriesWithTc.length}
                </span>
              </button>
              {showTcPanel && (
                <div onClick={e => e.stopPropagation()} style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50,
                  background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10,
                  padding: "14px 16px", minWidth: 270, boxShadow: "0 8px 24px rgba(0,0,0,.5)",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", letterSpacing: ".1em", marginBottom: 12 }}>
                    TC {MONTHS[crmMonth].toUpperCase()} {crmYear} — local / USD
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {countriesWithTc.map(country => {
                      const cc = getCountryCur(country);
                      const val = tcMap[country] ?? "";
                      const ok = parseFloat(val) > 0;
                      return (
                        <div key={country} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, minWidth: 78 }}>{country}</span>
                          <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 26 }}>{cc.sym}</span>
                          <input type="number" value={val}
                            onChange={e => setTcMap(m => ({ ...m, [country]: e.target.value }))}
                            placeholder="TC" style={{ ...inS, flex: 1 }} />
                          <span style={{ fontSize: 10, color: "var(--muted)" }}>/ USD</span>
                          <span style={{ fontSize: 13 }}>{ok ? "✓" : "⚠"}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 10, color: "var(--muted)", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                    Las ventas se obtienen de Bigg Eye automáticamente
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Avisos de fetch Bigg Eye */}
      {crmFetchErrors.length > 0 && (
        <div className="fade" style={{ marginBottom: 10, padding: "8px 14px", background: "rgba(251,191,36,.06)", border: "1px solid rgba(251,191,36,.2)", borderRadius: 8, fontSize: 11 }}>
          {crmFetchErrors.map((e, i) => (
            <div key={i} style={{ color: "var(--gold)", lineHeight: 1.6 }}>⚠ {e}</div>
          ))}
        </div>
      )}

      {/* Toolbar selección masiva */}
      {selected.size > 0 && (
        <div className="fade" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "7px 12px", background: "rgba(255,107,122,.07)", border: "1px solid rgba(255,107,122,.2)", borderRadius: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--red)" }}>{selected.size} seleccionada{selected.size !== 1 ? "s" : ""}</span>
          <button onClick={deleteSelected} className="del" style={{ fontSize: 11 }}>✕ Quitar seleccionadas</button>
          <button onClick={() => setSelected(new Set())} className="ghost" style={{ fontSize: 11, padding: "2px 8px" }}>Deseleccionar</button>
        </div>
      )}

      {/* Tabla */}
      <div className="card">
        <div className="tbl-wrap"><table>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                  checked={allFilteredSelected}
                  onChange={e => {
                    if (e.target.checked) setSelected(new Set(filteredRows.map(r => r._origIdx)));
                    else setSelected(new Set());
                  }} />
              </th>
              <th>Sede <FilterPopover col="frName" label="sede" /></th>
              <th>País <FilterPopover col="country" label="país" /></th>
              <th style={{ textAlign: "right" }}>Ventas (local)</th>
              <th style={{ textAlign: "center" }}>Reg. contrato</th>
              <th style={{ textAlign: "center" }}>Reg. factura</th>
              <th style={{ textAlign: "center" }}>Dto. efectivo</th>
              <th style={{ textAlign: "right" }}>Fee</th>
              <th style={{ width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(r => {
              const i      = r._origIdx;
              const cc     = getCountryCur(r.country);
              const isAR   = r.country === "Argentina";
              const hasV   = ventasN(r) > 0;
              const fee    = rowFee(r);
              const dto    = dtoDisplay(r);
              const dtoCol = dto >= 50 ? "var(--red)" : dto > 0 ? "var(--gold)" : "var(--muted)";
              const isSel  = selected.has(i);
              return (
                <tr key={r.frId} style={{ background: isSel ? "rgba(96,165,250,.06)" : "transparent" }}>
                  <td>
                    <input type="checkbox" style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                      checked={isSel}
                      onChange={e => {
                        setSelected(prev => { const n = new Set(prev); e.target.checked ? n.add(i) : n.delete(i); return n; });
                      }} />
                  </td>
                  <td style={{ fontSize: 12, fontWeight: 600 }}>
                    {r.frName}
                    {!isAR && <span className="pill" style={{ marginLeft: 5, fontSize: 8, color: "var(--cyan)", background: "rgba(34,211,238,.1)" }}>LATAM</span>}
                  </td>
                  <td style={{ fontSize: 11, color: "var(--muted)" }}>
                    {r.country ?? "—"}
                    {!isAR && <div style={{ fontSize: 9, marginTop: 1 }}>{cc.label}</div>}
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>{cc.sym}</span>
                      <input value={r.ventas}
                        onChange={e => updateRow(i, "ventas", e.target.value.replace(/[^\d,.]/g, ""))}
                        onBlur={e => updateRow(i, "ventas", formatCurrencyInput(e.target.value.replace(/\./g, ""), cc.code))}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === "Tab") updateRow(i, "ventas", formatCurrencyInput(e.target.value.replace(/\./g, ""), cc.code)); }}
                        placeholder="0" inputMode="decimal" style={{ ...inS, width: 120 }} />
                    </div>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{r.royaltyContrato}%</span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
                      <input type="number" value={r.royaltyFactura} min="0" max={r.royaltyContrato} step="0.5"
                        onChange={e => updateRow(i, "royaltyFactura", Math.min(r.royaltyContrato, Math.max(0, parseFloat(e.target.value) || 0)))}
                        style={{ ...inS, width: 52, textAlign: "center", color: r.royaltyFactura < r.royaltyContrato ? "var(--gold)" : "var(--text)" }} />
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>%</span>
                    </div>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {dto > 0
                      ? <span className="pill mono" style={{ fontSize: 11, fontWeight: 800, color: dtoCol, background: dto >= 50 ? "rgba(255,107,122,.1)" : "rgba(251,191,36,.1)" }}>{dto}%</span>
                      : <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>}
                  </td>
                  <td className="mono" style={{ textAlign: "right", fontSize: 12, fontWeight: 700 }}>
                    {hasV
                      ? <span style={{ color: fee <= 0 ? "var(--muted)" : "var(--green)" }}>
                          {isAR ? `$ ${fee.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "U$D " + fee.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          {fee <= 0 && <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 400 }}>100% dto.</div>}
                        </span>
                      : <span style={{ color: "var(--muted)" }}>—</span>}
                  </td>
                  <td>
                    <button onClick={() => { deleteRow(i); setSelected(p => { const n=new Set(p); n.delete(i); return n; }); }}
                      title="Quitar" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 13, padding: "2px 5px", borderRadius: 4 }}
                      onMouseEnter={e => e.currentTarget.style.color="var(--red)"}
                      onMouseLeave={e => e.currentTarget.style.color="var(--muted)"}>✕</button>
                  </td>
                </tr>
              );
            })}
            {filteredRows.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, padding: 24 }}>No hay sedes que coincidan con los filtros</td></tr>
            )}
          </tbody>
        </table></div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
        <span style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center" }}>
          {billableRows.length} con ventas
          {rows.filter(r => ventasN(r) > 0 && r.royaltyFactura === 0).length > 0 &&
            " · " + rows.filter(r => ventasN(r) > 0 && r.royaltyFactura === 0).length + " con 100% dto."}
        </span>
        <button className="btn" disabled={billableRows.length === 0} style={{ opacity: billableRows.length === 0 ? 0.4 : 1 }} onClick={handleConfirm}>
          ✓ Generar {billableRows.length} comprobante{billableRows.length !== 1 ? "s" : ""}
        </button>
      </div>
    </div>
  );
}


// ── Excel import helpers (nueva lógica: cuenta + signo determina tipo) ──────
const CUENTAS_COMP = new Set(["FEE","PAUTA","INTERUSOS","SPONSORS","OTROS_INGRESOS"]);
const CUENTAS_MOV  = new Set(["PAGO","PAGO_PAUTA","PAGO_ENVIADO"]);

function parseDate(raw) {
  if (!raw) return null;
  // JS Date object — lo más común con cellDates:true
  if (raw instanceof Date && !isNaN(raw)) {
    return `${String(raw.getDate()).padStart(2,"0")}/${String(raw.getMonth()+1).padStart(2,"0")}/${raw.getFullYear()}`;
  }
  const s = String(raw).trim();
  // DD/MM/YYYY o DD-MM-YYYY
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[1].padStart(2,"0")}/${m[2].padStart(2,"0")}/${m[3]}`;
  // YYYY-MM-DD
  m = s.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  // DD/MM/YY
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (m) return `${m[1].padStart(2,"0")}/${m[2].padStart(2,"0")}/20${m[3]}`;
  // Excel serial (número)
  if (typeof raw === "number" || /^\d{5}$/.test(s)) {
    try {
      const d = XLSX.SSF.parse_date_code(Number(raw));
      if (d && d.y > 2000) return `${String(d.d).padStart(2,"0")}/${String(d.m).padStart(2,"0")}/${d.y}`;
    } catch {}
    // fallback manual: días desde 1/1/1900
    try {
      const epoch = new Date(1899, 11, 30);
      epoch.setDate(epoch.getDate() + Number(raw));
      if (epoch.getFullYear() > 2000) return `${String(epoch.getDate()).padStart(2,"0")}/${String(epoch.getMonth()+1).padStart(2,"0")}/${epoch.getFullYear()}`;
    } catch {}
  }
  return null;
}

function validateRow(r, _frMap) {
  const errs = [];
  if (!r.franchiseId)         errs.push("Sede no encontrada");
  if (!r.date)                errs.push("Fecha inválida");
  if (!r.amount || isNaN(r.amount) || r.amount === 0) errs.push("Importe inválido o cero");
  if (!r.type)                errs.push("Cuenta inválida");
  return errs;
}

function parseExcelRows(data, franchises) {
  return data.map((row, idx) => {
    // normalize keys to lowercase
    const r = {};
    for (const k of Object.keys(row)) r[k.toLowerCase().trim()] = row[k];

    const sedeName    = String(r.sede ?? r.franquicia ?? r.franchise ?? "").trim();
    const cuentaRaw   = String(r.cuenta ?? r.account ?? r.tipo ?? "").trim().toUpperCase();
    const importeRaw  = parseFloat(String(r.importe ?? r.monto ?? r.amount ?? "0").replace(/[^0-9.,\-]/g,"").replace(",",".")) || 0;
    const fechaRaw    = r.fecha ?? r.date ?? r.fecha_doc ?? "";
    const conceptoRaw = String(r.concepto ?? r.descripcion ?? r.ref ?? r.referencia ?? "").trim();
    const monedaRaw   = String(r.moneda ?? r.currency ?? r.currencies ?? "").trim().toUpperCase();

    // match sede — exact only, sin fuzzy
    const fr = franchises.find(f => f.name.toLowerCase() === sedeName.toLowerCase());

    // moneda: usar la del excel si es válida, sino la de la sede
    const VALID_CURRENCIES = new Set(["ARS", "USD", "EUR"]);
    const currency = VALID_CURRENCIES.has(monedaRaw) ? monedaRaw : (fr?.currency ?? "ARS");

    // deduce type
    let type = null;
    if (CUENTAS_COMP.has(cuentaRaw)) {
      type = importeRaw >= 0 ? `FACTURA|${cuentaRaw}` : `NC|${cuentaRaw}`;
    } else if (CUENTAS_MOV.has(cuentaRaw)) {
      type = cuentaRaw;
    }

    const date    = parseDate(fechaRaw);
    const amount  = Math.abs(importeRaw);
    const mesRow  = date ? parseInt(date.split("/")[1]) - 1 : 0;
    const anioRow = date ? parseInt(date.split("/")[2]) : new Date().getFullYear();

    // auto-concepto
    const autoConcepto = type
      ? (CUENTAS_COMP.has(cuentaRaw)
          ? `${importeRaw >= 0 ? "Factura" : "NC"} - ${CUENTA_LABEL[cuentaRaw] ?? cuentaRaw} - ${MONTHS[mesRow]} ${anioRow}`
          : `${COMP_TYPES[type]?.label ?? type} - ${MONTHS[mesRow]} ${anioRow}`)
      : "";

    const built = {
      _idx: idx,
      franchiseId:   fr?.id ?? null,
      franchiseName: fr?.name ?? sedeName,
      rawFranchise:  sedeName,
      currency,
      type, date, amount,
      ref:      conceptoRaw || autoConcepto,
      month:    mesRow,
      year:     anioRow,
      excluded: false,
      errors:   [],
    };
    built.errors = validateRow(built, null);
    return built;
  });
}

function ModoExcel({ month, year, onAddComp, onDone, franchisor }) {
  const { franchises, activeCompany } = useStore();
  const activeCurrency = COMPANIES[activeCompany]?.currency ?? "ARS";
  const fileInputRef = useRef(null);
  const [stage,      setStage]      = useState(FACT_STAGE.IDLE);
  const [rows,       setRows]       = useState([]);
  const [editIdx,    setEditIdx]    = useState(null);
  const [editBuf,    setEditBuf]    = useState({});
  const [processLog, setProcessLog] = useState([]);
  const [loteId]                    = useState(`LOTE-${Date.now().toString(36).toUpperCase()}`);

  const activeRows = useMemo(() => rows.filter(r => !r.excluded && r.errors.length === 0), [rows]);
  const errorRows  = useMemo(() => rows.filter(r => !r.excluded && r.errors.length > 0),  [rows]);

  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
      // Preferir hoja "Plantilla", sino la primera
      const sheetName = wb.SheetNames.find(n => n.toLowerCase() === "plantilla") ?? wb.SheetNames[0];
      const ws   = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { defval: "", header: undefined });
      setRows(parseExcelRows(data, franchises));
      setStage(FACT_STAGE.PREVIEW);
    } catch (err) {
      alert("No se pudo leer el archivo. Asegurate de subir un .xlsx o .csv.");
    }
    e.target.value = "";
  }, [franchises]);

  const toggleExclude = useCallback((idx) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, excluded: !r.excluded } : r)), []);

  const saveEdit = useCallback(() => {
    setRows(prev => prev.map((r, i) => {
      if (i !== editIdx) return r;
      const updated = { ...r, ...editBuf, amount: parseFloat(editBuf.amount) || 0, date: parseDate(editBuf.date) || r.date };
      updated.errors = validateRow(updated, new Map());
      return updated;
    }));
    setEditIdx(null);
  }, [editIdx, editBuf]);

  const handleConfirm = useCallback(async () => {
    setStage(FACT_STAGE.PROCESSING);
    const log = [];
    for (const r of activeRows) {
      const fr = franchises.find(f => f.id === r.franchiseId);
      const isAR = fr?.country === "Argentina";
      const doc  = String(r.type ?? "").split("|")[0];
      const esComp = doc === "FACTURA" || doc === "NC";
      let comp = {
        id: uid(), type: r.type, date: r.date,
        amount: r.amount, ref: r.ref || `${loteId} — importado`,
        nota: `${COMP_TYPES[r.type]?.label ?? r.type} — ${r.franchiseName}`,
        month: r.month, year: r.year, loteId,
        currency: r.currency,
      };
      let msg = `✓ CC actualizada — ${r.franchiseName}`;
      if (isAR && r.currency === "ARS" && esComp && fr) {
        try {
          const result = await emitirComprobante({
            franchisor: franchisor?.ar ?? franchisor,
            franchise:  fr,
            comp:       { ...comp, applyIVA: !!fr.applyIVA },
          });
          comp = { ...comp, invoice: formatInvoiceLabel(result.tipoComprobante, result.idComprobante, result.puntoVenta), facturanteId: String(result.idComprobante) };
          msg = `✓ ${comp.invoice} emitida — ${r.franchiseName}`;
        } catch (err) {
          msg = `⚠ CC guardada sin AFIP (${err.message}) — ${r.franchiseName}`;
        }
      }
      onAddComp(r.franchiseId, comp);
      log.push({ status: comp.invoice ? "ok" : "sin_factura", step: "CC", msg });
    }
    setProcessLog(log);
    setStage(FACT_STAGE.DONE);
  }, [activeRows, franchises, onAddComp, loteId, franchisor]);

  const downloadPlantilla = () => {
    const wb = XLSX.utils.book_new();
    const wsInstr = XLSX.utils.aoa_to_sheet([
      ["PLANTILLA DE IMPORTACIÓN — BIGG Cuenta Corriente"],
      [""],
      ["CÓMO USAR ESTA PLANTILLA"],
      ["──────────────────────────────────────────────────────────────────────"],
      ["1. Completá la hoja 'Plantilla' con los comprobantes o movimientos que querés importar."],
      ["2. Cada fila es un comprobante o movimiento independiente."],
      ["3. No modifiques los nombres de las columnas (fila 1 de la hoja Plantilla)."],
      ["4. Guardá el archivo como .xlsx y subilo desde la pantalla de importación."],
      [""],
      ["COLUMNAS REQUERIDAS"],
      ["──────────────────────────────────────────────────────────────────────"],
      ["sede      →  Nombre de la sede (ej: Caballito, Nordelta Ruta 27)"],
      ["cuenta    →  Ver lista de cuentas válidas abajo"],
      ["importe   →  Número sin símbolo de moneda (ej: 150000 o -50000)"],
      ["fecha     →  Formato DD/MM/AAAA (ej: 15/02/2026)"],
      [""],
      ["COLUMNAS OPCIONALES"],
      ["──────────────────────────────────────────────────────────────────────"],
      ["moneda    →  ARS, USD o EUR. Si se omite, se usa la moneda base de la sede."],
      ["concepto  →  Descripción libre. Si se deja vacío se genera automáticamente."],
      [""],
      ["CUENTAS VÁLIDAS PARA COMPROBANTES"],
      ["──────────────────────────────────────────────────────────────────────"],
      ["FEE             →  Royalty mensual de la franquicia"],
      ["PAUTA           →  Contribución a fondo de publicidad"],
      ["INTERUSOS       →  Uso de espacios o servicios compartidos"],
      ["SPONSORS        →  Ingresos por sponsoreo"],
      ["OTROS_INGRESOS  →  Cualquier otro concepto de facturación"],
      [""],
      ["CÓMO SE DEDUCE EL TIPO DE DOCUMENTO"],
      ["──────────────────────────────────────────────────────────────────────"],
      ["Importe POSITIVO  →  Se genera una FACTURA  (suma deuda al franquiciado)"],
      ["Importe NEGATIVO  →  Se genera una NC        (reduce deuda del franquiciado)"],
      [""],
      ["CUENTAS VÁLIDAS PARA MOVIMIENTOS FINANCIEROS"],
      ["──────────────────────────────────────────────────────────────────────"],
      ["PAGO          →  Transferencia recibida del franquiciado (reduce deuda)"],
      ["PAGO_PAUTA    →  Pago a cuenta / anticipo de pauta"],
      ["PAGO_ENVIADO  →  Transferencia enviada al franquiciado (suma deuda)"],
      ["Nota: para movimientos el signo del importe se ignora."],
      [""],
      ["EJEMPLOS"],
      ["──────────────────────────────────────────────────────────────────────"],
      ["sede", "cuenta", "importe", "fecha", "moneda", "concepto"],
      ["Caballito", "FEE", 250000, "28/02/2026", "ARS", "Fee Febrero 2026"],
      ["Nordelta Ruta 27", "PAUTA", -30000, "28/02/2026", "ARS", "Ajuste pauta febrero"],
      ["Caballito", "PAGO", 200000, "05/02/2026", "ARS", "Transf. CBU 123456"],
      ["Herrera", "FEE", 1200, "28/02/2026", "USD", "Fee Febrero 2026"],
      ["Poblenou", "PAGO", 950, "05/02/2026", "EUR", "Transferencia recibida"],
    ]);
    wsInstr["!cols"] = [{ wch: 90 }];
    XLSX.utils.book_append_sheet(wb, wsInstr, "Instrucciones");

    const wsPlant = XLSX.utils.aoa_to_sheet([
      ["sede", "cuenta", "importe", "fecha", "moneda", "concepto"],
      ["Caballito", "FEE", 250000, "28/02/2026", "ARS", ""],
      ["Nordelta Ruta 27", "PAUTA", 80000, "28/02/2026", "ARS", ""],
      ["Caballito", "PAGO", 200000, "05/02/2026", "ARS", "Transferencia 123456"],
      ["Herrera", "FEE", 1200, "28/02/2026", "USD", ""],
    ]);
    wsPlant["!cols"] = [{ wch: 26 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 36 }];
    XLSX.utils.book_append_sheet(wb, wsPlant, "Plantilla");
    XLSX.writeFile(wb, "Plantilla_Importacion_BIGG.xlsx");
  };

  if (stage === FACT_STAGE.IDLE) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Pasos visuales */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        {[
          { n: "1", icon: "📥", title: "Descargá la plantilla", desc: "Ya tiene el formato correcto y ejemplos para guiarte.", action: <button className="ghost" style={{ fontSize: 11, marginTop: 10 }} onClick={downloadPlantilla}>↓ Descargar plantilla</button> },
          { n: "2", icon: "✏️", title: "Completá las filas", desc: "Una fila por comprobante. 4 columnas obligatorias: sede, cuenta, importe y fecha. Moneda y concepto son opcionales.", action: null },
          { n: "3", icon: "↑",  title: "Subí el archivo", desc: "El sistema valida todo antes de importar. Podés corregir errores ahí mismo.", action: null },
        ].map(s => (
          <div key={s.n} style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, padding: "18px 18px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--accent)", color: "#000", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{s.n}</div>
              <span style={{ fontSize: 22 }}>{s.icon}</span>
              <span style={{ fontWeight: 800, fontSize: 13 }}>{s.title}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>{s.desc}</div>
            {s.action}
          </div>
        ))}
      </div>

      {/* Preview de la tabla esperada */}
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, padding: "16px 20px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", letterSpacing: ".08em", marginBottom: 12 }}>ASÍ SE VE EL EXCEL — cada fila es un registro</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {[["sede",""],["cuenta",""],["importe",""],["fecha",""],["moneda","opcional"],["concepto","opcional"]].map(([col, sub]) => (
                  <th key={col} style={{ textAlign: "left", padding: "6px 12px", background: "rgba(173,255,25,.08)", border: "1px solid var(--border2)", fontFamily: "monospace", fontWeight: 700, color: "var(--accent)", whiteSpace: "nowrap" }}>
                    {col} {sub && <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 10 }}>({sub})</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Caballito",        "FEE",   "250.000",  "28/02/2026", "ARS", "→ Factura FEE",   "var(--red)"],
                ["Nordelta Ruta 27", "PAUTA",  "80.000",  "28/02/2026", "ARS", "→ Factura PAUTA", "var(--red)"],
                ["Caballito",        "FEE",   "-15.000",  "28/02/2026", "ARS", "→ NC (negativo)", "var(--green)"],
                ["Caballito",        "PAGO",  "200.000",  "05/02/2026", "ARS", "→ Pago recibido", "var(--muted)"],
                ["Herrera",          "FEE",    "1.200",   "28/02/2026", "USD", "→ en USD",        "var(--red)"],
              ].map((row, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                  {row.slice(0,4).map((cell, j) => (
                    <td key={j} style={{ padding: "7px 12px", color: "var(--text)", fontFamily: j === 1 ? "monospace" : "inherit", fontWeight: j === 1 ? 700 : 400 }}>{cell}</td>
                  ))}
                  <td style={{ padding: "7px 12px", fontFamily: "monospace", fontWeight: 700, color: "var(--accent)", fontSize: 11 }}>{row[4]}</td>
                  <td style={{ padding: "7px 12px", color: row[6], fontSize: 11, fontStyle: "italic" }}>{row[5]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            <span style={{ color: "var(--text)", fontWeight: 700 }}>Importe positivo</span> → Factura &nbsp;·&nbsp; <span style={{ color: "var(--text)", fontWeight: 700 }}>Importe negativo</span> → Nota de Crédito
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            Cuentas: {["FEE","PAUTA","INTERUSOS","SPONSORS","OTROS_INGRESOS"].map((c,i) => <span key={c}><span style={{ fontFamily: "monospace", color: "var(--text)" }}>{c}</span>{i < 4 ? " · " : ""}</span>)}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            Movimientos: {["PAGO","PAGO_PAUTA","PAGO_ENVIADO"].map((c,i) => <span key={c}><span style={{ fontFamily: "monospace", color: "var(--green)" }}>{c}</span>{i < 2 ? " · " : ""}</span>)}
          </div>
        </div>
      </div>

      {/* Upload */}
      <div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={handleFile} />
        <button className="btn" style={{ fontSize: 14, padding: "13px 32px", width: "100%" }} onClick={() => fileInputRef.current?.click()}>
          ↑ Seleccionar archivo para importar
        </button>
      </div>
    </div>
  );

  if (stage === FACT_STAGE.PROCESSING) return (
    <div style={{ textAlign: "center", padding: 60 }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⚙️</div>
      <div style={{ fontWeight: 800, fontSize: 18 }}>Procesando…</div>
    </div>
  );

  if (stage === FACT_STAGE.DONE) return (
    <div className="fade">
      <div style={{ background: "rgba(173,255,25,.06)", border: "1px solid rgba(173,255,25,.25)", borderRadius: 10, padding: "14px 22px", marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: "var(--accent)", marginBottom: 4 }}>✓ Lote procesado</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{loteId} · {activeRows.length} comprobante{activeRows.length !== 1 ? "s" : ""} registrado{activeRows.length !== 1 ? "s" : ""}</div>
      </div>
      <div className="card">
        {processLog.map((e, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 16px", borderBottom: i < processLog.length - 1 ? "1px solid var(--border)" : "none" }}>
            <span className="pill" style={{ color: e.status === "ok" ? "var(--green)" : "var(--gold)", background: e.status === "ok" ? "rgba(126,217,160,.1)" : "rgba(222,251,151,.1)", minWidth: 70, textAlign: "center" }}>{e.step}</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{e.msg}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onDone}>Nuevo lote</button>
      </div>
    </div>
  );

  // PREVIEW
  return (
    <div className="fade">
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 8, padding: "7px 14px", fontSize: 12 }}>
          Total: <strong>{rows.length}</strong>
        </div>
        <div style={{ background: "rgba(173,255,25,.05)", border: "1px solid rgba(173,255,25,.2)", borderRadius: 8, padding: "7px 14px", fontSize: 12 }}>
          Válidas: <strong style={{ color: "var(--accent)" }}>{activeRows.length}</strong>
        </div>
        {errorRows.length > 0 && (
          <div style={{ background: "rgba(255,107,122,.06)", border: "1px solid rgba(255,107,122,.2)", borderRadius: 8, padding: "7px 14px", fontSize: 12 }}>
            Errores: <strong style={{ color: "var(--red)" }}>{errorRows.length}</strong>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button className="ghost" onClick={() => { setStage(FACT_STAGE.IDLE); setRows([]); }}>← Volver</button>
        <button className="btn" disabled={activeRows.length === 0} style={{ opacity: activeRows.length === 0 ? 0.4 : 1 }} onClick={handleConfirm}>
          ✓ Confirmar {activeRows.length} comprobante{activeRows.length !== 1 ? "s" : ""}
        </button>
      </div>
      <div className="card">
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 32 }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "24%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: 52 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                  checked={rows.every(r => r.excluded)}
                  onChange={e => setRows(prev => prev.map(r => ({ ...r, excluded: e.target.checked })))} />
              </th>
              <th>Fecha</th><th>Tipo</th><th>Sede</th>
              <th style={{ textAlign: "right" }}>Importe</th>
              <th>Moneda</th>
              <th>Estado</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isEditing = editIdx === i;
              const hasError  = r.errors.length > 0;
              return (
                <tr key={r._idx} style={{ background: r.excluded ? "rgba(255,107,122,.07)" : hasError ? "rgba(255,107,122,.04)" : "transparent", opacity: r.excluded ? 0.45 : 1 }}>
                  <td><input type="checkbox" checked={r.excluded ?? false} onChange={() => toggleExclude(i)} style={{ accentColor: "var(--accent)", cursor: "pointer" }} /></td>
                  {isEditing ? (
                    <>
                      <td><input value={editBuf.date ?? ""} onChange={e => setEditBuf(b => ({ ...b, date: e.target.value }))} style={{ width: "100%", padding: "4px 6px", borderRadius: 6, fontSize: 11, background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)" }} /></td>
                      <td>
                        <select value={editBuf.type ?? ""} onChange={e => setEditBuf(b => ({ ...b, type: e.target.value }))} style={{ width: "100%", padding: "4px 6px", borderRadius: 6, fontSize: 11, background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)" }}>
                          <option value="">—</option>
                          {Object.entries(COMP_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={editBuf.franchiseId ?? ""} onChange={e => {
                          const fr = franchises.find(f => f.id === parseInt(e.target.value));
                          setEditBuf(b => ({ ...b, franchiseId: fr?.id ?? null, franchiseName: fr?.name ?? "", currency: fr?.currency ?? "ARS" }));
                        }} style={{ width: "100%", padding: "4px 6px", borderRadius: 6, fontSize: 11, background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)" }}>
                          <option value="">—</option>
                          {[...franchises.filter(f => f.activa !== false)].sort((a,b) => a.name.localeCompare(b.name,"es")).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </td>
                      <td><input value={editBuf.amountRaw ?? (editBuf.amount ? formatCurrencyInput(String(editBuf.amount), "ARS") : "")} onChange={e => { const raw = formatCurrencyInput(e.target.value.replace(/[^\d,]/g,""), "ARS"); setEditBuf(b => ({ ...b, amountRaw: raw, amount: parseCurrencyInput(raw) })); }} inputMode="decimal" placeholder="0,00" style={{ width: "100%", padding: "4px 6px", borderRadius: 6, fontSize: 11, textAlign: "right", background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)", fontFamily: "var(--font)" }} /></td>
                      <td>
                        <select value={editBuf.currency ?? "ARS"} onChange={e => setEditBuf(b => ({ ...b, currency: e.target.value }))} style={{ width: "100%", padding: "4px 6px", borderRadius: 6, fontSize: 11, background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)" }}>
                          <option value="ARS">ARS</option>
                          <option value="USD">USD</option>
                          <option value="EUR">EUR</option>
                        </select>
                      </td>
                      <td></td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn" style={{ padding: "3px 8px", fontSize: 10 }} onClick={saveEdit}>✓</button>
                          <button className="ghost" style={{ padding: "3px 8px", fontSize: 10 }} onClick={() => setEditIdx(null)}>✕</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="mono" style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.date || "—"}</td>
                      <td style={{ overflow: "hidden" }}>{r.type ? <TypePill type={r.type} /> : <span style={{ color: "var(--red)", fontSize: 10 }}>sin tipo</span>}</td>
                      <td style={{ fontSize: 12, overflow: "hidden" }}>
                        {r.franchiseId
                          ? <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", display: "block", whiteSpace: "nowrap" }}>{r.franchiseName}</span>
                          : (
                            <div>
                              <div style={{ fontSize: 10, color: "var(--red)", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                ⚠ "{r.rawFranchise}" no encontrada
                              </div>
                              <select
                                value=""
                                onChange={e => {
                                  const fr = franchises.find(f => f.id === parseInt(e.target.value));
                                  if (!fr) return;
                                  setRows(prev => prev.map((row, ri) => {
                                    if (ri !== i) return row;
                                    const updated = { ...row, franchiseId: fr.id, franchiseName: fr.name, currency: activeCurrency };
                                    updated.errors = validateRow(updated, null);
                                    return updated;
                                  }));
                                }}
                                style={{ width: "100%", padding: "3px 5px", fontSize: 11, borderRadius: 5, background: "var(--bg)", border: "1px solid var(--red)", color: "var(--text)", fontFamily: "var(--font)", cursor: "pointer" }}
                              >
                                <option value="">— asignar sede —</option>
                                {[...franchises.filter(f => f.activa !== false)].sort((a,b) => a.name.localeCompare(b.name,"es")).map(f => (
                                  <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                              </select>
                            </div>
                          )
                        }
                      </td>
                      <td className="mono" style={{ textAlign: "right", fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.amount > 0 ? `${r.currency === "USD" ? "U$D" : r.currency === "EUR" ? "€" : "$"}\u202f${r.amount.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : <span style={{ color: "var(--red)" }}>—</span>}
                      </td>
                      <td className="mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", textAlign: "center" }}>
                        {r.currency ?? "ARS"}
                      </td>
                      <td>
                        {r.excluded
                          ? <span className="pill" style={{ color: "var(--muted)", background: "rgba(255,255,255,.05)" }}>Excluida</span>
                          : hasError && r.franchiseId
                            ? <span title={r.errors.join(", ")} className="pill" style={{ color: "var(--red)", background: "rgba(255,107,122,.1)", cursor: "help" }}>⚠ {r.errors[0]}</span>
                            : !hasError
                              ? <span className="pill" style={{ color: "var(--green)", background: "rgba(126,217,160,.1)" }}>✓ OK</span>
                              : null
                        }
                      </td>
                      <td>{!r.excluded && <button className="ghost" style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => { setEditIdx(i); setEditBuf({ ...r }); }}>✏</button>}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab principal ───────────────────────────────────────────────────────────
const TabFacturador = memo(function TabFacturador({ month, year, onAddComp, factState, setFactState, franchisor, onStartImport }) {
  const { editComp, activeCompany } = useStore();
  // Envuelve onAddComp para inyectar automáticamente la empresa activa en todos los comprobantes
  const addCompWithEmpresa = useCallback(
    (frId, comp) => onAddComp(frId, { ...comp, empresa: activeCompany }),
    [onAddComp, activeCompany]
  );
  const [mode, setMode] = useState(EMIT_MODE.SELECT);
  const [prefillFr,   setPrefillFr]   = useState(null);
  const [prefillComp, setPrefillComp] = useState(null);

  // Abre el wizard manual para PAGO_PAUTA sin factura
  const handleEmitirDesde = (fr, comp) => {
    setPrefillFr(fr);
    setPrefillComp(comp);
    setMode(EMIT_MODE.MANUAL);
  };

  // Emite directamente ante AFIP un comp ya guardado en Sheets (sin wizard)
  const handleEmitirAfip = async (fr, comp) => {
    const result = await emitirComprobante({
      franchisor: franchisor?.ar ?? franchisor,
      franchise:  fr,
      comp:       { ...comp, applyIVA: !!fr.applyIVA },
      referenciaIdComprobante: comp.facturanteId ?? undefined,
    });
    const invoice      = formatInvoiceLabel(result.tipoComprobante, result.idComprobante, result.puntoVenta);
    const facturanteId = String(result.idComprobante);
    editComp(fr.id, comp.id, { invoice, facturanteId });
  };

  // Crea y emite FACTURA_PAUTA para un PAGO_PAUTA sin factura
  const handleEmitirPago = async (fr, pagoComp) => {
    const factComp = {
      id: uid(), type: makeType("FACTURA", "PAUTA"),
      amount: pagoComp.amount, date: pagoComp.date,
      month: pagoComp.month, year: pagoComp.year,
      currency: pagoComp.currency ?? "ARS",
      ref: `Pauta ${MONTHS[pagoComp.month]} ${pagoComp.year}`,
      nota: pagoComp.nota ?? `Factura Pauta ${MONTHS[pagoComp.month]} ${pagoComp.year}`,
    };
    if (fr.country === "Argentina" && factComp.currency === "ARS") {
      const result = await emitirComprobante({
        franchisor: franchisor?.ar ?? franchisor,
        franchise:  fr,
        comp:       { ...factComp, applyIVA: !!fr.applyIVA },
      });
      factComp.invoice      = formatInvoiceLabel(result.tipoComprobante, result.idComprobante, result.puntoVenta);
      factComp.facturanteId = String(result.idComprobante);
    }
    addCompWithEmpresa(fr.id, factComp);
  };

  const reset = () => {
    setMode(EMIT_MODE.SELECT);
    setPrefillFr(null);
    setPrefillComp(null);
  };

  const modeTitle = {
    [EMIT_MODE.MANUAL]: "Comprobante manual",
    [EMIT_MODE.CRM]:    "Desde CRM — ventas del mes",
    [EMIT_MODE.EXCEL]:  "Importar desde Excel",
  };

  return (
    <div className="fade">
      {/* Pendientes */}
      <PendientesPanel onEmitir={handleEmitirDesde} onEmitirAfip={handleEmitirAfip} onEmitirPago={handleEmitirPago} franchisor={franchisor} />

      {/* Selector de modo */}
      {mode === EMIT_MODE.SELECT ? (
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Emisión de Comprobantes</div>
          <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 24 }}>
            Seleccioná cómo querés cargar los datos para este lote.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, maxWidth: 600 }}>
            {[
              {
                mode: EMIT_MODE.MANUAL,
                icon: "✏️",
                title: "Manual",
                desc: "Ingresá los datos de un comprobante individual. Ideal para ajustes, notas de crédito o comprobantes puntuales.",
                color: "var(--blue)",
                bg: "rgba(96,165,250,.06)",
                border: "rgba(96,165,250,.2)",
              },
              {
                mode: EMIT_MODE.CRM,
                icon: "📡",
                title: "Desde CRM",
                desc: "Cargá las ventas del mes por sede, aplicá descuentos comerciales y calculá el fee de royalty automáticamente.",
                color: "var(--green)",
                bg: "rgba(16,217,122,.06)",
                border: "rgba(16,217,122,.2)",
              },
              {
                mode: EMIT_MODE.EXCEL,
                icon: "📊",
                title: "Importar Excel",
                desc: "Subí un .xlsx o .csv con múltiples comprobantes. El sistema los valida y te permite corregir antes de procesar.",
                color: "var(--gold)",
                bg: "rgba(222,251,151,.06)",
                border: "rgba(222,251,151,.2)",
              },
              {
                mode: "_extracto",
                icon: "🏦",
                title: "Extracto Banco Galicia",
                desc: "Importá el extracto mensual del Banco Galicia. Clasificación inteligente de pagos recibidos y enviados.",
                color: "var(--cyan)",
                bg: "rgba(34,211,238,.06)",
                border: "rgba(34,211,238,.2)",
              },
            ].map(opt => (
              <div key={opt.mode}
                onClick={() => opt.mode === "_extracto" ? onStartImport?.() : setMode(opt.mode)}
                style={{ background: opt.bg, border: `1px solid ${opt.border}`, borderRadius: 12, padding: "22px 20px", cursor: "pointer", transition: "all .15s" }}
                onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
                onMouseLeave={e => e.currentTarget.style.transform = ""}
              >
                <div style={{ fontSize: 28, marginBottom: 10 }}>{opt.icon}</div>
                <div style={{ fontWeight: 800, fontSize: 15, color: opt.color, marginBottom: 8 }}>{opt.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>{opt.desc}</div>
                <div style={{ marginTop: 16, fontSize: 11, color: opt.color, fontWeight: 700 }}>Seleccionar →</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div>
          {mode !== EMIT_MODE.MANUAL && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <button className="ghost" style={{ fontSize: 11 }} onClick={reset}>← Volver</button>
              <div style={{ width: 1, height: 16, background: "var(--border2)" }} />
              <span style={{ fontWeight: 800, fontSize: 15 }}>{modeTitle[mode]}</span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{MONTHS[month]} {year}</span>
            </div>
          )}
          {mode === EMIT_MODE.MANUAL && (
            <ModoManual month={month} year={year} onAddComp={addCompWithEmpresa} onDone={reset}
              franchisor={franchisor} prefillFr={prefillFr} prefillComp={prefillComp} />
          )}
          {mode === EMIT_MODE.CRM && (
            <ModoCRM month={month} year={year} onAddComp={addCompWithEmpresa} onDone={reset} franchisor={franchisor} />
          )}
          {mode === EMIT_MODE.EXCEL && (
            <ModoExcel month={month} year={year} onAddComp={addCompWithEmpresa} onDone={reset} franchisor={franchisor} />
          )}
        </div>
      )}
    </div>
  );
});

export default TabFacturador;
