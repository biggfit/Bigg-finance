import { createContext, useContext } from "react";

// ─── CONTEXT ──────────────────────────────────────────────────────────────────
// Avoids prop-drilling comprobantes/saldoInicial through every modal.
export const StoreCtx = createContext(null);
export const useStore = () => useContext(StoreCtx);
