---
name: vendix-inventory-stock
description: >
  Inventory stock management patterns: StockLevelManager service, stock transitions (simple↔variant),
  multi-location stock levels, reservations, audit trail (transactions + movements), and denormalized sync.
  Trigger: When working with stock levels, inventory adjustments, variant stock transitions, stock reservations,
  inventory movements, or any operation that modifies product/variant quantities.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Working with stock levels, inventory adjustments, or stock transfers"
    - "Transitioning products between simple and variant modes"
    - "Reserving or releasing stock"
    - "Modifying StockLevelManager service"
    - "Working with inventory transactions or movements"
---

# Vendix Inventory Stock Management

> **Source of Truth:** `stock_levels` table. The `stock_quantity` on `products` and `product_variants` is a **denormalized aggregate** maintained by `syncProductStock()`.

## When to Use

- Modifying product or variant stock quantities
- Transitioning products between simple ↔ variant modes
- Creating inventory adjustments or stock transfers
- Reserving or releasing stock for orders/layaways
- Building features that read or write inventory data
- Understanding the audit trail (transactions + movements)

---

## Architecture Overview

```
StockLevelManager (core service)
├── updateStock()                    — Atomic stock update with full audit
├── reserveStock() / releaseReservation() — Stock reservation system
├── syncProductStock()               — Denormalized aggregate sync
├── clearBaseStock()                 — Simple→Variant: zero base stock
├── transferBaseStockToVariants()    — Simple→Variant: with distribution modes
├── transferVariantStockToBase()     — Variant→Simple: aggregate to base
├── initializeVariantStockAtLocations() — Create 0-quantity stock levels
├── initializeStockLevelsForProduct()    — Create stock levels at all org locations
├── getDefaultLocationForProduct()       — Auto-resolve best location
└── getStockLevels() / checkReorderPoints() — Read operations
```

**File:** `apps/backend/src/domains/store/inventory/shared/services/stock-level-manager.service.ts`

---

## Critical Patterns

### Pattern 1: Stock Levels Are Per-Location

Stock is tracked per `(product_id, product_variant_id, location_id)`. A single product can have stock in multiple locations.

```typescript
// stock_levels unique constraint
@@unique([product_id, product_variant_id, location_id])
```

- `product_variant_id = null` → base product stock (no variants)
- `product_variant_id = <id>` → variant-specific stock

### Pattern 2: Three Quantity Fields

| Field                | Meaning                                |
| -------------------- | -------------------------------------- |
| `quantity_on_hand`   | Total physical units in location       |
| `quantity_reserved`  | Units reserved for pending orders      |
| `quantity_available` | `quantity_on_hand - quantity_reserved` |

**The `quantity_available` is what's sellable.** Never sell from `quantity_on_hand` directly.

### Pattern 3: Denormalized Sync (`syncProductStock()`)

After ANY stock change, `syncProductStock()` must be called to update:

- `products.stock_quantity` → sum of all stock levels (variant or base depending on mode)
- `product_variants.stock_quantity` → sum of that variant's stock levels

```typescript
// If product has variants: only sum variant stock (exclude base)
// If no variants: sum all stock (legacy/base behavior)
```

### Pattern 4: Transaction + Movement = Full Audit Trail

Every stock change creates TWO audit records:

1. **`inventory_transactions`** — What changed (product, quantity, type, reason)
2. **`inventory_movements`** — Where it moved (from_location → to_location, org context)

```typescript
// Always create both for traceability
await this.transactionsService.createTransaction({ ... }, prisma);
await prisma.inventory_movements.create({ data: { ... } });
```

### Pattern 5: Scoped Prisma for Stock

`StockLevelManager` uses `StorePrismaService`. For internal operations that bypass scope (cross-variant aggregation, stock transfers), use:

```typescript
const basePrisma = prisma._baseClient || prisma;
// Use basePrisma for direct stock level access
```

---

## Simple ↔ Variant Transitions

### Simple → Variant (Toggle ON)

When a product transitions from simple to variant mode, base stock must be redistributed:

```typescript
// 3 modes available:
// 'first'      → All stock goes to the first variant
// 'distribute'  → Stock divided equally (remainder to first)
// 'reset'      → All stock zeroed with audit trail

await this.stockLevelManager.transferBaseStockToVariants(
  product_id,
  variant_ids, // IDs of newly created variants
  user_id,
  mode, // 'first' | 'distribute' | 'reset'
  tx, // Prisma transaction client
);
```

**Always followed by:**

```typescript
await this.stockLevelManager.initializeVariantStockAtLocations(
  product_id,
  variant_id,
  location_ids, // Inherited from previous base stock locations
  tx,
);
```

### Variant → Simple (Toggle OFF)

When variants are removed, their stock must transfer back:

```typescript
await this.stockLevelManager.transferVariantStockToBase(
  product_id,
  variant_ids, // ALL variant IDs being removed
  user_id,
  tx,
);
```

This:

1. Aggregates all variant stock by location
2. Creates/updates base stock levels with the totals
3. Zeros out variant stock levels
4. Creates audit records for both operations
5. Calls `syncProductStock()` at the end

---

## Stock Reservations

### Reserve Stock (Orders, Layaways)

```typescript
await this.stockLevelManager.reserveStock(
  product_id,
  variant_id, // undefined for base product
  location_id,
  quantity,
  "order", // reserved_for_type: 'order' | 'transfer' | 'adjustment' | 'layaway'
  order_id, // reserved_for_id
  user_id,
  true, // validate_availability
  tx, // optional transaction
  expires_at, // null = no expiry (layaway), undefined = 7 days default
);
```

This:

1. Creates `stock_reservations` record (status: 'active')
2. Increases `quantity_reserved`, decreases `quantity_available`
3. Calls `syncProductStock()`

### Release Reservation

```typescript
await this.stockLevelManager.releaseReservation(
  product_id,
  variant_id,
  location_id,
  "order",
  order_id,
  tx,
);
```

This marks reservations as 'consumed' and reverses the quantity changes.

---

## updateStock() — The Core Method

Every stock modification goes through `updateStock()`:

```typescript
await this.stockLevelManager.updateStock(
  {
    product_id,
    variant_id, // optional
    location_id,
    quantity_change, // positive = stock in, negative = stock out
    movement_type, // 'stock_in' | 'stock_out' | 'transfer' | 'adjustment' | 'sale' | 'return' | 'damage' | 'expiration' | 'initial'
    reason, // human-readable reason
    user_id,
    create_movement: true, // create inventory_movement record
    validate_availability: true, // throw if insufficient stock
  },
  tx,
);
```

**Returns:** `{ stock_level, transaction, previous_quantity }`

**Side effects:**

1. Updates `stock_levels` row
2. Creates `inventory_transactions` record
3. Creates `inventory_movements` record (if `create_movement: true`)
4. Calls `syncProductStock()` (denormalized sync)
5. Emits `stock.updated` event
6. Emits `stock.low` event if below reorder point

---

## getOrCreateStockLevel Pattern

Stock levels may not exist yet for a product+variant+location combo. Always use `getOrCreateStockLevel()`:

```typescript
const stock_level = await this.getOrCreateStockLevel(
  prisma,
  product_id,
  variant_id, // undefined for base product
  location_id,
);
// Returns existing or creates with all quantities at 0
```

---

## Decision Tree

```
Need to change stock?
├── Single location, simple change
│   └── updateStock() with movement_type and reason
├── Multiple locations
│   └── Call updateStock() for each location
├── Reserving for an order
│   └── reserveStock() → later releaseReservation() or consumeReservation()
├── Product transitioning to variants
│   └── transferBaseStockToVariants() + initializeVariantStockAtLocations()
├── Variants being removed
│   └── transferVariantStockToBase() before deleting variants
└── Just reading stock
    └── getStockLevels() or checkReorderPoints()
```

---

## Commands

```bash
# Check backend logs for stock-related errors
docker logs --tail 40 vendix_backend

# Run Prisma Studio to inspect stock_levels
npm run prisma studio -w apps/backend
```

---

## Key Files

| File                                | Purpose                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `stock-level-manager.service.ts`    | Core stock operations (updateStock, transfers, sync, reservations) |
| `inventory-transactions.service.ts` | Audit transaction creation                                         |
| `inventory_locations.service.ts`    | Location management and default location resolution                |
| `products.service.ts`               | Variant sync integration (calls StockLevelManager)                 |
| `product-variant.service.ts`        | Variant CRUD with stock initialization                             |
| `stock_reservations` table          | Pending stock locks for orders/transfers/layaways                  |
| `stock_levels` table                | Source of truth for all quantities                                 |
| `inventory_transactions` table      | Audit trail (what changed)                                         |
| `inventory_movements` table         | Audit trail (where it moved)                                       |

## Related Skills

- `vendix-prisma-scopes` — How scoped Prisma works for stock queries
- `vendix-backend` — General NestJS patterns
- `vendix-error-handling` — Error codes for inventory (INV\_\*)
