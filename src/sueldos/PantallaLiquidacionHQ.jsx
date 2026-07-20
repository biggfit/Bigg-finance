import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import * as XLSX from "xlsx";
import {
  fetchLegajos, fetchLiquidaciones, updateLegajo,
  fetchPagos, appendPago, deletePago, nuevoLote, fetchNovedades, ROLES_HQ,
  FP_TIPOS, FP_TIPO_LABEL, FP_TIPO_COLOR,
  fetchSociedadesNumbers, fetchCuentasBancariasNumbers, fetchCuentasContablesNumbers,
  idLiqDe, lineaLiq, sociedadDeFormaPago, saveLiquidacionLines, isCerrada,
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

// Los pagos de sueldos siempre imputan a esta cuenta contable (match por nombre).
const CUENTA_CONTABLE_SUELDOS = "Sueldos";

// Normaliza para matchear nombres de cuenta contable sin importar acentos/caja
// (p. ej. "Autónomos" en novedades vs "Autonomos" en nb_cuentas).
const norm = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
// Resuelve una cuenta contable por id, y si falla, por nombre (acento-insensible).
const findCuenta = (cuentas, id, nombre) =>
  (id && cuentas.find(c => c.id === id)) ||
  (nombre && cuentas.find(c => norm(c.nombre) === norm(nombre))) || null;

// Concepto del nb_movimiento al pagar un ítem (línea de sueldo o novedad).
const conceptoPago = (it, liq, mes, anio) => it.kind === "novedad"
  ? `Novedad ${it.ref.cuenta_contable_nombre || ""} ${liq.legajo_nombre} ${mes}/${anio}${it.ref.descripcion ? ` · ${it.ref.descripcion}` : ""}`.trim()
  : (it.ref.nota ? `Sueldo ${liq.legajo_nombre} ${mes}/${anio} · ${it.ref.nota}` : "");

// Nota interna que se persiste en el movimiento de sueldo (nb_movimientos; la nota de la línea de receta; las
// novedades no llevan nota interna → su descripción ya viaja en el concepto).
const notaPago = (it) => it.kind === "novedad" ? "" : (it.ref.nota || "");

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
  titular: "", banco: "", tipo_cuenta: "", cuenta: "", cbu: "", cuit: "", nota: "",
});

// Receta por defecto para un legajo sin formas de pago cargadas:
// 1 línea de haberes (= blanco_neto, con datos bancarios) + 1 de efectivo (el resto).
function defaultLineasFromLeg(leg) {
  const total  = leg?.sueldo_total || leg?.blanco_neto || 0;
  const blanco = leg?.blanco_neto || 0;
  const lineas = [];
  if (blanco > 0)
    lineas.push({ ...lineaVacia("haberes"), id: "leg-haberes", importe: blanco, titular: leg?.nombre || "", banco: leg?.banco || "", cbu: leg?.cbu || "" });
  const efectivo = Math.max(0, total - blanco);
  if (efectivo > 0 || !lineas.length)
    lineas.push({ ...lineaVacia("efectivo"), id: "leg-efectivo", importe: efectivo });
  return lineas;
}

// El legajo es la fuente de verdad del sueldo en blanco: si la receta no trae una
// línea de haberes y el legajo tiene blanco_neto, la inyectamos desde el legajo.
function withHaberesFromLeg(lineas, leg) {
  const blanco = leg?.blanco_neto || 0;
  if (blanco <= 0 || lineas.some(l => l.tipo === "haberes")) return lineas;
  return [
    { ...lineaVacia("haberes"), id: "leg-haberes", importe: blanco, titular: leg?.nombre || "", banco: leg?.banco || "", cbu: leg?.cbu || "" },
    ...lineas,
  ];
}

// El efectivo es siempre el remanente: target − Σ(no efectivo). Nunca hay descuadre,
// la diferencia cae automáticamente a una única línea de efectivo.
function normalizeEfectivo(lineas, target) {
  const sumOtros = lineas.filter(l => l.tipo !== "efectivo").reduce((s, l) => s + (Number(l.importe) || 0), 0);
  const resto = Math.max(0, (Number(target) || 0) - sumOtros);
  const otros = lineas.filter(l => l.tipo !== "efectivo");
  const efActual = lineas.find(l => l.tipo === "efectivo");
  if (resto <= 0) return otros;
  const ef = efActual
    ? { ...efActual, importe: resto }
    : { ...lineaVacia("efectivo"), id: "leg-efectivo", importe: resto };
  return [...otros, ef];
}

// Suma importes por tipo EXACTO de línea (no por balde escalar): separa
// transferencia_financiera de monotributo para mostrar una columna por forma.
function sumByTipoRaw(lineas = []) {
  const acc = {};
  let total = 0;
  for (const l of lineas) {
    const v = Number(l.importe) || 0;
    acc[l.tipo] = (acc[l.tipo] || 0) + v;
    total += v;
  }
  acc.total = total;
  return acc;
}

// Total por forma de pago combinando las líneas del sueldo (cuenta Sueldos) y las
// novedades (cada una con su cuenta contable). Es la vista de tesorería por columna.
function sumByFormaPago(lineas = [], novedades = []) {
  const acc = sumByTipoRaw(lineas);
  for (const n of novedades) {
    const v = Number(n.monto) || 0;
    acc[n.forma_pago] = (acc[n.forma_pago] || 0) + v;
    acc.total = (acc.total || 0) + v;
  }
  return acc;
}

// Reconstruye líneas a partir de los escalares monto_* de liquidaciones legacy
// (sin formas_pago). Ids estables por tipo para el fallback de isPaid.
function legacyLineasFromLiq(liq, leg) {
  const haberes  = liq.monto_haberes || 0;
  const deposito = liq.monto_deposito || 0;
  const transf   = liq.monto_transferencia || 0;
  const efectivo = liq.monto_efectivo || 0;   // valor congelado al cerrar, no recalcular
  // La transferencia escalar puede ser monotributo o trf. financiera; se distingue por
  // la contratación (monotributista → factura monotributo).
  const transfTipo = (liq.tipo_contratacion === "monotributista" || leg?.tipo_contratacion === "monotributista")
    ? "monotributo" : "transferencia_financiera";
  const out = [];
  if (haberes)  out.push({ ...lineaVacia("haberes"),  id: "leg-haberes",  importe: haberes,  titular: leg?.nombre || "", banco: leg?.banco || "", cbu: leg?.cbu || "" });
  if (deposito) out.push({ ...lineaVacia("deposito"), id: "leg-deposito", importe: deposito });
  if (transf)   out.push({ ...lineaVacia(transfTipo), id: "leg-transferencia", importe: transf });
  if (efectivo) out.push({ ...lineaVacia("efectivo"), id: "leg-efectivo", importe: efectivo });
  return out;
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function PantallaLiquidacionHQ({ pais = "", initialMes, initialAnio, initialPaso }) {
  const [mes,  setMes]  = useState(initialMes  ?? MES_DEF);
  const [anio, setAnio] = useState(initialAnio ?? ANO_DEF);

  const [legajos,       setLegajos]       = useState([]);
  const [liquidaciones, setLiquidaciones] = useState([]);
  const [pagos,         setPagos]         = useState([]);
  const [novedades,     setNovedades]     = useState([]);
  const [sociedades,    setSociedades]    = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);

  // Wizard state
  const [paso,             setPaso]             = useState(initialPaso ?? 1);
  const [sueldosDraft,     setSueldosDraft]     = useState({});  // { [legajo_id]: { pct: "", total: N } }
  const [actualizarLegs,   setActualizarLegs]   = useState(false);
  const [formasDraft,      setFormasDraft]      = useState({});  // { [legajo_id]: lineas[] }
  const [actualizarRecetas, setActualizarRecetas] = useState(false);
  const [showPago,         setShowPago]         = useState(null);
  const [showCerrar,       setShowCerrar]       = useState(false);

  useEffect(() => { load(); }, [mes, anio]);

  async function load() {
    setLoading(true);
    try {
      const [legs, liqs, pags, novs, socs] = await Promise.all([
        fetchLegajos(),
        fetchLiquidaciones(mes, anio),
        fetchPagos(mes, anio),
        fetchNovedades(mes, anio),
        fetchSociedadesNumbers().catch(() => []),
      ]);
      const legsHQ = legs.filter(l => ROLES_HQ.includes(l.rol) && l.activo);
      const descartados = legs.filter(l => l.activo && !ROLES_HQ.includes(l.rol));
      if (descartados.length)
        console.warn("[HQ] Legajos activos descartados por rol desconocido:", descartados.map(l => `${l.nombre} → "${l.rol}"`));
      setLegajos(legsHQ);
      setLiquidaciones(liqs.filter(l => ROLES_HQ.includes(l.rol)));
      // Excluir pagos de Sedes (un legajo con liquidación en ambos: el pago de Sedes no es de HQ).
      setPagos(pags.filter(p => p.ambito !== "sedes"));
      setNovedades(novs.filter(n => n.tipo === "extra" && !n.sede_id));
      setSociedades(Array.isArray(socs) ? socs : []);
    } finally { setLoading(false); }
  }

  // Cerrar = congelar los números del mes (no bloquea pagos). Es el ÚNICO punto que
  // escribe su_liquidaciones: materializa filas virtuales con el borrador actual.
  // Recibe los legajos seleccionados a cerrar; el resto queda en borrador (p. ej.
  // externos sin precio definido, que se pagan igual pero no se cierran todavía).
  async function handleCerrarLiquidacion(seleccion) {
    if (!seleccion.length) return;
    setSaving(true);
    try {
      for (const liq of seleccion) {
        const total = getDraftTotal(liq);
        const h = {
          mes, anio, pais,
          legajo_id: liq.legajo_id, legajo_nombre: liq.legajo_nombre,
          sociedad_id: liq.sociedad_id, sociedad_nombre: liq.sociedad_nombre,
          sede_id: liq.sede_id, sede_nombre: liq.sede_nombre,
          rol: liq.rol, tipo_contratacion: liq.tipo_contratacion, estado: "cerrada",
        };
        const lineas = [
          // concepto: HQ es un sueldo único negociado.
          lineaLiq(h, { tipo: "concepto", concepto: "Sueldo base", cuenta_contable: CUENTA_CONTABLE_SUELDOS, monto: total }),
        ];
        // pago: reparto por forma de pago (cada línea de la receta).
        for (const l of (liq.lineas || [])) {
          const imp = Number(l.importe) || 0;
          if (imp <= 0) continue;
          lineas.push(lineaLiq(h, {
            tipo: "pago", concepto: FP_TIPO_LABEL[l.tipo] || l.tipo,
            cuenta_contable: CUENTA_CONTABLE_SUELDOS, forma_pago: l.tipo,
            sociedad_id: sociedadDeFormaPago(l.tipo, l.sociedad_id, liq.sociedad_id), monto: imp,
          }));
        }
        // novedad: congelar cada una con su cuenta contable.
        for (const n of (liq.novedades || [])) {
          const imp = Number(n.monto) || 0;
          if (imp <= 0) continue;
          lineas.push(lineaLiq(h, {
            tipo: "novedad", concepto: n.cuenta_contable_nombre || "Novedad",
            cuenta_contable: n.cuenta_contable_nombre || "", cuenta_contable_id: n.cuenta_contable_id || "",
            forma_pago: n.forma_pago || "efectivo",
            sociedad_id: sociedadDeFormaPago(n.forma_pago, "", liq.sociedad_id), monto: imp,
          }));
        }
        await saveLiquidacionLines(idLiqDe(liq.legajo_id, mes, anio, liq.sede_id), lineas);
      }
      await load();
      setShowCerrar(false);
    } catch (e) {
      alert("Error al cerrar la liquidación: " + e.message);
    } finally { setSaving(false); }
  }

  // La pantalla se deriva del LEGAJO (no de un "inicializar"). Cada legajo HQ activo
  // aparece siempre; si ya tiene liquidación persistida la mergeamos, si no es una
  // fila virtual (sin id) que se materializa lazily al avanzar/pagar.
  const liqs = useMemo(() => {
    const liqByLegajo = new Map(liquidaciones.map(l => [l.legajo_id, l]));
    const novByLegajo = new Map();
    for (const n of novedades) {
      if (!novByLegajo.has(n.legajo_id)) novByLegajo.set(n.legajo_id, []);
      novByLegajo.get(n.legajo_id).push(n);
    }
    // Index de pagos por legajo (evita el filter O(legajos × pagos); mismo patrón que Sedes).
    const pagosByLegajo = new Map();
    for (const p of pagos) {
      if (!pagosByLegajo.has(p.legajo_id)) pagosByLegajo.set(p.legajo_id, []);
      pagosByLegajo.get(p.legajo_id).push(p);
    }
    return legajos.map(leg => {
      const liq = liqByLegajo.get(leg.id);
      // Split escalar congelado al cerrar (monto_*): si existe, es la fuente de verdad del
      // reparto por forma y se usa TAL CUAL (sin re-normalizar contra la receta del legajo).
      // Esto evita el drift por-forma que daba pendientes negativos en liquidaciones cerradas.
      const splitGuardado = liq &&
        ((Number(liq.monto_haberes) || 0) + (Number(liq.monto_deposito) || 0) +
         (Number(liq.monto_transferencia) || 0) + (Number(liq.monto_efectivo) || 0)) > 0;
      let lineas;
      if (liq?.formas_pago?.length) {
        lineas = liq.formas_pago;   // líneas guardadas = reparto congelado, usar tal cual
      } else if (splitGuardado) {
        lineas = legacyLineasFromLiq(liq, leg);
      } else {
        const base = leg.formas_pago?.length ? leg.formas_pago : defaultLineasFromLeg(leg);
        lineas = normalizeEfectivo(withHaberesFromLeg(base, leg), leg.sueldo_total || 0);
      }
      const pagosMios   = pagosByLegajo.get(leg.id) ?? [];
      const totalPagado = pagosMios.reduce((s, p) => s + p.monto, 0);
      const total_bruto = lineas.reduce((s, l) => s + (Number(l.importe) || 0), 0);
      // Cerrada → novedades CONGELADAS en la liquidación (líneas); borrador → su_novedades en vivo.
      const novsMios = isCerrada(liq?.estado) ? (liq.novedades || []) : (novByLegajo.get(leg.id) || []);
      const total_novedades = novsMios.reduce((s, n) => s + (Number(n.monto) || 0), 0);
      return {
        id:                  liq?.id,                   // undefined ⇒ liquidación virtual (aún no cerrada)
        mes, anio,
        legajo_id:           leg.id,
        legajo_nombre:       leg.nombre,
        sociedad_id:         liq?.sociedad_id     ?? leg.sociedad_id,
        sociedad_nombre:     liq?.sociedad_nombre ?? leg.sociedad_nombre,
        sede_id:             liq?.sede_id         ?? leg.sede_id,        // = centro de costo
        sede_nombre:         liq?.sede_nombre     ?? leg.sede_nombre,
        rol:                 leg.rol,
        tipo_contratacion:   liq?.tipo_contratacion ?? leg.tipo_contratacion,
        sueldo_base:         liq?.sueldo_base ?? (leg.sueldo_total || leg.blanco_neto),
        estado:              liq?.estado ?? "borrador",
        lineas,
        sueldo_total_legajo: leg.sueldo_total || 0,
        blanco_neto_legajo:  leg.blanco_neto || 0,
        cbu:   leg.cbu   || "",
        banco: leg.banco || "",
        pagos: pagosMios,
        total_bruto,
        total_pagado: totalPagado,
        pendiente: total_bruto + total_novedades - totalPagado,
        novedades:        novsMios,
        total_novedades,
        total_liquidacion: total_bruto + total_novedades,
      };
    });
  }, [liquidaciones, pagos, legajos, novedades, mes, anio]);

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

  // Avanzar a Paso 2 NO persiste en su_liquidaciones (eso pasa solo al CERRAR).
  // Solo arma el borrador en memoria; opcionalmente empuja el sueldo al legajo maestro.
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
        d[liq.legajo_id] = normalizeEfectivo(base.map(l => ({ ...l })), getDraftTotal(liq));
      });
      return d;
    });
    setPaso(2);
  }

  // Avanzar a Paso 3 NO persiste en su_liquidaciones (eso pasa solo al CERRAR).
  // El borrador de formas de pago vive en memoria (formasDraft) y alimenta el Paso 3.
  // Opcionalmente actualiza la receta del legajo (aplica a meses futuros).
  async function handleConfirmarPago() {
    if (actualizarRecetas) {
      setSaving(true);
      try {
        for (const liq of liqs) {
          const formas_pago = (formasDraft[liq.legajo_id] || []).map(l => ({ ...l, importe: Number(l.importe) || 0 }));
          await updateLegajo(liq.legajo_id, { formas_pago });
        }
        await load();
      } catch (e) {
        alert("Error al actualizar recetas: " + e.message);
        setSaving(false);
        return;
      } finally { setSaving(false); }
    }
    setPaso(3);
  }

  // Guarda la receta editada de UN empleado en su legajo (botón dentro del editor de
  // formas). Persiste formas_pago en el legajo y refleja el cambio en el estado local.
  const [savingLegajo, setSavingLegajo] = useState(null); // legajo_id en guardado
  async function handleSaveLegajoReceta(legajoId, lineas) {
    setSavingLegajo(legajoId);
    try {
      const formas_pago = (lineas || []).map(l => ({ ...l, importe: Number(l.importe) || 0 }));
      await updateLegajo(legajoId, { formas_pago });
      setLegajos(ls => ls.map(le => le.id === legajoId ? { ...le, formas_pago } : le));
    } catch (e) {
      alert("Error al guardar la receta en el legajo: " + e.message);
    } finally {
      setSavingLegajo(null);
    }
  }

  // Overlay del borrador en memoria sobre las líneas derivadas, para que el Paso 3
  // (y el cierre) reflejen lo editado en Forma de pago sin persistir en su_liquidaciones.
  const liqsView = useMemo(() => liqs.map(l => {
    const draft = formasDraft[l.legajo_id];
    if (!draft?.length) return l;
    const lineas = draft.map(x => ({ ...x, importe: Number(x.importe) || 0 }));
    const total_bruto = lineas.reduce((s, x) => s + x.importe, 0);
    const total_liquidacion = total_bruto + l.total_novedades;   // las novedades son parte del devengado
    return { ...l, lineas, total_bruto, total_liquidacion, pendiente: total_liquidacion - l.total_pagado };
  }), [liqs, formasDraft]);

  const liqStaff    = liqsView.filter(l => l.rol === "HQ");
  const liqOwners   = liqsView.filter(l => l.rol === "HQ_OWNER");
  const liqExternos = liqsView.filter(l => l.rol === "HQ_EXT");

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
        <button onClick={() => setShowCerrar(true)} disabled={saving || !liqs.length}
          style={{ marginLeft: "auto", ...BTN_PRIMARY(saving || !liqs.length) }}>
          {saving ? "Procesando…" : "🔒 Cerrar liquidación"}
        </button>
      </div>

      {liqs.length === 0 ? (
        <div style={{ border: `1px dashed ${T.border}`, borderRadius: 8, padding: 40, textAlign: "center", color: T.muted, fontSize: 13 }}>
          No hay empleados HQ activos para {MESES[mes - 1]} {anio}.
        </div>
      ) : (
        <>

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
              sociedades={sociedades}
              onChangeLineas={(id, lineas) => setFormasDraft(d => ({ ...d, [id]: lineas }))}
              actualizarRecetas={actualizarRecetas}
              onChangeActualizar={setActualizarRecetas}
              onSaveLegajo={handleSaveLegajoReceta}
              savingLegajo={savingLegajo}
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

      {showCerrar && (
        <ModalCerrar
          mes={mes} anio={anio}
          liqs={liqsView}
          saving={saving}
          onClose={() => setShowCerrar(false)}
          onConfirm={handleCerrarLiquidacion}
        />
      )}

      {showPago && (() => {
        const liqSel = liqs.find(l => l.legajo_id === showPago.legajo_id);
        return (
          <ModalPagoHQ
            mes={mes} anio={anio}
            liq={liqSel}
            cell={showPago.cell}
            onClose={() => setShowPago(null)}
            onSaved={async () => { setShowPago(null); await load(); }}
          />
        );
      })()}
    </div>
  );
}

// ── Helpers de ordenamiento ──────────────────────────────────────────────────

function useSortable(defaultCol = null, defaultDir = "asc") {
  const [sortCol, setSortCol] = useState(defaultCol);
  const [sortDir, setSortDir] = useState(defaultDir);
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
  const arrow = (
    <span style={{ fontSize: 10, color: active ? T.blue : T.dim }}>
      {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
    </span>
  );
  return (
    <th onClick={() => onSort(col)} style={{ ...TH(style), cursor: "pointer", userSelect: "none" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {children}{arrow}
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

function EstadoBadge({ estado }) {
  if (estado === "cerrada")
    return <span title="Cerrada" style={{ marginLeft: 8, fontSize: 12, color: T.green }}>🔒</span>;
  return (
    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, whiteSpace: "nowrap", background: "#fef9c3", color: T.yellow }}>
      Borrador
    </span>
  );
}

// ── Indicador de pasos ────────────────────────────────────────────────────────

function StepsIndicator({ paso, onPaso }) {
  const steps = [
    { n: 1, label: "Confirmar liquidación" },
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

// ── Detalle de novedades (read-only, reutilizado en Paso 1 y Paso 2) ──────────

// Filas de novedades alineadas a las MISMAS columnas de la tabla de sueldos
// (se inyectan en el <tbody> del Paso 1, debajo de la fila del empleado).
function NovedadesDetalle({ novedades }) {
  const fila = "#cbd5e1";   // gris oscuro para que no se pierda con la fila del empleado
  if (!novedades?.length)
    return (
      <tr style={{ background: fila, borderBottom: `2px solid ${T.border}` }}>
        <td colSpan={9} style={TD({ paddingLeft: 34, fontSize: 12, color: T.dim })}>Sin novedades este mes.</td>
      </tr>
    );
  return (
    <>
      {novedades.map((n, idx) => {
        const montoActual = Number(n.monto) || 0;
        const montoM1     = 0;   // TODO: leer novedades del mes anterior
        const variacion   = montoM1 ? (montoActual - montoM1) / montoM1 * 100 : null;
        const ultima      = idx === novedades.length - 1;
        return (
          <tr key={n.id} style={{ background: fila, borderBottom: ultima ? `2px solid ${T.border}` : undefined }}>
            <td style={TD({ paddingLeft: 48, fontSize: 12, color: T.text })}>{n.cuenta_contable_nombre || "—"}</td>
            <td style={TD()} />
            <td style={TD({ fontSize: 12, color: FP_TIPO_COLOR[n.forma_pago] || T.text })}>{FP_TIPO_LABEL[n.forma_pago] || n.forma_pago}</td>
            <td style={TD({ textAlign: "right", color: T.dim })}>{fmtMoney(montoM1)}</td>
            <td style={TD({ textAlign: "right", fontWeight: 700, color: T.blue })}>{fmtMoney(montoActual)}</td>
            <td style={TD({ textAlign: "right", fontSize: 12, color: variacion == null ? T.dim : variacion > 0 ? T.green : variacion < 0 ? T.red : T.dim })}>
              {variacion == null ? "—" : `${variacion > 0 ? "↑" : variacion < 0 ? "↓" : ""} ${Math.abs(variacion).toFixed(1)}%`}
            </td>
            <td style={TD({ fontSize: 12, color: n.descripcion ? T.muted : T.dim })} colSpan={3}>
              {n.descripcion || "Notas:"}
            </td>
          </tr>
        );
      })}
    </>
  );
}

// ── Paso 1: Confirmar liquidación ─────────────────────────────────────────────

function PasoSueldos({ liqStaff, liqOwners, liqExternos, sueldosDraft, onChangeDraft, actualizarLegs, onChangeActualizar, onSiguiente, saving }) {
  const [expandido, setExpandido] = useState(null); // legajo_id desplegado
  const [pctGlobal, setPctGlobal] = useState("");
  // Por defecto, ordenado por sueldo actual de mayor a menor.
  const { sortCol, sortDir, toggle, sort } = useSortable("actual", "desc");

  const todos       = [...liqStaff, ...liqOwners, ...liqExternos];
  const totalActual = todos.reduce((s, l) => s + (l.sueldo_total_legajo || 0), 0);
  const totalNuevo  = todos.reduce((s, l) => s + (sueldosDraft[l.legajo_id]?.total ?? l.sueldo_total_legajo), 0);
  const totalNovedades = todos.reduce((s, l) => s + (l.total_novedades || 0), 0);
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
    if (col === "centro") return r.sede_nombre || r.sede_id || "";
    if (col === "actual") return r.sueldo_total_legajo;
    if (col === "nuevo")  return sueldosDraft[r.legajo_id]?.total ?? r.sueldo_total_legajo;
  });

  return (
    <div>
      {/* Resumen de totales */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Sueldos nuevos", value: totalNuevo,  color: T.blue },
          { label: "Novedades",      value: totalNovedades, color: totalNovedades ? T.purple : T.dim },
          { label: "Total liquidación", value: totalNuevo + totalNovedades, color: T.green },
          { label: "Dif. sueldos",   value: diff,        color: diff > 0 ? T.green : diff < 0 ? T.red : T.muted, prefix: diff > 0 ? "+" : "" },
        ].map(({ label, value, color, prefix = "" }) => (
          <div key={label} style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color }}>{prefix}{fmtMoney(value)}</div>
          </div>
        ))}
      </div>

      <div style={{ overflowX: "auto", marginBottom: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <SortTH col="nombre" sortCol={sortCol} sortDir={sortDir} onSort={toggle}>Nombre</SortTH>
            <SortTH col="rol" sortCol={sortCol} sortDir={sortDir} onSort={toggle}>Rol</SortTH>
            <SortTH col="centro" sortCol={sortCol} sortDir={sortDir} onSort={toggle}>Centro de costo</SortTH>
            <th style={TH({ textAlign: "right" })}>Sueldo M-1</th>
            <SortTH col="actual" sortCol={sortCol} sortDir={sortDir} onSort={toggle} style={{ textAlign: "right" }}>Sueldo actual</SortTH>
            <th style={TH({ textAlign: "right" })} title="Variación M-1 vs sueldo actual">↑ %</th>
            <th style={TH({ textAlign: "right", borderLeft: `1px solid ${T.border}` })}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 }}>
                <span title="Aumento en %">↑ %</span>
                <input
                  type="number" value={pctGlobal}
                  onChange={e => handlePctGlobal(e.target.value)}
                  placeholder="all"
                  title="Aplicar a todos"
                  style={INPUT({ width: 38, fontSize: 11, padding: "2px 4px", border: "1px solid #6366f1", color: T.text })}
                />
              </div>
            </th>
            <th style={TH({ textAlign: "right" })} title="Aumento en $">↑ $</th>
            <SortTH col="nuevo" sortCol={sortCol} sortDir={sortDir} onSort={toggle} style={{ textAlign: "right" }}>Nuevo sueldo</SortTH>
          </tr>
        </thead>
        <tbody>
          {sorted.map((liq, i) => {
            const d          = sueldosDraft[liq.legajo_id];
            const pct        = d?.pct   ?? "";
            const nuevoTotal = d?.total ?? liq.sueldo_total_legajo;
            const subio      = nuevoTotal > liq.sueldo_total_legajo;
            const aumento    = nuevoTotal - liq.sueldo_total_legajo;
            const sueldoM1   = 0; // TODO: leer liquidación cerrada del mes anterior
            const pctM1      = sueldoM1 ? (liq.sueldo_total_legajo - sueldoM1) / sueldoM1 * 100 : null;
            const novs       = liq.novedades || [];
            const open       = expandido === liq.legajo_id;
            return (
              <Fragment key={liq.legajo_id}>
              <tr style={{ background: open ? T.blueLt : i % 2 === 0 ? "#fff" : T.bg }}>
                <td
                  onClick={() => novs.length && setExpandido(open ? null : liq.legajo_id)}
                  title={novs.length ? "Ver / ocultar novedades" : ""}
                  style={TD({ fontWeight: 600, cursor: novs.length ? "pointer" : "default", userSelect: "none" })}>
                  <span
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 18, height: 18, marginRight: 6, borderRadius: 4,
                      verticalAlign: "middle",
                      background: novs.length ? "#ede9fe" : "transparent",
                    }}>
                    {novs.length > 0 && (
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none"
                        style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }}>
                        <path d="M3 1.5l4 3.5-4 3.5" stroke={T.purple} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {liq.legajo_nombre}
                  {novs.length > 0 && (
                    <span style={{ marginLeft: 6, fontSize: 10, background: "#f3e8ff", color: T.purple, padding: "1px 6px", borderRadius: 3, fontWeight: 600 }}>
                      +{fmtMoney(liq.total_novedades)}
                    </span>
                  )}
                </td>
                <td style={TD({ color: T.muted, fontSize: 12 })}>{liq.rol}</td>
                <td style={TD({ color: T.muted, fontSize: 12 })}>{liq.sede_nombre || liq.sede_id || "—"}</td>
                <td style={TD({ textAlign: "right", color: T.dim })}>{fmtMoney(sueldoM1)}</td>
                <td style={TD({ textAlign: "right", fontWeight: 700, color: T.blue })}>{fmtMoney(liq.sueldo_total_legajo)}</td>
                <td style={TD({ textAlign: "right", fontSize: 12, color: pctM1 == null ? T.dim : pctM1 > 0 ? T.green : pctM1 < 0 ? T.red : T.dim })}>
                  {pctM1 == null ? "—" : `${pctM1 > 0 ? "↑" : pctM1 < 0 ? "↓" : ""} ${Math.abs(pctM1).toFixed(1)}%`}
                </td>
                <td style={TD({ textAlign: "right", borderLeft: `1px solid ${T.border}` })}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                    <input
                      type="number" value={pct}
                      onChange={e => handlePct(liq, e.target.value)}
                      placeholder="0"
                      style={INPUT({ width: 48 })}
                    />
                    <span style={{ color: T.muted, fontSize: 12 }}>%</span>
                  </div>
                </td>
                <td style={TD({ textAlign: "right", color: aumento > 0 ? T.green : aumento < 0 ? T.red : T.dim })}>
                  {aumento ? (aumento > 0 ? "+" : "") + fmtMoney(aumento) : "—"}
                </td>
                <td style={TD({ textAlign: "right" })}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                    <input
                      type="text"
                      value={nuevoTotal ? Math.round(nuevoTotal).toLocaleString("es-AR") : ""}
                      onChange={e => handleTotal(liq, e.target.value.replace(/\./g, ""))}
                      style={INPUT({ width: 92, fontWeight: 700, color: subio ? T.green : T.text })}
                    />
                    {subio && <span style={{ fontSize: 12, color: T.green }}>↑</span>}
                  </div>
                </td>
              </tr>
              {open && <NovedadesDetalle novedades={novs} />}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>

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

function PasoPago({ liqStaff, liqOwners, liqExternos, sueldosDraft, formasDraft, sociedades = [], onChangeLineas, actualizarRecetas, onChangeActualizar, onSaveLegajo, savingLegajo, onAtras, onSiguiente, saving }) {
  const getTarget = (liq) => sueldosDraft[liq.legajo_id]?.total ?? liq.sueldo_total_legajo;
  const todos = [...liqStaff, ...liqOwners, ...liqExternos];
  const [expandido, setExpandido] = useState(null); // legajo_id desplegado

  const COLS = FP_TIPOS.map(id => ({ id, label: FP_TIPO_LABEL[id] }));
  const EXP_BG = "#cbd5e1";   // fondo del desglose (Sueldo + Novedades), más oscuro para destacar

  // Fondeo por forma de pago (sueldo editable + novedades), sumado sobre todos los empleados.
  const fondeoTotals = {};
  for (const t of FP_TIPOS) fondeoTotals[t] = 0;
  for (const liq of todos) {
    const s = sumByFormaPago(formasDraft[liq.legajo_id] || [], liq.novedades || []);
    for (const t of FP_TIPOS) fondeoTotals[t] += s[t] || 0;
  }
  const FONDEO = [
    { titulo: "Banco",      sub: "Lo que tiene que haber en el banco",  color: FP_TIPO_COLOR.haberes || T.blue,                  tipos: ["haberes", "monotributo"] },
    { titulo: "Financiera", sub: "Lo que tiene que tener la financiera", color: FP_TIPO_COLOR.transferencia_financiera || T.blue, tipos: ["transferencia_financiera", "deposito"] },
    { titulo: "Efectivo",   sub: "Lo que necesito en efectivo",          color: FP_TIPO_COLOR.efectivo || T.text,                 tipos: ["efectivo"] },
  ];

  return (
    <div>
      {/* Fondeo: cuánto tiene que haber por destino (sueldo + novedades) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
        {FONDEO.map(card => {
          const total = card.tipos.reduce((s, t) => s + (fondeoTotals[t] || 0), 0);
          return (
            <div key={card.titulo} style={{ background: "#fff", border: `1px solid ${T.border}`, borderTop: `3px solid ${card.color}`, borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{card.titulo}</div>
              <div style={{ fontSize: 10, color: T.muted, marginBottom: 8 }}>{card.sub}</div>
              {card.tipos.map(t => (
                <div key={t} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.muted, marginBottom: 2 }}>
                  <span>{FP_TIPO_LABEL[t]}</span><span style={{ color: T.text, fontWeight: 600 }}>{fmtMoney(fondeoTotals[t] || 0)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: `1px solid ${T.border}`, marginTop: "auto", paddingTop: 6 }}>
                <span style={{ color: T.muted, fontSize: 11, fontWeight: 600 }}>Total</span>
                <span style={{ color: card.color, fontSize: 16, fontWeight: 700 }}>{fmtMoney(total)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 12, color: T.muted, margin: "0 0 16px" }}>
        Cada empleado trae su receta de pago del legajo. Desplegá una fila para ver y ajustar cómo se componen los pagos; el origen del dinero se elige al pagar.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={TH({ minWidth: 180 })}>Empleado</th>
              <th style={TH({ textAlign: "right" })}>Total</th>
              {COLS.map(c => <th key={c.id} style={TH({ textAlign: "right" })}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {todos.map((liq, i) => {
              const lineas = formasDraft[liq.legajo_id] || [];
              const target = getTarget(liq);
              const novs   = liq.novedades || [];
              const sums   = sumByTipoRaw(lineas);                  // sólo sueldo: base de la reconciliación
              const colSums = sumByFormaPago(lineas, novs);         // sueldo + novedades: totales por columna
              const dif    = sums.total - target;
              const cuadra = Math.abs(dif) < 1;
              const open   = expandido === liq.legajo_id;
              return (
                <Fragment key={liq.legajo_id}>
                  <tr onClick={() => setExpandido(open ? null : liq.legajo_id)}
                    title={!cuadra ? `Σ líneas ${fmtMoney(sums.total)} (${dif > 0 ? "+" : ""}${fmtMoney(dif)})` : undefined}
                    style={{ background: !cuadra ? "#fecaca" : open ? T.blueLt : i % 2 === 0 ? "#fff" : T.bg, borderBottom: open ? "none" : `1px solid ${T.border}`, cursor: "pointer" }}>
                    <td style={TD({ fontWeight: 600 })}>
                      <span style={{ color: T.dim, marginRight: 6, fontSize: 11 }}>{open ? "▾" : "▸"}</span>
                      {liq.legajo_nombre}
                    </td>
                    <td style={TD({ textAlign: "right", fontWeight: 700, color: T.blue })}
                      title={(liq.total_novedades || 0) > 0 ? `Incluye ${fmtMoney(liq.total_novedades)} de novedades` : undefined}>
                      {fmtMoney(target + (liq.total_novedades || 0))}
                    </td>
                    {COLS.map(c => (
                      <td key={c.id} style={TD({ textAlign: "right", color: colSums[c.id] ? FP_TIPO_COLOR[c.id] || T.text : T.dim })}>
                        {colSums[c.id] ? fmtMoney(colSums[c.id]) : "—"}
                      </td>
                    ))}
                  </tr>
                  {open && (
                    <tr style={{ background: EXP_BG, borderBottom: `1px solid ${T.border}` }}>
                      <td style={TD({ paddingLeft: 34, fontSize: 12, fontWeight: 600, color: T.text })}>Sueldo</td>
                      <td style={TD({ textAlign: "right", fontSize: 12, fontWeight: 700, color: T.blue })}>{fmtMoney(target)}</td>
                      {COLS.map(c => (
                        <td key={c.id} style={TD({ textAlign: "right", fontSize: 12, color: sums[c.id] ? FP_TIPO_COLOR[c.id] || T.text : T.dim })}>
                          {sums[c.id] ? fmtMoney(sums[c.id]) : "—"}
                        </td>
                      ))}
                    </tr>
                  )}
                  {open && novs.map((n, ni) => {
                    const m = Number(n.monto) || 0;
                    return (
                      <tr key={n.id} style={{ background: EXP_BG, borderBottom: `1px solid ${T.border}` }}>
                        <td style={TD({ paddingLeft: 34, fontSize: 12, color: T.text })}>{n.cuenta_contable_nombre || n.descripcion || "Novedad"}</td>
                        <td style={TD({ textAlign: "right", fontSize: 12, fontWeight: 700, color: T.purple })}>{fmtMoney(m)}</td>
                        {COLS.map(c => (
                          <td key={c.id} style={TD({ textAlign: "right", fontSize: 12, color: c.id === n.forma_pago ? FP_TIPO_COLOR[c.id] || T.text : T.dim })}>
                            {c.id === n.forma_pago ? fmtMoney(m) : "—"}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {open && (
                    <tr style={{ background: EXP_BG, borderBottom: `1px solid ${T.border}` }}>
                      <td colSpan={2 + COLS.length} style={{ padding: "0 12px 14px" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: ".04em", margin: "4px 0 8px" }}>FORMAS DE PAGO DEL SUELDO</div>
                        <FormasLineEditor
                          target={target}
                          lineas={lineas}
                          sociedades={sociedades}
                          onChange={(ls) => onChangeLineas(liq.legajo_id, ls)}
                          onSaveLegajo={() => onSaveLegajo(liq.legajo_id, lineas)}
                          savingLegajo={savingLegajo === liq.legajo_id}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
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

// Padding horizontal = celda (5px) + input (7px) para que el header alinee con el texto del input.
const FP_TH = (extra = {}) => ({ padding: "5px 12px", textAlign: "left", fontWeight: 600, color: T.muted, fontSize: 10.5, letterSpacing: ".03em", whiteSpace: "nowrap", ...extra });
const FP_TD = (extra = {}) => ({ padding: "3px 5px", verticalAlign: "middle", ...extra });
const FP_INPUT = (extra = {}) => ({ border: `1px solid ${T.border}`, borderRadius: 5, padding: "4px 7px", fontSize: 12.5, fontFamily: T.font, background: "#fff", outline: "none", color: T.text, width: "100%", boxSizing: "border-box", ...extra });

function FormasLineEditor({ target, lineas, sociedades = [], onChange, onSaveLegajo, savingLegajo }) {
  // Toda mutación recalcula el efectivo como remanente: nunca queda descuadre.
  const emit = (ls) => onChange(normalizeEfectivo(ls, target));
  const upd = (id, k, v) => emit(lineas.map(l => l.id === id ? { ...l, [k]: v } : l));
  const add = () => emit([...lineas, lineaVacia("deposito")]);
  const del = (id) => emit(lineas.filter(l => l.id !== id));
  const suma = lineas.reduce((s, l) => s + (parseFloat(l.importe) || 0), 0);
  const dif  = suma - target;             // > 0 sólo si las líneas superan el sueldo (sobre-asignación)
  const cuadra = dif <= 1;

  return (
    <div style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 8, padding: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 110 }} /><col style={{ width: 100 }} /><col style={{ width: 130 }} /><col /><col />
          <col style={{ width: 64 }} /><col /><col /><col /><col style={{ width: 120 }} /><col style={{ width: 30 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={FP_TH()}>Tipo</th>
            <th style={FP_TH({ textAlign: "right" })}>Importe</th>
            <th style={FP_TH()}>Sociedad</th>
            <th style={FP_TH()}>Titular</th>
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
                  <input type="number" value={l.importe} disabled={esEf}
                    onChange={e => upd(l.id, "importe", e.target.value)}
                    title={esEf ? "El efectivo se calcula automáticamente como el remanente" : undefined}
                    style={FP_INPUT({ textAlign: "right", fontWeight: 600, ...(esEf ? { background: T.bg, color: T.muted } : {}) })} />
                </td>
                <td style={FP_TD()}>
                  {l.tipo === "monotributo"
                    ? <select value={l.sociedad_id || ""} onChange={e => upd(l.id, "sociedad_id", e.target.value)}
                        title="Sociedad desde la que se paga (define el devengado del monotributo)"
                        style={FP_INPUT({ fontWeight: 600 })}>
                        <option value="">— Sociedad —</option>
                        {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                      </select>
                    : <span style={{ color: T.dim, fontSize: 12, paddingLeft: 6 }}>—</span>}
                </td>
                <td style={FP_TD()}><input value={l.titular || ""} disabled={esEf} onChange={e => upd(l.id, "titular", e.target.value)} placeholder="Nombre de la cuenta" style={FP_INPUT(esEf ? { background: T.bg } : {})} /></td>
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
        {onSaveLegajo && (
          <button onClick={onSaveLegajo} disabled={savingLegajo}
            title="Guarda esta receta (líneas y datos bancarios) en el legajo del empleado, para que aplique a los próximos meses"
            style={{ background: "none", border: `1px solid ${T.green}`, color: T.green, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: savingLegajo ? "default" : "pointer", opacity: savingLegajo ? 0.6 : 1, fontFamily: T.font }}>
            {savingLegajo ? "Guardando…" : "💾 Guardar en legajo"}
          </button>
        )}
        <span style={{ fontSize: 11, color: T.dim }}>El efectivo se completa solo con el remanente.</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: T.muted }}>Σ líneas <strong style={{ color: cuadra ? T.green : T.red }}>{fmtMoney(suma)}</strong></span>
        {!cuadra && (
          <span style={{ fontSize: 12, color: T.red, fontWeight: 600 }}>
            ⚠️ {fmtMoney(dif)} de más vs sueldo total
          </span>
        )}
      </div>
    </div>
  );
}

// ── Modal: elegir qué legajos cerrar ──────────────────────────────────────────

function ModalCerrar({ mes, anio, liqs, saving, onClose, onConfirm }) {
  // Sólo se pueden cerrar los que están en borrador; los ya cerrados quedan fijos.
  const cerrables = liqs.filter(l => l.estado !== "cerrada");
  // Por defecto se cierran todos los cerrables menos los externos (suelen no tener precio cerrado).
  const [sel, setSel] = useState(() => new Set(cerrables.filter(l => l.rol !== "HQ_EXT").map(l => l.legajo_id)));
  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setAll = (ids) => setSel(new Set(ids));

  const seleccion = cerrables.filter(l => sel.has(l.legajo_id));
  // Total real (sueldo + novedades), igual que el "Total a pagar" del paso de pagos.
  const totalSel  = seleccion.reduce((s, l) => s + (l.total_liquidacion ?? l.total_bruto ?? 0), 0);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, fontFamily: T.font }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, width: 560, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}>
        <div style={{ padding: "18px 22px 12px", borderBottom: `1px solid ${T.border}` }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>🔒 Cerrar liquidación — {MESES[mes - 1]} {anio}</h3>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: T.muted }}>
            Elegí qué empleados cerrar. Los que dejes afuera quedan en borrador: podés pagarles igual y cerrarlos más adelante (cuando tengas el precio).
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => setAll(cerrables.map(l => l.legajo_id))} style={CHIP_BTN}>Todos</button>
            <button onClick={() => setAll(cerrables.filter(l => l.rol !== "HQ_EXT").map(l => l.legajo_id))} style={CHIP_BTN}>Sin externos</button>
            <button onClick={() => setAll([])} style={CHIP_BTN}>Ninguno</button>
          </div>
        </div>

        <div style={{ overflowY: "auto", padding: "8px 0" }}>
          {liqs.map(l => {
            const cerrada = l.estado === "cerrada";
            const on = !cerrada && sel.has(l.legajo_id);
            return (
              <label key={l.legajo_id} title={cerrada ? "Ya está cerrada" : undefined}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 22px", cursor: cerrada ? "default" : "pointer", opacity: cerrada ? 0.55 : 1, background: on ? T.blueLt : "#fff" }}>
                <input type="checkbox" checked={cerrada ? true : on} disabled={cerrada} onChange={() => toggle(l.legajo_id)} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.text }}>{l.legajo_nombre}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: T.muted, background: T.bg, borderRadius: 5, padding: "2px 7px" }}>{l.rol}</span>
                {cerrada && <span style={{ fontSize: 12, color: T.green }}>🔒</span>}
                <span style={{ fontSize: 13, color: T.muted, minWidth: 96, textAlign: "right" }}
                  title={(l.total_novedades || 0) > 0 ? `Incluye ${fmtMoney(l.total_novedades)} de novedades` : undefined}>{fmtMoney(l.total_liquidacion ?? l.total_bruto)}</span>
              </label>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderTop: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 12, color: T.muted }}>
            {seleccion.length} seleccionados · <strong style={{ color: T.text }}>{fmtMoney(totalSel)}</strong>
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={BTN_SECONDARY}>Cancelar</button>
            <button onClick={() => onConfirm(seleccion)} disabled={saving || !seleccion.length} style={BTN_PRIMARY(saving || !seleccion.length)}>
              {saving ? "Cerrando…" : `🔒 Cerrar ${seleccion.length}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const CHIP_BTN = {
  border: `1px solid ${T.border}`, background: "#fff", borderRadius: 6,
  padding: "4px 10px", fontSize: 12, cursor: "pointer", color: T.text, fontFamily: T.font,
};

// ── Helpers de exportación Excel (formato Galicia Office) ─────────────────────

const GALICIA_HEADERS = [
  "CBU/CVU/Alias/Nro cuenta            ",
  "Monto",
  "Concepto",
  "Descripción\r\n(opcional)",
  "Email destinatario\r\n(opcional)",
  "Mensaje del email\r\n(opcional)",
];

function descargarExcelHoja({ headers, anchos, hoja, filas, nombreArchivo }) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...filas]);
  ws["!cols"] = anchos.map(wch => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, hoja);
  XLSX.writeFile(wb, nombreArchivo);
}

function descargarExcelGalicia(filas, nombreArchivo) {
  descargarExcelHoja({ headers: GALICIA_HEADERS, anchos: [28, 12, 32, 14, 24, 24], hoja: "Formulario", filas, nombreArchivo });
}

// Genera una fila Galicia por cada línea de pago del tipo indicado (con CBU).
// Las novedades de la misma forma de pago se acreditan al CBU del empleado.
function lineasGalicia(liqs, tipo) {
  const filas = [];
  for (const liq of liqs) {
    for (const l of liq.lineas || []) {
      if (l.tipo !== tipo) continue;
      const cbu = (l.cbu || (tipo === "haberes" ? liq.cbu : "")).trim();
      if (!cbu || !(Number(l.importe) > 0)) continue;
      filas.push({ cbu, importe: Number(l.importe), nombre: liq.legajo_nombre, nota: l.nota || "" });
    }
    for (const n of liq.novedades || []) {
      if (n.forma_pago !== tipo) continue;
      const cbu = (liq.cbu || "").trim();
      if (!cbu || !(Number(n.monto) > 0)) continue;
      filas.push({ cbu, importe: Number(n.monto), nombre: liq.legajo_nombre, nota: n.cuenta_contable_nombre || n.descripcion || "" });
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

// ── Export detallado (Depósito / Trf. financiera) ────────────────────────────
// Formato con datos de cuenta completos. "Nota interna" = nombre de la cuenta
// (titular); cae a la nota de la línea si no hay titular.

const DETALLE_HEADERS = [
  "Legajo", "Titular (nombre de la cuenta)", "Importe", "Banco", "Tipo de cta",
  "Cuenta", "CBU", "CUIT", "Nota interna",
];

function descargarExcelDetalle(filas, nombreArchivo) {
  descargarExcelHoja({ headers: DETALLE_HEADERS, anchos: [24, 28, 14, 14, 12, 18, 26, 16, 26], hoja: "Sheet1", filas, nombreArchivo });
}

// Una fila por cada línea de pago del tipo indicado, con datos de cuenta.
function lineasDetalle(liqs, tipo) {
  const filas = [];
  for (const liq of liqs) {
    for (const l of liq.lineas || []) {
      if (l.tipo !== tipo) continue;
      if (!(Number(l.importe) > 0)) continue;
      filas.push([
        liq.legajo_nombre,
        l.titular || liq.legajo_nombre || "",
        Number(l.importe),
        l.banco || "",
        l.tipo_cuenta || "",
        l.cuenta || "",
        l.cbu || "",
        l.cuit || "",
        l.nota || "",
      ]);
    }
  }
  return filas;
}

function exportarDeposito(liqs, mes, anio) {
  const filas = lineasDetalle(liqs, "deposito");
  if (!filas.length) { alert("No hay líneas de Depósito con importe cargado."); return; }
  descargarExcelDetalle(filas, `Deposito_HQ_${String(mes).padStart(2,"0")}_${anio}.xlsx`);
}

function exportarTransferenciaFinanciera(liqs, mes, anio) {
  const filas = lineasDetalle(liqs, "transferencia_financiera");
  if (!filas.length) { alert("No hay líneas de Trf. financiera con importe cargado."); return; }
  descargarExcelDetalle(filas, `Transferencias_HQ_${String(mes).padStart(2,"0")}_${anio}.xlsx`);
}

// ── Paso 3: Registrar pagos ───────────────────────────────────────────────────

// Líneas con id sintético (derivadas del legajo, no persistidas): leg-/auto-/fp-.
// Su id se regenera entre cargas, así que un pago no puede anclarse a él de forma
// estable; se matchea por tipo de forma de pago.
const esLineaSintetica = (id) => /^(leg-|auto-|fp-)/.test(String(id));

// Pagos asociados a una línea. Para líneas persistidas: match exacto por
// forma_pago_id. Para líneas sintéticas: match por tipo_componente, excluyendo
// pagos de novedades (forma_pago_id "NOV…", que pertenecen a otra cuenta contable).
function getPagosLinea(liq, linea) {
  const pagos = liq.pagos || [];
  const byId = linea.id ? pagos.filter(p => String(p.forma_pago_id) === String(linea.id)) : [];
  if (byId.length) return byId;
  if (esLineaSintetica(linea.id))
    return pagos.filter(p =>
      p.tipo_componente === linea.tipo &&
      (!p.forma_pago_id || esLineaSintetica(p.forma_pago_id)));
  return [];
}

// Pagos de una novedad: vinculados por forma_pago_id = id de la novedad (NOV…).
// Requiere la columna forma_pago_id en nb_movimientos; sin ella el pago no se puede
// anclar a una novedad concreta (dos novedades iguales serían indistinguibles).
function getPagosNovedad(liq, nov) {
  if (!nov.id) return [];
  return (liq.pagos || []).filter(p => String(p.forma_pago_id) === String(nov.id));
}

function describirDestino(l, nombreEmpleado = "") {
  if (l.tipo === "efectivo") return l.nota || "Efectivo en mano";
  const base = [l.banco, l.cuenta || l.cbu].filter(Boolean).join(" · ") || "Sin datos bancarios";
  const titularDistinto = l.titular && l.titular.trim() && l.titular.trim() !== nombreEmpleado.trim();
  const detalle = [titularDistinto ? l.titular.trim() : "", l.nota].filter(Boolean).join(" · ");
  return detalle ? `${base} — ${detalle}` : base;
}

function PasoPagos({ mes, anio, liqStaff, liqOwners, liqExternos, onAtras, onRegistrarPago, onBatchPaid }) {
  const [anularModal, setAnularModal] = useState(null); // pago object
  const [expandido,   setExpandido]   = useState(null); // legajo_id desplegado
  const [batchModal,  setBatchModal]  = useState(null); // { tipo }

  // Cerradas arriba, borradores abajo; dentro de cada grupo, por total de mayor a menor.
  const todos = useMemo(() => {
    const rank = (l) => (l.estado === "cerrada" ? 0 : 1);
    return [...liqStaff, ...liqOwners, ...liqExternos]
      .sort((a, b) => rank(a) - rank(b) || b.total_bruto - a.total_bruto);
  }, [liqStaff, liqOwners, liqExternos]);

  const totalBruto  = todos.reduce((s, l) => s + l.total_liquidacion, 0);
  const totalPagado = todos.reduce((s, l) => s + l.total_pagado, 0);
  const totalPend   = totalBruto - totalPagado;

  // Una pasada por todas las líneas: importe total, cantidad y pendientes por tipo.
  // Alimenta tanto las tarjetas de fondeo como los encabezados de columna.
  const tipoStats = useMemo(() => {
    const acc = {};
    for (const tipo of FP_TIPOS) acc[tipo] = { total: 0, count: 0, pend: 0, pagado: 0 };
    for (const liq of todos) {
      for (const l of liq.lineas || []) {
        const s = acc[l.tipo];
        if (!s) continue;
        s.total += Number(l.importe) || 0;
        s.count += 1;
        if (getPagosLinea(liq, l).length === 0) s.pend += 1;
      }
      for (const n of liq.novedades || []) {
        const s = acc[n.forma_pago];
        if (!s) continue;
        s.total += Number(n.monto) || 0;
        s.count += 1;
        if (getPagosNovedad(liq, n).length === 0) s.pend += 1;
      }
      for (const p of liq.pagos || []) {
        const s = acc[p.tipo_componente];
        if (s) s.pagado += Number(p.monto) || 0;
      }
    }
    return acc;
  }, [todos]);

  const COLS = FP_TIPOS.map(id => ({ id, label: FP_TIPO_LABEL[id] }));

  // Ítems pendientes de un tipo a través de todos los empleados (para imputar en
  // masa): líneas de sueldo + novedades que salen por esa forma de pago.
  const pendientesTipo = (tipo) => todos.flatMap(liq => [
    ...liq.lineas
      .filter(l => l.tipo === tipo && getPagosLinea(liq, l).length === 0)
      .map(linea => ({ liq, kind: "linea", ref: linea })),
    ...(liq.novedades || [])
      .filter(n => n.forma_pago === tipo && getPagosNovedad(liq, n).length === 0)
      .map(nov => ({ liq, kind: "novedad", ref: nov })),
  ]);

  return (
    <div>
      {/* Resumen por medio de pago */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Total a pagar", grand: totalBruto,  color: T.text,  valor: t => tipoStats[t].total },
          { label: "Pagado",        grand: totalPagado, color: T.green, valor: t => tipoStats[t].pagado },
          { label: "Pendiente",     grand: totalPend,   color: totalPend > 0 ? T.red : T.green, valor: t => tipoStats[t].total - tipoStats[t].pagado },
        ].map(({ label, grand, color, valor }) => (
          <div key={label} style={{ background: "#fff", border: `1px solid ${T.border}`, borderTop: `3px solid ${color}`, borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 11, color: T.muted, fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color, marginBottom: 8 }}>{fmtMoney(grand)}</div>
            {FP_TIPOS.filter(t => tipoStats[t].total > 0).map(t => {
              const v = valor(t);
              return (
                <div key={t} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.muted, marginBottom: 2 }}>
                  <span>{FP_TIPO_LABEL[t]}</span>
                  <span style={{ color: v ? color : T.dim, fontWeight: 600 }}>{fmtMoney(v)}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <p style={{ fontSize: 12, color: T.muted, margin: "0 0 14px" }}>
        Desplegá una fila para pagar cada destino por separado, eligiendo el origen del dinero al pagar. Nada queda cerrado hasta que pagás.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={TH({ minWidth: 180 })}>Nombre</th>
              <th style={TH({ textAlign: "right" })}>Total</th>
              {COLS.map(c => {
                const hayAlgo    = tipoStats[c.id].count > 0;
                const todoPagado = hayAlgo && tipoStats[c.id].pend === 0;
                return (
                  <th key={c.id} style={TH({ textAlign: "right" })}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      {c.label}
                      {hayAlgo && (todoPagado
                        ? <span title="Todos pagados" style={{ fontSize: 11, color: T.green, fontWeight: 700 }}>✓</span>
                        : <button onClick={() => setBatchModal({ tipo: c.id })} title={`Imputar ${c.label} en masa`}
                            style={{ background: T.green, color: "#fff", border: "none", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>✓</button>
                      )}
                    </span>
                  </th>
                );
              })}
              <th style={TH({ textAlign: "right" })}>Pagado</th>
              <th style={TH({ textAlign: "right" })}>Pendiente</th>
            </tr>
          </thead>
          <tbody>
            {todos.map((liq, i) => {
              const sums = sumByFormaPago(liq.lineas, liq.novedades);
              const open = expandido === liq.legajo_id;
              const bucketPaid = (col) => {
                const ls   = liq.lineas.filter(l => l.tipo === col);
                const novs = (liq.novedades || []).filter(n => n.forma_pago === col);
                if (!ls.length && !novs.length) return null;
                return ls.every(l => getPagosLinea(liq, l).length > 0)
                    && novs.every(n => getPagosNovedad(liq, n).length > 0);
              };
              return (
                <Fragment key={liq.legajo_id}>
                  <tr onClick={() => setExpandido(open ? null : liq.legajo_id)}
                    style={{ background: open ? T.blueLt : i % 2 === 0 ? "#fff" : T.bg, borderBottom: open ? "none" : `1px solid ${T.border}`, cursor: "pointer" }}>
                    <td style={TD({ fontWeight: 600 })}>
                      <span style={{ color: T.dim, marginRight: 6, fontSize: 11 }}>{open ? "▾" : "▸"}</span>
                      {liq.legajo_nombre}
                      <EstadoBadge estado={liq.estado} />
                    </td>
                    <td style={TD({ textAlign: "right", fontWeight: 700, color: T.blue })}>{fmtMoney(liq.total_liquidacion)}</td>
                    {COLS.map(c => {
                      const monto = sums[c.id];
                      const paid  = bucketPaid(c.id);
                      if (!monto) return <td key={c.id} style={TD({ textAlign: "right", color: T.dim })}>—</td>;
                      return (
                        <td key={c.id} style={TD({ textAlign: "right", color: paid ? T.green : FP_TIPO_COLOR[c.id] || T.text })}>
                          {fmtMoney(monto)}{paid && <span style={{ marginLeft: 4, fontWeight: 700 }}>✓</span>}
                        </td>
                      );
                    })}
                    <td style={TD({ textAlign: "right", color: T.green })}>{fmtMoney(liq.total_pagado)}</td>
                    <td style={TD({ textAlign: "right", fontWeight: 600, color: liq.pendiente > 0 ? T.red : T.green })}>{fmtMoney(liq.pendiente)}</td>
                  </tr>
                  {open && (
                    <EmpleadoPagosLineas
                      liq={liq}
                      cols={COLS}
                      onPagar={(cell) => onRegistrarPago({ legajo_id: liq.legajo_id, cell })}
                      onVerPago={(pago) => setAnularModal(pago)}
                    />
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "16px 0", borderTop: `1px solid ${T.border}`, marginTop: 8 }}>
        <button style={BTN_EXPORT("#16a34a")} onClick={() => exportarHaberes(todos, mes, anio)}>
          📥 Excel Haberes (banco)
        </button>
        <button style={BTN_EXPORT("#0369a1")} onClick={() => exportarDeposito(todos, mes, anio)}>
          📥 Excel Depósito
        </button>
        <button style={BTN_EXPORT("#7c3aed")} onClick={() => exportarTransferenciaFinanciera(todos, mes, anio)}>
          📥 Excel Trf. financiera
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

      {batchModal && (
        <ModalBatchPago
          tipo={batchModal.tipo}
          items={pendientesTipo(batchModal.tipo)}
          mes={mes} anio={anio}
          onClose={() => setBatchModal(null)}
          onSaved={() => { setBatchModal(null); onBatchPaid?.(); }}
        />
      )}
    </div>
  );
}

// Detalle del Paso 3: desglose INLINE de la fila principal — mismas columnas
// (Total · formas de pago · Pagado · Pendiente), una fila por cuenta contable.
// Cada celda (cuenta × forma de pago) es un agrupamiento visual; al imputarla se
// paga cada ítem subyacente con su propio forma_pago_id (un nb_movimiento por
// línea). Sin descriptor bancario (el destino se resolvió en el Paso 2 / Excels).
function EmpleadoPagosLineas({ liq, cols, onPagar, onVerPago }) {
  const novedades   = liq.novedades || [];
  const cuentasNov  = [...new Set(novedades.map(n => n.cuenta_contable_nombre || "—"))];

  const itemsLinea = (tipo) => liq.lineas.filter(l => l.tipo === tipo).map(l => ({ kind: "linea", ref: l }));
  const itemsNov   = (cuenta, tipo) => novedades
    .filter(n => (n.cuenta_contable_nombre || "—") === cuenta && n.forma_pago === tipo)
    .map(n => ({ kind: "novedad", ref: n }));

  const filas = [
    { cuenta: CUENTA_CONTABLE_SUELDOS, esSueldo: true, cuenta_contable_id: null,
      cuenta_contable_nombre: CUENTA_CONTABLE_SUELDOS, items: (tipo) => itemsLinea(tipo) },
    ...cuentasNov.map(cuenta => {
      const muestra = novedades.find(n => (n.cuenta_contable_nombre || "—") === cuenta);
      return { cuenta, esSueldo: false, cuenta_contable_id: muestra?.cuenta_contable_id ?? null,
        cuenta_contable_nombre: cuenta, items: (tipo) => itemsNov(cuenta, tipo) };
    }),
  ];

  const pagosItem = (it) => it.kind === "linea" ? getPagosLinea(liq, it.ref) : getPagosNovedad(liq, it.ref);
  const montoItem = (it) => (it.kind === "linea" ? Number(it.ref.importe) : Number(it.ref.monto)) || 0;
  // Filas compactas y grises para diferenciarlas de la fila principal del empleado.
  const tdBase    = { background: "#cbd5e1", borderBottom: "none", fontSize: 12, color: T.text };
  const btn       = { background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: T.font, fontWeight: 600, fontSize: 12 };

  return (
    <>
      {filas.map((f, idx) => {
        const allItems = cols.flatMap(c => f.items(c.id));
        const total    = allItems.reduce((s, it) => s + montoItem(it), 0);
        const pagado   = allItems.reduce((s, it) => s + pagosItem(it).reduce((a, p) => a + (Number(p.monto) || 0), 0), 0);
        const pend     = total - pagado;
        const last     = idx === filas.length - 1;
        return (
          <tr key={f.cuenta} style={{ background: "#cbd5e1", borderBottom: last ? `1px solid ${T.border}` : "none" }}>
            <td style={TD({ ...tdBase, paddingLeft: 34, fontWeight: 600 })}>{f.cuenta_contable_nombre}</td>
            <td style={TD({ ...tdBase, textAlign: "right" })}>{fmtMoney(total)}</td>
            {cols.map(c => {
              const items = f.items(c.id);
              if (!items.length) return <td key={c.id} style={TD({ ...tdBase, textAlign: "right", color: T.dim })}>—</td>;
              const monto      = items.reduce((s, it) => s + montoItem(it), 0);
              const pagosCelda = items.map(pagosItem);
              const paid       = pagosCelda.every(p => p.length > 0);
              if (paid) {
                const primerPago = pagosCelda.find(p => p.length > 0)[0];
                return (
                  <td key={c.id} style={TD({ ...tdBase, textAlign: "right" })}>
                    <button onClick={() => onVerPago(primerPago)} title="Ver / anular este pago"
                      style={{ ...btn, color: T.green }}>
                      {fmtMoney(monto)} ✓
                    </button>
                  </td>
                );
              }
              const pendientes = items.filter(it => pagosItem(it).length === 0);
              return (
                <td key={c.id} style={TD({ ...tdBase, textAlign: "right" })}>
                  <button title={`Imputar ${FP_TIPO_LABEL[c.id] || c.id} → ${f.cuenta_contable_nombre}`}
                    onClick={() => onPagar({
                      tipo: c.id, esSueldo: f.esSueldo,
                      cuenta_contable_id: f.cuenta_contable_id,
                      cuenta_contable_nombre: f.cuenta_contable_nombre,
                      items: pendientes,
                    })}
                    style={{ ...btn, color: FP_TIPO_COLOR[c.id] || T.text, textDecoration: "underline", textDecorationStyle: "dotted" }}>
                    {fmtMoney(monto)}
                  </button>
                </td>
              );
            })}
            <td style={TD({ ...tdBase, textAlign: "right", color: T.green })}>{fmtMoney(pagado)}</td>
            <td style={TD({ ...tdBase, textAlign: "right", fontWeight: 600, color: pend > 0 ? T.red : T.green })}>{fmtMoney(pend)}</td>
          </tr>
        );
      })}
    </>
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
    : pago.tipo_componente === "monotributo"                  ? form.sociedad_id
    : "beta";  // depósito / efectivo / transferencia financiera → Beta
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
        lote_pago:              nuevoLote(),
        legajo_id:              pago.legajo_id,
        legajo_nombre:          pago.legajo_nombre,
        // Sociedad pagadora = la dueña de la cuenta elegida (quién mueve la tesorería).
        sociedad_id:            cta?.sociedad ?? pago.sociedad_id,
        sociedad_nombre:        sociedades.find(s => s.id === cta?.sociedad)?.nombre ?? pago.sociedad_nombre,
        // Centro de costo = el de la persona (se preserva del pago original).
        centro_costo:           pago.centro_costo ?? pago.sede_id ?? "",
        tipo_componente:        pago.tipo_componente,
        monto:                  parseFloat(form.monto) || 0,
        fecha:                  form.fecha,
        cuenta_bancaria_id:     form.cuenta_id,
        cuenta_bancaria_nombre: cta?.nombre ?? "",
        // Preservar la trazabilidad del pago original al recrearlo.
        forma_pago_id:          pago.forma_pago_id ?? "",
        concepto:               pago.concepto ?? "",
        nota:                   pago.nota ?? "",
        ambito:                 pago.ambito || "hq",
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
              {pago.tipo_componente === "monotributo" && (
                <div>
                  <ModalLabel>Sociedad que transfiere</ModalLabel>
                  <select style={MODAL_INPUT} value={form.sociedad_id}
                    onChange={e => setForm(f => ({ ...f, sociedad_id: e.target.value, cuenta_id: "" }))}>
                    <option value="">— Seleccioná —</option>
                    {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
              )}
              {(pago.tipo_componente === "deposito" || pago.tipo_componente === "efectivo" || pago.tipo_componente === "transferencia_financiera") && (
                <div style={{ fontSize: 12, color: T.muted, background: T.bg, borderRadius: 5, padding: "6px 10px" }}>
                  Sociedad: <strong style={{ color: T.text }}>Beta</strong>
                </div>
              )}
              <div>
                <ModalLabel>{pago.tipo_componente === "efectivo" ? "Caja" : "Cuenta bancaria"}</ModalLabel>
                {loadingCtas
                  ? <div style={{ fontSize: 12, color: T.muted }}>Cargando…</div>
                  : <select style={MODAL_INPUT} value={form.cuenta_id} onChange={e => set("cuenta_id", e.target.value)}
                      disabled={pago.tipo_componente === "monotributo" && !form.sociedad_id}>
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

// Imputa una CELDA (cuenta contable × forma de pago) del Paso 3: genera un
// nb_movimiento por ítem (línea de sueldo o novedad), todos a la misma cuenta
// contable, sociedad pagadora (dueña de la cuenta elegida) y centro de costo.
function ModalPagoHQ({ mes, anio, liq, cell, onClose, onSaved }) {
  const tipo       = cell.tipo;
  const montoItem  = (it) => (it.kind === "linea" ? Number(it.ref.importe) : Number(it.ref.monto)) || 0;
  const montoTotal = cell.items.reduce((s, it) => s + montoItem(it), 0);
  const [form, setForm] = useState({
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
      .then(([socs, ctas, cc]) => {
        setSociedades(socs); setCuentas(ctas); setCuentasContables(cc);
        // El sueldo imputa siempre a "Sueldos"; una novedad a SU cuenta contable.
        const cuenta = cell.esSueldo
          ? findCuenta(cc, null, CUENTA_CONTABLE_SUELDOS)
          : findCuenta(cc, cell.cuenta_contable_id, cell.cuenta_contable_nombre);
        if (cuenta) setForm(f => ({ ...f, cuenta_contable_id: cuenta.id }));
      })
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
    if (!form.cuenta_id) { alert("Seleccioná una cuenta bancaria."); return; }
    savingRef.current = true; setSaving(true);
    try {
      const cta = cuentas.find(c => c.id === form.cuenta_id);
      // Datos comunes a todos los movimientos de la celda. La sociedad pagadora =
      // dueña de la cuenta elegida (quién mueve la tesorería), no la del empleado.
      // Un lote por acción de pago → Conciliación matchea el débito contra el total del lote.
      const lote_pago = nuevoLote();
      const comunes = {
        mes, anio, lote_pago,
        legajo_id:               liq.legajo_id,
        legajo_nombre:           liq.legajo_nombre,
        sociedad_id:             cta?.sociedad ?? liq.sociedad_id,
        sociedad_nombre:         sociedades.find(s => s.id === cta?.sociedad)?.nombre ?? liq.sociedad_nombre,
        centro_costo:            liq.sede_id ?? "",   // sede_id = nombre legacy del centro de costo
        tipo_componente:         tipo,
        fecha:                   form.fecha,
        cuenta_bancaria_id:      form.cuenta_id,
        cuenta_bancaria_nombre:  cta?.nombre ?? "",
        cuenta_contable_id:      form.cuenta_contable_id,
        cuenta_contable_nombre:  cuentasContables.find(c => c.id === form.cuenta_contable_id)?.nombre ?? "",
      };
      // Un nb_movimiento por ítem (granularidad por línea). Secuencial a propósito:
      // el backend GAS pierde escrituras concurrentes a nb_movimientos (appendRow colisiona).
      for (const it of cell.items) {
        await appendPago({ ...comunes, forma_pago_id: it.ref.id, monto: montoItem(it), concepto: conceptoPago(it, liq, mes, anio), nota: notaPago(it), ambito: "hq" });
      }
      await onSaved();
    } catch (e) { alert("Error: " + e.message); setSaving(false); } finally { savingRef.current = false; }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: T.font }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>Registrar pago — {liq?.legajo_nombre}</h3>
        <p style={{ margin: "0 0 16px", fontSize: 12, color: T.muted }}>Pendiente: {fmtMoney(liq?.pendiente)}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: T.muted, background: T.bg, borderRadius: 5, padding: "8px 10px" }}>
            <strong style={{ color: T.text }}>{cell.cuenta_contable_nombre}</strong>
            {" · "}
            <strong style={{ color: FP_TIPO_COLOR[tipo] || T.text }}>{FP_TIPO_LABEL[tipo] || tipo}</strong>
            {cell.items.length > 1 && <span> · {cell.items.length} movimientos</span>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", background: T.bg, borderRadius: 5, padding: "8px 10px" }}>
            <span style={{ fontSize: 12, color: T.muted }}>Total a imputar</span>
            <strong style={{ fontSize: 16, color: T.text }}>{fmtMoney(montoTotal)}</strong>
          </div>
          <div>
            <ModalLabel>Fecha</ModalLabel>
            <input style={MODAL_INPUT} type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} />
          </div>
          {tipo === "monotributo" && (
            <div>
              <ModalLabel>Sociedad que transfiere</ModalLabel>
              <select style={MODAL_INPUT} value={form.sociedad_id}
                onChange={e => setForm(f => ({ ...f, sociedad_id: e.target.value, cuenta_id: "" }))}>
                <option value="">— Seleccioná —</option>
                {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          )}
          {(tipo === "deposito" || tipo === "efectivo" || tipo === "transferencia_financiera") && (
            <div style={{ fontSize: 12, color: T.muted, background: T.bg, borderRadius: 5, padding: "6px 10px" }}>
              Sociedad: <strong style={{ color: T.text }}>Beta</strong>
            </div>
          )}
          <div>
            <ModalLabel>{tipo === "efectivo" ? "Caja" : "Cuenta bancaria"} (origen)</ModalLabel>
            {loadingCtas
              ? <div style={{ fontSize: 12, color: T.muted }}>Cargando…</div>
              : <select style={MODAL_INPUT} value={form.cuenta_id} onChange={e => set("cuenta_id", e.target.value)}
                  disabled={tipo === "monotributo" && !form.sociedad_id}>
                  <option value="">— Seleccioná —</option>
                  {cuentasFiltradas.map(c => (
                    <option key={c.id} value={c.id}>{ctaLabel(c, sociedades)}</option>
                  ))}
                </select>
            }
          </div>
          <div style={{ fontSize: 12, color: T.muted, background: T.bg, borderRadius: 5, padding: "6px 10px" }}>
            Cuenta contable: <strong style={{ color: T.text }}>{cell.cuenta_contable_nombre}</strong>
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

// ── Modal batch: imputar todos los ítems de un tipo en masa ────────────────────
// items = [{ liq, kind:"linea"|"novedad", ref }] pendientes de ese tipo (todos los
// empleados). Registra un movimiento por ítem; cada uno imputa a SU cuenta contable
// (Sueldos para líneas, la propia para novedades). La sociedad pagadora sale de la
// cuenta elegida y el centro de costo es el de la persona.
function ModalBatchPago({ tipo, items, mes, anio, onClose, onSaved }) {
  const socFija = (tipo === "deposito" || tipo === "efectivo" || tipo === "transferencia_financiera") ? "beta" : null;
  // Para haberes/monotributo: pre-cargar la sociedad del devengado (la del legajo) si todos
  // los ítems coinciden; editable. Es la caja de origen, no cambia la atribución del devengado.
  const socDefault = socFija ?? (() => {
    const socs = [...new Set(items.map(it => it.liq?.sociedad_id).filter(Boolean))];
    return socs.length === 1 ? socs[0] : "";
  })();
  const [form, setForm] = useState({
    fecha:       new Date().toISOString().slice(0, 10),
    sociedad_id: socDefault,
    cuenta_id:   "",
  });
  const [sociedades,       setSociedades]       = useState([]);
  const [cuentas,          setCuentas]          = useState([]);
  const [cuentasContables, setCuentasContables] = useState([]);
  const [loadingMeta,      setLoadingMeta]      = useState(true);
  const [sel,              setSel]              = useState(() => new Set(items.map((_, i) => i)));
  const [saving,           setSaving]           = useState(false);
  const savingRef = useRef(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    Promise.all([fetchSociedadesNumbers(), fetchCuentasBancariasNumbers(), fetchCuentasContablesNumbers()])
      .then(([socs, ctas, cc]) => { setSociedades(socs); setCuentas(ctas); setCuentasContables(cc); })
      .finally(() => setLoadingMeta(false));
  }, []);

  const socFiltro = socFija ?? form.sociedad_id;
  const cuentasFiltradas = useMemo(() =>
    socFiltro ? cuentas.filter(c => c.sociedad === socFiltro) : [],
  [cuentas, socFiltro]);

  const montoItem  = (it) => (it.kind === "linea" ? Number(it.ref.importe) : Number(it.ref.monto)) || 0;
  const cuentaItem = (it) => it.kind === "linea"
    ? findCuenta(cuentasContables, null, CUENTA_CONTABLE_SUELDOS)
    : findCuenta(cuentasContables, it.ref.cuenta_contable_id, it.ref.cuenta_contable_nombre);
  const describirItem = (it) => it.kind === "linea"
    ? describirDestino(it.ref, it.liq.legajo_nombre)
    : (it.ref.cuenta_contable_nombre || "Novedad");

  const toggle = (i) => setSel(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const itemsSel = items.filter((_, i) => sel.has(i));
  const total    = itemsSel.reduce((s, it) => s + montoItem(it), 0);

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!itemsSel.length) { alert("Seleccioná al menos un ítem."); return; }
    if (!form.cuenta_id)  { alert("Seleccioná una cuenta bancaria."); return; }
    savingRef.current = true; setSaving(true);
    try {
      const cta        = cuentas.find(c => c.id === form.cuenta_id);
      const socNombre  = sociedades.find(s => s.id === cta?.sociedad)?.nombre ?? "";
      const lote_pago  = nuevoLote();
      // Secuencial a propósito: el backend GAS pierde escrituras concurrentes a
      // nb_movimientos (appendRow colisiona si se disparan en paralelo).
      for (const it of itemsSel) {
        const { liq, ref } = it;
        const cc = cuentaItem(it);
        const concepto = conceptoPago(it, liq, mes, anio);
        await appendPago({
          mes, anio, lote_pago,
          legajo_id:              liq.legajo_id,
          legajo_nombre:          liq.legajo_nombre,
          sociedad_id:            cta?.sociedad ?? liq.sociedad_id,
          sociedad_nombre:        socNombre || liq.sociedad_nombre,
          centro_costo:           liq.sede_id ?? "",
          tipo_componente:        tipo,
          forma_pago_id:          ref.id ?? "",
          monto:                  montoItem(it),
          fecha:                  form.fecha,
          cuenta_bancaria_id:     form.cuenta_id,
          cuenta_bancaria_nombre: cta?.nombre ?? "",
          cuenta_contable_id:     cc?.id ?? "",
          cuenta_contable_nombre: cc?.nombre ?? "",
          concepto,
          nota: notaPago(it),
          ambito: "hq",
        });
      }
      await onSaved();
    } catch (e) { alert("Error: " + e.message); setSaving(false); } finally { savingRef.current = false; }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, fontFamily: T.font }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 460, boxShadow: "0 8px 32px rgba(0,0,0,.18)", maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>
          Imputar en masa — <span style={{ color: FP_TIPO_COLOR[tipo] || T.text }}>{FP_TIPO_LABEL[tipo] || tipo}</span>
        </h3>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: T.muted }}>
          {itemsSel.length} ítem{itemsSel.length !== 1 ? "s" : ""} · Total <strong style={{ color: T.text }}>{fmtMoney(total)}</strong>
        </p>

        <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, marginBottom: 16, maxHeight: 200, overflowY: "auto" }}>
          {items.map((it, i) => {
            const checked = sel.has(i);
            return (
              <label key={i} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", cursor: "pointer", fontSize: 13,
                borderBottom: i < items.length - 1 ? `1px solid ${T.border}` : "none",
                background: checked ? "#f0fdf4" : "#fff",
              }}>
                <input type="checkbox" checked={checked} onChange={() => toggle(i)} style={{ accentColor: T.green, width: 14, height: 14, cursor: "pointer" }} />
                <span style={{ flex: 1, color: T.text }}>
                  {it.liq.legajo_nombre}
                  <span style={{ color: T.dim, fontSize: 11 }}> · {describirItem(it)}</span>
                  {it.kind === "novedad" && <span style={{ color: T.purple, fontSize: 10, fontWeight: 700, marginLeft: 6 }}>NOV</span>}
                </span>
                <span style={{ fontWeight: 700, color: checked ? (FP_TIPO_COLOR[tipo] || T.text) : T.dim }}>{fmtMoney(montoItem(it))}</span>
              </label>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <ModalLabel>Fecha</ModalLabel>
            <input style={MODAL_INPUT} type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} />
          </div>
          {!socFija && (
            <div>
              <ModalLabel>Sociedad que paga</ModalLabel>
              <select style={MODAL_INPUT} value={form.sociedad_id} onChange={e => { set("sociedad_id", e.target.value); set("cuenta_id", ""); }}>
                <option value="">— Seleccioná —</option>
                {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          )}
          {socFija && (
            <div style={{ fontSize: 12, color: T.muted, background: T.bg, borderRadius: 5, padding: "6px 10px" }}>
              Sociedad: <strong style={{ color: T.text }}>Beta</strong>
            </div>
          )}
          <div>
            <ModalLabel>{tipo === "efectivo" ? "Caja" : "Cuenta bancaria"} (origen)</ModalLabel>
            {loadingMeta
              ? <div style={{ fontSize: 12, color: T.muted }}>Cargando cuentas…</div>
              : <select style={MODAL_INPUT} value={form.cuenta_id} onChange={e => set("cuenta_id", e.target.value)} disabled={!socFiltro}>
                  <option value="">— Seleccioná —</option>
                  {cuentasFiltradas.map(c => <option key={c.id} value={c.id}>{ctaLabel(c, sociedades)}</option>)}
                </select>
            }
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={BTN_SECONDARY}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !itemsSel.length} style={{
            background: (saving || !itemsSel.length) ? T.dim : T.green, color: "#fff", border: "none",
            borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600,
            cursor: (saving || !itemsSel.length) ? "not-allowed" : "pointer",
          }}>
            {saving ? "Procesando…" : `Imputar ${itemsSel.length} pago${itemsSel.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
