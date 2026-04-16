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

export default function NuevoIngresoModal({ onClose, onSave, clientes = [], cuentas = [], centrosCosto, initialData, asPage = false }) {
  const isEdit = !!initialData;
  const CC_LIST = useMemo(() => centrosCosto ?? [], [centrosCosto]);
  const CUENTAS_INGRESO = useMemo(() => {
    return cuentas.filter(c => {
      const t = (c.tipo ?? "").toLowerCase();
      return t === "venta" || t === "ventas" || t === "ingreso" || t === "ingresos";
    });
  }, [cuentas]);

  const resolveCC = useMemo(() => makeCCResolver(CC_LIST), [CC_LIST]);
  const initCliId = lookupId(clientes, "clienteId", "cliente", initialData);
  const initCuentaId = lookupId(CUENTAS_INGRESO, "cuentaId", "cuenta", initialData);
  const initLineas = useMemo(
    () => initialFacturaLineas(initialData, resolveCC),
    [initialData, resolveCC],
  );

  const [cliId, setCliId] = useState(initCliId);
  const [cuentaId, setCuentaId] = useState(initCuentaId);
  const [moneda, setMoneda] = useState(initialData?.moneda ?? "ARS");
  const [fecha, setFecha] = useState(initialData?.fecha ?? todayISO());
  const [vto, setVto] = useState(initialData?.vto ?? addDays(todayISO(), 30));
  const [nroComp, setNroComp] = useState(initialData?.nroComp ?? "");
  const [nota, setNota] = useState(initialData?.nota ?? "");
  const { lineas, setLineas, updLinea, addLinea, delLinea } = useLineas(initLineas);

  const ccGroups = useCcGroups(CC_LIST);

  useDeferredEntityLookup({
    initialData, currentId: cliId, setId: setCliId, list: clientes,
    idKey: "clienteId", nameKey: "cliente",
  });
  useDeferredEntityLookup({
    initialData, currentId: cuentaId, setId: setCuentaId, list: CUENTAS_INGRESO,
    idKey: "cuentaId", nameKey: "cuenta",
  });

  const handleCliChange = useMemo(() => makeFacturaPartyChangeHandler({
    setPartyId: setCliId,
    list: clientes,
    setCuentaId,
    setMoneda,
    setLineas,
  }), [clientes, setLineas]);

  const { totalSub, totalIva, totalFinal } = useMemo(() => calcLineasTotals(lineas), [lineas]);
  const canSave = facturaCanSave({ partyId: cliId, cuentaId, fecha, lineas });

  const buildPayload = (extra = {}) => {
    const cli = clientes.find(c => c.id === cliId);
    const cuenta = CUENTAS_INGRESO.find(c => c.id === cuentaId);
    return {
      id: isEdit ? initialData.id : `IN-${Date.now()}`,
      _isEdit: isEdit,
      cliente: cli?.nombre ?? "—",
      clienteId: cliId,
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
      estado: "a_cobrar",
      ...extra,
    };
  };

  const handleSave = () => runSaveThenMaybeClose(onSave, buildPayload(), asPage, onClose);
  const handleSaveAndCobrar = () => runSaveThenMaybeClose(onSave, buildPayload({ _saveAndCobrar: true }), asPage, onClose);

  const cli = clientes.find(c => c.id === cliId);
  const INGRESO_HEADER_BG = "#1e3a5f";
  const INGRESO_TITLE = "#93c5fd";

  const formBody = (
    <div className={FACTURA_FORM_CLASS} style={{ padding: asPage ? 0 : 24 }}>
      <FacturaFormFocusRing />
      <div style={FACTURA_TOP_FIELDS_GRID}>
        <FacturaMaestroCuentaFields
          maestroLabel="Cliente"
          maestroValue={cliId}
          onMaestroChange={handleCliChange}
          maestros={clientes}
          emptyOption="— Seleccionar cliente —"
          emptyListHint="Sin clientes — cargá uno en Maestros"
          cuentaLabel="Cuenta contable"
          cuentaValue={cuentaId}
          onCuentaChange={setCuentaId}
          cuentasFiltradas={CUENTAS_INGRESO}
        />
        <SoftField label="Fecha de emisión" required>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={dateStyle} />
        </SoftField>
        <SoftField label="Vencimiento de cobro">
          <input type="date" value={vto} onChange={e => setVto(e.target.value)} style={dateStyle} />
          {cli && (
            <div style={{ fontSize: 11, color: T.blue, marginTop: 4, lineHeight: 1.35 }}>
              Sugerido según cliente · editable
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
        stripeColor={INGRESO_HEADER_BG}
        totalPositiveColor={T.blue}
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
        label: "Guardar y cobrar",
        onClick: handleSaveAndCobrar,
        outlineColor: INGRESO_HEADER_BG,
      }}
    />
  );

  const title = isEdit ? "Editar factura de venta" : "Nueva factura de venta";
  const subtitlePage = `Ingresos › ${isEdit ? `Editando ${initialData.id}` : "Nueva venta"}`;
  const subtitleModal = isEdit ? `Editando ${initialData.id}` : "Completá los datos y las líneas de imputación";

  return (
    <FacturaFormChrome
      asPage={asPage}
      onClose={onClose}
      headerBg={INGRESO_HEADER_BG}
      titleColor={INGRESO_TITLE}
      title={title}
      subtitlePage={subtitlePage}
      subtitleModal={subtitleModal}
      formBody={formBody}
      footer={footerBtns}
    />
  );
}
