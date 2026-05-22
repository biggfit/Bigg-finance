import { useState, useEffect, useMemo, useCallback } from "react";
import { T, fmtMoney, fmtDate } from "./theme";
import { fetchCuentasBancarias, fetchMovTesoreria, marcarConciliado } from "../lib/numbersApi";
import { parseGalicia, isBankFee } from "./parsers/galicia";
import { autoMatch, matchStats, normFecha } from "./reconciliacion/matchEngine";

// ─── Colores de estado ────────────────────────────────────────────────────────
const ESTADO_COLOR = {
  matched:  { bg: "rgba(34,197,94,.10)",  border: "rgba(34,197,94,.3)",  text: "#16a34a", label: "✓ OK" },
  multiple: { bg: "rgba(234,179, 8,.10)", border: "rgba(234,179, 8,.3)", text: "#ca8a04", label: "? Múltiple" },
  no_match: { bg: "rgba(239,68, 68,.10)", border: "rgba(239,68, 68,.3)", text: "#dc2626", label: "✕ Sin match" },
  ignored:  { bg: "rgba(156,163,175,.08)", border: "rgba(156,163,175,.2)", text: "#9ca3af", label: "— Ignorado" },
};

// ─── Helpers de UI ────────────────────────────────────────────────────────────
const pill = (color, text) => (
  <span style={{
    fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
    background: color.bg, border: `1px solid ${color.border}`, color: color.text,
    letterSpacing: ".04em", whiteSpace: "nowrap",
  }}>{text}</span>
);

function StatBadge({ label, value, color }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      background: T.card, border: `1px solid ${T.cardBorder}`,
      borderRadius: 10, padding: "10px 18px", minWidth: 80,
    }}>
      <span style={{ fontSize: 22, fontWeight: 900, color }}>{value}</span>
      <span style={{ fontSize: 10, color: T.muted, fontWeight: 600, marginTop: 2 }}>{label}</span>
    </div>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function PantallaReconciliacion({ sociedad }) {
  const [step,        setStep]        = useState(1);       // 1 upload, 2 match, 3 confirmar
  const [cuentas,     setCuentas]     = useState([]);
  const [cuentaId,    setCuentaId]    = useState("");
  const [movimientos, setMovimientos] = useState([]);
  const [parsed,      setParsed]      = useState(null);    // { lineas, fuente, total }
  const [results,     setResults]     = useState([]);      // líneas con estado de match
  const [saving,      setSaving]      = useState(false);
  const [done,        setDone]        = useState(false);
  const [dragOver,    setDragOver]    = useState(false);
  const [filterEstado,setFilterEstado]= useState("all");   // all | unmatched
  const [error,       setError]       = useState("");
  const [loadingMovs, setLoadingMovs] = useState(false);

  // Cargar cuentas bancarias de la sociedad
  useEffect(() => {
    fetchCuentasBancarias()
      .then(all => {
        const soc = all.filter(c => c.sociedad === sociedad && c.tipo !== "inversion");
        setCuentas(soc);
        if (soc.length === 1) setCuentaId(soc[0].id);
      })
      .catch(console.error);
  }, [sociedad]);

  // Cargar movimientos cuando se selecciona cuenta
  useEffect(() => {
    if (!cuentaId) return;
    setLoadingMovs(true);
    fetchMovTesoreria(sociedad)
      .then(setMovimientos)
      .catch(console.error)
      .finally(() => setLoadingMovs(false));
  }, [sociedad, cuentaId]);

  // Parsear archivo y correr auto-match
  const processFile = useCallback(async (file) => {
    setError("");
    try {
      const data = await parseGalicia(file);
      setParsed(data);

      // Auto-ignorar impuestos y comisiones bancarias
      const lineasConEstado = data.lineas.map(l => ({
        ...l,
        estado:   isBankFee(l) ? "ignored" : "no_match",
        selected: null,
        candidates: [],
      }));

      const matched = autoMatch(lineasConEstado, movimientos, cuentaId);
      setResults(matched);
      setStep(2);
    } catch (e) {
      setError(e.message);
    }
  }, [movimientos, cuentaId]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFileInput = (e) => {
    const file = e.target.files[0];
    if (file) processFile(file);
  };

  // Acciones sobre líneas
  const toggleIgnore = (idx) =>
    setResults(prev => prev.map(r =>
      r.idx === idx
        ? { ...r, estado: r.estado === "ignored" ? (r.candidates.length > 0 ? "matched" : "no_match") : "ignored", selected: null }
        : r,
    ));

  const assignMatch = (idx, movimiento) =>
    setResults(prev => prev.map(r =>
      r.idx === idx ? { ...r, estado: "matched", selected: movimiento } : r,
    ));

  // Confirmar conciliación
  const handleConfirmar = async () => {
    setSaving(true);
    try {
      const toMark = results.filter(r => r.estado === "matched" && r.selected);
      await Promise.all(
        toMark.map(r => marcarConciliado(r.selected.id, `${r.fecha} · ${r.descripcion}`)),
      );
      setDone(true);
      setStep(3);
    } catch (e) {
      setError("Error al guardar: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const stats = useMemo(() => matchStats(results), [results]);

  const visibleResults = useMemo(() =>
    filterEstado === "unmatched"
      ? results.filter(r => r.estado === "no_match" || r.estado === "multiple")
      : results,
  [results, filterEstado]);

  const cuenta = cuentas.find(c => c.id === cuentaId);

  // ─── Step 1: Upload ────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="fade" style={{ padding: "32px 40px", maxWidth: 680 }}>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: T.text, margin: "0 0 6px" }}>
          Conciliación bancaria
        </h2>
        <p style={{ fontSize: 13, color: T.muted, margin: "0 0 28px" }}>
          Importá el extracto del banco y la app matcheará automáticamente los movimientos ya cargados.
        </p>

        {/* Selector de cuenta */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: T.muted, display: "block", marginBottom: 6 }}>
            Cuenta bancaria a conciliar
          </label>
          <select
            value={cuentaId}
            onChange={e => setCuentaId(e.target.value)}
            style={{
              width: "100%", maxWidth: 420, padding: "9px 12px",
              background: "#fff", border: `1px solid ${T.cardBorder}`,
              borderRadius: 8, fontSize: 13, color: T.text, fontFamily: T.font,
            }}
          >
            <option value="">— Seleccionar cuenta —</option>
            {cuentas.map(c => (
              <option key={c.id} value={c.id}>{c.nombre} ({c.moneda})</option>
            ))}
          </select>
          {loadingMovs && (
            <p style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>Cargando movimientos…</p>
          )}
        </div>

        {/* Drop zone */}
        {cuentaId && (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragOver ? T.accent : T.cardBorder}`,
              borderRadius: 12, padding: "40px 32px", textAlign: "center",
              background: dragOver ? "rgba(173,255,25,.04)" : T.card,
              transition: "all .2s", cursor: "pointer",
            }}
            onClick={() => document.getElementById("concil-file-input").click()}
          >
            <div style={{ fontSize: 32, marginBottom: 10 }}>📄</div>
            <p style={{ fontSize: 14, fontWeight: 700, color: T.text, margin: "0 0 4px" }}>
              Arrastrá el extracto de Galicia aquí
            </p>
            <p style={{ fontSize: 12, color: T.muted, margin: 0 }}>
              o hacé click para seleccionar el archivo .xlsx
            </p>
            <input
              id="concil-file-input"
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={handleFileInput}
            />
          </div>
        )}

        {error && (
          <p style={{ fontSize: 12, color: "#dc2626", marginTop: 12, padding: "8px 12px",
            background: "rgba(239,68,68,.08)", borderRadius: 8, border: "1px solid rgba(239,68,68,.2)" }}>
            {error}
          </p>
        )}
      </div>
    );
  }

  // ─── Step 3: Listo ─────────────────────────────────────────────────────────
  if (step === 3) {
    const confirmed = results.filter(r => r.estado === "matched").length;
    return (
      <div className="fade" style={{ padding: "32px 40px", maxWidth: 560 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: T.text, margin: "0 0 8px" }}>
          Conciliación guardada
        </h2>
        <p style={{ fontSize: 13, color: T.muted, margin: "0 0 24px" }}>
          Se marcaron <strong>{confirmed}</strong> movimientos como conciliados en {cuenta?.nombre}.
        </p>
        {stats.noMatch > 0 && (
          <p style={{ fontSize: 12, color: "#ca8a04", padding: "10px 14px",
            background: "rgba(234,179,8,.08)", borderRadius: 8,
            border: "1px solid rgba(234,179,8,.2)", margin: "0 0 20px" }}>
            Quedan <strong>{stats.noMatch}</strong> líneas del banco sin movimiento en la app.
            Revisalas en Egresos o Tesorería.
          </p>
        )}
        <button
          onClick={() => { setStep(1); setParsed(null); setResults([]); setDone(false); setError(""); }}
          style={{ padding: "9px 20px", borderRadius: 8, background: T.accent, border: "none",
            color: "#000", fontFamily: T.font, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
        >
          Nueva conciliación
        </button>
      </div>
    );
  }

  // ─── Step 2: Match ─────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Header fijo */}
      <div style={{
        padding: "14px 24px", background: T.card, borderBottom: `1px solid ${T.cardBorder}`,
        display: "flex", alignItems: "center", gap: 16, flexShrink: 0,
      }}>
        <button
          onClick={() => setStep(1)}
          style={{ background: "none", border: "none", color: T.muted, cursor: "pointer",
            fontSize: 18, padding: 0, lineHeight: 1 }}
        >
          ←
        </button>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>
            {cuenta?.nombre} — {parsed?.total} líneas
          </div>
          <div style={{ fontSize: 11, color: T.muted }}>Extracto {parsed?.fuente}</div>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <StatBadge label="Matcheados"  value={stats.matched}  color="#16a34a" />
          <StatBadge label="Múltiple"    value={stats.multiple} color="#ca8a04" />
          <StatBadge label="Sin match"   value={stats.noMatch}  color="#dc2626" />
          <StatBadge label="Ignorados"   value={stats.ignored}  color="#9ca3af" />
        </div>

        {/* Filtro */}
        <select
          value={filterEstado}
          onChange={e => setFilterEstado(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${T.cardBorder}`,
            background: T.bg, color: T.text, fontSize: 12, fontFamily: T.font, cursor: "pointer" }}
        >
          <option value="all">Todas las líneas</option>
          <option value="unmatched">Solo sin match</option>
        </select>

        <button
          onClick={handleConfirmar}
          disabled={saving || stats.matched === 0}
          style={{
            padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700,
            background: stats.matched > 0 ? T.accent : "rgba(255,255,255,.08)",
            border: "none", color: stats.matched > 0 ? "#000" : T.dim,
            fontFamily: T.font, cursor: stats.matched > 0 ? "pointer" : "default",
            opacity: saving ? .5 : 1,
          }}
        >
          {saving ? "Guardando…" : `Confirmar (${stats.matched})`}
        </button>
      </div>

      {error && (
        <div style={{ padding: "8px 24px", background: "rgba(239,68,68,.08)",
          borderBottom: "1px solid rgba(239,68,68,.2)", fontSize: 12, color: "#dc2626" }}>
          {error}
        </div>
      )}

      {/* Tabla de match */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.card, position: "sticky", top: 0, zIndex: 1 }}>
              {["Fecha","Descripción banco","Monto","Estado","Movimiento app","Acciones"].map(h => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left",
                  fontSize: 10, fontWeight: 700, color: T.muted, letterSpacing: ".07em",
                  borderBottom: `1px solid ${T.cardBorder}`, whiteSpace: "nowrap" }}>
                  {h.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleResults.map(line => {
              const ec     = ESTADO_COLOR[line.estado] ?? ESTADO_COLOR.no_match;
              const isMon  = line.monto < 0;

              return (
                <tr
                  key={line.idx}
                  style={{
                    background: ec.bg,
                    borderBottom: `1px solid ${T.cardBorder}`,
                    opacity: line.estado === "ignored" ? .55 : 1,
                  }}
                >
                  {/* Fecha */}
                  <td style={{ padding: "7px 12px", color: T.muted, whiteSpace: "nowrap" }}>
                    {line.fecha}
                  </td>

                  {/* Descripción */}
                  <td style={{ padding: "7px 12px", color: T.text, maxWidth: 200 }}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {line.descripcion}
                    </div>
                    {line.contraparte && (
                      <div style={{ fontSize: 10, color: T.muted, marginTop: 1 }}>
                        {line.contraparte}
                      </div>
                    )}
                  </td>

                  {/* Monto */}
                  <td style={{ padding: "7px 12px", fontWeight: 700, whiteSpace: "nowrap",
                    color: isMon ? "#dc2626" : "#16a34a", textAlign: "right" }}>
                    {isMon ? "−" : "+"}{Math.abs(line.monto).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                  </td>

                  {/* Estado */}
                  <td style={{ padding: "7px 12px" }}>
                    {pill(ec, ec.label)}
                  </td>

                  {/* Movimiento app */}
                  <td style={{ padding: "7px 12px", minWidth: 200 }}>
                    {line.selected ? (
                      <div>
                        <div style={{ fontWeight: 600, color: T.text }}>
                          {line.selected.concepto || line.selected.tipo}
                        </div>
                        <div style={{ fontSize: 10, color: T.muted, marginTop: 1 }}>
                          {normFecha(line.selected.fecha)} · {Math.abs(Number(line.selected.monto)).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: T.dim, fontSize: 11, fontStyle: "italic" }}>
                        {line.estado === "ignored" ? "—" : "Sin movimiento"}
                      </span>
                    )}

                    {/* Selector si hay múltiples candidatos */}
                    {line.estado === "multiple" && line.candidates.length > 1 && (
                      <select
                        value={line.selected?.id ?? ""}
                        onChange={e => {
                          const mov = line.candidates.find(c => c.id === e.target.value);
                          if (mov) assignMatch(line.idx, mov);
                        }}
                        style={{ fontSize: 11, marginTop: 4, padding: "3px 6px",
                          background: "#fff", border: `1px solid ${T.cardBorder}`,
                          borderRadius: 5, color: T.text, fontFamily: T.font, width: "100%" }}
                      >
                        {line.candidates.map(c => (
                          <option key={c.id} value={c.id}>
                            {normFecha(c.fecha)} · {c.concepto || c.tipo} · {Math.abs(Number(c.monto)).toLocaleString("es-AR")}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>

                  {/* Acciones */}
                  <td style={{ padding: "7px 12px", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => toggleIgnore(line.idx)}
                      style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5,
                        background: "rgba(255,255,255,.06)", border: `1px solid ${T.cardBorder}`,
                        color: T.muted, fontFamily: T.font, cursor: "pointer", fontWeight: 600 }}
                    >
                      {line.estado === "ignored" ? "Activar" : "Ignorar"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visibleResults.length === 0 && (
          <div style={{ padding: "40px", textAlign: "center", color: T.muted, fontSize: 13 }}>
            No hay líneas para mostrar con este filtro.
          </div>
        )}
      </div>
    </div>
  );
}
