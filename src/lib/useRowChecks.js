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

  return { checked, toggle };
}
