# Lector de correo (facturas por mail) — puesta en marcha

Un Apps Script **dentro de la casilla** (primero `pagos.es@bigg.fit`) lee su propia bandeja cuando alguien toca
**Leer el buzón** en Reportes › Correo. Por cada mail con factura identifica al proveedor por las reglas de
Numbers, saca número, fecha, vencimiento, total e IVA del cuerpo y del PDF, detecta la sede, y **parkea** la
factura en la bandeja de Correo (subtipo `EGRESO_BORRADOR`). El equipo la contabiliza o la ignora, como hoy.

No hay delegación de casillas, ni reenvíos, ni cron. Lo único que el script escribe en Gmail son **etiquetas**
(prefijo `Numbers/`, reversibles); nunca archiva ni borra:

| Etiqueta | Quién la pone | Qué significa |
|---|---|---|
| `Numbers/Contabilizada` | la bandeja, al Contabilizar (y marca leído) | ya es un egreso en Numbers |
| `Numbers/Ignorada` | la bandeja, al Ignorar (y marca leído) | se decidió no contabilizar |
| `Numbers/Descartado` | el lector, en cada corrida | no es una factura (newsletter, aviso, pedido, catálogo) |
| `Numbers/Lote` | el lector, en cada corrida | ráfaga o lote de históricos, no se parkea |
| sin etiqueta | — | pendiente: está en la bandeja de Numbers esperando decisión |

Así en Gmail se filtra por etiqueta (`label:Numbers-Descartado`) y se borra o archiva en bloque lo que no sirve;
esa decisión siempre es de una persona. Si el marcado falla, la contabilización igual queda hecha y la bandeja avisa.
Al activar las etiquetas por primera vez, `etiquetarRetroactivo` (editor) etiqueta lo ya descartado en corridas previas. Para Argentina (`pagos@`) se repite el mismo procedimiento con otro proyecto y otras
propiedades (sociedad por remitente, moneda ARS).

Piezas:
- `apps-script-lector-correo.gs` — Apps Script nuevo e independiente, uno por casilla.
- `api/lector.js` — proxy de Vercel hacia ese Apps Script (`?buzon=es|ar`).
- `src/numbers/reportes/TabCorreo.jsx` — botón **Leer el buzón** y resumen de la corrida.
- `src/numbers/PantallaMaestros.jsx` — tres tipos de match nuevos en Reglas de banco: `remitente`, `asunto`, `sede`.

---

## Pasos (una sola vez, por casilla)

### 1. Crear el Apps Script logueado como la casilla
1. Entrar a https://script.google.com **con la cuenta pagos.es@bigg.fit** (en una ventana de incógnito si hace
   falta: el proyecto tiene que ser de esa cuenta, porque lee *su* Gmail) → **Nuevo proyecto**.
2. Nombre: **BIGG Lector de Correo (España)**.
3. Borrar lo que trae `Código.gs` y pegar todo el contenido de `apps-script-lector-correo.gs`. Guardar.

### 2. Habilitar la API de Drive (para leer el texto de los PDF)
En el editor, en el panel izquierdo **Servicios** → **+** → elegir **Drive API** → versión **v2** → Agregar.
(El script convierte cada PDF a un Google Doc temporal para leer su texto y lo borra en el acto. Si el PDF es
una imagen escaneada, Google le hace OCR en ese mismo paso.)

### 3. Propiedades del script
**Configuración del proyecto** (engranaje) → **Propiedades del script** → agregar:

| Propiedad | Valor |
|---|---|
| `NUMBERS_URL` | el mismo valor que `VITE_NUMBERS_API_URL` en `.env.local` |
| `NUMBERS_TOKEN` | el mismo valor que `VITE_SHEETS_TOKEN` en `.env.local` |
| `SOCIEDAD` | `wellness` |
| `MONEDA` | `EUR` |
| `PAIS` | `ES` |
| `FECHA_CORTE` | `2026-10-01` — no se mira nada anterior (por ejemplo el lote de 25 facturas viejas de Voldis reenviado el 8/10) |
| `BUZON` | `pagos.es@bigg.fit` (si se deja vacío, `instalar` lo completa con la cuenta activa) |

Opcionales, con valor por defecto: `INTERNOS` (dominios internos, `bigg.fit`), `IVA_DEFAULT` (`21`),
`PALABRAS_FACTURA`, `PALABRAS_DESCARTE` y `PALABRAS_PDF_DESCARTE` (expresiones regulares del filtro de entrada:
qué cuenta como factura, qué asuntos se descartan, qué PDF adjuntos no son facturas), `PARKEAR_SIN_PDF` (`0`: un mail
sin PDF nunca se parkea, aunque el proveedor sea conocido).

### 4. Instalar
Elegir la función **`instalar`** arriba y tocar **Ejecutar**. Google pide permisos: leer Gmail, Drive y
conectarse a un servicio externo (la API de Numbers). Aceptar. En el registro tiene que aparecer la cantidad
de proveedores leídos, cuántas reglas del lector hay en el Sheet y los hilos de la bandeja. Si falla, revisar
`NUMBERS_URL` / `NUMBERS_TOKEN`.

### 5. Reglas
El script **no tiene reglas adentro**: todo sale de **Maestros › Reglas de banco** (`nb_banco_reglas`). Las 27
relevadas en el buzón el 11/11/2026 ya están cargadas (ids `REG-ML-01…16` remitentes → proveedor/cuenta/centro,
`REG-ML-S1…S11` textos de sede). Se editan, desactivan o amplían ahí, sin tocar el script.

### 6. Simulacro (recomendado)
Elegir **`simulacro`** → **Ejecutar** → **Registro de ejecución**. Muestra qué parkearía y qué detecta como ya
cargado, **sin escribir nada**. Es el momento de agregar reglas si algo quedó sin proveedor o sin sede.

### 7. Publicar como aplicación web
**Implementar → Nueva implementación** → tipo **Aplicación web** → *Ejecutar como:* **Yo** · *Acceso:*
**Cualquier persona** → Implementar. Copiar la **URL /exec**.

### 8. Vercel
**Settings → Environment Variables** → `VITE_LECTOR_ES_URL` = la URL /exec del paso 7. Redeploy.
Para probar en local, lo mismo en `.env.local` y `vercel dev` (el botón pasa por `/api/lector`).

---

## Uso

**Reportes › Correo** tiene una solapa por casilla (España · pagos.es@ y Argentina · pagos@), cada una con su
conteo de pendientes y su botón; un borrador sin buzón en la nota (parkeado a mano) cae en Argentina. La columna
"Fecha correo" va primera. Botón **Leer el buzón (España)**: corre el script y muestra cuántos mails revisó,
cuántas facturas parkeó (con proveedor, número, total y sede), cuántas ya estaban cargadas y cuántas quedaron
**sin regla** (se parkean igual, con el remitente como proveedor, para que alguien las resuelva).

Si la corrida supera los 45 segundos (muchos PDF), el botón la continúa solo hasta terminar.

## Cómo decide

| Paso | Fuente | Qué hace |
|---|---|---|
| Entrada | mail + reglas | Solo mails desde `FECHA_CORTE` con PDF adjunto (la factura siempre viene en PDF; avisos y pedidos del mismo proveedor no se parkean); descarta catálogos, newsletters, PDF que no son facturas (certificados, contratos, IPC) y adjuntos > 5 MB. Una regla `remitente`/`asunto` con acción **ignorar** descarta el mail. El mismo PDF repetido en un hilo se toma una sola vez. |
| Remitente real | cuerpo | En un reenvío interno (Lucía, Bautista, Gonzalo) toma el primer `De:` que no sea `@bigg.fit`. |
| Proveedor e imputación | `nb_banco_reglas` (`remitente`, `asunto`) → `nb_proveedores.remitenteMail` | Gana la coincidencia más larga; aporta proveedor, cuenta y centro. Todo en `escala`. |
| Datos | texto del PDF, si no el cuerpo | Número, fecha de factura, período (fecha = fin del período), vencimiento, total, % IVA (21 % si no lo dice). |
| Sede | `nb_banco_reglas` (`sede`) sobre asunto + cuerpo + PDF | Una sola sede → se imputa. Ninguna o varias (GCS, Scentair) → centro vacío y nota `sedes=…`, se reparte desde "Abrir para editar". |
| Dedup | `nb_comprobantes` de la sociedad | 1) `COR-<mailId>` ya existe · 2) mismo proveedor y mismo número (normalizado: `26/219518` ≡ `26-219518`, `1/202604094` ≡ `202604094`, sin ceros a la izquierda) · 3) mismo proveedor, mismo total y mismo mes de servicio. |
| Escritura | API de Numbers, `add_batch` | Una sola escritura por corrida. `registrado_por = lector-correo`. |

La nota del borrador guarda `mail_ref`, `fecha_correo`, `remitente`, `buzon`, `archivo`, la regla aplicada y las
marcas `sin_regla`, `sin_total` o `sedes` cuando corresponde. "Ver mail" abre el hilo en la casilla correcta.

## Mantenimiento

- Proveedor nuevo: alta en Maestros › Proveedores con `remitenteMail`, o una regla `remitente` en Reglas de banco.
- Sede nueva o un texto que no reconoce: regla `sede` con el fragmento (sin acentos) y el centro.
- Mail que no es factura y molesta: regla `remitente` o `asunto` con acción **ignorar**.
- Sin ninguna regla de sede que matchee, o con varias (factura multi-sede), el centro queda vacío a propósito.
- `?accion=estado` (desde `/api/lector?buzon=es&accion=estado&token=…`) muestra la configuración y la última corrida.
- `?accion=reset` hace que vuelva a mirar todo desde la fecha de corte; lo ya parkeado no se duplica (candado 1).
- `?accion=marcar&ref=<hilo>&estado=contabilizada|ignorada` es lo que llama la bandeja al decidir; se puede usar a mano.
- Simulacro acotado a un proveedor: propiedad `SIMULACRO_FILTRO` (ej. `from:grupovoldis.es`); solo afecta al simulacro.
- Ráfagas: más de `MAX_PDFS_POR_MAIL` mails del mismo remitente en 5 minutos (reenvío masivo de históricos) se reportan como lote y no se parkean.

## Lo que NO resuelve (y sigue como hasta ahora)

Proveedores que no mandan factura por mail: Telefónica y Naturgy (portal), Prosegur, Segurcaixa, Coca-Cola,
Viva Aqua, Google Ads, Cecile, MyBox, expensas. Se contabilizan desde el débito con las reglas de banco.
