---
name: vendix-inventory-valuation
description: >
  Inventory valuation: current/historical valuation, CPP/FIFO costs, COGS, cost layers, snapshots, accounting alignment. Trigger: inventory valuation, COGS, inventory_cost_layers, valuation snapshots or reports.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Working with inventory valuation"
    - "Implementing historical inventory valuation"
    - "Changing COGS, CPP, FIFO, inventory_cost_layers, or inventory valuation snapshots"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Vendix Inventory Valuation

## Purpose

Use this skill for inventory value, historical inventory value, COGS, cost layers, and valuation reports.

## Core Rules

- Quantity source of truth is `stock_levels`.
- Current valuation must use actual stock cost, not `products.cost_price` as the primary source.
- Historical valuation must use valuation snapshots or movement cost snapshots; `stock_levels` alone is only current state.
- COGS must be calculated from the stock/location actually consumed.
- CPP and FIFO must affect stock exits, COGS, adjustments, transfers, and valuation.

## Costing Rules

- CPP/weighted average uses `stock_levels.cost_per_unit`.
- FIFO uses `inventory_cost_layers` ordered by `received_at ASC`.
- Purchase receipts create/update cost and cost layers.
- Negative stock movements consume cost before/while mutating stock.
- Positive adjustments need an explicit or fallback real cost; never use placeholders.

## Snapshot Rules

- Record valuation snapshots (`inventory_valuation_snapshots`) after stock mutations.
- Snapshot dimensions should include organization, store, accounting entity, location, product, variant, operating scope, costing method, quantities, unit cost, and total value.
- Historical reports must query the latest snapshot at or before `as_of` for each stock key.
- Data before snapshot rollout is best-effort only unless enough movement/cost history exists.

## Accounting Alignment

- Purchase receipt: DR `1435`, CR `2205` using received value.
- Sale COGS: DR `6135`, CR `1435` using consumed cost.
- Shrinkage: DR `5295`, CR `1435` using local consumed cost.
- Surplus: DR `1435`, CR `5295` using real input cost.
- Entries must resolve the correct accounting entity from operating scope.

## Restaurant Suite

- Inventory quantities stay `Int` (no `Decimal` migration in the MVP); ingredients use their minimum integer stock unit and `purchase_to_stock_factor` converts at receipt, so cost layers accumulate in that unit. Full rule: `vendix-restaurant-ops` (`references/domain-recipes-menus.md`).

### COGS recognition for prepared products

- COGS for a `prepared` product is recognized at **fire-to-kitchen**, not at payment: DR `6135` / CR `1435` via `AutoEntryService.onKitchenFired` (mapping keys `kitchen.fired.cogs` / `kitchen.fired.inventory`).
- The consumed cost is `Σ(FIFO costs consumed)` computed when the leaf ingredients exit through `StockLevelManager.updateStock` with `movement_type='consumption'` (negative sign → FIFO over `inventory_cost_layers`). Payment must not re-recognize this cost (see the `inventory_consumed_at_fire` guard in `vendix-restaurant-ops`).
- Sub-recipe production (`production_orders`) is an intra-inventory value transfer DR `1435` / CR `1435`; the produced lot's `unit_cost = Σ(FIFO costs consumed) / produced_qty`.

## Related Skills

- `vendix-inventory-stock`
- `vendix-restaurant-ops`
- `vendix-accounting-rules`
- `vendix-auto-entries`
- `vendix-operating-scope`
- `vendix-prisma-migrations`
