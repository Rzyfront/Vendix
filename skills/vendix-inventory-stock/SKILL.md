---
name: vendix-inventory-stock
description: >
  Inventory stock: StockLevelManager, stock_levels as source of truth, reservations, variant/base transitions, audit, stock sync. Trigger: stock levels, adjustments, transfers, reservations, INV_STOCK_* errors, quantity changes.
license: MIT
metadata:
  author: rzyfront
  version: "2.2"
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

### Order lifecycle and no-overselling (summary)

Detail (who releases, validator contract, partial release, switches, red flags): `references/order-lifecycle-no-overselling.md` (read before touching order/stock paths).

- Order reservations are released only by `OrderFlowService` transitions: cancel → `releaseReservationsByReference(...,'cancelled')`; item delivered → `OrderStockCommitService.commitOrderLines` (primary consumption point); order delivered/finished → `commitOrderDelivery` (atomic `inventory_committed` claim, never double); `order.shipped` event → `OrderAutoFulfillmentListener` (ORG scope, central warehouse only).
- Never write `orders.state` outside `OrderFlowService`; bypass buttons use `forceOrderState()` (skips preconditions only, still runs release/consume).
- Nothing oversells by default, including payment (QUI-557 "payment never blocks" is REVERSED). Validate (`StockValidatorService.assertLinesAvailable`, crediting the order's own reservation) → reserve (`allow_negative_available: false`) → consume on delivery inside the same tx (`INV_STOCK_002` rolls back the stamp) → reverse (`releaseReservationQuantity` per line; delivered cancel restocks by `stock_units_consumed`).
- Errors: `INV_STOCK_INSUFFICIENT_LINES` (409, `details.items[]` with `kind: 'product'|'ingredient'`, `used_by?`) before mutation; `INV_STOCK_002` (409, single item) at commit. Frontend: `core/utils/parse-api-error.ts` + `stock-shortage.util.ts`.
- Per-store switches via `resolveInventoryPolicy` (read `store_settings.settings.inventory` directly, not the deep-merge): `allow_negative_stock` default `false`; `allow_ingredient_overuse` default `true` (`?? true`, never `?? false`). ON paths warn and return additive `stock_warnings`.
- `updateStock({allow_negative})` only for those two switch-gated paths; `validate_availability: false` on order paths only in the webhook handler and dispatch-note listener (by design).

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

## Restaurant Movement Types

`production` (+) and `consumption` (−) flow through the existing FIFO/CPP engine, which branches on the SIGN of `quantity_change`, not on `movement_type`. Detail: `references/restaurant-movements.md`; recipes and fire: `vendix-restaurant-ops`.

## Known Risks

- Inventory adjustments may create more than one audit transaction because callers can add their own transaction after `updateStock()`.
- `stock_levels` has cascade FKs; destructive product/location deletes can remove stock state. Use migration/data cleanup safeguards.

## Related Skills

- `vendix-restaurant-ops`
- `vendix-product-variants`
- `vendix-prisma-scopes`
- `vendix-backend`
- `vendix-error-handling`
