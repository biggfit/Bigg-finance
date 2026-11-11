// Valuación del grupo (Martín 10/11/2026): cuánto "vale" cada línea del P&L del grupo al cierre de cada mes, con una
// regla que no cambia (ver valuacionDerive). Mismo molde que la Caja y Del resultado al patrimonio (TablaMeses): una
// fila por línea, los meses en columnas, el total abajo y la variación del mes. La segunda tabla (detrás de un botón)
// muestra el promedio mensual que se multiplica, para poder seguir de dónde sale cada valor.
import { useState } from "react";
import { T } from "../theme";
import { Fila, TablaMeses } from "./TablaMeses";
import { VAL } from "./valuacionDerive";

const pct = v => `${Math.round(v * 100)} %`;
const btn = on => ({ background: on ? "#e5e7eb" : "#f3f4f6", border: `1px solid ${T.cardBorder}`, borderRadius: 8, color: T.text,
  fontFamily: T.font, fontSize: 12.5, fontWeight: 700, padding: "6px 12px", cursor: "pointer" });
const nota = { color: T.dim, fontWeight: 500, fontSize: 11.5 };

export function ValuacionView({ val, meses = [] }) {
  const [sedesAbiertas, setSedesAbiertas] = useState(true);
  const [verProm, setVerProm] = useState(false);
  if (!val) return null;
  if (!meses.length) return <div style={{ color: T.muted, fontSize: 13, padding: "18px 4px" }}>Todavía no hay meses cerrados para valuar en este año.</div>;
  const ult = meses[meses.length - 1];
  const p = { meses, cerrados: meses, mesEnCurso: null };
  const de = g => val.filas.filter(f => f.grupo === g);
  const sedes = de("sedes"), puesto = de("puesto"), lineas = de("lineas");   // lineas = servicios y la Red neta de HQ
  const suma = fs => m => fs.reduce((t, f) => t + (Number(f.valor[m]) || 0), 0);
  const total = m => val.total[m] || 0;
  // Variación contra el cierre anterior. El primer mes valuado (julio 2026) no compara: antes no hay promedio.
  const variacion = m => (m === meses[0] && m > 0) ? 0 : total(m) - (m === 0 ? val.totalAntes : total(m - 1));
  // Etiqueta con la regla de la fila: parte de BIGG y ventana corta (sede nueva) cuando aplican.
  const etiqueta = f => {
    const extras = [];
    if (f.parte != null && f.parte < 0.999) extras.push(`al ${pct(f.parte)}`);
    if (f.corta?.[ult]) extras.push(`últimos ${f.ventana[ult]} meses`);
    return extras.length ? <>{f.label} <span style={nota}>· {extras.join(" · ")}</span></> : f.label;
  };
  const filasValor = (fs) => fs.map(f => <Fila key={f.key} label={etiqueta(f)} get={m => f.valor[m] || 0} {...p} total="ultimo" sangria={18} />);
  const filasProm = (fs) => fs.map(f => <Fila key={f.key} label={<>{f.label} <span style={nota}>· × {f.multiplo}</span></>} get={m => f.promedio?.[m] || 0} {...p} total="ultimo" sangria={18} />);
  const grupoStyle = { background: "#fafafa" };

  return (
    <div className="fade">
      <TablaMeses titulo="Valuación · USD" meses={meses} mesEnCurso={null}>
        <tbody>
          <Fila label={<>Sedes argentinas <span style={nota}>· promedio × {VAL.mesesNegocio}</span></>} get={suma(sedes)} {...p} total="ultimo" fuerte
            flecha={sedesAbiertas} onToggle={() => setSedesAbiertas(a => !a)} style={grupoStyle} />
          {sedesAbiertas && filasValor(sedes)}
          {puesto.map(f => <Fila key={f.key} label={<>{f.label} <span style={nota}>· lo que pusimos</span></>} get={m => f.valor[m] || 0} {...p} total="ultimo" fuerte style={grupoStyle} />)}
          {lineas.map(f => <Fila key={f.key} label={<>{f.label} <span style={nota}>· {f.detalle} · × {f.multiplo}</span></>} get={m => f.valor[m] || 0} {...p} total="ultimo" fuerte style={grupoStyle} />)}
        </tbody>
        <tfoot>
          <Fila label="Valor del grupo" get={total} {...p} total="ultimo" fuerte style={{ background: "#f3f4f6", borderTop: `2px solid ${T.cardBorder}` }} />
          <Fila label="Variación del mes" get={variacion} {...p} style={{ background: "#f3f4f6" }} labelStyle={{ color: T.muted }} />
        </tfoot>
      </TablaMeses>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "2px 0 14px", flexWrap: "wrap" }}>
        <button onClick={() => setVerProm(v => !v)} style={btn(verProm)}>{verProm ? "Ocultar promedios" : "Ver promedios"}</button>
        <span style={{ color: T.muted, fontSize: 12 }}>
          Sin IVA y sin impuestos, a TC real. El promedio toma los meses desde julio 2026, hasta 12. La columna TOTAL es el valor al último cierre. No es un valor de mercado: es la misma cuenta todos los meses.
        </span>
      </div>

      {verProm && (
        <TablaMeses titulo="Resultado promedio mensual que se multiplica · USD" meses={meses} mesEnCurso={null}>
          <tbody>
            {filasProm(sedes)}
            {filasProm(lineas)}
          </tbody>
        </TablaMeses>
      )}
    </div>
  );
}
