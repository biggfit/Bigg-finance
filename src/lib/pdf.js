import { fmt, MONTHS, COMP_TYPES, fmtS } from "./helpers";
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
    `Subtotal:   ${fmt(comp.amount, comp.currency ?? "ARS")}`,
    `IVA 21%:    ${fmt(comp.amount * 0.21, comp.currency ?? "ARS")}`,
    `TOTAL:      ${fmt(comp.amount * 1.21, comp.currency ?? "ARS")}`,
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
    `Amount Due:  ${fmt(comp.amount, comp.currency ?? "USD")}`,
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

// ─── CC HTML (para adjuntar en mail) ─────────────────────────────────────────
/**
 * Genera un HTML standalone con la tabla completa de la CC, listo para adjuntar por mail.
 * @param {string} frName
 * @param {string|null} frRazonSocial
 * @param {object[]} lines  — salida de buildCuentaCorriente()
 * @param {string} currency — "ARS" | "USD" | "EUR"
 */
export function buildCCHtml(frName, frRazonSocial, lines, currency, ccMonth, ccYear) {
  const SYM = { ARS: "$", USD: "U$D", EUR: "€" };
  const sym = SYM[currency] ?? "$";
  const fmtAmt   = v => v ? `${sym}\u202f${Math.abs(v).toLocaleString("es-AR", { minimumFractionDigits: 2 })}` : "";
  const fmtSaldo = v => `${v >= 0 ? "+" : "-"}${sym}\u202f${Math.abs(v).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;

  const rows = lines.map((l, i) => {
    const isApertura = l.type === "apertura";
    const label      = isApertura ? "Saldo Anterior" : (COMP_TYPES[l.type]?.label ?? l.type);
    const sc = l.saldo > 0.01 ? "#dc2626" : l.saldo < -0.01 ? "#16a34a" : "#6b7280";
    const bg = isApertura ? "#f0fdf4" : i % 2 === 0 ? "#ffffff" : "#f9fafb";
    const fw = isApertura ? "700" : "400";
    return `<tr style="background:${bg}">
      <td style="padding:7px 10px;font-family:monospace;font-size:12px;color:#6b7280;white-space:nowrap;font-weight:${fw}">${l.date ?? "—"}</td>
      <td style="padding:7px 10px;font-family:monospace;font-size:11px;color:#1d4ed8;font-weight:700">${l.invoice ?? (isApertura ? "" : "—")}</td>
      <td style="padding:7px 10px;font-size:11px;color:#374151">${label}</td>
      <td style="padding:7px 10px;font-size:11px;color:#6b7280;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.nota ?? l.ref ?? (isApertura ? "Saldo inicial / apertura" : "—")}</td>
      <td style="padding:7px 10px;font-family:monospace;font-size:12px;color:#dc2626;text-align:right;font-weight:${l.debit > 0 ? 700 : 400}">${fmtAmt(l.debit)}</td>
      <td style="padding:7px 10px;font-family:monospace;font-size:12px;color:#16a34a;text-align:right;font-weight:${l.credit > 0 ? 700 : 400}">${fmtAmt(l.credit)}</td>
      <td style="padding:7px 10px;font-family:monospace;font-size:12px;font-weight:700;text-align:right;color:${sc}">${fmtSaldo(l.saldo)}</td>
    </tr>`;
  }).join("");

  const saldoFinal = lines.length ? lines[lines.length - 1].saldo : 0;
  const scFinal    = saldoFinal > 0.01 ? "#dc2626" : saldoFinal < -0.01 ? "#16a34a" : "#6b7280";

  // Fecha de cierre: último día del mes informado (ej: 28/02/2026), o hoy si no se pasó mes
  const pad2     = n => String(n).padStart(2, "0");
  const baseM    = ccMonth  ?? new Date().getMonth();   // 0-based
  const baseY    = ccYear   ?? new Date().getFullYear();
  const lastDay  = new Date(baseY, baseM + 1, 0).getDate();
  const today    = ccMonth != null
    ? `${pad2(lastDay)}/${pad2(baseM + 1)}/${baseY}`
    : new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const nextM    = baseM === 11 ? 0  : baseM + 1;
  const nextY    = baseM === 11 ? baseY + 1 : baseY;
  const dueDay   = saldoFinal > 0.01 ? 10 : 20;        // adeudado → día 10 / a favor → día 20
  const dueDate  = `${pad2(dueDay)}/${pad2(nextM + 1)}/${nextY}`;
  const dueLabel = saldoFinal > 0.01 ? "Fecha límite de pago" : saldoFinal < -0.01 ? "Acreditación estimada" : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cuenta Corriente — ${frName}</title></head>
<body style="margin:0;padding:32px;font-family:Arial,sans-serif;background:#f3f4f6;color:#111">
<div style="max-width:900px;margin:auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="background:#111;color:#adff19;padding:22px 28px">
    <div style="font-size:18px;font-weight:800">${frName}</div>
    ${frRazonSocial ? `<div style="font-size:12px;opacity:.65;margin-top:2px">${frRazonSocial}</div>` : ""}
    <div style="font-size:11px;opacity:.5;margin-top:4px">Cuenta Corriente · ${currency} · al ${today}</div>
  </div>
  <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
          <th style="padding:9px 10px;text-align:left;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Fecha</th>
          <th style="padding:9px 10px;text-align:left;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">N° Comprobante</th>
          <th style="padding:9px 10px;text-align:left;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Tipo</th>
          <th style="padding:9px 10px;text-align:left;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Descripción</th>
          <th style="padding:9px 10px;text-align:right;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Debe</th>
          <th style="padding:9px 10px;text-align:right;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Haber</th>
          <th style="padding:9px 10px;text-align:right;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Saldo</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div style="padding:16px 28px;border-top:2px solid #e5e7eb;background:#f9fafb">
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <td style="vertical-align:middle;padding:0">
          ${dueLabel ? `<div style="font-size:11px;color:#6b7280;margin-bottom:3px">${dueLabel}</div><div style="font-size:15px;font-weight:700;color:#111">${dueDate}</div>` : ""}
        </td>
        <td style="text-align:right;vertical-align:middle;padding:0">
          <div style="font-size:11px;color:#6b7280;margin-bottom:3px">Saldo al ${today}</div>
          <div style="font-family:monospace;font-size:20px;font-weight:800;color:${scFinal}">${fmtSaldo(saldoFinal)}</div>
        </td>
      </tr>
    </table>
  </div>
</div>
</body></html>`;
}

/**
 * Convierte un string HTML a base64 (UTF-8 safe) para adjuntar vía Apps Script.
 */
export function htmlToBase64(html) {
  const bytes = new TextEncoder().encode(html);
  let binary = "";
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

/**
 * Construye el HTML de una factura/invoice para adjuntar por mail.
 * Usa la misma lógica que downloadTextAsPDF pero retorna el string en lugar de descargar.
 * @param {object} fr         — franquicia
 * @param {object} franchisor — { ar, usa }
 * @param {object} comp       — comprobante con invoice, date, etc.
 */
export function buildFacturaHtmlForMail(fr, franchisor, comp) {
  const isAR   = (comp.currency ?? fr.currency ?? "ARS") !== "USD";
  const text   = isAR ? buildFacturaPDF(fr, franchisor, comp) : buildInvoicePDF(fr, franchisor, comp);
  const title  = comp.invoice ?? (isAR ? "Factura" : "Invoice");
  const escaped = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:monospace;font-size:13px;padding:40px;max-width:600px;margin:auto;white-space:pre-wrap;line-height:1.6}
@media print{body{padding:20px}}</style></head>
<body>${escaped}</body></html>`;
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
