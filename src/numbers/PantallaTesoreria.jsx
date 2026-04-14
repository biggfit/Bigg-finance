import { useState } from "react";
import { T, Btn, Input, Select, PageHeader } from "./theme";

// ─── Datos de muestra ─────────────────────────────────────────────────────────
const CAJAS = [
  { id:"00-hq-ars",        nombre:"00 - HQ ARS",             saldo:  6141735.53 },
  { id:"00-hq-usd",        nombre:"00 - HQ USD",             saldo:     5237.00 },
  { id:"01-camacho",       nombre:"01 - CC Camacho",         saldo:       -0.00 },
  { id:"11-recoleta",      nombre:"11 - Local - Recoleta",   saldo:   391500.78 },
  { id:"12-barrio-norte",  nombre:"12 - Local - Barrio Norte",saldo:  588210.20 },
];

const BANCOS = [
  { id:"01-mp-hektor",       nombre:"01 - Mercado Pago - Hektor",  saldo: -206443061.98 },
  { id:"01-mp-nako",         nombre:"01 - Mercado Pago - Ñako",    saldo:    -576661.36 },
  { id:"07-galicia-nako",    nombre:"07 - Galicia - Ñako",         saldo: -176654908.02 },
  { id:"08-galicia-hektor",  nombre:"08 - Galicia - Hektor",       saldo:   18944084.47 },
  { id:"11-galicia-eventos", nombre:"11 - Galicia - Eventos",      saldo:    299957.71  },
];

const A_COBRAR = [
  { label:"Saldo Cta Cte Clientes", monto:   468778.08 },
  { label:"Cheque de Terceros",      monto: 12456949.60 },
];

const A_PAGAR = [
  { label:"Saldo Cta Cte Proveedores", monto:  78000603.08 },
  { label:"Cheque Propio",              monto:         0.00 },
  { label:"American Express Corp",      monto:        -0.00 },
  { label:"Deuda Impositiva",           monto:  25346536.39 },
  { label:"Dividendos Socios",          monto:    -32310.00 },
];

const MOV_SAMPLE = [
  { id:"MOV-001", fecha:"13/04/2026", tipo:"INGRESO",       cuenta:"00 - HQ ARS",              concepto:"Cobro Gympass",              monto:  2400000    },
  { id:"MOV-002", fecha:"12/04/2026", tipo:"EGRESO",        cuenta:"07 - Galicia - Ñako",      concepto:"Pago UTEDYC",                monto: -3111000.80 },
  { id:"MOV-003", fecha:"11/04/2026", tipo:"TRANSFERENCIA", cuenta:"HQ ARS → Galicia Hektor",  concepto:"Transferencia interna",      monto:  5000000    },
  { id:"MOV-004", fecha:"10/04/2026", tipo:"EGRESO",        cuenta:"08 - Galicia - Hektor",    concepto:"Alquiler Recoleta",          monto: -2100000    },
  { id:"MOV-005", fecha:"09/04/2026", tipo:"INGRESO",       cuenta:"01 - Mercado Pago - Ñako", concepto:"Ingresos B — Palermo",       monto:   980000    },
];

const TODAS_CUENTAS = [...CAJAS, ...BANCOS];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = n => {
  const neg = n < 0;
  return `${neg ? "-" : ""}$${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;
};

const TIPO_CFG = {
  INGRESO:       { bg:"#dcfce7", color:"#16a34a" },
  EGRESO:        { bg:"#fee2e2", color:"#dc2626" },
  TRANSFERENCIA: { bg:"#dbeafe", color:"#2563eb" },
};

// ─── Modal: Movimiento entre cuentas ─────────────────────────────────────────
function MovimientoModal({ onClose, onSave }) {
  const [form, setForm] = useState({ fecha:"", monto:"", cuentaSalida:"", cuentaEntrada:"", observacion:"" });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const canSave = form.fecha && form.monto && form.cuentaSalida && form.cuentaEntrada;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}>
      <div className="fade" style={{ background:T.card, borderRadius:10, width:500,
        maxWidth:"97vw", boxShadow:"0 20px 60px rgba(0,0,0,.25)", overflow:"hidden" }}
        onClick={e => e.stopPropagation()}>

        <div style={{ background:"#0e7490", padding:"14px 22px", display:"flex",
          justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:15, fontWeight:800, color:"#fff" }}>Nuevo Movimiento Entre Cuentas</span>
          <button onClick={onClose} style={{ background:"transparent", border:"none",
            color:"rgba(255,255,255,.6)", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
        </div>

        <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <Input label="Fecha" required type="date" value={form.fecha} onChange={v=>set("fecha",v)} />
            <Input label="Importe $" required type="number" value={form.monto} onChange={v=>set("monto",v)} placeholder="0,00" />
          </div>
          <Select label="Elija cuenta de salida" required value={form.cuentaSalida} onChange={v=>set("cuentaSalida",v)}
            options={TODAS_CUENTAS.map(c => ({ value:c.id, label:c.nombre }))} />
          <Select label="Elija cuenta de entrada" required value={form.cuentaEntrada} onChange={v=>set("cuentaEntrada",v)}
            options={TODAS_CUENTAS.filter(c => c.id !== form.cuentaSalida).map(c => ({ value:c.id, label:c.nombre }))} />
          <div>
            <label style={{ fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 }}>Observación</label>
            <textarea value={form.observacion} onChange={e=>set("observacion",e.target.value)}
              placeholder="Concepto del movimiento..."
              style={{ width:"100%", background:"#f9fafb", border:`1px solid ${T.cardBorder}`,
                borderRadius:8, padding:"8px 12px", fontSize:13, color:T.text,
                fontFamily:T.font, outline:"none", resize:"vertical", minHeight:72, boxSizing:"border-box" }} />
          </div>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10, paddingTop:4 }}>
            <button onClick={onClose} style={{
              background:"#dc2626", border:"none", borderRadius:8, padding:"9px 20px",
              fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer",
              display:"flex", alignItems:"center", gap:6, fontFamily:T.font }}>
              Cancelar ✕
            </button>
            <button onClick={() => { onSave(form); onClose(); }} disabled={!canSave} style={{
              background: canSave ? "#16a34a" : "#9ca3af", border:"none", borderRadius:8,
              padding:"9px 20px", fontSize:13, fontWeight:700, color:"#fff",
              cursor: canSave ? "pointer" : "default",
              display:"flex", alignItems:"center", gap:6, fontFamily:T.font }}>
              Crear ✓
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Bloque A Cobrar / A Pagar ────────────────────────────────────────────────
function BalanceBlock({ title, items, headerColor, total }) {
  return (
    <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
      borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden", flex:1, minWidth:0 }}>
      <div style={{ background:headerColor, padding:"10px 18px" }}>
        <span style={{ fontSize:14, fontWeight:800, color:"#fff" }}>{title}</span>
      </div>
      <div style={{ overflowY:"auto", maxHeight:220 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
            padding:"10px 18px", borderBottom:`1px solid ${T.cardBorder}` }}>
            <span style={{ fontSize:13, color:T.muted }}>{item.label}</span>
            <span style={{ fontSize:13, fontFamily:"var(--mono)", fontWeight:600,
              color: item.monto < 0 ? T.red : T.text }}>
              {fmt(item.monto)}
            </span>
          </div>
        ))}
      </div>
      <div style={{ padding:"12px 18px", borderTop:`2px solid ${headerColor}`,
        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:13, fontWeight:800, color:T.text }}>Total {title}</span>
        <span style={{ fontSize:15, fontFamily:"var(--mono)", fontWeight:900,
          color: total < 0 ? T.red : T.text }}>
          {fmt(total)}
        </span>
      </div>
    </div>
  );
}

// ─── Tab: Saldos ─────────────────────────────────────────────────────────────
function TabSaldos({ onNuevoMovimiento }) {
  const totalACobrar = A_COBRAR.reduce((s, x) => s + x.monto, 0);
  const totalAPagar  = A_PAGAR.reduce((s, x) => s + x.monto, 0);
  const totalCajas   = CAJAS.reduce((s, x) => s + x.saldo, 0);
  const totalBancos  = BANCOS.reduce((s, x) => s + x.saldo, 0);
  const totalDisp    = totalCajas + totalBancos;

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center", gap:10, marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8,
          background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:8,
          padding:"7px 14px", fontSize:13, color:T.muted, boxShadow:T.shadow }}>
          <span>📅</span>
          <span>Buscar por Fecha</span>
        </div>
        <button onClick={onNuevoMovimiento} style={{
          background:"#0e7490", border:"none", borderRadius:8, padding:"8px 18px",
          fontSize:13, fontWeight:700, color:"#fff", cursor:"pointer",
          display:"flex", alignItems:"center", gap:6, fontFamily:T.font }}>
          Movimiento entre Cuentas +
        </button>
      </div>

      {/* A Cobrar + A Pagar */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
        <BalanceBlock title="A Cobrar" items={A_COBRAR} headerColor="#16a34a" total={totalACobrar} />
        <BalanceBlock title="A Pagar"  items={A_PAGAR}  headerColor="#dc2626" total={totalAPagar}  />
      </div>

      {/* Disponible */}
      <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`,
        borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden" }}>
        <div style={{ background:"#0e7490", padding:"10px 18px", display:"flex",
          justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:14, fontWeight:800, color:"#fff" }}>Disponible</span>
          <span style={{ fontSize:14, fontWeight:900, fontFamily:"var(--mono)",
            color: totalDisp < 0 ? "#fca5a5" : "#a7f3d0" }}>
            Total: {fmt(totalDisp)}
          </span>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr" }}>
          {/* Cajas */}
          <div style={{ borderRight:`1px solid ${T.cardBorder}` }}>
            <div style={{ padding:"9px 18px", borderBottom:`1px solid ${T.cardBorder}`,
              fontSize:12, fontWeight:800, color:T.muted, letterSpacing:".08em", textTransform:"uppercase" }}>
              Cajas
            </div>
            {CAJAS.map((c, i) => (
              <div key={c.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                padding:"10px 18px", borderBottom: i < CAJAS.length-1 ? `1px solid ${T.cardBorder}` : "none" }}>
                <span style={{ fontSize:13, color:T.muted }}>{c.nombre}</span>
                <span style={{ fontSize:13, fontFamily:"var(--mono)", fontWeight:600,
                  color: c.saldo < 0 ? T.red : T.text }}>{fmt(c.saldo)}</span>
              </div>
            ))}
          </div>
          {/* Bancos */}
          <div>
            <div style={{ padding:"9px 18px", borderBottom:`1px solid ${T.cardBorder}`,
              fontSize:12, fontWeight:800, color:T.muted, letterSpacing:".08em", textTransform:"uppercase" }}>
              Bancos
            </div>
            {BANCOS.map((b, i) => (
              <div key={b.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                padding:"10px 18px", borderBottom: i < BANCOS.length-1 ? `1px solid ${T.cardBorder}` : "none" }}>
                <span style={{ fontSize:13, color:T.muted }}>{b.nombre}</span>
                <span style={{ fontSize:13, fontFamily:"var(--mono)", fontWeight:600,
                  color: b.saldo < 0 ? T.red : T.text }}>{fmt(b.saldo)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Movimientos ─────────────────────────────────────────────────────────
function TabMovimientos() {
  const [movimientos] = useState(MOV_SAMPLE);

  return (
    <div style={{ background:T.card, border:`1px solid ${T.cardBorder}`, borderRadius:T.radius,
      boxShadow:T.shadow, overflow:"hidden" }}>
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead>
          <tr style={{ background:T.tableHead }}>
            {["Tipo","ID","Fecha","Cuenta","Concepto","Importe"].map(h=>(
              <th key={h} style={{ padding:"10px 14px", fontSize:11, fontWeight:700,
                letterSpacing:".08em", textTransform:"uppercase", color:T.tableHeadText, textAlign:"left" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {movimientos.map((m, i) => {
            const cfg = TIPO_CFG[m.tipo] ?? { bg:"#f3f4f6", color:"#374151" };
            return (
              <tr key={m.id} style={{ borderBottom:`1px solid ${T.cardBorder}`,
                background: i%2===0 ? T.card : "#fafbfc" }}>
                <td style={{ padding:"10px 14px" }}>
                  <span style={{ display:"inline-block", padding:"2px 9px", borderRadius:999,
                    fontSize:11, fontWeight:700, background:cfg.bg, color:cfg.color,
                    whiteSpace:"nowrap" }}>{m.tipo}</span>
                </td>
                <td style={{ padding:"10px 14px", fontSize:12, color:T.blue, fontWeight:700, fontFamily:"var(--mono)" }}>{m.id}</td>
                <td style={{ padding:"10px 14px", fontSize:13, color:T.text }}>{m.fecha}</td>
                <td style={{ padding:"10px 14px", fontSize:12, color:T.muted }}>{m.cuenta}</td>
                <td style={{ padding:"10px 14px", fontSize:13, color:T.text }}>{m.concepto}</td>
                <td style={{ padding:"10px 14px", fontSize:13, fontFamily:"var(--mono)", fontWeight:700,
                  color: m.monto < 0 ? T.red : T.green, textAlign:"right", whiteSpace:"nowrap" }}>
                  {fmt(m.monto)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Pantalla principal ───────────────────────────────────────────────────────
export default function PantallaTesoreria() {
  const [activeTab, setActiveTab]   = useState("saldos");
  const [showMovModal, setShowMovModal] = useState(false);

  return (
    <div style={{ padding:"28px 32px", maxWidth:1300 }} className="fade">
      <PageHeader
        title="Tesorería"
        subtitle="Posición de caja, bancos y movimientos"
      />

      {/* Tabs */}
      <div style={{ display:"flex", gap:2, marginBottom:24, borderBottom:`2px solid ${T.cardBorder}` }}>
        {[{ id:"saldos", label:"Saldos" }, { id:"movimientos", label:"Movimientos" }].map(tab => (
          <button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{
            background:"transparent", border:"none",
            borderBottom:`3px solid ${activeTab===tab.id ? T.accentDark : "transparent"}`,
            padding:"10px 20px", fontSize:13, fontWeight: activeTab===tab.id ? 700 : 400,
            color: activeTab===tab.id ? T.text : T.muted,
            cursor:"pointer", fontFamily:T.font, marginBottom:-2, transition:"all .12s",
          }}>{tab.label}</button>
        ))}
      </div>

      {activeTab === "saldos"      && <TabSaldos onNuevoMovimiento={() => setShowMovModal(true)} />}
      {activeTab === "movimientos" && <TabMovimientos />}

      {showMovModal && (
        <MovimientoModal
          onClose={() => setShowMovModal(false)}
          onSave={() => {}}
        />
      )}
    </div>
  );
}
