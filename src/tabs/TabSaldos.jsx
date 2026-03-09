import { memo, useMemo, useCallback, useState } from "react";
import { useStore } from "../lib/context";
import { computeSaldo, computeSaldoPrevMes, computePautaPendiente, makeType, MONTHS, fmt, downloadCSV } from "../lib/helpers";
import { inPeriod } from "../data/franchisor";

// ─── HOOK COMPARTIDO: agrega datos por franquicia ─────────────────────────────
export function useFrData(franchises, month, year) {
  const { comps, saldoInicial } = useStore();
  return useMemo(() => franchises.map(fr => {
    const key    = String(fr.id);
    const fc     = (comps[key] ?? []).filter(c => inPeriod(c, month, year));
    const sp     = computeSaldoPrevMes(fr.id, year, month, comps, saldoInicial);
    const sa     = computeSaldo(fr.id, year, month, comps, saldoInicial);
    // Por cuenta: neto = FACTURA - NC
    const netoCuenta = (cuenta) => {
      const facts = fc.filter(c => c.type === makeType("FACTURA", cuenta)).reduce((a, c) => a + c.amount, 0);
      const ncs   = fc.filter(c => c.type === makeType("NC",      cuenta)).reduce((a, c) => a + c.amount, 0);
      return { facts, ncs, neto: facts - ncs };
    };
    const fee           = netoCuenta("FEE");
    const interusos     = netoCuenta("INTERUSOS");
    const pauta         = netoCuenta("PAUTA");
    const sponsors      = netoCuenta("SPONSORS");
    const otrosIngresos = netoCuenta("OTROS_INGRESOS");
    const pagos         = fc.filter(c => c.type === "PAGO").reduce((a, c) => a + c.amount, 0);
    const pagosACuenta  = fc.filter(c => c.type === "PAGO_PAUTA").reduce((a, c) => a + c.amount, 0);
    const enviados      = fc.filter(c => c.type === "PAGO_ENVIADO").reduce((a, c) => a + c.amount, 0);
    // Pauta pendiente: cobros a cuenta acumulados históricamente sin factura emitida
    const pautaPendiente = computePautaPendiente(fr.id, comps, year, month);
    return { fr, sp, sa, fee, interusos, pauta, sponsors, otrosIngresos, pagos, pagosACuenta, enviados, pautaPendiente };
  }), [franchises, comps, saldoInicial, month, year]);
}

// ─── SALDOS TABLE ──────────────────────────────────────────────────────────────
export function SaldosTable({ title, data, accentColor, bgColor, borderColor, onOpenFr, month, year, amountFn, showMail = true, showCbu = false }) {
  if (data.length === 0) return null;
  const getAmt = amountFn ?? (d => d.sa);
  const total  = data.reduce((a, d) => a + getAmt(d), 0);
  const [selected, setSelected] = useState(new Set());

  const toggleOne = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(prev => prev.size === data.length ? new Set() : new Set(data.map(d => d.fr.id)));
  const allChecked  = selected.size === data.length && data.length > 0;
  const someChecked = selected.size > 0 && !allChecked;

  const handleMail = (rows) => {
    const names = rows.map(d => d.fr.name).join(", ");
    alert(`Recordatorio enviado a:\n${names}\n\n(Integración de email pendiente)`);
  };

  const handleCSV = (rows) => {
    const headers = showCbu
      ? ["Franquicia", "Moneda", "Saldo", "CBU", "Banco", "Alias"]
      : ["Franquicia", "Moneda", "Saldo"];
    const csvRows = [headers, ...rows.map(d => showCbu
      ? [d.fr.name, d.fr.currency, Math.abs(getAmt(d)).toFixed(2), d.fr.cbu ?? "", d.fr.banco ?? "", d.fr.alias ?? ""]
      : [d.fr.name, d.fr.currency, Math.abs(getAmt(d)).toFixed(2)]
    )];
    downloadCSV(csvRows, `BIGG_${title.replace(/[^a-zA-Z0-9]/g,"_")}_${MONTHS[month]}_${year}.csv`);
  };

  const selectedRows = data.filter(d => selected.has(d.fr.id));
  const actionRows   = selectedRows.length > 0 ? selectedRows : data;

  return (
    <div style={{ marginBottom: 28 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ height: 3, width: 24, borderRadius: 2, background: accentColor }} />
        <span style={{ fontWeight: 800, fontSize: 13, color: accentColor, letterSpacing: ".08em", textTransform: "uppercase" }}>{title}</span>
        <span className="pill" style={{ color: accentColor, background: bgColor, border: `1px solid ${borderColor}` }}>{data.length} sede{data.length !== 1 ? "s" : ""}</span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: accentColor, marginLeft: "auto" }}>
          {Math.round(Math.abs(total)).toLocaleString("es-AR")} {data[0]?.fr.currency}
        </span>
      </div>

      {/* Bulk action bar — visible when something selected */}
      {selected.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "6px 10px", background: `${accentColor}12`, border: `1px solid ${accentColor}30`, borderRadius: 7 }}>
          <span style={{ fontSize: 11, color: accentColor, fontWeight: 700 }}>{selected.size} seleccionada{selected.size !== 1 ? "s" : ""}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {showMail && <button className="ghost" style={{ fontSize: 10 }} onClick={() => handleMail(selectedRows)}>✉ Recordatorio masivo</button>}
            <button className="ghost" style={{ fontSize: 10 }} onClick={() => handleCSV(selectedRows)}>↓ CSV selección{showCbu ? " + CBU" : ""}</button>
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse" }}>
          <colgroup>
            <col style={{ width: 36 }} />    {/* checkbox */}
            <col />                           {/* sede */}
            <col style={{ width: 160 }} />   {/* importe */}
            <col style={{ width: 150 }} />   {/* recordatorio */}
            <col style={{ width: 110 }} />   {/* ver CC */}
          </colgroup>
          <thead>
            <tr>
              <th style={{ padding: "6px 8px" }}>
                <input type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = someChecked; }}
                  onChange={toggleAll} style={{ accentColor, cursor: "pointer" }} />
              </th>
              <th>Franquicia</th>
              <th style={{ textAlign: "right", paddingRight: 24 }}>Saldo</th>
              <th style={{ textAlign: "center" }}></th>
              <th style={{ textAlign: "right", paddingRight: 16 }}>
                <button className="ghost" style={{ fontSize: 9, padding: "2px 6px" }} onClick={() => handleCSV(actionRows)}>
                  ↓ CSV{showCbu ? " + CBU" : ""}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => {
              const checked = selected.has(d.fr.id);
              return (
                <tr key={d.fr.id} style={{ background: checked ? `${accentColor}08` : i % 2 === 0 ? "transparent" : "rgba(255,255,255,.013)" }}>
                  <td style={{ padding: "7px 8px", textAlign: "center" }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleOne(d.fr.id)}
                      style={{ accentColor, cursor: "pointer" }} />
                  </td>
                  <td style={{ fontWeight: 600, fontSize: 13, padding: "7px 8px" }}>
                    {d.fr.name}
                    <span style={{ marginLeft: 6, fontSize: 10, color: "var(--muted)", fontWeight: 400 }}>{d.fr.currency}</span>
                  </td>
                  <td style={{ textAlign: "right", padding: "7px 24px 7px 8px" }}>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 800, color: accentColor }}>
                      {Math.round(Math.abs(getAmt(d))).toLocaleString("es-AR")}
                    </span>
                  </td>
                  <td style={{ padding: "7px 8px", textAlign: "center" }}>
                    {showMail && (
                      <button onClick={() => handleMail([d])} title="Enviar recordatorio"
                        style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--border2)", borderRadius: 999, padding: "3px 10px", fontSize: 10, color: "var(--muted)", cursor: "pointer", fontFamily: "var(--font)", fontWeight: 600, whiteSpace: "nowrap" }}>
                        ✉ Recordatorio
                      </button>
                    )}
                  </td>
                  <td style={{ textAlign: "right", padding: "7px 16px 7px 8px" }}>
                    <button className="ghost" style={{ fontSize: 10 }} onClick={() => onOpenFr(d.fr.id)}>Ver CC →</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── TAB: SALDOS ──────────────────────────────────────────────────────────────
const TabSaldos = memo(function TabSaldos({ franchises, month, year, onOpenFr }) {
  const frData = useFrData(franchises, month, year);

  const { deben, cobrar, pautaPend, alDia } = useMemo(() => {
    const deben     = [];
    const cobrar    = [];
    const pautaPend = [];
    const alDia     = [];
    for (const d of frData) {
      if (d.sa > 0.01) {
        deben.push(d);
      } else if (d.pautaPendiente > 0.01) {
        pautaPend.push(d);
      } else if (d.sa < -0.01) {
        cobrar.push(d);
      } else {
        alDia.push(d);
      }
    }
    return {
      deben:     deben.sort((a, b) => b.sa - a.sa),
      cobrar:    cobrar.sort((a, b) => a.sa - b.sa),
      pautaPend: pautaPend.sort((a, b) => a.sa - b.sa),
      alDia,
    };
  }, [frData]);

  const handleExportCSV = useCallback(() => {
    const rows = [["Franquicia","Moneda","Saldo Final","Estado"]];
    [...deben, ...cobrar, ...alDia].forEach(({ fr, sa }) =>
      rows.push([fr.name, fr.currency, sa.toFixed(2), sa > 0.01 ? "NOS DEBEN" : sa < -0.01 ? "DEBEMOS" : "AL DÍA"])
    );
    downloadCSV(rows, `BIGG_Saldos_${MONTHS[month]}_${year}.csv`);
  }, [deben, cobrar, alDia, month, year]);

  return (
    <div className="fade">
      <SaldosTable
        title={`Nos deben (${deben.length})`}
        data={deben}
        accentColor="var(--red)"
        bgColor="rgba(255,107,122,.08)"
        borderColor="rgba(255,107,122,.2)"
        onOpenFr={onOpenFr}
        month={month} year={year}
      />
      <SaldosTable
        title={`Debemos pagar (${cobrar.length})`}
        data={cobrar}
        accentColor="var(--green)"
        bgColor="rgba(126,217,160,.08)"
        borderColor="rgba(126,217,160,.2)"
        onOpenFr={onOpenFr}
        month={month} year={year}
        showMail={false}
        showCbu={true}
      />
      <SaldosTable
        title={`Pagos a cuenta — pendiente de facturar (${pautaPend.length})`}
        data={pautaPend}
        accentColor="var(--cyan)"
        bgColor="rgba(34,211,238,.08)"
        borderColor="rgba(34,211,238,.2)"
        onOpenFr={onOpenFr}
        month={month} year={year}
        amountFn={d => d.pautaPendiente}
      />
      {alDia.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", marginTop: 8 }}>
          {alDia.length} sede{alDia.length !== 1 ? "s" : ""} al día · {alDia.map(d => d.fr.name).join(", ")}
        </div>
      )}
    </div>
  );
});

export default TabSaldos;
