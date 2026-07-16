---
name: vendix-restaurant-ops
description: >
  Suite restaurante para Vendix: modelado plato/insumo, recetas/BOM, producción de
  sub-recetas en lote, fire-to-kitchen con descuento y COGS, mesas con cuenta
  abierta y split financiero, KDS en tiempo real vía SSE, menú con carta/secciones/
  combos/ventanas horarias/ingeniería BCG, e integración POS con gating por
  industria. Trigger: When working on restaurant suite, recipes, BOM, prepared
  products, ingredient flags, kitchen fire, KDS, kitchen tickets, table sessions,
  open tabs, bill split, menu engineering, menu availability windows, or any
  store whose `industries` includes `restaurant`.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.2"
  scope: [root]
  auto_invoke:
    - "Editing recipes, BOM explosion, or sub-recipe production orders"
    - "Editing kitchen-fire, fire-to-kitchen, or kitchen tickets / KDS"
    - "Editing tables, table sessions, or order split logic"
    - "Editing menus, menu sections, menu availability windows, or menu engineering"
    - "Modifying the POS for restaurant flow (fire, open table, split bill)"
    - "Working with order_items.inventory_consumed_at_fire flag"
    - "Working with product_type_enum='prepared' or the is_sellable/is_ingredient/is_combo/is_batch_produced flags"
    - "Editing industry gating so that only `restaurant` stores see restaurant_ops"
    - "Adding or adjusting the POS stock-vs-KDS decision modal (skipKds) for prepared+track_inventory+stock>0 products"
    - "Adding or adjusting KDS card urgency tiers (warning / danger) driven by preparation_time_minutes"
    - "Wiring the KDS ticket detail modal (recipe + actions replica)"
    - "Modifying the POS payment close-out against an open table (table_session_id, applyPosPaymentToTableSession, table status cleaning)"
    - "Modifying the POS open-table flow that propagates an optional customer to the session and draft order"
---

## When to Use

- A store has `restaurant` in `stores.industries` and needs the full restaurant suite.
- Touching any of: `recipes`, `recipe_items`, `production_orders`, `kitchen_tickets`,
  `kitchen_ticket_items`, `tables`, `table_sessions`, `menus`, `menu_sections`,
  `menu_section_items`, `menu_availability_windows`, or `order_items.inventory_consumed_at_fire`.
- Wiring the POS for restaurant flow (open table, send to kitchen, split bill).
- Editing the menu/carta UI, menu builder, or menu engineering (BCG) analytics.
- Debugging why a `prepared` product is not consumed at fire, or why a paid order
  double-discounts inventory.

## Domain Model Overview

A restaurant store works on three orthogonal product axes encoded as columns on
`products` (no new entity for "dishes" — `products` is reused):

| Column | Default | Meaning |
| --- | --- | --- |
| `product_type` | `physical` | New value `prepared` flags a dish composed by a recipe. |
| `is_sellable` | `true` | Shown on POS / carta / ecommerce. |
| `is_ingredient` | `false` | Eligible as a component in `recipe_items`. |
| `is_combo` | `false` | Combo/menú fijo (composed by recipe items pointing to sellable products). |
| `is_batch_produced` | `false` | Sub-receta produced in a `production_order` (has its own stock). |
| `stock_unit` / `purchase_unit` / `purchase_to_stock_factor` | `null` | Integer-unit stock rule (see §Unit rule). |

Combinations cover the 4 cases: `harina` (false/true), `agua dual` (true/true),
`camiseta retail` (true/false), `archivado` (false/false). The retail catalog
stays intact because the defaults match the existing semantics.

## Unit Rule (Critical, MVP)

`stock_levels.quantity_*`, `inventory_cost_layers.quantity`, and movements are
`Int` in the schema. Recipes need fractional quantities (grams, ml, portions).
**Do not migrate the inventory core to `Decimal` for the MVP.** Each ingredient
is stored in its **integer minimum stock unit** (e.g. grams, ml, units) and
referenced by integer quantity in the recipe. The purchase-to-stock factor
converts at purchase time. Waste (`waste_percent` per item and per recipe) and
yield (`yield_quantity`, `yield_unit`) are decimal factors; the **final consumed
quantity is rounded to integer** in the stock unit.

- Residual risk: rounding accumulates in recipes with many tiny components.
  Mitigate by working in milli-units (mg, µl) when needed — still integer.
- A future migration to `Decimal(18,4)` is deferred and **must** follow the
  anti-destructive rules in `vendix-prisma-migrations` and the global §6 of
  `CLAUDE.md`.

## Recipes / BOM

- `recipes` is 1:1 logical with a `prepared` product (`recipes.product_id` is
  unique per store). The recipe owns `recipe_items`, each pointing to a
  `component_product_id` (an ingredient, possibly another `prepared`
  sub-recipe) with an integer `quantity` and a per-item `waste_percent`.
- `RecipesService.explodeBom(recipeId, multipliers)` is the single entry point
  used by `kitchen-fire` and `production-orders` to flatten a recipe into the
  list of leaf ingredients to consume. It is the **only** place that knows how
  to walk sub-recipes. Always use it; do not re-implement traversal.
- Anti-cycle validation: a component cannot be the product itself. Detect
  transitive cycles with DFS on save.
- The recipe editor UI is at
  `apps/frontend/src/app/private/modules/store/restaurant-ops/recipes/` and
  uses `app-multi-selector` to pick ingredients (`is_ingredient=true`) and
  CVA inputs for `quantity` and `waste_percent` (see `vendix-zoneless-signals`).

## Production of Sub-recipes (batch stock)

- `production_orders` is the only flow that produces stock for a
  `is_batch_produced=true` product. `complete()` runs in a single Prisma
  transaction:
  1. For each `recipe_item`, call `StockLevelManager.updateStock` with
     `movement_type='consumption'` and a negative quantity, applying the
     multiplicative waste `(1 + line_waste/100) * (1 + recipe_waste/100)`.
  2. Compute `produced_qty = planned_qty * (1 - waste_percent/100) * yield_factor`.
  3. Call `StockLevelManager.updateStock` with `movement_type='production'`
     and a positive quantity on the prepared product, with
     `unit_cost = Σ(FIFO costs consumed) / produced_qty`.
  4. Update the order to `completed`; emit `production.completed` **after**
     the commit (failure to emit must not roll back the production).
- Accounting: `production.completed.finished_goods` and
  `production.completed.ingredient_consumed` are registered in the default
  account mappings (DR 1435 / CR 1435) — an intra-inventory value transfer.

## Fire-to-Kitchen (the seam)

Inventory + COGS for `prepared` items are consumed at **fire-to-kitchen**, not
at payment. The flow lives in `kitchen-fire`:

- `kitchen-fire.service.ts:fireOrderItems(orderId, orderItemIds[])` is
  transactional: for each item, if the product is `prepared` and has a recipe,
  it calls `RecipesService.explodeBom` and consumes the leaf ingredients
  through `StockLevelManager.updateStock` with `movement_type='consumption'`
  and a negative quantity. It then:
  - Sets `order_items.inventory_consumed_at_fire = true` for each fired item.
  - Creates a `kitchen_ticket` + `kitchen_ticket_items` (KDS picks them up).
  - Computes `cogsTotal = Σ(FIFO costs consumed)`.
  - Emits `kitchen.fired` after commit.
- The auto-entry mapping is `kitchen.fired.cogs` / `kitchen.fired.inventory`
  (DR 6135 / CR 1435) — handled by `AccountingEventsListener` and
  `AutoEntryService.onKitchenFired` (same pattern as `onOrderCompleted`).
- `payments.service.ts:updateInventoryFromOrder` (around line 2546) now has
  a one-line guard: `if (item.inventory_consumed_at_fire === true) continue;`
  This is the **anti-double-discount** rule — payment skips items already
  consumed at fire. Do not remove this guard when refactoring payments.
- Idempotency: re-firing the same `order_item` is a no-op because the flag
  is set; `fireOrderItems` returns the skipped item ids and errors if **all**
  items were skipped.

### Fase K — Recipe-less fire (Gap 3) + `KITCHEN_TICKET_NO_RECIPE`

A `prepared` product with **no active recipe** is still fireable to the
kitchen. `fireOrderItems` partitions `firedItemIds` into:

- `preparedItems` (active recipe): consume leaf ingredients, recognize COGS.
- `recipeLessItems` (no active recipe OR inactive recipe): no BOM, no stock
  movement, `cogsTotal` stays 0 for these rows. The flag
  `inventory_consumed_at_fire=true` is still flipped so the payment path
  skips them and the anti-double-discount invariant holds. The kitchen
  cooks them manually (the stock of leaf ingredients is the operator's
  concern, not the system's).

`startPreparation(ticketId)` adds a hard guard: if ANY item in the ticket
has no active recipe, the transition to `in_preparation` is rejected with
`KITCHEN_TICKET_NO_RECIPE` (422, `apps/backend/src/common/errors/error-codes.ts`).
The guard is per-ticket (not per-item) because the state model transitions
the whole ticket. The operator can either attach a recipe first or mark
the ticket as delivered directly to bypass `in_preparation`.

**Invariant — new meaning of `inventory_consumed_at_fire`:**
"disparado a KDS, el pago no lo toca, COGS puede ser 0" (not the old
"consumido de receta"). The payment path guard at
`payments.service.ts:2554` (`if (item.inventory_consumed_at_fire === true) continue;`)
DOES NOT distinguish between the two cases — and that is correct: in both
cases the KDS owns the item and the payment must not double-discount.

## Tables and Open Tab

- `tables` is a per-store floor entity (`pos_x`, `pos_y`, `status`).
- `table_sessions` is the **open tab**. Opening a session calls
  `orders.service.create` to make an `orders` row in `draft` state and links
  the session to it via `order_id`. Adding items to the session appends
  `order_items` to that draft order (no fire happens automatically — the
  POS decides when to fire).
- Closing a session marks `closed_at`; it does **not** finish the order.
  The order finishes when paid through the normal payment flow.
- Bill split (`split-order.service.ts`) is **purely financial**:
  - `splitOrderByItems(orderId, itemGroups[])` and
    `splitOrderByAmount(orderId, nSplits, mode)` create N sub-orders from
    the source.
  - Sub-orders **propagate** `inventory_consumed_at_fire=true` from the
    source `order_items`. Split must never create new consumption movements;
    inventory is already gone (taken at fire). The flag propagation is what
    keeps `payments.updateInventoryFromOrder` from re-discounting.

### Fase K — POS end-to-end (crear → mesa → cliente → cobrar)

The restaurant POS supports three fulfillment types (mostrador, delivery,
consumo) and an optional customer binding. The flow must work **end-to-end
without DB migrations** and stay aligned with the existing table / customer
APIs. Key invariants, encoded during the K-feature stabilization:

- `orders.customer_id` is **`Int?` nullable** at the Prisma layer. The
  `create-order.dto` declares it `@IsOptional() @IsInt() @Min(1)` so a
  counter / table-less sale can omit it; `orders.service.create` skips the
  `users.findUnique` FK lookup when null and persists `customer_id ?? null`
  on the row. Symmetrically, `payments.service.processSaleWithPayment`
  forwards the cart customer only when the cart has one. There is **no
  "Cliente General / id=1" sentinel** — true anonymous is the source of
  truth.
- `OpenTableSessionDto.customer_id?` already existed (Fase E). The
  `PosOpenTableModalComponent` now exposes a `[customer]` input and
  forwards it in the `openTableSession` call, so opening a table attaches
  the customer (if any) to the session **and** the linked draft order.
- The cart merge key in `pos-cart.service.processAddToCart` is
  `product.id + variant_id + skipKds` (boolean). The `skipKds` field is
  part of the identity because two same-product lines with different
  KDS-vs-stock decisions must NOT collapse — they take different code
  paths at fire time.
- `PosOrderCreateModalComponent.onConfirm` re-routes so the
  **table-session branch always wins** when a session is open. The
  pre-existing `hasUnfiredPreparedItems` check used to fall through to
  the retail `createRetailDraft` path on consumption sales, which
  silently orphaned the table. The fix: if a session is open, the modal
  always calls `appendToTableAndFire` (with `skipKds` lines filtered
  out of the fire list). `preparedItemIdsFromOrder` and the cart-level
  `hasUnfiredPreparedItems` both skip `skipKds` lines when deciding
  whether to fire the kitchen.
- `PosPaymentInterfaceComponent` (the cobro modal) gained an inline
  table picker for the `consumo` fulfillment: a CTA "Abrir mesa" embeds
  the same `PosOpenTableModalComponent` used by the create flow. The
  picker writes to `pickedTableId` and `pickedSessionId` signals;
  `canProcessPayment` falls back to `tableId() ?? pickedTableId()` so the
  Cobrar button unblocks. `processSaleWithPayment(cart, payment, user,
  tableSessionId?)` is the new 4-arg signature that forwards
  `table_session_id` to the backend.
- `PaymentsService.createOrUpdateOrderFromPos` branches on
  `dto.table_session_id`. When present, it delegates to
  `applyPosPaymentToTableSession` (new helper): loads the session,
  validates it belongs to the request store and is still open, optionally
  appends new `order_items` to the existing draft order, re-derives
  `subtotal_amount` / `tax_amount` / `discount_amount` / `grand_total`
  from the merged items (re-running promotion + coupon quote), persists
  the totals, marks the session `closed_at = now()`, **and** transitions
  the table to `status='cleaning'` (matching `TableSessionsService.closeSession`
  semantics — without this the table stays `occupied` forever after a POS
  close-out and blocks the next `openTableSession` call on the same table).
  The order then flows through the normal payment / inventory / journal
  pipeline; no special-casing downstream.
- The fire / payment path now filters `skipKds` in **three** places: the
  cart-level `hasUnfiredPreparedItems` (POS component), the
  `preparedItemIdsFromOrder` helper (create modal), and the actual fire
  loops in `fireCounterOrder` and `fireKitchenFromCompletedOrder`. Lines
  with `skipKds=true` are excluded from `order_item_ids` sent to the
  kitchen and `inventory_consumed_at_fire` is not set on them — their
  stock is consumed at payment time as a regular `sale` movement, not at
  fire.
- The orders list (`orders-list.component`) is loaded via `loadComponent`
  (lazy), so the constructor runs fresh on each navigation. The
  `OrdersComponent` host subscribes to `router.events` and increments a
  `reloadTick` signal on `NavigationEnd` to `/admin/orders` (and
  excluding detail sub-routes). The list binds `[reloadTrigger]="reloadTick()"`
  and re-fetches on tick change via an `effect`. The bug "POS sale
  doesn't show up in /admin/orders/sales until I hit F5" is fixed
  without backend changes — `findAll` was already correct.

## KDS (Kitchen Display System)

- KDS uses SSE on subject `kitchen:{store_id}` — same pattern as
  `notifications:{store_id}` in `notifications-sse.service.ts`. The
  `KdsSseService` on the frontend wraps `EventSource` with exponential
  backoff (1s → 30s), sends a `snapshot` event on connect (last
  `windowMinutes` of tickets), and merges incoming events into a signal
  consumed by the KDS board page.
- Ticket / item states: `pending → in_preparation → ready → delivered`
  (plus `cancelled`). All transitions are server-emitted SSE events
  (`ticket.created`, `ticket.started`, `ticket.ready`, `ticket.delivered`,
  `ticket.cancelled`).
- The KDS board is at
  `apps/frontend/src/app/private/modules/store/restaurant-ops/kds/` with a
  4-column layout. Reuse `app-sticky-header`, `app-stats`, `app-card`,
  `app-button`, `app-badge`, `app-icon`, `app-toast`, `app-spinner`.

### Fase K — KDS card urgency (Gap 5)

KDS card urgency is driven by `products.preparation_time_minutes` (also on
`product_variants.preparation_time_minutes`, exposed via the single
`KITCHEN_TICKET_INCLUDE` so snapshot and every SSE event carry it). The
board computes the **smallest** prep time across the ticket's items;
missing/0/negative values contribute the default of 10 minutes.

- **Warning tier**: `elapsed >= smallest_prep * 60s` (amber border + label).
- **Danger tier**: `elapsed >= (smallest_prep + 5) * 60s` (red border + label).
- Both tiers are suppressed in terminal states (`delivered`, `cancelled`).
- Legacy `--urgent` class is kept as a backward-compat alias for `--warning`;
  do not delete without auditing old screenshots.

The shared `now` ticker is pushed to every card from the board; one timer
for the whole page (not per card).

### Fase K — KDS ticket detail modal (Gap 4)

Clicking a KDS card body opens `kds-ticket-detail-modal`
(`apps/frontend/src/app/private/modules/store/restaurant-ops/kds/components/kds-ticket-detail-modal/`)
showing:

- Order header (number, table, status, elapsed).
- The ticket items with quantities, names, notes, and prep time.
- The active recipe for each item via `RecipesService.getByProduct`,
  cached per `product_id` in a local `Map` to avoid hammering the API.
  Graceful degradation to "Receta no disponible" on 403/404 (per R7, we
  never block the modal on a missing recipe nor touch permissions).
- Replica of the board actions (Start / Ready / Deliver / Cancel) that
  re-emit to the parent handlers so the SSE pipeline stays the source of
  truth.

The modal is **live**: the board derives the ticket from the SSE-fed
`tickets()` signal by id, so any board event updates the modal in real
time. The actions footer uses `(click)="$event.stopPropagation()"` so
clicking a button inside the modal never re-opens it.

### Fase K — KDS state in order detail (Gap 2)

`GET /api/store/orders/:id` (`orders.service.ts:findOne`) now includes
`kitchen_ticket_items` (ordered desc by id) on every `order_item`. The
order detail page surfaces a "Cocina: \<estado\>" badge per item with
the colour map: pending→neutral, in_preparation→warning, ready→success,
delivered→info, cancelled→error. Non-fired items show no badge. The
helper `kitchenStateFor(item)` prefers a non-terminal (in-flight) row
over the most recent terminal row, so the badge tracks the active state
even after re-fires.

## Menu / Carta

- A `menus` is a named carta with `menu_sections`, each with
  `menu_section_items` (a product reference, sort order).
- Availability: `menu_availability_windows` are windows per `day_of_week`
  + `start_time` + `end_time` (`"HH:mm"`), either at menu level
  (`menu_id`) or section level (`menu_section_id`). The post-filter uses
  the same `Intl.DateTimeFormat` algorithm as
  `schedule-validation.service.ts:getDateInTimezone` (do not duplicate
  timezone math).
- Combos are **not** a new model. A combo is a `product_type='prepared'`
  with `is_combo=true`, whose `recipe_items` point to sellable products
  (or other combos). The combo's price is the product's own price
  (`vendix-calculated-pricing`); at fire, the recipe is exploded and each
  component is consumed.
- Menu engineering (BCG): `menu-engineering.service.ts` aggregates
  popularity (units sold in a window) × margin (price − recipe unit cost)
  and classifies products as **estrella / caballo / puzzle / perro**. The
  engineering view lives at
  `apps/frontend/src/app/private/modules/store/restaurant-ops/menus/pages/menu-engineering-page/`.
- The public carta (`@Public()` at `catalog.service.ts:27/461`) now adds
  `is_sellable: true` to the where clause and post-filters results by the
  active availability window. Do not remove the `@Public()` decorator.

## POS Integration

- The POS (`apps/frontend/src/app/private/modules/store/pos/`) sends
  `is_sellable=true` in its product list filters so pure ingredients are
  never shown to the cashier.
- The 3 outputs are `openTable`, `fireKitchen`, `splitBill` — wired into
  `pos-cart.component.ts` and the mobile footer. They delegate to
  `pos-restaurant-integration.service.ts` which calls the
  `kitchen-fire`, `tables`, and `split-order` services.
- The retail POS path is unchanged: defaults preserve `is_sellable=true`
  on all retail products.

### Fase K — POS stock-vs-KDS decision (Gap 1, `skipKds`)

A `prepared` product that **also tracks inventory and has stock > 0** is
ambiguous: cook-from-scratch (consume ingredients at fire) vs sellable
item (consume its own stock on payment). The POS surfaces
`pos-prepared-choice-modal`
(`apps/frontend/src/app/private/modules/store/pos/components/pos-prepared-choice-modal/`)
to the cashier at add-to-cart time. The choice persists as
`CartItem.skipKds`:

- `skipKds=false` (default, "Producir por KDS"): the item is included in
  `fireOrderItems`. Stock of leaf ingredients is consumed at fire; the
  product's own stock is not touched.
- `skipKds=true` ("Usar stock"): the item is **excluded** from
  `fireOrderItems` (POS component filters the `order_item_ids` list).
  No kitchen ticket is created. The product's own stock is consumed at
  payment as a regular `sale` movement.

The flag is purely cart-local — it is **NOT** persisted to
`order_items`, so no DB migration is required. Retail-only stores never
see the modal (gated on `isRestaurantMode()`). Combined with the
`inventory_consumed_at_fire` guard in `updateInventoryFromOrder`, this
preserves the anti-double-discount invariant without schema changes.

## Industry Gating (inverse rule)

`restaurant_ops` is the panel UI module that aggregates
`recipes / production / kds / tables / menus`. The gating is **inverse**:
`retail`, `manufacturing`, and `service` industries list `restaurant_ops`
in `INDUSTRY_HIDDEN_MODULES`; `restaurant` does not. The 3-layer crossing
(industry ∩ store ∩ user) in `getModulesHiddenByIndustries` already
ensures that, if the industry hides a module, neither store nor user can
enable it. Do not relax this rule.

## Permissions

The seed (`permissions-roles.seed.ts`) registers the restaurant_ops
permission keys used by the controllers:

- `store:recipes:create|read|update|delete`
- `store:production_orders:create|read|update`
- `store:kitchen_fire:create|read|update`
- `store:tables:create|read|update|delete`
- `store:table_sessions:create|read|update`
- `store:menus:create|read|update|delete`
- `store:menu_engineering:read`

## Comensal / Storefront side

The **comensal-side** flow (scanning a physical QR from the storefront,
re-joining an active session, comensal SSE) is governed by the companion
skill `vendix-restaurant-table-qr`. This skill covers POS-side and
admin-side behavior (open session from POS, fire-to-kitchen, KDS, split
bill) — when working on the public storefront comensal experience, the
table-qr skill is the source of truth for the
`apps/backend/src/domains/ecommerce/tables/*` endpoints, the
`?mesa=<public_token>` deep-link, the `qr_scan_behavior` enum, and the
table-banner UI in `apps/frontend/src/app/public/modules/store-ecommerce/`.
Do not duplicate that documentation here.

## Source of Truth (paths)

- Backend modules: `apps/backend/src/domains/store/{recipes,production,kitchen-fire,tables,menus}/`
- Frontend modules: `apps/frontend/src/app/private/modules/store/restaurant-ops/{recipes,production,kds,tables,menus}/`
- Storefront comensal: `apps/backend/src/domains/ecommerce/tables/` +
  `apps/frontend/src/app/public/modules/store-ecommerce/` (see companion
  `vendix-restaurant-table-qr`).
- Schemas: `apps/backend/prisma/schema.prisma` + the migration
  `20260613000000_restaurant_suite_foundation/migration.sql` (Fase A) and
  `20260613000001_fire_to_kitchen_inventory_flag/migration.sql` (Fase D).
- Scopes: `apps/backend/src/prisma/services/store-prisma.service.ts`
  (11 new models in `store_scoped_models`).
- Account mappings + auto-entries:
  `apps/backend/src/domains/store/accounting/auto-entries/`.

## Anti-patterns

- Implementing a "dish" entity instead of reusing `products` with
  `product_type='prepared'`.
- Recursing recipes by hand in controllers/services — always call
  `RecipesService.explodeBom`.
- Discounting `prepared` inventory at payment — it must be at fire, and
  the `inventory_consumed_at_fire` guard must stay in
  `payments.updateInventoryFromOrder`.
- Splitting the bill by re-creating consumption movements — split is
  financial; inventory is already gone.
- Re-emitting the same SSE event before commit — emit only after the
  Prisma transaction commits, otherwise listeners may see events for
  state that was rolled back.
- Adding `restaurant_ops` to the `restaurant` industry in
  `INDUSTRY_HIDDEN_MODULES` — the rule is inverse; `restaurant` keeps
  it visible.
- Migrating inventory quantities to `Decimal` in this MVP — defer with a
  dedicated migration plan that follows `vendix-prisma-migrations` rules.
