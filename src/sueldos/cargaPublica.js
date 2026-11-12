// Helpers compartidos por las páginas PÚBLICAS de carga (sin login): Monotributo y Reintegros.
// Mismo contrato de imagen/base64/fetch para las dos. Ver PantallaMonotributoCarga / PantallaReintegroCarga.

export const T = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#1e293b",
  muted: "#64748b", blue: "#2563eb", red: "#dc2626", green: "#16a34a",
  font: "'Inter', system-ui, sans-serif",
};

// Vercel corta los requests de más de 4,5 MB; en base64 un archivo crece ~33%.
export const MAX_BYTES = 3 * 1024 * 1024;
export const MAX_LADO  = 1800;   // px: una foto del celular queda en ~300-600 KB y se lee perfecto

const aBase64 = (blob) => new Promise((ok, mal) => {
  const r = new FileReader();
  r.onload  = () => ok(String(r.result).split(",")[1] || "");
  r.onerror = () => mal(new Error("No se pudo leer el archivo."));
  r.readAsDataURL(blob);
});

// Fotos → JPEG reducido. Si el navegador no puede abrir la imagen (HEIC en Chrome/Windows) va tal cual.
export async function prepararArchivo(file) {
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

// Llama al proxy público `api` ("/api/monotributo" o "/api/reintegro"). GET con opts.qs, POST con opts.body.
export async function llamar(api, opts) {
  const res  = await fetch(opts.body ? api : `${api}?${opts.qs}`, opts.body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts.body) }
    : undefined);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("No se pudo conectar. Probá de nuevo en un rato."); }
  if (data?.error) throw new Error(data.error);
  return data;
}
