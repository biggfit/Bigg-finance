import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { T } from "./theme";
import {
  fetchCuentasBancarias, fetchMovimientosPendientes, ingestarExtracto, aceptarMovimiento,
  aceptarCobroFranquicia, fetchBancoReglas, fetchProveedores, fetchCuentas, fetchCentrosCosto, fetchSociedades,
  ignorarMovimiento, restaurarMovimiento, fetchMovimientosIgnorados, fetchPagosSueldos,
  fetchEgresos, fetchPagosCobros, calcSaldoPendiente, imputarPagoFC,
  appendBancoRegla, fetchIngresos, imputarCobroIngreso,
  fetchFinanciaciones, imputarCuota,
} from "../lib/numbersApi";
import { BancoReglaModal } from "./PantallaMaestros";
import { fetchAll } from "../lib/sheetsApi";
import { computeSaldoReal } from "../lib/helpers";
import { parseGalicia } from "./parsers/galicia";
import { clasificarLineas, clasificarLinea, reconocerCuota } from "./reconciliacion/ruleEngine";

const TIPO_LABEL = {
  impuesto: "Impuesto", comision: "Comisión", interes: "Interés", servicio: "Servicio",
  transferencia_interna: "Transf. interna", ingreso: "Ingreso", financiacion: "Financiación",
  pago_proveedor: "Pago proveedor", cobro_franquicia: "Cobro franquicia",
  cuota_financiacion: "Cuota de financiación", sin_clasificar: "Sin clasificar",
};
// fr_tipo según monto vs deuda viva del franquiciado. Crédito que matchea la deuda → PAGO de CC;
// si no hay deuda que lo respalde → PAGO_PAUTA (a cuenta). Débito → PAGO_ENVIADO.
const sugerirFrTipo = (monto, deuda) => {
  if ((Number(monto) || 0) < 0) return "PAGO_ENVIADO";
  const d = Number(deuda) || 0;   // positivo = debe; solo es Pago de CC si hay deuda que lo respalde
  return d > 0 && Math.abs(Math.abs(monto) - d) <= Math.max(500, d * 0.02) ? "PAGO" : "PAGO_PAUTA";
};
const FR_TIPO_LABEL = { PAGO: "Pago de CC", PAGO_PAUTA: "Pago a cuenta", PAGO_ENVIADO: "Transf. enviada" };
// Etiqueta legible del saldo de CC (positivo = debe, negativo = a favor).
const deudaLabel = (d) => Math.abs(Number(d) || 0) < 1 ? "al día" : (Number(d) > 0 ? `debe ${fmt(d)}` : `a favor ${fmt(-d)}`);
const fmt = n => (Number(n) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });
const normCuit = s => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");
// Dedup por id: el master de centros/cuentas tiene ids repetidos (ej. cc-2026-chueca) que
// rompen la reconciliación de React (claves duplicadas) y filtran opciones de un select a otro.
const dedupById = arr => { const seen = new Set(); return (arr || []).filter(x => x && !seen.has(x.id) && seen.add(x.id)); };
const MENU_ITEM = { display: "block", width: "100%", textAlign: "left", padding: "9px 12px", fontSize: 11, border: "none", borderBottom: "1px solid #f1f5f9", background: "#fff", color: "#111827", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const parseMeta = ref => Object.fromEntries(String(ref || "").split(";").map(kv => kv.split("=")).filter(a => a.length === 2));
const sel = { fontSize: 11, padding: "4px 6px", border: "1px solid #94a3b8", borderRadius: 6, fontFamily: T.font, color: "#111827", background: "#f8fafc" };
// Campo imputado: VERDE si está completo (no tocar) / ÁMBAR si falta elegir. Ancho fijo → columnas alineadas.
const fld = (lleno, w = 150) => ({ fontSize: 11, padding: "4px 6px", borderRadius: 6, fontFamily: T.font, color: "#111827", width: w, boxSizing: "border-box",
  background: lleno ? "#dcfce7" : "#fff7ed", border: `1px solid ${lleno ? "#4ade80" : "#fb923c"}` });

export default function PantallaReconciliacion({ sociedad, onPendientes }) {
  const [cuentas,    setCuentas]    = useState([]);
  const [cuentasAll, setCuentasAll] = useState([]); // todas las cuentas bancarias (todas las sociedades) para destino de transferencia
  const [cuentaTab,  setCuentaTab]  = useState("");
  const [pendientes, setPendientes] = useState([]);
  const [planCuentas,setPlanCuentas]= useState([]);
  const [centros,    setCentros]    = useState([]);
  const [reglas,     setReglas]     = useState([]);
  const [proveedores,setProveedores]= useState([]);
  const [franquicias,setFranquicias]= useState([]);
  const [sociedades, setSociedades] = useState([]); // nb_sociedades (con cuit) para detectar intercompany
  const [frComps,    setFrComps]    = useState({});
  const [frSaldos,   setFrSaldos]   = useState({});
  const [pagosSueldos,setPagosSueldos]= useState([]); // movs origen=sueldos haberes (para matchear lotes)
  const [egresos,    setEgresos]    = useState([]);    // facturas de proveedor (para imputar pagos)
  const [ingresos,   setIngresos]   = useState([]);    // facturas de venta (para imputar cobros)
  const [pagosCobros,setPagosCobros]= useState([]);    // pagos/cobros (para saldo pendiente de cada FC)
  const [financiaciones, setFinanciaciones] = useState([]); // planes AFIP + créditos (para imputar cuotas)
  const [ignorados,  setIgnorados]  = useState([]);    // líneas del extracto ya descartadas
  const [erroresIngesta, setErroresIngesta] = useState(null); // { lineas, cuenta_bancaria, moneda } que fallaron al subir
  const [filtroTipo, setFiltroTipo] = useState("");   // filtro por grupo de Propuesta (para aprobar por grupos)
  const [verIgnorados,setVerIgnorados]= useState(false);
  const [reglaModal, setReglaModal] = useState(null);  // {prefill} para crear regla desde una línea
  const [loading,    setLoading]    = useState(true);
  const [uploading,  setUploading]  = useState(false);
  const [msg,        setMsg]        = useState("");
  const [edits,      setEdits]      = useState({}); // movId → {cuenta_contable, centro_costo}
  const [menuFor,    setMenuFor]    = useState(null); // movId con el menú ⋯ abierto
  const fileRef = useRef(null);

  // Cerrar el menú ⋯ al clickear afuera
  useEffect(() => {
    if (menuFor === null) return;
    const h = () => setMenuFor(null);
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [menuFor]);

  // Avisa al sidebar el conteo de pendientes (badge en vivo)
  useEffect(() => { onPendientes?.(pendientes.length); }, [pendientes, onPendientes]);

  const recargar = async () => {
    setLoading(true);
    try {
      const pend = await fetchMovimientosPendientes(sociedad);
      setPendientes(Array.isArray(pend) ? pend : []);
    } catch (e) { setMsg("Error al cargar pendientes: " + e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    setMsg("");
    fetchCuentasBancarias().then(all => {
      setCuentasAll(all || []);
      const soc = (all || []).filter(c => c.sociedad === sociedad);
      setCuentas(soc);
      setCuentaTab(soc[0]?.id || "");
    }).catch(console.error);
    fetchCuentas().then(c => setPlanCuentas(dedupById(c))).catch(console.error);
    fetchCentrosCosto().then(c => setCentros(dedupById(c))).catch(console.error);
    fetchBancoReglas().then(r => setReglas(r || [])).catch(console.error);
    fetchProveedores().then(p => setProveedores(p || [])).catch(console.error);
    fetchSociedades().then(s => setSociedades(s || [])).catch(console.error);
    // Master de franquicias + su cuenta corriente (read-only, sistema de Franquicias) para
    // reconocer cobros y sugerir Pago de CC vs Pago a cuenta contra la deuda viva.
    fetchAll().then(({ franchises, comps, saldos }) => {
      setFranquicias(franchises || []);
      setFrComps(comps || {});
      setFrSaldos(saldos || {});
    }).catch(console.error);
    fetchPagosSueldos(sociedad).then(p => setPagosSueldos(p || [])).catch(console.error);
    fetchMovimientosIgnorados(sociedad).then(i => setIgnorados(i || [])).catch(console.error);
    fetchEgresos(sociedad).then(e => setEgresos(e || [])).catch(console.error);
    fetchIngresos(sociedad).then(i => setIngresos(i || [])).catch(console.error);
    fetchPagosCobros(sociedad).then(p => setPagosCobros(p || [])).catch(console.error);
    fetchFinanciaciones(sociedad).then(f => setFinanciaciones(f || [])).catch(console.error);
    recargar();
  }, [sociedad]);

  // Deuda viva del franquiciado (saldo de su CC al mes actual). Positivo = debe.
  // Memoizado con cache por franquicia: computeSaldoReal es pesado y se pide muchas veces por render.
  const deudaFr = useMemo(() => {
    const cache = new Map();
    return (frId) => {
      const key = String(frId);
      if (cache.has(key)) return cache.get(key);
      const fr = franquicias.find(f => String(f.id) === key);
      let v = 0;
      if (fr) { const now = new Date(); v = computeSaldoReal(fr.id, now.getFullYear(), now.getMonth(), frComps, frSaldos, fr.moneda || fr.currency || "ARS", null, null); }
      cache.set(key, v);
      return v;
    };
  }, [franquicias, frComps, frSaldos]);
  const frNombre = (frId) => franquicias.find(f => String(f.id) === String(frId))?.name || "";

  const byName = (a, b) => String(a.name ?? a.nombre ?? "").localeCompare(String(b.name ?? b.nombre ?? ""));
  const monedaCuenta = useMemo(() => cuentas.find(c => c.id === cuentaTab)?.moneda || "ARS", [cuentas, cuentaTab]);
  // Selector manual: TODAS las franquicias activas (sin filtrar por moneda) — una franquicia
  // de otra moneda puede cobrar en pesos (ej. Pocitos). El sufijo avisa cuando difiere.
  const franquiciasManual = useMemo(
    () => franquicias.filter(f => f.activa !== false).sort(byName),
    [franquicias]);
  const frMonedaSuf = (f) => { const cur = (f.currencies || [])[0] || f.moneda || f.currency || ""; return cur && cur !== monedaCuenta ? ` · ${cur}` : ""; };
  // Cuentas contables: TODAS (ordenadas). No filtramos por signo con heurística de nombre porque
  // misclasifica (ej. "IIBB / Ingresos Brutos" es un impuesto, no un ingreso) → ocultaba la cuenta
  // que la regla ya había imputado. El usuario elige; la regla pre-llena.
  const cuentasTodas = useMemo(() => [...planCuentas].sort(byName), [planCuentas]);
  // Sets de ids para validar O(1) (verde/aceptable solo si el valor existe en el master).
  const cuentasId = useMemo(() => new Set(cuentasTodas.map(c => String(c.id))), [cuentasTodas]);
  const centrosId = useMemo(() => new Set(centros.map(c => String(c.id))), [centros]);
  const cuentaValida = (id) => !!id && cuentasId.has(String(id));
  const ccValido     = (id) => !!id && centrosId.has(String(id));

  // ── Pago de haberes: el débito del banco ya está en los movs origen=sueldos (doble conteo).
  // Agrupamos esos movs por lote_pago (un lote = una tanda de pago) → matcheamos el débito
  // contra el TOTAL del lote para sugerir "ya está en Sueldos — descartar".
  const lotesConsumidos = useMemo(() => {           // lotes ya conciliados (una línea ignorada los tomó)
    const s = new Set();
    ignorados.forEach(m => { const ig = parseMeta(m.referencia).ign || ""; if (ig.startsWith("haberes:")) s.add(ig.slice(8)); });
    return s;
  }, [ignorados]);
  const lotesHaberes = useMemo(() => {
    const g = {};
    for (const p of pagosSueldos) {
      const lote = p.lote_pago || "";
      if (!lote || lotesConsumidos.has(lote) || String(p.cuenta_bancaria) !== String(cuentaTab)) continue;
      if (!g[lote]) g[lote] = { lote, fecha: p.fecha, total: 0, count: 0 };
      g[lote].total += Math.abs(Number(p.monto) || 0);
      g[lote].count += 1;
    }
    return Object.values(g);
  }, [pagosSueldos, lotesConsumidos, cuentaTab]);
  const haberesMatch = (mov) => {
    if ((Number(mov.monto) || 0) >= 0) return null;
    const t = Math.abs(Number(mov.monto) || 0);
    return lotesHaberes.find(L => Math.abs(L.total - t) <= Math.max(500, L.total * 0.01)) || null;
  };

  // ── Imputar a factura: facturas de proveedor con saldo pendiente, de la moneda de la cuenta.
  const facturasPendientes = useMemo(() => {
    const pagosFC = pagosCobros.filter(p => p.tipo === "PAGO" || p.tipo === "EGRESO_GASTO");
    return egresos
      .map(eg => ({ ...eg, saldo: calcSaldoPendiente(eg.importe ?? eg.total, pagosFC.filter(p => p.documento_id === eg.id)) }))
      .filter(eg => eg.saldo > 0.01 && (eg.moneda || "ARS") === monedaCuenta);
  }, [egresos, pagosCobros, monedaCuenta]);
  // Proveedores que tienen al menos una factura pendiente (para la 1ª caja del modo FC).
  const provConPendientes = useMemo(() => {
    const m = new Map();
    facturasPendientes.forEach(f => { if (!m.has(String(f.proveedorId))) m.set(String(f.proveedorId), f.proveedor || "Sin proveedor"); });
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [facturasPendientes]);
  const fcsDeProv = (provId) => facturasPendientes
    .filter(f => String(f.proveedorId) === String(provId))
    .sort((a, b) => String(a.vto || "").localeCompare(String(b.vto || "")));
  const fcLabel = (f) => `${f.nroComp || f.id} · saldo ${fmt(f.saldo)}${f.vto ? ` · vto ${f.vto}` : ""}`;
  // Proveedor efectivo de una línea en modo FC: el editado, o el reconocido si tiene pendientes.
  const fcProvDe = (mov) => {
    const ed = edits[mov.id] || {}, meta = parseMeta(mov.referencia);
    return ed.fc_prov ?? ((meta.prov && provConPendientes.some(p => p.id === String(meta.prov))) ? String(meta.prov) : "");
  };
  // FC efectiva: la editada, o la única del proveedor si hay exactamente una.
  const fcIdDe = (mov) => {
    const ed = edits[mov.id] || {};
    if (ed.fc_id != null) return ed.fc_id;
    const fcs = fcsDeProv(fcProvDe(mov));
    return fcs.length === 1 ? String(fcs[0].id) : "";
  };

  // ── Cobro de venta: facturas de venta con saldo pendiente (espejo de facturasPendientes).
  const ventasPendientes = useMemo(() => {
    const cobros = pagosCobros.filter(p => p.tipo === "COBRO");
    return ingresos
      .map(ing => ({ ...ing, saldo: calcSaldoPendiente(ing.importe ?? ing.total, cobros.filter(c => c.documento_id === ing.id)) }))
      .filter(ing => ing.saldo > 0.01 && (ing.moneda || "ARS") === monedaCuenta);
  }, [ingresos, pagosCobros, monedaCuenta]);
  const clientesConPendientes = useMemo(() => {
    const m = new Map();
    ventasPendientes.forEach(v => { if (!m.has(String(v.clienteId))) m.set(String(v.clienteId), v.cliente || "Sin cliente"); });
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [ventasPendientes]);
  const ventasDeCliente = (cliId) => ventasPendientes
    .filter(v => String(v.clienteId) === String(cliId))
    .sort((a, b) => String(a.vto || "").localeCompare(String(b.vto || "")));
  const cobClienteDe = (mov) => {
    const ed = edits[mov.id] || {};
    return ed.cob_cli ?? "";
  };
  const cobIdDe = (mov) => {
    const ed = edits[mov.id] || {};
    if (ed.cob_id != null) return ed.cob_id;
    const vs = ventasDeCliente(cobClienteDe(mov));
    return vs.length === 1 ? String(vs[0].id) : "";
  };
  // ── Cuotas de financiación pendientes (planes AFIP + créditos), de la moneda de la cuenta.
  const cuotasPendientes = useMemo(() => {
    const out = [];
    for (const p of financiaciones) {
      if (p.moneda && p.moneda !== monedaCuenta) continue;
      for (const c of (p.cuotas || [])) {
        if (c.estado !== "pendiente") continue;
        out.push({ plan_id: p.plan_id, nro_plan: p.nro_plan, acreedor_cuit: p.acreedor_cuit, acreedor_nombre: p.acreedor_nombre,
          nro_cuota: c.nro_cuota, row_id: c.rowId, total: c.total, total_tardio: c.total_tardio, vto: c.vto, moneda: p.moneda });
      }
    }
    return out;
  }, [financiaciones, monedaCuenta]);
  const planesVigentes = useMemo(() => {
    const m = new Map();
    cuotasPendientes.forEach(c => { if (!m.has(c.plan_id)) m.set(c.plan_id, { plan_id: c.plan_id, label: `${c.acreedor_nombre || "Plan"}${c.nro_plan ? " · " + c.nro_plan : ""}` }); });
    return [...m.values()];
  }, [cuotasPendientes]);
  const cuotasDePlan = (planId) => cuotasPendientes.filter(c => String(c.plan_id) === String(planId)).sort((a, b) => a.nro_cuota - b.nro_cuota);

  // Cuenta contable por defecto para retenciones sufridas (si existe una en el plan).
  const cuentaRetencionDefault = useMemo(
    () => planCuentas.find(c => /retenc/i.test(`${c.nombre} ${c.id}`))?.id || "",
    [planCuentas]);
  // Centro de las retenciones = "HQ - Impuestos" (son impuestos de la compañía → P&L BIGG, no sede).
  const centroRetencion = useMemo(
    () => (centros.find(c => (c.grupo ?? "").toLowerCase() === "hq" && /impuesto/i.test(c.nombre))
        || centros.find(c => /impuesto/i.test(c.nombre)))?.id || "",
    [centros]);

  // Subir extracto → ingestar como pendientes
  const onFile = async (file) => {
    if (!file || !cuentaTab) return;
    setUploading(true); setMsg("");
    try {
      const data = await parseGalicia(file);
      const cta = cuentas.find(c => c.id === cuentaTab);
      const ctx = { banco: cta?.banco, sociedad, pais: "", franquicias, sociedades, cuentas: cuentasAll, moneda: cta?.moneda || "ARS", cuotasPendientes };
      const lineas = clasificarLineas(data.lineas, reglas, proveedores, ctx);
      const moneda = cta?.moneda || "ARS";
      const { creados, dups, errores, fallidas } = await ingestarExtracto({ sociedad, cuenta_bancaria: cuentaTab, moneda, lineas });
      setMsg(`✓ ${creados} nuevos${dups ? ` · ${dups} duplicados` : ""}${errores ? ` · ⚠ ${errores} con error` : ""}.`);
      setErroresIngesta(errores ? { lineas: fallidas, cuenta_bancaria: cuentaTab, moneda } : null);
      await recargar();
    } catch (e) { setMsg("Error: " + e.message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  // Reintenta SOLO las líneas que fallaron en la última carga (no hace falta re-subir el archivo).
  const reintentarErrores = async () => {
    if (!erroresIngesta?.lineas?.length) return;
    setUploading(true); setMsg("");
    try {
      const { creados, dups, errores, fallidas } = await ingestarExtracto({ sociedad, ...erroresIngesta });
      setMsg(`✓ ${creados} reintentadas${dups ? ` · ${dups} ya estaban` : ""}${errores ? ` · ⚠ ${errores} siguen con error` : ""}.`);
      setErroresIngesta(errores ? { ...erroresIngesta, lineas: fallidas } : null);
      await recargar();
    } catch (e) { setMsg("Error: " + e.message); }
    finally { setUploading(false); }
  };

  // Estado de "modo franquicia" de una fila (auto por reconocimiento, o manual).
  // opciones = SOLO franquicias (master), nunca centros.
  const frState = (mov) => {
    const meta = parseMeta(mov.referencia);
    const ed = edits[mov.id] || {};
    // Reconocimiento EN VIVO por CUIT (robusto al timing de carga del master y al dedup):
    // si el CUIT empacado matchea franquicia(s), es cobro de franquicia aunque al ingestar no se haya clasificado.
    const credito = (Number(mov.monto) || 0) > 0;
    const porCuit = (meta.cuit && credito)
      ? franquicias.filter(f => f.activa !== false && normCuit(f.cuit) === normCuit(meta.cuit))
      : [];
    const es = !ed.noFranquicia && (meta.tipo === "cobro_franquicia" || porCuit.length > 0 || !!ed.modoFranquicia);
    if (!es) return { es: false };
    let opciones;
    if (ed.modoFranquicia) opciones = franquiciasManual;    // manual → activas de la moneda de la cuenta
    else if (porCuit.length) opciones = porCuit;            // vivo → las del CUIT
    else {                                                   // baked → las del CUIT empacado
      const ids = (meta.frops || "").split("|").filter(Boolean);
      opciones = ids.length ? franquicias.filter(f => ids.includes(String(f.id)))
               : (meta.fr ? franquicias.filter(f => String(f.id) === String(meta.fr)) : franquiciasManual);
      if (!opciones.length) opciones = franquiciasManual;
    }
    opciones = [...opciones].sort(byName);                   // siempre alfabético
    const franquiciaSel = ed.franquicia_id ?? (opciones.length === 1 ? String(opciones[0].id) : (meta.fr || ""));
    const deuda = franquiciaSel ? deudaFr(franquiciaSel) : 0;
    const frTipoSel = ed.fr_tipo ?? sugerirFrTipo(mov.monto, deuda);
    return { es: true, manual: !!ed.modoFranquicia, opciones, franquiciaSel, deuda, frTipoSel, split: ed.split || null };
  };

  const destinoDe = (mov) => (edits[mov.id]?.cuenta_destino) ?? mov.cuenta_destino ?? "";
  const esTransferMov = (mov) => {
    const meta = parseMeta(mov.referencia);
    const tipo = meta.tipo || (Number(mov.monto) > 0 ? "ingreso" : "");
    return tipo === "transferencia_interna" || !!edits[mov.id]?.modoTransfer;
  };
  const esInterco = (mov) => {
    const d = destinoDe(mov); if (!d) return false;
    const soc = cuentasAll.find(c => String(c.id) === String(d))?.sociedad;
    return !!soc && soc !== sociedad;
  };

  // Estado de "modo cuota de financiación" de una fila (auto por reconocimiento, o manual ⋯).
  // Auto solo para débitos que reconoce reconocerCuota (Nº de plan o CUIT+monto). Cede a los
  // otros modos (FC/cobro/transfer). Devuelve la financiación y cuota pre-seleccionadas.
  const cuotaState = (mov) => {
    const ed = edits[mov.id] || {};
    if (ed.noCuota || ed.modoFC || ed.modoCobro || ed.modoTransfer) return { es: false };
    const manual = !!ed.modoCuota;
    let auto = null;
    if (!manual) {
      if ((Number(mov.monto) || 0) >= 0) return { es: false };   // solo débitos para auto
      const meta = parseMeta(mov.referencia);
      auto = reconocerCuota(
        { monto: Number(mov.monto) || 0, descripcion: mov.concepto || "", ley1: mov.contraparte_nombre || "", ley2: meta.cuit || "", cuit: meta.cuit || "" },
        cuotasPendientes, monedaCuenta);
      if (!auto) return { es: false };
    }
    const planSel = ed.cuota_plan ?? auto?.plan_id ?? "";
    let cuotaSel = ed.cuota_row;
    if (cuotaSel == null) {
      if (auto && (!ed.cuota_plan || String(ed.cuota_plan) === String(auto.plan_id))) cuotaSel = auto.cuota_row_id;
      else { const cs = cuotasDePlan(planSel); cuotaSel = cs.length === 1 ? String(cs[0].row_id) : ""; }
    }
    return { es: true, manual, planSel, cuotaSel: cuotaSel || "" };
  };

  // ¿La fila está lista para aceptar? (imputación completa).
  const puedeAceptarMov = (mov) => {
    if (esTransferMov(mov)) return !!destinoDe(mov);
    const fr = frState(mov);
    const total = Math.abs(Number(mov.monto) || 0);
    if (fr.es) {
      if (fr.split) { const sum = fr.split.reduce((s, p) => s + (Number(p.monto) || 0), 0); return fr.split.every(p => p.franquicia_id) && Math.abs(sum - total) <= 0.01; }
      return !!fr.franquiciaSel && !!fr.frTipoSel;
    }
    if (edits[mov.id]?.modoFC) return !!fcIdDe(mov);
    if (edits[mov.id]?.modoCobro) {
      if (!cobIdDe(mov)) return false;
      const rets = edits[mov.id]?.rets || [];
      if (rets.some(r => (Number(r.monto) || 0) > 0 && !r.cuenta)) return false;   // falta cuenta en una retención
      return true;
    }
    const cs = cuotaState(mov);
    if (cs.es) return !!cs.cuotaSel;
    const cuentaSel = (edits[mov.id]?.cuenta_contable) ?? mov.cuenta_contable ?? "";
    const ccSel = (edits[mov.id]?.centro_costo) ?? mov.centro_costo ?? "";
    // cuenta y centro deben resolver a una opción real (si no, no se ven y se perderían en el P&L).
    return cuentaValida(cuentaSel) && ccValido(ccSel);
  };

  // Ejecuta la aceptación (asume fila lista). Lanza si el GAS falla.
  const doAceptar = async (mov) => {
    if (esTransferMov(mov)) {
      const dest = cuentasAll.find(c => String(c.id) === String(destinoDe(mov)));
      await aceptarMovimiento(mov, { tipo: "transferencia_interna", cuenta_destino: destinoDe(mov), interco: esInterco(mov),
        destino_sociedad: dest?.sociedad, destino_moneda: dest?.moneda });
      setPendientes(prev => prev.filter(m => m.id !== mov.id));
      return;
    }
    const fcId = (edits[mov.id]?.modoFC) ? fcIdDe(mov) : "";
    if (fcId) {
      const fc = facturasPendientes.find(f => String(f.id) === String(fcId));
      await imputarPagoFC(mov, {
        documento_id: fcId,
        cuenta_contable: fc?.cuentaId || fc?.cuenta || "",
        centro_costo: fc?.cc || "",
        proveedor_id: fc?.proveedorId || "",
        proveedor_nombre: fc?.proveedor || "",
      });
      // Reflejar el pago localmente para que baje el saldo de la FC sin refetch.
      setPagosCobros(prev => [...prev, { tipo: "PAGO", documento_id: fcId, monto: mov.monto }]);
      setPendientes(prev => prev.filter(m => m.id !== mov.id));
      return;
    }
    const cobId = (edits[mov.id]?.modoCobro) ? cobIdDe(mov) : "";
    if (cobId) {
      const ing = ventasPendientes.find(v => String(v.id) === String(cobId));
      const ed = edits[mov.id] || {};
      const deposito = Math.abs(Number(mov.monto) || 0);
      const rets = (ed.rets || []).filter(r => r.cuenta && Number(r.monto) > 0).map(r => ({ cuenta: r.cuenta, monto: Number(r.monto) }));
      await imputarCobroIngreso(mov, {
        documento_id: cobId,
        cuenta_contable: ing?.cuentaId || ing?.cuenta || "",
        centro_costo: ing?.cc || "",
        cliente_id: ing?.clienteId || "", cliente_nombre: ing?.cliente || "",
        retenciones: rets, retencion_centro: centroRetencion,
      });
      setPagosCobros(prev => [...prev,
        { tipo: "COBRO", documento_id: cobId, monto: deposito },
        ...rets.map(r => ({ tipo: "COBRO", documento_id: cobId, monto: r.monto }))]);
      setPendientes(prev => prev.filter(m => m.id !== mov.id));
      return;
    }
    const cs = cuotaState(mov);
    if (cs.es && cs.cuotaSel) {
      const cuota = cuotasPendientes.find(c => String(c.row_id) === String(cs.cuotaSel));
      if (cuota) {
        await imputarCuota(mov, { plan_id: cuota.plan_id, nro_cuota: cuota.nro_cuota, row_id: cuota.row_id });
        // Reflejar localmente: la cuota pasa a pagada (sale de cuotasPendientes / no se re-sugiere).
        setFinanciaciones(prev => prev.map(p => p.plan_id === cuota.plan_id
          ? { ...p, cuotas: p.cuotas.map(x => String(x.rowId) === String(cuota.row_id) ? { ...x, estado: "pagada" } : x) }
          : p));
        setPendientes(prev => prev.filter(m => m.id !== mov.id));
        return;
      }
    }
    const fr = frState(mov);
    if (fr.es) {
      const partes = fr.split
        ? fr.split.map(p => ({ franquicia_id: p.franquicia_id, franquicia_nombre: frNombre(p.franquicia_id), fr_tipo: p.fr_tipo || fr.frTipoSel, monto: p.monto }))
        : [{ franquicia_id: fr.franquiciaSel, franquicia_nombre: frNombre(fr.franquiciaSel), fr_tipo: fr.frTipoSel, monto: Math.abs(Number(mov.monto) || 0) }];
      await aceptarCobroFranquicia(mov, partes);
    } else {
      const ed = edits[mov.id] || {};
      const meta = parseMeta(mov.referencia);
      const tipo = meta.tipo || (Number(mov.monto) > 0 ? "ingreso" : "");
      await aceptarMovimiento(mov, {
        tipo, cuenta_contable: ed.cuenta_contable || mov.cuenta_contable || "",
        centro_costo: ed.centro_costo || mov.centro_costo || "", proveedor_id: meta.prov || "",
      });
    }
    setPendientes(prev => prev.filter(m => m.id !== mov.id));
  };

  const aceptar = async (mov) => {
    if (!puedeAceptarMov(mov)) { setMsg("Completá la imputación antes de aceptar."); return; }
    try { await doAceptar(mov); } catch (e) { setMsg("Error al aceptar: " + e.message); }
  };

  // Aceptar masivo: todas las filas listas de la cuenta activa (resiliente).
  const aceptarTodos = async () => {
    const listos = filtered.filter(puedeAceptarMov);
    if (!listos.length) { setMsg("No hay movimientos listos para aceptar."); return; }
    setUploading(true); let ok = 0, err = 0;
    for (const m of listos) { try { await doAceptar(m); ok++; } catch (e) { err++; } }
    setUploading(false);
    setMsg(`✓ ${ok} aceptados${err ? ` · ⚠ ${err} con error` : ""}.`);
  };

  // Ignorar: descarta la línea sin contabilizar (soft-mark IGN-). Sale de pendientes y no cuenta
  // en Tesorería/Cash Flow. motivo "haberes:<lote>" cuando matchea un pago de sueldos ya registrado.
  const ignorar = async (mov, motivo = "") => {
    try {
      await ignorarMovimiento(mov, motivo);
      setPendientes(prev => prev.filter(m => m.id !== mov.id));
      const ref = String(mov.referencia || "").replace(/;?ign=[^;]*/g, "") + `;ign=${motivo || "1"}`;
      setIgnorados(prev => [{ ...mov, documento_id: "IGN-" + mov.id, referencia: ref }, ...prev]);
    } catch (e) { setMsg("Error al ignorar: " + e.message); }
  };
  const restaurar = async (mov) => {
    try {
      await restaurarMovimiento(mov);
      setIgnorados(prev => prev.filter(m => m.id !== mov.id));
      await recargar();
    } catch (e) { setMsg("Error al restaurar: " + e.message); }
  };

  // Generar regla en vivo: pre-carga el modal de Maestros con los datos de la línea.
  // Si hay código de concepto matchea por código (estable); si no, por alias (contraparte/glosa).
  const prefillRegla = (mov) => {
    const meta = parseMeta(mov.referencia);
    const cta = cuentas.find(c => c.id === cuentaTab);
    const credito = (Number(mov.monto) || 0) > 0;
    return {
      prioridad: 20,
      match_tipo: meta.cod ? "codigo" : "alias",
      match_valor: meta.cod || mov.contraparte_nombre || mov.concepto || "",
      banco: cta?.banco || "", pais: "AR",
      tipo: credito ? "ingreso" : (meta.tipo && meta.tipo !== "sin_clasificar" ? meta.tipo : "pago_proveedor"),
      cuenta_contable: edits[mov.id]?.cuenta_contable || mov.cuenta_contable || "",
      centro_costo: edits[mov.id]?.centro_costo || mov.centro_costo || "",
      cuenta_destino: "", sociedad: "", proveedor_id: meta.prov || "",
      accion: "escala", nota: "",
    };
  };
  const handleSaveRegla = async (regla) => {
    try {
      const { id, ...rest } = regla;   // siempre alta (sin id) — appendBancoRegla genera el suyo
      await appendBancoRegla(rest);
      const r = await fetchBancoReglas();
      setReglas(r || []);
      setMsg("✓ Regla creada — aplica al próximo extracto que subas.");
    } catch (e) { setMsg("Error al crear la regla: " + e.message); }
  };

  const setEdit = (id, k, v) => setEdits(e => ({ ...e, [id]: { ...e[id], [k]: v } }));
  const setModo = (id, patch) => setEdits(e => ({ ...e, [id]: { ...e[id], ...patch } }));

  // ── Retenciones de un cobro (N líneas cuenta+monto; IIBB/Ganancias/IVA) ──
  const addRet = (id, monto = 0) => setEdits(e => ({ ...e, [id]: { ...e[id], rets: [...(e[id]?.rets || []), { cuenta: cuentaRetencionDefault, monto }] } }));
  const updRet = (id, idx, k, v) => setEdits(e => {
    const rets = (e[id]?.rets || []).map((r, i) => i === idx ? { ...r, [k]: k === "monto" ? (parseFloat(String(v).replace(",", ".")) || 0) : v } : r);
    return { ...e, [id]: { ...e[id], rets } };
  });
  const rmRet = (id, idx) => setEdits(e => ({ ...e, [id]: { ...e[id], rets: (e[id]?.rets || []).filter((_, i) => i !== idx) } }));

  // ── Split entre franquicias (⋯) ──
  const toggleSplit = (mov) => setEdits(e => {
    const ed = e[mov.id] || {};
    if (ed.split) { const { split, ...rest } = ed; return { ...e, [mov.id]: rest }; }
    const monto = Math.abs(Number(mov.monto) || 0);
    return { ...e, [mov.id]: { ...ed, split: [{ franquicia_id: "", fr_tipo: ed.fr_tipo || "PAGO", monto }] } };
  });
  const updSplit = (id, idx, k, v) => setEdits(e => {
    const split = (e[id]?.split || []).map((p, i) => i === idx ? { ...p, [k]: k === "monto" ? (parseFloat(String(v).replace(",", ".")) || 0) : v } : p);
    return { ...e, [id]: { ...e[id], split } };
  });
  const addSplit = (id) => setEdits(e => ({ ...e, [id]: { ...e[id], split: [...(e[id]?.split || []), { franquicia_id: "", fr_tipo: "PAGO", monto: 0 }] } }));
  const rmSplit = (id, idx) => setEdits(e => {
    const split = (e[id]?.split || []).filter((_, i) => i !== idx);
    return { ...e, [id]: { ...e[id], split: split.length ? split : null } };
  });

  // Grupo de "Propuesta" de una fila → para filtrar y aprobar por grupos.
  const grupoDe = (m) => {
    if (esTransferMov(m)) return esInterco(m) ? "Transferencia interco" : "Transferencia propia";
    if (frState(m).es) return "Cobro franquicia";
    if (cuotaState(m).es) return "Cuota de financiación";
    if (haberesMatch(m)) return "Pago de haberes";
    const meta = parseMeta(m.referencia);
    const tipo = meta.tipo || (Number(m.monto) > 0 ? "ingreso" : "");
    return TIPO_LABEL[tipo] || tipo || "Sin clasificar";
  };
  const pendCuenta = useMemo(
    () => pendientes.filter(m => !cuentaTab || String(m.cuenta_bancaria) === String(cuentaTab)),
    [pendientes, cuentaTab]);
  // Grupos presentes en la cuenta (con conteo) para el desplegable del header.
  const gruposDisp = useMemo(() => {
    const o = {}; pendCuenta.forEach(m => { const g = grupoDe(m); o[g] = (o[g] || 0) + 1; });
    return Object.entries(o).sort((a, b) => b[1] - a[1]);
  }, [pendCuenta, franquicias, pagosSueldos, edits]);
  const filtered = useMemo(
    () => filtroTipo ? pendCuenta.filter(m => grupoDe(m) === filtroTipo) : pendCuenta,
    [pendCuenta, filtroTipo, franquicias, pagosSueldos, edits]);
  const countByCuenta = useMemo(() => {
    const o = {}; pendientes.forEach(m => { o[m.cuenta_bancaria] = (o[m.cuenta_bancaria] || 0) + 1; }); return o;
  }, [pendientes]);
  // Memoizado: puedeAceptarMov es caro (frState/cuotaState/haberesMatch por fila) y esto corre por render.
  const listosCount = useMemo(() => filtered.filter(puedeAceptarMov).length, [filtered, edits, cuotasPendientes]);

  // Re-evaluar las reglas actuales sobre los pendientes de la cuenta (sin re-subir ni escribir):
  // reconstruye la línea desde el movimiento, la clasifica y pre-carga la propuesta en `edits`.
  // El usuario revisa y acepta (las reglas escala/auto caen como propuesta, no se contabilizan solas).
  const reEvaluar = () => {
    const cta = cuentas.find(c => c.id === cuentaTab);
    const ctx = { banco: cta?.banco, sociedad, pais: "", franquicias, sociedades, cuentas: cuentasAll, moneda: cta?.moneda || "ARS", cuotasPendientes };
    const lineaDeMov = (m) => {
      const meta = parseMeta(m.referencia);
      return { fecha: m.fecha, monto: Number(m.monto) || 0, descripcion: m.concepto || "",
        ley1: m.contraparte_nombre || "", ley2: meta.cuit || "", cuit: meta.cuit || "",
        codigoConcepto: meta.cod || "", grupoCodigo: meta.cod || "", saldo: meta.saldo || "" };
    };
    let n = 0;
    setEdits(prev => {
      const next = { ...prev };
      for (const m of pendCuenta) {
        const p = clasificarLinea(lineaDeMov(m), reglas, proveedores, ctx);
        if (!p || p.tipo === "sin_clasificar") continue;
        if (p.tipo === "transferencia_interna") {
          next[m.id] = { ...next[m.id], modoTransfer: true, modoFranquicia: false, modoFC: false, modoCobro: false, noFranquicia: true, cuenta_destino: p.cuenta_destino || next[m.id]?.cuenta_destino };
        } else if (p.cuenta_contable) {
          next[m.id] = { ...next[m.id], cuenta_contable: p.cuenta_contable, centro_costo: p.centro_costo || next[m.id]?.centro_costo };
        } else continue;
        n++;
      }
      return next;
    });
    setMsg(`Re-evaluado con reglas: ${n} con propuesta actualizada. Revisá y aceptá.`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", padding: "20px 28px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: T.text, margin: 0 }}>Conciliación</h2>
        <span style={{ fontSize: 12, color: T.muted }}>
          {pendientes.length} movimientos sin conciliar
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {listosCount > 0 && (
            <button onClick={aceptarTodos} disabled={uploading}
              style={{ background: "#16a34a", border: "none", borderRadius: 8, padding: "9px 16px",
                fontSize: 13, fontWeight: 700, color: "#fff", cursor: uploading ? "default" : "pointer",
                fontFamily: T.font, opacity: uploading ? .6 : 1 }}>
              Aceptar {listosCount} listo{listosCount !== 1 ? "s" : ""} ✓
            </button>
          )}
          {pendCuenta.length > 0 && (
            <button onClick={reEvaluar} disabled={uploading} title="Aplicar las reglas actuales a los pendientes de esta cuenta"
              style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 8, padding: "9px 14px",
                fontSize: 13, fontWeight: 700, color: T.text, cursor: "pointer", fontFamily: T.font }}>
              ↻ Re-evaluar reglas
            </button>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
            onChange={e => onFile(e.target.files[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={!cuentaTab || uploading}
            style={{ background: T.accent, border: "none", borderRadius: 8, padding: "9px 18px",
              fontSize: 13, fontWeight: 700, color: "#000", cursor: cuentaTab ? "pointer" : "default",
              fontFamily: T.font, opacity: uploading ? .6 : 1 }}>
            {uploading ? "Subiendo…" : "⬆ Subir extracto"}
          </button>
        </div>
      </div>

      {/* Pestañas por cuenta bancaria */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {cuentas.map(c => {
          const active = c.id === cuentaTab;
          const n = countByCuenta[c.id] || 0;
          return (
            <button key={c.id} onClick={() => { setCuentaTab(c.id); setFiltroTipo(""); }}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 8,
                border: `1px solid ${active ? T.accent : T.cardBorder}`, background: active ? "rgba(173,255,25,.1)" : T.card,
                color: active ? T.text : T.muted, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
              {c.nombre}
              {n > 0 && <span style={{ fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 999,
                background: "#dc2626", color: "#fff" }}>{n}</span>}
            </button>
          );
        })}
      </div>

      {msg && <div style={{ fontSize: 12, color: msg.startsWith("Error") ? "#dc2626" : "#16a34a", marginBottom: 10 }}>{msg}</div>}

      {erroresIngesta?.lineas?.length > 0 && (
        <div style={{ marginBottom: 12, background: "#fff7ed", border: "1px solid #fb923c", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#b45309" }}>⚠ {erroresIngesta.lineas.length} línea{erroresIngesta.lineas.length !== 1 ? "s" : ""} no se pudo cargar</span>
            <button onClick={reintentarErrores} disabled={uploading}
              style={{ background: "#fb923c", border: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, fontWeight: 700, color: "#fff", cursor: uploading ? "default" : "pointer", fontFamily: T.font, opacity: uploading ? .6 : 1 }}>
              {uploading ? "Reintentando…" : "Reintentar estas"}
            </button>
            <button onClick={() => setErroresIngesta(null)} style={{ background: "transparent", border: "none", color: T.muted, fontSize: 11, cursor: "pointer", fontFamily: T.font }}>descartar</button>
          </div>
          {erroresIngesta.lineas.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 10, fontSize: 11, color: T.text, padding: "2px 0" }}>
              <span style={{ color: T.muted, whiteSpace: "nowrap" }}>{l.fecha}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.descripcion || l.ley1 || ""}</span>
              <span style={{ fontWeight: 700, whiteSpace: "nowrap", color: (Number(l.monto) || 0) < 0 ? "#dc2626" : "#16a34a" }}>{fmt(Math.abs(Number(l.monto) || 0))}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 10 }}>
        {loading ? (
          <div style={{ padding: 50, textAlign: "center", color: T.muted }}>Cargando…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 50, textAlign: "center", color: T.muted, fontSize: 14 }}>
            No hay movimientos pendientes en esta cuenta. Subí un extracto para empezar.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.tableHead, position: "sticky", top: 0, zIndex: 1 }}>
                {[["Fecha","left"],["Descripción","left"],["Débitos","right"],["Créditos","right"],["Propuesta","left"],["Imputación","center"],["Acción","left"]].map(([h, al]) => (
                  <th key={h} style={{ padding: "9px 12px", textAlign: al, fontSize: 10, fontWeight: 700,
                    color: T.tableHeadText, letterSpacing: ".06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                    {h === "Propuesta" ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span>{h}</span>
                        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} title="Filtrar por tipo"
                          style={{ fontSize: 10, fontWeight: 700, padding: "2px 4px", borderRadius: 5, border: `1px solid ${filtroTipo ? T.accent : T.cardBorder}`,
                            background: filtroTipo ? "#ecfccb" : "#fff", color: "#111827", fontFamily: T.font, cursor: "pointer", textTransform: "none", letterSpacing: 0 }}>
                          <option value="">Todos ({pendCuenta.length})</option>
                          {gruposDisp.map(([g, n]) => <option key={g} value={g}>{g} ({n})</option>)}
                        </select>
                      </div>
                    ) : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, i) => {
                const meta = parseMeta(m.referencia);
                const tipo = meta.tipo || (Number(m.monto) > 0 ? "ingreso" : "");
                const esTransf = tipo === "transferencia_interna";
                const modoTransfer = esTransf || !!edits[m.id]?.modoTransfer;
                const destinoSel = (edits[m.id]?.cuenta_destino) ?? m.cuenta_destino ?? "";
                const interco = !!destinoSel && (cuentasAll.find(c => String(c.id) === String(destinoSel))?.sociedad ?? sociedad) !== sociedad;
                const fr = frState(m);
                const cuentaSel = (edits[m.id]?.cuenta_contable) ?? m.cuenta_contable ?? "";
                const ccSel = (edits[m.id]?.centro_costo) ?? m.centro_costo ?? "";
                // Verde solo si el centro RESUELVE a una opción real (un valor que no matchea —ej. casing—
                // muestra "— centro —" y no debe contar como completo, ni dejarse aceptar: se perdería en el P&L).
                const ccOk = ccValido(ccSel);
                const neg = Number(m.monto) < 0;
                const cuentaOk = cuentaValida(cuentaSel);
                const bg = i % 2 ? "#eef2f7" : "#ffffff";
                const total = Math.abs(Number(m.monto) || 0);
                const splitSum = fr.split ? fr.split.reduce((s, p) => s + (Number(p.monto) || 0), 0) : 0;
                const splitOk = fr.split ? (fr.split.every(p => p.franquicia_id) && Math.abs(splitSum - total) <= 0.01) : false;
                const puedeAceptar = puedeAceptarMov(m);
                const modoFC = !fr.es && !modoTransfer && !!edits[m.id]?.modoFC;
                // Caja 1 = proveedor (default: el reconocido si tiene pendientes). Caja 2 = sus facturas.
                const fcProvSel = fcProvDe(m);
                const fcDelProv = modoFC && fcProvSel ? fcsDeProv(fcProvSel) : [];
                const fcSel = modoFC ? fcIdDe(m) : "";
                const fcSelObj = fcSel ? facturasPendientes.find(f => String(f.id) === String(fcSel)) : null;
                // Modo cobro de venta (créditos): cliente → su factura de venta + retención opcional.
                const modoCobro = !fr.es && !modoTransfer && !modoFC && !!edits[m.id]?.modoCobro;
                const cobCliSel = cobClienteDe(m);
                const venDelCli = modoCobro && cobCliSel ? ventasDeCliente(cobCliSel) : [];
                const cobSel = modoCobro ? cobIdDe(m) : "";
                const cobSelObj = cobSel ? ventasPendientes.find(v => String(v.id) === String(cobSel)) : null;
                const cobDiff = cobSelObj ? (cobSelObj.saldo - total) : 0;   // saldo factura − depósito
                const cobRets = edits[m.id]?.rets || [];                      // retenciones [{cuenta, monto}]
                const cobRetSum = cobRets.reduce((s, r) => s + (Number(r.monto) || 0), 0);
                const cuotaSt = cuotaState(m);
                const modoCuota = cuotaSt.es;
                const cuotaSelObj = modoCuota && cuotaSt.cuotaSel ? cuotasPendientes.find(c => String(c.row_id) === String(cuotaSt.cuotaSel)) : null;
                const hMatch = (!fr.es && !modoTransfer && !modoFC && !modoCobro && !modoCuota) ? haberesMatch(m) : null;   // débito que coincide con un lote de haberes
                return (
                  <Fragment key={m.id}>
                  <tr style={{ borderBottom: fr.split ? "none" : "1px solid #cbd5e1", background: bg }}>
                    <td style={{ padding: "8px 12px", color: T.muted, whiteSpace: "nowrap" }}>{m.fecha}</td>
                    <td style={{ padding: "8px 12px", maxWidth: 220 }}>
                      <div style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.concepto}</div>
                      {m.contraparte_nombre && <div style={{ fontSize: 10, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.contraparte_nombre}>{m.contraparte_nombre}</div>}
                    </td>
                    <td style={{ padding: "8px 12px", fontWeight: 700, textAlign: "right", whiteSpace: "nowrap", color: "#16a34a" }}>
                      {Number(m.monto) > 0 ? fmt(total) : ""}
                    </td>
                    <td style={{ padding: "8px 12px", fontWeight: 700, textAlign: "right", whiteSpace: "nowrap", color: "#dc2626" }}>
                      {neg ? fmt(total) : ""}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {fr.es ? (
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: T.text }}>Cobro franquicia</span>
                          {fr.franquiciaSel
                            ? <div style={{ fontSize: 10, color: T.muted }}>{frNombre(fr.franquiciaSel)} · {deudaLabel(fr.deuda)}</div>
                            : <div style={{ fontSize: 10, color: "#b45309" }}>{fr.manual ? "elegí franquicia" : "varias con ese CUIT"}</div>}
                        </div>
                      ) : modoFC ? (
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#0ea5e9" }}>Pago de factura</span>
                          {fcSelObj
                            ? <div style={{ fontSize: 10, color: total + 0.01 < fcSelObj.saldo ? "#b45309" : T.muted }}>
                                {fcSelObj.proveedor} · {total + 0.01 < fcSelObj.saldo ? `parcial: $${fmt(total)} de $${fmt(fcSelObj.saldo)} (queda $${fmt(fcSelObj.saldo - total)})` : `saldo $${fmt(fcSelObj.saldo)}`}
                              </div>
                            : <div style={{ fontSize: 10, color: "#b45309" }}>{!provConPendientes.length ? "sin facturas pendientes" : !fcProvSel ? "elegí proveedor" : "elegí factura"}</div>}
                        </div>
                      ) : modoCobro ? (
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#0ea5e9" }}>Cobro de venta</span>
                          {cobSelObj
                            ? <div style={{ fontSize: 10, color: cobDiff > 0.01 ? "#b45309" : T.muted }}>
                                {cobSelObj.cliente} · {cobDiff > 0.01 ? `dep $${fmt(total)}${cobRetSum > 0 ? ` + ret $${fmt(cobRetSum)}` : ""} de $${fmt(cobSelObj.saldo)}` : `saldo $${fmt(cobSelObj.saldo)}`}
                              </div>
                            : <div style={{ fontSize: 10, color: "#b45309" }}>{!clientesConPendientes.length ? "sin facturas de venta pendientes" : !cobCliSel ? "elegí cliente" : "elegí factura"}</div>}
                        </div>
                      ) : modoCuota ? (
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed" }}>Cuota de financiación</span>
                          {cuotaSelObj
                            ? <div style={{ fontSize: 10, color: T.muted }}>{cuotaSelObj.acreedor_nombre || cuotaSelObj.nro_plan || "plan"} · cuota {cuotaSelObj.nro_cuota}{Math.abs(total - (cuotaSelObj.total_tardio || 0)) < Math.abs(total - cuotaSelObj.total) ? " (tardío)" : ""}</div>
                            : <div style={{ fontSize: 10, color: "#b45309" }}>{planesVigentes.length ? "elegí financiación/cuota" : "sin cuotas pendientes"}</div>}
                        </div>
                      ) : hMatch ? (
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed" }}>Pago de haberes</span>
                          <div style={{ fontSize: 10, color: T.muted }}>{hMatch.fecha} · {hMatch.count} pers · ${fmt(hMatch.total)} · ya en Sueldos</div>
                        </div>
                      ) : (
                        <>
                          <span style={{ fontSize: 11, fontWeight: 700, color: T.text }}>{TIPO_LABEL[tipo] || tipo || "—"}</span>
                          {meta.regla && <span style={{ fontSize: 9, color: T.dim, marginLeft: 5 }}>({meta.regla})</span>}
                        </>
                      )}
                    </td>
                    <td style={{ padding: "8px 4px 8px 12px", minWidth: 220, textAlign: "center" }}>
                      {modoTransfer ? (
                        <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
                          {interco && <span style={{ fontSize: 9, fontWeight: 800, color: "#7c3aed", background: "#ede9fe", border: "1px solid #c4b5fd", borderRadius: 6, padding: "2px 6px", whiteSpace: "nowrap" }}>INTERCO</span>}
                          <span style={{ fontSize: 11, color: T.muted }}>→</span>
                          <select value={destinoSel} onChange={e => setEdit(m.id, "cuenta_destino", e.target.value)} style={fld(!!destinoSel)}>
                            <option value="">— cuenta destino —</option>
                            {cuentasAll.filter(c => String(c.id) !== String(m.cuenta_bancaria)).map(c => (
                              <option key={c.id} value={c.id}>{c.nombre}{c.sociedad !== sociedad ? ` · ${c.sociedad}` : ""}</option>
                            ))}
                          </select>
                        </div>
                      ) : fr.es ? (
                        fr.split ? (
                          <span style={{ fontSize: 11, color: T.muted }}>Dividido en {fr.split.length} franquicia{fr.split.length !== 1 ? "s" : ""} ↓</span>
                        ) : (
                          <div key="franq" style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                            <select value={fr.frTipoSel} onChange={e => setEdit(m.id, "fr_tipo", e.target.value)} style={fld(true)}>
                              {neg ? <option value="PAGO_ENVIADO">Transf. enviada</option> : <>
                                <option value="PAGO">Pago de CC</option>
                                <option value="PAGO_PAUTA">Pago a cuenta</option>
                              </>}
                            </select>
                            <select value={fr.franquiciaSel} onChange={e => setEdit(m.id, "franquicia_id", e.target.value)} style={fld(!!fr.franquiciaSel)}>
                              <option value="">— franquicia —</option>
                              {fr.opciones.map(f => <option key={f.id} value={String(f.id)}>{f.name}{frMonedaSuf(f)}</option>)}
                            </select>
                          </div>
                        )
                      ) : modoFC ? (
                        <div key="fc" style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                          <select value={fcProvSel} disabled={!provConPendientes.length} onChange={e => setModo(m.id, { fc_prov: e.target.value, fc_id: "" })} style={fld(!!fcProvSel, 160)}>
                            <option value="">{provConPendientes.length ? "— proveedor —" : "sin facturas pendientes"}</option>
                            {provConPendientes.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                          </select>
                          <select value={fcSel} onChange={e => setEdit(m.id, "fc_id", e.target.value)} disabled={!fcProvSel} style={fld(!!fcSel, 200)}>
                            <option value="">{fcProvSel ? "— factura —" : "elegí proveedor"}</option>
                            {fcDelProv.map(f => <option key={f.id} value={String(f.id)}>{fcLabel(f)}</option>)}
                          </select>
                        </div>
                      ) : modoCobro ? (
                        <div key="cob" style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                          <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                            <select value={cobCliSel} disabled={!clientesConPendientes.length} onChange={e => setModo(m.id, { cob_cli: e.target.value, cob_id: "" })} style={fld(!!cobCliSel, 160)}>
                              <option value="">{clientesConPendientes.length ? "— cliente —" : "sin facturas de venta"}</option>
                              {clientesConPendientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                            </select>
                            <select value={cobSel} onChange={e => setEdit(m.id, "cob_id", e.target.value)} disabled={!cobCliSel} style={fld(!!cobSel, 200)}>
                              <option value="">{cobCliSel ? "— factura —" : "elegí cliente"}</option>
                              {venDelCli.map(v => <option key={v.id} value={String(v.id)}>{fcLabel(v)}</option>)}
                            </select>
                          </div>
                          {cobSelObj && cobDiff > 0.01 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", fontSize: 11, color: T.muted }}>
                              {cobRets.map((r, idx) => (
                                <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center" }}>
                                  <select value={r.cuenta} onChange={e => updRet(m.id, idx, "cuenta", e.target.value)} style={fld(!!r.cuenta, 150)}>
                                    <option value="">— retención —</option>
                                    {cuentasTodas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                  </select>
                                  <input type="number" value={r.monto} onChange={e => updRet(m.id, idx, "monto", e.target.value)}
                                    style={{ width: 90, textAlign: "right", ...sel }} />
                                  <button onClick={() => rmRet(m.id, idx)} title="Quitar" style={{ border: "none", background: "transparent", color: T.muted, cursor: "pointer", fontSize: 12 }}>✕</button>
                                </div>
                              ))}
                              <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
                                {cobRets.length > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: Math.abs(cobRetSum + total - cobSelObj.saldo) <= 0.01 ? "#16a34a" : "#b45309" }}>ret ${fmt(cobRetSum)} + dep ${fmt(total)} {Math.abs(cobRetSum + total - cobSelObj.saldo) <= 0.01 ? "= total ✓" : `de ${fmt(cobSelObj.saldo)}`}</span>}
                                <button onClick={() => addRet(m.id, Math.max(0, cobDiff - cobRetSum))}
                                  style={{ fontSize: 11, border: "none", background: "transparent", color: "#0ea5e9", cursor: "pointer", fontWeight: 700 }}>+ retención</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : modoCuota ? (
                        <div key="cuota" style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                          <select value={cuotaSt.planSel} onChange={e => setModo(m.id, { cuota_plan: e.target.value, cuota_row: "" })} style={fld(!!cuotaSt.planSel, 170)}>
                            <option value="">{planesVigentes.length ? "— financiación —" : "sin cuotas pendientes"}</option>
                            {planesVigentes.map(p => <option key={p.plan_id} value={p.plan_id}>{p.label}</option>)}
                          </select>
                          <select value={cuotaSt.cuotaSel} onChange={e => setEdit(m.id, "cuota_row", e.target.value)} disabled={!cuotaSt.planSel} style={fld(!!cuotaSt.cuotaSel, 190)}>
                            <option value="">{cuotaSt.planSel ? "— cuota —" : "elegí financiación"}</option>
                            {cuotasDePlan(cuotaSt.planSel).map(c => <option key={c.row_id} value={String(c.row_id)}>Cuota {c.nro_cuota} · {fmt(c.total)}{c.vto ? ` · ${c.vto}` : ""}</option>)}
                          </select>
                        </div>
                      ) : (
                        <div key="normal" style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center" }}>
                          <select value={cuentaOk ? cuentaSel : ""} onChange={e => setEdit(m.id, "cuenta_contable", e.target.value)}
                            style={fld(cuentaOk)}>
                            <option value="">— cuenta —</option>
                            {cuentasTodas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                          </select>
                          <select value={ccOk ? ccSel : ""} onChange={e => setEdit(m.id, "centro_costo", e.target.value)} style={fld(ccOk)}>
                            <option value="">— centro —</option>
                            {centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                          </select>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "8px 12px 8px 4px", whiteSpace: "nowrap", position: "relative" }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button onClick={() => aceptar(m)} disabled={!puedeAceptar}
                          title={puedeAceptar ? "" : "Completá la imputación"}
                          style={{ background: puedeAceptar ? "#16a34a" : "#cbd5e1", border: "none", borderRadius: 6, padding: "5px 12px",
                            fontSize: 11, fontWeight: 700, color: "#fff", cursor: puedeAceptar ? "pointer" : "default", fontFamily: T.font }}>
                          Aceptar ✓
                        </button>
                        {!esTransf && (
                          <button onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id); }} title="Más acciones"
                            style={{ background: menuFor === m.id ? T.accent : T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 6, padding: "4px 8px",
                              fontSize: 12, fontWeight: 800, color: T.text, cursor: "pointer", lineHeight: 1 }}>⋯</button>
                        )}
                      </div>
                      {menuFor === m.id && (
                        <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", right: 6, top: "calc(100% - 2px)", zIndex: 30,
                          background: "#fff", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,.14)", minWidth: 220, overflow: "hidden" }}>
                          {!fr.es && !modoTransfer && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoFranquicia: true, noFranquicia: false, modoTransfer: false }); setMenuFor(null); }}>↪ Convertir a {Number(m.monto) < 0 ? "transferencia a franquicia" : "cobro de franquicia"}</button>
                          )}
                          {!fr.es && !modoTransfer && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoTransfer: true, modoFranquicia: false, noFranquicia: true }); setMenuFor(null); }}>⇄ Convertir a transferencia entre cuentas</button>
                          )}
                          {neg && !fr.es && !modoTransfer && !modoFC && !modoCuota && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoFC: true, modoFranquicia: false, modoTransfer: false, noFranquicia: true }); setMenuFor(null); }}>🧾 Imputar a una factura…</button>
                          )}
                          {modoFC && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoFC: false, fc_id: undefined, noFranquicia: false }); setMenuFor(null); }}>↩ Volver a normal (no es pago de factura)</button>
                          )}
                          {neg && !fr.es && !modoTransfer && !modoFC && !modoCobro && !modoCuota && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoCuota: true, noCuota: false, modoFranquicia: false, modoTransfer: false, modoFC: false, modoCobro: false, noFranquicia: true }); setMenuFor(null); }}>💳 Imputar a cuota de financiación…</button>
                          )}
                          {modoCuota && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoCuota: false, noCuota: true, cuota_plan: undefined, cuota_row: undefined, noFranquicia: false }); setMenuFor(null); }}>↩ No es cuota de financiación</button>
                          )}
                          {!neg && !fr.es && !modoTransfer && !modoCobro && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoCobro: true, modoFranquicia: false, modoTransfer: false, noFranquicia: true }); setMenuFor(null); }}>🧾 Imputar a factura de venta (cobro)…</button>
                          )}
                          {modoCobro && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoCobro: false, cob_id: undefined, cob_cli: undefined, rets: [], noFranquicia: false }); setMenuFor(null); }}>↩ Volver a normal (no es cobro de venta)</button>
                          )}
                          {fr.es && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoFranquicia: false, noFranquicia: true, modoTransfer: false, split: null }); setMenuFor(null); }}>↩ No es franquicia (volver a normal)</button>
                          )}
                          {!fr.es && modoTransfer && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoTransfer: false, noFranquicia: false, cuenta_destino: undefined }); setMenuFor(null); }}>↩ Volver a normal (no es transferencia)</button>
                          )}
                          {fr.es && fr.opciones.length > 1 && !fr.split && (
                            <button style={MENU_ITEM} onClick={() => { toggleSplit(m); setMenuFor(null); }}>Dividir entre franquicias</button>
                          )}
                          {fr.es && fr.split && (
                            <button style={MENU_ITEM} onClick={() => { toggleSplit(m); setMenuFor(null); }}>Quitar división</button>
                          )}
                          {hMatch && (
                            <button style={{ ...MENU_ITEM, color: "#7c3aed", fontWeight: 700 }} onClick={() => { ignorar(m, `haberes:${hMatch.lote}`); setMenuFor(null); }}>✓ Ya está en Sueldos — descartar</button>
                          )}
                          <button style={MENU_ITEM} onClick={() => { setReglaModal({ prefill: prefillRegla(m) }); setMenuFor(null); }}>⚙ Crear regla de banco…</button>
                          <button style={{ ...MENU_ITEM, color: "#b45309" }} onClick={() => { if (window.confirm(`Ignorar esta línea (no se contabiliza)?\n${m.concepto || ""} · $${fmt(total)}`)) ignorar(m); setMenuFor(null); }}>🚫 Ignorar (no contabilizar)</button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {fr.es && fr.split && (
                    <>
                      {fr.split.map((p, idx) => (
                        <tr key={`${m.id}-sp-${idx}`} style={{ background: bg, borderLeft: `3px solid ${T.accent}` }}>
                          <td /><td />
                          <td style={{ padding: "4px 12px", textAlign: "right" }}>
                            <input type="number" value={p.monto} onChange={e => updSplit(m.id, idx, "monto", e.target.value)}
                              style={{ width: 110, textAlign: "right", ...sel }} />
                          </td>
                          <td />
                          <td />
                          <td style={{ padding: "4px 12px" }}>
                            <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                              <select value={p.fr_tipo} onChange={e => updSplit(m.id, idx, "fr_tipo", e.target.value)} style={fld(true)}>
                                <option value="PAGO">Pago de CC</option>
                                <option value="PAGO_PAUTA">Pago a cuenta</option>
                              </select>
                              <select value={p.franquicia_id} onChange={e => updSplit(m.id, idx, "franquicia_id", e.target.value)} style={fld(!!p.franquicia_id)}>
                                <option value="">— franquicia —</option>
                                {franquiciasManual.map(f => <option key={f.id} value={String(f.id)}>{f.name}{frMonedaSuf(f)}</option>)}
                              </select>
                            </div>
                          </td>
                          <td style={{ padding: "4px 12px" }}>
                            <button onClick={() => rmSplit(m.id, idx)} title="Quitar"
                              style={{ border: "none", background: "transparent", color: T.muted, cursor: "pointer", fontSize: 12 }}>✕</button>
                          </td>
                        </tr>
                      ))}
                      <tr style={{ background: bg, borderBottom: `1px solid ${T.cardBorder}`, borderLeft: `3px solid ${T.accent}` }}>
                        <td /><td />
                        <td style={{ padding: "4px 12px", textAlign: "right", fontSize: 10, fontWeight: 700, color: splitOk ? "#16a34a" : "#dc2626" }}>
                          {fmt(splitSum)} / {fmt(total)} {splitOk ? "✓" : "⚠"}
                        </td>
                        <td />
                        <td />
                        <td style={{ padding: "4px 12px", textAlign: "right" }}>
                          <button onClick={() => addSplit(m.id)}
                            style={{ fontSize: 11, border: "none", background: "transparent", color: T.accentDark || "#16a34a", cursor: "pointer", fontWeight: 700 }}>+ franquicia</button>
                        </td>
                        <td />
                      </tr>
                    </>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Ignorados de la cuenta activa: descartados sin contabilizar, restaurables. */}
      {(() => {
        const ign = ignorados.filter(m => String(m.cuenta_bancaria) === String(cuentaTab));
        if (!ign.length) return null;
        return (
          <div style={{ marginTop: 10 }}>
            <button onClick={() => setVerIgnorados(v => !v)}
              style={{ background: "transparent", border: "none", color: T.muted, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font, padding: 0 }}>
              {verIgnorados ? "▾" : "▸"} Ignorados ({ign.length})
            </button>
            {verIgnorados && (
              <div style={{ marginTop: 6, background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 8, overflow: "hidden" }}>
                {ign.map(m => {
                  const ig = parseMeta(m.referencia).ign || "";
                  return (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderBottom: "1px solid #f1f5f9", fontSize: 12 }}>
                      <span style={{ color: T.muted, whiteSpace: "nowrap" }}>{m.fecha}</span>
                      <span style={{ flex: 1, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.concepto}</span>
                      {ig.startsWith("haberes:") && <span style={{ fontSize: 9, fontWeight: 800, color: "#7c3aed", background: "#ede9fe", borderRadius: 6, padding: "2px 6px" }}>HABERES</span>}
                      <span style={{ fontWeight: 700, color: Number(m.monto) < 0 ? "#dc2626" : "#16a34a", whiteSpace: "nowrap" }}>{fmt(Math.abs(Number(m.monto) || 0))}</span>
                      <button onClick={() => restaurar(m)}
                        style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: T.text, cursor: "pointer", fontFamily: T.font }}>
                        Restaurar
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {reglaModal && (
        <BancoReglaModal
          prefill={reglaModal.prefill}
          cuentas={planCuentas} centros={centros} cuentasBancarias={cuentasAll} proveedores={proveedores}
          onClose={() => setReglaModal(null)} onSave={handleSaveRegla} />
      )}
    </div>
  );
}
