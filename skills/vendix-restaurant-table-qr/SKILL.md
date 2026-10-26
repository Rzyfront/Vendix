---
name: vendix-restaurant-table-qr
description: >
  QR de mesa del comensal en storefront (`?mesa=<public_token>`): modos `qr_scan_behavior`, re-asociación a sesión, cuenta compartida, SSE comensal. Trigger: QR de mesa, public_token, `ecommerce/tables/*`, table-context, pago desde la mesa.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Editing `tables.public_token`, mesa QR generation, or qr_code_url regeneration"
    - "Editing `store_settings.restaurant.{qr_scan_behavior, qr_auto_fire, enable_table_checkout}`"
    - "Editing `apps/backend/src/domains/ecommerce/tables/*` (resolveByToken, addOrderItems, getBill, payTable)"
    - "Editing storefront table-context, table-session-sse, table-welcome-wizard or mesa-cart guard"
    - "Modifying the storefront's `?mesa=` deep-link, mesa token hydration, or localStorage mesaToken guard"
    - "Adding or changing the 4 `qr_scan_behavior` modes (menu_only, mark_occupied, open_tab, require_staff)"
    - "Editing diner actions: identify, guests, call-waiter, request-bill, request-split, pay (table checkout)"
    - "Wiring the comensal SSE endpoint `/ecommerce/tables/{token}/stream?store_id=`"
---

## Alcance

Lado comensal del QR de mesa (storefront `?mesa=<public_token>`): resolución, modos de escaneo, sesión compartida, auto-pedido, cuenta, pago desde la mesa y SSE del comensal. El lado POS/admin (mesas, fire, KDS, split real) es de `vendix-restaurant-ops`.

## Código

- Backend público: `apps/backend/src/domains/ecommerce/tables/` (`ecommerce-tables.controller.ts`, `ecommerce-tables.service.ts`). Admin/POS: `apps/backend/src/domains/store/tables/` (`TableSessionsService.openTableSessionPublic`).
- Settings: `store_settings.settings.restaurant` (`QrScanBehavior`, `RestaurantSettings` en `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts`): `qr_scan_behavior`, `qr_auto_fire`, `enable_table_checkout`, `kitchen_mode`.
- Frontend storefront: `apps/frontend/src/app/private/modules/ecommerce/services/{table-context,table-session-sse}.service.ts`, `components/table-welcome-wizard/`, guard `apps/frontend/src/app/core/guards/mesa-cart.guard.ts`. Admin: `private/modules/store/restaurant-ops/tables/`.

## Modos `qr_scan_behavior` (default `menu_only`; valor desconocido → `menu_only`)

| Modo | Efecto del escaneo |
| --- | --- |
| `menu_only` | Solo carta; sin cambio de mesa |
| `mark_occupied` | Mesa → `occupied` (idempotente), sin sesión |
| `open_tab` | `openTableSessionPublic`: sesión + orden `draft`, mesa → `occupied` (también desde `cleaning`); re-escanear devuelve la misma sesión |
| `require_staff` | No abre sesión; notifica al staff; un mesero autenticado confirma con `POST /:token/confirm` |

`POST /:token/order` solo se permite en `open_tab` y `require_staff` ya confirmado; `menu_only`/`mark_occupied` → 409. Agregar un modo exige: tipo/DTO, rama en `ecommerce-tables.service.ts`, copy del frontend y toggle en settings admin.

## Endpoints (`ecommerce/tables`, `@OptionalAuth` salvo `confirm`)

`GET resolve?token=&session_id=` · `POST :token/order` · `POST :token/confirm` (JWT mesero) · `POST :token/identify` · `POST :token/guests` · `GET :token/bill` · `GET :token/payment-methods` · `SSE :token/stream?store_id=&device_id=` · `POST :token/call-waiter` · `POST :token/request-bill` · `POST :token/request-split` · `POST :token/pay` · `POST :token/pay/confirm`.

## Reglas

1. **Solo `public_token`** (`tables.public_token @unique`) en URLs/QR; nunca el `id` autoincremental. URL: `{shop-hostname}/?mesa={public_token}`.
2. **Re-escanear con sesión abierta reutiliza la sesión:** todos los comensales comparten `session_id` y `order_id`. `resolve` recibe el `session_id` que el comensal tenía en localStorage y devuelve `session_moved: true` si esa sesión sigue abierta en OTRA mesa (si se cerró, el carril es `session_closed`).
3. **`qr_auto_fire: false`** (default): los ítems del comensal quedan sin disparar hasta que el staff los dispare; respuesta incluye `fired: false`. Con `true` se disparan los `prepared` al agregar; la forma de la respuesta no cambia. En `kitchen_mode='physical'` el `auto_fire` efectivo es `false`.
4. **Cuenta compartida:** "Mi cuenta" muestra todos los ítems de la orden de la sesión, sin separación por comensal. `request-split` y `call-waiter`/`request-bill` solo notifican al staff, sin mutar; el split real lo hace el mesero (`split-order.service.ts`).
5. **Pago desde la mesa** (`pay`) respeta `restaurant.enable_table_checkout`; `cash`/`bank_transfer` → `payment.pending`; `wompi` → `next: 'wompi_widget'` + `wompi_data`; `pay/confirm` es idempotente y emite `payment.confirmed`. `payment-methods` filtra métodos no aptos (crédito, separado).
6. **Identidad del comensal** (`identify`): anonymous / guest / authenticated; anónimo solo si `pos.allow_anonymous_sales`. `guests` se valida contra `tables.capacity`.
7. **SSE del comensal:** EventSource no envía headers, así que `store_id` va obligatorio en query (`DomainResolverMiddleware` lo lee de `req.query.store_id`); persistirlo en el contexto al primer resolve y mandarlo en cada reconexión. Sin él → 403 y bucle de reintentos.
8. **SSE default-deny:** `boundOrderId`/`boundSessionId` se derivan en servidor desde el token; se filtran eventos fuera de la whitelist (`snapshot`, `kitchen.fired|preparing|ready|delivered`, `bill.requested`, `comensal_joined`/`comensal_left`, `item_added`, `guest_count_changed`, `payment.*`) o de otra orden/sesión. Dispositivos en Redis por `device_id` (reconexiones no duplican join/leave). Lecturas diferidas re-envueltas en `RequestContextService.run(...)` (ALS).
9. **Query params como `@Query('x')` primitivos**, no DTO: `forbidNonWhitelisted` rechazaría campos extra. El body de `order` es `{ items: [...] }`; campos desconocidos (p. ej. `comensal_id`, `product_id` en top-level) → 400 `SYS_VALIDATION_001`.
10. **Hidratación del token:** al cargar con `?mesa=`, comparar contra `tableToken()` antes de rehidratar de localStorage (si no, un token viejo pisa el escaneo nuevo; bug cerrado).
11. **Aislamiento de tenant:** el `store_id` sale del host vía `DomainResolverMiddleware`; sin tienda resuelta → `STORE_CONTEXT_001`. Token inexistente → `TABLE_NOT_FOUND`.
12. `auto_fire` es configuración del servidor, nunca input del cliente. No implementar `mark_occupied` como flujo aparte de la creación de sesión.

Skills relacionados: `vendix-restaurant-ops`, `vendix-ecommerce-checkout`, `vendix-error-handling`, `vendix-multi-tenant-context`.
