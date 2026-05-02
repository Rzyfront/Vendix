---
name: vendix-currency-formatting
description: >
  Currency formatting patterns: custom Vendix CurrencyPipe, CurrencyFormatService,
  money inputs with [currency], format_style enum, Decimal string handling, and avoiding
  hardcoded money formatting. Trigger: When displaying or inputting money/currency values.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "Displaying or formatting money/currency values"
    - "Adding money inputs to forms"
    - "Fixing currency display issues or hardcoded $ symbols"
    - "Working with CurrencyPipe or CurrencyFormatService"
---

# Vendix Currency Formatting

## Source of Truth

- `apps/frontend/src/app/shared/pipes/currency/currency.pipe.ts`
- `apps/frontend/src/app/shared/components/input/input.component.ts`
- `apps/frontend/src/app/shared/directives/currency-input.directive.ts`
- Backend `currencies` model and `currency_format_style_enum`.

## Rules

- Prefer the custom Vendix `CurrencyPipe` / `CurrencyFormatService` for money display.
- Be explicit in imports: Angular also has `CurrencyPipe` from `@angular/common`; do not confuse it with the custom pipe named `currency`.
- Convert Prisma Decimal strings with `Number(value) || 0` when doing calculations; the service accepts strings but the custom pipe transform currently expects numbers/null/undefined.
- Avoid hardcoded `$` for display. Prefix slots may show a symbol in inputs only when consistent with currency config or existing component behavior.
- Do not use Angular `number` pipe for money.

## Format Styles

Configured currencies support:

- `comma_dot`: `1,234.56`
- `dot_comma`: `1.234,56`
- `space_comma`: `1 234,56`

Currency config includes symbol position and decimal places.

## Service Behavior

`CurrencyFormatService` loads currency from tenant domain config first, then falls back to store settings and active public currencies. It exposes signal/computed state used by the impure custom pipe.

Useful methods:

- `format(amount, decimals?)`
- `formatCompact(amount)`
- `formatChartAxis(value)`

## Inputs

Use shared input currency mode:

```html
<app-input [currency]="true" formControlName="base_price"></app-input>
```

`[currency]` uses text input mode, live separators, raw numeric CVA value, `currencyDecimals`, and optional negative support.

## Related Skills

- `vendix-product-pricing`
- `vendix-calculated-pricing`
- `vendix-angular-forms`
