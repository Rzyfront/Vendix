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
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "Working with stock levels, inventory adjustments, or stock transfers"
    - "Transitioning products between simple and variant modes"
    - "Reserving or releasing stock"
    - "Modifying StockLevelManager service"
    - "Working with inventory transactions or movements"
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
| `→ finished` | `updateOrderState()` → `OrderStockCommitService` | consumes: reduces on-hand |
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
