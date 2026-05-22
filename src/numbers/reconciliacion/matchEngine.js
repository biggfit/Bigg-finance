const MONTO_TOLERANCE = 0.5; // 50 centavos de tolerancia

// Normaliza fecha DD/MM/YYYY o YYYY-MM-DD → YYYY-MM-DD
export function normFecha(f) {
  if (!f) return "";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(f)) {
    const [d, m, y] = f.split("/");
    return `${y}-${m}-${d}`;
  }
  return f;
}

function diffDays(isoA, isoB) {
  return Math.abs(
    (new Date(isoA + "T00:00:00Z") - new Date(isoB + "T00:00:00Z")) /
    (1000 * 86400),
  );
}

/**
 * Para cada línea del extracto bancario, busca movimientos candidatos
 * dentro de nb_movimientos filtrando por cuenta bancaria, monto (±tolerance)
 * y fecha (±1 día).
 *
 * Estados resultantes por línea:
 *   matched   — exactamente 1 candidato no usado
 *   multiple  — varios candidatos
 *   no_match  — ninguno
 *   ignored   — marcada manualmente como ignorar
 */
export function autoMatch(bankLineas, movimientos, cuentaBancariaId, dateTolerance = 1) {
  // Solo movimientos de la cuenta, que no estén ya conciliados
  const pool = movimientos.filter(
    m => m.cuenta_bancaria === cuentaBancariaId && !m.conciliado,
  );

  // Primera pasada: encontrar candidatos para cada línea
  const withCandidates = bankLineas.map(line => {
    const sign    = Math.sign(line.monto);
    const absAmt  = Math.abs(line.monto);

    const candidates = pool.filter(m => {
      const montoM = Number(m.monto) || 0;
      if (Math.sign(montoM) !== sign) return false;
      if (Math.abs(Math.abs(montoM) - absAmt) > MONTO_TOLERANCE) return false;
      return diffDays(normFecha(m.fecha), line.fecha) <= dateTolerance;
    });

    return { ...line, candidates };
  });

  // Segunda pasada: asignar sin repetir el mismo movimiento
  const assigned = new Set();

  return withCandidates.map(line => {
    if (line.estado === "ignored") return line;

    const available = line.candidates.filter(c => !assigned.has(c.id));

    if (available.length === 0) {
      return { ...line, estado: "no_match", selected: null };
    }

    // Ordenar por proximidad de fecha
    const sorted = [...available].sort(
      (a, b) =>
        diffDays(normFecha(a.fecha), line.fecha) -
        diffDays(normFecha(b.fecha), line.fecha),
    );
    const best = sorted[0];
    assigned.add(best.id);

    return {
      ...line,
      estado:     available.length === 1 ? "matched" : "multiple",
      selected:   best,
      candidates: available,
    };
  });
}

/** Calcula estadísticas del resultado del match */
export function matchStats(results) {
  const matched  = results.filter(r => r.estado === "matched").length;
  const multiple = results.filter(r => r.estado === "multiple").length;
  const noMatch  = results.filter(r => r.estado === "no_match").length;
  const ignored  = results.filter(r => r.estado === "ignored").length;
  return { matched, multiple, noMatch, ignored, total: results.length };
}
