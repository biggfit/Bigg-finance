import { useState, useMemo, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { MONTHS, AVAILABLE_YEARS, computeSaldoPrevMes, fmt, uid } from "../lib/helpers";
import { useStore } from "../lib/context";
import { appendComp } from "../lib/sheetsApi";

// ─── AUTO-DISCARD RULES ───────────────────────────────────────────────────────
const DISCARD_GRUPOS = new Set([
  "000901 - Impuestos",
  "000808 - Comisiones",
  "000814 - Intereses",
  "000083 - Pagos",
  "000908 - Haberes",
  "000916 - Inversiones",
]);
const INCLUDE_GRUPOS = new Set([
  "000907 - Transferencias",
  "000909 - Pago Proveedores",
  "000903 - Créditos Varios",
]);
// Partial strings that indicate "own account" transfers within Transferencias
const DISCARD_CONC_PARTIALS = ["TRANSF. CTAS PROPIAS", "TRANSF. AFIP"];
// CUITs of own accounts to discard
const DISCARD_CUITS = new Set(["30717028305"]);

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const normCuit = (c) => String(c ?? "").replace(/[-\s]/g, "").trim();

/** Accent-insensitive lowercase header normalizer */
const normHeader = (h) =>
  String(h ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

function buildCuitMap(franchises) {
  const map = new Map();
  for (const fr of franchises) {
    if (fr.activa === false) continue;
    const c = normCuit(fr.cuit);
    if (!c) continue;
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(fr);
  }
  return map;
}

function parseExcelDate(val) {
  if (val instanceof Date) {
    const d = String(val.getDate()).padStart(2, "0");
    const m = String(val.getMonth() + 1).padStart(2, "0");
    return `${d}/${m}/${val.getFullYear()}`;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    // D/MM/YYYY or DD/MM/YYYY
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
      const [d, m, y] = trimmed.split("/");
      return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
    }
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      const [y, m, d] = trimmed.slice(0, 10).split("-");
      return `${d}/${m}/${y}`;
    }
  }
  if (typeof val === "number") {
    // Excel serial date (fallback for cellDates:true miss)
    const jsDate = new Date(Math.round((val - 25569) * 86400 * 1000));
    const d = String(jsDate.getUTCDate()).padStart(2, "0");
    const m = String(jsDate.getUTCMonth() + 1).padStart(2, "0");
    return `${d}/${m}/${jsDate.getUTCFullYear()}`;
  }
  return String(val ?? "");
}

function parseMoney(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  // Handle Argentine format: 1.234.567,89
  const s = String(val)
    .replace(/[$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ─── PARSER ──────────────────────────────────────────────────────────────────
function parseExtracto(wb, targetMonth, targetYear, franchises, comps, saldoInicial) {
  const sheet = wb.Sheets["Movimientos"];
  if (!sheet) throw new Error('El archivo no contiene la hoja "Movimientos"');

  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Find header row (first row containing a cell matching "fecha")
  const headerIdx = rawRows.findIndex(
    (r) => Array.isArray(r) && r.some((c) => /^fecha$/.test(normHeader(c)))
  );
  if (headerIdx < 0)
    throw new Error("No se encontró la fila de encabezado (columna 'Fecha')");

  const headers = rawRows[headerIdx].map((h) => normHeader(h));
  const ci = (re) => headers.findIndex((h) => re.test(h));

  const col = {
    date:  ci(/^fecha$/)           >= 0 ? ci(/^fecha$/)           : 0,
    nro:   ci(/numero de comp/)    >= 0 ? ci(/numero de comp/)    : 1,
    deb:   ci(/debitos/)           >= 0 ? ci(/debitos/)           : 2,
    cred:  ci(/creditos/)          >= 0 ? ci(/creditos/)          : 3,
    grupo: ci(/grupo de concepto/) >= 0 ? ci(/grupo de concepto/) : 5,
    conc:  ci(/^concepto$/)        >= 0 ? ci(/^concepto$/)        : 6,
    ley1:  ci(/leyendas adicionales 1/) >= 0 ? ci(/leyendas adicionales 1/) : 7,
    ley2:  ci(/leyendas adicionales 2/) >= 0 ? ci(/leyendas adicionales 2/) : 8,
  };

  const cuitMap = buildCuitMap(franchises);
  const items = [];

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!Array.isArray(row) || row.every((c) => c == null || c === "")) continue;

    // Parse date & filter by target month/year
    const fechaStr = parseExcelDate(row[col.date]);
    const parts = fechaStr.split("/");
    if (parts.length !== 3) continue;
    const rowMonth = parseInt(parts[1], 10) - 1; // 0-indexed
    const rowYear  = parseInt(parts[2], 10);
    if (rowMonth !== targetMonth || rowYear !== targetYear) continue;

    const grupo   = String(row[col.grupo] ?? "").trim();
    const conc    = String(row[col.conc]  ?? "").trim();
    const ley1    = String(row[col.ley1]  ?? "").trim();
    const ley2    = String(row[col.ley2]  ?? "").trim();
    const nroComp = String(row[col.nro]   ?? "").trim();
    const debAmt  = parseMoney(row[col.deb]);
    const credAmt = parseMoney(row[col.cred]);

    if (debAmt === 0 && credAmt === 0) continue;

    // Auto-discard by Grupo
    if (!INCLUDE_GRUPOS.has(grupo)) continue;

    // Auto-discard specific conceptos
    if (DISCARD_CONC_PARTIALS.some((p) => conc.includes(p))) continue;

    const cuitNorm = normCuit(ley2);

    // Auto-discard own-account CUITs
    if (DISCARD_CUITS.has(cuitNorm)) continue;

    const direction = credAmt > 0 ? "in" : "out";
    const amount    = direction === "in" ? credAmt : debAmt;
    const frs       = cuitNorm ? (cuitMap.get(cuitNorm) ?? []) : [];
    const groupId   = uid();

    if (frs.length === 0) {
      // Unknown CUIT → red row, user can only delete
      items.push({
        id: uid(), groupId,
        fecha: fechaStr, entidad: ley1, cuit: cuitNorm,
        montoOriginal: amount, monto: amount,
        direction, nroComp,
        frId: null, frOptions: [],
        movType: direction === "out" ? "PAGO_ENVIADO" : null,
        autoClassified: direction === "out",
        deleted: false,
      });
    } else if (frs.length === 1) {
      const fr = frs[0];
      let movType = direction === "out" ? "PAGO_ENVIADO" : null;
      let autoC   = direction === "out";

      if (direction === "in") {
        const saldoPrev = computeSaldoPrevMes(
          fr.id, targetYear, targetMonth, comps, saldoInicial, fr.moneda
        );
        if (Math.abs(saldoPrev) > 0) {
          const diff = Math.abs(amount - Math.abs(saldoPrev));
          const tol  = Math.max(500, Math.abs(saldoPrev) * 0.02);
          if (diff <= tol) { movType = "PAGO"; autoC = true; }
        }
      }

      items.push({
        id: uid(), groupId,
        fecha: fechaStr, entidad: ley1, cuit: cuitNorm,
        montoOriginal: amount, monto: amount,
        direction, nroComp,
        frId: fr.id, frOptions: frs,
        movType, autoClassified: autoC,
        deleted: false,
      });
    } else {
      // Multi-sede (same CUIT → N franchises)
      if (direction === "in") {
        const saldos = frs.map((fr) =>
          computeSaldoPrevMes(fr.id, targetYear, targetMonth, comps, saldoInicial, fr.moneda)
        );
        const sumSaldos = saldos.reduce((a, s) => a + Math.abs(s), 0);
        const globalMatch =
          sumSaldos > 0 &&
          Math.abs(amount - sumSaldos) <= Math.max(500, sumSaldos * 0.02);

        frs.forEach((fr, idx) => {
          const frMonto = globalMatch
            ? Math.abs(saldos[idx])
            : idx === 0
            ? amount
            : 0;
          items.push({
            id: uid(), groupId,
            fecha: fechaStr, entidad: ley1, cuit: cuitNorm,
            montoOriginal: amount, monto: frMonto,
            direction, nroComp,
            frId: fr.id, frOptions: frs,
            movType: globalMatch ? "PAGO" : null,
            autoClassified: globalMatch,
            deleted: false,
          });
        });
      } else {
        // Outgoing multi-sede (edge case)
        frs.forEach((fr, idx) => {
          items.push({
            id: uid(), groupId,
            fecha: fechaStr, entidad: ley1, cuit: cuitNorm,
            montoOriginal: amount, monto: idx === 0 ? amount : 0,
            direction, nroComp,
            frId: fr.id, frOptions: frs,
            movType: "PAGO_ENVIADO", autoClassified: true,
            deleted: false,
          });
        });
      }
    }
  }

  return items;
}

// ─── SEMÁFORO ────────────────────────────────────────────────────────────────
const SEM = { green: "#4ade80", yellow: "#facc15", red: "#f87171" };

function getStatus(row, allRows) {
  if (row.frId === null) return "red";
  if (row.movType === null) return "yellow";
  if (row.frOptions.length > 1) {
    const group = allRows.filter((r) => r.groupId === row.groupId && !r.deleted);
    const total = group.reduce((s, r) => s + (r.monto || 0), 0);
    if (Math.abs(total - row.montoOriginal) > 0.01) return "yellow";
  }
  return "green";
}

function SemDot({ color, size = 9 }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%",
        background: SEM[color], flexShrink: 0, display: "inline-block",
      }}
    />
  );
}

// ─── MAIN MODAL ──────────────────────────────────────────────────────────────
export default function ImportBankModal({ franchises, month, year, addComp, onClose }) {
  const { comps, saldoInicial } = useStore();

  const [stage,     setStage]    = useState(1);
  const [selMonth,  setSelMonth] = useState(month);
  const [selYear,   setSelYear]  = useState(year);
  const [rows,      setRows]     = useState([]);
  const [parseErr,  setParseErr] = useState(null);
  const [importing, setImporting]= useState(false);
  const [summary,   setSummary]  = useState(null);
  const fileRef = useRef(null);

  // Group rows by groupId for multi-sede rendering
  const groups = useMemo(() => {
    const seen = new Set();
    return rows.reduce((acc, row) => {
      if (!seen.has(row.groupId)) {
        seen.add(row.groupId);
        acc.push(rows.filter((r) => r.groupId === row.groupId));
      }
      return acc;
    }, []);
  }, [rows]);

  const activeRows = rows.filter((r) => !r.deleted);
  const canImport  =
    activeRows.length > 0 &&
    activeRows.every((r) => getStatus(r, rows) === "green");

  // ─── File handler ───────────────────────────────────────────────────────
  const handleFile = useCallback(
    (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = ""; // allow re-upload of same file
      setParseErr(null);
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(ev.target.result, { type: "array", cellDates: true });
          const parsed = parseExtracto(
            wb, selMonth, selYear, franchises, comps, saldoInicial
          );
          if (parsed.length === 0) {
            setParseErr(
              `No se encontraron movimientos para ${MONTHS[selMonth]} ${selYear} en el extracto.`
            );
            return;
          }
          setRows(parsed);
          setStage(3);
        } catch (err) {
          setParseErr(err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    },
    [selMonth, selYear, franchises, comps, saldoInicial]
  );

  // ─── Row mutations ──────────────────────────────────────────────────────
  const deleteRow = useCallback(
    (id) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, deleted: true } : r))),
    []
  );
  const setMovType = useCallback(
    (id, val) =>
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, movType: val || null } : r))
      ),
    []
  );
  const setMonto = useCallback((id, val) => {
    const n = parseFloat(String(val).replace(",", ".")) || 0;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, monto: n } : r)));
  }, []);

  // ─── Import ─────────────────────────────────────────────────────────────
  const handleImport = useCallback(async () => {
    setImporting(true);
    const toImport = rows.filter((r) => !r.deleted);
    const counts = { PAGO: 0, PAGO_PAUTA: 0, PAGO_ENVIADO: 0 };
    const totals = { PAGO: 0, PAGO_PAUTA: 0, PAGO_ENVIADO: 0 };

    for (const row of toImport) {
      const [dd, mm, yy] = row.fecha.split("/");
      const comp = {
        id: uid(),
        type: row.movType,
        amount: row.monto,
        date: row.fecha,
        month: parseInt(mm, 10) - 1,
        year: parseInt(yy, 10),
        currency: "ARS",
        ...(row.nroComp ? { invoice: row.nroComp } : {}),
        ...(row.entidad ? { nota: row.entidad }   : {}),
      };
      addComp(row.frId, comp);
      try { await appendComp(row.frId, comp); } catch (_) { /* offline graceful */ }

      if (row.movType in counts) {
        counts[row.movType]++;
        totals[row.movType] += row.monto;
      }
    }

    setSummary({ counts, totals, total: toImport.length });
    setImporting(false);
  }, [rows, addComp]);

  // ─── Overlay backdrop ───────────────────────────────────────────────────
  const handleBackdrop = useCallback(
    (e) => { if (e.target === e.currentTarget) onClose(); },
    [onClose]
  );

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.65)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={handleBackdrop}
    >
      <div
        style={{
          background: "var(--bg2)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "24px 28px",
          width: "min(92vw, 860px)",
          maxHeight: "90vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}
      >
        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>
            Importar Extracto Banco Galicia
          </span>
          <span style={{ fontSize: 10, color: "var(--text2)", marginLeft: "auto" }}>
            {!summary && stage < 3 && `Paso ${stage} de 2`}
            {!summary && stage === 3 && `Vista previa — ${MONTHS[selMonth]} ${selYear}`}
            {summary && `✅ Importación completada`}
          </span>
          <button
            className="ghost"
            style={{ fontSize: 14, padding: "1px 7px", marginLeft: 4 }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* ── Stage 1: Selector de mes ── */}
        {stage === 1 && (
          <Stage1
            selMonth={selMonth}
            selYear={selYear}
            onMonthChange={setSelMonth}
            onYearChange={setSelYear}
            onNext={() => setStage(2)}
          />
        )}

        {/* ── Stage 2: Upload ── */}
        {stage === 2 && (
          <Stage2
            selMonth={selMonth}
            selYear={selYear}
            fileRef={fileRef}
            parseErr={parseErr}
            onFile={handleFile}
            onBack={() => { setStage(1); setParseErr(null); }}
          />
        )}

        {/* ── Stage 3: Preview ── */}
        {stage === 3 && !summary && (
          <PreviewTable
            rows={rows}
            groups={groups}
            activeCount={activeRows.length}
            canImport={canImport}
            importing={importing}
            onDelete={deleteRow}
            onSetMovType={setMovType}
            onSetMonto={setMonto}
            onImport={handleImport}
            onBack={() => { setRows([]); setStage(2); }}
          />
        )}

        {/* ── Post-import summary ── */}
        {summary && (
          <ImportSummary
            summary={summary}
            month={selMonth}
            year={selYear}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

// ─── STAGE 1 — Selector de mes ───────────────────────────────────────────────
function Stage1({ selMonth, selYear, onMonthChange, onYearChange, onNext }) {
  const selStyle = {
    fontSize: 12, padding: "5px 10px",
    background: "var(--bg)", border: "1px solid var(--border2)",
    borderRadius: 6, color: "var(--text)",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <p style={{ fontSize: 12, color: "var(--text2)", margin: 0 }}>
        Seleccioná el período del extracto a importar. Solo se procesarán los
        movimientos de ese mes y año.
      </p>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--text2)" }}>Mes</label>
        <select value={selMonth} onChange={(e) => onMonthChange(+e.target.value)} style={selStyle}>
          {MONTHS.map((m, i) => (
            <option key={i} value={i}>{m}</option>
          ))}
        </select>
        <label style={{ fontSize: 12, color: "var(--text2)" }}>Año</label>
        <select value={selYear} onChange={(e) => onYearChange(+e.target.value)} style={selStyle}>
          {AVAILABLE_YEARS.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          className="ghost"
          style={{ fontSize: 12, fontWeight: 600, padding: "6px 20px", border: "1px solid var(--border2)" }}
          onClick={onNext}
        >
          Siguiente →
        </button>
      </div>
    </div>
  );
}

// ─── STAGE 2 — Upload ────────────────────────────────────────────────────────
function Stage2({ selMonth, selYear, fileRef, parseErr, onFile, onBack }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ fontSize: 12, color: "var(--text2)", margin: 0 }}>
        Subí el extracto{" "}
        <strong style={{ color: "var(--text)" }}>
          {MONTHS[selMonth]} {selYear}
        </strong>{" "}
        en formato <code>.xlsx</code>. El archivo debe tener una hoja llamada{" "}
        <code>Movimientos</code>.
      </p>

      {/* Drop zone */}
      <div
        style={{
          border: "2px dashed var(--border2)",
          borderRadius: 10,
          padding: "36px 20px",
          textAlign: "center",
          cursor: "pointer",
        }}
        onClick={() => fileRef.current?.click()}
      >
        <div style={{ fontSize: 30, marginBottom: 8 }}>📁</div>
        <div style={{ fontSize: 13, color: "var(--text2)" }}>
          Clic para seleccionar el archivo <strong>.xlsx</strong>
        </div>
        <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 6 }}>
          Hoja requerida: Movimientos
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        onChange={onFile}
      />

      {parseErr && (
        <div
          style={{
            fontSize: 12, color: "var(--red)",
            background: "rgba(248,113,113,.1)",
            border: "1px solid rgba(248,113,113,.3)",
            borderRadius: 6, padding: "8px 12px",
          }}
        >
          ⚠ {parseErr}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-start" }}>
        <button className="ghost" style={{ fontSize: 12 }} onClick={onBack}>
          ← Volver
        </button>
      </div>
    </div>
  );
}

// ─── STAGE 3 — Preview table ─────────────────────────────────────────────────
function PreviewTable({
  rows, groups, activeCount, canImport, importing,
  onDelete, onSetMovType, onSetMonto, onImport, onBack,
}) {
  const thS = {
    textAlign: "left", fontSize: 10, fontWeight: 600,
    color: "var(--text2)", padding: "5px 8px", whiteSpace: "nowrap",
    borderBottom: "1px solid var(--border)",
    textTransform: "none", letterSpacing: "normal",
  };
  const tdS = { padding: "5px 8px", fontSize: 11, verticalAlign: "middle" };

  // Build flat list of table rows (avoids fragment-key issues)
  const tableRows = [];

  groups.forEach((groupRows) => {
    const isMulti = groupRows[0]?.frOptions?.length > 1;
    const activeGroupRows = groupRows.filter((r) => !r.deleted);
    const montoOrig = groupRows[0]?.montoOriginal ?? 0;
    const totalDist = activeGroupRows.reduce((s, r) => s + (r.monto || 0), 0);
    const distOk = Math.abs(totalDist - montoOrig) <= 0.01;

    groupRows.forEach((row) => {
      if (row.deleted) return;
      const status = getStatus(row, rows);
      const fr     = row.frOptions.find((f) => f.id === row.frId);
      const isOut  = row.direction === "out";

      tableRows.push(
        <tr
          key={row.id}
          style={{
            borderBottom: "1px solid var(--border)",
            background: status === "red" ? "rgba(248,113,113,.04)" : "transparent",
          }}
        >
          {/* Semáforo */}
          <td style={{ ...tdS, paddingLeft: 6, paddingRight: 4 }}>
            <SemDot color={status} />
          </td>

          {/* Fecha */}
          <td style={{ ...tdS, whiteSpace: "nowrap", color: "var(--text2)", fontSize: 10 }}>
            {row.fecha.slice(0, 5)}
          </td>

          {/* Entidad */}
          <td
            style={{
              ...tdS, maxWidth: 170, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
            title={row.entidad}
          >
            {row.entidad || "—"}
          </td>

          {/* CUIT */}
          <td style={{ ...tdS, fontFamily: "monospace", fontSize: 10, color: "var(--text2)" }}>
            {row.cuit || "—"}
          </td>

          {/* Sede */}
          <td style={tdS}>
            {fr ? (
              <span>{fr.name}</span>
            ) : (
              <span style={{ color: "var(--red)", fontSize: 10 }}>Sin mapeo</span>
            )}
          </td>

          {/* Monto */}
          <td style={{ ...tdS, textAlign: "right" }}>
            {isMulti ? (
              <input
                type="number"
                value={row.monto}
                onChange={(e) => onSetMonto(row.id, e.target.value)}
                style={{
                  width: 92, textAlign: "right", fontSize: 11,
                  background: "var(--bg)", color: "var(--text)",
                  border: "1px solid var(--border)", borderRadius: 4,
                  padding: "2px 6px",
                }}
              />
            ) : (
              <span
                style={{
                  color: isOut ? "var(--orange)" : "var(--green)",
                  fontWeight: 600, fontSize: 11,
                }}
              >
                {isOut ? "−" : "+"}{fmt(row.monto, "ARS")}
              </span>
            )}
          </td>

          {/* Tipo */}
          <td style={tdS}>
            {row.frId === null ? (
              <span style={{ fontSize: 10, color: "var(--text2)" }}>—</span>
            ) : isOut ? (
              <span style={{ fontSize: 10, color: "var(--orange)" }}>Transf. Enviada</span>
            ) : (
              <select
                value={row.movType ?? ""}
                onChange={(e) => onSetMovType(row.id, e.target.value)}
                style={{
                  fontSize: 11, padding: "2px 6px",
                  background: "var(--bg)", color: row.movType ? "var(--text)" : "var(--text2)",
                  border: `1px solid ${status === "yellow" ? "#facc15" : "var(--border)"}`,
                  borderRadius: 4,
                }}
              >
                <option value="">— Seleccionar —</option>
                <option value="PAGO">Pago Recibido</option>
                <option value="PAGO_PAUTA">Pago a Cuenta</option>
              </select>
            )}
          </td>

          {/* Delete */}
          <td style={{ ...tdS, textAlign: "center" }}>
            <button
              className="ghost"
              style={{ fontSize: 13, padding: "0 5px", color: "var(--text2)" }}
              onClick={() => onDelete(row.id)}
              title="Eliminar fila"
            >
              ✕
            </button>
          </td>
        </tr>
      );
    });

    // Multi-sede: distribution footer row
    if (isMulti && activeGroupRows.length > 0) {
      tableRows.push(
        <tr key={`dist-${groupRows[0].groupId}`} style={{ background: "var(--bg)" }}>
          <td colSpan={5} />
          <td colSpan={3} style={{ ...tdS, fontSize: 10, color: "var(--text2)", paddingTop: 3, paddingBottom: 3 }}>
            <span>Total original: {fmt(montoOrig, "ARS")}</span>
            <span style={{ margin: "0 8px", color: "var(--border2)" }}>|</span>
            <span>
              Distribuido:{" "}
              <strong style={{ color: distOk ? "var(--green)" : "var(--red)" }}>
                {fmt(totalDist, "ARS")}
              </strong>
            </span>
            <span style={{ marginLeft: 6 }}>{distOk ? "✅" : "⚠️"}</span>
          </td>
        </tr>
      );
    }
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Legend */}
      <div style={{ display: "flex", gap: 14, fontSize: 10, color: "var(--text2)", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <SemDot color="green" /> Listo
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <SemDot color="yellow" /> Pendiente de clasificar
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <SemDot color="red" /> CUIT sin mapeo — solo eliminar
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--bg)" }}>
              <th style={{ ...thS, width: 20 }} />
              <th style={thS}>Fecha</th>
              <th style={thS}>Entidad</th>
              <th style={thS}>CUIT</th>
              <th style={thS}>Sede</th>
              <th style={{ ...thS, textAlign: "right" }}>Monto</th>
              <th style={thS}>Tipo</th>
              <th style={{ ...thS, width: 30 }} />
            </tr>
          </thead>
          <tbody>
            {tableRows.length > 0 ? (
              tableRows
            ) : (
              <tr>
                <td
                  colSpan={8}
                  style={{ textAlign: "center", padding: "28px 0", fontSize: 12, color: "var(--text2)" }}
                >
                  Todos los movimientos fueron eliminados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer actions */}
      <div
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          paddingTop: 10, borderTop: "1px solid var(--border)",
        }}
      >
        <button className="ghost" style={{ fontSize: 12 }} onClick={onBack}>
          ← Volver
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!canImport && activeCount > 0 && (
            <span style={{ fontSize: 10, color: "var(--text2)" }}>
              Completá las filas amarillas para importar
            </span>
          )}
          <button
            className="ghost"
            style={{
              fontSize: 12, fontWeight: 600,
              padding: "6px 20px",
              border: "1px solid var(--border2)",
              opacity: canImport && !importing ? 1 : 0.38,
              cursor: canImport && !importing ? "pointer" : "not-allowed",
            }}
            disabled={!canImport || importing}
            onClick={onImport}
          >
            {importing
              ? "Importando…"
              : `Importar ${activeCount} movimiento${activeCount !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── POST-IMPORT SUMMARY ─────────────────────────────────────────────────────
function ImportSummary({ summary, month, year, onClose }) {
  const { counts, totals, total } = summary;

  const lines = [
    counts.PAGO_ENVIADO > 0 && {
      label: "Transferencias enviadas",
      count: counts.PAGO_ENVIADO,
      total: totals.PAGO_ENVIADO,
    },
    counts.PAGO > 0 && {
      label: "Pagos recibidos",
      count: counts.PAGO,
      total: totals.PAGO,
    },
    counts.PAGO_PAUTA > 0 && {
      label: "Pagos a cuenta",
      count: counts.PAGO_PAUTA,
      total: totals.PAGO_PAUTA,
    },
  ].filter(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 22 }}>✅</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            Importación completada
          </div>
          <div style={{ fontSize: 11, color: "var(--text2)" }}>
            {MONTHS[month]} {year}
          </div>
        </div>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        {lines.map(({ label, count, total: lineTotal }) => (
          <div
            key={label}
            style={{
              display: "flex", justifyContent: "space-between",
              alignItems: "center", padding: "10px 16px",
              borderBottom: "1px solid var(--border)", fontSize: 12,
            }}
          >
            <span style={{ color: "var(--text2)" }}>{label}</span>
            <span>
              <strong style={{ color: "var(--text)" }}>{count}</strong>
              <span style={{ color: "var(--text2)", marginLeft: 14 }}>
                {fmt(lineTotal, "ARS")}
              </span>
            </span>
          </div>
        ))}
        <div
          style={{
            display: "flex", justifyContent: "space-between",
            alignItems: "center", padding: "12px 16px",
            fontSize: 12, fontWeight: 700,
          }}
        >
          <span>Total importado</span>
          <span>{total} movimiento{total !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
        <button
          className="ghost"
          style={{
            fontSize: 12, fontWeight: 600,
            padding: "6px 20px", border: "1px solid var(--border2)",
          }}
          onClick={onClose}
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
