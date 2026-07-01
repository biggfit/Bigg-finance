// Extracto InterAudi (BigFit LLC, cuentas USD/EUR) — CSV con cabecera:
//   Date, Id, Currency, AccoutType, AccountNumber, DebitCredit, Description1, Description2, Amount
// Distinto a Galicia: fecha ya ISO, monto positivo (el signo lo da DebitCredit), sin saldo
// corriente pero con un Id ÚNICO por fila → lo usamos como clave de dedup (fecha|Id).
//
// Se parsea el CSV como TEXTO (no XLSX): XLSX coacciona "2026-06-29" a serial Excel y mete
// líos de timezone/epoch (off-by-one). El texto crudo preserva la fecha ISO exacta.

const IA_REQ = ["Date", "DebitCredit", "Amount", "Description1"];

// CSV → array de arrays, respetando comillas con comas internas ("ATLASSIAN,SF,CA").
function parseCSV(text) {
  return text.split(/\r?\n/).filter(l => l.trim().length).map(line => {
    const out = []; let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  });
}

export function isInterAudiFormat(rows) {
  if (!rows || rows.length < 2) return false;
  const h = rows[0].map(c => String(c).trim());
  return IA_REQ.every(col => h.includes(col));
}

/** Parsea un .csv de extracto InterAudi. Retorna Promise<{ lineas, fuente, total }>. */
export function parseInterAudi(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const rows = parseCSV(String(e.target.result || ""));
        if (!isInterAudiFormat(rows)) {
          reject(new Error("El archivo no tiene formato de extracto InterAudi (Date/DebitCredit/Amount/Description1)"));
          return;
        }
        const h   = rows[0].map(c => String(c).trim());
        const col = (name) => h.indexOf(name);
        const ci  = {
          date: col("Date"), id: col("Id"), dc: col("DebitCredit"),
          d1: col("Description1"), d2: col("Description2"), amt: col("Amount"),
        };

        const lineas = rows.slice(1)
          .filter(r => String(r[ci.date] || "").trim() && String(r[ci.amt] ?? "").trim() !== "")
          .map((r, idx) => {
            const amount  = Math.abs(Number(r[ci.amt]) || 0);
            const isDebit = String(r[ci.dc]).trim().toUpperCase() === "DEBIT";
            const d1 = String(r[ci.d1] || "").trim();   // contraparte / concepto
            const d2 = String(r[ci.d2] || "").trim();   // sub-tipo (Funds Transfer / Debit Card / Other / ACH)
            // "WIRE FEE OCEANTEC LTDA" / "FEES - INVFX… ABUDINO" → contraparte limpia (a qué
            // proveedor/cliente pertenece la comisión) para saber a qué cuenta/centro pegarla.
            const feeM = d1.match(/^(?:WIRE\s+FEE|FEES)\s*-?\s*(.+)$/i);
            const contraparte = feeM ? feeM[1].trim() : d1;
            return {
              idx,
              fecha:          String(r[ci.date]).trim().slice(0, 10),
              descripcion:    d2 ? `${d1} · ${d2}` : d1,   // glosa completa (conserva "WIRE FEE" para la regla)
              monto:          isDebit ? -amount : amount,
              ley1:           contraparte,
              contraparte:    contraparte,
              ley2: "", ley3: d2, ley4: "", cuit: "",
              codigoConcepto: "",
              saldo:          String(r[ci.id] || `IA-${idx}`),   // Id único → dedup (fecha|Id)
            };
          });

        resolve({ lineas, fuente: "interaudi", total: lineas.length });
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error("Error al leer el archivo"));
    reader.readAsText(file);
  });
}
