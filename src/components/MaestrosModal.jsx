import { useState, useRef } from "react";
import React from "react";
import { COMP_TYPES, CURRENCIES } from "../lib/helpers";

// ─── SHARED FIELD COMPONENTS (defined at module scope — no remount on rerender) ─
export function CountryGroup({ country, sedes, activeFrId, openFr, startOpen }) {
  const hasActive = sedes.some(fr => fr.id === activeFrId);
  const isTodas = country === "Todas";
  const [open, setOpen] = React.useState(startOpen !== undefined ? startOpen : hasActive);
  return (
    <div style={{ marginBottom: isTodas ? 6 : 2 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"4px 8px", borderRadius:5, fontSize:10, fontWeight:700,
        letterSpacing:".07em",
        color: isTodas ? "var(--text)" : "var(--muted)",
        background: "transparent",
        border: "none",
        cursor:"pointer", textAlign:"left",
      }}>
        <span>{isTodas ? "TODAS" : country.toUpperCase()} ({sedes.length})</span>
        <span style={{ opacity:.5 }}>{open ? "−" : "+"}</span>
      </button>
      {isTodas && <div style={{ height:1, background:"var(--border2)", margin:"4px 0 2px" }} />}
      {open && sedes.map(fr => (
        <button key={fr.id} onClick={() => openFr(fr)}
          style={{ display:"block", width:"100%", padding:"5px 10px 5px 16px", borderRadius:6, fontSize:11,
            fontWeight: activeFrId === fr.id ? 700 : 400,
            background: activeFrId === fr.id ? "rgba(173,255,25,.1)" : "transparent",
            color: activeFrId === fr.id ? "var(--accent)" : fr.activa !== false ? "var(--text)" : "var(--muted)",
            border:"none", cursor:"pointer", textAlign:"left",
            textDecoration: fr.activa !== false ? "none" : "line-through" }}>
          {fr.name}
        </button>
      ))}
    </div>
  );
}

export function AccordionSection({ label, open, onToggle, accent, children }) {
  return (
    <div style={{ marginBottom:8, border:"1px solid var(--border2)", borderRadius:10, overflow:"hidden" }}>
      <button onClick={onToggle} style={{
        width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"11px 16px", background: open ? "rgba(255,255,255,.04)" : "transparent",
        border:"none", cursor:"pointer", textAlign:"left",
        borderBottom: open ? "1px solid var(--border2)" : "none",
      }}>
        <span style={{ fontSize:11, fontWeight:800, letterSpacing:".1em", color: accent || "var(--accent)" }}>
          {label.toUpperCase()}
        </span>
        <span style={{ fontSize:12, color:"var(--muted)", fontWeight:700 }}>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div style={{ padding:"16px" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// CustomSelect: position:fixed calculado desde getBoundingClientRect para escapar overflow
export function CustomSelect({ value, onChange, opts, style: extStyle }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ top:0, left:0, width:0 });
  const triggerRef = React.useRef(null);
  const dropRef = React.useRef(null);

  const openDropdown = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    setOpen(o => !o);
  };

  React.useEffect(() => {
    if (!open) return;
    const close = e => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        dropRef.current && !dropRef.current.contains(e.target)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const base = {
    padding:"7px 10px", borderRadius:6, fontSize:12,
    background: open ? "var(--card)" : "var(--bg)",
    border: open ? "1px solid var(--accent)" : "1px solid var(--border2)",
    color:"var(--text)", width:"100%", boxSizing:"border-box", ...extStyle,
  };

  return (
    <div ref={triggerRef} style={{ position:"relative", width:"100%" }}>
      <div onClick={openDropdown}
        style={{ ...base, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"space-between", userSelect:"none" }}>
        <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {value || <span style={{ color:"var(--muted)" }}>—</span>}
        </span>
        <span style={{ fontSize:10, color:"var(--muted)", marginLeft:10, flexShrink:0, transform: open ? "rotate(180deg)" : "none", transition:"transform .15s" }}>▾</span>
      </div>
      {open && (
        <div ref={dropRef} style={{
          position:"fixed",
          top: pos.top,
          left: pos.left,
          width: pos.width,
          zIndex: 9999,
          background:"#1e2226",
          border:"1px solid var(--border2)",
          borderRadius:8,
          boxShadow:"0 12px 32px rgba(0,0,0,.7)",
          maxHeight: Math.min(opts.length * 37 + 8, 400),
          overflowY:"auto",
          padding:"4px 0",
        }}>
          {opts.map(o => (
            <div key={o} onClick={() => { onChange(o); setOpen(false); }}
              style={{
                padding:"9px 14px", fontSize:12, cursor:"pointer", lineHeight:1.3,
                background: o === value ? "rgba(173,255,25,.1)" : "transparent",
                color: o === value ? "var(--accent)" : "var(--text)",
                fontWeight: o === value ? 700 : 400,
                borderLeft: o === value ? "2px solid var(--accent)" : "2px solid transparent",
              }}
              onMouseEnter={e => { if (o !== value) e.currentTarget.style.background = "rgba(255,255,255,.06)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = o === value ? "rgba(173,255,25,.1)" : "transparent"; }}>
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FieldInput({ label, value, onChange, type="text", opts=null, half=false, textarea=false }) {
  const style = { padding:"7px 10px", borderRadius:6, fontSize:12, background:"var(--bg)", border:"1px solid var(--border2)", color:"var(--text)", width:"100%", boxSizing:"border-box" };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4, gridColumn: half ? "auto" : "1 / -1" }}>
      <label style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:".07em" }}>{label}</label>
      {opts
        ? <CustomSelect value={value ?? ""} onChange={onChange} opts={opts} />
        : textarea
          ? <textarea value={value ?? ""} onChange={e => onChange(e.target.value)} rows={3} style={{ ...style, resize:"vertical" }} />
          : type === "checkbox"
            ? <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, cursor:"pointer" }}>
                <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)}
                  style={{ accentColor:"var(--accent)", width:14, height:14 }} />
                <span style={{ color:"var(--muted)" }}>{label}</span>
              </label>
            : <input type={type} value={value ?? ""} onChange={e => onChange(e.target.value)} style={style} />
      }
    </div>
  );
}

// DateInput: valida dd/mm/aaaa, autocompleta cero en dia/mes al salir del campo
export function DateInput({ label, value, onChange, half=false }) {
  const [err, setErr] = React.useState(false);
  const inputStyle = {
    padding:"8px 12px", borderRadius:6, fontSize:13, width:"100%", boxSizing:"border-box",
    background:"var(--bg)", color:"var(--text)",
    border: err ? "1px solid var(--red)" : "1px solid var(--border2)",
  };
  const handleBlur = e => {
    let v = e.target.value.trim();
    if (!v) { setErr(false); return; }
    // Autocompletar ceros: si el dia o mes es de 1 digito separado por /
    const parts = v.split("/");
    if (parts.length === 3) {
      parts[0] = parts[0].padStart(2, "0");
      parts[1] = parts[1].padStart(2, "0");
      v = parts.join("/");
    }
    // Validar dd/mm/aaaa
    const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) { setErr(true); return; }
    const d = parseInt(m[1]), mo = parseInt(m[2]), y = parseInt(m[3]);
    const valid = mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100;
    setErr(!valid);
    if (valid) onChange(v); else onChange(v);
  };
  const handleKeyDown = e => { if (e.key === "Enter") e.target.blur(); };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4, gridColumn: half ? "auto" : "1 / -1" }}>
      <label style={{ fontSize:10, color: err ? "var(--red)" : "var(--muted)", fontWeight:700, letterSpacing:".07em" }}>
        {label}{err ? "  formato dd/mm/aaaa" : ""}
      </label>
      <input value={value ?? ""} placeholder="dd/mm/aaaa"
        onChange={e => { setErr(false); onChange(e.target.value); }}
        onBlur={handleBlur} onKeyDown={handleKeyDown}
        style={inputStyle} />
    </div>
  );
}

const COND_IVA_AR   = ["Responsable Inscripto","Monotributo","Exento","Consumidor Final"];
const SOCIEDAD_OPTS = ["ÑAKO SRL", "BIGG FIT LLC"];

const EMPTY_FR_BUF = {
  name:"", razonSocial:"", cuit:"", condIVA:"Responsable Inscripto",
  sociedad:"ÑAKO SRL", currency:"ARS", currencies:["ARS"], country:"Argentina",
  applyIVA:true, paysFee:true, activa:true,
  feeImporte:"", feeMoneda:"ARS",
  contrato:"", fechaInicio:"", fechaVto:"", fechaApertura:"", aniosContrato:"",
  renovacionAuto:false, periodoRenovacion:"1 año",
  royaltyPct:"", fondoPublicidadPct:"", territorioCoberturaExclusiva:"", clausulasEspeciales:"",
  titular:"", emailFactura:"", emailComercial:"", telefonoTitular:"", telefonoAdm:"",
  domicilio:"", localidad:"", provincia:"", cp:"",
  contactoAdm:"", emailAdm:"",
  ptaVenta:"", condPago:"10 dias", cbu:"", banco:"", alias:"", notaFactura:"",
  billingAddress:"", billingCity:"", billingState:"", billingZip:"",
  taxExempt:false, paymentTerms:"Net 30",
  noteGeneral:"",
  biggEyeId:"",
};

export function frToBuf(fr) {
  return {
    name:            fr.name            ?? "",
    razonSocial:     fr.razonSocial     ?? "",
    cuit:            fr.cuit            ?? "",
    condIVA:         fr.condIVA         ?? "Responsable Inscripto",
    sociedad:        fr.sociedad        ?? "ÑAKO SRL",
    currency:        fr.moneda          ?? fr.currency ?? "ARS",
    country:         fr.country         ?? "Argentina",
    applyIVA:        fr.applyIVA        ?? true,
    paysFee:         fr.paysFee         ?? true,
    activa:          fr.activa          !== false,
    feeImporte:      fr.feeImporte      ?? "",
    feeMoneda:       fr.feeMoneda       ?? fr.moneda ?? "ARS",
    contrato:        fr.contrato        ?? "",
    fechaInicio:     fr.fechaInicio     ?? "",
    fechaVto:        fr.fechaVto        ?? "",
    renovacionAuto:  fr.renovacionAuto  ?? false,
    periodoRenovacion: fr.periodoRenovacion ?? "1 año",
    royaltyPct:      fr.royaltyPct      ?? "",
    fondoPublicidadPct: fr.fondoPublicidadPct ?? "",
    territorioCoberturaExclusiva: fr.territorioCoberturaExclusiva ?? "",
    clausulasEspeciales: fr.clausulasEspeciales ?? "",
    titular:         fr.titular         ?? "",
    emailFactura:    fr.emailFactura    ?? "",
    emailComercial:  fr.emailComercial  ?? "",
    telefonoTitular: fr.telefonoTitular ?? "",
    telefonoAdm:     fr.telefonoAdm     ?? "",
    domicilio:       fr.domicilio       ?? "",
    localidad:       fr.localidad       ?? "",
    provincia:       fr.provincia       ?? "",
    cp:              fr.cp              ?? "",
    contactoAdm:     fr.contactoAdm     ?? "",
    emailAdm:        fr.emailAdm        ?? "",
    ptaVenta:        fr.ptaVenta        ?? "",
    condPago:        fr.condPago        ?? "10 dias",
    diasVto:         fr.diasVto         ?? "30",
    cbu:             fr.cbu             ?? "",
    banco:           fr.banco           ?? "",
    alias:           fr.alias           ?? "",
    notaFactura:     fr.notaFactura     ?? "",
    billingAddress:  fr.billingAddress  ?? "",
    billingCity:     fr.billingCity     ?? "",
    billingState:    fr.billingState    ?? "",
    billingZip:      fr.billingZip      ?? "",
    taxExempt:       fr.taxExempt       ?? false,
    fechaApertura:   fr.fechaApertura   ?? "",
    aniosContrato:   fr.aniosContrato   ?? "",
    paymentTerms:    fr.paymentTerms    ?? "Net 30",
    noteGeneral:     fr.noteGeneral     ?? "",
    biggEyeId:       fr.biggEyeId  != null ? String(fr.biggEyeId)  : "",
    currencies:      Array.isArray(fr.currencies) && fr.currencies.length > 0
                       ? fr.currencies
                       : [fr.moneda ?? fr.currency ?? "ARS"],
  };
}

export default function MaestrosModal({ franchises, franchisor, comps, onSaveFr, onAddFr, onDeleteFr, onSaveFranchisor, onClose }) {
  const [topSection,  setTopSection]  = useState(null);
  const [biggSub,     setBiggSub]     = useState(null);
  const [activeFrId,  setActiveFrId]  = useState(null);
  const [sedesOpen,   setSedesOpen]   = useState(false);
  const [buf,         setBuf]         = useState(EMPTY_FR_BUF);
  const [fbufAR,      setFbufAR]      = useState({ currencies: ["ARS"],         ...franchisor.ar  });
  const [fbufUSA,     setFbufUSA]     = useState({ currencies: ["USD", "EUR"],   ...franchisor.usa });
  const [fbufES,      setFbufES]      = useState({ currencies: ["EUR"],          ...franchisor.es  });
  const [toast,       setToast]       = useState(null);
  const [newMode,     setNewMode]     = useState(false);
  const [sedeFilter,  setSedeFilter]  = useState("activas"); // "activas" | "inactivas" | "todas"
  const toastTimer = useRef(null);

  const showSaved = (msg) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg: msg || "Cambios guardados correctamente", type:"ok" });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const setF   = field => val => setBuf(b => ({ ...b, [field]: val }));
  const setAR  = field => val => setFbufAR(b => ({ ...b, [field]: val }));
  const setUS  = field => val => setFbufUSA(b => ({ ...b, [field]: val }));
  const setES  = field => val => setFbufES(b => ({ ...b, [field]: val }));

  const SECS_CLOSED = { id:false, cc:false, ct:false, fac:false };

  const openFr = fr => {
    setBuf(frToBuf(fr));
    setActiveFrId(fr.id);
    setNewMode(false);
    setTopSection("sedes");
    // no contraer sidebar: el usuario puede querer cambiar de sede
    setOpenSecs(SECS_CLOSED);
  };

  const openNew = () => {
    setBuf({ ...EMPTY_FR_BUF });
    setActiveFrId(null);
    setNewMode(true);
    setTopSection("sedes");
    setSedesOpen(false);
    setOpenSecs({ id:true, cc:true, ct:true, fac:true });
  };

  const saveFr = () => {
    if (newMode) {
      onAddFr(buf);
      showSaved("Sede '" + buf.name + "' creada correctamente");
      setNewMode(false);
      setActiveFrId(null);
    } else {
      onSaveFr(activeFrId, buf);
      showSaved("Datos de '" + buf.name + "' guardados correctamente");
    }
  };

  const cancelFr = () => { setActiveFrId(null); setNewMode(false); };
  const [confirmDelete, setConfirmDelete] = useState(false);

  const hasMovements = (frId) => {
    return Object.keys(comps || {}).some(key => {
      const parts = key.split("-");
      return String(parts[0]) === String(frId) && (comps[key] || []).length > 0;
    });
  };

  const hasSaldo = (frId) => {
    let saldo = 0;
    Object.entries(comps || {}).forEach(([key, arr]) => {
      const parts = key.split("-");
      if (String(parts[0]) === String(frId))
        (arr || []).forEach(c => { saldo += (c.importe ?? 0) * (COMP_TYPES[c.tipo]?.sign ?? 0); });
    });
    return Math.abs(saldo) > 0.01;
  };

  const handleDeleteClick = () => {
    if (hasMovements(activeFrId)) {
      showSaved("Esta sede tiene movimientos contables. Para darla de baja usá el botón ACTIVA/INACTIVA.");
      return;
    }
    setConfirmDelete("confirm");
  };

  const confirmDeleteFr = () => {
    onDeleteFr(activeFrId);
    setConfirmDelete(false);
    setActiveFrId(null);
    setNewMode(false);
  };
  const [openSecs, setOpenSecs] = useState({ id:true, cc:false, ct:false, fac:false });
  const toggleSec = k => setOpenSecs(s => ({ ...s, [k]: !s[k] }));

  // Auto-precarga segun pais
  const handleCountryChange = country => {
    const latam = ["Uruguay","Chile","Colombia","Peru","Mexico","Bolivia","Paraguay","Ecuador"];
    const europa = ["Espana","España","Francia","Italia","Alemania","Portugal","Reino Unido"];
    let patch = { country };
    if (country === "Argentina") {
      patch.currency = "ARS"; patch.currencies = ["ARS"]; patch.condIVA = "Responsable Inscripto"; patch.applyIVA = true;
      patch.sociedad = fbufAR.razonSocial || "ÑAKO SRL";
    } else if (latam.includes(country)) {
      patch.currency = "USD"; patch.currencies = ["USD"]; patch.condIVA = "Exento"; patch.applyIVA = false;
      patch.sociedad = fbufUSA.legalName || "BIGG FIT LLC";
    } else if (europa.includes(country)) {
      patch.currency = "EUR"; patch.currencies = ["EUR"]; patch.condIVA = "Exento"; patch.applyIVA = false;
      patch.sociedad = fbufES.legalName || "Gestión Deportiva y Wellness SL";
    } else if (country === "USA") {
      patch.currency = "USD"; patch.currencies = ["USD"]; patch.condIVA = "Exento"; patch.applyIVA = false;
      patch.sociedad = fbufUSA.legalName || "BIGG FIT LLC";
    }
    setBuf(b => ({ ...b, ...patch }));
  };

  const isAR = buf.sociedad === (fbufAR.razonSocial || "ÑAKO SRL");
  // Opciones de sociedad contratante dinamicas desde los datos BIGG
  const sociedadOpts = [fbufAR.razonSocial || "ÑAKO SRL", fbufUSA.legalName || "BIGG FIT LLC", fbufES.legalName || "Gestión Deportiva y Wellness SL"];

  const navBtn = active => ({
    padding:"8px 18px", borderRadius:8, fontSize:12, fontWeight:700, cursor:"pointer",
    background: active ? "var(--accent)" : "var(--bg)",
    color:       active ? "#1e2022"       : "var(--muted)",
    border:      active ? "none"          : "1px solid var(--border2)",
    transition:"all .15s",
  });

  const sHdr = (color) => ({
    fontSize:10, fontWeight:800, color: color || "var(--accent)",
    letterSpacing:".1em", marginBottom:10, marginTop:4,
  });

  const grid2 = { display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:18 };
  const divider = { gridColumn:"1 / -1", borderTop:"1px solid var(--border)", margin:"2px 0" };

  const currentFrName = activeFrId ? (franchises.find(f => f.id === activeFrId) || {}).name || "" : "";

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.72)", zIndex:300,
      display:"flex", alignItems:"flex-start", justifyContent:"center",
      padding:"32px 16px", overflowY:"auto" }}>
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:14,
        width:"100%", maxWidth:860, boxShadow:"0 24px 80px rgba(0,0,0,.5)",
        display:"flex", flexDirection:"column", position:"relative" }}>

        {/* Header */}
        <div style={{ padding:"16px 24px", borderBottom:"1px solid var(--border)",
          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontWeight:900, fontSize:15, letterSpacing:".04em" }}>
            Datos Maestros
          </div>
          <button className="ghost" onClick={onClose}>X Cerrar</button>
        </div>

        {/* Toast */}
        {toast && (
          <div style={{
            position:"absolute", top:68, left:"50%", transform:"translateX(-50%)",
            background:"#1a3320", border:"1px solid var(--accent)", borderRadius:10,
            padding:"10px 20px", display:"flex", alignItems:"center", gap:10,
            boxShadow:"0 8px 32px rgba(0,0,0,.5)", zIndex:10, whiteSpace:"nowrap",
          }}>
            <span style={{ fontSize:16 }}>OK</span>
            <span style={{ fontSize:13, fontWeight:700, color:"var(--accent)" }}>{toast.msg}</span>
          </div>
        )}

        {/* Body */}
        <div style={{ display:"flex", minHeight:520 }}>

          {/* Sidebar */}
          <div style={{ width:210, borderRight:"1px solid var(--border)",
            padding:"16px 12px", display:"flex", flexDirection:"column", gap:4, flexShrink:0 }}>

            {/* BIGG section — mismo estilo que Sedes */}
            <div>
              <button
                style={{ ...navBtn(topSection === "bigg"), display:"flex", alignItems:"center",
                  justifyContent:"space-between", width:"100%", textAlign:"left" }}
                onClick={() => {
                  setTopSection(topSection === "bigg" ? null : "bigg");
                  if (topSection === "bigg") setBiggSub(null);
                  setActiveFrId(null); setNewMode(false); setSedesOpen(false);
                }}>
                <span>BIGG (3)</span>
                <span style={{ fontSize:10, opacity:.6 }}>{topSection === "bigg" ? "^" : "v"}</span>
              </button>
              {topSection === "bigg" && (
                <div style={{ display:"flex", flexDirection:"column", gap:1, paddingLeft:8, marginTop:2 }}>
                  {[
                    ["ar",  fbufAR.razonSocial  || "ÑAKO SRL"],
                    ["usa", fbufUSA.legalName    || "BIGG FIT LLC"],
                    ["es",  fbufES.legalName     || "Gestión Deportiva y Wellness SL"],
                  ].map(function(item) {
                    var k = item[0], label = item[1];
                    const active = biggSub === k;
                    return (
                      <button key={k} onClick={() => setBiggSub(k)}
                        style={{ padding:"5px 10px", borderRadius:6, fontSize:11,
                          fontWeight: active ? 700 : 400,
                          background: active ? "rgba(173,255,25,.1)" : "transparent",
                          color: active ? "var(--accent)" : "var(--text)",
                          border:"none", cursor:"pointer", textAlign:"left",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                          display:"block" }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Sedes section */}
            <button
              style={{ ...navBtn(topSection === "sedes"), display:"flex", alignItems:"center",
                justifyContent:"space-between", width:"100%", textAlign:"left", marginTop:4 }}
              onClick={() => {
                const opening = topSection !== "sedes";
                setTopSection(opening ? "sedes" : null);
                setSedesOpen(opening);
                setBiggSub(null);
                if (!opening) { setActiveFrId(null); setNewMode(false); }
              }}>
              <span>Sedes ({franchises.length})</span>
              <span style={{ fontSize:10, opacity:.6 }}>{sedesOpen && topSection === "sedes" ? "^" : "v"}</span>
            </button>

            {sedesOpen && (
              <div style={{ display:"flex", flexDirection:"column", gap:1, paddingLeft:8,
                maxHeight:360, overflowY:"auto" }}>
                {/* Filtro activas/inactivas */}
                <div style={{ display:"flex", gap:4, marginBottom:6, marginTop:8 }}>
                  {[["activas","Activas"],["inactivas","Inact."],["todas","Todas"]].map(([v,l]) => (
                    <button key={v} onClick={() => setSedeFilter(v)}
                      style={{ flex:1, padding:"3px 0", borderRadius:5, fontSize:9, fontWeight:700,
                        cursor:"pointer", border:"none",
                        background: sedeFilter === v ? "var(--accent)" : "var(--bg)",
                        color:      sedeFilter === v ? "#1e2022"       : "var(--muted)" }}>
                      {l}
                    </button>
                  ))}
                </div>
                {(() => {
                  const sorted = [...franchises]
                    .filter(fr => sedeFilter === "todas" ? true : sedeFilter === "activas" ? fr.activa !== false : fr.activa === false)
                    .sort((a,b) => a.name.localeCompare(b.name));
                  const byCountry = {};
                  sorted.forEach(fr => {
                    const c = fr.country || "Sin pais";
                    if (!byCountry[c]) byCountry[c] = [];
                    byCountry[c].push(fr);
                  });
                  return [
                    <CountryGroup key="__todas__" country="Todas" sedes={sorted}
                      activeFrId={activeFrId} openFr={openFr} startOpen={false} />,
                    ...Object.keys(byCountry).sort().map(country => (
                      <CountryGroup key={country} country={country} sedes={byCountry[country]}
                        activeFrId={activeFrId} openFr={openFr} />
                    ))
                  ];
                })()}
              </div>
            )}
          </div>

          {/* Content */}
          <div style={{ flex:1, padding:"20px 24px", overflowY:"auto" }}>

            {/* Landing */}
            {!topSection && (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                justifyContent:"center", height:"100%", gap:12, color:"var(--muted)" }}>
                <div style={{ fontSize:32 }}>&#9881;</div>
                <div style={{ fontSize:13, fontWeight:600 }}>Selecciona una seccion del menu lateral</div>
                <div style={{ fontSize:11 }}>BIGG para datos de la sociedad · Sedes para franquicias</div>
              </div>
            )}

            {/* BIGG landing */}
            {topSection === "bigg" && !biggSub && (
              <div style={{ display:"flex", gap:16, paddingTop:20, flexWrap:"wrap" }}>
                {[
                  ["ar",  "🇦🇷", "Argentina",  fbufAR.razonSocial  || "ÑAKO SRL",                    "#b8960088"],
                  ["usa", "🇺🇸", "USA",         fbufUSA.legalName   || "BIGG FIT LLC",               "#6ec6f588"],
                  ["es",  "🇪🇸", "España",      fbufES.legalName    || "Gestión Deportiva y Wellness SL", "#f5a62388"],
                ].map(function(item) {
                  var k = item[0], flag = item[1], country = item[2], name = item[3], borderColor = item[4];
                  return (
                    <button key={k} onClick={() => setBiggSub(k)}
                      style={{ flex:1, background:"var(--bg)", border:"1px solid " + borderColor,
                        borderRadius:12, padding:"24px 20px", cursor:"pointer", textAlign:"left" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = borderColor.replace("88",""); }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = borderColor; }}>
                      <div style={{ fontSize:28, marginBottom:8 }}>{flag}</div>
                      <div style={{ fontWeight:800, fontSize:14 }}>{name}</div>
                      <div style={{ fontSize:11, color:"var(--muted)", marginTop:4 }}>Sociedad {country}</div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* BIGG AR */}
            {topSection === "bigg" && biggSub === "ar" && (
              <div>
                <div style={sHdr("var(--gold)")}>BIGG ARGENTINA — Datos del franquiciante</div>

                <div style={{ fontSize: 10, color: "var(--gold)", fontWeight: 800, letterSpacing: ".08em", marginBottom: 8, marginTop: 4 }}>IDENTIFICACIÓN</div>
                <div style={grid2}>
                  <FieldInput label="Razón social"     value={fbufAR.razonSocial}  onChange={setAR("razonSocial")} />
                  <FieldInput label="CUIT"              value={fbufAR.cuit}          onChange={setAR("cuit")}         half />
                  <FieldInput label="Condición IVA"     value={fbufAR.condIVA}       onChange={setAR("condIVA")}      half opts={COND_IVA_AR} />
                </div>

                <div style={{ fontSize: 10, color: "var(--gold)", fontWeight: 800, letterSpacing: ".08em", marginBottom: 8, marginTop: 10 }}>DOMICILIO</div>
                <div style={grid2}>
                  <FieldInput label="Domicilio"         value={fbufAR.domicilio}     onChange={setAR("domicilio")} />
                  <FieldInput label="Localidad"         value={fbufAR.localidad}     onChange={setAR("localidad")}    half />
                  <FieldInput label="Provincia"         value={fbufAR.provincia}     onChange={setAR("provincia")}    half />
                  <FieldInput label="Código postal"     value={fbufAR.cp}            onChange={setAR("cp")}           half />
                  <FieldInput label="País"              value={"Argentina"}          onChange={() => {}}              half />
                </div>

                <div style={{ fontSize: 10, color: "var(--gold)", fontWeight: 800, letterSpacing: ".08em", marginBottom: 8, marginTop: 10 }}>DATOS BANCARIOS</div>
                <div style={grid2}>
                  <FieldInput label="Banco"             value={fbufAR.banco}         onChange={setAR("banco")}        half />
                  <FieldInput label="Punto de venta"    value={fbufAR.puntoVenta}    onChange={setAR("puntoVenta")}   half />
                  <FieldInput label="CBU"               value={fbufAR.cbu}           onChange={setAR("cbu")}          half />
                  <FieldInput label="Alias"             value={fbufAR.alias}         onChange={setAR("alias")}        half />
                </div>

                <div style={{ fontSize: 10, color: "var(--gold)", fontWeight: 800, letterSpacing: ".08em", marginBottom: 8, marginTop: 10 }}>FACTURACIÓN</div>
                <div style={grid2}>
                  <FieldInput label="Texto pie de factura" value={fbufAR.notaPie}    onChange={setAR("notaPie")}      textarea />
                </div>

                <div style={{ fontSize: 10, color: "var(--gold)", fontWeight: 800, letterSpacing: ".08em", marginBottom: 8, marginTop: 10 }}>MONEDAS PERMITIDAS</div>
                <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
                  {CURRENCIES.map(cur => {
                    const checked = (fbufAR.currencies ?? ["ARS"]).includes(cur);
                    const isLast  = checked && (fbufAR.currencies ?? ["ARS"]).length === 1;
                    return (
                      <label key={cur} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: isLast ? "not-allowed" : "pointer", userSelect: "none", opacity: isLast ? .5 : 1 }}>
                        <input type="checkbox" checked={checked} disabled={isLast}
                          onChange={e => setFbufAR(b => { const p = b.currencies ?? ["ARS"]; return { ...b, currencies: e.target.checked ? [...p, cur] : p.filter(c => c !== cur) }; })}
                          style={{ accentColor: "var(--accent)", width: 14, height: 14 }} />
                        <span style={{ fontWeight: 700, color: checked ? "var(--text)" : "var(--muted)" }}>{cur}</span>
                      </label>
                    );
                  })}
                </div>

                <div style={{ display:"flex", justifyContent:"flex-end" }}>
                  <button className="btn" onClick={() => {
                    onSaveFranchisor("ar", fbufAR);
                    showSaved("Datos de '" + (fbufAR.razonSocial || "BIGG Argentina") + "' guardados");
                  }}>Guardar</button>
                </div>
              </div>
            )}

            {/* BIGG USA */}
            {topSection === "bigg" && biggSub === "usa" && (
              <div>
                <div style={sHdr("var(--cyan)")}>BIGG FIT LLC — Datos del franquiciante</div>

                <div style={{ fontSize: 10, color: "var(--cyan)", fontWeight: 800, letterSpacing: ".08em", marginBottom: 8, marginTop: 4 }}>IDENTIFICACIÓN</div>
                <div style={grid2}>
                  <FieldInput label="Razón social"     value={fbufUSA.legalName}      onChange={setUS("legalName")} />
                  <FieldInput label="Número EIN"        value={fbufUSA.ein}            onChange={setUS("ein")}            half />
                  <FieldInput label="Condición fiscal"  value={fbufUSA.condFiscal ?? ""} onChange={setUS("condFiscal")}   half />
                  <FieldInput label="Sitio web"         value={fbufUSA.website ?? ""}  onChange={setUS("website")}        half />
                  <FieldInput label="Email de contacto" value={fbufUSA.email ?? ""}    onChange={setUS("email")}          half />
                  <FieldInput label="URL del logo (imagen)" value={fbufUSA.logoUrl ?? ""} onChange={setUS("logoUrl")} />
                </div>

                <div style={{ fontSize: 10, color: "var(--cyan)", fontWeight: 800, letterSpacing: ".08em", marginBottom: 8, marginTop: 10 }}>DOMICILIO</div>
                <div style={grid2}>
                  <FieldInput label="Domicilio (calle y número)" value={fbufUSA.address} onChange={setUS("address")} />
                  <FieldInput label="Suite / Piso"       value={fbufUSA.suite ?? ""}    onChange={setUS("suite")}          half />
                  <FieldInput label="Localidad"          value={fbufUSA.city}           onChange={setUS("city")}           half />
                  <FieldInput label="Provincia / Estado" value={fbufUSA.state}          onChange={setUS("state")}          half />
                  <FieldInput label="Código postal"      value={fbufUSA.zip}            onChange={setUS("zip")}            half />
                  <FieldInput label="País"               value={fbufUSA.country}        onChange={setUS("country")}        half />
                </div>

                <div style={{ fontSize: 10, color: "var(--cyan)", fontWeight: 800, letterSpacing: ".08em", marginBottom: 8, marginTop: 10 }}>DATOS BANCARIOS</div>
                <div style={grid2}>
                  <FieldInput label="Banco"                       value={fbufUSA.bankName}          onChange={setUS("bankName")} />
                  <FieldInput label="Dirección del banco"         value={fbufUSA.bankAddress ?? ""}  onChange={setUS("bankAddress")} />
                  <FieldInput label="Número de ruta (ABA/Routing)" value={fbufUSA.routingNumber}    onChange={setUS("routingNumber")}    half />
                  <FieldInput label="Número de cuenta"            value={fbufUSA.accountNumber}     onChange={setUS("accountNumber")}   half />
                  <FieldInput label="Nombre del beneficiario"     value={fbufUSA.beneficiaryName ?? ""} onChange={setUS("beneficiaryName")} half />
                  <FieldInput label="SWIFT / BIC"                 value={fbufUSA.swift}             onChange={setUS("swift")}           half />
                </div>

                <div style={{ fontSize: 10, color: "var(--cyan)", fontWeight: 800, letterSpacing: ".08em", marginBottom: 8, marginTop: 10 }}>FACTURACIÓN</div>
                <div style={grid2}>
                  <FieldInput label="Condición de pago (ej: Wire Transfer)" value={fbufUSA.paymentTerms ?? ""} onChange={setUS("paymentTerms")} />
                  <FieldInput label="Texto pie de invoice" value={fbufUSA.notaPie}     onChange={setUS("notaPie")}        textarea />
                </div>

                <div style={{ fontSize: 10, color: "var(--cyan)", fontWeight: 800, letterSpacing: ".08em", marginBottom: 8, marginTop: 10 }}>MONEDAS PERMITIDAS</div>
                <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
                  {CURRENCIES.map(cur => {
                    const checked = (fbufUSA.currencies ?? ["USD", "EUR"]).includes(cur);
                    const isLast  = checked && (fbufUSA.currencies ?? ["USD", "EUR"]).length === 1;
                    return (
                      <label key={cur} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: isLast ? "not-allowed" : "pointer", userSelect: "none", opacity: isLast ? .5 : 1 }}>
                        <input type="checkbox" checked={checked} disabled={isLast}
                          onChange={e => setFbufUSA(b => { const p = b.currencies ?? ["USD", "EUR"]; return { ...b, currencies: e.target.checked ? [...p, cur] : p.filter(c => c !== cur) }; })}
                          style={{ accentColor: "var(--accent)", width: 14, height: 14 }} />
                        <span style={{ fontWeight: 700, color: checked ? "var(--text)" : "var(--muted)" }}>{cur}</span>
                      </label>
                    );
                  })}
                </div>

                <div style={{ display:"flex", justifyContent:"flex-end" }}>
                  <button className="btn" onClick={() => {
                    onSaveFranchisor("usa", fbufUSA);
                    showSaved("Datos de '" + (fbufUSA.legalName || "BIGG FIT LLC") + "' guardados");
                  }}>Guardar</button>
                </div>
              </div>
            )}

            {/* BIGG ES */}
            {topSection === "bigg" && biggSub === "es" && (
              <div>
                <div style={sHdr("var(--orange, #f5a623)")}>GESTIÓN DEPORTIVA Y WELLNESS SL — Datos del franquiciante</div>

                <div style={{ fontSize: 10, color: "var(--orange, #f5a623)", fontWeight: 800, letterSpacing: ".08em", marginBottom: 8, marginTop: 4 }}>IDENTIFICACIÓN</div>
                <div style={grid2}>
                  <FieldInput label="Razón social"     value={fbufES.legalName}  onChange={setES("legalName")} />
                  <FieldInput label="NIF"               value={fbufES.nif}        onChange={setES("nif")}        half />
                  <FieldInput label="País"              value={fbufES.country}    onChange={setES("country")}    half />
                </div>

                <div style={{ fontSize: 10, color: "var(--orange, #f5a623)", fontWeight: 800, letterSpacing: ".08em", marginBottom: 8, marginTop: 10 }}>DOMICILIO</div>
                <div style={grid2}>
                  <FieldInput label="Dirección"         value={fbufES.address}    onChange={setES("address")} />
                  <FieldInput label="Ciudad"            value={fbufES.city}       onChange={setES("city")}       half />
                  <FieldInput label="Código postal"     value={fbufES.cp}         onChange={setES("cp")}         half />
                </div>

                <div style={{ fontSize: 10, color: "var(--orange, #f5a623)", fontWeight: 800, letterSpacing: ".08em", marginBottom: 8, marginTop: 10 }}>DATOS BANCARIOS</div>
                <div style={grid2}>
                  <FieldInput label="Banco"             value={fbufES.bankName}   onChange={setES("bankName")} />
                  <FieldInput label="IBAN"              value={fbufES.iban}       onChange={setES("iban")}       half />
                  <FieldInput label="SWIFT / BIC"       value={fbufES.swift}      onChange={setES("swift")}      half />
                </div>

                <div style={{ fontSize: 10, color: "var(--orange, #f5a623)", fontWeight: 800, letterSpacing: ".08em", marginBottom: 8, marginTop: 10 }}>FACTURACIÓN</div>
                <div style={grid2}>
                  <FieldInput label="Texto pie de factura" value={fbufES.notaPie} onChange={setES("notaPie")}   textarea />
                </div>

                <div style={{ fontSize: 10, color: "var(--orange, #f5a623)", fontWeight: 800, letterSpacing: ".08em", marginBottom: 8, marginTop: 10 }}>MONEDAS PERMITIDAS</div>
                <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
                  {CURRENCIES.map(cur => {
                    const checked = (fbufES.currencies ?? ["EUR"]).includes(cur);
                    const isLast  = checked && (fbufES.currencies ?? ["EUR"]).length === 1;
                    return (
                      <label key={cur} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: isLast ? "not-allowed" : "pointer", userSelect: "none", opacity: isLast ? .5 : 1 }}>
                        <input type="checkbox" checked={checked} disabled={isLast}
                          onChange={e => setFbufES(b => { const p = b.currencies ?? ["EUR"]; return { ...b, currencies: e.target.checked ? [...p, cur] : p.filter(c => c !== cur) }; })}
                          style={{ accentColor: "var(--accent)", width: 14, height: 14 }} />
                        <span style={{ fontWeight: 700, color: checked ? "var(--text)" : "var(--muted)" }}>{cur}</span>
                      </label>
                    );
                  })}
                </div>

                <div style={{ display:"flex", justifyContent:"flex-end" }}>
                  <button className="btn" onClick={() => {
                    onSaveFranchisor("es", fbufES);
                    showSaved("Datos de '" + (fbufES.legalName || "Gestión Deportiva y Wellness SL") + "' guardados");
                  }}>Guardar</button>
                </div>
              </div>
            )}

            {/* Sedes landing */}
            {topSection === "sedes" && !activeFrId && !newMode && (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                justifyContent:"center", height:"100%", gap:14, color:"var(--muted)" }}>
                <div style={{ fontSize:28 }}>&#127970;</div>
                <div style={{ fontSize:13, fontWeight:600 }}>Selecciona una sede del menu lateral</div>
                <div style={{ width:1, height:10, background:"var(--border)" }} />
                <button onClick={openNew}
                  style={{ padding:"9px 22px", borderRadius:8, fontSize:12, fontWeight:700,
                    background:"rgba(173,255,25,.06)", color:"var(--accent)",
                    border:"1px dashed rgba(173,255,25,.35)", cursor:"pointer" }}>
                  + Nueva sede
                </button>
              </div>
            )}

            {/* Sede form */}
            {topSection === "sedes" && (activeFrId || newMode) && (
              <div>
                {/* Breadcrumb header */}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <span style={{ fontWeight:800, fontSize:14 }}>
                      {newMode ? "Nueva sede" : currentFrName}
                    </span>
                    {newMode && (
                      <span className="pill" style={{ color:"var(--accent)", background:"rgba(173,255,25,.1)", fontSize:10 }}>
                        NUEVA
                      </span>
                    )}
                    {!newMode && (
                      <button onClick={() => {
                        if (buf.activa && hasSaldo(activeFrId)) {
                          showSaved("Esta sede tiene saldo pendiente. Ajustá el saldo antes de inactivarla.");
                          return;
                        }
                        setBuf(b => ({ ...b, activa: !b.activa }));
                      }} style={{
                        padding:"2px 8px", borderRadius:20, fontSize:9, fontWeight:800, cursor:"pointer", border:"none",
                        color:       buf.activa ? "var(--green)" : "var(--red)",
                        background:  buf.activa ? "rgba(126,217,160,.12)" : "rgba(255,107,122,.12)",
                        letterSpacing:".06em",
                      }} title={buf.activa ? "Click para inactivar" : "Click para activar"}>
                        {buf.activa ? "● ACTIVA" : "○ INACTIVA"}
                      </button>
                    )}
                  </div>
                  {/* Menu ... con Eliminar */}
                  {!newMode && (
                    <div style={{ position:"relative" }}>
                      <button
                        onClick={() => setConfirmDelete(cd => cd === "menu" ? false : "menu")}
                        style={{ padding:"4px 10px", borderRadius:6, fontSize:16, fontWeight:700,
                          background:"transparent", color:"var(--muted)", border:"1px solid transparent",
                          cursor:"pointer", lineHeight:1, letterSpacing:2 }}
                        title="Opciones">
                        ···
                      </button>
                      {confirmDelete === "menu" && (
                        <div style={{ position:"absolute", right:0, top:"110%", zIndex:200,
                          background:"#1e2226", border:"1px solid var(--border2)",
                          borderRadius:8, boxShadow:"0 8px 24px rgba(0,0,0,.6)",
                          minWidth:160, padding:"4px 0" }}>
                          <button onClick={handleDeleteClick}
                            style={{ width:"100%", padding:"9px 16px", background:"transparent",
                              color:"var(--red)", border:"none", cursor:"pointer",
                              fontSize:12, textAlign:"left", display:"flex", alignItems:"center", gap:8 }}
                            onMouseEnter={e => e.currentTarget.style.background="rgba(255,107,122,.08)"}
                            onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                            🗑 Eliminar sede
                          </button>
                        </div>
                      )}
                      {confirmDelete === "confirm" && (
                        <div style={{ position:"absolute", right:0, top:"110%", zIndex:200,
                          background:"#1e2226", border:"1px solid rgba(255,107,122,.4)",
                          borderRadius:8, boxShadow:"0 8px 24px rgba(0,0,0,.6)",
                          minWidth:200, padding:"14px 16px", display:"flex", flexDirection:"column", gap:10 }}>
                          <div style={{ fontSize:11, color:"var(--red)", fontWeight:700, lineHeight:1.4 }}>
                            Eliminar permanentemente?<br/>
                            <span style={{ color:"var(--muted)", fontWeight:400 }}>Esta accion no se puede deshacer.</span>
                          </div>
                          <div style={{ display:"flex", gap:8 }}>
                            <button onClick={confirmDeleteFr}
                              style={{ flex:1, padding:"6px 0", borderRadius:6, fontSize:11, fontWeight:800,
                                background:"var(--red)", color:"#fff", border:"none", cursor:"pointer" }}>
                              Si, eliminar
                            </button>
                            <button onClick={() => setConfirmDelete(false)}
                              style={{ flex:1, padding:"6px 0", borderRadius:6, fontSize:11,
                                background:"transparent", color:"var(--muted)",
                                border:"1px solid var(--border2)", cursor:"pointer" }}>
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── IDENTIFICACION ── */}
                <AccordionSection label="Informacion General" open={openSecs.id} onToggle={() => toggleSec("id")} accent="var(--accent)">
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:10 }}>
                    <FieldInput label="Nombre sede"  value={buf.name}     onChange={setF("name")}    half />
                    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                      <label style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:".07em" }}>Pais</label>
                      <CustomSelect value={buf.country} onChange={handleCountryChange}
                        opts={["Argentina","Uruguay","Chile","Colombia","Peru","Mexico","Bolivia","Paraguay","Ecuador","USA","Espana","Francia","Italia","Alemania","Portugal","Reino Unido","Otro"]} />
                    </div>
                    <FieldInput label="Moneda principal" value={buf.currency} onChange={v => { setF("currency")(v); setBuf(b => ({ ...b, currencies: (b.currencies ?? [b.currency ?? "ARS"]).includes(v) ? b.currencies : [...(b.currencies ?? [b.currency ?? "ARS"]), v] })); }} half opts={["ARS","USD","EUR"]} />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700, letterSpacing: ".07em", display: "block", marginBottom: 5 }}>MONEDAS QUE OPERA</label>
                    <div style={{ display: "flex", gap: 16 }}>
                      {["ARS","USD","EUR"].map(cur => {
                        const curs   = buf.currencies ?? [buf.currency ?? "ARS"];
                        const checked = curs.includes(cur);
                        const isLast  = checked && curs.length === 1;
                        return (
                          <label key={cur} style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, cursor: isLast ? "not-allowed" : "pointer", userSelect:"none", opacity: isLast ? .5 : 1 }}>
                            <input type="checkbox" checked={checked} disabled={isLast}
                              onChange={e => setBuf(b => { const p = b.currencies ?? [b.currency ?? "ARS"]; return { ...b, currencies: e.target.checked ? [...p, cur] : p.filter(c => c !== cur) }; })}
                              style={{ accentColor:"var(--accent)", width:13, height:13 }} />
                            <span style={{ fontWeight:700, color: checked ? "var(--text)" : "var(--muted)" }}>{cur}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div style={divider} />
                  <div style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:".08em", margin:"10px 0 8px" }}>CONTACTO</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:10 }}>
                    <FieldInput label="Nombre Operador" value={buf.titular}      onChange={setF("titular")}      half />
                    <FieldInput label="Telefono"         value={buf.telefonoTitular} onChange={setF("telefonoTitular")} half />
                    <FieldInput label="Email"            value={buf.emailComercial}  onChange={setF("emailComercial")}  half />
                  </div>
                  <div style={divider} />
                  <div style={{ fontSize:10, color:"var(--cyan)", fontWeight:700, letterSpacing:".08em", margin:"10px 0 8px" }}>BIGG EYE</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:10 }}>
                    <FieldInput label="ID en Bigg Eye" value={buf.biggEyeId} onChange={setF("biggEyeId")} half type="number" />
                  </div>
                </AccordionSection>

                {/* ── CONDICIONES COMERCIALES ── */}
                <AccordionSection label="Condiciones Comerciales" open={openSecs.cc} onToggle={() => toggleSec("cc")} accent="var(--gold)">
                  <div style={grid2}>
                    <FieldInput label="Regalias s/Ventas (%)"    value={buf.royaltyPct}         onChange={setF("royaltyPct")}         half type="number" />
                    <FieldInput label="Condicion de pago"        value={buf.condPago}           onChange={setF("condPago")}           half opts={["10 dias","Contado","15 dias","30 dias","60 dias","A convenir"]} />
                    <FieldInput label="Fondo de publicidad (%)"  value={buf.fondoPublicidadPct} onChange={setF("fondoPublicidadPct")} half type="number" />
                    <FieldInput label="Fee mensual fijo (canon)" value={buf.feeImporte}         onChange={setF("feeImporte")}         half type="number" />
                    <FieldInput label="Notas generales" value={buf.noteGeneral} onChange={setF("noteGeneral")} textarea />
                  </div>
                </AccordionSection>

                {/* ── CONDICIONES CONTRACTUALES ── */}
                <AccordionSection label="Condiciones Contractuales" open={openSecs.ct} onToggle={() => toggleSec("ct")} accent="var(--purple)">
                  <div style={grid2}>
                    <div style={{ display:"flex", flexDirection:"column", gap:4, gridColumn:"auto" }}>
                      <label style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:".07em" }}>Sociedad contratante</label>
                      <CustomSelect value={buf.sociedad} onChange={v => setBuf(b => ({ ...b, sociedad: v }))}
                        opts={sociedadOpts} />
                    </div>
                    <FieldInput label="N de contrato"                value={buf.contrato}      onChange={setF("contrato")}      half />
                    <DateInput  label="Fecha de firma"               value={buf.fechaInicio}   onChange={setF("fechaInicio")}   half />
                    <DateInput  label="Fecha de apertura" value={buf.fechaApertura} onChange={v => {
                      const anios = parseInt(buf.aniosContrato) || 0;
                      let vto = "";
                      if (v && anios) {
                        const p = v.split("/");
                        if (p.length === 3 && !isNaN(parseInt(p[2]))) {
                          vto = p[0] + "/" + p[1] + "/" + (parseInt(p[2]) + anios);
                        }
                      }
                      setBuf(b => ({ ...b, fechaApertura: v, fechaVto: vto }));
                    }} half />
                    <FieldInput label="Anos de contrato" value={buf.aniosContrato} onChange={v => {
                      const anios = parseInt(v) || 0;
                      let vto = "";
                      if (buf.fechaApertura && anios) {
                        const p = buf.fechaApertura.split("/");
                        if (p.length === 3 && !isNaN(parseInt(p[2]))) {
                          vto = p[0] + "/" + p[1] + "/" + (parseInt(p[2]) + anios);
                        }
                      }
                      setBuf(b => ({ ...b, aniosContrato: v, fechaVto: vto }));
                    }} half type="number" />
                    <div style={{ display:"flex", flexDirection:"column", gap:4, gridColumn:"auto" }}>
                      <label style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:".07em" }}>Vencimiento (calculado)</label>
                      <div style={{ padding:"7px 10px", borderRadius:6, fontSize:12,
                        background:"var(--bg)", border:"1px solid var(--border2)",
                        color: buf.fechaVto ? "var(--accent)" : "var(--muted)",
                        fontWeight: buf.fechaVto ? 700 : 400 }}>
                        {buf.fechaVto || "completar apertura y anos"}
                      </div>
                    </div>
                    <FieldInput label="Condiciones especiales / Comentarios" value={buf.clausulasEspeciales} onChange={setF("clausulasEspeciales")} textarea />
                  </div>
                </AccordionSection>

                {/* ── DATOS DE FACTURACION ── */}
                <AccordionSection
                  label="Datos de Facturacion"
                  open={openSecs.fac} onToggle={() => toggleSec("fac")}
                  accent="var(--gold)">
                  <div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:14 }}>
                      <FieldInput label="Razon social"  value={buf.razonSocial} onChange={setF("razonSocial")} half />
                      <FieldInput label="CUIT / Tax ID" value={buf.cuit}        onChange={setF("cuit")}        half />
                      <FieldInput label="Condicion IVA" value={buf.condIVA}     onChange={setF("condIVA")}     half opts={COND_IVA_AR} />
                    </div>
                    <FieldInput label="Email para envio de facturas" value={buf.emailFactura} onChange={setF("emailFactura")} />
                    <div style={{ marginBottom:14 }} />
                    <div style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:".08em", margin:"0 0 8px" }}>DIRECCION DE FACTURACION</div>
                    <FieldInput label="Domicilio" value={buf.billingAddress} onChange={setF("billingAddress")} />
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:14, marginTop:8 }}>
                      <FieldInput label="Localidad"      value={buf.billingCity}  onChange={setF("billingCity")}  half />
                      <FieldInput label="Prov. / Estado" value={buf.billingState} onChange={setF("billingState")} half />
                      <FieldInput label="CP"             value={buf.billingZip}   onChange={setF("billingZip")}   half />
                    </div>
                    <div style={{ fontSize:10, color:"var(--muted)", fontWeight:700, letterSpacing:".08em", margin:"0 0 8px" }}>CUENTA BANCARIA</div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:14 }}>
                      <FieldInput label="Banco"              value={buf.banco} onChange={setF("banco")} half />
                      <FieldInput label={isAR ? "CBU" : "CBU / IBAN"}         value={buf.cbu}   onChange={setF("cbu")}   half />
                      <FieldInput label={isAR ? "Alias CBU" : "Alias / SWIFT"} value={buf.alias} onChange={setF("alias")} half />
                    </div>
                    <div style={divider} />
                    <FieldInput label="Nota en factura" value={buf.notaFactura} onChange={setF("notaFactura")} textarea />
                  </div>
                </AccordionSection>

                {/* Botones */}
                <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:20, paddingBottom:8 }}>
                  <button className="ghost" onClick={cancelFr}>Cancelar</button>
                  <button className="btn" onClick={saveFr}>
                    {newMode ? "Crear sede" : "Guardar cambios"}
                  </button>
                </div>

              </div>
            )}

          </div>{/* end content */}
        </div>{/* end body */}
      </div>
    </div>
  );
}
