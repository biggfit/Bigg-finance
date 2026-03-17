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

/**
 * Genera un HTML completo y estilizado para un Invoice USA, apto para imprimir como PDF.
 */
export function buildInvoiceHtml(fr, franchisor, comp) {
  const usa   = franchisor?.usa ?? {};
  const sym   = comp.currency === "EUR" ? "€" : comp.currency === "ARS" ? "$" : "U$D";
  const fmtAmt = v => `${sym}\u202f${Number(v).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const period = `${MONTHS[comp.month ?? 0]} ${comp.year ?? new Date().getFullYear()}`;
  const invoiceNum  = comp.invoice ?? "—";
  const description = comp.nota ?? comp.ref ?? "";
  const amount      = comp.amount ?? 0;
  const footer      = fr.notaFactura ?? usa.notaPie ?? "";

  // Datos del receptor
  const toName    = fr.razonSocial ?? fr.name ?? "";
  const toTaxId   = fr.cuit ? `Tax ID / RUC: ${fr.cuit}` : "";
  const toAddr    = [fr.billingAddress, fr.billingCity, fr.billingState]
    .filter(Boolean).join(", ");
  const toCountry = fr.country ?? "";

  // Datos bancarios
  const hasBankInfo = usa.bankName || usa.routingNumber || usa.accountNumber || usa.swift;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${invoiceNum}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 13px; color: #1a1a1a; background: #e8e8e8; }
.page { max-width: 760px; margin: 32px auto; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.18); }
.header { background: #111; padding: 30px 36px; }
.header-top { display: table; width: 100%; }
.header-left { display: table-cell; vertical-align: top; }
.header-right { display: table-cell; vertical-align: top; text-align: right; }
.brand { color: #adff19; font-size: 26px; font-weight: 900; letter-spacing: .12em; }
.from-name { color: #fff; font-size: 13px; font-weight: 700; margin-top: 4px; }
.from-detail { color: rgba(255,255,255,.45); font-size: 10px; line-height: 1.7; margin-top: 2px; }
.inv-label { color: rgba(255,255,255,.35); font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; }
.inv-num { color: #adff19; font-size: 18px; font-weight: 900; margin-top: 3px; letter-spacing: .04em; }
.inv-date { color: rgba(255,255,255,.5); font-size: 11px; margin-top: 4px; }
.body { padding: 28px 36px; }
.parties { display: table; width: 100%; border-collapse: collapse; margin-bottom: 28px; }
.party { display: table-cell; width: 50%; vertical-align: top; padding-right: 24px; }
.party:last-child { padding-right: 0; padding-left: 24px; border-left: 1px solid #eee; }
.party-label { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: #aaa; margin-bottom: 7px; }
.party-name { font-size: 14px; font-weight: 800; color: #111; margin-bottom: 3px; }
.party-detail { font-size: 11px; color: #666; line-height: 1.7; }
table.items { width: 100%; border-collapse: collapse; margin-bottom: 0; }
table.items th { padding: 9px 12px; background: #f8f8f8; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: #aaa; text-align: left; border-bottom: 2px solid #eee; }
table.items th.r { text-align: right; }
table.items td { padding: 14px 12px; border-bottom: 1px solid #f3f3f3; font-size: 12px; vertical-align: top; }
table.items td.r { text-align: right; font-family: monospace; font-weight: 700; white-space: nowrap; }
.total-wrap { border-top: 2px solid #111; padding: 14px 12px; text-align: right; }
.total-label { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: #aaa; margin-bottom: 4px; }
.total-amount { font-family: monospace; font-size: 22px; font-weight: 900; color: #111; }
.bank { margin: 24px 0 0; background: #f9f9f9; border: 1px solid #eee; border-radius: 7px; padding: 16px 20px; }
.bank-title { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: #aaa; margin-bottom: 10px; }
.bank-grid { display: table; width: 100%; }
.bank-cell { display: table-cell; font-size: 11px; color: #555; padding-right: 20px; padding-bottom: 4px; }
.bank-cell b { display: block; font-size: 9px; color: #aaa; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 1px; }
.page-footer { padding: 14px 36px 24px; font-size: 10px; color: #aaa; border-top: 1px solid #f0f0f0; margin-top: 4px; }
@media print {
  body { background: white; }
  .page { box-shadow: none; margin: 0; border-radius: 0; max-width: 100%; }
}
</style></head>
<body>
<div class="page">
  <div class="header">
    <div class="header-top">
      <div class="header-left">
        <div class="brand">BIGG</div>
        <div class="from-name">${usa.legalName ?? "BIGG FIT LLC"}</div>
        <div class="from-detail">
          ${usa.address ? usa.address + "<br>" : ""}
          ${[usa.city, usa.state, usa.zip].filter(Boolean).join(", ")}${usa.country ? " &middot; " + usa.country : ""}<br>
          ${usa.ein ? "EIN: " + usa.ein : ""}
        </div>
      </div>
      <div class="header-right">
        <div class="inv-label">Invoice</div>
        <div class="inv-num">${invoiceNum}</div>
        <div class="inv-date">Date: ${comp.date ?? ""}</div>
        <div class="inv-date" style="margin-top:2px">Period: ${period}</div>
      </div>
    </div>
  </div>

  <div class="body">
    <div class="parties">
      <div class="party">
        <div class="party-label">From</div>
        <div class="party-name">${usa.legalName ?? "BIGG FIT LLC"}</div>
        <div class="party-detail">
          ${usa.address ?? ""}<br>
          ${[usa.city, usa.state, usa.zip].filter(Boolean).join(", ")}<br>
          ${usa.ein ? "EIN: " + usa.ein : ""}
        </div>
      </div>
      <div class="party">
        <div class="party-label">Bill To</div>
        <div class="party-name">${toName}</div>
        <div class="party-detail">
          ${toTaxId ? toTaxId + "<br>" : ""}
          ${toAddr ? toAddr + "<br>" : ""}
          ${toCountry}
        </div>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th>Description</th>
          <th class="r">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${description}</td>
          <td class="r">${fmtAmt(amount)}</td>
        </tr>
      </tbody>
    </table>
    <div class="total-wrap">
      <div class="total-label">Total Due</div>
      <div class="total-amount">${fmtAmt(amount)}</div>
    </div>

    ${hasBankInfo ? `
    <div class="bank">
      <div class="bank-title">Payment Instructions</div>
      <div class="bank-grid">
        ${usa.bankName ? `<span class="bank-cell"><b>Bank</b>${usa.bankName}</span>` : ""}
        ${usa.routingNumber ? `<span class="bank-cell"><b>Routing</b>${usa.routingNumber}</span>` : ""}
        ${usa.accountNumber ? `<span class="bank-cell"><b>Account</b>${usa.accountNumber}</span>` : ""}
        ${usa.swift ? `<span class="bank-cell"><b>SWIFT / BIC</b>${usa.swift}</span>` : ""}
      </div>
    </div>` : ""}
  </div>

  ${footer ? `<div class="page-footer">${footer}</div>` : ""}
</div>
</body></html>`;
}

/**
 * Abre una nueva ventana con el HTML del invoice y dispara el diálogo de impresión.
 * El usuario puede elegir "Guardar como PDF" en el diálogo.
 */
export function printInvoice(html) {
  const w = window.open("", "_blank");
  if (!w) { console.warn("printInvoice: popup bloqueado"); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
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
