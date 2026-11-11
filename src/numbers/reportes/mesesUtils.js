// Helpers de meses compartidos por los reportes que trabajan con cierres mensuales (Balance, Del resultado al
// patrimonio, Valuación, provisión de la cesión). Módulo aparte, sin componentes: balanceUtils.jsx exporta componentes
// y cada función que se le suma es un error de react-refresh.

// Fin del mes `m` (0-based) del año, como corte comparable contra fechas ISO: "YYYY-MM-31". Es un tope, no una fecha de
// calendario (sirve igual para un mes de 30 días); m = −1 → "YYYY-00-31" = todo lo anterior al año.
export const finDeMes = (year, m) => `${year}-${String(m + 1).padStart(2, "0")}-31`;

// Último mes CERRADO del año (0-based): 11 si el año ya pasó, −1 si todavía no empezó, el anterior al mes en curso si no.
export const ultimoMesCerrado = (year, hoy = new Date()) => year < hoy.getFullYear() ? 11 : year > hoy.getFullYear() ? -1 : hoy.getMonth() - 1;
