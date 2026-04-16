// ─── BIGG Numbers — Estructura de Tesorería ──────────────────────────────────
// Basado en Posicion Financiera V1.xlsx + datos del usuario
// Los saldos arrancan en 0 — se cargan desde backend / carga manual

// ─── Sociedades ───────────────────────────────────────────────────────────────
export const SOCIEDADES = [
  { id:"nako",     nombre:"Ñako SRL",                    pais:"AR", bandera:"🇦🇷", moneda:"ARS" },
  { id:"hektor",   nombre:"Hektor SRL",                  pais:"AR", bandera:"🇦🇷", moneda:"ARS" },
  { id:"eventos",  nombre:"Eventos SRL",                 pais:"AR", bandera:"🇦🇷", moneda:"ARS" },
  { id:"biggfit",  nombre:"Bigg Fit LLC",                pais:"US", bandera:"🇺🇸", moneda:"USD" },
  { id:"wellness", nombre:"Gestión Deportiva y Wellness",pais:"ES", bandera:"🇪🇸", moneda:"EUR" },
  { id:"tigre",    nombre:"Tigre Loco SAS",              pais:"CO", bandera:"🇨🇴", moneda:"COP" },
  { id:"funfit",   nombre:"Fun Fitness Performance LLC", pais:"US", bandera:"🇺🇸", moneda:"USD" },
  { id:"b",        nombre:"B",                           pais:"AR", bandera:"🔒",  moneda:"ARS", discreta:true },
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

  // ── Tigre Loco SAS ────────────────────────────────────────────────────────
  { id:"tigre-cop",          sociedad:"tigre",   nombre:"Cuenta COP",          banco:null,             tipo:"banco",    moneda:"COP", saldo:0 },

  // ── Fun Fitness Performance LLC ───────────────────────────────────────────
  { id:"funfit-usd",         sociedad:"funfit",  nombre:"Cuenta USD",          banco:null,             tipo:"banco",    moneda:"USD", saldo:0 },

  // ── B ─────────────────────────────────────────────────────────────────────
  { id:"b-ars",              sociedad:"b",       nombre:"Efectivo ARS",        banco:null,             tipo:"caja",     moneda:"ARS", saldo:0 },
  { id:"b-usd",              sociedad:"b",       nombre:"Efectivo USD",        banco:null,             tipo:"caja",     moneda:"USD", saldo:0 },
];

// ─── A Cobrar (Activo — no físico) ───────────────────────────────────────────
export const A_COBRAR_ITEMS = [
  { id:"cxc-clientes-ars", label:"Cta Cte Clientes (Franquicias ARS)", moneda:"ARS", saldo:0 },
  { id:"cxc-clientes-usd", label:"Cta Cte Clientes (Franquicias USD)", moneda:"USD", saldo:0 },
  { id:"cxc-clientes-eur", label:"Cta Cte Clientes (Franquicias EUR)", moneda:"EUR", saldo:0 },
  { id:"cxc-franq-ventas", label:"Venta de Franquicias (USD)",         moneda:"USD", saldo:0 },
  { id:"cxc-wellhub-usd",  label:"Wellhub APP (USD)",                  moneda:"USD", saldo:0 },
  { id:"cxc-rosedal",      label:"Cta Rosedal",                        moneda:"ARS", saldo:0 },
  { id:"cxc-cheques",      label:"Cheque de Terceros",                 moneda:"ARS", saldo:0 },
];

// ─── A Pagar (Pasivo — no físico) ────────────────────────────────────────────
export const A_PAGAR_ITEMS = [
  { id:"cxp-proveedores-ars", label:"Saldo Cta Cte Proveedores ARS",  moneda:"ARS", saldo:0 },
  { id:"cxp-proveedores-usd", label:"Saldo Cta Cte Proveedores USD",  moneda:"USD", saldo:0 },
  { id:"cxp-visa",            label:"VISA Business",                   moneda:"ARS", saldo:0 },
  { id:"cxp-amex",            label:"American Express Corp",           moneda:"USD", saldo:0 },
  { id:"cxp-deuda-imp",       label:"Deuda Impositiva",               moneda:"ARS", saldo:0 },
  { id:"cxp-prestamos-ars",   label:"Préstamos ARS",                  moneda:"ARS", saldo:0 },
  { id:"cxp-prestamos-usd",   label:"Préstamos USD",                  moneda:"USD", saldo:0 },
  { id:"cxp-wellhub-ars",     label:"Wellhub ARS",                    moneda:"ARS", saldo:0 },
  { id:"cxp-wellhub-chile",   label:"Wellhub Chile (USD)",            moneda:"USD", saldo:0 },
  { id:"cxp-wellhub-espana",  label:"Wellhub España (USD)",           moneda:"USD", saldo:0 },
  { id:"cxp-pase-libre",      label:"Pase Libre (USD)",               moneda:"USD", saldo:0 },
  { id:"cxp-dividendos",      label:"Dividendos Socios",              moneda:"USD", saldo:0 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
export const TIPO_CUENTA = {
  banco:     { label:"Banco",    icon:"🏦", color:"#2563eb" },
  caja:      { label:"Caja",     icon:"💵", color:"#16a34a" },
  inversion: { label:"Inversión",icon:"📈", color:"#7c3aed" },
};

export const MONEDA_SYM = {
  ARS: "$",
  USD: "U$D",
  EUR: "€",
  COP: "COP",
};

export const fmtSaldo = (n, moneda) => {
  const sym  = MONEDA_SYM[moneda] ?? moneda;
  const abs  = Math.abs(Number(n) || 0);
  const neg  = Number(n) < 0;
  return `${neg ? "-" : ""}${sym} ${abs.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;
};
