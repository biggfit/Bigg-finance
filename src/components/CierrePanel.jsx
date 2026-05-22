import { useState, useEffect } from "react";
import { T } from "../numbers/theme";

const MONTHS     = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const CHECKLIST  = [
  { id: "extracto", label: "Extracto bancario revisado" },
  { id: "egresos",  label: "Egresos y pagos verificados" },
  { id: "ingresos", label: "Ingresos y cobros verificados" },
  { id: "numeros",  label: "Números OK" },
];

export default function CierrePanel({ sociedad, isCerrado, cerrar, reabrir }) {
  const now  = new Date();
  const [año,    setAño]    = useState(now.getFullYear());
  const [mes,    setMes]    = useState(now.getMonth() + 1);
  const [open,   setOpen]   = useState(false);
  const [saving, setSaving] = useState(false);

  const storageKey = `nb_cierre_${sociedad}_${año}_${mes}`;

  const [checks, setChecks] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(storageKey) ?? "[]")); }
    catch { return new Set(); }
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      setChecks(saved ? new Set(JSON.parse(saved)) : new Set());
    } catch { setChecks(new Set()); }
  }, [storageKey]);

  const toggleCheck = (id) => {
    setChecks(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });
  };

  const closed     = isCerrado?.(año, mes) ?? false;
  const doneCount  = CHECKLIST.filter(c => checks.has(c.id)).length;
  const allChecked = doneCount === CHECKLIST.length;
  const progPct    = (doneCount / CHECKLIST.length) * 100;

  const handleCerrar = async () => {
    setSaving(true);
    try { await cerrar?.(año, mes); } finally { setSaving(false); }
  };

  const handleReabrir = async () => {
    setSaving(true);
    try { await reabrir?.(año, mes); } finally { setSaving(false); }
  };

  return (
    <div style={{
      background: T.card,
      borderBottom: `1px solid ${T.cardBorder}`,
      padding: open ? "10px 20px 14px" : "6px 20px",
      flexShrink: 0,
    }}>
      {/* ── Header (clickeable para expand/collapse) ── */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen(v => !v)}
      >
        <span style={{ fontSize: 10, fontWeight: 800, color: T.muted, letterSpacing: ".08em" }}>
          CIERRE
        </span>

        {/* Selector de período (no propaga el click al toggle) */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }} onClick={e => e.stopPropagation()}>
          <select
            value={mes}
            onChange={e => setMes(Number(e.target.value))}
            style={{
              background: T.bg, border: `1px solid ${T.cardBorder}`, borderRadius: 5,
              color: T.text, fontSize: 11, fontWeight: 700, padding: "1px 4px",
              fontFamily: T.font, cursor: "pointer",
            }}
          >
            {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <input
            type="number"
            value={año}
            onChange={e => setAño(Number(e.target.value))}
            style={{
              background: T.bg, border: `1px solid ${T.cardBorder}`, borderRadius: 5,
              color: T.text, fontSize: 11, fontWeight: 700, padding: "1px 6px",
              width: 58, fontFamily: T.font,
            }}
          />
        </div>

        {/* Barra de progreso (solo si abierto) */}
        {!closed && (
          <div style={{
            flex: 1, height: 3, borderRadius: 2,
            background: T.cardBorder, overflow: "hidden", maxWidth: 80,
          }}>
            <div style={{
              height: "100%", borderRadius: 2,
              width: `${progPct}%`,
              background: progPct >= 100 ? T.accent : progPct >= 50 ? "#f59e0b" : T.dim,
              transition: "width .3s ease",
            }} />
          </div>
        )}

        {/* Badge estado */}
        {closed ? (
          <span style={{
            fontSize: 10, fontWeight: 700, color: T.accent,
            background: "rgba(173,255,25,.1)", border: "1px solid rgba(173,255,25,.25)",
            borderRadius: 5, padding: "2px 8px", letterSpacing: ".04em",
          }}>
            CERRADO
          </span>
        ) : (
          <span style={{ fontSize: 10, fontWeight: 600, color: T.dim }}>
            {doneCount}/{CHECKLIST.length} tareas
          </span>
        )}

        <span style={{ fontSize: 10, color: T.dim, marginLeft: "auto" }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* ── Checklist + botón (expandido) ── */}
      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {CHECKLIST.map(item => (
            <div
              key={item.id}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "4px 8px", borderRadius: 6,
                background: checks.has(item.id) ? "rgba(173,255,25,.04)" : "rgba(255,255,255,.02)",
                opacity: closed ? .55 : 1,
              }}
            >
              <button
                onClick={() => !closed && toggleCheck(item.id)}
                style={{
                  background: "none", border: "none",
                  cursor: closed ? "default" : "pointer",
                  fontSize: 13, color: checks.has(item.id) ? T.accent : T.dim,
                  padding: 0, lineHeight: 1, flexShrink: 0,
                }}
              >
                {checks.has(item.id) ? "✓" : "○"}
              </button>
              <span style={{
                fontSize: 12, fontWeight: checks.has(item.id) ? 400 : 500,
                color: checks.has(item.id) ? T.muted : T.text,
              }}>
                {item.label}
              </span>
            </div>
          ))}

          {/* Botón cierre / reapertura */}
          <div style={{ marginTop: 6 }}>
            {closed ? (
              <button
                onClick={handleReabrir}
                disabled={saving}
                style={{
                  fontSize: 11, padding: "5px 14px", borderRadius: 7,
                  cursor: saving ? "default" : "pointer",
                  background: "rgba(255,255,255,.06)", border: `1px solid ${T.cardBorder}`,
                  color: T.muted, fontFamily: T.font, fontWeight: 600,
                  opacity: saving ? .5 : 1,
                }}
              >
                {saving ? "Reabriendo…" : "Reabrir período"}
              </button>
            ) : (
              <button
                onClick={handleCerrar}
                disabled={saving || !allChecked}
                title={!allChecked ? "Completá todas las tareas antes de cerrar" : ""}
                style={{
                  fontSize: 11, padding: "5px 14px", borderRadius: 7,
                  cursor: (!allChecked || saving) ? "default" : "pointer",
                  background: allChecked ? T.accent : "rgba(255,255,255,.06)",
                  border: `1px solid ${allChecked ? T.accent : T.cardBorder}`,
                  color: allChecked ? "#000" : T.dim,
                  fontFamily: T.font, fontWeight: 700,
                  transition: "all .15s", opacity: saving ? .5 : 1,
                }}
              >
                {saving ? "Cerrando…" : "Cerrar período"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
