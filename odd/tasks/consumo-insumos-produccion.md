# Consumo de insumos en producción: por lote y consolidado del día

**Objetivo.** Al terminar un lote, y a lo largo de la producción del día, se ve cuánto se planificó y cuánto se consumió de cada insumo.
**Rama:** `feat/consumo-insumos-produccion` (worktree `Vendix-consumo-insumos`, desde develop c8b7674ea).
**Entrega:** un PR por unidad a develop (backend y luego frontend), con gate ≥85.
**Pruebas:** backend con jest, un spec por invocación; frontend con karma en CI y los specs en la lista `--include` de `ci.yml`.

## Specs

### S1. Cada orden de restaurante nace con su consumo planificado (backend)
**Historia.** Como encargado de producción en un restaurante, quiero que cada orden de producción sepa desde que se crea cuánto debe consumir de cada insumo, para compararlo con lo consumido al terminar.

**Comportamiento al crear la orden**
- Al crear una orden manual (`ProductionOrdersService.create`) o desde una venta (`ProductionSaleLinkService.ensureForOrder`), se crean sus `production_order_lines`:
  - `planned_qty` = `computeComponentRequirements(receta, planned_qty)` (`production-orders.service.ts` ~L260);
  - `consumed_qty` = 0.
- En las órdenes de una venta, las adiciones de sus líneas (`order_item_options`) suman su requerimiento al mismo insumo (`expandProduction`).
- Si la venta cambia `planned_qty` mientras la orden está en borrador, o si la orden se reinicia (`restart`), las líneas se recalculan. Es lo que hace hoy Planta (`manufacturing-orders.service.ts` ~L295-300).
- Planta no cambia: ya crea sus líneas al crear la orden.

**Criterio de aceptación.** Se cobra en el POS una venta con 2 platos producibles. El detalle de cada orden trae `lines`, con el planificado de cada insumo de la receta y consumido 0.

### S2. Finalizar guarda el consumo real en toda orden (backend)
**Comportamiento**
- `persistLines` pasa de `manufacturing-orders.service.ts` (~L505-562) a `ProductionOrdersService`.
  - Corre dentro de la transacción de `complete()` para toda orden: manual de restaurante, de venta y de Planta.
  - Planta deja de llamarlo en `onProduced`, así que no hay doble conteo.
  - Su lógica de estado parcial, `produced_qty` y `actual_cost` sigue en `onProduced`.
- Incluye los insumos de adiciones que consume `consumeLinkedAddons`, con su costo.
- Una orden abierta creada antes del deploy no tiene líneas. Al finalizarse, primero crea sus líneas planificadas desde la receta y luego acumula el consumo.
- Cada línea guarda `unit_cost` y `total_cost` desde el `cost_snapshot` de `updateStock`, como hoy en Planta.
- Un insumo consumido que no estaba planificado conserva el comportamiento actual de `persistLines`.
- El stock y la contabilidad no cambian: los movimientos `consumption` de `updateStock` son los mismos. Solo se escriben las líneas.

**Criterios de aceptación**
- Al finalizar una orden de venta completa, su detalle muestra el consumido igual al planificado y el costo de cada insumo.
- En Planta, dos entregas parciales acumulan el consumido y el costo igual que hoy.

### S3. Detalle de la orden: planificado vs consumido por lote
**Historia.** Como encargado de producción, quiero ver en el detalle de una orden el planificado y el consumido de cada insumo con su costo, para detectar la merma de ese lote.

**Pasos**
1. Ir a Producción → Lista del día.
2. Abrir una orden y finalizarla.

**Se ve**
- La card "Insumos: planificado vs consumido", con las columnas Insumo, Planificado, Consumido, Costo unit. y Costo total. Son las mismas que en el detalle de Planta.
- Al finalizar desde el detalle, la tabla se actualiza sin recargar.
- Una orden finalizada antes del deploy dice "Sin desglose de consumo".

**Técnico**
- `GET store/production-orders/:id` incluye `lines` con `component_product {id, name, sku, stock_unit}`.
- La vista vive en `production-order-detail.component.ts`.
- El costo se muestra solo en el detalle (L2).

### S4. Consumo del día (backend)
**Endpoints**
- `GET store/production-orders/day/supplies?date=` y `GET store/manufacturing/orders/day/supplies?date=`.
- Tienen los mismos permisos e industria que el `day` de cada controlador.

**Qué órdenes entran:** las mismas que la Lista del día de esa fecha (L2, "Día de la lista").
- Se reutiliza el `dayWhere` de `findDay`, con la zona horaria de la tienda.
- Incluye las órdenes arrastradas (`carried_over`) y excluye las canceladas.

**Respuesta por insumo**
- `product_id`, `name`, `sku`, `unit` (`stock_unit`).
- `planned`: Σ planificado de todas las órdenes.
- `consumed`: Σ consumido de todas las órdenes.
- `pending`: Σ `max(planificado − consumido, 0)` de las órdenes no finalizadas.
- `difference`: Σ (consumido − planificado) de las órdenes finalizadas.

**Totales de la respuesta**
- `orders_total`, `orders_completed`.
- `orders_without_breakdown`: órdenes finalizadas sin líneas, es decir, de antes del deploy.

**Sin costo** (L2). Se resuelve con una sola agregación sobre todas las órdenes del día, sin paginar.

### S5. Panel "Consumo del día" en vivo
**Historia.** Como encargado de producción, al iniciar la producción del día quiero ver cuánto llevo consumido de cada insumo y cuánto falta, para preparar los insumos y controlar la merma de toda la jornada.

**Pasos**
1. Ir a Producción → Lista del día y tocar "Iniciar producción del día".
2. Finalizar órdenes desde el tablero de Producción activa.

**Se ve**
- Un panel plegable "Consumo del día" en la Lista del día y en Producción activa, con las columnas Insumo, Unidad, Planificado, Consumido y Pendiente. Solo muestra cantidades (L2).
- El panel se actualiza cada vez que se finaliza una orden, sin recargar la página.
- Si el día no tiene insumos: "No hay insumos planificados para este día."
- Si `orders_without_breakdown > 0`: "N órdenes finalizadas antes de este cambio no tienen desglose de consumo."

**Técnico**
- El panel vive en `ProductionDayListComponent` y `ProductionActiveComponent`.
- Así aparece en restaurante, en Planta y en `/admin/scheduled-orders/day`, que reutilizan esos componentes.
- Se refresca con el mismo stream SSE que ya refresca la lista.

### S6. Resumen al cerrar la producción del día
**Pasos**
1. En Producción activa, finalizar la última orden pendiente del día.

**Se ve**
- Se abre el modal "Resumen de producción del día":
  - columnas Insumo, Unidad, Planificado, Consumido y Diferencia;
  - las órdenes finalizadas del total;
  - solo cantidades.
- El botón "Resumen del día" lo vuelve a abrir mientras haya órdenes finalizadas.
- El modal se puede imprimir con "Imprimir", con el mismo patrón que `production-list-page`.

**Técnico.** El modal se abre solo cuando, durante la sesión, el resumen pasa de tener órdenes en espera o en curso a no tener ninguna, con al menos una finalizada. Si la página se abre con el día ya cerrado, solo aparece el botón.

### S7. Compatibilidad
- En Planta, el detalle muestra los mismos números que hoy (planificado, consumido y costo).
- La respuesta de `GET .../day` no cambia.
- No hay migraciones: `production_order_lines` ya existe con todas las columnas.
- Las órdenes finalizadas antes del deploy no se reconstruyen (L2, "Desde el deploy").
- No se toca `apps/mobile`.

### Supuestos (confirmados por Rafael en L5)
- **A1.** Planta entra en el panel y en el resumen del día, porque comparte la lista, el tablero y `findDay`.
- **A2.** Las adiciones de una venta cuentan como consumo de su orden, en el planificado y en el consumido.
- **A3.** Finalizar una orden suelta desde la lista mantiene el aviso actual, sin modal por orden. El desglose queda en el detalle y en el panel.

## Tasks

| ID | S# | Tarea | Ruta | Estado |
| --- | --- | --- | --- | --- |
| T1 | S1, S2, S4, S7 | Backend: líneas planificadas al crear y recalcular, `persistLines` genérico en `complete()` con adiciones, `lines` en el detalle, endpoints `day/supplies`, con tests | escritor sonnet A (superficie backend) | en curso |
| T2 | S3, S5, S6 | Frontend: tabla en el detalle de restaurante, panel "Consumo del día", modal de cierre con impresión, con specs en `ci.yml` | escritor sonnet B (superficie frontend, en paralelo, sobre el contrato de L3) | escrito y auditado (L6); karma pendiente en CI |
| T3 | S1-S7 | Auditoría del padre, verificador Opus independiente (ítem 1), RDD, PRs, gate ≥85 y verificación en el demo de prod tras el deploy | inline + verificador Opus | pendiente |

**Estimación.** Unas 1.000 líneas de autor: backend ~450 y frontend ~550.

**Riesgo: ítem 1.**
- S2 escribe dentro de la transacción de `complete()` y cambia el lugar donde Planta guarda sus líneas y costos.
- Si hay doble conteo o falta un conteo, los consumidos y costos guardados quedan mal sin que nada falle.

**Ruta.** T1 y T2 son unidades independientes, con superficies disjuntas y un contrato fijo (L3). Cada una pasa de 400 líneas, así que corren en paralelo (disparador de escritor, motivo a). El padre es dueño de git.

## Log
- L1 (2026-11-10, Rafael): "El sistema de producción al final de una etapa de producción muestra el consolidado del consumo de insumos en el flujo de producción.?" — y luego: "Sí, claro, eso hay que cubrirlo. Y no solamente cuando se produce un solo lote, si no puedo se iniciar una linea de produccion del dia..."
- L2 (2026-11-11, decisiones de Rafael):
  - Vista del día: "Panel en vivo + cierre (Recomendado)".
  - Día: "Día de la lista (Recomendado)".
  - Costos: "Costo solo en el detalle (Recomendado)".
  - Histórico: "Desde el deploy (Recomendado)".
- L3 (2026-11-11, contrato compartido entre T1 y T2):
  - `GET store/production-orders/:id` → la orden actual más `lines: ProductionOrderLine[]`. Su forma es la del `ManufacturingOrderLine` del frontend: `id`, `component_product_id`, `planned_qty`, `consumed_qty`, `unit_cost`, `total_cost`, `component_product {id, name, sku, stock_unit}`. Una orden sin líneas trae `lines: []`.
  - `GET store/production-orders/day/supplies?date=YYYY-MM-DD` y `GET store/manufacturing/orders/day/supplies?date=` → `{ date, timezone, orders_total, orders_completed, orders_without_breakdown, supplies: [{ product_id, name, sku, unit, planned, consumed, pending, difference }] }`. Las cantidades son números, la lista va ordenada por `name` y no trae costos.
- L4 (2026-11-11, mapa de solo lectura sobre develop c8b7674ea):
  - "Iniciar producción del día" solo navega al tablero (`production-day-list.component.ts:514`). No existe iniciar o finalizar en bloque para todo el día; solo por venta (`moveSaleOrders`).
  - Las órdenes de restaurante no guardan líneas. Solo Planta las crea y las acumula, vía `onProduced` → `persistLines`.
  - "Insumos consolidados" es un plan de los pedidos programados del día que aún no se inician. No muestra consumo.
  - `production_order_lines` no tiene clave única por insumo; `persistLines` usa `findFirst`.
  - Siguiente: aprobación de Rafael y, con "ejecuta", T1 y T2 en paralelo.
- L5 (2026-11-11, Rafael): "Si dale!" — aprueba el plan y los supuestos A1-A3. Arrancan T1 y T2 en paralelo en el worktree `Vendix-consumo-insumos`, con superficies disjuntas; el padre es dueño de git y de este documento. `node_modules` se enlazan desde el checkout principal (ignorados por git) para correr jest.
- L6 (2026-11-11, auditoría del padre sobre T2):
  - Superficie respetada: 6 archivos modificados (+162), un componente nuevo `production-day-supplies` (componente, util y spec) y 2 specs nuevos (detalle y servicio), los 3 en el `--include` de `ci.yml`.
  - S3: la card del detalle usa `CurrencyPipe` y dice "Sin desglose de consumo" con `lines` vacío. El refresco tras finalizar ya existía (`afterAction` → `load(id)`); ahora lo fija un spec.
  - S5: el panel recarga con `refreshToken = data()` del host. En la lista, `loadMore` también lo dispara (un refetch extra barato, aceptado).
  - S6: `shouldAutoOpenDaySummary(prev, next)`, con `prev` por fecha. Los hosts solo vacían `data` al cambiar de fecha (`resetView`), así que una recarga SSE no produce una lectura en cero que esconda la transición. La impresión usa una clase de body propia con `ViewEncapsulation.None`, porque el modal es un overlay.
  - Sin karma local (regla de la máquina); lo corre CI.
