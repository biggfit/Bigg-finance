// Reportes › CxC consolidada por cliente — cuentas por cobrar de TODAS las sociedades, con antigüedad.
// Envoltorio: toda la lógica vive en TabCxConsolidada (lado "cxc"); lo que difiere del lado CxP está en su CFG.
import TabCxConsolidada from "./TabCxConsolidada";

export default function TabCxCClientes(props) { return <TabCxConsolidada lado="cxc" {...props} />; }
