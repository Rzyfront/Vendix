---
name: vendix-inventory-valuation
description: >
  Inventory valuation rules for Vendix: current and historical valuation, CPP/FIFO costs,
  COGS, inventory snapshots, and alignment with accounting entities.
  Trigger: When implementing or debugging inventory valuation, COGS, cost layers, stock cost snapshots, or inventory valuation reports.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
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

- Record valuation snapshots after stock mutations.
- Snapshot dimensions should include organization, store, accounting entity, location, product, variant, operating scope, costing method, quantities, unit cost, and total value.
- Historical reports must query the latest snapshot at or before `as_of` for each stock key.
- Data before snapshot rollout is best-effort only unless enough movement/cost history exists.

## Accounting Alignment

- Purchase receipt: DR `1435`, CR `2205` using received value.
- Sale COGS: DR `6135`, CR `1435` using consumed cost.
- Shrinkage: DR `5295`, CR `1435` using local consumed cost.
- Surplus: DR `1435`, CR `5295` using real input cost.
- Entries must resolve the correct accounting entity from operating scope.

## Restaurant Suite — Minimum Integer Stock Unit Rule (MVP)

- The inventory core stays `Int`: `stock_levels.quantity_*`, `inventory_cost_layers.quantity`, and movements were **NOT** migrated to `Decimal`.
- Each ingredient is modeled in its **minimum integer stock unit** (g, ml, unit) via `products.stock_unit` / `products.purchase_unit` / `products.purchase_to_stock_factor`. The factor converts purchase units → stock units at receipt time, so cost layers and valuation accumulate in the integer minimal unit.
- Recipes (`recipe_items`) reference quantities in the ingredient's **minimal integer unit**. `waste_percent` (merma) and `yield`/`rendimiento` factors are applied as decimals, and the resulting consumed/produced quantity is **rounded to integer** in the stock unit before hitting `StockLevelManager`.
- Residual risk: rounding error accumulates in recipes with many tiny components. Mitigation: model in milli-units (mg, µl) — still integer.
- Deferred alternative: a `Decimal(18,4)` migration of the inventory core. It is intentionally deferred and **must** follow the anti-destructive rules in `vendix-prisma-migrations` and global §6 of `CLAUDE.md`.

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
