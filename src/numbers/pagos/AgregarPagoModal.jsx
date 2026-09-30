// Modal "Agregar Pago" (registrar un pago sobre un egreso). Lo usan PantallaEgresos y el reporte CxP por
// proveedor. Es el modo "pago" de PagoCobroModal (mismo modal que Registrar Cobro, con los textos y la
// tolerancia de este lado). onSave recibe { fecha, monto, medioPago, nota, egresoId }.
import PagoCobroModal from "./PagoCobroModal";

export default function AgregarPagoModal({ egreso, ...rest }) {
  return <PagoCobroModal modo="pago" doc={egreso} {...rest} />;
}
