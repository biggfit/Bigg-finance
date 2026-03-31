/**
 * invoicePdf.jsx — Invoice / Factura PDF unificado
 * Layout basado en el estilo Revolut (clean, blanco/negro, minimal).
 *
 * - EUR  (Gestión Deportiva y Wellness SL / ES): columnas + resumen con IVA 21% y Retención opcional
 * - USD  (BIGG FIT LLC / USA)                  : misma estructura, IVA = $0.00
 *
 * Nota: fmtAmt usa locale de-DE para EUR ("1.234,56€") y en-US para USD ("$1,234.56"),
 *       diferente de fmt() en helpers.js que usa es-AR.
 */
import React from "react";
import { Document, Page, View, Text, Image, StyleSheet, pdf } from "@react-pdf/renderer";
import { MONTHS, CUENTA_LABEL } from "./helpers";

// ─── Paleta ────────────────────────────────────────────────────────────────────
const BLACK  = "#111111";
const DARK   = "#333333";
const GRAY   = "#777777";
const LGRAY  = "#f6f6f6";
const BORDER = "#dddddd";
const WHITE  = "#ffffff";

// ─── Estilos ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: BLACK,
    backgroundColor: WHITE,
    paddingTop: 38,
    paddingBottom: 50,
    paddingHorizontal: 50,
  },

  // ── Top row ──────────────────────────────────────────────────────────────────
  topRow:       { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  logoImg:      { width: 58, height: 58, objectFit: "contain" },
  logoWrap:     { width: 58, height: 58, borderRadius: 29, borderWidth: 1.5, borderStyle: "solid", borderColor: BLACK, alignItems: "center", justifyContent: "center" },
  logoInner:    { alignItems: "center" },
  logoTextBig:  { fontFamily: "Helvetica-Bold", fontSize: 12, color: BLACK, letterSpacing: 1 },
  logoTextSub:  { fontSize: 5, color: GRAY, letterSpacing: 0.5, marginTop: 1 },
  invoiceRef:   { alignItems: "flex-end" },
  invoiceNum:   { fontFamily: "Helvetica-Bold", fontSize: 15, color: BLACK },
  invoiceDate:  { fontSize: 9, color: GRAY, marginTop: 4 },

  // ── Issuer ───────────────────────────────────────────────────────────────────
  issuerName:   { fontFamily: "Helvetica-Bold", fontSize: 15, color: BLACK, marginBottom: 5 },
  issuerDetail: { fontSize: 8.5, color: DARK, lineHeight: 1.6 },

  // ── Separador ────────────────────────────────────────────────────────────────
  hr: { borderBottomWidth: 0.5, borderBottomColor: BORDER, borderBottomStyle: "solid", marginVertical: 14 },

  // ── Client box ───────────────────────────────────────────────────────────────
  clientBox:      { borderWidth: 0.75, borderStyle: "solid", borderColor: BORDER, padding: 12, marginBottom: 20, width: "52%" },
  clientBoxLabel: { fontSize: 7.5, color: GRAY, marginBottom: 6 },
  clientName:     { fontFamily: "Helvetica-Bold", fontSize: 9.5, color: BLACK, marginBottom: 3 },
  clientLegal:    { fontSize: 8.5, color: GRAY, marginBottom: 2 },
  clientDetail:   { fontSize: 8.5, color: DARK, lineHeight: 1.6 },

  // ── Tabla ────────────────────────────────────────────────────────────────────
  tableHead:   { flexDirection: "row", backgroundColor: LGRAY, paddingVertical: 7, paddingHorizontal: 8,
                 borderTopWidth: 0.5, borderTopStyle: "solid", borderTopColor: BORDER,
                 borderBottomWidth: 0.5, borderBottomStyle: "solid", borderBottomColor: BORDER },
  tableRow:    { flexDirection: "row", paddingVertical: 9, paddingHorizontal: 8,
                 borderBottomWidth: 0.5, borderBottomStyle: "solid", borderBottomColor: BORDER },
  th:          { fontFamily: "Helvetica-Bold", fontSize: 7.5, color: GRAY, textTransform: "uppercase", letterSpacing: 0.4 },
  tdText:      { fontSize: 8.5, color: BLACK },
  tdNum:       { fontSize: 8.5, color: BLACK },
  tdMuted:     { fontSize: 8, color: GRAY },

  colConcepto:  { flex: 3 },
  colPrecio:    { flex: 1.3, alignItems: "flex-end" },
  colUnd:       { width: 44, alignItems: "center" },
  colSubtotal:  { flex: 1.3, alignItems: "flex-end" },
  colIvaPct:    { width: 42, alignItems: "center" },
  colTotal:     { flex: 1.3, alignItems: "flex-end" },

  // ── Resumen ──────────────────────────────────────────────────────────────────
  summaryWrap:   { flexDirection: "row", justifyContent: "flex-end", marginTop: 18 },
  summaryInner:  { width: 230 },
  sumRow:        { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4.5,
                   borderBottomWidth: 0.5, borderBottomStyle: "solid", borderBottomColor: BORDER },
  sumLabel:      { fontSize: 8.5, color: GRAY },
  sumVal:        { fontSize: 8.5, color: BLACK },
  sumLabelB:     { fontFamily: "Helvetica-Bold", fontSize: 9.5, color: BLACK },
  sumValB:       { fontFamily: "Helvetica-Bold", fontSize: 9.5, color: BLACK },
  sumRowFinal:   { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5.5,
                   borderTopWidth: 1.2, borderTopStyle: "solid", borderTopColor: BLACK, marginTop: 2 },

  // ── Pie ──────────────────────────────────────────────────────────────────────
  footer:  { position: "absolute", bottom: 22, left: 50, right: 50, textAlign: "center", fontSize: 8, color: GRAY },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtAmt(amount, currency) {
  const n = Number(amount);
  if (currency === "EUR")
    return `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(rate) {
  return `${Math.round(rate * 100)}%`;
}

// ─── Componente página ────────────────────────────────────────────────────────
function InvoicePage({ fr, issuer, comp, isES }) {
  const currency = comp.currency ?? (isES ? "EUR" : "USD");

  // ── Montos ──────────────────────────────────────────────────────────────────
  const neto        = comp.amount ?? 0;
  const ivaRate     = isES ? (comp.applyIVA !== false ? 0.21 : 0) : 0;
  const retRate     = isES && comp.retencionPct ? comp.retencionPct / 100 : 0;
  const ivaAmt      = Math.round(neto * ivaRate * 100) / 100;
  const retAmt      = Math.round(neto * retRate * 100) / 100;
  const total       = Math.round((neto + ivaAmt - retAmt) * 100) / 100;

  // ── Texto de concepto ───────────────────────────────────────────────────────
  const cuentaRaw = String(comp.type ?? "").split("|")[1] ?? "";
  const concepto  = CUENTA_LABEL[cuentaRaw] || (isES ? "Servicio" : "Service");
  const period    = `${MONTHS[comp.month ?? 0]} ${comp.year ?? new Date().getFullYear()}`;
  const descr     = comp.nota ?? comp.ref ?? period;

  // ── Emisor ──────────────────────────────────────────────────────────────────
  const issuerName    = issuer.legalName ?? (isES ? "Gestión Deportiva y Wellness SL" : "BIGG FIT LLC");
  const issuerTaxId   = isES ? issuer.nif : issuer.ein;
  const issuerAddress = [issuer.address, issuer.suite].filter(Boolean).join(", ");
  const issuerCity    = isES
    ? [issuer.city, issuer.cp ? `(${issuer.cp})` : "", issuer.country].filter(Boolean).join(", ")
    : [issuer.city, issuer.state, issuer.zip].filter(Boolean).join(", ") + (issuer.country ? `, ${issuer.country}` : "");
  const issuerLines   = [issuerTaxId, issuerAddress, issuerCity, issuer.email, issuer.phone].filter(Boolean);

  // ── Cliente ─────────────────────────────────────────────────────────────────
  const clientSede    = fr.name ?? "";
  const clientLegal   = (fr.razonSocial && fr.razonSocial !== fr.name) ? fr.razonSocial : "";
  const clientTaxId   = fr.cuit   ? `CIF/NIF: ${fr.cuit}`
                      : fr.nif    ? `NIF: ${fr.nif}`
                      : fr.taxId  ? `Tax ID: ${fr.taxId}` : "";
  const clientAddr    = [fr.billingAddress ?? fr.domicilio, fr.billingCity, fr.billingState].filter(Boolean).join(", ");
  const clientCountry = fr.billingCountry ?? fr.country ?? "";
  const clientEmail   = fr.emailFactura ?? fr.email ?? "";
  const clientLines   = [clientTaxId, clientAddr, clientCountry, clientEmail].filter(Boolean);

  // ── Labels por idioma ────────────────────────────────────────────────────────
  const L = isES ? {
    title:        `FACTURA #${comp.invoice ?? "—"}`,
    dateLabel:    "Fecha:",
    clientLabel:  "Cliente:",
    thConcepto:   "Concepto",
    thPrecio:     "Precio",
    thUnd:        "Unidades",
    thSubtotal:   "Subtotal",
    thIva:        "IVA",
    thTotal:      "Total",
    sumBase:      "Base imponible",
    sumIva:       `IVA ${pct(ivaRate)}`,
    sumRet:       retRate ? `Retención ${pct(retRate)}` : null,
    sumTotal:     "TOTAL",
  } : {
    title:        `INVOICE #${comp.invoice ?? "—"}`,
    dateLabel:    "Date:",
    clientLabel:  "Bill To:",
    thConcepto:   "Concept",
    thPrecio:     "Price",
    thUnd:        "Qty",
    thSubtotal:   "Subtotal",
    thIva:        "Tax",
    thTotal:      "Total",
    sumBase:      "Net",
    sumIva:       `Tax (${pct(ivaRate)})`,
    sumRet:       null,
    sumTotal:     "TOTAL",
  };

  return (
    <>
      {/* ─── TOP ROW: logo + ref ─────────────────────────────────────────── */}
      <View style={S.topRow}>
        {issuer.logoUrl ? (
          <Image src={issuer.logoUrl} style={S.logoImg} />
        ) : (
          <View style={S.logoWrap}>
            <View style={S.logoInner}>
              <Text style={S.logoTextBig}>BIGG</Text>
              <Text style={S.logoTextSub}>FITNESS</Text>
            </View>
          </View>
        )}
        <View style={S.invoiceRef}>
          <Text style={S.invoiceNum}>{L.title}</Text>
          <Text style={S.invoiceDate}>{L.dateLabel} {comp.date ?? ""}</Text>
        </View>
      </View>

      {/* ─── EMISOR ──────────────────────────────────────────────────────── */}
      <Text style={S.issuerName}>{issuerName}</Text>
      <Text style={S.issuerDetail}>{issuerLines.join("\n")}</Text>

      <View style={S.hr} />

      {/* ─── CLIENTE ─────────────────────────────────────────────────────── */}
      <View style={S.clientBox}>
        <Text style={S.clientBoxLabel}>{L.clientLabel}</Text>
        <Text style={S.clientName}>{clientSede}</Text>
        {clientLegal ? <Text style={S.clientLegal}>{clientLegal}</Text> : null}
        {clientLines.length > 0 && (
          <Text style={S.clientDetail}>{clientLines.join("\n")}</Text>
        )}
      </View>

      {/* ─── TABLA ───────────────────────────────────────────────────────── */}
      <View>
        <View style={S.tableHead}>
          <View style={S.colConcepto} ><Text style={S.th}>{L.thConcepto}</Text></View>
          <View style={S.colPrecio}   ><Text style={S.th}>{L.thPrecio}</Text></View>
          <View style={S.colUnd}      ><Text style={S.th}>{L.thUnd}</Text></View>
          <View style={S.colSubtotal} ><Text style={S.th}>{L.thSubtotal}</Text></View>
          <View style={S.colIvaPct}   ><Text style={S.th}>{L.thIva}</Text></View>
          <View style={S.colTotal}    ><Text style={S.th}>{L.thTotal}</Text></View>
        </View>
        <View style={S.tableRow}>
          <View style={S.colConcepto} ><Text style={S.tdText}>{concepto}{descr !== concepto ? `\n${descr}` : ""}</Text></View>
          <View style={S.colPrecio}   ><Text style={S.tdNum}>{fmtAmt(neto, currency)}</Text></View>
          <View style={S.colUnd}      ><Text style={S.tdNum}>1</Text></View>
          <View style={S.colSubtotal} ><Text style={S.tdNum}>{fmtAmt(neto, currency)}</Text></View>
          <View style={S.colIvaPct}   ><Text style={S.tdMuted}>{pct(ivaRate)}</Text></View>
          <View style={S.colTotal}    ><Text style={S.tdNum}>{fmtAmt(isES ? neto + ivaAmt : total, currency)}</Text></View>
        </View>
      </View>

      {/* ─── RESUMEN ─────────────────────────────────────────────────────── */}
      <View style={S.summaryWrap}>
        <View style={S.summaryInner}>
          <View style={S.sumRow}>
            <Text style={S.sumLabel}>{L.sumBase}</Text>
            <Text style={S.sumVal}>{fmtAmt(neto, currency)}</Text>
          </View>
          <View style={S.sumRow}>
            <Text style={S.sumLabel}>{L.sumIva}</Text>
            <Text style={S.sumVal}>{fmtAmt(ivaAmt, currency)}</Text>
          </View>
          {L.sumRet && (
            <View style={S.sumRow}>
              <Text style={S.sumLabel}>{L.sumRet}</Text>
              <Text style={S.sumVal}>-{fmtAmt(retAmt, currency)}</Text>
            </View>
          )}
          <View style={S.sumRowFinal}>
            <Text style={S.sumLabelB}>{L.sumTotal}</Text>
            <Text style={S.sumValB}>{fmtAmt(total, currency)}</Text>
          </View>
        </View>
      </View>

      {/* ─── NOTA PIE ────────────────────────────────────────────────────── */}
      {(fr.notaFactura ?? issuer.notaPie) ? (
        <View style={{ marginTop: 20, borderTopWidth: 0.5, borderTopStyle: "solid", borderTopColor: BORDER, paddingTop: 8 }}>
          <Text style={{ fontSize: 7.5, color: GRAY, lineHeight: 1.6 }}>{fr.notaFactura ?? issuer.notaPie}</Text>
        </View>
      ) : null}

      {/* ─── PIE DE PÁGINA ───────────────────────────────────────────────── */}
      <Text style={S.footer} render={({ pageNumber, totalPages }) =>
        `Pág. ${pageNumber} de ${totalPages}`
      } fixed />
    </>
  );
}

// ─── Documentos PDF ───────────────────────────────────────────────────────────
function InvoiceDoc({ fr, franchisor, comp }) {
  const isES   = comp.currency === "EUR";
  const issuer = isES ? (franchisor?.es ?? {}) : (franchisor?.usa ?? {});
  return (
    <Document>
      <Page size="A4" style={S.page}>
        <InvoicePage fr={fr} issuer={issuer} comp={comp} isES={isES} />
      </Page>
    </Document>
  );
}

function InvoiceBatchDoc({ items }) {
  return (
    <Document>
      {items.map(({ fr, issuer, isES, comp }, i) => (
        <Page key={i} size="A4" style={S.page}>
          <InvoicePage fr={fr} issuer={issuer} comp={comp} isES={isES} />
        </Page>
      ))}
    </Document>
  );
}

// ─── Helpers de descarga ──────────────────────────────────────────────────────
function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revocamos en el siguiente tick para dar tiempo al browser a iniciar la descarga
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Genera y descarga un PDF para un único invoice.
 */
export async function downloadInvoicePdf(fr, franchisor, comp) {
  const blob  = await pdf(<InvoiceDoc fr={fr} franchisor={franchisor} comp={comp} />).toBlob();
  const label = comp.invoice ? String(comp.invoice).replace(/\//g, "-") : comp.id;
  triggerBlobDownload(blob, `Invoice_${label}_${fr.name}.pdf`);
}

/**
 * Genera y descarga un PDF con múltiples invoices (una página por invoice).
 * @param {Array<{fr, comp}>} items
 * @param {object} franchisor
 */
export async function downloadBatchInvoicePdf(items, franchisor) {
  const docItems = items.map(({ fr, comp }) => {
    const isES   = comp.currency === "EUR";
    const issuer = isES ? (franchisor?.es ?? {}) : (franchisor?.usa ?? {});
    return { fr, issuer, isES, comp };
  });
  const blob = await pdf(<InvoiceBatchDoc items={docItems} />).toBlob();
  triggerBlobDownload(blob, `Invoices_batch_${new Date().toISOString().slice(0, 10)}.pdf`);
}
