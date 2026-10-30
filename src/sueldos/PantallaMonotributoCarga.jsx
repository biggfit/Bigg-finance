import { useState, useEffect } from "react";
import { fmtMiles, limpiarMonto } from "../lib/sueldosApi";
import { fmtEntero } from "./sueldosUi";

// Página PÚBLICA (sin login) a la que llega cada monotributista desde el mail del día 12:
//   /?monotributo=1&l=<legajo>&p=<yyyy-mm>&t=<firma>
// Carga el importe + comprobante → novedad "pendiente" en la solapa Monotributo de Novedades HQ.
// Backend: apps-script-monotributo.gs vía /api/monotributo.

const T = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#1e293b",
  muted: "#64748b", blue: "#2563eb", red: "#dc2626", green: "#16a34a",
  font: "'Inter', system-ui, sans-serif",
};

const API = "/api/monotributo";
// Vercel corta los requests de más de 4,5 MB; en base64 un archivo crece ~33%.
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_LADO  = 1800;   // px: una foto del celular queda en ~300-600 KB y se lee perfecto

const aBase64 = (blob) => new Promise((ok, mal) => {
  const r = new FileReader();
  r.onload  = () => ok(String(r.result).split(",")[1] || "");
  r.onerror = () => mal(new Error("No se pudo leer el archivo."));
  r.readAsDataURL(blob);
});

// Fotos → JPEG reducido. Si el navegador no puede abrir la imagen (HEIC en Chrome/Windows) se manda tal cual.
async function prepararArchivo(file) {
  if (file.type.startsWith("image/")) {
    try {
      const bmp   = await createImageBitmap(file);
      const k     = Math.min(1, MAX_LADO / Math.max(bmp.width, bmp.height));
      const cv    = document.createElement("canvas");
      cv.width    = Math.round(bmp.width * k);
      cv.height   = Math.round(bmp.height * k);
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob  = await new Promise(ok => cv.toBlob(ok, "image/jpeg", 0.82));
      if (blob) return { nombre: file.name.replace(/\.[^.]+$/, "") + ".jpg", mime: "image/jpeg", base64: await aBase64(blob) };
    } catch { /* formato que el navegador no decodifica: va el original */ }
  }
  if (file.size > MAX_BYTES)
    throw new Error("El archivo pesa más de 3 MB. Probá con una captura de pantalla o una foto del comprobante.");
  return { nombre: file.name, mime: file.type || "application/octet-stream", base64: await aBase64(file) };
}

async function llamar(opts) {
  const res  = await fetch(opts.body ? API : `${API}?${opts.qs}`, opts.body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts.body) }
    : undefined);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("No se pudo conectar. Probá de nuevo en un rato."); }
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function PantallaMonotributoCarga() {
  const q = new URLSearchParams(window.location.search);
  const link = { l: q.get("l") || "", p: q.get("p") || "", t: q.get("t") || "" };

  const [info,    setInfo]    = useState(null);
  const [error,   setError]   = useState("");
  const [monto,   setMonto]   = useState("");
  const [archivo, setArchivo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [listo,   setListo]   = useState(false);

  useEffect(() => {
    llamar({ qs: new URLSearchParams({ accion: "info", ...link }).toString() })
      .then(d => { setInfo(d); if (d.carga) setMonto(String(d.carga.monto || "")); })
      .catch(e => setError(e.message));
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const yaCargado   = info?.carga;
  const aprobado    = yaCargado && yaCargado.estado !== "pendiente";
  const conservaComp = yaCargado?.comprobante_url && !archivo;   // corrección: solo cambia el importe
  const puedeEnviar = parseFloat(monto) > 0 && (archivo || conservaComp) && !enviando;

  const enviar = async () => {
    setEnviando(true); setError("");
    try {
      const arch = archivo ? await prepararArchivo(archivo) : null;
      await llamar({ body: { accion: "cargar", ...link, monto: parseFloat(monto), archivo: arch } });
      setListo(true);
    } catch (e) {
      setError(e.message);
    } finally { setEnviando(false); }
  };

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 22,
    maxWidth: 440, margin: "0 auto", boxShadow: "0 4px 20px rgba(15,23,42,.06)" };
  const label = { display: "block", fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 6 };

  let cuerpo;
  if (!info && !error) {
    cuerpo = <p style={{ color: T.muted, fontSize: 14 }}>Cargando…</p>;
  } else if (!info) {
    cuerpo = <p style={{ color: T.red, fontSize: 14 }}>{error}</p>;
  } else if (listo) {
    cuerpo = (
      <>
        <p style={{ fontSize: 32, margin: "0 0 6px" }}>✅</p>
        <p style={{ fontSize: 15, fontWeight: 600, margin: "0 0 6px" }}>¡Listo, {info.nombre.split(" ")[0]}!</p>
        <p style={{ fontSize: 14, color: T.muted, margin: 0 }}>
          Cargaste ${fmtEntero(parseFloat(monto))} del monotributo de {info.mesLabel}. Te lo devolvemos con la liquidación del mes.
        </p>
      </>
    );
  } else if (aprobado) {
    cuerpo = (
      <p style={{ fontSize: 14, color: T.muted, margin: 0 }}>
        El monotributo de {info.mesLabel} ya está cargado y aprobado (${fmtEntero(yaCargado.monto)}).
        Si hay que corregir algo, escribile a administración.
      </p>
    );
  } else {
    cuerpo = (
      <>
        {yaCargado && (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 8,
            padding: "8px 12px", fontSize: 13, marginBottom: 16 }}>
            Ya cargaste ${fmtEntero(yaCargado.monto)}. Podés corregirlo hasta que se apruebe.
          </div>
        )}

        <label style={label}>Importe que pagaste</label>
        <div style={{ position: "relative", marginBottom: 6 }}>
          <span style={{ position: "absolute", left: 12, top: 11, color: T.muted, fontSize: 16 }}>$</span>
          <input value={fmtMiles(monto)} onChange={e => setMonto(limpiarMonto(e.target.value))}
            inputMode="decimal" placeholder="0" autoFocus
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 26px", fontSize: 16,
              border: `1px solid ${T.border}`, borderRadius: 8, fontFamily: T.font, color: T.text, background: "#fff" }} />
        </div>
        {info.montoAnterior > 0 && (
          <p style={{ fontSize: 12, color: T.muted, margin: "0 0 16px" }}>Mes anterior: ${fmtEntero(info.montoAnterior)}</p>
        )}

        <label style={{ ...label, marginTop: info.montoAnterior > 0 ? 0 : 16 }}>Comprobante de pago</label>
        <label style={{ display: "block", border: `1.5px dashed ${archivo ? T.green : T.border}`, borderRadius: 8,
          padding: "16px 12px", textAlign: "center", cursor: "pointer", fontSize: 14,
          color: archivo ? T.green : T.blue, background: archivo ? "#f0fdf4" : T.bg }}>
          {archivo ? `📎 ${archivo.name}` : conservaComp ? "📎 Comprobante ya subido — tocá para cambiarlo" : "📎 Elegí el archivo o sacá una foto"}
          <input type="file" accept="image/*,application/pdf,.pdf,.heic,.heif" style={{ display: "none" }}
            onChange={e => { setArchivo(e.target.files?.[0] || null); setError(""); }} />
        </label>
        <p style={{ fontSize: 12, color: T.muted, margin: "6px 0 18px" }}>PDF, foto o captura de pantalla.</p>

        {error && <p style={{ color: T.red, fontSize: 13, margin: "0 0 12px" }}>{error}</p>}

        <button onClick={enviar} disabled={!puedeEnviar}
          style={{ width: "100%", padding: "12px", fontSize: 15, fontWeight: 600, border: "none", borderRadius: 8,
            background: T.blue, color: "#fff", cursor: puedeEnviar ? "pointer" : "default",
            opacity: puedeEnviar ? 1 : 0.5, fontFamily: T.font }}>
          {enviando ? "Enviando…" : yaCargado ? "Guardar corrección" : "Enviar"}
        </button>
      </>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.font, color: T.text, padding: "32px 16px", boxSizing: "border-box" }}>
      <div style={card}>
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", color: T.muted, margin: "0 0 4px" }}>BIGG · MONOTRIBUTO</p>
        {info && (
          <h1 style={{ fontSize: 19, fontWeight: 700, margin: "0 0 18px" }}>
            {info.nombre} — <span style={{ textTransform: "capitalize" }}>{info.mesLabel}</span>
          </h1>
        )}
        {cuerpo}
      </div>
    </div>
  );
}
