import { T } from "./theme";

// ─── Normalizador ─────────────────────────────────────────────────────────────
export const norm = s => (s ?? "").trim().toLowerCase();

// ─── Estilos base ─────────────────────────────────────────────────────────────
export const inputStyle = {
  width: "100%", background: "#ffffff", border: "1px solid #c5cad4",
  borderRadius: 7, padding: "8px 10px", fontSize: 13, color: T.text,
  fontFamily: T.font, outline: "none", boxSizing: "border-box", cursor: "pointer",
};
export const dateStyle = { ...inputStyle, appearance: "auto", WebkitAppearance: "auto" };

// ─── Lookup: busca primero por ID, luego por nombre ───────────────────────────
export const lookupId = (list, idKey, nameKey, data) => {
  if (!data) return "";
  return (
    list.find(x => x.id === data[idKey])?.id ||
    list.find(x => norm(x.nombre) === norm(data[nameKey]))?.id ||
    ""
  );
};

// ─── Resolver: val/nombre → ID (para cargar datos existentes al editar) ───────
export const makeCCResolver = (list) => (val) => {
  if (!val) return "";
  if (list.find(c => c.id === val)) return val;
  return list.find(c => norm(c.nombre) === norm(val))?.id ?? val;
};

// ─── Resolver: ID → nombre (para display en DetalleModal) ────────────────────
export const makeResolveCC = (list) => (id) => {
  if (!id) return "—";
  return list.find(c => c.id === id)?.nombre ?? id;
};

export const makeResolveCB = (list) => (id) =>
  list.find(c => c.id === id)?.nombre ?? id ?? "—";

// ─── Totales de líneas ────────────────────────────────────────────────────────
export function calcLineasTotals(lineas) {
  let totalSub = 0, totalIva = 0;
  lineas.forEach(l => {
    const sub = Number(l.subtotal) || 0;
    totalSub += sub;
    totalIva += sub * (Number(l.ivaRate) / 100);
  });
  return { totalSub, totalIva, totalFinal: totalSub + totalIva };
}

// ─── Componentes de campo ─────────────────────────────────────────────────────
export const Label = ({ children, required }) => (
  <label style={{ fontSize: 11, color: T.muted, fontWeight: 700, display: "block",
    marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>
    {children}{required && <span style={{ color: T.red }}> *</span>}
  </label>
);

export const Field = ({ label, required, children }) => (
  <div>
    {label && <Label required={required}>{label}</Label>}
    {children}
  </div>
);

// ─── CC Dropdown: opciones agrupadas por tipo ─────────────────────────────────
export const CCSelectOptions = ({ ccGroups }) => (
  <>
    {ccGroups.hq.length > 0 && (
      <optgroup label="Marca / HQ">
        {ccGroups.hq.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </optgroup>
    )}
    {ccGroups.ops.length > 0 && (
      <optgroup label="Sedes Operativas">
        {ccGroups.ops.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </optgroup>
    )}
    {ccGroups.rest.length > 0 && (
      <optgroup label="Otros">
        {ccGroups.rest.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </optgroup>
    )}
  </>
);
