// ─── BIGG Numbers — Datos maestros (seed) ─────────────────────────────────
// Extraídos de historico.xlsx (compras + VENTAS) · Abril 2026
// Antes de pasar a producción: reemplazar por carga completa desde Sheets.

// ─────────────────────────────────────────────────────────────────────────────
// CENTROS DE COSTO
// grupo "operaciones" = sedes propias
// grupo "marca"       = departamentos de HQ
// ─────────────────────────────────────────────────────────────────────────────
export const CENTROS_COSTO = [
  // ── Sedes operativas ──
  { id: "01 - Recoleta",      nombre: "Recoleta",           grupo: "operaciones", activo: true },
  { id: "02 - Palermo Chico", nombre: "Palermo Chico",      grupo: "operaciones", activo: true },
  { id: "03 - Belgrano",      nombre: "Belgrano",           grupo: "operaciones", activo: true },
  { id: "04 - Plaza Libertad",nombre: "Plaza Libertad",     grupo: "operaciones", activo: true },
  { id: "05 - Barrio Norte",  nombre: "Barrio Norte",       grupo: "operaciones", activo: true },
  { id: "11 - Wellness",      nombre: "Wellness",           grupo: "operaciones", activo: true },
  { id: "12 - Tigre Loco",    nombre: "Tigre Loco",         grupo: "operaciones", activo: true },
  { id: "17 - Huergo",        nombre: "Huergo",             grupo: "operaciones", activo: true },

  // ── HQ — Departamentos ──
  { id: "10 - HQ",                    nombre: "HQ General",          grupo: "HQ", activo: true },
  { id: "HQ - Administracion",        nombre: "Administración",      grupo: "HQ", activo: true },
  { id: "HQ - BI",                    nombre: "BI & Analytics",      grupo: "HQ", activo: true },
  { id: "HQ - Design",                nombre: "Design",              grupo: "HQ", activo: true },
  { id: "HQ - Gerencia General",      nombre: "Gerencia General",    grupo: "HQ", activo: true },
  { id: "HQ - Impuestos",             nombre: "Impuestos",           grupo: "HQ", activo: true },
  { id: "HQ - Infraestructura IT",    nombre: "Infraestructura IT",  grupo: "HQ", activo: true },
  { id: "HQ - Marketing",             nombre: "Marketing",           grupo: "HQ", activo: true },
  { id: "HQ - Recursos Humanos",      nombre: "Recursos Humanos",    grupo: "HQ", activo: true },
  { id: "HQ - Sport",                 nombre: "Sport",               grupo: "HQ", activo: true },
  { id: "HQ - Tecnologia",            nombre: "Tecnología",          grupo: "HQ", activo: true },
  { id: "HQ - Ventas y Operaciones",  nombre: "Ventas y Operaciones",grupo: "HQ", activo: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// CUENTAS
// tipo: "gasto" | "ingreso" | "financiero"
// cuenta_pasivo: bucket de balance al que apunta cuando queda impago
//   "proveedores" | "sueldos" | "impuestos" | "financiero" | null (ingresos)
// ─────────────────────────────────────────────────────────────────────────────
export const CUENTAS = [

  // ── GASTOS OPERATIVOS DE SEDE ──
  { id: "alquiler",                nombre: "Alquiler",                              tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "expensas_abl",            nombre: "Expensas y ABL",                        tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "limpieza",                nombre: "Limpieza",                              tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "servicios",               nombre: "Servicios",                             tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "equipamiento_mantenimiento", nombre: "Equipamiento y Mantenimiento",       tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "interusos",               nombre: "Interusos",                             tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "comisiones",              nombre: "Comisiones",                            tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "comision_resultado",      nombre: "Comisión s/ Resultado",                 tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "honorarios",              nombre: "Honorarios Profesionales",              tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "otros_gastos_centro",     nombre: "Otros Gastos del Centro",               tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "inversiones_no_operativas", nombre: "Inversiones / Gastos no Operativos", tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "inversores",              nombre: "Inversores",                            tipo: "gasto",      cuenta_pasivo: "proveedores" },

  // ── GASTOS DE PERSONAL ──
  { id: "sueldos",                 nombre: "Sueldos",                               tipo: "gasto",      cuenta_pasivo: "sueldos"     },
  { id: "costos_salariales",       nombre: "Costos Salariales",                     tipo: "gasto",      cuenta_pasivo: "sueldos"     },
  { id: "obra_social",             nombre: "Obra Social",                           tipo: "gasto",      cuenta_pasivo: "sueldos"     },
  { id: "autonomos",               nombre: "Autónomos",                             tipo: "gasto",      cuenta_pasivo: "sueldos"     },
  { id: "capacitaciones",          nombre: "Capacitaciones",                        tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "reunion_equipo",          nombre: "Reunión de Equipo",                     tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "viaticos",                nombre: "Viáticos",                              tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "representacion",          nombre: "Representación",                        tipo: "gasto",      cuenta_pasivo: "proveedores" },

  // ── GASTOS DE HQ / TECNOLOGÍA ──
  { id: "licencias_software",      nombre: "Licencias de Software y Sistemas",      tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "servidores",              nombre: "Servidores y Alojamiento Web",           tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "otros_servicios_sistemas",nombre: "Otros Servicios de Sistemas",            tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "version_dos",             nombre: "Version Dos",                            tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "consultoria",             nombre: "Consultoría y Asesoramiento Estratégico",tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "material_oficina",        nombre: "Material de Oficina y Suministros",      tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "registro_marca",          nombre: "Registro de Marca y Prop. Intelectual",  tipo: "gasto",      cuenta_pasivo: "proveedores" },
  { id: "otros_gastos_generales",  nombre: "Otros Gastos Generales",                 tipo: "gasto",      cuenta_pasivo: "proveedores" },

  // ── MARKETING ──
  { id: "acciones_mkt",            nombre: "Acciones de Marketing",                  tipo: "gasto",      cuenta_pasivo: "proveedores" },

  // ── GASTOS FINANCIEROS / IMPOSITIVOS ──
  { id: "gastos_bancarios",        nombre: "Gastos Bancarios",                       tipo: "financiero", cuenta_pasivo: "financiero"  },
  { id: "perdidas_financieras",    nombre: "Pérdidas Financieras",                   tipo: "financiero", cuenta_pasivo: "financiero"  },
  { id: "aranceles_financieros",   nombre: "Aranceles y Otros Financieros",          tipo: "financiero", cuenta_pasivo: "financiero"  },
  { id: "iva_compra",              nombre: "IVA Compra",                             tipo: "financiero", cuenta_pasivo: "impuestos"   },
  { id: "iva_gasto",               nombre: "IVA (gasto)",                            tipo: "financiero", cuenta_pasivo: "impuestos"   },
  { id: "iibb",                    nombre: "IIBB",                                   tipo: "financiero", cuenta_pasivo: "impuestos"   },
  { id: "ganancias",               nombre: "Ganancias",                              tipo: "financiero", cuenta_pasivo: "impuestos"   },
  { id: "imp_cred_deb",            nombre: "Imp. Créditos y Débitos",                tipo: "financiero", cuenta_pasivo: "impuestos"   },
  { id: "plan_facilidades",        nombre: "Plan Facilidades AFIP",                  tipo: "financiero", cuenta_pasivo: "impuestos"   },
  { id: "otros_egresos",           nombre: "Otros Egresos",                          tipo: "gasto",      cuenta_pasivo: "proveedores" },

  // ── INGRESOS ──
  { id: "fee_gestion",             nombre: "Fee de Gestión y Adm.",                  tipo: "ingreso",    cuenta_pasivo: null },
  { id: "fee_gestion_huergo",      nombre: "Fee de Gestión y Adm. (Huergo)",         tipo: "ingreso",    cuenta_pasivo: null },
  { id: "ingresos_a",              nombre: "Ingresos A",                             tipo: "ingreso",    cuenta_pasivo: null },
  { id: "ingresos_b",              nombre: "Ingresos B",                             tipo: "ingreso",    cuenta_pasivo: null },
  { id: "corporativos_gympass",    nombre: "Corporativos (Gympass)",                 tipo: "ingreso",    cuenta_pasivo: null },
  { id: "app_gympass",             nombre: "APP (Gympass)",                          tipo: "ingreso",    cuenta_pasivo: null },
  { id: "regalias",                nombre: "Regalías s/ Ventas",                     tipo: "ingreso",    cuenta_pasivo: null },
  { id: "sponsor",                 nombre: "Sponsor",                                tipo: "ingreso",    cuenta_pasivo: null },
  { id: "otros_ingresos",          nombre: "Otros Ingresos",                         tipo: "ingreso",    cuenta_pasivo: null },
  { id: "ingreso_pesos",           nombre: "Ingreso Pesos",                          tipo: "ingreso",    cuenta_pasivo: null },
  { id: "intereses_ganados",       nombre: "Intereses Ganados",                      tipo: "financiero", cuenta_pasivo: null },
  { id: "acciones_mkt_ing",        nombre: "Acciones de Marketing (ingreso)",        tipo: "ingreso",    cuenta_pasivo: null },
];

// ─────────────────────────────────────────────────────────────────────────────
// PROVEEDORES — seed (3 representativos para prueba)
// ─────────────────────────────────────────────────────────────────────────────
export const PROVEEDORES_SEED = [
  {
    id: "prov-utedyc",
    nombre: "UTEDYC",
    cuit: "30-53160227-3",
    condIVA: "Responsable Inscripto",
    email: "",
    telefono: "",
    banco: "",
    cbu: "",
    monedaDefault: "ARS",
    cuentaDefault: "obra_social",      // cuenta habitual
    ccDefault: "HQ - Recursos Humanos",
    activo: true,
    nota: "Sindicato — pago mensual Obra Social",
  },
  {
    id: "prov-holded",
    nombre: "HOLDED TECHNOLOGIES",
    cuit: "",
    condIVA: "No categorizado",
    email: "",
    telefono: "",
    banco: "",
    cbu: "",
    monedaDefault: "USD",
    cuentaDefault: "licencias_software",
    ccDefault: "HQ - Administracion",
    activo: true,
    nota: "Software de gestión",
  },
  {
    id: "prov-galicia",
    nombre: "Banco Galicia",
    cuit: "",
    condIVA: "Responsable Inscripto",
    email: "",
    telefono: "",
    banco: "Banco Galicia",
    cbu: "",
    monedaDefault: "ARS",
    cuentaDefault: "gastos_bancarios",
    ccDefault: "HQ - Administracion",
    activo: true,
    nota: "Comisiones y gastos bancarios",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTES — seed (3 representativos para prueba)
// ─────────────────────────────────────────────────────────────────────────────
export const CLIENTES_SEED = [
  {
    id: "cli-rosedal",
    nombre: "Rosedal",
    cuit: "",
    condIVA: "Responsable Inscripto",
    email: "",
    monedaDefault: "ARS",
    cuentaDefault: "fee_gestion",
    ccDefault: "10 - HQ",
    activo: true,
    nota: "Cliente recurrente — Fee de gestión mensual",
  },
  {
    id: "cli-dlocal",
    nombre: "DLOCAL ARGENTINA SA",
    cuit: "30-71577872-2",
    condIVA: "Responsable Inscripto",
    email: "",
    monedaDefault: "ARS",
    cuentaDefault: "sponsor",
    ccDefault: "10 - HQ",
    activo: true,
    nota: "Sponsor",
  },
  {
    id: "cli-gympass-es",
    nombre: "Gympass España",
    cuit: "",
    condIVA: "No categorizado",
    email: "",
    monedaDefault: "USD",
    cuentaDefault: "corporativos_gympass",
    ccDefault: "10 - HQ",
    activo: true,
    nota: "Corporativos Gympass — facturación en USD",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PLAN DE CUENTAS — BALANCE
//
// Estas cuentas NO las elige el usuario directamente al imputar un gasto/ingreso.
// El sistema las asigna automáticamente según el tipo de operación:
//
//   Gasto pagado      → Débito: cuenta resultado  / Crédito: cuenta ACTIVO (banco)
//   Gasto pendiente   → Débito: cuenta resultado  / Crédito: cuenta PASIVO (según tipo)
//   Ingreso cobrado   → Débito: cuenta ACTIVO     / Crédito: cuenta resultado
//   Ingreso pendiente → Débito: cuenta ACTIVO     / Crédito: cuenta resultado
//
// El usuario solo ve "¿desde qué banco?" o "¿qué tipo de deuda?".
// ─────────────────────────────────────────────────────────────────────────────

// ── ACTIVO ──────────────────────────────────────────────────────────────────
// Las cuentas bancarias concretas se generan desde el ABM de Tesorería.
// Estas son las categorías de activo que usa el sistema internamente.
export const CUENTAS_ACTIVO = [
  {
    id: "bancos",
    nombre: "Caja y Bancos",
    descripcion: "Efectivo y saldos bancarios. Cada cuenta bancaria del ABM mapea aquí.",
    icono: "🏦",
  },
  {
    id: "ctas_cobrar",
    nombre: "Cuentas a Cobrar",
    descripcion: "Ingresos facturados pendientes de cobro (clientes).",
    icono: "📥",
  },
];

// ── PASIVO ───────────────────────────────────────────────────────────────────
// El usuario elige UNO de estos buckets cuando registra una deuda pendiente.
// Simple y claro — sin subdivisiones contables internas.
export const CUENTAS_PASIVO = [
  {
    id: "ctas_pagar_proveedores",
    nombre: "Proveedores",
    descripcion: "Facturas recibidas de proveedores pendientes de pago.",
    icono: "🧾",
    color: "var(--red)",
  },
  {
    id: "ctas_pagar_sueldos",
    nombre: "Sueldos",
    descripcion: "Remuneraciones devengadas pendientes de acreditación.",
    icono: "👥",
    color: "var(--orange)",
  },
  {
    id: "ctas_pagar_impuestos",
    nombre: "Impuestos",
    descripcion: "Obligaciones fiscales (IVA, IIBB, Ganancias, AFIP, etc.) pendientes.",
    icono: "🏛",
    color: "var(--purple)",
  },
  {
    id: "ctas_pagar_tarjetas",
    nombre: "Tarjetas de Crédito",
    descripcion: "Consumos realizados con tarjeta aún no debitados de la cuenta bancaria.",
    icono: "💳",
    color: "var(--blue)",
  },
  {
    id: "ctas_pagar_prestamos",
    nombre: "Préstamos",
    descripcion: "Deudas financieras con bancos u otras entidades.",
    icono: "🏦",
    color: "var(--gold)",
  },
];

// ── PATRIMONIO ───────────────────────────────────────────────────────────────
// Calculado — nunca se imputa manualmente.
export const CUENTAS_PATRIMONIO = [
  {
    id: "resultado_ejercicio",
    nombre: "Resultado del Ejercicio",
    descripcion: "Suma de ingresos menos gastos del período. Calculado automáticamente.",
    icono: "📊",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// LÓGICA DE CONTRAPARTIDA AUTOMÁTICA
//
// Dado un tipo de operación, el sistema resuelve qué cuenta de balance usar.
// El usuario nunca ve esto — es la "fontanería" contable interna.
// ─────────────────────────────────────────────────────────────────────────────

// Tipos de operación y su mapeo automático de contrapartida
export const TIPOS_OPERACION = [
  {
    id: "gasto_pago_inmediato",
    label: "Pago de gasto",
    descripcion: "Registrar un gasto que ya se pagó desde una cuenta bancaria.",
    ladoResultado: "debe",        // Débito en la cuenta de gasto
    contrapartida: "bancos",      // Crédito en Caja y Bancos
    requiereBanco: true,
    requierePasivo: false,
    icono: "↓",
    color: "var(--red)",
  },
  {
    id: "gasto_pendiente",
    label: "Gasto pendiente de pago",
    descripcion: "Registrar una deuda (factura recibida no pagada todavía).",
    ladoResultado: "debe",
    contrapartida: "pasivo",      // Crédito en la cuenta de pasivo elegida
    requiereBanco: false,
    requierePasivo: true,         // Usuario elige: Proveedores / Sueldos / Impuestos / etc.
    icono: "⏳",
    color: "var(--orange)",
  },
  {
    id: "pago_deuda",
    label: "Pago de deuda existente",
    descripcion: "Cancelar total o parcialmente una deuda ya registrada.",
    ladoResultado: null,          // No toca resultado — es balance contra balance
    contrapartida: "bancos",
    requiereBanco: true,
    requierePasivo: false,
    icono: "✓",
    color: "var(--green)",
  },
  {
    id: "ingreso_cobrado",
    label: "Ingreso cobrado",
    descripcion: "Registrar un ingreso que ya entró a la cuenta bancaria.",
    ladoResultado: "haber",       // Crédito en la cuenta de ingreso
    contrapartida: "bancos",      // Débito en Caja y Bancos
    requiereBanco: true,
    requierePasivo: false,
    icono: "↑",
    color: "var(--green)",
  },
  {
    id: "ingreso_pendiente",
    label: "Ingreso pendiente de cobro",
    descripcion: "Registrar una factura emitida no cobrada todavía.",
    ladoResultado: "haber",
    contrapartida: "ctas_cobrar", // Débito en Cuentas a Cobrar
    requiereBanco: false,
    requierePasivo: false,
    icono: "📥",
    color: "var(--blue)",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function getCuentasByTipo(tipo) {
  return CUENTAS.filter(c => c.tipo === tipo);
}

export function getTipoOperacion(id) {
  return TIPOS_OPERACION.find(t => t.id === id) ?? null;
}

// ─── Utilidades de fecha / número compartidas por modales ────────────────────
export const IVA_OPTS = [
  { value: 0,    label: "0%"    },
  { value: 10.5, label: "10.5%" },
  { value: 21,   label: "21%"   },
  { value: 27,   label: "27%"   },
];

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const addDays = (iso, n) => {
  const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10);
};

export const fmtNum = n => Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });
