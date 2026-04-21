import { useState, useMemo } from "react";
import { T } from "./theme";
import { IVA_OPTS, todayISO, addDays, fmtNum } from "../data/numbersData";
import {
  inputStyle, dateStyle, lookupId, makeCCResolver,
  calcLineasTotals, SoftField, FacturaFormFocusRing, FACTURA_FORM_CLASS,
  InvoiceLineasTable, InvoiceNotaYTotales, InvoiceFormFooter,
  useCcGroups, initialFacturaLineas, facturaCanSave, runSaveThenMaybeClose,
  useDeferredEntityLookup, makeFacturaPartyChangeHandler, FACTURA_TOP_FIELDS_GRID,
  FacturaMaestroCuentaFields, FacturaFormChrome,
} from "./formUtils";
import { useLineas } from "./useLineas";

const EGRESO_SECONDARY_OUTLINE = "#0e7490";

export default function NuevoEgresoModal({ onClose, onSave, proveedores = [], cuentas = [], centrosCosto, initialData, asPage = false }) {
  const isEdit = !!initialData;
  const CC_LIST = useMemo(() => centrosCosto ?? [], [centrosCosto]);
  const CUENTAS_GASTO = useMemo(() => {
    return cuentas.filter(c => {
      const t = (c.tipo ?? "").toLowerCase();
      return t === "gasto" || t === "gastos" || t === "financiero" || t === "financieros";
    });
  }, [cuentas]);

  const resolveCC = useMemo(() => makeCCResolver(CC_LIST), [CC_LIST]);
  const initProvId = lookupId(proveedores, "proveedorId", "proveedor", initialData);
  const initCuentaId = lookupId(CUENTAS_GASTO, "cuentaId", "cuenta", initialData);
  const initLineas = useMemo(
    () => initialFacturaLineas(initialData, resolveCC),
    [initialData, resolveCC],
  );

  const [provId, setProvId] = useState(initProvId);
  const [cuentaId, setCuentaId] = useState(initCuentaId);
  const [moneda, setMoneda] = useState(initialData?.moneda ?? "ARS");
  const [fecha, setFecha] = useState(initialData?.fecha ?? todayISO());
  const [vto, setVto] = useState(initialData?.vto ?? addDays(todayISO(), 30));
  const [nroComp, setNroComp] = useState(initialData?.nroComp ?? "");
  const [nota, setNota] = useState(initialData?.nota ?? "");
  const { lineas, setLineas, updLinea, addLinea, delLinea } = useLineas(initLineas);

  const ccGroups = useCcGroups(CC_LIST);

  useDeferredEntityLookup({
    initialData, currentId: provId, setId: setProvId, list: proveedores,
    idKey: "proveedorId", nameKey: "proveedor",
  });
  useDeferredEntityLookup({
    initialData, currentId: cuentaId, setId: setCuentaId, list: CUENTAS_GASTO,
    idKey: "cuentaId", nameKey: "cuenta",
  });

  const handleProvChange = useMemo(() => makeFacturaPartyChangeHandler({
    setPartyId: setProvId,
    list: proveedores,
    setCuentaId,
    setMoneda,
    setLineas,
    setVto,
    getFecha: () => fecha,
  }), [proveedores, setLineas, fecha]);

  const { totalSub, totalIva, totalFinal } = useMemo(() => calcLineasTotals(lineas), [lineas]);
  const canSave = facturaCanSave({ partyId: provId, cuentaId, fecha, lineas });

  const buildPayload = (extra = {}) => {
    const prov = proveedores.find(p => p.id === provId);
    const cuenta = CUENTAS_GASTO.find(c => c.id === cuentaId);
    return {
      id: isEdit ? initialData.id : `EG-${Date.now()}`,
      _isEdit: isEdit,
      proveedor: prov?.nombre ?? "—",
      proveedorId: provId,
      cuenta: cuenta?.nombre ?? cuentaId,
      cuentaId,
      cc: lineas.map(l => l.cc).filter(Boolean).join(", ") || "—",
      moneda,
      importe: totalFinal,
      fecha: fecha.split("-").reverse().join("/"),
      vto: vto.split("-").reverse().join("/"),
      nroComp,
      nota,
      lineas,
      estado: "a_pagar",
      ...extra,
    };
  };

  const handleSave = () => runSaveThenMaybeClose(onSave, buildPayload(), asPage, onClose);
  const handleSaveAndPay = () => runSaveThenMaybeClose(onSave, buildPayload({ _saveAndPay: true }), asPage, onClose);

  const prov = proveedores.find(p => p.id === provId);

  const formBody = (
    <div className={FACTURA_FORM_CLASS} style={{ padding: asPage ? 0 : 24 }}>
      <FacturaFormFocusRing />
      <div style={FACTURA_TOP_FIELDS_GRID}>
        <FacturaMaestroCuentaFields
          maestroLabel="Proveedor"
          maestroValue={provId}
          onMaestroChange={handleProvChange}
          maestros={proveedores}
          emptyOption="— Seleccionar proveedor —"
          emptyListHint="Sin proveedores — cargá uno en Maestros"
          cuentaLabel="Cuenta contable"
          cuentaValue={cuentaId}
          onCuentaChange={setCuentaId}
          cuentasFiltradas={CUENTAS_GASTO}
        />
        <SoftField label="Fecha de emisión" required>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={dateStyle} />
        </SoftField>
        <SoftField label="Vencimiento de pago">
          <input type="date" value={vto} onChange={e => setVto(e.target.value)} style={dateStyle} />
          {prov && (
            <div style={{ fontSize: 11, color: T.blue, marginTop: 4, lineHeight: 1.35 }}>
              Sugerido según proveedor · editable
            </div>
          )}
        </SoftField>
        <SoftField label="Moneda">
          <select value={moneda} onChange={e => setMoneda(e.target.value)} style={inputStyle}>
            <option value="ARS">$ ARS</option>
            <option value="USD">U$D</option>
            <option value="EUR">€ EUR</option>
          </select>
        </SoftField>
        <SoftField label="N° comprobante">
          <input value={nroComp} onChange={e => setNroComp(e.target.value)}
            placeholder="FC-A 0001-00001234" style={inputStyle} />
        </SoftField>
      </div>

      <InvoiceLineasTable
        lineas={lineas}
        ccGroups={ccGroups}
        moneda={moneda}
        fmtNum={fmtNum}
        IVA_OPTS={IVA_OPTS}
        updLinea={updLinea}
        delLinea={delLinea}
        addLinea={addLinea}
      />

      <InvoiceNotaYTotales
        nota={nota}
        onNotaChange={setNota}
        totalSub={totalSub}
        totalIva={totalIva}
        totalFinal={totalFinal}
        moneda={moneda}
        fmtNum={fmtNum}
      />
    </div>
  );

  const footerBtns = (
    <InvoiceFormFooter
      asPage={asPage}
      canSave={canSave}
      onClose={onClose}
      onSave={handleSave}
      showSecondary={asPage}
      secondaryAction={{
        label: "Guardar y pagar",
        onClick: handleSaveAndPay,
        outlineColor: EGRESO_SECONDARY_OUTLINE,
      }}
    />
  );

  const title = isEdit ? "Editar factura de proveedor" : "Nueva factura de proveedor";
  const subtitlePage = `Egresos › ${isEdit ? `Editando ${initialData.id}` : "Nueva compra"}`;
  const subtitleModal = isEdit ? `Editando ${initialData.id}` : "Completá los datos y las líneas de imputación";

  return (
    <FacturaFormChrome
      asPage={asPage}
      onClose={onClose}
      headerBg={T.accentDark}
      titleColor={T.accent}
      title={title}
      subtitlePage={subtitlePage}
      subtitleModal={subtitleModal}
      formBody={formBody}
      footer={footerBtns}
    />
  );
}
