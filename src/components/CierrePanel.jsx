import { useMemo, useState, useEffect } from "react";
import { useStore } from "../lib/context";
import { compEmpresa, compCurrency, MONTHS } from "../lib/helpers";

// ─── Panel de Cierre de Mes ───────────────────────────────────────────────────
export default function CierrePanel({ periodMonth, periodYear, onStartImport }) {
  const { comps } = useStore();
  const storageKey = `cierre_${periodMonth}_${periodYear}`;

  const [manualDone, setManualDone] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(storageKey) ?? "[]")); }
    catch { return new Set(); }
  });
  const [open, setOpen] = useState(false);

  // Persist manual checkmarks
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify([...manualDone]));
  }, [manualDone, storageKey]);

  // Reset state when period changes
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      setManualDone(saved ? new Set(JSON.parse(saved)) : new Set());
    } catch { setManualDone(new Set()); }
  }, [storageKey]);

  const toggleManual = (id) =>
    setManualDone(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const steps = useMemo(() => {
    const all = Object.values(comps).flat();
    const inPer = c => c.month === periodMonth && c.year === periodYear;

    // 1: algún PAGO o PAGO_PAUTA en el período
    const s1 = all.some(c => inPer(c) && (c.type === "PAGO" || c.type === "PAGO_PAUTA"));

    // 2: todos los PAGO_PAUTA tienen su FACTURA|PAUTA
    const ppCount = all.filter(c => inPer(c) && c.type === "PAGO_PAUTA").length;
    const pfCount = all.filter(c => inPer(c) && c.type === "FACTURA|PAUTA").length;
    const s2 = ppCount === 0 || pfCount >= ppCount;

    // 3: FACTURA|FEE por empresa y moneda
    const hasFee = (emp, cur) => all.some(c =>
      inPer(c) && c.type?.startsWith("FACTURA|FEE") &&
      compEmpresa(c) === emp && (!cur || compCurrency(c) === cur)
    );
    const s3sub = {
      "ÑAKO":     hasFee("ÑAKO SRL", null),
      "BIGG USD": hasFee("BIGG FIT LLC", "USD"),
      "BIGG EUR": hasFee("BIGG FIT LLC", "EUR"),
      "GDW":      hasFee("Gestión Deportiva y Wellness SL", null),
    };
    const s3 = Object.values(s3sub).every(Boolean);

    // 4: algún interusos (facturado o recibido)
    const s4 = all.some(c => inPer(c) && (
      c.type?.startsWith("FACTURA|INTERUSOS") || c.type?.startsWith("FC_RECIBIDA|INTERUSOS")
    ));

    // 5: FACTURA|PAUTA en EUR
    const s5 = all.some(c => inPer(c) && c.type === "FACTURA|PAUTA" && compCurrency(c) === "EUR");

    // 6: manual
    const s6 = manualDone.has(6);

    return [
      { id: 1, label: "Extracto bancario importado", done: s1,
        action: onStartImport, actionLabel: "→ Importar" },
      { id: 2, label: "Pauta Adelantada facturada",  done: s2,
        hint: ppCount > 0 ? `${ppCount} adelanto${ppCount !== 1 ? "s" : ""}, ${pfCount} factura${pfCount !== 1 ? "s" : ""}` : null },
      { id: 3, label: "Fee CRM facturado",           done: s3, sub: s3sub },
      { id: 4, label: "Interusos importados",        done: s4 },
      { id: 5, label: "Pauta Consumida GDW (EUR)",   done: s5 },
      { id: 6, label: "Otros (Sponsors, Fotos, Pauta)", done: s6,
        action: () => toggleManual(6),
        actionLabel: s6 ? "✓ Listo" : "Marcar listo" },
    ];
  }, [comps, periodMonth, periodYear, manualDone, onStartImport]);

  const doneCount = steps.filter(s => s.done).length;
  const total     = steps.length;
  const allDone   = doneCount === total;

  // Abrir automáticamente si hay pendientes al cambiar de período
  useEffect(() => { setOpen(!allDone); }, [periodMonth, periodYear]);

  const progPct = (doneCount / total) * 100;

  return (
    <div style={{
      background: "var(--bg2)",
      borderBottom: "1px solid var(--border)",
      padding: open ? "10px 20px 14px" : "8px 20px",
    }}>
      {/* Header */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen(v => !v)}
      >
        <span style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", letterSpacing: ".08em" }}>
          CIERRE
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: allDone ? "var(--accent)" : "var(--text)" }}>
          {MONTHS[periodMonth]} {periodYear}
        </span>

        {/* Barra de progreso */}
        <div style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--border2)", overflow: "hidden", maxWidth: 120 }}>
          <div style={{
            height: "100%", borderRadius: 2,
            width: `${progPct}%`,
            background: allDone ? "var(--accent)" : progPct >= 66 ? "var(--green)" : progPct >= 33 ? "#f59e0b" : "var(--red)",
            transition: "width .3s ease",
          }} />
        </div>

        <span style={{
          fontSize: 11, fontWeight: 700,
          color: allDone ? "var(--accent)" : "var(--muted)",
        }}>
          {doneCount}/{total}
        </span>

        {allDone && <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>✓ Mes cerrado</span>}
        <span style={{ fontSize: 10, color: "var(--dim)", marginLeft: "auto" }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* Steps */}
      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {steps.map((s, i) => (
            <div key={s.id} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "5px 10px", borderRadius: 7,
              background: s.done ? "rgba(173,255,25,.04)" : i % 2 === 0 ? "rgba(255,255,255,.02)" : "transparent",
            }}>
              {/* Indicador */}
              <span style={{
                fontSize: 13, width: 18, textAlign: "center", flexShrink: 0,
                color: s.done ? "var(--accent)" : "var(--dim)",
              }}>
                {s.done ? "✓" : "○"}
              </span>

              {/* Número */}
              <span style={{ fontSize: 10, color: "var(--dim)", width: 14, flexShrink: 0 }}>{s.id}</span>

              {/* Label */}
              <span style={{
                fontSize: 12, fontWeight: s.done ? 400 : 600,
                color: s.done ? "var(--muted)" : "var(--text)",
                textDecoration: s.done ? "none" : "none",
              }}>
                {s.label}
              </span>

              {/* Sub-chips paso 3 */}
              {s.sub && (
                <span style={{ display: "flex", gap: 4, marginLeft: 4 }}>
                  {Object.entries(s.sub).map(([name, ok]) => (
                    <span key={name} style={{
                      fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
                      background: ok ? "rgba(173,255,25,.14)" : "rgba(255,255,255,.05)",
                      color: ok ? "var(--accent)" : "var(--dim)",
                      border: `1px solid ${ok ? "rgba(173,255,25,.25)" : "rgba(255,255,255,.08)"}`,
                    }}>
                      {ok ? "✓ " : ""}{name}
                    </span>
                  ))}
                </span>
              )}

              {/* Hint paso 2 */}
              {s.hint && (
                <span style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>({s.hint})</span>
              )}

              {/* Acción */}
              {!s.done && s.action && (
                <button
                  className="ghost"
                  style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px", flexShrink: 0 }}
                  onClick={e => { e.stopPropagation(); s.action(); }}
                >
                  {s.actionLabel}
                </button>
              )}
              {s.done && s.id === 6 && (
                <button
                  className="ghost"
                  style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px", opacity: .5, flexShrink: 0 }}
                  onClick={e => { e.stopPropagation(); toggleManual(6); }}
                >
                  ✕ Desmarcar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
