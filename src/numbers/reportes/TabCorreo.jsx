// Conciliación "Correo" — bandeja CONSOLIDADA de facturas parkeadas desde el mail (subtipo EGRESO_BORRADOR).
// Read-only sobre Gmail (el lector parkea aparte); acá el equipo revisa y CONTABILIZA (crea el EGRESO real) o
// IGNORA. Consolidado: todas las sociedades, columna Sociedad editable. Nada automático.
import { useState, useMemo, useEffect, useRef } from "react";
import { T, PageHeader, fmtDate, fmtMoney } from "../theme";
import {
  fetchCorreoBorradores, contabilizarBorrador, ignorarBorrador, leerBuzonCorreo, marcarCorreo, fetchPdfCorreo, responderCorreo,
  fetchSociedades, fetchCuentas, fetchCentrosCosto, fetchProveedores,
  fetchEgresos, fetchMovTesoreria, toNum,
} from "../../lib/numbersApi";
import NuevoEgresoModal from "../NuevoEgresoModal";
import { formatNroComp, ccActivos, Label } from "../formUtils";
import { RowMenu } from "../comprobantesUi";
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
// `firma` = cómo se despide el acuse de recibo que sale desde esa casilla.
const BUZONES = [
  { id: "ar", label: "Argentina", mail: "pagos@bigg.fit",    lector: false, firma: "Administración · BIGG" },
  { id: "es", label: "España",    mail: "pagos.es@bigg.fit", lector: true,  firma: "Administración · BIGG España" },
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
  const [editar,     setEditar]     = useState(null);  // row abierto en NuevoEgresoModal
  const [pdf,        setPdf]        = useState(null);  // vista previa: { row, url, nombre } | { row, cargando } | { row, error }

  // Vista previa del PDF: el script lo lee del mail (2-5 s) y se muestra en un visor flotante. Los ya traídos quedan
  // en memoria por borrador hasta salir de la pantalla: reabrir el mismo PDF es instantáneo.
  const pdfCache = useRef(new Map());
  useEffect(() => () => { pdfCache.current.forEach(p => URL.revokeObjectURL(p.url)); }, []);
  const verPdf = async (row) => {
    const bz = buzonDe(row.nota); const mail = mailIdDe(row.id); const archivo = metaArchivo(row.nota);
    if (!bz || !mail) return;
    const visto = pdfCache.current.get(row.id);
    if (visto) { setPdf({ row, ...visto }); return; }
    setPdf({ row, cargando: true, nombre: archivo });
    try {
      const { blob, nombre } = await fetchPdfCorreo({ buzon: bz.id, mail, archivo });
      const p = { url: URL.createObjectURL(blob), nombre };
      pdfCache.current.set(row.id, p);
      setPdf({ row, ...p });
    } catch (e) { setPdf({ row, error: e?.message || String(e), nombre: archivo }); }
  };
  const cerrarPdf = () => setPdf(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [lectura,    setLectura]    = useState(null);  // resumen de la última corrida del lector (o su error)
  const [leyendo,    setLeyendo]    = useState(null);  // id del buzón que se está leyendo
  const [avisoMail,  setAvisoMail]  = useState(null);  // si no se pudo marcar el mail en Gmail (la contabilización ya quedó hecha)
  const [solapa,     setSolapa]     = useState(() => localStorage.getItem("nb_correo_solapa") || "es");   // buzón visible
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
  // Pistas por fila (pago ya debitado, duplicado, motivos de revisión, fecha del mail): se calculan cuando cambian los
  // datos, no en cada tecla de edición (duplicado recorre todos los egresos por fila).
  const pistas = useMemo(() => new Map(visibles.map(r => [r.id, { pago: pagoPendiente(r), dup: duplicado(r), revisar: motivosRevisar(r.nota), fechaCorreo: metaFecha(r.nota) }])),
    [visibles, egresos, pendientesDebito]);   // eslint-disable-line react-hooks/exhaustive-deps
  const nombreCentro = id => (centros.find(c => c.id === id)?.nombre) || id || "(sin centro)";

  // fechaServicio = devengado (fin del período que factura); fechaFiscal = emisión de la factura (libro de IVA).
  const propuestaDe = (row) => ({ sociedad: row.sociedad || "", cuentaId: row.cuentaId || "", centro: row.cc || "",
    fechaServicio: row.fecha || "", fechaFiscal: row.fechaFiscal || row.fecha || "", nroComp: row.nroComp || "" });
  const ed = (row) => edits[row.id] || propuestaDe(row);
  // La primera edición de una fila parte de lo propuesto por el lector (antes arrancaba de {} y perdía sociedad,
  // cuenta, centro y fechas: los selectores quedaban en amarillo y Contabilizar no hacía nada).
  const setEd = (row, patch) => setEdits(prev => ({ ...prev, [row.id]: { ...(prev[row.id] || propuestaDe(row)), ...patch } }));

  // Líneas con las que se contabiliza un borrador. Si vino repartido en varios centros (el lector abre una línea por
  // sede cuando la factura las trae, ej. Scentair) van todas tal cual; si es una sola, el centro es el del selector.
  // Es la única fuente para el payload, el chequeo de "listo" y las sumas de la fila.
  const esMulti = row => arr(row.lineas).length > 1;
  const lineasDe = (row, e) => {
    if (esMulti(row)) return row.lineas.map(l => ({ cc: l.cc, subtotal: l.subtotal, ivaRate: l.ivaRate ?? 0, iva_monto: l.iva_monto || 0, total: l.total_linea }));
    const l = arr(row.lineas)[0] || {};
    return [{ cc: e.centro, subtotal: l.subtotal ?? row.total, ivaRate: l.ivaRate ?? 0, iva_monto: l.iva_monto || 0, total: row.total }];
  };
  const puedeContabilizar = (row, e) => !!(e.sociedad && e.cuentaId && lineasDe(row, e).every(l => l.cc));
  const payloadDe = (row, e) => ({
    sociedad: e.sociedad, fecha: e.fechaServicio || row.fecha || "", fechaFiscal: e.fechaFiscal || row.fechaFiscal || e.fechaServicio || row.fecha || "", vto: row.vto || "",
    proveedor: row.proveedor, proveedorId: row.proveedorId,
    cuenta: (cuentas.find(c => c.id === e.cuentaId)?.nombre) || e.cuentaId, cuentaId: e.cuentaId, moneda: row.moneda || "ARS",
    nroComp: e.nroComp || "", nota: row.nota || "",
    lineas: lineasDe(row, e).map(l => ({ cc: l.cc, subtotal: l.subtotal, ivaRate: l.ivaRate })),
  });

  // Tras escribir en Numbers, marcar el mail y recargar la bandeja no dependen entre sí: van en paralelo.
  const marcarYRecargar = (row, estado) => Promise.all([marcarEnGmail(row, estado), cargar()]);

  // "Contabilizar y responder": lo mismo que Contabilizar y, si salió bien, abre el modal del acuse de recibo con
  // destinatario (remitente real del mail) y texto precargados. No se manda nada hasta que una persona confirma.
  const contabilizar = async (row, { responder = false } = {}) => {
    const e = ed(row);
    if (!puedeContabilizar(row, e)) return;
    setBusy(row.id);
    try {
      await contabilizarBorrador(row.id, payloadDe(row, e));
      if (responder) setRespuesta(acuseDe(row, e));
      await marcarYRecargar(row, "contabilizada");
    }
    catch (err) { alert("Error al contabilizar: " + (err?.message || err)); }
    finally { setBusy(null); }
  };

  // Acuse de recibo precargado. Se responde desde la casilla del buzón (el script responde en el hilo).
  const [respuesta, setRespuesta] = useState(null);   // { proveedor, buzon, ref, para, texto, enviando }
  const acuseDe = (row, e) => {
    const bz = buzonDe(row.nota);
    const vto = row.vto ? `, con vencimiento el ${fmtDate(row.vto)}` : "";
    const texto = `Buenos días,\n\nConfirmamos la recepción de la factura nº ${e.nroComp || "(sin número)"} por ${fmtMoney(row.total, row.moneda || "EUR")}, que ha quedado registrada${vto}.\n\nUn saludo,\n${bz?.firma || "Administración · BIGG"}\n${bz?.mail || ""}`;
    return { proveedor: row.proveedor, buzon: bz, ref: metaRef(row.nota), para: meta(row.nota, "remitente"), texto, enviando: false };
  };
  const patchRespuesta = p => setRespuesta(r => (r ? { ...r, ...p } : r));
  const enviarRespuesta = async () => {
    const r = respuesta;
    if (!r || r.enviando) return;
    setRespuesta({ ...r, enviando: true });
    try { await responderCorreo({ buzon: r.buzon.id, ref: r.ref, para: r.para.trim(), texto: r.texto }); setRespuesta(null); }
    catch (err) { setRespuesta({ ...r, enviando: false }); alert("No se pudo enviar la respuesta: " + (err?.message || err)); }
  };

  const ignorar = async (row) => {
    if (!(await confirm(`¿Ignorar la factura de ${row.proveedor} ($${Math.round(row.total)})? No se contabiliza.`))) return;
    setBusy(row.id);
    try { await ignorarBorrador(row.id, "correo"); await marcarYRecargar(row, "ignorada"); }
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
    setEditar(null);
    await marcarYRecargar(editar, "contabilizada");
  };

  const thS = { padding:"10px 12px", fontSize:11, fontWeight:800, color:"rgba(255,255,255,.9)",
    textAlign:"left", letterSpacing:".04em", textTransform:"uppercase", whiteSpace:"nowrap" };
  // borde sin shorthand: los selectores de sociedad/centro pisan borderColor y React avisa si se mezcla con `border`
  const sel = { background:"#fff", borderWidth:1, borderStyle:"solid", borderColor:T.cardBorder, borderRadius:6, padding:"5px 7px",
    fontSize:12, color:T.text, fontFamily:T.font, outline:"none", maxWidth:150 };
  const selFalta = ok => (ok ? sel : { ...sel, borderColor:"#f59e0b", background:"#fffbeb" });   // ámbar = falta elegir
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

  return (
    <div className="fade" style={{ padding:"28px 32px" }}>
      {confirmUI}

      {/* Acuse de recibo tras "Contabilizar y responder": destinatario y texto editables; se manda desde la casilla. */}
      {respuesta && (() => {
        const enviando = respuesta.enviando;
        const campo = { ...sel, width:"100%", maxWidth:"none", boxSizing:"border-box" };
        return (
          <div onClick={() => !enviando && setRespuesta(null)}
            style={{ position:"fixed", inset:0, zIndex:700, background:"rgba(0,0,0,.35)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
            <div onClick={ev => ev.stopPropagation()}
              style={{ background:T.card, borderRadius:12, width:"min(600px, 100%)", boxShadow:"0 16px 48px rgba(0,0,0,.25)", padding:"20px 22px", fontFamily:T.font }}>
              <div style={{ fontSize:15, fontWeight:800, color:T.text, marginBottom:2 }}>Responder al proveedor</div>
              <div style={{ fontSize:12, color:T.muted, marginBottom:14 }}>
                {respuesta.proveedor} · ya contabilizada. El acuse sale desde {respuesta.buzon?.mail} como respuesta al hilo del mail.
              </div>
              <Label>Para</Label>
              <input value={respuesta.para} onChange={ev => patchRespuesta({ para: ev.target.value })} disabled={enviando} style={{ ...campo, marginBottom:12 }} />
              <Label>Mensaje</Label>
              <textarea value={respuesta.texto} onChange={ev => patchRespuesta({ texto: ev.target.value })} disabled={enviando} rows={9}
                style={{ ...campo, resize:"vertical", lineHeight:1.45, fontSize:13 }} />
              <div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginTop:14 }}>
                <button onClick={() => setRespuesta(null)} disabled={enviando}
                  style={{ background:"#f3f4f6", color:T.text, border:`1px solid ${T.cardBorder}`, borderRadius:8, padding:"9px 14px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:T.font }}>
                  No responder
                </button>
                <button onClick={enviarRespuesta} disabled={enviando || !respuesta.para.trim() || !respuesta.texto.trim()}
                  style={{ background:T.accentDark, color:T.accent, border:"none", borderRadius:8, padding:"9px 16px", fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:T.font, opacity: enviando ? .7 : 1 }}>
                  {enviando ? "Enviando…" : "✉ Enviar"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Visor de PDF: panel flotante a la derecha, la bandeja sigue visible y editable al lado. */}
      {pdf && (
        <div style={{ position:"fixed", top:0, right:0, bottom:0, left:T.sidebarW, zIndex:600, background:T.card,
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
          {/* #navpanes=0: sin la columna de miniaturas; view=FitH: la hoja ajustada al ancho (parámetros del visor de Chrome) */}
          {pdf.url && <iframe title={pdf.nombre} src={`${pdf.url}#navpanes=0&view=FitH`} style={{ flex:1, border:"none", width:"100%" }} />}
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
                const enCurso = busy === row.id;
                const { pago, dup, revisar, fechaCorreo } = pistas.get(row.id) || {};
                const multi = esMulti(row);
                const mon = row.moneda || "ARS";
                const lineas = lineasDe(row, e);
                const subRow = lineas.reduce((a, l) => a + (toNum(l.subtotal) || 0), 0);
                const ivaRow = lineas.reduce((a, l) => a + (toNum(l.iva_monto) || 0), 0);
                const listo = puedeContabilizar(row, e);
                const ref = metaRef(row.nota); const buzon = metaBuzon(row.nota);
                // Vto: si el pago ya se debitó en el banco, mostramos esa fecha; si no, la de la factura.
                const vtoMostrar = pago ? pago.fecha : row.vto;
                return (
                  <tr key={row.id} style={{ borderBottom:`1px solid ${T.cardBorder}`, background: i%2===0 ? T.card : "#fafbfc" }}>
                    <td style={{ padding:"9px 12px", fontSize:12, color:T.muted, whiteSpace:"nowrap" }}>{fechaCorreo ? fmtDate(fechaCorreo) : "—"}</td>
                    <td style={{ padding:"9px 12px", whiteSpace:"nowrap" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, fontWeight:700, color:T.text }}>
                        <span>{row.proveedor || "—"}</span>
                        {pago && <span style={{ fontSize:13, cursor:"help" }} title={`Pago ya realizado — falta matchearlo contra esta factura.\nDébito en Banco: ${pago.cuenta_bancaria} · ${fmtDate(pago.fecha)} · ${fmtMoney(Math.abs(toNum(pago.monto)), mon)}`}>💳</span>}
                        {dup?.nivel === "dup" && <span style={{ fontSize:13, cursor:"help" }} title={`YA CARGADA: existe un egreso con el mismo número.\n${descEgreso(dup.egreso)}`}>⛔</span>}
                        {dup?.nivel === "mes" && <span style={{ fontSize:13, cursor:"help" }} title={`Mismo importe y mismo mes que un egreso ya cargado, con otro número: revisá.\n${descEgreso(dup.egreso)}`}>⚠️</span>}
                        {revisar && <span style={{ fontSize:13, cursor:"help" }} title={`El lector no está seguro de esta factura:\n${revisar}\nAbrí el PDF y revisá antes de contabilizar.`}>🔎</span>}
                      </div>
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      {/* Máscara AFIP (FC-A 00001-00001234) sólo para Argentina; en España el nº es libre (FAC-2026-175, 26/219518). */}
                      <input value={e.nroComp} onChange={ev => setEd(row, { nroComp: solapa === "ar" ? formatNroComp(ev.target.value) : ev.target.value })}
                        placeholder="" style={{ ...sel, maxWidth:130 }} />
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      <select value={e.sociedad} onChange={ev => setEd(row, { sociedad: ev.target.value })} style={selFalta(e.sociedad)}>
                        <option value="">⚠ Falta sociedad</option>
                        {sociedades.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                      </select>
                    </td>
                    <td style={{ padding:"9px 12px" }} title="Fecha de emisión de la factura (fecha fiscal: libro de IVA)">
                      <input type="date" value={e.fechaFiscal} onChange={ev => setEd(row, { fechaFiscal: ev.target.value })}
                        style={{ ...sel, maxWidth:140 }} />
                    </td>
                    <td style={{ padding:"9px 12px" }} title="Fecha del servicio (devengado: fin del período facturado)">
                      <input type="date" value={e.fechaServicio} onChange={ev => setEd(row, { fechaServicio: ev.target.value })}
                        style={{ ...sel, maxWidth:140 }} />
                    </td>
                    <td style={{ padding:"9px 12px", fontSize:12, color: pago ? "#059669" : T.muted, whiteSpace:"nowrap", fontWeight: pago ? 700 : 400 }}
                      title={pago ? "Fecha del pago ya debitado en el banco" : "Vencimiento de la factura"}>
                      {vtoMostrar ? fmtDate(vtoMostrar) : "—"}
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      <select value={e.cuentaId} onChange={ev => setEd(row, { cuentaId: ev.target.value })} style={sel}>
                        <option value="">— cuenta —</option>
                        {cuentasEgreso.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      {multi ? (
                        <span style={{ fontSize:12, color:T.text, cursor:"help", whiteSpace:"nowrap" }}
                          title={`La factura ya viene repartida en ${lineas.length} centros:\n${lineas.map(l => `${nombreCentro(l.cc)} · ${fmtMoney(l.total, mon)}`).join("\n")}\nPara cambiar el reparto: Abrir para editar.`}>
                          Varios ({lineas.length}) ▾
                        </span>
                      ) : (
                        <select value={e.centro} onChange={ev => setEd(row, { centro: ev.target.value })} style={selFalta(e.centro)}>
                          <option value="">⚠ centro</option>
                          {ccActivos(centros, e.centro).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                      )}
                    </td>
                    <td style={num(false)}>{fmtMoney(subRow, mon)}</td>
                    <td style={{ ...num(false), color:T.muted }}>{ivaRow > 0 ? fmtMoney(ivaRow, mon) : "—"}</td>
                    <td style={num(true)}>{fmtMoney(row.total, mon)}</td>
                    <td style={{ padding:"9px 10px", whiteSpace:"nowrap", textAlign:"right" }}>
                      {/* Menú de acciones compartido (se abre hacia arriba solo si abajo no entra). */}
                      <RowMenu align="right" label={enCurso ? "…" : "⋯"} disabled={enCurso} items={[
                        { label: "Contabilizar ✓", onClick: () => contabilizar(row), color: "#16a34a", disabled: !listo, hint: listo ? "" : "Falta sociedad, cuenta o centro" },
                        buzon && ref && { label: "Contabilizar y responder ✓ ✉", onClick: () => contabilizar(row, { responder: true }), color: "#16a34a", disabled: !listo, hint: listo ? "" : "Falta sociedad, cuenta o centro" },
                        { label: "Abrir para editar (varios centros)", onClick: () => setEditar(row) },
                        buzon && metaArchivo(row.nota) && { label: "Ver PDF", onClick: () => verPdf(row) },
                        ref && { label: "Ver mail", onClick: () => window.open(gmailUrl(ref, buzon), "_blank") },
                        "divider",
                        { label: "Ignorar", onClick: () => ignorar(row), color: T.red },
                      ]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      ))}
    </div>
  );
}
