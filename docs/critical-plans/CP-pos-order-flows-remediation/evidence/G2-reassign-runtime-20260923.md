# G.2 — API/SQL real de reasignación (2026-09-23)

Fixture aislado de tienda #10: mesas QA #27 (origen) y #28 (destino), no se tocó mesa #26/sesión #125/orden #1189. Owner QA; no producción.

1. `POST /store/tables` ×2 → **201**; `POST /store/table-sessions` con alias → **201**, sesión #126, orden #1192 `draft`; cierre de #126 → **201**, origen `cleaning`.
2. `POST /store/table-sessions/reassign {order_id:1192,target_table_id:28}` → **201**, sesión nueva #127, **misma** orden #1192, `closed_at=NULL`. SQL: 2 sesiones históricas, solo 1 abierta; #126 conservó su `closed_at`; destino `occupied`, origen `cleaning`.
3. Reintento con sesión abierta → **409 `TABLE_SESSION_ALREADY_OPEN`**, sin nueva sesión. Campo ajeno `store_id:999` → **400 `SYS_VALIDATION_001`**; no sobreescribe el contexto. `POST /127/add-items` con servicio #425 → **201**, una línea y `grand_total=10000`: la orden reasignada es editable.
4. Cierre #127; origen `reserved` y luego `cleaning` → cada intento de reasignación **409 `TABLE_INVALID_STATUS`**, sin nueva sesión. Cancelación oficial de orden #1192 → **200**; mesas #27/#28 restauradas a `available` por API. Ambas sesiones quedaron cerradas y la orden cancelada.

El fixture no tenía ticket KDS (`count=0`), por lo que **no** prueba el re-estampado de cocina; sigue pendiente caso preparado. Respuestas y consultas locales: `/tmp/g2-*.response.json`. Los códigos HTTP de `ResponseService.updated` aquí son 201; se documenta el wire real en vez de asumir 200 del plan.
