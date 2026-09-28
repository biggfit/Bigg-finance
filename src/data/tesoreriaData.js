// ─── BIGG Numbers — Estructura de Tesorería ──────────────────────────────────
// Basado en Posicion Financiera V1.xlsx + datos del usuario
// Los saldos arrancan en 0 — se cargan desde backend / carga manual

// ─── Sociedades ───────────────────────────────────────────────────────────────
// Lista de respaldo (fallback) — se usa SOLO si fetchSociedades() no carga. Debe espejar la hoja
// nb_sociedades (id/nombre/pais/bandera/moneda/anillo) para no mostrar datos viejos si el GAS falla.
// La fuente de verdad es la hoja; esto es el bootstrap del primer render y el salvavidas ante caída.
export const SOCIEDADES = [
  { id:"nako",       nombre:"Ñako SRL",                     cuit:"30717028305", pais:"AR", bandera:"AR", moneda:"ARS", anillo:"Núcleo",                 activo:true },
  { id:"hektor",     nombre:"Hektor",                       cuit:"30714015377", pais:"AR", bandera:"AR", moneda:"ARS", anillo:"Núcleo",                 activo:true },
  { id:"eventos",    nombre:"Eventos",                      cuit:"30714381594", pais:"AR", bandera:"AR", moneda:"ARS", anillo:"Núcleo",                 activo:true },
  { id:"biggfit",    nombre:"Bigg Fit LLC",                 cuit:"36-5000106",  pais:"US", bandera:"AR", moneda:"USD", anillo:"Núcleo",                 activo:true },
  { id:"wellness",   nombre:"Gestion Deportiva y Wellness", cuit:"B09706771",   pais:"ES", bandera:"ES", moneda:"EUR", anillo:"Fondeadas / inversión",  activo:true },
  { id:"beta",       nombre:"Beta",                         cuit:"",            pais:"AR", bandera:"AR", moneda:"ARS", anillo:"Núcleo",                 activo:true },
  { id:"tigre-loco", nombre:"Tigre Loco",                   cuit:"",            pais:"CO", bandera:"CO", moneda:"COP", anillo:"Fondeadas / inversión",  activo:true },
  { id:"segui-fit",  nombre:"Segui Fit",                    cuit:"30717067769", pais:"AR", bandera:"AR", moneda:"ARS", anillo:"Externas administradas", activo:true },
  { id:"puertos",    nombre:"Puertos",                      cuit:"",            pais:"AR", bandera:"AR", moneda:"ARS", anillo:"Fondeadas / inversión",  activo:true },
];

// ─── Cuentas bancarias y cajas ────────────────────────────────────────────────
// tipo: "banco" | "caja" | "inversion"
// saldo: 0 = pendiente de carga real
export const CUENTAS_BANCARIAS = [

  // ── Ñako SRL ──────────────────────────────────────────────────────────────
  { id:"nako-galicia-ars",   sociedad:"nako",    nombre:"Galicia ARS",         banco:"Banco Galicia",  tipo:"banco",    moneda:"ARS", saldo:0 },
  { id:"nako-galicia-usd",   sociedad:"nako",    nombre:"Galicia USD",         banco:"Banco Galicia",  tipo:"banco",    moneda:"USD", saldo:0 },
  { id:"nako-mp",            sociedad:"nako",    nombre:"Mercado Pago",        banco:"Mercado Pago",   tipo:"banco",    moneda:"ARS", saldo:0 },
  { id:"nako-prisma",        sociedad:"nako",    nombre:"PRISMA",              banco:"PRISMA",         tipo:"inversion",moneda:"ARS", saldo:0 },
  { id:"nako-fima",          sociedad:"nako",    nombre:"FIMA",                banco:"FIMA",           tipo:"inversion",moneda:"ARS", saldo:0 },
  { id:"nako-allaria",       sociedad:"nako",    nombre:"ALLARIA",             banco:"ALLARIA",        tipo:"inversion",moneda:"ARS", saldo:0 },
  { id:"nako-caja-hq-ars",   sociedad:"nako",    nombre:"Caja HQ ARS",         banco:null,             tipo:"caja",     moneda:"ARS", saldo:0 },
  { id:"nako-caja-hq-usd",   sociedad:"nako",    nombre:"Caja HQ USD",         banco:null,             tipo:"caja",     moneda:"USD", saldo:0 },
  { id:"nako-camacho",       sociedad:"nako",    nombre:"Caja CC Camacho",     banco:null,             tipo:"caja",     moneda:"ARS", saldo:0 },
  { id:"nako-recoleta",      sociedad:"nako",    nombre:"Caja Recoleta",       banco:null,             tipo:"caja",     moneda:"ARS", saldo:0 },
  { id:"nako-barrio-norte",  sociedad:"nako",    nombre:"Caja Barrio Norte",   banco:null,             tipo:"caja",     moneda:"ARS", saldo:0 },
  { id:"nako-plaza-libertad",sociedad:"nako",    nombre:"Caja Plaza Libertad", banco:null,             tipo:"caja",     moneda:"ARS", saldo:0 },
  { id:"nako-belgrano",      sociedad:"nako",    nombre:"Caja Belgrano",       banco:null,             tipo:"caja",     moneda:"ARS", saldo:0 },
  { id:"nako-palermo",       sociedad:"nako",    nombre:"Caja Palermo Chico",  banco:null,             tipo:"caja",     moneda:"ARS", saldo:0 },

  // ── Hektor SRL ────────────────────────────────────────────────────────────
  { id:"hektor-galicia-ars", sociedad:"hektor",  nombre:"Galicia ARS",         banco:"Banco Galicia",  tipo:"banco",    moneda:"ARS", saldo:0 },
  { id:"hektor-galicia-usd", sociedad:"hektor",  nombre:"Galicia USD",         banco:"Banco Galicia",  tipo:"banco",    moneda:"USD", saldo:0 },
  { id:"hektor-mp",          sociedad:"hektor",  nombre:"Mercado Pago",        banco:"Mercado Pago",   tipo:"banco",    moneda:"ARS", saldo:0 },
  { id:"hektor-columbia",    sociedad:"hektor",  nombre:"Banco Columbia",      banco:"Banco Columbia", tipo:"banco",    moneda:"ARS", saldo:0 },

  // ── Eventos SRL ───────────────────────────────────────────────────────────
  { id:"eventos-galicia-ars",sociedad:"eventos", nombre:"Galicia ARS",         banco:"Banco Galicia",  tipo:"banco",    moneda:"ARS", saldo:0 },
  { id:"eventos-galicia-usd",sociedad:"eventos", nombre:"Galicia USD",         banco:"Banco Galicia",  tipo:"banco",    moneda:"USD", saldo:0 },

  // ── Bigg Fit LLC ──────────────────────────────────────────────────────────
  { id:"biggfit-usd",        sociedad:"biggfit", nombre:"InterAudi USD",       banco:"InterAudi",      tipo:"banco",    moneda:"USD", saldo:0 },
  { id:"biggfit-eur",        sociedad:"biggfit", nombre:"InterAudi EUR",       banco:"InterAudi",      tipo:"banco",    moneda:"EUR", saldo:0 },

  // ── Gestión Deportiva y Wellness ──────────────────────────────────────────
  { id:"wellness-eur",       sociedad:"wellness",nombre:"Cuenta EUR",          banco:null,             tipo:"banco",    moneda:"EUR", saldo:0 },

  // ── Tigre Loco ────────────────────────────────────────────────────────────
  { id:"tigre-cop",          sociedad:"tigre-loco", nombre:"Cuenta COP",        banco:null,             tipo:"banco",    moneda:"COP", saldo:0 },

  // ── Beta ──────────────────────────────────────────────────────────────────
  { id:"b-ars",              sociedad:"beta",    nombre:"Efectivo ARS",        banco:null,             tipo:"caja",     moneda:"ARS", saldo:0 },
  { id:"b-usd",              sociedad:"beta",    nombre:"Efectivo USD",        banco:null,             tipo:"caja",     moneda:"USD", saldo:0 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const TIPO_CUENTA = {
  banco:     { label:"Banco",    icon:"🏦", color:"#2563eb" },
  caja:      { label:"Caja",     icon:"💵", color:"#16a34a" },
  inversion: { label:"Inversión",icon:"📈", color:"#7c3aed" },
  tarjeta:   { label:"Tarjeta",  icon:"💳", color:"#dc2626" },
};

export const MONEDA_SYM = {
  ARS: "$",
  USD: "U$D",
  EUR: "€",
  COP: "COP",
};

// Monedas elegibles en los formularios (factura de proveedor/cliente, moneda habitual del
// maestro). Fuente única para que no vuelvan a quedar listas hardcodeadas desincronizadas:
// COP existía en MONEDA_SYM y en las cuentas bancarias de Tigre Loco, pero no en los selects,
// así que en Colombia no se podía cargar una factura en su propia moneda.
// Moneda con la que abre un formulario nuevo (factura de proveedor/cliente) segun la sociedad
// activa. Antes arrancaba siempre en ARS, asi que en Tigre Loco (COP), Bigg Fit (USD) y Wellness
// (EUR) habia que corregir el dropdown en cada carga. Lee de SOCIEDADES, que espeja nb_sociedades;
// si el id no esta en la lista cae en ARS, que es el comportamiento que habia antes.
export const monedaDeSociedad = (id) => SOCIEDADES.find(s => s.id === id)?.moneda ?? "ARS";
export const paisDeSociedad   = (id) => SOCIEDADES.find(s => s.id === id)?.pais   ?? "AR";

// Alicuotas de IVA por pais de la sociedad. El circuito de factura estaba cableado a Argentina
// (opciones 0/10.5/21/27 y default 21), asi que en Tigre Loco no se podia cargar el IVA colombiano
// —no existia el 19%— y a Bigg Fit LLC, que no lleva IVA, le aparecia 21% preseleccionado.
// La 1a opcion de cada lista es la que trae una linea nueva.
const IVA_POR_PAIS = {
  AR: [21, 10.5, 27, 0],   // general, reducida, incrementada, exento
  CO: [19, 5, 0],          // general, reducida, exento
  ES: [21, 10, 4, 0],      // general, reducida, superreducida, exento
  US: [0],                 // sin IVA
};
const ivaListaDeSociedad = (id) => IVA_POR_PAIS[SOCIEDADES.find(s => s.id === id)?.pais] ?? IVA_POR_PAIS.AR;

// Opciones ordenadas de menor a mayor para el <select>, pero el default sale de la lista de arriba
// (la general del pais), no del primero del select.
export const ivaOptsDeSociedad = (id) =>
  [...ivaListaDeSociedad(id)].sort((a, b) => a - b).map(v => ({ value: v, label: `${v}%` }));
export const ivaDefaultDeSociedad = (id) => ivaListaDeSociedad(id)[0];

// Régimen de retenciones PRACTICADAS por país (somos agentes de retención). Mismo criterio que
// IVA_POR_PAIS: lo que cambia entre países es DATO, no ramas en la pantalla. El modal de Egresos lee de
// acá y no sabe qué es un VEP ni qué es el modelo 111.
//
// Lo que varía de verdad entre circuitos es CUÁNDO se deposita lo retenido:
//   · AR — se deposita por VEP en el mismo acto, así que el VEP identifica la deuda (va al nro_comp),
//     es obligatorio, y la fecha del asiento es la de hoy.
//   · ES — el IRPF se declara y paga con el modelo 111 TRIMESTRAL, así que no hay número por operación:
//     el comprobante va sin nro_comp, y el asiento pertenece al período FISCAL de la factura aunque se
//     cargue meses después.
// CO y US todavía no tienen régimen propio: caen en el argentino, que es lo que hacían antes de que esto
// existiera. Cuando Tigre Loco empiece a retener (RteFte/RteICA), es agregar su fila acá —no tocar el modal.
// OJO con el vencimiento: se calcula por slice del ISO, sin construir Date, igual que balanceUtils, para
// que el huso horario no corra el día.
const RETENCION_POR_PAIS = {
  AR: {
    organismoRe: /afip|arca|a\.?f\.?i\.?p/i, organismoNombre: "AFIP",
    nroLabel: "N° VEP", nroPlaceholder: "1661738826", nroRequerido: true,
    vtoLabel: "Vto. VEP", vtoSugerido: () => "",
    organismoLabel: "Organismo (destino del VEP)", organismoPlaceholder: "— elegí el proveedor AFIP/ARCA —",
    depositoLabel: "A depositar a AFIP (VEP):",
    cuentasHint: "Ganancias, IVA, IIBB", pidePct: false,
    fechaAsiento: "hoy",
    ref: (nro) => (nro ? `VEP ${nro}` : ""),
  },
  ES: {
    organismoRe: /hacienda|aeat/i, organismoNombre: "Hacienda",
    nroLabel: "", nroPlaceholder: "", nroRequerido: false,
    vtoLabel: "Vto. modelo 111",
    // El 20 del mes siguiente al cierre del trimestre de la fecha fiscal.
    vtoSugerido: (iso) => {
      if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso || ""))) return "";
      const y = +iso.slice(0, 4), m = +iso.slice(5, 7);          // m: 1-12
      const finTrim = Math.ceil(m / 3) * 3;                      // 3, 6, 9 o 12
      const mesVto = finTrim === 12 ? 1 : finTrim + 1;
      return `${finTrim === 12 ? y + 1 : y}-${String(mesVto).padStart(2, "0")}-20`;
    },
    organismoLabel: "Organismo (modelo 111)", organismoPlaceholder: "— elegí Hacienda —",
    depositoLabel: "A depositar a Hacienda (modelo 111):",
    cuentasHint: "IRPF", pidePct: true,
    fechaAsiento: "fiscal",
    ref: () => "Modelo 111",
  },
};
export const regimenRetencionDeSociedad = (id) => RETENCION_POR_PAIS[paisDeSociedad(id)] ?? RETENCION_POR_PAIS.AR;

export const MONEDA_OPTS = [
  { value: "ARS", label: "$ ARS", labelLargo: "ARS — Pesos" },
  { value: "USD", label: "U$D",   labelLargo: "USD — Dólares" },
  { value: "EUR", label: "€ EUR", labelLargo: "EUR — Euros" },
  { value: "COP", label: "COP",   labelLargo: "COP — Pesos colombianos" },
];

export const fmtSaldo = (n, moneda) => {
  const sym  = MONEDA_SYM[moneda] ?? moneda;
  const abs  = Math.abs(Number(n) || 0);
  const neg  = Number(n) < 0;
  return `${neg ? "-" : ""}${sym} ${abs.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
