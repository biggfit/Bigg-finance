import { useState, useEffect, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import {
  fetchLegajos, fetchLiquidaciones, saveLiquidacion, updateLegajo,
  fetchPagos, appendPago, deletePago, ROLES_HQ,
  FP_TIPOS, FP_TIPO_LABEL, FP_TIPO_COLOR, esTransferencia,
  fetchSociedadesNumbers, fetchCuentasBancariasNumbers, fetchCuentasContablesNumbers,
} from "../lib/sueldosApi";

// ── Estilos compartidos ───────────────────────────────────────────────────────

const T = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0",
  text: "#1e293b", muted: "#64748b", dim: "#94a3b8",
  blue: "#2563eb", blueLt: "#eff6ff",
  red: "#dc2626", green: "#16a34a",
  yellow: "#ca8a04", purple: "#7c3aed",
  font: "'Inter', system-ui, sans-serif",
};

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
               "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const fmtMoney = n => (!n && n !== 0) ? "—" : "$" + Math.round(n).toLocaleString("es-AR");
const redondear = n => Math.round(n / 500) * 500;
const hoy     = new Date();
const MES_DEF = hoy.getMonth() === 0 ? 12 : hoy.getMonth();
const ANO_DEF = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();

const TH = (extra = {}) => ({
  padding: "8px 12px", textAlign: "left", fontWeight: 600, color: T.muted,
  fontSize: 11, letterSpacing: ".04em", borderBottom: `1px solid ${T.border}`,
  whiteSpace: "nowrap", background: T.bg, ...extra,
});
const TD = (extra = {}) => ({
  padding: "9px 12px", borderBottom: `1px solid ${T.border}`,
  verticalAlign: "middle", ...extra,
});
const INPUT = (extra = {}) => ({
  border: "1px solid #93c5fd", borderRadius: 5, padding: "4px 8px",
  fontSize: 13, textAlign: "right", fontFamily: T.font, background: "#fff",
  outline: "none", color: T.text, ...extra,
});
const BTN_PRIMARY = (disabled) => ({
  background: disabled ? T.dim : T.blue, color: "#fff", border: "none",
  borderRadius: 7, padding: "8px 20px", fontSize: 13, fontWeight: 600,
  cursor: disabled ? "not-allowed" : "pointer",
});
const BTN_SECONDARY = {
  border: `1px solid #94a3b8`, background: "#fff", borderRadius: 7,
  padding: "8px 20px", fontSize: 13, cursor: "pointer", color: T.text,
};

const BTN_EXPORT = (color) => ({
  display: "flex", alignItems: "center", gap: 6,
  border: `1px solid ${color}`, background: "#fff", borderRadius: 7,
  padding: "7px 14px", fontSize: 12, fontWeight: 600,
  cursor: "pointer", color, fontFamily: T.font,
});

const MODAL_INPUT = {
  border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px",
  fontSize: 13, fontFamily: T.font, width: "100%", boxSizing: "border-box",
  color: T.text, background: "#fff",
};

function ModalLabel({ children }) {
  return <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>{children}</label>;
}

function ctaLabel(c, sociedades) {
  const soc = sociedades.find(s => s.id === c.sociedad)?.nombre ?? c.sociedad;
  const mon = c.moneda !== "ARS" ? ` (${c.moneda})` : "";
  return `${soc} — ${c.nombre}${mon}`;
}

// ── Formas de pago (receta de líneas por empleado) ────────────────────────────

const nuevaLineaId = () => `fp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
const lineaVacia = (tipo = "deposito") => ({
  id: nuevaLineaId(), tipo, importe: 0,
  banco: "", tipo_cuenta: "", cuenta: "", cbu: "", cuit: "", nota: "",
});

// Receta por defecto para un legajo sin formas de pago cargadas:
// 1 línea de haberes (= blanco_neto, con datos bancarios) + 1 de efectivo (el resto).
function defaultLineasFromLeg(leg) {
  const total  = leg?.sueldo_total || leg?.blanco_neto || 0;
  const blanco = leg?.blanco_neto || 0;
  const lineas = [];
  if (blanco > 0)
    lineas.push({ ...lineaVacia("haberes"), importe: blanco, banco: leg?.banco || "", cbu: leg?.cbu || "" });
  const efectivo = Math.max(0, total - blanco);
  if (efectivo > 0 || !lineas.length)
    lineas.push({ ...lineaVacia("efectivo"), importe: efectivo });
  return lineas;
}

// Reconstruye líneas a partir de los escalares monto_* de liquidaciones legacy
// (sin formas_pago). Ids estables por tipo para el fallback de isPaid.
function legacyLineasFromLiq(liq, leg) {
  const total    = leg?.sueldo_total || 0;
  const haberes  = liq.monto_haberes || 0;
  const deposito = liq.monto_deposito || 0;
  const transf   = liq.monto_transferencia || 0;
  const efectivo = Math.max(0, total - haberes - deposito - transf);
  const out = [];
  if (haberes)  out.push({ ...lineaVacia("haberes"),       id: "leg-haberes",       importe: haberes,  banco: leg?.banco || "", cbu: leg?.cbu || "" });
  if (deposito) out.push({ ...lineaVacia("deposito"),      id: "leg-deposito",      importe: deposito });
  if (transf)   out.push({ ...lineaVacia("transferencia"), id: "leg-transferencia", importe: transf });
  if (efectivo) out.push({ ...lineaVacia("efectivo"),      id: "leg-efectivo",      importe: efectivo });
  return out;
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function PantallaLiquidacionHQ({ pais = "" }) {
  const [mes,  setMes]  = useState(MES_DEF);
  const [anio, setAnio] = useState(ANO_DEF);

  const [legajos,       setLegajos]       = useState([]);
  const [liquidaciones, setLiquidaciones] = useState([]);
  const [pagos,         setPagos]         = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);

  // Wizard state
  const [paso,             setPaso]             = useState(1);
  const [sueldosDraft,     setSueldosDraft]     = useState({});  // { [legajo_id]: { pct: "", total: N } }
  const [actualizarLegs,   setActualizarLegs]   = useState(false);
  const [formasDraft,      setFormasDraft]      = useState({});  // { [legajo_id]: lineas[] }
  const [actualizarRecetas, setActualizarRecetas] = useState(false);
  const [showPago,         setShowPago]         = useState(null);

  useEffect(() => { load(); }, [mes, anio]);

  async function load() {
    setLoading(true);
    try {
      const [legs, liqs, pags] = await Promise.all([
        fetchLegajos(),
        fetchLiquidaciones(mes, anio),
        fetchPagos(mes, anio),
      ]);
      const legsHQ = legs.filter(l => ROLES_HQ.includes(l.rol) && l.activo);
      const descartados = legs.filter(l => l.activo && !ROLES_HQ.includes(l.rol));
      if (descartados.length)
        console.warn("[HQ] Legajos activos descartados por rol desconocido:", descartados.map(l => `${l.nombre} → "${l.rol}"`));
      setLegajos(legsHQ);
      setLiquidaciones(liqs.filter(l => ROLES_HQ.includes(l.rol)));
      setPagos(pags);
    } finally { setLoading(false); }
  }

  async function handleInicializar() {
    const idsConLiq = new Set(liquidaciones.map(l => l.legajo_id));
    const nuevos = legajos.filter(l => !idsConLiq.has(l.id));
    if (nuevos.length === 0) { alert("Todos los empleados ya tienen liquidación."); return; }
    setSaving(true);
    try {
      for (const leg of nuevos) {
        const formas_pago = leg.formas_pago?.length ? leg.formas_pago : defaultLineasFromLeg(leg);
        await saveLiquidacion({
          mes, anio,
          legajo_id: leg.id, legajo_nombre: leg.nombre,
          sociedad_id: leg.sociedad_id, sociedad_nombre: leg.sociedad_nombre,
          sede_id: leg.sede_id, sede_nombre: leg.sede_nombre,
          rol: leg.rol, tipo_contratacion: leg.tipo_contratacion,
          sueldo_base: leg.sueldo_total || leg.blanco_neto,
          formas_pago,
          estado: "borrador",
        });
      }
      await load();
    } catch (e) {
      alert("Error al inicializar: " + e.message);
    } finally { setSaving(false); }
  }

  const liqs = useMemo(() => {
    const legById = new Map(legajos.map(l => [l.id, l]));
    return liquidaciones.map(liq => {
      const leg         = legById.get(liq.legajo_id);
      const lineas      = liq.formas_pago?.length ? liq.formas_pago : legacyLineasFromLiq(liq, leg);
      const pagosMios   = pagos.filter(p => p.legajo_id === liq.legajo_id);
      const totalPagado = pagosMios.reduce((s, p) => s + p.monto, 0);
      const total_bruto = lineas.reduce((s, l) => s + (Number(l.importe) || 0), 0);
      return {
        ...liq,
        lineas,
        sueldo_total_legajo: leg?.sueldo_total || 0,
        blanco_neto_legajo:  leg?.blanco_neto || 0,
        cbu:   leg?.cbu   || "",
        banco: leg?.banco || "",
        pagos: pagosMios,
        total_bruto,
        total_pagado: totalPagado,
        pendiente: total_bruto - totalPagado,
      };
    });
  }, [liquidaciones, pagos, legajos]);

  useEffect(() => {
    if (!liqs.length) return;
    setSueldosDraft(prev => {
      const next = { ...prev };
      liqs.forEach(liq => {
        if (!(liq.legajo_id in next))
          next[liq.legajo_id] = { pct: "", total: liq.sueldo_total_legajo };
      });
      return next;
    });
  }, [liqs.length]);

  const faltantes = useMemo(() => {
    const conLiq = new Set(liqs.map(l => l.legajo_id));
    return legajos.filter(l => !conLiq.has(l.id));
  }, [legajos, liqs]);

  const getDraftTotal = (liq) => sueldosDraft[liq.legajo_id]?.total ?? liq.sueldo_total_legajo;

  async function handleConfirmarSueldos() {
    if (actualizarLegs) {
      setSaving(true);
      try {
        for (const liq of liqs) {
          const nuevoTotal = getDraftTotal(liq);
          if (nuevoTotal !== liq.sueldo_total_legajo)
            await updateLegajo(liq.legajo_id, { sueldo_total: nuevoTotal });
        }
        await load();
      } catch (e) {
        alert("Error al actualizar legajos: " + e.message);
        setSaving(false);
        return;
      } finally { setSaving(false); }
    }
    setFormasDraft(() => {
      const d = {};
      liqs.forEach(liq => {
        const base = liq.lineas?.length ? liq.lineas : defaultLineasFromLeg({
          sueldo_total: getDraftTotal(liq), blanco_neto: liq.blanco_neto_legajo, banco: liq.banco, cbu: liq.cbu,
        });
        d[liq.legajo_id] = base.map(l => ({ ...l }));
      });
      return d;
    });
    setPaso(2);
  }

  async function handleConfirmarPago() {
    setSaving(true);
    try {
      for (const liq of liqs) {
        const formas_pago = (formasDraft[liq.legajo_id] || []).map(l => ({ ...l, importe: Number(l.importe) || 0 }));
        await saveLiquidacion({
          id: liq.id, mes, anio,
          legajo_id: liq.legajo_id, legajo_nombre: liq.legajo_nombre,
          sociedad_id: liq.sociedad_id, sociedad_nombre: liq.sociedad_nombre,
          sede_id: liq.sede_id, sede_nombre: liq.sede_nombre,
          rol: liq.rol, tipo_contratacion: liq.tipo_contratacion,
          sueldo_base: getDraftTotal(liq),
          formas_pago,
          estado: liq.estado || "borrador",
        });
        if (actualizarRecetas) await updateLegajo(liq.legajo_id, { formas_pago });
      }
      await load();
      setPaso(3);
    } catch (e) {
      alert("Error al guardar forma de pago: " + e.message);
    } finally { setSaving(false); }
  }

  const liqStaff    = liqs.filter(l => l.rol === "HQ");
  const liqOwners   = liqs.filter(l => l.rol === "HQ_OWNER");
  const liqExternos = liqs.filter(l => l.rol === "HQ_EXT");

  if (loading) return (
    <div style={{ padding: 40, color: T.muted, fontFamily: T.font, fontSize: 13 }}>Cargando…</div>
  );

  return (
    <div style={{ padding: 24, fontFamily: T.font, color: T.text }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Liquidación — HQ</h2>
        <select value={mes} onChange={e => setMes(Number(e.target.value))}
          style={{ border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: T.font }}>
          {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={anio} onChange={e => setAnio(Number(e.target.value))}
          style={{ border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, width: 80, fontFamily: T.font }} />
        <button onClick={handleInicializar} disabled={saving}
          style={{ marginLeft: "auto", ...BTN_PRIMARY(saving) }}>
          {saving ? "Procesando…" : "↻ Inicializar período"}
        </button>
      </div>

      {liqs.length === 0 ? (
        <div style={{ border: `1px dashed ${T.border}`, borderRadius: 8, padding: 40, textAlign: "center", color: T.muted, fontSize: 13 }}>
          No hay liquidación HQ para {MESES[mes - 1]} {anio}. Usá "Inicializar período".
        </div>
      ) : (
        <>
          {faltantes.length > 0 && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 8,
              padding: "10px 16px", marginBottom: 16, fontSize: 13, gap: 12,
            }}>
              <span>
                <strong style={{ color: "#92400e" }}>⚠️ {faltantes.length} empleado{faltantes.length > 1 ? "s" : ""} sin liquidación:</strong>
                {" "}<span style={{ color: "#78350f" }}>{faltantes.map(l => l.nombre).join(", ")}</span>
              </span>
              <button onClick={handleInicializar} disabled={saving} style={{ ...BTN_PRIMARY(saving), whiteSpace: "nowrap", fontSize: 12, padding: "6px 14px" }}>
                {saving ? "Agregando…" : "↻ Agregar faltantes"}
              </button>
            </div>
          )}

          <StepsIndicator paso={paso} onPaso={p => p < paso && setPaso(p)} />

          {paso === 1 && (
            <PasoSueldos
              liqStaff={liqStaff} liqOwners={liqOwners} liqExternos={liqExternos}
              sueldosDraft={sueldosDraft}
              onChangeDraft={(id, updates) =>
                setSueldosDraft(d => ({ ...d, [id]: { ...(d[id] || {}), ...updates } }))
              }
              actualizarLegs={actualizarLegs}
              onChangeActualizar={setActualizarLegs}
              onSiguiente={handleConfirmarSueldos}
              saving={saving}
            />
          )}

          {paso === 2 && (
            <PasoPago
              liqStaff={liqStaff} liqOwners={liqOwners} liqExternos={liqExternos}
              sueldosDraft={sueldosDraft}
              formasDraft={formasDraft}
              onChangeLineas={(id, lineas) => setFormasDraft(d => ({ ...d, [id]: lineas }))}
              actualizarRecetas={actualizarRecetas}
              onChangeActualizar={setActualizarRecetas}
              onAtras={() => setPaso(1)}
              onSiguiente={handleConfirmarPago}
              saving={saving}
            />
          )}

          {paso === 3 && (
            <PasoPagos
              mes={mes} anio={anio}
              liqStaff={liqStaff} liqOwners={liqOwners} liqExternos={liqExternos}
              onAtras={() => setPaso(2)}
              onRegistrarPago={setShowPago}
              onBatchPaid={load}
            />
          )}
        </>
      )}

      {showPago && (() => {
        const liqSel = liqs.find(l => l.legajo_id === showPago.legajo_id);
        return (
          <ModalPagoHQ
            mes={mes} anio={anio}
            liq={liqSel}
            linea={liqSel?.lineas?.find(l => l.id === showPago.linea_id)}
            onClose={() => setShowPago(null)}
            onSaved={async () => { setShowPago(null); await load(); }}
          />
        );
      })()}
    </div>
  );
}

// ── Helpers de ordenamiento ──────────────────────────────────────────────────

function useSortable(defaultCol = null) {
  const [sortCol, setSortCol] = useState(defaultCol);
  const [sortDir, setSortDir] = useState("asc");
  const toggle = (col) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };
  const sort = (rows, getVal) => [...rows].sort((a, b) => {
    if (!sortCol) return 0;
    const va = getVal(a, sortCol) ?? "";
    const vb = getVal(b, sortCol) ?? "";
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ?  1 : -1;
    return 0;
  });
  return { sortCol, sortDir, toggle, sort };
}

function SortTH({ col, sortCol, sortDir, onSort, children, style = {} }) {
  const active = sortCol === col;
  return (
    <th onClick={() => onSort(col)} style={{ ...TH(style), cursor: "pointer", userSelect: "none" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {children}
        <span style={{ fontSize: 10, color: active ? T.blue : T.dim }}>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </span>
    </th>
  );
}

// ── Badge de rol ─────────────────────────────────────────────────────────────

function RolBadge({ rol }) {
  if (rol === "HQ_OWNER")
    return <span style={{ fontSize: 10, background: "#f3e8ff", color: T.purple,  padding: "2px 6px", borderRadius: 3, fontWeight: 600, whiteSpace: "nowrap" }}>Owner</span>;
  if (rol === "HQ_EXT")
    return <span style={{ fontSize: 10, background: "#ccfbf1", color: "#0d9488", padding: "2px 6px", borderRadius: 3, fontWeight: 600, whiteSpace: "nowrap" }}>Ext</span>;
  return null;
}

// ── Indicador de pasos ────────────────────────────────────────────────────────

function StepsIndicator({ paso, onPaso }) {
  const steps = [
    { n: 1, label: "Confirmar sueldos" },
    { n: 2, label: "Forma de pago" },
    { n: 3, label: "Registrar pagos" },
  ];
  return (
    <div style={{ display: "flex", marginBottom: 24, borderRadius: 8, overflow: "hidden", border: `1px solid ${T.border}` }}>
      {steps.map((s, i) => (
        <button key={s.n} onClick={() => onPaso(s.n)}
          style={{
            flex: 1, padding: "10px 0", border: "none",
            borderRight: i < steps.length - 1 ? `1px solid ${T.border}` : "none",
            cursor: s.n < paso ? "pointer" : "default",
            background: s.n === paso ? T.blue : s.n < paso ? "#eff6ff" : T.bg,
            color: s.n === paso ? "#fff" : s.n < paso ? "#1d4ed8" : T.dim,
            fontWeight: 600, fontSize: 12, fontFamily: T.font,
            transition: "background .15s",
          }}>
          {s.n}. {s.label}
        </button>
      ))}
    </div>
  );
}

// ── Paso 1: Confirmar sueldos ─────────────────────────────────────────────────

function PasoSueldos({ liqStaff, liqOwners, liqExternos, sueldosDraft, onChangeDraft, actualizarLegs, onChangeActualizar, onSiguiente, saving }) {
  const [pctGlobal, setPctGlobal] = useState("");
  const { sortCol, sortDir, toggle, sort } = useSortable("nombre");

  const todos       = [...liqStaff, ...liqOwners, ...liqExternos];
  const totalActual = todos.reduce((s, l) => s + (l.sueldo_total_legajo || 0), 0);
  const totalNuevo  = todos.reduce((s, l) => s + (sueldosDraft[l.legajo_id]?.total ?? l.sueldo_total_legajo), 0);
  const diff        = totalNuevo - totalActual;

  const handlePct = (liq, rawPct) => {
    const nuevoTotal = rawPct !== "" ? redondear(liq.sueldo_total_legajo * (1 + parseFloat(rawPct) / 100)) : liq.sueldo_total_legajo;
    onChangeDraft(liq.legajo_id, { pct: rawPct, total: nuevoTotal });
  };

  const handleTotal = (liq, rawTotal) => {
    onChangeDraft(liq.legajo_id, { pct: "", total: parseFloat(rawTotal) || 0 });
  };

  // Aplica el mismo % a todos los empleados de una vez
  const handlePctGlobal = (rawPct) => {
    setPctGlobal(rawPct);
    todos.forEach(liq => handlePct(liq, rawPct));
  };

  const sorted = sort(todos, (r, col) => {
    if (col === "nombre") return r.legajo_nombre;
    if (col === "rol")    return r.rol;
    if (col === "actual") return r.sueldo_total_legajo;
    if (col === "nuevo")  return sueldosDraft[r.legajo_id]?.total ?? r.sueldo_total_legajo;
  });

  return (
    <div>
      {/* Resumen de totales */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Total actual",  value: totalActual, color: T.muted },
          { label: "Total nuevo",   value: totalNuevo,  color: T.blue },
          { label: "Diferencia",    value: diff,        color: diff > 0 ? T.green : diff < 0 ? T.red : T.muted, prefix: diff > 0 ? "+" : "" },
        ].map(({ label, value, color, prefix = "" }) => (
          <div key={label} style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color }}>{prefix}{fmtMoney(value)}</div>
          </div>
        ))}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 8 }}>
        <thead>
          <tr>
            <SortTH col="nombre" sortCol={sortCol} sortDir={sortDir} onSort={toggle}>Nombre</SortTH>

            <SortTH col="actual" sortCol={sortCol} sortDir={sortDir} onSort={toggle} style={{ textAlign: "right" }}>Sueldo actual</SortTH>
            <th style={TH({ textAlign: "right" })}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                <span>% aumento</span>
                <input
                  type="number" value={pctGlobal}
                  onChange={e => handlePctGlobal(e.target.value)}
                  placeholder="todos"
                  title="Aplicar a todos"
                  style={INPUT({ width: 60, fontSize: 11, padding: "2px 6px", border: "1px solid #6366f1", color: T.text })}
                />
              </div>
            </th>
            <SortTH col="nuevo" sortCol={sortCol} sortDir={sortDir} onSort={toggle} style={{ textAlign: "right" }}>Nuevo sueldo</SortTH>
          </tr>
        </thead>
        <tbody>
          {sorted.map((liq, i) => {
            const d          = sueldosDraft[liq.legajo_id];
            const pct        = d?.pct   ?? "";
            const nuevoTotal = d?.total ?? liq.sueldo_total_legajo;
            const subio      = nuevoTotal > liq.sueldo_total_legajo;
            return (
              <tr key={liq.id} style={{ background: i % 2 === 0 ? "#fff" : T.bg }}>
                <td style={TD({ fontWeight: 600 })}>{liq.legajo_nombre}</td>

                <td style={TD({ textAlign: "right", fontWeight: 700, color: T.blue })}>{fmtMoney(liq.sueldo_total_legajo)}</td>
                <td style={TD({ textAlign: "right" })}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                    <input
                      type="number" value={pct}
                      onChange={e => handlePct(liq, e.target.value)}
                      placeholder="0"
                      style={INPUT({ width: 64 })}
                    />
                    <span style={{ color: T.muted, fontSize: 12 }}>%</span>
                  </div>
                </td>
                <td style={TD({ textAlign: "right" })}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                    <input
                      type="text"
                      value={nuevoTotal ? Math.round(nuevoTotal).toLocaleString("es-AR") : ""}
                      onChange={e => handleTotal(liq, e.target.value.replace(/\./g, ""))}
                      style={INPUT({ width: 110, fontWeight: 700, color: subio ? T.green : T.text })}
                    />
                    {subio && <span style={{ fontSize: 12, color: T.green }}>↑</span>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 0", borderTop: `1px solid ${T.border}`, marginTop: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", color: T.text }}>
          <input type="checkbox" checked={actualizarLegs} onChange={e => onChangeActualizar(e.target.checked)} />
          Actualizar sueldo en todos los legajos con los nuevos valores
        </label>
        <button onClick={onSiguiente} disabled={saving} style={BTN_PRIMARY(saving)}>
          {saving ? "Guardando…" : "Siguiente →"}
        </button>
      </div>
    </div>
  );
}

// ── Paso 2: Forma de pago ─────────────────────────────────────────────────────

function PasoPago({ liqStaff, liqOwners, liqExternos, sueldosDraft, formasDraft, onChangeLineas, actualizarRecetas, onChangeActualizar, onAtras, onSiguiente, saving }) {
  const getTarget = (liq) => sueldosDraft[liq.legajo_id]?.total ?? liq.sueldo_total_legajo;
  const todos = [...liqStaff, ...liqOwners, ...liqExternos];

  return (
    <div>
      <p style={{ fontSize: 12, color: T.muted, margin: "0 0 16px" }}>
        Cada empleado trae su receta de pago del legajo. Ajustá las líneas que cambian este mes; el origen del dinero se elige al pagar.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {todos.map(liq => (
          <EmpleadoFormasEditor
            key={liq.legajo_id}
            liq={liq}
            target={getTarget(liq)}
            lineas={formasDraft[liq.legajo_id] || []}
            onChange={(lineas) => onChangeLineas(liq.legajo_id, lineas)}
          />
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 0", borderTop: `1px solid ${T.border}`, marginTop: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", color: T.text }}>
          <input type="checkbox" checked={actualizarRecetas} onChange={e => onChangeActualizar(e.target.checked)} />
          Actualizar la receta en los legajos (aplica a meses futuros)
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onAtras} style={BTN_SECONDARY}>← Atrás</button>
          <button onClick={onSiguiente} disabled={saving} style={BTN_PRIMARY(saving)}>
            {saving ? "Guardando…" : "Guardar y continuar →"}
          </button>
        </div>
      </div>
    </div>
  );
}

const FP_TH = (extra = {}) => ({ padding: "5px 7px", textAlign: "left", fontWeight: 600, color: T.muted, fontSize: 10.5, letterSpacing: ".03em", whiteSpace: "nowrap", ...extra });
const FP_TD = (extra = {}) => ({ padding: "3px 5px", verticalAlign: "middle", ...extra });
const FP_INPUT = (extra = {}) => ({ border: `1px solid ${T.border}`, borderRadius: 5, padding: "4px 7px", fontSize: 12.5, fontFamily: T.font, background: "#fff", outline: "none", color: T.text, width: "100%", boxSizing: "border-box", ...extra });

function EmpleadoFormasEditor({ liq, target, lineas, onChange }) {
  const upd = (id, k, v) => onChange(lineas.map(l => l.id === id ? { ...l, [k]: v } : l));
  const add = () => onChange([...lineas, lineaVacia("deposito")]);
  const del = (id) => onChange(lineas.filter(l => l.id !== id));
  const setResto = () => {
    const noEf = lineas.filter(l => l.tipo !== "efectivo").reduce((s, l) => s + (parseFloat(l.importe) || 0), 0);
    const resto = Math.max(0, target - noEf);
    const idx = lineas.findIndex(l => l.tipo === "efectivo");
    if (idx >= 0) onChange(lineas.map((l, i) => i === idx ? { ...l, importe: resto } : l));
    else onChange([...lineas, { ...lineaVacia("efectivo"), importe: resto }]);
  };
  const suma = lineas.reduce((s, l) => s + (parseFloat(l.importe) || 0), 0);
  const dif  = suma - target;

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <strong style={{ fontSize: 14 }}>{liq.legajo_nombre}</strong>
        <span style={{ fontSize: 12, color: T.muted }}>Sueldo total <strong style={{ color: T.blue }}>{fmtMoney(target)}</strong></span>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 120 }} /><col style={{ width: 110 }} /><col /><col style={{ width: 70 }} />
          <col /><col /><col /><col style={{ width: 140 }} /><col style={{ width: 32 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={FP_TH()}>Tipo</th>
            <th style={FP_TH({ textAlign: "right" })}>Importe</th>
            <th style={FP_TH()}>Banco</th>
            <th style={FP_TH()}>Tipo cta</th>
            <th style={FP_TH()}>Cuenta</th>
            <th style={FP_TH()}>CBU</th>
            <th style={FP_TH()}>CUIT</th>
            <th style={FP_TH()}>Nota interna</th>
            <th style={FP_TH()}></th>
          </tr>
        </thead>
        <tbody>
          {lineas.map(l => {
            const esEf = l.tipo === "efectivo";
            return (
              <tr key={l.id}>
                <td style={FP_TD()}>
                  <select value={l.tipo} onChange={e => upd(l.id, "tipo", e.target.value)}
                    style={FP_INPUT({ color: FP_TIPO_COLOR[l.tipo] || T.text, fontWeight: 600 })}>
                    {FP_TIPOS.map(t => <option key={t} value={t}>{FP_TIPO_LABEL[t]}</option>)}
                  </select>
                </td>
                <td style={FP_TD()}>
                  <input type="number" value={l.importe}
                    onChange={e => upd(l.id, "importe", e.target.value)}
                    style={FP_INPUT({ textAlign: "right", fontWeight: 600 })} />
                </td>
                <td style={FP_TD()}><input value={l.banco} disabled={esEf} onChange={e => upd(l.id, "banco", e.target.value)} style={FP_INPUT(esEf ? { background: T.bg } : {})} /></td>
                <td style={FP_TD()}><input value={l.tipo_cuenta} disabled={esEf} onChange={e => upd(l.id, "tipo_cuenta", e.target.value)} placeholder="CA/CC" style={FP_INPUT(esEf ? { background: T.bg } : {})} /></td>
                <td style={FP_TD()}><input value={l.cuenta} disabled={esEf} onChange={e => upd(l.id, "cuenta", e.target.value)} style={FP_INPUT(esEf ? { background: T.bg } : {})} /></td>
                <td style={FP_TD()}><input value={l.cbu} disabled={esEf} onChange={e => upd(l.id, "cbu", e.target.value)} style={FP_INPUT(esEf ? { background: T.bg } : {})} /></td>
                <td style={FP_TD()}><input value={l.cuit} disabled={esEf} onChange={e => upd(l.id, "cuit", e.target.value)} style={FP_INPUT(esEf ? { background: T.bg } : {})} /></td>
                <td style={FP_TD()}><input value={l.nota} onChange={e => upd(l.id, "nota", e.target.value)} placeholder="Alquiler, cuenta 2…" style={FP_INPUT()} /></td>
                <td style={FP_TD({ textAlign: "center" })}>
                  <button onClick={() => del(l.id)} title="Eliminar línea"
                    style={{ background: "none", border: "none", cursor: "pointer", color: T.red, fontSize: 14, padding: 0 }}>🗑</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        <button onClick={add} style={{ background: "none", border: `1px dashed ${T.blue}`, color: T.blue, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>＋ Agregar línea</button>
        <button onClick={setResto} style={{ background: "none", border: `1px solid #fde68a`, color: "#92400e", borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Resto a efectivo</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: T.muted }}>Σ líneas <strong style={{ color: Math.abs(dif) < 1 ? T.green : T.red }}>{fmtMoney(suma)}</strong></span>
        {Math.abs(dif) >= 1 && (
          <span style={{ fontSize: 12, color: T.red, fontWeight: 600 }}>
            ⚠️ {dif > 0 ? "+" : ""}{fmtMoney(dif)} vs sueldo total
          </span>
        )}
      </div>
    </div>
  );
}

// ── Helpers de exportación Excel (formato Galicia Office) ─────────────────────

const GALICIA_HEADERS = [
  "CBU/CVU/Alias/Nro cuenta            ",
  "Monto",
  "Concepto",
  "Descripción\r\n(opcional)",
  "Email destinatario\r\n(opcional)",
  "Mensaje del email\r\n(opcional)",
];

function descargarExcelGalicia(filas, nombreArchivo) {
  const ws = XLSX.utils.aoa_to_sheet([GALICIA_HEADERS, ...filas]);
  // Ancho de columnas aproximado
  ws["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 32 }, { wch: 14 }, { wch: 24 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Formulario");
  XLSX.writeFile(wb, nombreArchivo);
}

// Genera una fila Galicia por cada línea de pago del tipo indicado (con CBU).
function lineasGalicia(liqs, tipo) {
  const filas = [];
  for (const liq of liqs) {
    for (const l of liq.lineas || []) {
      if (l.tipo !== tipo) continue;
      const cbu = (l.cbu || (tipo === "haberes" ? liq.cbu : "")).trim();
      if (!cbu || !(Number(l.importe) > 0)) continue;
      filas.push({ cbu, importe: Number(l.importe), nombre: liq.legajo_nombre, nota: l.nota || "" });
    }
  }
  return filas;
}

function exportarHaberes(liqs, mes, anio) {
  const desc = `Sueldo ${String(mes).padStart(2, "0")}/${anio}`.slice(0, 12);
  const filas = lineasGalicia(liqs, "haberes")
    .map(f => [f.cbu, f.importe, "acreditamiento de haberes", desc, "", ""]);
  if (!filas.length) { alert("No hay líneas de Haberes con CBU cargado."); return; }
  descargarExcelGalicia(filas, `Haberes_HQ_${String(mes).padStart(2,"0")}_${anio}.xlsx`);
}

function exportarDeposito(liqs, mes, anio) {
  const desc = `Dep ${String(mes).padStart(2, "0")}/${anio}`.slice(0, 12);
  const filas = lineasGalicia(liqs, "deposito")
    .map(f => [f.cbu, f.importe, f.nota || "varios", desc, "", ""]);
  if (!filas.length) { alert("No hay líneas de Depósito con CBU cargado."); return; }
  descargarExcelGalicia(filas, `Deposito_HQ_${String(mes).padStart(2,"0")}_${anio}.xlsx`);
}

// ── Paso 3: Registrar pagos ───────────────────────────────────────────────────

// Pagos asociados a una línea: match por forma_pago_id; fallback legacy (líneas
// reconstruidas "leg-…") por tipo_componente para pagos viejos sin forma_pago_id.
function getPagosLinea(liq, linea) {
  const pagos = liq.pagos || [];
  const byId = pagos.filter(p => p.forma_pago_id === linea.id);
  if (byId.length) return byId;
  if (String(linea.id).startsWith("leg-"))
    return pagos.filter(p => !p.forma_pago_id && p.tipo_componente === linea.tipo);
  return [];
}

function describirDestino(l) {
  if (l.tipo === "efectivo") return l.nota || "Efectivo en mano";
  const base = [l.banco, l.cuenta || l.cbu].filter(Boolean).join(" · ") || "Sin datos bancarios";
  return l.nota ? `${base} — ${l.nota}` : base;
}

function PasoPagos({ mes, anio, liqStaff, liqOwners, liqExternos, onAtras, onRegistrarPago, onBatchPaid }) {
  const [anularModal, setAnularModal] = useState(null); // pago object

  const todos = useMemo(() => [...liqStaff, ...liqOwners, ...liqExternos], [liqStaff, liqOwners, liqExternos]);

  const totalBruto  = todos.reduce((s, l) => s + l.total_bruto,  0);
  const totalPagado = todos.reduce((s, l) => s + l.total_pagado, 0);
  const totalPend   = totalBruto - totalPagado;

  return (
    <div>
      {/* Resumen */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Total a pagar", value: totalBruto,  color: T.text },
          { label: "Pagado",        value: totalPagado, color: T.green },
          { label: "Pendiente",     value: totalPend,   color: totalPend > 0 ? T.red : T.green },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color }}>{fmtMoney(value)}</div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 12, color: T.muted, margin: "0 0 14px" }}>
        Cada destino se paga por separado, eligiendo el origen del dinero al momento de pagar. Nada queda cerrado hasta que pagás.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {todos.map(liq => (
          <EmpleadoPagosLineas
            key={liq.legajo_id}
            liq={liq}
            onPagar={(linea) => onRegistrarPago({ legajo_id: liq.legajo_id, linea_id: linea.id })}
            onVerPago={(pago) => setAnularModal(pago)}
          />
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "16px 0", borderTop: `1px solid ${T.border}`, marginTop: 8 }}>
        <button style={BTN_EXPORT("#16a34a")} onClick={() => exportarHaberes(todos, mes, anio)}>
          📥 Excel Haberes (banco)
        </button>
        <button style={BTN_EXPORT("#0369a1")} onClick={() => exportarDeposito(todos, mes, anio)}>
          📥 Excel Depósito (financiera)
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={onAtras} style={BTN_SECONDARY}>← Atrás</button>
      </div>

      {anularModal && (
        <ModalAnularPago
          pago={anularModal}
          onClose={() => setAnularModal(null)}
          onAnulado={() => { setAnularModal(null); onBatchPaid?.(); }}
        />
      )}
    </div>
  );
}

function EmpleadoPagosLineas({ liq, onPagar, onVerPago }) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>{liq.legajo_nombre}</strong>
        <span style={{ fontSize: 12, color: T.muted }}>
          Total <strong style={{ color: T.blue }}>{fmtMoney(liq.total_bruto)}</strong>
          {" · "}Pendiente <strong style={{ color: liq.pendiente > 0 ? T.red : T.green }}>{fmtMoney(liq.pendiente)}</strong>
        </span>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <tbody>
          {liq.lineas.map(l => {
            const pagos  = getPagosLinea(liq, l);
            const pagado = pagos.length > 0;
            const dup    = pagos.length > 1;
            return (
              <tr key={l.id} style={{ borderTop: `1px solid ${T.border}` }}>
                <td style={TD({ width: 110, color: FP_TIPO_COLOR[l.tipo] || T.text, fontWeight: 600 })}>{FP_TIPO_LABEL[l.tipo] || l.tipo}</td>
                <td style={TD({ color: T.muted, fontSize: 12 })}>{describirDestino(l)}</td>
                <td style={TD({ textAlign: "right", fontWeight: 700 })}>{fmtMoney(Number(l.importe) || 0)}</td>
                <td style={TD({ textAlign: "right", whiteSpace: "nowrap", width: 130 })}>
                  {pagado
                    ? <button onClick={() => onVerPago(pagos[0])}
                        title={dup ? `⚠️ ${pagos.length} pagos para esta línea` : "Ver / anular este pago"}
                        style={{ background: "none", border: `1px solid ${dup ? T.red : T.green}`, color: dup ? T.red : T.green, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
                        {dup ? `⚠️ ×${pagos.length}` : "✅ Pagado"}
                      </button>
                    : <button onClick={() => onPagar(l)}
                        style={{ background: "#fff", color: T.green, border: `1px solid ${T.green}`, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
                        💳 Pagar
                      </button>
                  }
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Modal anular / editar pago ────────────────────────────────────────────────

function ModalAnularPago({ pago, onClose, onAnulado }) {
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({
    monto:       pago.monto,
    fecha:       (pago.fecha ?? "").slice(0, 10),
    cuenta_id:   pago.cuenta_bancaria_id ?? "",
    sociedad_id: "",
  });
  const [cuentas,     setCuentas]     = useState([]);
  const [sociedades,  setSociedades]  = useState([]);
  const [loadingCtas, setLoadingCtas] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const savingRef = useRef(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const tipoLabel = FP_TIPO_LABEL[pago.tipo_componente] ?? pago.tipo_componente;

  const handleStartEdit = () => {
    setLoadingCtas(true);
    Promise.all([fetchSociedadesNumbers(), fetchCuentasBancariasNumbers()])
      .then(([socs, ctas]) => { setSociedades(socs); setCuentas(ctas); })
      .finally(() => setLoadingCtas(false));
    setEditMode(true);
  };

  const socFiltro = pago.tipo_componente === "haberes"       ? pago.sociedad_id
    : esTransferencia(pago.tipo_componente)                  ? form.sociedad_id
    : "beta";
  const cuentasFiltradas = socFiltro ? cuentas.filter(c => c.sociedad === socFiltro) : [];

  const handleAnular = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      await deletePago(pago.id, pago.nb_movimiento_id);
      await onAnulado();
    } catch (e) { alert("Error: " + e.message); setSaving(false); } finally { savingRef.current = false; }
  };

  const handleGuardar = async () => {
    if (savingRef.current) return;
    if (!form.monto) { alert("Completá el monto."); return; }
    if (!form.cuenta_id) { alert("Seleccioná una cuenta."); return; }
    savingRef.current = true; setSaving(true);
    try {
      const cta = cuentas.find(c => c.id === form.cuenta_id);
      await deletePago(pago.id, pago.nb_movimiento_id);
      await appendPago({
        mes:                    pago.mes,
        anio:                   pago.anio,
        legajo_id:              pago.legajo_id,
        legajo_nombre:          pago.legajo_nombre,
        sociedad_id:            pago.tipo_componente === "haberes" ? pago.sociedad_id : (form.sociedad_id || "beta"),
        sociedad_nombre:        pago.tipo_componente === "haberes" ? pago.sociedad_nombre : (sociedades.find(s => s.id === (form.sociedad_id || "beta"))?.nombre ?? "Beta"),
        tipo_componente:        pago.tipo_componente,
        monto:                  parseFloat(form.monto) || 0,
        fecha:                  form.fecha,
        cuenta_bancaria_id:     form.cuenta_id,
        cuenta_bancaria_nombre: cta?.nombre ?? "",
      });
      await onAnulado();
    } catch (e) { alert("Error: " + e.message); setSaving(false); } finally { savingRef.current = false; }
  };

  const ROW = ({ label, value }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${T.border}`, fontSize: 13 }}>
      <span style={{ color: T.muted }}>{label}</span>
      <span style={{ fontWeight: 600, color: T.text }}>{value}</span>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: T.font }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>
          {editMode ? "Editar pago" : "Pago registrado"} — {pago.legajo_nombre}
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: T.muted }}>
          {editMode ? "Los cambios reemplazan el pago y el movimiento en Tesorería." : tipoLabel}
        </p>

        {!editMode ? (
          <>
            <div style={{ marginBottom: 20 }}>
              <ROW label="Tipo"   value={tipoLabel} />
              <ROW label="Monto"  value={fmtMoney(pago.monto)} />
              <ROW label="Fecha"  value={(pago.fecha ?? "").slice(0, 10)} />
              <ROW label="Cuenta" value={pago.cuenta_bancaria_nombre || "—"} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={BTN_SECONDARY}>Cerrar</button>
              <button onClick={handleStartEdit} style={{ ...BTN_SECONDARY, borderColor: T.blue, color: T.blue }}>✏️ Editar</button>
              <button onClick={handleAnular} disabled={saving} style={{
                background: saving ? T.dim : T.red, color: "#fff", border: "none",
                borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
              }}>
                {saving ? "Anulando…" : "Anular"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <ModalLabel>Monto (ARS)</ModalLabel>
                <input style={MODAL_INPUT} type="number" value={form.monto} onChange={e => set("monto", e.target.value)} />
              </div>
              <div>
                <ModalLabel>Fecha</ModalLabel>
                <input style={MODAL_INPUT} type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} />
              </div>
              {esTransferencia(pago.tipo_componente) && (
                <div>
                  <ModalLabel>Sociedad que transfiere</ModalLabel>
                  <select style={MODAL_INPUT} value={form.sociedad_id}
                    onChange={e => setForm(f => ({ ...f, sociedad_id: e.target.value, cuenta_id: "" }))}>
                    <option value="">— Seleccioná —</option>
                    {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
              )}
              {(pago.tipo_componente === "deposito" || pago.tipo_componente === "efectivo") && (
                <div style={{ fontSize: 12, color: T.muted, background: T.bg, borderRadius: 5, padding: "6px 10px" }}>
                  Sociedad: <strong style={{ color: T.text }}>Beta</strong>
                </div>
              )}
              <div>
                <ModalLabel>{pago.tipo_componente === "efectivo" ? "Caja" : "Cuenta bancaria"}</ModalLabel>
                {loadingCtas
                  ? <div style={{ fontSize: 12, color: T.muted }}>Cargando…</div>
                  : <select style={MODAL_INPUT} value={form.cuenta_id} onChange={e => set("cuenta_id", e.target.value)}
                      disabled={esTransferencia(pago.tipo_componente) && !form.sociedad_id}>
                      <option value="">— Seleccioná —</option>
                      {cuentasFiltradas.map(c => (
                        <option key={c.id} value={c.id}>{ctaLabel(c, sociedades)}</option>
                      ))}
                    </select>
                }
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button onClick={() => setEditMode(false)} style={BTN_SECONDARY}>Cancelar</button>
              <button onClick={handleGuardar} disabled={saving} style={{
                background: saving ? T.dim : T.blue, color: "#fff", border: "none",
                borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
              }}>
                {saving ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Modal pago HQ (individual) ────────────────────────────────────────────────

function ModalPagoHQ({ mes, anio, liq, linea, onClose, onSaved }) {
  const tipo = linea?.tipo ?? "haberes";
  const [form, setForm] = useState({
    monto:              linea?.importe ?? "",
    fecha:              new Date().toISOString().slice(0, 10),
    sociedad_id:        "",   // solo para transferencia
    cuenta_id:          "",
    cuenta_contable_id: "",
  });
  const [cuentas,          setCuentas]          = useState([]);
  const [sociedades,       setSociedades]       = useState([]);
  const [cuentasContables, setCuentasContables] = useState([]);
  const [loadingCtas,      setLoadingCtas]      = useState(true);
  const [saving,           setSaving]           = useState(false);
  const savingRef = useRef(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    Promise.all([fetchSociedadesNumbers(), fetchCuentasBancariasNumbers(), fetchCuentasContablesNumbers()])
      .then(([socs, ctas, cc]) => { setSociedades(socs); setCuentas(ctas); setCuentasContables(cc); })
      .finally(() => setLoadingCtas(false));
  }, []);

  const socFiltro = useMemo(() => {
    if (tipo === "haberes")  return liq?.sociedad_id ?? "";
    if (tipo === "deposito") return "beta";
    if (tipo === "efectivo") return "beta";  // caja de Beta
    return form.sociedad_id;                 // transferencia: el usuario elige
  }, [tipo, form.sociedad_id, liq?.sociedad_id]);

  const cuentasFiltradas = useMemo(() =>
    socFiltro ? cuentas.filter(c => c.sociedad === socFiltro) : [],
  [cuentas, socFiltro]);

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!form.monto) { alert("Completá el monto."); return; }
    if (!form.cuenta_id) { alert("Seleccioná una cuenta bancaria."); return; }
    savingRef.current = true; setSaving(true);
    try {
      const cta = cuentas.find(c => c.id === form.cuenta_id);
      await appendPago({
        mes, anio,
        legajo_id:               liq.legajo_id,
        legajo_nombre:           liq.legajo_nombre,
        sociedad_id:             liq.sociedad_id,
        sociedad_nombre:         liq.sociedad_nombre,
        tipo_componente:         tipo,
        forma_pago_id:           linea?.id ?? "",
        monto:                   parseFloat(form.monto) || 0,
        fecha:                   form.fecha,
        cuenta_bancaria_id:      form.cuenta_id,
        cuenta_bancaria_nombre:  cta?.nombre ?? "",
        cuenta_contable_id:      form.cuenta_contable_id,
        cuenta_contable_nombre:  cuentasContables.find(c => c.id === form.cuenta_contable_id)?.nombre ?? "",
        concepto:                linea?.nota ? `Sueldo ${liq.legajo_nombre} ${mes}/${anio} · ${linea.nota}` : "",
      });
      await onSaved();
    } catch (e) { alert("Error: " + e.message); setSaving(false); } finally { savingRef.current = false; }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: T.font }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>Registrar pago — {liq?.legajo_nombre}</h3>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: T.muted }}>Pendiente: {fmtMoney(liq?.pendiente)}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {linea && (
            <div style={{ fontSize: 12, color: T.muted, background: T.bg, borderRadius: 5, padding: "8px 10px" }}>
              <strong style={{ color: FP_TIPO_COLOR[tipo] || T.text }}>{FP_TIPO_LABEL[tipo] || tipo}</strong>
              {" → "}{describirDestino(linea)}
            </div>
          )}
          <div>
            <ModalLabel>Monto (ARS)</ModalLabel>
            <input style={MODAL_INPUT} type="number" value={form.monto} onChange={e => set("monto", e.target.value)} />
          </div>
          <div>
            <ModalLabel>Fecha</ModalLabel>
            <input style={MODAL_INPUT} type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} />
          </div>
          {esTransferencia(tipo) && (
            <div>
              <ModalLabel>Sociedad que transfiere</ModalLabel>
              <select style={MODAL_INPUT} value={form.sociedad_id}
                onChange={e => setForm(f => ({ ...f, sociedad_id: e.target.value, cuenta_id: "" }))}>
                <option value="">— Seleccioná —</option>
                {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          )}
          {(tipo === "deposito" || tipo === "efectivo") && (
            <div style={{ fontSize: 12, color: T.muted, background: T.bg, borderRadius: 5, padding: "6px 10px" }}>
              Sociedad: <strong style={{ color: T.text }}>Beta</strong>
            </div>
          )}
          <div>
            <ModalLabel>{tipo === "efectivo" ? "Caja" : "Cuenta bancaria"} (origen)</ModalLabel>
            {loadingCtas
              ? <div style={{ fontSize: 12, color: T.muted }}>Cargando…</div>
              : <select style={MODAL_INPUT} value={form.cuenta_id} onChange={e => set("cuenta_id", e.target.value)}
                  disabled={esTransferencia(tipo) && !form.sociedad_id}>
                  <option value="">— Seleccioná —</option>
                  {cuentasFiltradas.map(c => (
                    <option key={c.id} value={c.id}>{ctaLabel(c, sociedades)}</option>
                  ))}
                </select>
            }
          </div>
          <div>
            <ModalLabel>Cuenta contable</ModalLabel>
            <select style={MODAL_INPUT} value={form.cuenta_contable_id} onChange={e => set("cuenta_contable_id", e.target.value)}>
              <option value="">— Opcional —</option>
              {cuentasContables.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={BTN_SECONDARY}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{
            background: saving ? T.dim : T.green, color: "#fff", border: "none",
            borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
          }}>
            {saving ? "Procesando…" : "Registrar y enviar a Tesorería"}
          </button>
        </div>
      </div>
    </div>
  );
}
