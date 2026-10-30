# Monotributo: carga por link — puesta en marcha

Cada mes, el día 12, los 14 monotributistas que cargan solos reciben un mail con un link personal.
Ahí cargan el importe y adjuntan el comprobante. La carga aparece en **Novedades HQ → Monotributo** como
**pendiente**. Se aprueba (de a uno o con "Aprobar todos") y se toca **Guardar**: recién ahí entra en la liquidación.
Los días 24 y 27 sale un recordatorio solo a quien todavía no cargó. El link sirve todo el mes: quien paga a mano carga apenas paga; quien tiene débito automático, después del 20 (o del hábil siguiente).

Gigio, Guido, Ignacio y Victoria no reciben mail: se siguen cargando a mano.

Piezas:
- `apps-script-monotributo.gs` — Apps Script nuevo e independiente: mails, Drive y recepción de la carga.
- `api/monotributo.js` — proxy de Vercel hacia ese Apps Script.
- `src/sueldos/PantallaMonotributoCarga.jsx` — la página del link (no pide login).

---

## Pasos (una sola vez)

### 1. Dos columnas nuevas en la planilla de Sueldos
En la hoja **su_novedades**, agregar al final dos encabezados (fila 1):
- `estado`
- `comprobante_url`

### 2. Crear el Apps Script
1. Entrar a https://script.google.com con la cuenta desde la que querés que salgan los mails → **Nuevo proyecto**.
2. Ponerle de nombre **BIGG Monotributo**.
3. Borrar lo que trae `Código.gs` y pegar todo el contenido de `apps-script-monotributo.gs`. Guardar.

### 3. Propiedades del script
Ir a **Configuración del proyecto** (engranaje) → **Propiedades del script** → agregar:

| Propiedad | Valor |
|---|---|
| `SUELDOS_URL` | el mismo valor que `VITE_SUELDOS_API_URL` en `.env.local` |
| `SUELDOS_TOKEN` | el mismo valor que `VITE_SHEETS_TOKEN` en `.env.local` |
| `APP_URL` | la dirección de la app en producción, sin barra al final (ej. `https://bigg-finance.vercel.app`) |
| `ADMIN_EMAIL` | tu mail (para la vista previa) |

### 4. Instalar
En el editor, elegir la función **`instalar`** arriba y tocar **Ejecutar**. Google pide permisos
(Drive, enviar mails, conectarse a servicios externos, ejecutar en segundo plano): aceptar.
Crea la carpeta **Comprobantes Monotributo** en tu Drive y los disparadores del 12 (aviso), 24 y 27 (recordatorios) a las 9 h.
En el registro tiene que decir "Legajos leídos: …" y "Listo".

### 5. Publicar como aplicación web
**Implementar → Nueva implementación** → tipo **Aplicación web**:
- Ejecutar como: **Yo**
- Quién tiene acceso: **Cualquier persona**

Copiar la **URL de la aplicación web** (termina en `/exec`).

### 6. Vercel
En Vercel → Settings → Environment Variables, agregar
`VITE_MONOTRIBUTO_API_URL` = la URL del paso 5. Agregarla también en `.env.local` para probar en local.
Después hay que volver a desplegar (lo hace solo el próximo push).

### 7. Vista previa
En el Apps Script, ejecutar **`vistaPreviaMail`**: te llegan a `ADMIN_EMAIL` los dos mails (aviso y recordatorio)
con tu propio link. Abrí el link y probá la carga; después aparece en la solapa Monotributo como pendiente.

---

## Si algo cambia
- **Alguien deja de ser monotributista o se suma uno:** editar la lista `AUTOCARGA` en el Apps Script
  y la de `PantallaNovedades.jsx`.
- **Corregir un importe:** mientras está pendiente, la persona puede volver a entrar al link y corregirlo.
  Una vez aprobado, se corrige desde la solapa.
- **Los comprobantes** quedan en Drive → Comprobantes Monotributo → una carpeta por mes.
