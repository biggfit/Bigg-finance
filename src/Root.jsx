import { useState, useEffect } from "react";
import App        from "./App";
import NumbersApp from "./NumbersApp";
import SueldosApp from "./SueldosApp";

// ─── ROOT: switch entre BIGG Numbers, Bigg Franquicias y BIGG Sueldos ──────
export default function Root() {
  const [activeApp, setActiveApp] = useState("numbers");

  // Al clickear cualquier input de fecha, abrir el calendario nativo (no solo en el iconito).
  useEffect(() => {
    const openPicker = (e) => {
      const el = e.target;
      if (el && el.tagName === "INPUT" && el.type === "date" && !el.disabled && typeof el.showPicker === "function") {
        try { el.showPicker(); } catch { /* requiere gesto de usuario; el click lo es */ }
      }
    };
    document.addEventListener("click", openPicker);
    return () => document.removeEventListener("click", openPicker);
  }, []);

  if (activeApp === "franquicias") {
    return <App onVolverNumbers={() => setActiveApp("numbers")} />;
  }

  if (activeApp === "sueldos") {
    return <SueldosApp onVolver={() => setActiveApp("numbers")} />;
  }

  return (
    <NumbersApp
      onGoToFranquicias={() => setActiveApp("franquicias")}
      onGoToSueldos={() => setActiveApp("sueldos")}
    />
  );
}
