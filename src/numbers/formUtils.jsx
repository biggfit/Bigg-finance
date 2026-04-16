import { useEffect, useMemo } from "react";
import { T } from "./theme";
import { newLinea } from "./useLineas";

// ─── Normalizador ─────────────────────────────────────────────────────────────
export const norm = s => (s ?? "").trim().toLowerCase();

// ─── Estilos base ─────────────────────────────────────────────────────────────
export const inputStyle = {
  width: "100%", background: "#ffffff", border: "1px solid #c5cad4",
  borderRadius: 7, padding: "8px 10px", fontSize: 13, color: T.text,
  fontFamily: T.font, outline: "none", boxSizing: "border-box", cursor: "pointer",
};
export const dateStyle = { ...inputStyle, appearance: "auto", WebkitAppearance: "auto" };

// ─── Lookup: busca primero por ID, luego por nombre ───────────────────────────
export const lookupId = (list, idKey, nameKey, data) => {
  if (!data) return "";
  return (
    list.find(x => x.id === data[idKey])?.id ||
    list.find(x => norm(x.nombre) === norm(data[nameKey]))?.id ||
    ""
  );
};

// ─── Resolver: val/nombre → ID (para cargar datos existentes al editar) ───────
export const makeCCResolver = (list) => (val) => {
  if (!val) return "";
  if (list.find(c => c.id === val)) return val;
  return list.find(c => norm(c.nombre) === norm(val))?.id ?? val;
};

// ─── Resolver: ID → nombre (para display en DetalleModal) ────────────────────
export const makeResolveCC = (list) => (id) => {
  if (!id) return "—";
  return list.find(c => c.id === id)?.nombre ?? id;
};

export const makeResolveCB = (list) => (id) =>
  list.find(c => c.id === id)?.nombre ?? id ?? "—";

// ─── Totales de líneas ────────────────────────────────────────────────────────
export function calcLineasTotals(lineas) {
  let totalSub = 0, totalIva = 0;
  lineas.forEach(l => {
    const sub = Number(l.subtotal) || 0;
    totalSub += sub;
    totalIva += sub * (Number(l.ivaRate) / 100);
  });
  return { totalSub, totalIva, totalFinal: totalSub + totalIva };
}

/** Agrupa centros de costo como en facturas ingreso/egreso; `rest` en O(n). */
export function groupCentrosCosto(CC_LIST) {
  const hq = CC_LIST.filter(c => ["hq", "marca", "hq - marca"].includes(norm(c.grupo ?? "")));
  const ops = CC_LIST.filter(c => ["operaciones", "ops", "sedes"].includes(norm(c.grupo ?? "")));
  const hqSet = new Set(hq);
  const opsSet = new Set(ops);
  const rest = CC_LIST.filter(c => !hqSet.has(c) && !opsSet.has(c));
  return { hq, ops, rest };
}

export function useCcGroups(CC_LIST) {
  return useMemo(() => groupCentrosCosto(CC_LIST), [CC_LIST]);
}

export function initialFacturaLineas(initialData, resolveCC) {
  return initialData?.lineas?.map(l => ({
    id: Date.now() + Math.random(),
    cc: resolveCC(l.cc ?? ""),
    subtotal: String(l.subtotal ?? ""),
    ivaRate: l.ivaRate ?? 21,
  })) ?? [newLinea()];
}

export function facturaCanSave({ partyId, cuentaId, fecha, lineas }) {
  return !!(partyId && cuentaId && fecha && lineas.some(l => Number(l.subtotal) > 0));
}

export function runSaveThenMaybeClose(onSave, payload, asPage, onClose) {
  onSave?.(payload);
  if (!asPage) onClose();
}

export function useDeferredEntityLookup({ initialData, currentId, setId, list, idKey, nameKey }) {
  useEffect(() => {
    if (!initialData || currentId) return;
    const found =
      list.find(x => x.id === initialData[idKey]) ||
      list.find(x => norm(x.nombre) === norm(initialData[nameKey]));
    if (found) setId(found.id);
  }, [initialData, currentId, list, idKey, nameKey, setId]);
}

export function makeFacturaPartyChangeHandler({ setPartyId, list, setCuentaId, setMoneda, setLineas }) {
  return (id) => {
    setPartyId(id);
    const row = list.find(x => x.id === id);
    if (!row) return;
    if (row.cuentaDefault) setCuentaId(row.cuentaDefault);
    if (row.monedaDefault) setMoneda(row.monedaDefault);
    setLineas([newLinea(row.ccDefault ?? "")]);
  };
}

/** Grid 4 columnas del bloque superior de factura (ingreso/egreso). */
export const FACTURA_TOP_FIELDS_GRID = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 16,
  marginBottom: 22,
};

// ─── Componentes de campo ─────────────────────────────────────────────────────
export const Label = ({ children, required }) => (
  <label style={{ fontSize: 11, color: T.muted, fontWeight: 700, display: "block",
    marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>
    {children}{required && <span style={{ color: T.red }}> *</span>}
  </label>
);

export const Field = ({ label, required, children }) => (
  <div>
    {label && <Label required={required}>{label}</Label>}
    {children}
  </div>
);

// ─── CC Dropdown: opciones agrupadas por tipo ─────────────────────────────────
export const CCSelectOptions = ({ ccGroups }) => (
  <>
    {ccGroups.hq.length > 0 && (
      <optgroup label="Marca / HQ">
        {ccGroups.hq.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </optgroup>
    )}
    {ccGroups.ops.length > 0 && (
      <optgroup label="Sedes Operativas">
        {ccGroups.ops.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </optgroup>
    )}
    {ccGroups.rest.length > 0 && (
      <optgroup label="Otros">
        {ccGroups.rest.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </optgroup>
    )}
  </>
);

// ─── Facturas (ingresos / egresos) — UI compartida ────────────────────────────
export const FACTURA_FORM_CLASS = "numbers-factura-form";

/** Focus ring lima coherente con Numbers */
export function FacturaFormFocusRing() {
  return (
    <style>{`
      .${FACTURA_FORM_CLASS} button:focus-visible,
      .${FACTURA_FORM_CLASS} select:focus-visible,
      .${FACTURA_FORM_CLASS} input:focus-visible,
      .${FACTURA_FORM_CLASS} textarea:focus-visible {
        outline: 2px solid ${T.accent};
        outline-offset: 1px;
      }
    `}</style>
  );
}

export function SoftField({ label, required, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      {label && (
        <label style={{
          fontSize: 12, color: T.muted, fontWeight: 600, display: "block",
          marginBottom: 6, letterSpacing: ".01em",
        }}>
          {label}{required && <span style={{ color: T.red }}> *</span>}
        </label>
      )}
      {children}
    </div>
  );
}

export function FacturaMaestroCuentaFields({
  maestroLabel,
  maestroValue,
  onMaestroChange,
  maestros,
  emptyOption,
  emptyListHint,
  cuentaLabel,
  cuentaValue,
  onCuentaChange,
  cuentasFiltradas,
}) {
  return (
    <>
      <div style={{ gridColumn: "1 / 3" }}>
        <SoftField label={maestroLabel} required>
          <select value={maestroValue} onChange={e => onMaestroChange(e.target.value)} style={inputStyle}>
            <option value="">{emptyOption}</option>
            {maestros.length === 0 && (
              <option disabled>{emptyListHint}</option>
            )}
            {maestros.map(c => (
              <option key={c.id} value={c.id}>{c.nombre}{c.cuit ? ` · ${c.cuit}` : ""}</option>
            ))}
          </select>
        </SoftField>
      </div>
      <div style={{ gridColumn: "3 / 5" }}>
        <SoftField label={cuentaLabel} required>
          <select value={cuentaValue} onChange={e => onCuentaChange(e.target.value)} style={inputStyle}>
            <option value="">— Seleccionar cuenta —</option>
            {cuentasFiltradas.map(c => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </SoftField>
      </div>
    </>
  );
}

/**
 * Layout compartido: pantalla completa o modal con overlay, header y pie.
 */
export function FacturaFormChrome({
  asPage,
  onClose,
  headerBg,
  titleColor,
  title,
  subtitlePage,
  subtitleModal,
  formBody,
  footer,
}) {
  if (asPage) {
    return (
      <div className="fade" style={{ padding: "28px 32px" }}>
        <div style={{
          background: headerBg, borderRadius: T.radius, padding: "18px 24px",
          display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24,
          boxShadow: "0 4px 20px rgba(0,0,0,.12)",
        }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, color: titleColor, letterSpacing: "-.02em" }}>
              {title}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,.45)", marginTop: 5, fontWeight: 500 }}>
              {subtitlePage}
            </div>
          </div>
        </div>

        <div style={{
          background: "#e8eaef", borderRadius: 12, overflow: "hidden",
          boxShadow: "0 2px 12px rgba(0,0,0,.08)", border: `1px solid ${T.cardBorder}`,
        }}>
          <div style={{
            padding: 24, background: "#f3f4f6", margin: 16, borderRadius: 10,
            border: "1px solid rgba(0,0,0,.04)",
          }}>{formBody}</div>
          <div style={{
            padding: "14px 24px", borderTop: `1px solid ${T.cardBorder}`,
            background: "#e2e5eb", display: "flex", justifyContent: "flex-end",
          }}>
            {footer}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 400,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}
    onClick={onClose}>
      <div className="fade" onClick={e => e.stopPropagation()} style={{
        background: "#f8f9fa", borderRadius: 12, width: 780, maxWidth: "98vw",
        maxHeight: "94vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,.3)", overflow: "hidden",
      }}>
        <div style={{
          background: headerBg, padding: "18px 24px",
          display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, color: titleColor, letterSpacing: "-.02em" }}>
              {title}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,.45)", marginTop: 4, fontWeight: 500, maxWidth: 420 }}>
              {subtitleModal}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar"
            style={{
              background: "transparent", border: "none",
              color: "rgba(255,255,255,.45)", fontSize: 22, cursor: "pointer", lineHeight: 1,
              padding: 4, borderRadius: 6,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "#fff"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,.45)"; }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>{formBody}</div>

        <div style={{
          padding: "14px 24px", borderTop: `1px solid ${T.cardBorder}`,
          background: "#fff", display: "flex", justifyContent: "flex-end", flexShrink: 0,
        }}>
          {footer}
        </div>
      </div>
    </div>
  );
}

export function moneySym(m) {
  if (m === "USD") return "U$D";
  if (m === "EUR") return "€";
  return "$";
}

const LINE_GRID = "1fr 130px 90px 110px 40px";

/** Tabla de líneas (centro de costo, subtotal, IVA, total, eliminar) */
export function InvoiceLineasTable({
  lineas,
  ccGroups,
  moneda,
  fmtNum,
  IVA_OPTS,
  updLinea,
  delLinea,
  addLinea,
}) {
  const cur = moneySym(moneda);
  return (
    <div style={{
      background: "#fff", border: `1px solid ${T.cardBorder}`,
      borderRadius: T.radius, overflow: "hidden", marginBottom: 18, boxShadow: T.shadow,
    }}>
      <div style={{
        background: T.tableHead, display: "grid", gridTemplateColumns: LINE_GRID,
        padding: "10px 14px", gap: 10, alignItems: "center",
      }}>
        {["Centro de costo", "Subtotal", "IVA", "Total", ""].map((h, i) => (
          <div key={i} style={{
            fontSize: 11, fontWeight: 700, color: T.tableHeadText,
            letterSpacing: ".04em",
            textAlign: i >= 1 && i <= 3 ? "right" : "left",
          }}>{h}</div>
        ))}
      </div>

      {lineas.map((l, idx) => {
        const sub = Number(l.subtotal) || 0;
        const iva = sub * (Number(l.ivaRate) / 100);
        const tot = sub + iva;
        return (
          <div key={l.id} style={{
            display: "grid", gridTemplateColumns: LINE_GRID,
            padding: "10px 14px", gap: 10, alignItems: "center",
            borderTop: `1px solid ${T.cardBorder}`,
            background: idx % 2 === 0 ? "#fff" : "#fafbfc",
            transition: "background .12s ease",
          }}>
            <select value={l.cc} onChange={e => updLinea(l.id, "cc", e.target.value)}
              style={{ ...inputStyle, padding: "6px 8px", fontSize: 12 }}>
              <option value="">— Centro de Costo —</option>
              <CCSelectOptions ccGroups={ccGroups} />
            </select>
            <input type="number" value={l.subtotal}
              onChange={e => updLinea(l.id, "subtotal", e.target.value)}
              placeholder="0,00"
              style={{ ...inputStyle, padding: "6px 8px", fontSize: 13,
                textAlign: "right", fontFamily: "var(--mono)" }} />
            <select value={l.ivaRate} onChange={e => updLinea(l.id, "ivaRate", e.target.value)}
              style={{ ...inputStyle, padding: "6px 8px", fontSize: 12, textAlign: "right" }}>
              {IVA_OPTS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div style={{
              fontSize: 13, fontFamily: "var(--mono)", fontWeight: 700,
              color: T.text, textAlign: "right",
            }}>
              {cur} {fmtNum(tot)}
            </div>
            <button type="button" onClick={() => delLinea(l.id)}
              aria-label={`Eliminar línea ${idx + 1}`}
              title="Eliminar línea"
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                color: T.dim, fontSize: 15, padding: 6, borderRadius: 6,
                display: "flex", alignItems: "center", justifyContent: "center",
                lineHeight: 1, transition: "color .12s, background .12s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.color = T.red;
                e.currentTarget.style.background = T.redBg;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = T.dim;
                e.currentTarget.style.background = "transparent";
              }}>
              🗑
            </button>
          </div>
        );
      })}

      <div style={{ borderTop: `1px solid ${T.cardBorder}`, padding: "10px 14px", background: "#f9fafb" }}>
        <button type="button" onClick={addLinea} style={{
          background: "transparent", border: "1.5px dashed rgba(17, 24, 39, 0.18)",
          borderRadius: 8, padding: "8px 18px", fontSize: 12, color: T.muted,
          cursor: "pointer", fontFamily: T.font, fontWeight: 600,
          display: "inline-flex", alignItems: "center", gap: 8,
          transition: "border-color .15s, color .15s, background .15s",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = T.accent;
          e.currentTarget.style.color = T.accentDark;
          e.currentTarget.style.background = "rgba(173,255,25,.08)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = "rgba(17, 24, 39, 0.18)";
          e.currentTarget.style.color = T.muted;
          e.currentTarget.style.background = "transparent";
        }}>
          + Agregar línea
        </button>
      </div>
    </div>
  );
}

/** Nota interna + tarjeta de totales alineada en altura */
export function InvoiceNotaYTotales({
  nota,
  onNotaChange,
  totalSub,
  totalIva,
  totalFinal,
  moneda,
  fmtNum,
  stripeColor = T.accent,
  totalPositiveColor = T.accentDark,
}) {
  const cur = moneySym(moneda);
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr minmax(232px, 280px)",
      gap: 20,
      alignItems: "stretch",
    }}>
      <SoftField label="Nota interna">
        <textarea value={nota} onChange={e => onNotaChange(e.target.value)}
          placeholder="Observaciones, referencia interna…"
          style={{
            ...inputStyle, resize: "vertical", minHeight: 132, height: 132,
            lineHeight: 1.45, boxSizing: "border-box",
          }} />
      </SoftField>
      <div style={{
        background: "#fff", border: `1px solid ${T.cardBorder}`,
        borderRadius: T.radius, padding: "18px 20px", boxShadow: T.shadow,
        borderLeft: `3px solid ${stripeColor}`,
        display: "flex", flexDirection: "column", justifyContent: "space-between",
        minHeight: 132, boxSizing: "border-box",
      }}>
        <div>
          {[
            { label: "Subtotal", value: totalSub, muted: false },
            { label: "IVA", value: totalIva, muted: true },
          ].map(({ label, value, muted }) => (
            <div key={label} style={{
              display: "flex", justifyContent: "space-between",
              marginBottom: 10, fontSize: 13, alignItems: "baseline",
            }}>
              <span style={{ color: muted ? T.muted : T.text }}>{label}</span>
              <span style={{
                fontFamily: "var(--mono)", fontWeight: 600,
                color: muted ? T.muted : T.text,
              }}>
                {cur} {fmtNum(value)}
              </span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ height: 1, background: T.cardBorder, marginBottom: 12 }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: T.text, letterSpacing: ".02em" }}>Total</span>
            <span style={{
              fontSize: 20, fontFamily: "var(--mono)", fontWeight: 900,
              color: totalFinal > 0 ? totalPositiveColor : T.dim,
              letterSpacing: "-.02em",
            }}>
              {cur} {fmtNum(totalFinal)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Pie de acciones: cancelar (ghost), acción secundaria opcional (outline), guardar (primario BIGG).
 * secondaryAction solo se muestra si showSecondary es true (p. ej. asPage).
 */
export function InvoiceFormFooter({
  asPage,
  canSave,
  onClose,
  onSave,
  showSecondary,
  secondaryAction,
}) {
  return (
    <div className={FACTURA_FORM_CLASS} style={{
      display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 10,
    }}>
      <button type="button" onClick={onClose} style={{
        background: "#fff", border: `1px solid ${T.cardBorder}`, borderRadius: 8,
        padding: "10px 20px", fontSize: 13, fontWeight: 600, color: T.muted,
        cursor: "pointer", fontFamily: T.font,
        transition: "background .15s, border-color .15s, color .15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "#f9fafb"; e.currentTarget.style.color = T.text; }}
      onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = T.muted; }}>
        {asPage ? "← Cancelar" : "Cancelar"}
      </button>
      {showSecondary && secondaryAction && (
        <button type="button" onClick={secondaryAction.onClick} disabled={!canSave} style={{
          background: canSave ? "#fff" : "#f3f4f6",
          border: `1px solid ${canSave ? secondaryAction.outlineColor : T.cardBorder}`,
          borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 700,
          color: canSave ? secondaryAction.outlineColor : T.dim,
          cursor: canSave ? "pointer" : "not-allowed",
          fontFamily: T.font, opacity: canSave ? 1 : 0.85,
        }}>
          {secondaryAction.label}
        </button>
      )}
      <button type="button" onClick={onSave} disabled={!canSave} style={{
        background: canSave ? T.accentDark : "#e5e7eb",
        border: "none", borderRadius: 8, padding: "10px 22px", fontSize: 13, fontWeight: 800,
        color: canSave ? T.accent : T.dim,
        cursor: canSave ? "pointer" : "not-allowed",
        fontFamily: T.font,
        boxShadow: canSave ? "0 2px 10px rgba(30,32,34,.25)" : "none",
      }}>
        Guardar
      </button>
    </div>
  );
}
