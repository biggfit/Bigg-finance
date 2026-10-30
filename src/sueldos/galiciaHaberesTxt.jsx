import { useState, useEffect, useRef } from "react";

// ── Galicia Office Banking: archivo de Pago de Haberes (.txt, ancho fijo) ─────
// Replica lo que arma el "Conversor_SNP3.xlsm" del banco (hojas Def-Header / Def-Detalle /
// Def-Trailer): header *H3 + un detalle por empleado + trailer *F, cada línea de 477 caracteres.
// El .txt sale listo para subir: no hace falta pasar por la planilla ni su macro.
// Convive con el Excel "formato Galicia Office" de siempre: el botón Haberes Galicia ofrece los dos.

const LARGO_LINEA = 477;

// Cuentas a debitar por sociedad (pantalla "Datos de cuenta" de Galicia). La cuenta va con sus
// 12 dígitos tal cual: "0005820-7 325-3" → 000582073253. Convenio de Pago de Haberes: fijo acá
// cuando se conoce; si no, lo pide el modal y queda recordado en este navegador.
const CUENTAS_GALICIA = [
  { key: "nako",      match: /nako/,   nombre: "Ñako",      cuit: "30717028305", tipoCuenta: "C", cuenta: "000582073253", convenio: "362050" },
  { key: "hektor",    match: /hektor/, nombre: "Hektor",    cuit: "30714015377", tipoCuenta: "C", cuenta: "000526363251", convenio: "028897" },
  { key: "segui-fit", match: /segui/,  nombre: "Segui Fit", cuit: "30717067769", tipoCuenta: "C", cuenta: "000666463253", convenio: "807212" },
];

const sinAcentos = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const soloDigitos = (s) => String(s ?? "").replace(/\D/g, "");

export function cuentaGaliciaDe(sociedadNombre) {
  const n = sinAcentos(sociedadNombre).toLowerCase();
  return CUENTAS_GALICIA.find(c => c.match.test(n)) || null;
}

// El banco toma ASCII en mayúsculas: sin acentos ni Ñ, sin caracteres raros.
const texto = (s) => sinAcentos(s).toUpperCase().replace(/[^A-Z0-9 .,\-/@_]/g, " ").replace(/\s+/g, " ").trim();
const esp   = (s, n) => texto(s).slice(0, n).padEnd(n, " ");
const ceros = (s, n) => String(s).padStart(n, "0").slice(-n);
const fechaTxt = (iso) => iso.replace(/-/g, "");                  // "2026-10-30" → "20261030"
const centavos = (importe) => Math.round((Number(importe) || 0) * 100);

// Tipo de cuenta crédito del legajo ("CA", "Cta Cte $", "Cuenta corriente"…) → A / C. Sin dato = caja de ahorro.
const tipoCuentaCredito = (s) => /^\s*(cc|c\.?\s*c|cta\.?\s*cte|cuenta\s*corriente)/i.test(sinAcentos(s)) ? "C" : "A";

// filas: [{ nombre, cuil, cbu, tipo_cuenta, importe }]. Devuelve { ok, excluidas } para mostrar
// en el modal quién no entra (sin CUIL o CBU válidos) antes de bajar.
export function validarFilas(filas) {
  const ok = [], excluidas = [];
  for (const f of filas) {
    const cuil = soloDigitos(f.cuil), cbu = soloDigitos(f.cbu);
    const motivos = [];
    if (cuil.length !== 11) motivos.push("sin CUIL");
    if (cbu.length !== 22)  motivos.push("CBU inválido");
    if (!(centavos(f.importe) > 0)) motivos.push("sin monto");
    if (motivos.length) excluidas.push({ ...f, motivo: motivos.join(", ") });
    else ok.push({ ...f, cuil, cbu });
  }
  return { ok, excluidas };
}

export function generarTxtHaberes({ cuenta, convenio, fecha, mes, anio, filas }) {
  const f8 = fechaTxt(fecha);
  const periodo = `${String(mes).padStart(2, "0")}/${anio}`;
  const total = filas.reduce((a, f) => a + centavos(f.importe), 0);
  const header =
    "*H3" +                                  // Pago de Haberes
    ceros(soloDigitos(convenio), 6) +
    cuenta.cuit +
    cuenta.tipoCuenta +
    "1" +                                    // pesos
    ceros(cuenta.cuenta, 12) +
    ceros("", 26) +                          // CBU débito: la macro lo deja en ceros
    ceros(total, 14) +
    f8 +
    esp(`HABERES ${periodo}`, 15) +
    "S";                                     // débito consolidado
  const detalles = filas.map(f =>
    esp(f.nombre, 16) +
    f.cuil +
    f8 +
    tipoCuentaCredito(f.tipo_cuenta) +
    "1" +                                    // moneda crédito pesos
    ceros("", 12) +                          // cuenta crédito: solo si es Galicia; va por CBU
    ceros(f.cbu, 26) +
    "32" +                                   // código de transacción
    "1" +                                    // tipo de pago: haberes
    ceros(centavos(f.importe), 14) +
    esp(`SUELDO ${periodo}`, 15) +
    esp(f.nombre, 22) +                      // identificación interna
    f8 +                                     // fecha de proceso
    "01"                                     // concepto: Acreditamiento Haberes
  );
  const trailer = "*F" + ceros(soloDigitos(convenio), 6) + ceros(filas.length, 7);
  return [header, ...detalles, trailer].map(l => l.padEnd(LARGO_LINEA, " ")).join("\r\n") + "\r\n";
}

function descargarTxt(contenido, nombreArchivo) {
  const blob = new Blob([contenido], { type: "text/plain;charset=us-ascii" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombreArchivo;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const leerConvenio = (key) => { try { return localStorage.getItem(`galicia_convenio_${key}`) || ""; } catch { return ""; } };
const guardarConvenio = (key, v) => { try { localStorage.setItem(`galicia_convenio_${key}`, v); } catch { /* sin storage */ } };

const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const fmt = (n) => (Number(n) || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });

// Modal: confirma convenio + fecha, muestra quién entra / queda afuera y baja el .txt.
// `sociedadNombre` elige la cuenta a debitar; `filas` = [{ nombre, cuil, cbu, tipo_cuenta, importe }].
export function ModalGaliciaTxt({ sociedadNombre, filas, mes, anio, prefijoArchivo, onClose }) {
  const cuenta = cuentaGaliciaDe(sociedadNombre);
  const [convenio, setConvenio] = useState(() => (cuenta ? cuenta.convenio || leerConvenio(cuenta.key) : ""));
  const [fecha, setFecha] = useState(hoyISO);
  const { ok, excluidas } = validarFilas(filas);
  const total = ok.reduce((a, f) => a + (Number(f.importe) || 0), 0);
  const convenioOk = /^\d{1,6}$/.test(convenio.trim());

  const bajar = () => {
    guardarConvenio(cuenta.key, convenio.trim());
    const txt = generarTxtHaberes({ cuenta, convenio: convenio.trim(), fecha, mes, anio, filas: ok });
    descargarTxt(txt, `${prefijoArchivo}_${String(mes).padStart(2, "0")}_${anio}_${cuenta.nombre.replace(/\W+/g, "")}.txt`);
    onClose();
  };

  const lbl = { fontSize: 12, color: "#64748b", display: "block", marginBottom: 4 };
  const inp = { border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 8px", fontSize: 13, width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 10, padding: 20, width: 520, maxWidth: "calc(100vw - 32px)", maxHeight: "85vh", overflow: "auto", fontFamily: "'Inter', system-ui, sans-serif", color: "#1e293b" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Haberes Galicia (.txt nuevo formato)</div>
        {!cuenta ? (
          <div style={{ fontSize: 13, color: "#dc2626", margin: "12px 0" }}>
            No hay cuenta Galicia cargada para la sociedad "{sociedadNombre || "sin sociedad"}". Están Ñako, Hektor y Segui Fit.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
              Debita de {cuenta.nombre} · Cta Cte $ {cuenta.cuenta} · CUIT {cuenta.cuit}
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>N° de convenio (Pago de Haberes)</label>
                {cuenta.convenio
                  ? <div style={{ ...inp, background: "#f8fafc" }}>{cuenta.convenio}</div>
                  : <input style={inp} value={convenio} onChange={e => setConvenio(e.target.value.replace(/\D/g, ""))} placeholder="Ej: 502454" />}
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Fecha de acreditación</label>
                <input style={inp} type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
              </div>
            </div>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              <b>{ok.length}</b> empleados · total <b>{fmt(total)}</b>
            </div>
            {excluidas.length > 0 && (
              <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 6, padding: "8px 10px", fontSize: 12, marginBottom: 8 }}>
                <b>Quedan afuera del archivo ({excluidas.length})</b> — completá el dato en Legajos y volvé a bajarlo:
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {excluidas.map((f, i) => <li key={i}>{f.nombre} · {fmt(f.importe)} — {f.motivo}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button onClick={onClose} style={{ border: "1px solid #e2e8f0", background: "#fff", borderRadius: 6, padding: "7px 14px", cursor: "pointer", fontSize: 13 }}>Cancelar</button>
          {cuenta && (
            <button onClick={bajar} disabled={!convenioOk || !fecha || !ok.length}
              style={{ border: "none", background: (!convenioOk || !fecha || !ok.length) ? "#94a3b8" : "#ea580c", color: "#fff", borderRadius: 6, padding: "7px 14px", cursor: (!convenioOk || !fecha || !ok.length) ? "default" : "pointer", fontSize: 13, fontWeight: 600 }}>
              Descargar .txt
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Botón único "Haberes Galicia": abre un menú (hacia arriba: está al pie) para elegir entre
// sueldos por transferencia (Excel de siempre) o por archivo (.txt nuevo). `grupos` =
// [{ id, titulo?, detalle? }]: con título (Sedes, una entrada por sociedad) el menú muestra
// las dos opciones bajo cada sociedad; HQ pasa un solo grupo sin título.
export function BotonHaberesGalicia({ btnStyle, grupos, vacio, onTransferencia, onArchivo }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const click = () => {
    if (!grupos.length) { alert(vacio); return; }
    setOpen(o => !o);
  };
  const elegir = (fn, id) => { setOpen(false); fn(id); };
  const opcion = { display: "block", width: "100%", padding: "8px 14px", background: "transparent", border: "none",
    cursor: "pointer", fontSize: 13, color: "#1e293b", fontFamily: "'Inter', system-ui, sans-serif", textAlign: "left" };
  const hover = { onMouseEnter: e => e.currentTarget.style.background = "#f3f4f6", onMouseLeave: e => e.currentTarget.style.background = "transparent" };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button style={btnStyle} onClick={click}>📥 Haberes Galicia ▾</button>
      {open && (
        <div style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, zIndex: 50, minWidth: 280,
          background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.15)", overflow: "hidden" }}>
          {grupos.map((g, i) => (
            <div key={g.id} style={{ borderTop: i ? "1px solid #e2e8f0" : "none" }}>
              {g.titulo && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "8px 14px 2px", fontSize: 12 }}>
                  <strong>{g.titulo}</strong><span style={{ color: "#64748b" }}>{g.detalle}</span>
                </div>
              )}
              <button style={opcion} {...hover} onClick={() => elegir(onTransferencia, g.id)}>Sueldos por transferencia</button>
              <button style={opcion} {...hover} onClick={() => elegir(onArchivo, g.id)}>Sueldos por archivo</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
