import { useState, useEffect, useMemo } from "react";
import { fetchLiquidaciones, fetchCategorias, fetchPagos, fetchLegajos, desglosarLiquidacion, ROLES_SEDES, ROLES_HQ } from "../lib/sueldosApi";

const T = {
  bg:     "#f8fafc",
  card:   "#ffffff",
  border: "#e2e8f0",
  text:   "#1e293b",
  muted:  "#64748b",
  dim:    "#94a3b8",
  blue:   "#2563eb",
  red:    "#dc2626",
  green:  "#16a34a",
  head:   "#f1f5f9",
  font:   "'Inter', system-ui, sans-serif",
};

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const hoy     = new Date();
const MES_DEF = hoy.getMonth() === 0 ? 12 : hoy.getMonth();
const ANO_DEF = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();

const ROL_LABEL = {
  COACH_SENIOR: "Coach Senior", COACH: "Coach", BOTANICO: "Botánico", YOGA: "Yoga",
  ENCARGADO: "Encargado", VENTAS: "Ventas", LIMPIEZA: "Limpieza",
  HQ: "HQ", HQ_OWNER: "HQ Owner", HQ_EXT: "HQ Externo",
};

const FP_LABEL = {
  haberes: "Haberes", deposito: "Depósito",
  transferencia_financiera: "Transferencia financiera",
  monotributo: "Monotributo", efectivo: "Efectivo",
};

// Orden de las formas en el listado de pagos (haberes siempre primero).
const FP_ORDEN = ["haberes", "deposito", "monotributo", "transferencia_financiera", "efectivo"];
const ordenForma = (tipo) => {
  const i = FP_ORDEN.indexOf(tipo);
  return i === -1 ? FP_ORDEN.length : i;
};

const fmt = (n) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-AR");
const fmtNum = (n) => (Number(n) || 0).toLocaleString("es-AR");
const fmtFecha = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d) ? s : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

export default function PantallaResumen({ pais = "AR" }) {
  const [vista, setVista] = useState("sedes");   // "sedes" | "hq"
  const [mes,  setMes]  = useState(MES_DEF);
  const [anio, setAnio] = useState(ANO_DEF);
  const [liqs, setLiqs] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [legajos, setLegajos] = useState([]);
  const [selId, setSelId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const [ls, cats, pgs, lgs] = await Promise.all([
          fetchLiquidaciones(mes, anio).catch(() => []),
          fetchCategorias(mes, anio, pais).catch(() => []),
          fetchPagos(mes, anio).catch(() => []),
          fetchLegajos().catch(() => []),
        ]);
        if (cancel) return;
        setLiqs(Array.isArray(ls) ? ls : []);
        setCategorias(Array.isArray(cats) ? cats : []);
        setPagos(Array.isArray(pgs) ? pgs : []);
        setLegajos(Array.isArray(lgs) ? lgs : []);
      } finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [mes, anio, pais]);

  // Agrupar por empleado según la vista (los coaches de Sedes tienen una fila por sede).
  const empleados = useMemo(() => {
    const roles = vista === "hq" ? ROLES_HQ : ROLES_SEDES;
    const map = new Map();
    for (const l of liqs) {
      if (!roles.includes(l.rol)) continue;
      if (l.pais && l.pais !== pais) continue;
      const key = l.legajo_id || l.legajo_nombre;
      if (!key) continue;
      if (!map.has(key)) map.set(key, { id: key, nombre: l.legajo_nombre, rol: l.rol, sociedad: l.sociedad_nombre, rows: [] });
      map.get(key).rows.push(l);
    }
    return [...map.values()].sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
  }, [liqs, vista, pais]);

  // Empleado seleccionado (default: el primero).
  const sel = useMemo(() => {
    if (!empleados.length) return null;
    return empleados.find(e => e.id === selId) || empleados[0];
  }, [empleados, selId]);

  // Email del legajo del empleado seleccionado (destinatario al enviar la ficha).
  const emailSel = useMemo(() => {
    if (!sel) return "";
    return legajos.find(l => l.id === sel.id || l.nombre === sel.nombre)?.email || "";
  }, [sel, legajos]);

  // Pagos individuales del empleado seleccionado (nb_movimientos origen sueldos), ordenados por forma y fecha.
  const pagosEmpleado = useMemo(() => {
    if (!sel) return [];
    return pagos
      .filter(p => p.legajo_id === sel.id || p.legajo_nombre === sel.nombre)
      .sort((a, b) =>
        ordenForma(a.tipo_componente) - ordenForma(b.tipo_componente) ||
        (a.fecha || "").localeCompare(b.fecha || ""));
  }, [pagos, sel]);

  // Desglose Sedes: suma sobre las filas por sede, recalcula importes con tarifas.
  const resumenSedes = useMemo(() => {
    if (vista !== "sedes" || !sel) return null;
    const acc = {
      fijo: 0, horasCant: 0, horasMonto: 0,
      cdpCoachCant: 0, cdpFrontCant: 0, cdpMonto: 0,
      oneShotCant: 0, oneShotMonto: 0, asignaciones: 0, objGrupalMonto: 0,
      feriadosCant: 0, feriadosMonto: 0, domingosCant: 0, domingosMonto: 0,
      yogaCant: 0, yogaMonto: 0, redondeo: 0, sueldoVariable: 0,
    };
    const fijoVistos = new Set();   // no duplicar el sueldo base si hay varias filas (multi-sede)
    const sedes = [];
    const novedades = [];           // novedades congeladas de la(s) liquidación(es)
    let tarifas = {};
    const porSede = {};             // sede → total (para elegir la principal)
    const cs = { horas: new Set(), feriado: new Set(), domingo: new Set(),
                 cdpCoach: new Set(), cdpFront: new Set(), oneShot: new Set() };  // sedes que aportan a cada concepto
    for (const row of sel.rows) {
      const d = desglosarLiquidacion(row, categorias);
      tarifas = { tarifaHora: d.tarifaHora, tCdpCoach: d.tCdpCoach, tCdpFront: d.tCdpFront,
        tarifaOS: d.tarifaOS, tarifaDomingo: d.tarifaDomingo, tarifaYoga: d.tarifaYoga };
      if (!fijoVistos.has(sel.id)) { acc.fijo += d.fijo; fijoVistos.add(sel.id); }
      for (const k of ["horasCant","horasMonto","cdpCoachCant","cdpFrontCant","cdpMonto",
                       "oneShotCant","oneShotMonto","asignaciones","objGrupalMonto",
                       "feriadosCant","feriadosMonto","domingosCant","domingosMonto",
                       "yogaCant","yogaMonto","redondeo","sueldoVariable"]) {
        acc[k] += d[k] || 0;
      }
      const sn = row.sede_nombre || "—";
      porSede[sn] = (porSede[sn] || 0) + (Number(d.totalLiquidar) || 0);
      if ((d.horasCant || 0) + (d.yogaCant || 0) > 0) cs.horas.add(sn);
      if (d.feriadosCant > 0) cs.feriado.add(sn);
      if (d.domingosCant > 0) cs.domingo.add(sn);
      if (d.cdpCoachCant > 0) cs.cdpCoach.add(sn);
      if (d.cdpFrontCant > 0) cs.cdpFront.add(sn);
      if (d.oneShotCant  > 0) cs.oneShot.add(sn);
      sedes.push({ sede: sn, horas: d.horasCant, total: d.totalLiquidar });
      for (const n of (row.novedades || [])) novedades.push({ cuenta: n.cuenta_contable_nombre || "Novedad", descripcion: n.descripcion || "", monto: Number(n.monto) || 0 });
    }
    const principalSede = Object.entries(porSede).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const conceptoSedes = Object.fromEntries(Object.entries(cs).map(([k, set]) => [k, [...set]]));
    // El desglose de la ficha (FichaSedes) arma sus propios subtotales; acá solo el total.
    const totalNov = novedades.reduce((s, n) => s + n.monto, 0);
    const totalLiquidar = acc.fijo + acc.horasMonto + acc.sueldoVariable + totalNov;
    return { ...acc, ...tarifas, sedes, novedades, totalNov, principalSede, conceptoSedes, totalLiquidar };
  }, [vista, sel, categorias]);

  // Desglose HQ: sueldo base + novedades por cuenta + split de formas de pago.
  const resumenHQ = useMemo(() => {
    if (vista !== "hq" || !sel) return null;
    let sueldo = 0, totalBruto = 0;
    const novedades = [];
    for (const row of sel.rows) {
      sueldo     += Number(row.sueldo_base) || 0;
      totalBruto += Number(row.total_bruto) || 0;
      for (const n of (row.novedades || [])) {
        novedades.push({ cuenta: n.cuenta_contable_nombre || "Novedad", monto: Number(n.monto) || 0 });
      }
    }
    const sueldoFinal = totalBruto || sueldo;
    const totalNov = novedades.reduce((s, n) => s + n.monto, 0);
    return {
      sueldo: sueldoFinal,
      novedades,
      totalNov,
      totalLiquidar: sueldoFinal + totalNov,
    };
  }, [vista, sel]);

  const prevMes = () => { if (mes === 1) { setMes(12); setAnio(a => a - 1); } else setMes(m => m - 1); };
  const nextMes = () => { if (mes === 12) { setMes(1); setAnio(a => a + 1); } else setMes(m => m + 1); };

  const resumen = vista === "hq" ? resumenHQ : resumenSedes;

  const periodo = `${MESES[mes - 1]} ${anio}`;

  return (
    <div style={{ padding: 24, fontFamily: T.font, color: T.text, maxWidth: 860, margin: "0 auto" }}>
      <style>{`@media print {
        body * { visibility: hidden; }
        #ficha-print, #ficha-print * { visibility: visible; }
        #ficha-print { position: absolute; left: 0; top: 0; width: 100%; }
        .no-print { display: none !important; }
      }`}</style>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>Resumen de liquidación</h2>
        <span style={{ fontSize: 12, color: T.dim, whiteSpace: "nowrap", flexShrink: 0 }}>· solo consulta</span>

        {/* Toggle Sedes / HQ */}
        <div style={{ display: "flex", gap: 2, background: T.head, borderRadius: 7, padding: 3 }}>
          {[["sedes", "Sedes"], ["hq", "HQ"]].map(([v, label]) => (
            <button key={v} onClick={() => setVista(v)} style={toggleBtn(vista === v)}>{label}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, marginLeft: "auto", alignItems: "center" }}>
          <button onClick={prevMes} style={navBtn}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 120, textAlign: "center" }}>{MESES[mes - 1]} {anio}</span>
          <button onClick={nextMes} style={navBtn}>›</button>
          <select value={sel?.id ?? ""} onChange={e => setSelId(e.target.value)}
            style={{ border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, fontFamily: T.font, minWidth: 180, maxWidth: 220, marginLeft: 6 }}>
            {empleados.length === 0 && <option value="">— sin empleados —</option>}
            {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={muted}>Cargando…</div>
      ) : !sel || !resumen ? (
        <div style={{ border: `1px dashed ${T.border}`, borderRadius: 8, padding: 40, textAlign: "center", color: T.muted, fontSize: 13 }}>
          No hay liquidaciones de {vista === "hq" ? "HQ" : "Sedes"} para {MESES[mes - 1]} {anio}.
        </div>
      ) : vista === "hq" ? (
        <FichaHQ sel={sel} resumen={resumen} pagos={pagosEmpleado} email={emailSel} periodo={periodo} />
      ) : (
        <FichaSedes sel={sel} resumen={resumen} pagos={pagosEmpleado} email={emailSel} periodo={periodo} />
      )}
    </div>
  );
}

// Marco compartido de la ficha: header + componentes (children) + total + pagos.
function FichaShell({ sel, subtitulo, totalLiquidar, pagos, email, periodo, tag, children }) {
  const imprimir = () => window.print();
  const enviarMail = () => {
    const asunto = `Liquidación ${periodo} — ${sel.nombre}`;
    const lineas = pagos.map(p => `· ${fmtFecha(p.fecha)}  ${FP_LABEL[p.tipo_componente] ?? p.tipo_componente}  ${notaDePago(p)}  ${fmt(p.monto)}`);
    const cuerpo = [
      `${sel.nombre} — ${subtitulo}`,
      `Período: ${periodo}`,
      ``,
      `Total a liquidar: ${fmt(totalLiquidar)}`,
      ``,
      `Pagos:`,
      ...lineas,
    ].join("\n");
    window.location.href = `mailto:${encodeURIComponent(email || "")}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
  };
  return (
    <div id="ficha-print" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
        padding: "16px 20px", borderBottom: `1px solid ${T.border}`, background: "#e2e8f0" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800 }}>
            {sel.nombre}
            {tag && <span style={{ fontSize: 12, fontWeight: 600, color: T.muted, marginLeft: 8 }}>· {tag}</span>}
          </div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 2 }}>{subtitulo}</div>
        </div>
        <div className="no-print" style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={imprimir} style={fichaBtn}>🖨 Imprimir</button>
          <button onClick={enviarMail} disabled={!email} title={email ? `Enviar a ${email}` : "El legajo no tiene email cargado"}
            style={{ ...fichaBtn, opacity: email ? 1 : 0.5, cursor: email ? "pointer" : "not-allowed" }}>✉ Enviar por mail</button>
        </div>
      </div>

      {children}

      <TotalLiquidar importe={totalLiquidar} />

      <Section titulo="Forma de pago">
        <FormaPagoTabla pagos={pagos} />
      </Section>

      <PagosTotales pagos={pagos} totalLiquidar={totalLiquidar} />
    </div>
  );
}

// ── Ficha Sedes ──────────────────────────────────────────────────────────────
function FichaSedes({ sel, resumen, pagos, email, periodo }) {
  const sedes = resumen.sedes.length;
  const subtitulo = `${ROL_LABEL[sel.rol] ?? sel.rol} · ${sedes} sede${sedes !== 1 ? "s" : ""} · ${fmtNum(resumen.horasCant)} hs`;
  // Fijo = base + horas (base/feriado/domingo/yoga) + asignaciones (la base sobre la que pega la comisión grupal).
  const sueldoFijo  = resumen.fijo + resumen.horasMonto + resumen.yogaMonto + resumen.feriadosMonto + resumen.domingosMonto + resumen.asignaciones;
  const incentivos  = resumen.cdpMonto + resumen.oneShotMonto;
  const totalSueldo = sueldoFijo + resumen.objGrupalMonto + incentivos;
  // Sedes extra (≠ principal) que aportan a un concepto → se muestran entre paréntesis.
  const extra = (key) => {
    const list = (resumen.conceptoSedes?.[key] || []).filter(s => s !== resumen.principalSede);
    return list.length ? ` (${list.join(", ")})` : "";
  };
  return (
    <FichaShell sel={sel} subtitulo={subtitulo} totalLiquidar={resumen.totalLiquidar} pagos={pagos} email={email} periodo={periodo} tag={resumen.principalSede}>
      <Section titulo="Componentes">
        <table style={tbl}>
          <thead><tr><Th>Concepto</Th><Th right>Cant.</Th><Th right>Valor u.</Th><Th right>Importe</Th></tr></thead>
          <tbody>
            {/* Sueldo Fijo: base + horas (base/feriado/domingo) + asignaciones */}
            <Linea label="Sueldo base"   importe={resumen.fijo} />
            <Linea label={`Horas base${extra("horas")}`}
              cant={resumen.horasCant + resumen.yogaCant}
              valor={resumen.horasCant > 0 ? resumen.tarifaHora : resumen.tarifaYoga}
              importe={resumen.horasMonto + resumen.yogaMonto} />
            <Linea label={`Horas feriado${extra("feriado")}`} cant={resumen.feriadosCant} valor={resumen.tarifaHora}    importe={resumen.feriadosMonto} />
            <Linea label={`Horas domingo${extra("domingo")}`} cant={resumen.domingosCant} valor={resumen.tarifaDomingo} importe={resumen.domingosMonto} />
            <Linea label="Asignaciones"  importe={resumen.asignaciones} />
            <Subtotal label="Sueldo Fijo" importe={sueldoFijo} />

            <Linea label="Comisión grupal"  importe={resumen.objGrupalMonto} />

            {/* Incentivos: todo CDP */}
            <Linea label={`CDP coach${extra("cdpCoach")}`}      cant={resumen.cdpCoachCant} valor={resumen.tCdpCoach}     importe={resumen.cdpCoachCant * resumen.tCdpCoach} />
            <Linea label={`CDP front desk${extra("cdpFront")}`} cant={resumen.cdpFrontCant} valor={resumen.tCdpFront}     importe={resumen.cdpFrontCant * resumen.tCdpFront} />
            <Linea label={`One Shot${extra("oneShot")}`}        cant={resumen.oneShotCant}  valor={resumen.tarifaOS}      importe={resumen.oneShotMonto} />
            <Subtotal label="Incentivos" importe={incentivos} />

            <Subtotal label="Total sueldo" importe={totalSueldo} fuerte />

            {/* Adicionales sobre el sueldo */}
            {resumen.novedades.map((n, i) => (
              <Linea key={i} label={n.descripcion || n.cuenta} importe={n.monto} />
            ))}
            <Linea label="Redondeo"         importe={resumen.redondeo} />

            <Subtotal label="Total a liquidar" importe={resumen.totalLiquidar} fuerte />
          </tbody>
        </table>
      </Section>
    </FichaShell>
  );
}

// ── Ficha HQ ─────────────────────────────────────────────────────────────────
function FichaHQ({ sel, resumen, pagos, email, periodo }) {
  const subtitulo = `${ROL_LABEL[sel.rol] ?? sel.rol}${sel.sociedad ? ` · ${sel.sociedad}` : ""}`;
  return (
    <FichaShell sel={sel} subtitulo={subtitulo} totalLiquidar={resumen.totalLiquidar} pagos={pagos} email={email} periodo={periodo}>
      <Section titulo="Componentes">
        <table style={tbl}>
          <thead><tr><Th>Concepto</Th><Th right>Importe</Th></tr></thead>
          <tbody>
            <tr style={{ borderTop: `1px solid ${T.border}` }}>
              <Td>Sueldo</Td>
              <Td right>{fmt(resumen.sueldo)}</Td>
            </tr>
            {resumen.novedades.map((n, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${T.border}` }}>
                <Td>{n.cuenta}</Td>
                <Td right dim={!n.monto}>{n.monto ? fmt(n.monto) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </FichaShell>
  );
}

// Nota a mostrar: la nota interna guardada en el pago; si no hay, el concepto
// del pago salvo que sea el autogenerado ("Sueldo <nombre> <m>/<a> · <forma>").
function notaDePago(p) {
  if (p.nota) return p.nota;
  const auto = `Sueldo ${p.legajo_nombre} ${p.mes}/${p.anio} · ${p.tipo_componente}`;
  if (!p.concepto || p.concepto === auto) return "—";
  // El nombre del empleado es redundante en su propia ficha → lo quitamos.
  return p.legajo_nombre ? p.concepto.replace(p.legajo_nombre, "").replace(/\s{2,}/g, " ").trim() : p.concepto;
}

// Una línea por pago real (nb_movimientos origen sueldos): fecha · forma · nota · monto.
function FormaPagoTabla({ pagos }) {
  return (
    <table style={tbl}>
      <thead><tr><Th>Fecha</Th><Th>Forma</Th><Th>Nota interna</Th><Th right>Monto</Th></tr></thead>
      <tbody>
        {pagos.length === 0 ? (
          <tr style={{ borderTop: `1px solid ${T.border}` }}>
            <Td dim>Sin pagos registrados</Td><Td /><Td /><Td right dim>—</Td>
          </tr>
        ) : pagos.map((p, i) => (
          <tr key={p.id || i} style={{ borderTop: `1px solid ${T.border}` }}>
            <Td dim>{fmtFecha(p.fecha)}</Td>
            <Td>{FP_LABEL[p.tipo_componente] ?? p.tipo_componente}</Td>
            <Td dim>{notaDePago(p)}</Td>
            <Td right>{fmt(p.monto)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Banda full-width al pie de la ficha: total pagado + pendiente (llega a los bordes).
function PagosTotales({ pagos, totalLiquidar }) {
  const totalPagado = pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const pendiente   = (Number(totalLiquidar) || 0) - totalPagado;
  const pendColor   = pendiente > 0 ? T.red : pendiente < 0 ? T.blue : T.text;
  const fila = (label, valor, color) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0" }}>
      <span style={{ fontSize: 14, fontWeight: 800 }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: color ?? T.text }}>{valor}</span>
    </div>
  );
  return (
    <div style={{ background: "#e2e8f0", borderTop: `2px solid ${T.dim}`, padding: "9px 20px" }}>
      {fila("Total pagado", fmt(totalPagado))}
      {fila("Pendiente", fmt(pendiente), pendColor)}
    </div>
  );
}

// ── Subcomponentes ──────────────────────────────────────────────────────────
function TotalLiquidar({ importe }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "14px 20px", background: "#bfdbfe", borderTop: `2px solid ${T.blue}` }}>
      <span style={{ fontSize: 14, fontWeight: 800 }}>Total a Liquidar</span>
      <span style={{ fontSize: 18, fontWeight: 800, color: T.blue }}>{fmt(importe)}</span>
    </div>
  );
}
function Section({ titulo, children }) {
  return (
    <div style={{ borderTop: `1px solid ${T.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, letterSpacing: ".05em",
        textTransform: "uppercase", padding: "10px 20px 4px" }}>{titulo}</div>
      <div style={{ padding: "0 20px 12px" }}>{children}</div>
    </div>
  );
}
function Th({ children, right }) {
  return <th style={{ textAlign: right ? "right" : "left", fontSize: 11, fontWeight: 600,
    color: T.muted, padding: "6px 4px" }}>{children}</th>;
}
function Td({ children, right, dim }) {
  return <td style={{ textAlign: right ? "right" : "left", fontSize: 13, padding: "6px 4px",
    color: dim ? T.dim : T.text, fontVariantNumeric: "tabular-nums" }}>{children}</td>;
}
function Linea({ label, cant, valor, importe }) {
  const hay = Number(importe) > 0 || Number(cant) > 0;
  return (
    <tr style={{ borderTop: `1px solid ${T.border}` }}>
      <Td>{label}</Td>
      <Td right dim={!cant}>{cant ? fmtNum(cant) : "—"}</Td>
      <Td right dim>{Number(cant) > 0 && Number(valor) ? fmt(valor) : "—"}</Td>
      <Td right dim={!hay}>{Number(importe) ? fmt(importe) : "—"}</Td>
    </tr>
  );
}
function Subtotal({ label, importe, fuerte }) {
  return (
    <tr style={{ borderTop: `1px solid ${T.border}`, background: fuerte ? "#dbeafe" : "#e2e8f0" }}>
      <td colSpan={3} style={{ fontSize: 13, fontWeight: fuerte ? 800 : 700, padding: "7px 4px" }}>{label}</td>
      <td style={{ textAlign: "right", fontSize: 13, fontWeight: fuerte ? 800 : 700, padding: "7px 4px",
        fontVariantNumeric: "tabular-nums" }}>{fmt(importe)}</td>
    </tr>
  );
}

const navBtn = { background: "none", border: `1px solid ${T.border}`, borderRadius: 5, padding: "4px 9px", cursor: "pointer", fontSize: 13, color: T.muted };
const fichaBtn = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: T.text, fontFamily: T.font, whiteSpace: "nowrap" };
const toggleBtn = (active) => ({
  background: active ? T.card : "transparent", border: "none", borderRadius: 5,
  padding: "5px 14px", cursor: "pointer", fontSize: 12, fontWeight: active ? 700 : 500,
  color: active ? T.blue : T.muted, fontFamily: T.font,
  boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
});
const muted  = { fontSize: 13, color: T.muted };
const tbl    = { width: "100%", borderCollapse: "collapse" };
