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
  version: "1.0"
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

## Source of Truth (paths)

- Backend modules: `apps/backend/src/domains/store/{recipes,production,kitchen-fire,tables,menus}/`
- Frontend modules: `apps/frontend/src/app/private/modules/store/restaurant-ops/{recipes,production,kds,tables,menus}/`
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
