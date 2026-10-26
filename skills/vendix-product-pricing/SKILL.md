---
name: vendix-product-pricing
description: >
  Product/variant pricing: cost, margin, base price, price_override, sale price, tax-derived
  final_price calculated on read, snapshot totals. Trigger: editing product schemas, pricing
  logic, tax/fee price calculations or price displays, product forms.
license: MIT
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "When editing product schemas, pricing logic, or advanced product forms"
    - "When working with pricing that includes taxes/fees, creating UI components for pricing, or implementing price calculations"
---

# Vendix Product Pricing

## Source of Truth

- Schema: `apps/backend/prisma/schema.prisma`.
- Backend product service: `apps/backend/src/domains/store/products/products.service.ts`.
- Frontend product forms/pages under `apps/frontend/src/app/private/modules/store/products/`.

## Stored Fields

Products:

- `base_price`: listing price before taxes.
- `cost_price`: acquisition/manufacturing cost.
- `profit_margin`: target margin percentage.
- `is_on_sale`: sale flag.
- `sale_price`: promotional price.

Product variants:

- `price_override`: variant-specific listing price override.
- `cost_price`: variant cost.
- `profit_margin`: variant margin.
- `is_on_sale`: variant sale flag.
- `sale_price`: variant promotional price.

Do not document or add `product_variants.base_price`; variants use `price_override`.

Tax links persist in `product_tax_assignments` (many-to-many through tax categories).

## Calculations

- Base from margin: `base_price = cost_price * (1 + profit_margin / 100)`.
- Margin from base: `profit_margin = ((base_price - cost_price) / cost_price) * 100` when cost is positive.
- Sale price is valid only when `is_on_sale` and must be less than the regular/base price.

## Calculated Pricing (taxes/fees)

**Core rule:** do not persist calculated display prices for products. Persist base/sale inputs and tax assignments; calculate the final display price on read.

- Formula: `final_price = effectiveBase * (1 + sum(taxRates))`.
- Effective base uses `sale_price` when `is_on_sale` is true and the sale price is valid; otherwise base (or variant `price_override`).
- Current product API uses `final_price` for calculated tax-inclusive responses. Do not standardize new code on `price_with_tax` unless the existing endpoint/interface already uses that name.

### Snapshot Exception

Orders, invoices, payments, refunds, and accounting documents can store totals because they are historical transaction snapshots. Those amounts must not change if product prices or tax rates change later. For historical timestamp semantics see `vendix-date-timezone`.

## Frontend Rules

- Keep cost/margin/base calculations reactive without infinite loops (`emitEvent: false` where needed).
- Show tax-inclusive/final price as read-only calculated information; label it as calculated/final when user input could be confused with a persisted price.
- Use existing product validators for cross-field pricing constraints before adding new validators.
- Format money with the custom Vendix currency pipe/service (`vendix-currency-formatting`).

## Backend / DTO / API Rules

- Create/update DTOs accept persisted fields only; never accept client-supplied `final_price` or equivalent calculated fields.
- Read responses calculate `final_price` from sale/base price plus assigned tax rates.
- If an API returns both stored and calculated values, name them clearly.
- Preserve historical order/invoice totals separately; those are snapshots, unlike product display prices.

## Related Skills

- `vendix-currency-formatting`
- `vendix-angular-forms`
- `vendix-prisma`
- `vendix-date-timezone`
