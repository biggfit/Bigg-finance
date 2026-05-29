import { useState, useEffect, useRef, useMemo } from "react";
import {
  fetchLegajos, fetchLiquidaciones, saveLiquidacion, updateLegajo,
  fetchPagos, appendPago, ROLES_HQ,
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
const hoy = new Date();

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

// ── Componente principal ──────────────────────────────────────────────────────

export default function PantallaLiquidacionHQ() {
  const [mes,  setMes]  = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());

  const [legajos,       setLegajos]       = useState([]);
  const [liquidaciones, setLiquidaciones] = useState([]);
  const [pagos,         setPagos]         = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);

  // Wizard state
  const [paso,             setPaso]             = useState(1);
  const [sueldosDraft,     setSueldosDraft]     = useState({});  // { [legajo_id]: { pct: "", total: N } }
  const [actualizarLegs,   setActualizarLegs]   = useState(false);
  const [pagoDraft,        setPagoDraft]        = useState({});  // { [legajo_id]: { monto_haberes, monto_monotributo } }
  const [showPago,         setShowPago]         = useState(null);

  useEffect(() => { load(); setPaso(1); }, [mes, anio]);

  async function load() {
    setLoading(true);
    try {
      const [legs, liqs, pags] = await Promise.all([
        fetchLegajos(),
        fetchLiquidaciones(mes, anio),
        fetchPagos(mes, anio),
      ]);
      setLegajos(legs.filter(l => ROLES_HQ.includes(l.rol) && l.activo));
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
      await Promise.all(nuevos.map(leg => saveLiquidacion({
        mes, anio,
        legajo_id: leg.id, legajo_nombre: leg.nombre,
        sociedad_id: leg.sociedad_id, sociedad_nombre: leg.sociedad_nombre,
        sede_id: leg.sede_id, sede_nombre: leg.sede_nombre,
        rol: leg.rol, tipo_contratacion: leg.tipo_contratacion,
        sueldo_base:      leg.sueldo_total || leg.blanco_neto,
        monto_haberes:    leg.blanco_neto,
        monto_monotributo: 0,
        monto_efectivo:   Math.max(0, (leg.sueldo_total || 0) - (leg.blanco_neto || 0)),
        estado: "borrador",
      })));
      await load();
    } finally { setSaving(false); }
  }

  // Enriquecer liquidaciones con datos del legajo y pagos
  const liqs = useMemo(() => {
    return liquidaciones.map(liq => {
      const leg              = legajos.find(l => l.id === liq.legajo_id);
      const pagosMios        = pagos.filter(p => p.legajo_id === liq.legajo_id);
      const totalPagado      = pagosMios.reduce((s, p) => s + p.monto, 0);
      const sueldo_total_legajo = leg?.sueldo_total || 0;
      const efectivo_real    = Math.max(0, sueldo_total_legajo - (liq.monto_haberes || 0) - (liq.monto_monotributo || 0));
      const total_bruto      = (liq.monto_haberes || 0) + (liq.monto_monotributo || 0) + efectivo_real;
      return {
        ...liq,
        sueldo_total_legajo,
        blanco_neto_legajo: leg?.blanco_neto || 0,
        pagos: pagosMios,
        total_bruto,
        total_pagado: totalPagado,
        pendiente: total_bruto - totalPagado,
      };
    });
  }, [liquidaciones, pagos, legajos]);

  // Inicializar sueldosDraft cuando cargan liqs (solo entradas nuevas)
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

  const getDraftTotal = (liq) => sueldosDraft[liq.legajo_id]?.total ?? liq.sueldo_total_legajo;

  // Paso 1 → 2: opcionalmente actualizar legajos, luego init pagoDraft
  async function handleConfirmarSueldos() {
    if (actualizarLegs) {
      setSaving(true);
      try {
        await Promise.all(liqs.map(liq => {
          const nuevoTotal = getDraftTotal(liq);
          if (nuevoTotal === liq.sueldo_total_legajo) return null;
          return updateLegajo(liq.legajo_id, { sueldo_total: nuevoTotal });
        }).filter(Boolean));
        await load();
      } finally { setSaving(false); }
    }
    // Pre-llenar pagoDraft desde blanco_neto del legajo (o valor ya guardado)
    setPagoDraft(() => {
      const d = {};
      liqs.forEach(liq => {
        d[liq.legajo_id] = {
          monto_haberes:    liq.monto_haberes || liq.blanco_neto_legajo || 0,
          monto_monotributo: liq.monto_monotributo || 0,
        };
      });
      return d;
    });
    setPaso(2);
  }

  // Paso 2 → 3: guardar liquidaciones con los componentes definidos
  async function handleConfirmarPago() {
    setSaving(true);
    try {
      await Promise.all(liqs.map(liq => {
        const target = getDraftTotal(liq);
        const d          = pagoDraft[liq.legajo_id] || {};
        const haberes    = d.monto_haberes    || 0;
        const deposito   = d.monto_monotributo || 0;
        const efectivo   = Math.max(0, target - haberes - deposito);
        return saveLiquidacion({
          ...liq,
          sueldo_base:       target,
          monto_haberes:     haberes,
          monto_monotributo: deposito,
          monto_efectivo:    efectivo,
        });
      }));
      await load();
      setPaso(3);
    } finally { setSaving(false); }
  }

  const liqStaff  = liqs.filter(l => l.rol === "HQ");
  const liqOwners = liqs.filter(l => l.rol === "HQ_OWNER");

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
          <StepsIndicator paso={paso} onPaso={p => p < paso && setPaso(p)} />

          {paso === 1 && (
            <PasoSueldos
              liqStaff={liqStaff} liqOwners={liqOwners}
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
              liqStaff={liqStaff} liqOwners={liqOwners}
              sueldosDraft={sueldosDraft}
              pagoDraft={pagoDraft}
              onChangePago={(id, field, val) =>
                setPagoDraft(d => ({ ...d, [id]: { ...(d[id] || {}), [field]: val } }))
              }
              onAtras={() => setPaso(1)}
              onSiguiente={handleConfirmarPago}
              saving={saving}
            />
          )}

          {paso === 3 && (
            <PasoPagos
              liqStaff={liqStaff} liqOwners={liqOwners}
              onAtras={() => setPaso(2)}
              onRegistrarPago={setShowPago}
            />
          )}
        </>
      )}

      {showPago && (
        <ModalPagoHQ
          mes={mes} anio={anio}
          liq={liqs.find(l => l.legajo_id === showPago)}
          onClose={() => setShowPago(null)}
          onSaved={async () => { setShowPago(null); await load(); }}
        />
      )}
    </div>
  );
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

function PasoSueldos({ liqStaff, liqOwners, sueldosDraft, onChangeDraft, actualizarLegs, onChangeActualizar, onSiguiente, saving }) {
  const [pctGlobal, setPctGlobal] = useState("");

  const todos       = [...liqStaff, ...liqOwners];
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

  const renderTabla = (liqs, ownerStyle, esElPrimero = false) => (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 8 }}>
      <thead>
        <tr>
          <th style={TH()}>Nombre</th>
          <th style={TH({ textAlign: "right" })}>Sueldo actual</th>
          <th style={TH({ textAlign: "right" })}>
            {esElPrimero ? (
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
            ) : "% aumento"}
          </th>
          <th style={TH({ textAlign: "right" })}>Nuevo sueldo</th>
        </tr>
      </thead>
      <tbody>
        {liqs.map((liq, i) => {
          const d          = sueldosDraft[liq.legajo_id];
          const pct        = d?.pct   ?? "";
          const nuevoTotal = d?.total ?? liq.sueldo_total_legajo;
          const subio      = nuevoTotal > liq.sueldo_total_legajo;
          return (
            <tr key={liq.id} style={{ background: i % 2 === 0 ? "#fff" : T.bg }}>
              <td style={TD({ fontWeight: 600 })}>
                {liq.legajo_nombre}
                {ownerStyle && (
                  <span style={{ marginLeft: 6, fontSize: 10, background: "#f3e8ff", color: T.purple, padding: "1px 5px", borderRadius: 3, fontWeight: 600 }}>Owner</span>
                )}
              </td>
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
                    type="number" value={nuevoTotal || ""}
                    onChange={e => handleTotal(liq, e.target.value)}
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
  );

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

      {liqStaff.length > 0 && (
        <>
          <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700 }}>HQ Staff</h3>
          {renderTabla(liqStaff, false, true)}
        </>
      )}
      {liqOwners.length > 0 && (
        <>
          <h3 style={{ margin: "20px 0 10px", fontSize: 14, fontWeight: 700, color: T.purple }}>⬡ Socios / HQ Owner</h3>
          {renderTabla(liqOwners, true, liqStaff.length === 0)}
        </>
      )}
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

function PasoPago({ liqStaff, liqOwners, sueldosDraft, pagoDraft, onChangePago, onAtras, onSiguiente, saving }) {
  const getTarget = (liq) => sueldosDraft[liq.legajo_id]?.total ?? liq.sueldo_total_legajo;

  const renderTabla = (liqs) => (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 8 }}>
      <thead>
        <tr>
          <th style={TH()}>Nombre</th>
          <th style={TH({ textAlign: "right" })}>Sueldo total</th>
          <th style={TH({ textAlign: "right" })}>Haberes</th>
          <th style={TH({ textAlign: "right" })}>Depósito</th>
          <th style={TH({ textAlign: "right" })}>Efectivo</th>
        </tr>
      </thead>
      <tbody>
        {liqs.map((liq, i) => {
          const target   = getTarget(liq);
          const d        = pagoDraft[liq.legajo_id] || {};
          const haberes  = d.monto_haberes    ?? 0;
          const deposito = d.monto_monotributo ?? 0;
          const efectivo = Math.max(0, target - haberes - deposito);
          return (
            <tr key={liq.id} style={{ background: i % 2 === 0 ? "#fff" : T.bg }}>
              <td style={TD({ fontWeight: 600 })}>{liq.legajo_nombre}</td>
              <td style={TD({ textAlign: "right", fontWeight: 700, color: T.blue })}>{fmtMoney(target)}</td>
              <td style={TD({ textAlign: "right" })}>
                <input type="number" value={haberes}
                  onChange={e => onChangePago(liq.legajo_id, "monto_haberes", parseFloat(e.target.value) || 0)}
                  style={INPUT({ width: 110 })} />
              </td>
              <td style={TD({ textAlign: "right" })}>
                <input type="number" value={deposito}
                  onChange={e => onChangePago(liq.legajo_id, "monto_monotributo", parseFloat(e.target.value) || 0)}
                  style={INPUT({ width: 110 })} />
              </td>
              <td style={TD({ textAlign: "right" })}>
                <div style={{
                  display: "inline-block", minWidth: 110, background: "#fefce8",
                  border: "1px solid #fde68a", borderRadius: 5, padding: "4px 8px",
                  color: "#92400e", fontWeight: 700, textAlign: "right",
                }}>
                  {fmtMoney(efectivo)}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div>
      {liqStaff.length > 0 && (
        <>
          <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700 }}>HQ Staff</h3>
          {renderTabla(liqStaff)}
        </>
      )}
      {liqOwners.length > 0 && (
        <>
          <h3 style={{ margin: "20px 0 10px", fontSize: 14, fontWeight: 700, color: T.purple }}>⬡ Socios / HQ Owner</h3>
          {renderTabla(liqOwners)}
        </>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "16px 0", borderTop: `1px solid ${T.border}`, marginTop: 8 }}>
        <button onClick={onAtras} style={BTN_SECONDARY}>← Atrás</button>
        <button onClick={onSiguiente} disabled={saving} style={BTN_PRIMARY(saving)}>
          {saving ? "Guardando…" : "Guardar y continuar →"}
        </button>
      </div>
    </div>
  );
}

// ── Paso 3: Registrar pagos ───────────────────────────────────────────────────

function PasoPagos({ liqStaff, liqOwners, onAtras, onRegistrarPago }) {
  const renderTabla = (liqs) => (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 8 }}>
      <thead>
        <tr>
          <th style={TH()}>Nombre</th>
          <th style={TH({ textAlign: "right" })}>Haberes</th>
          <th style={TH({ textAlign: "right" })}>Depósito</th>
          <th style={TH({ textAlign: "right" })}>Efectivo</th>
          <th style={TH({ textAlign: "right" })}>Total</th>
          <th style={TH({ textAlign: "right" })}>Pagado</th>
          <th style={TH({ textAlign: "right" })}>Pendiente</th>
          <th style={TH()}></th>
        </tr>
      </thead>
      <tbody>
        {liqs.map((liq, i) => {
          const efectivo  = Math.max(0, liq.sueldo_total_legajo - (liq.monto_haberes || 0) - (liq.monto_monotributo || 0));
          const pendiente = liq.pendiente;
          return (
            <tr key={liq.id} style={{ background: i % 2 === 0 ? "#fff" : T.bg }}>
              <td style={TD({ fontWeight: 600 })}>
                {liq.legajo_nombre}
                {liq.pagos?.length > 0 && (
                  <div style={{ fontSize: 11, color: T.green, marginTop: 2 }}>
                    {liq.pagos.map(p => `${p.tipo_componente} ${fmtMoney(p.monto)}`).join(" · ")}
                  </div>
                )}
              </td>
              <td style={TD({ textAlign: "right" })}>{fmtMoney(liq.monto_haberes)}</td>
              <td style={TD({ textAlign: "right", color: liq.monto_monotributo > 0 ? "#0369a1" : T.dim })}>
                {liq.monto_monotributo > 0 ? fmtMoney(liq.monto_monotributo) : "—"}
              </td>
              <td style={TD({ textAlign: "right", color: efectivo > 0 ? T.yellow : T.dim })}>
                {efectivo > 0 ? fmtMoney(efectivo) : "—"}
              </td>
              <td style={TD({ textAlign: "right", fontWeight: 700, color: T.blue })}>{fmtMoney(liq.total_bruto)}</td>
              <td style={TD({ textAlign: "right", color: T.green })}>{fmtMoney(liq.total_pagado)}</td>
              <td style={TD({ textAlign: "right", fontWeight: 600, color: pendiente > 0 ? T.red : T.green })}>
                {fmtMoney(pendiente)}
              </td>
              <td style={TD({ whiteSpace: "nowrap" })}>
                {pendiente > 0 ? (
                  <button onClick={() => onRegistrarPago(liq.legajo_id)} style={{
                    background: T.green, color: "#fff", border: "none", borderRadius: 6,
                    padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>💳 Pagar</button>
                ) : (
                  <span style={{ fontSize: 12, color: T.green, fontWeight: 600 }}>✓ Pagado</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const totalBruto  = [...liqStaff, ...liqOwners].reduce((s, l) => s + l.total_bruto,  0);
  const totalPagado = [...liqStaff, ...liqOwners].reduce((s, l) => s + l.total_pagado, 0);
  const totalPend   = totalBruto - totalPagado;

  return (
    <div>
      {/* Resumen */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Total a pagar",  value: totalBruto,  color: T.text },
          { label: "Pagado",         value: totalPagado, color: T.green },
          { label: "Pendiente",      value: totalPend,   color: totalPend > 0 ? T.red : T.green },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color }}>{fmtMoney(value)}</div>
          </div>
        ))}
      </div>

      {liqStaff.length > 0 && (
        <>
          <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700 }}>HQ Staff</h3>
          {renderTabla(liqStaff)}
        </>
      )}
      {liqOwners.length > 0 && (
        <>
          <h3 style={{ margin: "20px 0 10px", fontSize: 14, fontWeight: 700, color: T.purple }}>⬡ Socios / HQ Owner</h3>
          {renderTabla(liqOwners)}
        </>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "16px 0", borderTop: `1px solid ${T.border}`, marginTop: 8 }}>
        <button onClick={onAtras} style={BTN_SECONDARY}>← Atrás</button>
      </div>
    </div>
  );
}

// ── Modal pago HQ ─────────────────────────────────────────────────────────────

function ModalPagoHQ({ mes, anio, liq, onClose, onSaved }) {
  const [form, setForm] = useState({
    tipo_componente: "haberes",
    monto: liq?.monto_haberes ?? "",
    fecha: new Date().toISOString().slice(0, 10),
    cuenta_bancaria_nombre: "",
    concepto: "",
  });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleTipo = (tipo) => {
    let monto = "";
    if (tipo === "haberes")        monto = liq?.monto_haberes     ?? "";
    if (tipo === "monotributista") monto = liq?.monto_monotributo ?? "";
    if (tipo === "efectivo") {
      const ef = Math.max(0, (liq?.sueldo_total_legajo || 0) - (liq?.monto_haberes || 0) - (liq?.monto_monotributo || 0));
      monto = ef || "";
    }
    set("tipo_componente", tipo);
    if (monto) set("monto", monto);
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!form.monto || !form.cuenta_bancaria_nombre) { alert("Completá monto y cuenta bancaria."); return; }
    savingRef.current = true; setSaving(true);
    try {
      await appendPago({
        mes, anio,
        legajo_id: liq.legajo_id, legajo_nombre: liq.legajo_nombre,
        sociedad_id: liq.sociedad_id, sociedad_nombre: liq.sociedad_nombre,
        tipo_componente: form.tipo_componente,
        monto: parseFloat(form.monto) || 0,
        fecha: form.fecha,
        cuenta_bancaria_id: form.cuenta_bancaria_nombre,
        cuenta_bancaria_nombre: form.cuenta_bancaria_nombre,
        concepto: form.concepto,
      });
      await onSaved();
    } catch (e) { alert("Error: " + e.message); setSaving(false); } finally { savingRef.current = false; }
  };

  const inputStyle = {
    border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px",
    fontSize: 13, fontFamily: T.font, width: "100%", boxSizing: "border-box",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: T.font }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>Registrar pago — {liq?.legajo_nombre}</h3>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: T.muted }}>Pendiente: {fmtMoney(liq?.pendiente)}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Componente</label>
            <select style={inputStyle} value={form.tipo_componente} onChange={e => handleTipo(e.target.value)}>
              <option value="haberes">Haberes (recibo / transferencia)</option>
              <option value="monotributista">Depósito bancario</option>
              <option value="efectivo">Efectivo</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Monto (ARS)</label>
            <input style={inputStyle} type="number" value={form.monto} onChange={e => set("monto", e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Fecha</label>
            <input style={inputStyle} type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Cuenta bancaria</label>
            <input style={inputStyle} value={form.cuenta_bancaria_nombre} onChange={e => set("cuenta_bancaria_nombre", e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>Concepto (opcional)</label>
            <input style={inputStyle} value={form.concepto} onChange={e => set("concepto", e.target.value)} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ border: "1px solid #94a3b8", background: "#fff", borderRadius: 7, padding: "7px 14px", fontSize: 13, cursor: "pointer", color: T.text }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{ background: saving ? T.dim : T.green, color: "#fff", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Procesando…" : "Registrar y enviar a Tesorería"}
          </button>
        </div>
      </div>
    </div>
  );
}
