import { useState, useEffect } from "react";
import { T } from "./theme";
import LOGO_SRC from "../assets/biggLogo";
import { fetchUsuarios, updateUsuario } from "../lib/numbersApi";
import { setSesion, hashPassword } from "../lib/auth";

// Gate de login (atribución, no barrera de seguridad — ver auth.js). Elegís usuario +
// password; si la cuenta no tiene clave seteada, el 1er login la reclama (setea el hash).
export default function Login({ onLogin }) {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState("");
  const [userId, setUserId]     = useState("");
  const [pass, setPass]         = useState("");
  const [busy, setBusy]         = useState(false);

  useEffect(() => {
    fetchUsuarios()
      .then(rows => setUsuarios((rows || []).filter(u => u.activo !== false)))
      .catch(() => setErr("No se pudieron cargar los usuarios."))
      .finally(() => setLoading(false));
  }, []);

  const submit = async (e) => {
    e?.preventDefault();
    setErr("");
    const u = usuarios.find(x => x.id === userId);
    if (!u) { setErr("Elegí un usuario."); return; }
    if (!pass) { setErr("Ingresá la contraseña."); return; }
    setBusy(true);
    try {
      const hash = await hashPassword(pass);
      const stored = String(u.password_hash || "");
      if (!stored) {
        // Cuenta sin reclamar → esta password queda como la clave.
        await updateUsuario(u.id, { password_hash: hash });
      } else if (stored !== hash) {
        setErr("Contraseña incorrecta.");
        setBusy(false);
        return;
      }
      onLogin(setSesion(u));
    } catch {
      setErr("Error al iniciar sesión. Reintentá.");
      setBusy(false);
    }
  };

  const inp = {
    width:"100%", background:"#eceff3", border:`1px solid ${T.cardBorder}`,
    borderRadius:8, padding:"10px 12px", fontSize:14, color:T.text,
    fontFamily:T.font, outline:"none", boxSizing:"border-box",
  };
  const lbl = { fontSize:12, color:"rgba(255,255,255,.5)", fontWeight:600, display:"block", marginBottom:6 };

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center",
      background:T.sidebar, fontFamily:T.font, padding:20 }}>
      <form onSubmit={submit} style={{ width:360, maxWidth:"92vw", background:"#1e2022",
        border:`1px solid rgba(173,255,25,.25)`, borderRadius:16, padding:"32px 28px",
        boxShadow:T.shadowMd, display:"flex", flexDirection:"column", gap:18 }}>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8, marginBottom:4 }}>
          <img src={LOGO_SRC} alt="BIGG" style={{ height:40, filter:"invert(1) sepia(1) saturate(10) hue-rotate(52deg)" }} />
          <div style={{ fontSize:12, color:"rgba(255,255,255,.45)", letterSpacing:".18em", fontWeight:700 }}>NUMBERS</div>
        </div>

        {loading ? (
          <div style={{ color:"rgba(255,255,255,.5)", textAlign:"center", fontSize:13, padding:"12px 0" }}>Cargando…</div>
        ) : (
          <>
            <div>
              <label style={lbl}>Usuario</label>
              <select value={userId} onChange={e => { setUserId(e.target.value); setErr(""); }} style={inp}>
                <option value="">— Elegí quién sos —</option>
                {usuarios.map(u => (
                  <option key={u.id} value={u.id}>{u.nombre}{u.rol ? ` · ${u.rol}` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>Contraseña</label>
              <input type="password" value={pass} onChange={e => { setPass(e.target.value); setErr(""); }}
                placeholder="••••••••" style={inp} autoFocus />
            </div>
          </>
        )}

        {err && <div style={{ color:"#fca5a5", fontSize:12, textAlign:"center" }}>{err}</div>}

        <button type="submit" disabled={busy || loading} style={{
          background:T.accent, color:T.accentDark, border:"none", borderRadius:999,
          padding:"11px 20px", fontSize:14, fontWeight:800, letterSpacing:".03em",
          cursor: busy || loading ? "default" : "pointer", opacity: busy || loading ? .5 : 1,
          fontFamily:T.font, marginTop:4,
        }}>
          {busy ? "Ingresando…" : "Ingresar"}
        </button>

        <div style={{ fontSize:10.5, color:"rgba(255,255,255,.3)", textAlign:"center", lineHeight:1.5 }}>
          Tu sesión queda guardada en este navegador.<br/>Si es tu primera vez, la contraseña que ingreses queda registrada.
        </div>
      </form>
    </div>
  );
}
