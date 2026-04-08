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

function buildInvoicePDF(fr, franchisor, comp) {
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
export async function fetchLogoDataUrl(url) {
  try {
    const abs = url.startsWith("http") ? url : window.location.origin + (url.startsWith("/") ? url : `/${url}`);
    const res  = await fetch(abs);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

export function buildCCHtml(frName, frRazonSocial, lines, currency, ccMonth, ccYear, logoDataUrl = null, empresa = null) {
  const SYM = { ARS: "$", USD: "U$D", EUR: "€" };
  const sym = SYM[currency] ?? "$";
  const fmtImporte = v => `${v >= 0 ? "" : "-"}${sym}\u202f${Math.abs(v).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;
  const fmtSaldo   = v => `${v >= 0 ? "+" : "-"}${sym}\u202f${Math.abs(v).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;

  // ── Separar apertura de movimientos del mes ──
  const apertura = lines.find(l => l.type === "apertura");
  const movs     = lines.filter(l => l.type !== "apertura");
  const saldoAnterior = apertura?.saldo ?? 0;
  const totalDebe      = movs.reduce((a, l) => a + (l.debit ?? 0), 0);
  const totalHaber     = movs.reduce((a, l) => a + (l.credit ?? 0), 0);
  const totalFacturado = movs.filter(l => l.type?.startsWith("FACTURA")).reduce((a, l) => a + (l.debit ?? 0), 0);
  const totalNC        = movs.filter(l => l.type?.startsWith("NC")).reduce((a, l) => a + (l.credit ?? 0), 0);
  const totalCobros    = movs.filter(l => ["PAGO","PAGO_PAUTA","PAGO_ENVIADO"].includes(l.type)).reduce((a, l) => a + (l.credit ?? 0), 0);

  // ── Filas con IMPORTE y TOTAL MES acumulado ──
  let runningMes = 0;
  const movsRows = movs.map((l, i) => {
    const label   = COMP_TYPES[l.type]?.label ?? l.type;
    const sc      = l.saldo > 0.01 ? "#dc2626" : l.saldo < -0.01 ? "#16a34a" : "#6b7280";
    const bg      = i % 2 === 0 ? "#ffffff" : "#f9fafb";
    const importe = (l.debit ?? 0) - (l.credit ?? 0);
    const impColor = importe > 0.01 ? "#dc2626" : importe < -0.01 ? "#16a34a" : "#6b7280";
    runningMes += importe;
    const mesColor = runningMes > 0.01 ? "#dc2626" : runningMes < -0.01 ? "#16a34a" : "#6b7280";
    return `<tr style="background:${bg}">
      <td style="padding:7px 10px;font-family:monospace;font-size:12px;color:#6b7280;white-space:nowrap">${l.date ?? "—"}</td>
      <td class="mob-hide" style="padding:7px 10px;font-family:monospace;font-size:11px;color:#1d4ed8;font-weight:700">${l.invoice ?? "—"}</td>
      <td style="padding:7px 10px;font-size:11px;color:#374151">${label}</td>
      <td class="mob-hide" style="padding:7px 10px;font-size:11px;color:#6b7280;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.nota ?? l.ref ?? "—"}</td>
      <td style="padding:7px 10px;font-family:monospace;font-size:12px;font-weight:700;text-align:right;color:${impColor};white-space:nowrap">${fmtImporte(importe)}</td>
      <td style="padding:7px 10px;font-family:monospace;font-size:12px;font-weight:700;text-align:right;color:${mesColor};white-space:nowrap">${fmtSaldo(runningMes)}</td>
      <td class="mob-hide" style="padding:7px 10px;font-family:monospace;font-size:12px;font-weight:700;text-align:right;color:${sc};white-space:nowrap">${fmtSaldo(l.saldo)}</td>
    </tr>`;
  }).join("");

  const saldoFinal = lines.length ? lines[lines.length - 1].saldo : 0;
  const scFinal    = saldoFinal > 0.01 ? "#dc2626" : saldoFinal < -0.01 ? "#16a34a" : "#6b7280";
  const scAnterior = saldoAnterior > 0.01 ? "#dc2626" : saldoAnterior < -0.01 ? "#16a34a" : "#6b7280";

  // Fecha de cierre: último día del mes informado
  const pad2     = n => String(n).padStart(2, "0");
  const baseM    = ccMonth  ?? new Date().getMonth();
  const baseY    = ccYear   ?? new Date().getFullYear();
  const mesLabel = `${MONTHS[baseM]} ${baseY}`;
  const nextM    = baseM === 11 ? 0  : baseM + 1;
  const nextY    = baseM === 11 ? baseY + 1 : baseY;
  const dueDay   = saldoFinal > 0.01 ? 10 : 20;
  const dueDate  = `${pad2(dueDay)}/${pad2(nextM + 1)}/${nextY}`;
  const dueLabel = saldoFinal > 0.01 ? "Vencimiento" : saldoFinal < -0.01 ? "Acreditación estimada" : "";

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>Estado de Cuenta — ${frName}</title>
<style>:root{color-scheme:light only}

@media only screen and (max-width:620px){
  .mob-hide{display:none !important}
  .sum-cell{display:block !important;width:100% !important;box-sizing:border-box !important;border-left:none !important;border-right:none !important;border-bottom:1px solid #e5e7eb !important}
  .sum-cell:last-child{border-bottom:none !important}
  .sum-bg{background:#fff !important}
  .hpad{padding-left:16px !important;padding-right:16px !important}
}
</style>
</head>
<body style="margin:0;padding:0;font-family:'Helvetica Neue',Arial,sans-serif;background:#fff;color:#111;-webkit-text-size-adjust:100%">
<div style="width:100%;background:#fff">

  <!-- HEADER -->
  <div class="hpad" style="background:#111 !important;padding:24px 32px">
    <div style="font-size:20px;font-weight:800;color:#adff19;letter-spacing:-.02em">${frName}</div>
    ${frRazonSocial ? `<div style="font-size:12px;color:rgba(255,255,255,.5);margin-top:3px">${frRazonSocial}</div>` : ""}
    <div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:5px">Estado de Cuenta · ${currency} · ${mesLabel}${empresa ? ` · <span style="color:rgba(255,255,255,.5)">${empresa}</span>` : ""}</div>
  </div>

  <!-- RESUMEN -->
  <div style="background:#f9fafb !important;border-bottom:1px solid #e5e7eb">
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <td class="sum-cell" style="padding:16px 0;text-align:center;width:33%">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:4px">Saldo anterior</div>
          <div style="font-family:monospace;font-size:16px;font-weight:700;color:${scAnterior}">${fmtSaldo(saldoAnterior)}</div>
        </td>
        <td class="sum-cell sum-bg" style="padding:14px 12px;text-align:center;width:34%;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;background:#fff">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:8px">${ccMonth === null ? "Movimientos" : `Movimientos ${mesLabel}`}</div>
          ${totalDebe === 0 && totalHaber === 0
            ? `<span style="color:#9ca3af;font-size:13px;font-weight:400">sin movimientos</span>`
            : `<table style="width:100%;border-collapse:collapse;font-size:11px">
            ${totalFacturado > 0 ? `<tr><td style="color:#6b7280;padding:1px 4px;text-align:left">Facturado</td><td style="font-family:monospace;font-weight:700;color:#dc2626;text-align:right;padding:1px 4px">${fmtSaldo(totalFacturado)}</td></tr>` : ""}
            ${totalNC        > 0 ? `<tr><td style="color:#6b7280;padding:1px 4px;text-align:left">NC</td><td style="font-family:monospace;font-weight:700;color:#16a34a;text-align:right;padding:1px 4px">${fmtSaldo(-totalNC)}</td></tr>` : ""}
            ${totalCobros    > 0 ? `<tr><td style="color:#6b7280;padding:1px 4px;text-align:left">Cobros</td><td style="font-family:monospace;font-weight:700;color:#16a34a;text-align:right;padding:1px 4px">${fmtSaldo(-totalCobros)}</td></tr>` : ""}
            <tr><td colspan="2" style="padding:3px 4px 1px"><div style="border-top:1px solid #e5e7eb"></div></td></tr>
            <tr><td style="color:#374151;font-weight:600;padding:1px 4px;text-align:left">Neto</td><td style="font-family:monospace;font-size:13px;font-weight:800;color:${(totalDebe-totalHaber)>0.01?"#dc2626":(totalDebe-totalHaber)<-0.01?"#16a34a":"#6b7280"};text-align:right;padding:1px 4px">${fmtSaldo(totalDebe-totalHaber)}</td></tr>
          </table>`}
        </td>
        <td class="sum-cell" style="padding:16px 0;text-align:center;width:33%">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:4px">Nuevo saldo</div>
          <div style="font-family:monospace;font-size:16px;font-weight:800;color:${scFinal}">${fmtSaldo(saldoFinal)}</div>
          ${dueLabel ? `<div style="font-size:10px;color:#6b7280;margin-top:5px">${dueLabel}: <strong style="color:#111">${dueDate}</strong></div>` : ""}
        </td>
      </tr>
    </table>
  </div>

  <!-- DETALLE -->
  <div style="overflow-x:auto;padding:16px 16px 0">
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="border-bottom:2px solid #e5e7eb">
          <th style="padding:8px 10px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Fecha</th>
          <th class="mob-hide" style="padding:8px 10px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;font-weight:600">N° Comprobante</th>
          <th style="padding:8px 10px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Tipo</th>
          <th class="mob-hide" style="padding:8px 10px;text-align:left;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Descripción</th>
          <th style="padding:8px 10px;text-align:right;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Importe</th>
          <th style="padding:8px 10px;text-align:right;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Total mes</th>
          <th class="mob-hide" style="padding:8px 10px;text-align:right;font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Saldo</th>
        </tr>
      </thead>
      <tbody>${movsRows}</tbody>
    </table>
  </div>

  <!-- LEGAL -->
  <div class="hpad" style="padding:14px 32px;background:#111 !important;text-align:center;margin-top:20px">
    <div style="font-size:10px;color:rgba(255,255,255,.3)">Este es un resumen informativo de tu cuenta corriente. Los comprobantes fiscales se adjuntan en este correo.</div>
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
 * Convierte un Blob a base64 (para adjuntar PDFs vía Apps Script).
 */
export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(chunks.join(""));
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
function buildInvoiceHtml(fr, franchisor, comp) {
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

  // Datos bancarios — elige USD o EUR según moneda
  const isEUR = comp.currency === "EUR" && usa.bankNameEUR;
  const hasBankInfo = isEUR
    ? (usa.bankNameEUR || usa.ibanEUR || usa.swiftEUR || usa.accountNumberEUR)
    : (usa.bankName || usa.routingNumber || usa.accountNumber || usa.swift);

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
      <div class="bank-title">Wire Transfer Instructions${isEUR ? " (EUR)" : ""}</div>
      <div class="bank-grid">
        ${isEUR ? `
        ${usa.intermediaryBankEUR ? `<span class="bank-cell"><b>Intermediary Bank</b>${usa.intermediaryBankEUR}</span>` : ""}
        ${usa.intermediarySwiftEUR ? `<span class="bank-cell"><b>Intermediary SWIFT</b>${usa.intermediarySwiftEUR}</span>` : ""}
        ${usa.bankNameEUR ? `<span class="bank-cell"><b>Beneficiary Bank</b>${usa.bankNameEUR}</span>` : ""}
        ${usa.bankAddressEUR ? `<span class="bank-cell"><b>Bank Address</b>${usa.bankAddressEUR}</span>` : ""}
        ${usa.swiftEUR ? `<span class="bank-cell"><b>SWIFT / BIC</b>${usa.swiftEUR}</span>` : ""}
        ${usa.ibanEUR ? `<span class="bank-cell"><b>IBAN</b>${usa.ibanEUR}</span>` : ""}
        ${usa.beneficiaryNameEUR ? `<span class="bank-cell"><b>Account Name</b>${usa.beneficiaryNameEUR}</span>` : ""}
        ${usa.accountNumberEUR ? `<span class="bank-cell"><b>Account #</b>${usa.accountNumberEUR}</span>` : ""}
        ` : `
        ${usa.bankName ? `<span class="bank-cell"><b>Bank</b>${usa.bankName}</span>` : ""}
        ${usa.routingNumber ? `<span class="bank-cell"><b>Routing</b>${usa.routingNumber}</span>` : ""}
        ${usa.accountNumber ? `<span class="bank-cell"><b>Account</b>${usa.accountNumber}</span>` : ""}
        ${usa.swift ? `<span class="bank-cell"><b>SWIFT / BIC</b>${usa.swift}</span>` : ""}
        `}
      </div>
    </div>` : ""}
  </div>

  ${footer ? `<div class="page-footer">${footer}</div>` : ""}
</div>
</body></html>`;
}

/**
 * Combina múltiples HTMLs de invoice (uno por franquicia) en un único documento
 * imprimible con saltos de página entre cada invoice.
 * Útil para el modo CRM/Excel donde se generan varios invoices a la vez.
 */
function buildCombinedInvoicesHtml(htmlArray) {
  if (!htmlArray || htmlArray.length === 0) return "";
  if (htmlArray.length === 1) return htmlArray[0];

  // Extraer CSS del primer invoice (idéntico en todos)
  const cssMatch = htmlArray[0].match(/<style>([\s\S]*?)<\/style>/);
  const css = cssMatch ? cssMatch[1] : "";

  // Extraer contenido del <body> de cada invoice
  const pages = htmlArray.map((html, i) => {
    const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
    const body = bodyMatch ? bodyMatch[1].trim() : html;
    const isLast = i === htmlArray.length - 1;
    return isLast
      ? body
      : `<div style="page-break-after:always;break-after:page">${body}</div>`;
  }).join("\n");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoices (${htmlArray.length})</title>\n<style>${css}</style></head>\n<body>${pages}</body></html>`;
}

/**
 * Abre una nueva ventana con el HTML del invoice y dispara el diálogo de impresión.
 * El usuario puede elegir "Guardar como PDF" en el diálogo.
 */
function printInvoice(html) {
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
