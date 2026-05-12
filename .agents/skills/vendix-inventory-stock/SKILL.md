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

## Prisma Scope

`StockLevelManager` uses `StorePrismaService`. Some internals use `_baseClient || prisma` for nullable composite keys and cross-mode aggregation. Do not copy that bypass into request handlers; prefer scoped service access unless the stock manager already encapsulates it.

## Known Risks

- Inventory adjustments may create more than one audit transaction because callers can add their own transaction after `updateStock()`.
- `stock_levels` has cascade FKs; destructive product/location deletes can remove stock state. Use migration/data cleanup safeguards.

## Related Skills

- `vendix-prisma-scopes`
- `vendix-backend`
- `vendix-error-handling`
