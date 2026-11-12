# Lector de correo (facturas por mail) — puesta en marcha

Un Apps Script **dentro de la casilla** (primero `pagos.es@bigg.fit`) lee su propia bandeja cuando alguien toca
**Leer el buzón** en Reportes › Correo. Por cada mail con factura identifica al proveedor por las reglas de
Numbers, le manda el PDF a **Gemini** (modelo `gemini-3.1-flash-lite`), que devuelve número, fechas, importes,
sede y reparto por sede en un JSON con esquema, y **parkea** la factura en la bandeja de Correo (subtipo
`EGRESO_BORRADOR`). El equipo la contabiliza o la ignora, como hoy. El modelo solo extrae datos: proveedor,
cuenta y centro siguen saliendo de las reglas del Sheet. Sin clave de Gemini, o si la API falla, el script usa
la extracción por patrones sobre el texto del PDF (como la v5).

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

### 2. Habilitar la API de Drive (solo para el fallback por patrones)
En el editor, en el panel izquierdo **Servicios** → **+** → elegir **Drive API** → versión **v2** o **v3** → Agregar.
(Con Gemini activo no se usa: el modelo lee el PDF directo. Si falta la clave o la API falla, el script convierte
el PDF a un Google Doc temporal para leer su texto y lo borra en el acto.)

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
| `GEMINI_KEY` | clave de la API de Gemini (Google AI Studio, proyecto con facturación activa: en el nivel gratuito Google puede usar los PDF para entrenar). **Nunca va en el código ni en el repo.** |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` (se cambia acá, sin tocar el código) |

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
| Datos | Gemini sobre el PDF (fallback: patrones sobre el texto del PDF, si no el cuerpo) | Número (tal como está impreso), fecha de emisión (`fecha_fiscal`), período de servicio (`fecha` = fin del período, si termina como mucho 75 días antes de la emisión), vencimiento, base, % IVA y total, CIF del emisor, dirección/referencias de la sede, reparto por sede si la factura lo trae. Chequeos: base + IVA = total, nº y fecha presentes, vto ≥ emisión, confianza; lo que no cierra se parkea igual con `revisar=…` en la nota (🔎 en la bandeja). Un PDF que el modelo dice que no es factura (pedido, albarán, certificado) se descarta si el remitente no tiene regla; si es un proveedor conocido se parkea con `revisar=tipo:…`. |
| Proveedor por CIF | `nb_proveedores.cuit` | Sin regla ni `remitenteMail` que matchee, el CIF que figura en la factura identifica al proveedor (nota `por_cif=1`). |
| Sede | `nb_banco_reglas` (`sede`) sobre asunto + cuerpo + dirección y referencias del PDF; después la sede elegida por el modelo | Las reglas `sede` son también el diccionario que recibe el modelo (centro → direcciones, nombres, nº de contrato, CUPS); un nº de contrato matchea aunque el proveedor lo imprima distinto (`134-31369` ≡ `134031369`). Una sola sede → se imputa. Varias con el reparto en la propia factura (Scentair: una línea por gimnasio) → una línea por centro, se contabiliza entera. Ninguna o varias sin reparto (GCS) → centro vacío y nota `sedes=…`, se reparte desde "Abrir para editar". |
| Dedup | `nb_comprobantes` de la sociedad | 1) `COR-<mailId>` ya existe · 2) mismo proveedor y mismo número (normalizado: `26/219518` ≡ `26-219518`, `1/202604094` ≡ `202604094`, sin ceros a la izquierda) · 3) mismo proveedor, mismo total y mismo mes de servicio. |
| Escritura | API de Numbers, `add_batch` | Una sola escritura por corrida. `registrado_por = lector-correo`. |

La nota del borrador guarda `mail_ref`, `fecha_correo`, `remitente`, `buzon`, `archivo`, la regla aplicada y las
marcas `sin_regla`, `sin_total`, `sedes`, `fuente=gemini`, `revisar=…`, `por_cif` o `pagada` cuando corresponde.
"Ver mail" abre el hilo en la casilla correcta; "Ver PDF" muestra el adjunto sin salir de la bandeja.

## Control: revisar los descartados

Cada tanto, en Gmail, filtrar `label:Numbers-Descartado has:attachment` y pasar la vista por los asuntos: si
hay una factura ahí, es que al remitente le falta regla. Corrección en dos pasos:
1. Cargar la regla (`remitente` o `asunto`) en Maestros › Reglas de banco, o el `remitenteMail` del proveedor.
2. En Gmail, **sacarle la etiqueta Numbers/Descartado** a ese mail y tocar **Leer el buzón**: el lector lo vuelve
   a procesar (sin la etiqueta deja de valer el memo) y lo parkea.
La etiqueta es por hilo: un hilo con una factura pendiente nunca queda con Descartado, aunque tenga respuestas
descartadas; el lector la quita en cada corrida y `etiquetarRetroactivo` también.

## Mantenimiento

- Proveedor nuevo: alta en Maestros › Proveedores con `remitenteMail`, o una regla `remitente` en Reglas de banco.
- Sede nueva o un texto que no reconoce: regla `sede` con el fragmento (sin acentos) y el centro. Sirve también para
  nº de contrato, CUPS o nº de cliente (Grenke `134-31369`, Nabalia `ES0021…GT1P`): el modelo los devuelve como
  referencias y la regla los convierte en centro. No usar la dirección fiscal de la sociedad como fragmento.
- Modelo: `GEMINI_MODEL` en las propiedades. El simulacro muestra cuántos PDF leyó el modelo y cuántos cayeron a
  patrones, y lista lo que quedó `PARA REVISAR`.
- Mail que no es factura y molesta: regla `remitente` o `asunto` con acción **ignorar**.
- Sin ninguna regla de sede que matchee, o con varias (factura multi-sede), el centro queda vacío a propósito.
- `?accion=estado` (desde `/api/lector?buzon=es&accion=estado&token=…`) muestra la configuración y la última corrida.
- `?accion=reset` hace que vuelva a mirar todo desde la fecha de corte; lo ya parkeado no se duplica (candado 1).
- `?accion=marcar&ref=<hilo>&estado=contabilizada|ignorada` es lo que llama la bandeja al decidir; se puede usar a mano.
- Simulacro acotado: propiedad `SIMULACRO_FILTRO` (ej. `from:grupovoldis.es`, `newer_than:3d has:attachment`); solo
  afecta al simulacro. Con filtro, el simulacro **ignora el memo**: re-lee mails ya procesados y lista "YA EN BANDEJA"
  con lo que el modelo extrajo ahora, para comparar contra lo parkeado. Sin filtro, solo mira mails nuevos.
- Ráfagas: más de `MAX_PDFS_POR_MAIL` mails del mismo remitente en 5 minutos (reenvío masivo de históricos) se reportan como lote y no se parkean.

## Lo que NO resuelve (y sigue como hasta ahora)

Proveedores que no mandan factura por mail: Telefónica y Naturgy (portal), Prosegur, Segurcaixa, Coca-Cola,
Viva Aqua, Google Ads, Cecile, MyBox, expensas. Se contabilizan desde el débito con las reglas de banco.
