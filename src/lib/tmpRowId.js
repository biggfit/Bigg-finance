// Id temporal de fila para las grillas de Sueldos (clave React hasta que el backend da el id real).
// Con secuencia: `Date.now() + Math.random()` chocaba al crear decenas de filas en el mismo
// milisegundo ("Cargar en la grilla", "Copiar mes anterior") → claves repetidas → filas fantasma en
// el DOM que el estado ya no tenía.
let _seq = 0;
export const tmpRowId = () => `tmp-${Date.now()}-${++_seq}`;
