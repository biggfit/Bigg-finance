import { useState, useEffect } from "react";
import App        from "./App";
import NumbersApp from "./NumbersApp";
import SueldosApp from "./SueldosApp";
import ReportesApp from "./ReportesApp";
import Login      from "./numbers/Login";
import { sesionActual, cerrarSesion } from "./lib/auth";

// ─── ROOT: switch entre BIGG Numbers, Bigg Franquicias, BIGG Sueldos y BIGG Reportes ──────
export default function Root() {
  // Persistido: al refrescar (F5) la app se remonta; sin esto activeApp volvía siempre a "numbers"
  // y sacaba al usuario de Sueldos/Franquicias a Numbers. Se guarda en localStorage como activeCompany.
  const [activeApp, setActiveApp] = useState(() => {
    try { return localStorage.getItem("activeApp") || "numbers"; } catch { return "numbers"; }
  });
  useEffect(() => { try { localStorage.setItem("activeApp", activeApp); } catch { /* storage no disponible */ } }, [activeApp]);
  // Gate de login: sin sesión NO se renderiza ninguna app. La sesión se lee en el
  // inicializador (no en efecto) para no parpadear al Login en el doble-montaje de StrictMode.
  const [sesion, setSesion] = useState(sesionActual);
  const salir = () => { cerrarSesion(); setSesion(null); };

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

  if (!sesion) return <Login onLogin={setSesion} />;

  if (activeApp === "franquicias") {
    return <App onVolverNumbers={() => setActiveApp("numbers")} />;
  }

  if (activeApp === "sueldos") {
    return <SueldosApp onVolver={() => setActiveApp("numbers")} />;
  }

  // BIGG Reportes: los mismos reportes de Numbers, solo lectura, con sidebar propio (sin selector de sociedad).
  if (activeApp === "reportes") {
    return <ReportesApp onVolver={() => setActiveApp("numbers")} />;
  }

  return (
    <NumbersApp
      onGoToFranquicias={() => setActiveApp("franquicias")}
      onGoToSueldos={() => setActiveApp("sueldos")}
      onGoToReportes={() => setActiveApp("reportes")}
      sesion={sesion}
      onCerrarSesion={salir}
    />
  );
}
