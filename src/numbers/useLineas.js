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

  // "Dividir costo": agrega una línea y reparte la suma de los subtotales en partes iguales entre todas las líneas
  // (1000 en una → 500 + 500 → 333,33 ×3 → 250 ×4). Cada línea conserva su centro e IVA; la nueva copia el IVA
  // de la última y queda sin centro. El redondeo a centavos va a la última línea para que la suma no se mueva.
  const dividirLinea = () => setLineas(prev => {
    const r2 = n => Math.round(n * 100) / 100;
    const total = r2(prev.reduce((a, l) => a + (Number(l.subtotal) || 0), 0));
    const next = [...prev, newLinea("", prev.length ? prev[prev.length - 1].ivaRate : ivaDefault)];
    const n = next.length;
    const parte = Math.floor(total / n * 100) / 100;
    const resto = r2(total - parte * n);
    return next.map((l, i) => ({ ...l, subtotal: r2(i === n - 1 ? parte + resto : parte).toFixed(2) }));   // "918.70", no "918.7"
  });

  return { lineas, setLineas, updLinea, addLinea, delLinea, dividirLinea };
}
