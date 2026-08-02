# Diccionario de datos — `nb_movimientos`

> El **libro diario** de BIGG Numbers: una sola tabla que guarda **todos** los hechos financieros
> (caja + asientos). Es la hoja más importante y la más difícil de leer cruda, porque es
> **polimórfica**: una fila = un evento, pero *qué columnas importan depende de `origen` + `tipo`*.
> Nadie la edita a mano — los writers/readers de `src/lib/numbersApi.js` ponen y sacan las convenciones.
>
> **Cómo leer una fila:** mirá primero **`origen`** (de qué flujo nació) y **`tipo`** (qué clase de
> asiento es). Eso te dice cuáles de las ~30 columnas aplican. El resto quedan vacías.

---

## 1. Columnas

### Núcleo (siempre presentes)
| Columna | Qué es |
|---|---|
| `id` | Clave única opaca e inmutable (`PREFIJO-nnnnn-salt`). No tiene significado; **nunca matchear por otra cosa que no sea el id** salvo que se indique. |
| `sociedad` | Entidad legal dueña de la caja (`nako`, `hektor`, `eventos`, `biggfit`, `beta`, `wellness`, …). |
| `fecha` | Fecha del hecho económico (ISO `YYYY-MM-DD`). |
| `tipo` | Clase de asiento (ver §2). |
| `origen` | De qué flujo/módulo nació la fila (ver §3). **La dimensión más importante para interpretar la fila.** |
| `monto` | Importe **firmado**: `+` entra a la caja, `−` sale. |
| `moneda` | `ARS` / `USD` / `EUR` / `COP`. |
| `concepto` | Descripción legible. |
| `documento_id` | Link al documento **y** estado codificado por prefijo (ver §4). |
| `referencia` | "Cajón" de metadata empaquetada como texto `clave=valor` (ver §5). |
| `registrado_por` | Usuario que cargó/contabilizó la fila (autoría). |
| `created_at` | Timestamp de creación. |

### Caja / conciliación
| Columna | Qué es | Aplica cuando |
|---|---|---|
| `cuenta_bancaria` | La caja/banco donde ocurrió el movimiento. | Todo lo que mueve plata real. |
| `cuenta_destino` | La **otra** caja involucrada. | Transferencias, cambio de moneda, interco. |
| `extracto_saldo` | Saldo corriente del banco = **clave de dedup** al re-subir el extracto. | `origen="extracto"`. |

### Contabilidad (P&L)
| Columna | Qué es | Aplica cuando |
|---|---|---|
| `cuenta_contable` | Cuenta contable por **NOMBRE** (el P&L la busca por nombre, no por id). Su presencia + `documento_id` `CONTAB-` es lo que hace que la fila **devengue** en el P&L. | Gasto/ingreso contado, retención, interuso de gestión. |
| `centro_costo` | Centro de costo / sede (id `cc-2026-…`). | Idem. |
| `iva_rate` | Alícuota IVA como **entero** (ej. `21`, no `0.21`). | Gasto/ingreso directo. |
| `iva_monto` | Monto de IVA (sub-porción de `monto`; `neto = |monto| − iva_monto`). | Idem. |

### Contraparte
| Columna | Qué es |
|---|---|
| `contraparte_id` | Id del proveedor / cliente / franquicia / **sociedad** (en interco). |
| `contraparte_nombre` | Snapshot del nombre de la contraparte. |

### Nómina (SOLO filas de sueldos, `origen="sueldos"`)
| Columna | Qué es |
|---|---|
| `mes`, `anio` | Período liquidado. |
| `legajo_id`, `legajo_nombre` | Empleado. |
| `tipo_componente` | Componente del recibo (`haberes`, etc.). |
| `ambito` | HQ / Sedes. |
| `forma_pago_id` | Forma de pago (define la sociedad/caja). |
| `lote_pago` | Id de la **tanda** de pago (una acción de "Registrar pago" = un lote). Permite matchear el débito del banco contra el total del lote en conciliación. |

### Dimensiones de sub-módulos
| Columna | Qué es |
|---|---|
| `fr_tipo` | Tipo de movimiento de franquicia: `PAGO` / `PAGO_PAUTA` (a cuenta) / `PAGO_ENVIADO`. Con `origen="franquicias"`. |
| `socio_tipo` | Tipo de movimiento de socio: `prestamo` / `devolucion` / `aporte` / `dividendo_pago`. Con `origen="socios"`. |

---

## 2. `tipo` — clase de asiento
| Valor | Significado | Signo típico |
|---|---|---|
| `INGRESO` | Cobro / ingreso (venta directa, cobro de franquicia, interco recibida). | `+` |
| `EGRESO` | Egreso genérico (pata de banco sin factura, interco). | `−` |
| `EGRESO_GASTO` | **Gasto contado**: devengado y caja a la vez (gasto directo o conciliación contabilizada). | `−` |
| `PAGO` | Pago que **cancela una factura** de proveedor (netea la CxP; no devenga de nuevo). | `−` |
| `COBRO` | Cobro que **cancela una factura** emitida (netea la CxC). | `+` |
| `TRANSFERENCIA` | Movimiento entre cajas **propias** (2 patas, `documento_id` compartido). | ± |
| `CAMBIO` | Cambio de moneda (2 patas). | ± |
| `INTERCOMPANIA` | Movimiento entre sociedades (interco). | ± |
| `SUELDO` | Pago de haberes (`origen="sueldos"`). | `−` |
| `PAGO_TARJETA` | Pago del resumen de tarjeta (baja la deuda de la cuenta-tarjeta). | ± |
| `SALDO_INICIAL` | Saldo de apertura al 30/6 (migración; sin P&L). | ± |

> **Cuidado:** `nb_comprobantes` es **otra tabla** (documentos: facturas/NC), con su propio campo
> `subtipo` (`EGRESO`/`INGRESO`/`GASTO`/…). No confundir con el `tipo` de acá.

---

## 3. `origen` — de qué flujo nació la fila
| Valor | Qué evento es |
|---|---|
| `extracto` | Línea de extracto bancario ingerida, **pendiente** de conciliar. |
| `gasto_directo` | Gasto contado cargado a mano (o contabilizado desde conciliación). |
| `ingreso_directo` | Ingreso contado cargado a mano (o crédito sin factura contabilizado). |
| `pago` / `cobro` | Pago/cobro imputado a una factura. |
| `sueldos` | Pago de haberes (trae las columnas de nómina). |
| `franquicias` | Cobro/pago de franquiciado (trae `fr_tipo`). |
| `transferencia` / `cambio` | Patas de transferencia interna / cambio de moneda. |
| `intercompania` / `interco_park` / `interco_recibida` / `interco_enviada` | Movimientos entre sociedades (anillos). |
| `interuso_gestion` | Asiento de gestión de sede propia (solo P&L, sin caja). |
| `retencion` | Retención sufrida (lleva el `documento_id` de la factura que netea). |
| `socios` | Préstamo/aporte/dividendo a/de socio (trae `socio_tipo`). |
| `tarjeta` / `pago_tarjeta` | Consumo / pago de tarjeta de crédito. |
| `cuota` / `financiacion_alta` | Cuota o alta de plan AFIP / préstamo. |
| `anticipo_alta` / `anticipo_consumo` | Anticipos. |
| `manual` / `maestros` | Carga manual / de setup. |

---

## 4. `documento_id` — link **y** estado (prefijo)
El `documento_id` hace doble trabajo: apunta a un documento **y** codifica el estado por prefijo.
Para entender la fila hay que decodificar el prefijo.

| Valor | Significado |
|---|---|
| *(vacío)* | **Pendiente**: línea de extracto sin conciliar (o fila sin documento). No devenga. |
| `CONTAB-<id>` | Gasto/ingreso contado ya **contabilizado** → **entra al P&L**. |
| `IGN-<id>` | **Ignorado** (descartado en conciliación sin contabilizar). No cuenta en Tesorería/Cash Flow/P&L. Reversible. |
| `TRF-<id>` / `INTERCOMPANY-<id>` | Par de **transferencia interna** / interco de 2 patas (mismo id en ambas patas). |
| `INTERPARK-<id>` | Interco **parkeada** (una sola pata, esperando que la contraparte la cierre). |
| `INTERRECV-<id>` / `INTERSND-<id>` | Interco **recibida** / **enviada** declarada. |
| `FIN-<plan>#<n>` | Pago de la **cuota N** de un plan de financiación. |
| `<id de una FC>` (ej. `EG-…`) | Pago/cobro **imputado a esa factura** → netea su CxP/CxC. |

> **Regla de estado:** `documento_id` vacío = pendiente; con valor = ya procesado. Es la convención que
> usa toda la conciliación (`fetchMovimientosPendientes` filtra `!documento_id`).

---

## 5. `referencia` — metadata empaquetada (`clave=valor`)
Se lee con `parseMeta()`. Claves:
| Clave | Qué guarda |
|---|---|
| `saldo=` | Saldo del banco (dedup del extracto). |
| `cod=` | Código de concepto del banco (ej. `907176`). |
| `ign=` | Motivo de ignorado (ej. `haberes:<lote_pago>`). |
| `prov=` | Proveedor reconocido por regla. |
| `par=` | Id de la pata interco emparejada. |
| `recibida=` | Id del movimiento que cerró la interco. |
| `tipo=` | Sub-tipo empaquetado. |
| `1` | Marcador simple de "procesado". |

---

## 6. Notas para la migración a base de datos real
Lo que hoy es **complejidad accidental** (a limpiar cuando se migre; ver plan del CTO):
1. **`documento_id` codifica estado por prefijo** → en la base real, darle a "estado" su **columna propia**
   (enum) y dejar `documento_id` como FK pura.
2. **`referencia` empaqueta varios campos como string** → desempaquetar en **columnas reales**
   (`saldo`, `codigo_concepto`, `motivo_ignorado`, `interco_par_id`, …).
3. **Columnas semánticas frágiles** (`cuenta_contable` por nombre, ids `cc-2026-<slug>`/`CUENTA_<nombre>`)
   → id opaco inmutable + FK. Ver `docs/plan-migracion.md`.
4. **Integridad referencial**: Sheets no tiene FKs → la base real debe imponerlas (contraparte/cuenta/centro).

Lo **sano e inherente** (mantener): una sola tabla-libro para todos los eventos de caja/asiento, leída por
adaptadores. Es la decisión correcta para un ledger; solo hay que quitarle las codificaciones opacas.
