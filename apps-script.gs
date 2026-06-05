// ─────────────────────────────────────────────────────────────────────────────
// Bigg Finance — Google Apps Script Web App
// ─────────────────────────────────────────────────────────────────────────────
//
// CONFIGURACIÓN:
//   Reemplazá SHEET_ID con el ID de tu planilla (está en la URL del Sheet).
//   TOKEN debe coincidir con VITE_SHEETS_TOKEN en tu .env.local y en Vercel.
//
// TABS REQUERIDAS en la planilla:
//   comprobantes, saldos, franchises, franchisor
//
// DEPLOY:
//   Extensiones → Apps Script → Implementar → Nueva implementación
//   Tipo: Aplicación web
//   Ejecutar como: Yo
//   Acceso: Cualquier persona
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_ID = "18CCRMQ_7dU5TnZWhum5YQE2NVG_vz8vzq5c0iuZf5kk";
const TOKEN    = "bigg-finance-2026-secreto";

// Normaliza el yearMonth de tipos_cambio a "YYYY-MM".
// Google Sheets puede interpretar "2026-01" como Date y devolverlo como objeto Date
// (ej. "Thu Jan 01 2026..."), por eso reconstruimos la clave desde el Date si hace falta.
function normalizeYearMonth(v) {
  if (v instanceof Date) {
    var y = v.getFullYear();
    var m = ("0" + (v.getMonth() + 1)).slice(-2);
    return y + "-" + m;
  }
  return String(v).slice(0, 7);
}

// ─── GET ─────────────────────────────────────────────────────────────────────

function doGet(e) {
  if (e.parameter.token !== TOKEN) return err("unauthorized");
  const resource = e.parameter.resource;
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // ── Comprobantes ──────────────────────────────────────────────────────────
  if (resource === "comps") {
    const rows = ss.getSheetByName("comprobantes").getDataRange().getValues();
    const [headers, ...data] = rows;
    const comps = {};
    data.forEach(row => {
      const obj = Object.fromEntries(headers.map((h, i) => [h, row[i]]));
      const key = String(obj.frId);
      if (!comps[key]) comps[key] = [];
      comps[key].push(obj);
    });
    return json(comps);
  }

  // ── Saldos ────────────────────────────────────────────────────────────────
  if (resource === "saldos") {
    const rows = ss.getSheetByName("saldos").getDataRange().getValues();
    const [headers, ...data] = rows;
    // Formato v3: frId | empresa | currency | saldo  (4 columnas)
    // Formato v2: frId | empresa | saldo             (3 columnas)
    // Legado v1:  frId | saldo                       (2 columnas)
    // Buscar columnas por nombre (case-insensitive) — tolerante a cualquier nombre de header
    const hLow        = headers.map(h => String(h).toLowerCase());
    const frIdCol     = hLow.findIndex(h => h === "frid" || h === "id" || h === "fr_id");
    const empresaCol  = hLow.findIndex(h => h === "empresa" || h === "company");
    const currencyCol = hLow.findIndex(h => h === "currency" || h === "moneda" || h === "cur");
    const amountCol   = hLow.findIndex(h => h === "saldo" || h === "amount" || h === "balance" || h === "importe" || h === "monto");

    const colFr  = frIdCol  >= 0 ? frIdCol  : 0;
    const colAmt = amountCol >= 0 ? amountCol : (empresaCol < 0 ? 1 : (currencyCol >= 0 ? 3 : 2));

    const hasEmpresa = empresaCol >= 0;
    if (hasEmpresa) {
      const saldos = {};
      data.forEach(row => {
        const frId     = String(row[colFr]);
        const empresa  = row[empresaCol] !== "" ? String(row[empresaCol]) : "ÑAKO SRL";
        const currency = currencyCol >= 0 ? (row[currencyCol] !== "" ? String(row[currencyCol]) : null) : null;
        const saldo    = Number(row[colAmt]);
        if (isNaN(saldo) || frId === "") return;
        if (!saldos[empresa]) saldos[empresa] = {};
        // En caso de duplicados, conservar el de mayor saldo absoluto
        const prev    = saldos[empresa][frId];
        const prevAmt = prev != null ? (typeof prev === "object" ? (prev.saldo ?? 0) : prev) : null;
        if (prevAmt === null || Math.abs(saldo) > Math.abs(prevAmt)) {
          saldos[empresa][frId] = { saldo, currency };
        }
      });
      return json(saldos);
    } else {
      // Formato legado: devolver objeto plano { frId: saldo }
      const saldos = {};
      data.forEach(row => {
        const frId  = String(row[colFr]);
        const saldo = Number(row[colAmt]);
        if (frId !== "" && !isNaN(saldo)) saldos[frId] = saldo;
      });
      return json(saldos);
    }
  }

  // ── Franchises ────────────────────────────────────────────────────────────
  if (resource === "franchises") {
    const rows = ss.getSheetByName("franchises").getDataRange().getValues();
    const [headers, ...data] = rows;
    const franchises = data.map(row =>
      Object.fromEntries(headers.map((h, i) => [h, row[i]]))
    );
    return json(franchises);
  }

  // ── Franchisor ────────────────────────────────────────────────────────────
  if (resource === "franchisor") {
    const rows = ss.getSheetByName("franchisor").getDataRange().getValues();
    const [headers, ...data] = rows;
    const result = {};
    data.forEach(row => {
      const obj = Object.fromEntries(headers.map((h, i) => [h, row[i]]));
      result[obj.side] = obj; // result.ar = {...}, result.usa = {...}
    });
    return json(result);
  }

  // ── Recordatorios ─────────────────────────────────────────────────────────
  if (resource === "recordatorios") {
    var sh = ss.getSheetByName("recordatorios");
    if (!sh) return json({});
    var rows = sh.getDataRange().getValues();
    var headers = rows[0];
    var result = {};
    for (var i = 1; i < rows.length; i++) {
      var obj = {};
      headers.forEach(function(h, j) { obj[h] = rows[i][j]; });
      var key = String(obj.frId);
      if (!result[key]) result[key] = [];
      result[key].push(serializeRecordatorio(obj));
    }
    return json(result);
  }

  // ── All (un solo request para evitar throttling de Google) ────────────────
  if (resource === "all") {
    // Comps
    var compRows = ss.getSheetByName("comprobantes").getDataRange().getValues();
    var compH = compRows[0], compD = compRows.slice(1);
    var comps = {};
    compD.forEach(function(row) {
      var obj = {};
      compH.forEach(function(h, i) { obj[h] = row[i]; });
      var key = String(obj.frId);
      if (!comps[key]) comps[key] = [];
      comps[key].push(obj);
    });

    // Saldos
    var salRows = ss.getSheetByName("saldos").getDataRange().getValues();
    var salH = salRows[0], salD = salRows.slice(1);
    var hLow2 = salH.map(function(h) { return String(h).toLowerCase(); });
    var frIdCol2     = hLow2.indexOf("frid") >= 0 ? hLow2.indexOf("frid") : (hLow2.indexOf("id") >= 0 ? hLow2.indexOf("id") : hLow2.indexOf("fr_id"));
    var empresaCol2  = hLow2.indexOf("empresa") >= 0 ? hLow2.indexOf("empresa") : hLow2.indexOf("company");
    var currencyCol2 = hLow2.indexOf("currency") >= 0 ? hLow2.indexOf("currency") : (hLow2.indexOf("moneda") >= 0 ? hLow2.indexOf("moneda") : hLow2.indexOf("cur"));
    var amountCol2   = ["saldo","amount","balance","importe","monto"].reduce(function(found, name) { return found >= 0 ? found : hLow2.indexOf(name); }, -1);
    var colFr2  = frIdCol2 >= 0 ? frIdCol2 : 0;
    var colAmt2 = amountCol2 >= 0 ? amountCol2 : (empresaCol2 < 0 ? 1 : (currencyCol2 >= 0 ? 3 : 2));
    var saldos = {};
    if (empresaCol2 >= 0) {
      salD.forEach(function(row) {
        var frId = String(row[colFr2]);
        var empresa = row[empresaCol2] !== "" ? String(row[empresaCol2]) : "ÑAKO SRL";
        var currency = currencyCol2 >= 0 ? (row[currencyCol2] !== "" ? String(row[currencyCol2]) : null) : null;
        var saldo = Number(row[colAmt2]);
        if (isNaN(saldo) || frId === "") return;
        if (!saldos[empresa]) saldos[empresa] = {};
        var prev = saldos[empresa][frId];
        var prevAmt = prev != null ? (typeof prev === "object" ? (prev.saldo || 0) : prev) : null;
        if (prevAmt === null || Math.abs(saldo) > Math.abs(prevAmt)) {
          saldos[empresa][frId] = { saldo: saldo, currency: currency };
        }
      });
    } else {
      salD.forEach(function(row) {
        var frId = String(row[colFr2]);
        var saldo = Number(row[colAmt2]);
        if (frId !== "" && !isNaN(saldo)) saldos[frId] = saldo;
      });
    }

    // Franchises
    var frRows = ss.getSheetByName("franchises").getDataRange().getValues();
    var frH = frRows[0], frD = frRows.slice(1);
    var franchises = frD.map(function(row) {
      var obj = {};
      frH.forEach(function(h, i) { obj[h] = row[i]; });
      return obj;
    });

    // Franchisor
    var fsorRows = ss.getSheetByName("franchisor").getDataRange().getValues();
    var fsorH = fsorRows[0], fsorD = fsorRows.slice(1);
    var franchisor = {};
    fsorD.forEach(function(row) {
      var obj = {};
      fsorH.forEach(function(h, i) { obj[h] = row[i]; });
      franchisor[obj.side] = obj;
    });

    // Recordatorios
    var recSh = ss.getSheetByName("recordatorios");
    var recordatorios = {};
    if (recSh) {
      var recRows = recSh.getDataRange().getValues();
      var recH = recRows[0];
      for (var ri = 1; ri < recRows.length; ri++) {
        var rObj = {};
        recH.forEach(function(h, j) { rObj[h] = recRows[ri][j]; });
        var rKey = String(rObj.frId);
        if (!recordatorios[rKey]) recordatorios[rKey] = [];
        recordatorios[rKey].push(serializeRecordatorio(rObj));
      }
    }

    // Tipos de Cambio
    var tcSh2 = ss.getSheetByName("tipos_cambio");
    var tiposCambio = {};
    if (tcSh2) {
      var tcRows2 = tcSh2.getDataRange().getValues();
      if (tcRows2.length >= 2) {
        var tcH2 = tcRows2[0];
        for (var tci = 1; tci < tcRows2.length; tci++) {
          var tObj2 = {};
          tcH2.forEach(function(h, j) { tObj2[h] = tcRows2[tci][j]; });
          var ym2 = normalizeYearMonth(tObj2.yearMonth);
          if (ym2 && ym2 !== "") {
            tiposCambio[ym2] = {
              yearMonth: ym2,
              arsUSD: Number(tObj2.arsUSD) || 0,
              eurUSD: Number(tObj2.eurUSD) || 0,
              uyuUSD: Number(tObj2.uyuUSD) || 0,
              pygUSD: Number(tObj2.pygUSD) || 0,
              clpUSD: Number(tObj2.clpUSD) || 0,
              penUSD: Number(tObj2.penUSD) || 0,
            };
          }
        }
      }
    }

    return json({ comps: comps, saldos: saldos, franchises: franchises, franchisor: franchisor, recordatorios: recordatorios, tiposCambio: tiposCambio });
  }

  // ── Tipos de Cambio ───────────────────────────────────────────────────────
  if (resource === "tiposCambio") {
    var tcSh = ss.getSheetByName("tipos_cambio");
    if (!tcSh) return json({});
    var tcRows = tcSh.getDataRange().getValues();
    if (tcRows.length < 2) return json({});
    var tcH = tcRows[0];
    var result = {};
    for (var ti = 1; ti < tcRows.length; ti++) {
      var tObj = {};
      tcH.forEach(function(h, j) { tObj[h] = tcRows[ti][j]; });
      var ym = normalizeYearMonth(tObj.yearMonth);
      if (ym && ym !== "") {
        result[ym] = {
          yearMonth: ym,
          arsUSD: Number(tObj.arsUSD) || 0,
          eurUSD: Number(tObj.eurUSD) || 0,
          uyuUSD: Number(tObj.uyuUSD) || 0,
          pygUSD: Number(tObj.pygUSD) || 0,
          clpUSD: Number(tObj.clpUSD) || 0,
          penUSD: Number(tObj.penUSD) || 0,
        };
      }
    }
    return json(result);
  }

  return err("recurso desconocido: " + resource);
}

// ─── POST ────────────────────────────────────────────────────────────────────

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.token !== TOKEN) return err("unauthorized");
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // ── Comprobantes ──────────────────────────────────────────────────────────
  if (body.action === "add") {
    const sh = ss.getSheetByName("comprobantes");
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    sh.appendRow(headers.map(h => body.comp[h] ?? ""));
    return json({ ok: true });
  }

  if (body.action === "edit" || body.action === "del") {
    const sh = ss.getSheetByName("comprobantes");
    const data = sh.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf("id");
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === String(body.compId)) {
        if (body.action === "del") {
          sh.deleteRow(i + 1);
        } else {
          headers.forEach((h, c) => {
            if (h in body.patch) sh.getRange(i + 1, c + 1).setValue(body.patch[h]);
          });
        }
        return json({ ok: true });
      }
    }
    return err("comprobante no encontrado: " + body.compId);
  }

  // ── Franchises ────────────────────────────────────────────────────────────
  if (body.action === "saveFr") {
    const sh = ss.getSheetByName("franchises");
    const data = sh.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf("id");
    for (let i = 1; i < data.length; i++) {
      if (Number(data[i][idCol]) === Number(body.id)) {
        headers.forEach((h, c) => {
          if (h in body.data) sh.getRange(i + 1, c + 1).setValue(body.data[h] ?? "");
        });
        return json({ ok: true });
      }
    }
    return err("franquicia no encontrada: " + body.id);
  }

  if (body.action === "addFr") {
    const sh = ss.getSheetByName("franchises");
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    sh.appendRow(headers.map(h => body.data[h] ?? ""));
    return json({ ok: true });
  }

  if (body.action === "deleteFr") {
    const sh = ss.getSheetByName("franchises");
    const data = sh.getDataRange().getValues();
    const idCol = data[0].indexOf("id");
    for (let i = 1; i < data.length; i++) {
      if (Number(data[i][idCol]) === Number(body.id)) {
        sh.deleteRow(i + 1);
        return json({ ok: true });
      }
    }
    return err("franquicia no encontrada: " + body.id);
  }

  // ── Franchisor ────────────────────────────────────────────────────────────
  if (body.action === "saveFranchisor") {
    const sh = ss.getSheetByName("franchisor");
    const data = sh.getDataRange().getValues();
    const headers = data[0];
    const sideCol = headers.indexOf("side");
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][sideCol]) === String(body.side)) {
        headers.forEach((h, c) => {
          if (h in body.data) sh.getRange(i + 1, c + 1).setValue(body.data[h] ?? "");
        });
        return json({ ok: true });
      }
    }
    return err("franquiciante no encontrado: " + body.side);
  }

  // ── Invoice correlativo (USA) ─────────────────────────────────────────────
  if (body.action === "nextInvoiceNum") {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var fsh     = ss.getSheetByName("franchises");
      var fdata   = fsh.getDataRange().getValues();
      var fheads  = fdata[0];
      var idCol   = fheads.indexOf("id");
      var seqCol  = fheads.indexOf("invoiceSeq");
      if (seqCol < 0) {
        seqCol = fheads.length;
        fsh.getRange(1, seqCol + 1).setValue("invoiceSeq");
      }
      for (var ri = 1; ri < fdata.length; ri++) {
        if (String(fdata[ri][idCol]) === String(body.frId)) {
          var prev  = Number(fdata[ri][seqCol]) || 0;
          var next  = prev + 1;
          fsh.getRange(ri + 1, seqCol + 1).setValue(next);
          var prefix = body.prefix || "USA";
          var label = prefix + "-" + body.frId + "-" + String(next).padStart(4, "0");
          return json({ ok: true, num: next, label: label });
        }
      }
      return err("frId not found: " + body.frId);
    } finally {
      lock.releaseLock();
    }
  }

  // ── Invoice correlativo — decremento al borrar ────────────────────────────
  if (body.action === "tryDecrementInvoiceSeq") {
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var fsh    = ss.getSheetByName("franchises");
      var fdata  = fsh.getDataRange().getValues();
      var fheads = fdata[0];
      var idCol  = fheads.indexOf("id");
      var seqCol = fheads.indexOf("invoiceSeq");
      if (seqCol < 0) return json({ ok: false, reason: "no invoiceSeq col" });
      for (var ri = 1; ri < fdata.length; ri++) {
        if (String(fdata[ri][idCol]) === String(body.frId)) {
          var curr = Number(fdata[ri][seqCol]) || 0;
          if (curr === Number(body.num) && curr > 0) {
            fsh.getRange(ri + 1, seqCol + 1).setValue(curr - 1);
            return json({ ok: true, decremented: true, newSeq: curr - 1 });
          }
          return json({ ok: true, decremented: false, curr: curr });
        }
      }
      return err("frId not found: " + body.frId);
    } finally {
      lock.releaseLock();
    }
  }

  // ── Recordatorio ──────────────────────────────────────────────────────────
  if (body.action === "addRecordatorio") {
    var sh = ss.getSheetByName("recordatorios");
    if (!sh) {
      sh = ss.insertSheet("recordatorios");
      sh.appendRow(["frId", "fecha", "ccMes", "ccAnio", "to", "frName", "tipo", "empresa"]);
    } else {
      // Migración: agregar columnas nuevas si aún no existen
      var hRow = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      if (hRow.indexOf("frName")   === -1) sh.getRange(1, hRow.length + 1).setValue("frName");
      if (hRow.indexOf("tipo")     === -1) sh.getRange(1, sh.getLastColumn()).setValue("tipo");
      if (hRow.indexOf("empresa")  === -1) sh.getRange(1, sh.getLastColumn() + 1).setValue("empresa");
      if (hRow.indexOf("currency") === -1) sh.getRange(1, sh.getLastColumn() + 1).setValue("currency");
    }
    sh.appendRow([
      body.frId, body.fecha,
      body.ccMes   || "", body.ccAnio   || "",
      body.to      || "", body.frName   || "",
      body.tipo    || "cc", body.empresa || "", body.currency || ""
    ]);
    return json({ ok: true });
  }

  // ── Tipos de Cambio ───────────────────────────────────────────────────────
  if (body.action === "saveTC") {
    try {
      var tcSh = ss.getSheetByName("tipos_cambio");
      var allTcCols = ["yearMonth","arsUSD","eurUSD","uyuUSD","pygUSD","clpUSD","penUSD"];
      var sheetCreated = false;
      if (!tcSh) {
        tcSh = ss.insertSheet("tipos_cambio");
        tcSh.appendRow(allTcCols);
        tcSh.getRange("A:A").setNumberFormat("@"); // yearMonth como texto, evita coerción a Date
        tcSh.appendRow(allTcCols.map(function(h) { return h === "yearMonth" ? body.yearMonth : (body.tc[h] != null ? body.tc[h] : ""); }));
        sheetCreated = true;
        SpreadsheetApp.flush();
        return json({ ok: true, sheetCreated: sheetCreated, yearMonth: body.yearMonth, spreadsheetUrl: ss.getUrl() });
      }
      var tcData = tcSh.getDataRange().getValues();
      var tcHeaders = tcData[0];
      // Agregar columnas nuevas si faltan
      allTcCols.forEach(function(col) {
        if (tcHeaders.indexOf(col) === -1) {
          var newColIdx = tcHeaders.length + 1;
          tcSh.getRange(1, newColIdx).setValue(col);
          for (var ri = 1; ri < tcData.length; ri++) {
            tcSh.getRange(ri + 1, newColIdx).setValue("");
            tcData[ri].push("");
          }
          tcHeaders.push(col);
        }
      });
      var ymCol = tcHeaders.indexOf("yearMonth");
      // Forzar columna yearMonth a texto para evitar que Sheets la convierta a Date
      tcSh.getRange(1, ymCol + 1, tcSh.getMaxRows(), 1).setNumberFormat("@");
      // Buscar fila existente (normalizamos por si filas viejas quedaron como Date)
      for (var ti = 1; ti < tcData.length; ti++) {
        if (normalizeYearMonth(tcData[ti][ymCol]) === String(body.yearMonth)) {
          // Sanea la clave por si quedó guardada como Date
          tcSh.getRange(ti + 1, ymCol + 1).setValue(String(body.yearMonth));
          tcHeaders.forEach(function(h, c) {
            if (h in body.tc) tcSh.getRange(ti + 1, c + 1).setValue(body.tc[h] != null ? body.tc[h] : "");
          });
          SpreadsheetApp.flush();
          return json({ ok: true, sheetCreated: false, updated: true, yearMonth: body.yearMonth, spreadsheetUrl: ss.getUrl() });
        }
      }
      // Nueva fila
      tcSh.appendRow(tcHeaders.map(function(h) { return h === "yearMonth" ? body.yearMonth : (body.tc[h] != null ? body.tc[h] : ""); }));
      SpreadsheetApp.flush();
      return json({ ok: true, sheetCreated: false, added: true, yearMonth: body.yearMonth, spreadsheetUrl: ss.getUrl() });
    } catch(saveTcErr) {
      return json({ error: "saveTC falló: " + saveTcErr.message, yearMonth: body.yearMonth });
    }
  }

  // ── Send Mail ─────────────────────────────────────────────────────────────
  if (body.action === "sendMail") {
    return handleSendMail(body);
  }

  return err("acción desconocida: " + body.action);
}

// ─── Send Mail ────────────────────────────────────────────────────────────────

function handleSendMail(data) {
  try {
    var to       = data.to;
    var subject  = data.subject  || "(sin asunto)";
    var htmlBody = data.htmlBody || "";

    var attachments = (data.attachments || []).map(function(att) {
      var decoded = Utilities.base64Decode(att.data);
      return Utilities.newBlob(decoded, att.mimeType, att.name);
    });

    GmailApp.sendEmail(to, subject, "", {
      from:        "pagos@bigg.fit",
      htmlBody:    htmlBody,
      attachments: attachments,
      name:        "BIGG Administracion",
    });

    return json({ ok: true });
  } catch (err) {
    return json({ error: err.message });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function serializeRecordatorio(obj) {
  var rawFecha = obj.fecha;
  var fechaStr;
  if (rawFecha && typeof rawFecha.getTime === "function") {
    fechaStr = String(rawFecha.getDate()).padStart(2,"0") + "/" + String(rawFecha.getMonth()+1).padStart(2,"0") + "/" + rawFecha.getFullYear();
  } else {
    fechaStr = String(rawFecha || "");
  }
  return { fecha: fechaStr, ccMes: Number(obj.ccMes || 0), ccAnio: Number(obj.ccAnio || 0), to: obj.to || "", frName: obj.frName || "", tipo: obj.tipo || "cc", empresa: obj.empresa || "", currency: obj.currency || "" };
}

const json = d => ContentService
  .createTextOutput(JSON.stringify(d))
  .setMimeType(ContentService.MimeType.JSON);

const err = m => json({ error: m });
