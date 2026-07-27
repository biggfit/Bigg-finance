# BIGG Finance — Onboarding

Sistema del equipo: **Numbers** (contabilidad, `nb_*`), **Sueldos** (`su_*`) y **Franquicias**.
Front en **React + Vite**; los datos viven en **Google Sheets** vía Google Apps Script (GAS),
expuestos por endpoints serverless en `/api`. Se edita y se opera desde **Claude Code**.

## Levantar el proyecto (local)

1. Cloná el repo y entrá a la carpeta.
2. `npm install`
3. Poné el archivo **`.env.local`** en la raíz (al lado de `package.json`). **Martín te lo pasa por
   canal seguro** (1Password / nota encriptada) — nunca por WhatsApp/mail. Son tokens de escritura a
   producción y de Mercado Pago: tratalos como contraseñas.
4. `npm run dev` → abrir **http://localhost:5173**

## Variables de entorno (nombres — los valores te los pasa Martín)

**Para correr la app (cliente):**
- `VITE_NUMBERS_API_URL` — GAS de Numbers
- `VITE_SUELDOS_API_URL` — GAS de Sueldos
- `VITE_SHEETS_API_URL` — GAS de Franquicias
- `VITE_SHEETS_TOKEN` — token de escritura a las hojas (mismo para los 3)

**Solo para los `/api/*` serverless (no imprescindibles para trabajar local):**
- `BIGG_EYE_TOKEN` — horas/CDP de BIGG Eye
- `MP_ACCESS_TOKEN_HEKTOR` — saldo Mercado Pago en vivo
- `FACTURANTE_ENDPOINT` · `FACTURANTE_EMPRESA` · `FACTURANTE_USUARIO` · `FACTURANTE_HASH` — Facturante

## Importante

- Con **`npm run dev`** corre la app y lee los `VITE_*`. Los endpoints **`/api/*`** (BIGG Eye en vivo,
  Mercado Pago, Facturante) **NO corren con `vite` común** — solo con `vercel dev` o ya deployado en
  Vercel. O sea: se puede trabajar casi todo local; el "Re-sincronizar BIGG Eye" en vivo y el saldo MP
  se ven **en Vercel**, no en localhost (local usan caché / "—"). Es esperable, no es un bug.
- **Datos reales:** el token da acceso de lectura/escritura a las hojas de **producción**. Cuidado con
  lo que se guarda/borra. Nunca borrar filas de las hojas sin estar seguro.

## Flujo de trabajo (git / deploy)

- Se trabaja en la rama `sueldos/sedes-resumen-novedades` y se sincroniza a **`main`**.
- **Vercel producción** (bigg-finance.vercel.app) deploya desde **`main`** → para ver un cambio en
  producción, tiene que estar en `main`.
- Después de un cambio: `npm run build` (que quede verde) → commit → push a la rama → sync a `main`.

## Orientación rápida del código

- `src/numbers/` — módulos de Numbers (Tesorería, Ingresos, Egresos, Conciliación, Reportes, Financiaciones, Socios…).
- `src/sueldos/` — Liquidación HQ / Sedes, Novedades, Resúmenes (recibos).
- `src/App.jsx` + `src/tabs/` + `src/components/` — app de Franquicias.
- `src/lib/numbersApi.js` / `src/lib/sueldosApi.js` / `src/lib/sheetsApi.js` — capas de datos (fetch/write a los GAS).
- `api/` — funciones serverless (BIGG Eye horas/CDP, Mercado Pago, Facturante) — corren en Vercel.
