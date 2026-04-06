// ─── STATIC CSS ───────────────────────────────────────────────────────────────
// Injected once outside the component tree — not re-injected on every render.
const styleEl = document.createElement("style");
styleEl.textContent = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#1e2022;--bg2:#282b2e;--bg3:#323639;
  --border:#3a3e42;--border2:#484d52;
  --text:#F0F0F0;--muted:#A6A6A6;--dim:#3a3e42;
  --accent:#ADFF19;
  --blue:#6ec6f5;--purple:#b8a9f5;--red:#ff6b7a;--green:#7ed9a0;
  --gold:#DEFB97;--orange:#f5c46e;--cyan:#7ed9d9;
  --font:'Messina Sans',sans-serif;--mono:'JetBrains Mono',monospace;
}
body{background:var(--bg);color:var(--text);font-family:var(--font)}
input,select,textarea{font-family:var(--font);background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:20px;outline:none;transition:border-color .15s;font-size:13px}
input:focus,select:focus,textarea:focus{border-color:var(--accent)}
::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:var(--bg)}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
.fade{animation:fi .2s ease}@keyframes fadeInDown{from{opacity:0;transform:translateX(-50%) translateY(-8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
@keyframes fi{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.tab{background:transparent;border:1.5px solid var(--border2);color:var(--muted);border-radius:999px;padding:6px 18px;font-family:var(--font);font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;transition:all .15s}
.tab:hover{border-color:var(--accent);color:var(--text)}.tab.on{background:var(--accent);border-color:var(--accent);color:#1e2022;font-weight:800}
.btn{background:var(--accent);color:#1e2022;border:none;border-radius:999px;padding:8px 20px;font-family:var(--font);font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
.btn:hover{opacity:.85}.btn:disabled{opacity:.35;cursor:default}
.ghost{background:transparent;color:var(--muted);border:1.5px solid var(--border2);border-radius:999px;padding:5px 14px;font-family:var(--font);font-size:11px;font-weight:700;cursor:pointer;transition:all .15s}
.ghost:hover{color:var(--accent);border-color:var(--accent)}.ghost:disabled{opacity:.35;cursor:default;pointer-events:none}
.del{background:transparent;color:var(--red);border:1px solid rgba(255,107,122,.2);border-radius:999px;padding:3px 10px;font-size:10px;font-weight:700;cursor:pointer;font-family:var(--font)}
table{width:100%;border-collapse:collapse}
th{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:9px 12px;border-bottom:1px solid var(--border);white-space:nowrap;text-align:left}
td{padding:9px 12px;font-size:13px;border-bottom:1px solid var(--border);vertical-align:middle;white-space:nowrap}
tr:last-child td{border-bottom:none}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.08em}
.mono{font-family:var(--mono);white-space:nowrap}
input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
input[type=number]{-moz-appearance:textfield}
`;
document.head.appendChild(styleEl);
