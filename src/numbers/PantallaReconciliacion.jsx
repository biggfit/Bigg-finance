import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { T } from "./theme";
import {
  fetchCuentasBancarias, fetchMovimientosPendientes, ingestarExtracto, aceptarMovimiento,
  aceptarCobroFranquicia, fetchBancoReglas, fetchProveedores, fetchCuentas, fetchCentrosCosto, fetchSociedades,
  ignorarMovimiento, restaurarMovimiento, fetchMovimientosIgnorados, fetchPagosSueldos,
  fetchEgresos, fetchPagosCobros, calcSaldoPendiente, imputarPagoFC,
  appendEgreso, appendProveedor, appendCuenta,
  appendIngreso, fetchClientes, appendCliente,
  appendBancoRegla, fetchIngresos, imputarCobroIngreso,
  fetchFinanciaciones, imputarCuota, pagarTarjeta, esCuentaCredito, fetchMovTesoreria,
  fetchIntercoData, pendientesInterco, reconocerVentaInterco, reconocerInterusoGestion, normCuit,
  pendientesIntercoRecibir, declararIntercoRecibida, declararIntercoEnviada, intercoMatchCandidato,
  esCuentaMercadoPago,
} from "../lib/numbersApi";
import { BancoReglaModal } from "./PantallaMaestros";
import MundoTarjeta from "./reconciliacion/MundoTarjeta";
import { fetchAll } from "../lib/sheetsApi";
import { franquiciasPendientesInterco } from "../lib/franquiciasAdapter";
import { groupCentrosCosto, makeCrearMaestro } from "./formUtils";
import NuevoEgresoModal from "./NuevoEgresoModal";
import NuevoIngresoModal from "./NuevoIngresoModal";
import { computeSaldoReal } from "../lib/helpers";
import { parseGalicia } from "./parsers/galicia";
import { parseInterAudi } from "./parsers/interaudi";
import { parseCaixa } from "./parsers/caixa";
import { parseMercadoPago } from "./parsers/mercadopago";
import { clasificarLineas, clasificarLinea, reconocerCuota } from "./reconciliacion/ruleEngine";

const TIPO_LABEL = {
  impuesto: "Impuesto", comision: "Comisiones", interes: "Interés", servicio: "Servicio",
  transferencia_interna: "Transf. interna", ingreso: "Ingreso", financiacion: "Financiación",
  pago_proveedor: "Pago proveedor", cobro_franquicia: "Cobro franquicia",
  cuota_financiacion: "Cuota de plan", sin_clasificar: "Sin clasificar",
  venta: "Ventas", compra: "Compras",   // Mercado Pago (archivo depurado)
};
// Agrupación por GLOSA del banco (el tipo de transacción, no el reconocimiento). Es el
// bucket del dropdown. `fc`: si por defecto se imputa a factura (proveedor) o no (AFIP =
// impuesto, Tarjeta = pago de tarjeta a mano). La imputación real sigue por proveedor
// reconocido (no se pierde la preselección). Glosas de Galicia — extensible por banco.
// Se testea contra glosa + contraparte (la tarjeta a veces viene con glosa genérica
// "Pago De Servicios" y se reconoce por la contraparte VISA/AMEX). La tarjeta va PRIMERO
// para ganarle a "Servicios".
const GLOSA_GRUPO = [
  { re: /foreign\s+currency\s+(purchase|sale)|cambio\s+de\s+moneda/i, grupo: "Cambio de moneda", fc: false },
  { re: /transf\.?\s*afip/i,                                       grupo: "AFIP",            fc: false },
  { re: /pago\s*tarjeta|\b(visa|amex|american\s*express|mastercard)\b/i, grupo: "Pago de tarjeta", fc: false },
  { re: /deb\.?\s*autom.*serv|pago\s*de\s*servicios/i,             grupo: "Servicios",       fc: true  },
  { re: /trf\s*inmed\s*proveed/i,                                   grupo: "Proveedores",     fc: true  },
];
const grupoGlosa = (mov) => {
  const t = `${mov?.concepto || ""} ${mov?.contraparte_nombre || ""}`;
  return GLOSA_GRUPO.find(x => x.re.test(t)) || null;
};
// Tipos "débiles": no clasificados por una regla explícita → elegibles para glosa/cobranza.
const TIPOS_DEBILES = ["pago_proveedor", "servicio", "sin_clasificar", ""];
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
const fmt = n => (Number(n) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Dedup por id: el master de centros/cuentas tiene ids repetidos (ej. cc-2026-chueca) que
// rompen la reconciliación de React (claves duplicadas) y filtran opciones de un select a otro.
const dedupById = arr => { const seen = new Set(); return (arr || []).filter(x => x && !seen.has(x.id) && seen.add(x.id)); };
const MENU_ITEM = { display: "block", width: "100%", textAlign: "left", padding: "9px 12px", fontSize: 11, border: "none", borderBottom: "1px solid #f1f5f9", background: "#fff", color: "#111827", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const parseMeta = ref => Object.fromEntries(String(ref || "").split(";").map(kv => kv.split("=")).filter(a => a.length === 2));
// Estilos compartidos de los modales interco (Reconocer / Declarar recibida).
const MODAL_INP = { width: "100%", background: "#eceff3", border: `1px solid ${T.cardBorder}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, color: T.text, fontFamily: T.font, outline: "none", boxSizing: "border-box" };
const MODAL_LBL = { fontSize: 12, color: T.muted, fontWeight: 600, display: "block", marginBottom: 5 };
// El carril Banco concilia extractos → solo cuentas tipo "Banco" (cajas/inversión/tarjeta no tienen extracto).
const esCuentaBanco = c => String(c?.tipo || "").toLowerCase() === "banco";
const sel = { fontSize: 11, padding: "4px 6px", border: "1px solid #94a3b8", borderRadius: 6, fontFamily: T.font, color: "#111827", background: "#f8fafc" };
// Campo imputado: VERDE si está completo (no tocar) / ÁMBAR si falta elegir. Ancho fijo → columnas alineadas.
const fld = (lleno, w = 150) => ({ fontSize: 11, padding: "4px 6px", borderRadius: 6, fontFamily: T.font, color: "#111827", width: w, boxSizing: "border-box",
  background: lleno ? "#dcfce7" : "#fff7ed", border: `1px solid ${lleno ? "#4ade80" : "#fb923c"}` });

// Modal para RECONOCER una venta interco: registra mi compra (con mis cuenta+centro) → FC por pagar.
// Cuentas de interuso para el asiento de gestión (sede propia). Los NOMBRES matchean las líneas
// del P&L Sede (int_bigg "Interusos" / int_corp "Coorporativos"). El default sale de la nota.
const GESTION_CUENTAS = ["Interusos", "Coorporativos"];
const cuentaGestionPorNota = (nota) => /gympass|corpo/i.test(String(nota || "")) ? "Coorporativos" : "Interusos";

function ReconocerIntercoModal({ pend, sociedad, cuentas = [], centros = [], onClose, onDone }) {
  const esGestion = pend?.tratamiento === "gestion";
  const [cuenta, setCuenta] = useState(esGestion ? cuentaGestionPorNota(pend?.nota) : "");
  const [centro, setCentro] = useState(esGestion ? (pend?.sedeCentro || "") : "");
  const [total, setTotal]   = useState(String(pend?.total ?? ""));
  const [fecha, setFecha]   = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy]     = useState(false);
  // NC de interuso (a mi favor) → la reconozco como INGRESO a una cuenta de venta/ingreso (CxC). El resto
  // (FACTURA que debo) → EGRESO a una cuenta de gasto (CxP). Se filtra la lista de cuentas según el caso.
  const esIngreso = pend?.subtipo === "INGRESO";
  const esVentaTipo = c => /^(venta|ventas|ingreso|ingresos)$/i.test(String(c.tipo || ""));
  const cuentasGasto = (cuentas || []).filter(c => esIngreso ? esVentaTipo(c) : !esVentaTipo(c))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const centrosOrd = (centros || []).slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const canSave = cuenta && Number(total) > 0 && !busy;

  const guardar = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      if (esGestion) {
        // Asiento de gestión (sede propia): pata de la sede en nb_movimientos, SIN caja, SIN CxP.
        await reconocerInterusoGestion({ ...pend, total: Number(total), fecha }, { cuenta, centro });
      } else {
        await reconocerVentaInterco({
          sociedad, ventaIdComp: pend.id_comp, vendedorId: pend.vendedor, vendedorNombre: pend.vendedorNombre,
          cuenta_contable: cuenta, centro_costo: centro, total: Number(total), moneda: pend.moneda, fecha, nroComp: pend.nroComp,
          subtipo: pend.subtipo || "EGRESO",
        });
      }
      await onDone();
    } catch (e) { setBusy(false); alert("No se pudo reconocer: " + (e?.message || e)); }
  };

  const inp = MODAL_INP, lbl = MODAL_LBL;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#f1f5f9", borderRadius: 16, width: 480, maxWidth: "97vw", overflow: "hidden", boxShadow: T.shadowMd }}>
        <div style={{ background: T.accentDark, padding: "16px 22px" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{esGestion ? "Asiento de gestión" : (esIngreso ? "Reconocer crédito" : "Reconocer compra")}</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,.6)", marginTop: 2 }}>
            {pend?.vendedorNombre} te {esIngreso ? "acreditó" : "vendió"} {pend?.moneda} {Math.round(pend?.total || 0).toLocaleString("es-AR")}{pend?.concepto ? ` · ${pend.concepto}` : ""}{pend?.nroComp ? ` · ${pend.nroComp}` : ""}
          </div>
        </div>
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={lbl}>{esGestion ? "Concepto de interuso *" : "Cuenta contable *"}</label>
            <select value={cuenta} onChange={e => setCuenta(e.target.value)} style={inp}>
              <option value="">— Elegí la cuenta —</option>
              {esGestion
                ? GESTION_CUENTAS.map(n => <option key={n} value={n}>{n === "Coorporativos" ? "Coorporativos (Gympass)" : "Interusos (Red BIGG)"}</option>)
                : cuentasGasto.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
            </select></div>
          <div><label style={lbl}>Centro de costo</label>
            <select value={centro} onChange={e => setCentro(e.target.value)} style={inp}>
              <option value="">— Sin centro —</option>
              {centrosOrd.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select></div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}><label style={lbl}>Importe *</label>
              <input value={total} onChange={e => setTotal(e.target.value)} style={inp} /></div>
            <div style={{ flex: 1 }}><label style={lbl}>Fecha</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} /></div>
          </div>
          <div style={{ fontSize: 11.5, color: T.muted }}>{esGestion
            ? <>Reconocimiento de <b>resultado</b> en el P&L de la sede (línea de interusos), <b>sin caja</b> y <b>sin cuenta por cobrar/pagar</b>. La contrapartida ya pega en el P&L de {pend?.vendedorNombre}.</>
            : esIngreso
            ? <>Se registra como <b>ingreso</b> en tu sociedad → queda como <b>cuenta por cobrar</b> a {pend?.vendedorNombre}.</>
            : <>Se registra como compra en tu sociedad → queda como <b>factura por pagar</b> a {pend?.vendedorNombre}.</>}</div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.cardBorder}`, borderRadius: 999, padding: "8px 18px", fontSize: 13, fontWeight: 700, color: T.muted, cursor: "pointer", fontFamily: T.font }}>Cancelar</button>
            <button onClick={guardar} disabled={!canSave} style={{ background: T.accent, border: "none", borderRadius: 999, padding: "8px 20px", fontSize: 13, fontWeight: 800, color: "#000", cursor: canSave ? "pointer" : "default", opacity: canSave ? 1 : .5, fontFamily: T.font }}>{busy ? "Guardando…" : (esIngreso ? "Reconocer y registrar ingreso" : "Reconocer y registrar compra")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Modal para DECLARAR una interco recibida (lado receptor): la plata que entró a mi banco/caja → fondeo,
// sin P&L, sin posición nueva. Costo de clearing opcional → Perdidas Financieras (P&L). Marca la pata parkeada.
function DeclararRecibidaModal({ pend, sociedad, cuentas = [], planCuentas = [], onClose, onDone }) {
  const envio = pend?.dir === "envie";   // envié = EGRESO (cierro mi salida); recibí = INGRESO (fondeo)
  const ctasContables = (planCuentas || []).slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const [costoCuenta, setCostoCuenta] = useState("Perdidas Financieras");   // cuenta contable del costo (editable)
  // El que parkeó dejó su caja destino como hint (cuenta_mia desde mi lado) → precargar la cuenta.
  const ctaHint = (cuentas || []).find(c => String(c.id) === String(pend?.cuenta_mia));
  // Precargar el monto SOLO si la moneda de la caja coincide con la parkeada. Cross-moneda (recibís EUR/COP
  // vs los USD que mandó el núcleo) → vacío, lo completás con lo que realmente entró/salió de tu caja.
  const mismaMoneda = ctaHint && String(ctaHint.moneda) === String(pend?.moneda);
  const [cuenta, setCuenta] = useState(ctaHint ? String(ctaHint.id) : "");
  const [monto, setMonto]   = useState(mismaMoneda && pend?.monto ? String(Math.round(pend.monto)) : "");
  const [fecha, setFecha]   = useState(new Date().toISOString().slice(0, 10));
  const [costo, setCosto]   = useState("");
  const [busy, setBusy]     = useState(false);
  const ctas = (cuentas || []).slice().sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const monedaCta = ctas.find(c => String(c.id) === String(cuenta))?.moneda || pend?.moneda || "USD";
  const canSave = cuenta && Number(monto) > 0 && !busy;

  const guardar = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      if (envio) {
        await declararIntercoEnviada({
          sociedad, cuenta_bancaria: cuenta, fecha,
          destino_sociedad: pend.origen_sociedad, destino_nombre: pend.origen_nombre,
          monto: Number(monto), moneda: monedaCta, costo: Number(costo) || 0, costo_cuenta: costoCuenta, parked_leg_id: pend.id,
        });
      } else {
        await declararIntercoRecibida({
          sociedad, cuenta_bancaria: cuenta, fecha,
          origen_sociedad: pend.origen_sociedad, origen_nombre: pend.origen_nombre,
          monto: Number(monto), moneda: monedaCta, costo: Number(costo) || 0, costo_cuenta: costoCuenta, parked_leg_id: pend.id,
        });
      }
      await onDone();
    } catch (e) { setBusy(false); alert("No se pudo declarar: " + (e?.message || e)); }
  };

  const inp = MODAL_INP, lbl = MODAL_LBL;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#f1f5f9", borderRadius: 16, width: 480, maxWidth: "97vw", overflow: "hidden", boxShadow: T.shadowMd }}>
        <div style={{ background: T.accentDark, padding: "16px 22px" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>Cerrar operación</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,.6)", marginTop: 2 }}>
            {envio ? "Le enviaste a " : "Te envió "}{pend?.origen_nombre} · parkeó {pend?.moneda} {Math.round(pend?.monto || 0).toLocaleString("es-AR")}{pend?.fecha ? ` · ${pend.fecha}` : ""}
          </div>
        </div>
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1.4 }}><label style={lbl}>{envio ? "Cuenta / caja de donde salió *" : "Cuenta / caja donde entró *"}</label>
              <select value={cuenta} onChange={e => setCuenta(e.target.value)} style={inp}>
                <option value="">— Elegí la cuenta —</option>
                {ctas.map(c => <option key={c.id} value={c.id}>{c.nombre} · {c.moneda}</option>)}
              </select></div>
            <div style={{ flex: 1 }}><label style={lbl}>Fecha</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} /></div>
          </div>
          <div><label style={lbl}>{envio ? `Monto que salió de tu caja (${monedaCta}) *` : `Monto bruto que ingresó (post-TC) (${monedaCta}) *`}</label>
            <input value={monto} onChange={e => setMonto(e.target.value)} style={inp} placeholder={envio ? "lo que salió" : "el bruto, antes del costo"} /></div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}><label style={lbl}>Costo de transferencia / clearing</label>
              <input value={costo} onChange={e => setCosto(e.target.value)} style={inp} placeholder="si la financiera te lo informa" /></div>
            <div style={{ flex: 1.2 }}><label style={lbl}>Cuenta contable del costo</label>
              <select value={costoCuenta} onChange={e => setCostoCuenta(e.target.value)} style={inp}>
                {!ctasContables.some(c => c.nombre === costoCuenta) && <option value={costoCuenta}>{costoCuenta}</option>}
                {ctasContables.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
              </select></div>
          </div>
          {Number(costo) > 0 && (
            <div style={{ fontSize: 11.5, color: T.text, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 6, padding: "6px 10px" }}>
              Neto en tu caja: <b>{monedaCta} {Math.round((Number(monto) || 0) - (Number(costo) || 0)).toLocaleString("es-AR")}</b>
              &nbsp;(ingreso {Math.round(Number(monto) || 0).toLocaleString("es-AR")} − costo {Math.round(Number(costo) || 0).toLocaleString("es-AR")}) · a <b>{costoCuenta}</b>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.cardBorder}`, borderRadius: 999, padding: "8px 18px", fontSize: 13, fontWeight: 700, color: T.muted, cursor: "pointer", fontFamily: T.font }}>Cancelar</button>
            <button onClick={guardar} disabled={!canSave} style={{ background: T.accent, border: "none", borderRadius: 999, padding: "8px 20px", fontSize: 13, fontWeight: 800, color: "#000", cursor: canSave ? "pointer" : "default", opacity: canSave ? 1 : .5, fontFamily: T.font }}>{busy ? "Guardando…" : "Cerrar operación"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PantallaReconciliacion({ sociedad, onPendientes, mundo = "banco" }) {
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
  const [movsCuenta, setMovsCuenta] = useState([]);    // movimientos ya contabilizados (para detectar transferencias duplicadas)
  const [erroresIngesta, setErroresIngesta] = useState(null); // { lineas, cuenta_bancaria, moneda } que fallaron al subir
  const [progreso,   setProgreso]   = useState(null); // { done, total } mientras sube el extracto
  const [filtroTipo, setFiltroTipo] = useState("");   // filtro por grupo de Propuesta (para aprobar por grupos)
  const [verIgnorados,setVerIgnorados]= useState(false);
  const [reglaModal, setReglaModal] = useState(null);  // {prefill} para crear regla desde una línea
  const [loading,    setLoading]    = useState(true);
  const [uploading,  setUploading]  = useState(false);
  const [msg,        setMsg]        = useState("");
  const [edits,      setEdits]      = useState({}); // movId → {cuenta_contable, centro_costo}
  const [menuFor,    setMenuFor]    = useState(null); // movId con el menú ⋯ abierto
  const [cargarFacturaFor, setCargarFacturaFor] = useState(null); // mov para el que abrimos "Cargar factura" de compra (débito)
  const [cargarIngresoFor, setCargarIngresoFor] = useState(null); // mov para el que abrimos "Cargar factura de venta" (crédito)
  const [clientes,   setClientes]   = useState([]); // maestro de clientes (para el modal de venta)
  const fileRef = useRef(null);

  // Crear proveedor/cuenta/cliente desde los modales de Nueva Compra / Venta (mismo patrón que Egresos/Ingresos).
  const crearProveedor = useMemo(() => makeCrearMaestro(appendProveedor, fetchProveedores, setProveedores), []);
  const crearCuenta     = useMemo(() => makeCrearMaestro(appendCuenta,     fetchCuentas,     l => setPlanCuentas(dedupById(l))), []);
  const crearCliente    = useMemo(() => makeCrearMaestro(appendCliente,    fetchClientes,    setClientes), []);

  // Cerrar el menú ⋯ al clickear afuera
  useEffect(() => {
    if (menuFor === null) return;
    const h = () => setMenuFor(null);
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [menuFor]);


  const [intercoData, setIntercoData] = useState({ movs: [], comps: [], centros: [], clientes: [], sociedades: [] });  // fuentes interco (read-only)
  const [reconocerFor, setReconocerFor] = useState(null);  // pendiente interco que se está reconociendo
  // fetchIntercoData trae TODAS las sociedades (payload pesado): lo necesitan tanto Interco (mapa/pendientes)
  // como Banco (al conciliar una línea interco hay que detectar la pata parkeada de la contraparte,
  // "matchear o parkear"). No depende de `mundo` → se carga una vez por sociedad, no en cada toggle.
  useEffect(() => {
    fetchIntercoData().then(d => d && setIntercoData(d)).catch(console.error);
  }, [sociedad]);
  // Pendientes de documentos de FRANQUICIA emitidos a MI sociedad (ej. Segui = una franquicia cuyo CUIT es
  // el de la sociedad activa). Los docs viven en el backend de Franquicias (frComps) → los surteamos al mismo
  // inbox de reconocer. FACTURA (le debo: pauta/sponsoreo) → EGRESO/CxP; NC (a mi favor: interuso) → INGRESO/CxC.
  const franqPend = useMemo(
    () => franquiciasPendientesInterco(frComps, franquicias, (sociedades.find(s => String(s.id) === String(sociedad)) || {}).cuit, sociedad),
    [frComps, franquicias, sociedades, sociedad]);
  const pendInterco = useMemo(() => pendientesInterco({ ...intercoData, franqPend }, { sociedad }), [intercoData, franqPend, sociedad]);
  const pendRecibir = useMemo(() => pendientesIntercoRecibir(intercoData, { sociedad }), [intercoData, sociedad]);
  // Avisa al sidebar los conteos de pendientes (badge en vivo): Banco (extracto sin conciliar) + Interco
  // (ventas a reconocer + CC a liquidar ida/vuelta).
  useEffect(() => { onPendientes?.({ banco: pendientes.length, interco: pendRecibir.length + pendInterco.length }); },
    [pendientes, pendRecibir, pendInterco, onPendientes]);
  const [declararFor, setDeclararFor] = useState(null);  // pata parkeada hacia mí que estoy declarando (recibí)

  const recargar = async () => {
    setLoading(true);
    try {
      const [pend, movs] = await Promise.all([
        fetchMovimientosPendientes(sociedad),
        fetchMovTesoreria(sociedad).catch(() => []),
      ]);
      setPendientes(Array.isArray(pend) ? pend : []);
      setMovsCuenta(Array.isArray(movs) ? movs : []);
    } catch (e) { setMsg("Error al cargar pendientes: " + e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    setMsg("");
    fetchCuentasBancarias().then(all => {
      setCuentasAll(all || []);
      const soc = (all || []).filter(c => c.sociedad === sociedad);
      setCuentas(soc);
      // Pestaña inicial = primera cuenta real (las tarjeta se concilian en el mundo Tarjeta).
      setCuentaTab((soc.find(esCuentaBanco) || soc[0])?.id || "");
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
    fetchClientes().then(c => setClientes(c || [])).catch(console.error);
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
  // ¿La cuenta bancaria de la fila es de Mercado Pago? En MP el crédito típico es una venta
  // directa (ingreso rápido), no un cobro B2B → arranca pidiendo cuenta+centro, no factura.
  // Set memoizado (se consulta por fila en cada render) en vez de un .find sobre todas las cuentas.
  const mpCuentaIds = useMemo(
    () => new Set(cuentasAll.filter(esCuentaMercadoPago).map(c => String(c.id))),
    [cuentasAll]);
  const esCuentaMP = (cuentaId) => mpCuentaIds.has(String(cuentaId));

  // Resolución nombre→id para el importador de Mercado Pago (el archivo depurado trae nombres
  // legibles; el módulo matchea cuenta por id-nombre y centro por id).
  const cuentaIdPorNombre = useMemo(() => {
    const m = new Map();
    planCuentas.forEach(c => m.set(String(c.nombre || "").trim().toLowerCase(), String(c.id)));
    return name => m.get(String(name || "").trim().toLowerCase()) || "";
  }, [planCuentas]);
  // Centro: normaliza (saca prefijo "NN - ", tildes y no-alfanuméricos) → "Recoleta"/"01 - Recoleta"
  // /"Belgrano" caen todos al mismo id. Match exacto normalizado (no substring) para no colisionar.
  const centroIdPorNombre = useMemo(() => {
    const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^\s*\d+\s*-\s*/, "").replace(/[^a-z0-9]/g, "");
    const m = new Map();
    centros.forEach(c => m.set(norm(c.nombre), String(c.id)));
    return name => m.get(norm(name)) || "";
  }, [centros]);

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

  // ── "Posible duplicado": una línea del extracto que coincide (fecha|monto) con un movimiento YA
  // contabilizado en la MISMA cuenta. Cubre transferencias/interco (la pata ya existe al conciliar el
  // otro banco), pagos de tarjeta ya cargados a mano, y cualquier otro movimiento previo. Se excluyen:
  //   • las líneas de extracto todavía pendientes (origen="extracto" sin documento_id) → no se marcan
  //     entre sí ni a sí mismas; solo avisamos contra algo YA cargado en la caja.
  //   • las ignoradas (documento_id "IGN-…").
  const cajaKeys = useMemo(() => {
    const s = new Set();
    for (const m of movsCuenta) {
      if (String(m.cuenta_bancaria) !== String(cuentaTab)) continue;
      const doc = String(m.documento_id || "");
      const pendiente = m.origen === "extracto" && !doc;
      if (pendiente || doc.startsWith("IGN-")) continue;
      s.add(`${m.fecha}|${Math.round(Math.abs(Number(m.monto) || 0))}`);
    }
    return s;
  }, [movsCuenta, cuentaTab]);
  const dupTransfer = (mov) => cajaKeys.has(`${mov.fecha}|${Math.round(Math.abs(Number(mov.monto) || 0))}`);

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
  // Opciones del selector de proveedor en modo FC: TODOS los activos (para que el
  // reconocido aparezca y se preseleccione aunque todavía no tenga factura cargada).
  const provOpciones = useMemo(
    () => (proveedores || []).filter(p => p.activo !== false && String(p.activo) !== "false")
      .map(p => ({ id: String(p.id), nombre: p.nombre || p.id }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [proveedores]);
  const fcsDeProv = (provId) => facturasPendientes
    .filter(f => String(f.proveedorId) === String(provId))
    .sort((a, b) => String(a.vto || "").localeCompare(String(b.vto || "")));
  const fcLabel = (f) => `${f.nroComp || f.id} · saldo ${fmt(f.saldo)}${f.vto ? ` · vto ${f.vto}` : ""}`;
  // Proveedor efectivo de una línea en modo FC: el editado, o el reconocido si tiene pendientes.
  const fcProvDe = (mov) => {
    const ed = edits[mov.id] || {}, meta = parseMeta(mov.referencia);
    return ed.fc_prov ?? (meta.prov ? String(meta.prov) : "");   // preselecciona SIEMPRE el proveedor reconocido
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
  // Todos los clientes (de cualquier factura de venta) → para elegir en el cobro aunque no
  // tenga pendientes; se pre-selecciona el reconocido. (Espeja el selector de proveedor.)
  const clienteOpciones = useMemo(() => {
    const m = new Map();
    ingresos.forEach(v => { const id = String(v.clienteId || ""); if (id && !m.has(id)) m.set(id, v.cliente || v.clienteId); });
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [ingresos]);
  const cobClienteDe = (mov) => {
    const ed = edits[mov.id] || {};
    if (ed.cob_cli != null) return ed.cob_cli;
    // Cliente de la regla (cli=…, ej. Gympass por glosa) o reconocido por contraparte.
    return parseMeta(mov.referencia).cli || reconocerClienteCobro(mov);
  };
  // Anillo de cada sociedad + el de la sociedad activa (para separar transferencia intra-anillo de interco).
  const anilloDe = useMemo(() => {
    const m = {}; (sociedades || []).forEach(s => { m[String(s.id)] = String(s.anillo || ""); }); return m;
  }, [sociedades]);
  const anilloActivo = anilloDe[String(sociedad)] || "";
  const mismoAnillo = (socId) => !!anilloActivo && (anilloDe[String(socId)] || "") === anilloActivo;
  // Sociedades destino para "parkear" una interco (una sola pata): las de OTRO anillo (desde el banco que
  // estoy contabilizando serían interco). Intra-anillo va por "transferencia entre cuentas" (dos patas).
  const socInterco = useMemo(() => {
    return (sociedades || [])
      .filter(s => String(s.id) !== String(sociedad))
      .filter(s => !anilloActivo || String(s.anillo || "") !== anilloActivo)
      .map(s => ({ id: String(s.id), nombre: s.nombre || s.id }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [sociedades, sociedad, anilloActivo]);
  const socNombre = (id) => socInterco.find(s => String(s.id) === String(id))?.nombre
    || (sociedades.find(s => String(s.id) === String(id))?.nombre) || id;
  // Modo interco (parkear una pata): toggle manual del ⋯, o AUTO por regla de banco (tipo=interco_park).
  const modoIntercoDe = (mov) => {
    const ed = edits[mov.id] || {};
    if (ed.modoInterco !== undefined) return ed.modoInterco;
    return parseMeta(mov.referencia).tipo === "interco_park";
  };
  // "Matchear o parkear": ¿ALGUNA contraparte ya parkeó una pata hacia mí (dirección opuesta)? Busca sin
  // saber la contraparte de antemano → así la propuesta auto sugiere cerrar en vez de parkear a ciegas.
  const intercoInboundSoc = (mov) => {
    for (const s of socInterco) {
      if (intercoMatchCandidato(intercoData, { sociedad, contraparte: s.id, monto: mov.monto })) return s.id;
    }
    return "";
  };
  // Sociedad destino: la elegida a mano; si no, la contraparte que ya parkeó hacia mí (cerrar circuito);
  // si tampoco, la derivada de la regla (cuenta única del otro lado).
  const intercoSocDe = (mov) => {
    const ed = edits[mov.id] || {};
    if (ed.interco_soc) return ed.interco_soc;
    const inbound = intercoInboundSoc(mov);
    if (inbound) return inbound;
    const acc = cuentasAll.find(c => String(c.id) === String(parseMeta(mov.referencia).idest));
    return acc?.sociedad || "";
  };
  // Cuenta destino elegida (hint): la del usuario, la de la regla (idest), o la única de la sociedad.
  // "matchear o parkear": ¿la contraparte elegida ya parkeó su pata (dirección opuesta)? → cerramos contra ella.
  const intercoMatchDe = (mov) => intercoMatchCandidato(intercoData, { sociedad, contraparte: intercoSocDe(mov), monto: mov.monto });
  const intercoAccDe = (mov) => {
    const ed = edits[mov.id] || {};
    if (ed.interco_acc != null) return ed.interco_acc;
    const idest = parseMeta(mov.referencia).idest;
    if (idest) return idest;
    const accs = cuentasAll.filter(c => String(c.sociedad) === String(intercoSocDe(mov)));
    return accs.length === 1 ? String(accs[0].id) : "";
  };
  // Modo "interco recibida" (lado receptor, solo créditos): manual desde el ⋯. La plata entró y la
  // reconozco como fondeo de otra sociedad → caja real, sin P&L, sin posición nueva. Costo financiero opcional.
  const modoRecvDe = (mov) => !!edits[mov.id]?.modoRecv;
  const recvSocDe = (mov) => edits[mov.id]?.recv_soc ?? "";
  // Opciones del <select> de centro de costo, agrupadas: Operaciones por país → HQ → Otros.
  const centroOptionsEls = useMemo(() => {
    const { hq, ops, rest } = groupCentrosCosto(centros);   // clasificación hq/ops/rest compartida
    const porPais = {};
    for (const c of ops) { const p = c.pais || "Sin país"; (porPais[p] ||= []).push(c); }   // solo el sub-grupo por país es propio de esta pantalla
    const opt = c => <option key={c.id} value={c.id}>{c.nombre}</option>;
    return (
      <>
        {Object.keys(porPais).sort().map(p => (
          <optgroup key={p} label={`Operaciones · ${p}`}>{porPais[p].map(opt)}</optgroup>
        ))}
        {hq.length > 0 && <optgroup label="HQ">{hq.map(opt)}</optgroup>}
        {rest.length > 0 && <optgroup label="Otros">{rest.map(opt)}</optgroup>}
      </>
    );
  }, [centros]);
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
  // Total de cuotas por plan (nº de cuota más alto) → para mostrar "cuota X/N".
  const totalCuotasPorPlan = useMemo(() => {
    const m = new Map();
    for (const p of financiaciones) m.set(p.plan_id, (p.cuotas || []).reduce((mx, c) => Math.max(mx, Number(c.nro_cuota) || 0), 0));
    return m;
  }, [financiaciones]);
  const cuotaLabel = (c) => `cuota ${c.nro_cuota}/${totalCuotasPorPlan.get(c.plan_id) || "?"}`;

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
      const cta = cuentas.find(c => c.id === cuentaTab);
      const banco = String(cta?.banco || "");
      const moneda = cta?.moneda || "ARS";
      let lineas;
      if (/mercado\s*pago/i.test(banco)) {
        // Mercado Pago: el archivo depurado ya viene clasificado (tipo/cuenta/centro por columna).
        // No hay reglas de banco: la propuesta sale del propio archivo, resolviendo nombre→id
        // contra los maestros vivos. Transferencias → modo transferencia interna (manual).
        const data = await parseMercadoPago(file);
        lineas = data.lineas.map((l) => {
          const esTransfer = l.tipo === "transferencia";
          // Clave de dedup estable y única por fila. Incluye tipo+cuenta+centro+operación+monto:
          // en MP una MISMA operación (mismo nº) trae la venta Y su comisión/impuesto → sin el tipo
          // se pisarían entre sí. Sin índice → idempotente: re-subir el mismo archivo solo completa
          // lo que falta (no duplica).
          const dedupKey = `${l.tipo}|${l.cuentaNombre}|${l.centroNombre}|${l.nro_operacion || ""}|${l.monto}`;
          return { ...l, saldo: dedupKey, propuesta: {
            tipo:            esTransfer ? "transferencia_interna" : l.tipo,
            cuenta_contable: esTransfer ? "" : cuentaIdPorNombre(l.cuentaNombre),
            centro_costo:    esTransfer ? "" : centroIdPorNombre(l.centroNombre),
          } };
        });
      } else {
        // Extracto crudo: InterAudi = CSV propio; Caixa = .xls/.xlsx propio; el resto = Galicia. Clasifica por reglas.
        const data = /interaudi/i.test(banco) ? await parseInterAudi(file)
          : /caixa/i.test(banco) ? await parseCaixa(file)
          : await parseGalicia(file);
        const ctx = { banco: cta?.banco, sociedad, pais: "", franquicias, sociedades, cuentas: cuentasAll, moneda, cuotasPendientes };
        lineas = clasificarLineas(data.lineas, reglas, proveedores, ctx);
      }
      setProgreso({ done: 0, total: lineas.length });
      const { creados, matcheados = 0, dups, errores, fallidas } = await ingestarExtracto({ sociedad, cuenta_bancaria: cuentaTab, moneda, lineas,
        onProgress: (done, total) => setProgreso({ done, total }) });
      setMsg(`✓ ${creados} nuevos${matcheados ? ` · ${matcheados} conciliados con lo ya cargado` : ""}${dups ? ` · ${dups} ya estaban` : ""}${errores ? ` · ⚠ ${errores} con error` : ""}.`);
      setErroresIngesta(errores ? { lineas: fallidas, cuenta_bancaria: cuentaTab, moneda } : null);
      await recargar();
    } catch (e) { setMsg("Error: " + e.message); }
    finally { setUploading(false); setProgreso(null); if (fileRef.current) fileRef.current.value = ""; }
  };

  // Reintenta SOLO las líneas que fallaron en la última carga (no hace falta re-subir el archivo).
  const reintentarErrores = async () => {
    if (!erroresIngesta?.lineas?.length) return;
    setUploading(true); setMsg("");
    try {
      setProgreso({ done: 0, total: erroresIngesta.lineas.length });
      const { creados, dups, errores, fallidas } = await ingestarExtracto({ sociedad, ...erroresIngesta,
        onProgress: (done, total) => setProgreso({ done, total }) });
      setMsg(`✓ ${creados} reintentadas${dups ? ` · ${dups} ya estaban` : ""}${errores ? ` · ⚠ ${errores} siguen con error` : ""}.`);
      setErroresIngesta(errores ? { ...erroresIngesta, lineas: fallidas } : null);
      await recargar();
    } catch (e) { setMsg("Error: " + e.message); }
    finally { setUploading(false); setProgreso(null); }
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
    const es = !ed.noFranquicia && !modoIntercoDe(mov) && !modoRecvDe(mov) && (meta.tipo === "cobro_franquicia" || porCuit.length > 0 || !!ed.modoFranquicia);
    if (!es) return { es: false };
    // Dropdown SIEMPRE con TODAS las franquicias activas (para corregir un match errado); se
    // PRESELECCIONA la reconocida (CUIT con match único, o la empacada). Si el CUIT mapea a varias,
    // sin default → el usuario elige.
    const bakedIds = (meta.frops || "").split("|").filter(Boolean);
    const recomendada = (porCuit.length === 1 ? String(porCuit[0].id) : "")
                      || (bakedIds.length === 1 ? bakedIds[0] : "")
                      || (meta.fr ? String(meta.fr) : "");
    const opciones = franquiciasManual;                      // todas las activas (alfabético, con sufijo de moneda)
    const franquiciaSel = ed.franquicia_id ?? recomendada;
    const deuda = franquiciaSel ? deudaFr(franquiciaSel) : 0;
    const frTipoSel = ed.fr_tipo ?? sugerirFrTipo(mov.monto, deuda);
    return { es: true, manual: !!ed.modoFranquicia, opciones, franquiciaSel, deuda, frTipoSel, split: ed.split || null };
  };

  const destinoDe = (mov) => (edits[mov.id]?.cuenta_destino) ?? mov.cuenta_destino ?? "";
  // Normaliza nombres para comparar (mayúsculas, sin acentos/Ñ ni no-alfanuméricos).
  const normS = (s) => String(s || "").toUpperCase().normalize("NFD").replace(/[^A-Z0-9]/g, "");
  // Transferencia entre cuentas propias: la contraparte del banco es el nombre de la sociedad
  // activa (ej. Ñako → "NAKO NAKO"). Coelsa rotula todo igual; lo que distingue es la contraparte.
  const esTransferPropia = (mov) => {
    const soc = normS(sociedad);
    return soc.length >= 3 && normS(mov.contraparte_nombre).includes(soc);
  };
  // Reconoce el cliente de un cobro (crédito) por nombre de contraparte vs clientes con facturas
  // de venta pendientes. Sin match → "" (no carga nada; queda en Cobranza para revisar/asociar).
  const reconocerClienteCobro = (mov) => {
    if ((Number(mov.monto) || 0) <= 0) return "";
    const cp = normS(mov.contraparte_nombre);
    if (cp.length < 4) return "";
    const hit = clientesConPendientes.find(c => { const n = normS(c.nombre); return n.length >= 4 && (cp.includes(n) || n.includes(cp)); });
    return hit ? hit.id : "";
  };
  const esTransferMov = (mov) => {
    if (modoIntercoDe(mov) || modoRecvDe(mov)) return false;   // interco (parkear/recibida) tiene prioridad
    if (edits[mov.id]?.noTransfer) return false;   // override: "volver a normal" apaga el modo transferencia bakeado
    const meta = parseMeta(mov.referencia);
    const tipo = meta.tipo || (Number(mov.monto) > 0 ? "ingreso" : "");
    return tipo === "transferencia_interna" || !!edits[mov.id]?.modoTransfer || esTransferPropia(mov);
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
    if (ed.noCuota || ed.modoFC || ed.modoCobro || ed.modoTransfer || ed.modoFranquicia || modoIntercoDe(mov)) return { es: false };
    const manual = !!ed.modoCuota;
    let auto = null;
    if (!manual) {
      if ((Number(mov.monto) || 0) >= 0) return { es: false };   // solo débitos para auto
      const meta = parseMeta(mov.referencia);
      auto = reconocerCuota(
        { monto: Number(mov.monto) || 0, descripcion: mov.concepto || "", ley1: mov.contraparte_nombre || "", ley2: meta.cuit || "", cuit: meta.cuit || "" },
        cuotasPendientes, monedaCuenta);
      // Fallback: el plan que el motor identificó al INGERIR (por la leyenda con el Nº de
      // plan, que no se almacena) queda empacado en `referencia` → lo usamos aunque el
      // re-match en vivo falle (ej. cuotas de monto decreciente que no pegan exacto).
      if (!auto && meta.plan) auto = { plan_id: meta.plan, cuota_row_id: meta.pcuota || "" };
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

  // Pago a proveedor / servicio → por defecto se IMPUTA a una factura (el débito es el
  // pago de una FC ya devengada, no un gasto nuevo → evita doble conteo). El gasto directo
  // queda como opción explícita en el ⋯. Fuente única del modo-FC efectivo (render +
  // puedeAceptar + doAceptar leen de acá → nunca se desincronizan).
  const esProvServ = (mov) => ["pago_proveedor", "servicio"].includes(parseMeta(mov.referencia).tipo);
  // ¿La fila ya está en otro modo (transfer/franquicia/cuota) o lo detectamos? → FC y cobro ceden.
  const otroModoActivo = (mov) => {
    const ed = edits[mov.id] || {};
    return modoIntercoDe(mov) || modoRecvDe(mov) || ed.modoTransfer || ed.modoFranquicia || ed.modoCuota || esTransferMov(mov) || frState(mov).es || cuotaState(mov).es;
  };
  const modoFCde = (mov) => {
    const ed = edits[mov.id] || {};
    if (otroModoActivo(mov) || ed.modoCobro) return false;
    if ((Number(mov.monto) || 0) > 0) return false;   // "pago de factura" es pagar a un proveedor = débito; un crédito es cobranza
    const gg = grupoGlosa(mov);   // AFIP/Tarjeta → no FC; Servicios/Proveedores → FC
    return ed.modoFC ?? (gg ? gg.fc : esProvServ(mov));   // default; el ⋯ lo apaga (gasto directo)
  };
  // Modo cobro de venta efectivo: crédito con cliente reconocido → auto (fuente única render +
  // puedeAceptar + doAceptar). Cede a transfer/franquicia/cuota. Sin cliente → no auto (queda Cobranza).
  const modoCobroDe = (mov) => {
    const ed = edits[mov.id] || {};
    if (otroModoActivo(mov) || ed.modoFC) return false;
    if ((Number(mov.monto) || 0) <= 0) return false;   // cobro = crédito
    if (grupoGlosa(mov)) return false;   // FX/AFIP/Tarjeta por glosa → no es cobro de venta
    if (ed.modoCobro !== undefined) return ed.modoCobro;   // toggle explícito del ⋯ (forzar cobro / volver a normal)
    if (parseMeta(mov.referencia).tipo === "cobro_cliente") return true;   // regla de cliente → cobro contra su factura
    // Mercado Pago: el crédito es venta directa → ingreso rápido (elegí cuenta+centro), no cobro.
    if (esCuentaMP(mov.cuenta_bancaria)) return false;
    // Otros bancos: si YA viene con propuesta (cuenta+centro) es ingreso rápido; sin propuesta,
    // un crédito arranca como cobro-contra-factura (cobranza B2B).
    const cuentaProp = mov.cuenta_contable ?? "";
    const ccProp     = mov.centro_costo   ?? "";
    return !(cuentaValida(cuentaProp) && ccValido(ccProp));
  };

  // ¿La fila está lista para aceptar? (imputación completa).
  const puedeAceptarMov = (mov) => {
    if (modoIntercoDe(mov)) return !!intercoSocDe(mov);
    if (modoRecvDe(mov)) return !!recvSocDe(mov);
    if (esTransferMov(mov)) return !!destinoDe(mov);
    const fr = frState(mov);
    const total = Math.abs(Number(mov.monto) || 0);
    if (fr.es) {
      if (fr.split) { const sum = fr.split.reduce((s, p) => s + (Number(p.monto) || 0), 0); return fr.split.every(p => p.franquicia_id) && Math.abs(sum - total) <= 0.01; }
      return !!fr.franquiciaSel && !!fr.frTipoSel;
    }
    if (modoFCde(mov)) return !!fcIdDe(mov);
    if (modoCobroDe(mov)) {
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
    if (modoIntercoDe(mov)) {
      const soc = intercoSocDe(mov);
      const cand = intercoMatchDe(mov);   // si la contraparte ya parkeó → cierro contra ella; si no → parkeo
      await aceptarMovimiento(mov, { tipo: "interco_park", destino_sociedad: soc, destino_nombre: socNombre(soc),
        cuenta_destino: intercoAccDe(mov), match_leg_id: cand?.id || "" });
      setIntercoData(prev => ({ ...prev, movs: (prev.movs || []).map(x => x.id === cand?.id ? { ...x, referencia: "recibida=" + mov.id } : x) }));
      setPendientes(prev => prev.filter(m => m.id !== mov.id));
      return;
    }
    if (modoRecvDe(mov)) {
      const soc = recvSocDe(mov);
      const ed = edits[mov.id] || {};
      await aceptarMovimiento(mov, { tipo: "interco_recv", origen_sociedad: soc, origen_nombre: socNombre(soc),
        costo: Number(ed.recv_costo) || 0, costo_centro: ed.recv_costo_centro || "" });
      setPendientes(prev => prev.filter(m => m.id !== mov.id));
      return;
    }
    if (esTransferMov(mov)) {
      const dest = cuentasAll.find(c => String(c.id) === String(destinoDe(mov)));
      await aceptarMovimiento(mov, { tipo: "transferencia_interna", cuenta_destino: destinoDe(mov), interco: esInterco(mov),
        destino_sociedad: dest?.sociedad, destino_moneda: dest?.moneda });
      setPendientes(prev => prev.filter(m => m.id !== mov.id));
      return;
    }
    const fcId = modoFCde(mov) ? fcIdDe(mov) : "";
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
    const cobId = modoCobroDe(mov) ? cobIdDe(mov) : "";
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
      // Resolver el NOMBRE del proveedor de la regla (ej. impuesto→AFIP, comisión Galicia→Banco Galicia)
      // para que quede como contraparte (y no la glosa del banco).
      const provId  = ed.proveedor_id || meta.prov || "";
      const provNom = provId ? (proveedores.find(p => String(p.id) === String(provId))?.nombre || "") : "";
      await aceptarMovimiento(mov, {
        tipo, cuenta_contable: ed.cuenta_contable || mov.cuenta_contable || "",
        centro_costo: ed.centro_costo || mov.centro_costo || "",
        proveedor_id: provId, proveedor_nombre: provNom,
      });
    }
    setPendientes(prev => prev.filter(m => m.id !== mov.id));
  };

  const aceptar = async (mov) => {
    if (!puedeAceptarMov(mov)) { setMsg("Completá la imputación antes de aceptar."); return; }
    try { await doAceptar(mov); } catch (e) { setMsg("Error al aceptar: " + e.message); }
  };

  // 💳 El débito es el pago de la tarjeta: la fila del extracto es el lado real (caja baja) y se crea
  // el lado tarjeta (+) que reduce su deuda. No es transferencia. Requiere una cuenta-tarjeta de esa moneda.
  const pagarTarjetaDesdeExtracto = async (mov) => {
    const card = cuentas.find(c => esCuentaCredito(c) && c.moneda === (mov.moneda || "ARS"));
    if (!card) { setMsg(`No hay una cuenta-tarjeta en ${mov.moneda || "ARS"} para esta sociedad. Creala en Maestros.`); return; }
    try {
      await pagarTarjeta({
        sociedad, fecha: mov.fecha, monto: Math.abs(Number(mov.monto) || 0), moneda: mov.moneda || "ARS",
        cuenta_real: mov.cuenta_bancaria, tarjeta_id: card.id, mov_existente: mov,
      });
      setPendientes(prev => prev.filter(m => m.id !== mov.id));
      setMsg(`✓ Registrado como pago de ${card.nombre}.`);
    } catch (e) { setMsg("Error al registrar pago de tarjeta: " + e.message); }
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
    // Débito (plata que SALIÓ a franquicias) → PAGO_ENVIADO en cada parte; si no, el signo se invierte en la CC.
    const ftDefault = (Number(mov.monto) || 0) < 0 ? "PAGO_ENVIADO" : (ed.fr_tipo || "PAGO");
    return { ...e, [mov.id]: { ...ed, split: [{ franquicia_id: "", fr_tipo: ftDefault, monto }] } };
  });
  const updSplit = (id, idx, k, v) => setEdits(e => {
    const split = (e[id]?.split || []).map((p, i) => i === idx ? { ...p, [k]: k === "monto" ? (parseFloat(String(v).replace(",", ".")) || 0) : v } : p);
    return { ...e, [id]: { ...e[id], split } };
  });
  // La nueva parte hereda el fr_tipo de las existentes (mismo signo del extracto) → no fuerza "PAGO" en un débito.
  const addSplit = (id) => setEdits(e => ({ ...e, [id]: { ...e[id], split: [...(e[id]?.split || []), { franquicia_id: "", fr_tipo: e[id]?.split?.[0]?.fr_tipo || "PAGO", monto: 0 }] } }));
  const rmSplit = (id, idx) => setEdits(e => {
    const split = (e[id]?.split || []).filter((_, i) => i !== idx);
    return { ...e, [id]: { ...e[id], split: split.length ? split : null } };
  });

  // Grupo de "Propuesta" de una fila → para filtrar y aprobar por grupos.
  const grupoDe = (m) => {
    if (modoIntercoDe(m)) return "Interco";
    if (modoRecvDe(m)) return "Interco recibida";
    if (esTransferMov(m)) return esInterco(m) ? "Transferencia interco" : "Transferencia propia";
    if (frState(m).es) return "Franquicia";
    const csG = cuotaState(m);
    if (csG.es) {   // la cuota va al bucket de su acreedor: AFIP con el resto de AFIP; el crédito bancario aparte
      const plan = financiaciones.find(p => String(p.plan_id) === String(csG.planSel));
      const acr = plan?.acreedor_nombre || "";
      if (/afip/i.test(acr) || plan?.tipo === "plan_afip") return "AFIP";
      if (/galicia|banco|pr[eé]stamo/i.test(acr) || plan?.tipo === "prestamo") return "Cuota préstamos";
      return "Cuota de plan";
    }
    if (haberesMatch(m)) return "Pago de haberes";
    const meta = parseMeta(m.referencia);
    const tipo = meta.tipo || (Number(m.monto) > 0 ? "ingreso" : "");
    // Agrupación por glosa+contraparte (Cambio de moneda / AFIP / Tarjeta / Servicios /
    // Proveedores) — solo sobre lo no clasificado por una regla explícita. Va ANTES que
    // "Cobranza" para que un FX en crédito no caiga como cobranza.
    if (TIPOS_DEBILES.includes(tipo)) {
      const gg = grupoGlosa(m);
      if (gg) return gg.grupo;
    }
    // Un CRÉDITO (entra plata) que no matcheó nada no puede ser un "pago" → es cobranza.
    if ((Number(m.monto) || 0) > 0 && [...TIPOS_DEBILES, "ingreso"].includes(tipo)) return "Cobranza";
    return TIPO_LABEL[tipo] || tipo || "Sin clasificar";
  };
  const pendCuenta = useMemo(
    () => pendientes.filter(m => !cuentaTab || String(m.cuenta_bancaria) === String(cuentaTab)),
    [pendientes, cuentaTab]);
  // Grupos presentes en la cuenta (con conteo) para el desplegable del header.
  const gruposDisp = useMemo(() => {
    const o = {}; pendCuenta.forEach(m => { const g = grupoDe(m); o[g] = (o[g] || 0) + 1; });
    return Object.entries(o).sort((a, b) => b[1] - a[1]);
  }, [pendCuenta, franquicias, pagosSueldos, cuotasPendientes, edits]);
  const filtered = useMemo(
    () => filtroTipo ? pendCuenta.filter(m => grupoDe(m) === filtroTipo) : pendCuenta,
    [pendCuenta, filtroTipo, franquicias, pagosSueldos, cuotasPendientes, edits]);
  const countByCuenta = useMemo(() => {
    const o = {}; pendientes.forEach(m => { o[m.cuenta_bancaria] = (o[m.cuenta_bancaria] || 0) + 1; }); return o;
  }, [pendientes]);
  // Memoizado: puedeAceptarMov es caro (frState/cuotaState/haberesMatch por fila) y esto corre por render.
  const listosCount = useMemo(() => filtered.filter(puedeAceptarMov).length, [filtered, edits, cuotasPendientes]);

  // Re-evaluar las reglas actuales sobre los pendientes de la cuenta (sin re-subir ni escribir):
  // reconstruye la línea desde el movimiento, la clasifica y pre-carga la propuesta en `edits`.
  // El usuario revisa y acepta (las reglas escala/auto caen como propuesta, no se contabilizan solas).
  const reEvaluar = async () => {
    // Trae las reglas FRESCAS de la hoja (salta el cache) → toma cambios recién editados
    // en Maestros sin necesidad de recargar la página.
    const reglasFrescas = await fetchBancoReglas({ fresh: true }).catch(() => reglas);
    setReglas(reglasFrescas || []);
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
        const p = clasificarLinea(lineaDeMov(m), reglasFrescas, proveedores, ctx);
        if (!p || p.tipo === "sin_clasificar") continue;
        if (p.tipo === "transferencia_interna") {
          next[m.id] = { ...next[m.id], modoTransfer: true, modoFranquicia: false, modoFC: false, modoCobro: false, noFranquicia: true, cuenta_destino: p.cuenta_destino || next[m.id]?.cuenta_destino };
        } else if (p.tipo === "cobro_cliente" && p.cliente_id) {
          // Regla de cliente (ej. Gympass) → modo cobro con el cliente pre-seleccionado (la FC la elige el usuario).
          next[m.id] = { ...next[m.id], modoCobro: true, cob_cli: p.cliente_id, cob_id: undefined, modoTransfer: false, modoFranquicia: false, modoFC: false, noFranquicia: true };
        } else if (p.tipo === "interco_park") {
          // Regla interco (ej. Tigre Loco / Wellness) → parkear: sociedad derivada de la cuenta única del otro lado.
          const acc = (cuentasAll || []).find(c => String(c.id) === String(p.cuenta_destino));
          next[m.id] = { ...next[m.id], modoInterco: true, interco_soc: acc?.sociedad || "", interco_acc: p.cuenta_destino || "", modoTransfer: false, modoFranquicia: false, modoFC: false, modoCobro: false, noFranquicia: true, noTransfer: true };
        } else if (p.cuenta_contable) {
          next[m.id] = { ...next[m.id], cuenta_contable: p.cuenta_contable, centro_costo: p.centro_costo || next[m.id]?.centro_costo, proveedor_id: p.proveedor_id || next[m.id]?.proveedor_id };
        } else continue;
        n++;
      }
      return next;
    });
    setMsg(`Re-evaluado con reglas: ${n} con propuesta actualizada. Revisá y aceptá.`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", padding: "20px 28px", boxSizing: "border-box" }}>
      {mundo !== "tarjeta" && (<div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: T.text, margin: 0 }}>
          Conciliaciones <span style={{ fontSize: 13, fontWeight: 700, color: T.muted }}>· {mundo === "interco" ? "Intercompañía" : "Banco"}</span>
        </h2>
        {mundo === "banco" && (
          <span style={{ fontSize: 12, color: T.muted }}>
            {pendientes.length} movimientos sin conciliar
          </span>
        )}
        {mundo === "banco" && (
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
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
            onChange={e => onFile(e.target.files[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={!cuentaTab || uploading}
            style={{ background: T.accent, border: "none", borderRadius: 8, padding: "9px 18px",
              fontSize: 13, fontWeight: 700, color: "#000", cursor: cuentaTab ? "pointer" : "default",
              fontFamily: T.font, opacity: uploading ? .6 : 1 }}>
            {uploading ? "Subiendo…" : "⬆ Subir extracto"}
          </button>
        </div>
        )}
      </div>)}

      {/* ── MUNDO INTERCOMPAÑÍA — posiciones de esta sociedad (read-only) ── */}
      {mundo === "interco" && (() => {
        const pend = pendInterco;
        const money = (n, mon) => `${mon} ${Math.round(Math.abs(n)).toLocaleString("es-AR")}`;
        return (
          <div className="fade" style={{ overflow: "auto" }}>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 12 }}>
              Documentos que otra sociedad te emitió y todavía no reconociste (ventas de otra sociedad + docs de franquicia hacia vos, ej. Segui). <b>Reconocer</b> = lo cargás con TUS cuentas: una factura (te la vendieron) queda por pagar; un crédito/NC (a tu favor, ej. interuso) queda a cobrar.
            </div>
            {pend.length === 0 ? (
              <div style={{ color: T.muted, fontSize: 13, padding: "24px 4px" }}>No hay ventas de otras sociedades pendientes de reconocer.</div>
            ) : (
              <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 10, overflow: "hidden", boxShadow: T.shadow, maxWidth: 720 }}>
                {pend.map((p, i) => (
                  <div key={p.id_comp} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderTop: i ? `1px solid ${T.cardBorder}` : "none", fontSize: 13, color: T.text }}>
                    <div style={{ flex: 1 }}>
                      {p.tratamiento === "gestion" && (
                        <span style={{ display: "inline-block", marginRight: 6, padding: "1px 7px", borderRadius: 999, fontSize: 9.5, fontWeight: 800, letterSpacing: ".05em", color: "#7c3aed", background: "rgba(167,139,250,.15)" }}
                          title="Interuso de sede propia: asiento de gestión (solo P&L, sin caja ni CxC/CxP)">◆ GESTIÓN{p.sedeNombre ? " · " + p.sedeNombre : ""}</span>
                      )}
                      <b>{p.vendedorNombre}</b> te {p.subtipo === "INGRESO" ? "acreditó" : "vendió"} <b style={{ color: p.subtipo === "INGRESO" ? "#0284c7" : "#16a34a", fontFamily: T.mono }}>{money(p.total, p.moneda)}</b>
                      <span style={{ color: T.muted }}>{p.concepto ? ` · ${p.concepto}` : ""}{p.nroComp ? ` · ${p.nroComp}` : ""}{p.fecha ? ` · ${p.fecha}` : ""}</span>
                    </div>
                    <button onClick={() => setReconocerFor(p)}
                      style={{ background: T.accent, border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12.5, fontWeight: 800, color: "#000", cursor: "pointer", fontFamily: T.font }}>
                      Reconocer
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* CC interco pendiente de liquidar (ida y vuelta) */}
            <div style={{ fontSize: 12, color: T.muted, margin: "22px 0 12px" }}>
              Cuenta corriente interco pendiente de liquidar con otras sociedades <b>(ida y vuelta)</b>. Cada una muestra de qué cuenta/caja salió y a cuál entró. Lo que recibiste en caja → <b>Contabilizar recepción</b>; lo que enviaste se cierra al conciliar tu extracto (Banco).
            </div>
            {pendRecibir.length === 0 ? (
              <div style={{ color: T.muted, fontSize: 13, padding: "8px 4px" }}>No hay interco pendientes de liquidar.</div>
            ) : (
              <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 10, overflowX: "auto", boxShadow: T.shadow }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, color: T.text }}>
                  <thead>
                    <tr style={{ color: T.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", textAlign: "left", borderBottom: `1px solid ${T.cardBorder}` }}>
                      <th style={{ padding: "9px 14px", fontWeight: 700 }}>Fecha</th>
                      <th style={{ padding: "9px 14px", fontWeight: 700 }}>Concepto</th>
                      <th style={{ padding: "9px 14px", fontWeight: 700 }}>Cuentas</th>
                      <th style={{ padding: "9px 14px", fontWeight: 700, textAlign: "right" }}>Monto</th>
                      <th style={{ padding: "9px 14px" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {pendRecibir.map((p, i) => {
                      const ctaNom = id => cuentasAll.find(c => String(c.id) === String(id))?.nombre || (id || "—");
                      const recibi = p.dir === "recibi";
                      const de  = recibi ? ctaNom(p.cuenta_otro) : ctaNom(p.cuenta_mia);
                      const a   = recibi ? ctaNom(p.cuenta_mia)  : ctaNom(p.cuenta_otro);
                      return (
                      <tr key={p.id} style={{ borderTop: i ? `1px solid ${T.cardBorder}` : "none" }}>
                        <td style={{ padding: "11px 14px", color: T.muted, whiteSpace: "nowrap" }}>{p.fecha}</td>
                        <td style={{ padding: "11px 14px" }}><b>{p.origen_nombre}</b> {recibi ? "te transfirió" : "— le transferiste"}</td>
                        <td style={{ padding: "11px 14px", fontSize: 11, color: T.muted, whiteSpace: "nowrap" }}>{de} <span style={{ color: T.dim }}>→</span> {a}</td>
                        <td style={{ padding: "11px 14px", textAlign: "right", fontFamily: T.mono, fontWeight: 700, whiteSpace: "nowrap", color: recibi ? "#16a34a" : "#dc2626" }}>{recibi ? "+" : "−"} {money(p.monto, p.moneda)}</td>
                        <td style={{ padding: "8px 14px", textAlign: "right", minWidth: 150 }}>
                          {p.mia ? (
                            <span style={{ fontSize: 11, color: T.dim }}>esperando que {p.origen_nombre} la cierre</span>
                          ) : (
                            <button onClick={() => setDeclararFor(p)}
                              style={{ background: T.accent, border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12.5, fontWeight: 800, color: "#000", cursor: "pointer", fontFamily: T.font }}>
                              Cerrar operación
                            </button>
                          )}
                        </td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── MUNDO TARJETA — resumen como bandeja de consumos a autorizar ── */}
      {mundo === "tarjeta" && <MundoTarjeta sociedad={sociedad} />}

      {/* ── MUNDO BANCO — extracto + bandeja ── */}
      {mundo === "banco" && (<>

      {/* Barra de progreso del upload — no cambies de sociedad mientras sube */}
      {progreso && progreso.total > 0 && (
        <div style={{ margin: "0 0 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: T.muted, marginBottom: 5 }}>
            <span>Subiendo… no cambies de sociedad</span>
            <span>{progreso.done} / {progreso.total}</span>
          </div>
          <div style={{ height: 8, background: T.cardBorder, borderRadius: 999, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round((progreso.done / progreso.total) * 100)}%`,
              background: T.accent, borderRadius: 999, transition: "width .15s ease" }} />
          </div>
        </div>
      )}

      {/* Pestañas por cuenta bancaria (las cuentas-tarjeta viven en el mundo Tarjeta, no acá) */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {cuentas.filter(esCuentaBanco).map(c => {
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
                const modoTransfer = !edits[m.id]?.noTransfer && (esTransf || !!edits[m.id]?.modoTransfer || esTransferPropia(m));
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
                const modoFC = modoFCde(m);
                // Caja 1 = proveedor (default: el reconocido si tiene pendientes). Caja 2 = sus facturas.
                const fcProvSel = fcProvDe(m);
                const fcDelProv = modoFC && fcProvSel ? fcsDeProv(fcProvSel) : [];
                const fcSel = modoFC ? fcIdDe(m) : "";
                const fcSelObj = fcSel ? facturasPendientes.find(f => String(f.id) === String(fcSel)) : null;
                // Modo cobro de venta (créditos): cliente → su factura de venta + retención opcional.
                const modoCobro = !fr.es && !modoTransfer && !modoFC && modoCobroDe(m);
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
                const modoInterco = modoIntercoDe(m);                  // parkeo interco (una pata): manual ⋯ o auto por regla
                const intercoSocSel = modoInterco ? intercoSocDe(m) : "";   // evita parseMeta+find por fila en filas normales
                const intercoAccSel = modoInterco ? intercoAccDe(m) : "";
                const intercoAccOpts = modoInterco && intercoSocSel ? cuentasAll.filter(c => String(c.sociedad) === String(intercoSocSel)) : [];
                const intercoMatch = modoInterco && intercoSocSel ? intercoMatchDe(m) : null;   // pata parkeada de la contraparte → cerrar
                const intercoMatchTxt = intercoMatch ? (() => {
                  const cAbs = Math.abs(Number(intercoMatch.monto) || 0), mAbs = Math.abs(Number(m.monto) || 0);
                  const otra = intercoMatch.moneda || "", mia = m.moneda || "";
                  const tc = (mAbs > 0 && otra !== mia) ? ` · TC impl. ${otra}/${mia} ${(cAbs / mAbs).toFixed(4)}` : "";
                  return `${otra} ${fmt(cAbs)} (parkeada ${intercoMatch.fecha})${tc}`;
                })() : "";
                const modoRecv = modoRecvDe(m);                        // interco recibida (lado receptor, crédito)
                const recvSocSel = recvSocDe(m);
                const hMatch = (!fr.es && !modoTransfer && !modoFC && !modoCobro && !modoCuota && !modoInterco && !modoRecv) ? haberesMatch(m) : null;   // débito que coincide con un lote de haberes
                return (
                  <Fragment key={`${m.id}-${i}`}>
                  <tr style={{ borderBottom: fr.split ? "none" : "1px solid #cbd5e1", background: bg }}>
                    <td style={{ padding: "8px 12px", color: T.muted, whiteSpace: "nowrap" }}>{m.fecha}</td>
                    <td style={{ padding: "8px 12px", maxWidth: 220 }}>
                      <div style={{ color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.concepto}</div>
                      {m.contraparte_nombre && <div style={{ fontSize: 10, color: T.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.contraparte_nombre}>{m.contraparte_nombre}</div>}
                    </td>
                    <td style={{ padding: "8px 12px", fontWeight: 700, textAlign: "right", whiteSpace: "nowrap", color: "#dc2626" }}>
                      {neg ? fmt(total) : ""}
                    </td>
                    <td style={{ padding: "8px 12px", fontWeight: 700, textAlign: "right", whiteSpace: "nowrap", color: "#16a34a" }}>
                      {Number(m.monto) > 0 ? fmt(total) : ""}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {modoInterco ? (
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed" }}>{intercoMatch ? "Interco · cerrar circuito" : "Interco · parkear"}</span>
                          {!intercoSocSel
                            ? <div style={{ fontSize: 10, color: "#b45309" }}>elegí la sociedad</div>
                            : intercoMatch
                              ? <div style={{ fontSize: 10, color: "#16a34a" }}>→ cierra contra {socNombre(intercoSocSel)} · {intercoMatchTxt}</div>
                              : <div style={{ fontSize: 10, color: T.muted }}>→ parkear a {socNombre(intercoSocSel)} · queda pendiente</div>}
                        </div>
                      ) : modoRecv ? (
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed" }}>Interco recibida</span>
                          {recvSocSel
                            ? <div style={{ fontSize: 10, color: T.muted }}>de {socNombre(recvSocSel)} · fondeo (sin P&L)</div>
                            : <div style={{ fontSize: 10, color: "#b45309" }}>elegí la sociedad de origen</div>}
                        </div>
                      ) : fr.es ? (
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: T.text }}>{neg ? "Transferencia a franquicia" : "Cobro franquicia"}</span>
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
                            : <div style={{ fontSize: 10, color: "#b45309" }}>{!fcProvSel ? "elegí proveedor" : fcDelProv.length ? "elegí factura" : "sin factura cargada — cargala o gasto directo (⋯)"}</div>}
                        </div>
                      ) : modoCobro ? (
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#0ea5e9" }}>Cobro de venta</span>
                          {cobSelObj
                            ? <div style={{ fontSize: 10, color: cobDiff > 0.01 ? "#b45309" : T.muted }}>
                                {cobSelObj.cliente} · {cobDiff > 0.01 ? `dep $${fmt(total)}${cobRetSum > 0 ? ` + ret $${fmt(cobRetSum)}` : ""} de $${fmt(cobSelObj.saldo)}` : `saldo $${fmt(cobSelObj.saldo)}`}
                              </div>
                            : <div style={{ fontSize: 10, color: "#b45309" }}>{!cobCliSel ? "elegí cliente" : venDelCli.length ? "elegí factura" : "sin factura de venta — cargala o volvé a normal (⋯)"}</div>}
                        </div>
                      ) : modoCuota ? (
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed" }}>Cuota de plan</span>
                          {cuotaSelObj
                            ? <div style={{ fontSize: 10, color: T.muted }}>{cuotaSelObj.acreedor_nombre || cuotaSelObj.nro_plan || "plan"} · {cuotaLabel(cuotaSelObj)}{Math.abs(total - (cuotaSelObj.total_tardio || 0)) < Math.abs(total - cuotaSelObj.total) ? " (tardío)" : ""}</div>
                            : <div style={{ fontSize: 10, color: "#b45309" }}>{planesVigentes.length ? "elegí financiación/cuota" : "sin cuotas pendientes"}</div>}
                        </div>
                      ) : hMatch ? (
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed" }}>Pago de haberes</span>
                          <div style={{ fontSize: 10, color: T.muted }}>{hMatch.fecha} · {hMatch.count} pers · ${fmt(hMatch.total)} · ya en Sueldos</div>
                        </div>
                      ) : modoTransfer ? (
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: T.text }}>{interco ? "Transferencia interco" : "Transferencia"}</span>
                          {meta.op && <span style={{ fontSize: 9, color: T.dim, marginLeft: 5 }}>op {meta.op}</span>}
                          {dupTransfer(m)
                            ? <div style={{ fontSize: 10, color: "#b45309" }}>⚠ posible duplicado — ya está en la caja (ignorá con ⋯)</div>
                            : <div style={{ fontSize: 10, color: T.muted }}>{destinoSel ? "→ destino elegido" : "elegí destino o ignorá (⋯)"}</div>}
                        </div>
                      ) : (
                        <>
                          <span style={{ fontSize: 11, fontWeight: 700, color: T.text }}>{TIPO_LABEL[tipo] || tipo || "—"}</span>
                          {meta.regla && <span style={{ fontSize: 9, color: T.dim, marginLeft: 5 }}>({meta.regla})</span>}
                          {meta.op && <div style={{ fontSize: 10, color: T.muted }}>op {meta.op}</div>}
                          {dupTransfer(m) && <div style={{ fontSize: 10, color: "#b45309" }}>⚠ posible duplicado — ya hay un movimiento igual en la caja (¿pago ya cargado? ignorá con ⋯)</div>}
                        </>
                      )}
                    </td>
                    <td style={{ padding: "8px 4px 8px 12px", minWidth: 220, textAlign: "center" }}>
                      {modoInterco ? (
                        <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                          <select value={intercoSocSel} onChange={e => setModo(m.id, { interco_soc: e.target.value, interco_acc: undefined })} style={fld(!!intercoSocSel, 150)}>
                            <option value="">— sociedad —</option>
                            {socInterco.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                          </select>
                          <select value={intercoAccSel} onChange={e => setModo(m.id, { interco_acc: e.target.value })} disabled={!intercoSocSel} style={fld(!!intercoAccSel, 160)}>
                            <option value="">{!intercoSocSel ? "elegí sociedad" : (intercoAccOpts.length ? "— cuenta —" : "sin cuenta")}</option>
                            {intercoAccOpts.map(c => <option key={c.id} value={c.id}>{c.nombre} · {c.moneda}</option>)}
                          </select>
                        </div>
                      ) : modoRecv ? (
                        <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
                          <select value={recvSocSel} onChange={e => setModo(m.id, { recv_soc: e.target.value })} style={fld(!!recvSocSel, 150)}>
                            <option value="">— origen —</option>
                            {socInterco.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                          </select>
                          <input type="number" placeholder="costo fin. (opc)" value={edits[m.id]?.recv_costo ?? ""}
                            onChange={e => setModo(m.id, { recv_costo: e.target.value })} style={fld(false, 110)}
                            title="Costo de transferencia/clearing → Perdidas Financieras (P&L)" />
                        </div>
                      ) : modoTransfer ? (
                        <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
                          {interco && <span style={{ fontSize: 9, fontWeight: 800, color: "#7c3aed", background: "#ede9fe", border: "1px solid #c4b5fd", borderRadius: 6, padding: "2px 6px", whiteSpace: "nowrap" }}>INTERCO</span>}
                          <span style={{ fontSize: 11, color: T.muted }}>→</span>
                          <select value={destinoSel} onChange={e => setEdit(m.id, "cuenta_destino", e.target.value)} style={fld(!!destinoSel)}>
                            <option value="">— cuenta destino —</option>
                            {cuentasAll
                              .filter(c => String(c.id) !== String(m.cuenta_bancaria))
                              // Transferencia propia (misma sociedad, contraparte = tu nombre): solo tus cuentas.
                              // Transferencia manual (⋯): cuentas del MISMO anillo (intra-anillo = 2 patas;
                              // la interco cross-anillo va por "Transferencia interco" = 1 pata parkeada).
                              .filter(c => esTransferPropia(m)
                                ? String(c.sociedad ?? "").toLowerCase() === String(sociedad ?? "").toLowerCase()
                                : (!anilloActivo || mismoAnillo(c.sociedad)))
                              .map(c => (
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
                          <select value={fcProvSel} onChange={e => setModo(m.id, { fc_prov: e.target.value, fc_id: "" })} style={fld(!!fcProvSel, 160)}>
                            <option value="">— proveedor —</option>
                            {provOpciones.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                          </select>
                          <select value={fcSel} onChange={e => setEdit(m.id, "fc_id", e.target.value)} disabled={!fcProvSel} style={fld(!!fcSel, 200)}>
                            <option value="">{!fcProvSel ? "elegí proveedor" : fcDelProv.length ? "— factura —" : "sin facturas cargadas"}</option>
                            {fcDelProv.map(f => <option key={f.id} value={String(f.id)}>{fcLabel(f)}</option>)}
                          </select>
                        </div>
                      ) : modoCobro ? (
                        <div key="cob" style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                          <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                            <select value={cobCliSel} onChange={e => setModo(m.id, { cob_cli: e.target.value, cob_id: "" })} style={fld(!!cobCliSel, 160)}>
                              <option value="">— cliente —</option>
                              {clienteOpciones.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                            </select>
                            <select value={cobSel} onChange={e => setEdit(m.id, "cob_id", e.target.value)} disabled={!cobCliSel} style={fld(!!cobSel, 200)}>
                              <option value="">{!cobCliSel ? "elegí cliente" : venDelCli.length ? "— factura —" : "sin facturas de venta"}</option>
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
                            {cuotasDePlan(cuotaSt.planSel).map(c => <option key={c.row_id} value={String(c.row_id)}>Cuota {c.nro_cuota}/{totalCuotasPorPlan.get(c.plan_id) || "?"} · {fmt(c.total)}{c.vto ? ` · ${c.vto}` : ""}</option>)}
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
                            {centroOptionsEls}
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
                        <button onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id); }} title="Más acciones"
                          style={{ background: menuFor === m.id ? T.accent : T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 6, padding: "4px 8px",
                            fontSize: 12, fontWeight: 800, color: T.text, cursor: "pointer", lineHeight: 1 }}>⋯</button>
                      </div>
                      {menuFor === m.id && (
                        <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", right: 6, top: "calc(100% - 2px)", zIndex: 30,
                          background: "#fff", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,.14)", minWidth: 220, overflow: "hidden" }}>
                          {/* Acciones primarias (se ocultan cuando la fila ya está en un modo) */}
                          {!fr.es && !modoTransfer && !modoInterco && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoTransfer: true, noTransfer: false, modoFranquicia: false, modoInterco: false, noFranquicia: true }); setMenuFor(null); }}>⇄ Transferencia entre cuentas</button>
                          )}
                          {!modoInterco && !fr.es && !modoTransfer && !modoFC && !modoCobro && !modoCuota && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoInterco: true, modoFranquicia: false, modoTransfer: false, modoFC: false, modoCobro: false, modoCuota: false, noFranquicia: true, noTransfer: true }); setMenuFor(null); }}>🌐 Transferencia interco (otra sociedad)…</button>
                          )}
                          {!neg && !modoRecv && !modoInterco && !fr.es && !modoTransfer && !modoCobro && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoRecv: true, modoFranquicia: false, modoTransfer: false, modoFC: false, modoCobro: false, noFranquicia: true, noTransfer: true }); setMenuFor(null); }}>🌐 Interco recibida (de otra sociedad)…</button>
                          )}
                          {modoRecv && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoRecv: false, recv_soc: undefined, recv_costo: undefined, noFranquicia: false, noTransfer: false }); setMenuFor(null); }}>↩ Volver a normal (no es interco recibida)</button>
                          )}
                          {!fr.es && !modoTransfer && !modoInterco && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoFranquicia: true, noFranquicia: false, modoTransfer: false, modoInterco: false }); setMenuFor(null); }}>🏬 Mov. franquicias</button>
                          )}
                          {neg && !fr.es && !modoTransfer && !modoInterco && !modoFC && !modoCuota && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoFC: true, modoFranquicia: false, modoTransfer: false, noFranquicia: true }); setMenuFor(null); }}>🧾 Imputar a factura</button>
                          )}
                          {neg && !fr.es && !modoTransfer && !modoInterco && !modoCuota && !modoCobro && (
                            <button style={MENU_ITEM} onClick={() => { setCargarFacturaFor(m); setMenuFor(null); }}>➕ Cargar factura nueva…</button>
                          )}
                          {!neg && !fr.es && !modoTransfer && !modoInterco && !modoCobro && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoCobro: true, modoFranquicia: false, modoTransfer: false, noFranquicia: true }); setMenuFor(null); }}>🧾 Imputar a factura</button>
                          )}
                          {!neg && !fr.es && !modoTransfer && !modoInterco && !modoRecv && (
                            <button style={MENU_ITEM} onClick={() => { setCargarIngresoFor(m); setMenuFor(null); }}>➕ Cargar factura de venta nueva…</button>
                          )}
                          {neg && !fr.es && !modoTransfer && !modoInterco && !modoFC && !modoCobro && !modoCuota && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoCuota: true, noCuota: false, modoFranquicia: false, modoTransfer: false, modoFC: false, modoCobro: false, noFranquicia: true }); setMenuFor(null); }}>💳 Imputar a cuota de financiación</button>
                          )}
                          {neg && !fr.es && !modoTransfer && !modoInterco && !modoFC && !modoCuota && !modoCobro && cuentas.some(c => esCuentaCredito(c) && c.moneda === (m.moneda || "ARS")) && (
                            <button style={MENU_ITEM} onClick={() => { setMenuFor(null); pagarTarjetaDesdeExtracto(m); }}>💳 Pago de tarjeta</button>
                          )}
                          {/* Toggles contextuales: volver a normal / dividir (solo con el modo activo) */}
                          {modoInterco && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoInterco: false, interco_soc: undefined, noFranquicia: false, noTransfer: false }); setMenuFor(null); }}>↩ Volver a normal (no es interco)</button>
                          )}
                          {modoFC && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoFC: false, fc_id: undefined, noFranquicia: false }); setMenuFor(null); }}>{esProvServ(m) ? "🧾✗ Contabilizar como gasto directo (sin factura)" : "↩ Volver a normal (no es pago de factura)"}</button>
                          )}
                          {modoCuota && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoCuota: false, noCuota: true, cuota_plan: undefined, cuota_row: undefined, noFranquicia: false }); setMenuFor(null); }}>↩ No es cuota de financiación</button>
                          )}
                          {modoCobro && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoCobro: false, cob_id: undefined, cob_cli: undefined, rets: [], noFranquicia: false }); setMenuFor(null); }}>↩ Volver a normal (no es cobro de venta)</button>
                          )}
                          {fr.es && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { modoFranquicia: false, noFranquicia: true, modoTransfer: false, split: null }); setMenuFor(null); }}>↩ No es franquicia (volver a normal)</button>
                          )}
                          {!fr.es && modoTransfer && (
                            <button style={MENU_ITEM} onClick={() => { setModo(m.id, { noTransfer: true, modoTransfer: false, noFranquicia: false, cuenta_destino: undefined }); setMenuFor(null); }}>↩ Volver a normal (no es transferencia)</button>
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
                          <button style={MENU_ITEM} onClick={() => { setReglaModal({ prefill: prefillRegla(m) }); setMenuFor(null); }}>⚙ Crear regla</button>
                          <button style={{ ...MENU_ITEM, color: "#b45309" }} onClick={() => { if (window.confirm(`Ignorar esta línea (no se contabiliza)?\n${m.concepto || ""} · $${fmt(total)}`)) ignorar(m); setMenuFor(null); }}>🚫 Ignorar</button>
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
                                {(Number(m.monto) || 0) < 0
                                  ? <option value="PAGO_ENVIADO">Transf. enviada</option>
                                  : <><option value="PAGO">Pago de CC</option><option value="PAGO_PAUTA">Pago a cuenta</option></>}
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
      </>)}

      {reconocerFor && (
        <ReconocerIntercoModal
          pend={reconocerFor}
          sociedad={sociedad}
          cuentas={planCuentas}
          centros={centros}
          onClose={() => setReconocerFor(null)}
          onDone={async () => { setReconocerFor(null); try { const d = await fetchIntercoData(); setIntercoData(d); } catch {} }}
        />
      )}

      {declararFor && (
        <DeclararRecibidaModal
          pend={declararFor}
          sociedad={sociedad}
          cuentas={cuentas}
          planCuentas={cuentasTodas}
          onClose={() => setDeclararFor(null)}
          onDone={async () => {
            const closedId = declararFor?.id;   // pata parkeada que se acaba de cerrar
            setDeclararFor(null);
            // Optimista: marcarla "recibida=" localmente para que salga YA de pendientes (GAS tiene lag
            // read-after-write → el refetch inmediato suele traer la hoja pre-edit y la línea reaparecía).
            const marcarCerrada = (movs) => (movs || []).map(m =>
              String(m.id) === String(closedId) && !/recibida=/.test(String(m.referencia || ""))
                ? { ...m, referencia: "recibida=local" } : m);
            if (closedId) setIntercoData(prev => ({ ...prev, movs: marcarCerrada(prev.movs) }));
            // Reconcilia con el servidor, pero mantiene la marca local si todavía no propagó (no revive la línea).
            try { const d = await fetchIntercoData(); setIntercoData({ ...d, movs: closedId ? marcarCerrada(d.movs) : d.movs }); } catch {}
          }}
        />
      )}

      {/* Cargar factura nueva desde la bandeja (modal Nueva Compra, encima de la conciliación).
          Prefill con proveedor reconocido + monto/fecha del débito; al guardar, queda lista para
          imputar el pago (auto-entra en modo FC con la factura preseleccionada). */}
      {cargarFacturaFor && (() => {
        const mov = cargarFacturaFor;
        const provId = fcProvDe(mov) || "";
        const prov = proveedores.find(p => String(p.id) === String(provId));
        const tot = Math.abs(Number(mov.monto) || 0);
        return (
          <NuevoEgresoModal
            sociedad={sociedad}
            proveedores={proveedores}
            cuentas={planCuentas}
            centrosCosto={centros}
            onCrearProveedor={crearProveedor}
            onCrearCuenta={crearCuenta}
            initialData={{
              _duplicate: true,   // NUEVA factura (id nuevo), no editar una existente
              proveedor: prov?.nombre || mov.contraparte_nombre || "",
              proveedorId: provId,
              cuentaId: prov?.cuentaDefault || "",           // cuenta contable default del proveedor (ej. Aysa → Servicios)
              moneda: prov?.monedaDefault || mov.moneda || "ARS",
              fecha: "",           // emisión vacía a propósito (no es la fecha del pago) → obliga a completarla, no queda mal
              vto: mov.fecha,      // vto = fecha del pago que estás conciliando
              nroComp: "",
              nota: mov.concepto || "",
              lineas: [{ cc: prov?.ccDefault || "", subtotal: tot, ivaRate: 0, iva_monto: 0, total_linea: tot }],
              importe: tot,
            }}
            onClose={() => setCargarFacturaFor(null)}
            onSave={async (payload) => {
              // 1) crear la factura, 2) imputar el pago del extracto contra ella = conciliar la línea.
              await appendEgreso(payload);
              await imputarPagoFC(mov, {
                documento_id: payload.id,
                cuenta_contable: payload.cuentaId || payload.cuenta || "",
                centro_costo: String(payload.cc || "").split(",")[0].trim(),
                proveedor_id: payload.proveedorId || "",
                proveedor_nombre: payload.proveedor || "",
              });
              setPendientes(prev => prev.filter(x => x.id !== mov.id));   // sale de la bandeja
              fetchEgresos(sociedad).then(e => setEgresos(e || [])).catch(() => {});   // refresca Compras
              setCargarFacturaFor(null);
            }}
          />
        );
      })()}

      {/* Cargar factura de VENTA nueva desde un crédito (espejo del de compra): crea el ingreso y
          concilia el cobro contra él en un paso. */}
      {cargarIngresoFor && (() => {
        const mov = cargarIngresoFor;
        const cliId = cobClienteDe(mov) || "";
        const cli = clientes.find(c => String(c.id) === String(cliId)) || {};
        const tot = Math.abs(Number(mov.monto) || 0);
        return (
          <NuevoIngresoModal
            sociedad={sociedad}
            clientes={clientes}
            cuentas={planCuentas}
            centrosCosto={centros}
            onCrearCliente={crearCliente}
            onCrearCuenta={crearCuenta}
            initialData={{
              _duplicate: true,
              cliente: cli.nombre || mov.contraparte_nombre || "",
              clienteId: cliId,
              cuentaId: cli.cuentaDefault || "",
              moneda: cli.monedaDefault || mov.moneda || "ARS",
              fecha: "",           // emisión vacía a propósito → obliga a completarla
              vto: mov.fecha,      // vto = fecha del cobro que estás conciliando
              nroComp: "",
              nota: mov.concepto || "",
              lineas: [{ cc: cli.ccDefault || "", subtotal: tot, ivaRate: 0, iva_monto: 0, total_linea: tot }],
              importe: tot,
            }}
            onClose={() => setCargarIngresoFor(null)}
            onSave={async (payload) => {
              // 1) crear la factura de venta, 2) imputar el cobro del extracto contra ella = conciliar.
              await appendIngreso(payload);
              await imputarCobroIngreso(mov, {
                documento_id: payload.id,
                cuenta_contable: payload.cuentaId || payload.cuenta || "",
                centro_costo: String(payload.cc || "").split(",")[0].trim(),
                cliente_id: payload.clienteId || "", cliente_nombre: payload.cliente || "",
                retenciones: [], retencion_centro: centroRetencion,
              });
              setPendientes(prev => prev.filter(x => x.id !== mov.id));   // sale de la bandeja
              fetchIngresos(sociedad).then(i => setIngresos(i || [])).catch(() => {});   // refresca Ventas
              setCargarIngresoFor(null);
            }}
          />
        );
      })()}
    </div>
  );
}
