---
name: vendix-product-variants
description: >
  Product and service variant rules for Vendix: variants as sellable options,
  inventory-independent availability, service variant booking overrides, and
  ecommerce/POS/cart behavior. Trigger: When creating, editing, validating, or
  selling product variants, service variants, products without stock, or any
  flow where variant availability must not be confused with inventory.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Creating or editing product variants"
    - "Creating or editing service variants"
    - "Working with products that have variants but do not track stock"
    - "Working with service variants, booking duration, buffer, preparation time, or product_variant_id on bookings"
    - "Validating variant availability in ecommerce, POS, cart, checkout, reservations, or catalog"
    - "Fixing bugs where variants are hidden or blocked because stock_quantity is zero"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Vendix Product Variants

## Purpose

Use this skill when working with variants for products or services. Variants in Vendix are sellable/configurable options, not inventory units. Inventory is an optional layer that applies only when effective tracking is enabled.

This skill governs business behavior and cross-flow expectations. Pricing details belong to `vendix-product-pricing`; physical stock mutations belong to `vendix-inventory-stock`; checkout flow details belong to `vendix-ecommerce-checkout`.

## Core Rules

- A variant is a sellable option for a product or service.
- Variants are allowed for physical products with stock, physical products without stock, services that require booking, and services that do not require booking.
- Do not hide, reject, or block a variant only because `stock_quantity` is `0`.
- Stock validation applies only when effective inventory tracking is enabled.
- Service availability is based on booking rules, duration, buffer, provider schedules, and selected variant overrides, not stock.
- Products with variants must require a selected `product_variant_id` in ecommerce, POS, cart, checkout, and booking flows.
- Historical commercial records must keep `product_variant_id`, SKU, attributes, price snapshots, and booking references when available.

## Canonical Availability Matrix

| Item type | Effective stock tracking | Variants allowed | Availability source |
| --- | --- | --- | --- |
| Physical product | `true` | Yes | `stock_levels` for base or selected variant |
| Physical product | `false` | Yes | Always sellable unless product/variant is inactive |
| Service with booking | `false` | Yes | Booking availability using duration, buffer, provider, and selected variant |
| Service without booking | `false` | Yes | Always sellable unless product/variant is inactive |

## Effective Tracking

Resolve inventory tracking at the product/variant pair:

```ts
const effectiveTracking =
  variant.track_inventory_override ?? product.track_inventory;

const requiresStockValidation =
  product.product_type === 'physical' && effectiveTracking === true;
```

Rules:

- If `requiresStockValidation` is false, do not check `stock_quantity` or `stock_levels` to decide if the variant can be sold.
- If `requiresStockValidation` is true, validate availability through `StockValidatorService` / `StockLevelManager`, not denormalized `stock_quantity` alone.
- Service variants should normally have `track_inventory_override = null` and inherit `product.track_inventory = false`.

## Service Variant Overrides

Service variants may override parent service values:

- `price_override`
- `cost_price`
- `profit_margin`
- `is_on_sale`
- `sale_price`
- `service_duration_minutes`
- `service_pricing_type`
- `buffer_minutes`
- `preparation_time_minutes`
- `attributes`
- `image_id`

Null service override fields mean inherit from the parent product.

Booking and availability flows must use the selected `product_variant_id` to resolve effective duration and buffer:

```ts
const duration =
  variant?.service_duration_minutes ??
  product.service_duration_minutes ??
  60;

const buffer =
  variant?.buffer_minutes ??
  product.buffer_minutes ??
  0;
```

## Ecommerce, POS, Cart, And Checkout

Catalog and POS product reads:

- Include variants for non-tracked products and services even when `stock_quantity` is `0`.
- Only mark a variant as out of stock when `requiresStockValidation` is true and stock is unavailable.
- For service variants, show booking-relevant labels such as duration or package name instead of stock messaging.

Cart and checkout:

- If a product has variants, require `product_variant_id`.
- Resolve prices through the shared pricing rules, with variant sale/override priority.
- Validate stock only when `requiresStockValidation` is true.
- Reserve stock only when `requiresStockValidation` is true.
- For booked services, attach the selected `product_variant_id` to booking and order item payloads.

## Admin UI Rules

Admin product forms must adapt the variant editor by product type and tracking mode:

| Situation | UI behavior |
| --- | --- |
| Physical product with stock | Show SKU, attributes, price, image, and stock controls per variant |
| Physical product without stock | Show SKU, attributes, price, and image; do not require stock |
| Service with booking | Show service option fields: duration, buffer, preparation time, pricing type, price, and image |
| Service without booking | Show service option fields that affect sale/fulfillment; do not show stock requirements |

Do not force variant stock totals to be greater than zero when product tracking is disabled.

## Validation Rules

- Variant SKU must be present and unique within the product.
- `price_override` must be null or greater than zero.
- If `is_on_sale` is true, `sale_price` must be greater than zero and lower than `price_override ?? product.base_price`.
- Service-specific variant fields are allowed only when the parent product is `product_type = service`.
- Do not accept DTO fields that are not persisted in `product_variants` unless the service explicitly strips them before Prisma writes.
- Blocking transitions from physical to service solely because variants exist is invalid when service variants are supported; validate whether the existing variant data can be interpreted as service options or require an explicit conversion flow.

## Existing Data Behavior

- Existing physical variants remain valid.
- Existing service products without variants remain valid and inherit product-level booking values.
- Existing service variants with null service override fields inherit parent product values.
- Existing variants with `stock_quantity = 0` must not be treated as unavailable unless effective tracking is enabled.

## Anti-Patterns

- Filtering variants with `where: { stock_quantity: { gt: 0 } }` without checking effective tracking.
- Using `product.track_inventory` alone when a variant has `track_inventory_override`.
- Creating a booking with `product_variant_id` but calculating duration, price, or order items from the product only.
- Treating service variants as physical stock variants in the admin UI.
- Adding `product_variants.base_price`; variants use `price_override`.

## Related Skills

- `vendix-product-pricing` - Variant price, cost, margin, sale price, and final price rules.
- `vendix-inventory-stock` - Stock source of truth, effective stock writes, reservations, and simple/variant stock transitions.
- `vendix-ecommerce-checkout` - Cart, checkout, bookings, and stock reservation flow.
- `vendix-frontend` - Angular web app structure.
- `vendix-zoneless-signals` - Angular signals and zoneless rules for frontend variant editors.
- `vendix-business-analysis` - Business discovery before planning economically relevant variant changes.
