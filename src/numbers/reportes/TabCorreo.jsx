// Conciliación "Correo" — bandeja CONSOLIDADA de facturas parkeadas desde el mail (subtipo EGRESO_BORRADOR).
// Read-only sobre Gmail (el lector parkea aparte); acá el equipo revisa y CONTABILIZA (crea el EGRESO real) o
// IGNORA. Consolidado: todas las sociedades, columna Sociedad editable. Nada automático.
import { useState, useMemo, useEffect, useRef } from "react";
import { T, PageHeader, fmtDate, fmtMoney } from "../theme";
import {
  fetchCorreoBorradores, contabilizarBorrador, ignorarBorrador, leerBuzonCorreo, marcarCorreo, fetchPdfCorreo,
  fetchSociedades, fetchCuentas, fetchCentrosCosto, fetchProveedores,
  fetchEgresos, fetchMovTesoreria, toNum,
} from "../../lib/numbersApi";
import NuevoEgresoModal from "../NuevoEgresoModal";
import { formatNroComp, ccActivos } from "../formUtils";
import { useConfirm } from "../useConfirm";

const arr = x => Array.isArray(x) ? x : [];
const meta      = (nota, k) => (String(nota || "").match(new RegExp(`(?:^|;)${k}=([^;]+)`)) || [])[1] || "";
const metaRef   = nota => meta(nota, "mail_ref");
const metaFecha = nota => meta(nota, "fecha_correo");
const metaBuzon = nota => meta(nota, "buzon");
const metaArchivo = nota => meta(nota, "archivo");
// Marcas `revisar=` que deja el lector cuando la extracción no cierra (base + IVA ≠ total, sin nº, documento que no
// parece factura…): la fila lleva 🔎 con el motivo. No bloquea: el equipo mira el PDF y decide.
const TEXTO_REVISAR = { sin_total: "no encontró el total", no_cuadra: "base + IVA no suma el total", sin_nro: "sin número de factura",
  sin_fecha: "sin fecha de emisión", confianza: "el lector no está seguro de los datos", abono: "es una rectificativa / abono: revisá el signo" };
const motivosRevisar = nota => meta(nota, "revisar").split("|").filter(Boolean)
  .map(m => TEXTO_REVISAR[m] || (m.startsWith("tipo:") ? `parece ser "${m.slice(5).replace(/_/g, " ")}", no una factura` : m)).join(" · ");
// id del mensaje de Gmail: el borrador del lector se parkea como COR-<mailId>[-k]
const mailIdDe = id_comp => (String(id_comp || "").match(/^COR-([0-9a-f]+)/i) || [])[1] || "";
// "Ver mail": si el borrador trae el buzón (lector por casilla), abre esa cuenta de Google; si no, la activa.
const gmailUrl  = (ref, buzon) => !ref ? null
  : buzon ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(buzon)}#all/${ref}`
  : `https://mail.google.com/mail/u/0/#all/${ref}`;

// Una solapa por casilla de pagos. `lector` = tiene Apps Script propio (apps-script-lector-correo.gs); el de
// Argentina se habilita cuando exista. Un borrador sin `buzon=` en la nota (parkeado a mano, antes del lector) va a pagos@.
const BUZONES = [
  { id: "ar", label: "Argentina", mail: "pagos@bigg.fit",    lector: false },
  { id: "es", label: "España",    mail: "pagos.es@bigg.fit", lector: true },
];
const buzonDe = nota => BUZONES.find(b => b.mail === metaBuzon(nota)) || null;
const solapaDe = nota => (buzonDe(nota) || BUZONES.find(b => b.id === "ar")).id;

export default function TabCorreo({ onPend } = {}) {
  const [confirm, confirmUI] = useConfirm();
  const [borradores, setBorradores] = useState([]);
  const [sociedades, setSociedades] = useState([]);
  const [cuentas,    setCuentas]    = useState([]);
  const [centros,    setCentros]    = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [egresos,    setEgresos]    = useState([]);   // EGRESO reales (para flag "posible duplicado")
  const [movs,       setMovs]       = useState([]);   // para flag "débito pendiente en banco"
  const [edits,      setEdits]      = useState({});
  const [busy,       setBusy]       = useState(null);
  const [menuOpen,   setMenuOpen]   = useState(null);  // id_comp del dropdown abierto
  const [editar,     setEditar]     = useState(null);  // row abierto en NuevoEgresoModal
  const [pdf,        setPdf]        = useState(null);  // vista previa: { row, url, nombre } | { row, cargando } | { row, error }

  // Vista previa del PDF: el script lo lee del mail y lo devuelve; acá se muestra en un visor flotante.
  const verPdf = async (row) => {
    const bz = buzonDe(row.nota); const mail = mailIdDe(row.id); const archivo = metaArchivo(row.nota);
    if (!bz || !mail) return;
    setPdf({ row, cargando: true, nombre: archivo });
    try {
      const { blob, nombre } = await fetchPdfCorreo({ buzon: bz.id, mail, archivo });
      setPdf({ row, url: URL.createObjectURL(blob), nombre });
    } catch (e) { setPdf({ row, error: e?.message || String(e), nombre: archivo }); }
  };
  const cerrarPdf = () => { if (pdf?.url) URL.revokeObjectURL(pdf.url); setPdf(null); };
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [lectura,    setLectura]    = useState(null);  // resumen de la última corrida del lector (o su error)
  const [leyendo,    setLeyendo]    = useState(null);  // id del buzón que se está leyendo
  const [avisoMail,  setAvisoMail]  = useState(null);  // si no se pudo marcar el mail en Gmail (la contabilización ya quedó hecha)
  const [solapa,     setSolapa]     = useState(() => localStorage.getItem("nb_correo_solapa") || "es");   // buzón visible
  const menuRef = useRef(null);
  useEffect(() => { localStorage.setItem("nb_correo_solapa", solapa); }, [solapa]);
  const buzonActivo = BUZONES.find(b => b.id === solapa) || BUZONES[0];
  const visibles = useMemo(() => borradores.filter(r => solapaDe(r.nota) === solapa), [borradores, solapa]);
  const porSolapa = useMemo(() => Object.fromEntries(BUZONES.map(b => [b.id, borradores.filter(r => solapaDe(r.nota) === b.id).length])), [borradores]);

  // Estado en Gmail: tras contabilizar o ignorar un borrador que vino del lector, el hilo queda leído y etiquetado.
  // Si falla, la operación en Numbers NO se deshace: se avisa y se puede marcar a mano en el mail.
  const marcarEnGmail = async (row, estado) => {
    const bz = buzonDe(row.nota); const ref = metaRef(row.nota);
    if (!bz || !ref) return;
    try { await marcarCorreo({ buzon: bz.id, ref, estado }); }
    catch (e) { setAvisoMail(`${row.proveedor}: contabilizado en Numbers, pero no se pudo marcar el mail en ${bz.mail} (${e?.message || e}). Marcalo a mano.`); }
  };

  async function cargar() {
    setLoading(true); setError(null);
    try {
      const [brs, socs, ctas, ccs, provs, egs, mvs] = await Promise.all([
        fetchCorreoBorradores().catch(() => []),
        fetchSociedades().catch(() => []),
        fetchCuentas().catch(() => []),
        fetchCentrosCosto().catch(() => []),
        fetchProveedores().catch(() => []),
        fetchEgresos().catch(() => []),
        fetchMovTesoreria().catch(() => []),
      ]);
      setBorradores(arr(brs)); setSociedades(arr(socs)); setCuentas(arr(ctas));
      setCentros(arr(ccs)); setProveedores(arr(provs)); setEgresos(arr(egs)); setMovs(arr(mvs));
      onPend?.(arr(brs).length);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { cargar(); }, []);

  // "Leer el buzón": el script corre dentro de la casilla y parkea él mismo. Si se queda sin tiempo
  // devuelve parcial=true → se lo vuelve a llamar hasta que termine, acumulando el resumen.
  const leerBuzon = async (bz) => {
    setLeyendo(bz.id); setLectura(null);
    const acc = { buzon: bz, revisados: 0, parkeadas: [], ya_cargadas: [], viejas: [], sin_regla: 0, descartados: 0, lotes: [], errores: [], error_pdf: "", vueltas: 0 };
    try {
      let r;
      do {
        r = await leerBuzonCorreo({ buzon: bz.id });
        acc.vueltas++;
        acc.revisados   += r.revisados || 0;
        acc.sin_regla   += r.sin_regla || 0;
        acc.descartados += r.descartados || 0;
        acc.parkeadas.push(...arr(r.parkeadas));
        acc.ya_cargadas.push(...arr(r.ya_cargadas));
        acc.lotes.push(...arr(r.lotes));
        acc.viejas.push(...arr(r.viejas));
        acc.errores.push(...arr(r.errores));
        if (r.error_pdf) acc.error_pdf = r.error_pdf;
      } while (r.parcial && acc.vueltas < 12);
      acc.parcial = !!r.parcial;
      setLectura(acc);
      if (acc.parkeadas.length) await cargar();
    } catch (e) {
      // Las vueltas anteriores ya parkearon: se muestra lo que entró junto con el error, y se refresca la bandeja.
      setLectura({ ...acc, error: e?.message || String(e) });
      if (acc.parkeadas.length) await cargar();
    } finally { setLeyendo(null); }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const h = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(null); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);

  const cuentasEgreso = useMemo(() => cuentas.filter(c => {
    const t = (c.tipo ?? "").toLowerCase();
    return !(t === "venta" || t === "ventas" || t === "ingreso" || t === "ingresos");
  }), [cuentas]);

  // Débitos del banco todavía sin conciliar (origen extracto, salida, sin documento) → para marcar la fila.
  const pendientesDebito = useMemo(() =>
    movs.filter(m => m.origen === "extracto" && !String(m.documento_id || "") && toNum(m.monto) < 0),
    [movs]);
  // Importe exacto (al centavo): con ±0,50 un débito de Prosegur de 59,44 se "pegaba" a una factura de Grenke de 59,29.
  // Y el débito tiene que ser posterior a la emisión de la factura: uno anterior es el pago de la factura del mes
  // pasado (recurrentes de importe fijo). Es solo una pista: el match real se hace en Conciliaciones.
  const pagoPendiente = (row) => {
    const emision = String(row.fechaFiscal || row.fecha || "");
    return pendientesDebito.find(m => Math.abs(Math.abs(toNum(m.monto)) - toNum(row.total)) < 0.015
      && (!emision || String(m.fecha || "") >= emision)) || null;
  };
  // Duplicado contra los EGRESO reales del mismo proveedor, con la misma lógica que el lector:
  //   "dup" = mismo nº de factura (normalizado: "26/219518" ≡ "26-219518", sin ceros a la izquierda) → ya cargada.
  //   "mes" = mismo importe y mismo mes de servicio, con otro nº → mirar. Mismo importe de otro mes = recurrente, nada.
  // Devuelve el egreso que se parece, para mostrarlo en el tooltip sin abrir otra pestaña.
  const normNro = s => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
  const mismoNro = (a, b) => { a = normNro(a); b = normNro(b); if (a.length < 4 || b.length < 4) return false;
    return a === b || a.endsWith(b) || b.endsWith(a) || (a.length >= 6 && b.includes(a)) || (b.length >= 6 && a.includes(b)); };
  const duplicado = (row) => {
    if (!row.proveedorId) return null;
    const mios = egresos.filter(e => String(e.proveedorId || "") === String(row.proveedorId));
    const porNro = mios.find(e => row.nroComp && e.nroComp && mismoNro(row.nroComp, e.nroComp));
    if (porNro) return { nivel: "dup", egreso: porNro };
    const mes = String(row.fecha || "").slice(0, 7);
    const porMes = mios.find(e => Math.abs(toNum(e.total) - toNum(row.total)) < 0.01 && mes && String(e.fecha || "").slice(0, 7) === mes);
    return porMes ? { nivel: "mes", egreso: porMes } : null;
  };
  const descEgreso = e => `${e.id} · nº ${e.nroComp || "(sin nº)"} · ${fmtDate(e.fecha)} · ${fmtMoney(e.total, e.moneda || "EUR")}`;

  // fechaServicio = devengado (fin del período que factura); fechaFiscal = emisión de la factura (libro de IVA).
  const ed = (row) => edits[row.id] || { sociedad: row.sociedad || "", cuentaId: row.cuentaId || "", centro: row.cc || "",
    fechaServicio: row.fecha || "", fechaFiscal: row.fechaFiscal || row.fecha || "", nroComp: row.nroComp || "" };
  const setEd = (id, patch) => setEdits(e => ({ ...e, [id]: { ...(edits[id] || {}), ...patch } }));

  // Un borrador puede venir ya repartido en varios centros (el lector abre una línea por sede cuando la factura
  // las trae, ej. Scentair): se contabiliza con todas sus líneas; el selector de centro solo aplica a una línea.
  const esMulti = row => arr(row.lineas).length > 1;
  const payloadDe = (row, e) => {
    const cuentaNombre = (cuentas.find(c => c.id === e.cuentaId)?.nombre) || e.cuentaId;
    const linea = (row.lineas && row.lineas[0]) || {};
    return {
      sociedad: e.sociedad, fecha: e.fechaServicio || row.fecha || "", fechaFiscal: e.fechaFiscal || row.fechaFiscal || e.fechaServicio || row.fecha || "", vto: row.vto || "",
      proveedor: row.proveedor, proveedorId: row.proveedorId,
      cuenta: cuentaNombre, cuentaId: e.cuentaId, moneda: row.moneda || "ARS",
      nroComp: e.nroComp || "", nota: row.nota || "",
      lineas: esMulti(row) ? row.lineas.map(l => ({ cc: l.cc, subtotal: l.subtotal, ivaRate: l.ivaRate ?? 0 }))
                           : [{ cc: e.centro, subtotal: linea.subtotal ?? row.total, ivaRate: linea.ivaRate ?? 0 }],
    };
  };

  const contabilizar = async (row) => {
    const e = ed(row);
    if (!e.sociedad || !e.cuentaId || (esMulti(row) ? row.lineas.some(l => !l.cc) : !e.centro)) return;
    setBusy(row.id); setMenuOpen(null);
    try { await contabilizarBorrador(row.id, payloadDe(row, e)); await marcarEnGmail(row, "contabilizada"); await cargar(); }
    catch (err) { alert("Error al contabilizar: " + (err?.message || err)); }
    finally { setBusy(null); }
  };

  const ignorar = async (row) => {
    setMenuOpen(null);
    if (!(await confirm(`¿Ignorar la factura de ${row.proveedor} ($${Math.round(row.total)})? No se contabiliza.`))) return;
    setBusy(row.id);
    try { await ignorarBorrador(row.id, "correo"); await marcarEnGmail(row, "ignorada"); await cargar(); }
    catch (err) { alert("Error: " + (err?.message || err)); }
    finally { setBusy(null); }
  };

  // "Abrir para editar" → NuevoEgresoModal precargado (para repartir en varios centros).
  // Reusa payloadDe y sólo agrega lo propio del modal (marca _duplicate + nombre de cuenta legible).
  const initialDe = (row) => {
    const e = ed(row);
    return {
      ...payloadDe(row, e),
      _duplicate: true,   // se trata como comprobante NUEVO (el id COR- no es un egreso real)
      cuenta: (cuentas.find(c => c.id === e.cuentaId)?.nombre) || row.cuenta,
    };
  };
  const guardarEditado = async (payload) => {
    if (!editar) return;
    await contabilizarBorrador(editar.id, payload);
    await marcarEnGmail(editar, "contabilizada");
    setEditar(null);
    await cargar();
  };

  const thS = { padding:"10px 12px", fontSize:11, fontWeight:800, color:"rgba(255,255,255,.9)",
    textAlign:"left", letterSpacing:".04em", textTransform:"uppercase", whiteSpace:"nowrap" };
  const sel = { background:"#fff", border:`1px solid ${T.cardBorder}`, borderRadius:6, padding:"5px 7px",
    fontSize:12, color:T.text, fontFamily:T.font, outline:"none", maxWidth:150 };
  const num = (bold) => ({ padding:"9px 12px", fontSize:13, fontWeight: bold?800:600, color:T.text,
    fontFamily:"var(--mono)", textAlign:"right", whiteSpace:"nowrap" });

  if (editar) {
    return (
      <NuevoEgresoModal asPage sociedad={ed(editar).sociedad || editar.sociedad}
        proveedores={proveedores} cuentas={cuentas} centrosCosto={centros}
        initialData={initialDe(editar)}
        onClose={() => setEditar(null)} onSave={guardarEditado} />
    );
  }

  const item = (label, onClick, color, disabled) => (
    <button onClick={() => { if (!disabled) { setMenuOpen(null); onClick(); } }} disabled={disabled}
      style={{ display:"block", width:"100%", textAlign:"left", padding:"8px 14px", background:"transparent",
        border:"none", fontSize:13, color: disabled ? T.dim : (color || T.text), cursor: disabled?"default":"pointer", fontFamily:T.font }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = "#f3f4f6"; }}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>{label}</button>
  );

  return (
    <div className="fade" style={{ padding:"28px 32px" }}>
      {confirmUI}

      {/* Visor de PDF: panel flotante a la derecha, la bandeja sigue visible y editable al lado. */}
      {pdf && (
        <div style={{ position:"fixed", top:0, right:0, bottom:0, width:"min(720px, 60vw)", zIndex:600, background:T.card,
          borderLeft:`1px solid ${T.cardBorder}`, boxShadow:"-12px 0 32px rgba(0,0,0,.18)", display:"flex", flexDirection:"column" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 16px", borderBottom:`1px solid ${T.cardBorder}` }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:800, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{pdf.row.proveedor} · {pdf.row.nroComp || "sin nº"}</div>
              <div style={{ fontSize:11, color:T.muted, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{pdf.nombre}</div>
            </div>
            {pdf.url && (
              <a href={pdf.url} target="_blank" rel="noreferrer" download={pdf.nombre}
                style={{ fontSize:12, color:T.muted, textDecoration:"none", border:`1px solid ${T.cardBorder}`, borderRadius:6, padding:"4px 10px", whiteSpace:"nowrap" }}>Abrir en pestaña</a>
            )}
            <button onClick={cerrarPdf} style={{ background:"transparent", border:"none", color:T.muted, cursor:"pointer", fontSize:18 }} title="Cerrar">✕</button>
          </div>
          {pdf.cargando && <div style={{ padding:40, textAlign:"center", color:T.muted, fontSize:13 }}>Trayendo el PDF del mail…</div>}
          {pdf.error && <div role="alert" style={{ margin:16, background:T.redBg, border:`1px solid ${T.red}`, borderRadius:T.radius, padding:"12px 16px", color:"#991b1b", fontSize:13 }}>No se pudo traer el PDF: {pdf.error}</div>}
          {pdf.url && <iframe title={pdf.nombre} src={pdf.url} style={{ flex:1, border:"none", width:"100%" }} />}
        </div>
      )}
      <PageHeader
        title="Correo — facturas"
        back={
          <span title={`Facturas leídas de ${buzonActivo.mail}, parkeadas sin contabilizar. El lector lee cada PDF con Gemini (número, fechas, importes, sede) y propone proveedor, cuenta y centro por las reglas del Sheet. Revisá y Contabilizá (crea la factura/CxP en su sociedad) o Ignorá. 🔎 = el lector no está seguro de algún dato. El mail no se toca.`}
            style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:20, height:20, borderRadius:"50%",
              border:`1.5px solid ${T.muted}`, color:T.muted, fontSize:12, fontWeight:800, cursor:"help", userSelect:"none" }}>?</span>
        }
        action={(() => {
          const bz = buzonActivo;
          const puede = bz.lector && !leyendo && !loading;
          return (
            <button onClick={() => puede && leerBuzon(bz)} disabled={!puede}
              title={bz.lector ? `Lee ${bz.mail} y parkea las facturas nuevas. No toca el mail.` : `${bz.mail} todavía no tiene lector: las facturas se parkean a mano.`}
              style={{ background: puede ? T.accentDark : "#e5e7eb", color: puede ? T.accent : T.muted, flexShrink:0,
                border:"none", borderRadius:8, padding:"9px 16px", fontSize:13, fontWeight:800, cursor: puede ? "pointer" : "default", fontFamily:T.font, whiteSpace:"nowrap" }}>
              {leyendo === bz.id ? "Leyendo el buzón…" : bz.lector ? `✉ Leer el buzón (${bz.label})` : "✉ Sin lector todavía"}
            </button>
          );
        })()} />

      {/* Solapas: una por casilla. El conteo es lo pendiente de cada buzón. */}
      <div style={{ display:"flex", gap:6, marginBottom:16, borderBottom:`1px solid ${T.cardBorder}` }}>
        {BUZONES.map(bz => {
          const on = bz.id === solapa;
          return (
            <button key={bz.id} onClick={() => setSolapa(bz.id)}
              style={{ background:"transparent", border:"none", borderBottom:`2px solid ${on ? T.accentDark : "transparent"}`, marginBottom:-1,
                padding:"8px 14px", fontSize:13, fontWeight: on ? 800 : 600, color: on ? T.text : T.muted, cursor:"pointer", fontFamily:T.font }}>
              {bz.label} · {bz.mail}
              {porSolapa[bz.id] > 0 && (
                <span style={{ marginLeft:8, background: on ? T.accentDark : "#e5e7eb", color: on ? T.accent : T.muted, borderRadius:10, padding:"1px 7px", fontSize:11, fontWeight:800 }}>
                  {porSolapa[bz.id]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {avisoMail && (
        <div role="alert" style={{ background:"#fffbeb", border:"1px solid #f59e0b", borderRadius:T.radius, padding:"10px 16px", marginBottom:12, fontSize:13, color:"#92400e",
          display:"flex", justifyContent:"space-between", gap:12 }}>
          <span>{avisoMail}</span>
          <button onClick={() => setAvisoMail(null)} style={{ background:"transparent", border:"none", color:"#92400e", cursor:"pointer", fontSize:16 }}>✕</button>
        </div>
      )}

      {lectura && (
        <div role="status" style={{ background: lectura.error ? T.redBg : T.card, border:`1px solid ${lectura.error ? T.red : T.cardBorder}`,
          borderRadius:T.radius, padding:"12px 16px", marginBottom:16, fontSize:13, color: lectura.error ? "#991b1b" : T.text }}>
          {lectura.error ? (
            <span>
              No se pudo terminar de leer {lectura.buzon.mail}: {lectura.error}
              {lectura.parkeadas.length > 0 && <> · Antes del error entraron {lectura.parkeadas.length} factura{lectura.parkeadas.length === 1 ? "" : "s"}. Volvé a tocar el botón para seguir.</>}
            </span>
          ) : (
            <>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                <span>
                  <b>{lectura.buzon.mail}</b>: {lectura.revisados} mails revisados ·{" "}
                  <b>{lectura.parkeadas.length} factura{lectura.parkeadas.length === 1 ? "" : "s"} parkeada{lectura.parkeadas.length === 1 ? "" : "s"}</b>
                  {lectura.sin_regla > 0 && <> ({lectura.sin_regla} sin regla: revisá proveedor y centro)</>}
                  {" "}· {lectura.ya_cargadas.length} ya estaban cargadas · {lectura.descartados} descartados (sin factura)
                  {lectura.viejas.length > 0 && <> · {lectura.viejas.length} anteriores al corte (no se parkean)</>}
                  {lectura.parcial && <> · <span style={{ color:"#b45309" }}>corrida incompleta, volvé a tocar el botón</span></>}
                </span>
                <button onClick={() => setLectura(null)} style={{ background:"transparent", border:"none", color:T.muted, cursor:"pointer", fontSize:16 }}>✕</button>
              </div>
              {lectura.parkeadas.length > 0 && (
                <ul style={{ margin:"8px 0 0", paddingLeft:18, color:T.muted, columns:2, columnGap:24 }}>
                  {lectura.parkeadas.map((p, i) => (
                    <li key={i}>{p.proveedor || "?"}{p.nro ? ` · ${p.nro}` : ""}{p.total != null ? ` · ${fmtMoney(p.total, "EUR")}` : " · sin total"}{p.sin_regla ? " · sin regla" : ""}</li>
                  ))}
                </ul>
              )}
              {lectura.lotes.length > 0 && (
                <div style={{ marginTop:8, color:"#b45309" }}>
                  Lotes sin parkear (muchos PDF en un mail, revisar a mano): {lectura.lotes.map(l => `${l.remitente} · ${l.mail} (${l.pdfs.length} PDF, ${fmtDate(l.fecha)})`).join(" · ")}
                </div>
              )}
              {lectura.error_pdf && <div style={{ marginTop:8, color:"#991b1b" }}>{lectura.error_pdf}</div>}
              {lectura.errores.length > 0 && (
                <div style={{ marginTop:8, color:"#991b1b" }}>Con error: {lectura.errores.map(e => `${e.mail} (${e.error})`).join(" · ")}</div>
              )}
            </>
          )}
        </div>
      )}


      {loading && <div style={{ padding:"50px", textAlign:"center", color:T.muted, fontSize:14 }}>Cargando bandeja de correo…</div>}
      {error && !loading && (
        <div role="alert" style={{ background:T.redBg, border:`1px solid ${T.red}`, borderRadius:T.radius, padding:"16px 20px", color:"#991b1b", fontSize:13 }}>{error}</div>
      )}

      {!loading && !error && (visibles.length === 0 ? (
        <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius, padding:"56px 24px", textAlign:"center" }}>
          <div style={{ fontSize:28, marginBottom:10 }}>📭</div>
          <div style={{ fontSize:14, color:T.muted }}>No hay facturas de {buzonActivo.mail} por contabilizar.</div>
        </div>
      ) : (
        <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius, boxShadow:T.shadow, overflow:"visible" }}>
          <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", minWidth:1360 }}>
            <thead><tr style={{ background:"#0e7490" }}>
              {[["Fecha correo","left"],["Proveedor","left"],["N°","left"],["Sociedad","left"],["Emisión","left"],["Fecha servicio","left"],["Vto","left"],
                ["Cuenta contable","left"],["Centro","left"],["Subtotal","right"],["IVA","right"],["Total","right"],["",""]]
                .map(([h,a],i) => <th key={i} style={{ ...thS, textAlign:a }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {visibles.map((row, i) => {
                const e = ed(row);
                const linea = (row.lineas && row.lineas[0]) || {};
                const enCurso = busy === row.id;
                const pago = pagoPendiente(row);
                const dup  = duplicado(row);
                const revisar = motivosRevisar(row.nota);
                const multi = esMulti(row);
                // Vto: si el pago ya se debitó en el banco, mostramos esa fecha; si no, la de la factura.
                const vtoMostrar = pago ? pago.fecha : row.vto;
                return (
                  <tr key={row.id} style={{ borderBottom:`1px solid ${T.cardBorder}`, background: i%2===0 ? T.card : "#fafbfc" }}>
                    <td style={{ padding:"9px 12px", fontSize:12, color:T.muted, whiteSpace:"nowrap" }}>{metaFecha(row.nota) ? fmtDate(metaFecha(row.nota)) : "—"}</td>
                    <td style={{ padding:"9px 12px", whiteSpace:"nowrap" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, fontWeight:700, color:T.text }}>
                        <span>{row.proveedor || "—"}</span>
                        {pago && <span style={{ fontSize:13, cursor:"help" }} title={`Pago ya realizado — falta matchearlo contra esta factura.\nDébito en Banco: ${pago.cuenta_bancaria} · ${fmtDate(pago.fecha)} · ${fmtMoney(Math.abs(toNum(pago.monto)), row.moneda||"ARS")}`}>💳</span>}
                        {dup?.nivel === "dup" && <span style={{ fontSize:13, cursor:"help" }} title={`YA CARGADA: existe un egreso con el mismo número.\n${descEgreso(dup.egreso)}`}>⛔</span>}
                        {dup?.nivel === "mes" && <span style={{ fontSize:13, cursor:"help" }} title={`Mismo importe y mismo mes que un egreso ya cargado, con otro número: revisá.\n${descEgreso(dup.egreso)}`}>⚠️</span>}
                        {revisar && <span style={{ fontSize:13, cursor:"help" }} title={`El lector no está seguro de esta factura:\n${revisar}\nAbrí el PDF y revisá antes de contabilizar.`}>🔎</span>}
                      </div>
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      {/* Máscara AFIP (FC-A 00001-00001234) sólo para Argentina; en España el nº es libre (FAC-2026-175, 26/219518). */}
                      <input value={e.nroComp} onChange={ev => setEd(row.id, { nroComp: solapa === "ar" ? formatNroComp(ev.target.value) : ev.target.value })}
                        placeholder="" style={{ ...sel, maxWidth:130 }} />
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      <select value={e.sociedad} onChange={ev => setEd(row.id, { sociedad: ev.target.value })}
                        style={{ ...sel, borderColor: e.sociedad ? T.cardBorder : "#f59e0b", background: e.sociedad ? "#fff" : "#fffbeb" }}>
                        <option value="">⚠ Falta sociedad</option>
                        {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                      </select>
                    </td>
                    <td style={{ padding:"9px 12px" }} title="Fecha de emisión de la factura (fecha fiscal: libro de IVA)">
                      <input type="date" value={e.fechaFiscal} onChange={ev => setEd(row.id, { fechaFiscal: ev.target.value })}
                        style={{ ...sel, maxWidth:140 }} />
                    </td>
                    <td style={{ padding:"9px 12px" }} title="Fecha del servicio (devengado: fin del período facturado)">
                      <input type="date" value={e.fechaServicio} onChange={ev => setEd(row.id, { fechaServicio: ev.target.value })}
                        style={{ ...sel, maxWidth:140 }} />
                    </td>
                    <td style={{ padding:"9px 12px", fontSize:12, color: pago ? "#059669" : T.muted, whiteSpace:"nowrap", fontWeight: pago ? 700 : 400 }}
                      title={pago ? "Fecha del pago ya debitado en el banco" : "Vencimiento de la factura"}>
                      {vtoMostrar ? fmtDate(vtoMostrar) : "—"}
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      <select value={e.cuentaId} onChange={ev => setEd(row.id, { cuentaId: ev.target.value })} style={sel}>
                        <option value="">— cuenta —</option>
                        {cuentasEgreso.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      {multi ? (
                        <span style={{ fontSize:12, color:T.text, cursor:"help", whiteSpace:"nowrap" }}
                          title={`La factura ya viene repartida en ${row.lineas.length} centros:\n${row.lineas.map(l => `${(centros.find(c => c.id === l.cc)?.nombre) || l.cc || "(sin centro)"} · ${fmtMoney(l.total_linea, row.moneda || "ARS")}`).join("\n")}\nPara cambiar el reparto: Abrir para editar.`}>
                          Varios ({row.lineas.length}) ▾
                        </span>
                      ) : (
                        <select value={e.centro} onChange={ev => setEd(row.id, { centro: ev.target.value })}
                          style={{ ...sel, borderColor: e.centro ? T.cardBorder : "#f59e0b", background: e.centro ? "#fff" : "#fffbeb" }}>
                          <option value="">⚠ centro</option>
                          {ccActivos(centros, e.centro).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                      )}
                    </td>
                    <td style={num(false)}>{fmtMoney(multi ? row.lineas.reduce((a, l) => a + (l.subtotal || 0), 0) : (linea.subtotal ?? row.total), row.moneda || "ARS")}</td>
                    <td style={{ ...num(false), color:T.muted }}>{(() => { const iva = multi ? row.lineas.reduce((a, l) => a + (l.iva_monto || 0), 0) : (linea.iva_monto || 0); return iva > 0 ? fmtMoney(iva, row.moneda || "ARS") : "—"; })()}</td>
                    <td style={num(true)}>{fmtMoney(row.total, row.moneda || "ARS")}</td>
                    <td style={{ padding:"9px 10px", whiteSpace:"nowrap", textAlign:"right" }}>
                      <button onClick={(ev) => {
                          if (menuOpen?.id === row.id) { setMenuOpen(null); return; }
                          const r = ev.currentTarget.getBoundingClientRect();
                          setMenuOpen({ id: row.id, top: r.bottom + 4, left: Math.max(8, r.right - 210) });
                        }} disabled={enCurso}
                        style={{ background: menuOpen?.id===row.id ? "#e5e7eb" : "#f3f4f6", border:`1px solid ${T.cardBorder}`,
                          borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:13, color:T.muted, fontFamily:T.font }}>
                        {enCurso ? "…" : "⋯"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      ))}

      {/* Dropdown de acciones — position:fixed para no cortarse dentro del contenedor con overflow. */}
      {menuOpen && (() => {
        const row = borradores.find(r => r.id === menuOpen.id);
        if (!row) return null;
        const e = ed(row); const ref = metaRef(row.nota); const buzon = metaBuzon(row.nota);
        const listo = e.sociedad && e.cuentaId && e.centro;
        return (
          <div ref={menuRef} style={{ position:"fixed", top:menuOpen.top, left:menuOpen.left, zIndex:9999,
            background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:8, boxShadow:"0 8px 24px rgba(0,0,0,.15)", minWidth:200, overflow:"hidden" }}>
            {item("Contabilizar ✓", () => contabilizar(row), "#16a34a", !listo)}
            {item("Abrir para editar (varios centros)", () => setEditar(row))}
            {buzon && metaArchivo(row.nota) && item("Ver PDF", () => verPdf(row))}
            {ref && item("Ver mail", () => window.open(gmailUrl(ref, buzon), "_blank"))}
            <div style={{ height:1, background:T.cardBorder, margin:"3px 0" }} />
            {item("Ignorar", () => ignorar(row), T.red)}
          </div>
        );
      })()}
    </div>
  );
}
