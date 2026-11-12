import { useState, useEffect } from "react";
import { fmtMiles, limpiarMonto } from "../lib/sueldosApi";
import { fmtEntero } from "./sueldosUi";

// Página PÚBLICA (sin login) — formulario de REINTEGRO. Link personal permanente que llega por
// WhatsApp/mail:  /?reintegro=1&l=<legajo>&t=<firma>
// Permite varias líneas (cada gasto: descripción + importe + uno o varios comprobantes). Cada línea
// crea una novedad "Otros" PENDIENTE en Novedades HQ; administración le asigna la cuenta al aprobar.
// Backend: apps-script-reintegro.gs vía /api/reintegro.

const T = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#1e293b",
  muted: "#64748b", blue: "#2563eb", red: "#dc2626", green: "#16a34a",
  font: "'Inter', system-ui, sans-serif",
};

const API = "/api/reintegro";
const MAX_BYTES = 3 * 1024 * 1024;   // Vercel corta >4,5 MB; base64 crece ~33%
const MAX_LADO  = 1800;              // px: una foto del celular queda en ~300-600 KB

const aBase64 = (blob) => new Promise((ok, mal) => {
  const r = new FileReader();
  r.onload  = () => ok(String(r.result).split(",")[1] || "");
  r.onerror = () => mal(new Error("No se pudo leer el archivo."));
  r.readAsDataURL(blob);
});

// Fotos → JPEG reducido. Si el navegador no puede abrir la imagen (HEIC en Chrome/Windows) va tal cual.
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
    throw new Error("El archivo pesa más de 3 MB. Probá con una captura de pantalla o una foto más chica.");
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

let _uid = 0;
const nuevaLinea = () => ({ _id: ++_uid, descripcion: "", monto: "", archivos: [] });

export default function PantallaReintegroCarga() {
  const q = new URLSearchParams(window.location.search);
  const link = { l: q.get("l") || "", t: q.get("t") || "" };

  const [info,     setInfo]     = useState(null);
  const [error,    setError]    = useState("");
  const [lineas,   setLineas]   = useState([nuevaLinea()]);
  const [enviando, setEnviando] = useState(false);
  const [listo,    setListo]    = useState(null);   // { n, total } al terminar

  useEffect(() => {
    llamar({ qs: new URLSearchParams({ accion: "info", ...link }).toString() })
      .then(setInfo)
      .catch(e => setError(e.message));
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const setLinea = (id, patch) => setLineas(prev => prev.map(l => l._id === id ? { ...l, ...patch } : l));
  const addLinea = () => setLineas(prev => [...prev, nuevaLinea()]);
  const delLinea = (id) => setLineas(prev => prev.length > 1 ? prev.filter(l => l._id !== id) : prev);
  const addArchivos = (id, files) => setLineas(prev => prev.map(l =>
    l._id === id ? { ...l, archivos: [...l.archivos, ...files] } : l));
  const delArchivo = (id, idx) => setLineas(prev => prev.map(l =>
    l._id === id ? { ...l, archivos: l.archivos.filter((_, i) => i !== idx) } : l));

  const completa = (l) => l.descripcion.trim() && parseFloat(l.monto) > 0 && l.archivos.length > 0;
  const vacia    = (l) => !l.descripcion.trim() && !(parseFloat(l.monto) > 0) && !l.archivos.length;
  const lineasOk = lineas.filter(completa);
  const total    = lineas.reduce((s, l) => s + (parseFloat(l.monto) || 0), 0);
  // Se puede enviar si hay al menos una completa y ninguna quedó a medias (evita cargas incompletas).
  const puedeEnviar = lineasOk.length > 0 && lineas.every(l => completa(l) || vacia(l)) && !enviando;

  const enviar = async () => {
    setEnviando(true); setError("");
    try {
      const payloadLineas = [];
      for (const l of lineasOk) {
        const comprobantes = [];
        for (const f of l.archivos) comprobantes.push(await prepararArchivo(f));
        payloadLineas.push({ descripcion: l.descripcion.trim(), monto: parseFloat(l.monto), comprobantes });
      }
      const r = await llamar({ body: { accion: "cargar", ...link, lineas: payloadLineas } });
      setListo({ n: r.n ?? payloadLineas.length, total: payloadLineas.reduce((s, x) => s + x.monto, 0) });
    } catch (e) {
      setError(e.message);
    } finally { setEnviando(false); }
  };

  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 22,
    maxWidth: 480, margin: "0 auto", boxShadow: "0 4px 20px rgba(15,23,42,.06)" };
  const label = { display: "block", fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 6 };
  const inputBase = { width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 15,
    border: `1px solid ${T.border}`, borderRadius: 8, fontFamily: T.font, color: T.text, background: "#fff" };

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
          Cargaste {listo.n === 1 ? "1 gasto" : `${listo.n} gastos`} por ${fmtEntero(listo.total)}. Te los reintegramos con la liquidación de {info.mesLabel}.
        </p>
      </>
    );
  } else {
    cuerpo = (
      <>
        <p style={{ fontSize: 13, color: T.muted, margin: "0 0 16px" }}>
          Cargá cada gasto con su importe y el comprobante (PDF, foto o captura). Podés sumar varios.
        </p>

        {lineas.map((l, idx) => (
          <div key={l._id} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, marginBottom: 12, background: "#fcfcfd" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.muted }}>Gasto {idx + 1}</span>
              {lineas.length > 1 && (
                <button onClick={() => delLinea(l._id)}
                  style={{ background: "none", border: "none", color: T.red, fontSize: 13, cursor: "pointer", padding: 0 }}>Quitar</button>
              )}
            </div>

            <label style={label}>¿Qué gasto fue?</label>
            <input value={l.descripcion} onChange={e => setLinea(l._id, { descripcion: e.target.value })}
              placeholder="Ej.: viático shooting Colegiales, librería, impresiones…"
              style={{ ...inputBase, marginBottom: 12 }} />

            <label style={label}>Importe</label>
            <div style={{ position: "relative", marginBottom: 12 }}>
              <span style={{ position: "absolute", left: 12, top: 11, color: T.muted, fontSize: 15 }}>$</span>
              <input value={fmtMiles(l.monto)} onChange={e => setLinea(l._id, { monto: limpiarMonto(e.target.value) })}
                inputMode="decimal" placeholder="0" style={{ ...inputBase, paddingLeft: 26 }} />
            </div>

            <label style={label}>Comprobante(s)</label>
            {l.archivos.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.green,
                background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 7, padding: "7px 10px", marginBottom: 6 }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📎 {f.name}</span>
                <button onClick={() => delArchivo(l._id, i)}
                  style={{ background: "none", border: "none", color: T.red, fontSize: 12, cursor: "pointer", padding: 0 }}>✕</button>
              </div>
            ))}
            <label style={{ display: "block", border: `1.5px dashed ${T.border}`, borderRadius: 8,
              padding: "12px", textAlign: "center", cursor: "pointer", fontSize: 14, color: T.blue, background: T.bg }}>
              {l.archivos.length ? "+ Agregar otro comprobante" : "📎 Elegí el archivo o sacá una foto"}
              <input type="file" accept="image/*,application/pdf,.pdf,.heic,.heif" multiple style={{ display: "none" }}
                onChange={e => { addArchivos(l._id, Array.from(e.target.files || [])); setError(""); e.target.value = ""; }} />
            </label>
          </div>
        ))}

        <button onClick={addLinea}
          style={{ width: "100%", padding: "10px", fontSize: 14, fontWeight: 600, border: `1px dashed ${T.blue}`,
            borderRadius: 8, background: "#fff", color: T.blue, cursor: "pointer", fontFamily: T.font, marginBottom: 16 }}>
          + Agregar otro gasto
        </button>

        {total > 0 && (
          <p style={{ fontSize: 14, fontWeight: 600, textAlign: "right", margin: "0 0 14px" }}>
            Total: ${fmtEntero(total)}
          </p>
        )}

        {error && <p style={{ color: T.red, fontSize: 13, margin: "0 0 12px" }}>{error}</p>}

        <button onClick={enviar} disabled={!puedeEnviar}
          style={{ width: "100%", padding: "12px", fontSize: 15, fontWeight: 600, border: "none", borderRadius: 8,
            background: T.blue, color: "#fff", cursor: puedeEnviar ? "pointer" : "default",
            opacity: puedeEnviar ? 1 : 0.5, fontFamily: T.font }}>
          {enviando ? "Enviando…" : "Enviar reintegro"}
        </button>
        <p style={{ fontSize: 12, color: T.muted, margin: "10px 0 0", textAlign: "center" }}>
          Cada gasto necesita descripción, importe y al menos un comprobante.
        </p>
      </>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.font, color: T.text, padding: "32px 16px", boxSizing: "border-box" }}>
      <div style={card}>
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", color: T.muted, margin: "0 0 4px" }}>BIGG · REINTEGRO</p>
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
