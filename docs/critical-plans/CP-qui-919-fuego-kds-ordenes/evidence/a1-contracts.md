# A.1 — Evidencia de contratos

Fecha: 2026-10-06. Revisión estática de la rama `feature/qui-919-fuego-kds-ordenes`, basada en el código actual de `origin/develop`.

## Elegibilidad y cantidades

- `GET /store/orders/:id` ya carga `order_items` con producto y filas `kitchen_ticket_items`; `pendingKitchenItems` en `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.ts` define el patrón actual: producto `prepared`, `product_id` presente, `skip_kds !== true`, `cancelled_at === null`, `inventory_consumed_at_fire !== true` y sin ticket existente. La lista paginada aún no proyecta todos esos campos.
- El denominador visual es la suma de `quantity` de las líneas preparadas elegibles, no el número de tickets: una línea puede estar en una estación y un ticket puede agrupar varias líneas.
- Para agregado KDS se usa el estado más rezagado entre las cantidades elegibles: `pending < in_preparation < ready < delivered`. Una fila activa (`pending`, `in_preparation`, `ready`) gana a filas terminales recientes; canceladas y líneas ya disparadas no cuentan como pendientes.
- En modo físico el primer ticket se crea en preparación y se imprime por el flujo existente; en virtual nace pendiente. El endpoint de fire manual debe rechazar líneas `skip_kds`, canceladas y órdenes terminales en servidor. Reenvíos siguen su ruta explícita existente.

## Permiso y visibilidad

- El endpoint existente es `POST /store/kitchen-fire`, protegido con `store:kitchen_fire:create`; la semilla registra ese permiso en `apps/backend/prisma/seeds/permissions-roles.seed.ts`.
- La industria restaurante es validada actualmente por el servicio de fire. La UI consulta el mismo permiso como affordance y la visibilidad efectiva del módulo padre `restaurant_ops`.
- No usar `restaurant_ops_kds` como gate de la acción: `MenuFilterService.hiddenBySettings()` oculta deliberadamente solo ese hijo cuando `restaurant.kitchen_mode === 'physical'`, porque en modo físico se imprimen comandas. La acción de fire debe seguir disponible en físico.

## Errores y SSE

- `FireOrderItemsDto.order_item_ids` valida arreglo no vacío de enteros; el body vacío resulta en HTTP 400 (`SYS_VALIDATION_001`), consistente con ERR-03.
- `POST /store/kitchen-fire` usa el flujo de consumo BOM/stock, COGS, bandera y ticket dentro de transacción; eventos contables y SSE se emiten después del commit.
- `GET /store/orders/stream` autoriza `store:orders:read` y comparte el subject por tienda con eventos de KDS. Los eventos KDS reales tienen `{ type: 'ticket.*', ticket: <ticket completo>, ts }`, con `ticket.order_id`; los eventos de orden llevan `data.order_id`. El parser actual de la lista solo entiende el segundo envelope y descarta `ticket.*` y `order.items.updated`.
- El ticket completo puede contener notas y datos del cliente. La lista solo necesita `type`, `ticket.order_id` y timestamp; B.4 debe reenviar por el stream de órdenes una forma mínima allow-listed sin mutar el stream KDS.

## Hallazgos reproducidos en código

- F-001: la lectura de `inventory_consumed_at_fire` y el preflight de stock ocurren antes de la transacción; dentro de `fireOrderItemsInTx` la bandera se actualiza sin condición después del consumo. Dos POST concurrentes pueden consumir ambos.
- F-002: la selección manual filtra `cancelled_at` pero no `skip_kds` ni el estado terminal del encabezado. `fireOrderItemsInTx` declara que `skip_kds` debe ser filtrado por el caller.
- F-004: validación de arreglo vacío responde HTTP 400, no 422.
- La prueba del componente/servicio frontend debe usar Jasmine/Karma según configuración Angular del workspace; no Vitest.
- Si falla la hidratación REST gatillada por SSE, la fila debe marcarse obsoleta y permitir reintento limitado/refresco manual para no conservar verde desactualizado.

## Límites de prueba de esta etapa

Esta etapa es solo lectura de contratos y código. No se ejecutaron requests autenticados: el paso se cierra con evidencia estática; pruebas funcionales de desarrollo quedan para B.2 y C.1.
