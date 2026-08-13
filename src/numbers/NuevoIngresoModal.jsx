import { useState, useMemo } from "react";
import { T } from "./theme";
import { checkDuplicateComp } from "../lib/numbersApi";
import { todayISO, addDays, fmtNum } from "../data/numbersData";
import { MONEDA_OPTS, monedaDeSociedad, ivaOptsDeSociedad, ivaDefaultDeSociedad } from "../data/tesoreriaData";
import {
  inputStyle, dateStyle, lookupId, makeCCResolver,
  calcLineasTotals, SoftField, FacturaFormFocusRing, FACTURA_FORM_CLASS,
  InvoiceLineasTable, InvoiceNotaYTotales, InvoiceFormFooter,
  useCcGroups, initialFacturaLineas, facturaCanSave, runSaveThenMaybeClose,
  useDeferredEntityLookup, makeFacturaPartyChangeHandler, FACTURA_TOP_FIELDS_GRID,
  FacturaMaestroCuentaFields, FacturaFormChrome, useNroCompMask,
} from "./formUtils";
import { ClienteModal, CuentaModal } from "./PantallaMaestros";
import { useLineas } from "./useLineas";

export default function NuevoIngresoModal({ onClose, onSave, sociedad, clientes = [], cuentas = [], centrosCosto, initialData, asPage = false, onCrearCliente, onCrearCuenta }) {
  const [crearCliOpen, setCrearCliOpen] = useState(false);
  const [crearCuentaOpen, setCrearCuentaOpen] = useState(false);
  // _duplicate: precarga la data de otra factura pero como NUEVA (id nuevo, sin borrar la original).
  const isEdit = !!initialData && !initialData._duplicate;
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
  // Alicuotas del pais de la sociedad: la general es el default de cada linea nueva.
  const ivaOpts    = useMemo(() => ivaOptsDeSociedad(sociedad), [sociedad]);
  const ivaDefault = useMemo(() => ivaDefaultDeSociedad(sociedad), [sociedad]);
  const initLineas = useMemo(
    () => initialFacturaLineas(initialData, resolveCC, ivaDefault),
    [initialData, resolveCC, ivaDefault],
  );

  const [cliId, setCliId] = useState(initCliId);
  const [cuentaId, setCuentaId] = useState(initCuentaId);
  const [moneda, setMoneda] = useState(initialData?.moneda ?? monedaDeSociedad(sociedad));
  const [fecha, setFecha] = useState(initialData?.fecha ?? todayISO());
  const [vto, setVto] = useState(initialData?.vto ?? addDays(todayISO(), 30));
  const [nroComp, setNroComp] = useState(initialData?.nroComp ?? "");
  const nroMask = useNroCompMask(nroComp, setNroComp);
  const [nota, setNota] = useState(initialData?.nota ?? "");
  const { lineas, setLineas, updLinea, addLinea, delLinea } = useLineas(initLineas, ivaDefault);

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
    ivaDefault,
  }), [clientes, setLineas, ivaDefault]);

  const { totalSub, totalIva, totalFinal } = useMemo(() => calcLineasTotals(lineas), [lineas]);
  const canSave = facturaCanSave({ partyId: cliId, cuentaId, fecha, lineas });

  const [dupError, setDupError] = useState(null);
  useMemo(() => setDupError(null), [nroComp, cliId]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildPayload = (extra = {}) => {
    const cli = clientes.find(c => c.id === cliId);
    const cuenta = CUENTAS_INGRESO.find(c => c.id === cuentaId);
    return {
      id: isEdit ? initialData.id : `IN-${Date.now()}`,
      sociedad,                       // desde la prop → la FC se guarda con la sociedad activa (blinda TODOS
                                      // los callers: Conciliación llamaba appendIngreso(payload) sin inyectarla)
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

  const handleSave = async () => {
    const dup = await checkDuplicateComp(sociedad, "INGRESO", nroComp, cliId, isEdit ? initialData.id : null);
    if (dup) { setDupError(dup); return; }
    runSaveThenMaybeClose(onSave, buildPayload(), asPage, onClose);
  };
  const handleSaveAndCobrar = async () => {
    const dup = await checkDuplicateComp(sociedad, "INGRESO", nroComp, cliId, isEdit ? initialData.id : null);
    if (dup) { setDupError(dup); return; }
    runSaveThenMaybeClose(onSave, buildPayload({ _saveAndCobrar: true }), asPage, onClose);
  };

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
          onCrearMaestro={onCrearCliente ? () => setCrearCliOpen(true) : undefined}
          cuentaLabel="Cuenta contable"
          cuentaValue={cuentaId}
          onCuentaChange={setCuentaId}
          cuentasFiltradas={CUENTAS_INGRESO}
          onCrearCuenta={onCrearCuenta ? () => setCrearCuentaOpen(true) : undefined}
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
            {MONEDA_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </SoftField>
        <SoftField label="N° comprobante">
          <input ref={nroMask.ref} value={nroComp} onChange={nroMask.onChange}
            placeholder="FC-A 0001-00001234"
            style={{ ...inputStyle, ...(dupError ? { borderColor: "#dc2626", background: "#fef2f2" } : {}) }} />
          {dupError && (
            <div style={{ marginTop: 5, fontSize: 11, color: "#dc2626", fontWeight: 700,
              background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6,
              padding: "5px 10px", lineHeight: 1.4 }}>
              ⚠️ Ya existe una FC con este número para este cliente ({dupError}).
              Verificá si es un duplicado o cambiá el N° de comprobante.
            </div>
          )}
        </SoftField>
      </div>

      <InvoiceLineasTable
        lineas={lineas}
        ccGroups={ccGroups}
        moneda={moneda}
        fmtNum={fmtNum}
        IVA_OPTS={ivaOpts}
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
    <>
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
      {crearCliOpen && (
        <ClienteModal cuentas={cuentas} centrosCosto={centrosCosto}
          onClose={() => setCrearCliOpen(false)}
          onSave={async (form) => { const id = await onCrearCliente?.(form); if (id) setCliId(id); }} />
      )}
      {crearCuentaOpen && (
        <CuentaModal onClose={() => setCrearCuentaOpen(false)}
          onSave={async (form) => { const id = await onCrearCuenta?.(form); if (id) setCuentaId(id); }} />
      )}
    </>
  );
}
