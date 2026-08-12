import { useState, useEffect, useMemo, useRef } from "react";
import {
  fetchSociedades, fetchProveedores, fetchCuentas, fetchCentrosCosto,
  appendCargaSocial, fetchCargasSociales,
} from "../lib/numbersApi";
import { baseHaberesPorCentro, fmtMiles, limpiarMonto } from "../lib/sueldosApi";

const T = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#1e293b",
  muted: "#64748b", dim: "#94a3b8", blue: "#2563eb", red: "#dc2626",
  green: "#16a34a", amber: "#b45309", font: "'Inter', system-ui, sans-serif",
};

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const fmtFecha = (s) => { const m = String(s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || ""); };
const fmtMoney = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
const fmtMoney2 = (n) => "$" + (Number(n) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const hoy     = new Date();
const MES_DEF = hoy.getMonth() === 0 ? 12 : hoy.getMonth();
const ANO_DEF = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();

export default function PantallaCargasSociales({ mes: mesProp, anio: anioProp, pais = "" }) {
  const [mes,  setMes]  = useState(mesProp  ?? MES_DEF);
  const [anio, setAnio] = useState(anioProp ?? ANO_DEF);
  const [cargas,  setCargas]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [masters, setMasters] = useState({ soc: [], prov: [], ctas: [], ccs: [] });

  useEffect(() => { (async () => {
    const [soc, prov, ctas, ccs] = await Promise.all([
      fetchSociedades().catch(() => []), fetchProveedores().catch(() => []),
      fetchCuentas().catch(() => []),    fetchCentrosCosto().catch(() => []),
    ]);
    setMasters({ soc, prov, ctas, ccs });
  })(); }, []);

  useEffect(() => { load(); }, [mes, anio]);
  async function load() { setLoading(true); try { setCargas(await fetchCargasSociales(mes, anio)); } finally { setLoading(false); } }

  const ccNombre = useMemo(() => { const m = new Map(masters.ccs.map(c => [String(c.id).toLowerCase(), c.nombre])); return id => m.get(String(id).toLowerCase()) || id || "(sin centro)"; }, [masters.ccs]);
  const socNombre = useMemo(() => { const m = new Map(masters.soc.map(s => [String(s.id), s.nombre])); return id => m.get(String(id)) || id; }, [masters.soc]);

  const totalMes = cargas.reduce((s, c) => s + c.monto_total, 0);

  const selStyle = { border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: T.font };

  return (
    <div style={{ padding: 24, fontFamily: T.font, color: T.text, maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Cargas sociales</h2>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", alignItems: "center" }}>
          <select value={mes} onChange={e => setMes(Number(e.target.value))} style={selStyle}>
            {MESES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
          <input type="number" value={anio} onChange={e => setAnio(Number(e.target.value))} style={{ ...selStyle, width: 80 }} />
          <button onClick={() => setShowForm(true)} style={{ background: T.blue, color: "#fff", border: "none", borderRadius: 7, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            + Nueva carga
          </button>
        </div>
      </div>

      {cargas.length > 0 && (
        <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "12px 16px", marginBottom: 16, display: "flex", gap: 24, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: T.muted }}>Total del mes:</span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{fmtMoney(totalMes)}</span>
          <span style={{ fontSize: 13, color: T.muted, marginLeft: "auto" }}>{cargas.filter(c => c.pagado).length} de {cargas.length} pagadas</span>
        </div>
      )}

      {loading ? (
        <p style={{ color: T.muted, fontSize: 13 }}>Cargando…</p>
      ) : cargas.length === 0 ? (
        <div style={{ border: `1px dashed ${T.border}`, borderRadius: 8, padding: 40, textAlign: "center", color: T.muted, fontSize: 13 }}>
          No hay cargas sociales cargadas para {MESES[mes-1]} {anio}.<br />
          Cargá el F931 y el aporte sindical de cada sociedad con "+ Nueva carga".
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {cargas.map(c => <CargaCard key={c.id_comp} carga={c} socNombre={socNombre} />)}
        </div>
      )}

      {showForm && (
        <FormCargaSocial mes={mes} anio={anio} masters={masters} ccNombre={ccNombre}
          onClose={() => setShowForm(false)} onSaved={async () => { setShowForm(false); await load(); }} />
      )}
    </div>
  );
}

function CargaCard({ carga, socNombre }) {
  return (
    <div style={{ border: `1px solid ${carga.pagado ? "#bbf7d0" : T.border}`, borderRadius: 8, padding: 16, background: carga.pagado ? "#f0fdf4" : T.card }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{socNombre(carga.sociedad)}</span>
        <span style={{ fontSize: 12, color: T.muted }}>· {carga.proveedor}</span>
        <span style={{ fontSize: 11, color: T.dim }}>· {carga.cuenta}</span>
        {carga.pagado
          ? <span style={{ fontSize: 11, fontWeight: 600, color: T.green, background: "#dcfce7", padding: "2px 8px", borderRadius: 999 }}>✓ Pagado</span>
          : <span style={{ fontSize: 11, fontWeight: 600, color: "#92400e", background: "#fef3c7", padding: "2px 8px", borderRadius: 999 }}>CxP pendiente</span>}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{fmtMoney(carga.monto_total)}</div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: T.muted }}>
        {carga.vep && <span>VEP: <b style={{ color: T.text }}>{carga.vep}</b></span>}
        {carga.vto && <span>Vencimiento: {fmtFecha(carga.vto)}</span>}
      </div>
    </div>
  );
}

function FormCargaSocial({ mes, anio, masters, ccNombre, onClose, onSaved }) {
  const [sociedad, setSociedad]       = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [cuentaId, setCuentaId]       = useState(() => masters.ctas.find(c => /costos\s*salariales/i.test(c.nombre))?.id || "");
  const [monto, setMonto]             = useState("");
  const [vep, setVep]                 = useState("");
  const [vto, setVto]                 = useState("");
  const [base, setBase]               = useState(null);   // { porCentro, total }
  const [loadingBase, setLoadingBase] = useState(false);
  const [lineas, setLineas]           = useState([]);      // [{ cc, monto }]
  const [saving, setSaving]           = useState(false);
  const savingRef = useRef(false);
  const [addCC, setAddCC]             = useState("");

  // Al elegir sociedad → traer la base de haberes en blanco por centro (liquidaciones cerradas del mes).
  useEffect(() => {
    if (!sociedad) { setBase(null); return; }
    let live = true; setLoadingBase(true);
    baseHaberesPorCentro(sociedad, mes, anio)
      .then(b => { if (live) setBase(b); })
      .catch(() => { if (live) setBase({ porCentro: {}, total: 0 }); })
      .finally(() => { if (live) setLoadingBase(false); });
    return () => { live = false; };
  }, [sociedad, mes, anio]);

  const r2  = (n) => Math.round((Number(n) || 0) * 100) / 100;   // redondeo al centavo
  const tot = r2(parseFloat(monto) || 0);

  // Auto-prorrateo por regla de tres al CENTAVO; el último centro absorbe el resto para que la
  // suma dé EXACTA (dos decimales) al monto ingresado.
  useEffect(() => {
    if (!base || base.total <= 0 || tot <= 0) { setLineas([]); return; }
    const ccs = Object.keys(base.porCentro);
    let acc = 0;
    const arr = ccs.map((cc, i) => {
      const m = i === ccs.length - 1 ? r2(tot - acc) : r2(tot * base.porCentro[cc] / base.total);
      acc = r2(acc + m); return { cc, monto: m };
    });
    setLineas(arr);
  }, [base, tot]);   // eslint-disable-line react-hooks/exhaustive-deps

  const sumLineas = r2(lineas.reduce((s, l) => s + (Number(l.monto) || 0), 0));
  const cuadra = tot > 0 && Math.abs(sumLineas - tot) < 0.005;   // al centavo
  const ccsUsados = new Set(lineas.map(l => String(l.cc)));
  const ccsDisponibles = masters.ccs.filter(c => !ccsUsados.has(String(c.id)));

  // v llega ya limpio (limpiarMonto: dígitos + "." decimal). Se guarda el STRING para poder tipear
  // decimales sin que la coma se corte; se convierte a Number recién al sumar/guardar.
  const setLinMonto = (cc, v) => setLineas(ls => ls.map(l => l.cc === cc ? { ...l, monto: v } : l));
  const rmCentro    = (cc)   => setLineas(ls => ls.filter(l => l.cc !== cc));
  const agregar     = ()     => { if (!addCC || ccsUsados.has(addCC)) return; setLineas(ls => [...ls, { cc: addCC, monto: 0 }]); setAddCC(""); };
  // Fuerza el calce exacto: el último centro absorbe la diferencia contra el total (para ediciones a mano).
  const ajustarUltimo = () => setLineas(ls => {
    if (!ls.length) return ls;
    const otros = r2(ls.slice(0, -1).reduce((s, l) => s + (Number(l.monto) || 0), 0));
    return ls.map((l, i) => i === ls.length - 1 ? { ...l, monto: r2(tot - otros) } : l);
  });

  const handleSave = async () => {
    if (savingRef.current) return;
    const prov = masters.prov.find(p => String(p.id) === String(proveedorId));
    const cta  = masters.ctas.find(c => String(c.id) === String(cuentaId));
    if (!sociedad)     { alert("Elegí la sociedad."); return; }
    if (!proveedorId)  { alert("Elegí el proveedor (AFIP/ARCA, UTEDYC, …)."); return; }
    if (!cuentaId)     { alert("Elegí la cuenta contable."); return; }
    if (!(tot > 0))    { alert("Ingresá el monto total."); return; }
    if (!lineas.length){ alert("No hay distribución. Cargá la liquidación del mes o agregá centros a mano."); return; }
    if (!cuadra)       { alert(`La distribución (${fmtMoney(sumLineas)}) no cuadra con el total (${fmtMoney(tot)}).`); return; }
    savingRef.current = true; setSaving(true);
    try {
      await appendCargaSocial({
        sociedad, proveedorId, proveedor: prov?.nombre || "",
        cuenta: cta?.nombre || "", cuentaId, mes, anio, vep, vto,
        lineas: lineas.map(l => ({ cc: l.cc, subtotal: Number(l.monto) || 0 })),
        concepto: `${prov?.nombre || "Carga social"} ${MESES[mes-1]} ${anio}`,
      });
      await onSaved();
    } catch (e) { alert("Error: " + e.message); setSaving(false); }
    finally { savingRef.current = false; }
  };

  const inp = { border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: T.font, width: "100%", boxSizing: "border-box" };
  const lab = { fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 4, display: "block" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div style={{ background: T.card, borderRadius: 12, width: 560, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,.18)", fontFamily: T.font }}>
        <div style={{ padding: "24px 28px", overflowY: "auto", flex: 1, minHeight: 0 }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>Nueva carga social — {MESES[mes-1]} {anio}</h3>
        <p style={{ margin: "0 0 18px", fontSize: 12, color: T.muted }}>F931, aporte sindical u otra obligación. Se crea como CxP y se prorratea por los haberes en blanco de cada centro.</p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <label style={lab}>Sociedad</label>
            <select style={inp} value={sociedad} onChange={e => setSociedad(e.target.value)}>
              <option value="">Elegir…</option>
              {masters.soc.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div>
            <label style={lab}>Proveedor</label>
            <select style={inp} value={proveedorId} onChange={e => setProveedorId(e.target.value)}>
              <option value="">Elegir… (AFIP, UTEDYC, …)</option>
              {masters.prov.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div>
            <label style={lab}>Cuenta contable</label>
            <select style={inp} value={cuentaId} onChange={e => setCuentaId(e.target.value)}>
              <option value="">Elegir…</option>
              {masters.ctas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label style={lab}>Monto total (ARS)</label>
            <input style={inp} inputMode="decimal" value={fmtMiles(monto)} onChange={e => setMonto(limpiarMonto(e.target.value))} placeholder="0" />
          </div>
          <div>
            <label style={lab}>N° de VEP</label>
            <input style={inp} value={vep} onChange={e => setVep(e.target.value)} placeholder="El que pasa el estudio" />
          </div>
          <div>
            <label style={lab}>Vencimiento</label>
            <input style={inp} type="date" value={vto} onChange={e => setVto(e.target.value)} />
          </div>
        </div>

        {/* Distribución por centro */}
        <div style={{ marginTop: 20 }}>
          <label style={lab}>Distribución por centro (prorrateo por haberes en blanco)</label>
          {!sociedad ? (
            <div style={{ fontSize: 12, color: T.dim, padding: "8px 0" }}>Elegí una sociedad para calcular la distribución.</div>
          ) : loadingBase ? (
            <div style={{ fontSize: 12, color: T.dim, padding: "8px 0" }}>Buscando haberes del mes…</div>
          ) : base && base.total <= 0 ? (
            <div style={{ fontSize: 12, color: T.amber, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "8px 10px" }}>
              ⚠ No hay liquidación <b>cerrada</b> con haberes para esta sociedad en {MESES[mes-1]}. No hay base para prorratear —
              cerrá la liquidación del mes, o agregá los centros a mano abajo.
            </div>
          ) : null}

          {(lineas.length > 0 || (base && base.total > 0)) && (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 13 }}>
              <thead>
                <tr style={{ color: T.muted, fontSize: 11, textAlign: "left" }}>
                  <th style={{ padding: "4px 6px", fontWeight: 600 }}>Centro</th>
                  <th style={{ padding: "4px 6px", fontWeight: 600, textAlign: "right" }}>Haberes base</th>
                  <th style={{ padding: "4px 6px", fontWeight: 600, textAlign: "right" }}>%</th>
                  <th style={{ padding: "4px 6px", fontWeight: 600, textAlign: "right" }}>Monto</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lineas.map(l => {
                  const hb = base?.porCentro?.[l.cc] || 0;
                  const pct = base && base.total > 0 ? (hb / base.total * 100) : 0;
                  return (
                    <tr key={l.cc} style={{ borderTop: `1px solid ${T.border}` }}>
                      <td style={{ padding: "5px 6px" }}>{ccNombre(l.cc)}</td>
                      <td style={{ padding: "5px 6px", textAlign: "right", color: T.muted }}>{hb ? fmtMoney(hb) : "—"}</td>
                      <td style={{ padding: "5px 6px", textAlign: "right", color: T.muted }}>{hb ? pct.toFixed(1) + "%" : "—"}</td>
                      <td style={{ padding: "5px 6px", textAlign: "right" }}>
                        <input inputMode="decimal" value={fmtMiles(String(l.monto))} onChange={e => setLinMonto(l.cc, limpiarMonto(e.target.value))}
                          style={{ ...inp, width: 120, textAlign: "right", padding: "4px 8px" }} />
                      </td>
                      <td style={{ padding: "5px 6px", textAlign: "center" }}>
                        <button onClick={() => rmCentro(l.cc)} title="Quitar" style={{ background: "none", border: "none", color: T.dim, cursor: "pointer", fontSize: 15 }}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${T.border}`, fontWeight: 700 }}>
                  <td style={{ padding: "6px" }} colSpan={3}>Total distribuido</td>
                  <td style={{ padding: "6px", textAlign: "right", color: cuadra ? T.green : T.red }}>{fmtMoney2(sumLineas)}</td>
                  <td />
                </tr>
                {tot > 0 && !cuadra && (
                  <tr><td colSpan={5} style={{ padding: "2px 6px", textAlign: "right", fontSize: 11, color: T.red }}>
                    Debe sumar {fmtMoney2(tot)} (difieren {fmtMoney2(Math.abs(sumLineas - tot))})
                  </td></tr>
                )}
              </tfoot>
            </table>
          )}

          {tot > 0 && lineas.length > 0 && !cuadra && (
            <div style={{ marginTop: 8, textAlign: "right" }}>
              <button onClick={ajustarUltimo} style={{ border: `1px solid ${T.border}`, background: "#fffbeb", color: T.amber, borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                Ajustar diferencia al último centro
              </button>
            </div>
          )}

          {sociedad && !loadingBase && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
              <select value={addCC} onChange={e => setAddCC(e.target.value)} style={{ ...inp, width: "auto", flex: 1 }}>
                <option value="">Agregar centro a mano…</option>
                {ccsDisponibles.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <button onClick={agregar} disabled={!addCC} style={{ border: `1px solid ${T.border}`, background: T.card, borderRadius: 6, padding: "7px 12px", fontSize: 13, cursor: addCC ? "pointer" : "not-allowed", color: addCC ? T.text : T.dim }}>+ Agregar</button>
            </div>
          )}
        </div>

        </div>{/* /cuerpo scrolleable */}

        {/* Pie fijo: siempre visible aunque el cuerpo scrollee */}
        <div style={{ display: "flex", gap: 10, padding: "14px 28px", borderTop: `1px solid ${T.border}`, justifyContent: "flex-end", flexShrink: 0 }}>
          <button onClick={onClose} style={{ border: `1px solid ${T.border}`, background: T.card, borderRadius: 7, padding: "8px 16px", fontSize: 13, cursor: "pointer", fontFamily: T.font }}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || !cuadra} style={{ background: (saving || !cuadra) ? T.dim : T.blue, color: "#fff", border: "none", borderRadius: 7, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: (saving || !cuadra) ? "not-allowed" : "pointer", fontFamily: T.font }}>
            {saving ? "Creando…" : "Crear CxP"}
          </button>
        </div>
      </div>
    </div>
  );
}
