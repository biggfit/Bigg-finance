import { useState, useEffect, useCallback } from "react";
import { fetchCierres, cerrarPeriodo, reabrirPeriodo } from "../lib/numbersApi";

export function useCierres(sociedad) {
  const [cierres,  setCierres]  = useState([]);
  const [loading,  setLoading]  = useState(false);

  const reload = useCallback(async () => {
    if (!sociedad) return;
    setLoading(true);
    try {
      const data = await fetchCierres(sociedad);
      setCierres(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("[useCierres]", e);
    } finally {
      setLoading(false);
    }
  }, [sociedad]);

  useEffect(() => { reload(); }, [reload]);

  // Devuelve true si el período está cerrado (usa el registro más reciente)
  const isCerrado = useCallback((año, mes) => {
    const matches = cierres.filter(c =>
      c.sociedad === sociedad &&
      Number(c.año) === Number(año) &&
      Number(c.mes) === Number(mes),
    );
    if (matches.length === 0) return false;
    const latest = [...matches].sort((a, b) =>
      (b.cerrado_at ?? "").localeCompare(a.cerrado_at ?? ""),
    )[0];
    return latest.estado === "cerrado";
  }, [cierres, sociedad]);

  const _getCierreId = useCallback((año, mes) => {
    const matches = cierres.filter(c =>
      c.sociedad === sociedad &&
      Number(c.año) === Number(año) &&
      Number(c.mes) === Number(mes) &&
      c.estado === "cerrado",
    );
    if (matches.length === 0) return null;
    return [...matches].sort((a, b) =>
      (b.cerrado_at ?? "").localeCompare(a.cerrado_at ?? ""),
    )[0].id;
  }, [cierres, sociedad]);

  const cerrar = useCallback(async (año, mes) => {
    await cerrarPeriodo({ sociedad, año, mes });
    await reload();
  }, [sociedad, reload]);

  const reabrir = useCallback(async (año, mes) => {
    const id = _getCierreId(año, mes);
    if (!id) return;
    await reabrirPeriodo(id);
    await reload();
  }, [_getCierreId, reload]);

  return { cierres, loading, isCerrado, cerrar, reabrir };
}
