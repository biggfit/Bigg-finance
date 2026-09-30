// Modal "Registrar Cobro" (registrar un cobro sobre un ingreso). Lo usan PantallaIngresos y el reporte CxC
// por cliente. Es el modo "cobro" de PagoCobroModal (mismo modal que Agregar Pago, con los textos, la
// tolerancia y los anticipos de este lado). onSave recibe { fecha, monto, medioCobro, ingresoId }.
import PagoCobroModal from "./PagoCobroModal";

export default function RegistrarCobroModal({ ingreso, ...rest }) {
  return <PagoCobroModal modo="cobro" doc={ingreso} {...rest} />;
}
