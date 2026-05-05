import { useMemo, useState } from "react";
import { useStore } from "../lib/context";
import { makeType, MONTHS, AVAILABLE_YEARS, fmt, compCurrency, compEmpresa, CUENTAS, CUENTA_LABEL, COMPANIES } from "../lib/helpers";
import { inPeriod, dateMonth, dateYear, todayDmy } from "../data/franchisor";
import { sendMailFr } from "../lib/sheetsApi";

// ── Pendientes panel ────────────────────────────────────────────────────────
export default function PendientesPanel({ onEmitir, onEmitirAfip, onEmitirPago, onFetchAfipNumero }) {
  const { franchises, comps, editComp, deleteComp, activeCompany, recordatorios, addRecordatorioEntry } = useStore();
  const [showAfip,       setShowAfip]       = useState(false);
  const [showSinNumero,  setShowSinNumero]  = useState(false);
  const [showSinAsignar, setShowSinAsignar] = useState(false);
  const [showPago,       setShowPago]       = useState(false);
  const [showFcRecibidas, setShowFcRecibidas] = useState(false);
  const [fetchingNumero, setFetchingNumero] = useState({}); // { [compId]: true }
  const [fetchNumeroErr, setFetchNumeroErr] = useState({}); // { [compId]: string }
  const [discardingId,   setDiscardingId]   = useState({}); // { [compId]: true }
  const [emitting, setEmitting] = useState({}); // { [compId]: true }
  const [errors,   setErrors]   = useState({}); // { [compId]: string }

  // Recordatorio "solicitud de factura" al franquiciado
  const [selectedSinAsignar,  setSelectedSinAsignar]  = useState(new Set()); // sinAsignar
  const [selectedFcRecibidas, setSelectedFcRecibidas] = useState(new Set()); // fcRecibidasPendientes
  const [sendingFcReminder,   setSendingFcReminder]   = useState(false);
  const [fcReminderResult,    setFcReminderResult]    = useState(null); // { ok: [], err: [] }

  // Registrar nro de factura recibida del franquiciado
  const [adjuntando, setAdjuntando] = useState({}); // { [compId]: true }
  const [adjuntarVal, setAdjuntarVal] = useState({}); // { [compId]: string }
  const [adjuntarErr, setAdjuntarErr] = useState({}); // { [compId]: string }

  const handleAbrirAdjuntar = (compId) => {
    setAdjuntando(p => ({ ...p, [compId]: true }));
    setAdjuntarVal(p => ({ ...p, [compId]: "" }));
    setAdjuntarErr(p => { const n = { ...p }; delete n[compId]; return n; });
  };

  const handleCerrarAdjuntar = (compId) => {
    setAdjuntando(p => { const n = { ...p }; delete n[compId]; return n; });
  };

  const handleConfirmAdjuntar = async (fr, comp) => {
    const val = (adjuntarVal[comp.id] ?? "").trim();
    if (!val) { setAdjuntarErr(p => ({ ...p, [comp.id]: "Ingresá el número de comprobante" })); return; }
    try {
      await editComp(fr.id, comp.id, { invoice: val });
      setAdjuntando(p => { const n = { ...p }; delete n[comp.id]; return n; });
    } catch (err) {
      setAdjuntarErr(p => ({ ...p, [comp.id]: err.message ?? "Error al guardar" }));
    }
  };

  // Emisión masiva (sinAfip)
  const [batchRunning, setBatchRunning]   = useState(false);
  const [batchProgress, setBatchProgress] = useState(null); // { done, total, ok, errors }
  const [batchDatePending, setBatchDatePending] = useState(false); // true = mostrando input de fecha
  const [batchDate, setBatchDate]         = useState(""); // yyyy-mm-dd (para input type=date)

  // Modal de referencias NC (NCA sin refInvoice)
  const [ncRefModal, setNcRefModal] = useState(null); // null | [{ fr, comp, refInvoice }]

  // Emisión masiva (pagos a cuenta)
  const [pagoBatchRunning, setPagoBatchRunning]   = useState(false);
  const [pagoBatchProgress, setPagoBatchProgress] = useState(null);
  const [pagoBatchDate, setPagoBatchDate]         = useState(""); // yyyy-mm-dd
  const [pagoPreviewQueue, setPagoPreviewQueue]   = useState(null); // null = no preview, array = mostrando preview
  const [pagoPreviewEdits, setPagoPreviewEdits]   = useState({});   // { [comp.id]: { cuenta, concepto } }

  const initPreview = (queue) => {
    const edits = {};
    queue.forEach(({ comp }) => {
      edits[comp.id] = {
        cuenta:   "PAUTA",
        concepto: `Pauta ${MONTHS[comp.month]} ${comp.year}`,
      };
    });
    setPagoPreviewEdits(edits);
    setPagoPreviewQueue(queue);
  };
  const setPreviewEdit = (compId, field, value) =>
    setPagoPreviewEdits(prev => ({ ...prev, [compId]: { ...prev[compId], [field]: value } }));

  // Filtro de período
  const [filterMonth, setFilterMonth] = useState(null);
  const [filterYear,  setFilterYear]  = useState(null);

  // Selección individual para emisión masiva (sinAfip)
  const [selectedIds, setSelectedIds] = useState(new Set()); // comp.ids seleccionados
  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Selección individual para pagos a cuenta
  const [selectedPagoIds, setSelectedPagoIds] = useState(new Set());
  const togglePagoSelect = (id) => setSelectedPagoIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleAllPagos = () => {
    if (selectedPagoIds.size === pagosSinFactura.length)
      setSelectedPagoIds(new Set());
    else
      setSelectedPagoIds(new Set(pagosSinFactura.map(({ comp }) => comp.id)));
  };

  // Filtro multi-sede
  const [filterFrIds, setFilterFrIds] = useState(new Set()); // vacío = todas
  const [frDropOpen,  setFrDropOpen]  = useState(false);

  const toggleFr = (id) => setFilterFrIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // FAs emitidas por sede (para el selector en modal NC ref), ordenadas por fecha desc
  const fasPerFr = useMemo(() => {
    const map = {};
    for (const [frId, frComps] of Object.entries(comps)) {
      const fas = (frComps ?? [])
        .filter(c => String(c.type ?? '').startsWith('FACTURA|') && c.invoice)
        .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
      if (fas.length > 0) map[frId] = fas;
    }
    return map;
  }, [comps]);

  // 1. Comprobantes AR+ARS sin facturanteId ni invoice
  const sinAfipAll = useMemo(() => {
    return franchises
      .filter(f => f.activa !== false && f.country === "Argentina")
      .flatMap(fr => {
        const frComps = comps[fr.id] ?? [];
        return frComps
          .filter(c => {
            const doc = String(c.type ?? "").split("|")[0];
            return (doc === "FACTURA" || doc === "NC") &&
                   compCurrency(c) === "ARS" &&
                   !c.facturanteId && !c.invoice &&
                   (!activeCompany || compEmpresa(c) === activeCompany);
          })
          .map(c => ({ fr, comp: c }));
      });
  }, [franchises, comps, activeCompany]);

  // 1b. Comprobantes AR+ARS con facturanteId pero sin invoice (número AFIP no obtenido)
  const sinNumeroAfip = useMemo(() => {
    return franchises
      .filter(f => f.activa !== false && f.country === "Argentina")
      .flatMap(fr => {
        const frComps = comps[fr.id] ?? [];
        return frComps
          .filter(c => {
            const doc = String(c.type ?? "").split("|")[0];
            return (doc === "FACTURA" || doc === "NC") &&
                   compCurrency(c) === "ARS" &&
                   c.facturanteId && !c.invoice &&
                   (!activeCompany || compEmpresa(c) === activeCompany);
          })
          .map(c => ({ fr, comp: c }));
      })
      .sort((a, b) => a.fr.name.localeCompare(b.fr.name, "es"));
  }, [franchises, comps, activeCompany]);

  const handleFetchNumero = async (fr, comp) => {
    if (fetchingNumero[comp.id] || !onFetchAfipNumero) return;
    setFetchingNumero(p => ({ ...p, [comp.id]: true }));
    setFetchNumeroErr(p => { const n = { ...p }; delete n[comp.id]; return n; });
    try {
      await onFetchAfipNumero(fr, comp);
    } catch (err) {
      setFetchNumeroErr(p => ({ ...p, [comp.id]: err.message ?? "Error" }));
    } finally {
      setFetchingNumero(p => { const n = { ...p }; delete n[comp.id]; return n; });
    }
  };

  // Descarta el facturanteId → el comp vuelve a "SIN EMISIÓN AFIP" para poder re-emitir
  const handleDescartarAfipId = async (fr, comp) => {
    if (discardingId[comp.id]) return;
    setDiscardingId(p => ({ ...p, [comp.id]: true }));
    try {
      await editComp(fr.id, comp.id, { facturanteId: null });
      setFetchNumeroErr(p => { const n = { ...p }; delete n[comp.id]; return n; });
    } finally {
      setDiscardingId(p => { const n = { ...p }; delete n[comp.id]; return n; });
    }
  };

  // Envía mail recordatorio a los franquiciados con facturas pendientes seleccionados
  const handleSendFcReminder = async (collection, selectedIds, clearSelection) => {
    if (!selectedIds.size || sendingFcReminder) return;
    setSendingFcReminder(true);
    setFcReminderResult(null);

    // Agrupar comps seleccionados por fr.id → un único mail por franquiciado
    const byFr = new Map();
    for (const { fr, comp } of collection) {
      if (!selectedIds.has(comp.id)) continue;
      if (!byFr.has(fr.id)) byFr.set(fr.id, { fr, comps: [] });
      byFr.get(fr.id).comps.push(comp);
    }

    const ok = [], err = [];
    for (const { fr, comps: frComps } of byFr.values()) {
      const to = fr.emailFactura ?? fr.emailComercial ?? "";
      if (!to) { err.push(`${fr.name} (sin email)`); continue; }

      const rows = frComps.map(c => {
        const cuenta = String(c.type ?? "").split("|")[1] ?? "";
        const cur    = compCurrency(c);
        const label  = CUENTA_LABEL[cuenta] ?? cuenta;
        const total  = c.amount ?? 0;
        const neto   = c.amountNeto != null ? c.amountNeto : Math.round(total / 1.21 * 100) / 100;
        const iva    = c.amountIVA  != null ? c.amountIVA  : Math.round((total - neto) * 100) / 100;
        return `<tr style="border-bottom:1px solid #e2e8f0">
          <td style="padding:10px 12px;white-space:nowrap">${c.date}</td>
          <td style="padding:10px 12px;font-weight:600">${label}</td>
          <td style="padding:10px 12px;text-align:right;font-family:monospace">${fmt(neto, cur)}</td>
          <td style="padding:10px 12px;text-align:right;font-family:monospace">${fmt(iva, cur)}</td>
          <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:700">${fmt(total, cur)}</td>
        </tr>`;
      }).join("");

      const htmlBody = `
        <div style="font-family:sans-serif;max-width:640px;margin:0 auto;color:#1e293b">
          <h2 style="margin-bottom:4px;font-size:18px">Solicitud de emisión de factura</h2>
          <p>Estimados,</p>
          <p>Les solicitamos la emisión de ${frComps.length === 1 ? "la siguiente factura" : "las siguientes facturas"} con los datos indicados a continuación. <strong>Es importante que utilicen la fecha de emisión indicada</strong> para que el comprobante quede con la fecha fiscal correcta.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
            <thead>
              <tr style="background:#f8fafc">
                <th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0">Fecha de emisión</th>
                <th style="padding:10px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0">Concepto</th>
                <th style="padding:10px 12px;text-align:right;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0">Neto</th>
                <th style="padding:10px 12px;text-align:right;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0">IVA (21%)</th>
                <th style="padding:10px 12px;text-align:right;font-weight:600;color:#475569;border-bottom:2px solid #e2e8f0">Total</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p>Una vez emitida, por favor envíen el número de comprobante a la brevedad.</p>
        </div>`;

      try {
        await sendMailFr({ to, subject: `Solicitud de factura — ${fr.name}`, htmlBody });
        addRecordatorioEntry(fr.id, {
          frName: fr.name,
          tipo: "solicitud_factura",
          fecha: todayDmy(),
          to,
          status: "ok",
          compIds: frComps.map(c => c.id),
        });
        ok.push(fr.name);
      } catch (e) {
        const msg = e.message ?? "Error";
        addRecordatorioEntry(fr.id, {
          frName: fr.name,
          tipo: "solicitud_factura",
          fecha: todayDmy(),
          to,
          status: "error",
          error: msg,
          compIds: frComps.map(c => c.id),
        });
        err.push(`${fr.name} (${msg})`);
      }
    }

    clearSelection(new Set());
    setSendingFcReminder(false);
    setFcReminderResult({ ok, err });
  };

  // Sedes únicas presentes en sinAfipAll (para el dropdown)
  const frOptions = useMemo(() => {
    const seen = new Map();
    for (const { fr } of sinAfipAll) if (!seen.has(fr.id)) seen.set(fr.id, fr);
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [sinAfipAll]);

  const sinAfip = useMemo(() => {
    let filtered = sinAfipAll;
    if (filterFrIds.size > 0)           filtered = filtered.filter(({ fr }) => filterFrIds.has(fr.id));
    if (filterMonth != null || filterYear != null) {
      filtered = filtered.filter(({ comp }) => {
        const m = dateMonth(comp.date);
        const y = dateYear(comp.date);
        if (filterMonth != null && filterYear != null) return m === filterMonth && y === filterYear;
        if (filterMonth != null) return m === filterMonth;
        return y === filterYear;
      });
    }
    return [...filtered].sort((a, b) => {
      const ta = String(a.comp.type ?? "");
      const tb = String(b.comp.type ?? "");
      if (ta !== tb) return ta.localeCompare(tb, "es");
      return a.fr.name.localeCompare(b.fr.name, "es");
    });
  }, [sinAfipAll, filterFrIds, filterMonth, filterYear]);

  // 2. Comprobantes marcados "Sin asignar"
  const sinAsignar = useMemo(() => {
    return franchises
      .filter(f => f.activa !== false)
      .flatMap(fr => {
        const frComps = comps[fr.id] ?? [];
        return frComps
          .filter(c => c.invoice === "Sin asignar" &&
                       (!activeCompany || compEmpresa(c) === activeCompany))
          .map(c => ({ fr, comp: c }));
      })
      .sort((a, b) => a.fr.name.localeCompare(b.fr.name, "es"));
  }, [franchises, comps, activeCompany]);

  // 3. Pagos a cuenta sin factura de pauta
  const pagosSinFactura = useMemo(() => {
    return franchises.filter(f => f.activa !== false).flatMap(fr => {
      const frComps = comps[fr.id] ?? [];
      return frComps
        .filter(c => c.type === "PAGO_PAUTA" &&
                     (!activeCompany || compEmpresa(c) === activeCompany))
        .filter(c => {
          const hasFact = frComps.some(f2 =>
            f2.type === makeType("FACTURA","PAUTA") &&
            inPeriod(f2, dateMonth(c.date), dateYear(c.date)) &&
            (!activeCompany || compEmpresa(f2) === activeCompany)
          );
          return !hasFact;
        })
        .map(c => ({ fr, comp: c }));
    });
  }, [franchises, comps, activeCompany]);

  // 4. FC Recibidas pendientes de recibir factura (sin invoice)
  const fcRecibidasPendientes = useMemo(() => {
    return franchises.filter(f => f.activa !== false).flatMap(fr => {
      const frComps = comps[fr.id] ?? [];
      return frComps
        .filter(c => {
          const doc = String(c.type ?? "").split("|")[0];
          return doc === "FC_RECIBIDA" &&
                 !c.invoice &&
                 (!activeCompany || compEmpresa(c) === activeCompany);
        })
        .map(c => ({ fr, comp: c }));
    }).sort((a, b) => a.fr.name.localeCompare(b.fr.name, "es"));
  }, [franchises, comps, activeCompany]);

  // ── Emitir individual ──
  const handleEmitAfip = async (fr, comp) => {
    if (emitting[comp.id] || batchRunning) return;
    setEmitting(p => ({ ...p, [comp.id]: true }));
    setErrors(p => { const n = { ...p }; delete n[comp.id]; return n; });
    try {
      const dateOverride = batchDate ? toAR(batchDate) : null;
      await onEmitirAfip(fr, comp, dateOverride);
    } catch (err) {
      setErrors(p => ({ ...p, [comp.id]: err.message ?? "Error AFIP" }));
    } finally {
      setEmitting(p => { const n = { ...p }; delete n[comp.id]; return n; });
    }
  };

  // ── Emisión masiva ──
  // Si hay seleccionados, emitir solo esos; si no, todos los visibles
  const toEmit = selectedIds.size > 0
    ? sinAfip.filter(({ comp }) => selectedIds.has(comp.id))
    : sinAfip;

  // Convierte yyyy-mm-dd → dd/mm/yyyy
  const toAR = (isoDate) => isoDate ? `${isoDate.slice(8,10)}/${isoDate.slice(5,7)}/${isoDate.slice(0,4)}` : null;

  const handleBatch = async () => {
    if (batchRunning || toEmit.length === 0) return;

    // NCA sin refInvoice: AFIP rechaza — abrir modal para completar referencias
    const ncSinRef = toEmit.filter(({ fr, comp }) =>
      String(comp.type ?? '').startsWith('NC') && fr.applyIVA === true && !comp.refInvoice
    );
    if (ncSinRef.length > 0) {
      setNcRefModal(ncSinRef.map(({ fr, comp }) => {
        const ultima = fasPerFr[fr.id]?.[0];
        return { fr, comp, refInvoice: ultima?.invoice ?? '', refDate: ultima?.date ?? '' };
      }));
      return;
    }

    await runBatch(toEmit);
  };

  const handleConfirmNcRefs = async () => {
    if (!ncRefModal) return;
    // Guardar refInvoice en Sheets para cada NC y actualizar el comp local
    const updatedToEmit = toEmit.map(({ fr, comp }) => {
      const row = ncRefModal.find(r => r.comp.id === comp.id);
      if (!row) return { fr, comp };
      editComp(fr.id, comp.id, { refInvoice: row.refInvoice, refDate: row.refDate });
      return { fr, comp: { ...comp, refInvoice: row.refInvoice, refDate: row.refDate } };
    });
    setNcRefModal(null);
    await runBatch(updatedToEmit);
  };

  const runBatch = async (queue) => {
    setBatchRunning(true);
    setBatchDatePending(false);
    setErrors({});
    const dateOverride = batchDate ? toAR(batchDate) : null;
    const total = queue.length;
    let done = 0, ok = 0;
    const batchErrors = [];
    setBatchProgress({ done: 0, total, ok: 0, errors: [] });

    for (const { fr, comp } of queue) {
      try {
        await onEmitirAfip(fr, comp, dateOverride);
        ok++;
      } catch (err) {
        batchErrors.push({ fr, comp, msg: err.message ?? "Error AFIP" });
      }
      done++;
      setBatchProgress({ done, total, ok, errors: [...batchErrors] });
      if (done < total) await new Promise(r => setTimeout(r, 600));
    }

    setBatchRunning(false);
  };

  const handlePagoBatch = async (retryList = null) => {
    if (pagoBatchRunning || !onEmitirPago) return;
    const queue = retryList
      ?? (selectedPagoIds.size > 0
          ? pagosSinFactura.filter(({ comp }) => selectedPagoIds.has(comp.id))
          : pagosSinFactura);
    if (queue.length === 0) return;
    setPagoBatchRunning(true);
    const total = queue.length;
    let done = 0, ok = 0;
    const batchErrors = [];
    setPagoBatchProgress({ done: 0, total, ok: 0, errors: [] });

    for (const { fr, comp } of queue) {
      try {
        await onEmitirPago(fr, comp);
        ok++;
      } catch (err) {
        batchErrors.push({ fr, comp, msg: err.message ?? "Error AFIP" });
      }
      done++;
      setPagoBatchProgress({ done, total, ok, errors: [...batchErrors] });
      if (done < total) await new Promise(r => setTimeout(r, 600));
    }

    setPagoBatchRunning(false);
    setSelectedPagoIds(new Set());
  };

  if (sinAfipAll.length === 0 && sinAsignar.length === 0 && pagosSinFactura.length === 0 && fcRecibidasPendientes.length === 0) return null;

  const selS = { background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)", borderRadius: 6, padding: "4px 8px", fontSize: 11, fontFamily: "var(--font)", cursor: "pointer" };
  const thS  = { fontSize: 10, fontWeight: 700, color: "var(--muted)", padding: "6px 10px", letterSpacing: ".04em", textAlign: "left", borderBottom: "1px solid var(--border)" };
  const tdS  = { fontSize: 12, padding: "7px 10px", borderBottom: "1px solid rgba(255,255,255,.04)" };

  const batchDone = batchProgress && !batchRunning;

  // frId → todos los envíos "solicitud_factura" (para mostrar un dot por envío)
  const fcReminderSent = useMemo(() => {
    const m = new Map();
    for (const { fr } of [...sinAsignar, ...fcRecibidasPendientes]) {
      if (m.has(fr.id)) continue;
      const entries = (recordatorios[String(fr.id)] ?? []).filter(r => r.tipo === "solicitud_factura");
      if (entries.length) m.set(fr.id, entries);
    }
    return m;
  }, [sinAsignar, fcRecibidasPendientes, recordatorios]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>

      {/* ── Modal: referencias NC ── */}
      {ncRefModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, padding: "24px 28px", minWidth: 520, maxWidth: 680, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,.5)" }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Notas de Crédito — FA asociada</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 18 }}>
              AFIP requiere referenciar la factura original de cada NC. Se sugiere la última FA emitida por sede.
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "5px 8px", fontSize: 10, fontWeight: 700, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>Sede</th>
                  <th style={{ textAlign: "left", padding: "5px 8px", fontSize: 10, fontWeight: 700, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>NC</th>
                  <th style={{ textAlign: "left", padding: "5px 8px", fontSize: 10, fontWeight: 700, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>FA referenciada</th>
                </tr>
              </thead>
              <tbody>
                {ncRefModal.map((row, i) => (
                  <tr key={row.comp.id} style={{ borderBottom: "1px solid rgba(255,255,255,.04)" }}>
                    <td style={{ padding: "8px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>{row.fr.name}</td>
                    <td style={{ padding: "8px 8px", color: "var(--red)", fontWeight: 700, whiteSpace: "nowrap" }} className="mono">
                      −{fmt(row.comp.amount, "ARS")}
                    </td>
                    <td style={{ padding: "8px 8px" }}>
                      <select
                        value={row.refInvoice}
                        onChange={e => {
                          const fa = (fasPerFr[row.fr.id] ?? []).find(f => f.invoice === e.target.value);
                          setNcRefModal(prev => prev.map((r, ri) => ri === i
                            ? { ...r, refInvoice: e.target.value, refDate: fa?.date ?? r.refDate }
                            : r));
                        }}
                        style={{ width: "100%", padding: "4px 8px", borderRadius: 6, fontSize: 11, background: "var(--bg)", border: `1px solid ${row.refInvoice ? "var(--border2)" : "var(--red)"}`, color: "var(--text)", fontFamily: "var(--font)", cursor: "pointer" }}
                      >
                        <option value="">— Seleccionar FA —</option>
                        {(fasPerFr[row.fr.id] ?? []).map(fa => {
                          const cuenta = String(fa.type ?? '').split('|')[1] ?? '';
                          const importe = fmt(fa.amount, 'ARS');
                          return (
                            <option key={fa.id} value={fa.invoice}>
                              {fa.invoice} — {fa.date} — {cuenta} — {importe}
                            </option>
                          );
                        })}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button className="ghost" onClick={() => setNcRefModal(null)}>Cancelar</button>
              <button
                className="btn"
                disabled={ncRefModal.some(r => !r.refInvoice.trim())}
                style={{ opacity: ncRefModal.some(r => !r.refInvoice.trim()) ? 0.4 : 1 }}
                onClick={handleConfirmNcRefs}
              >
                ⚡ Confirmar y emitir {toEmit.length} documento{toEmit.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SIN EMISIÓN AFIP ── */}
      {sinAfipAll.length > 0 && (
        <div style={{ background: "rgba(255,107,122,.04)", border: "1px solid rgba(255,107,122,.22)", borderRadius: 10, padding: "14px 18px" }}>

          {/* Header — título + toggle */}
          <div
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: showAfip ? 10 : 0 }}
            onClick={() => setShowAfip(v => !v)}
          >
            <span style={{ fontSize: 10, fontWeight: 800, color: "var(--red)", letterSpacing: ".1em", flex: 1 }}>
              ⚡ SIN EMISIÓN AFIP — {sinAfip.length}{sinAfip.length !== sinAfipAll.length ? `/${sinAfipAll.length}` : ""} comprobante{sinAfipAll.length !== 1 ? "s" : ""}
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{showAfip ? "▲" : "▼"}</span>
          </div>

          {/* Controles — solo visibles cuando está desplegado */}
          {showAfip && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              {/* Filtro período */}
              <select value={filterMonth ?? ""} onChange={e => { setFilterMonth(e.target.value === "" ? null : parseInt(e.target.value)); setBatchProgress(null); }} style={selS} disabled={batchRunning}>
                <option value="">Todos los meses</option>
                {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select>
              <select value={filterYear ?? ""} onChange={e => { setFilterYear(e.target.value === "" ? null : parseInt(e.target.value)); setBatchProgress(null); }} style={{ ...selS, width: 72 }} disabled={batchRunning}>
                <option value="">Todos</option>
                {AVAILABLE_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              {(filterMonth != null || filterYear != null) && !batchRunning && (
                <button onClick={() => { setFilterMonth(null); setFilterYear(null); setBatchProgress(null); }} style={{ ...selS, color: "var(--muted)", padding: "4px 6px" }}>✕</button>
              )}

              {/* Filtro multi-sede */}
              <div style={{ position: "relative" }}>
                <button
                  style={{ ...selS, color: filterFrIds.size > 0 ? "var(--cyan)" : "var(--muted)", borderColor: filterFrIds.size > 0 ? "rgba(34,211,238,.4)" : undefined }}
                  disabled={batchRunning}
                  onClick={() => setFrDropOpen(v => !v)}
                >
                  {filterFrIds.size === 0 ? "Todas las sedes" : `${filterFrIds.size} sede${filterFrIds.size !== 1 ? "s" : ""}`} ▾
                </button>
                {frDropOpen && (
                  <div
                    style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 8, padding: "6px 0", minWidth: 200, maxHeight: 240, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,.4)" }}
                    onMouseLeave={() => setFrDropOpen(false)}
                  >
                    {filterFrIds.size > 0 && (
                      <button
                        onClick={() => { setFilterFrIds(new Set()); setFrDropOpen(false); }}
                        style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "5px 12px", fontSize: 11, color: "var(--muted)", cursor: "pointer" }}
                      >
                        ✕ Limpiar selección
                      </button>
                    )}
                    {frOptions.map(fr => (
                      <label key={fr.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, color: filterFrIds.has(fr.id) ? "var(--cyan)" : "var(--text)" }}>
                        <input
                          type="checkbox"
                          checked={filterFrIds.has(fr.id)}
                          onChange={() => toggleFr(fr.id)}
                          style={{ accentColor: "var(--cyan)", cursor: "pointer" }}
                        />
                        {fr.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ flex: 1 }} />

              {/* Fecha emisión ARCA */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: "var(--red)", letterSpacing: ".06em", whiteSpace: "nowrap" }}>Fecha ARCA:</label>
                <input type="date" value={batchDate} onChange={e => setBatchDate(e.target.value)}
                  style={{ background: "var(--bg)", border: `1px solid ${batchDate ? "var(--green)" : "var(--red)"}`, color: "var(--text)", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontFamily: "var(--font)" }} />
              </div>

              {/* Botón emisión masiva */}
              {!batchRunning && !batchDone && toEmit.length > 0 && (
                <button
                  className="btn"
                  style={{ fontSize: 11, padding: "4px 14px", background: "rgba(255,107,122,.18)", color: "var(--red)", border: "1px solid rgba(255,107,122,.35)", opacity: batchDate ? 1 : 0.4 }}
                  disabled={!batchDate}
                  onClick={handleBatch}
                >
                  ⚡ Emitir {toEmit.length} documento{toEmit.length !== 1 ? "s" : ""}
                </button>
              )}
              {batchDone && (
                <button className="ghost" style={{ fontSize: 10, padding: "3px 10px" }} onClick={() => setBatchProgress(null)}>
                  ✕ Cerrar resumen
                </button>
              )}
            </div>
          )}

          {/* Barra de progreso batch */}
          {showAfip && batchProgress && (
            <div style={{ marginBottom: 12 }}>
              {/* Barra */}
              <div style={{ height: 4, borderRadius: 2, background: "var(--border2)", marginBottom: 8, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 2,
                  background: batchDone ? (batchProgress.errors.length === 0 ? "var(--green)" : "var(--gold)") : "var(--red)",
                  width: `${(batchProgress.done / batchProgress.total) * 100}%`,
                  transition: "width .3s",
                }} />
              </div>
              {/* Resumen */}
              <div style={{ display: "flex", gap: 16, fontSize: 11, alignItems: "center" }}>
                <span style={{ color: "var(--muted)" }}>
                  {batchRunning ? `Emitiendo ${batchProgress.done}/${batchProgress.total}…` : `Completado ${batchProgress.done}/${batchProgress.total}`}
                </span>
                {batchProgress.ok > 0 && <span style={{ color: "var(--green)", fontWeight: 700 }}>✓ {batchProgress.ok} ok</span>}
                {batchProgress.errors.length > 0 && <span style={{ color: "var(--red)", fontWeight: 700 }}>✕ {batchProgress.errors.length} error{batchProgress.errors.length !== 1 ? "es" : ""}</span>}
              </div>
              {/* Detalle de errores */}
              {batchDone && batchProgress.errors.length > 0 && (
                <div style={{ marginTop: 8, border: "1px solid rgba(255,107,122,.2)", borderRadius: 7, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>
                      <th style={thS}>Sede</th>
                      <th style={thS}>Tipo</th>
                      <th style={thS}>Error</th>
                    </tr></thead>
                    <tbody>
                      {batchProgress.errors.map(({ fr, comp, msg }, i) => (
                        <tr key={i}>
                          <td style={tdS}>{fr.name}</td>
                          <td style={{ ...tdS, fontSize: 10 }}>{comp.type}</td>
                          <td style={{ ...tdS, fontSize: 10, color: "var(--red)" }}>{msg}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Lista */}
          {showAfip && !batchRunning && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 420, overflowY: "auto" }}>
              {sinAfip.length === 0 && (
                <div style={{ color: "var(--muted)", fontSize: 12, padding: "8px 0" }}>Sin pendientes para el período seleccionado.</div>
              )}
              {sinAfip.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px 4px" }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size > 0 && sinAfip.every(({ comp }) => selectedIds.has(comp.id))}
                    ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && !sinAfip.every(({ comp }) => selectedIds.has(comp.id)); }}
                    onChange={() => {
                      const allSelected = sinAfip.every(({ comp }) => selectedIds.has(comp.id));
                      setSelectedIds(allSelected ? new Set() : new Set(sinAfip.map(({ comp }) => comp.id)));
                    }}
                    style={{ accentColor: "var(--red)", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>
                    {selectedIds.size === 0 ? "Seleccionar todos" : `${selectedIds.size} seleccionado${selectedIds.size !== 1 ? "s" : ""}`}
                  </span>
                  {selectedIds.size > 0 && (
                    <button onClick={() => setSelectedIds(new Set())} style={{ fontSize: 10, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>✕ limpiar</button>
                  )}
                </div>
              )}
              {sinAfip.map(({ fr, comp }) => {
                const doc      = String(comp.type ?? "").split("|")[0];
                const cuenta   = String(comp.type ?? "").split("|")[1] ?? "";
                const isNC     = doc === "NC";
                const busy     = !!emitting[comp.id];
                const err      = errors[comp.id];
                const openAdj  = !!adjuntando[comp.id];
                const adjErr   = adjuntarErr[comp.id];
                const hasErr   = err || adjErr;
                const selected = selectedIds.has(comp.id);
                return (
                  <div key={comp.id}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, background: selected ? "rgba(255,107,122,.08)" : "var(--bg2)", borderRadius: hasErr ? "7px 7px 0 0" : openAdj ? "7px 7px 0 0" : 7, padding: "8px 12px", flexWrap: "wrap", outline: selected ? "1px solid rgba(255,107,122,.25)" : "none" }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelect(comp.id)}
                        style={{ accentColor: "var(--red)", cursor: "pointer", flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 12, fontWeight: 700, flex: 1, minWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fr.name}</span>
                      <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>{comp.date}</span>
                      <span className="mono" style={{ fontSize: 12, color: isNC ? "var(--red)" : "var(--green)", fontWeight: 700, whiteSpace: "nowrap" }}>
                        {isNC ? "−" : ""}{fmt(comp.amount, "ARS")}
                      </span>
                      <span className="pill" style={{ color: isNC ? "var(--red)" : "var(--cyan)", background: isNC ? "rgba(255,107,122,.1)" : "rgba(34,211,238,.1)", fontSize: 9, whiteSpace: "nowrap" }}>
                        {doc} {cuenta}
                      </span>
                      {isNC ? (
                        <button
                          className="ghost"
                          disabled={busy}
                          style={{ fontSize: 10, padding: "2px 8px", color: busy ? "var(--muted)" : "var(--red)", whiteSpace: "nowrap", opacity: busy ? 0.4 : 1 }}
                          onClick={() => handleEmitAfip(fr, comp)}
                        >
                          {busy ? "⏳…" : "Emitir AFIP →"}
                        </button>
                      ) : (
                        <button
                          className="ghost"
                          disabled={busy}
                          style={{ fontSize: 10, padding: "2px 8px", color: busy ? "var(--muted)" : "var(--red)", whiteSpace: "nowrap", opacity: busy ? 0.6 : 1 }}
                          onClick={() => handleEmitAfip(fr, comp)}
                        >
                          {busy ? "⏳ Emitiendo…" : "Emitir →"}
                        </button>
                      )}
                    </div>
                    {/* Input adjuntar inline */}
                    {openAdj && (
                      <div style={{ background: "rgba(34,211,238,.05)", border: "1px solid rgba(34,211,238,.2)", borderTop: "none", borderRadius: adjErr ? 0 : "0 0 7px 7px", padding: "8px 12px", display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>Nro. factura franquiciado:</span>
                        <input
                          autoFocus
                          value={adjuntarVal[comp.id] ?? ""}
                          onChange={e => setAdjuntarVal(p => ({ ...p, [comp.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === "Enter") handleConfirmAdjuntar(fr, comp); if (e.key === "Escape") handleCerrarAdjuntar(comp.id); }}
                          placeholder="Nro. de factura del franquiciado"
                          style={{ flex: 1, background: "var(--bg)", border: "1px solid var(--border2)", borderRadius: 5, padding: "4px 8px", fontSize: 12, color: "var(--text)", fontFamily: "var(--font)" }}
                        />
                        <button
                          className="btn"
                          style={{ fontSize: 11, padding: "3px 12px", background: "rgba(34,211,238,.15)", color: "var(--cyan)", border: "1px solid rgba(34,211,238,.3)" }}
                          onClick={() => handleConfirmAdjuntar(fr, comp)}
                        >
                          Guardar
                        </button>
                      </div>
                    )}
                    {adjErr && (
                      <div style={{ background: "rgba(255,107,122,.08)", border: "1px solid rgba(255,107,122,.2)", borderTop: "none", borderRadius: "0 0 7px 7px", padding: "6px 12px", fontSize: 11, color: "var(--red)" }}>
                        ✕ {adjErr}
                      </div>
                    )}
                    {err && (
                      <div style={{ background: "rgba(255,107,122,.08)", border: "1px solid rgba(255,107,122,.2)", borderTop: "none", borderRadius: "0 0 7px 7px", padding: "6px 12px", fontSize: 11, color: "var(--red)" }}>
                        ✕ {err}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Durante batch: ocultar lista y mostrar spinner central */}
          {batchRunning && (
            <div style={{ textAlign: "center", padding: "20px 0", color: "var(--muted)", fontSize: 12 }}>
              Emitiendo comprobante {batchProgress?.done + 1} de {batchProgress?.total}…
            </div>
          )}
        </div>
      )}

      {/* ── NÚMERO AFIP PENDIENTE ── */}
      {sinNumeroAfip.length > 0 && (
        <div style={{ background: "rgba(251,191,36,.04)", border: "1px solid rgba(251,191,36,.30)", borderRadius: 10, padding: "14px 18px" }}>
          <div
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: showSinNumero ? 10 : 0 }}
            onClick={() => setShowSinNumero(v => !v)}
          >
            <span style={{ fontSize: 10, fontWeight: 800, color: "#fbbf24", letterSpacing: ".1em", flex: 1 }}>
              ⏳ NÚMERO AFIP PENDIENTE — {sinNumeroAfip.length} comprobante{sinNumeroAfip.length !== 1 ? "s" : ""}
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{showSinNumero ? "▲" : "▼"}</span>
          </div>
          {showSinNumero && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sinNumeroAfip.map(({ fr, comp }) => {
                const doc    = String(comp.type ?? "").split("|")[0];
                const cuenta = String(comp.type ?? "").split("|")[1] ?? "";
                const busy        = !!fetchingNumero[comp.id];
                const discarding  = !!discardingId[comp.id];
                const err         = fetchNumeroErr[comp.id];
                const hasFooter   = !!err;
                return (
                  <div key={comp.id}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg2)", borderRadius: hasFooter ? "7px 7px 0 0" : 7, padding: "8px 12px" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fr.name}</span>
                      <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>{comp.date}</span>
                      <span className="mono" style={{ fontSize: 12, color: "var(--green)", fontWeight: 700, whiteSpace: "nowrap" }}>{fmt(comp.amount, "ARS")}</span>
                      <span className="pill" style={{ color: "var(--cyan)", background: "rgba(34,211,238,.1)", fontSize: 9, whiteSpace: "nowrap" }}>{doc} {cuenta}</span>
                      <span style={{ fontSize: 9, color: "#fbbf24", fontStyle: "italic", whiteSpace: "nowrap" }}>ID {comp.facturanteId}</span>
                      <button
                        className="ghost"
                        disabled={busy || discarding}
                        style={{ fontSize: 10, padding: "2px 8px", whiteSpace: "nowrap", opacity: (busy || discarding) ? 0.4 : 1 }}
                        onClick={() => handleFetchNumero(fr, comp)}
                      >
                        {busy ? "⏳…" : "Obtener nro. AFIP →"}
                      </button>
                      <button
                        className="ghost"
                        disabled={busy || discarding}
                        title="Descartar el ID de Facturante y mover a Sin emisión AFIP para re-emitir"
                        style={{ fontSize: 10, padding: "2px 8px", whiteSpace: "nowrap", opacity: (busy || discarding) ? 0.4 : 1, color: "var(--red)" }}
                        onClick={() => handleDescartarAfipId(fr, comp)}
                      >
                        {discarding ? "⏳…" : "↩ Sin AFIP"}
                      </button>
                    </div>
                    {err && (
                      <div style={{ background: "rgba(255,107,122,.08)", borderRadius: "0 0 7px 7px", padding: "4px 12px", fontSize: 10, color: "var(--red)" }}>{err}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── FACTURAS PENDIENTES DE FRANQUICIADO ── */}
      {sinAsignar.length > 0 && (
        <div style={{ background: "rgba(96,165,250,.04)", border: "1px solid rgba(96,165,250,.22)", borderRadius: 10, padding: "14px 18px" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: showSinAsignar ? 10 : 0 }}>
            <input
              type="checkbox"
              style={{ cursor: "pointer", flexShrink: 0 }}
              checked={selectedSinAsignar.size === sinAsignar.length && sinAsignar.length > 0}
              onChange={e => setSelectedSinAsignar(e.target.checked ? new Set(sinAsignar.map(x => x.comp.id)) : new Set())}
              onClick={e => e.stopPropagation()}
            />
            <span
              style={{ fontSize: 10, fontWeight: 800, color: "var(--blue)", letterSpacing: ".1em", flex: 1, cursor: "pointer" }}
              onClick={() => setShowSinAsignar(v => !v)}
            >
              📥 PENDIENTES DE RECIBIR FACTURA — {sinAsignar.length} comprobante{sinAsignar.length !== 1 ? "s" : ""}
            </span>
            {selectedSinAsignar.size > 0 && (
              <button
                className="ghost"
                disabled={sendingFcReminder}
                style={{ fontSize: 10, padding: "2px 10px", whiteSpace: "nowrap", color: "var(--blue)", opacity: sendingFcReminder ? 0.5 : 1 }}
                onClick={e => { e.stopPropagation(); handleSendFcReminder(sinAsignar, selectedSinAsignar, setSelectedSinAsignar); }}
              >
                {sendingFcReminder ? "Enviando…" : `✉ Recordatorio (${selectedSinAsignar.size})`}
              </button>
            )}
            <span style={{ fontSize: 11, color: "var(--muted)", cursor: "pointer" }} onClick={() => setShowSinAsignar(v => !v)}>
              {showSinAsignar ? "▲" : "▼"}
            </span>
          </div>
          {/* Resultado del envío */}
          {fcReminderResult && (
            <div style={{ fontSize: 11, padding: "2px 0 8px", color: fcReminderResult.err.length && !fcReminderResult.ok.length ? "var(--red)" : "var(--green)" }}>
              {fcReminderResult.ok.length > 0 && `✓ Enviado a: ${fcReminderResult.ok.join(", ")}. `}
              {fcReminderResult.err.length > 0 && <span style={{ color: "var(--red)" }}>✕ Error: {fcReminderResult.err.join(", ")}</span>}
            </div>
          )}
          {showSinAsignar && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sinAsignar.map(({ fr, comp }) => {
                const doc    = String(comp.type ?? "").split("|")[0];
                const cuenta = String(comp.type ?? "").split("|")[1] ?? "";
                const sent   = fcReminderSent.get(fr.id);
                return (
                  <div key={comp.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg2)", borderRadius: 7, padding: "8px 12px" }}>
                    <input
                      type="checkbox"
                      style={{ cursor: "pointer", flexShrink: 0 }}
                      checked={selectedSinAsignar.has(comp.id)}
                      onChange={() => setSelectedSinAsignar(prev => {
                        const next = new Set(prev);
                        next.has(comp.id) ? next.delete(comp.id) : next.add(comp.id);
                        return next;
                      })}
                    />
                    <span style={{ fontSize: 12, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
                      {fr.name}
                      {sent && (
                        <span
                          title={`Recordatorio enviado el ${sent.fecha}${sent.status === "error" ? ` — Error: ${sent.error}` : ""}`}
                          style={{
                            width: 7, height: 7, borderRadius: "50%", flexShrink: 0, display: "inline-block",
                            background: sent.status === "error" ? "#ef4444" : "#60a5fa",
                            boxShadow: sent.status === "error" ? "0 0 5px #ef4444" : "0 0 5px #60a5fa",
                          }}
                        />
                      )}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>{comp.date}</span>
                    <span className="mono" style={{ fontSize: 12, color: "var(--blue)", fontWeight: 700, whiteSpace: "nowrap" }}>{fmt(comp.amount, compCurrency(comp))}</span>
                    <span className="pill" style={{ color: "var(--blue)", background: "rgba(96,165,250,.1)", fontSize: 9, whiteSpace: "nowrap" }}>
                      {doc} {cuenta}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic", whiteSpace: "nowrap" }}>Sin factura recibida</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── PAGOS A CUENTA SIN FACTURA ── */}
      {pagosSinFactura.length > 0 && (
        <div style={{ background: "rgba(222,251,151,.04)", border: "1px solid rgba(222,251,151,.2)", borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: showPago ? 10 : 0 }}>
            <span
              style={{ fontSize: 10, fontWeight: 800, color: "var(--gold)", letterSpacing: ".1em", flex: 1, cursor: "pointer" }}
              onClick={() => setShowPago(v => !v)}
            >
              ⚠ PAGOS A CUENTA SIN FACTURA — {pagosSinFactura.length} pendiente{pagosSinFactura.length !== 1 ? "s" : ""}
            </span>
            {!pagoBatchRunning && !pagoBatchProgress && !pagoPreviewQueue && onEmitirPago && (
              <button
                className="btn"
                style={{ fontSize: 11, padding: "4px 14px", background: "rgba(222,251,151,.18)", color: "var(--gold)", border: "1px solid rgba(222,251,151,.35)" }}
                onClick={() => {
                  const queue = selectedPagoIds.size > 0
                    ? pagosSinFactura.filter(({ comp }) => selectedPagoIds.has(comp.id))
                    : pagosSinFactura;
                  initPreview(queue);
                  setPagoBatchDate("");
                  setShowPago(true);
                }}
              >
                ⚡ Emitir {selectedPagoIds.size > 0 ? selectedPagoIds.size : pagosSinFactura.length} documento{(selectedPagoIds.size || pagosSinFactura.length) !== 1 ? "s" : ""}
              </button>
            )}
            {pagoBatchProgress && (
              <span style={{ fontSize: 10, color: "var(--text2)" }}>
                {pagoBatchRunning
                  ? `Emitiendo… ${pagoBatchProgress.done}/${pagoBatchProgress.total}`
                  : `✓ ${pagoBatchProgress.ok}/${pagoBatchProgress.total}${pagoBatchProgress.errors.length ? ` — ${pagoBatchProgress.errors.length} error${pagoBatchProgress.errors.length !== 1 ? "es" : ""}` : ""}`}
              </span>
            )}
            {pagoBatchProgress && !pagoBatchRunning && pagoBatchProgress.errors.length > 0 && (
              <button
                className="ghost"
                style={{ fontSize: 10, padding: "3px 10px", color: "var(--red)" }}
                onClick={() => initPreview(pagoBatchProgress.errors.map(e => ({ fr: e.fr, comp: e.comp })))}
              >
                ↺ Reintentar {pagoBatchProgress.errors.length} fallido{pagoBatchProgress.errors.length !== 1 ? "s" : ""}
              </button>
            )}
            {pagoBatchProgress && !pagoBatchRunning && (
              <button className="ghost" style={{ fontSize: 10, padding: "3px 10px" }} onClick={() => { setPagoBatchProgress(null); setSelectedPagoIds(new Set()); }}>✕ Cerrar</button>
            )}
            <span style={{ fontSize: 11, color: "var(--muted)", cursor: "pointer" }} onClick={() => setShowPago(v => !v)}>
              {showPago ? "▲" : "▼"}
            </span>
          </div>
          {showPago && pagoPreviewQueue && (
            <div style={{ background: "rgba(0,0,0,.25)", borderRadius: 8, padding: "14px 16px", marginBottom: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 12, color: "var(--gold)", marginBottom: 10 }}>
                ⚡ Revisión previa — {pagoPreviewQueue.length} factura{pagoPreviewQueue.length !== 1 ? "s" : ""} a emitir
              </div>
              {/* Tabla */}
              <div style={{ display: "grid", gridTemplateColumns: "auto auto 130px 1fr auto auto auto", gap: "4px 10px", alignItems: "center", marginBottom: 10 }}>
                {/* Header */}
                {["SEDE", "PERÍODO", "CUENTA", "DESCRIPCIÓN", "NETO S/IVA", "IVA 21%", "TOTAL"].map(h => (
                  <span key={h} style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700, letterSpacing: ".08em" }}>{h}</span>
                ))}
                {/* Rows */}
                {pagoPreviewQueue.map(({ fr, comp }, i) => {
                  const applyIVA = !!(COMPANIES[activeCompany]?.applyIVA);
                  const total    = comp.amount;
                  const neto     = applyIVA ? Math.round(total / 1.21 * 100) / 100 : total;
                  const iva      = applyIVA ? Math.round((total - neto) * 100) / 100 : 0;
                  const cur      = compCurrency(comp);
                  const edit     = pagoPreviewEdits[comp.id] ?? {};
                  const inpS     = { background: "var(--bg)", border: "1px solid var(--border2)", color: "var(--text)", borderRadius: 5, padding: "3px 7px", fontSize: 11, fontFamily: "var(--font)" };
                  return [
                    <span key={`n${i}`}  style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{fr.name}</span>,
                    <span key={`p${i}`}  style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{MONTHS[comp.month]} {comp.year}</span>,
                    <select key={`c${i}`} value={edit.cuenta ?? "PAUTA"} onChange={e => setPreviewEdit(comp.id, "cuenta", e.target.value)} style={{ ...inpS, cursor: "pointer" }}>
                      {CUENTAS.map(c => <option key={c} value={c}>{CUENTA_LABEL[c] ?? c}</option>)}
                    </select>,
                    <input  key={`d${i}`} value={edit.concepto ?? ""} onChange={e => setPreviewEdit(comp.id, "concepto", e.target.value)} style={{ ...inpS, minWidth: 0, width: "100%" }} />,
                    <span key={`ne${i}`} className="mono" style={{ fontSize: 11, textAlign: "right", whiteSpace: "nowrap" }}>{fmt(neto, cur)}</span>,
                    <span key={`iv${i}`} className="mono" style={{ fontSize: 11, color: "var(--muted)", textAlign: "right", whiteSpace: "nowrap" }}>{applyIVA ? fmt(iva, cur) : "–"}</span>,
                    <span key={`t${i}`}  className="mono" style={{ fontSize: 12, color: "var(--gold)", fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>{fmt(total, cur)}</span>,
                  ];
                })}
              </div>
              {/* Fecha emisión ARCA */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: "var(--gold)", letterSpacing: ".06em" }}>Fecha emisión ARCA:</label>
                <input type="date" value={pagoBatchDate} onChange={e => setPagoBatchDate(e.target.value)}
                  style={{ background: "var(--bg)", border: "1px solid var(--gold)", color: "var(--text)", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontFamily: "var(--font)" }} />
                {!pagoBatchDate && <span style={{ fontSize: 10, color: "var(--orange)" }}>Obligatorio</span>}
              </div>
              {/* Botones */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn"
                  style={{ fontSize: 11, padding: "5px 18px", background: "rgba(222,251,151,.2)", color: "var(--gold)", border: "1px solid rgba(222,251,151,.4)", opacity: pagoBatchDate ? 1 : 0.4 }}
                  disabled={!pagoBatchDate}
                  onClick={() => {
                    const fechaOverride = pagoBatchDate ? toAR(pagoBatchDate) : null;
                    const augmented = pagoPreviewQueue.map(({ fr, comp }) => ({
                      fr,
                      comp: { ...comp, _cuenta: pagoPreviewEdits[comp.id]?.cuenta ?? "PAUTA", _concepto: pagoPreviewEdits[comp.id]?.concepto, _fecha: fechaOverride },
                    }));
                    handlePagoBatch(augmented);
                    setPagoPreviewQueue(null);
                  }}
                >
                  ✓ Confirmar y emitir
                </button>
                <button
                  className="ghost"
                  style={{ fontSize: 11, padding: "5px 12px" }}
                  onClick={() => setPagoPreviewQueue(null)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {showPago && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {/* Fila de selección masiva */}
              {!pagoBatchRunning && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 4, borderBottom: "1px solid var(--border2)" }}>
                  <input
                    type="checkbox"
                    checked={selectedPagoIds.size === pagosSinFactura.length && pagosSinFactura.length > 0}
                    onChange={toggleAllPagos}
                    style={{ cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>
                    {selectedPagoIds.size > 0 ? `${selectedPagoIds.size} seleccionado${selectedPagoIds.size !== 1 ? "s" : ""}` : "Seleccionar todos"}
                  </span>
                </div>
              )}
              {pagosSinFactura.map(({ fr, comp }, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg2)", borderRadius: 7, padding: "8px 12px", opacity: pagoBatchRunning ? 0.6 : 1 }}>
                  {!pagoBatchRunning && (
                    <input
                      type="checkbox"
                      checked={selectedPagoIds.has(comp.id)}
                      onChange={() => togglePagoSelect(comp.id)}
                      style={{ cursor: "pointer", flexShrink: 0 }}
                    />
                  )}
                  <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>{fr.name}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{MONTHS[comp.month]} {comp.year}</span>
                  <span className="mono" style={{ fontSize: 12, color: "var(--gold)", fontWeight: 700 }}>{fmt(comp.amount, compCurrency(comp))}</span>
                  <span className="pill" style={{ color: "var(--gold)", background: "rgba(222,251,151,.1)", fontSize: 9 }}>PAGO A CTA</span>
                  <button
                    className="ghost"
                    style={{ fontSize: 10, padding: "2px 8px", color: "var(--gold)" }}
                    disabled={pagoBatchRunning}
                    onClick={() => onEmitir(fr, comp)}
                  >
                    Emitir factura →
                  </button>
                  <button
                    className="ghost"
                    style={{ fontSize: 11, padding: "0 5px", color: "var(--text2)" }}
                    title="Eliminar"
                    disabled={pagoBatchRunning}
                    onClick={() => deleteComp(fr.id, comp.id)}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── PENDIENTES DE RECIBIR FACTURA (FC_RECIBIDA sin invoice) ── */}
      {fcRecibidasPendientes.length > 0 && (
        <div style={{ background: "rgba(96,165,250,.04)", border: "1px solid rgba(96,165,250,.22)", borderRadius: 10, padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: showFcRecibidas ? 10 : 0 }}>
            <input
              type="checkbox"
              style={{ cursor: "pointer", flexShrink: 0 }}
              checked={selectedFcRecibidas.size === fcRecibidasPendientes.length && fcRecibidasPendientes.length > 0}
              onChange={e => setSelectedFcRecibidas(e.target.checked ? new Set(fcRecibidasPendientes.map(x => x.comp.id)) : new Set())}
              onClick={e => e.stopPropagation()}
            />
            <span
              style={{ fontSize: 10, fontWeight: 800, color: "var(--blue)", letterSpacing: ".1em", flex: 1, cursor: "pointer" }}
              onClick={() => setShowFcRecibidas(v => !v)}
            >
              📥 PENDIENTES DE RECIBIR FACTURA — {fcRecibidasPendientes.length} comprobante{fcRecibidasPendientes.length !== 1 ? "s" : ""}
            </span>
            {selectedFcRecibidas.size > 0 && (
              <button
                className="ghost"
                disabled={sendingFcReminder}
                style={{ fontSize: 10, padding: "2px 10px", whiteSpace: "nowrap", color: "var(--blue)", opacity: sendingFcReminder ? 0.5 : 1 }}
                onClick={e => { e.stopPropagation(); handleSendFcReminder(fcRecibidasPendientes, selectedFcRecibidas, setSelectedFcRecibidas); }}
              >
                {sendingFcReminder ? "Enviando…" : `✉ Recordatorio (${selectedFcRecibidas.size})`}
              </button>
            )}
            <span style={{ fontSize: 11, color: "var(--muted)", cursor: "pointer" }} onClick={() => setShowFcRecibidas(v => !v)}>
              {showFcRecibidas ? "▲" : "▼"}
            </span>
          </div>
          {fcReminderResult && selectedFcRecibidas.size === 0 && (
            <div style={{ fontSize: 11, padding: "2px 0 8px", color: fcReminderResult.err.length && !fcReminderResult.ok.length ? "var(--red)" : "var(--green)" }}>
              {fcReminderResult.ok.length > 0 && `✓ Enviado a: ${fcReminderResult.ok.join(", ")}. `}
              {fcReminderResult.err.length > 0 && <span style={{ color: "var(--red)" }}>✕ Error: {fcReminderResult.err.join(", ")}</span>}
            </div>
          )}
          {showFcRecibidas && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {fcRecibidasPendientes.map(({ fr, comp }) => {
                const cuenta   = String(comp.type ?? "").split("|")[1] ?? "";
                const openAdj  = !!adjuntando[comp.id];
                const adjErr   = adjuntarErr[comp.id];
                const cur      = compCurrency(comp);
                const sent     = fcReminderSent.get(fr.id);
                return (
                  <div key={comp.id}>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8,
                      background: "var(--bg2)", borderRadius: openAdj || adjErr ? "7px 7px 0 0" : 7,
                      padding: "8px 12px",
                    }}>
                      <input
                        type="checkbox"
                        style={{ cursor: "pointer", flexShrink: 0 }}
                        checked={selectedFcRecibidas.has(comp.id)}
                        onChange={() => setSelectedFcRecibidas(prev => {
                          const next = new Set(prev);
                          next.has(comp.id) ? next.delete(comp.id) : next.add(comp.id);
                          return next;
                        })}
                      />
                      <span style={{ fontSize: 12, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
                        {fr.name}
                        {(fcReminderSent.get(fr.id) ?? []).map((entry, i) => (
                          <span
                            key={i}
                            title={`Recordatorio enviado el ${entry.fecha}${entry.status === "error" ? ` — Error: ${entry.error}` : ""}`}
                            style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, display: "inline-block", cursor: "default", background: entry.status === "error" ? "#ef4444" : "var(--accent)", boxShadow: entry.status === "error" ? "0 0 5px #ef4444" : "none" }}
                          />
                        ))}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>{comp.date}</span>
                      <span className="mono" style={{ fontSize: 12, color: "var(--blue)", fontWeight: 700, whiteSpace: "nowrap" }}>{fmt(comp.amount, cur)}</span>
                      <span className="pill" style={{ color: "var(--blue)", background: "rgba(96,165,250,.1)", fontSize: 9, whiteSpace: "nowrap" }}>
                        FC Recibida {CUENTA_LABEL[cuenta] ?? cuenta}
                      </span>
                      <button
                        className="ghost"
                        style={{ fontSize: 10, padding: "2px 8px", color: openAdj ? "var(--muted)" : "var(--blue)", whiteSpace: "nowrap" }}
                        onClick={() => openAdj ? handleCerrarAdjuntar(comp.id) : handleAbrirAdjuntar(comp.id)}
                      >
                        {openAdj ? "Cancelar" : "Adjuntar nro →"}
                      </button>
                    </div>
                    {/* Input adjuntar inline */}
                    {openAdj && (
                      <div style={{ background: "rgba(96,165,250,.05)", border: "1px solid rgba(96,165,250,.2)", borderTop: "none", borderRadius: adjErr ? 0 : "0 0 7px 7px", padding: "8px 12px", display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>Nro. factura recibida:</span>
                        <input
                          autoFocus
                          value={adjuntarVal[comp.id] ?? ""}
                          onChange={e => setAdjuntarVal(p => ({ ...p, [comp.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === "Enter") handleConfirmAdjuntar(fr, comp); if (e.key === "Escape") handleCerrarAdjuntar(comp.id); }}
                          placeholder="Nro. de factura del franquiciado"
                          style={{ flex: 1, background: "var(--bg)", border: "1px solid var(--border2)", borderRadius: 5, padding: "4px 8px", fontSize: 12, color: "var(--text)", fontFamily: "var(--font)" }}
                        />
                        <button
                          className="btn"
                          style={{ fontSize: 11, padding: "3px 12px", background: "rgba(96,165,250,.15)", color: "var(--blue)", border: "1px solid rgba(96,165,250,.3)" }}
                          onClick={() => handleConfirmAdjuntar(fr, comp)}
                        >
                          Guardar
                        </button>
                      </div>
                    )}
                    {adjErr && (
                      <div style={{ background: "rgba(255,107,122,.08)", border: "1px solid rgba(255,107,122,.2)", borderTop: "none", borderRadius: "0 0 7px 7px", padding: "6px 12px", fontSize: 11, color: "var(--red)" }}>
                        ✕ {adjErr}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
