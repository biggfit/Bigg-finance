import { useState, useRef, useCallback } from "react";
import ConfirmModal from "./ConfirmModal";

// Reemplazo de window.confirm por un modal in-app (inmune al bloqueo de diálogos de Chrome, que tras
// varios confirm() seguidos o con "impedir cuadros de diálogo adicionales" los desactiva en silencio
// y dejaba los borrados mudos). API tipo promesa para que el cambio en cada sitio sea casi 1:1:
//
//   const [confirm, confirmUI] = useConfirm();
//   const handleX = async () => { if (!(await confirm("¿Eliminar?"))) return; ...hacer... };
//   return (<>{...}{confirmUI}</>);
//
// `confirm` acepta un string (mensaje) o un objeto { title, message, confirmLabel, cancelLabel, danger }.
export function useConfirm() {
  const [opts, setOpts] = useState(null);
  const resolver = useRef(null);
  const confirm = useCallback((arg) => new Promise((resolve) => {
    resolver.current = resolve;
    setOpts(typeof arg === "string" ? { message: arg } : (arg || {}));
  }), []);
  const finish = (val) => { const r = resolver.current; resolver.current = null; setOpts(null); r?.(val); };
  const confirmUI = (
    <ConfirmModal open={!!opts} title={opts?.title} message={opts?.message}
      confirmLabel={opts?.confirmLabel ?? "Sí"} cancelLabel={opts?.cancelLabel ?? "No"}
      danger={opts?.danger ?? true} onConfirm={() => finish(true)} onCancel={() => finish(false)} />
  );
  return [confirm, confirmUI];
}
