// Reportes › CxP consolidada por proveedor — cuentas por pagar de TODAS las sociedades, con antigüedad.
// Envoltorio: toda la lógica vive en TabCxConsolidada (lado "cxp"); lo que difiere del lado CxC está en su CFG.
import TabCxConsolidada from "./TabCxConsolidada";

export default function TabCxPProveedores(props) { return <TabCxConsolidada lado="cxp" {...props} />; }
