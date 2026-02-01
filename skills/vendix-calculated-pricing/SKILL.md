---
name: vendix-calculated-pricing
description: >
  Standardize how calculated prices (with taxes) are handled across the entire system.
  Trigger: When working with pricing that includes taxes/fees, creating UI components for pricing, or implementing price calculations.
license: MIT
metadata:
  author: vendix
  version: "1.0"
---

# Vendix Calculated Pricing Pattern

> **Standardize how calculated prices (with taxes) are handled across the entire system**

## Trigger

Use this skill when:
- Working with pricing that includes taxes/fees (products, services, orders, invoices)
- Creating UI components that display calculated prices
- Designing database schemas for pricing
- Implementing price calculations in backend services
- Creating DTOs or interfaces that include price fields

## Pattern Overview

**Core Principle:** **NEVER store calculated prices (base + tax) in the database.** Always calculate them on-the-fly using base prices and applicable rates.

### Why This Pattern?

1. **Single Source of Truth**: Base prices are the only persisted values
2. **Tax Rate Flexibility**: When tax rates change, all calculations update automatically
3. **No Data Inconsistency**: Eliminates risk of stored calculated values becoming outdated
4. **Audit Trail**: Changes in tax rates are traceable through the `tax_rates` table
5. **Multi-Tenant Support**: Different stores/domains can have different tax rules

## Database Schema Pattern

### DO Store (Persist):
```prisma
model products {
  id          Int      @id
  base_price  Decimal  @db.Decimal(12, 2)  // PVP before taxes
  cost_price  Decimal? @db.Decimal(12, 2)  // Cost price
  sale_price  Decimal? @db.Decimal(12, 2)  // Optional sale price

  // Relationship to taxes (MANY-TO-MANY)
  product_tax_assignments  product_tax_assignments[]
}

model product_tax_assignments {
  product_id       Int
  tax_category_id  Int
  products         products       @relation(fields: [product_id], references: [id])
  tax_categories   tax_categories @relation(fields: [tax_category_id], references: [id])

  @@id([product_id, tax_category_id])
}

model tax_rates {
  id              Int     @id
  rate            Decimal @db.Decimal(6, 5)  // e.g., 0.21 for 21%
  name            String  @db.VarChar(100)   // "IVA 21%", "VAT Standard"
  tax_category_id Int
}
```

### DO NOT Store:
❌ `final_price` - Calculated field
❌ `price_with_tax` - Calculated field
❌ `total_amount` - Calculated field (unless it's a snapshot like order)

**Exception:** Order/Invoice totals ARE stored because they represent a historical transaction snapshot that shouldn't change even if tax rates are modified later.

## Naming Convention

| Concept | Database Field | Description |
|---------|---------------|-------------|
| Base Price | `base_price` | Price WITHOUT taxes (PVP) - **STORED** |
| Cost Price | `cost_price` | Acquisition/manufacturing cost - **STORED** |
| Calculated Price | `priceWithTax` / `finalPrice` | Base + taxes - **CALCULATED** |
| Sale Price | `sale_price` | Optional promotional price - **STORED** |

## Frontend Pattern (Angular)

### 1. Create a Getter for Calculated Price

```typescript
// product.component.ts
get priceWithTax(): number {
  const basePrice = Number(this.productForm.get('base_price')?.value || 0);
  const selectedTaxIds = this.productForm.get('tax_category_ids')?.value || [];

  let totalTaxRate = 0;
  selectedTaxIds.forEach((id: number) => {
    const taxCat = this.allTaxCategories.find((tc) => tc.id === id);
    if (taxCat) {
      const rate = taxCat.rate ?? taxCat.tax_rates?.[0]?.rate ?? 0;
      totalTaxRate += Number(rate);
    }
  });

  return basePrice * (1 + totalTaxRate);
}
```

### 2. Display as Read-Only Field in Template

```html
<!-- Visual feedback that this is CALCULATED -->
<div class="space-y-1.5">
  <label class="block text-sm font-bold text-text-primary">
    Precio Final (PVP + Imp)
  </label>
  <div class="h-[42px] px-4 flex items-center bg-surface border-2 border-primary-500/20 rounded-lg text-xl font-black text-primary-600 shadow-sm">
    {{ priceWithTax | currency }}
  </div>
  <p class="text-[10px] text-text-secondary font-medium italic">
    Calculado automáticamente
  </p>
</div>
```

### 3. Visual Design Guidelines

**Calculated fields should be:**
- ✅ Read-only (no input field)
- ✅ Visually distinct (different background/border)
- ✅ Labeled clearly as "Calculated"
- ✅ Updated reactively when base values change

```scss
.calculated-price {
  background: var(--surface-bg);
  border: 2px solid var(--primary-border);
  color: var(--primary-color);
  font-weight: 900;  // Extra bold to emphasize it's a result
}
```

## Backend Pattern (NestJS)

### 1. DTO Pattern

```typescript
// create-product.dto.ts
export class CreateProductDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  base_price: number;  // ✅ ACCEPTED

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  cost_price?: number;  // ✅ ACCEPTED

  @IsArray()
  @IsOptional()
  tax_category_ids?: number[];  // ✅ ACCEPTED

  // ❌ NEVER include final_price or price_with_tax
}
```

### 2. Service Calculation Method

```typescript
// products.service.ts
calculatePriceWithTax(
  basePrice: number,
  taxCategoryIds: number[],
  allTaxRates: TaxRate[]
): number {
  let totalTaxRate = 0;

  taxCategoryIds.forEach(taxId => {
    const tax = allTaxRates.find(t => t.id === taxId);
    if (tax) {
      totalTaxRate += Number(tax.rate);
    }
  });

  return basePrice * (1 + totalTaxRate);
}
```

### 3. API Response Pattern

```typescript
// Response DTO should include both
export class ProductResponseDto {
  id: number;
  name: string;
  base_price: number;          // Stored value
  cost_price: number;
  tax_categories: {            // Tax breakdown
    id: number;
    name: string;
    rate: number;
  }[];
  price_with_tax?: number;     // ✅ OK in READ responses (calculated)
}
```

**Key:** `price_with_tax` is **only included in GET responses**, never in CREATE/UPDATE payloads.

## Composite Tax Rates

When multiple taxes apply (e.g., VAT + municipal tax):

```typescript
// Example: Base $100, VAT 21%, Municipal 2%
// Calculation: $100 × (1 + 0.21 + 0.02) = $123

get totalTaxRate(): number {
  return this.taxCategories.reduce((sum, tax) => sum + tax.rate, 0);
}

get priceWithTax(): number {
  return this.basePrice * (1 + this.totalTaxRate);
}

get taxAmount(): number {
  return this.basePrice * this.totalTaxRate;  // Just the tax portion
}
```

## Display Patterns

### Price Breakdown Display

```html
<div class="price-breakdown">
  <div class="row">
    <span>Base Price:</span>
    <span>{{ product.base_price | currency }}</span>
  </div>
  <div class="row" *ngFor="let tax of product.tax_categories">
    <span>{{ tax.name }}:</span>
    <span>{{ (product.base_price * tax.rate) | currency }}</span>
  </div>
  <div class="row total">
    <span>Total:</span>
    <span>{{ priceWithTax | currency }}</span>
  </div>
</div>
```

### Compact Display with Tooltip

```html
<span class="price-display" [tooltip]="taxBreakdown">
  {{ priceWithTax | currency }}
  <small class="text-muted">{{ base_price | currency }} + tax</small>
</span>
```

## Order/Invoice Exception (Snapshot Pattern)

**Orders ARE stored with calculated totals** because they represent historical transactions:

```prisma
model orders {
  subtotal_amount  Decimal  @db.Decimal(12, 2)  // Sum of base prices
  tax_amount       Decimal  @db.Decimal(12, 2)  // Calculated tax AT ORDER TIME
  grand_total      Decimal  @db.Decimal(12, 2)  // ✅ STORED - Final total
}
```

**Why?** If tax rates change next year, historical orders should remain unchanged.

## Testing Pattern

```typescript
describe('Price Calculation', () => {
  it('should calculate price with single tax', () => {
    const base = 100;
    const taxes = [{ rate: 0.21 }];  // 21%
    expect(calculatePriceWithTax(base, taxes)).toBe(121);
  });

  it('should calculate price with composite taxes', () => {
    const base = 100;
    const taxes = [
      { rate: 0.21 },  // VAT
      { rate: 0.02 }   // Municipal
    ];
    expect(calculatePriceWithTax(base, taxes)).toBe(123);
  });

  it('should handle zero taxes', () => {
    expect(calculatePriceWithTax(100, [])).toBe(100);
  });
});
```

## Currency Formatting

Always use a consistent pipe or formatter:

```typescript
// currency.pipe.ts
@Pipe({ name: 'currency' })
export class CurrencyPipe implements PipeTransform {
  transform(value: number): string {
    return `$${value.toFixed(2)}`;
  }
}
```

## Quick Checklist

When implementing pricing:

- [ ] Only `base_price` is stored in database
- [ ] Tax rates are in `tax_rates` table (not hardcoded)
- [ ] Frontend uses a getter for `priceWithTax`
- [ ] Template shows "Calculado automáticamente" label
- [ ] DTO accepts `base_price`, NOT `price_with_tax`
- [ ] API responses include calculated price for display
- [ ] Tests cover single and composite tax scenarios
- [ ] Currency formatting is consistent
- [ ] Exception: Order totals ARE stored (historical snapshot)

## Files Example Reference

- **Schema:** [`apps/backend/prisma/schema.prisma`](apps/backend/prisma/schema.prisma) - `products` model (line 653)
- **Frontend:** [`apps/frontend/src/app/private/modules/store/products/pages/product-create-page/product-create-page.component.ts`](apps/frontend/src/app/private/modules/store/products/pages/product-create-page/product-create-page.component.ts) - `priceWithTax` getter (line 217)
- **Template:** [`apps/frontend/src/app/private/modules/store/products/pages/product-create-page/product-create-page.component.html`](apps/frontend/src/app/private/modules/store/products/pages/product-create-page/product-create-page.component.html) - Display pattern (line 124)
