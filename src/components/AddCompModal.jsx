import { useState } from "react";
import { Modal } from "./atoms";
import { useStore } from "../lib/context";
import {
  CURRENCIES, DOCS, CUENTAS, CUENTA_LABEL, COMP_TYPES,
  SYM, uid, makeType, COMPANIES, MONTHS, TIPOS_MOVIMIENTO,
} from "../lib/helpers";
import { getCompanyCurrencies, getFranchiseCurrencies } from "../data/franchisor";
import { emitirComprobante, invoiceFromResult, downloadFacturantePdfBlob, afipSaveFailedMsg } from "../lib/facturanteApi";
import { downloadInvoicePdf } from "../lib/invoicePdf";
import { buildFacturaPDF, downloadTextAsPDF } from "../lib/pdf";
import { getNextInvoiceNum } from "../lib/sheetsApi";

// ─── ADD COMP MODAL ───────────────────────────────────────────────────────────
// Versión completa con la misma lógica de ModoManual del Facturador:
// • Formateador de importe con puntos de miles
// • Paso preview → confirmar antes de guardar (comprobante)
// • Emisión ante ARCA para AR+ARS
// • Invoice correlativo para USA/ESP
// • Selector de FA de referencia para NC AR
// • PDF automático al confirmar

const IVA_RATE    = 0.21;
const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function formatCurrencyInput(raw) {
  const digits = raw.replace(/[^\d,]/g, "");
  const [intPart, decPart] = digits.split(",");
  const intFormatted = (intPart ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (digits.includes(",")) return `${intFormatted},${(decPart ?? "").slice(0, 2)}`;
  return intFormatted;
}
function parseCurrencyInput(formatted) {
  if (!formatted) return 0;
  return parseFloat(formatted.replace(/\./g, "").replace(",", ".")) || 0;
}
function inputDateToDmy(iso) {
  if (!iso || !iso.includes("-")) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function todayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

export default function AddCompModal({ franchise = null, month, year, onClose, onAdd, prefill = null }) {
  const { activeCompany, franchisor, comps, franchises } = useStore();

  // Cuando se abre globalmente (sin sede pre-seleccionada), el usuario elige la sede aquí
  const [selectedFr,  setSelectedFr]  = useState(franchise);
  const [frSearch,    setFrSearch]    = useState("");

  const allowedCurrencies = getCompanyCurrencies(activeCompany, franchisor);
  const applyIVA = !!(COMPANIES[activeCompany]?.applyIVA);
  const isAR     = selectedFr?.country === "Argentina";

  const initCur = () => {
    const def = COMPANIES[activeCompany]?.currency ?? selectedFr?.currency ?? "ARS";
    return allowedCurrencies.includes(def) ? def : (allowedCurrencies[0] ?? "ARS");
  };

  // Si viene prefill de pauta, back-calculamos el neto (pautaPend ya tiene IVA incluido si aplica)
  const initImporteRaw = () => {
    if (!prefill?.amount) return "";
    const neto = applyIVA ? prefill.amount / (1 + IVA_RATE) : prefill.amount;
    return formatCurrencyInput(neto.toFixed(2).replace(".", ","));
  };

  // ── modo ──
  const [mode, setMode] = useState("comprobante"); // "comprobante"|"fc_recibida"|"movimiento"

  // ── comprobante / fc_recibida ──
  const [doc,        setDoc]        = useState(prefill?.doc ?? "FACTURA");
  const [cuenta,     setCuenta]     = useState(prefill?.cuenta ?? "FEE");
  const [currency,   setCurrency]   = useState(initCur);
  const [fechaIso,   setFechaIso]   = useState(todayIso());
  const [importeRaw, setImporteRaw] = useState(initImporteRaw);
  const [concepto,   setConcepto]   = useState(prefill?.concepto ?? ""); // descripción (comp) o nro factura recibida (fc_rec)

  // ── movimiento ──
  const [movTipo,    setMovTipo]    = useState("PAGO");
  const [movCurrency,setMovCurrency]= useState(initCur);
  const [movImpRaw,  setMovImpRaw]  = useState("");
  const [movFecha,   setMovFecha]   = useState(todayIso());
  const [movConcepto,setMovConcepto]= useState("");

  // ── estado de emisión (comprobante) ──
  const [preview,   setPreview]   = useState(null);
  const [emitState, setEmitState] = useState("idle"); // "idle"|"emitting"|"error"
  const [emitError, setEmitError] = useState(null);
  const [refCompId, setRefCompId] = useState(null);

  // ── derivados comprobante ──
  const importeNeto  = parseCurrencyInput(importeRaw);
  const importeIVA   = applyIVA ? Math.round(importeNeto * IVA_RATE * 100) / 100 : 0;
  // Si el neto es el back-calculado exacto del prefill, usar prefill.amount como total
  // para evitar la pérdida de centavos al redondear (ej: 5.000.000 / 1.21 → × 1.21 ≠ 5.000.000)
  const importeTotal = (() => {
    if (applyIVA && prefill?.amount != null) {
      const prefillNetoRounded = Math.round(prefill.amount / (1 + IVA_RATE) * 100) / 100;
      if (importeNeto === prefillNetoRounded) return prefill.amount;
    }
    return Math.round((importeNeto + importeIVA) * 100) / 100;
  })();
  const sym          = SYM[currency] ?? "$";
  const fmtBig       = v => v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const mesComp  = fechaIso ? parseInt(fechaIso.split("-")[1]) - 1 : month;
  const anioComp = fechaIso ? parseInt(fechaIso.split("-")[0]) : year;

  // ── derivados movimiento ──
  const movImporte   = parseCurrencyInput(movImpRaw);
  const symMov       = SYM[movCurrency] ?? "$";
  const mesMovComp   = movFecha ? parseInt(movFecha.split("-")[1]) - 1 : month;
  const anioMovComp  = movFecha ? parseInt(movFecha.split("-")[0]) : year;

  // ── conceptos automáticos ──
  const autoConcepto = mode === "comprobante"
    ? `${doc === "FACTURA" ? "Factura" : "NC"} - ${CUENTA_LABEL[cuenta] ?? cuenta} - ${MONTHS[mesComp]} ${anioComp}`
    : `FC Recibida - ${CUENTA_LABEL[cuenta] ?? cuenta} - ${MONTHS[mesComp]} ${anioComp}`;
  const autoMovConcepto = `${COMP_TYPES[movTipo]?.label ?? movTipo} - ${MONTHS[mesMovComp]} ${anioMovComp}`;

  // ── flags de emisión ──
  const usaFacturante = mode === "comprobante" && isAR && currency === "ARS" && (doc === "FACTURA" || doc === "NC");
  const refFAComp     = doc === "NC" ? (comps[String(selectedFr?.id)] ?? []).find(c => c.id === refCompId) : null;
  const ncSinRef      = usaFacturante && doc === "NC" && !refFAComp?.invoice;

  const inputS = { padding: "9px 12px", fontSize: 14, borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)", fontFamily: "var(--font)", width: "100%", boxSizing: "border-box" };
  const labelS = { fontSize: 10, fontWeight: 700, color: "var(--muted)", letterSpacing: ".08em", display: "block", marginBottom: 6 };

  // ── reset al cambiar modo ──
  const switchMode = (m) => {
    setMode(m); setPreview(null); setEmitState("idle"); setEmitError(null);
  };

  // ── preview (comprobante) ──
  const handlePreview = () => {
    if (importeNeto <= 0 || !fechaIso) return;
    const nota = concepto || autoConcepto;
    setPreview({
      id: uid(), type: makeType(doc, cuenta), date: inputDateToDmy(fechaIso),
      amount: importeTotal, amountNeto: importeNeto,
      amountIVA: importeIVA > 0 ? importeIVA : undefined,
      ref: nota, nota,
      month: mesComp, year: anioComp,
      currency, empresa: activeCompany,
    });
  };

  // ── confirmar emisión ──
  const doConfirm = async (skipFacturante = false) => {
    if (!preview || emitState === "emitting") return;
    let enriched = doc === "NC" && refFAComp?.invoice
      ? { ...preview, refInvoice: refFAComp.invoice, refDate: refFAComp.date }
      : { ...preview };

    if (usaFacturante && !skipFacturante) {
      // Emisión ante ARCA
      setEmitState("emitting"); setEmitError(null);
      try {
        const result = await emitirComprobante({
          franchisor: franchisor?.ar ?? franchisor,
          franchise: selectedFr,
          comp: { ...preview, applyIVA },
          referenciaInvoice: refFAComp?.invoice ?? undefined,
          referenciaDate:    refFAComp?.date    ?? undefined,
        });
        enriched = { ...preview, invoice: invoiceFromResult(result), facturanteId: String(result.idComprobante) };
        setEmitState("idle");
      } catch (err) {
        setEmitState("error"); setEmitError(err.message ?? "Error al emitir ante ARCA"); return;
      }
    } else if (!usaFacturante && !skipFacturante && mode === "comprobante") {
      // Invoice USA/ESP
      setEmitState("emitting"); setEmitError(null);
      try {
        const invoicePrefix = COMPANIES[activeCompany]?.side === "es" ? "ESP" : "USA";
        const res = await getNextInvoiceNum(selectedFr?.id, invoicePrefix);
        enriched = { ...enriched, invoice: res.label };
        setEmitState("idle");
      } catch (e) {
        setEmitState("error"); setEmitError(e.message ?? "Error al obtener número de invoice"); return;
      }
    }

    try { onAdd(selectedFr?.id, enriched); } catch {
      setEmitState("error"); setEmitError(afipSaveFailedMsg(enriched.invoice, enriched.facturanteId)); return;
    }

    // PDF automático
    if (isAR && enriched.facturanteId) {
      const filename = `Factura_${enriched.invoice ?? enriched.facturanteId}_${selectedFr?.name}.pdf`;
      downloadFacturantePdfBlob(enriched.facturanteId)
        .then(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url; a.download = filename;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 100);
        })
        .catch(() => downloadTextAsPDF(buildFacturaPDF(selectedFr, franchisor, enriched), `Factura_${selectedFr?.name}.html`));
    } else if (isAR) {
      downloadTextAsPDF(buildFacturaPDF(selectedFr, franchisor, enriched), `Factura_${selectedFr?.name}.html`);
    } else if (enriched.invoice) {
      downloadInvoicePdf(selectedFr, franchisor, enriched).catch(console.error);
    }
    onClose();
  };

  // Franchises filtradas por búsqueda (para el picker global)
  const frOptions = (franchises ?? [])
    .filter(f =>
      f.activa !== false &&
      getFranchiseCurrencies(f).some(c => allowedCurrencies.includes(c)) &&
      (!frSearch || f.name.toLowerCase().includes(frSearch.toLowerCase()))
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Modal
      title={selectedFr ? `Nuevo comprobante — ${selectedFr.name}` : "Nuevo comprobante"}
      subtitle={selectedFr ? `${MONTH_NAMES[month]} ${year}` : "Seleccioná una sede"}
      onClose={onClose} width={540}
    >

      {/* ── Sede selector (solo cuando se abre sin sede pre-seleccionada) ── */}
      {franchise === null && (
        <div style={{ marginBottom: 16 }}>
          {selectedFr ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(173,255,25,.06)", borderRadius: 8, border: "1px solid rgba(173,255,25,.15)" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>{selectedFr.name}</span>
              <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 4 }}>{selectedFr.country}</span>
              <button className="ghost" style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px" }} onClick={() => { setSelectedFr(null); setFrSearch(""); }}>Cambiar</button>
            </div>
          ) : (
            <div>
              <input
                autoFocus
                value={frSearch}
                onChange={e => setFrSearch(e.target.value)}
                placeholder="Buscar sede…"
                style={{ padding: "9px 12px", fontSize: 13, borderRadius: 8, background: "var(--bg)", border: "1px solid var(--accent)", color: "var(--text)", fontFamily: "var(--font)", width: "100%", boxSizing: "border-box", marginBottom: 6 }}
              />
              <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border2)", borderRadius: 8, background: "var(--bg)" }}>
                {frOptions.length === 0
                  ? <div style={{ padding: "14px 12px", fontSize: 12, color: "var(--muted)", textAlign: "center" }}>Sin resultados</div>
                  : frOptions.map(f => (
                    <div key={f.id} onClick={() => setSelectedFr(f)} style={{
                      padding: "9px 14px", cursor: "pointer", fontSize: 13, fontWeight: 500,
                      borderBottom: "1px solid var(--border)",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,.05)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <span>{f.name}</span>
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>{f.country}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>
      )}

      {/* El resto del form solo se muestra cuando hay sede seleccionada */}
      {selectedFr && (<>

      {/* ── Tabs ── */}
      <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1.5px solid var(--border2)", marginBottom: 18 }}>
        {[["🧾 Comprobante","comprobante","var(--red)"],["📥 FC Recibida","fc_recibida","var(--blue)"],["💸 Movimiento","movimiento","var(--green)"]].map(([lbl, v, clr], i) => (
          <div key={v} onClick={() => switchMode(v)} style={{
            flex: 1, padding: "9px 12px", cursor: "pointer", fontWeight: 800, fontSize: 12, textAlign: "center",
            background: mode === v ? `color-mix(in srgb, ${clr} 14%, transparent)` : "transparent",
            color: mode === v ? clr : "var(--muted)",
            borderRight: i < 2 ? "1px solid var(--border2)" : "none",
            transition: "all .12s",
          }}>{lbl}</div>
        ))}
      </div>

      {/* ═══ COMPROBANTE / FC RECIBIDA ═══ */}
      {(mode === "comprobante" || mode === "fc_recibida") && (<>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 14, marginBottom: 16, alignItems: "start" }}>
          {/* Columna izquierda: Fecha + Cuenta */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelS}>FECHA</label>
              <input type="date" value={fechaIso} onChange={e => { setFechaIso(e.target.value); setPreview(null); }}
                style={{ ...inputS, cursor: "pointer", colorScheme: "dark", fontWeight: 700, border: fechaIso ? "1px solid var(--border2)" : "2px solid var(--red)" }} />
            </div>
            <div>
              <label style={labelS}>CUENTA</label>
              <select value={cuenta} onChange={e => { setCuenta(e.target.value); setPreview(null); }}
                style={{ ...inputS, fontWeight: 700, fontSize: 13 }}>
                {CUENTAS.map(c => <option key={c} value={c}>{CUENTA_LABEL[c]}</option>)}
              </select>
            </div>
          </div>

          {/* Columna derecha: Tipo doc + Moneda + Importe */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {mode === "comprobante" && (
              <div>
                <label style={labelS}>TIPO DE DOCUMENTO</label>
                <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1.5px solid var(--border2)" }}>
                  {DOCS.map((d, i) => (
                    <div key={d} onClick={() => { setDoc(d); setPreview(null); }} style={{
                      flex: 1, padding: "9px 18px", cursor: "pointer", fontWeight: 800, fontSize: 13, textAlign: "center",
                      background: doc === d ? (d === "FACTURA" ? "rgba(255,85,112,.18)" : "rgba(16,217,122,.18)") : "transparent",
                      color: doc === d ? (d === "FACTURA" ? "var(--red)" : "var(--green)") : "var(--muted)",
                      borderRight: i < DOCS.length - 1 ? "1px solid var(--border2)" : "none",
                      transition: "all .12s",
                    }}>{d === "FACTURA" ? "🧾 Factura" : "📋 NC"}</div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "start" }}>
              <div>
                <label style={labelS}>MONEDA</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {CURRENCIES.map(cur => {
                    const allowed = allowedCurrencies.includes(cur);
                    return (
                      <button key={cur} onClick={() => { if (allowed) { setCurrency(cur); setPreview(null); } }} style={{
                        padding: "8px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                        cursor: allowed ? "pointer" : "not-allowed", border: "none", fontFamily: "var(--font)",
                        background: currency === cur ? "var(--accent)" : "var(--bg)",
                        color: currency === cur ? "#1e2022" : allowed ? "var(--muted)" : "var(--dim)",
                        outline: currency === cur ? "none" : "1px solid var(--border2)",
                        opacity: allowed ? 1 : 0.3,
                      }} title={allowed ? cur : `${cur} no habilitado`}>{cur}</button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label style={labelS}>{applyIVA ? "NETO (SIN IVA)" : "IMPORTE"}</label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: 13, pointerEvents: "none" }}>{sym}</span>
                  <input value={importeRaw} inputMode="decimal"
                    onChange={e => { if (!e.target.value) { setImporteRaw(""); setPreview(null); return; } setImporteRaw(formatCurrencyInput(e.target.value)); setPreview(null); }}
                    placeholder="0,00"
                    style={{ ...inputS, paddingLeft: 28, textAlign: "right", fontWeight: 700 }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* IVA breakdown */}
        {applyIVA && importeNeto > 0 && (
          <div style={{ display: "flex", gap: 0, border: "1px solid var(--border2)", borderRadius: 8, overflow: "hidden", marginBottom: 16 }}>
            {[["NETO", importeNeto, "var(--text)"], ["IVA 21%", importeIVA, "var(--blue)"], ["TOTAL", importeTotal, "var(--accent)"]].map(([l, v, c], i) => (
              <div key={l} style={{ flex: 1, padding: "8px 14px", textAlign: "center", borderRight: i < 2 ? "1px solid var(--border2)" : "none", background: i === 2 ? "rgba(173,255,25,.05)" : "transparent" }}>
                <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700, letterSpacing: ".06em", marginBottom: 4 }}>{l}</div>
                <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: c }}>{sym} {fmtBig(v)}</div>
              </div>
            ))}
          </div>
        )}

        {/* Descripción / Nro factura recibida */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelS}>
            {mode === "fc_recibida" ? "NRO. FACTURA RECIBIDA" : "DESCRIPCIÓN"}
            {" "}<span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— editable</span>
          </label>
          <input
            value={concepto}
            onChange={e => { setConcepto(e.target.value); setPreview(null); }}
            onFocus={() => { if (!concepto && mode === "comprobante") setConcepto(autoConcepto); }}
            placeholder={mode === "fc_recibida" ? "Ej: FC-A 0001-00004521" : autoConcepto}
            style={inputS} />
        </div>

        {/* Preview (solo comprobante) */}
        {mode === "comprobante" && preview && (
          <div style={{ marginBottom: 16, background: "rgba(16,217,122,.05)", border: "1px solid rgba(16,217,122,.2)", borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: "var(--muted)", letterSpacing: ".1em", marginBottom: 10 }}>CONFIRMACIÓN</div>
            {[
              ["Tipo",        COMP_TYPES[preview.type]?.label],
              ["Importe",     applyIVA ? `${sym} ${fmtBig(preview.amountNeto)} neto + IVA = ${sym} ${fmtBig(preview.amount)}` : `${sym} ${fmtBig(preview.amount)}`],
              ["Moneda",      preview.currency],
              ["Fecha",       preview.date],
              ["Descripción", preview.nota],
              ["Documento",   usaFacturante ? (doc === "NC" ? "NC ARCA (ÑAKO SRL)" : "Factura ARCA (ÑAKO SRL)") : isAR ? (doc === "NC" ? "Nota de Crédito" : "Factura") : "Invoice"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, borderBottom: "1px solid var(--border)", paddingBottom: 4, marginBottom: 4 }}>
                <span style={{ color: "var(--muted)" }}>{k}</span>
                <span style={{ fontWeight: 600 }}>{v}</span>
              </div>
            ))}

            {/* Selector FA de referencia para NC AR */}
            {isAR && currency === "ARS" && doc === "NC" && (() => {
              const allFAs = (comps[String(selectedFr?.id)] ?? [])
                .filter(c => c.type?.startsWith("FACTURA") && c.invoice)
                .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
              const selFA = allFAs.find(c => c.id === refCompId);
              return (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                  <label style={{ fontSize: 9, fontWeight: 800, color: "var(--red)", letterSpacing: ".1em", display: "block", marginBottom: 6 }}>
                    FACTURA DE REFERENCIA <span style={{ color: "var(--muted)", fontWeight: 400 }}>(obligatoria ante ARCA)</span>
                  </label>
                  {allFAs.length === 0
                    ? <div style={{ fontSize: 11, color: "var(--muted)", padding: "8px 10px", background: "var(--bg2)", borderRadius: 6 }}>
                        No hay facturas registradas para esta sede.
                      </div>
                    : <select value={refCompId ?? ""} onChange={e => setRefCompId(e.target.value || null)}
                        style={{ width: "100%", background: "var(--bg)", border: `1px solid ${selFA?.invoice ? "var(--border2)" : "var(--red)"}`, borderRadius: 6, padding: "6px 10px", color: "var(--text)", fontSize: 12 }}>
                        <option value="">— Seleccionar factura —</option>
                        {allFAs.map(c => {
                          const ct  = CUENTA_LABEL[c.type?.split("|")[1]] ?? c.type?.split("|")[1] ?? "";
                          const imp = c.amount ? `$${c.amount.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "";
                          return <option key={c.id} value={c.id}>{c.invoice} — {c.date} — {ct} — {imp}</option>;
                        })}
                      </select>
                  }
                </div>
              );
            })()}
          </div>
        )}

        {/* Error de emisión */}
        {emitState === "error" && (
          <div style={{ marginBottom: 12, padding: "10px 14px", background: "rgba(255,85,112,.08)", border: "1px solid rgba(255,85,112,.25)", borderRadius: 8, fontSize: 12 }}>
            <div style={{ color: "var(--red)", fontWeight: 700, marginBottom: 6 }}>⚠ {emitError}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => doConfirm(false)}>Reintentar</button>
              {usaFacturante && <button className="ghost" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => doConfirm(true)}>Guardar sin emitir</button>}
            </div>
          </div>
        )}

        {/* Acciones */}
        <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
          {mode === "fc_recibida" ? (<>
            <button className="ghost" style={{ flex: 1, height: 44, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>Cancelar</button>
            <button
              className="btn"
              disabled={importeNeto <= 0 || !fechaIso}
              style={{ flex: 3, height: 44, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(96,165,250,.15)", color: "var(--blue)", border: "1px solid rgba(96,165,250,.3)" }}
              onClick={() => {
                if (importeNeto <= 0) return;
                const nota = `FC Recibida - ${CUENTA_LABEL[cuenta] ?? cuenta} - ${MONTHS[mesComp]} ${anioComp}`;
                onAdd(selectedFr?.id, {
                  id: uid(), type: makeType("FC_RECIBIDA", cuenta), date: inputDateToDmy(fechaIso),
                  amount: importeTotal, amountNeto: importeNeto,
                  amountIVA: importeIVA > 0 ? importeIVA : undefined,
                  ref: nota, nota, invoice: concepto.trim() || "",
                  month: mesComp, year: anioComp,
                  currency, empresa: activeCompany,
                });
                onClose();
              }}>
              ✓ Registrar comprobante recibido
            </button>
          </>) : !preview ? (<>
            <button className="ghost" style={{ flex: 1, height: 44, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>Cancelar</button>
            <button className="btn" style={{ flex: 3, height: 44, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}
              disabled={importeNeto <= 0 || !fechaIso}
              onClick={handlePreview}>
              Vista previa →
            </button>
          </>) : (<>
            <button className="ghost" style={{ flex: 1, height: 44, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setPreview(null)}>← Editar</button>
            {usaFacturante && (
              <button className="ghost" style={{ flex: 2, height: 44, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}
                disabled={emitState === "emitting" || ncSinRef}
                title={ncSinRef ? "Seleccioná la FA de referencia antes de guardar" : undefined}
                onClick={() => doConfirm(true)}>
                Guardar sin emitir
              </button>
            )}
            <button className="btn" style={{ flex: 3, height: 44, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}
              disabled={emitState === "emitting" || ncSinRef}
              title={ncSinRef ? "Seleccioná la FA de referencia antes de emitir" : undefined}
              onClick={() => doConfirm(false)}>
              {emitState === "emitting"
                ? (usaFacturante ? "Emitiendo ante ARCA…" : "Generando…")
                : `✓ ${usaFacturante ? (doc === "NC" ? "Emitir NC ARCA" : "Emitir Factura ARCA") : isAR ? (doc === "NC" ? "Generar NC" : "Generar Factura") : "Generar Invoice"}`}
            </button>
          </>)}
        </div>
      </>)}

      {/* ═══ MOVIMIENTO ═══ */}
      {mode === "movimiento" && (<>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 14, marginBottom: 16, alignItems: "start" }}>
          {/* Fecha */}
          <div>
            <label style={labelS}>FECHA</label>
            <input type="date" value={movFecha} onChange={e => setMovFecha(e.target.value)}
              style={{ ...inputS, cursor: "pointer", colorScheme: "dark", fontWeight: 700 }} />
          </div>

          {/* Tipo + Moneda + Importe */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelS}>TIPO DE MOVIMIENTO</label>
              <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1.5px solid var(--border2)" }}>
                {TIPOS_MOVIMIENTO.map((k, i) => {
                  const t   = COMP_TYPES[k];
                  const sel = movTipo === k;
                  const short = k === "PAGO" ? "Cobro" : k === "PAGO_PAUTA" ? "A cuenta" : "Trf. Enviada";
                  const sub   = k === "PAGO" ? "del franquiciado" : k === "PAGO_PAUTA" ? "pago a cuenta" : "al franquiciado";
                  return (
                    <div key={k} onClick={() => setMovTipo(k)} style={{
                      flex: 1, padding: "9px 4px 7px", cursor: "pointer", fontWeight: 800, fontSize: 11, textAlign: "center",
                      background: sel ? `${t?.color ?? "var(--accent)"}28` : "transparent",
                      color: sel ? (t?.color ?? "var(--accent)") : "var(--muted)",
                      borderRight: i < TIPOS_MOVIMIENTO.length - 1 ? "1px solid var(--border2)" : "none",
                      borderBottom: `3px solid ${sel ? (t?.color ?? "var(--accent)") : "transparent"}`,
                      transition: "all .12s",
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
                  {CURRENCIES.map(cur => {
                    const allowed = allowedCurrencies.includes(cur);
                    return (
                      <button key={cur} onClick={() => allowed && setMovCurrency(cur)} style={{
                        padding: "8px 12px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                        cursor: allowed ? "pointer" : "not-allowed", border: "none", fontFamily: "var(--font)",
                        background: movCurrency === cur ? "var(--accent)" : "var(--bg)",
                        color: movCurrency === cur ? "#1e2022" : allowed ? "var(--muted)" : "var(--dim)",
                        outline: movCurrency === cur ? "none" : "1px solid var(--border2)",
                        opacity: allowed ? 1 : 0.3,
                      }} title={allowed ? cur : `${cur} no habilitado`}>{cur}</button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label style={labelS}>IMPORTE</label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: 13, pointerEvents: "none" }}>{symMov}</span>
                  <input value={movImpRaw} inputMode="decimal"
                    onChange={e => { if (!e.target.value) { setMovImpRaw(""); return; } setMovImpRaw(formatCurrencyInput(e.target.value)); }}
                    placeholder="0,00"
                    style={{ ...inputS, paddingLeft: 28, textAlign: "right", fontWeight: 700 }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Referencia */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelS}>REFERENCIA <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— editable</span></label>
          <input
            value={movConcepto || autoMovConcepto}
            onChange={e => setMovConcepto(e.target.value)}
            onFocus={() => { if (!movConcepto) setMovConcepto(autoMovConcepto); }}
            placeholder="Nro. de transferencia, descripción..."
            style={inputS} />
        </div>

        {movTipo === "PAGO_PAUTA"   && <div style={{ background: "rgba(34,211,238,.05)", border: "1px solid rgba(34,211,238,.15)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "var(--cyan)" }}>Cobro anticipado — queda pendiente hasta emitir la factura de pauta.</div>}
        {movTipo === "PAGO_ENVIADO" && <div style={{ background: "rgba(255,85,112,.05)", border: "1px solid rgba(255,85,112,.15)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "var(--red)" }}>BIGG transfiere fondos al franquiciado. Aumenta la deuda de BIGG.</div>}

        <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
          <button className="ghost" style={{ flex: 1, height: 44, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>Cancelar</button>
          <button className="btn" style={{ flex: 3, height: 44, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}
            disabled={movImporte <= 0}
            onClick={() => {
              if (movImporte <= 0) return;
              const nota = movConcepto || autoMovConcepto;
              onAdd(selectedFr?.id, {
                id: uid(), type: movTipo, date: inputDateToDmy(movFecha),
                amount: movImporte, ref: nota, nota,
                month: mesMovComp, year: anioMovComp,
                currency: movCurrency, empresa: activeCompany,
              });
              onClose();
            }}>
            ✓ Registrar movimiento
          </button>
        </div>
      </>)}

      </>)} {/* fin {selectedFr && */}
    </Modal>
  );
}
