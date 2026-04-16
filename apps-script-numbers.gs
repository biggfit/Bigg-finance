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
//
// SHEETS EN LA PLANILLA (una por recurso):
//
//   ── NUEVO MODELO (activo) ──────────────────────────────────────────────────
//   nb_comprobantes     → id | id_comp | sociedad | fecha | vto | subtipo | contraparte_id | contraparte_nombre | cuenta_contable | cuenta_contable_id | moneda | centro_costo | subtotal | iva_rate | iva_monto | total | nro_comp | nota | created_at
//                          · id      = clave única de fila (ej: EG-2026-00001-L01)
//                          · id_comp = id del documento (se repite si hay varias líneas de CC)
//                          · subtipo = "EGRESO_FC" | "INGRESO_FC" | "GASTO"
//                          · EGRESO_FC  = factura de proveedor con vencimiento
//                          · INGRESO_FC = factura a cliente con vencimiento
//                          · GASTO      = gasto directo (devengado = percibido, sin vto separado)
//
//   nb_movimientos      → id | sociedad | fecha | tipo | cuenta_bancaria | cuenta_destino | cuenta_contable | centro_costo | moneda | monto | documento_id | concepto | referencia | origen | created_at
//                          · tipo         = "PAGO_FC" | "COBRO_FC" | "EGRESO_GASTO" | "TRANSFERENCIA"
//                          · PAGO_FC      = pago parcial/total de EGRESO_FC (monto negativo)
//                          · COBRO_FC     = cobro parcial/total de INGRESO_FC (monto positivo)
//                          · EGRESO_GASTO = salida de caja vinculada a un GASTO (monto negativo)
//                          · TRANSFERENCIA = movimiento entre cuentas propias
//                          · monto        = firmado: PAGO_FC/EGRESO_GASTO negativos, COBRO_FC positivos
//                          · documento_id = id_comp del comprobante vinculado (PAGO_FC, COBRO_FC, EGRESO_GASTO)
//                          · origen       = "pago" | "cobro" | "gasto" | "manual"
//
//   ── TABLAS MAESTRAS (sin cambios) ─────────────────────────────────────────
//   nb_proveedores      → id | nombre | cuit | condIVA | monedaDefault | cuentaDefault | ccDefault | nota | activo | created_at
//   nb_clientes         → id | nombre | cuit | condIVA | monedaDefault | cuentaDefault | ccDefault | nota | activo | created_at
//   nb_cuentas          → id | nombre | tipo | cuenta_pasivo | activo | created_at
//   nb_cuentas_bancarias → id | sociedad | nombre | tipo | moneda | banco | cbu | nota | activo | created_at
//   nb_centros_costo    → id | nombre | grupo | empresa | activo | created_at
//   nb_sociedades       → id | nombre | pais | bandera | moneda | activo | created_at
//
//   ── TABLAS HISTÓRICAS (conservar, ya no se escriben) ──────────────────────
//   nb_egresos          → id_comp | id_linea | sociedad | ...
//   nb_ingresos         → id_comp | id_linea | sociedad | ...
//   nb_pagos_cobros     → id | tipo | documento_id | sociedad | ...
//   nb_mov_tesoreria    → id | sociedad | fecha | tipo | ...
//
// HANDLER GENÉRICO: no hay whitelist. Cualquier sheet "nb_*" es válida.
// Para agregar una nueva entidad solo creá la solapa en el Sheet — sin tocar el script.
//
// NOTA sobre acciones:
//   · edit/del   → buscan columna "id" (clave primaria por defecto)
//   · del_comp   → elimina todas las filas donde id_comp = valor (cascade delete)
//   · Para sheets con clave distinta, pasá id_field en el body del POST.
// ─────────────────────────────────────────────────────────────────────────────

const NUMBERS_SHEET_ID = "1IQ1YAJjCudmXBa1gmilbT9s1gUq3SNik8ubXbukUZYg";
const NUMBERS_TOKEN    = "bigg-finance-2026-secreto";

// ─── GET ─────────────────────────────────────────────────────────────────────

function doGet(e) {
  if (e.parameter.token !== NUMBERS_TOKEN) return nbErr("unauthorized");

  const resource = e.parameter.resource;
  if (!resource || !resource.startsWith("nb_")) {
    return nbErr("resource inválido — debe empezar con 'nb_'");
  }

  const ss = SpreadsheetApp.openById(NUMBERS_SHEET_ID);
  const sh = ss.getSheetByName(resource);
  if (!sh) return nbErr("Sheet desconocida: " + resource);

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return nbJson([]);

  const headers = data[0].map(h => String(h).trim());
  const rows    = data.slice(1);

  // Filtro opcional por sociedad (GET ?sociedad=nako)
  const sociedad = e.parameter.sociedad;
  const socCol   = headers.indexOf("sociedad");

  const result = rows
    .filter(row => {
      // Ignorar filas completamente vacías
      if (row.every(cell => cell === "" || cell === null || cell === undefined)) return false;
      // Filtro por sociedad si se pidió y la columna existe
      if (sociedad && socCol >= 0 && String(row[socCol]) !== sociedad) return false;
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

  return nbJson(result);
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
