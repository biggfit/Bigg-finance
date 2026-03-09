import { useState, useCallback } from "react";

// ─── LOGIN ────────────────────────────────────────────────────────────────────
const USERS = [
  { email: "admin@bigg.com", password: "bigg2024", name: "Admin" },
];

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pass,  setPass]  = useState("");
  const [err,   setErr]   = useState("");

  const handleLogin = useCallback(() => {
    const u = USERS.find(u => u.email === email && u.password === pass);
    u ? onLogin(u) : setErr("Credenciales incorrectas");
  }, [email, pass, onLogin]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", backgroundImage: "radial-gradient(ellipse 80% 40% at 50% -5%, rgba(173,255,25,.07), transparent)" }}>
      <div className="fade" style={{ width: 400, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 20, padding: 40 }}>
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <div style={{ position: "relative", width: 72, height: 72, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--accent)", borderRadius: "50%" }}>
            <span style={{ fontWeight: 900, fontSize: 22, letterSpacing: ".12em", color: "#1e2022", lineHeight: 1 }}>BIGG</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: ".15em", textTransform: "uppercase", fontWeight: 700 }}>Franquicias</div>
        </div>
        {[
          ["EMAIL",       "email",    email, setEmail, "usuario@bigg.com"],
          ["CONTRASEÑA",  "password", pass,  setPass,  "••••••••"],
        ].map(([l, t, v, s, ph]) => (
          <div key={l} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".12em", marginBottom: 6, fontWeight: 700 }}>{l}</div>
            <input type={t} value={v} onChange={e => s(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder={ph} style={{ width: "100%", padding: "11px 16px" }} />
          </div>
        ))}
        {err && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 12, textAlign: "center" }}>{err}</div>}
        <button className="btn" style={{ width: "100%", padding: 13, fontSize: 13, marginTop: 6 }} onClick={handleLogin}>Ingresar</button>
        <div style={{ marginTop: 18, fontSize: 11, color: "var(--dim)", borderTop: "1px solid var(--border)", paddingTop: 14, textAlign: "center" }}>admin@bigg.com / bigg2024</div>
      </div>
    </div>
  );
}
