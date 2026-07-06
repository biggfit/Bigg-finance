import { useState, useEffect } from "react";
import { T, Btn, PageHeader } from "./theme";
import { fetchUsuarios, appendUsuario, updateUsuario, deleteUsuario } from "../lib/numbersApi";
import { hashPassword, inicial } from "../lib/auth";

// Módulo group-level (fuera de Maestros): gestión de usuarios del sistema + sesión actual.
// Permisos NO se enforzan (todos pueden todo); solo se guarda `rol` como estructura.
export default function PantallaUsuarios({ sesion, onCerrarSesion }) {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(null);   // null | "nuevo" | usuario

  const recargar = async () => {
    setLoading(true);
    try { setUsuarios((await fetchUsuarios()) || []); }
    finally { setLoading(false); }
  };
  useEffect(() => { recargar(); }, []);

  const handleEliminar = async (u) => {
    if (!window.confirm(`¿Eliminar al usuario "${u.nombre}"?`)) return;
    await deleteUsuario(u.id);
    await recargar();
  };

  const th = { textAlign:"left", padding:"10px 14px", fontSize:11, fontWeight:700,
    letterSpacing:".05em", textTransform:"uppercase", color:T.tableHeadText };
  const td = { padding:"10px 14px", fontSize:13, color:T.text };

  return (
    <div className="fade" style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", padding:"24px 32px 0" }}>
      <PageHeader
        title="Usuarios del sistema"
        subtitle="Login y sello de autoría. Hoy todos pueden todo — el rol es informativo."
        action={<Btn variant="accent" onClick={() => setModal("nuevo")}>➕ Nuevo usuario</Btn>}
      />

      {/* Sesión actual */}
      <div style={{ display:"flex", alignItems:"center", gap:14, background:T.card,
        border:`1px solid ${T.cardBorder}`, borderRadius:T.radius, padding:"12px 18px",
        boxShadow:T.shadow, marginBottom:18 }}>
        <div style={{ width:36, height:36, borderRadius:"50%", background:T.accentDark, color:T.accent,
          display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:15 }}>
          {inicial(sesion?.nombre)}
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:11, color:T.muted, fontWeight:700, letterSpacing:".06em", textTransform:"uppercase" }}>Sesión iniciada</div>
          <div style={{ fontSize:15, fontWeight:800, color:T.text }}>
            {sesion?.nombre || "—"}{sesion?.rol ? <span style={{ color:T.muted, fontWeight:600 }}> · {sesion.rol}</span> : null}
          </div>
        </div>
        <Btn variant="ghost" onClick={onCerrarSesion}>Cambiar de usuario</Btn>
        <Btn variant="danger" onClick={onCerrarSesion}>Cerrar sesión</Btn>
      </div>

      {loading ? (
        <div style={{ padding:"60px 24px", textAlign:"center", color:T.muted, fontSize:13 }}>Cargando…</div>
      ) : (
        <div style={{ flex:1, overflow:"auto", background:T.card, border:`1px solid ${T.cardBorder}`,
          borderRadius:T.radius, boxShadow:T.shadow }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead style={{ background:T.tableHead, position:"sticky", top:0 }}>
              <tr>
                <th style={th}>Nombre</th><th style={th}>Email</th><th style={th}>Rol</th>
                <th style={th}>Estado</th><th style={{ ...th, textAlign:"right" }}></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.length === 0 && (
                <tr><td style={{ ...td, color:T.muted, padding:"40px 14px", textAlign:"center" }} colSpan={5}>
                  Todavía no hay usuarios. Creá el primero para poder iniciar sesión.
                </td></tr>
              )}
              {usuarios.map((u, i) => (
                <tr key={u.id} style={{ background: i % 2 ? "#fafbfc" : "#fff", borderTop:`1px solid ${T.cardBorder}` }}>
                  <td style={{ ...td, fontWeight:700 }}>{u.nombre}</td>
                  <td style={{ ...td, color:T.muted }}>{u.email || "—"}</td>
                  <td style={td}>{u.rol || "—"}</td>
                  <td style={td}>
                    <span style={{ fontSize:11, fontWeight:700, padding:"2px 9px", borderRadius:999,
                      background: u.activo === false ? T.redBg : T.greenBg,
                      color: u.activo === false ? T.red : T.green }}>
                      {u.activo === false ? "Inactivo" : "Activo"}
                    </span>
                    {!u.password_hash && <span style={{ marginLeft:8, fontSize:10.5, color:T.orange }}>sin contraseña</span>}
                  </td>
                  <td style={{ ...td, textAlign:"right", whiteSpace:"nowrap" }}>
                    <button onClick={() => setModal(u)} style={linkBtn}>Editar</button>
                    <button onClick={() => handleEliminar(u)} style={{ ...linkBtn, color:T.red }}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <UsuarioModal
          initial={modal === "nuevo" ? null : modal}
          onClose={() => setModal(null)}
          onSaved={async () => { setModal(null); await recargar(); }}
        />
      )}
    </div>
  );
}

const linkBtn = { background:"transparent", border:"none", cursor:"pointer", color:T.blue,
  fontSize:12.5, fontWeight:700, padding:"4px 8px", fontFamily:T.font };

function UsuarioModal({ initial, onClose, onSaved }) {
  const isEdit = !!initial;
  const [nombre, setNombre] = useState(initial?.nombre || "");
  const [email, setEmail]   = useState(initial?.email || "");
  const [rol, setRol]       = useState(initial?.rol || "");
  const [activo, setActivo] = useState(initial ? initial.activo !== false : true);
  const [pass, setPass]     = useState("");
  const [vaciar, setVaciar] = useState(false);   // forzar re-claim (borrar hash)
  const [busy, setBusy]     = useState(false);

  const canSave = nombre.trim() && !busy;

  const guardar = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const base = { nombre: nombre.trim(), email: email.trim(), rol: rol.trim(), activo };
      let password_hash;
      if (vaciar) password_hash = "";
      else if (pass) password_hash = await hashPassword(pass);

      if (isEdit) {
        const patch = { ...base };
        if (password_hash !== undefined) patch.password_hash = password_hash;
        await updateUsuario(initial.id, patch);
      } else {
        await appendUsuario({ ...base, password_hash: password_hash ?? "" });
      }
      await onSaved();
    } catch {
      setBusy(false);
      alert("No se pudo guardar el usuario. Reintentá.");
    }
  };

  const inp = { width:"100%", background:"#eceff3", border:`1px solid ${T.cardBorder}`, borderRadius:8,
    padding:"9px 12px", fontSize:13, color:T.text, fontFamily:T.font, outline:"none", boxSizing:"border-box" };
  const lbl = { fontSize:12, color:T.muted, fontWeight:600, display:"block", marginBottom:5 };
  const card = { background:"#fff", border:"1px solid #e2e8f0", borderRadius:10, padding:"16px 20px",
    display:"flex", flexDirection:"column", gap:12 };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:500,
      display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background:"#f1f5f9", borderRadius:16,
        width:520, maxWidth:"97vw", overflow:"hidden", boxShadow:T.shadowMd }}>
        <div style={{ background:T.accentDark, padding:"16px 22px" }}>
          <div style={{ fontSize:16, fontWeight:800, color:"#fff" }}>{isEdit ? "Editar usuario" : "Nuevo usuario"}</div>
          {isEdit && <div style={{ fontSize:12, color:"rgba(255,255,255,.5)", marginTop:2 }}>{initial.nombre}</div>}
        </div>
        <div style={{ padding:22, display:"flex", flexDirection:"column", gap:14 }}>
          <div style={card}>
            <div><label style={lbl}>Nombre *</label>
              <input value={nombre} onChange={e => setNombre(e.target.value)} style={inp} placeholder="Nombre y apellido" /></div>
            <div><label style={lbl}>Email</label>
              <input value={email} onChange={e => setEmail(e.target.value)} style={inp} placeholder="nombre@bigg.fit" /></div>
            <div><label style={lbl}>Rol</label>
              <input value={rol} onChange={e => setRol(e.target.value)} style={inp} placeholder="Admin / Contable / Sueldos…" /></div>
            <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:T.text, cursor:"pointer" }}>
              <input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)} /> Usuario activo
            </label>
          </div>

          <div style={card}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:".05em", textTransform:"uppercase", color:T.muted }}>Contraseña</div>
            {isEdit && !vaciar && (
              <div style={{ fontSize:12, color:T.muted }}>
                Dejá vacío para no cambiarla.{initial.password_hash ? "" : " (Esta cuenta aún no tiene contraseña: la define el próximo login.)"}
              </div>
            )}
            {!vaciar && (
              <div><label style={lbl}>{isEdit ? "Nueva contraseña" : "Contraseña inicial (opcional)"}</label>
                <input type="password" value={pass} onChange={e => setPass(e.target.value)} style={inp}
                  placeholder={isEdit ? "Dejar vacío = sin cambios" : "Vacío = se define en el 1er login"} /></div>
            )}
            {isEdit && (
              <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:T.text, cursor:"pointer" }}>
                <input type="checkbox" checked={vaciar} onChange={e => setVaciar(e.target.checked)} />
                Resetear contraseña (el usuario la define en su próximo login)
              </label>
            )}
          </div>

          <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn variant="accent" onClick={guardar} disabled={!canSave}>{busy ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear usuario"}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
