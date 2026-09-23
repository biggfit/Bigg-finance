// Aviso al guardar un comprobante SIN N° de factura.
//
// El reporte fiscal que baja la contadora cruza cada comprobante contra el libro de IVA por su
// número, así que una factura cargada sin él le llega incompleta y hay que volver a buscarla a mano.
// Esto lo avisa en el momento de la carga, que es cuando el dato está a mano.
//
// Es un AVISO, no un bloqueo: en Wellness hay cargas legítimamente sin número (sueldos, saldos de
// apertura, gastos sin factura formal), y bloquearlas dejaría fuera media contabilidad de España.
//
// Por ahora solo Wellness — es la sociedad cuyo reporte va a una contadora externa. Para extenderlo
// a otra, agregarla acá; si algún día son varias, conviene mirar el país de la sociedad en vez de
// enumerarlas (`paisDeSociedad(sociedad) === "ES"`).
export const PIDE_NRO_COMP = (sociedad) => sociedad === "wellness";

export const AVISO_SIN_NRO = {
  title: "Sin N° de comprobante",
  message: "Este comprobante se va a guardar sin el N° de factura.\n\n"
         + "El reporte para la contadora lo necesita para cruzarlo contra el libro de IVA.",
  confirmLabel: "Guardar igual",
  cancelLabel: "Volver y cargarlo",
  danger: false,
};
