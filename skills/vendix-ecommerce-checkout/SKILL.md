---
name: vendix-ecommerce-checkout
description: >
  Checkout flow for STORE_ECOMMERCE: cart, shipping, payment methods, Wompi,
  WhatsApp checkout, bookings, and stock reservations. Trigger: When implementing
  or debugging ecommerce checkout, cart checkout, shipping/payment selection, or Wompi checkout.
license: MIT
metadata:
  author: rzyfront
  version: "1.2"
  scope: [root]
  auto_invoke: "Implementing ecommerce checkout"
---

## Alcance

Checkout del storefront (`STORE_ECOMMERCE`): carrito, envío, métodos de pago, Wompi, finalizar por WhatsApp, bookings y reservas de stock. Precio por distancia: `vendix-shipping-distance-pricing`. Dirección/mapa: `vendix-address-geocoding`. Pagos y webhooks: `vendix-payment-processors`. Mesa QR: `vendix-restaurant-table-qr`.

## Código

- Backend: `apps/backend/src/domains/ecommerce/checkout/` (`checkout.controller.ts`, `checkout.service.ts` → `checkout()` / `runCheckout()`, `dto/checkout.dto.ts`), carrito en `domains/ecommerce/cart/`.
- Frontend: `apps/frontend/src/app/private/modules/ecommerce/pages/{checkout,cart}/`, `services/{checkout,cart}.service.ts`. Ruta pública `/checkout` con `mesaCartGuard` (sin `AuthGuard`).

## API (`ecommerce/checkout`, controller con `JwtAuthGuard` + `@OptionalAuth`)

- `GET eligibility` (¿facturación activa? para datos de factura del invitado), `GET delivery-options`, `GET address-scope`, `POST coupon-preview`, `GET payment-methods?shipping_type=`, `GET payment-methods/:methodId/bank-accounts`: públicos.
- `POST /ecommerce/checkout` (`@OptionalAuth` + `StoreAvailabilityGuard`): JSON o `multipart/form-data` con `data` (DTO como string, validado a mano) + `file` opcional (comprobante de transferencia/voucher).
- `POST prepare-wompi`, `POST confirm-wompi-payment/:orderId` (body `public_order_token?` para invitados): `@OptionalAuth`.
- `GET payments/:paymentId/receipt-url`: solo comprador autenticado (scope `customer_id`).
- `POST whatsapp`: **LEGACY**, no añadir capacidades. El storefront finaliza por WhatsApp con `POST /ecommerce/checkout` + `channel: 'whatsapp'` (mismo núcleo y cálculo).

`CheckoutDto`: `items?` (fallback si el carrito backend está vacío; `product_variant_id`, `price_tier_id`, `notes` por línea), `bookings?`, `shipping_method_id?`, `shipping_rate_id?`, `shipping_address_id?` o `shipping_address` inline (con lat/lng), `guest_customer?`, `payment_method_id?`, `bank_account_id?`, `notes?`, `coupon_code?`, `channel?`, `pending_shipping_assignment?`.

## Reglas

1. **Invitado permitido** en el checkout normal: exige al menos `guest_customer.first_name`; bookings requieren cuenta. Wallet solo con cliente autenticado (oculta y rechazada para anónimos, QUI-467).
2. **El servidor recalcula todo**: precios con `PriceResolverService`, impuestos, cupón y envío (`resolveConfirmShippingCost`); nunca confiar en totales del frontend.
3. Productos con variantes exigen `product_variant_id`. Stock: validar con `StockValidatorService` y reservar con `StockLevelManager.reserveStock()` en la transacción; el checkout nunca descuenta stock directo (consumo en entrega, `vendix-inventory-stock`).
4. Orden `channel: 'ecommerce'` (o `whatsapp`), `state: 'pending_payment'`; emitir `order.created` tras crearla. Contra-entrega (`ON_DELIVERY`): `total_paid: 0`, `remaining_balance: grand_total` (si no, el despacho la trata como prepagada).
5. **Filtro de métodos de pago** por `processing_mode` y tipo de envío: `pickup` → `DIRECT` + `ONLINE`; envío a domicilio o sin tipo → `DIRECT` + `ONLINE` + `ON_DELIVERY`. **Nunca exponer `cash`** en la tienda en línea (filtro por `type === 'cash'`, no por modo, para no ocultar wallet ni `cash_on_delivery`). El frontend recarga métodos al elegir envío.
6. Carritos solo-servicio saltan dirección/envío; físicos los exigen; servicios reservables añaden paso de booking (fallo de booking se registra y no tumba el checkout).
7. Envío a domicilio sin coordenadas no tiene tarifa; salida WhatsApp "envío por asignar" solo con `whatsapp_checkout` activo (`vendix-shipping-distance-pricing`).
8. Wompi: se crea la orden primero; `prepare-wompi` reutiliza `payments.gateway_reference` y valida el host de redirect contra el dominio; `confirm-wompi-payment` consulta Wompi y aplica con `WebhookHandlerService.applyWompiTransaction` (fallback de UX; el webhook es la fuente). Frontend detecta `type === 'wompi'` o `provider === 'wompi'` y usa `WompiService`.
9. Tras crear la orden: marcar el carrito como convertido y luego `clearCart()` (QUI-628).

## Carrito

- Autenticado: `/ecommerce/cart` (CRUD + `POST /ecommerce/cart/sync` al iniciar sesión, luego se limpia localStorage).
- Invitado: localStorage `vendix_cart` (esquema v2, ver `cart.service.ts`).
- Cotización de envío: `CartService.getShippingEstimates()` → `POST /shipping/calculate?store_id=...` (no es endpoint del checkout).
- Estado nuevo en signals/computed (`vendix-zoneless-signals`); no copiar campos mutables heredados del componente.

Skills relacionados: `vendix-customer-auth`, `vendix-payment-processors`, `vendix-inventory-stock`, `vendix-multi-tenant-context`, `vendix-zoneless-signals`.
