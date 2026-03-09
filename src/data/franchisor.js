export const DEFAULT_FRANCHISOR = {
  ar: {
    razonSocial:    "ÑAKO SRL",
    cuit:           "30-71234567-8",
    condIVA:        "Responsable Inscripto",
    domicilio:      "",
    localidad:      "Buenos Aires",
    provincia:      "CABA",
    cp:             "",
    telefono:       "",
    email:          "",
    puntoVenta:     "0001",
    cbu:            "",
    banco:          "",
    alias:          "",
    notaPie:        "",
  },
  usa: {
    legalName:      "BIGG FIT LLC",
    ein:            "",
    address:        "",
    city:           "",
    state:          "",
    zip:            "",
    country:        "United States",
    bankName:       "",
    routingNumber:  "",
    accountNumber:  "",
    swift:          "",
    notaPie:        "",
  },
};

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────
// Almacenamiento interno: dd/mm/aaaa  →  comparación: aaaa-mm-dd (temporal)
export const dmyToIso = d => { if (!d || !d.includes("/")) return d ?? ""; const [dd,mm,yy] = d.split("/"); return `${yy}-${mm}-${dd}`; };
export const isoToDmy = d => { if (!d || !d.includes("-")) return d ?? ""; const [yy,mm,dd] = d.split("-"); return `${dd}/${mm}/${yy}`; };
export const cmpDate    = (a, b) => dmyToIso(a).localeCompare(dmyToIso(b));
export const todayDmy   = () => { const n = new Date(); return `${String(n.getDate()).padStart(2,"0")}/${String(n.getMonth()+1).padStart(2,"0")}/${n.getFullYear()}`; };
export const dateMonth  = (dmy) => { if (!dmy) return 0; const p = dmy.split("/"); return parseInt(p[1], 10) - 1; };
export const dateYear   = (dmy) => { if (!dmy) return 0; const p = dmy.split("/"); return parseInt(p[2], 10); };
export const inPeriod   = (c, month, year) => dateMonth(c.date) === month && dateYear(c.date) === year;
export const upToPeriod = (c, year, month) => dateYear(c.date) < year || (dateYear(c.date) === year && dateMonth(c.date) <= month);

// ─── DATA ─────────────────────────────────────────────────────────────────────
// Moved to module scope — never changes, no reason to live inside the component tree.
