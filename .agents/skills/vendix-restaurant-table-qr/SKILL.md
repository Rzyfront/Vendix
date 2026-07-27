---
name: vendix-restaurant-table-qr
description: >
  Flujo QR-de-mesa para comensales escaneando desde el storefront
  (`{shop-hostname}/?mesa=<public_token>`): tokens, modos de escaneo,
  re-asociación a sesión activa, cuenta compartida, SSE del comensal y
  reactivación automática desde mesa en limpieza. Complementa
  `vendix-restaurant-ops` (lado POS/admin) cubriendo el lado
  storefront/comensal que la otra skill no gobierna. Trigger: When editing
  QR de mesa comensal, public_token, table_session desde storefront,
  `ecommerce/tables/*` endpoints, table-banner UI, or `qr_scan_behavior`
  in restaurant settings.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Editing `tables.public_token`, mesa QR generation, or qr_code_url regeneration"
    - "Editing `store_settings.restaurant.{qr_scan_behavior, qr_auto_fire, enable_table_checkout}`"
    - "Editing `apps/backend/src/domains/ecommerce/tables/*` (resolveByToken, getBill, addOrder)"
    - "Editing `apps/frontend/src/app/public/modules/store-ecommerce/` table-banner, table-context, table-session-sse"
    - "Modifying the storefront's `?mesa=` deep-link, mesa token hydration, or localStorage mesaToken guard"
    - "Adding or changing the 4 `qr_scan_behavior` modes (only_view, mark_occupied, open_tab, require_waiter)"
    - "Implementing the per-table `scan_mode` override (currently GAP-6 — pendiente por mesa)"
    - "Wiring the comensal SSE endpoint `/ecommerce/tables/{token}/stream?store_id=`"
---

# QR de Mesa para Comensales (Storefront Dine-in)

## Purpose

Governs the **comensal-side** of QR-de-mesa flow: how a customer scanning
a physical QR on a restaurant table lands in the storefront, gets attached
to a `table_sessions` row, accumulates orders into a shared bill, and
receives live SSE updates. This skill is the storefront complement to
`vendix-restaurant-ops`, which covers the POS/admin side of tables, KDS,
fire-to-kitchen, and split-bill.

This skill does **not** govern POS table-side flows (those live in
`vendix-restaurant-ops` "Tables and Open Tab").

## Core Rules

1. **Tokens are public, not internal.** `tables.public_token` is the only
   safe handle for a QR — never use the autoincrement `id` in the URL. Tokens
   are `@unique`, generated on table create (same pattern as
   `customer_queue.token`). The storefront URL is
   `{shop-hostname}/?mesa={public_token}`.

2. **`qr_scan_behavior` is a global per-store setting today.** Lives in
   `store_settings.restaurant` (see `apps/backend/src/domains/store/settings/`).
   The four modes are documented in §Four QR Modes. **Per-table override is
   GAP-6 — NOT implemented.** Until the UI in
   `restaurant-settings-form/` is wired, every table in the store inherits
   the global setting.

3. **Re-scanning an occupied table re-joins the active session.** When a
   customer scans a table whose `active_session` is still open, the
   storefront MUST attach to that session — not open a new one. Verified
   contract: `GET /ecommerce/tables/resolve?token=<t>` returns the SAME
   `session_id` to every comensal who scans while the session is open. Items
   added by comensal B accumulate into the same `order_id` as comensal A.

4. **Mesa `cleaning` is auto-reactivated by `open_tab` mode.** When a
   customer scans a table with `status='cleaning'`, the backend creates a
   new `table_sessions` row and transitions the table to `status='occupied'`
   without mesero involvement. This is intentional per owner decision (jul-2026).
   The `cleaning` flag is purely a floor-map visual indicator under this
   design.

5. **`qr_auto_fire: false` means comensal does not fire to kitchen.** Items
   added by the comensal via `POST /ecommerce/tables/{token}/order` stay in
   `pending_fire` until a mesero explicitly fires them from the POS or admin.
   The response payload includes `fired: false` for transparency. If
   `qr_auto_fire: true`, items fire on add — do not change the response
   shape; only the side effect changes.

6. **Bill is shared, not per-comensal.** The "Mi cuenta" modal shows ALL
   items from the active `order_id` for the session, regardless of which
   comensal added them. There is no visual separation by comensal. Per-comensal
   separation is purely financial via the "Dividir" button (delegates to
   `split-order.service.ts`, covered by `vendix-restaurant-ops`).

7. **`store_id` in the comensal SSE URL is mandatory.** EventSource cannot
   send custom headers (no `x-store-id`). The endpoint
   `GET /ecommerce/tables/{token}/stream?store_id=<int>` takes the `store_id`
   as a query param because `DomainResolverMiddleware` only reads it from
   `req.query.store_id` when the host doesn't resolve a store. Mismatched
   `token + store_id` → backend returns null binding → connection drops
   immediately, defaulting to deny. Frontend MUST persist `storeId` to the
   table-context signal on first resolve and pass it on every reconnect.

## Four QR Modes (`qr_scan_behavior` enum)

| Value | Comportamiento | Estado mesa | Sesión |
| --- | --- | --- | --- |
| `only_view` | QR abre carta; mesa NO cambia estado | unchanged | none |
| `mark_occupied` | QR marca mesa como `occupied` auto | `available`/`cleaning` → `occupied` | none (no order) |
| `open_tab` | QR abre sesión + crea `orders` row `draft` | `available`/`cleaning` → `occupied` | new `table_sessions` + new `order_id` |
| `require_waiter` | QR notifica al mesero; mesa NO se activa hasta confirmación del staff | unchanged | none (pending waiter ack) |

In Roku store 10 (jul-2026) only `open_tab` is in use. `mark_occupied` and
`require_waiter` are reserved enum values with partial backend support but
no UI driver. Adding a new mode requires (1) DTO enum, (2) service branch in
`ecommerce-tables.service.ts`, (3) frontend banner copy variations, (4) admin
settings form toggle.

## Endpoints (all `@Public()`, storefront consumer)

```
GET  /api/ecommerce/tables/resolve?token={public_token}
  → 200 { store_id, table: {id, name}, behavior, auto_fire, session_id | null }
  → 404 TABLE_NOT_FOUND       (token no existe)
  → 400 STORE_CONTEXT_001     (sin store_id resuelto del host)

POST /api/ecommerce/tables/{token}/order
  body: { items: [{ product_id: int, quantity: int ≥ 1, ... }] }
  → 201 { session_id, order_id, added: int, fired: bool }
  → 400 SYS_VALIDATION_001    (mass-assignment o quantity inválido)
  → 404 TABLE_NOT_FOUND       (token no existe)

GET  /api/ecommerce/tables/{token}/bill
  → 200 { table, session_id, order_id, items: [...], subtotal, grand_total, currency }
  → 400 STORE_CONTEXT_001     (sin store_id resuelto del host)

GET  /api/ecommerce/tables/{token}/stream?store_id={int}   (SSE)
  events: snapshot, item_added, bill_changed, guest_count_changed,
          request_waiter, request_bill, request_split, session_closed
```

The endpoint contract REJECTS unknown top-level fields (mass-assignment).
Always send `{ items: [...] }`, never `{ product_id, quantity }` at top
level — backend will 400.

## Domain Model (this flow's slice)

```prisma
model tables {
  id           Int       @id @default(autoincrement())
  store_id     Int
  name         String
  zone         String?
  capacity     Int
  status       String    // available | occupied | cleaning | reserved
  pos_x        Int       @default(0)
  pos_y        Int       @default(0)
  public_token String    @unique    // ← the QR handle
  // ...
}

model table_sessions {
  id          Int       @id @default(autoincrement())
  table_id    Int
  order_id    Int       // FK to orders (draft state)
  opened_by   Int?      // nullable — comensal anonymous open is allowed
  opened_at   DateTime
  closed_at   DateTime? // null = still open
  guest_count Int?
  // ...
}

model restaurant_settings {  // persisted under store_settings.restaurant
  qr_scan_behavior      String  // only_view | mark_occupied | open_tab | require_waiter
  qr_auto_fire          Bool    @default(false)
  enable_table_checkout Bool    @default(false)
}
```

## Frontend Components (the storefront comensal side)

| Component | Purpose |
| --- | --- |
| `apps/frontend/src/app/public/modules/store-ecommerce/pages/cartas/` | Public carta listing `/cartas` |
| `apps/frontend/src/app/public/modules/store-ecommerce/components/menus-showcase/` | Home cards summarizing active cartas |
| `apps/frontend/src/app/public/modules/store-ecommerce/components/table-banner/` | Persistent mesa banner (bottom-sheet on mobile <768px, inline row ≥768px) |
| `apps/frontend/src/app/public/modules/store-ecommerce/services/table-context.service.ts` | Holds `mesaToken`, `tableContext`, `storeId` signals + localStorage hydration |
| `apps/frontend/src/app/public/modules/store-ecommerce/services/table-session-sse.service.ts` | EventSource wrapper; auto-reconnect with backoff; merges snapshot + delta |

**Hydration guard (BUG B cerrado 11-jul):** when the storefront loads with a
`?mesa=` token, compare `mesaToken !== tableContext.tableToken()` before
re-hydrating from localStorage. Without this guard, the new mesa token is
ignored if the user already had a stale mesaToken in localStorage.

## SSE Snapshot Pattern

On `EventSource` connect, the backend pushes a `snapshot` event with the
last `windowMinutes` of mesa activity (items, bill state, guest_count).
Subsequent events are deltas. The frontend merges into a `tickets()` /
`bill()` signal consumed by the table-banner. Critical: `store_id` is
mandatory in the URL (see Rule 7); persist it on first resolve.

## Workflow (Comensal Scan)

1. Comensal scans physical QR → opens `{shop-hostname}/?mesa=<token>`.
2. Frontend reads `mesaToken` from query string → calls
   `GET /ecommerce/tables/resolve?token=...`.
3. Backend resolves table, returns `{ store_id, table, behavior, auto_fire, session_id }`.
4. Frontend persists `mesaToken` + `storeId` to `table-context` signal +
   localStorage; opens SSE on `/ecommerce/tables/{token}/stream?store_id=...`.
5. If `session_id === null` AND `behavior === 'open_tab'`: backend creates
   new `table_sessions` row + new `orders` row in `draft`. Frontend
   re-receives this via SSE snapshot.
6. Comensal navigates storefront → product cards show "Agregar a mi cuenta"
   instead of "Añadir" / "Comprar ahora" when mesa is active.
7. Add-to-mesa → `POST /ecommerce/tables/{token}/order` → SSE
   `item_added` event → other comensales' banners update live.

## Cross-Tenant Isolation

`public_token` is unique per table. The `DomainResolverMiddleware` MUST
resolve `store_id` from the request host before the controller runs.
Frontends hitting `api.vendix.com/api/ecommerce/tables/...` from
`roku-shop.vendix.com` get `store_id=10` automatically. From other domains
(rokku typo, lancer), the middleware returns 403 STORE_CONTEXT_001.
Brute-force probing across tenants: rejected at the middleware layer before
the controller runs.

## Anti-Patterns

- Using the autoincrement `tables.id` in a QR URL (info-leak; guessable).
- Putting the `public_token` in a header instead of query string for the
  SSE endpoint — EventSource cannot set custom headers.
- Persisting `mesaToken` without checking `tableToken()` first → stale
  hydration overrides fresh scan (BUG B 11-jul, already fixed).
- Adding `comensal_id` to the request body to "track who added what" —
  forbidden by `forbidNonWhitelisted`; not part of the contract; rejected
  with 400.
- Implementing `qr_scan_behavior: 'mark_occupied'` as a separate flow
  instead of reusing the `table_sessions` create path — duplicates state
  transitions and breaks the bill rollup.
- Sending `auto_fire=true` in the response payload as a request parameter
  — it's a server-controlled setting, not client input.
- Adding per-table `scan_mode` columns without also wiring
  `restaurant-settings-form` to read them — orphan config.

## Source of Truth (paths)

- Backend: `apps/backend/src/domains/ecommerce/tables/` (public consumer),
  `apps/backend/src/domains/store/tables/` (admin/POS).
- Frontend: `apps/frontend/src/app/public/modules/store-ecommerce/` (this flow).
- Admin frontend: `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/`.
- Schemas: `apps/backend/prisma/schema.prisma` → `models.tables`,
  `models.table_sessions`.
- Settings: `apps/backend/src/domains/store/settings/settings.controller.ts` →
  `restaurant_settings.{qr_scan_behavior, qr_auto_fire, enable_table_checkout}`.
- Related skills: `vendix-restaurant-ops` (POS/admin), `vendix-ecommerce-checkout`
  (regular order flow), `vendix-error-handling` (SYS_VALIDATION_001, STORE_CONTEXT_001, TABLE_NOT_FOUND).