# Reintegros: carga por link — puesta en marcha

Cada persona de HQ tiene un **link personal permanente** (un formulario de reintegro). Lo usa cuando
tiene un gasto para que se lo reintegren: carga una o varias líneas (descripción + importe + uno o varios
comprobantes) y listo. No hay mails automáticos ni recordatorios: el link se reparte una vez (WhatsApp o
mail) o la persona lo guarda. El link **no caduca** y sirve todos los meses (el gasto cae en el mes en que
se carga).

Cada línea cargada aparece en **Novedades HQ → "Otros"** como **pendiente**, **sin cuenta contable**:
administración le asigna la cuenta, la aprueba (de a una o con "Aprobar todos") y toca **Guardar**. Recién
ahí entra en la liquidación y Santiago la paga con el sueldo del mes.

Es el mismo patrón que el monotributo por link, con tres diferencias: link permanente (no mail mensual),
varias líneas por carga (varios comprobantes por línea) y la cuenta la pone administración al aprobar.

Piezas:
- `apps-script-reintegro.gs` — Apps Script nuevo e independiente: recibe la carga, Drive y escribe las novedades.
- `api/reintegro.js` — proxy de Vercel hacia ese Apps Script.
- `src/sueldos/PantallaReintegroCarga.jsx` — el formulario del link (no pide login).

---

## Pasos (una sola vez)

### 1. Planilla de Sueldos
Las columnas `estado` y `comprobante_url` de **su_novedades** ya existen (las usa el monotributo). No hay que agregar nada.

### 2. Crear el Apps Script
1. Entrar a https://script.google.com con la cuenta de administración → **Nuevo proyecto**.
2. Ponerle de nombre **BIGG Reintegros**.
3. Borrar lo que trae `Código.gs` y pegar todo el contenido de `apps-script-reintegro.gs`. Guardar.

### 3. Propiedades del script
**Configuración del proyecto** (engranaje) → **Propiedades del script** → agregar:

| Propiedad | Valor |
|---|---|
| `SUELDOS_URL` | el mismo valor que `VITE_SUELDOS_API_URL` en `.env.local` |
| `SUELDOS_TOKEN` | el mismo valor que `VITE_SHEETS_TOKEN` en `.env.local` |
| `APP_URL` | la dirección de la app en producción, sin barra al final (ej. `https://bigg-finance.vercel.app`) |

(`SECRET` y `FOLDER_ID` los crea solos `instalar()`.)

### 4. Instalar
En el editor, elegir la función **`instalar`** arriba y **Ejecutar**. Google pide permisos (Drive, conectarse
a servicios externos): aceptar. Crea la carpeta **Comprobantes Reintegros** en el Drive. En el registro tiene
que decir "Legajos leídos: …" y "Listo". (No crea disparadores: este circuito no manda mails.)

### 5. Publicar como aplicación web
**Implementar → Nueva implementación** → tipo **Aplicación web**:
- Ejecutar como: **Yo**
- Quién tiene acceso: **Cualquier persona**

Copiar la **URL de la aplicación web** (termina en `/exec`).

### 6. Vercel
En Vercel → Settings → Environment Variables, agregar
`VITE_REINTEGRO_API_URL` = la URL del paso 5. Agregarla también en `.env.local` para probar en local.
Después hay que volver a desplegar (lo hace solo el próximo push).

### 7. Repartir los links
En el Apps Script, ejecutar **`listarLinks`**: imprime el link permanente de cada persona de HQ para copiar
y pasar por WhatsApp o mail. Para una sola persona: `linkDeLegajo("LEG-nako-XXXX")`.
Probá uno: abrí el link, cargá un gasto de prueba con comprobante → aparece en Novedades HQ → "Otros" como
pendiente. Aprobalo + Guardar.

---

## Cómo se usa (la persona)
Abre su link → "Agregar otro gasto" por cada ítem → en cada uno pone qué fue, el importe y adjunta el/los
comprobantes → "Enviar reintegro". Puede sumar varios comprobantes a un mismo gasto.

## Si algo cambia
- **Se suma o se va alguien de HQ:** el link sale del legajo (rol HQ/HQ_OWNER/HQ_EXT, activo). Volvé a correr
  `listarLinks` para el link del nuevo; el de quien se fue deja de funcionar al marcarlo inactivo.
- **Corregir un gasto:** mientras está pendiente se edita o se borra desde Novedades HQ → "Otros". Una vez
  aprobado, se corrige ahí mismo antes de cerrar la liquidación.
- **Los comprobantes** quedan en Drive → Comprobantes Reintegros → una carpeta por mes.

## Alcance
Hoy el circuito es de **HQ** (la novedad entra con sede vacía → solapa "Otros" de Novedades HQ). Si en el
futuro se quiere para Sedes, hay que setear `sede_id` según el legajo en `apps-script-reintegro.gs` y mostrar
la carga por link en Novedades Sedes.
