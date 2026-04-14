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
  { id: "10 - HQ",                    nombre: "HQ General",          grupo: "marca", activo: true },
  { id: "HQ - Administracion",        nombre: "Administración",      grupo: "marca", activo: true },
  { id: "HQ - BI",                    nombre: "BI & Analytics",      grupo: "marca", activo: true },
  { id: "HQ - Design",                nombre: "Design",              grupo: "marca", activo: true },
  { id: "HQ - Gerencia General",      nombre: "Gerencia General",    grupo: "marca", activo: true },
  { id: "HQ - Impuestos",             nombre: "Impuestos",           grupo: "marca", activo: true },
  { id: "HQ - Infraestructura IT",    nombre: "Infraestructura IT",  grupo: "marca", activo: true },
  { id: "HQ - Marketing",             nombre: "Marketing",           grupo: "marca", activo: true },
  { id: "HQ - Recursos Humanos",      nombre: "Recursos Humanos",    grupo: "marca", activo: true },
  { id: "HQ - Sport",                 nombre: "Sport",               grupo: "marca", activo: true },
  { id: "HQ - Tecnologia",            nombre: "Tecnología",          grupo: "marca", activo: true },
  { id: "HQ - Ventas y Operaciones",  nombre: "Ventas y Operaciones",grupo: "marca", activo: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// CUENTAS
// tipo: "gasto" | "ingreso" | "financiero"
// centrosCostoPermitidos: null = cualquier CC; array = solo esos
// ─────────────────────────────────────────────────────────────────────────────
export const CUENTAS = [

  // ── GASTOS OPERATIVOS DE SEDE ──
  {
    id: "alquiler", nombre: "Alquiler", tipo: "gasto",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","05 - Barrio Norte"],
  },
  {
    id: "expensas_abl", nombre: "Expensas y ABL", tipo: "gasto",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","05 - Barrio Norte"],
  },
  {
    id: "limpieza", nombre: "Limpieza", tipo: "gasto",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","05 - Barrio Norte"],
  },
  {
    id: "servicios", nombre: "Servicios", tipo: "gasto",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","05 - Barrio Norte","HQ - Administracion","HQ - Gerencia General"],
  },
  {
    id: "equipamiento_mantenimiento", nombre: "Equipamiento y Mantenimiento", tipo: "gasto",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","HQ - Gerencia General"],
  },
  {
    id: "interusos", nombre: "Interusos", tipo: "gasto",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","05 - Barrio Norte"],
  },
  {
    id: "comisiones", nombre: "Comisiones", tipo: "gasto",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","05 - Barrio Norte"],
  },
  {
    id: "comision_resultado", nombre: "Comisión s/ Resultado", tipo: "gasto",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","04 - Plaza Libertad","05 - Barrio Norte"],
  },
  {
    id: "honorarios", nombre: "Honorarios Profesionales", tipo: "gasto",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","05 - Barrio Norte","HQ - Administracion"],
  },
  {
    id: "otros_gastos_centro", nombre: "Otros Gastos del Centro", tipo: "gasto",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","05 - Barrio Norte","HQ - Administracion"],
  },
  {
    id: "inversiones_no_operativas", nombre: "Inversiones / Gastos no Operativos", tipo: "gasto",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad"],
  },
  {
    id: "inversores", nombre: "Inversores", tipo: "gasto",
    centrosCostoPermitidos: ["05 - Barrio Norte"],
  },

  // ── GASTOS DE PERSONAL ──
  {
    id: "sueldos", nombre: "Sueldos", tipo: "gasto",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","05 - Barrio Norte","11 - Wellness","12 - Tigre Loco","17 - Huergo","HQ - Administracion","HQ - BI","HQ - Design","HQ - Gerencia General","HQ - Marketing","HQ - Sport","HQ - Tecnologia","HQ - Ventas y Operaciones"],
  },
  {
    id: "costos_salariales", nombre: "Costos Salariales", tipo: "gasto",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","05 - Barrio Norte","12 - Tigre Loco","HQ - Administracion","HQ - BI","HQ - Design","HQ - Gerencia General","HQ - Marketing","HQ - Sport","HQ - Tecnologia","HQ - Ventas y Operaciones"],
  },
  {
    id: "obra_social", nombre: "Obra Social", tipo: "gasto",
    centrosCostoPermitidos: ["HQ - Marketing","HQ - Recursos Humanos","HQ - Sport","HQ - Ventas y Operaciones"],
  },
  {
    id: "autonomos", nombre: "Autónomos", tipo: "gasto",
    centrosCostoPermitidos: ["HQ - Gerencia General"],
  },
  {
    id: "capacitaciones", nombre: "Capacitaciones", tipo: "gasto",
    centrosCostoPermitidos: ["HQ - Sport"],
  },
  {
    id: "reunion_equipo", nombre: "Reunión de Equipo", tipo: "gasto",
    centrosCostoPermitidos: ["HQ - Recursos Humanos"],
  },
  {
    id: "viaticos", nombre: "Viáticos", tipo: "gasto",
    centrosCostoPermitidos: ["12 - Tigre Loco","HQ - Design","HQ - Gerencia General","HQ - Marketing","HQ - Ventas y Operaciones"],
  },
  {
    id: "representacion", nombre: "Representación", tipo: "gasto",
    centrosCostoPermitidos: ["11 - Wellness","12 - Tigre Loco","HQ - Gerencia General","HQ - Marketing","HQ - Ventas y Operaciones"],
  },

  // ── GASTOS DE HQ / TECNOLOGÍA ──
  {
    id: "licencias_software", nombre: "Licencias de Software y Sistemas", tipo: "gasto",
    centrosCostoPermitidos: ["11 - Wellness","HQ - Administracion","HQ - BI","HQ - Gerencia General","HQ - Infraestructura IT","HQ - Ventas y Operaciones"],
  },
  {
    id: "servidores", nombre: "Servidores y Alojamiento Web", tipo: "gasto",
    centrosCostoPermitidos: ["HQ - Infraestructura IT"],
  },
  {
    id: "otros_servicios_sistemas", nombre: "Otros Servicios de Sistemas", tipo: "gasto",
    centrosCostoPermitidos: ["HQ - Design"],
  },
  {
    id: "version_dos", nombre: "Version Dos", tipo: "gasto",
    centrosCostoPermitidos: ["HQ - Tecnologia"],
  },
  {
    id: "consultoria", nombre: "Consultoría y Asesoramiento Estratégico", tipo: "gasto",
    centrosCostoPermitidos: ["HQ - BI"],
  },
  {
    id: "material_oficina", nombre: "Material de Oficina y Suministros", tipo: "gasto",
    centrosCostoPermitidos: ["HQ - Administracion"],
  },
  {
    id: "registro_marca", nombre: "Registro de Marca y Prop. Intelectual", tipo: "gasto",
    centrosCostoPermitidos: ["HQ - Gerencia General"],
  },
  {
    id: "otros_gastos_generales", nombre: "Otros Gastos Generales", tipo: "gasto",
    centrosCostoPermitidos: ["HQ - Administracion","HQ - Gerencia General"],
  },

  // ── MARKETING ──
  {
    id: "acciones_mkt", nombre: "Acciones de Marketing", tipo: "gasto",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","05 - Barrio Norte","10 - HQ","11 - Wellness","12 - Tigre Loco","HQ - Marketing"],
  },

  // ── GASTOS FINANCIEROS / IMPOSITIVOS ──
  {
    id: "gastos_bancarios", nombre: "Gastos Bancarios", tipo: "financiero",
    centrosCostoPermitidos: ["HQ - Administracion"],
  },
  {
    id: "perdidas_financieras", nombre: "Pérdidas Financieras", tipo: "financiero",
    centrosCostoPermitidos: ["10 - HQ","HQ - Administracion"],
  },
  {
    id: "aranceles_financieros", nombre: "Aranceles y Otros Financieros", tipo: "financiero",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","05 - Barrio Norte","HQ - Administracion","HQ - Impuestos"],
  },
  {
    id: "iva_compra", nombre: "IVA Compra", tipo: "financiero",
    centrosCostoPermitidos: ["HQ - Impuestos"],
  },
  {
    id: "iva_gasto", nombre: "IVA (gasto)", tipo: "financiero",
    centrosCostoPermitidos: ["HQ - Impuestos"],
  },
  {
    id: "iibb", nombre: "IIBB", tipo: "financiero",
    centrosCostoPermitidos: ["HQ - Impuestos"],
  },
  {
    id: "ganancias", nombre: "Ganancias", tipo: "financiero",
    centrosCostoPermitidos: ["HQ - Impuestos"],
  },
  {
    id: "imp_cred_deb", nombre: "Imp. Créditos y Débitos", tipo: "financiero",
    centrosCostoPermitidos: ["HQ - Impuestos"],
  },
  {
    id: "plan_facilidades", nombre: "Plan Facilidades AFIP", tipo: "financiero",
    centrosCostoPermitidos: ["HQ - Impuestos"],
  },
  {
    id: "otros_egresos", nombre: "Otros Egresos", tipo: "gasto",
    centrosCostoPermitidos: ["10 - HQ","HQ - Sport"],
  },

  // ── INGRESOS ──
  {
    id: "fee_gestion", nombre: "Fee de Gestión y Adm.", tipo: "ingreso",
    centrosCostoPermitidos: ["10 - HQ"],
  },
  {
    id: "fee_gestion_huergo", nombre: "Fee de Gestión y Adm. (Huergo)", tipo: "ingreso",
    centrosCostoPermitidos: ["10 - HQ"],
  },
  {
    id: "ingresos_a", nombre: "Ingresos A", tipo: "ingreso",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","05 - Barrio Norte"],
  },
  {
    id: "ingresos_b", nombre: "Ingresos B", tipo: "ingreso",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","05 - Barrio Norte"],
  },
  {
    id: "corporativos_gympass", nombre: "Corporativos (Gympass)", tipo: "ingreso",
    centrosCostoPermitidos: ["01 - Recoleta","02 - Palermo Chico","03 - Belgrano","04 - Plaza Libertad","05 - Barrio Norte","10 - HQ"],
  },
  {
    id: "app_gympass", nombre: "APP (Gympass)", tipo: "ingreso",
    centrosCostoPermitidos: ["10 - HQ"],
  },
  {
    id: "regalias", nombre: "Regalías s/ Ventas", tipo: "ingreso",
    centrosCostoPermitidos: ["10 - HQ"],
  },
  {
    id: "sponsor", nombre: "Sponsor", tipo: "ingreso",
    centrosCostoPermitidos: ["10 - HQ"],
  },
  {
    id: "otros_ingresos", nombre: "Otros Ingresos", tipo: "ingreso",
    centrosCostoPermitidos: ["10 - HQ","HQ - Administracion"],
  },
  {
    id: "ingreso_pesos", nombre: "Ingreso Pesos", tipo: "ingreso",
    centrosCostoPermitidos: ["10 - HQ"],
  },
  {
    id: "intereses_ganados", nombre: "Intereses Ganados", tipo: "financiero",
    centrosCostoPermitidos: ["10 - HQ"],
  },
  {
    id: "acciones_mkt_ing", nombre: "Acciones de Marketing (ingreso)", tipo: "ingreso",
    centrosCostoPermitidos: ["10 - HQ"],
  },
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

// Obtener CCs permitidos para una cuenta de resultado
export function getCCsPermitidos(cuentaId) {
  const cuenta = CUENTAS.find(c => c.id === cuentaId);
  return cuenta?.centrosCostoPermitidos ?? null;
}

// Validar combinación cuenta + centro de costo
// Retorna: "ok" | "advertencia"
export function validarCuentaCC(cuentaId, ccId) {
  const permitidos = getCCsPermitidos(cuentaId);
  if (!permitidos) return "ok";
  return permitidos.includes(ccId) ? "ok" : "advertencia";
}

// Obtener cuentas de resultado filtradas por tipo
export function getCuentasByTipo(tipo) {
  return CUENTAS.filter(c => c.tipo === tipo);
}

// Obtener el tipo de operación por id
export function getTipoOperacion(id) {
  return TIPOS_OPERACION.find(t => t.id === id) ?? null;
}
