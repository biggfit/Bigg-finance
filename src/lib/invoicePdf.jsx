/**
 * invoicePdf.jsx — Generación de INVOICE en PDF para BIGG FIT LLC (y ES)
 * Usa @react-pdf/renderer v4.
 * Nota: fmtAmt usa locale en-US (formato $1,234.56) a diferencia de fmt() en helpers.js
 * que usa es-AR. Esto es intencional para invoices en inglés dirigidas al exterior.
 */
import React from "react";
import { Document, Page, View, Text, Image, StyleSheet, pdf } from "@react-pdf/renderer";
import { MONTHS, CUENTA_LABEL } from "./helpers";

// ─── Paleta ────────────────────────────────────────────────────────────────────
const TEAL     = "#4A9DA6";
const BLACK    = "#1a1a1a";
const GRAY     = "#666666";
const MIDGRAY  = "#999999";
const LGRAY    = "#f5f5f5";
const BORDER   = "#e0e0e0";

// ─── Estilos ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    color: BLACK,
    backgroundColor: "#ffffff",
    paddingVertical: 38,
    paddingHorizontal: 46,
  },

  // ── Header ──────────────────────────────────────────────────────────────────
  header:            { flexDirection: "row", alignItems: "flex-start", marginBottom: 20 },
  logoWrap:          { width: 70, height: 70, borderRadius: 35, borderWidth: 1.5, borderStyle: "solid", borderColor: BLACK, alignItems: "center", justifyContent: "center", marginRight: 22, flexShrink: 0 },
  logoImg:           { width: 70, height: 70, objectFit: "contain", marginRight: 22, flexShrink: 0 },
  logoInner:         { alignItems: "center" },
  logoTextBig:       { fontFamily: "Helvetica-Bold", fontSize: 13, color: BLACK, letterSpacing: 1 },
  logoTextSub:       { fontSize: 5, color: GRAY, letterSpacing: 0.8, marginTop: 1 },
  headerCenter:      { flex: 1 },
  headerCompany:     { fontFamily: "Helvetica-Bold", fontSize: 11, color: TEAL, marginBottom: 4 },
  headerDetail:      { fontSize: 8.5, color: BLACK, lineHeight: 1.6 },
  headerRight:       { width: 185, alignItems: "flex-end" },
  headerAddress:     { fontSize: 8.5, color: BLACK, lineHeight: 1.65, textAlign: "right" },

  // ── Separadores ─────────────────────────────────────────────────────────────
  hrThick: { borderBottomWidth: 1.5, borderBottomColor: "#cccccc", borderBottomStyle: "solid", marginVertical: 0 },
  hrThin:  { borderBottomWidth: 0.5, borderBottomColor: BORDER,    borderBottomStyle: "solid" },

  // ── Título ──────────────────────────────────────────────────────────────────
  invoiceTitle: { fontFamily: "Helvetica-Bold", fontSize: 14, color: TEAL, marginTop: 10, marginBottom: 10 },

  // ── Bloque de información ───────────────────────────────────────────────────
  infoBlock:    { flexDirection: "row", marginTop: 4, marginBottom: 16 },
  infoLeft:     { flex: 1.1, paddingRight: 18 },
  infoRow:      { flexDirection: "row", marginBottom: 5 },
  infoLabel:    { width: 112, fontSize: 8.5, color: GRAY },
  infoVal:      { fontFamily: "Helvetica-Bold", fontSize: 8.5, color: BLACK },
  infoRight:    { flex: 1, paddingLeft: 18, borderLeftWidth: 0.5, borderLeftStyle: "solid", borderLeftColor: BORDER },
  clientName:   { fontFamily: "Helvetica-Bold", fontSize: 10, color: BLACK, marginBottom: 4 },
  clientLegal:  { fontSize: 8.5, color: GRAY, marginBottom: 3 },
  clientDetail: { fontSize: 8.5, color: GRAY, lineHeight: 1.7 },

  // ── Tabla ───────────────────────────────────────────────────────────────────
  tableHead:   { flexDirection: "row", paddingVertical: 8, paddingHorizontal: 10, backgroundColor: LGRAY },
  tableRow:    { flexDirection: "row", paddingVertical: 11, paddingHorizontal: 10, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f0", borderBottomStyle: "solid" },
  colConcepto: { flex: 2 },
  colDesc:     { flex: 1.8 },
  colUnit:     { flex: 1.4, alignItems: "flex-end" },
  colQty:      { width: 55, alignItems: "center" },
  colTotal:    { width: 75, alignItems: "flex-end" },
  th:          { fontFamily: "Helvetica-Bold", fontSize: 7.5, color: MIDGRAY, textTransform: "uppercase", letterSpacing: 0.5 },
  tdConcepto:  { fontSize: 9, color: TEAL },
  tdDesc:      { fontSize: 9, color: GRAY },
  tdNum:       { fontFamily: "Helvetica-Bold", fontSize: 9, color: BLACK },

  // ── Footer ──────────────────────────────────────────────────────────────────
  footer:      { flexDirection: "row", marginTop: 18 },
  footerLeft:  { flex: 1, paddingRight: 28 },
  footerRight: { width: 195 },
  payTitle:    { fontFamily: "Helvetica-Bold", fontSize: 8.5, color: BLACK, marginBottom: 5 },
  payLine:     { fontSize: 8, color: GRAY, lineHeight: 1.7 },

  sumRow:      { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f0", borderBottomStyle: "solid" },
  sumLabel:    { fontSize: 8.5, color: GRAY },
  sumVal:      { fontSize: 8.5, color: BLACK },
  sumLabelB:   { fontFamily: "Helvetica-Bold", fontSize: 8.5, color: BLACK },
  sumValB:     { fontFamily: "Helvetica-Bold", fontSize: 8.5, color: BLACK },
  sumRowFinal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4.5, borderTopWidth: 1.5, borderTopColor: BLACK, borderTopStyle: "solid", marginTop: 4 },

  // ── Nota pie ────────────────────────────────────────────────────────────────
  noteFooter: { marginTop: 24, borderTopWidth: 0.5, borderTopColor: BORDER, borderTopStyle: "solid", paddingTop: 8, fontSize: 7.5, color: MIDGRAY, lineHeight: 1.6 },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Formato en-US ($1,234.56) para invoices en inglés — distinto de fmt() en helpers.js (es-AR)
function fmtAmt(amount, currency = "USD") {
  const sym = currency === "EUR" ? "€" : "$";
  return `${sym}${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Componente página ────────────────────────────────────────────────────────
function InvoicePage({ fr, usa, comp }) {
  const amount    = comp.amount ?? 0;
  const currency  = comp.currency ?? "USD";
  const amtStr    = fmtAmt(amount, currency);   // calculado una sola vez
  const zerStr    = fmtAmt(0, currency);
  const cuentaRaw = String(comp.type ?? "").split("|")[1] ?? "";
  const concepto  = CUENTA_LABEL[cuentaRaw] || "Service";
  const period    = `${MONTHS[comp.month ?? 0]} ${comp.year ?? new Date().getFullYear()}`;
  const descr     = comp.nota ?? comp.ref ?? period;

  // ── Franquiciante (izquierda del header) ──────────────────────────────────
  const companyName = usa.legalName ?? "BIGG FIT LLC";
  const website     = usa.website ?? "";
  const emailFac    = usa.email ?? "";
  const address1    = usa.address ?? "";
  const suite       = usa.suite ?? "";
  const cityLine    = [usa.city, usa.state, usa.zip].filter(Boolean).join(", ");
  const country     = usa.country ?? "United States";

  // ── Franquiciado (lado derecho info) ─────────────────────────────────────
  const clientSede    = fr.name ?? "";
  const clientLegal   = (fr.razonSocial && fr.razonSocial !== fr.name) ? fr.razonSocial : "";
  const clientTaxId   = fr.cuit ? `RUC: ${fr.cuit}` : (fr.taxId ? `Tax ID: ${fr.taxId}` : "");
  const clientAddr    = [fr.billingAddress ?? fr.domicilio, fr.billingCity, fr.billingState].filter(Boolean).join(", ");
  const clientCountry = fr.billingCountry ?? fr.country ?? "";
  const clientEmail   = fr.emailFactura ?? fr.email ?? "";

  // ── Banco ─────────────────────────────────────────────────────────────────
  const hasBankInfo = usa.bankName || usa.routingNumber || usa.swift;
  const bankLines = [
    usa.bankName,
    usa.bankAddress,
    usa.routingNumber   && `ABA: ${usa.routingNumber}`,
    usa.swift           && `SWIFT: ${usa.swift}`,
    usa.beneficiaryName && `Beneficiary Name: ${usa.beneficiaryName}`,
    usa.accountNumber   && `Beneficiary Account #: ${usa.accountNumber}`,
  ].filter(Boolean);

  return (
    <>
      {/* ─── HEADER ─────────────────────────────────────────────────────── */}
      <View style={S.header}>
        {/* Logo */}
        {usa.logoUrl ? (
          <Image src={usa.logoUrl} style={S.logoImg} />
        ) : (
          <View style={S.logoWrap}>
            <View style={S.logoInner}>
              <Text style={S.logoTextBig}>BIGG</Text>
              <Text style={S.logoTextSub}>FITNESS</Text>
            </View>
          </View>
        )}

        {/* Centro: nombre + contacto */}
        <View style={S.headerCenter}>
          <Text style={S.headerCompany}>{companyName}</Text>
          {website  && <Text style={S.headerDetail}>{website}</Text>}
          {emailFac && <Text style={S.headerDetail}>{emailFac}</Text>}
        </View>

        {/* Derecha: dirección */}
        <View style={S.headerRight}>
          {address1 && <Text style={S.headerAddress}>{address1}</Text>}
          {suite    && <Text style={S.headerAddress}>{suite}</Text>}
          {cityLine && <Text style={S.headerAddress}>{cityLine}</Text>}
          {country  && <Text style={S.headerAddress}>{country}</Text>}
        </View>
      </View>

      {/* ─── SEPARADOR ──────────────────────────────────────────────────── */}
      <View style={S.hrThick} />

      {/* ─── TÍTULO ─────────────────────────────────────────────────────── */}
      <Text style={S.invoiceTitle}>INVOICE</Text>

      {/* ─── SEPARADOR FINO ─────────────────────────────────────────────── */}
      <View style={S.hrThin} />

      {/* ─── INFO BLOCK ─────────────────────────────────────────────────── */}
      <View style={S.infoBlock}>
        {/* Izquierda: datos del comprobante */}
        <View style={S.infoLeft}>
          <View style={S.infoRow}>
            <Text style={S.infoLabel}>Invoice Number</Text>
            <Text style={S.infoVal}>{comp.invoice ?? "—"}</Text>
          </View>
          <View style={S.infoRow}>
            <Text style={S.infoLabel}>Invoice Date</Text>
            <Text style={S.infoVal}>{comp.date ?? ""}</Text>
          </View>
          <View style={S.infoRow}>
            <Text style={S.infoLabel}>Period</Text>
            <Text style={S.infoVal}>{period}</Text>
          </View>
          <View style={S.infoRow}>
            <Text style={S.infoLabel}>Total</Text>
            <Text style={S.infoVal}>{amtStr}</Text>
          </View>
          <View style={S.infoRow}>
            <Text style={S.infoLabel}>Pending</Text>
            <Text style={S.infoVal}>{amtStr}</Text>
          </View>
        </View>

        {/* Derecha: datos del cliente */}
        <View style={S.infoRight}>
          <Text style={S.clientName}>{clientSede}</Text>
          {clientLegal ? <Text style={S.clientLegal}>{clientLegal}</Text> : null}
          <Text style={S.clientDetail}>
            {[clientTaxId, clientAddr, clientCountry, clientEmail].filter(Boolean).join("\n")}
          </Text>
        </View>
      </View>

      {/* ─── SEPARADOR ──────────────────────────────────────────────────── */}
      <View style={S.hrThick} />

      {/* ─── TABLA ──────────────────────────────────────────────────────── */}
      <View>
        {/* Encabezado */}
        <View style={S.tableHead}>
          <View style={S.colConcepto}><Text style={S.th}>Concept</Text></View>
          <View style={S.colDesc}>    <Text style={S.th}>Description</Text></View>
          <View style={S.colUnit}>    <Text style={S.th}>Unit Price</Text></View>
          <View style={S.colQty}>     <Text style={S.th}>Qty</Text></View>
          <View style={S.colTotal}>   <Text style={S.th}>Total</Text></View>
        </View>
        {/* Fila */}
        <View style={S.tableRow}>
          <View style={S.colConcepto}><Text style={S.tdConcepto}>{concepto}</Text></View>
          <View style={S.colDesc}>    <Text style={S.tdDesc}>{descr}</Text></View>
          <View style={S.colUnit}>    <Text style={S.tdNum}>{amtStr}</Text></View>
          <View style={S.colQty}>     <Text style={S.tdNum}>1</Text></View>
          <View style={S.colTotal}>   <Text style={S.tdNum}>{amtStr}</Text></View>
        </View>
      </View>

      {/* ─── FOOTER ─────────────────────────────────────────────────────── */}
      <View style={S.footer}>
        {/* Izquierda: condiciones de pago */}
        <View style={S.footerLeft}>
          <Text style={S.payTitle}>Payment Terms:</Text>
          {usa.paymentTerms && <Text style={S.payLine}>{usa.paymentTerms}</Text>}
          {hasBankInfo && bankLines.map((line, i) => (
            <Text key={i} style={S.payLine}>{line}</Text>
          ))}
        </View>

        {/* Derecha: resumen de montos */}
        <View style={S.footerRight}>
          <View style={S.sumRow}>
            <Text style={S.sumLabel}>Net</Text>
            <Text style={S.sumVal}>{amtStr}</Text>
          </View>
          <View style={S.sumRow}>
            <Text style={S.sumLabel}>Subtotal</Text>
            <Text style={S.sumVal}>{amtStr}</Text>
          </View>
          <View style={S.sumRow}>
            <Text style={S.sumLabelB}>Total</Text>
            <Text style={S.sumValB}>{amtStr}</Text>
          </View>
          <View style={S.sumRow}>
            <Text style={S.sumLabel}>Paid</Text>
            <Text style={S.sumVal}>{zerStr}</Text>
          </View>
          <View style={S.sumRowFinal}>
            <Text style={S.sumLabelB}>Pending</Text>
            <Text style={S.sumValB}>{amtStr}</Text>
          </View>
        </View>
      </View>

      {/* ─── NOTA PIE ─────────────────────────────────────────────────── */}
      {(fr.notaFactura ?? usa.notaPie) ? (
        <View style={S.noteFooter}>
          <Text>{fr.notaFactura ?? usa.notaPie}</Text>
        </View>
      ) : null}
    </>
  );
}

// ─── Documento PDF ────────────────────────────────────────────────────────────
function InvoiceDoc({ fr, franchisor, comp }) {
  const usa = franchisor?.usa ?? {};
  return (
    <Document>
      <Page size="A4" style={S.page}>
        <InvoicePage fr={fr} usa={usa} comp={comp} />
      </Page>
    </Document>
  );
}

function InvoiceBatchDoc({ items }) {
  return (
    <Document>
      {items.map(({ fr, usa, comp }, i) => (
        <Page key={i} size="A4" style={S.page}>
          <InvoicePage fr={fr} usa={usa} comp={comp} />
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
  const usa      = franchisor?.usa ?? {};
  const docItems = items.map(({ fr, comp }) => ({ fr, usa, comp }));
  const blob     = await pdf(<InvoiceBatchDoc items={docItems} />).toBlob();
  triggerBlobDownload(blob, `Invoices_batch_${new Date().toISOString().slice(0, 10)}.pdf`);
}
