---
name: vendix-product-pricing
description: >
  Product and variant pricing patterns: cost, margin, base price, variant price_override,
  sale price, tax-derived final_price, and frontend reactive calculations. Trigger: When
  editing product schemas, pricing logic, or advanced product forms.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "When editing product schemas, pricing logic, or advanced product forms"
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

## Calculations

- Base from margin: `base_price = cost_price * (1 + profit_margin / 100)`.
- Margin from base: `profit_margin = ((base_price - cost_price) / cost_price) * 100` when cost is positive.
- Sale price is valid only when `is_on_sale` and must be less than the regular/base price.
- Tax assignments are many-to-many through `product_tax_assignments` / tax categories.
- Backend read responses calculate `final_price`; this is not persisted for products.

## Frontend Rules

- Keep cost/margin/base calculations reactive without infinite loops (`emitEvent: false` where needed).
- Show tax-inclusive/final price as read-only calculated information.
- Use existing product validators for cross-field pricing constraints before adding new validators.
- Format money with `vendix-currency-formatting` patterns.

## Backend Rules

- Create/update DTOs accept persisted fields only; do not accept client-supplied `final_price`.
- Calculate `final_price` in read responses from sale/base price plus assigned tax rates.
- Preserve historical order/invoice totals separately; those are snapshots, unlike product display prices.

## Related Skills

- `vendix-calculated-pricing`
- `vendix-currency-formatting`
- `vendix-angular-forms`
- `vendix-prisma-schema`
