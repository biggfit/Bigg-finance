import { useState } from "react";

export const newLinea = (cc = "", ivaRate = 21) => ({ id: Date.now() + Math.random(), cc, subtotal: "", ivaRate });

// ivaDefault = alicuota general del pais de la sociedad (ver ivaDefaultDeSociedad). Queda 21 como
// fallback para no cambiarle el comportamiento a ningun caller que no lo pase.
export function useLineas(initial, ivaDefault = 21) {
  const [lineas, setLineas] = useState(initial);

  const updLinea = (id, key, val) =>
    setLineas(prev => prev.map(l => l.id === id ? { ...l, [key]: val } : l));

  const addLinea = () => setLineas(prev => [...prev, newLinea("", ivaDefault)]);

  const delLinea = (id) => setLineas(prev => {
    const next = prev.filter(l => l.id !== id);
    return next.length > 0 ? next : [newLinea("", ivaDefault)];
  });

  return { lineas, setLineas, updLinea, addLinea, delLinea };
}
