import { useState } from "react";
import App        from "./App";
import NumbersApp from "./NumbersApp";
import SueldosApp from "./SueldosApp";

// ─── ROOT: switch entre BIGG Numbers, Bigg Franquicias y BIGG Sueldos ──────
export default function Root() {
  const [activeApp, setActiveApp] = useState("numbers");

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
