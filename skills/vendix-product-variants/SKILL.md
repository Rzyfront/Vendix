---
name: vendix-product-variants
description: >
  Product and service variant rules: variants as sellable options independent of inventory, service booking overrides, POS/ecommerce/cart behavior. Trigger: creating/editing/selling variants, variants blocked by stock_quantity zero.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
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
- Stock validation applies only when effective inventory tracking is enabled (see Effective Tracking).
- Service availability is based on booking rules, duration, buffer, provider schedules, and selected variant overrides, not stock.
- Products with variants must require a selected `product_variant_id` in ecommerce, POS, cart, checkout, booking, **and purchase (POP) / reception** flows.
- Historical commercial records must keep `product_variant_id`, SKU, attributes, price snapshots, and booking references when available.

## Base Line Is Not Purchasable On A Variant Product (QUI-486)

A purchase line on the base (`product_variant_id = NULL`) of a product with variants receives stock into a row no aggregate reads (mechanism: `vendix-inventory-stock`, "Trap: null `variant_id`"). The money is spent and the goods are invisible.

Rules:

- Reject the base line **at purchase-order creation** (`PurchaseOrdersService.create`)
  with `PO_VARIANT_001`, so the unusable order never exists.
- Keep a second guard in `receive()` for legacy orders created before the first
  guard existed; its message must name the escape hatch (`PATCH /store/purchase-orders/:id/cancel`).
- Never "fix" this by making the base row readable again — the exclusion in
  `syncProductStock` is deliberate: counting base **and** variant rows together
  double-counts the same physical stock.
- Never auto-assign a default variant: the buyer's intent is unknowable and a
  wrong pick silently corrupts that variant's weighted-average cost.
- In the POP product-config modal the "Gestionar variantes" toggle is
  **immutable** when the product already has variants: the operator chooses
  *which* variants, never *whether* to use variants.


## Canonical Availability Matrix

| Item type | Effective stock tracking | Variants allowed | Availability source |
| --- | --- | --- | --- |
| Physical product | `true` | Yes | `stock_levels` for base or selected variant |
| Physical product | `false` | Yes | Always sellable unless product/variant is inactive |
| Service with booking | `false` | Yes | Booking availability using duration, buffer, provider, and selected variant |
| Service without booking | `false` | Yes | Always sellable unless product/variant is inactive |

## Effective Tracking

`StockValidatorService.resolveEffectiveTracking(product, variant)` = `variant.track_inventory_override ?? product.track_inventory`. Stock validation applies when effective tracking is true and `product_type !== 'service'` (physical and `prepared` both qualify).

- Not tracked → never check `stock_quantity`/`stock_levels` to decide if the variant sells.
- Tracked → validate through `StockValidatorService` / `StockLevelManager`, not denormalized `stock_quantity`.
- Service variants normally keep `track_inventory_override = null` and inherit `product.track_inventory = false`.

## Service Variant Overrides (summary)

Service variants may override price/cost/margin/sale, `service_duration_minutes`, `service_pricing_type`, `buffer_minutes`, `preparation_time_minutes`, `attributes`, `image_id`; null = inherit. Booking uses the selected variant: duration `variant ?? product ?? 60`, buffer `variant ?? product ?? 0`. Field list, admin UI matrix by type/tracking and existing-data behavior: `references/service-overrides-admin-ui.md`.

## Ecommerce, POS, Cart, And Checkout

Catalog and POS product reads:

- Include variants for non-tracked products and services even when `stock_quantity` is `0`.
- Only mark a variant as out of stock when stock validation applies and stock is unavailable.
- For service variants, show booking-relevant labels such as duration or package name instead of stock messaging.

Cart and checkout:

- If a product has variants, require `product_variant_id`.
- Resolve prices through the shared pricing rules, with variant sale/override priority.
- Validate and reserve stock only when stock validation applies.
- For booked services, attach the selected `product_variant_id` to booking and order item payloads.

## Validation Rules

- Variant SKU must be present and unique within the product.
- `price_override` must be null or greater than zero.
- If `is_on_sale` is true, `sale_price` must be greater than zero and lower than `price_override ?? product.base_price`.
- Service-specific variant fields are allowed only when the parent product is `product_type = service`.
- Do not accept DTO fields that are not persisted in `product_variants` unless the service explicitly strips them before Prisma writes.
- Blocking transitions from physical to service solely because variants exist is invalid when service variants are supported; validate whether the existing variant data can be interpreted as service options or require an explicit conversion flow.

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
