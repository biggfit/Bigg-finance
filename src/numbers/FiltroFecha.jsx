import { useState, useCallback } from "react";
import { T } from "./theme";

// ─── Helpers ────────────────────────────────────────────────────────────────
const dmyToIso = d => {
  if (!d || !d.includes("/")) return d ?? "";
  const [dd, mm, yy] = d.split("/");
  return `${yy}-${mm}-${dd}`;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const OPCIONES = [
  { id: "todos",         label: "Todos" },
  { id: "hoy",          label: "Hoy" },
  { id: "semana",       label: "Esta semana" },
  { id: "mes_actual",   label: "Mes actual" },
  { id: "mes_anterior", label: "Mes anterior" },
  { id: "año_actual",   label: "Año actual" },
  { id: "año_anterior", label: "Año anterior" },
  { id: "desde_hasta",  label: "Desde – Hasta" },
];

// ─── Hook ───────────────────────────────────────────────────────────────────
export function useFiltroFecha(defaultOpcion = "todos") {
  const [opcion, setOpcion] = useState(defaultOpcion);
  const [desde, setDesde]   = useState("");
  const [hasta, setHasta]   = useState("");

  const inRange = useCallback((fecha) => {
    if (opcion === "todos") return true;
    const iso = dmyToIso(fecha);
    if (!iso) return true;
    const hoy = todayIso();

    switch (opcion) {
      case "hoy": return iso === hoy;

      case "semana": {
        const d   = new Date();
        const dow = d.getDay() || 7;         // Mon=1 … Sun=7
        d.setDate(d.getDate() - dow + 1);    // → lunes
        const lun = d.toISOString().slice(0, 10);
        d.setDate(d.getDate() + 6);
        const dom = d.toISOString().slice(0, 10);
        return iso >= lun && iso <= dom;
      }

      case "mes_actual":   return iso.slice(0, 7) === hoy.slice(0, 7);

      case "mes_anterior": {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - 1);
        return iso.slice(0, 7) === d.toISOString().slice(0, 7);
      }

      case "año_actual":   return iso.slice(0, 4) === hoy.slice(0, 4);

      case "año_anterior": return iso.slice(0, 4) === String(new Date().getFullYear() - 1);

      case "desde_hasta": {
        const d2 = desde || "0000-00-00";
        const h2 = hasta || "9999-12-31";
        return iso >= d2 && iso <= h2;
      }

      default: return true;
    }
  }, [opcion, desde, hasta]);

  return { opcion, setOpcion, desde, setDesde, hasta, setHasta, inRange };
}

// ─── Componente ─────────────────────────────────────────────────────────────
const SEL_STYLE = {
  background: "#f9fafb",
  border: `1px solid ${T.cardBorder}`,
  borderRadius: 8,
  color: T.text,
  padding: "7px 10px",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: T.font,
  outline: "none",
};

const DATE_STYLE = {
  background: "#f9fafb",
  border: `1px solid ${T.cardBorder}`,
  borderRadius: 8,
  color: T.text,
  padding: "6px 10px",
  fontSize: 13,
  fontFamily: T.font,
  outline: "none",
};

export default function FiltroFecha({ opcion, setOpcion, desde, setDesde, hasta, setHasta }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <select value={opcion} onChange={e => setOpcion(e.target.value)} style={SEL_STYLE}>
        {OPCIONES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {opcion === "desde_hasta" && (
        <>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={DATE_STYLE} />
          <span style={{ color: T.muted, fontSize: 13 }}>–</span>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={DATE_STYLE} />
        </>
      )}
    </div>
  );
}
