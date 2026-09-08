import { T } from "./theme";

// Confirmación dentro de la app (NO usa window.confirm). Chrome — tras varios confirm() seguidos, o si
// el usuario tildó "impedir cuadros de diálogo adicionales" — los desactiva en silencio (confirm()
// devuelve false sin mostrar nada) y el botón "no hace nada". Este modal lo dibuja React, así que
// nunca queda mudo. Uso: guardar un estado { message, onConfirm } y renderizar <ConfirmModal .../>.
export default function ConfirmModal({
  open, title, message,
  confirmLabel = "Sí", cancelLabel = "No",
  danger = true, busy = false, onConfirm, onCancel,
}) {
  if (!open) return null;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.55)", zIndex:700,
      display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={busy ? undefined : onCancel}>
      <div className="fade" style={{ background:T.card, borderRadius:10, width:430, maxWidth:"96vw",
        boxShadow:"0 20px 60px rgba(0,0,0,.35)", overflow:"hidden" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding:"18px 22px 6px" }}>
          {title && <div style={{ fontSize:15, fontWeight:800, color:T.text, marginBottom:8 }}>{title}</div>}
          <div style={{ fontSize:13, color:T.muted, lineHeight:1.5, whiteSpace:"pre-line" }}>{message}</div>
        </div>
        <div style={{ padding:"14px 22px 18px", display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onCancel} disabled={busy}
            style={{ padding:"9px 18px", borderRadius:8, border:`1px solid ${T.cardBorder}`, cursor: busy ? "default" : "pointer",
              background:"#f3f4f6", color:T.muted, fontWeight:700, fontSize:13, fontFamily:T.font }}>{cancelLabel}</button>
          <button onClick={onConfirm} disabled={busy} autoFocus
            style={{ padding:"9px 18px", borderRadius:8, border:"none", cursor: busy ? "default" : "pointer",
              background: danger ? "#dc2626" : "#16a34a", color:"#fff", fontWeight:700, fontSize:13, fontFamily:T.font }}>
            {busy ? "…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
