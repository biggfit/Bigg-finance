// Borrador local de una grilla de novedades: lo que se edita sin guardar queda en localStorage (solo esta
// máquina/navegador) y se recupera al volver a la pantalla. Lo definitivo sigue siendo "Guardar", que
// escribe en la planilla.
export function readDraft(key) {
  try {
    const d = JSON.parse(localStorage.getItem(key) || "null");
    return d && Array.isArray(d.rows) ? d : null;
  } catch { return null; }
}

// `extra`: datos adicionales que la pantalla necesite para recuperar el borrador (ej: firmas de filas).
export function writeDraft(key, rows, extra = {}) {
  try { localStorage.setItem(key, JSON.stringify({ ...extra, ts: Date.now(), rows })); } catch { /* localStorage no disponible */ }
}

export function clearDraft(key) {
  try { localStorage.removeItem(key); } catch { /* localStorage no disponible */ }
}
