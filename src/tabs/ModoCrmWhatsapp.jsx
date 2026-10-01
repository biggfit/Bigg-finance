import { useState, useMemo } from "react";
import { useStore } from "../lib/context";
import { makeType, MONTHS, AVAILABLE_YEARS, uid, COMPANIES, monthRange, fmt } from "../lib/helpers";
import { tcDelMes, montoAMoneda } from "../lib/numbersApi";
import { empresaEmisoraPorPais, monedaFacturacionPorPais, round2, emitirLote,
         formatCurrencyInput, parseCurrencyInput, CRM_WA_APLICA_IVA } from "./facturadorBatch";

// ─── Lote: servicio CRM WhatsApp ──────────────────────────────────────────────
// BIGG cobra aparte (fuera del fee) la integración del CRM con WhatsApp. El cobro mensual es un
// importe en USD por sede que sale del reporte 29 de BIGG Eye ("Consumo WhatsApp por franquicia",
// vía /api/bigg-eye-whatsapp) y también se puede tipear a mano. Se factura con las MISMAS reglas que el fee:
// AR → ÑAKO en ARS con el TC de Maestros + IVA; LATAM → BIGG FIT en USD; país EUR → Wellness en EUR.
// Se factura a cualquier sede que tenga el servicio, pague fee o no. Sede propia → asiento de
// gestión (GFAC|CRM), sin ARCA ni correlativo, como el resto de sus interusos.

// El IVA por sociedad (CRM_WA_APLICA_IVA) y el subtítulo viven en facturadorBatch.js: también los usa
// el encabezado del Facturador.
const IVA_RATE = 0.21;

const fmtTc = (cur, tc) => cur === "ARS"
  ? `$ ${tc.toLocaleString("es-AR", { maximumFractionDigits: 2 })} / USD`
  : `${tc.toLocaleString("es-AR", { maximumFractionDigits: 4 })} USD / €`;

export default function ModoCrmWhatsapp({ month: monthProp, year: yearProp, onAddComp, onDone, franchisor, tiposCambio = {}, setBatchProg = () => {} }) {
  const { franchises, activeCompany } = useStore();
  const activeFr = useMemo(() => franchises.filter(f => f.activa !== false).sort((a, b) => a.name.localeCompare(b.name, "es")), [franchises]);
  // Mismo criterio que el fee: la sociedad emisora la define el PAÍS de la sede.
  const frForCompany = useMemo(() => activeFr.filter(f => empresaEmisoraPorPais(f.country) === activeCompany), [activeFr, activeCompany]);
  const aplicaIVA   = !!CRM_WA_APLICA_IVA[activeCompany];
  const curSociedad = COMPANIES[activeCompany]?.currency ?? "USD";

  const [waMonth, setWaMonth] = useState(monthProp);
  const [waYear,  setWaYear]  = useState(yearProp);
  const [waDate,  setWaDate]  = useState(() => monthRange(monthProp, yearProp).mesFin);
  // Grilla vacía cada mes a propósito (decisión de Martín): el USD se carga a mano o viene de Eye.
  // El componente se monta con key={activeCompany} desde TabFacturador → cambiar de sociedad lo reinicia.
  const [rows, setRows] = useState(() => frForCompany.map(fr => ({
    frId: fr.id, frName: fr.name, country: fr.country,
    biggEyeId: fr.biggEyeId ?? null, esSedePropia: fr.esSedePropia === true, costoUsd: "",
  })));
  const [selected,   setSelected]   = useState(new Set());
  const [filtro,     setFiltro]     = useState("");
  const [stage,      setStage]      = useState("edit");   // "edit" | "done"
  const [processed,  setProcessed]  = useState([]);
  const [eyeMsg,     setEyeMsg]     = useState(null);     // { tipo: "ok"|"warn", texto }
  const [eyeLoading, setEyeLoading] = useState(false);

  const tcMes = tcDelMes(tiposCambio, waYear, waMonth + 1);

  // Cálculo por fila. ARS convierte con el TC OFICIAL (`arsUSDOficial`, TC_REFERENCIA_FIELDS en numbersApi):
  // es el que usa el banco para cobrarnos Meta/Twilio, así que es el que corresponde para refacturar ese
  // costo; el MEP (`arsUSD`) es para reportar el fee, no para esto (decisión de Martín, 1/10). Es la única
  // conversión del sistema que usa el oficial, a propósito. EUR sigue por montoAMoneda (eurUSD divide).
  // Sin TC del mes → null, nunca 0 silencioso.
  const calc = (r) => {
    const u      = round2(parseCurrencyInput(r.costoUsd));
    const cur    = monedaFacturacionPorPais(r.country);
    const tcRaw  = cur === "ARS" ? tcMes?.arsUSDOficial : cur === "EUR" ? tcMes?.eurUSD : 1;
    const tcRate = tcRaw > 0 ? tcRaw : null;
    const sinTc  = cur !== "USD" && tcRate == null;
    const conv   = u <= 0 ? 0 : sinTc ? null : cur === "ARS" ? u * tcRate : montoAMoneda(u, "USD", tcMes, cur);
    const neto   = conv == null ? null : round2(conv);
    const iva    = aplicaIVA && neto != null ? round2(neto * IVA_RATE) : 0;
    const total  = neto == null ? null : round2(neto + iva);
    return { u, cur, tcRate, sinTc, neto, iva, total };
  };

  const conCosto     = rows.map((r, i) => ({ ...r, _i: i, ...calc(r) })).filter(r => r.u > 0);
  const sinTcRows    = conCosto.filter(r => r.sinTc);
  const billableRows = conCosto.filter(r => !r.sinTc);
  const gestionRows  = billableRows.filter(r => r.esSedePropia);
  const toProcess    = selected.size > 0 ? billableRows.filter(r => selected.has(r._i)) : billableRows;

  const filasVisibles = rows
    .map((r, i) => ({ ...r, _i: i, ...calc(r) }))
    .filter(r => !filtro.trim() || r.frName.toLowerCase().includes(filtro.toLowerCase()) || (r.country ?? "").toLowerCase().includes(filtro.toLowerCase()))
    .sort((a, b) => (a.country ?? "").localeCompare(b.country ?? "", "es") || a.frName.localeCompare(b.frName, "es"));

  const updateCosto = (i, raw) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, costoUsd: raw ? formatCurrencyInput(raw) : "" } : r));
  const quitarFila  = (i) => { setRows(prev => prev.filter((_, idx) => idx !== i)); setSelected(new Set()); };

  // BIGG Eye, reporte 29 "Consumo WhatsApp por franquicia" vía /api/bigg-eye-whatsapp (ver contrato ahí).
  // Se precarga el "cobro franquicia" (lo que se le factura a la sede); el "costo estimado" (prorrateo del
  // costo real de Meta/Twilio) viene como referencia y se muestra en el tooltip del importe.
  const handleDescargarEye = async () => {
    setEyeLoading(true); setEyeMsg(null);
    try {
      const res  = await fetch(`/api/bigg-eye-whatsapp?month=${waMonth + 1}&year=${waYear}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) { setEyeMsg({ tipo: "warn", texto: data.error || `BIGG Eye respondió ${res.status}` }); return; }
      const costos  = data.costos  || {};
      const detalle = data.detalle || {};
      const idsGrilla = new Set(rows.filter(r => r.biggEyeId != null).map(r => String(r.biggEyeId)));
      let n = 0;
      const next = rows.map(r => {
        if (r.biggEyeId == null) return r;
        const d = detalle[String(r.biggEyeId)];
        const c = costos[String(r.biggEyeId)];
        const base = { ...r, costoEstimado: d?.costoEstimado ?? null, eyeCategoria: d?.categoria ?? "" };
        if (c == null || !(Number(c) > 0)) return base;
        n++;
        return { ...base, costoUsd: formatCurrencyInput(Number(c).toFixed(2).replace(".", ",")) };
      });
      setRows(next);
      // El resumen cuenta desde lo que dice EYE (no desde la grilla), así los números cierran entre sí:
      //   con cobro (precargadas) · con consumo pero sin cobro (operadas/propias, no se facturan) ·
      //   con cobro en Eye que no están en la grilla (ID no cargado en Maestros o sede de otra sociedad) ← esto sí es un problema.
      const todas      = Object.entries(detalle);
      const conCobro   = todas.filter(([, d]) => d.cobro > 0);
      const sinCobro   = todas.filter(([, d]) => !(d.cobro > 0));
      const noUbicadas = conCobro.filter(([id]) => !idsGrilla.has(id)).map(([, d]) => d.nombre);
      const fmtU = v => Number(v).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const cobroTot   = conCobro.reduce((s, [, d]) => s + d.cobro, 0);
      const costoCobr  = conCobro.reduce((s, [, d]) => s + (d.costoEstimado || 0), 0);
      const costoTot   = Number(data.totales?.costoEstimado) || 0;
      setEyeMsg({ tipo: noUbicadas.length ? "warn" : "ok", texto:
        `Eye ${MONTHS[waMonth]} ${waYear}: ${conCobro.length} sede${conCobro.length !== 1 ? "s" : ""} con cobro (U$D ${fmtU(cobroTot)}), ${n} precargada${n !== 1 ? "s" : ""} en la grilla` +
        (sinCobro.length ? ` · ${sinCobro.length} con consumo pero sin cobro: ${sinCobro.map(([, d]) => d.nombre).join(", ")}` : "") +
        (noUbicadas.length ? ` · ⚠ ${noUbicadas.length} con cobro que no están en esta grilla (sin Bigg Eye ID en Maestros o de otra sociedad): ${noUbicadas.join(", ")}` : "") +
        (costoTot ? ` · costo estimado Meta/Twilio U$D ${fmtU(costoTot)}, de los cuales U$D ${fmtU(costoCobr)} corresponden a las sedes con cobro` : "") });
    } catch (e) {
      setEyeMsg({ tipo: "warn", texto: e.message ?? "No se pudo consultar BIGG Eye" });
    } finally { setEyeLoading(false); }
  };

  const handleConfirm = async (skipFacturante = false) => {
    const items = [];
    for (const r of toProcess) {
      const fr = activeFr.find(f => f.id === r.frId);
      if (!fr || r.total == null) continue;
      const concepto = `Servicio CRM WhatsApp ${MONTHS[waMonth]} ${waYear}`;
      const comp = {
        id: uid(), type: makeType(r.esSedePropia ? "GFAC" : "FACTURA", "CRM"), date: waDate,
        amount:     r.total,
        amountNeto: aplicaIVA ? r.neto : undefined,
        amountIVA:  aplicaIVA ? r.iva  : undefined,
        applyIVA:   aplicaIVA,                      // explícito: el PDF de España asume IVA si falta
        ref:  concepto,                             // → Detalle / Observaciones en ARCA
        nota: `${concepto} · U$D ${r.u.toFixed(2)}${r.cur === "ARS" ? ` · TC oficial ${r.tcRate}` : r.cur === "EUR" ? ` · TC ${r.tcRate}` : ""}`,
        month: waMonth, year: waYear,
        currency: r.cur, empresa: activeCompany,
      };
      items.push({ fr, comp, sinEmision: r.esSedePropia, meta: { frName: r.frName, country: r.country, u: r.u, cur: r.cur, total: r.total } });
    }
    const log = await emitirLote({ items, franchisor, activeCompany, onAddComp, skipFacturante, setBatchProg });
    setProcessed(log);
    setStage("done");
  };

  // ── Pantalla final ─────────────────────────────────────────────────────────
  if (stage === "done") {
    const failedCount    = processed.filter(p => p.facturanteStatus?.startsWith("GUARDADO_FALLIDO")).length;
    const verificarCount = processed.filter(p => p.facturanteStatus?.startsWith("VERIFICAR")).length;
    const OK = new Set(["ok", "omitido", "invoice_ok", "gestion"]);
    return (
      <div className="fade" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>{failedCount > 0 || verificarCount > 0 ? "⚠️" : "✅"}</div>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Lote CRM WhatsApp procesado</div>
        <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
          {processed.length} comprobante{processed.length !== 1 ? "s" : ""} · {MONTHS[waMonth]} {waYear} · {activeCompany}
        </div>
        {failedCount > 0 && (
          <div style={{ color: "var(--red)", fontWeight: 700, fontSize: 13, marginBottom: 16 }}>
            {failedCount} factura{failedCount !== 1 ? "s" : ""} emitida{failedCount !== 1 ? "s" : ""} en Facturante pero NO guardada{failedCount !== 1 ? "s" : ""} en el sistema
            <div style={{ fontWeight: 400, fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Verificado releyendo la hoja. Cargalas a mano con el ID que figura abajo.</div>
          </div>
        )}
        {verificarCount > 0 && (
          <div style={{ color: "var(--orange)", fontWeight: 700, fontSize: 13, marginBottom: 16 }}>
            {verificarCount} factura{verificarCount !== 1 ? "s" : ""} sin confirmar
            <div style={{ fontWeight: 400, fontSize: 11, color: "var(--muted)", marginTop: 4 }}>No se pudo releer la hoja. Buscá cada una en su sede antes de cargarla a mano.</div>
          </div>
        )}
        <div className="card" style={{ textAlign: "left", maxWidth: 560, margin: "0 auto 20px" }}>
          {processed.map((p, i) => (
            <div key={i} style={{ borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 14px", fontSize: 12 }}>
                <span>
                  {p.frName}
                  {p.invoice && <span className="mono" style={{ fontSize: 10, color: "var(--accent)", marginLeft: 8 }}>{p.invoice}</span>}
                  {p.facturanteStatus === "gestion" && <span className="pill" style={{ fontSize: 9, marginLeft: 8, color: "var(--purple, #a78bfa)", background: "rgba(167,139,250,.12)" }}>gestión</span>}
                </span>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>U$D {p.u.toFixed(2)}</span>
                  <span className="mono" style={{ fontWeight: 700, color: "var(--green)" }}>{fmt(p.total, p.cur)}</span>
                </span>
              </div>
              {p.facturanteStatus && !OK.has(p.facturanteStatus) && (
                <div style={{ padding: "3px 14px 6px", fontSize: 10, color: "var(--red)" }}>{p.facturanteStatus}</div>
              )}
            </div>
          ))}
        </div>
        <button className="btn" onClick={onDone}>Volver</button>
      </div>
    );
  }

  // ── Edición ────────────────────────────────────────────────────────────────
  const inS  = { padding: "4px 8px", fontSize: 12, borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)", fontFamily: "var(--font)", textAlign: "right" };
  const selS = { padding: "5px 9px", fontSize: 12, borderRadius: 7, background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)", fontFamily: "var(--font)", cursor: "pointer" };
  const tcSociedad = curSociedad === "ARS" ? tcMes?.arsUSDOficial : curSociedad === "EUR" ? tcMes?.eurUSD : null;
  const necesitaTc = curSociedad !== "USD";
  // Totales de lo que está en pantalla con costo (respeta el filtro de sede/país); las filas sin TC no suman ARS.
  const tot = filasVisibles.reduce((a, r) => {
    if (r.u <= 0) return a;
    a.sedes++; a.usd += r.u;
    if (r.total != null) { a.neto += r.neto; a.iva += r.iva; a.total += r.total; } else a.sinTc++;
    return a;
  }, { sedes: 0, usd: 0, neto: 0, iva: 0, total: 0, sinTc: 0 });
  const tcNombre   = curSociedad === "ARS" ? "TC oficial" : "TC";
  const tcCampo    = curSociedad === "ARS" ? "ARS / U$D (Oficial)" : "€ / U$D";
  const allSel = filasVisibles.length > 0 && filasVisibles.every(r => selected.has(r._i));

  return (
    <div className="fade">
      {/* Header — el título y el subtítulo del lote los muestra el encabezado del Facturador */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <button className={eyeLoading ? "ghost" : "btn"} style={{ fontSize: 12, padding: "6px 14px", opacity: eyeLoading ? .6 : 1 }}
          onClick={handleDescargarEye} disabled={eyeLoading} title="Trae el cobro de WhatsApp del mes por sede desde BIGG Eye (reporte Consumo WhatsApp por franquicia)">
          {eyeLoading ? "⏳ Consultando…" : "⬇ Descargar de Eye"}
        </button>
        <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Filtrar sede o país…"
          style={{ ...inS, textAlign: "left", minWidth: 180 }} />
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 8, padding: "5px 10px" }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", letterSpacing: ".08em" }}>PERÍODO</span>
          <select value={waMonth} onChange={e => { const m = parseInt(e.target.value); setWaMonth(m); setWaDate(monthRange(m, waYear).mesFin); }} style={selS}>
            {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select value={waYear} onChange={e => { const y = parseInt(e.target.value); setWaYear(y); setWaDate(monthRange(waMonth, y).mesFin); }} style={{ ...selS, width: 78 }}>
            {AVAILABLE_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {necesitaTc && (
          <div title={tcSociedad > 0 ? `${tcCampo} de Numbers → Maestros → Tipo de Cambio para ${MONTHS[waMonth]} ${waYear}. Para cambiarlo, editalo ahí.` : `Falta "${tcCampo}" de ${MONTHS[waMonth]} ${waYear} en Numbers → Maestros → Tipo de Cambio: sin TC no se factura.`}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, padding: "6px 10px", borderRadius: 8, cursor: "help",
                     border: `1px solid ${tcSociedad > 0 ? "var(--border2)" : "rgba(255,107,122,.4)"}`, color: tcSociedad > 0 ? "var(--muted)" : "var(--red)" }}>
            <span style={{ fontWeight: 700 }}>{tcNombre} {MONTHS[waMonth].slice(0, 3)}</span>
            <span className="mono">{tcSociedad > 0 ? fmtTc(curSociedad, tcSociedad) : "falta en Maestros"}</span>
            <span>{tcSociedad > 0 ? "🔒" : "✗"}</span>
          </div>
        )}
      </div>

      {eyeMsg && (
        <div className="fade" style={{ marginBottom: 10, padding: "8px 14px", borderRadius: 8, fontSize: 11,
          background: eyeMsg.tipo === "ok" ? "rgba(16,217,122,.06)" : "rgba(251,191,36,.06)",
          border: `1px solid ${eyeMsg.tipo === "ok" ? "rgba(16,217,122,.25)" : "rgba(251,191,36,.2)"}`,
          color: eyeMsg.tipo === "ok" ? "var(--green)" : "var(--gold)" }}>
          {eyeMsg.tipo === "ok" ? "✓ " : "⚠ "}{eyeMsg.texto}
        </div>
      )}

      {selected.size > 0 && (
        <div className="fade" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "7px 12px", background: "rgba(34,211,238,.06)", border: "1px solid rgba(34,211,238,.2)", borderRadius: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--cyan)" }}>{selected.size} seleccionada{selected.size !== 1 ? "s" : ""}</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Solo se facturan las seleccionadas que tengan costo.</span>
          <button onClick={() => setSelected(new Set())} className="ghost" style={{ fontSize: 11, padding: "2px 8px", marginLeft: "auto" }}>Deseleccionar</button>
        </div>
      )}

      {/* Tabla: una sola moneda por sociedad */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border2)" }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".07em", color: "var(--cyan)" }}>💬 Factura en {curSociedad} · {activeCompany}</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{filasVisibles.length} sede{filasVisibles.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="tbl-wrap"><table style={{ tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            <col style={{ width: 32 }} /><col style={{ width: 150 }} /><col style={{ width: 90 }} /><col style={{ width: 120 }} />
            <col style={{ width: 120 }} /><col style={{ width: 110 }} /><col style={{ width: 95 }} /><col style={{ width: 115 }} /><col style={{ width: 80 }} /><col style={{ width: 32 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" style={{ accentColor: "var(--accent)", cursor: "pointer" }} checked={allSel}
                  onChange={e => setSelected(prev => { const n = new Set(prev); filasVisibles.forEach(r => e.target.checked ? n.add(r._i) : n.delete(r._i)); return n; })} />
              </th>
              <th>Sede</th><th>País</th>
              <th style={{ textAlign: "right" }}>Costo USD</th>
              <th style={{ textAlign: "right" }}>TC</th>
              <th style={{ textAlign: "right" }}>Neto {curSociedad}</th>
              <th style={{ textAlign: "right" }}>IVA</th>
              <th style={{ textAlign: "right" }}>Total</th>
              <th style={{ textAlign: "center" }}>Estado</th>
              <th style={{ width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {filasVisibles.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: "center", padding: 24, color: "var(--muted)", fontSize: 12 }}>
                {rows.length === 0 ? `No hay sedes activas que facture ${activeCompany}.` : "No hay sedes que coincidan con el filtro"}
              </td></tr>
            )}
            {filasVisibles.map(r => {
              const i = r._i;
              const estado = r.u <= 0 ? null : r.sinTc ? "sinTc" : r.esSedePropia ? "gestion" : "listo";
              const pill = estado === "listo"   ? { t: "listo",   c: "var(--green)",  bg: "rgba(16,217,122,.1)" }
                         : estado === "sinTc"   ? { t: "sin TC",  c: "var(--red)",    bg: "rgba(255,107,122,.1)" }
                         : estado === "gestion" ? { t: "gestión", c: "var(--purple, #a78bfa)", bg: "rgba(167,139,250,.12)" }
                         : null;
              return (
                <tr key={r.frId} style={{ background: selected.has(i) ? "rgba(34,211,238,.06)" : "transparent" }}>
                  <td><input type="checkbox" style={{ accentColor: "var(--accent)", cursor: "pointer" }} checked={selected.has(i)}
                    onChange={e => setSelected(prev => { const n = new Set(prev); e.target.checked ? n.add(i) : n.delete(i); return n; })} /></td>
                  <td style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.frName}>
                    {r.frName}
                    {r.biggEyeId == null && <span title="Sin Bigg Eye ID: el costo no puede venir de Eye, se carga a mano" style={{ color: "var(--gold)", marginLeft: 4, fontWeight: 700 }}>*</span>}
                    {r.esSedePropia && <span title="Sede propia: se guarda como asiento de gestión, sin ARCA ni correlativo" style={{ color: "var(--purple, #a78bfa)", marginLeft: 4, fontSize: 10 }}>◆</span>}
                  </td>
                  <td style={{ fontSize: 11, color: "var(--muted)" }}>{r.country ?? "—"}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>U$D</span>
                      <input value={r.costoUsd} onChange={e => updateCosto(i, e.target.value)} placeholder="0,00" inputMode="decimal" style={{ ...inS, width: 90 }}
                        title={r.costoEstimado != null ? `Eye · ${r.eyeCategoria || "—"} · costo estimado Meta/Twilio U$D ${Number(r.costoEstimado).toFixed(2)}` : undefined} />
                    </div>
                  </td>
                  <td className="mono" style={{ textAlign: "right", fontSize: 11, color: r.sinTc && r.u > 0 ? "var(--red)" : "var(--muted)" }}>
                    {r.cur === "USD" ? "—" : r.tcRate ? fmtTc(r.cur, r.tcRate) : "falta"}
                  </td>
                  <td className="mono" style={{ textAlign: "right", fontSize: 12 }}>{r.u > 0 && r.neto != null ? fmt(r.neto, r.cur) : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                  <td className="mono" style={{ textAlign: "right", fontSize: 11, color: "var(--muted)" }}>{r.u > 0 && r.neto != null && aplicaIVA ? fmt(r.iva, r.cur) : "—"}</td>
                  <td className="mono" style={{ textAlign: "right", fontSize: 12, fontWeight: 700, color: r.total != null && r.u > 0 ? "var(--green)" : "var(--muted)" }}>
                    {r.u > 0 && r.total != null ? fmt(r.total, r.cur) : "—"}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {pill ? <span className="pill" style={{ fontSize: 9, fontWeight: 800, color: pill.c, background: pill.bg }}>{pill.t}</span> : <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>}
                  </td>
                  <td>
                    <button onClick={() => quitarFila(i)} title="Quitar de la lista" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 13, padding: "2px 5px", borderRadius: 4 }}
                      onMouseEnter={e => e.currentTarget.style.color = "var(--red)"}
                      onMouseLeave={e => e.currentTarget.style.color = "var(--muted)"}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {tot.sedes > 0 && (
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--border2)", background: "rgba(255,255,255,.02)" }}>
                <td />
                <td colSpan={2} style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, padding: "8px 8px" }}>
                  TOTAL · {tot.sedes} sede{tot.sedes !== 1 ? "s" : ""} con costo{tot.sinTc ? ` · ${tot.sinTc} sin TC` : ""}
                </td>
                <td className="mono" style={{ textAlign: "right", fontSize: 12, fontWeight: 800, padding: "8px 8px", whiteSpace: "nowrap" }}>U$D {round2(tot.usd).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td />
                <td className="mono" style={{ textAlign: "right", fontSize: 12, fontWeight: 800, padding: "8px 8px", whiteSpace: "nowrap" }}>{fmt(round2(tot.neto), curSociedad)}</td>
                <td className="mono" style={{ textAlign: "right", fontSize: 11, fontWeight: 700, color: "var(--muted)", padding: "8px 8px", whiteSpace: "nowrap" }}>{aplicaIVA ? fmt(round2(tot.iva), curSociedad) : "—"}</td>
                <td className="mono" style={{ textAlign: "right", fontSize: 13, fontWeight: 800, color: "var(--green)", padding: "8px 8px", whiteSpace: "nowrap" }}>{fmt(round2(tot.total), curSociedad)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table></div>
      </div>

      {/* Pie */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center" }}>
          {conCosto.length} con costo
          {selected.size > 0 && <span style={{ color: "var(--accent)", marginLeft: 6 }}>· {toProcess.length} seleccionada{toProcess.length !== 1 ? "s" : ""}</span>}
          {sinTcRows.length > 0 && (
            <span style={{ color: "var(--red)", marginLeft: 6, fontWeight: 700 }}
              title={`Cargá "${tcCampo}" de ${MONTHS[waMonth]} ${waYear} en Numbers → Maestros → Tipo de Cambio`}>
              · {sinTcRows.length} sin TC, fuera del lote
            </span>
          )}
          {gestionRows.length > 0 && (
            <span style={{ color: "var(--purple, #a78bfa)", marginLeft: 6, fontWeight: 700 }}
              title={`${gestionRows.map(r => r.frName).join(", ")}: sede propia, se guarda como asiento de gestión (GFAC|CRM), sin ARCA ni número`}>
              · {gestionRows.length} por gestión
            </span>
          )}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>Fecha emisión</label>
          <input type="date"
            value={(() => { const p = waDate.split("/"); return `${p[2]}-${p[1]}-${p[0]}`; })()}
            onChange={e => { const [y, m, d] = e.target.value.split("-"); if (y && m && d) setWaDate(`${d}/${m}/${y}`); }}
            style={{ ...inS, width: 140, fontSize: 12 }} />
        </div>
        {/* Visible para todas las sociedades (en el fee solo ARS): permite probar sin consumir correlativo USA-/ESP-. */}
        <button className="ghost" disabled={toProcess.length === 0} style={{ opacity: toProcess.length === 0 ? 0.4 : 1, fontSize: 12 }} onClick={() => handleConfirm(true)}>
          ✓ Guardar sin emitir ({toProcess.length})
        </button>
        <button className="btn" disabled={toProcess.length === 0} style={{ opacity: toProcess.length === 0 ? 0.4 : 1 }} onClick={() => handleConfirm(false)}>
          ✓ Confirmar y generar ({toProcess.length})
        </button>
      </div>
    </div>
  );
}
