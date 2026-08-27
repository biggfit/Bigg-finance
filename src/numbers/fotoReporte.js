// "Foto" de un reporte: toma un nodo del DOM (una tabla de P&L) y lo rasteriza a PNG SIN librerías externas,
// usando el truco de SVG <foreignObject> (serializa el HTML dentro de un SVG y lo dibuja en un <canvas>).
// Se usa para (a) "Ampliar" (mostrar el reporte como foto a pantalla completa) y (b) "Copiar imagen" para
// pegar en PowerPoint. Corre SOLO al hacer click → no afecta la performance del render normal.
//
// Notas:
// - Serializamos con XMLSerializer (NO outerHTML): el foreignObject exige XML BIEN FORMADO, y outerHTML mete
//   entidades HTML (&nbsp;, & crudos) que rompen el parseo del SVG. XMLSerializer escapa/numera todo.
// - La imagen NO hereda las fuentes de la página (el SVG se renderiza aislado) → forzamos una tipografía de
//   sistema limpia (Arial/Segoe). Se ve prolijo en PowerPoint.
// - El ancho se toma del scrollWidth real (la tabla suele desbordar un contenedor con scroll); max-content en
//   tablas con columnas sticky puede dispararse a un número absurdo.

// Ancho real del contenido de un nodo (contando lo que desborda por scroll horizontal).
function anchoReal(node) {
  let w = node.offsetWidth;
  node.querySelectorAll("*").forEach(el => { if (el.scrollWidth > w) w = el.scrollWidth; });
  return w;
}

// Extensión REAL renderizada de un nodo (píxel más a la derecha/abajo de cualquier descendiente, relativo a su
// esquina). Robusto ante padding / box-sizing / contenido que desborda (evita que se corte la última columna).
export function medirContenido(node, pad = 8) {
  const base = node.getBoundingClientRect();
  let right = node.offsetWidth, bottom = node.offsetHeight;
  node.querySelectorAll("*").forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.right - base.left > right) right = r.right - base.left;
    if (r.bottom - base.top > bottom) bottom = r.bottom - base.top;
  });
  return { w: Math.ceil(right) + pad, h: Math.ceil(bottom) + pad };
}

// Clona un nodo, neutraliza los scrolls internos para que quede a su ANCHO COMPLETO (sin recorte), le antepone
// un encabezado opcional (título / año / moneda), lo cuelga fuera de pantalla y devuelve el clon medible.
// El llamador debe removerlo (clon.remove()).
export function clonarParaFoto(src, { bg = "#ffffff", padding = 18, caption = null } = {}) {
  const contentW = anchoReal(src);
  const clon = src.cloneNode(true);
  // Apagar TODO scroll/recorte para que la tabla entre entera (sin barra de scroll). Se hace incondicional
  // (no con getComputedStyle) porque el clon todavía no está en el DOM → getComputedStyle daría vacío.
  clon.querySelectorAll("*").forEach(el => {
    el.style.overflow = "visible";
    el.style.maxHeight = "none";
    // La columna/encabezado "sticky" (left:0 / top:0) sirve para scrollear; en una foto estática se pega al
    // borde y TAPA las primeras columnas (ENE/FEB). En el clon lo pasamos a flujo normal.
    if (el.style.position === "sticky") { el.style.position = "static"; }
  });
  if (caption) {
    const h = document.createElement("div");
    h.textContent = caption;
    Object.assign(h.style, {
      fontSize: "16px", fontWeight: "800", color: "#0f172a", letterSpacing: "-.01em",
      padding: "0 0 10px", marginBottom: "12px", borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap",
    });
    clon.insertBefore(h, clon.firstChild);
  }
  Object.assign(clon.style, {
    position: "fixed", left: "-99999px", top: "0", width: `${contentW + padding * 2}px`,
    maxWidth: "none", maxHeight: "none", overflow: "visible", boxSizing: "border-box",
    background: bg, padding: `${padding}px`, boxShadow: "none", borderRadius: "14px",
  });
  document.body.appendChild(clon);
  return clon;
}

// Rasteriza un nodo (idealmente ya expandido con clonarParaFoto) a un Blob PNG.
export async function nodoAPngBlob(node, { scale = 2, bg = "#ffffff" } = {}) {
  const { w, h } = medirContenido(node);
  const clone = node.cloneNode(true);
  // El nodo fuente vive fuera de pantalla (position:fixed; left:-99999px) para poder medirlo. Si serializo eso,
  // en el SVG queda posicionado fuera del lienzo → imagen EN BLANCO. Lo traigo al origen antes de rasterizar.
  clone.style.position = "static"; clone.style.left = "auto"; clone.style.top = "auto"; clone.style.margin = "0";
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  const xml = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;background:${bg};">` +
    `<style>*{font-family:Arial,'Segoe UI',Helvetica,sans-serif !important;box-sizing:border-box;}</style>` +
    xml +
    `</div></foreignObject></svg>`;
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("no se pudo renderizar el SVG")); img.src = url; });
  const canvas = document.createElement("canvas");
  canvas.width = w * scale; canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.drawImage(img, 0, 0);
  return await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("toBlob vacío")), "image/png"));
}

// Copia el reporte (nodo del DOM) al portapapeles como imagen PNG (para pegar en PowerPoint).
export async function copiarReporteComoImagen(src, opts = {}) {
  const clon = clonarParaFoto(src, opts);
  try {
    const blob = await nodoAPngBlob(clon, opts);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  } finally {
    clon.remove();
  }
}
