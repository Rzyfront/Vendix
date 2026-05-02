---
name: vendix-ecommerce-checkout
description: >
  Checkout flow for STORE_ECOMMERCE: cart, shipping, payment methods, Wompi,
  WhatsApp checkout, bookings, and stock reservations. Trigger: When implementing
  or debugging ecommerce checkout, cart checkout, shipping/payment selection, or Wompi checkout.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke: "Implementing ecommerce checkout"
---

## When to Use

- Editing backend checkout/cart APIs under `apps/backend/src/domains/ecommerce/`.
- Editing frontend checkout/cart pages under `apps/frontend/src/app/private/modules/ecommerce/`.
- Working with ecommerce payment method filtering, Wompi widget checkout, WhatsApp checkout, shipping estimates, bookings, or cart sync.

## Backend API

Checkout controller routes:

- `GET /ecommerce/checkout/payment-methods?shipping_type=...` with `JwtAuthGuard`.
- `POST /ecommerce/checkout` with `JwtAuthGuard`.
- `POST /ecommerce/checkout/prepare-wompi` with `JwtAuthGuard`.
- `POST /ecommerce/checkout/confirm-wompi-payment/:orderId` with `JwtAuthGuard`.
- `POST /ecommerce/checkout/whatsapp` with `@OptionalAuth()`.

Cart routes are authenticated: `GET /ecommerce/cart`, `POST /ecommerce/cart/items`, `PUT /ecommerce/cart/items/:id`, `DELETE /ecommerce/cart/items/:id`, `DELETE /ecommerce/cart`, and `POST /ecommerce/cart/sync`.

## DTO Shape

`CheckoutDto` supports:

- `payment_method_id` required.
- `shipping_method_id`, `shipping_rate_id`, `shipping_address_id`, or inline `shipping_address`.
- `notes`.
- `items` fallback for cart-less checkout payloads.
- `bookings` for bookable service products.

`WhatsappCheckoutDto` supports `notes`, `items`, `shipping_method_id`, and `shipping_rate_id`.

## Normal Checkout Flow

The backend reads the authenticated user's ecommerce cart through `EcommercePrismaService`. If the backend cart is empty and DTO `items` exist, it uses those DTO items as fallback.

Current flow:

1. Validate non-empty items.
2. Resolve store currency.
3. Validate enabled store payment method.
4. Validate variants; products with variants require `product_variant_id`.
5. Validate stock through `StockValidatorService`.
6. Detect physical items; service/no-shipping products can skip address/shipping.
7. Create or load shipping address when required.
8. Validate shipping rate or method through store-scoped queries.
9. Resolve item prices with `PriceResolverService` and taxes with `TaxesService`.
10. Create order with `channel: 'ecommerce'` and `state: 'pending_payment'`.
11. Emit `order.created`.
12. Create pending payment row.
13. Reserve stock through `StockLevelManager.reserveStock()`; checkout does not directly decrement stock.
14. Create booking reservations when `bookings` are present; failures are logged and do not fail checkout.
15. Clear backend cart.
16. Return `order_id`, `order_number`, `total`, `state`, and `message`.

## Payment Method Filtering

`GET /ecommerce/checkout/payment-methods` filters enabled store payment methods by `system_payment_method.processing_mode` and shipping type:

- `pickup`: `DIRECT`, `ONLINE`.
- Delivery/other shipping types: `ONLINE`, `ON_DELIVERY`.
- No shipping type: all supported modes.

Frontend reloads payment methods after shipping selection because shipping method type changes eligible payment methods.

## Wompi Flow

Frontend normal checkout creates the order first, then prepares/opens Wompi.

Backend endpoints:

- `prepare-wompi` builds widget config, reuses existing `payments.gateway_reference` when present, and validates redirect host against domain settings.
- `confirm-wompi-payment/:orderId` polls Wompi by `transaction_id` or `gateway_reference`, then applies the result through `WebhookHandlerService.applyWompiTransaction`.

Frontend detects Wompi when selected method has `type === 'wompi'` or `provider === 'wompi'`, opens the Wompi widget via shared `WompiService`, and confirms approved/declined/error callbacks as a UX fallback.

## WhatsApp Checkout

WhatsApp checkout is separate from normal checkout.

- Route: `POST /ecommerce/checkout/whatsapp`.
- Auth is optional.
- Authenticated users can use backend cart or DTO items.
- Guests must send DTO `items` from localStorage cart.
- Creates order with `channel: 'whatsapp'` and `state: 'created'`.
- Does not create a payment row.
- Backend clears cart only for authenticated backend carts; frontend clears guest localStorage after success.

## Frontend Flow

Frontend files:

- `apps/frontend/src/app/private/modules/ecommerce/pages/checkout/checkout.component.ts`
- `apps/frontend/src/app/private/modules/ecommerce/services/checkout.service.ts`
- `apps/frontend/src/app/private/modules/ecommerce/services/cart.service.ts`
- `apps/frontend/src/app/private/modules/ecommerce/pages/cart/cart.component.ts`

The normal `/checkout` route is protected by `AuthGuard`. Guest purchase is handled through WhatsApp checkout unless store config requires registration.

The checkout component uses signals/computed for core state and `takeUntilDestroyed`. Some shipping fields are still plain mutable fields in current code; avoid copying that pattern into new code.

Step selection is dynamic:

- Service-only carts can skip address/shipping.
- Physical carts require address and shipping/payment.
- Bookable service products add a booking step.

Shipping estimates are calculated by `CartService.getShippingEstimates()` through `POST /shipping/calculate?store_id=...`, not a checkout-owned endpoint.

## Cart Behavior

- Authenticated cart uses backend `/ecommerce/cart`.
- Guest cart uses localStorage key `vendix_cart`.
- On login, local cart syncs to backend through `/ecommerce/cart/sync`, then localStorage is cleared.
- Cart page blocks normal checkout for guests by opening login, but can start WhatsApp checkout if config allows.

## Related Skills

- `vendix-customer-auth` - Customer login/register and guest boundary
- `vendix-payment-processors` - Wompi and payment processor internals
- `vendix-inventory-stock` - Reservation and stock validation behavior
- `vendix-multi-tenant-context` - Ecommerce store/user context
- `vendix-zoneless-signals` - Frontend signal state
