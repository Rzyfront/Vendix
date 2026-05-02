---
name: vendix-payment-processors
description: >
  Payment processor system: strategy registration, store credentials, webhooks, Wompi,
  and SaaS recurrent charges. Trigger: When adding payment processors, changing payment
  gateway logic, handling webhooks, or working with Wompi recurrent billing.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke: "Adding new payment processors, modifying payment gateway logic, working with payment webhooks"
---

## When to Use

- Adding or modifying payment gateways such as cash, card, PayPal, bank transfer, Wompi, or wallet.
- Working with `store_payment_methods`, credential encryption, masking, or gateway config schemas.
- Handling store payment webhooks or Wompi transaction confirmation.
- Working on SaaS subscription charges through Wompi recurrent payment sources.

## Source of Truth

- Module registration: `apps/backend/src/domains/store/payments/payments.module.ts`
- Strategy router: `apps/backend/src/domains/store/payments/services/payment-gateway.service.ts`
- Interfaces: `apps/backend/src/domains/store/payments/interfaces/`
- Credential service: `apps/backend/src/domains/store/payments/services/payment-encryption.service.ts`
- Store payment method CRUD: `apps/backend/src/domains/store/payments/services/store-payment-methods.service.ts`
- Webhooks: `apps/backend/src/domains/store/payments/webhook.controller.ts` and `services/webhook-handler.service.ts`
- Wompi processor: `apps/backend/src/domains/store/payments/processors/wompi/wompi.processor.ts`
- SaaS Wompi charges: `apps/backend/src/domains/store/subscriptions/services/subscription-payment.service.ts`

## Architecture

`system_payment_methods` is the global catalog. `store_payment_methods` activates/configures methods per store. `PaymentsModule.onModuleInit()` registers processor instances in `PaymentGatewayService`, keyed by `system_payment_methods.type`.

Currently registered processor types:

- `cash`
- `card` through Stripe
- `paypal`
- `bank_transfer`
- `wompi`
- `wallet`

The Prisma enum also includes `voucher`; verify registration/usage before assuming a processor exists.

## Processor Contract

Every processor extends `BasePaymentProcessor` and implements:

- `processPayment(data: PaymentData)`
- `refundPayment(...)`
- `validatePayment(...)`
- `getPaymentStatus(...)`
- `validateWebhook(...)`

Current `PaymentData` includes required `idempotencyKey`. `storePaymentMethodId` is optional because SaaS subscription billing can charge with platform credentials instead of a per-store payment method.

Current `PaymentResult` may include `gatewayReference` and `errorCode` in addition to success/status/transaction fields. Wompi recurrent revocation uses `errorCode: 'PAYMENT_SOURCE_REVOKED'`.

## Credentials

Store credentials live in `store_payment_methods.custom_config`.

- Sensitive fields are encrypted with AES-256-GCM by `PaymentEncryptionService` when `PAYMENT_ENCRYPTION_KEY` is configured.
- Encrypted format is `iv:authTag:ciphertext`.
- If the env key is missing, credentials are stored without encryption; do not rely on encryption in local/dev unless configured.
- API responses must return masked values (`****last4`), never raw decrypted config.
- Internal processing uses `StorePaymentMethodsService.getDecryptedConfig()`.

Sensitive field map currently includes:

- `wompi`: `private_key`, `events_secret`, `integrity_secret`
- `stripe`: `secret_key`, `webhook_secret`
- `paypal`: `client_secret`

## Store Webhooks

Webhook controller base path is `POST /store/webhooks` with routes for `stripe`, `paypal`, `bank-transfer`, and `wompi`.

Webhook handlers run without normal tenant context. Use `prisma.withoutScope()` for webhook lookup/update paths, and derive tenant/store from payload/reference where needed.

Wompi specifics:

- Store id is extracted from references shaped like `vendix_{storeId}_{orderId}_{timestamp}`.
- Signature validation loads enabled Wompi store payment methods and decrypts config.
- Wompi webhook endpoint must return HTTP 200 even on validation/processing failure to avoid unwanted provider retry behavior.
- Handler deduplicates through `webhook_event_dedup`.
- Lookup priority is `payments.gateway_reference`, then `payments.transaction_id`, then legacy transaction reference.
- Payment updates use compare-and-swap protections against terminal states.

## Wompi Recurrent Charges

Do not reuse a Wompi `transaction.id` as a recurring token. The recurrent/MIT path uses a Wompi `payment_source_id` and sends transactions with `recurrent: true` and no `payment_method` payload.

SaaS subscription charges do not go through `PaymentGatewayService`; `SubscriptionPaymentService` calls `WompiProcessor` directly with platform credentials from `PlatformGatewayService`.

Current behavior:

- Recurrent path uses `provider_payment_source_id`.
- Metadata includes `payment_source_id` and `wompiConfig`.
- Fresh acceptance/personal auth tokens may be fetched for the transaction request.
- `INVALID_PAYMENT_SOURCE` and not-found-like COF failures map to `PAYMENT_SOURCE_REVOKED`.
- Revoked sources are marked invalid, `consecutive_failures` resets to `0`, `replaced_at` is set, an event is emitted, and failover may be attempted.
- Legacy inline token path is controlled by `WOMPI_RECURRENT_ENFORCE`.
- Telemetry logs `WOMPI_CHARGE_PATH path=recurrent|legacy|no_pm|recurrent_failover`.

## Adding a Processor

1. Create a processor directory under `apps/backend/src/domains/store/payments/processors/{name}/`.
2. Implement `BasePaymentProcessor` and provider client/types as needed.
3. Register the module/provider in `payments.module.ts` and register the type in `onModuleInit()`.
4. Add or update `system_payment_methods` seed data and config schema.
5. Add Prisma enum/migration if introducing a new `payment_methods_type_enum` value; load `vendix-prisma-migrations` first.
6. Add credential validator and sensitive-key entries when the provider has secrets.
7. Add webhook route/handler only if the provider sends async events.
8. Update frontend config UI only if store admins must configure the provider.

## Pitfalls

- Do not process POS digital payments inside the same DB transaction that creates the order; commit the order first.
- Do not expose `custom_config` secrets in API responses.
- Do not use scoped Prisma inside webhooks without a context; use explicit unscoped queries.
- Do not assume Wompi recurrent `404` maps to a distinct not-found error; current code treats it as revoked.
- Do not claim Wompi acceptance tokens are cached with TTL unless current code confirms it.

## Related Skills

- `vendix-prisma-scopes` - Scoped and unscoped Prisma usage
- `vendix-prisma-migrations` - Safe enum/schema migrations
- `vendix-multi-tenant-context` - Store context resolution
- `vendix-ecommerce-checkout` - Ecommerce Wompi checkout flow
- `vendix-saas-billing` - SaaS subscription payment flows
