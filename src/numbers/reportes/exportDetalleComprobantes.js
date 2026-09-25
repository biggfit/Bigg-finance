// Exportación a Excel del detalle de Egresos / Ingresos (ExcelJS). Baja EXACTAMENTE las filas que quedaron
// después de los filtros de pantalla, más columnas que en la tabla no entran pero se necesitan para trabajar
// afuera: N° de comprobante, id interno del comprobante, código del estudio contable y fecha fiscal.
//
// Dos aperturas, porque son dos lecturas distintas del mismo dato:
//  · "ceco"    (management) — una fila por LÍNEA, con su centro de costo y su cuenta. Es lo que se ve en pantalla.
//  · "factura" (fiscal)     — una fila por COMPROBANTE, sin apertura de centro ni cuenta: al estudio le importa
//                             la factura, no cómo la repartimos por dentro.
//
// El llamador resuelve los campos derivados (nombres de sociedad/centro, tipo, cód. de estudio) porque los mapas
// viven en la pantalla; acá solo se serializa.
import ExcelJS from "exceljs";

const FMT_MONEY = "#,##0.00;(#,##0.00)";
const FMT_DATE  = "dd/mm/yyyy";

const solid = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin  = { style: "thin", color: { argb: "FFE2E8F0" } };

const CFG = {
  EGRESO:  { titulo: "Egresos (detalle)",  headerBg: "FFDC2626", archivo: "Egresos" },
  INGRESO: { titulo: "Ingresos (detalle)", headerBg: "FF16A34A", archivo: "Ingresos" },
};
const MODOS = {
  ceco:    { sufijo: "por centro de costo", archivo: "por_centro" },
  factura: { sufijo: "por factura",         archivo: "por_factura" },
};

// "YYYY-MM-DD" → Date a medianoche UTC. Tiene que ser UTC y no local: ExcelJS serializa el INSTANTE, así que
// una medianoche local se guarda corrida por el huso y el serial cae en el día anterior (verificado en una
// máquina en UTC+2: 17/09 salía 16/09 22:00). Con Date.UTC el serial es entero y el día es el correcto en
// cualquier zona horaria.
function isoADate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

// `iva_rate` NO se normaliza al leer: `fetchLineasEnriquecidas` solo pasa por toNum a total/subtotal/
// iva_monto, así que la alícuota puede llegar como el texto "10,5" desde Sheets. Sin esto, una misma tasa
// se partiría en dos columnas distintas ("10,5" y 10,5).
function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Cuentas que NO van al Excel del estudio contable (modo factura).
//   · Sueldos          — las nóminas; la contadora las lleva por su lado.
//   · Costos Salariales — la TGSS. OJO: en Wellness NO existe una cuenta llamada "Cargas Sociales";
//     la seguridad social se carga acá, y eso no se adivina leyendo el nombre.
//   · IVA               — los pagos a Hacienda España. "Hacienda España no es un gasto", dijo la contadora,
//     y tiene razón: liquidar el IVA cancela un pasivo, no devenga un costo.
// Las nóminas y la TGSS se cargan como compra a propósito (para diferir el pago del devengamiento y poder
// repartirlas entre varios centros), así que esto es un filtro del REPORTE, no un cambio en cómo se carga:
// las tres siguen enteras en el P&L, en Tesorería y en el modo por centro de costo.
const CUENTAS_FUERA_DEL_ESTUDIO = new Set(["Sueldos", "Costos Salariales", "IVA"]);

// Una fila por comprobante: suma las líneas que pasaron el filtro (no el total original del comprobante — si
// filtraste por centro, lo que baja es lo que estás mirando). Las filas que NO son comprobantes (sueldos,
// financiaciones, histórico) no tienen id_comp: quedan una por registro, porque no hay factura que agrupar y
// descartarlas escondería gasto real.
function agruparPorFactura(rows) {
  const m = new Map();
  rows.forEach((r, i) => {
    const k = r.id_comp ? `C:${r.id_comp}` : `X:${r.id ?? i}`;
    if (!m.has(k)) m.set(k, { ...r, _total: 0, _subtotal: null, _iva: null, _porTasa: {} });
    const acc = m.get(k);
    acc._total += Math.abs(Number(r.total) || 0);
    // Subtotal e IVA se acumulan solo si la línea los trae: así una factura queda con su neto y su IVA, y un
    // sueldo (que no tiene ni uno ni otro) queda en null → celda vacía, no un 0 que se leería como "IVA cero".
    if (r.subtotal   != null && r.subtotal   !== "") acc._subtotal = (acc._subtotal || 0) + Math.abs(Number(r.subtotal) || 0);
    if (r.iva_monto  != null && r.iva_monto  !== "") acc._iva      = (acc._iva      || 0) + Math.abs(Number(r.iva_monto) || 0);
    // Base y cuota POR ALÍCUOTA: una factura puede llevar varios tipos de IVA (la alícuota es de la LÍNEA,
    // no del encabezado) y la contadora necesita verlos abiertos. Solo para las líneas que traen base.
    if (r.subtotal != null && r.subtotal !== "") {
      const t = toNum(r.iva_rate);
      const e = (acc._porTasa[t] ??= { base: 0, cuota: 0 });
      e.base  += Math.abs(Number(r.subtotal) || 0);
      e.cuota += Math.abs(Number(r.iva_monto) || 0);
    }
  });
  return [...m.values()];
}

// Una factura con dos tipos de IVA ocupa DOS renglones, uno por alícuota — como en un libro de IVA. Se
// prefirió esto a un pivot con columnas Base/Cuota por tasa: el pivot gastaba siete columnas casi siempre
// vacías para resolver un caso (1 factura de 116 en España lleva dos tipos).
// `Total` es el de CADA renglón (base + cuota), no el de la factura: así la columna suma bien. El N° de
// comprobante se repite en los dos renglones, que es lo que permite reagruparlos.
// Redondeo a 2 decimales. Todo lo que sale de sumar importes lo necesita: el punto flotante deja colas
// (60.980000000000004, 135313.67157024794) y el formato de celda las esconde, pero el valor guardado sigue
// siendo ese y cualquier fórmula que arme el estudio lo ve.
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

function abrirPorTasa(datos) {
  const out = [];
  let orden = 0;
  for (const d of datos) {
    orden++;
    const tasas = Object.keys(d._porTasa || {});
    // Sin base declarada (sueldos, financiaciones): un renglón, sin apertura de IVA.
    if (!tasas.length) { out.push({ ...d, _orden: orden, _tasa: "", _base: "", _cuota: "", _primera: true }); continue; }
    tasas.sort((a, b) => toNum(b) - toNum(a)).forEach((t, i) => {
      const e = d._porTasa[t];
      // N° de orden, total de la factura y retención van SOLO en el primer renglón — es la convención de la
      // plantilla del estudio: así la columna de totales suma el importe real de las facturas y no el doble.
      // Redondeo a 2: son sumas de líneas y el punto flotante deja colas (60.980000000000004). El formato de
      // celda las escondería, pero el valor guardado seguiría siendo ese y las fórmulas del estudio lo verían.
      out.push({ ...d, _orden: i === 0 ? orden : "", _primera: i === 0,
        _tasa: toNum(t), _base: r2(e.base), _cuota: r2(e.cuota), _total: r2(d._total) });
    });
  }
  return out;
}

// Totales al pie, como en la plantilla del estudio: un renglón por tipo de IVA (para cuadrar el libro contra
// cada alícuota) y el total general de facturas.
function totalesPorTasa(filas) {
  const m = new Map();
  for (const f of filas) {
    if (f._tasa === "") continue;
    const e = m.get(f._tasa) ?? { base: 0, cuota: 0 };
    e.base  += Number(f._base)  || 0;
    e.cuota += Number(f._cuota) || 0;
    m.set(f._tasa, e);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

// Valor de una columna de plata: en el modo factura ya viene sumado (`kAgg`); en el modo por centro se lee de
// la línea. Vacío —no 0— cuando el dato no existe.
function montoCol(r, kAgg, kRaw) {
  if (kAgg in r) return r[kAgg] == null ? "" : r[kAgg];
  const v = r[kRaw];
  return (v == null || v === "") ? "" : Math.abs(Number(v) || 0);
}

function columnas(modo, contraLabel, campo) {
  // ── Modo factura: es el archivo que recibe el estudio contable, así que sigue el orden y el vocabulario de
  //    SU plantilla de "Facturas Recibidas" (Expedidor, N.I.F., Base Imponible, Cuota, Retención, Total Fra.).
  //    No es un clon: sus columnas internas (N.Referencia) no las podemos llenar, y al final van las nuestras,
  //    que le sirven para imputar y a nosotros para rastrear el documento.
  if (modo === "factura") return [
    // N° de orden correlativo por FACTURA (vacío en el segundo renglón de una con dos tipos de IVA).
    { h: "NºOrden",        w: 9,  get: r => r._orden === "" ? "" : r._orden, num: true },
    // Nuestro id de comprobante ocupa la columna "N.Referencia" de su plantilla: es la referencia con la que
    // cualquiera de los dos vuelve al documento si hay que discutir una línea.
    { h: "N.Referencia",   w: 22, get: r => r.id_comp || "" },
    { h: "Núm.Fact.",      w: 18, get: r => r.nro_comp || "" },
    // La FISCAL, no la de emisión: es la que rige el período de IVA, que es lo que el estudio liquida.
    { h: "Fecha",          w: 12, get: r => isoADate(r.fecha_fiscal || r.fecha), fmt: FMT_DATE },
    { h: "Concepto",       w: 38, get: r => r.nota || r.cuenta_contable || "" },
    { h: "N.I.F.",         w: 16, get: r => campo.cuit?.(r) ?? "" },
    { h: "Expedidor",      w: 34, get: r => r.contraparte_nombre || "" },
    { h: "Base Imponible", w: 15, get: r => r._base  === "" ? "" : r._base,  fmt: FMT_MONEY, num: true },
    { h: "%IVA",           w: 8,  get: r => r._tasa  === "" ? "" : r._tasa,  num: true },
    { h: "Cuota",          w: 14, get: r => r._cuota === "" ? "" : r._cuota, fmt: FMT_MONEY, num: true },
    // Retención (IRPF): sale de la retención practicada sobre la factura (nb_movimientos, origen
    // "retencion_practicada"), que el llamador resuelve por documento_id. Hoy no hay ninguna cargada en
    // España → sale vacía; se llena sola a medida que se registren.
    { h: "Retención",      w: 13, get: r => r._primera ? (campo.irpfMonto?.(r) ?? "") : "", fmt: FMT_MONEY, num: true },
    // Total de la FACTURA, solo en su primer renglón: así la columna suma el importe real de las facturas y
    // no cuenta dos veces las que llevan dos tipos de IVA. Es la convención de la plantilla del estudio.
    { h: "Total Fra.",     w: 16, get: r => r._primera ? (r._total ?? Math.abs(Number(r.total) || 0)) : "", fmt: FMT_MONEY, num: true },

    // ── Dos columnas nuestras, después de las suyas: las dos son para el estudio, no para nosotros ──
    // El "tipo de gasto" que pidió la contadora. Es la cuenta del ENCABEZADO (una sola por factura).
    { h: "Cuenta contable", w: 28, get: r => r.cuenta_contable || "" },
    // Su propio código de cuenta de proveedor, que vive en nuestro maestro: les deja imputar directo.
    { h: "Cód. estudio",    w: 14, get: r => campo.codEstudio?.(r) ?? "" },
  ];

  const cols = [
    { h: "Fecha",        w: 12, get: r => isoADate(r.fecha),                     fmt: FMT_DATE },
    { h: "Fecha fiscal", w: 12, get: r => isoADate(r.fecha_fiscal || r.fecha),   fmt: FMT_DATE },
    { h: "Tipo",         w: 16, get: r => campo.tipo?.(r) ?? "" },
    { h: "Sociedad",     w: 20, get: r => campo.sociedad?.(r) ?? "" },
    { h: contraLabel,    w: 34, get: r => r.contraparte_nombre || "" },
    // Identificación fiscal y código del estudio: los dos salen del maestro de proveedores/clientes (el
    // comprobante no los guarda), y van pegados al nombre porque identifican a la misma contraparte.
    { h: "CUIT / NIF",   w: 16, get: r => campo.cuit?.(r) ?? "" },
    { h: "Cód. estudio", w: 16, get: r => campo.codEstudio?.(r) ?? "" },
    { h: "N° comp",      w: 18, get: r => r.nro_comp || "" },
    // Id interno del comprobante: permite volver al documento en el sistema y, en el modo por centro, armar
    // un dinámico por factura. Es la clave con la que agrupa el modo "factura". Vacío en las filas que no son
    // comprobantes (sueldos, financiaciones, histórico).
    { h: "ID comp",      w: 22, get: r => r.id_comp || "" },
  ];
  if (modo === "ceco") cols.push(
    { h: "Cuenta",    w: 28, get: r => r.cuenta_contable || "" },
    // Nuestro código de cuenta, al lado del nombre y enfrentado al del estudio (`Cód. estudio`): con los dos
    // en la misma fila se puede mapear nuestro plan contra el de ellos. Conviven dos formatos de id
    // (`CUENTA_<nombre>` viejo y `CTA-…` nuevo) y algunas filas no lo traen.
    { h: "ID cuenta", w: 22, get: r => r.cuenta_contable_id || "" },
    { h: "Centro",    w: 24, get: r => campo.centro?.(r) ?? "" },
  );
  cols.push(
    { h: "Moneda", w: 10, get: r => r.moneda || "ARS" },
    // Los tres en positivo, igual que en pantalla (el reporte ya dice si son egresos o ingresos). En el dato,
    // subtotal + IVA = total en 1.006 de 1.014 comprobantes; los que no, difieren por centavos de redondeo.
    { h: "Subtotal", w: 15, get: r => montoCol(r, "_subtotal", "subtotal"),  fmt: FMT_MONEY, num: true },
    { h: "IVA",      w: 13, get: r => montoCol(r, "_iva",      "iva_monto"), fmt: FMT_MONEY, num: true },
    { h: "Total",    w: 16, get: r => r._total ?? Math.abs(Number(r.total) || 0), fmt: FMT_MONEY, num: true },
  );
  return cols;
}

/**
 * @param tipo     "EGRESO" | "INGRESO"
 * @param modo     "ceco" (una fila por línea, con centro y cuenta) | "factura" (una fila por comprobante)
 * @param rows     filas YA filtradas y ordenadas (las de pantalla)
 * @param campo    resolvers: { tipo, sociedad, centro, codEstudio } — cada uno (row) => string
 * @param totales  { [moneda]: importe } de pantalla; no cambia entre modos (agrupar solo junta líneas)
 */
export async function exportarDetalleExcel({ tipo = "EGRESO", modo = "ceco", rows = [], campo = {}, totales = {}, contraLabel = "Contraparte", rango = {} }) {
  const cfg  = CFG[tipo] || CFG.EGRESO;
  const mcfg = MODOS[modo] || MODOS.ceco;

  // El modo factura es el que va al estudio contable → se le sacan las cuentas que la contadora no quiere.
  // El modo ceco (management) baja todo.
  const fuera = modo === "factura" ? rows.filter(r => CUENTAS_FUERA_DEL_ESTUDIO.has(String(r.cuenta_contable || ""))) : [];
  const dentro = fuera.length ? rows.filter(r => !CUENTAS_FUERA_DEL_ESTUDIO.has(String(r.cuenta_contable || ""))) : rows;

  const comps = modo === "factura" ? agruparPorFactura(dentro) : dentro;
  const datos = modo === "factura" ? abrirPorTasa(comps) : comps;
  const COLS = columnas(modo, contraLabel, campo);

  // Lo excluido se DECLARA en el archivo (abajo, en el subtítulo): nada se descarta en silencio.
  const excl = fuera.length ? {
    comps: new Set(fuera.map(r => r.id_comp || r.id)).size,
    total: fuera.reduce((s, r) => s + Math.abs(Number(r.total) || 0), 0),
    cuentas: [...new Set(fuera.map(r => String(r.cuenta_contable || "")))].sort(),
  } : null;

  const wb = new ExcelJS.Workbook();
  wb.creator = "BIGG Numbers";
  const ws = wb.addWorksheet(tipo === "INGRESO" ? "Ingresos" : "Egresos");

  // El archivo del estudio se llama como su libro ("Facturas Recibidas"), no como nuestro reporte: es el
  // documento que ellos archivan, así que lleva su nombre.
  const titulo = modo === "factura"
    ? (tipo === "INGRESO" ? "Facturas Emitidas" : "Facturas Recibidas")
    : `${cfg.titulo} · ${mcfg.sufijo}`;
  ws.addRow([titulo]); ws.mergeCells(1, 1, 1, COLS.length);
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: "FF0F172A" } };

  const periodo = rango.desde || rango.hasta
    ? `${rango.desde ? rango.desde.split("-").reverse().join("/") : "inicio"} → ${rango.hasta ? rango.hasta.split("-").reverse().join("/") : "hoy"}`
    : "todo el período";
  const unidad = modo === "factura" ? "comprobante" : "registro";
  const fmt2 = v => v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Los totales vienen de pantalla (sin filtrar), así que en el modo factura se recalculan sobre lo que
  // realmente baja — si no, el encabezado diría un número que las filas no suman.
  // Se suma sobre COMPS, no sobre los renglones: una factura con dos tipos de IVA ocupa dos filas y las dos
  // arrastran el total del comprobante — sumar los renglones la contaría dos veces.
  const totVis = excl
    ? comps.reduce((a, r) => { const k = r.moneda || "ARS"; a[k] = (a[k] || 0) + (r._total ?? Math.abs(Number(r.total) || 0)); return a; }, {})
    : totales;
  const totTxt = Object.entries(totVis).sort((a, b) => b[1] - a[1])
    .map(([mo, v]) => `${mo} ${fmt2(v)}`).join(" · ");
  const exclTxt = excl
    ? ` — excluidos ${excl.comps} ${excl.comps === 1 ? "comprobante" : "comprobantes"} (${fmt2(excl.total)}): ${excl.cuentas.join(", ")}`
    : "";
  // Se cuentan COMPROBANTES, no renglones: en el modo factura una con dos tipos de IVA ocupa dos filas y
  // decir "117 comprobantes" sería mentir. Si difieren, se aclara.
  const nComp = modo === "factura" ? comps.length : datos.length;
  const filasTxt = datos.length !== nComp ? ` en ${datos.length} renglones (los que llevan dos tipos de IVA ocupan uno por tipo)` : "";
  // Cabecera del estudio: Empresa / Período / Fecha, como en su plantilla. La empresa sale de las sociedades
  // que quedaron en lo filtrado (normalmente una sola, porque el archivo se baja por sociedad).
  if (modo === "factura") {
    const empresas = [...new Set(datos.map(r => campo.sociedad?.(r) || r.sociedad || "").filter(Boolean))];
    const hoy = new Date();
    const dd = n => String(n).padStart(2, "0");
    for (const txt of [
      `Empresa: ${empresas.join(" · ") || "—"}`,
      `Período: ${periodo}`,
      `Fecha: ${dd(hoy.getDate())}/${dd(hoy.getMonth() + 1)}/${hoy.getFullYear()}`,
    ]) {
      const r = ws.addRow([txt]);
      ws.mergeCells(r.number, 1, r.number, COLS.length);
      ws.getCell(r.number, 1).font = { bold: true, size: 11, color: { argb: "FF0F172A" } };
    }
  }

  const rm = ws.addRow([`${periodo} · ${nComp} ${unidad}${nComp === 1 ? "" : "s"}${filasTxt}${totTxt ? ` · ${totTxt}` : ""}${exclTxt}`]);
  ws.mergeCells(rm.number, 1, rm.number, COLS.length);
  ws.getCell(rm.number, 1).font = { italic: true, size: 10, color: { argb: "FF64748B" } };
  ws.addRow([]);

  const head = ws.addRow(COLS.map(c => c.h));
  head.eachCell((cell, col) => {
    cell.fill = solid(cfg.headerBg);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: COLS[col - 1].num ? "right" : "left", vertical: "middle" };
    cell.border = { bottom: thin };
  });
  head.height = 20;
  ws.views = [{ state: "frozen", ySplit: head.number }];
  ws.autoFilter = { from: { row: head.number, column: 1 }, to: { row: head.number, column: COLS.length } };

  for (const r of datos) {
    const row = ws.addRow(COLS.map(c => c.get(r) ?? ""));
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const c = COLS[col - 1];
      cell.border = { bottom: thin };
      cell.alignment = { horizontal: c.num ? "right" : "left" };
      if (c.fmt) cell.numFmt = c.fmt;
    });
  }

  // ── Totales al pie (solo el archivo del estudio): un renglón por tipo de IVA + el total de facturas. Es
  //    como cierra su plantilla, y es lo que le permite cuadrar el libro alícuota por alícuota.
  if (modo === "factura") {
    const iBase = COLS.findIndex(c => c.h === "Base Imponible") + 1;
    const iTasa = COLS.findIndex(c => c.h === "%IVA") + 1;
    const iCuota = COLS.findIndex(c => c.h === "Cuota") + 1;
    const iRet = COLS.findIndex(c => c.h === "Retención") + 1;
    const iTot = COLS.findIndex(c => c.h === "Total Fra.") + 1;
    const porTasa = totalesPorTasa(datos);
    const iLbl = Math.max(1, iBase - 1);
    ws.addRow([]);
    const pintar = (row, negrita) => {
      for (const i of [iBase, iTasa, iCuota, iRet, iTot]) {
        const cell = row.getCell(i);
        cell.alignment = { horizontal: "right" };
        if (i !== iTasa) cell.numFmt = FMT_MONEY;
        if (negrita) cell.font = { bold: true };
      }
      row.getCell(iLbl).font = { bold: true };
      row.getCell(iLbl).alignment = { horizontal: "right" };
    };
    porTasa.forEach(([t, v], i) => {
      const row = ws.addRow([]);
      if (i === 0) row.getCell(iLbl).value = "Total Período";
      row.getCell(iBase).value = r2(v.base);
      row.getCell(iTasa).value = t;
      row.getCell(iCuota).value = r2(v.cuota);
      pintar(row, false);
    });
    const tot = datos.reduce((a, r) => ({
      base:  a.base  + (Number(r._base)  || 0),
      cuota: a.cuota + (Number(r._cuota) || 0),
      ret:   a.ret   + (r._primera ? (Number(campo.irpfMonto?.(r)) || 0) : 0),
      total: a.total + (r._primera ? (r._total ?? Math.abs(Number(r.total) || 0)) : 0),
    }), { base: 0, cuota: 0, ret: 0, total: 0 });
    const rowT = ws.addRow([]);
    rowT.getCell(iLbl).value = "Total Facturas";
    rowT.getCell(iBase).value = r2(tot.base);
    rowT.getCell(iCuota).value = r2(tot.cuota);
    rowT.getCell(iRet).value = r2(tot.ret);
    rowT.getCell(iTot).value = r2(tot.total);
    pintar(rowT, true);
  }

  COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${cfg.archivo}_${mcfg.archivo}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
