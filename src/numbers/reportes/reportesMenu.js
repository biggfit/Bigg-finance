// ─── Menú de Reportes: lista única de reportes (TABS) y su agrupación por lente (LENTES) ─────────────────
// Vive aparte de PantallaReportes para que BIGG Reportes (la app con sidebar) lea la MISMA lista sin exportar
// constantes desde un archivo de componentes (react-refresh). Los ids de TABS los usa toda PantallaReportes.

// ─── Tab config ───────────────────────────────────────────────────────────────
export const TABS = [
  // ── Funcionando ──
  { id: "pl_sede", label: "P&L · Sedes Argentina",  icon: "🏬", ico: "store", desc: "Resultado operativo por sede: ventas, costos variables y márgenes." },
  { id: "pl_bigg", label: "P&L · BIGG (grupo)",   icon: "🏢", ico: "building", retirar: true, desc: "Resultado corporativo por centro de HQ (R&D, Sales & Mkt, G&A). A retirar: lo reemplaza P&L · del grupo (Martín 5/11/2026)." },
  { id: "pl_grupo", label: "P&L · del grupo", icon: "🏢", ico: "building", desc: "Para el comité: contribución de cada negocio al 100%, estructura, resultado y lo que queda para BIGG después de los socios." },
  { id: "cf",      label: "Cash Flow",  icon: "💵", ico: "flow", desc: "Por qué la caja subió o bajó cada mes, en pocas líneas: la operación, inversiones y fondeo, financiación y cambio de moneda, de la caja al inicio a la caja al cierre." },
  { id: "interco", label: "Saldos entre sociedades",   icon: "🔗", ico: "link", desc: "Préstamos y saldos interco entre TODAS las sociedades: posición neta por moneda (quién le debe a quién). Filtrá por sociedad y hacé click en una fila para ver el detalle de movimientos." },
  { id: "interco_matriz", label: "Fondeo por negocio", icon: "🧮", ico: "grid", desc: "Fondeo del grupo a cada negocio (CAPEX), consolidado en USD · meses × negocio/tipo. Click en una celda = los movimientos que la componen. Ata al Fondeo del P&L." },
  { id: "consolidado", label: "Tesorería consolidada", icon: "🏦", ico: "bank", desc: "Cuánta plata hay hoy y dónde: saldos de cajas y bancos, cuentas a cobrar/pagar y movimientos de todas las sociedades." },
  { id: "balance_pn",  label: "Balance", icon: "⚖️", ico: "scale", desc: "Qué tiene y qué debe cada sociedad (o el grupo en USD) al cierre de cada mes: la evolución mensual, o un mes contra el anterior." },
  { id: "patrimonio_ctrl", label: "Del resultado al patrimonio", icon: "🧭", ico: "puzzle", desc: "Control de cierre: por qué cambió el patrimonio cada mes. Si \"Sin explicar\" da cero, el resultado, la caja y el balance dicen lo mismo; si no, hay un dato por corregir antes de cerrar el mes." },
  { id: "posicion_fin", label: "Posición financiera", icon: "🎯", ico: "target", desc: "El número del board: disponible − deuda financiera = posición financiera neta; + a cobrar − a pagar = posición neta (ata con el PN). Al último cierre, consolidado en USD y por sociedad." },
  { id: "cxp_prov", label: "Cuentas por pagar", icon: "📋", ico: "invoice", desc: "Cuentas por pagar consolidadas por proveedor (todas las sociedades), con antigüedad." },
  { id: "cxc_cli", label: "Cuentas por cobrar", icon: "📥", ico: "receipt", desc: "Cuentas por cobrar consolidadas por cliente (todas las sociedades), con antigüedad." },
  { id: "socios",  label: "Participaciones", icon: "◎", ico: "people", desc: "Quién es socio de cada negocio, qué puso y qué le debemos: socios, cesiones y cuenta corriente (balance, no P&L)." },
  { id: "valuacion", label: "Valuación", icon: "📐", ico: "pie", desc: "Cuánto vale el grupo con una regla fija, mes a mes: cada sede y negocio por su resultado promedio, España y Colombia por lo que pusimos. Para ver si sube o baja, no como valor de mercado." },

  // ── Detalle operativo (funcionando): el único lugar donde se ve la contabilidad de TODAS las sociedades ──
  { id: "inf_egresos",  label: "Egresos en detalle",  icon: "🔎", ico: "out", desc: "Listar y filtrar compras por cuenta · centro · proveedor · moneda · período." },
  { id: "inf_ingresos", label: "Ingresos en detalle", icon: "🔎", ico: "in", desc: "Listar y filtrar ventas/ingresos por cuenta · centro · cliente · moneda · período." },
  { id: "inf_pagos",    label: "Pagos y cobros en detalle", icon: "🏧", ico: "flow", desc: "Todo lo que pasó por cada caja o banco, con la factura que cancela al lado. Filtrable por cuenta bancaria y cuenta contable; el Excel suma CUIT, código del estudio y saldo del extracto para que la contadora pueda imputar." },

  { id: "er_soc",       label: "Estado de Resultados por sociedad", icon: "📄", ico: "doc", wip: true, desc: "P&L de la entidad legal seleccionada (por sociedad)." },

  { id: "op_espana",    label: "P&L · Sedes España", icon: "🇪🇸", ico: "store", desc: "Igual que Sedes propias AR + impuestos debajo del Resultado Operativo (sociedad Fondeada)." },
  { id: "op_colombia",  label: "P&L · Sedes Colombia", icon: "🇨🇴", ico: "store", desc: "Igual que Sedes propias AR + impuestos debajo del Resultado Operativo (sociedad Fondeada)." },
  { id: "op_puertos",   label: "P&L · Puertos", icon: "⚓", ico: "anchor", wip: true, desc: "Igual que Sedes propias AR + impuestos debajo del Resultado Operativo (sociedad Fondeada, inversión USD)." },
  { id: "op_rosedal",   label: "P&L · Rosedal (Segui Fit)", icon: "🤝", ico: "handshake", desc: "P&L completo de la operación administrada hasta Free Cash Flow, con impuestos dentro; a BIGG entra el fee + su % del FCF." },
  { id: "op_huergo",    label: "P&L · Huergo", icon: "🏗️", ico: "building", desc: "Negocio propio (anillo 1): ingreso del edificio − horas de coaches = margen a seguir de cerca." },

  { id: "consol_grupo", label: "Consolidado de grupo", icon: "🌐", ico: "globe", wip: true, desc: "P&L y patrimonio del grupo: propias full (neto de IVA) + fee/share de administradas + impuestos del anillo al final." },

  { id: "an_ventas",    label: "Composición de ingresos", icon: "📈", ico: "pie", desc: "Igual que el P&L BIGG hasta Total Ingresos: cada negocio (Sedes AR con apertura por sede / Rosedal / Huergo) y las líneas de HQ." },
  { id: "an_margenes",  label: "Márgenes por negocio", icon: "🧩", ico: "puzzle", wip: true, desc: "Cuánto aporta cada negocio al Margen Bruto del grupo." },
  { id: "an_gastos_cc", label: "Gastos por centro de costo", icon: "🧾", ico: "tag", wip: true, desc: "Apertura del gasto por centro de costo y, dentro, por cuenta contable." },

  { id: "devengado",    label: "Resultado devengado por cuenta", icon: "🧪", ico: "flask", desc: "Diagnóstico: devengado crudo por cuenta y mes, filtrable por sociedad/anillo · centro · moneda. Sin fondeo ni traducción de moneda → el Resultado ata contra la variación del PN del balance." },
];

// ─── Menú de Reportes: por lo que uno viene a HACER (operar → resultados → plata entre sociedades → control) ──
// Decisión Martín 19/9/2026: Egresos/Ingresos en detalle + Cuentas a pagar/cobrar son el ÚNICO lugar donde se opera la
// contabilidad de TODAS las sociedades → van primero y en grande (hero). Resultados, plata entre sociedades y control
// como listas de una línea con su descripción. Lo que está en construcción va al FINAL de su grupo, en gris, nunca
// primero. Los ids de TABS no cambian (los usa todo el resto de la pantalla).
export const LENTES = [
  { id: "operar",     label: "Operar el día a día",      hint: "La contabilidad de todas las sociedades, en un solo lugar", hero: true,
    // Orden FIJO en 3 columnas × 2 filas (Martín 19/9): Egresos / Cuentas a pagar / Tesorería arriba; Ingresos / Cuentas a cobrar / Cash Flow abajo.
    // Debajo del hero, como filas: Posición financiera (Martín 24/9) y Pagos y cobros (Martín 25/9, para el
    // estudio contable de España). El hero no se toca.
    tabs: ["inf_egresos", "cxp_prov", "consolidado", "inf_ingresos", "cxc_cli", "cf", "posicion_fin", "inf_pagos"] },
  { id: "resultados", label: "¿Cómo nos fue?",            hint: "Resultados del grupo y de cada negocio",
    tabs: ["pl_grupo", "pl_bigg", "pl_sede", "op_espana", "op_colombia", "op_rosedal", "op_huergo", "an_ventas", "op_puertos", "an_margenes", "consol_grupo"] },
  { id: "plata",      label: "La plata entre sociedades", hint: "Quién le debe a quién y qué fondeó el grupo",
    tabs: ["interco", "interco_matriz", "socios"] },
  { id: "control",    label: "Control y cierre",          hint: "Para atar el resultado contra el patrimonio",
    // Trilogía de cierre: Balance/EEPN (afuera de Tesorería desde 19/9, pedido Martín) + devengado que ata contra el PN.
    tabs: ["balance_pn", "patrimonio_ctrl", "valuacion", "devengado", "an_gastos_cc", "er_soc"] },
];
