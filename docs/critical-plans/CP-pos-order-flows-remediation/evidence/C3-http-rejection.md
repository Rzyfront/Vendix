# C.3 — rechazos de cocina con status HTTP real

QA local 2026-09-23, tienda #10. C.3 sigue **in-progress**: ADR-06 está proposed y falta provocar `KDS_STATION_LOCKED` en un turno ajeno seguro y verificar toasts UI de los tres rechazos.

- Agente de cocina: `POST /store/kitchen-fire/tickets/94/delivered` sobre ticket mixto/no-takeaway devolvía **HTTP 201** con body `statusCode:422`, `KITCHEN_TICKET_NOT_TAKEAWAY`: el frontend veía éxito. `KitchenFireController` consumía la excepción con `return responseService.error`. Tras `de529b29f`, mismo curl devuelve **HTTP 422** con el mismo `error_code`; ticket #94 siguió `ready` y su ítem #1750 sin `delivered_at`. Se corrigió el mismo patrón en start/ready/cancel/revert y lecturas list/snapshot; el filtro global decide status/error.
- Mesero: `PATCH /store/orders/1063/flow/items/1767/deliver` sobre plato preparado `pending` devolvió **HTTP 409 `ORDER_ITEM_NOT_DELIVERABLE`**; `delivered_at` siguió NULL. El mensaje backend ahora nombra el KDS y pide esperar a `ready`, pues `parseApiError` prioriza el detalle español sobre el copy enlatado.
- Sin token al endpoint de ticket: **401**. Specs KitchenFireService **33/33**, KitchenFireController **1/1** (siete handlers deben lanzar), OrderFlowService **118/118**, Angular error-messages **20/20**. El literal `KITCHEN_TICKET_NOT_TAKEAWAY` y su 422 permanecen idénticos en el catálogo central.

No se creó turno KDS ni se alteraron estaciones para fabricar el 403; queda una sonda real y Playwright de toasts. Ninguna de las dos se infiere de specs.
