# Integración con Facturante — Diagrama de Flujo

## Arquitectura General

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BROWSER (React)                             │
│                                                                     │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │TabFacturador │  │ PendientesPanel  │  │     FrDetail          │  │
│  │  (individual │  │  (pendientes     │  │  (estado de cuenta,   │  │
│  │   + masiva)  │  │   sin emitir)    │  │   descarga PDF)       │  │
│  └──────┬───────┘  └────────┬─────────┘  └──────────┬────────────┘  │
│         │                   │                        │              │
│         └───────────┬───────┘────────────────────────┘              │
│                     ▼                                               │
│          ┌─────────────────────┐                                    │
│          │   facturanteApi.js  │                                    │
│          │  emitirComprobante()│                                    │
│          │  downloadFacturantePdfBlob│                            │
│          │  fetchAfipNumero()  │                                    │
│          │  formatInvoiceLabel│                                    │
│          └─────────┬──────────┘                                    │
└────────────────────┼────────────────────────────────────────────────┘
                     │ POST /api/facturante
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  VERCEL SERVERLESS (api/facturante.js)               │
│                     timeout: 30s                                    │
│                                                                     │
│   Env vars:                                                         │
│   ├── FACTURANTE_EMPRESA    (ID empresa)                            │
│   ├── FACTURANTE_HASH       (auth hash)                             │
│   ├── FACTURANTE_USUARIO    (usuario)                               │
│   └── FACTURANTE_ENDPOINT   (URL del servicio)                      │
│                                                                     │
│   Acciones:                                                         │
│   ├── action: "emitir"  → SOAP CrearComprobante / CrearFull / SinImp│
│   ├── action: "getPdf"  → SOAP DetalleComprobanteFull → fetch PDF  │
│   ├── action: "getNumero" → SOAP DetalleComprobanteFull (nº/pref) │
│   └── action: "anular"  → 501 (no implementado)                   │
└─────────────────────┬───────────────────────────────────────────────┘
                      │ SOAP/XML (15s timeout)
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    FACTURANTE API (WCF/SOAP)                        │
│                                                                     │
│   Operaciones:                                                      │
│   ├── CrearComprobante          (FA/NC con IVA)                     │
│   ├── CrearComprobanteFull      (NC con documento asociado)         │
│   ├── CrearComprobanteSinImpuestos  (FA/NC sin IVA)                 │
│   └── DetalleComprobanteFull    (consulta + URL PDF)                │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          AFIP                                       │
│   Asigna número secuencial (Prefijo + Numero)                       │
│   Genera comprobante fiscal oficial                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Flujo de Emisión de Comprobante

```
Usuario completa form
        │
        ▼
┌───────────────────┐
│ ¿Es Argentina     │──── NO ──→ getNextInvoiceNum() → número manual
│ + ARS + ÑAKO SRL? │
└────────┬──────────┘
         │ SÍ
         ▼
┌───────────────────┐
│ ¿Tiene IVA?       │
│ (applyIVA)        │
└──┬─────────────┬──┘
   │ SÍ          │ NO
   ▼             ▼
┌──────────┐  ┌────────────────────────┐
│¿Es NC?   │  │CrearComprobanteSinImp  │
└─┬──────┬─┘  └────────────────────────┘
  │SÍ    │NO
  ▼      ▼
┌─────────────────┐  ┌──────────────────┐
│CrearComprobante │  │CrearComprobante  │
│Full (con ref FA)│  │  (sin asociado)  │
└────────┬────────┘  └────────┬─────────┘
         └──────┬─────────────┘
                ▼
┌───────────────────────────────┐
│  Facturante procesa → AFIP    │
└───────────────┬───────────────┘
                ▼
┌───────────────────────────────┐
│  Polling: DetalleComprobante  │
│  5 intentos, 2s entre cada una │
│  (tras el 1.er intento)       │
│  Espera número AFIP           │
└───────────────┬───────────────┘
                ▼
┌───────────────────────────────┐
│  Respuesta al cliente:        │
│  ├── idComprobante (interno)  │
│  ├── afipNumero               │
│  ├── afipPrefijo              │
│  └── tipoComprobante          │
└───────────────┬───────────────┘
                ▼
┌───────────────────────────────┐
│  formatInvoiceLabel()         │
│  "FA 0100-00000010"           │
└───────────────┬───────────────┘
                ▼
┌───────────────────────────────┐
│  Guardar en Google Sheets     │
│  campos: invoice, facturanteId│
└───────────────────────────────┘
```

---

## Tipos de Comprobante

```
                    ┌──────────────────────┐
                    │   condIVA destino     │
                    ├──────────┬───────────┤
                    │    RI    │  Exento   │
┌───────────┬──────┼──────────┼───────────┤
│           │  FA  │  FA (A)  │  FB (B)   │
│  Tipo     ├──────┼──────────┼───────────┤
│           │  NC  │  NCA     │  NCB      │
└───────────┴──────┴──────────┴───────────┘

Códigos legacy → nuevos:
  1 → FA    3 → FB    6 → NCA    8 → NCB
```

---

## Flujo de Descarga PDF

```
Usuario clickea número de factura
        │
        ▼
┌───────────────────────┐
│ ¿Tiene facturanteId?  │── NO ──→ Genera HTML local
└────────┬──────────────┘
         │ SÍ
         ▼
POST /api/facturante { action: "getPdf", idComprobante }
         │
         ▼
DetalleComprobanteFull → extrae URLPDF
         │
         ▼
Fetch HTTPS al PDF → binary blob → descarga en browser
         │
    ¿Error?
    │ SÍ → fallback a HTML generado
    │ NO → archivo PDF oficial AFIP
```

---

## Facturación Masiva

```
┌───────────────────────────────────────┐
│  Selección de franquicias + fees      │
│  (múltiples registros)                │
└───────────────┬───────────────────────┘
                │
                ▼
        ┌───────────────┐
        │  Loop por cada │
        │  franquicia    │◄──────────────┐
        └───────┬───────┘               │
                │                       │
                ▼                       │
        ┌───────────────┐               │
        │ emitirComp()  │               │
        │ (individual)  │               │
        └───────┬───────┘               │
                │                       │
           ┌────┴────┐                  │
           │         │                  │
        OK ▼      ERROR ▼              │
     guardar      loguear              │
     resultado    error                │
           │         │                  │
           └────┬────┘                  │
                │ ¿quedan más?          │
                ├── SÍ ─────────────────┘
                │
                ▼ NO
        ┌───────────────────┐
        │ Resumen:           │
        │ ✓ exitosas         │
        │ ✗ fallidas         │
        └───────────────────┘
```

---

## Datos que se persisten (Google Sheets)

```
┌────────────────────────────────────────────────────┐
│  Comprobante guardado                              │
├──────────────┬─────────────────────────────────────┤
│ id           │ timestamp-random (interno)          │
│ frId         │ ID franquicia                       │
│ type         │ FACTURA|FEE, NC|FEE, etc.           │
│ date         │ dd/mm/yyyy                          │
│ amount       │ total con IVA                       │
│ amountNeto   │ neto sin IVA                        │
│ amountIVA    │ monto IVA (21%)                     │
│ currency     │ ARS / USD                           │
│ empresa      │ ÑAKO SRL                            │
│ ref          │ "Fee Marzo 2026"                    │
│ invoice      │ "FA 0100-00000010" (AFIP)           │
│ facturanteId │ 4521 (para descargar PDF)           │
│ month        │ 0-indexed (0=Ene)                   │
│ year         │ 2026                                │
└──────────────┴─────────────────────────────────────┘
```

---

## Condición de Pago

```
┌─────────────┐
│ ¿Es NC?     │── SÍ ──→ Siempre CONTADO (CondVenta=1)
└──────┬──────┘
       │ NO
       ▼
┌─────────────┐
│ ¿Contado?   │── SÍ ──→ CondVenta=1, CondPago=1
└──────┬──────┘
       │ NO
       ▼
CondVenta=2 (cta cte)
CondPago=30 días
FechaVtoPago = día 10 del mes siguiente
```

---

## Manejo de Errores


| Etapa               | Retry                                      | Acción si falla                                                              |
| ------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| SOAP a Facturante   | No                                         | Error inmediato al usuario                                                   |
| Polling AFIP número | 5×2s (código: `pollAfipNumero(id,5,2000)`) | Retorna `afipNumero: null`, emisión OK; UI puede reconsultar con `getNumero` |
| Descarga PDF        | No                                         | Fallback a HTML generado                                                     |
| Emisión masiva      | No por item                                | Continúa con siguiente, loguea error                                         |


---

## Variables de Entorno


| Variable              | Descripción              | Ejemplo                                       |
| --------------------- | ------------------------ | --------------------------------------------- |
| `FACTURANTE_EMPRESA`  | ID empresa en Facturante | `12345`                                       |
| `FACTURANTE_HASH`     | Hash de autenticación    | `abc123...`                                   |
| `FACTURANTE_USUARIO`  | Usuario/email            | `user@empresa.com`                            |
| `FACTURANTE_ENDPOINT` | URL del servicio SOAP    | `https://facturante.com/api/comprobantes.svc` |


---

## Documento de homologación (Facturante / auditoría)

Mapeo completo BFF–SOAP, tablas de campos, seguridad, alcance y límites: [facturante-homologacion.md](facturante-homologacion.md).