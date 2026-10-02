// Piezas compartidas por las pantallas de comprobantes (Compras / Ventas). Nacieron copiadas en
// PantallaEgresos y PantallaIngresos y cada arreglo había que hacerlo dos veces; acá viven una sola vez.
// Lo que difiere entre los dos lados (textos, colores, signo del monto) entra como prop o como `modo`.
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { T, MoneyField } from "./theme";
import { TIPO_CUENTA } from "../data/tesoreriaData";
import { updateMovTesoreria, borrarPagoImputado } from "../lib/numbersApi";
import { byNombre, ccActivos } from "./formUtils";

// ─── Centros de costo de un comprobante, en una celda ─────────────────────────
export function CCDisplay({ lineas, resolveCC }) {
  const ids = [...new Set((lineas ?? []).map(l => l.cc).filter(Boolean))];
  if (ids.length === 0) return <span style={{ color:T.dim, fontSize:11 }}>—</span>;
  const names = ids.map(id => resolveCC(id));
  if (ids.length === 1) return <span style={{ fontSize:11, background:"#f3f4f6", color:T.muted, borderRadius:6, padding:"2px 8px", fontWeight:600 }}>{names[0]}</span>;
  return <span title={names.join("\n")} style={{ fontSize:11, background:"#f3f4f6", color:T.muted, borderRadius:6, padding:"2px 8px", fontWeight:600, cursor:"help" }}>Múltiple ({ids.length})</span>;
}

// ─── Búsqueda libre de la lista: contraparte, cuenta, centro, nota y N° de comprobante ─────────
// `partyKey` = "proveedor" | "cliente". Sin texto de búsqueda, todo matchea.
export function matchBusqueda(doc, busqueda, partyKey) {
  const q = String(busqueda ?? "").toLowerCase();
  if (!q) return true;
  const has = v => String(v ?? "").toLowerCase().includes(q);
  return has(doc[partyKey]) || has(doc.cuenta) || has(doc.cc) || has(doc.nota) || has(doc.nroComp);
}

// ─── Dropdown de acciones por fila ────────────────────────────────────────────
// items: [{ label, onClick, color? } | "divider" | falsy]. Los falsy se saltan (acciones condicionales).
export function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState({ top:0, left:0 });
  const btnRef  = useRef(null);
  const menuRef = useRef(null);

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(o => !o);
  };

  // Si el menú se sale por abajo del viewport (última fila), lo abrimos hacia arriba.
  useLayoutEffect(() => {
    if (!open || !menuRef.current || !btnRef.current) return;
    const menu = menuRef.current.getBoundingClientRect();
    if (menu.bottom > window.innerHeight - 8) {
      const b = btnRef.current.getBoundingClientRect();
      setPos({ top: b.top - menu.height - 4, left: b.left });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = e => {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          btnRef.current  && !btnRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <>
      <button ref={btnRef} onClick={handleToggle} style={{
        background: open ? "#e5e7eb" : "#f3f4f6",
        border:`1px solid ${T.cardBorder}`, borderRadius:6,
        padding:"3px 8px", cursor:"pointer", fontSize:12, color:T.muted,
        fontFamily:T.font, lineHeight:1,
      }}>▾</button>

      {open && (
        <div ref={menuRef} style={{
          position:"fixed", top:pos.top, left:pos.left, zIndex:9999,
          background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:8,
          boxShadow:"0 8px 24px rgba(0,0,0,.15)", minWidth:170, overflow:"hidden",
        }}>
          {items.map((it, i) => {
            if (!it) return null;
            if (it === "divider") return <div key={`d${i}`} style={{ height:1, background:T.cardBorder, margin:"3px 0" }} />;
            return (
              <button key={it.label} onClick={() => { it.onClick(); setOpen(false); }} style={{
                display:"block", width:"100%", textAlign:"left", padding:"8px 14px",
                background:"transparent", border:"none", fontSize:13, color: it.color ?? T.text,
                cursor:"pointer", fontFamily:T.font,
              }}
              onMouseEnter={e => e.currentTarget.style.background="#f3f4f6"}
              onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── Modal: Editar Pago / Editar Cobro ────────────────────────────────────────
// `modo` = "pago" (Compras: el monto se guarda negativo) | "cobro" (Ventas: positivo; una retención se
// edita por cuenta contable + centro en vez de medio de cobro). El resto del modal es el mismo.
const EDITAR_CFG = {
  pago:  { titulo: () => "Editar Pago",  headerBg: () => "#0e7490", medioLabel: "Medio de pago",  signo: -1, cosa: () => "este pago" },
  cobro: { titulo: (esRet) => esRet ? "Editar Retención" : "Editar Cobro",
           headerBg: (esRet) => esRet ? "#5b21b6" : "#16a34a", medioLabel: "Medio de cobro", signo: 1,
           cosa: (esRet) => esRet ? "esta retención" : "este cobro" },
};
const LBL = { fontSize:11, fontWeight:700, color:T.muted, textTransform:"uppercase", letterSpacing:".07em", display:"block", marginBottom:4 };
const INP = { width:"100%", padding:"8px 10px", fontSize:13, borderRadius:8, boxSizing:"border-box", border:`1px solid ${T.cardBorder}`, background:"#eceff3", color:T.text, fontFamily:"inherit" };
const SEL = { width:"100%", padding:"8px 10px", fontSize:13, borderRadius:8, border:`1px solid ${T.cardBorder}`, background:"#eceff3", color:T.text, fontFamily:"inherit" };

export function EditarPagoCobroModal({ modo, mov, cuentasSoc, cuentasContables = [], centros = [], onClose, onSaved }) {
  const cfg   = EDITAR_CFG[modo];
  const esRet = modo === "cobro" && mov.origen === "retencion";   // una retención se edita por cuenta+centro, no por medio de cobro
  const cuentasOrd = useMemo(() => [...cuentasContables].sort(byNombre), [cuentasContables]);
  const [form, setForm] = useState({
    fecha:           mov.fecha ?? new Date().toISOString().slice(0, 10),
    monto:           String(Math.abs(Number(mov.monto) || 0)),
    cuenta_bancaria: mov.cuenta_bancaria ?? "",
    cuenta_contable: mov.cuenta_contable ?? "",
    centro_costo:    mov.centro_costo ?? "",
    nota:            mov.nota ?? "",
  });
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);   // confirmación inline (no dependemos de window.confirm, que Chrome puede bloquear)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const canSave = form.fecha && form.monto && Number(form.monto) > 0 && (!esRet || (form.cuenta_contable && form.centro_costo));

  const _savingRef = useRef(false);
  const handleGuardar = async () => {
    if (_savingRef.current) return;
    _savingRef.current = true;
    setSaving(true);
    try {
      const monto = Number(form.monto);
      const patch = esRet
        ? { fecha: form.fecha, monto, cuenta_contable: form.cuenta_contable, centro_costo: form.centro_costo, nota: form.nota }
        : { fecha: form.fecha, monto: cfg.signo * monto, cuenta_bancaria: form.cuenta_bancaria, nota: form.nota };
      await updateMovTesoreria(mov.id, patch);
      onSaved();
    } catch (e) { alert("Error: " + e.message); }
    finally { _savingRef.current = false; setSaving(false); }
  };

  // Un movimiento que vino del motor de conciliación (origen="extracto") ES la línea del banco: no se
  // borra (destruiría el movimiento real) → se desimputa y vuelve a la conciliación. El manual (y la
  // retención) sí se borra. borrarPagoImputado decide.
  const delMotor = mov.origen === "extracto";
  const handleBorrar = async () => {
    setDeleting(true);
    try {
      await borrarPagoImputado(mov);
      onSaved();
    } catch (e) { alert("Error al eliminar: " + e.message); }
    finally { setDeleting(false); }
  };

  const cuentasOpts = cuentasSoc
    .filter(c => c.moneda === mov.moneda)
    .map(c => ({ value: c.id, label: `${TIPO_CUENTA[(c.tipo ?? "").toLowerCase()]?.icon ?? "💳"} ${c.nombre}` }));

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.55)", zIndex:600,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:10, width:440, maxWidth:"97vw",
        boxShadow:"0 20px 60px rgba(0,0,0,.35)", overflow:"hidden" }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ background: cfg.headerBg(esRet), padding:"13px 20px",
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:15, fontWeight:800, color:"#fff" }}>{cfg.titulo(esRet)}</span>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.7)", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding:"20px 22px", display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div>
              <label style={LBL}>Fecha</label>
              <input type="date" value={form.fecha} onChange={e => set("fecha", e.target.value)} style={INP} />
            </div>
            <div>
              <label style={LBL}>Monto</label>
              <MoneyField value={form.monto} onChange={e => set("monto", e.target.value)} style={INP} />
            </div>
          </div>
          {esRet ? (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div>
                <label style={LBL}>Cuenta</label>
                <select value={form.cuenta_contable} onChange={e => set("cuenta_contable", e.target.value)} style={INP}>
                  <option value="">— cuenta —</option>
                  {cuentasOrd.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
                </select>
              </div>
              <div>
                <label style={LBL}>Centro de costo</label>
                <select value={form.centro_costo} onChange={e => set("centro_costo", e.target.value)} style={INP}>
                  <option value="">— centro —</option>
                  {ccActivos(centros, form.centro_costo).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label style={LBL}>{cfg.medioLabel}</label>
              <select value={form.cuenta_bancaria} onChange={e => set("cuenta_bancaria", e.target.value)} style={SEL}>
                <option value="">— Seleccionar —</option>
                {cuentasOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <label style={LBL}>Nota</label>
            <textarea value={form.nota} onChange={e => set("nota", e.target.value)} rows={3}
              style={{ ...INP, resize:"vertical" }} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding:"12px 22px 18px", display:"flex", gap:8, alignItems:"center" }}>
          {!confirmDel ? (
            <button onClick={() => setConfirmDel(true)} disabled={deleting}
              style={{ padding:"9px 16px", borderRadius:8, border:"none", cursor:"pointer",
                background:"#dc2626", color:"#fff", fontWeight:700, fontSize:13, fontFamily:"inherit",
                display:"flex", alignItems:"center", gap:6 }}>
              {delMotor ? "↩︎ Quitar de la factura" : "🗑 Borrar"}
            </button>
          ) : (
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <span style={{ fontSize:12, color:T.muted, fontWeight:700, maxWidth:190 }}>
                {delMotor ? "Vuelve a conciliación (no se borra del banco). ¿Seguro?" : `¿Eliminar ${cfg.cosa(esRet)}?`}
              </span>
              <button onClick={handleBorrar} disabled={deleting}
                style={{ padding:"9px 14px", borderRadius:8, border:"none", cursor:"pointer",
                  background:"#dc2626", color:"#fff", fontWeight:700, fontSize:13, fontFamily:"inherit" }}>
                {deleting ? (delMotor ? "Desimputando…" : "Eliminando…") : (delMotor ? "Sí, quitar" : "Sí, borrar")}
              </button>
              <button onClick={() => setConfirmDel(false)} disabled={deleting}
                style={{ padding:"9px 12px", borderRadius:8, border:`1px solid ${T.cardBorder}`,
                  cursor:"pointer", background:"#f3f4f6", color:T.muted, fontWeight:700, fontSize:13, fontFamily:"inherit" }}>No</button>
            </div>
          )}
          <div style={{ flex:1 }} />
          <button onClick={onClose}
            style={{ padding:"9px 18px", borderRadius:8, border:`1px solid ${T.cardBorder}`,
              cursor:"pointer", background:"#f3f4f6", color:T.muted, fontWeight:700,
              fontSize:13, fontFamily:"inherit" }}>Cancelar</button>
          <button onClick={handleGuardar} disabled={!canSave || saving}
            style={{ padding:"9px 18px", borderRadius:8, border:"none",
              cursor: canSave ? "pointer" : "default", fontWeight:700, fontSize:13,
              fontFamily:"inherit", background: canSave ? "#16a34a" : "#9ca3af", color:"#fff",
              display:"flex", alignItems:"center", gap:6 }}>
            💾 {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
