---
name: vendix-calculated-pricing
description: >
  Standardize calculated prices with taxes/fees: persist base/snapshot values only,
  calculate product final_price on reads, and keep tax-inclusive values out of create/update
  payloads. Trigger: When working with pricing that includes taxes/fees, UI price displays,
  or backend price calculations.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "When working with pricing that includes taxes/fees, creating UI components for pricing, or implementing price calculations"
---

# Vendix Calculated Pricing

## Core Rule

Do not persist calculated display prices for products. Persist base/sale inputs and tax assignments; calculate final display price on read.

Current product API uses `final_price` for calculated tax-inclusive responses. Do not standardize new code on `price_with_tax` unless the existing endpoint/interface already uses that name.

## Product Pattern

- Persist: `base_price`, `cost_price`, `profit_margin`, `is_on_sale`, `sale_price`.
- Persist variant override: `product_variants.price_override`.
- Persist tax links: `product_tax_assignments`.
- Calculate: `final_price = effectiveBase * (1 + sum(taxRates))`.
- Effective base uses `sale_price` when `is_on_sale` is true and sale price is valid.

## Snapshot Exception

Orders, invoices, payments, refunds, and accounting documents can store totals because they are historical transaction snapshots. Those amounts must not change if product prices or tax rates change later.

## Frontend Display

- Calculated prices are read-only UI values.
- Label them as calculated/final values when user input could be confused with persisted price.
- Use the custom Vendix currency pipe/service for display.

## DTO/API Rules

- Create/update DTOs should not accept `final_price` or equivalent calculated fields.
- Read responses may include `final_price` for convenience.
- If an API returns both stored and calculated values, name them clearly.

## Related Skills

- `vendix-product-pricing`
- `vendix-currency-formatting`
- `vendix-date-timezone` for historical timestamp semantics
