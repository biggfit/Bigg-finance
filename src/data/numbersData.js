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
