---
name: vendix-subscription-gate
description: >
  Feature gating by store subscription state: store write guard, AI feature gate, Redis feature resolution, frontend paywall and banner. Trigger: feature gates, paywalls, subscription access control, @RequireAIFeature, rollout flags.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.2"
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

- Enforcement is the **code default**. `STORE_GATE_ENFORCE=false` (deprecated alias `AI_GATE_ENFORCE=false`, logs a warning) falls back to log-only, e.g. for an incident bypass.

`SUBSCRIPTION_CRON_DRY_RUN=true` enables dry-run behavior for some subscription jobs.

Known caveat: `SubscriptionAccessService` has a private `isEnforceMode()` that returns `AI_GATE_ENFORCE === 'true'` only (opt-in, opposite default) for internal-error fail-open/fail-closed. Other guard/AI paths use `SubscriptionGateConfig.isEnforce()`.

## State Mapping

Current backend `stateToMode()` behavior:

| State | Mode | Reason |
| --- | --- | --- |
| `active`, `trial` | allow | none |
| `pending_payment` | warn (charge in flight; `ReconcileStuckPendingJob` reverts it after 60 min) | `SUBSCRIPTION_007` |
| `grace_soft` | warn | `SUBSCRIPTION_007` |
| `grace_hard` | warn by default, block if feature `degradation='block'` | `SUBSCRIPTION_009` when blocked |
| `suspended` | block | `SUBSCRIPTION_008` |
| `blocked` | block | `SUBSCRIPTION_009` |
| `cancelled`, `expired` | block | `SUBSCRIPTION_003` |
| `no_plan` | block | `SUBSCRIPTION_004` |
| `draft`/default | block | `SUBSCRIPTION_002` |

If the plan was retired from the catalog, `pending_payment`/grace/`suspended`/`blocked` report `SUBSCRIPTION_011` instead (recovery = pick a plan, no debt). `stateToMode()` also reads `store_subscriptions.lock_reason` to name the real cause.

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

`consumeAIQuota()` uses Redis Lua with request-id dedupe (`ai:quota:{storeId}:{feature}:{period}`, UTC periods, TTL 48h daily / 40d monthly). The AI engine passes the request context id or a synthetic `internal-${randomUUID()}`. Rules: `vendix-redis-quota`.

## Frontend

Store `core/store/subscription/`, interceptor `core/interceptors/subscription-paywall.interceptor.ts`, `core/services/subscription-access.service.ts`, `shared/components/ai-paywall-modal/`, `shared/components/subscription-banner/`, pages `private/modules/store/subscription/`. The interceptor opens the paywall by backend `error_code` (`SUBSCRIPTION_002`–`009`, `SUBSCRIPTION_011`, `PLAN_001`, `TRIAL_001`), not by status, and rethrows. Paywall suppression, facade state cascade, SSE `subscription.updated`, banner and dunning: `references/frontend.md` (read on demand).

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
