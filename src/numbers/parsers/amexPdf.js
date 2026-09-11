// Parser del resumen de American Express Argentina (Corporate) → líneas de consumo.
// Reusa extractLines (genérico, de planPdf.js). Validado contra 2 resúmenes reales de 09/2026.
//
// Amex NO es Galicia y la diferencia manda en el diseño:
//   · UN PDF POR TITULAR (Galicia trae todos los titulares en un resumen con cortes
//     "Total Consumos de X"). Acá cada tarjeta es su propio archivo → el caller sube varios
//     y los mergea (ver mergeAmex).
//   · Las fechas de consumo NO traen año ("04 de Agosto") → se infiere del ciclo (ver anioDe).
//   · Cada consumo ocupa 3 renglones: importe / rubro / "Referencia…". Solo el primero trae
//     fecha, así que el resto cae solo al filtrar por FECHA.
//   · La moneda NO se adivina del texto: el resumen viene partido en secciones
//     "Nuevos Cargos en PESOS/DOLARES para <titular>", cada una con su propio subtotal.
//     Bastante más confiable que la heurística por token USD/EUR que necesita Galicia.
//
// Control de integridad: la cabecera trae `Saldo Anterior − Créditos + Débitos = Saldo a pagar`,
// y se cumple que `Total de Cargos` + `Total de transacciones financieras` = `Débitos`. O sea que
// el PDF se verifica contra sí mismo: `controles` compara los DÉBITOS de la cabecera contra lo
// parseado, en las dos monedas. Si el lector se comió un renglón, no cuadra y el caller avisa.
//
// OJO con `totalAPagar`: se devuelve SIEMPRE null a propósito. El "Saldo a pagar" de Amex incluye
// el saldo anterior impago (estas cuentas vienen con mora), así que cuadrar contra él —como hace
// el parser de Galicia— metería un ajuste fantasma por todo el arrastre y duplicaría los consumos
// del mes anterior. Lo que este resumen explica son los DÉBITOS del período; el saldo anterior es
// deuda vieja que ya debería vivir en la cuenta-tarjeta. Se devuelve aparte (`saldoAnterior`) para
// que el caller pueda avisarlo, no para imputarlo.
// La extracción del texto la hace el caller (parsers/resumenTarjeta.js), que la necesita antes para
// saber de qué emisor es el PDF → este módulo es puro y se puede testear sin pdfjs.

const arNum = s => { const n = parseFloat(String(s).replace(/\./g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Importe es-AR: miles con punto (1.234,56) o corrida de dígitos (1234,56). Exige coma decimal,
// lo que deja afuera el importe en moneda de origen, que Amex escribe con punto ("311.58 EURO").
const AMT = /-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}/g;
const amountsOf = ln => (ln.match(AMT) || []).map(arNum);

// Fecha de consumo: "04 de Agosto". Exige 2 dígitos — así no pica el "8 de Septiembre2026" de la
// leyenda de cabecera (que además cae fuera de toda sección).
const FECHA = /^(\d{2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+)/;
const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const mesNum = s => MESES[String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")] || 0;

// El consumo no trae año: si su mes es POSTERIOR al del cierre, es del año anterior (compra de
// diciembre que cae en el resumen de enero). Si no, el mismo año del cierre.
const anioDe = (mes, cierreISO) => {
  const cy = Number(cierreISO.slice(0, 4)), cm = Number(cierreISO.slice(5, 7));
  if (!cy || !cm || !mes) return cy || new Date().getFullYear();
  return mes > cm ? cy - 1 : cy;
};

const pad2 = n => String(n).padStart(2, "0");
const ddmmaaISO = s => { const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{2})/); return m ? `20${m[3]}-${m[2]}-${m[1]}` : ""; };

// Cabecera: "<TITULAR> <NNNN-NNNNNN-NNNNN> <facturación> <vencimiento>" en una sola fila.
const CUENTA_FECHAS = /^(.+?)\s+(\d{4}-\d{6}-\d{5})\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{2}\/\d{2}\/\d{2})/;

// Fila de saldos. El layout dibuja las 4 celdas con íconos al lado, y pdfjs a veces manda el "Saldo
// a pagar" a una fila propia (mismo Y del ícono, no del texto) → unas veces vienen 4 importes en la
// fila y otras 3. Se toman SIEMPRE los 3 primeros (anterior · créditos · débitos) y el saldo a
// pagar se CALCULA, así el orden de la 4ta celda deja de importar.
function saldosTras(lines, idxLabel) {
  if (idxLabel < 0) return null;
  for (let i = idxLabel + 1; i < Math.min(idxLabel + 8, lines.length); i++) {
    const a = amountsOf(lines[i]);
    if (a.length >= 3) return { anterior: a[0], creditos: a[1], debitos: a[2], aPagar: round2(a[0] - a[1] + a[2]) };
  }
  return null;
}

/** Parsea las líneas ya extraídas de un resumen Amex. Pura (sin pdfjs) → testeable en node. */
export function parseAmexLines(lines) {
  // ── Cabecera ──────────────────────────────────────────────────────────────
  let titularHdr = "", cuenta = "", fechaCierre = "", vto = "";
  for (const ln of lines) {
    const m = ln.match(CUENTA_FECHAS);
    if (!m) continue;
    titularHdr = m[1].trim(); cuenta = m[2]; fechaCierre = ddmmaaISO(m[3]); vto = ddmmaaISO(m[4]);
    break;
  }
  const nroResumen = (lines.join(" ").match(/\b(\d{4}-\d{7})\b/) || [])[1] || "";
  const periodo = fechaCierre ? fechaCierre.slice(0, 7) : "";

  const ars = saldosTras(lines, lines.findIndex(l => /^Saldo Anterior\s*\$/i.test(l.trim())));
  const usd = saldosTras(lines, lines.findIndex(l => /^Saldo Anterior\s*U\$S/i.test(l.trim())));

  // ── Detalle ───────────────────────────────────────────────────────────────
  const out = [];
  let moneda = null;        // sección activa: "ARS" | "USD" | null (fuera del detalle)
  let titular = titularHdr;
  const totPdf = { ARS: 0, USD: 0 };   // subtotales declarados por el PDF (cargos + financieras)

  for (const raw of lines) {
    const ln = raw.trim();

    // Después del detalle viene la letra chica (tasas, CFT, límites), que trae importes sueltos.
    if (/INFORMACI[ÓO]N SOBRE INTERESES|Pr[óo]xima fecha de facturaci[óo]n/i.test(ln)) break;

    let m;
    if ((m = ln.match(/^Nuevos Cargos en (PESOS|DOLARES) para\s+(.+)$/i))) {
      moneda = /pesos/i.test(m[1]) ? "ARS" : "USD";
      titular = m[2].trim();
      continue;
    }
    // Cierra los cargos del grupo. Lo que siga (hasta el total de financieras) son intereses e IVA
    // del mismo titular y la misma moneda → la sección sigue abierta a propósito.
    if ((m = ln.match(/^Total de Cargos en (PESOS|DOLARES) para\s+(.+?)\s+-?[\d.]*\d,\d{2}\s*$/i))) {
      const mon = /pesos/i.test(m[1]) ? "ARS" : "USD";
      const a = amountsOf(ln);
      if (a.length) totPdf[mon] = round2(totPdf[mon] + a[a.length - 1]);
      continue;
    }
    if (/^Total de transacciones financieras/i.test(ln)) {
      const a = amountsOf(ln);
      if (a.length && moneda) totPdf[moneda] = round2(totPdf[moneda] + a[a.length - 1]);
      continue;
    }
    if (!moneda) continue;

    const f = ln.match(FECHA);
    if (!f) continue;                       // rubro, "Referencia…", pies de página, leyendas
    const mes = mesNum(f[2]);
    if (!mes) continue;
    const a = amountsOf(ln);
    if (!a.length) continue;
    const monto = a[a.length - 1];          // el último importe es el facturado (su columna)
    if (!monto) continue;

    const comercio = ln.replace(FECHA, "").trim()
      .split(AMT)[0]                                                   // cortar antes del 1er importe
      .replace(/\s*[\d.,]+\s+(?:US\s*DOLLA\w*|USD|EUROS?)\b.*$/i, "")  // "6.99 US DOLLAR" / "311.58 EURO"
      .replace(/\b\d{5,}\b/g, "")                                      // refs largas del comercio
      .replace(/\s+/g, " ").trim();

    out.push({
      fecha: `${anioDe(mes, fechaCierre)}-${pad2(mes)}-${f[1]}`,
      comercio: comercio.slice(0, 60), monto, moneda, titular,
    });
  }

  // ── Control: DÉBITOS de la cabecera vs. lo parseado ───────────────────────
  // Se usan los débitos (y no los subtotales de sección) porque cubren cargos + financieras de una,
  // y son el mismo número que el resumen usa para llegar al saldo a pagar.
  const sum = mon => round2(out.reduce((s, l) => s + (l.moneda === mon ? l.monto : 0), 0));
  const controles = [{
    titular: titularHdr || titular,
    pdfARS: ars?.debitos ?? totPdf.ARS, pdfUSD: usd?.debitos ?? totPdf.USD,
    parsedARS: sum("ARS"), parsedUSD: sum("USD"),
  }];

  return {
    lineas: out,
    header: { nroResumen, fechaCierre, vto, periodo, titular: titularHdr, cuenta },
    controles,
    totalAPagar: null,                                        // a propósito — ver cabecera del archivo
    saldoAnterior: { ars: ars?.anterior ?? 0, usd: usd?.anterior ?? 0 },
    debitos:       { ars: ars?.debitos  ?? 0, usd: usd?.debitos  ?? 0 },
    aPagar:        { ars: ars?.aPagar   ?? 0, usd: usd?.aPagar   ?? 0 },
  };
}

/** ¿Estas líneas son un resumen de Amex? (para elegir parser cuando el usuario sube un PDF) */
export function esResumenAmex(lines) {
  return /American Express/i.test(lines.slice(0, 40).join(" "));
}

/**
 * Mergea N resúmenes (uno por titular) en el shape que consume Mundo Tarjeta.
 * Los totales se suman; el período/cierre sale del primero que lo traiga — si alguno es de otro
 * ciclo se avisa en `ciclosDistintos` (subir por error el resumen del mes pasado es fácil).
 */
export function mergeAmex(resultados) {
  const rs = resultados.filter(Boolean);
  if (!rs.length) return null;
  const acc = (sel) => rs.reduce((o, r) => ({ ars: round2(o.ars + (r[sel]?.ars || 0)), usd: round2(o.usd + (r[sel]?.usd || 0)) }), { ars: 0, usd: 0 });
  const base = rs.find(r => r.header?.fechaCierre) || rs[0];
  return {
    lineas:     rs.flatMap(r => r.lineas),
    header:     base.header,
    controles:  rs.flatMap(r => r.controles),
    totalAPagar: null,
    saldoAnterior: acc("saldoAnterior"),
    debitos:       acc("debitos"),
    aPagar:        acc("aPagar"),
    ciclosDistintos: [...new Set(rs.map(r => r.header?.fechaCierre).filter(Boolean))].length > 1,
  };
}
