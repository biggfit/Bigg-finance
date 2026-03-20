import { useState, useMemo, useRef, useEffect } from "react";

export default function FrSearch({ franchises, selected, onChange, placeholder = "Buscar sede, país o mail…" }) {
  const [query, setQuery] = useState("");
  const [open,  setOpen]  = useState(false);
  const ref = useRef(null);

  // Cierra al hacer click fuera
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Filtra por query: nombre, país, emailFactura o emailComercial
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return franchises;
    return franchises.filter(fr =>
      fr.name?.toLowerCase().includes(q) ||
      fr.country?.toLowerCase().includes(q) ||
      fr.emailFactura?.toLowerCase().includes(q) ||
      fr.emailComercial?.toLowerCase().includes(q)
    );
  }, [franchises, query]);

  // Agrupa por país
  const byCountry = useMemo(() => {
    const map = new Map();
    for (const fr of filtered) {
      const c = fr.country ?? "—";
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(fr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "es"));
  }, [filtered]);

  const toggleFr = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(next);
  };

  const toggleCountry = (frs) => {
    const ids = frs.map(f => f.id);
    const allSel = ids.every(id => selected.has(id));
    const next = new Set(selected);
    allSel ? ids.forEach(id => next.delete(id)) : ids.forEach(id => next.add(id));
    onChange(next);
  };

  const clearAll = (e) => { e.stopPropagation(); onChange(new Set()); setQuery(""); };

  const hasSelection = selected.size > 0;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Input + badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 5,
        background: "var(--bg)", border: `1px solid ${hasSelection ? "var(--accent)" : "var(--border2)"}`,
        borderRadius: 6, padding: "2px 8px", minWidth: 200 }}>
        <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>🔍</span>
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={hasSelection ? "" : placeholder}
          style={{ border: "none", outline: "none", background: "transparent",
            color: "var(--text)", fontSize: 11, fontFamily: "var(--font)",
            flex: 1, minWidth: 0, padding: "2px 0" }}
        />
        {hasSelection && (
          <>
            <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>
              {selected.size} sede{selected.size !== 1 ? "s" : ""}
            </span>
            <button
              onMouseDown={clearAll}
              style={{ border: "none", background: "none", color: "var(--muted)", cursor: "pointer",
                fontSize: 12, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}
              title="Limpiar selección"
            >✕</button>
          </>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0,
          zIndex: 300, background: "var(--bg2)",
          border: "1px solid var(--border2)", borderRadius: 8,
          boxShadow: "0 6px 24px rgba(0,0,0,.5)",
          minWidth: 280, maxHeight: 320, overflowY: "auto",
        }}>
          {byCountry.length === 0 ? (
            <div style={{ padding: "14px 16px", fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
              Sin resultados
            </div>
          ) : byCountry.map(([country, frs]) => {
            const allSel  = frs.every(f => selected.has(f.id));
            const someSel = !allSel && frs.some(f => selected.has(f.id));
            return (
              <div key={country}>
                {/* Cabecera de país */}
                <div
                  onMouseDown={() => toggleCountry(frs)}
                  style={{ display: "flex", alignItems: "center", gap: 8,
                    padding: "7px 12px", cursor: "pointer",
                    background: "rgba(255,255,255,.04)",
                    borderBottom: "1px solid var(--border)",
                    userSelect: "none" }}
                >
                  <input
                    type="checkbox"
                    checked={allSel}
                    ref={el => { if (el) el.indeterminate = someSel; }}
                    onChange={() => {}}
                    style={{ accentColor: "var(--accent)", cursor: "pointer", flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", flex: 1 }}>{country}</span>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>{frs.length}</span>
                </div>
                {/* Franquicias */}
                {frs.map(fr => (
                  <div
                    key={fr.id}
                    onMouseDown={() => toggleFr(fr.id)}
                    style={{ display: "flex", alignItems: "center", gap: 8,
                      padding: "5px 12px 5px 28px", cursor: "pointer",
                      background: selected.has(fr.id) ? "rgba(173,255,25,.07)" : "transparent",
                      borderBottom: "1px solid rgba(255,255,255,.03)",
                      userSelect: "none" }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(fr.id)}
                      onChange={() => {}}
                      style={{ accentColor: "var(--accent)", cursor: "pointer", flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 11, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fr.name}</span>
                    {(fr.emailFactura || fr.emailComercial) && (
                      <span style={{ fontSize: 9, color: "var(--muted)", flexShrink: 0, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {fr.emailFactura ?? fr.emailComercial}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
