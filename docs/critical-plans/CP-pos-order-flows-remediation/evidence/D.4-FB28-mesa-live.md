# D.4 — FB-28 mesa-live vía curl (2026-09-24)

Ejecutor: toss · Tienda #10 · mesero #241 · Mesa QA #35 ("QA D4 toss 01").

## Flujo

1. `POST /store/table-sessions {table_id:35}` → 201, sesión #137, orden #1229.
2. `POST :137/add-items {product_id:333 ×1}` ×2 → 201/201, ítems #1961/#1962.
3. Mesa: `POST /store/table-sessions/137/items/1961/cancel
   {reason:"FB-28 mesa live test", cancellation_type:"before_fire"}` → 200.
4. Detalle: `PATCH /store/orders/1229/flow/items/1962/cancel
   {reason:"FB-28 detalle live test", cancellation_type:"before_fire"}` → 200.
5. Limpieza: `POST :137/close` → 201; `PATCH /tables/35 {available}` → 200.

## Comparación SELECT (boss ruling 1)

| id | carril | cancellation_type | reason | anulado |
|----|--------|-------------------|--------|---------|
| 1961 | mesa | before_fire | FB-28 mesa live test | t |
| 1962 | detalle | before_fire | FB-28 detalle live test | t |

Veredicto: el carril mesa persiste el MISMO vocabulario que el detalle
(mismo DTO `CancelOrderItemDto`, mismo seam). FB-28 live ✅.
Crudo: /tmp/fb28-*.json (mesa-cancel, detalle-cancel, open, close).
