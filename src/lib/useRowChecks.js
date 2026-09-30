import { useState, useCallback, useEffect } from "react";

// Marcas "reviewed" persistidas en localStorage: solo en esta máquina/navegador, no viajan al backend.
function readSet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function useRowChecks(storageKey) {
  const [checked, setChecked] = useState(() => readSet(storageKey));

  useEffect(() => { setChecked(readSet(storageKey)); }, [storageKey]);

  const toggle = useCallback((id) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* localStorage no disponible */ }
      return next;
    });
  }, [storageKey]);

  // Marca/desmarca de una todos los ids dados (ej: "tildar todas las filas visibles").
  const setMany = useCallback((ids, value) => {
    setChecked(prev => {
      const next = new Set(prev);
      for (const id of ids) { if (value) next.add(id); else next.delete(id); }
      try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* localStorage no disponible */ }
      return next;
    });
  }, [storageKey]);

  return { checked, toggle, setMany };
}

// Migración de una sola vez. Categorías y Objetivos guardaban sus tildes como UN objeto
// { "AR:2026-8:CONCEPTO": true } bajo una sola clave; ahora usan useRowChecks, que guarda un array de
// ids por clave "<oldKey>:<pais>:<anio>-<mes>". Se convierte lo que haya y se borra la clave vieja, así
// nadie pierde lo que ya tenía tildado. Idempotente: sin clave vieja no hace nada.
export function migrarMarcasAgrupadas(oldKey) {
  try {
    const raw = localStorage.getItem(oldKey);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj || Array.isArray(obj) || typeof obj !== "object") return;
    const porClave = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!v) continue;
      const i = k.lastIndexOf(":");
      if (i < 0) continue;
      (porClave[k.slice(0, i)] ||= []).push(k.slice(i + 1));
    }
    for (const [sub, ids] of Object.entries(porClave)) {
      const nk = `${oldKey}:${sub}`;
      const set = readSet(nk);
      for (const id of ids) set.add(id);
      localStorage.setItem(nk, JSON.stringify([...set]));
    }
    localStorage.removeItem(oldKey);
  } catch { /* localStorage no disponible: se sigue sin migrar */ }
}
