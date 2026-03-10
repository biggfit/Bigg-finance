import { fmt, MONTHS } from "./helpers";
import { todayDmy } from "../data/franchisor";

// ─── PDF GENERATORS ──────────────────────────────────────────────────────────
export function buildFacturaPDF(fr, franchisor, comp) {
  const ar = franchisor?.ar ?? {};
  const lines = [
    `FACTURA`,
    ``,
    `Emisor: ${ar.razonSocial ?? "ÑAKO SRL"}`,
    `CUIT: ${ar.cuit ?? ""}   Cond. IVA: ${ar.condIVA ?? ""}`,
    `Punto de Venta: ${ar.puntoVenta ?? "0001"}`,
    ``,
    `Receptor: ${fr.razonSocial ?? fr.name}`,
    `CUIT: ${fr.cuit ?? ""}   Cond. IVA: ${fr.condIVA ?? ""}`,
    `Domicilio: ${fr.billingAddress ?? fr.domicilio ?? ""}`,
    ``,
    `Fecha: ${comp.date ?? todayDmy()}`,
    `Período: ${MONTHS[comp.month ?? 0]} ${comp.year ?? new Date().getFullYear()}`,
    ``,
    `Descripción: ${comp.nota ?? comp.ref ?? ""}`,
    ``,
    `─────────────────────────────────────────`,
    `Subtotal:   ${fmt(comp.amount, fr.currency ?? "ARS")}`,
    `IVA 21%:    ${fmt(comp.amount * 0.21, fr.currency ?? "ARS")}`,
    `TOTAL:      ${fmt(comp.amount * 1.21, fr.currency ?? "ARS")}`,
    `─────────────────────────────────────────`,
    ``,
    fr.notaFactura ?? ar.notaPie ?? "",
  ];
  return lines.join("\n");
}

export function buildInvoicePDF(fr, franchisor, comp) {
  const usa = franchisor?.usa ?? {};
  const lines = [
    `INVOICE`,
    ``,
    `From: ${usa.legalName ?? "BIGG FIT LLC"}`,
    `${usa.address ?? ""}`,
    `${usa.city ?? ""}, ${usa.state ?? ""} ${usa.zip ?? ""}   ${usa.country ?? "United States"}`,
    `EIN: ${usa.ein ?? ""}`,
    ``,
    `To: ${fr.razonSocial ?? fr.name}`,
    `${fr.billingAddress ?? ""}`,
    `${fr.billingCity ?? ""}, ${fr.billingState ?? ""} ${fr.billingZip ?? ""}`,
    ``,
    `Invoice Date: ${comp.date ?? todayDmy()}`,
    `Period: ${MONTHS[comp.month ?? 0]} ${comp.year ?? new Date().getFullYear()}`,
    ``,
    `Description: ${comp.nota ?? comp.ref ?? ""}`,
    ``,
    `─────────────────────────────────────────`,
    `Amount Due:  ${fmt(comp.amount, fr.currency ?? "USD")}`,
    `─────────────────────────────────────────`,
    ``,
    fr.notaFactura ?? usa.notaPie ?? "",
    ``,
    `Bank: ${usa.bankName ?? ""}`,
    `Routing: ${usa.routingNumber ?? ""}   Account: ${usa.accountNumber ?? ""}`,
    `SWIFT: ${usa.swift ?? ""}`,
  ];
  return lines.join("\n");
}

export function downloadTextAsPDF(text, filename) {
  // Descarga como HTML (apto para imprimir como PDF desde el navegador)
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${filename}</title>
<style>body{font-family:monospace;font-size:13px;padding:40px;max-width:600px;margin:auto;white-space:pre-wrap;line-height:1.6}
@media print{body{padding:20px}}</style></head>
<body>${text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
