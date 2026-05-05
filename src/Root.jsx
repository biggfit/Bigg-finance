import { useState } from "react";
import App from "./App";
import NumbersApp from "./NumbersApp";

// ─── ROOT: switch entre BIGG Numbers y Bigg Franquicias ───────────────────
// App.jsx (Franquicias) no se toca internamente — zero cambios.
// El botón "← BIGG Numbers" se superpone como overlay fijo.
export default function Root() {
  const [activeApp, setActiveApp] = useState("franquicias");

  if (activeApp === "franquicias") {
    return <App onVolverNumbers={() => setActiveApp("numbers")} />;
  }

  return (
    <NumbersApp onGoToFranquicias={() => setActiveApp("franquicias")} />
  );
}
