# Plan de Migración: Contagram → BIGG Numbers

**Fecha de corte objetivo:** 30/06/2026  
**Go-live:** 01/07/2026  
**Sociedades:** Todas simultáneamente

---

## Contexto

Contagram cubre: ingresos, egresos (incluidos sueldos como proveedores) y tesorería. No usan conciliación bancaria, presupuestos, IVA ni libros contables. BIGG Numbers ya cubre todo eso.

**Qué se migra:** solo saldos iniciales de tesorería + partidas abiertas (comprobantes con saldo pendiente) al día de corte.  
**Qué NO se migra:** historial (5 años, mezclado entre sociedades).  
**Desde el 01/07/2026:** todo movimiento nuevo va a BIGG Numbers. Contagram queda como archivo de solo lectura.

---

## Fase 0 — Auditoría de paridad funcional (1–2 semanas)

**Objetivo:** confirmar que no hay ningún flujo de Contagram que BIGG Numbers no cubra.

**Pasos:**
1. Recorrer Contagram pantalla por pantalla con el equipo admin
2. Por cada flujo: ¿se puede hacer lo mismo en BIGG Numbers? ¿cómo?
3. Documentar gaps → buildear antes del go-live

**Items a verificar:**
- [ ] ¿Se usan **notas de débito** (ND)? BIGG Numbers tiene FA y NC — confirmar si se necesita ND
- [ ] ¿Cómo se registran los **sueldos**? ¿Como egreso con proveedor "RRHH" o un proveedor por empleado?
- [ ] ¿Los egresos de compra siempre tienen factura del proveedor, o también hay gastos sin comprobante formal?
- [ ] ¿Se emiten **recibos** propios desde Contagram?
- [ ] Verificar que todas las **sociedades** estén configuradas en BIGG Numbers
- [ ] Verificar que los **centros de costo** y **cuentas contables** de cada sociedad estén cargados

---

## Fase 1 — Carga de maestros (1 semana, antes del corte)

Para cada sociedad, verificar/cargar en BIGG Numbers:

| Maestro | Fuente | Dónde en BIGG Numbers |
|---|---|---|
| Proveedores | Exportar de Contagram | Maestros → Proveedores |
| Clientes | Exportar de Contagram | (implícito en ingresos) |
| Cuentas bancarias | Manual | Tesorería → Cuentas |
| Plan de cuentas contables | Manual/importar | Maestros |
| Centros de costo | Manual | Maestros |

---

## Fase 2 — Definir fecha de corte

**Regla:** siempre fin de mes (para que los saldos cierren prolijo).

**Fecha elegida:** **30/06/2026**

**Período de convivencia (julio 2026):**
- Las facturas emitidas a fin de junio se cargan en Contagram Y en BIGG Numbers
- Los pagos de esas facturas se registran **solo en BIGG Numbers**
- A partir del 01/08/2026: corte duro, Contagram solo lectura

---

## Fase 3 — Carga de datos al día de corte (2–3 días)

### 3a. Saldos iniciales de Tesorería

Por cada cuenta bancaria, por cada sociedad: saldo real al 30/06/2026.

Formato — 1 movimiento en `nb_movimientos`:
```
tipo        = "SALDO_INICIAL"
fecha       = 2026-06-30
monto       = saldo real (positivo)
origen      = "migracion"
```

### 3b. Partidas abiertas — Ingresos

Facturas emitidas con saldo pendiente de cobro al 30/06/2026.

Formato en `nb_comprobantes`:
- `id_comp` con prefijo `IN-CONT-`
- Una fila por línea de centro de costo
- `subtipo = "INGRESO_FC"`
- `estado = "pendiente"`

### 3c. Partidas abiertas — Egresos

Facturas recibidas con saldo pendiente de pago al 30/06/2026.

Formato en `nb_comprobantes`:
- `id_comp` con prefijo `EG-CONT-`
- `subtipo = "EGRESO_FC"`
- `estado = "pendiente"`

### 3d. Validación post-carga

- Saldo de Tesorería en BIGG Numbers = saldo en Contagram ± diferencias conocidas
- Total de deudores en BIGG Numbers = total en Contagram
- Total de acreedores en BIGG Numbers = total en Contagram

---

## Fase 4 — Go-live (01/07/2026)

1. Todas las sociedades simultáneamente
2. Desde esa fecha: toda transacción nueva va a BIGG Numbers
3. Contagram: no se carga nada nuevo, queda para consultas históricas
4. Equipo admin: 1 semana de soporte intensivo para dudas de flujo

---

## Fase 5 — Post-migración (a partir del mes 2)

Una vez estabilizado y en producción, evaluar:
- Automatizaciones que Contagram no tiene
- Módulo de sueldos propio (si se quiere separar de proveedores)
- Intercompañía
- Reportes consolidados multi-sociedad
- Integración bancaria / importación de extractos

---

## Resumen de tiempos estimados

| Fase | Duración | Responsable |
|---|---|---|
| 0 — Auditoría paridad | 1–2 semanas | Equipo admin + referente técnico |
| 1 — Carga maestros | 1 semana | Equipo admin |
| 2 — Definir fecha corte | 1 día | Dirección |
| 3 — Carga datos de corte | 2–3 días | Equipo admin + referente técnico |
| 4 — Go-live | Día D (01/07/2026) | — |
| 5 — Estabilización | 1 mes | Equipo admin |
