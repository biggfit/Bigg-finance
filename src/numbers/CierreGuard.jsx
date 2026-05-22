import { useState, useCallback } from "react";
import { T } from "./theme";

const MONTHS_FULL = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

/**
 * useCierreGuard — envuelve una acción de guardar/eliminar con un check de período cerrado.
 *
 * Uso:
 *   const { guardSave, CierreModal } = useCierreGuard(isCerrado);
 *
 *   const handleSave = async () => {
 *     const ok = await guardSave(fecha);   // fecha en formato YYYY-MM-DD
 *     if (!ok) return;
 *     // continuar con el guardado...
 *   };
 *
 *   return <>{CierreModal}<TuFormulario /></>;
 */
export function useCierreGuard(isCerrado) {
  const [pendingResolve, setPendingResolve] = useState(null);
  const [periodInfo,     setPeriodInfo]     = useState(null);

  const guardSave = useCallback((fecha) => {
    if (!fecha || !isCerrado) return Promise.resolve(true);
    // Soporta YYYY-MM-DD y DD/MM/YYYY
    let año, mes;
    if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      const d = new Date(fecha + "T00:00:00");
      año = d.getFullYear();
      mes = d.getMonth() + 1;
    } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) {
      const parts = fecha.split("/");
      mes = Number(parts[1]);
      año = Number(parts[2]);
    } else {
      return Promise.resolve(true);
    }
    if (!isCerrado(año, mes)) return Promise.resolve(true);

    return new Promise((resolve) => {
      setPeriodInfo({ año, mes });
      setPendingResolve(() => resolve);
    });
  }, [isCerrado]);

  const confirm = useCallback(() => {
    pendingResolve?.(true);
    setPendingResolve(null);
    setPeriodInfo(null);
  }, [pendingResolve]);

  const cancel = useCallback(() => {
    pendingResolve?.(false);
    setPendingResolve(null);
    setPeriodInfo(null);
  }, [pendingResolve]);

  const CierreModal = pendingResolve ? (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.6)",
        zIndex: 700, display: "flex", alignItems: "center",
        justifyContent: "center", padding: 16,
      }}
      onClick={cancel}
    >
      <div
        className="fade"
        style={{
          background: T.card, borderRadius: 12, width: 420, maxWidth: "95vw",
          boxShadow: "0 24px 64px rgba(0,0,0,.45)", overflow: "hidden",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ background: "#92400e", padding: "14px 22px" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>
            Período cerrado
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,.7)", marginTop: 2 }}>
            {MONTHS_FULL[(periodInfo?.mes ?? 1) - 1]} {periodInfo?.año}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 22px" }}>
          <p style={{ fontSize: 13, color: T.text, margin: "0 0 18px", lineHeight: 1.65 }}>
            Este período ya fue cerrado. Si necesitás hacer este cambio, podés confirmar
            igual — el período seguirá cerrado pero quedará registrada la modificación.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              onClick={cancel}
              style={{
                padding: "8px 18px", borderRadius: 8, fontSize: 13,
                background: "rgba(255,255,255,.06)", border: `1px solid ${T.cardBorder}`,
                color: T.muted, fontFamily: T.font, cursor: "pointer", fontWeight: 600,
              }}
            >
              Cancelar
            </button>
            <button
              onClick={confirm}
              style={{
                padding: "8px 18px", borderRadius: 8, fontSize: 13,
                background: "#dc2626", border: "none",
                color: "#fff", fontFamily: T.font, cursor: "pointer", fontWeight: 700,
              }}
            >
              Confirmar igualmente
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { guardSave, CierreModal };
}
