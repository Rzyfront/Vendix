# G.2 visual — recorrido mesa→reasignar→agregar (runner-2, 2026-09-24)

Runner: e2e-runner-2 · Tienda #10 (Roku) · mesero `mesero.e2e@roku.test` (#241).
Handoff fox: G.2 done a nivel API; este E2E cubre la parte visual pendiente (HALT).

## Mesas (selección documentada, sin robar fixtures)

- Listado por API (`GET /store/tables/floor-map`, `/tmp/e2e-tables.txt`): 23 mesas.
  Solo 4 sin sesión activa: #26 (cleaning), #22 (cleaning), #27 (cleaning, QA-G2
  PROHIBIDA), #28 (available, QA-G2 PROHIBIDA).
- Decisión: NO usar #27/#28 ni tocar #22/#26 (fixtures B.5/E.4 ajenos). Creadas DOS
  mesas frescas como owner (`owner@roku.vendix.com`):
  - **#30 `QA G2 e2e-r2 src 20260924`** (origen) — `POST /store/tables` 201
  - **#31 `QA G2 e2e-r2 dst 20260924`** (destino) — `POST /store/tables` 201
- Nota: en el selector del modal aparecieron también `QA G2 e2e-2b src/dst`
  (creadas por un peer en paralelo, batch-1 truncado). No se tocaron.

## Recorrido ejecutado (híbrido setup-curl + UI)

| Paso | Mecanismo | HTTP observado |
|---|---|---|
| Abrir mesa #30 | curl `POST /store/table-sessions {table_id:30}` | **201** → sesión #130, orden #1207 |
| Pedir (Hamburguesa #333 ×1) | curl `POST .../130/add-items` (DTO `{product_id,quantity}`; con `product_name`/`unit_price` da 400 `SYS_VALIDATION_001` — whitelist) | **201** → item #1934, total $15.000 |
| Disparar cocina | curl `POST /store/kitchen-fire {order_id:1207,order_item_ids:[1934]}` | **201** → ticket #123 pending, COGS=0 |
| Cerrar por error | UI sesión #130 → "Cerrar mesa" → confirmar | **201** `POST .../130/close` → mesa Limpieza, "Cerrada · pago pendiente" |
| Reasignar desde el modal | UI Opciones → "Volver a asignar mesa" → elegir dst #31 → "Reasignar mesa" | **201** `POST .../reassign` → sesión nueva **#131** (navega a `/tables/session/131`) |
| Agregar plato (Coca-Cola #302 ×1) | UI "Agregar items" → +1 Coca-Cola → Agregar | **201** `POST .../131/add-items` → item #1938, total **$53.000**, comanda 2 líneas |

Modal de reasignación: título "Devolver orden a una mesa", mesas en limpieza
deshabilitadas, origen marcado "Anterior", texto de confirmación "La orden volverá
a … con una sesión nueva; el cierre anterior se conserva."

## Invariantes SQL (post-recorrido, orden #1207 `T-1790214481878-820`)

- `table_sessions`: **1 abierta + 2 total**; #130 cerrada (closed_at intacto),
  #131 abierta con `opened_by=241` (mesero que reasigna, ADR-04).
- `kitchen_tickets`: #123 re-estampado a `table_id=31`, sigue `pending`
  (sin re-disparo; `fired_at` original).
- `orders`: mismo id/number, `state=draft`, `grand_total=53000`.
- `order_items.inventory_consumed_at_fire`: #1934=true (del fire previo, sin cambio
  en reasignación), #1938=false (agregado después, sin disparar).
- Mesas: #30 `cleaning`, #31 `occupied`.

## Consola / red durante el flujo UI

- **0 excepciones JS.** 5 errores de recurso, todos 403 pre-existentes por rol
  waiter (ruido, misma clase que C.3): `subscriptions/current` ×2,
  `subscriptions/payment-methods`, `support/pqr/stats`, `weekly-report/latest`.
- 1 warning NG0953 (emit en OutputRef destruido al cerrar modal — cosmético).
- Incidente de entorno: backend en flap (watch-rebuild por peers, `Empty reply`)
  a mitad del flujo UI; recuperado tras ~60 s (health 200, `API_READY`).
  Evidencia de login previo: `POST /api/auth/login` 200 como mesero #241.
- CORS `notifications/stream` FAILED durante el flap (ruido de entorno, no regresión).

## Evidencia

- Screenshot: `evidence/G2-recorrido.png` (sesión #131 en dst, 2 líneas, $53.000).
- Crudos curl: `/tmp/e2e-g2-open.json`, `/tmp/e2e-g2-add1.json`, `/tmp/e2e-g2-fire.json`;
  network Playwright: close 201 (#298), reassign 201 (#306), add-items 201 (#325).

## Limpieza

- `POST /store/orders/1207/flow/cancel {reason, kitchenDisposition:"waste"}` → 200
  (cancela orden + ticket #123 pendiente).
- `POST /store/table-sessions/131/close` → 201 (libera #31 → cleaning).
- Estado final: #30/#31 en `cleaning` sin sesión activa; #27/#28 intactas.
