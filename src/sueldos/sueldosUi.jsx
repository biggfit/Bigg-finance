// Piezas que las pantallas de Sueldos tenían copiadas (formato de pesos, tilde de "todas", botón de mes
// marcado). Cada pantalla conserva SU forma de mostrar (con o sin espacio, guión para vacío o para cero):
// eso entra como opción, no se unifica el texto que ve el usuario.
import { useState } from "react";

// ─── Formato ──────────────────────────────────────────────────────────────────
export const fmtEntero = (n) => (Number(n) || 0).toLocaleString("es-AR");

// Pesos sin decimales. `espacio`: "$ 1.234" (Resumen, Sueldos por pagar) o "$1.234" (el resto).
// `guion`: "none" nunca muestra guión; "vacio" lo muestra para null/undefined/"" (0 es "$0": liquidaciones);
// "cero" también para 0 (Legajos).
export function fmtPesos(n, { espacio = false, guion = "none" } = {}) {
  if (guion === "vacio" && !n && n !== 0) return "—";
  const v = Number(n) || 0;
  if (guion === "cero" && !v) return "—";
  return (espacio ? "$ " : "$") + Math.round(v).toLocaleString("es-AR");
}

// ─── Tilde del encabezado: marcar/desmarcar todas las filas como revisadas ────
export function HeaderCheckTodas({ checked, onToggle, accent = "#16a34a" }) {
  return (
    <input type="checkbox" checked={checked} onChange={onToggle}
      title="Marcar/desmarcar todas como revisadas"
      style={{ cursor: "pointer", accentColor: accent }} />
  );
}

// ─── "Mes finalizado" personal (HQ y Sedes) ───────────────────────────────────
// Independiente del estado real de la liquidación: podés marcarlo sin haber cerrado nada, o dejar sin
// marcar un mes ya cerrado si volviste a tocarlo. Solo un recordatorio visual fuerte para no
// confundirse de mes; vive en este navegador (localStorage), no en el backend — no es un dato de
// negocio, es un tilde personal. `storageKey` es la clave de cada pantalla (hqMesesMarcados /
// sedesMesesMarcados); `clave` identifica el mes (`${pais}:${anio}-${mes}`).
export function useMesMarcado(storageKey, clave) {
  const [marcados, setMarcados] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { return {}; }
  });
  const marcado = !!marcados[clave];
  const toggleMarcado = () => setMarcados(prev => {
    const next = { ...prev, [clave]: !prev[clave] };
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage lleno o no disponible */ }
    return next;
  });
  return { marcado, toggleMarcado };
}

export function BotonMesMarcado({ marcado, onToggle, T }) {
  return (
    <button onClick={onToggle}
      title={marcado ? "Marcado por vos como finalizado — click para desmarcar (no afecta la liquidación real)" : "Marcar este mes como finalizado (tilde personal, no afecta la liquidación)"}
      style={{
        background: marcado ? "#334155" : "#fff", color: marcado ? "#fff" : T.muted,
        border: `1px solid ${marcado ? "#334155" : T.border}`, borderRadius: 7,
        padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font,
      }}>
      {marcado ? "✅ Finalizado" : "☐ En proceso"}
    </button>
  );
}
