---
name: vendix-inventory-stock
description: >
  Inventory stock management patterns: StockLevelManager, stock_levels source of truth,
  reservations, variant/base transitions, audit records, and denormalized stock sync.
  Trigger: When working with stock levels, inventory adjustments, stock transfers,
  reservations, or any operation that modifies product/variant quantities.
license: MIT
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "Working with stock levels, inventory adjustments, or stock transfers"
    - "Transitioning products between simple and variant modes"
    - "Reserving or releasing stock"
    - "Modifying StockLevelManager service"
    - "Working with inventory transactions or movements"
    - "Debugging INV_STOCK_INSUFFICIENT_LINES or INV_STOCK_002"
    - "Adding a validate-before-mutate stock guard on an order/kitchen path"
    - "Working with store_settings.inventory.allow_negative_stock or allow_ingredient_overuse"
---

# Vendix Inventory Stock

## Source of Truth

- Core service: `apps/backend/src/domains/store/inventory/shared/services/stock-level-manager.service.ts`.
- Stock source of truth: `stock_levels` with unique `(product_id, product_variant_id, location_id)`.
- Denormalized fields: `products.stock_quantity` and `product_variants.stock_quantity` are maintained by `syncProductStock()`.
- `stock_quantity` mirrors `quantity_available`, not `quantity_on_hand`.

## Quantity Semantics

| Field | Meaning |
| --- | --- |
| `quantity_on_hand` | Physical units in the location |
| `quantity_reserved` | Units locked by active reservations |
| `quantity_available` | Sellable units; `on_hand - reserved` |

Never sell from `quantity_on_hand` directly.

## Mutation Rule

Use `StockLevelManager` for stock writes. Do not update `stock_levels`, `products.stock_quantity`, or `product_variants.stock_quantity` directly.

`updateStock()`:

- Skips stock operations for products with `track_inventory = false` and returns null stock/transaction values.
- Uses `getOrCreateStockLevel()` for missing location rows.
- Validates availability only when requested.
- Creates an `inventory_transactions` record.
- Creates an `inventory_movements` record only when `create_movement: true`.
- Calls `syncProductStock()` and emits `stock.updated` / `stock.low` as applicable.

## Sync Rule

`syncProductStock(product_id, variant_id?)`:

- If the product has variants, product aggregate sums variant rows only.
- If the product has no variants, product aggregate sums base rows.
- Variant aggregate updates `product_variants.stock_quantity` for that variant.

Call sync after any stock/reservation change unless the manager method already does it.

## Reservations

- `reserveStock()` creates active `stock_reservations`, increments `quantity_reserved`, decrements `quantity_available`, then syncs.
- `releaseReservation()` marks active reservations as `consumed` and restores available stock.
- `releaseReservationsByReference(..., 'consumed')` consumes reserved units by reducing `quantity_on_hand`.
- `releaseReservationsByReference(..., 'cancelled')` restores available stock without reducing on-hand stock.
- `releaseAllReservationsForProduct()` and `releaseAllActiveReservations()` are bulk helpers for cleanup flows.

### Who releases an order's reservations, and when

A reservation created for an order is never released by inventory code on its
own — it is released by the **order state machine**. Every release is a side
effect of a state transition in `OrderFlowService`:

| Transition | Who releases | How |
| --- | --- | --- |
| `→ cancelled` | `cancelOrder()` | `releaseReservationsByReference('order', id, 'cancelled')` — restores available, keeps on-hand |
| item `→ delivered` | `deliverOrderItem()` → `OrderStockCommitService.commitOrderLines([itemId], …)` | **consumes**: reduces on-hand for that one line only. This is now the PRIMARY consumption point — see "No Overselling" below |
| order `→ delivered` / `→ finished` | `updateOrderState()` → `OrderStockCommitService.commitOrderDelivery()` | consumes any line not already committed at item-level delivery; the atomic `inventory_committed` claim makes re-running it at `finished` a no-op for lines already consumed |
| `→ shipped` | the `order.shipped` **event** → `OrderAutoFulfillmentListener` | ORG scope only, and only for reservations held **at the central warehouse**: it auto-creates a transfer central→store and consumes that reservation. STORE scope, or reservations at the store's own location, are a no-op here |

The `shipped` row is the trap. The consumption is **not** in `shipOrder()`'s
body — it hangs off `eventEmitter.emit('order.shipped', ...)`, which only fires
when `order.stores.organization_id` is set. Any path that moves an order to
`shipped` without going through `shipOrder()` silently skips it, and the units
stay reserved forever even though they physically left. That is exactly what
`PATCH /store/orders/:id {"state":"shipped"}` used to do (QUI-557 follow-up).

Rule: never write `orders.state` outside `OrderFlowService`. The manual UI
buttons that need to bypass the state machine go through
`OrderFlowService.forceOrderState()`, which skips **preconditions only** and
still runs the release/consume chain. See `vendix-backend-domain` for the seam.

`finished` used to be the ONLY consumption point (pre-2026-09-26). It is not
anymore — see the next section for why, and for the full reserve→consume
lifecycle, the shared error contract, and the two per-store overselling
switches.

## No Overselling (validate → reserve on add → consume on delivery → reverse)

`docs/plans/no-overselling-stock-guard-plan.md` (2026-09-26). Reverses
QUI-557's "stock agotado no bloquea el cobro": **by default nothing oversells,
anywhere, including payment.** A tracked product or ingredient with no
available stock blocks the operation and names what is missing; untracked
items/ingredients have no limit. The old model (validate loosely, consume only
at `finished`) let two open tables promise the same physical unit and let
delivery mark an item as handed over without ever touching inventory — that is
exactly what produced negative `quantity_available` in production (order 7826,
Gorrero).

Lifecycle for a tracked product/variant line:

1. **Validate on add** — every entry point calls
   `StockValidatorService.assertLinesAvailable(lines, {orderId?, tx})` BEFORE
   reserving: `orders.service.create`, `updateOrderItems`, `table-sessions
   .service.ts addItems`, `promoteDraftToCreated`, and the POS payment check in
   `payments.service.ts`. It aggregates demand per
   `(product_id, product_variant_id)`, skips `service` products and untracked
   identities (`resolveEffectiveTracking`), and credits the order's OWN active
   reservation back into "available" (`opts.orderId`) — re-validating a line
   that already reserved its stock is never counted as a shortfall against
   itself.
2. **Reserve on add** — `StockLevelManager.reserveStock(..., allow_negative_available: false)`
   inside the same tx right after the validator passes. A race that slips past
   the validator still throws `INV_STOCK_001` at the atomic claim.
   `reserveStock` is itself a no-op for untracked products — it never creates
   a reservation nothing downstream would release.
3. **Consume on delivery, not on finish** — `deliverOrderItem` calls
   `OrderStockCommitService.commitOrderLines(orderId, [itemId],
   {blockOnInsufficient: true})` INSIDE the same tx as the `delivered_at`
   stamp. A shortfall (`INV_STOCK_002`) rolls back the stamp — the item stays
   undelivered. `updateOrderState('delivered' | 'finished')` and
   `forceOrderState('delivered')` (`direct_deliver`) run the full-order
   `commitOrderDelivery` the same way, BEFORE writing the state. The atomic
   `inventory_committed` claim (`updateMany({where: {inventory_committed:
   false}}, …)`) makes re-running the commit at `finished` a no-op for lines
   already consumed at `delivered` — never a double deduction.
4. **Reverse**:
   - Cancelling an undelivered item (`cancelOrderItem`) releases exactly that
     line's reservation via `StockLevelManager.releaseReservationQuantity(ref,
     product, variant, qty, 'cancelled', tx)`. Two lines of the same product
     never fight over one reservation — see the partial release below.
   - Cancelling a DELIVERED item (`cancelDeliveredOrderItem`) restocks by
     `stock_units_consumed` (what was ACTUALLY deducted, keyed off
     `inventory_committed`) — never by `quantity` or `delivered_at`. An item
     that carries `delivered_at` but was never actually committed only
     releases its reservation; it never adds phantom stock.

### Partial reservation release (`releaseReservationQuantity`)

`StockLevelManager.releaseReservationQuantity(referenceType, referenceId,
product_id, variant_id, quantity, status, tx)` releases/consumes only the
requested `quantity` from the reference's active reservations, locking
candidate rows `FOR UPDATE` in id order and re-reading before mutating (so two
concurrent deliveries of sibling lines can't race each other). It never clamps
silently: if active reservations sum to less than `quantity`, it releases what
there is and returns the real total — the caller decides whether that is an
error. This is what makes "2 lines of the same product on one order" safe:
delivering (or cancelling) one line releases/consumes only that line's units,
the sibling line's reservation stays intact. `status: 'consumed'` decrements
`quantity_on_hand` by default; a caller that already decremented on-hand
itself (via `updateStock`, the only source of costing/movements/valuation)
must pass `{decrementOnHand: false}` to avoid a double deduction.

### Shared validator (`StockValidatorService`)

| Method | Validates | Throws |
| --- | --- | --- |
| `assertLinesAvailable(lines, opts)` | order lines (products/variants) | `INV_STOCK_INSUFFICIENT_LINES` (409) |
| `assertIngredientsAvailable(demands, opts)` | recipe ingredients, summed BOM (see `vendix-restaurant-ops`) | `INV_STOCK_INSUFFICIENT_LINES` (409) |
| `findInsufficientLines(lines, opts)` | shared non-throwing core of both above | — (returns the list) |
| `resolveInventoryPolicy(storeId, tx?)` | reads the two per-store switches below | never throws — degrades to strict defaults on any read error |

Both throwing methods share ONE error contract:
`details.items[] = {product_id, product_variant_id, product_name,
kind: 'product' | 'ingredient', requested, available, used_by?}`. `used_by`
names the dish(es) that demanded a shared ingredient when a shortage spans
several recipe lines.

`INV_STOCK_INSUFFICIENT_LINES` (409) is thrown by the validator BEFORE any
mutation (add-to-order, table `addItems`, payment, fire-to-kitchen,
production) with an array of shortfalls. `INV_STOCK_002` (409) is thrown by
`OrderStockCommitService` AT delivery/commit time for a single line whose
reservation + sellable stock still don't cover it (rare — steps 1-2 already
reserved); its `details` is the flat single-item shape, not an array. Frontend
renders both through the same pipeline:
`apps/frontend/src/app/core/utils/parse-api-error.ts` (`readInsufficientStockItems`)
+ `stock-shortage.util.ts` (`formatStockShortageLines` /
`formatStockWarningSummary`).

### Per-store switches (plan step 9, 2026-09-26)

Read via `StockValidatorService.resolveInventoryPolicy(storeId, tx?)` from
`store_settings.settings.inventory` directly — NOT through
`mergeStoreSettingsWithDefaults` (its deep-merge only skips `undefined`; a
persisted `null` would otherwise leak through instead of resolving to the
field's default).

| Key | UI label | Default | Missing/null resolves to | ON behavior |
| --- | --- | --- | --- | --- |
| `allow_negative_stock` | "Permitir sobreventa" | `false` | `false` — only an explicit `true` turns it on | Order-line paths (reserve/pay/deliver/fire) don't block: `reserveStock(..., allow_negative_available: true)`, `commitOrderLines`/`commitOrderDelivery({blockOnInsufficient: false, allowNegativeOnShortfall: true})`. `quantity_on_hand`/`quantity_available` go negative by the missing amount. |
| `allow_ingredient_overuse` | "Permitir sobre-uso de insumos" | `true` | `true` — resolve with `?? true`, **never** `?? false` (that inverts the default and silently blocks every store that never touched the key) | Fire/resend/production don't block on a tracked ingredient shortfall: `updateStock({allow_negative: true})` consumes the FULL BOM quantity, the ingredient's stock goes negative (no clamp to 0). See `vendix-restaurant-ops`. |

Both ON paths are non-silent: the shortfall is `logger.warn`'d and collected
into `stock_warnings` (`InsufficientStockItem[]`) on the response — an
ADDITIVE field, absent (not `[]`) when nothing was short. The frontend renders
it as a warning toast (`formatStockWarningSummary`) in POS, the table session
page, order detail, the KDS resend modal, and the production orders list.

`UpdateStockParams.allow_negative` on `StockLevelManager.updateStock` is a
narrowly-scoped opt-in that skips the `Math.max(0, …)` floor. It exists ONLY
for these two switch-gated paths — every other caller keeps the existing
clamp-to-zero. Passing it together with `validate_availability: true` is a
contradiction the code does not resolve silently: the atomic `gte` claim
inside the `validate_availability && quantity_change < 0` branch still throws
regardless of `allow_negative`, by design (the two describe mutually exclusive
intents).

### Red flags (audit these on sight)

- Any NEW `reserveStock(..., allow_negative_available: true)` call outside
  `OrderStockCommitService`'s two switch-gated paths.
- `validate_availability: false` or `blockOnInsufficient: false` on an
  order-facing path that is not the webhook handler
  (`webhook-handler.service.ts:751`) or the dispatch-note listener
  (`dispatch-note-events.listener.ts:642`) — both stay `false` BY DESIGN
  (money/goods are already out by the time they run, and the reservation is
  guaranteed upstream by steps 1-2) and both `logger.error` if the floor ever
  actually triggers, since that would mean an earlier guard failed.
- `allow_ingredient_overuse` read with `?? false` — see the table above.
- **QUI-557 said payment never blocks on stock. That rule is REVERSED** as of
  2026-09-26 — payment blocks like every other entry point unless the store
  owner explicitly turned `allow_negative_stock` on.

## Simple And Variant Modes

Simple/base stock uses `product_variant_id = null`. Variant stock uses a variant id.

Simple to variant:

- Use `transferBaseStockToVariants(product_id, variant_ids, user_id, mode, tx)`.
- Modes: `first`, `distribute`, `reset`.
- `enforceStockLevelsMode()` removes base stock rows after variants exist.
- Initialize missing variant/location rows with `initializeVariantStockAtLocations()`.

Variant to simple:

- Use `transferVariantStockToBase(product_id, variant_ids, user_id, tx)` before deleting variants.
- It aggregates variant stock by location, creates/updates base rows, zeros variant rows, and syncs.

### Trap: null `variant_id` on a product that has variants (QUI-486)

Calling `updateStock()` with `variant_id: undefined/null` for a product that
**has variants** does not throw. It silently receives stock into a dead row:

1. `getOrCreateStockLevel()` re-creates the base row that
   `enforceStockLevelsMode()` deleted on purpose.
2. `syncProductStock()` then filters `product_variant_id: { not: null }`
   whenever `variantCount > 0`, so those units never reach
   `products.stock_quantity`.
3. The stock is invisible in the catalog, unsellable, and gets destroyed by the
   next `enforceStockLevelsMode()` run.

Every caller that can pass a null `variant_id` must reject the case **before**
reaching the manager — the manager itself cannot tell an intentional base write
(during a variant→simple transition) from an accidental one. `PurchaseOrdersService`
does this with `PO_VARIANT_001`; see `vendix-product-variants`.

## Prisma Scope

`StockLevelManager` uses `StorePrismaService`. Some internals use `_baseClient || prisma` for nullable composite keys and cross-mode aggregation. Do not copy that bypass into request handlers; prefer scoped service access unless the stock manager already encapsulates it.

## Restaurant Suite Movement Types

The restaurant suite adds two `movement_type` values to `updateStock()`:

| `movement_type` | Sign of `quantity_change` | Emitted from | Meaning |
| --- | --- | --- | --- |
| `production` | `+` | `production-orders.service.ts` (`complete()`) | A finished sub-recipe lot is added to the `is_batch_produced` product's stock. |
| `consumption` | `−` | `kitchen-fire.service.ts` (`fireOrderItems`) and `production-orders.service.ts` | Leaf ingredients are consumed (fire-to-kitchen, or ingredients burned during a production order). |

Key fact: `calculateAndConsumeMovementCost` (the FIFO/CPP engine) branches by the **sign** of `params.quantity_change`, **not** by the `movement_type` enum value. A positive change resolves the receipt cost (`movement_unit_cost ?? unit_cost ?? cost_per_unit`); a negative change walks `inventory_cost_layers` (FIFO `received_at ASC`). So `production` (+) and `consumption` (−) flow through the **existing** costing machinery automatically — no new costing branch was added. The transaction-type mapper still maps both to `stock_in` for `inventory_transactions` audit-type compliance; the real cost direction is decided by the sign, not that label.

See `vendix-restaurant-ops` for the recipe explosion (`RecipesService.explodeBom`), the fire-to-kitchen seam, and the `inventory_consumed_at_fire` anti-double-discount guard.

## Known Risks

- Inventory adjustments may create more than one audit transaction because callers can add their own transaction after `updateStock()`.
- `stock_levels` has cascade FKs; destructive product/location deletes can remove stock state. Use migration/data cleanup safeguards.

## Related Skills

- `vendix-restaurant-ops`

- `vendix-prisma-scopes`
- `vendix-backend`
- `vendix-error-handling`
