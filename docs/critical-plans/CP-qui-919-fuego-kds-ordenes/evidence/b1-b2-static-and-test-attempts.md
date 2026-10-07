# B.1/B.2 — Revisión estática y ejecución de pruebas

Fecha: 2026-10-06. La verificación aplica al árbol local de `feature/qui-919-fuego-kds-ordenes`.

## B.1 — Proyección paginada

- `OrdersService.findAll` mantiene el scope existente y añade a cada línea `product_id`, `quantity`, `skip_kds`, `cancelled_at`, `inventory_consumed_at_fire`, `delivered_at`, `products.product_type` y `kitchen_ticket_items(id,status,kitchen_ticket_id)` ordenados por `id desc`.
- No se añadió una consulta por orden/línea ni una columna derivada persistida. El spec inspecciona la consulta paginada, el shape y el conteo de consultas.
- Estimación reproducible con `JSON.stringify` de una línea representativa: antes 135 B, ahora 365 B, incremento 230 B. Para 50 órdenes × 20 líneas = 1.000 líneas: 230.000 B = 224,61 KiB adicionales, excluyendo header y delimitadores del JSON.
- El spec guardado en `apps/backend/src/domains/store/orders/orders.service.spec.ts` no llegó a ejecutarse: el proceso de Jest alcanzó el límite V8 de 2.045,6 MB antes de iniciar casos (0 tests). Log: `.buildcheck/backend-tests.log`.

## B.2 — Fire idempotente y elegibilidad

- La ruta pública valida `skip_kds` y estado de orden. Los estados terminales (`cancelled`, `refunded`, `shipped`, `delivered`, `finished`) se verifican antes del preflight y se vuelven a leer dentro de la transacción con `id` y `store_id` antes del reclamo.
- La transacción reclama las líneas con `updateMany` condicionado por `order_id`, ids, `inventory_consumed_at_fire=false` y `cancelled_at=null`, antes de actualizar stock, crear ticket o reconocer COGS. Un conteo parcial lanza `KITCHEN_FIRE_ALL_ALREADY_CONSUMED` (409), y la excepción revierte el reclamo parcial junto con la transacción.
- Los callers internos de POS, mesa y resend no activan `enforceManualEligibility`; mantienen su flujo de negocio existente. La prueba de concurrencia unitaria modela un reclamo ganador y otro perdedor; no sustituye una prueba real contra PostgreSQL.
- Se añadió `KITCHEN_FIRE_NOT_ELIGIBLE_001` (409) y se cubren inelegibilidad, cambio a terminal antes del TX, reclamo anterior a efectos y perdedor de reclamo en `kitchen-fire.service.spec.ts`.
- El comando `npm run buildcheck:test -- src/domains/store/kitchen-fire/kitchen-fire.service.spec.ts` no alcanzó los casos: el log registrado por el runner reportó `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`, GC cerca de 2.046 MB, 0 tests. No se repitió porque el watcher del frontend estaba usando ~5,8 GB y la memoria disponible era limitada.

## Estado de evidencia

La inspección estática y `git diff --check` pasan. Los tests de backend siguen pendientes de un entorno donde el transform de Jest pueda completar sin presionar el dev stack; F-001 y F-002 no se cierran hasta verificar la transacción funcionalmente.
