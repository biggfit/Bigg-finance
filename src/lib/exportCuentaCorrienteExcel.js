// Excel de la cuenta corriente de franquiciados de UNA sociedad, para el estudio contable.
//
// Es el hermano de "Pagos y cobros en detalle" de Numbers (reportes/exportPagosCobros.js), con una diferencia
// de fondo: en Franquicias una factura NO se cancela con un pago puntual. Cada franquiciado tiene un SALDO
// VIVO —todo lo facturado menos todo lo cobrado— y los cobros bajan ese saldo, no una factura en particular.
// Por eso acá no hay columna "factura aplicada": en su lugar va el saldo del franquiciado después de cada
// movimiento, como en un mayor de clientes.
//
// Dos hojas:
//   · "Cuenta corriente" — una fila por comprobante o movimiento, agrupada por franquiciado y moneda, con su
//     saldo de apertura arriba y el saldo acumulado en la última columna.
//   · "Saldos"           — una fila por franquiciado y moneda: apertura + debe − haber = saldo final.
//
// Los saldos salen de los MISMOS helpers que la pestaña Movimientos (computeSaldoPrevMes, SKIP_CC_TYPES,
// compEmpresa, compCurrency). Este archivo no define ninguna regla de saldo propia: si el Excel y la pantalla
// dieran distinto, el error está acá.
import { COMP_TYPES, CUENTA_LABEL, SKIP_CC_TYPES, compEmpresa, compCurrency, computeSaldoPrevMes, MONTHS } from "./helpers";
import { cmpDate, inPeriod } from "../data/franchisor";

const FMT_MONEY = "#,##0.00;(#,##0.00)";
const FMT_DATE  = "dd/mm/yyyy";
const solid = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin  = { style: "thin", color: { argb: "FFE2E8F0" } };
const r2    = n => Math.round((Number(n) || 0) * 100) / 100;

// "DD/MM/YYYY" → Date a medianoche UTC. UTC y no local por lo mismo que en exportPagosCobros: ExcelJS guarda
// el instante, y una medianoche local en UTC+2 cae en el día anterior.
function dmyADate(dmy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(dmy || ""));
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : null;
}
const ultimoDia = (y, m) => new Date(Date.UTC(y, m + 1, 0));
const fmtDmy = d => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

// Tipo legible, en el vocabulario del estudio (no el de la pantalla, que dice "Pago Recibido").
function tipoDe(type) {
  const t = String(type || "");
  if (t.startsWith("FACTURA|"))     return "Factura";
  if (t.startsWith("NC|"))          return "Nota de crédito";
  if (t.startsWith("FC_RECIBIDA|")) return "Factura recibida";
  if (t === "PAGO")                 return "Cobro";
  if (t === "PAGO_PAUTA")           return "Cobro a cuenta (pauta)";
  if (t === "PAGO_ENVIADO")         return "Pago enviado";
  return COMP_TYPES[t]?.label ?? t;
}
const cuentaDe = type => { const k = String(type || "").split("|")[1]; return k ? (CUENTA_LABEL[k] ?? k) : ""; };

/**
 * Arma las filas de las dos hojas. Respeta los filtros de pantalla que cambian QUÉ se mira (período o
 * historial completo, moneda, franquicias elegidas en el buscador) y no los filtros por columna de la tabla:
 * filtrar por cuenta dejaría un saldo acumulado que ya no es el del franquiciado.
 *
 * @param franchises  franquicias a incluir (las del buscador; todas si no hay selección)
 * @param comps       { frId: [comp] } — ya enriquecido con nb_movimientos (el mismo `comps` del store)
 * @param monedas     monedas a abrir (una si la pantalla filtra, todas las de la sociedad si no)
 * @param resolver    { cuentaBancaria(comp), concepto(comp), codEstudio(fr) } — datos que viven en Numbers
 */
export function armarCuentaCorriente({ franchises, comps, saldoInicial, empresa, monedas, month, year, showAll, resolver = {} }) {
  // Con una sola moneda se replica exactamente la llamada de la pantalla (frCurrency null). Con varias hay que
  // pasar la moneda de la franquicia: un saldo inicial legado (número sin moneda) se contaría en todas.
  const variasMonedas = monedas.length > 1;
  const aperturaFecha = showAll ? new Date(Date.UTC(2025, 11, 31)) : ultimoDia(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1);
  const cierreFecha   = showAll ? null : ultimoDia(year, month);

  const movimientos = [], saldos = [];
  const frOrden = [...franchises].sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));

  for (const fr of frOrden) {
    const key   = String(fr.id);
    const frCur = variasMonedas ? (fr.currencies?.[0] || fr.currency || null) : null;
    for (const moneda of monedas) {
      const docs = (comps[key] ?? []).filter(c =>
        !SKIP_CC_TYPES.has(c.type) && compEmpresa(c) === empresa && compCurrency(c) === moneda &&
        (showAll || inPeriod(c, month, year)));
      const apertura = showAll
        ? computeSaldoPrevMes(fr.id, 2025, 11, comps, saldoInicial, frCur, moneda, empresa)
        : computeSaldoPrevMes(fr.id, year, month, comps, saldoInicial, frCur, moneda, empresa);
      if (!docs.length && Math.abs(apertura) < 0.005) continue;

      const base = { franquicia: fr.name || "", razonSocial: fr.razonSocial || "", cuit: fr.cuit || "",
                     codEstudio: resolver.codEstudio?.(fr) ?? "", moneda };
      movimientos.push({ ...base, fecha: aperturaFecha, tipo: "Saldo inicial", cuenta: "",
        concepto: `Saldo al ${fmtDmy(aperturaFecha)}`, saldo: r2(apertura), apertura: true });

      let saldo = apertura, debe = 0, haber = 0;
      for (const c of [...docs].sort((a, b) => cmpDate(a.date, b.date))) {
        const sign = COMP_TYPES[c.type]?.sign ?? 0;
        const amt  = Math.abs(Number(c.amount) || 0);
        const d = sign === +1 ? amt : 0, h = sign === -1 ? amt : 0;
        saldo += d - h; debe += d; haber += h;
        const esDoc = String(c.type || "").includes("|");
        movimientos.push({
          ...base, fecha: dmyADate(c.date), tipo: tipoDe(c.type), cuenta: cuentaDe(c.type),
          concepto: resolver.concepto?.(c) || c.nota || c.ref || "",
          nroComp: c.invoice || "",
          // La cuenta bancaria solo existe para cobros y pagos: una factura no mueve plata.
          cuentaBancaria: esDoc ? "" : (resolver.cuentaBancaria?.(c) ?? ""),
          neto: esDoc && c.amountNeto != null ? r2(c.amountNeto) : "",
          iva:  esDoc && c.amountIVA  != null ? r2(c.amountIVA)  : "",
          debe: d ? r2(d) : "", haber: h ? r2(h) : "", saldo: r2(saldo),
        });
      }
      saldos.push({ ...base, apertura: r2(apertura), debe: r2(debe), haber: r2(haber), saldo: r2(saldo) });
    }
  }
  return { movimientos, saldos, aperturaFecha, cierreFecha };
}

const COLS_MOV = [
  { h: "Fecha",           w: 12, k: "fecha", fmt: FMT_DATE },
  { h: "Franquicia",      w: 26, k: "franquicia" },
  { h: "Razón social",    w: 30, k: "razonSocial" },
  { h: "CUIT / NIF",      w: 16, k: "cuit" },
  { h: "Cód. estudio",    w: 14, k: "codEstudio" },
  { h: "Tipo",            w: 20, k: "tipo" },
  { h: "Cuenta",          w: 12, k: "cuenta" },
  { h: "Concepto",        w: 38, k: "concepto" },
  { h: "N° comp",         w: 18, k: "nroComp" },
  { h: "Cuenta bancaria", w: 24, k: "cuentaBancaria" },
  { h: "Moneda",          w: 9,  k: "moneda" },
  { h: "Neto",            w: 14, k: "neto",  fmt: FMT_MONEY, num: true },
  { h: "IVA",             w: 13, k: "iva",   fmt: FMT_MONEY, num: true },
  // Debe = sube lo que el franquiciado nos debe (factura, pago que le enviamos).
  // Haber = lo baja (cobro, nota de crédito, factura que él nos hizo).
  { h: "Debe",            w: 15, k: "debe",  fmt: FMT_MONEY, num: true },
  { h: "Haber",           w: 15, k: "haber", fmt: FMT_MONEY, num: true },
  { h: "Saldo franquicia", w: 16, k: "saldo", fmt: FMT_MONEY, num: true },
];
const COLS_SAL = [
  { h: "Franquicia",       w: 26, k: "franquicia" },
  { h: "Razón social",     w: 30, k: "razonSocial" },
  { h: "CUIT / NIF",       w: 16, k: "cuit" },
  { h: "Cód. estudio",     w: 14, k: "codEstudio" },
  { h: "Moneda",           w: 9,  k: "moneda" },
  { h: "Saldo inicial",    w: 16, k: "apertura", fmt: FMT_MONEY, num: true },
  { h: "Debe",             w: 16, k: "debe",     fmt: FMT_MONEY, num: true },
  { h: "Haber",            w: 16, k: "haber",    fmt: FMT_MONEY, num: true },
  { h: "Saldo final",      w: 16, k: "saldo",    fmt: FMT_MONEY, num: true },
  { h: "Situación",        w: 14, k: "situacion" },
];

function encabezado(ws, cols, titulo, subtitulo, nota) {
  ws.addRow([titulo]); ws.mergeCells(1, 1, 1, cols.length);
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: "FF0F172A" } };
  for (const [txt, italic] of [[subtitulo, true], [nota, false]]) {
    const r = ws.addRow([txt]); ws.mergeCells(r.number, 1, r.number, cols.length);
    ws.getCell(r.number, 1).font = { italic, size: 10, color: { argb: "FF64748B" } };
  }
  ws.addRow([]);
  const head = ws.addRow(cols.map(c => c.h));
  head.eachCell((cell, i) => {
    cell.fill = solid("FF0E7490");
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: cols[i - 1].num ? "right" : "left", vertical: "middle" };
  });
  head.height = 20;
  ws.views = [{ state: "frozen", ySplit: head.number }];
  ws.autoFilter = { from: { row: head.number, column: 1 }, to: { row: head.number, column: cols.length } };
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w; });
}

function fila(ws, cols, datos, estilo = {}) {
  const row = ws.addRow(cols.map(c => datos[c.k] ?? ""));
  row.eachCell({ includeEmpty: true }, (cell, i) => {
    const c = cols[i - 1];
    cell.border = { bottom: thin };
    cell.alignment = { horizontal: c.num ? "right" : "left" };
    if (c.fmt) cell.numFmt = c.fmt;
    if (estilo.fill) cell.fill = solid(estilo.fill);
    if (estilo.font) cell.font = estilo.font;
  });
}

/**
 * @param data     lo que devuelve armarCuentaCorriente
 * @param empresa  razón social de la sociedad (título y nombre del archivo)
 */
export async function exportarCuentaCorrienteExcel({ data, empresa, month, year, showAll }) {
  const { default: ExcelJS } = await import("exceljs");   // dinámico: la app de Franquicias no lo carga si nadie baja
  const { movimientos, saldos, aperturaFecha, cierreFecha } = data;

  const periodo = showAll ? `Historial completo desde ${fmtDmy(aperturaFecha)}` : `${MONTHS[month]} ${year}`;
  const nota = "Las facturas no se cancelan una a una: el saldo de cada franquiciado es todo lo facturado menos todo lo cobrado. "
             + "Saldo positivo = el franquiciado nos debe; negativo = le debemos.";

  const wb = new ExcelJS.Workbook();
  wb.creator = "BIGG Franquicias";

  // ── Hoja 1: cuenta corriente
  const ws = wb.addWorksheet("Cuenta corriente");
  const nMov = movimientos.filter(m => !m.apertura).length;
  encabezado(ws, COLS_MOV, `Cuenta corriente de franquiciados — ${empresa}`,
    `${periodo} · ${nMov} movimiento${nMov === 1 ? "" : "s"} · ${saldos.length} cuenta${saldos.length === 1 ? "" : "s"}`, nota);
  for (const m of movimientos) {
    fila(ws, COLS_MOV, m, m.apertura ? { fill: "FFF1F5F9", font: { italic: true, color: { argb: "FF475569" } } } : {});
  }

  // ── Hoja 2: saldos por franquiciado, con total por moneda al pie
  const ws2 = wb.addWorksheet("Saldos");
  encabezado(ws2, COLS_SAL, `Saldos de franquiciados — ${empresa}`,
    `${periodo}${cierreFecha ? ` · saldo final al ${fmtDmy(cierreFecha)}` : ""}`, nota);
  for (const s of saldos) {
    const situacion = s.saldo > 0.005 ? "Nos debe" : s.saldo < -0.005 ? "Le debemos" : "Saldada";
    fila(ws2, COLS_SAL, { ...s, situacion });
  }
  const porMoneda = {};
  for (const s of saldos) {
    const t = (porMoneda[s.moneda] ??= { apertura: 0, debe: 0, haber: 0, saldo: 0, deben: 0, debemos: 0 });
    t.apertura += s.apertura; t.debe += s.debe; t.haber += s.haber; t.saldo += s.saldo;
    if (s.saldo > 0) t.deben += s.saldo; else t.debemos += -s.saldo;
  }
  if (Object.keys(porMoneda).length) ws2.addRow([]);
  for (const [moneda, t] of Object.entries(porMoneda)) {
    fila(ws2, COLS_SAL, { franquicia: `Total ${moneda}`, moneda, apertura: r2(t.apertura), debe: r2(t.debe),
      haber: r2(t.haber), saldo: r2(t.saldo),
      situacion: "" }, { fill: "FFE2E8F0", font: { bold: true } });
    // El neto esconde que hay deudores Y acreedores: se muestran separados, como en Tesorería.
    fila(ws2, COLS_SAL, { franquicia: `  Nos deben`, moneda, saldo: r2(t.deben) }, { font: { color: { argb: "FF475569" } } });
    fila(ws2, COLS_SAL, { franquicia: `  Les debemos`, moneda, saldo: r2(-t.debemos) }, { font: { color: { argb: "FF475569" } } });
  }

  const buf  = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  const slug = String(empresa).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  a.href = url;
  a.download = `Cuenta_corriente_franquicias_${slug}_${showAll ? "historial" : `${year}-${String(month + 1).padStart(2, "0")}`}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
