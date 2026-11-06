// Estilos compartidos de las tablas "meses en columnas" (TablaMeses.jsx los usa; la Caja los necesita también para
// el panel de detalle). Viven aparte de los componentes por react-refresh (un archivo de componentes no exporta constantes).
import { T } from "../theme";

export const COL_MES = 118, COL_TOT = 132;
export const TABLA = { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" };
export const trLine = { borderBottom: `1px solid ${T.cardBorder}` };
export const tdLabel = { padding: "7px 18px", fontSize: 13, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
