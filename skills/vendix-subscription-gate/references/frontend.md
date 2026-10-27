# Subscription gate: frontend detail

Paths relative to `apps/frontend/src/app/`.

## Frontend Source of Truth

- Store: `apps/frontend/src/app/core/store/subscription/`
- Interceptor: `apps/frontend/src/app/core/interceptors/subscription-paywall.interceptor.ts`
- Paywall service: `apps/frontend/src/app/core/services/subscription-access.service.ts`
- Paywall outlet/modal: `apps/frontend/src/app/shared/components/ai-paywall-modal/`
- Banner: `apps/frontend/src/app/shared/components/subscription-banner/subscription-banner.component.ts`
- Store subscription pages: `apps/frontend/src/app/private/modules/store/subscription/`

## Frontend Paywall

The HTTP interceptor opens a paywall by backend `error_code`, not strictly by HTTP status.

Codes handled include `SUBSCRIPTION_002` through `SUBSCRIPTION_009`, `SUBSCRIPTION_011`, `PLAN_001`, and `TRIAL_001`. It rethrows the original error after opening the modal.

Suppression rules prevent duplicate paywalls on:

- no-plan while already on `/admin/subscription/picker`.
- suspended/blocked while already on `/admin/subscription/dunning`.
- exact `/admin/subscription`.

`SubscriptionAccessService.openPaywall(code, message?, details?)` maps backend codes and synthetic state codes to variant config. It also supports state-driven paywalls and payment-success microinteraction.

`<app-paywall-outlet />` is mounted in store-admin, organization-admin, and super-admin layouts. The subscription banner is store-admin only.

## Frontend Subscription State

`SubscriptionFacade` exposes both observables and signals with `toSignal(..., { initialValue })`.

Important facade concepts:

- `subscriptionContextChanged(storeId)` resets/loads state by store context.
- `subscriptionUiState` is the frontend cascade for grace, terminal states, no-plan, pending payment/change, expiring soon, and healthy states.
- Effects call `/store/subscriptions/current`, `/current/access`, checkout preview/commit, invoices, dunning state, retry payment, coupon validation, and invoice sync from gateway.
- SSE listens to `/store/notifications/stream?token=...` and reacts to `subscription.updated`.

## Banner And Dunning UI

`SubscriptionBannerComponent` is store-scoped and visible only for `expiring_soon`, `grace_soft`, and `grace_hard`. Terminal and pending states are handled by subscription pages/paywall variants.

Store dunning page shows deadline, total due, overdue invoices, features lost/kept, retry payment, and support request CTA.

