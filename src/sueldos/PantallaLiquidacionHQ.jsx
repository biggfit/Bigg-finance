import { useState, useEffect, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import {
  fetchLegajos, fetchLiquidaciones, saveLiquidacion, updateLegajo,
  fetchPagos, appendPago, deletePago, ROLES_HQ,
  fetchSociedadesNumbers, fetchCuentasBancariasNumbers,
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
  const [liqsPrevMes,      setLiqsPrevMes]      = useState([]);
  const [showPago,         setShowPago]         = useState(null);

  useEffect(() => { load(); setPaso(1); }, [mes, anio]);

  async function load() {
    setLoading(true);
    const mesPrev  = mes === 1 ? 12 : mes - 1;
    const anioPrev = mes === 1 ? anio - 1 : anio;
    try {
      const [legs, liqs, pags, liqsPrev] = await Promise.all([
        fetchLegajos(),
        fetchLiquidaciones(mes, anio),
        fetchPagos(mes, anio),
        fetchLiquidaciones(mesPrev, anioPrev),
      ]);
      setLegajos(legs.filter(l => ROLES_HQ.includes(l.rol) && l.activo));
      setLiquidaciones(liqs.filter(l => ROLES_HQ.includes(l.rol)));
      setPagos(pags);
      setLiqsPrevMes(liqsPrev.filter(l => ROLES_HQ.includes(l.rol)));
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
        sueldo_base:         leg.sueldo_total || leg.blanco_neto,
        monto_haberes:       leg.blanco_neto,
        monto_deposito:      0,
        monto_transferencia: 0,
        monto_efectivo:      Math.max(0, (leg.sueldo_total || 0) - (leg.blanco_neto || 0)),
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
      const efectivo_real    = Math.max(0, sueldo_total_legajo - (liq.monto_haberes || 0) - (liq.monto_deposito || 0) - (liq.monto_transferencia || 0));
      const total_bruto      = (liq.monto_haberes || 0) + (liq.monto_deposito || 0) + (liq.monto_transferencia || 0) + efectivo_real;
      return {
        ...liq,
        sueldo_total_legajo,
        blanco_neto_legajo: leg?.blanco_neto || 0,
        cbu:   leg?.cbu   || "",
        banco: leg?.banco || "",
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
    // Pre-llenar pagoDraft: valor guardado en el período actual > mes anterior > 0
    setPagoDraft(() => {
      const d = {};
      liqs.forEach(liq => {
        const prev = liqsPrevMes.find(l => l.legajo_id === liq.legajo_id);
        d[liq.legajo_id] = {
          monto_haberes:       liq.monto_haberes       || liq.blanco_neto_legajo  || 0,
          monto_deposito:      liq.monto_deposito      || prev?.monto_deposito      || 0,
          monto_transferencia: liq.monto_transferencia || prev?.monto_transferencia || 0,
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
        const target       = getDraftTotal(liq);
        const d            = pagoDraft[liq.legajo_id] || {};
        const haberes      = d.monto_haberes       || 0;
        const deposito     = d.monto_deposito      || 0;
        const transferencia = d.monto_transferencia || 0;
        const efectivo     = Math.max(0, target - haberes - deposito - transferencia);
        return saveLiquidacion({
          ...liq,
          sueldo_base:         target,
          monto_haberes:       haberes,
          monto_deposito:      deposito,
          monto_transferencia: transferencia,
          monto_efectivo:      efectivo,
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
              mes={mes} anio={anio}
              liqStaff={liqStaff} liqOwners={liqOwners}
              onAtras={() => setPaso(2)}
              onRegistrarPago={setShowPago}
              onBatchPaid={load}
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

  // Clampea el valor ingresado para que la suma nunca supere el sueldo total
  const handleCampo = (liq, campo, rawVal) => {
    const target  = getTarget(liq);
    const d       = pagoDraft[liq.legajo_id] || {};
    const parsed  = parseFloat(rawVal) || 0;
    const otros   = ["monto_haberes", "monto_deposito", "monto_transferencia"]
      .filter(f => f !== campo)
      .reduce((s, f) => s + (d[f] ?? 0), 0);
    const clamped = Math.min(parsed, Math.max(0, target - otros));
    onChangePago(liq.legajo_id, campo, clamped);
  };

  const renderTabla = (liqs) => (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 8 }}>
      <thead>
        <tr>
          <th style={TH()}>Nombre</th>
          <th style={TH({ textAlign: "right" })}>Sueldo total</th>
          <th style={TH({ textAlign: "right" })}>Haberes</th>
          <th style={TH({ textAlign: "right" })}>Depósito</th>
          <th style={TH({ textAlign: "right" })}>Transferencia</th>
          <th style={TH({ textAlign: "right" })}>Efectivo</th>
        </tr>
      </thead>
      <tbody>
        {liqs.map((liq, i) => {
          const target        = getTarget(liq);
          const d             = pagoDraft[liq.legajo_id] || {};
          const haberes       = d.monto_haberes       ?? 0;
          const deposito      = d.monto_deposito      ?? 0;
          const transferencia = d.monto_transferencia ?? 0;
          const efectivo      = Math.max(0, target - haberes - deposito - transferencia);
          return (
            <tr key={liq.id} style={{ background: i % 2 === 0 ? "#fff" : T.bg }}>
              <td style={TD({ fontWeight: 600 })}>{liq.legajo_nombre}</td>
              <td style={TD({ textAlign: "right", fontWeight: 700, color: T.blue })}>{fmtMoney(target)}</td>
              <td style={TD({ textAlign: "right" })}>
                <input type="number" value={haberes}
                  onChange={e => handleCampo(liq, "monto_haberes", e.target.value)}
                  style={INPUT({ width: 100 })} />
              </td>
              <td style={TD({ textAlign: "right" })}>
                <input type="number" value={deposito}
                  onChange={e => handleCampo(liq, "monto_deposito", e.target.value)}
                  style={INPUT({ width: 100 })} />
              </td>
              <td style={TD({ textAlign: "right" })}>
                <input type="number" value={transferencia}
                  onChange={e => handleCampo(liq, "monto_transferencia", e.target.value)}
                  style={INPUT({ width: 100 })} />
              </td>
              <td style={TD({ textAlign: "right" })}>
                <div style={{
                  display: "inline-block", minWidth: 90, background: "#fefce8",
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

function exportarHaberes(liqs, mes, anio) {
  const desc = `Sueldo ${String(mes).padStart(2, "0")}/${anio}`.slice(0, 12);
  const filas = liqs
    .filter(l => (l.monto_haberes || 0) > 0 && l.cbu)
    .map(l => [l.cbu, l.monto_haberes, "acreditamiento de haberes", desc, "", ""]);
  if (!filas.length) { alert("No hay empleados con Haberes y CBU cargado."); return; }
  descargarExcelGalicia(filas, `Haberes_HQ_${String(mes).padStart(2,"0")}_${anio}.xlsx`);
}

function exportarDeposito(liqs, mes, anio) {
  const desc = `Dep ${String(mes).padStart(2, "0")}/${anio}`.slice(0, 12);
  const filas = liqs
    .filter(l => (l.monto_deposito || 0) > 0 && l.cbu)
    .map(l => [l.cbu, l.monto_deposito, "varios", desc, "", ""]);
  if (!filas.length) { alert("No hay empleados con Depósito y CBU cargado."); return; }
  descargarExcelGalicia(filas, `Deposito_HQ_${String(mes).padStart(2,"0")}_${anio}.xlsx`);
}

// ── Paso 3: Registrar pagos ───────────────────────────────────────────────────

const TIPOS_PAGO = [
  { id: "haberes",       label: "Haberes",       color: T.text },
  { id: "deposito",      label: "Depósito",      color: "#0369a1" },
  { id: "transferencia", label: "Transferencia", color: T.purple },
  { id: "efectivo",      label: "Efectivo",      color: T.yellow },
];

function getEfectivo(liq) {
  return Math.max(0, liq.sueldo_total_legajo - (liq.monto_haberes || 0) - (liq.monto_deposito || 0) - (liq.monto_transferencia || 0));
}

function getMontoTipo(liq, tipo) {
  if (tipo === "haberes")       return liq.monto_haberes       || 0;
  if (tipo === "deposito")      return liq.monto_deposito      || 0;
  if (tipo === "transferencia") return liq.monto_transferencia || 0;
  return getEfectivo(liq);
}

function isPaid(liq, tipo) {
  return liq.pagos?.some(p => p.tipo_componente === tipo) ?? false;
}

function PasoPagos({ mes, anio, liqStaff, liqOwners, onAtras, onRegistrarPago, onBatchPaid }) {
  const [batchModal,  setBatchModal]  = useState(null); // { tipo }
  const [anularModal, setAnularModal] = useState(null); // pago object

  const todos = [...liqStaff, ...liqOwners];

  // Empleados pendientes de pago para un tipo dado
  const pendientesTipo = (tipo) =>
    todos.filter(l => getMontoTipo(l, tipo) > 0 && !isPaid(l, tipo));

  const renderTabla = (liqs) => (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 8 }}>
      <thead>
        <tr>
          <th style={TH()}>Nombre</th>
          <th style={TH({ textAlign: "right" })}>Total</th>
          {TIPOS_PAGO.map(({ id, label }) => {
            const pend   = pendientesTipo(id);
            const hayAlgo = todos.some(l => getMontoTipo(l, id) > 0);
            const todoPagado = hayAlgo && pend.length === 0;
            return (
              <th key={id} style={TH({ textAlign: "right" })}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                  {label}
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20 }}>
                    {todoPagado
                      ? <span title="Todos pagados" style={{ fontSize: 11, color: T.green, fontWeight: 700 }}>✓</span>
                      : hayAlgo
                        ? <button
                            onClick={() => setBatchModal({ tipo: id })}
                            title={`Confirmar pago de ${label}`}
                            style={{
                              background: T.green, color: "#fff", border: "none",
                              borderRadius: 4, padding: "1px 6px", fontSize: 10,
                              fontWeight: 700, cursor: "pointer", lineHeight: "1.6",
                              fontFamily: T.font,
                            }}>✓</button>
                        : null
                    }
                  </span>
                </div>
              </th>
            );
          })}
          <th style={TH({ textAlign: "right" })}>Pagado</th>
          <th style={TH({ textAlign: "right" })}>Pendiente</th>
          <th style={TH()}></th>
        </tr>
      </thead>
      <tbody>
        {liqs.map((liq, i) => {
          const efectivo  = getEfectivo(liq);
          const pendiente = liq.pendiente;
          const montos    = { haberes: liq.monto_haberes || 0, deposito: liq.monto_deposito || 0, transferencia: liq.monto_transferencia || 0, efectivo };

          return (
            <tr key={liq.id} style={{ background: i % 2 === 0 ? "#fff" : T.bg }}>
              <td style={TD({ fontWeight: 600 })}>{liq.legajo_nombre}</td>
              <td style={TD({ textAlign: "right", fontWeight: 700, color: T.blue })}>{fmtMoney(liq.total_bruto)}</td>

              {TIPOS_PAGO.map(({ id, color }) => {
                const monto = montos[id];
                const paid  = isPaid(liq, id);
                const pago  = paid ? liq.pagos.find(p => p.tipo_componente === id) : null;
                if (!monto) return (
                  <td key={id} style={TD({ textAlign: "right" })}>
                    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
                      <span style={{ color: T.dim }}>—</span>
                      <span style={{ width: 20 }} />
                    </div>
                  </td>
                );
                return (
                  <td key={id} style={TD({ textAlign: "right", color: paid ? T.green : color })}>
                    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
                      {fmtMoney(monto)}
                      <span style={{ display: "inline-flex", justifyContent: "center", width: 20, fontSize: 11, fontWeight: 700 }}>
                        {pago
                          ? <button
                              onClick={() => setAnularModal(pago)}
                              title="Ver / anular este pago"
                              style={{ background: "none", border: "none", cursor: "pointer", color: T.green, fontSize: 12, fontWeight: 700, padding: 0, lineHeight: 1 }}>✓</button>
                          : ""
                        }
                      </span>
                    </div>
                  </td>
                );
              })}

              <td style={TD({ textAlign: "right", color: T.green })}>{fmtMoney(liq.total_pagado)}</td>
              <td style={TD({ textAlign: "right", fontWeight: 600, color: pendiente > 0 ? T.red : T.green })}>
                {fmtMoney(pendiente)}
              </td>
              <td style={TD({ whiteSpace: "nowrap" })}>
                {pendiente > 0
                  ? <button onClick={() => onRegistrarPago(liq.legajo_id)} style={{
                      background: "#fff", color: T.green, border: `1px solid ${T.green}`,
                      borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}>💳 Pagar</button>
                  : <span style={{ fontSize: 12, color: T.green, fontWeight: 600 }}>✓</span>
                }
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const totalBruto  = todos.reduce((s, l) => s + l.total_bruto,  0);
  const totalPagado = todos.reduce((s, l) => s + l.total_pagado, 0);
  const totalPend   = totalBruto - totalPagado;

  const BTN_EXPORT = (color) => ({
    display: "flex", alignItems: "center", gap: 6,
    border: `1px solid ${color}`, background: "#fff", borderRadius: 7,
    padding: "7px 14px", fontSize: 12, fontWeight: 600,
    cursor: "pointer", color, fontFamily: T.font,
  });

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

      {batchModal && (
        <ModalBatchPago
          tipo={batchModal.tipo}
          liqs={pendientesTipo(batchModal.tipo)}
          mes={mes} anio={anio}
          onClose={() => setBatchModal(null)}
          onSaved={() => { setBatchModal(null); onBatchPaid?.(); }}
        />
      )}

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

// ── Modal batch pago ──────────────────────────────────────────────────────────

function ModalBatchPago({ tipo, liqs, mes, anio, onClose, onSaved }) {
  const meta   = TIPOS_PAGO.find(t => t.id === tipo);
  const socFija = tipo === "deposito" || tipo === "efectivo" ? "beta" : null;

  const [form, setForm] = useState({
    fecha:        new Date().toISOString().slice(0, 10),
    sociedad_id:  socFija ?? "",
    cuenta_id:    "",
  });
  const [sociedades,  setSociedades]  = useState([]);
  const [cuentas,     setCuentas]     = useState([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  // Empleados seleccionados (empiezan todos tildados)
  const [selec, setSelec] = useState(() => new Set(liqs.map(l => l.legajo_id)));
  const [saving,    setSaving]    = useState(false);
  const savingRef = useRef(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    Promise.all([fetchSociedadesNumbers(), fetchCuentasBancariasNumbers()])
      .then(([socs, ctas]) => { setSociedades(socs); setCuentas(ctas); })
      .finally(() => setLoadingMeta(false));
  }, []);

  // Cuentas filtradas según la sociedad seleccionada (o todas si no aplica)
  const cuentasFiltradas = useMemo(() => {
    if (tipo === "haberes") return cuentas;          // haberes: cualquier cuenta (cada mov usa la soc del legajo)
    if (!form.sociedad_id)  return cuentas;
    return cuentas.filter(c => c.sociedad === form.sociedad_id);
  }, [cuentas, form.sociedad_id, tipo]);

  const liqsSelec = liqs.filter(l => selec.has(l.legajo_id));
  const total     = liqsSelec.reduce((s, l) => s + getMontoTipo(l, tipo), 0);

  const toggleSelec = (id) => setSelec(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!liqsSelec.length) { alert("Seleccioná al menos un empleado."); return; }
    if (!form.cuenta_id) { alert("Seleccioná una cuenta bancaria."); return; }
    savingRef.current = true; setSaving(true);
    try {
      const ctaNombre = cuentas.find(c => c.id === form.cuenta_id)?.nombre ?? form.cuenta_id;
      const socNombre = sociedades.find(s => s.id === form.sociedad_id)?.nombre ?? form.sociedad_id;
      await Promise.all(liqsSelec.map(liq => {
        const soc_id     = tipo === "haberes" ? liq.sociedad_id     : (form.sociedad_id || "beta");
        const soc_nombre = tipo === "haberes" ? liq.sociedad_nombre : socNombre;
        return appendPago({
          mes, anio,
          legajo_id:              liq.legajo_id,
          legajo_nombre:          liq.legajo_nombre,
          sociedad_id:            soc_id,
          sociedad_nombre:        soc_nombre,
          tipo_componente:        tipo,
          monto:                  getMontoTipo(liq, tipo),
          fecha:                  form.fecha,
          cuenta_bancaria_id:     form.cuenta_id,
          cuenta_bancaria_nombre: ctaNombre,
        });
      }));
      await onSaved();
    } catch (e) {
      alert("Error: " + e.message);
      setSaving(false);
    } finally {
      savingRef.current = false;
    }
  };

  const iStyle = {
    border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px",
    fontSize: 13, fontFamily: T.font, width: "100%", boxSizing: "border-box",
    color: T.text, background: "#fff",
  };
  const LBL = ({ children }) => (
    <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>{children}</label>
  );

  const mostrarSociedad = tipo === "transferencia";   // deposito/efectivo → fija Beta, haberes → no aplica

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 440, boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: T.font, maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>
          Confirmar pago — {meta?.label}
        </h3>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: T.muted }}>
          {liqsSelec.length} empleado{liqsSelec.length !== 1 ? "s" : ""} · Total <strong>{fmtMoney(total)}</strong>
        </p>

        {/* Lista con checkboxes */}
        <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, marginBottom: 16, maxHeight: 180, overflowY: "auto" }}>
          {liqs.map((liq, i) => {
            const checked = selec.has(liq.legajo_id);
            return (
              <label key={liq.legajo_id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "7px 10px", cursor: "pointer", fontSize: 13,
                borderBottom: i < liqs.length - 1 ? `1px solid ${T.border}` : "none",
                background: checked ? "#f0fdf4" : "#fff",
              }}>
                <input type="checkbox" checked={checked} onChange={() => toggleSelec(liq.legajo_id)}
                  style={{ accentColor: T.green, width: 14, height: 14, cursor: "pointer" }} />
                <span style={{ flex: 1, color: T.text }}>{liq.legajo_nombre}</span>
                <span style={{ fontWeight: 700, color: checked ? (meta?.color || T.text) : T.dim }}>
                  {fmtMoney(getMontoTipo(liq, tipo))}
                </span>
              </label>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Fecha */}
          <div>
            <LBL>Fecha</LBL>
            <input style={iStyle} type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} />
          </div>

          {/* Sociedad (solo para transferencia — deposito/efectivo muestran badge fijo) */}
          {mostrarSociedad && (
            <div>
              <LBL>Sociedad que transfiere</LBL>
              <select style={iStyle} value={form.sociedad_id} onChange={e => { set("sociedad_id", e.target.value); set("cuenta_id", ""); }}>
                <option value="">— Seleccioná —</option>
                {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          )}

          {/* Badge sociedad fija (deposito / efectivo) */}
          {socFija && (
            <div style={{ fontSize: 12, color: T.muted, background: T.bg, borderRadius: 5, padding: "6px 10px" }}>
              Sociedad: <strong style={{ color: T.text }}>Beta</strong>
            </div>
          )}

          {/* Cuenta bancaria — siempre visible (efectivo = caja de Beta) */}
          <div>
            <LBL>{tipo === "efectivo" ? "Caja" : "Cuenta bancaria"}</LBL>
            {loadingMeta
                ? <div style={{ fontSize: 12, color: T.muted }}>Cargando cuentas…</div>
                : <select style={iStyle} value={form.cuenta_id} onChange={e => set("cuenta_id", e.target.value)}>
                    <option value="">— Seleccioná —</option>
                    {cuentasFiltradas.map(c => {
                      const socNombre = sociedades.find(s => s.id === c.sociedad)?.nombre ?? c.sociedad;
                      const moneda    = c.moneda !== "ARS" ? ` (${c.moneda})` : "";
                      return <option key={c.id} value={c.id}>{socNombre} — {c.nombre}{moneda}</option>;
                    })}
                  </select>
              }
            </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={BTN_SECONDARY}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !liqsSelec.length} style={{
            background: (saving || !liqsSelec.length) ? T.dim : T.green, color: "#fff", border: "none",
            borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600,
            cursor: (saving || !liqsSelec.length) ? "not-allowed" : "pointer",
          }}>
            {saving ? "Procesando…" : `Confirmar ${liqsSelec.length} pago${liqsSelec.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
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
  const meta = TIPOS_PAGO.find(t => t.id === pago.tipo_componente);

  const handleStartEdit = () => {
    setLoadingCtas(true);
    Promise.all([fetchSociedadesNumbers(), fetchCuentasBancariasNumbers()])
      .then(([socs, ctas]) => { setSociedades(socs); setCuentas(ctas); })
      .finally(() => setLoadingCtas(false));
    setEditMode(true);
  };

  // Filtro de cuentas igual que en ModalPagoHQ
  const socFiltro = pago.tipo_componente === "haberes"  ? pago.sociedad_id
    : pago.tipo_componente === "transferencia"           ? form.sociedad_id
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
      // Borrar viejo + crear nuevo
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

  const iStyle = {
    border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px",
    fontSize: 13, fontFamily: T.font, width: "100%", boxSizing: "border-box",
    color: T.text, background: "#fff",
  };
  const LBL = ({ children }) => (
    <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>{children}</label>
  );
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
          {editMode ? "Los cambios reemplazan el pago y el movimiento en Tesorería." : `${meta?.label ?? pago.tipo_componente}`}
        </p>

        {!editMode ? (
          <>
            <div style={{ marginBottom: 20 }}>
              <ROW label="Tipo"   value={meta?.label ?? pago.tipo_componente} />
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
                <LBL>Monto (ARS)</LBL>
                <input style={iStyle} type="number" value={form.monto} onChange={e => set("monto", e.target.value)} />
              </div>
              <div>
                <LBL>Fecha</LBL>
                <input style={iStyle} type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} />
              </div>
              {pago.tipo_componente === "transferencia" && (
                <div>
                  <LBL>Sociedad que transfiere</LBL>
                  <select style={iStyle} value={form.sociedad_id}
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
                <LBL>{pago.tipo_componente === "efectivo" ? "Caja" : "Cuenta bancaria"}</LBL>
                {loadingCtas
                  ? <div style={{ fontSize: 12, color: T.muted }}>Cargando…</div>
                  : <select style={iStyle} value={form.cuenta_id} onChange={e => set("cuenta_id", e.target.value)}
                      disabled={pago.tipo_componente === "transferencia" && !form.sociedad_id}>
                      <option value="">— Seleccioná —</option>
                      {cuentasFiltradas.map(c => {
                        const soc = sociedades.find(s => s.id === c.sociedad)?.nombre ?? c.sociedad;
                        const mon = c.moneda !== "ARS" ? ` (${c.moneda})` : "";
                        return <option key={c.id} value={c.id}>{soc} — {c.nombre}{mon}</option>;
                      })}
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

function ModalPagoHQ({ mes, anio, liq, onClose, onSaved }) {
  const [form, setForm] = useState({
    tipo_componente: "haberes",
    monto:           liq?.monto_haberes ?? "",
    fecha:           new Date().toISOString().slice(0, 10),
    sociedad_id:     "",   // solo para transferencia
    cuenta_id:       "",
  });
  const [cuentas,     setCuentas]     = useState([]);
  const [sociedades,  setSociedades]  = useState([]);
  const [loadingCtas, setLoadingCtas] = useState(true);
  const [saving,      setSaving]      = useState(false);
  const savingRef = useRef(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    Promise.all([fetchSociedadesNumbers(), fetchCuentasBancariasNumbers()])
      .then(([socs, ctas]) => { setSociedades(socs); setCuentas(ctas); })
      .finally(() => setLoadingCtas(false));
  }, []);

  // Sociedad que determina las cuentas disponibles según el componente
  const socFiltro = useMemo(() => {
    if (form.tipo_componente === "haberes")  return liq?.sociedad_id ?? "";
    if (form.tipo_componente === "deposito") return "beta";
    if (form.tipo_componente === "efectivo") return "beta";  // caja de Beta
    return form.sociedad_id;                                 // transferencia: el usuario elige
  }, [form.tipo_componente, form.sociedad_id, liq?.sociedad_id]);

  const cuentasFiltradas = useMemo(() =>
    socFiltro ? cuentas.filter(c => c.sociedad === socFiltro) : [],
  [cuentas, socFiltro]);

  const handleTipo = (tipo) => {
    const ef = Math.max(0, (liq?.sueldo_total_legajo || 0) - (liq?.monto_haberes || 0) - (liq?.monto_deposito || 0) - (liq?.monto_transferencia || 0));
    const montos = { haberes: liq?.monto_haberes, deposito: liq?.monto_deposito, transferencia: liq?.monto_transferencia, efectivo: ef || "" };
    setForm(f => ({ ...f, tipo_componente: tipo, cuenta_id: "", sociedad_id: "", ...(montos[tipo] ? { monto: montos[tipo] } : {}) }));
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!form.monto) { alert("Completá el monto."); return; }
    if (!form.cuenta_id) { alert("Seleccioná una cuenta bancaria."); return; }
    savingRef.current = true; setSaving(true);
    try {
      const cta = cuentas.find(c => c.id === form.cuenta_id);
      await appendPago({
        mes, anio,
        legajo_id:              liq.legajo_id,
        legajo_nombre:          liq.legajo_nombre,
        sociedad_id:            liq.sociedad_id,
        sociedad_nombre:        liq.sociedad_nombre,
        tipo_componente:        form.tipo_componente,
        monto:                  parseFloat(form.monto) || 0,
        fecha:                  form.fecha,
        cuenta_bancaria_id:     form.cuenta_id,
        cuenta_bancaria_nombre: cta?.nombre ?? "",
      });
      await onSaved();
    } catch (e) { alert("Error: " + e.message); setSaving(false); } finally { savingRef.current = false; }
  };

  const iStyle = {
    border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px",
    fontSize: 13, fontFamily: T.font, width: "100%", boxSizing: "border-box",
    color: T.text, background: "#fff",
  };
  const LBL = ({ children }) => (
    <label style={{ fontSize: 12, fontWeight: 600, color: T.muted, display: "block", marginBottom: 3 }}>{children}</label>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: T.font }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>Registrar pago — {liq?.legajo_nombre}</h3>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: T.muted }}>Pendiente: {fmtMoney(liq?.pendiente)}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <LBL>Componente</LBL>
            <select style={iStyle} value={form.tipo_componente} onChange={e => handleTipo(e.target.value)}>
              <option value="haberes">Haberes (recibo de sueldo)</option>
              <option value="deposito">Depósito bancario</option>
              <option value="transferencia">Transferencia (factura monotributo)</option>
              <option value="efectivo">Efectivo</option>
            </select>
          </div>
          <div>
            <LBL>Monto (ARS)</LBL>
            <input style={iStyle} type="number" value={form.monto} onChange={e => set("monto", e.target.value)} />
          </div>
          <div>
            <LBL>Fecha</LBL>
            <input style={iStyle} type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} />
          </div>
          {/* Sociedad que transfiere — solo para transferencia */}
          {form.tipo_componente === "transferencia" && (
            <div>
              <LBL>Sociedad que transfiere</LBL>
              <select style={iStyle} value={form.sociedad_id}
                onChange={e => setForm(f => ({ ...f, sociedad_id: e.target.value, cuenta_id: "" }))}>
                <option value="">— Seleccioná —</option>
                {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          )}

          {/* Badge sociedad fija (depósito y efectivo = Beta) */}
          {(form.tipo_componente === "deposito" || form.tipo_componente === "efectivo") && (
            <div style={{ fontSize: 12, color: T.muted, background: T.bg, borderRadius: 5, padding: "6px 10px" }}>
              Sociedad: <strong style={{ color: T.text }}>Beta</strong>
            </div>
          )}

          {/* Cuenta bancaria — siempre visible, filtrada por componente */}
          <div>
            <LBL>{form.tipo_componente === "efectivo" ? "Caja" : "Cuenta bancaria"}</LBL>
            {loadingCtas
              ? <div style={{ fontSize: 12, color: T.muted }}>Cargando…</div>
              : <select style={iStyle} value={form.cuenta_id} onChange={e => set("cuenta_id", e.target.value)}
                  disabled={form.tipo_componente === "transferencia" && !form.sociedad_id}>
                  <option value="">— Seleccioná —</option>
                  {cuentasFiltradas.map(c => {
                    const soc = sociedades.find(s => s.id === c.sociedad)?.nombre ?? c.sociedad;
                    const mon = c.moneda !== "ARS" ? ` (${c.moneda})` : "";
                    return <option key={c.id} value={c.id}>{soc} — {c.nombre}{mon}</option>;
                  })}
                </select>
            }
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
