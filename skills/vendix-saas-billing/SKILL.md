---
name: vendix-saas-billing
description: >
  SaaS subscription billing for Vendix stores: plan pricing, invoices, Wompi platform
  payments, manual payments, partner commissions, payouts, proration, and dunning.
  Trigger: When creating SaaS invoices, working with partner rev-share, margin/surcharge
  pricing, invoice sequence allocation, partner payout batches, subscription payments,
  manual payments, or dunning flows.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "Creating SaaS subscription invoices or rev-share splits"
    - "Working with SubscriptionBillingService or SubscriptionPaymentService"
    - "Accruing partner commissions or running partner payout batches"
    - "Allocating invoice numbers with advisory locks"
    - "Computing partner margin, fixed surcharge, or effective price"
    - "Debugging free-plan invoices, pending credits, or proration flows"
---

## When to Use

- Editing store subscription invoices, payments, manual payments, dunning, proration, or checkout.
- Editing super-admin subscription plans, partners, payouts, gateway settings, or metrics.
- Touching partner margin/fixed surcharge pricing or `subscription_invoices.split_breakdown`.
- Working with platform Wompi credentials or recurrent Wompi subscription charges.

## Source of Truth

- Billing: `apps/backend/src/domains/store/subscriptions/services/subscription-billing.service.ts`
- Payments: `apps/backend/src/domains/store/subscriptions/services/subscription-payment.service.ts`
- Manual payment: `apps/backend/src/domains/store/subscriptions/services/subscription-manual-payment.service.ts`
- State/dunning/proration: `apps/backend/src/domains/store/subscriptions/services/`
- Super-admin plans/partners/payouts: `apps/backend/src/domains/superadmin/subscriptions/`
- Platform gateway: `apps/backend/src/domains/superadmin/subscriptions/gateway/`
- Jobs: `apps/backend/src/jobs/commission-accrual.job.ts`, `partner-payout-batch.job.ts`
- Frontend store subscription UI: `apps/frontend/src/app/private/modules/store/subscription/`
- Frontend super-admin UI: `apps/frontend/src/app/private/modules/super-admin/subscriptions/`

## Current Model Facts

- `store_subscription_state_enum`: `draft`, `trial`, `active`, `grace_soft`, `grace_hard`, `suspended`, `blocked`, `cancelled`, `expired`, `pending_payment`, `no_plan`.
- `subscription_invoice_state_enum`: `draft`, `issued`, `paid`, `overdue`, `void`, `refunded`, `refunded_chargeback`.
- `subscription_payment_state_enum`: `pending`, `succeeded`, `failed`, `refunded`, `partial_refund`.
- `partner_commission_state_enum`: `accrued`, `pending_payout`, `paid`, `reversed`, `reversed_pending_recovery`.
- `store_subscriptions.lock_reason` exists.
- `organizations.fraud_blocked` fields exist.
- Plans currently include currency fields in backend/frontend payloads. Do not document “COP only/no currency field” as current code fact.

## Invoice Emission

`SubscriptionBillingService.issueInvoice()` is the core invoice path.

Current behavior:

- Uses `GlobalPrismaService`.
- Locks the `store_subscriptions` row with `FOR UPDATE`.
- Allocates invoice numbers with `pg_advisory_xact_lock(0x53414153)` and format `SAAS-YYYYMMDD-00001`.
- Computes price as `base_price + margin_amount + fixed_surcharge`.
- Clamps partner margin against plan cap.
- Writes `tax_amount=0`, `currency=sub.currency`, `line_items`, and `split_breakdown`.
- Skips non-prorated zero-price invoices when `unitPrice <= 0` and `margin_amount <= 0`; advances period and writes a `renewed` event with `skipped_reason='zero_price'`.
- Applies `metadata.pending_credit` to non-prorated invoices, capped to subtotal, and rolls over excess.
- Does not accrue commission for promotional plans.

Use `Prisma.Decimal` for money. Round at storage boundaries, not mid-calculation.

## split_breakdown

`subscription_invoices.split_breakdown` is the partner/Vendix share contract. Store decimal values as strings when serializing JSON to avoid JS number precision issues.

Typical fields:

- `vendix_share`
- `partner_share`
- `margin_pct_used`
- `partner_org_id`

When reading it back, convert with `new Prisma.Decimal(value)`.

## Platform Payments

SaaS subscription payments use platform Wompi credentials from `PlatformGatewayService.getActiveCredentials('wompi')`.

Important distinctions:

- Store ecommerce payment processors are separate from SaaS platform payments.
- SaaS charge flow calls `WompiProcessor` directly for platform Wompi charges.
- Widget preparation uses platform credentials and returns Wompi widget config.
- `SubscriptionPaymentService.refund()` still uses `PaymentGatewayService.refundPayment()`; do not claim SaaS never touches `PaymentGatewayService`.

Current payment flow:

- `prepareWidgetCharge()` creates a pending `subscription_payments` row and returns widget config.
- SaaS references use `vendix_saas_{store_subscription_id}_{invoiceId}_{timestamp}`.
- `charge()` supports saved Wompi recurrent source via `provider_payment_source_id` and legacy token fallback under `WOMPI_RECURRENT_ENFORCE`.
- Logs `WOMPI_CHARGE_PATH path=recurrent|legacy|no_pm|recurrent_failover`.
- On success, payment becomes `succeeded`, invoice becomes `paid`, subscription may become `active`, card may be auto-registered, and commission outbox is upserted.

## Manual Payments

Manual/offline payments are implemented.

- Service: `subscription-manual-payment.service.ts`.
- Controller: `superadmin/subscriptions/controllers/manual-payment.controller.ts`.
- Route: `POST /superadmin/subscriptions/invoices/:id/manual-payment`.
- Permission: `superadmin:subscriptions`.
- Creates `subscription_payments(state='succeeded', payment_method='manual')` with bank reference.
- Marks invoice `paid`.
- Excess amount becomes `store_subscriptions.metadata.pending_credit`.
- Attempts to transition the subscription to `active` in the same transaction.

## Plans And Partners

Super-admin plan service facts:

- `is_free` forces `base_price=0` and `setup_fee=null`.
- `plan_type` supports `base`, `partner_custom`, and `promotional`.
- Promotional flag mirrors `plan_type === 'promotional'`.
- `setDefault()` clears existing default and sets one active plan as default in a serializable transaction.

Partner facts:

- Partners are `organizations` with `is_partner=true`.
- Overrides are `partner_plan_overrides` keyed by `(organization_id, base_plan_id)`.
- `PartnersService.createOverride()` enforces `margin_pct <= plan.max_partner_margin_pct`.
- Current code does not fully block overrides on promotional plans in `PartnersService`; billing skips commission for promotional plans. Treat this as a known implementation gap if product policy requires blocking overrides.

## Commissions And Payouts

Commission accrual paths:

- `PartnerCommissionsService.accrueCommission(invoiceId)` upserts `partner_commissions(state='accrued')` from `invoice.split_breakdown.partner_share`.
- `commission-accrual.job.ts` processes `commission_accrual_pending`, upserts commission as `pending_payout`, and promotes existing `accrued` to `pending_payout`.
- `partner-payout-batch.job.ts` runs `0 4 5 * *`, creates monthly draft batches for previous-month `accrued` commissions, and transitions them to `pending_payout`.

Known current inconsistency: `commission-accrual.job.ts` promotes commissions to `pending_payout`, while `partner-payout-batch.job.ts` selects only `accrued`. Do not document the payout lifecycle as perfectly consistent until this is resolved.

Admin payout service:

- `approve()` moves draft batch to approved.
- `rejectBatch()` releases commissions back to `accrued`.
- `markPaid()` requires approved batch and sets batch plus commissions to `paid`.

## Platform Webhooks

- Route: `POST /platform/webhooks/wompi`.
- Controller is public and `@SkipSubscriptionGate()`.
- `SAAS_WEBHOOK_ENABLED` defaults enabled.
- SaaS reference regex: `^vendix_saas_(\d+)_(\d+)_\d+$`.
- Validation uses platform Wompi credentials, not store payment methods.
- Invalid platform webhook validation returns `400`; this differs from store Wompi webhooks.

## Frontend Subscription UI

Store subscription routes include overview, plans, picker, payment, history, timeline, invoice detail, checkout, and dunning.

Key frontend facts:

- `SubscriptionFacade` exposes observables and signals with `toSignal(..., { initialValue })`.
- Plan catalog groups by billing cycle and supports coupon validation.
- Picker is the soft `no_plan` path and filters promotional plans unless `show_in_picker === true`.
- Checkout preview/commit handles free plans, trial swap, proration, resubscribe, scheduled-cancel revert, Wompi widget, polling, and invoice gateway sync fallback.
- Dunning board shows deadline, total due, overdue invoices, features lost/kept, retry payment, and support CTA.
- Super-admin plan form includes overview, AI matrix, pricing, trial/grace tabs; pricing default drives canonical `base_price`, `billing_cycle`, and `currency`.

## Anti-Patterns

- Do not call Wompi/gateway network I/O inside long Prisma transactions.
- Do not use JS `Number` for money math.
- Do not serialize money in JSON as numbers when precision matters.
- Do not assume partner override blocking on promotional plans is enforced everywhere.
- Do not assume payout batch and commission accrual job are lifecycle-consistent; verify before changing payouts.
- Do not document policy/spec claims as current behavior unless code enforces them.

## Related Skills

- `vendix-subscription-gate` - Store write gate, AI feature gate, paywall behavior
- `vendix-payment-processors` - Wompi processor and ecommerce payment processors
- `vendix-prisma-migrations` - Safe schema/enum changes
- `vendix-currency-formatting` - Currency display/input
- `vendix-date-timezone` - UTC period and display rules
- `vendix-auto-entries` - Accounting entries for subscription payments
