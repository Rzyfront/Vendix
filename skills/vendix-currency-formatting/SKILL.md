---
name: vendix-currency-formatting
description: >
  Currency formatting patterns: CurrencyPipe, CurrencyFormatService, [currency] input mode, format_style enum, and anti-patterns.
  Trigger: When displaying or inputting money/currency values, formatting prices, working with CurrencyPipe or CurrencyFormatService.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Displaying or formatting money/currency values"
    - "Adding money inputs to forms"
    - "Working with CurrencyPipe or CurrencyFormatService"
    - "Fixing currency display issues or hardcoded $ symbols"
---

## When to Use

- Displaying money values in templates (tables, cards, detail pages, stats)
- Adding money/price inputs to forms
- Formatting currency in TypeScript code (transforms, chart formatters)
- Fixing currency display that shows raw numbers without separators
- Working with Prisma `Decimal` fields that arrive as strings

## Critical Rules

1. **NEVER** hardcode `$` symbol — use `CurrencyPipe` or `CurrencyFormatService`
2. **NEVER** use `toLocaleString('es-CO')` or `Intl.NumberFormat` with hardcoded locale
3. **NEVER** use Angular's `| number` pipe for money — use `| currency` (custom pipe)
4. **ALWAYS** use `Number(value) || 0` before formatting — Prisma Decimals arrive as strings

## Format Style System

Each currency has a `format_style` field (configured in Super Admin → Currencies):

| Enum | Example | Locale | Separators |
|------|---------|--------|------------|
| `comma_dot` | `1,234.56` | en-US | `,` miles, `.` decimal |
| `dot_comma` | `1.234,56` | de-DE | `.` miles, `,` decimal |
| `space_comma` | `1 234,56` | fr-FR | ` ` miles, `,` decimal |

## How to Format Money

### In Templates (HTML)

```html
<!-- Standard format (uses store currency config) -->
{{ product.base_price | currency }}

<!-- Force specific decimals -->
{{ total | currency:0 }}    <!-- no decimals -->
{{ total | currency:2 }}    <!-- 2 decimals -->
```

**Requires** `CurrencyPipe` in component imports:
```typescript
import { CurrencyPipe } from 'path/to/shared/pipes/currency/currency.pipe';

@Component({
  imports: [CurrencyPipe, ...],
})
```

### In TypeScript (transforms, formatters)

```typescript
import { CurrencyFormatService } from 'path/to/shared/pipes/currency/currency.pipe';

// Inject
private currencyService = inject(CurrencyFormatService);

// Table column transform
{
  key: 'base_price',
  label: 'Precio',
  transform: (val: any) => this.currencyService.format(Number(val) || 0),
}

// Stats card value
this.currencyService.formatCompact(totalRevenue)  // → "$1.2M" or "1,2M$"

// Chart axis
this.currencyService.formatChartAxis(value)  // → "$100K" or "100K$"
```

### In Form Inputs

```html
<!-- Money input with real-time formatting -->
<app-input
  [currency]="true"
  formControlName="base_price"
  [prefixIcon]="true"
>
  <span slot="prefix-icon">$</span>
</app-input>

<!-- Override decimal places -->
<app-input
  [currency]="true"
  [currencyDecimals]="0"
  formControlName="total"
></app-input>

<!-- Conditional: money or percentage -->
<app-input
  [currency]="discountType !== 'PERCENTAGE'"
  [type]="discountType === 'PERCENTAGE' ? 'number' : 'text'"
  formControlName="discount_value"
></app-input>
```

**Key behaviors of `[currency]="true"`:**
- Overrides `type` to `text` with `inputmode="decimal"`
- Adds thousand separators in real-time as user types
- Keeps raw numeric value in the FormControl
- On blur: rounds to configured decimal places
- Respects `format_style` from currency config

## CurrencyFormatService API

| Method | Input | Output | Use case |
|--------|-------|--------|----------|
| `format(amount, decimals?)` | `number\|string\|null` | `"$1,234.56"` | Tables, detail views, general display |
| `formatCompact(amount)` | `number\|string\|null` | `"$1.2M"` | Stats cards, compact displays |
| `formatChartAxis(value)` | `number\|string\|null` | `"$100K"` | Chart axis labels |

All methods accept `string | number | null | undefined` and convert internally with `Number(amount) || 0`.

## Prisma Decimal Gotcha

Prisma `Decimal` fields (like `base_price Decimal @db.Decimal(10,2)`) are serialized as **strings** in JSON responses:

```typescript
// API response: { base_price: "108000" }  ← STRING, not number!

// WRONG: string.toLocaleString() returns the string unchanged
"108000".toLocaleString('en-US')  // → "108000" (no formatting!)

// CORRECT: convert to number first
Number("108000").toLocaleString('en-US')  // → "108,000"

// BEST: CurrencyFormatService handles this internally
this.currencyService.format("108000")  // → "$108,000.00" ✓
```

## Anti-patterns

```typescript
// ❌ WRONG: Hardcoded $ symbol
`$${Number(val).toLocaleString()}`

// ❌ WRONG: Hardcoded locale
`$${Number(val).toLocaleString('es-CO')}`
new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(val)

// ❌ WRONG: Angular number pipe for money
{{ price | number:'1.2-2' }}

// ❌ WRONG: toFixed without formatting
`$${val.toFixed(2)}`

// ❌ WRONG: type="number" for money inputs
<app-input type="number" formControlName="price">

// ✅ CORRECT: CurrencyFormatService
this.currencyService.format(Number(val) || 0)

// ✅ CORRECT: CurrencyPipe
{{ price | currency }}

// ✅ CORRECT: Currency input mode
<app-input [currency]="true" formControlName="price">
```

## Key Files

| File | Purpose |
|------|---------|
| `apps/frontend/src/app/shared/pipes/currency/currency.pipe.ts` | CurrencyFormatService + CurrencyPipe |
| `apps/frontend/src/app/shared/pipes/currency/index.ts` | Barrel export |
| `apps/frontend/src/app/shared/components/input/input.component.ts` | `[currency]` input mode |
| `apps/frontend/src/app/shared/directives/currency-input.directive.ts` | Standalone directive (for native inputs) |
| `apps/backend/prisma/schema.prisma` | `currencies` model + `currency_format_style_enum` |
