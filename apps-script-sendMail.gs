// ─────────────────────────────────────────────────────────────────────────────
// SNIPPET para agregar al Apps Script existente (dentro del switch de actions)
// ─────────────────────────────────────────────────────────────────────────────
//
// En tu doPost(e), dentro del switch(data.action) { ... }, agrega:
//
//   case "sendMail":
//     return handleSendMail(data);
//
// Y agrega esta función fuera del doPost:

function handleSendMail(data) {
  try {
    var to       = data.to;
    var subject  = data.subject  || "(sin asunto)";
    var htmlBody = data.htmlBody || "";

    // Convertir los adjuntos de base64 a Blobs de Google
    var attachments = (data.attachments || []).map(function(att) {
      var decoded = Utilities.base64Decode(att.data);
      return Utilities.newBlob(decoded, att.mimeType, att.name);
    });

    GmailApp.sendEmail(to, subject, "", {
      from:        "pagos@bigg.fit",   // debe ser alias configurado en la cuenta del script
      htmlBody:    htmlBody,
      attachments: attachments,
      name:        "BIGG Finance",
    });

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANTE: Después de agregar este código, republicá el Apps Script:
//   Implementar → Administrar implementaciones → (tu implementación activa) → Editar → Nueva versión → Guardar
//
// Permisos necesarios: "https://www.googleapis.com/auth/gmail.send"
// La primera vez que se ejecute, Google pedirá autorización.
// ─────────────────────────────────────────────────────────────────────────────
