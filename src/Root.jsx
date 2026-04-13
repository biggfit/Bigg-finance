import { useState } from "react";
import App from "./App";
import NumbersApp from "./NumbersApp";

// ─── ROOT: switch entre BIGG Numbers y Bigg Franquicias ───────────────────
// App.jsx (Franquicias) no se toca internamente — zero cambios.
// El botón "← BIGG Numbers" se superpone como overlay fijo.
export default function Root() {
  const [activeApp, setActiveApp] = useState("numbers");

  if (activeApp === "franquicias") {
    return (
      <div>
        <App />
        {/* Botón flotante para volver — overlay sobre App sin tocar su código */}
        <button
          onClick={() => setActiveApp("numbers")}
          title="Volver a BIGG Numbers"
          style={{
            position: "fixed", bottom: 20, right: 20, zIndex: 9999,
            background: "var(--bg2)", border: "1px solid rgba(173,255,25,.35)",
            color: "var(--accent)", borderRadius: 999,
            padding: "7px 16px", fontSize: 11,
            fontFamily: "var(--font)", cursor: "pointer",
            fontWeight: 700, letterSpacing: ".06em",
            display: "flex", alignItems: "center", gap: 6,
            boxShadow: "0 4px 20px rgba(0,0,0,.4)",
            transition: "all .15s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(173,255,25,.12)"}
          onMouseLeave={e => e.currentTarget.style.background = "var(--bg2)"}
        >
          ← BIGG Numbers
        </button>
      </div>
    );
  }

  return (
    <NumbersApp onGoToFranquicias={() => setActiveApp("franquicias")} />
  );
}
