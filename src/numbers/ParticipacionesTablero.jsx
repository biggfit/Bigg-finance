// Participaciones por negocio (T4, Martín 5-6/11/2026): quién es dueño de qué, qué puso y qué le debemos. Reemplaza al
// tablero de "Socios" (una lista de 5 personas con nos deben / les debemos): un bloque por negocio leído de nb_socios
// (fila sin `alcance` = BIGG grupo; con `alcance` = esa sociedad o ese centro), socios primero y cesiones después, con
// la cuenta corriente de cada uno al lado (nb_socios_cc + nb_movimientos origen="socios", mismo criterio que el ledger:
// + nos debe / − le debemos). El pie controla que los socios sumen 100 y cuánto se cedió.
// Las columnas de plata van en la moneda de la sociedad del negocio (aportado/retirado no traen moneda en la hoja).
// Un negocio a la vez: selector de pills arriba y UNA tabla (Martín 6/11: "prefiero un selector por negocio y no todas
// las tablas juntas", misma regla que en la Caja: el selector cambia el cuadro, nunca se apilan).
import { useState } from "react";
import { T } from "./theme";
import { SOCIO_SIGNO_CAJA } from "../lib/numbersApi";

const n = v => Number(v) || 0;
// Importes sin decimales (Martín 6/11: "sacá los decimales de los números, no de los porcentajes"); mismo símbolo que fmtMoney.
const fmtEntero = (v, cur) => `${cur === "USD" ? "U$D" : cur === "EUR" ? "€" : "$"} ${Math.round(Math.abs(v)).toLocaleString("es-AR")}`;
const BASE_LABEL = { resultado_neto: "resultado neto", resultado_final: "resultado final", fcf: "flujo de caja libre" };
const GRID = "2.4fr repeat(6, 1fr)";   // todas las columnas iguales salvo la primera (Martín 6/11)
const gridRow = { display: "grid", gridTemplateColumns: GRID, columnGap: 12 };
const cell = { fontSize: 12.5, whiteSpace: "nowrap" };
const numCell = { ...cell, textAlign: "right", fontFamily: T.mono };

// Saldo de CC por socio y moneda. `sociedad` acota a esa sociedad (el bloque de Wellness mira solo lo de Wellness);
// sin filtro, todo el grupo (bloque BIGG).
function saldosCC(ccRows, movs, sociedad = null) {
  const acc = {};
  const add = (sid, mon, d) => { if (!sid) return; (acc[sid] ??= {}); acc[sid][mon] = (acc[sid][mon] || 0) + d; };
  for (const r of ccRows) if (!sociedad || String(r.sociedad) === sociedad) add(r.socio_id, r.moneda || "ARS", n(r.monto));
  for (const m of movs) {
    const signo = SOCIO_SIGNO_CAJA[m.socio_tipo] ?? 0;
    if (signo && (!sociedad || String(m.sociedad) === sociedad)) add(m.contraparte_id, m.moneda || "ARS", signo * Math.abs(n(m.monto)));
  }
  return acc;
}
// Dividendos declarados (en positivo) por socio y moneda, acotados igual que el saldo.
function declaradosCC(ccRows, sociedad = null) {
  const acc = {};
  for (const r of ccRows) {
    if (r.tipo !== "dividendo_declarado" || (sociedad && String(r.sociedad) !== sociedad)) continue;
    (acc[r.socio_id] ??= {}); acc[r.socio_id][r.moneda || "ARS"] = (acc[r.socio_id][r.moneda || "ARS"] || 0) - n(r.monto);
  }
  return acc;
}

// Los bloques: BIGG (grupo) primero, después las sociedades en el orden del maestro, después los centros.
function negociosDe(participaciones, sociedades, centros) {
  const socMap = new Map(sociedades.map(s => [String(s.id), s]));
  const ccMap = new Map(centros.map(c => [String(c.id), c]));
  const porAlcance = new Map();
  for (const r of participaciones) {
    if (!String(r.id ?? "").trim()) continue;
    const k = String(r.alcance ?? "").trim();
    if (!porAlcance.has(k)) porAlcance.set(k, []);
    porAlcance.get(k).push(r);
  }
  const bloques = [];
  for (const [k, filas] of porAlcance) {
    const soc = socMap.get(k), cc = ccMap.get(k);
    const sociedadId = k === "" ? null : soc ? k : (cc?.sociedad ? String(cc.sociedad) : null);
    const moneda = (soc || socMap.get(sociedadId || ""))?.moneda || "ARS";
    const nombre = k === "" ? "BIGG · grupo" : soc?.nombre || (cc?.nombre || k).replace(/^\d+\s*-\s*/, "");
    const orden = k === "" ? 0 : soc ? 1 + sociedades.findIndex(s => String(s.id) === k) : 100 + centros.findIndex(c => String(c.id) === k);
    const socios = filas.filter(r => r.tipo !== "cesion").sort((a, b) => n(b.participacion) - n(a.participacion));
    const cesiones = filas.filter(r => r.tipo === "cesion").sort((a, b) => String(a.desde || "").localeCompare(String(b.desde || "")));
    bloques.push({ key: k, nombre, moneda, sociedadId, orden, socios, cesiones,
      pctSocios: socios.reduce((s, r) => s + n(r.participacion), 0), pctCedido: cesiones.reduce((s, r) => s + n(r.participacion), 0) });
  }
  return bloques.sort((a, b) => a.orden - b.orden);
}

const chips = porMon => Object.entries(porMon || {}).filter(([, v]) => Math.abs(v) > 0.01);
function Monto({ v, moneda, signo = false, dim = false, bold = false }) {
  if (!v || Math.abs(v) < 0.01) return <span style={{ ...numCell, color: T.dim }}>—</span>;
  const color = signo ? (v > 0 ? T.green : T.red) : dim ? T.muted : T.text;
  return <span style={{ ...numCell, color, fontWeight: bold ? 800 : 500 }}>{signo && v < 0 ? "−" : ""}{fmtEntero(v, moneda)}</span>;
}
function Montos({ porMon, signo = false, bold = false }) {
  const cs = chips(porMon);
  if (!cs.length) return <span style={{ ...numCell, color: T.dim }}>—</span>;
  return <span style={numCell}>{cs.map(([m, v], i) => <span key={m}>{i ? " · " : ""}<Monto v={v} moneda={m} signo={signo} bold={bold} /></span>)}</span>;
}

export function ParticipacionesTablero({ participaciones, ccRows, movs, sociedades, centros, onSel }) {
  const bloques = negociosDe(participaciones, sociedades, centros);
  const [negocio, setNegocio] = useState(null);
  const esDelGrupo = id => sociedades.some(s => String(s.id) === String(id));
  if (!bloques.length) return (
    <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, padding: 24, color: T.dim, fontSize: 13, textAlign: "center" }}>
      No hay participaciones cargadas. Cargá <code>nb_socios</code>: una fila por persona y negocio (columna <code>alcance</code>).
    </div>
  );
  const bloque = bloques.find(b => b.key === negocio) || bloques[0];
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: "uppercase", letterSpacing: ".08em", marginRight: 4 }}>Negocio</span>
        {bloques.map(b => {
          const on = b.key === bloque.key;
          return (
            <button key={b.key} type="button" onClick={() => setNegocio(b.key)} style={{
              background: on ? T.accentDark : "#eceff3", color: on ? T.accent : T.muted,
              border: `1px solid ${on ? T.accentDark : T.cardBorder}`, borderRadius: 999,
              padding: "5px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
              {b.nombre}
            </button>
          );
        })}
      </div>
      {[bloque].map(b => {
        const saldos = saldosCC(ccRows, movs, b.sociedadId);
        const declarados = declaradosCC(ccRows, b.sociedadId);
        const filas = [...b.socios, ...b.cesiones];
        const sum = f => filas.reduce((s, r) => s + n(r[f]), 0);
        // La CC es por persona: quien es socio Y cesionario (Gonzalo en Wellness) aparece en dos filas pero suma una vez.
        const ids = [...new Set(filas.map(r => String(r.id)))];
        const sumPorMon = porId => { const acc = {}; for (const id of ids) for (const [m, v] of Object.entries(porId[id] || {})) acc[m] = (acc[m] || 0) + v; return acc; };
        const subt = [
          b.socios.length ? `Socios ${fmtPct(b.pctSocios)}` : null,
          b.cesiones.length ? `cedido ${fmtPct(b.pctCedido)}` : null,
        ].filter(Boolean).join(" · ");
        return (
          <div key={b.key} style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: T.radius, boxShadow: T.shadow, overflow: "hidden", marginBottom: 16 }}>
            <div style={{ ...gridRow, padding: "10px 18px", background: T.tableHead, color: T.tableHeadText, fontSize: 11, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", alignItems: "center" }}>
              <span style={{ fontSize: 12, letterSpacing: ".06em", whiteSpace: "nowrap" }}>{b.nombre}<span style={{ display: "block", opacity: .6, fontWeight: 600, textTransform: "none", letterSpacing: 0, fontSize: 11 }}>{subt}</span></span>
              <span style={{ textAlign: "right" }}>Tipo</span><span style={{ textAlign: "right" }}>%</span>
              <span style={{ textAlign: "right" }}>Aportado</span><span style={{ textAlign: "right" }}>Retirado</span>
              <span style={{ textAlign: "right" }}>Dividendos</span><span style={{ textAlign: "right" }}>Saldo CC</span>
            </div>
            {filas.map((r, i) => {
              const cesion = r.tipo === "cesion";
              const primeraCesion = cesion && i === b.socios.length && b.socios.length > 0;
              // La CC es de la persona, no de la fila: quien es socio Y cesionario la ve en la fila de la cesión.
              const conCC = cesion || !b.cesiones.some(c => String(c.id) === String(r.id));
              return (
                <div key={`${r.id}:${r.tipo}`} onClick={() => onSel(r.id)}
                  style={{ ...gridRow, padding: "10px 18px", alignItems: "center", cursor: "pointer",
                    borderTop: `${primeraCesion ? 2 : 1}px solid ${T.cardBorder}`, background: cesion ? "#fafbfc" : T.card, opacity: r.activo === false ? .5 : 1 }}>
                  <span style={{ ...cell, fontWeight: 700, color: T.text }}>
                    {r.nombre}
                    {esDelGrupo(r.id) && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, color: T.purple, background: T.purpleBg, padding: "1px 6px", borderRadius: 4, letterSpacing: ".04em" }}>DEL GRUPO</span>}
                  </span>
                  {/* La base de la cesión (resultado neto / final / FCF) va como tooltip: en la fila solo el tipo (Martín 6/11). */}
                  <span style={{ ...cell, color: T.muted, textAlign: "right" }} title={cesion && r.base ? `Cesión de utilidades sobre ${BASE_LABEL[r.base] || r.base}` : undefined}>
                    {cesion ? "Cesión Utl." : "Socio"}
                  </span>
                  <span style={{ ...numCell, fontWeight: 700, color: n(r.participacion) ? T.text : T.dim }}>{n(r.participacion) ? fmtPct(n(r.participacion)) : "—"}</span>
                  <Monto v={n(r.aportado)} moneda={b.moneda} />
                  <Monto v={n(r.retirado)} moneda={b.moneda} dim />
                  <Montos porMon={conCC ? declarados[r.id] : null} />
                  <Montos porMon={conCC ? saldos[r.id] : null} signo />
                </div>
              );
            })}
            <div style={{ ...gridRow, padding: "11px 18px", borderTop: `2px solid ${T.tableHead}`, alignItems: "center", background: "#f8fafc" }}>
              <span style={{ fontWeight: 900, color: T.text, fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em" }}>Total</span>
              <span />
              {/* Control: los socios suman 100 (naranja si no); si el negocio solo tiene cesiones, cuánto se cedió. */}
              <span style={{ ...numCell, fontWeight: 800, color: !b.socios.length || Math.abs(b.pctSocios - 100) < 0.01 ? T.text : T.orange }}
                title={b.socios.length ? "Los socios deberían sumar 100 %" : "Cedido"}>{fmtPct(b.socios.length ? b.pctSocios : b.pctCedido)}</span>
              <Monto v={sum("aportado")} moneda={b.moneda} bold />
              <Monto v={sum("retirado")} moneda={b.moneda} dim bold />
              <Montos porMon={sumPorMon(declarados)} bold />
              <Montos porMon={sumPorMon(saldos)} signo bold />
            </div>
          </div>
        );
      })}
    </>
  );
}

function fmtPct(v) { return `${Number(v).toLocaleString("es-AR", { maximumFractionDigits: 3 })} %`; }
