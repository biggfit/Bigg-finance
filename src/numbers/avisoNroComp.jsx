// Aviso al guardar un comprobante SIN N° de factura.
//
// El reporte fiscal que baja la contadora cruza cada comprobante contra el libro de IVA por su
// número, así que una factura cargada sin él le llega incompleta y hay que volver a buscarla a mano.
// Esto lo avisa en el momento de la carga, que es cuando el dato está a mano.
//
// Es un AVISO, no un bloqueo: en Wellness hay cargas legítimamente sin número (sueldos, saldos de
// apertura, gastos sin factura formal), y bloquearlas dejaría fuera media contabilidad de España.
//
// A qué sociedades se les avisa lo dice el país (NRO_COMP_POR_PAIS en tesoreriaData): hoy solo España,
// que es donde el reporte va a una contadora externa.
import { useState } from "react";
import ConfirmModal from "./ConfirmModal";
import { nroCompDeSociedad } from "../data/tesoreriaData";

export const PIDE_NRO_COMP = (sociedad) => nroCompDeSociedad(sociedad).avisarSinNro;

export const AVISO_SIN_NRO = {
  title: "Sin N° de comprobante",
  message: "Este comprobante se va a guardar sin el N° de factura.\n\n"
         + "El reporte para la contadora lo necesita para cruzarlo contra el libro de IVA.",
  confirmLabel: "Guardar igual",
  cancelLabel: "Volver y cargarlo",
  danger: false,
};

// Guarda "sin N° de comprobante" para los formularios de factura: si falta el número, en vez de guardar
// abre el cartel y deja pendiente la acción que el usuario apretó — al confirmar se ejecuta esa misma.
// Corre DESPUÉS del chequeo de duplicados, que sin número no hace nada (checkDuplicateComp devuelve
// null con `nro` vacío), así que las dos guardas no se pisan.
// Uso: const { guardarOAvisar, avisoSinNro } = useGuardaSinNro(sociedad, nroComp, guardarAhora); … {avisoSinNro}
export function useGuardaSinNro(sociedad, nroComp, guardarAhora) {
  const [pend, setPend] = useState(null);   // `extra` de la acción pendiente ({} o { _saveAndPay: true }, etc.)
  const guardarOAvisar = (extra) => {
    if (PIDE_NRO_COMP(sociedad) && !String(nroComp ?? "").trim()) { setPend(extra); return; }
    guardarAhora(extra);
  };
  const avisoSinNro = (
    <ConfirmModal open={!!pend} {...AVISO_SIN_NRO}
      onCancel={() => setPend(null)}
      onConfirm={() => { const extra = pend; setPend(null); guardarAhora(extra); }} />
  );
  return { guardarOAvisar, avisoSinNro };
}
