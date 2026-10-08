// Reportes › Pagos y cobros en detalle — TODO lo que pasó por cada caja/banco, con la factura aplicada.
//
// Por qué existe: el estudio contable recibe el extracto del banco y no sabe contra qué factura va cada
// línea; de ahí su cuenta de "partidas pendientes de aplicación". Numbers sí tiene el vínculo, y este
// reporte es el único lugar donde se ve y se baja.
//
// Alcance: el movimiento de caja COMPLETO, con filtro de Tipo. Un reporte de solo pagos y cobros cubriría
// una fracción de las líneas y NO conciliaría contra el banco — los cobros directos, los gastos contados y
// las transferencias también son plata que pasó por la cuenta, solo que no nacen de una factura.
//
// Regla que no se rompe: UNA FILA POR MOVIMIENTO. No se parte aunque por dentro toque varios centros. Por
// eso acá NO hay filtro ni columna de centro de costo (además de que es dato de management, no del estudio):
// el centro se imputa por línea de factura y un mismo pago puede aplicar a varias. La cuenta contable sí,
// porque es del encabezado del comprobante → una sola por factura.
//
// La tarjeta de crédito (PAGO_TARJETA) sale marcada como tipo "Tarjeta" y sin cuenta: el resumen se manda
// aparte y crudo, así que el reporte no intenta explicar qué había adentro.
import { useState, useMemo, useEffect, useRef } from "react";
import { T } from "../theme";
import { MONEDA_SYM } from "../../data/tesoreriaData";
import { fetchProveedores, fetchClientes, esIgnorado, esExtractoSinConciliar, esIntercoParkAbierta } from "../../lib/numbersApi";
import { fmtN, fmtSigned, selStyle, MultiSelect, DATE_PRESETS, rangoDePreset } from "./reportesUi";
import { PNL_INICIO, fechaFiscalDe } from "./pnlDerive";
import { exportarPagosCobrosExcel } from "./exportPagosCobros";
import { armarMaestroContrapartes } from "./contrapartes";

// Movimientos que SON plata moviéndose por una caja. Quedan afuera los asientos que viven en nb_movimientos
// sin ser caja (retenciones sufridas, interusos de gestión): no tienen cuenta bancaria y meterlos rompería
// el cruce contra el extracto.
const TIPO_LABEL = {
  PAGO: "Pago", COBRO: "Cobro", INGRESO: "Ingreso", EGRESO: "Egreso",
  // "Pagos sin factura" y no "Gasto contado" (vocabulario Contagram): el estudio de España separa el mundo
  // en factura (IVA deducible) y sin factura; "contado" además sugiere efectivo cuando salió por banco.
  EGRESO_GASTO: "Pagos sin factura", SUELDO: "Sueldo", TRANSFERENCIA: "Transferencia",
  PAGO_TARJETA: "Tarjeta", INTERCOMPANIA: "Interco", CAMBIO: "Cambio",
};
// Intercompañía: para el estudio es plata que salió o entró de la cuenta contra otra sociedad del grupo,
// y la contraparte ya dice cuál. El estado interno del circuito (parkeada = INTERCOMPANIA, emparejada =
// EGRESO/INGRESO) hacía que la misma transferencia a Bigg Fit LLC saliera "Interco" o "Egreso" según si el
// otro lado ya había declarado su pata (Martín, 7/10/2026). Se etiqueta por sentido de la caja.
const esInterco = m => /^interco/.test(String(m.origen || ""));
// "Sin conciliar" = la línea del banco todavía no fue aceptada por nadie: (a) extracto sin documento_id, que
// conserva el tipo crudo del parser (EGRESO/INGRESO) y la cuenta que PROPUSO la regla sin que nadie la haya
// confirmado; (b) interco parkeada a la que el otro lado aún no le declaró su pata. Los dos predicados los
// define numbersApi (es quien escribe esos estados). Sin esta etiqueta el estudio las leía como pagos hechos.
const esSinConciliar = m => esExtractoSinConciliar(m) || esIntercoParkAbierta(m);
const tipoDeMov = (m, sinConciliar) => {
  if (sinConciliar) return "Sin conciliar";
  if (esInterco(m)) return Number(m.monto) < 0 ? "Pago" : "Cobro";
  return TIPO_LABEL[String(m.tipo || "").toUpperCase()] || m.tipo || "—";
};

const fmtF = iso => String(iso || "").split("-").reverse().join("/");

// `franquicias`: el maestro de Franquicias (razón social, NIF, domicilio), que PantallaReportes ya tiene cargado;
// los cobros que vienen de ahí llevan el id numérico de la franquicia en contraparte_id.
export default function TabDetallePagosCobros({ movs = [], comps = [], cuentasBancarias = [], sociedades = [], franquicias = [] }) {
  const socMap = useMemo(() => new Map(sociedades.map(s => [String(s.id), s.nombre])), [sociedades]);
  const cbMap  = useMemo(() => new Map(cuentasBancarias.map(c => [String(c.id), c.nombre])), [cuentasBancarias]);

  // Comprobante (por id_comp) → lo que el estudio necesita del lado del devengado. `comps` son LÍNEAS, así
  // que el total se acumula y el resto se toma de la primera (cuenta y contraparte son del encabezado).
  const compMap = useMemo(() => {
    const m = new Map();
    for (const r of comps) {
      const k = String(r.id_comp || "");
      if (!k) continue;
      let e = m.get(k);
      if (!e) {
        e = { nroComp: r.nro_comp || "", fechaFiscal: fechaFiscalDe(r) || "",
              cuenta: r.cuenta_contable || "", cpId: r.contraparte_id || "",
              cpNombre: r.contraparte_nombre || "", total: 0 };
        m.set(k, e);
      }
      e.total += Math.abs(Number(r.total) || 0);
    }
    return m;
  }, [comps]);

  // Universo: movimientos de caja desde el go-live, sin los ignorados (que son tumbas de deduplicación) y
  // sin los que no pasaron por ninguna caja (retenciones sufridas, origen="retencion": tipo COBRO con
  // cuenta_bancaria vacía). Sin esta condición entraban como "Cobro" sin caja y sumaban al neto, que dejaba
  // de ser la variación de caja del período (Revolut, 7/10/2026: 4 × 171 € de IRPF sobre alquiler).
  const base = useMemo(() => (movs || [])
    .filter(m => String(m.fecha || "") >= PNL_INICIO && !esIgnorado(m) && m.cuenta_bancaria)
    .map(m => {
      const c = m.documento_id ? compMap.get(String(m.documento_id)) : null;
      const sinConc = esSinConciliar(m);
      return {
        ...m,
        _tipo:    tipoDeMov(m, sinConc),
        _caja:    cbMap.get(String(m.cuenta_bancaria)) || m.cuenta_bancaria || "",
        _contra:  m.contraparte_nombre || c?.cpNombre || m.legajo_nombre || "",
        _cpId:    m.contraparte_id || c?.cpId || "",
        _nroComp: c?.nroComp || "",
        _fFiscal: c?.fechaFiscal || "",
        // La cuenta contable sale del comprobante aplicado; si el movimiento la trae propia (gasto contado
        // imputado en la conciliación) se usa esa. La tarjeta queda vacía a propósito, y una línea sin
        // conciliar también: lo que trae es la propuesta de la regla, no una imputación.
        _cuenta:  sinConc ? "" : (c?.cuenta || m.cuenta_contable || ""),
        _totalFc: c?.total ?? null,
      };
    }), [movs, compMap, cbMap]);

  // Estado del comprobante aplicado: Total si lo pagado cubre la factura, Parcial si no. Vacío cuando el
  // movimiento no aplica a ninguna (no hay nada que estar pagando del todo o a medias).
  const estadoDe = useMemo(() => {
    const pagado = {};
    for (const m of (movs || [])) {
      if (!m.documento_id || esIgnorado(m)) continue;
      const t = String(m.tipo || "").toUpperCase();
      if (t !== "PAGO" && t !== "COBRO") continue;
      const k = String(m.documento_id);
      pagado[k] = (pagado[k] || 0) + Math.abs(Number(m.monto) || 0);
    }
    return r => {
      if (!r.documento_id || r._totalFc == null) return "";
      return (r._totalFc - (pagado[String(r.documento_id)] || 0)) <= 0.5 ? "Total" : "Parcial";
    };
  }, [movs]);

  const [q, setQ]             = useState("");
  const [fSoc, setFSoc]       = useState(new Set());
  const [fCaja, setFCaja]     = useState(new Set());
  const [fCta, setFCta]       = useState(new Set());
  const [fMon, setFMon]       = useState(new Set());
  const [fTipo, setFTipo]     = useState(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [bajando, setBajando]   = useState(false);
  const menuRef = useRef(null);
  const [preset, setPreset] = useState("anio");
  const [dDesde, setDDesde] = useState("");
  const [dHasta, setDHasta] = useState("");
  const { desde, hasta } = rangoDePreset(preset, dDesde, dHasta);

  // Opciones de filtro, siempre de los datos presentes (no de listas fijas): si mañana aparece un tipo de
  // movimiento nuevo, sale solo en el filtro.
  const socOpts  = useMemo(() => [...new Set(base.map(r => String(r.sociedad)).filter(Boolean))].sort().map(s => ({ value: s, label: socMap.get(s) || s })), [base, socMap]);
  const cajaOpts = useMemo(() => [...new Set(base.map(r => String(r.cuenta_bancaria || "")))].sort()
    .map(id => ({ value: id, label: id ? (cbMap.get(id) || id) : "(sin cuenta)" })), [base, cbMap]);
  const ctaOpts  = useMemo(() => [...new Set(base.map(r => r._cuenta).filter(Boolean))].sort().map(c => ({ value: c, label: c })), [base]);
  const monOpts  = useMemo(() => [...new Set(base.map(r => r.moneda || "ARS"))].sort().map(m => ({ value: m, label: m })), [base]);
  const tipoOpts = useMemo(() => [...new Set(base.map(r => r._tipo))].sort().map(t => ({ value: t, label: t })), [base]);

  const inSet = (set, v) => set.size === 0 || set.has(v);
  const filt = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return base.filter(r => {
      const f = String(r.fecha || "");
      if (desde && f < desde) return false;
      if (hasta && f > hasta) return false;
      if (!inSet(fSoc, String(r.sociedad))) return false;
      if (!inSet(fCaja, String(r.cuenta_bancaria || ""))) return false;
      if (!inSet(fCta, r._cuenta)) return false;
      if (!inSet(fMon, r.moneda || "ARS")) return false;
      if (!inSet(fTipo, r._tipo)) return false;
      if (qq) {
        const hay = [r._contra, r.concepto, r._nroComp, r.documento_id, r._cuenta].map(x => String(x || "").toLowerCase()).join(" ");
        if (!hay.includes(qq)) return false;
      }
      return true;
    }).sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
  }, [base, q, fSoc, fCaja, fCta, fMon, fTipo, desde, hasta]);

  // Neto CON signo por moneda: es la variación de caja del período, así se cruza contra el saldo.
  const porMon = useMemo(() => {
    const m = {};
    for (const r of filt) { const k = r.moneda || "ARS"; m[k] = (m[k] || 0) + (Number(r.monto) || 0); }
    return m;
  }, [filt]);

  // "Con factura aplicada" = el documento_id resolvió contra un comprobante REAL. No alcanza con que el
  // campo tenga algo: los gastos contados y las conciliaciones llevan un documento_id propio ("CONTAB-…")
  // que no es una factura, y contarlos daría casi el total de las líneas.
  const conFactura = useMemo(() => filt.filter(r => r._totalFc != null).length, [filt]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);

  // El cód. de estudio, el NIF y el domicilio NO viven en el movimiento sino en el maestro de proveedores/
  // clientes (y en el de Franquicias): se resuelven por contraparte, y los maestros de Numbers se piden recién
  // acá, para no sumarle otra llamada a la carga.
  const bajarExcel = async () => {
    setMenuOpen(false);
    setBajando(true);
    try {
      const [proveedores, clientes] = await Promise.all([fetchProveedores(), fetchClientes()]);
      const maestro = armarMaestroContrapartes({ proveedores, clientes, franquicias });
      const deMaestro = r => maestro(r._cpId, r._contra);
      await exportarPagosCobrosExcel({
        rows: filt, totales: porMon, rango: { desde, hasta },
        campo: {
          sociedad:       r => socMap.get(String(r.sociedad)) || r.sociedad || "",
          cuentaBancaria: r => r._caja,
          tipo:           r => r._tipo,
          // Razón social del maestro cuando la contraparte está identificada; si no, lo que dice el banco.
          contraparte:    r => deMaestro(r)?.nombre || r._contra,
          cuit:           r => deMaestro(r)?.cuit ?? "",
          codEstudio:     r => deMaestro(r)?.cod ?? "",
          domicilio:      r => deMaestro(r)?.domicilio ?? "",
          nroComp:        r => r._nroComp,
          idComp:         r => r._totalFc != null ? (r.documento_id || "") : "",
          fechaFiscal:    r => r._fFiscal,
          cuentaContable: r => r._cuenta,
          totalFactura:   r => r._totalFc,
          estado:         estadoDe,
        },
      });
    } catch (e) {
      alert("No se pudo generar el Excel: " + (e?.message || e));
    } finally {
      setBajando(false);
    }
  };

  const lbl = { display: "block", fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 };
  const td  = { padding: "8px 12px", fontSize: 13, borderBottom: `1px solid ${T.cardBorder}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  const th  = { padding: "9px 12px", fontSize: 10, fontWeight: 800, color: T.tableHeadText, textTransform: "uppercase", letterSpacing: ".06em", background: T.tableHead, position: "sticky", top: 0, textAlign: "left", whiteSpace: "nowrap" };
  const kpi = { background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, padding: "12px 18px", boxShadow: "0 1px 3px rgba(0,0,0,.04)" };
  const kpiLbl = { fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em" };

  return (
    <div className="fade">
      {/* Filtros */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", background: T.card,
        border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, padding: "12px 16px", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
        <div style={{ flex: "1 1 200px", minWidth: 170 }}>
          <label style={lbl}>Buscar</label>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Contraparte, concepto, N° comp…"
            style={{ ...selStyle, width: "100%", cursor: "text" }} />
        </div>
        <div>
          <label style={lbl}>Fecha</label>
          <select value={preset} onChange={e => setPreset(e.target.value)} style={selStyle}>
            {DATE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        {preset === "rango" && (
          <>
            <div><label style={lbl}>Desde</label>
              <input type="date" value={dDesde} onChange={e => setDDesde(e.target.value)} style={{ ...selStyle, cursor: "pointer" }} /></div>
            <div><label style={lbl}>Hasta</label>
              <input type="date" value={dHasta} onChange={e => setDHasta(e.target.value)} style={{ ...selStyle, cursor: "pointer" }} /></div>
          </>
        )}
        <MultiSelect label="Tipo" options={tipoOpts} selected={fTipo} onChange={setFTipo} allLabel="Todos" width={170} />
        <MultiSelect label="Sociedad" options={socOpts} selected={fSoc} onChange={setFSoc} allLabel="Todas" />
        <MultiSelect label="Cuenta bancaria" options={cajaOpts} selected={fCaja} onChange={setFCaja} searchable allLabel="Todas" width={220} />
        <MultiSelect label="Cuenta contable" options={ctaOpts} selected={fCta} onChange={setFCta} searchable allLabel="Todas" width={220} />
        <MultiSelect label="Moneda" options={monOpts} selected={fMon} onChange={setFMon} allLabel="Todas" width={120} />

        {/* Menú ⋮ (Bajar a Excel) */}
        <div ref={menuRef} style={{ marginLeft: "auto", position: "relative" }}>
          <button type="button" onClick={() => setMenuOpen(o => !o)} title="Opciones" aria-haspopup="menu" aria-expanded={menuOpen}
            style={{ border: `1px solid ${T.cardBorder}`, borderRadius: 8, background: menuOpen ? "#eceff3" : "#fff",
              width: 34, height: 34, cursor: "pointer", fontSize: 18, color: T.muted, lineHeight: 1,
              display: "inline-flex", alignItems: "center", justifyContent: "center" }}>⋮</button>
          {menuOpen && (
            <div role="menu" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, minWidth: 280, background: T.card,
              border: `1px solid ${T.cardBorder}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.12)", padding: 6, zIndex: 30 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: T.muted, textTransform: "uppercase",
                letterSpacing: ".08em", padding: "6px 11px 4px" }}>Bajar a Excel</div>
              <button type="button" role="menuitem" onClick={bajarExcel} disabled={filt.length === 0 || bajando}
                style={{ display: "flex", alignItems: "flex-start", gap: 9, width: "100%", textAlign: "left", background: "transparent",
                  border: "none", borderRadius: 7, padding: "8px 11px", fontFamily: T.font,
                  color: (filt.length === 0 || bajando) ? T.dim : T.text, cursor: (filt.length === 0 || bajando) ? "not-allowed" : "pointer" }}
                onMouseEnter={e => { if (filt.length && !bajando) e.currentTarget.style.background = "#eceff3"; }}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span aria-hidden style={{ fontSize: 15, lineHeight: 1.3 }}>⬇️</span>
                <span>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{bajando ? "Generando…" : "Movimientos con su factura"}</span>
                  <span style={{ display: "block", fontSize: 11, color: T.muted, marginTop: 1 }}>
                    Para el estudio: suma CUIT, cód. de estudio, fecha fiscal y saldo del extracto
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={kpi}>
          <div style={kpiLbl}>Movimientos</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: T.text, fontFamily: T.mono }}>{filt.length}</div>
        </div>
        <div style={kpi}>
          <div style={kpiLbl}>Con factura aplicada</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: T.text, fontFamily: T.mono }}>{conFactura}</div>
        </div>
        {Object.entries(porMon).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([mo, tot]) => (
          <div key={mo} style={kpi}>
            <div style={kpiLbl}>Neto {mo}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: tot < 0 ? T.red : T.green, fontFamily: T.mono }}>
              {MONEDA_SYM[mo] ?? mo} {fmtSigned(tot)}
            </div>
          </div>
        ))}
      </div>

      {/* Tabla */}
      <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflow: "auto", maxHeight: "60vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: 1180 }}>
          <colgroup>
            <col style={{ width: 90 }} /><col style={{ width: 130 }} /><col style={{ width: 110 }} />
            <col style={{ width: 190 }} /><col style={{ width: 210 }} /><col style={{ width: 150 }} />
            <col style={{ width: 170 }} /><col style={{ width: 130 }} />
          </colgroup>
          <thead><tr>
            <th style={th}>Fecha</th><th style={th}>Cuenta bancaria</th><th style={th}>Tipo</th>
            <th style={th}>Contraparte</th><th style={th}>Concepto</th><th style={th}>Factura aplicada</th>
            <th style={th}>Cuenta contable</th>
            <th style={{ ...th, textAlign: "right" }}>Importe</th>
          </tr></thead>
          <tbody>
            {filt.length === 0
              ? <tr><td colSpan={8} style={{ ...td, textAlign: "center", color: T.dim, padding: 32 }}>Sin resultados con esos filtros.</td></tr>
              : filt.map((r, i) => (
                <tr key={r.id ?? i} style={{ background: i % 2 ? "#fafbfc" : T.card }}>
                  <td style={{ ...td, color: T.muted }}>{fmtF(r.fecha)}</td>
                  <td style={{ ...td, color: T.text, fontSize: 12 }} title={r._caja}>{r._caja || "—"}</td>
                  <td style={{ ...td, fontSize: 12, color: T.muted }}>{r._tipo}</td>
                  <td style={{ ...td, color: T.text, fontWeight: 600 }} title={r._contra}>{r._contra || "—"}</td>
                  <td style={{ ...td, color: T.muted, fontSize: 12 }} title={r.concepto || ""}>{r.concepto || "—"}</td>
                  {/* Solo si resolvió contra un comprobante real. Si la factura no tiene N° (aperturas), se
                      muestra su id. Un documento_id que no es factura NO se muestra: sería ruido. */}
                  <td style={{ ...td, color: r._totalFc != null ? T.text : T.dim, fontSize: 12 }} title={r.documento_id || ""}>
                    {r._totalFc != null ? (r._nroComp || r.documento_id) : "—"}
                  </td>
                  <td style={{ ...td, color: T.text, fontSize: 12 }} title={r._cuenta}>{r._cuenta || "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: T.mono, fontWeight: 700, color: (Number(r.monto) || 0) < 0 ? T.red : T.green }}>
                    {MONEDA_SYM[r.moneda || "ARS"] ?? (r.moneda || "ARS")} {fmtN(Math.abs(Number(r.monto) || 0))}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
