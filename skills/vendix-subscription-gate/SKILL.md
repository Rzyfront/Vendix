---
name: vendix-subscription-gate
description: >
  Feature gating by store subscription state: global store write guard, AI feature gate,
  Redis feature resolution, quota consumption, frontend paywall interceptor, banner, and
  subscription UI states. Trigger: When adding feature gates, paywalls, subscription-based
  access control, protecting store write operations, AI feature gates, or rollout flags.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "Adding feature gates or paywalls backed by subscription state"
    - "Protecting store write operations behind a subscription"
    - "Applying @RequireAIFeature decorator + AiAccessGuard to controllers"
    - "Applying @SkipSubscriptionGate to bypass StoreOperationsGuard on a handler/controller"
    - "Working with SubscriptionAccessService or SubscriptionResolverService"
    - "Mapping store_subscription_state_enum to allow/warn/block"
    - "Invalidating the sub:features:{storeId} Redis cache"
    - "Wiring the subscription-paywall HTTP interceptor on the frontend"
---

## When to Use

- Adding or modifying subscription-gated store writes.
- Adding AI feature gates or quota checks.
- Changing subscription state-to-access behavior.
- Editing frontend paywall, subscription banner, or subscription access UI.
- Debugging why a store can write, sees warnings, or gets a paywall.

## Backend Source of Truth

- Access service: `apps/backend/src/domains/store/subscriptions/services/subscription-access.service.ts`
- Resolver/cache: `apps/backend/src/domains/store/subscriptions/services/subscription-resolver.service.ts`
- Global write guard: `apps/backend/src/domains/store/subscriptions/guards/store-operations.guard.ts`
- AI guard/decorator: `apps/backend/src/domains/store/subscriptions/guards/ai-access.guard.ts`
- Skip decorator: `apps/backend/src/domains/store/subscriptions/decorators/skip-subscription-gate.decorator.ts`
- Config: `apps/backend/src/domains/store/subscriptions/config/subscription-gate.config.ts`
- AI engine inline consumer: `apps/backend/src/ai-engine/ai-engine.service.ts`

## StoreOperationsGuard

`StoreOperationsGuard` is registered as an `APP_GUARD` in `apps/backend/src/app.module.ts`.

It applies only when all of these are true:

- HTTP method is `POST`, `PATCH`, `PUT`, or `DELETE`.
- Request path starts with `/api/store/`.
- Path is not `/api/store/subscriptions/**`.
- Handler/class does not have `@SkipSubscriptionGate()`.
- A store id is available, usually from `req.user.store_id` because ALS context is not ready yet in guards.

Warn results set `X-Subscription-Warning`. Block results log `STORE_GATE_OBSERVATION` and throw only when `SubscriptionGateConfig.isEnforce()` is true.

Use `@SkipSubscriptionGate()` for subscription management, platform webhook/payment unblock paths, and other handlers that must remain reachable while blocked.

## Rollout Flags

Primary flag:

- `STORE_GATE_ENFORCE=true` enables enforcement.

Deprecated alias:

- `AI_GATE_ENFORCE=true` also enables enforcement and logs a deprecation warning.

`SUBSCRIPTION_CRON_DRY_RUN=true` enables dry-run behavior for some subscription jobs.

Known implementation caveat: `SubscriptionAccessService` has an internal private `isEnforceMode()` path that checks only `AI_GATE_ENFORCE` for internal-error fail-open/fail-closed behavior. Other guard/AI paths use `SubscriptionGateConfig.isEnforce()`.

## State Mapping

Current backend `stateToMode()` behavior:

| State | Mode | Reason |
| --- | --- | --- |
| `active`, `trial` | allow | none |
| `grace_soft` | warn | `SUBSCRIPTION_007` |
| `grace_hard` | warn by default, block if feature `degradation='block'` | `SUBSCRIPTION_009` when blocked |
| `suspended` | block | `SUBSCRIPTION_008` |
| `blocked` | block | `SUBSCRIPTION_009` |
| `cancelled`, `expired` | block | `SUBSCRIPTION_003` |
| `no_plan` | block | `SUBSCRIPTION_004` |
| `draft`/default | block | `SUBSCRIPTION_002` |

Important nuance: GET/HEAD/OPTIONS requests bypass `StoreOperationsGuard`, so read routes remain reachable at the guard layer. But `canUseModule()` currently maps `cancelled` to block; do not document module checks as read-allow for cancelled unless code changes.

## Resolver And Cache

`SubscriptionResolverService` materializes effective plan features and caches them in Redis.

- Cache key: `sub:features:{storeId}`.
- TTL: 60 seconds.
- Uses `GlobalPrismaService` with explicit `store_id` filters.
- Uses `paid_plan_id` as source of truth for paid feature gating; trial uses `plan_id`.
- `no_plan` resolves empty features and null plan id.

Feature resolution order:

1. Base `subscription_plans.ai_feature_flags`.
2. Partner override as restriction-only: boolean AND, cap min, tool intersection.
3. Promotional overlay as union-of-max: boolean OR, cap max, tool union.

Call `SubscriptionAccessService.invalidateCache(storeId)` synchronously after subscription state, plan, partner override, or promo overlay changes.

## AI Feature Gate

Use both declarative guard and inline service checks for AI features.

Controller layer:

```typescript
@Post('generate')
@UseGuards(AiAccessGuard)
@RequireAIFeature('text_generation')
generate() {}
```

Inline layer:

- `AIEngineService.runSubscriptionGate()` executes before provider work.
- `AIEngineService.consumeSubscriptionQuota()` runs after successful provider output.
- Logs `AI_GATE_CHECK` and `AI_GATE_OBSERVATION`.

Do not consume quota before provider success.

## Quota Keys

`consumeAIQuota()` uses Redis with request-id dedupe.

- Counter: `ai:quota:{storeId}:{feature}:{period}`.
- Dedup set: `ai:quota:dedup:{storeId}:{feature}:{period}`.
- Daily period: `YYYYMMDD`, TTL 48h.
- Monthly period: `YYYYMM`, TTL 40d.
- Requires non-empty request id; AI engine uses request context id or synthetic `internal-${randomUUID()}`.

## Frontend Source of Truth

- Store: `apps/frontend/src/app/core/store/subscription/`
- Interceptor: `apps/frontend/src/app/core/interceptors/subscription-paywall.interceptor.ts`
- Paywall service: `apps/frontend/src/app/core/services/subscription-access.service.ts`
- Paywall outlet/modal: `apps/frontend/src/app/shared/components/ai-paywall-modal/`
- Banner: `apps/frontend/src/app/shared/components/subscription-banner/subscription-banner.component.ts`
- Store subscription pages: `apps/frontend/src/app/private/modules/store/subscription/`

## Frontend Paywall

The HTTP interceptor opens a paywall by backend `error_code`, not strictly by HTTP status.

Codes handled include `SUBSCRIPTION_002` through `SUBSCRIPTION_009`, `PLAN_001`, and `TRIAL_001`. It rethrows the original error after opening the modal.

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

## Anti-Patterns

- Do not gate read requests through `StoreOperationsGuard`; current guard intentionally skips reads.
- Do not rely only on `AiAccessGuard`; internal jobs/services need inline checks.
- Do not consume AI quota pre-flight.
- Do not skip `sub:features:{storeId}` invalidation after subscription state or plan/override changes.
- Do not document frontend paywall as status-code-only; it is error-code-driven.
- Do not claim `cancelled` is allowed by `canUseModule()` unless the backend mapping is changed.

## Related Skills

- `vendix-saas-billing` - Subscription invoices, payments, dunning, plans, commissions
- `vendix-redis-quota` - Period keyed Redis quota counters
- `vendix-error-handling` - Subscription error codes
- `vendix-multi-tenant-context` - Store context resolution
- `vendix-ai-engine` - Inline AI gate consumer
