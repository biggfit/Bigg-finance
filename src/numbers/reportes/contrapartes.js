// Maestro de contrapartes para los Excel del estudio contable (Facturas Emitidas / Recibidas y Pagos y cobros).
//
// El cód. de estudio, el NIF, la razón social y el domicilio NO viven en el comprobante ni en el movimiento:
// están en nb_proveedores / nb_clientes, y para los franquiciados en el maestro de Franquicias (sheetsApi "all"
// → `franchises`), que es otra app. Este módulo junta las tres fuentes en UN resolver para que los dos reportes
// resuelvan igual (antes cada uno armaba su mapa y ya habían divergido: uno saltaba las filas sin NIF ni código,
// el otro no — 8/10/2026).
//
// Claves: por id (nb_proveedores/nb_clientes: su id; franquicias: el id numérico de la franquicia, que es lo que
// llevan los cobros de Franquicias en contraparte_id, y también `FR-<id>`, que es lo que llevan las filas de
// facturas de Franquicias en el libro de Emitidas) y, como último recurso, por nombre en minúsculas (sueldos,
// financiaciones e histórico no traen id).
const limpio = v => String(v ?? "").trim();

export function armarMaestroContrapartes({ proveedores = [], clientes = [], franquicias = [] } = {}) {
  const porId = new Map(), porNombre = new Map();
  for (const m of [...(Array.isArray(proveedores) ? proveedores : []), ...(Array.isArray(clientes) ? clientes : [])]) {
    const dato = { cod: limpio(m.cod_estudio), cuit: limpio(m.cuit), nombre: limpio(m.nombre), domicilio: limpio(m.domicilio) };
    porId.set(String(m.id), dato);
    if (dato.nombre) porNombre.set(dato.nombre.toLowerCase(), dato);
  }
  for (const f of (Array.isArray(franquicias) ? franquicias : [])) {
    if (f?.id == null) continue;
    const dato = { cod: "", cuit: limpio(f.cuit), nombre: limpio(f.razonSocial || f.name), domicilio: limpio(f.domicilio || f.billingAddress) };
    porId.set(String(f.id), dato);
    porId.set(`FR-${f.id}`, dato);
  }
  // (id, nombre) → { cod, cuit, nombre, domicilio } | undefined
  return (id, nombre) => porId.get(String(id ?? "")) ?? porNombre.get(limpio(nombre).toLowerCase());
}
