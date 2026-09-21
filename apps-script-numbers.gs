// ─────────────────────────────────────────────────────────────────────────────
// BIGG Numbers — Apps Script Backend (handler genérico)
// ─────────────────────────────────────────────────────────────────────────────
//
// SETUP:
//   1. Reemplazá NUMBERS_SHEET_ID con el ID de tu planilla de Numbers
//      (está en la URL: docs.google.com/spreadsheets/d/ESTE_ID/edit)
//   2. TOKEN ya está cargado — debe coincidir con VITE_SHEETS_TOKEN en .env.local
//
// DEPLOY:
//   Extensiones → Apps Script → Implementar → Nueva implementación (o editar existente)
//   Tipo: Aplicación web · Ejecutar como: Yo · Acceso: Cualquier persona

const NUMBERS_SHEET_ID = "1IQ1YAJjCudmXBa1gmilbT9s1gUq3SNik8ubXbukUZYg";
const NUMBERS_TOKEN    = "bigg-finance-2026-secreto";

// ─── GET ─────────────────────────────────────────────────────────────────────

function doGet(e) {
  if (e.parameter.token !== NUMBERS_TOKEN) return nbErr("unauthorized");

  const resource = e.parameter.resource;

  // BATCH: varias hojas en UNA sola ejecución (ver handleMulti abajo)
  if (resource === "__multi") return handleMulti(e);

  if (!resource || !resource.startsWith("nb_")) {
    return nbErr("resource inválido — debe empezar con 'nb_'");
  }

  const ss = SpreadsheetApp.openById(NUMBERS_SHEET_ID);
  const sh = ss.getSheetByName(resource);
  if (!sh) return nbErr("Sheet desconocida: " + resource);

  // Filtros = todos los parámetros de la query que no sean de control (token/resource/_cb/spec).
  // Cada uno que coincida con una columna acota la lectura server-side (ej. ?origen=sueldos).
  return nbJson(nbReadSheet_(sh, nbFiltros_(e.parameter)));
}

// Parámetros de la query que actúan como filtro de columna (excluye los de control).
function nbFiltros_(params) {
  const RESERVADOS = { token: 1, resource: 1, _cb: 1, spec: 1 };
  const f = {};
  Object.keys(params).forEach(k => { if (!RESERVADOS[k]) f[k] = params[k]; });
  return f;
}

// Lee una hoja → filas-objeto (header-keyed). `filtros` = { columna: valor, ... }: cada par que
// coincida con una columna existente y tenga valor no vacío acota las filas (AND). Antes solo
// filtraba por `sociedad` y devolvía la hoja entera para todo lo demás: al crecer nb_movimientos
// (~3k filas / 2,4 MB por las líneas de extracto), lecturas acotadas como los pagos de sueldo
// (origen=sueldos → ~400 filas) se bajaban las 3k enteras. Comparación por String para que los
// números de la hoja (mes/anio) matcheen contra el parámetro de texto.
function nbReadSheet_(sh, filtros) {
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0].map(h => String(h).trim());
  const rows    = data.slice(1);

  const pares = [];
  if (filtros) {
    Object.keys(filtros).forEach(k => {
      const val = filtros[k];
      if (val === undefined || val === null || val === "") return;
      const col = headers.indexOf(k);
      if (col >= 0) pares.push({ col: col, val: String(val) });
    });
  }

  return rows
    .filter(row => {
      // Ignorar filas completamente vacías
      if (row.every(cell => cell === "" || cell === null || cell === undefined)) return false;
      // Todos los filtros pedidos deben coincidir (AND)
      for (let i = 0; i < pares.length; i++) {
        if (String(row[pares[i].col]) !== pares[i].val) return false;
      }
      return true;
    })
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        const v = row[i];
        // Normalizar fechas de Google Sheets (objetos Date) a YYYY-MM-DD
        if (v && typeof v.getTime === "function") {
          const d  = v;
          const dd = String(d.getDate()).padStart(2, "0");
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          obj[h]   = d.getFullYear() + "-" + mm + "-" + dd;
        } else {
          obj[h] = v;
        }
      });
      return obj;
    });
}

// ─── BATCH GET: varias hojas en una sola llamada ─────────────────────────────
// GET ?resource=__multi&spec=<JSON>&token=TOKEN
//   spec = [ { "r": "nb_movimientos", "s": "nako" }, { "r": "nb_cuentas" }, ... ]
//   r = nombre de hoja (obligatorio, debe empezar con nb_) · s = sociedad (opcional, filtra esa hoja)
// Devuelve { "nb_movimientos": [ {...}, ... ], "nb_cuentas": [ ... ], ... }
// Reduce las ~11-19 llamadas de una pantalla (que el GAS serializa) a UNA.
function handleMulti(e) {
  let spec;
  try { spec = JSON.parse(e.parameter.spec || "[]"); }
  catch (err) { return nbErr("spec inválido"); }
  if (!Array.isArray(spec)) return nbErr("spec debe ser un array");

  const ss  = SpreadsheetApp.openById(NUMBERS_SHEET_ID);
  const out = {};
  for (let i = 0; i < spec.length; i++) {
    const item = spec[i] || {};
    const name = item.r;
    if (!name || !String(name).startsWith("nb_")) continue;
    const sh = ss.getSheetByName(name);
    out[name] = sh ? nbReadSheet_(sh, { sociedad: item.s }) : [];
  }
  return nbJson(out);
}

// ─── POST ─────────────────────────────────────────────────────────────────────

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.token !== NUMBERS_TOKEN) return nbErr("unauthorized");

  const sheetName = body.sheet;
  if (!sheetName || !sheetName.startsWith("nb_")) {
    return nbErr("sheet inválida — debe empezar con 'nb_'");
  }

  const ss = SpreadsheetApp.openById(NUMBERS_SHEET_ID);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return nbErr("Sheet desconocida: " + sheetName);

  // ── ADD: agrega una fila nueva ────────────────────────────────────────────
  if (body.action === "add") {
    const lastCol = sh.getLastColumn();
    if (lastCol === 0) {
      // Sheet existe pero sin headers — auto-poblar desde body.row
      const keys = Object.keys(body.row);
      sh.appendRow(keys);
      sh.appendRow(keys.map(k => { const v = body.row[k]; return (v === undefined || v === null) ? "" : v; }));
      return nbJson({ ok: true });
    }
    const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    sh.appendRow(headers.map(h => {
      const v = body.row[h];
      return (v === undefined || v === null) ? "" : v;
    }));
    return nbJson({ ok: true });
  }

  // ── ADD_BATCH: agrega N filas en UNA sola escritura (atómico, rápido) ──────
  // Para cargas grandes (ej. cronograma de 70 cuotas) — evita 70 requests.
  if (body.action === "add_batch") {
    const list = body.rows || [];
    if (!list.length) return nbJson({ ok: true, n: 0 });
    let lastCol = sh.getLastColumn();
    let headers;
    if (lastCol === 0) {                 // Sheet sin headers — poblar desde la 1ª fila
      headers = Object.keys(list[0]);
      sh.appendRow(headers);
    } else {
      headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    }
    const matrix = list.map(row => headers.map(h => {
      const v = row[h];
      return (v === undefined || v === null) ? "" : v;
    }));
    sh.getRange(sh.getLastRow() + 1, 1, matrix.length, headers.length).setValues(matrix);
    return nbJson({ ok: true, n: matrix.length });
  }

  // ── EDIT: actualiza campos de una fila por id ─────────────────────────────
  // body.id_field permite usar una columna clave distinta a "id"
  // (ej: nb_egresos / nb_ingresos usan "id_linea" como clave por fila)
  if (body.action === "edit") {
    const data       = sh.getDataRange().getValues();
    const headers    = data[0];
    const idField    = body.id_field ?? "id";
    const idCol      = headers.indexOf(idField);
    if (idCol < 0) return nbErr("Sheet sin columna '" + idField + "': " + sheetName);

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === String(body.id)) {
        headers.forEach((h, c) => {
          if (h in body.patch) {
            const v = body.patch[h];
            sh.getRange(i + 1, c + 1).setValue(v === null || v === undefined ? "" : v);
          }
        });
        return nbJson({ ok: true });
      }
    }
    return nbErr("fila no encontrada: " + body.id);
  }

  // ── DEL: elimina una fila por id ──────────────────────────────────────────
  if (body.action === "del") {
    const data  = sh.getDataRange().getValues();
    const idCol = data[0].indexOf("id");
    if (idCol < 0) return nbErr("Sheet sin columna 'id': " + sheetName);

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === String(body.id)) {
        sh.deleteRow(i + 1);
        return nbJson({ ok: true });
      }
    }
    return nbErr("fila no encontrada: " + body.id);
  }

  // ── DEL_COMP: elimina todas las líneas de un comprobante ──────────────────
  // Usado para borrar egresos/ingresos que tienen varias líneas de CC
  if (body.action === "del_comp") {
    const data    = sh.getDataRange().getValues();
    const compCol = data[0].indexOf("id_comp");
    if (compCol < 0) return nbErr("Sheet sin columna 'id_comp': " + sheetName);

    // Borrar de abajo hacia arriba para no desalinear índices de fila
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][compCol]) === String(body.id_comp)) {
        sh.deleteRow(i + 1);
      }
    }
    return nbJson({ ok: true });
  }

  return nbErr("acción desconocida: " + body.action);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const nbJson = d => ContentService
  .createTextOutput(JSON.stringify(d))
  .setMimeType(ContentService.MimeType.JSON);

const nbErr = m => nbJson({ error: m });
