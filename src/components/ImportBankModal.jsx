import { useState, useMemo, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { MONTHS, AVAILABLE_YEARS, computeSaldoPrevMes, fmt, uid } from "../lib/helpers";
import { useStore } from "../lib/context";

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
const DISCARD_CONC_PARTIALS = ["TRANSF. CTAS PROPIAS", "TRANSF. AFIP"];
const DISCARD_CUITS = new Set(["30717028305", "30715754262"]); // NAKO NAKO, Sympass SAS

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const normCuit = (c) => String(c ?? "").replace(/[-\s]/g, "").trim();

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
    const t = val.trim();
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) {
      const [d, m, y] = t.split("/");
      return `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
      const [y, m, d] = t.slice(0, 10).split("-");
      return `${d}/${m}/${y}`;
    }
  }
  if (typeof val === "number") {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}/${d.getUTCFullYear()}`;
  }
  return String(val ?? "");
}

function parseMoney(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const s = String(val).replace(/[$\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ─── PARSER ──────────────────────────────────────────────────────────────────
function parseExtracto(wb, targetMonth, targetYear, franchises, comps, saldoInicial) {
  const sheet = wb.Sheets["Movimientos"];
  if (!sheet) throw new Error('El archivo no contiene la hoja "Movimientos"');

  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const headerIdx = rawRows.findIndex(
    (r) => Array.isArray(r) && r.some((c) => /^fecha$/.test(normHeader(c)))
  );
  if (headerIdx < 0)
    throw new Error("No se encontró la fila de encabezado (columna 'Fecha')");

  const headers = rawRows[headerIdx].map(normHeader);
  const ci = (re) => headers.findIndex((h) => re.test(h));

  const col = {
    date:  ci(/^fecha$/)                >= 0 ? ci(/^fecha$/)                : 0,
    nro:   ci(/numero de comp/)         >= 0 ? ci(/numero de comp/)         : 1,
    deb:   ci(/debitos/)                >= 0 ? ci(/debitos/)                : 2,
    cred:  ci(/creditos/)               >= 0 ? ci(/creditos/)               : 3,
    grupo: ci(/grupo de concepto/)      >= 0 ? ci(/grupo de concepto/)      : 5,
    conc:  ci(/^concepto$/)             >= 0 ? ci(/^concepto$/)             : 6,
    ley1:  ci(/leyendas adicionales 1/) >= 0 ? ci(/leyendas adicionales 1/) : 7,
    ley2:  ci(/leyendas adicionales 2/) >= 0 ? ci(/leyendas adicionales 2/) : 8,
  };

  const cuitMap = buildCuitMap(franchises);
  const items = [];

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!Array.isArray(row) || row.every((c) => c == null || c === "")) continue;

    const fechaStr = parseExcelDate(row[col.date]);
    const parts = fechaStr.split("/");
    if (parts.length !== 3) continue;
    const rowMonth = parseInt(parts[1], 10) - 1;
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
    if (!INCLUDE_GRUPOS.has(grupo)) continue;
    if (DISCARD_CONC_PARTIALS.some((p) => conc.includes(p))) continue;

    const cuitNorm = normCuit(ley2);
    if (DISCARD_CUITS.has(cuitNorm)) continue;

    const direction = credAmt > 0 ? "in" : "out";
    const amount    = direction === "in" ? credAmt : debAmt;
    const frs       = cuitNorm ? (cuitMap.get(cuitNorm) ?? []) : [];
    const groupId   = uid();

    if (frs.length === 0) {
      // Egresos a CUITs sin mapeo = pagos a terceros (PML, fideicomiso, etc.) → descartar
      if (direction === "out") continue;
      // Ingresos de CUITs sin mapeo → llevar al preview en rojo para que el usuario decida
      items.push({
        id: uid(), groupId,
        fecha: fechaStr, entidad: ley1, cuit: cuitNorm,
        montoOriginal: amount, monto: amount,
        direction, nroComp, frId: null, frOptions: [],
        movType: null, autoClassified: false, deleted: false,
      });
    } else if (frs.length === 1) {
      const fr = frs[0];
      let movType = direction === "out" ? "PAGO_ENVIADO" : null;
      let autoC   = direction === "out";
      if (direction === "in") {
        const sp = computeSaldoPrevMes(fr.id, targetYear, targetMonth, comps, saldoInicial, fr.moneda);
        if (Math.abs(sp) > 0) {
          const diff = Math.abs(amount - Math.abs(sp));
          if (diff <= Math.max(500, Math.abs(sp) * 0.02)) { movType = "PAGO"; autoC = true; }
        }
      }
      items.push({
        id: uid(), groupId,
        fecha: fechaStr, entidad: ley1, cuit: cuitNorm,
        montoOriginal: amount, monto: amount,
        direction, nroComp, frId: fr.id, frOptions: frs,
        movType, autoClassified: autoC, deleted: false,
      });
    } else {
      // Multi-sede
      if (direction === "in") {
        const saldos = frs.map((fr) =>
          computeSaldoPrevMes(fr.id, targetYear, targetMonth, comps, saldoInicial, fr.moneda)
        );
        const sumS = saldos.reduce((a, s) => a + Math.abs(s), 0);
        const globalMatch = sumS > 0 && Math.abs(amount - sumS) <= Math.max(500, sumS * 0.02);
        frs.forEach((fr, idx) => {
          items.push({
            id: uid(), groupId,
            fecha: fechaStr, entidad: ley1, cuit: cuitNorm,
            montoOriginal: amount,
            monto: globalMatch ? Math.abs(saldos[idx]) : idx === 0 ? amount : 0,
            direction, nroComp, frId: fr.id, frOptions: frs,
            movType: globalMatch ? "PAGO" : null,
            autoClassified: globalMatch, deleted: false,
          });
        });
      } else {
        frs.forEach((fr, idx) => {
          items.push({
            id: uid(), groupId,
            fecha: fechaStr, entidad: ley1, cuit: cuitNorm,
            montoOriginal: amount, monto: idx === 0 ? amount : 0,
            direction, nroComp, frId: fr.id, frOptions: frs,
            movType: "PAGO_ENVIADO", autoClassified: true, deleted: false,
          });
        });
      }
    }
  }
  return items;
}

// ─── SEMÁFORO ─────────────────────────────────────────────────────────────────
// "auto"   = auto-classified (yellow) — looks good, importable but worth reviewing
// "green"  = manually confirmed
// "yellow" = needs action (movType null or distribution mismatch)
// "red"    = CUIT not mapped

const SEM_COLOR = { green: "#4ade80", auto: "#facc15", yellow: "#facc15", red: "#f87171" };

function getStatus(row, allRows) {
  if (row.frId === null) return "red";
  if (row.movType === null) return "yellow";
  if (row.frOptions.length > 1) {
    const group = allRows.filter((r) => r.groupId === row.groupId && !r.deleted);
    const total = group.reduce((s, r) => s + (r.monto || 0), 0);
    if (Math.abs(total - row.montoOriginal) > 0.01) return "yellow";
  }
  if (row.autoClassified && row.direction === "in") return "auto";
  return "green";
}

function SemDot({ color, size = 9 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: SEM_COLOR[color], flexShrink: 0, display: "inline-block",
    }} />
  );
}

// ─── MAIN PANEL ──────────────────────────────────────────────────────────────
export default function ImportBankModal({ franchises, month, year, addComp, onClose }) {
  const { comps, saldoInicial } = useStore();

  const [stage,     setStage]    = useState(1);
  const [selMonth,  setSelMonth] = useState(month);
  const [selYear,   setSelYear]  = useState(year);
  const [rows,      setRows]     = useState([]);
  const [parseErr,  setParseErr] = useState(null);
  const [importing, setImporting]= useState(false);
  const [summary,   setSummary]  = useState(null);
  const [minimized, setMinimized]= useState(false);
  const fileRef = useRef(null);

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
    activeRows.every((r) => {
      const s = getStatus(r, rows);
      return s === "green" || s === "auto";
    });

  // Status label for minimized header
  const statusLabel = summary
    ? "✅ Importación completada"
    : stage === 1
    ? "Paso 1 — elegir período"
    : stage === 2
    ? `${MONTHS[selMonth]} ${selYear} — subir archivo`
    : `${MONTHS[selMonth]} ${selYear} · ${activeRows.length} mov.`;

  // Aggregate semaphore dot for the header (red > yellow > auto)
  const headerStatus = stage === 3 && !summary && activeRows.length > 0
    ? activeRows.some((r) => getStatus(r, rows) === "red")    ? "red"
    : activeRows.some((r) => getStatus(r, rows) === "yellow") ? "yellow"
    : "auto"
    : null;

  // ─── Handlers ───────────────────────────────────────────────────────────
  const handleFile = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setParseErr(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "array", cellDates: true });
        const parsed = parseExtracto(wb, selMonth, selYear, franchises, comps, saldoInicial);
        if (parsed.length === 0) {
          setParseErr(`No se encontraron movimientos para ${MONTHS[selMonth]} ${selYear} en el extracto.`);
          return;
        }
        setRows(parsed);
        setStage(3);
      } catch (err) {
        setParseErr(err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }, [selMonth, selYear, franchises, comps, saldoInicial]);

  const deleteRow   = useCallback((id) =>
    setRows((p) => p.map((r) => r.id === id ? { ...r, deleted: true } : r)), []);
  const setMovType  = useCallback((id, v) =>
    setRows((p) => p.map((r) => r.id === id ? { ...r, movType: v || null } : r)), []);
  const setMonto    = useCallback((id, v) => {
    const n = parseFloat(String(v).replace(",", ".")) || 0;
    setRows((p) => p.map((r) => r.id === id ? { ...r, monto: n } : r));
  }, []);
  const setFrId     = useCallback((id, frIdStr) => {
    const picked = franchises.find((f) => f.activa !== false && String(f.id) === frIdStr) ?? null;
    setRows((p) => p.map((r) => {
      if (r.id !== id) return r;
      return {
        ...r,
        frId:      picked ? picked.id : null,
        frOptions: picked ? [picked]  : [],
        // egresos: auto-tipo; ingresos: dejar que el usuario elija
        movType: picked && r.direction === "out" ? "PAGO_ENVIADO" : r.movType,
        autoClassified: false,
      };
    }));
  }, [franchises]);

  const handleImport = useCallback(async () => {
    setImporting(true);
    const toImport = rows.filter((r) => !r.deleted);
    const counts = { PAGO: 0, PAGO_PAUTA: 0, PAGO_ENVIADO: 0 };
    const totals = { PAGO: 0, PAGO_PAUTA: 0, PAGO_ENVIADO: 0 };
    for (const row of toImport) {
      const [, mm, yy] = row.fecha.split("/");
      const comp = {
        id: uid(), type: row.movType, amount: row.monto,
        date: row.fecha, month: parseInt(mm, 10) - 1, year: parseInt(yy, 10),
        currency: "ARS",
        ...(row.nroComp ? { invoice: row.nroComp } : {}),
        ...(row.entidad ? { nota: row.entidad }   : {}),
      };
      addComp(row.frId, comp);
      if (row.movType in counts) { counts[row.movType]++; totals[row.movType] += row.monto; }
    }
    setSummary({ counts, totals, total: toImport.length });
    setImporting(false);
  }, [rows, addComp]);

  // ─── Panel shell (fixed bottom, grows upward, no backdrop) ─────────────
  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(96vw, 940px)",
        background: "var(--bg2)",
        border: "1px solid var(--border)",
        borderBottom: "none",
        borderRadius: "14px 14px 0 0",
        boxShadow: "0 -6px 40px rgba(0,0,0,.38)",
        zIndex: 500,
        overflow: "hidden",
      }}
    >
      {/* ── Panel header (always visible, click to minimize) ── */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "11px 18px",
          borderBottom: minimized ? "none" : "1px solid var(--border)",
          cursor: "pointer", userSelect: "none",
          background: "var(--bg)",
        }}
        onClick={() => setMinimized((m) => !m)}
      >
        <span style={{ fontSize: 14 }}>🏦</span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Importar Extracto Banco Galicia</span>
        {minimized && (
          <span style={{
            fontSize: 10, color: "var(--text2)",
            background: "var(--bg2)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "2px 8px", marginLeft: 4,
          }}>
            {statusLabel}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "var(--text2)", pointerEvents: "none" }}>
            {minimized ? "▲ Expandir" : "▼ Minimizar"}
          </span>
          {headerStatus && <SemDot color={headerStatus} size={10} />}
          <button
            className="ghost"
            style={{ fontSize: 13, padding: "1px 6px" }}
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            title="Cerrar"
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Panel content (hidden when minimized) ── */}
      {!minimized && (
        <div style={{ maxHeight: "calc(100vh - 96px)", overflowY: "auto", padding: "22px 28px" }}>

          {/* Stage 1 */}
          {stage === 1 && (
            <Stage1
              selMonth={selMonth} selYear={selYear}
              onMonthChange={setSelMonth} onYearChange={setSelYear}
              onNext={() => setStage(2)}
            />
          )}

          {/* Stage 2 */}
          {stage === 2 && (
            <Stage2
              selMonth={selMonth} selYear={selYear}
              fileRef={fileRef} parseErr={parseErr}
              onFile={handleFile}
              onBack={() => { setStage(1); setParseErr(null); }}
            />
          )}

          {/* Stage 3 — Preview */}
          {stage === 3 && !summary && (
            <PreviewTable
              rows={rows} groups={groups}
              activeCount={activeRows.length}
              canImport={canImport} importing={importing}
              allFranchises={franchises}
              onDelete={deleteRow} onSetMovType={setMovType}
              onSetMonto={setMonto} onSetFrId={setFrId}
              onImport={handleImport}
              onBack={() => { setRows([]); setStage(2); }}
            />
          )}

          {/* Post-import summary */}
          {summary && (
            <ImportSummary
              summary={summary} month={selMonth} year={selYear}
              onClose={onClose}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── STAGE 1 ─────────────────────────────────────────────────────────────────
function Stage1({ selMonth, selYear, onMonthChange, onYearChange, onNext }) {
  const sel = {
    fontSize: 12, padding: "5px 10px",
    background: "var(--bg)", border: "1px solid var(--border2)",
    borderRadius: 6, color: "var(--text)",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <p style={{ fontSize: 12, color: "var(--text2)", margin: 0 }}>
        Seleccioná el período del extracto a importar. Solo se procesarán los movimientos de ese mes y año.
      </p>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--text2)" }}>Mes</label>
        <select value={selMonth} onChange={(e) => onMonthChange(+e.target.value)} style={sel}>
          {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
        </select>
        <label style={{ fontSize: 12, color: "var(--text2)" }}>Año</label>
        <select value={selYear} onChange={(e) => onYearChange(+e.target.value)} style={sel}>
          {AVAILABLE_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="ghost"
          style={{ fontSize: 12, fontWeight: 600, padding: "6px 20px", border: "1px solid var(--border2)" }}
          onClick={onNext}>
          Siguiente →
        </button>
      </div>
    </div>
  );
}

// ─── STAGE 2 ─────────────────────────────────────────────────────────────────
function Stage2({ selMonth, selYear, fileRef, parseErr, onFile, onBack }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ fontSize: 12, color: "var(--text2)", margin: 0 }}>
        Subí el extracto{" "}
        <strong style={{ color: "var(--text)" }}>{MONTHS[selMonth]} {selYear}</strong>{" "}
        en formato <code>.xlsx</code>. El archivo debe tener una hoja llamada <code>Movimientos</code>.
      </p>
      <div
        style={{ border: "2px dashed var(--border2)", borderRadius: 10, padding: "36px 20px", textAlign: "center", cursor: "pointer" }}
        onClick={() => fileRef.current?.click()}
      >
        <div style={{ fontSize: 30, marginBottom: 8 }}>📁</div>
        <div style={{ fontSize: 13, color: "var(--text2)" }}>Clic para seleccionar el archivo <strong>.xlsx</strong></div>
        <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 6 }}>Hoja requerida: Movimientos</div>
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={onFile} />
      {parseErr && (
        <div style={{ fontSize: 12, color: "var(--red)", background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.3)", borderRadius: 6, padding: "8px 12px" }}>
          ⚠ {parseErr}
        </div>
      )}
      <button className="ghost" style={{ fontSize: 12, alignSelf: "flex-start" }} onClick={onBack}>← Volver</button>
    </div>
  );
}

// ─── STAGE 3 — Preview table ─────────────────────────────────────────────────
function PreviewTable({ rows, groups, activeCount, canImport, importing, allFranchises, onDelete, onSetMovType, onSetMonto, onSetFrId, onImport, onBack }) {
  const thS = {
    textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--text2)",
    padding: "6px 10px", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)",
    textTransform: "none", letterSpacing: "normal",
  };
  const tdS = { padding: "5px 10px", fontSize: 11, verticalAlign: "middle" };

  // Build flat row list
  const tableRows = [];
  groups.forEach((groupRows) => {
    const isMulti = groupRows[0]?.frOptions?.length > 1;
    const activeGroupRows = groupRows.filter((r) => !r.deleted);
    const montoOrig  = groupRows[0]?.montoOriginal ?? 0;
    const totalDist  = activeGroupRows.reduce((s, r) => s + (r.monto || 0), 0);
    const distOk     = Math.abs(totalDist - montoOrig) <= 0.01;

    groupRows.forEach((row) => {
      if (row.deleted) return;
      const status = getStatus(row, rows);
      const fr     = row.frOptions.find((f) => f.id === row.frId);
      const isOut  = row.direction === "out";
      // Auto-classified incoming → yellow amount; outgoing → orange; manual incoming → green
      const amtColor = isOut
        ? "var(--orange)"
        : status === "auto"
        ? "#facc15"
        : "var(--green)";

      tableRows.push(
        <tr key={row.id} style={{
          borderBottom: "1px solid var(--border)",
          borderLeft: isMulti ? "3px solid rgba(34,211,238,.45)" : "3px solid transparent",
          background: isMulti ? "rgba(34,211,238,.03)" : undefined,
        }}>
          {/* Semáforo */}
          <td style={{ ...tdS, paddingLeft: 8, paddingRight: 4 }}>
            <SemDot color={status} />
          </td>
          {/* Fecha */}
          <td style={{ ...tdS, color: "var(--text2)", fontSize: 10, whiteSpace: "nowrap" }}>
            {row.fecha.slice(0, 5)}
          </td>
          {/* Entidad */}
          <td style={{ ...tdS, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.entidad}>
            {row.entidad || "—"}
          </td>
          {/* CUIT */}
          <td style={{ ...tdS, fontFamily: "monospace", fontSize: 10, color: "var(--text2)" }}>
            {row.cuit || "—"}
          </td>
          {/* Sede */}
          <td style={tdS}>
            {row.frOptions.length > 1 ? (
              // Multi-sede: solo texto (la distribución la maneja el grupo)
              <span>{fr?.name ?? "—"}</span>
            ) : (
              <select
                value={row.frId != null ? String(row.frId) : ""}
                onChange={(e) => onSetFrId(row.id, e.target.value)}
                style={{
                  fontSize: 11, padding: "2px 6px",
                  background: "var(--bg)",
                  color: row.frId != null ? "var(--text)" : "var(--text2)",
                  border: `1px solid ${row.frId != null ? "var(--border)" : "var(--red)"}`,
                  borderRadius: 4, maxWidth: 160,
                }}
              >
                <option value="">— Sin mapeo —</option>
                {allFranchises
                  .filter((f) => f.activa !== false)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((f) => <option key={f.id} value={String(f.id)}>{f.name}</option>)
                }
              </select>
            )}
          </td>
          {/* Monto */}
          <td style={{ ...tdS, textAlign: "right" }}>
            {isMulti ? (
              <input
                type="number" value={row.monto}
                onChange={(e) => onSetMonto(row.id, e.target.value)}
                style={{ width: 96, textAlign: "right", fontSize: 11, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px" }}
              />
            ) : (
              <span style={{ color: amtColor, fontWeight: 600, fontSize: 11 }}>
                {isOut ? "−" : "+"}{fmt(row.monto, "ARS")}
              </span>
            )}
          </td>
          {/* Tipo */}
          <td style={tdS}>
            {isOut ? (
              <span style={{ fontSize: 10, color: "var(--orange)" }}>Transf. Enviada</span>
            ) : (
              <select
                value={row.movType ?? ""}
                onChange={(e) => onSetMovType(row.id, e.target.value)}
                style={{
                  fontSize: 11, padding: "2px 6px", background: "var(--bg)",
                  color: row.movType ? "var(--text)" : "var(--text2)",
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
            <button className="ghost" style={{ fontSize: 13, padding: "0 5px", color: "var(--text2)" }}
              onClick={() => onDelete(row.id)} title="Eliminar">✕</button>
          </td>
        </tr>
      );
    });

    // Multi-sede distribution footer
    if (isMulti && activeGroupRows.length > 0) {
      tableRows.push(
        <tr key={`dist-${groupRows[0].groupId}`} style={{
          background: "rgba(34,211,238,.06)",
          borderLeft: "3px solid rgba(34,211,238,.45)",
          borderBottom: "2px solid rgba(34,211,238,.2)",
        }}>
          <td colSpan={5} />
          <td colSpan={3} style={{ ...tdS, fontSize: 10, color: "var(--text2)", paddingTop: 4, paddingBottom: 4 }}>
            <span>Total original: {fmt(montoOrig, "ARS")}</span>
            <span style={{ margin: "0 8px", color: "var(--border2)" }}>|</span>
            <span>Distribuido:{" "}
              <strong style={{ color: distOk ? "var(--green)" : "var(--red)" }}>{fmt(totalDist, "ARS")}</strong>
            </span>
            <span style={{ marginLeft: 6 }}>{distOk ? "✅" : "⚠️"}</span>
          </td>
        </tr>
      );
    }
  });

  // Stats bar
  const greenCount  = activeRows(rows).filter(r => getStatus(r,rows) === "green").length;
  const autoCount   = activeRows(rows).filter(r => getStatus(r,rows) === "auto").length;
  const yellowCount = activeRows(rows).filter(r => getStatus(r,rows) === "yellow").length;
  const redCount    = activeRows(rows).filter(r => getStatus(r,rows) === "red").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Legend + stats */}
      <div style={{ display: "flex", gap: 16, fontSize: 10, color: "var(--text2)", flexWrap: "wrap", alignItems: "center" }}>
        {greenCount > 0 && <StatBadge color="#4ade80" label={`${greenCount} confirmados`} />}
        {autoCount  > 0 && <StatBadge color="#facc15" label={`${autoCount} auto-clasificados`} />}
        {yellowCount > 0 && <StatBadge color="#facc15" label={`${yellowCount} pendientes`} />}
        {redCount   > 0 && <StatBadge color="#f87171" label={`${redCount} sin mapeo`} />}
        <span style={{ marginLeft: "auto", color: "var(--text2)" }}>
          {activeRows(rows).length} movimientos
        </span>
      </div>

      {/* Table */}
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflowX: "auto" }}>
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
            {tableRows.length > 0 ? tableRows : (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: "28px 0", fontSize: 12, color: "var(--text2)" }}>
                  Todos los movimientos fueron eliminados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTop: "1px solid var(--border)" }}>
        <button className="ghost" style={{ fontSize: 12 }} onClick={onBack}>← Volver</button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!canImport && activeCount > 0 && (
            <span style={{ fontSize: 10, color: "var(--text2)" }}>
              Completá las filas pendientes para importar
            </span>
          )}
          <button
            className="ghost"
            style={{ fontSize: 12, fontWeight: 600, padding: "6px 20px", border: "1px solid var(--border2)", opacity: canImport && !importing ? 1 : 0.38, cursor: canImport && !importing ? "pointer" : "not-allowed" }}
            disabled={!canImport || importing}
            onClick={onImport}
          >
            {importing ? "Importando…" : `Importar ${activeCount} movimiento${activeCount !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// helper inside PreviewTable to avoid name clash
function activeRows(rows) { return rows.filter(r => !r.deleted); }

function StatBadge({ color, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <SemDot color={color === "#4ade80" ? "green" : color === "#facc15" ? "yellow" : "red"} />
      {label}
    </span>
  );
}

// ─── POST-IMPORT SUMMARY ─────────────────────────────────────────────────────
function ImportSummary({ summary, month, year, onClose }) {
  const { counts, totals, total } = summary;
  const lines = [
    counts.PAGO_ENVIADO > 0 && { label: "Transferencias enviadas", count: counts.PAGO_ENVIADO, total: totals.PAGO_ENVIADO },
    counts.PAGO       > 0 && { label: "Pagos recibidos",          count: counts.PAGO,          total: totals.PAGO },
    counts.PAGO_PAUTA > 0 && { label: "Pagos a cuenta",           count: counts.PAGO_PAUTA,    total: totals.PAGO_PAUTA },
  ].filter(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 24 }}>✅</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Importación completada</div>
          <div style={{ fontSize: 11, color: "var(--text2)" }}>{MONTHS[month]} {year}</div>
        </div>
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        {lines.map(({ label, count, total: t }) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
            <span style={{ color: "var(--text2)" }}>{label}</span>
            <span>
              <strong>{count}</strong>
              <span style={{ color: "var(--text2)", marginLeft: 14 }}>{fmt(t, "ARS")}</span>
            </span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", fontSize: 12, fontWeight: 700 }}>
          <span>Total importado</span>
          <span>{total} movimiento{total !== 1 ? "s" : ""}</span>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="ghost" style={{ fontSize: 12, fontWeight: 600, padding: "6px 20px", border: "1px solid var(--border2)" }} onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
