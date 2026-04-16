// ─── Datos de muestra para BIGG Numbers (desarrollo) ─────────────────────────
// REGLA: cada registro SIEMPRE tiene campo `sociedad` — nunca se mezclan

export const EGRESOS_SAMPLE = [
  { id:"EG-001", sociedad:"nako",    fecha:"03/04/2026", vto:"03/04/2026", proveedor:"UTEDYC",               cuit:"30-53160227-3", cuenta:"Obra Social",                cc:"HQ - Recursos Humanos",   moneda:"ARS", importe:485000,  estado:"pagado",  pasivo:null,                     banco:"Banco Galicia ARS" },
  { id:"EG-002", sociedad:"nako",    fecha:"01/04/2026", vto:"10/04/2026", proveedor:"HOLDED TECHNOLOGIES",  cuit:"",             cuenta:"Licencias de Software",        cc:"HQ - Administracion",    moneda:"USD", importe:312,     estado:"a_pagar", pasivo:"ctas_pagar_proveedores", banco:null },
  { id:"EG-003", sociedad:"nako",    fecha:"01/04/2026", vto:"05/04/2026", proveedor:"Banco Galicia",        cuit:"",             cuenta:"Gastos Bancarios",             cc:"HQ - Administracion",    moneda:"ARS", importe:33200,   estado:"vencido", pasivo:"ctas_pagar_proveedores", banco:null },
  { id:"EG-004", sociedad:"nako",    fecha:"01/04/2026", vto:"30/04/2026", proveedor:"Propietario Recoleta", cuit:"",             cuenta:"Alquiler",                     cc:"01 - Recoleta",          moneda:"ARS", importe:2100000, estado:"a_pagar", pasivo:"ctas_pagar_proveedores", banco:null },
  { id:"EG-005", sociedad:"nako",    fecha:"31/03/2026", vto:"31/03/2026", proveedor:"AFIP",                 cuit:"33-69345023-9",cuenta:"IIBB",                         cc:"HQ - Impuestos",         moneda:"ARS", importe:198400,  estado:"pagado",  pasivo:null,                     banco:"Banco Galicia ARS" },
  { id:"EG-006", sociedad:"nako",    fecha:"28/03/2026", vto:"10/04/2026", proveedor:"NEW RELIC",            cuit:"",             cuenta:"Servidores y Alojamiento Web",  cc:"HQ - Infraestructura IT",moneda:"USD", importe:890,     estado:"a_pagar", pasivo:"ctas_pagar_proveedores", banco:null },
  { id:"EG-007", sociedad:"nako",    fecha:"31/03/2026", vto:"31/03/2026", proveedor:"AFIP",                 cuit:"33-69345023-9",cuenta:"Sueldos",                      cc:"HQ - Administracion",    moneda:"ARS", importe:3800000, estado:"pagado",  pasivo:null,                     banco:"Banco Galicia ARS" },
  { id:"EG-008", sociedad:"nako",    fecha:"10/04/2026", vto:"10/04/2026", proveedor:"AMEX",                 cuit:"",             cuenta:"Gastos Bancarios",             cc:"HQ - Gerencia General",  moneda:"ARS", importe:520000,  estado:"a_pagar", pasivo:"ctas_pagar_tarjetas",    banco:null },
  // ── Hektor SRL ──
  { id:"EG-009", sociedad:"hektor",  fecha:"01/04/2026", vto:"30/04/2026", proveedor:"Propietario Barrio Norte", cuit:"",        cuenta:"Alquiler",                     cc:"03 - Barrio Norte",      moneda:"ARS", importe:1850000, estado:"a_pagar", pasivo:"ctas_pagar_proveedores", banco:null },
  { id:"EG-010", sociedad:"hektor",  fecha:"31/03/2026", vto:"31/03/2026", proveedor:"AFIP",                 cuit:"33-69345023-9",cuenta:"IIBB",                         cc:"HQ - Impuestos",         moneda:"ARS", importe:92000,   estado:"pagado",  pasivo:null,                     banco:"Galicia ARS" },
  // ── Bigg Fit LLC ──
  { id:"EG-011", sociedad:"biggfit", fecha:"01/04/2026", vto:"01/05/2026", proveedor:"AWS",                  cuit:"",             cuenta:"Servidores y Alojamiento Web",  cc:"HQ - Infraestructura IT",moneda:"USD", importe:420,     estado:"a_pagar", pasivo:"ctas_pagar_proveedores", banco:null },
  { id:"EG-012", sociedad:"biggfit", fecha:"05/04/2026", vto:"05/04/2026", proveedor:"Stripe",               cuit:"",             cuenta:"Gastos Bancarios",             cc:"HQ - Administracion",    moneda:"USD", importe:310,     estado:"pagado",  pasivo:null,                     banco:"InterAudi USD" },
];

export const INGRESOS_SAMPLE = [
  { id:"IN-001", sociedad:"nako",    fecha:"01/04/2026", vto:"10/04/2026", cliente:"Rosedal",              cuit:"",              cuenta:"Fee de Gestión y Adm.",   cc:"10 - HQ",        moneda:"ARS", importe:4804671, estado:"cobrado",  banco:"Banco Galicia ARS" },
  { id:"IN-002", sociedad:"nako",    fecha:"02/04/2026", vto:"02/04/2026", cliente:"DLOCAL ARGENTINA SA",  cuit:"30-71577872-2", cuenta:"Sponsor",                 cc:"10 - HQ",        moneda:"ARS", importe:500000,  estado:"cobrado",  banco:"Banco Galicia ARS" },
  { id:"IN-003", sociedad:"nako",    fecha:"03/04/2026", vto:"15/04/2026", cliente:"Franquicias ÑAKO",     cuit:"",              cuenta:"Ingresos A",              cc:"01 - Recoleta",  moneda:"ARS", importe:1200000, estado:"a_cobrar", banco:null },
  // ── Bigg Fit LLC ──
  { id:"IN-004", sociedad:"biggfit", fecha:"01/04/2026", vto:"10/04/2026", cliente:"Gympass España",       cuit:"",              cuenta:"Corporativos (Gympass)",  cc:"10 - HQ",        moneda:"USD", importe:485.78,  estado:"a_cobrar", banco:null },
  { id:"IN-005", sociedad:"biggfit", fecha:"01/04/2026", vto:"10/04/2026", cliente:"Gympass Chile",        cuit:"",              cuenta:"Corporativos (Gympass)",  cc:"10 - HQ",        moneda:"USD", importe:2111.53, estado:"cobrado",  banco:"InterAudi USD" },
  { id:"IN-006", sociedad:"biggfit", fecha:"31/03/2026", vto:"01/04/2026", cliente:"USD - Pase Libre",     cuit:"",              cuenta:"APP (Gympass)",           cc:"10 - HQ",        moneda:"USD", importe:796,     estado:"vencido",  banco:null },
  // ── Hektor SRL ──
  { id:"IN-007", sociedad:"hektor",  fecha:"01/04/2026", vto:"10/04/2026", cliente:"Franquicias Hektor",   cuit:"",              cuenta:"Fee de Gestión y Adm.",   cc:"10 - HQ",        moneda:"ARS", importe:2100000, estado:"a_cobrar", banco:null },
];
