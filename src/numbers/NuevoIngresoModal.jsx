import { useState, useMemo } from "react";
import { T, Btn, Input, Select } from "./theme";
import { CENTROS_COSTO, CUENTAS, CLIENTES_SEED, CUENTAS_ACTIVO, validarCuentaCC } from "../data/numbersData";

const STEPS = [
  { id: 1, label: "Tipo"       },
  { id: 2, label: "Cliente"    },
  { id: 3, label: "Imputación" },
  { id: 4, label: "Detalle"    },
  { id: 5, label: "Cobro"      },
];

const TIPOS_OP = [
  { id:"ingreso_cobrado",   label:"Cobré un ingreso",          desc:"El dinero ya ingresó a la cuenta bancaria.",        icon:"💰" },
  { id:"ingreso_pendiente", label:"Tengo un cobro pendiente",  desc:"Registrar factura emitida no cobrada todavía.",     icon:"📄" },
];

const BANCOS_SAMPLE = [
  "Banco Galicia ARS",
  "Banco Galicia USD",
  "BBVA ARS",
  "Mercado Pago ARS",
];

// ─── Step bar ────────────────────────────────────────────────────────────────
function StepBar({ current }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:0, marginBottom:28 }}>
      {STEPS.map((s, i) => {
        const done   = s.id < current;
        const active = s.id === current;
        return (
          <div key={s.id} style={{ display:"flex", alignItems:"center", flex: i < STEPS.length-1 ? 1 : "none" }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
              <div style={{
                width:30, height:30, borderRadius:"50%", fontSize:11, fontWeight:800,
                display:"flex", alignItems:"center", justifyContent:"center",
                background: done ? T.green : active ? T.accentDark : "#e5e7eb",
                color:       done ? "#fff"  : active ? T.accent    : T.dim,
                border:      active ? `2px solid ${T.accentDark}` : "2px solid transparent",
                flexShrink:0,
              }}>
                {done ? "✓" : s.id}
              </div>
              <span style={{ fontSize:10, color: active ? T.text : T.dim, fontWeight: active ? 700 : 400, whiteSpace:"nowrap" }}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length-1 && (
              <div style={{ flex:1, height:2, background: done ? T.green : "#e5e7eb",
                margin:"0 4px", marginBottom:16 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Tipo ─────────────────────────────────────────────────────────────
function Step1({ form, set }) {
  return (
    <div>
      <h3 style={{ fontSize:15, fontWeight:800, color:T.text, margin:"0 0 6px" }}>¿Qué querés registrar?</h3>
      <p style={{ fontSize:13, color:T.muted, margin:"0 0 20px" }}>Elegí el tipo de ingreso — el sistema hace el resto.</p>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {TIPOS_OP.map(t => (
          <button key={t.id} onClick={()=>set("tipoOp", t.id)} style={{
            background: form.tipoOp === t.id ? "#eff6ff" : T.card,
            border: `2px solid ${form.tipoOp === t.id ? T.blue : T.cardBorder}`,
            borderRadius:10, padding:"14px 18px", cursor:"pointer",
            display:"flex", alignItems:"center", gap:14, textAlign:"left", transition:"all .12s",
          }}>
            <span style={{ fontSize:22 }}>{t.icon}</span>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:T.text }}>{t.label}</div>
              <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>{t.desc}</div>
            </div>
            {form.tipoOp === t.id && <span style={{ marginLeft:"auto", color:T.blue, fontWeight:800 }}>✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step 2: Cliente ──────────────────────────────────────────────────────────
function Step2({ form, set }) {
  const [nuevoMode, setNuevoMode] = useState(false);
  return (
    <div>
      <h3 style={{ fontSize:15, fontWeight:800, color:T.text, margin:"0 0 6px" }}>¿De quién es el ingreso?</h3>
      <p style={{ fontSize:13, color:T.muted, margin:"0 0 20px" }}>Seleccioná un cliente existente o cargá uno nuevo.</p>

      {!nuevoMode ? (
        <>
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16 }}>
            {CLIENTES_SEED.map(c => (
              <button key={c.id} onClick={()=>{ set("clienteId", c.id); set("clienteNombre", c.nombre); set("cuenta", c.cuentaDefault); set("cc", c.ccDefault); }} style={{
                background: form.clienteId === c.id ? "#eff6ff" : T.card,
                border:`2px solid ${form.clienteId === c.id ? T.blue : T.cardBorder}`,
                borderRadius:10, padding:"12px 16px", cursor:"pointer",
                display:"flex", alignItems:"center", gap:12, textAlign:"left", transition:"all .12s",
              }}>
                <div style={{ width:36, height:36, borderRadius:8, background: form.clienteId===c.id ? "#dbeafe" : "#f3f4f6",
                  display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>
                  🏢
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:T.text }}>{c.nombre}</div>
                  <div style={{ fontSize:11, color:T.muted }}>{c.cuit || "Sin CUIT"} · {c.nota}</div>
                </div>
                {form.clienteId === c.id && <span style={{ color:T.blue, fontWeight:800, fontSize:16 }}>✓</span>}
              </button>
            ))}
          </div>
          <button onClick={()=>setNuevoMode(true)} style={{
            background:"transparent", border:`1.5px dashed ${T.cardBorder}`,
            borderRadius:10, padding:"10px 16px", cursor:"pointer",
            fontSize:13, color:T.muted, fontFamily:T.font, width:"100%",
            display:"flex", alignItems:"center", justifyContent:"center", gap:8,
          }}>
            + Agregar cliente nuevo
          </button>
        </>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <Input label="Nombre / Razón Social" required value={form.nuevoCliNombre ?? ""} onChange={v=>set("nuevoCliNombre",v)} placeholder="Ej: Empresa SA" />
          <Input label="CUIT / DNI" value={form.nuevoCliCuit ?? ""} onChange={v=>set("nuevoCliCuit",v)} placeholder="30-00000000-0" />
          <Select label="Moneda habitual" value={form.nuevoCliMoneda ?? "ARS"} onChange={v=>set("nuevoCliMoneda",v)}
            options={[{value:"ARS",label:"ARS — Pesos"},{value:"USD",label:"USD — Dólares"},{value:"EUR",label:"EUR — Euros"}]} />
          <div style={{ display:"flex", gap:10, marginTop:4 }}>
            <Btn variant="ghost" onClick={()=>setNuevoMode(false)}>← Volver</Btn>
            <Btn variant="primary" onClick={()=>{ set("clienteId","nuevo"); set("clienteNombre", form.nuevoCliNombre ?? "Nuevo"); setNuevoMode(false); }}>
              Usar este cliente
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step 3: Cuenta + CC ─────────────────────────────────────────────────────
function Step3({ form, set }) {
  const cuentasIngreso = CUENTAS.filter(c => c.tipo === "ingreso");
  const ccPermitidos = useMemo(() => {
    if (!form.cuenta) return CENTROS_COSTO;
    const c = CUENTAS.find(x => x.id === form.cuenta);
    if (!c?.centrosCostoPermitidos) return CENTROS_COSTO;
    return CENTROS_COSTO.filter(cc => c.centrosCostoPermitidos.includes(cc.id));
  }, [form.cuenta]);

  const validacion = form.cuenta && form.cc ? validarCuentaCC(form.cuenta, form.cc) : null;

  return (
    <div>
      <h3 style={{ fontSize:15, fontWeight:800, color:T.text, margin:"0 0 6px" }}>¿Qué tipo de ingreso es?</h3>
      <p style={{ fontSize:13, color:T.muted, margin:"0 0 20px" }}>Elegí la categoría y el centro de costo donde se imputa.</p>

      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        <Select label="Categoría de ingreso" required value={form.cuenta ?? ""} onChange={v=>{ set("cuenta",v); set("cc",""); }}
          options={cuentasIngreso.map(c=>({ value:c.id, label:c.nombre }))} />

        <Select label="Centro de costo" required value={form.cc ?? ""} onChange={v=>set("cc",v)}
          options={[
            { value:"__marca", label:"── Marca / HQ ──", disabled:true },
            ...CENTROS_COSTO.filter(c=>c.grupo==="marca").map(c=>({ value:c.id, label:c.nombre })),
            { value:"__ops",   label:"── Sedes Operativas ──", disabled:true },
            ...CENTROS_COSTO.filter(c=>c.grupo==="operaciones").map(c=>({ value:c.id, label:c.nombre })),
          ]} />

        {validacion === "advertencia" && (
          <div style={{ background:"#fffbeb", border:"1px solid #fcd34d", borderRadius:8,
            padding:"10px 14px", fontSize:12, color:"#92400e",
            display:"flex", alignItems:"flex-start", gap:8 }}>
            <span style={{ fontSize:16 }}>⚠️</span>
            <div>
              <strong>Combinación poco habitual</strong> — esta cuenta no suele usarse con ese centro de costo según el histórico.
              <br/>Podés continuar igual si es correcto.
            </div>
          </div>
        )}

        {form.clienteId && !form.cuenta && (
          <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:8,
            padding:"10px 14px", fontSize:12, color:"#1e40af" }}>
            💡 Sugerencia basada en el cliente: <strong>
              {CUENTAS.find(c=>c.id===CLIENTES_SEED.find(cl=>cl.id===form.clienteId)?.cuentaDefault)?.nombre ?? "—"}
            </strong>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 4: Detalle ─────────────────────────────────────────────────────────
function Step4({ form, set }) {
  return (
    <div>
      <h3 style={{ fontSize:15, fontWeight:800, color:T.text, margin:"0 0 6px" }}>Detalle del comprobante</h3>
      <p style={{ fontSize:13, color:T.muted, margin:"0 0 20px" }}>Completá los datos de la factura o comprobante emitido.</p>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        <Select label="Moneda" required value={form.moneda ?? "ARS"} onChange={v=>set("moneda",v)}
          options={[{value:"ARS",label:"$ ARS — Pesos"},{value:"USD",label:"U$D USD"},{value:"EUR",label:"€ EUR"}]} />
        <Input label="Importe" required type="number" value={form.importe ?? ""} onChange={v=>set("importe",v)} placeholder="0,00" />
        <Input label="Fecha de emisión" required type="date" value={form.fecha ?? ""} onChange={v=>set("fecha",v)} />
        <Input label="Fecha de vencimiento" type="date" value={form.vto ?? ""} onChange={v=>set("vto",v)} />
        <div style={{ gridColumn:"1/-1" }}>
          <Input label="N° de comprobante" value={form.nroComp ?? ""} onChange={v=>set("nroComp",v)} placeholder="FC-A 0001-00001234" />
        </div>
        <div style={{ gridColumn:"1/-1" }}>
          <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>Descripción / Nota interna</label>
          <textarea value={form.descripcion ?? ""} onChange={e=>set("descripcion",e.target.value)}
            placeholder="Detalle adicional del ingreso..."
            style={{ width:"100%", background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
              borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
              fontFamily:T.font, outline:"none", resize:"vertical", minHeight:72, boxSizing:"border-box" }} />
        </div>
      </div>
    </div>
  );
}

// ─── Step 5: Cobro ────────────────────────────────────────────────────────────
function Step5({ form, set }) {
  const esCobrado   = form.tipoOp === "ingreso_cobrado";
  const esPendiente = form.tipoOp === "ingreso_pendiente";

  return (
    <div>
      <h3 style={{ fontSize:15, fontWeight:800, color:T.text, margin:"0 0 6px" }}>
        {esCobrado ? "¿En qué cuenta entró el dinero?" : "¿Cómo está registrado el cobro?"}
      </h3>
      <p style={{ fontSize:13, color:T.muted, margin:"0 0 20px" }}>
        {esCobrado
          ? "Indicá la cuenta bancaria donde se acreditó el cobro."
          : "Se registrará como Cuenta a Cobrar (Activo) hasta que se acredite."}
      </p>

      {esCobrado && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {BANCOS_SAMPLE.map(b=>(
            <button key={b} onClick={()=>set("banco",b)} style={{
              background: form.banco===b ? "#eff6ff" : T.card,
              border:`2px solid ${form.banco===b ? T.blue : T.cardBorder}`,
              borderRadius:10, padding:"12px 16px", cursor:"pointer",
              display:"flex", alignItems:"center", gap:12, textAlign:"left", transition:"all .12s",
            }}>
              <span style={{ fontSize:18 }}>🏦</span>
              <span style={{ fontSize:13, fontWeight:600, color:T.text }}>{b}</span>
              {form.banco===b && <span style={{ marginLeft:"auto", color:T.blue, fontWeight:800 }}>✓</span>}
            </button>
          ))}
        </div>
      )}

      {esPendiente && (
        <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:10,
          padding:"14px 18px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <span style={{ fontSize:24 }}>📥</span>
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:T.text }}>Cuentas a Cobrar</div>
              <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>
                El sistema registrará este ingreso como pendiente de cobro (Activo).
                Cuando se acredite el pago, lo marcás como cobrado.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Resumen */}
      {((esCobrado && form.banco) || esPendiente) && (
        <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:10,
          padding:"14px 18px", marginTop:20 }}>
          <div style={{ fontSize:12, fontWeight:700, color:T.blue, marginBottom:10,
            letterSpacing:".06em", textTransform:"uppercase" }}>Resumen del asiento</div>
          <div style={{ fontSize:12, color:T.muted, display:"flex", flexDirection:"column", gap:6 }}>
            <div style={{ display:"flex", justifyContent:"space-between" }}>
              <span>Débito ({esCobrado ? "banco" : "cobro pendiente"})</span>
              <span style={{ fontWeight:600, color:T.text }}>
                {esCobrado ? form.banco : "Cuentas a Cobrar"}
              </span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between" }}>
              <span>Crédito (ingreso)</span>
              <span style={{ fontWeight:600, color:T.text }}>
                {CUENTAS.find(c=>c.id===form.cuenta)?.nombre ?? "—"}
              </span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", paddingTop:6,
              borderTop:`1px solid #bfdbfe`, fontWeight:800, color:T.text }}>
              <span>Importe</span>
              <span>{form.moneda} {Number(form.importe||0).toLocaleString("es-AR",{minimumFractionDigits:2})}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────
export default function NuevoIngresoModal({ onClose, onSave }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ moneda:"ARS", tipoOp:"", clienteId:"", cuenta:"", cc:"", banco:"" });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const canNext = useMemo(() => {
    if (step===1) return !!form.tipoOp;
    if (step===2) return !!form.clienteId;
    if (step===3) return !!form.cuenta && !!form.cc;
    if (step===4) return !!form.importe && !!form.fecha;
    if (step===5) return form.tipoOp==="ingreso_cobrado" ? !!form.banco : true;
    return false;
  }, [step, form]);

  const handleSave = () => {
    onSave?.({ ...form, id: `IN-${Date.now()}` });
    onClose();
  };

  const stepComponents = {
    1: <Step1 form={form} set={set}/>,
    2: <Step2 form={form} set={set}/>,
    3: <Step3 form={form} set={set}/>,
    4: <Step4 form={form} set={set}/>,
    5: <Step5 form={form} set={set}/>,
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:400,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.bg, borderRadius:14, width:540,
        maxWidth:"97vw", maxHeight:"90vh", display:"flex", flexDirection:"column",
        overflow:"hidden", boxShadow:"0 20px 60px rgba(0,0,0,.25)" }}
        onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{ background:"#1e3a5f", padding:"18px 24px", display:"flex",
          justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:16, fontWeight:900, color:"#93c5fd" }}>Nuevo Ingreso</div>
            <div style={{ fontSize:12, color:"rgba(147,197,253,.5)", marginTop:2 }}>
              {STEPS[step-1]?.label} — paso {step} de {STEPS.length}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.4)", fontSize:18, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:"auto", padding:"24px 24px 0" }}>
          <StepBar current={step} />
          {stepComponents[step]}
        </div>

        {/* Footer */}
        <div style={{ padding:"16px 24px", borderTop:`1px solid ${T.cardBorder}`,
          display:"flex", justifyContent:"space-between", alignItems:"center",
          background:T.card }}>
          <Btn variant="ghost" onClick={step===1 ? onClose : ()=>setStep(s=>s-1)}>
            {step===1 ? "Cancelar" : "← Atrás"}
          </Btn>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <span style={{ fontSize:11, color:T.dim }}>{step}/{STEPS.length}</span>
            {step < STEPS.length
              ? <Btn variant="primary" onClick={()=>setStep(s=>s+1)} disabled={!canNext}>Siguiente →</Btn>
              : <Btn variant="accent" onClick={handleSave} disabled={!canNext}>Guardar ingreso ✓</Btn>
            }
          </div>
        </div>
      </div>
    </div>
  );
}
