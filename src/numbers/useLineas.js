import { useState } from "react";

export const newLinea = (cc = "") => ({ id: Date.now() + Math.random(), cc, subtotal: "", ivaRate: 21 });

export function useLineas(initial) {
  const [lineas, setLineas] = useState(initial);

  const updLinea = (id, key, val) =>
    setLineas(prev => prev.map(l => l.id === id ? { ...l, [key]: val } : l));

  const addLinea = () => setLineas(prev => [...prev, newLinea()]);

  const delLinea = (id) => setLineas(prev => {
    const next = prev.filter(l => l.id !== id);
    return next.length > 0 ? next : [newLinea()];
  });

  return { lineas, setLineas, updLinea, addLinea, delLinea };
}
