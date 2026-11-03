// Estilos, formatos y helpers compartidos por los reportes de compensación de Sedes
// (Compensación · Sedes y Sueldos Sedes · Franquiciados).
import { fmtPesos } from "./sueldosUi";
import { copiarReporteComoImagen } from "../numbers/fotoReporte";

export const T = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#1e293b", muted: "#64748b", dim: "#94a3b8",
  blue: "#2563eb", green: "#16a34a", red: "#dc2626", head: "#f1f5f9", dark: "#1e2022", fluo: "#ADFF19",
  font: "'Inter', system-ui, sans-serif",
};
export const fmt   = (n) => fmtPesos(n, { guion: "vacio" });
export const fmtN  = (n) => (n == null ? "—" : Math.round(Number(n) || 0).toLocaleString("es-AR"));
export const fmtM  = (n) => (n == null ? "—" : `${(Number(n) / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M`);
export const th = { padding: "7px 10px", textAlign: "left", fontWeight: 600, color: T.muted, fontSize: 11, letterSpacing: ".04em",
  borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" };
export const thR = { ...th, textAlign: "right" };
export const td  = { padding: "6px 10px", fontSize: 13, whiteSpace: "nowrap", borderBottom: `1px solid ${T.border}` };
export const tdR = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
export const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: T.muted };
export const sel = { border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: T.font,
  background: "#fff", color: T.text };
export const btn = (primary) => ({ background: primary ? T.blue : "transparent", color: primary ? "#fff" : T.muted,
  border: primary ? "none" : `1px solid ${T.border}`, borderRadius: 7, padding: "7px 14px", fontSize: 13, fontWeight: 600,
  cursor: "pointer", fontFamily: T.font });
export const vacio = { border: `1px dashed ${T.border}`, borderRadius: 8, padding: 40, textAlign: "center", color: T.muted, fontSize: 13 };
export const COLOR_BASE = "#2a78d6", COLOR_INC = "#1baf7a";
export const MSG_COPIADA = "✔ Imagen copiada — pegala en PowerPoint (Ctrl+V).";

export const colsRatio = (esCoach) => [[esCoach ? "$/h tarifa" : "Fijo / mes", "r"], [esCoach ? "$/h c/ incentivos" : "Cobrado / mes", "r"], ...(esCoach ? [["Promedio mensual", "r"]] : []), ["% incentivos", "r"]];

// Copiar como imagen: primero el helper compartido (SVG foreignObject → PNG → portapapeles); si el
// navegador no lo permite, html2canvas (el de los recibos) y, si tampoco deja escribir el portapapeles,
// se descarga el PNG. Así siempre queda una imagen para pegar en PowerPoint. Devuelve el mensaje a mostrar.
export async function copiarImagenReporte(node, { nombre, caption }) {
  try {
    await copiarReporteComoImagen(node, { caption });
    return MSG_COPIADA;
  } catch {
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale: 2 });
      const blob = await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error("sin imagen"))), "image/png"));
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return MSG_COPIADA;
      } catch {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        return `El navegador no deja copiar al portapapeles: se descargó ${nombre}.`;
      }
    } catch { return "No se pudo generar la imagen en este navegador."; }
  }
}

// Descarga el reporte como PNG (para mandarlo por WhatsApp o mail). Devuelve el mensaje a mostrar.
export async function descargarImagenReporte(node, { nombre }) {
  try {
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale: 2 });
    const blob = await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error("sin imagen"))), "image/png"));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return `✔ Se descargó ${nombre}.`;
  } catch { return "No se pudo generar la imagen en este navegador."; }
}
