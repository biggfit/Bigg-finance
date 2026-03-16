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
    const hasEmpresa  = headers.length >= 3 && String(headers[1]).toLowerCase() === "empresa";
    const hasCurrency = hasEmpresa && headers.length >= 4 && String(headers[2]).toLowerCase() === "currency";
    if (hasEmpresa) {
      const saldos = {};
      data.forEach(row => {
        const frId    = String(row[0]);
        const empresa = row[1] !== "" ? String(row[1]) : "ÑAKO SRL";
        const currency = hasCurrency ? (row[2] !== "" ? String(row[2]) : null) : null;
        const saldo   = Number(hasCurrency ? row[3] : row[2]);
        if (!saldos[empresa]) saldos[empresa] = {};
        // En caso de duplicados, conservar el de mayor saldo absoluto
        const prev = saldos[empresa][frId];
        const prevAmt = prev != null ? (typeof prev === "object" ? (prev.saldo ?? 0) : prev) : null;
        if (prevAmt === null || Math.abs(saldo) > Math.abs(prevAmt)) {
          saldos[empresa][frId] = { saldo, currency };
        }
      });
      return json(saldos);
    } else {
      // Formato legado: devolver objeto plano { frId: saldo }
      const saldos = Object.fromEntries(
        data.map(([frId, amount]) => [String(frId), Number(amount)])
      );
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

  return err("acción desconocida: " + body.action);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const json = d => ContentService
  .createTextOutput(JSON.stringify(d))
  .setMimeType(ContentService.MimeType.JSON);

const err = m => json({ error: m });
