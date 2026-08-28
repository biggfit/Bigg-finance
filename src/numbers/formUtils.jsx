import { useEffect, useLayoutEffect, useMemo, useRef, useCallback, useState } from "react";
import { T } from "./theme";
import { newLinea } from "./useLineas";

// ─── Normalizador ─────────────────────────────────────────────────────────────
export const norm = s => (s ?? "").trim().toLowerCase();

// Comparador alfabético por `nombre` (locale es, sin distinguir acentos/mayúsculas). Un solo
// Collator a nivel módulo (reusar es mucho más barato que localeCompare con opciones por llamada).
const _collator = new Intl.Collator("es", { sensitivity: "base" });
export const byNombre = (a, b) => _collator.compare(String(a?.nombre ?? ""), String(b?.nombre ?? ""));

// Alta rápida de un maestro (cliente/proveedor/cuenta) desde un select: append → refetch → set →
// devuelve el id nuevo para preseleccionar. Mismo patrón en Ingresos y Egresos.
export const makeCrearMaestro = (appendFn, fetchFn, setFn) => async (form) => {
  const { id } = await appendFn(form);
  const fresh = await fetchFn();
  if (Array.isArray(fresh) && fresh.length) setFn(fresh);
  return id;
};

// Prepara un documento (factura) para DUPLICAR: saca id/fechas/nº comprobante/estado/pagos y marca
// _duplicate → el form lo abre precargado como NUEVO. Conocimiento de la forma de la factura en un lugar.
export const stripForDuplicate = (doc) => {
  const { id, fecha, vto, nroComp, estado, saldoPendiente, pagosVinculados, _isEdit, ...rest } = doc;
  return { ...rest, _duplicate: true };
};

// ─── Estilos base ─────────────────────────────────────────────────────────────
export const inputStyle = {
  width: "100%", background: "#ffffff", border: "1px solid #c5cad4",
  borderRadius: 7, padding: "8px 10px", fontSize: 13, color: T.text,
  fontFamily: T.font, outline: "none", boxSizing: "border-box", cursor: "pointer",
};
export const dateStyle = { ...inputStyle, appearance: "auto", WebkitAppearance: "auto" };

// Carga asistida del N° de comprobante AFIP → "TIPO-CLASE PtoVenta-Número" (ej. "FC-A 0001-00001234").
// Separa letras y dígitos: formatea el tipo solo si matchea un patrón AFIP conocido (para no
// mancillar textos libres) y agrupa los dígitos como PtoVenta(4)-Número(hasta 8). Asistivo, no
// estricto: si no encaja, deja las letras como vinieron.
export function formatNroComp(raw) {
  const up      = String(raw ?? "").toUpperCase();
  const letras  = (up.match(/[A-Z]/g) || []).join("");
  const digitos = (up.match(/\d/g) || []).join("").slice(0, 13);   // AFIP: hasta 5 (pto vta) + 8 (número)
  // Prefijo: sólo tipos de comprobante válidos (AFIP/ARCA). Descarta letras inválidas
  // en vez de tomarlas tal cual. Tipos: Factura/NC/ND/Recibo/Tique · Clases: A B C E M T.
  const TIPOS_COMP  = ["FC", "FA", "NC", "ND", "RE", "TK", "TQ"];
  const CLASES_COMP = "ABCEMT";
  let prefijo = "";
  if (letras) {
    const t2 = letras.slice(0, 2);
    if (TIPOS_COMP.includes(t2)) {
      prefijo = CLASES_COMP.includes(letras[2]) ? `${t2}-${letras[2]}` : t2;
    } else if (TIPOS_COMP.some(t => t.startsWith(letras[0]))) {
      prefijo = letras[0];   // 1ª letra válida (va camino a un tipo) → se permite mientras tipea
    }
  }
  // Punto de venta = hasta 5 dígitos · Número = 8 (AFIP moderno, ej. 00009-00003541).
  const num     = digitos.length > 5 ? `${digitos.slice(0, 5)}-${digitos.slice(5, 13)}` : digitos;
  return [prefijo, num].filter(Boolean).join(" ");
}

// Hook para el input de N° de comprobante: formatea en vivo con la máscara AFIP
// (formatNroComp) SIN mandar el cursor al final. Guarda cuántos alfanuméricos hay
// antes del cursor y, tras reformatear, lo reubica en el mismo punto lógico.
// Uso: const nro = useNroCompMask(value, setValue); <input ref={nro.ref} value={value} onChange={nro.onChange} />
export function useNroCompMask(value, setValue) {
  const ref   = useRef(null);
  const caret = useRef(null);
  // Rechaza el cambio: revierte el DOM al valor anterior y deja el cursor donde estaba.
  const revert = (el) => {
    const back = Math.max(0, (el.selectionStart ?? value.length) - 1);
    el.value = value;
    try { el.setSelectionRange(back, back); } catch { /* input sin selección */ }
  };
  const onChange = (e) => {
    const el = e.target, raw = el.value;
    // AFIP: máx 5 (pto vta) + 8 (número) = 13 dígitos. Si ya está completo, no aceptar más.
    if ((raw.match(/\d/g) || []).length > 13) { revert(el); return; }
    const formatted = formatNroComp(raw);
    // Si el cambio no produjo un valor válido nuevo (ej. una letra que no forma un tipo
    // de comprobante válido), se rechaza la tecla en vez de dejar el carácter suelto.
    if (formatted === value) { revert(el); return; }
    // No pisar/borrar lo ya cargado: si se AGREGA un carácter pero el resultado PIERDE
    // contenido (ej. una letra inválida al frente que descarta el prefijo FC-C), se rechaza.
    // La corrección es borrar y reescribir (una tecla nueva nunca reduce lo cargado).
    const alnum = (s) => (String(s).match(/[A-Za-z0-9]/g) || []).length;
    if (alnum(raw) >= alnum(value) && alnum(formatted) < alnum(value)) { revert(el); return; }
    const pos = el.selectionStart ?? raw.length;
    caret.current = raw.slice(0, pos).replace(/[^A-Za-z0-9]/g, "").length;
    setValue(formatted);
  };
  useLayoutEffect(() => {
    if (caret.current == null || !ref.current) return;
    const target = caret.current; caret.current = null;
    let pos = 0, seen = 0;
    while (pos < value.length && seen < target) {
      if (/[A-Za-z0-9]/.test(value[pos])) seen++;
      pos++;
    }
    ref.current.setSelectionRange(pos, pos);
  }, [value]);
  return { ref, onChange };
}

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
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;   // a centavos, sin residuos de milésimas
  let totalSub = 0, totalIva = 0;
  lineas.forEach(l => {
    const sub = round2(Number(l.subtotal) || 0);
    totalSub += sub;
    totalIva += round2(sub * (Number(l.ivaRate) / 100));
  });
  totalSub = round2(totalSub); totalIva = round2(totalIva);
  return { totalSub, totalIva, totalFinal: round2(totalSub + totalIva) };
}

/** Agrupa centros de costo como en facturas ingreso/egreso; `rest` en O(n).
 *  Excluye centros inactivos (activo=false, ej. el ceco "10 - HQ") → no se ofrecen en ningún select. */
export function groupCentrosCosto(CC_LIST) {
  CC_LIST = (CC_LIST || []).filter(c => String(c.activo).trim().toLowerCase() !== "false");
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

export function initialFacturaLineas(initialData, resolveCC, ivaDefault = 21) {
  return initialData?.lineas?.map(l => ({
    id: Date.now() + Math.random(),
    cc: resolveCC(l.cc ?? ""),
    subtotal: String(l.subtotal ?? ""),
    // Al editar/duplicar mandan las alicuotas ya guardadas; el default solo aplica a lo que no tiene.
    ivaRate: l.ivaRate ?? ivaDefault,
  })) ?? [newLinea("", ivaDefault)];
}

export function facturaCanSave({ partyId, cuentaId, fecha, lineas }) {
  // Toda línea con monto debe tener centro de costo: sin centro la fila desaparece de los P&L
  // (Sedes filtra por centro de sede, BIGG por centro HQ). Exigirlo evita el agujero.
  const conMonto = lineas.filter(l => Number(l.subtotal) > 0);
  return !!(partyId && cuentaId && fecha && conMonto.length > 0 && conMonto.every(l => l.cc));
}

// ANTES: onSave?.(payload) sin await + cierre inmediato del modal — un guardado que tarda
// (varios POST secuenciales al GAS) o que falla a mitad de camino cerraba igual, sin avisar
// nada: el usuario veía "guardó" cuando en realidad quedó a medio hacer (ej. factura creada
// pero sin el pago vinculado). Ahora espera el resultado real y solo cierra si no hay error;
// si onSave rechaza, el propio caller ya mostró su alert — acá solo se evita el cierre fantasma.
export async function runSaveThenMaybeClose(onSave, payload, asPage, onClose) {
  try {
    await onSave?.(payload);
    if (!asPage) onClose();
  } catch {
    // el modal queda abierto: el error ya se le avisó al usuario en el onSave del caller.
  }
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

function calcVtoFromProveedor(proveedor, fechaFactura) {
  const forma = proveedor.formaPago;
  const dias  = Number(proveedor.diasPago) || 0;
  if (!forma || forma === "libre" || dias === 0) return null;
  const base = fechaFactura ? new Date(fechaFactura + "T00:00:00") : new Date();
  if (forma === "transferencia") {
    const d = new Date(base);
    d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
  }
  // debito_automatico | contrato | impuesto → día fijo del mes
  const d = new Date(base);
  d.setDate(dias);
  if (d <= base) d.setMonth(d.getMonth() + 1); // siguiente mes si ya pasó
  return d.toISOString().slice(0, 10);
}

export function makeFacturaPartyChangeHandler({ setPartyId, list, setCuentaId, setMoneda, setLineas, setVto, getFecha, ivaDefault = 21 }) {
  return (id) => {
    setPartyId(id);
    const row = list.find(x => x.id === id);
    if (!row) return;
    if (row.cuentaDefault) setCuentaId(row.cuentaDefault);
    if (row.monedaDefault) setMoneda(row.monedaDefault);
    // NO pisar importes ya cargados: abierto desde Conciliación el subtotal viene del extracto, y
    // elegir el proveedor despues borraba la plata. Solo se resetea si no hay ningun monto tipeado;
    // si lo hay, se conserva todo y el ccDefault del proveedor unicamente rellena los cc vacios.
    setLineas(prev => {
      const hayMonto = (prev ?? []).some(l => String(l.subtotal ?? "").trim() !== "");
      if (!hayMonto) return [newLinea(row.ccDefault ?? "", ivaDefault)];
      return prev.map(l => ({ ...l, cc: l.cc || (row.ccDefault ?? "") }));
    });
    if (setVto) {
      const vto = calcVtoFromProveedor(row, getFecha?.());
      if (vto) setVto(vto);
    }
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
  onCrearMaestro,   // opcional: si viene, agrega una opción "➕ Crear …" que la dispara
  cuentaLabel,
  cuentaValue,
  onCuentaChange,
  cuentasFiltradas,
  onCrearCuenta,   // opcional: agrega "➕ Crear cuenta…" al select de cuenta contable
}) {
  // Ordenar una sola vez por cambio de lista (no en cada tecla de la factura, que re-renderiza esto).
  const maestrosOrd = useMemo(() => [...maestros].sort(byNombre), [maestros]);
  const cuentasOrd   = useMemo(() => [...cuentasFiltradas].sort(byNombre), [cuentasFiltradas]);
  return (
    <>
      <div style={{ gridColumn: "1 / 3" }}>
        <SoftField label={maestroLabel} required>
          <select value={maestroValue}
            onChange={e => { if (e.target.value === "__crear__") { onCrearMaestro?.(); } else { onMaestroChange(e.target.value); } }}
            style={inputStyle}>
            <option value="">{emptyOption}</option>
            {onCrearMaestro && <option value="__crear__">➕ Crear {String(maestroLabel).toLowerCase()} nuevo…</option>}
            {maestros.length === 0 && (
              <option disabled>{emptyListHint}</option>
            )}
            {maestrosOrd.map(c => (
              <option key={c.id} value={c.id}>{c.nombre}{c.cuit ? ` · ${c.cuit}` : ""}</option>
            ))}
          </select>
        </SoftField>
      </div>
      <div style={{ gridColumn: "3 / 5" }}>
        <SoftField label={cuentaLabel} required>
          <select value={cuentaValue}
            onChange={e => { if (e.target.value === "__crear__") { onCrearCuenta?.(); } else { onCuentaChange(e.target.value); } }}
            style={inputStyle}>
            <option value="">— Seleccionar cuenta —</option>
            {onCrearCuenta && <option value="__crear__">➕ Crear cuenta nueva…</option>}
            {cuentasOrd.map(c => (
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
  // ── Estado del modal: guarda de cierre + arrastre. En modo página no se usan,
  //    pero los hooks se declaran siempre (rules of hooks).
  const [touched, setTouched] = useState(false);        // ¿el usuario cargó/cambió algo?
  const [confirmOpen, setConfirmOpen] = useState(false); // cartel "¿salir sin guardar?"
  const [dragging, setDragging] = useState(false);       // arrastre en curso (aclara el velo)
  const [drag, setDrag] = useState({ x: 0, y: 0 });      // offset del modal respecto al centro

  const markTouched = useCallback(() => setTouched(true), []);

  // Cierre con guarda: si hay datos cargados, muestra el cartel; si no, cierra directo.
  const requestClose = useCallback(() => {
    if (touched) setConfirmOpen(true);
    else onClose?.();
  }, [touched, onClose]);

  // Escape cierra (con guarda). Solo en modal.
  useEffect(() => {
    if (asPage) return;
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); requestClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asPage, requestClose]);

  // Arrastre desde el header (deshabilitado en mobile). Se clampa para no perder la ventana.
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
  const onHeaderMouseDown = useCallback((e) => {
    if (isMobile || e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, baseX: drag.x, baseY: drag.y };
    setDragging(true);
    const onMove = (ev) => {
      const maxX = window.innerWidth * 0.35;
      const maxY = window.innerHeight * 0.35;
      setDrag({
        x: Math.max(-maxX, Math.min(maxX, start.baseX + (ev.clientX - start.x))),
        y: Math.max(-maxY, Math.min(maxY, start.baseY + (ev.clientY - start.y))),
      });
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [isMobile, drag.x, drag.y]);

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
            {footer(onClose)}
          </div>
        </div>
      </div>
    );
  }

  return (
    // El click en el velo NO cierra (a propósito): el modal se cierra solo por ✕, Cancelar o Escape,
    // y con guarda si hay datos cargados. El velo se aclara mientras arrastrás para ver lo de atrás.
    <div style={{
      position: "fixed", inset: 0,
      background: dragging ? "rgba(0,0,0,.12)" : "rgba(0,0,0,.5)",
      transition: "background .2s ease", zIndex: 400,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div className="fade" style={{
        background: "#f8f9fa", borderRadius: 12, width: 780, maxWidth: "98vw",
        maxHeight: "94vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,.3)", overflow: "hidden",
        transform: (drag.x || drag.y) ? `translate(${drag.x}px, ${drag.y}px)` : undefined,
      }}>
        <div
          onMouseDown={onHeaderMouseDown}
          style={{
            background: headerBg, padding: "18px 24px",
            display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
            cursor: isMobile ? "default" : (dragging ? "grabbing" : "grab"), userSelect: "none",
          }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, color: titleColor, letterSpacing: "-.02em" }}>
              {title}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,.45)", marginTop: 4, fontWeight: 500, maxWidth: 420 }}>
              {subtitleModal}
            </div>
          </div>
          <button type="button" onClick={requestClose} aria-label="Cerrar"
            style={{
              background: "transparent", border: "none",
              color: "rgba(255,255,255,.45)", fontSize: 22, cursor: "pointer", lineHeight: 1,
              padding: 4, borderRadius: 6,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "#fff"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,.45)"; }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }} onInput={markTouched} onChange={markTouched}>{formBody}</div>

        <div style={{
          padding: "14px 24px", borderTop: `1px solid ${T.cardBorder}`,
          background: "#fff", display: "flex", justifyContent: "flex-end", flexShrink: 0,
        }}>
          {footer(requestClose)}
        </div>
      </div>

      {confirmOpen && (
        <div style={{
          position: "absolute", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 10,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div className="fade" style={{
            background: "#fff", borderRadius: 12, width: 400, maxWidth: "90%",
            padding: "22px 24px", boxShadow: "0 20px 50px rgba(0,0,0,.35)",
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.text, marginBottom: 8 }}>
              ¿Salir sin guardar?
            </div>
            <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5, marginBottom: 20 }}>
              Perdés la carga de esta operación que estás ejecutando. Esta acción no se puede deshacer.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" onClick={() => setConfirmOpen(false)} style={{
                background: "#fff", border: `1px solid ${T.cardBorder}`, borderRadius: 8,
                padding: "10px 18px", fontSize: 13, fontWeight: 700, color: T.text,
                cursor: "pointer", fontFamily: T.font,
              }}>
                Seguir editando
              </button>
              <button type="button" onClick={() => { setConfirmOpen(false); onClose?.(); }} style={{
                background: "#dc2626", border: "none", borderRadius: 8,
                padding: "10px 18px", fontSize: 13, fontWeight: 800, color: "#fff",
                cursor: "pointer", fontFamily: T.font,
              }}>
                Salir sin guardar
              </button>
            </div>
          </div>
        </div>
      )}
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
              title={sub > 0 && !l.cc ? "Falta el centro de costo (obligatorio)" : ""}
              style={{ ...inputStyle, padding: "6px 8px", fontSize: 12,
                ...(sub > 0 && !l.cc ? { border: "1px solid #fb923c", background: "#fff7ed" } : {}) }}>
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

      <div style={{ borderTop: `1px solid ${T.cardBorder}`, padding: "10px 14px", background: "#eceff3" }}>
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
  const savingRef = useRef(false);

  const guard = useCallback((fn) => () => {
    if (savingRef.current || !fn) return;
    savingRef.current = true;
    fn();
    // Reset tras 3s por si el modal no cierra (ej: error de validación)
    setTimeout(() => { savingRef.current = false; }, 3000);
  }, []);

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
      onMouseEnter={e => { e.currentTarget.style.background = "#eceff3"; e.currentTarget.style.color = T.text; }}
      onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = T.muted; }}>
        {asPage ? "← Cancelar" : "Cancelar"}
      </button>
      {showSecondary && secondaryAction && (
        <button type="button" onClick={guard(secondaryAction.onClick)} disabled={!canSave} style={{
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
      <button type="button" onClick={guard(onSave)} disabled={!canSave} style={{
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
