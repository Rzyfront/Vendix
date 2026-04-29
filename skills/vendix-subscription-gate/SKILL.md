---
name: vendix-subscription-gate
description: >
  Feature gating by store subscription state. Three-layer defense in depth: a global
  StoreOperationsGuard that blocks store writes when subscription is not in active/trial/grace,
  an AI-feature guard at the controller layer plus an inline check in core services,
  Redis-cached feature resolution, canonical state -> mode mapping, frontend HTTP interceptor
  that opens a paywall modal on 402/403, and a STORE_GATE_ENFORCE env flag (with backwards-compat
  alias AI_GATE_ENFORCE) for gradual rollout (log-only -> enforce).
  Trigger: When adding feature gates, paywalls, subscription-based access control,
  protecting store write operations, or doing a gradual rollout of a new enforce path.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "Adding feature gates or paywalls backed by subscription state"
    - "Protecting store write operations behind a subscription"
    - "Rolling out a new enforce path with log-only -> enforce flag"
    - "Working with SubscriptionAccessService or SubscriptionResolverService"
    - "Applying @RequireAIFeature decorator + AiAccessGuard to controllers"
    - "Applying @SkipSubscriptionGate to bypass StoreOperationsGuard on a handler/controller"
    - "Mapping store_subscription_state_enum to allow/warn/block"
    - "Invalidating the sub:features:{storeId} Redis cache"
    - "Wiring the subscription-paywall HTTP interceptor on the frontend"
---

# Vendix Subscription Gate - Feature Access Control by Store

> Central access gate for subscription-gated features. Uses **defense in depth**: a guard
> at the controller (rejects early) PLUS an inline check inside the core service (never
> trust a single layer). Supports a gradual rollout via `AI_GATE_ENFORCE`.

## When to Use

- Adding a new feature that must be gated by subscription plan or state
- Promoting a feature from log-only (observability) to enforce (actual 403)
- Debugging why a store sees "paywall" warnings or blocks
- Adding or modifying `feature_overrides` on partner/promo overlays
- Changing the grace period mode mapping
- Decorating a controller handler with `@RequireAIFeature('<key>')`

---

## Key Files

| File | Purpose |
|------|---------|
| `apps/backend/src/domains/store/subscriptions/services/subscription-access.service.ts` | Public API: `canUseAIFeature`, `canUseModule`, `consumeAIQuota`, `invalidateCache` |
| `apps/backend/src/domains/store/subscriptions/services/subscription-resolver.service.ts` | Redis-cached materialization of effective features (plan + partner + promo) |
| `apps/backend/src/domains/store/subscriptions/guards/store-operations.guard.ts` | **APP_GUARD** global: blocks writes on `/api/store/**` when subscription is suspended/blocked/cancelled/expired/missing |
| `apps/backend/src/domains/store/subscriptions/guards/ai-access.guard.ts` | NestJS guard: `@RequireAIFeature(key)` + `AiAccessGuard` |
| `apps/backend/src/domains/store/subscriptions/decorators/skip-subscription-gate.decorator.ts` | `@SkipSubscriptionGate()` — bypass for handlers that must work even when blocked (subscribe, payment, cancel) |
| `apps/backend/src/ai-engine/ai-engine.service.ts` | Inline consumer (`runSubscriptionGate`, `consumeSubscriptionQuota`) |
| `apps/backend/src/domains/store/subscriptions/types/access.types.ts` | `AIFeatureKey`, `FeatureConfig`, `AccessCheckResult`, `FEATURE_QUOTA_CONFIG` |
| `apps/frontend/src/app/core/interceptors/subscription-paywall.interceptor.ts` | Functional HTTP interceptor: catches 402/403 with `error_code` SUBSCRIPTION_*/PLAN_001/TRIAL_001 and dispatches paywall |
| `apps/frontend/src/app/core/services/subscription-access.service.ts` | `openPaywall(code, message)` + dedupe signal `isPaywallOpen` + variant catalog |
| `apps/frontend/src/app/shared/components/ai-paywall-modal/paywall-outlet.component.ts` | Mounts the modal once per layout; subscribes to access-service signals |

---

## Architecture: Three-Layer Defense in Depth

```
HTTP request (any /api/store/** write)
        |
        v
  StoreOperationsGuard (APP_GUARD, global)
        | path !startsWith /api/store/  -> pass
        | method GET                    -> pass
        | path startsWith /api/store/subscriptions/ -> pass (allowlist)
        | @SkipSubscriptionGate() on handler/class  -> pass (decorator bypass)
        | canUseModule(storeId, 'store-operations'):
        |   active|trial         -> pass
        |   grace_soft|grace_hard -> pass + X-Subscription-Warning header
        |   suspended|blocked|cancelled|expired|no-sub:
        |       enforce=true  -> throw SUBSCRIPTION_004/008/009
        |       enforce=false -> log STORE_GATE_OBSERVATION, pass
        v
  AiAccessGuard (@RequireAIFeature('text_generation'))   <-- AI-specific layer
        | block -> throw SUBSCRIPTION_005/006 (if enforce)
        | warn  -> set X-Subscription-Warning header, pass
        | allow -> pass
        v
  Controller -> Service -> AIEngineService.run()
        |
        v
  runSubscriptionGate(appKey, featureCategory)  <-- inline check #3
        | same mode semantics; protects jobs/events that bypass guards
        v
  Provider call (OpenAI, Anthropic, etc.)
        |
  success
        v
  consumeSubscriptionQuota(feature, units)  <-- Redis INCR (post-success only)
        |
        v
  HTTP error response (402/403 with error_code SUBSCRIPTION_*/PLAN_001/TRIAL_001)
        |
        v
  [FRONTEND] subscriptionPaywallInterceptor
        | dedupe via SubscriptionAccessService.isPaywallOpen signal
        | openPaywall(code, message) -> variant -> <app-paywall-outlet />
```

Rationale for three layers:

- **`StoreOperationsGuard`** (global APP_GUARD) protects every store write uniformly
  without each domain having to opt-in. Single point of policy.
- **`AiAccessGuard` + `@RequireAIFeature`** apply AI-specific gating (per-feature flag
  in `ai_feature_flags`, per-feature quota cap).
- **Inline check** protects service-to-service calls (events, jobs, internal runners)
  where neither HTTP guard executes.

Frontend mirror: the interceptor turns gate rejections into a paywall modal with the
correct CTA. No route guards — paywall is feature-level.

---

## Business Rules (Canonical, spec 2026-04-29)

> **READ THIS FIRST.** These business rules govern every gate decision. They override any
> earlier assumption in the canonical `stateToMode()` mapping below. Tactical rules
> (1-12) implement these decisions.

### G1: State machine consolidada (post-cleanup)

Estados activos del enum `store_subscription_state_enum`:

| State | Significado | Writes | Reads | Recovery path |
|-------|-------------|--------|-------|---------------|
| `draft` | Pre-checkout. Suscripción creada antes del primer pago. Auto-void en 24h si no se completa. | block | block | Completar checkout → `pending_payment` o `active` |
| `pending_payment` | Invoice issued esperando confirmación Wompi. | block | block | Webhook payment.succeeded → `active` |
| `trial` | Trial activo. Plan default auto-aplicado a primera store de la org. | allow | allow | Auto-charge al expirar (si PM válido) o → `expired` |
| `active` | Operación normal. | allow | allow | — |
| `grace_soft` | Pago renovación falló, ventana 1 (`plan.grace_period_soft_days`). | allow + warning | allow | Pago exitoso → `active` |
| `grace_hard` | Ventana 2 (`plan.grace_period_hard_days`). Por feature: warn o block. | warn/block per feature | allow | Pago exitoso → `active` |
| `suspended` | Lock automático por dunning. Recuperable con pago atrasado. | block | allow | Pago exitoso → `active` (con descuento de días en gracia) |
| `blocked` | Lock manual super-admin (fraud/abuso/compliance). Requiere unblock manual. `lock_reason` populado. | block | block | Solo super-admin |
| `cancelled` | Cliente abandonó (scheduled end-of-period o admin cancel). | block | **allow** (read-only indefinido) | Re-suscripción = limpia, sin deuda |
| `expired` | Fin natural de período. Cliente puede re-adquirir plan disponible. | block | allow | Elegir plan + pagar → `active` |
| `no_plan` | **Scope estrecho**: solo stores adicionales de orgs sin trial disponible. UI soft picker. | block | allow | Elegir plan + pagar → `active` |

**Eliminado del invoice enum**: `partially_paid` (incompatible con política all-or-nothing).

### G2: `cancelled` permite reads (read-only indefinido)

Implicación: el `stateToMode()` para `cancelled` debe diferenciar HTTP method. La policy
canónica de `StoreOperationsGuard` ya skip GET/HEAD/OPTIONS, pero hay que asegurar que
`canUseModule()` para módulos de UI (read-only views) retorne `allow` en `cancelled`,
NO `block`.

### G3: `lock_reason` audit en suspended/blocked

Añadir columna `store_subscriptions.lock_reason` (nullable string). Valores típicos:
- `'dunning'` (default cuando suspended automático)
- `'admin_manual'` (super-admin lock)
- `'fraud'` (chargebacks anti-fraud)
- `'compliance'` (compliance lock)
- `'chargeback'` (suspended por chargeback inmediato)

Mostrar al cliente en mensaje del paywall para contextualizar el bloqueo.

### G4: Trial es por organización; primera store de org auto-trial

- `organization_trial_consumptions UNIQUE(organization_id)` enforce single trial per org.
- Plan trial = `subscription_plans.is_default=true` (UNIQUE partial index). Configurable
  super-admin.
- Stores adicionales de org que ya consumió trial → estado `no_plan`.
- **Sin extensiones de trial**. Si cliente necesita más tiempo → super-admin asigna
  promo plan manualmente.

### G5: Promo plans (gratuitos ocasionales) sin partner override

- `subscription_plans.plan_type='promotional'`. Aplicación dual: redemption_code o
  visible-en-picker (`show_in_picker`).
- **Bloqueado**: NO se permite `partner_plan_overrides` sobre planes promocionales.
  Validar al crear el override O al cambiar plan_type.
- **Sin commission**: el resolver no acrúa partner commission para suscripciones
  con plan promocional.
- Expiración del promo → estado `expired` (no `no_plan`). Cliente re-elige plan.

### G6: Partner = organización con `is_partner=true`

- El partner ES la org. No es entidad separada que "asigna" planes a orgs distintas.
- Si org tiene `is_partner=true`, sus stores reciben `partner_plan_overrides`
  configurados por super-admin para esa org.
- **No hay cambio de partner mid-subscription**. La org no cambia.

### G7: Reactivación de grace/suspended descuenta días en gracia

- Al pagar la deuda atrasada, transición a `active` PERO el nuevo período se acorta:
  `new_period_end = paid_at + plan_duration - days_in_grace`.
- Previene abuso. Esto se calcula en `SubscriptionBillingService.computePeriod()` o
  `SubscriptionPaymentService.handleChargeSuccess()` antes de actualizar `period_end`.

### G8: Reactivación desde cancelled/no_plan/expired = limpia, sin deuda

- Cobro siempre por anticipado → no debería existir deuda histórica al llegar a estos
  estados por flujo natural.
- Cliente reactiva eligiendo plan + pagando ciclo nuevo. **No bloquear** por invoices
  viejos.
- Excepción: estado `blocked` (manual admin lock) NO se reactiva automáticamente. Solo
  super-admin puede desbloquear.

### G9: Card failover entre tarjetas guardadas del cliente

- Si la default falla, antes de avanzar dunning, sistema prueba todas las
  `subscription_payment_methods.state='active'` del cliente en orden de creación.
- La que succeed se promueve a `is_default=true` automáticamente.
- Solo si todas fallan → entonces sí avanza estado dunning (grace_soft, etc.).

### G10: Chargebacks → suspend + reverse + clawback + 2-strike anti-fraud

- Webhook chargeback → `state='suspended'`, `lock_reason='chargeback'`,
  `partner_commissions.state='reversed'`, super-admin notif.
- Si commission `paid` previo → clawback negativo en próximo `partner_payout_batch`.
- 2do chargeback en una org → `organizations.fraud_blocked=true`. Cliente NO puede
  crear stores ni suscribirse. Super-admin valida y desbloquea si aplica.

### G11: Notificaciones lean

- **Cliente recibe email solo en**: payment.failed, grace_hard entrada, suspended,
  chargeback, PM próximo a expirar, T-3 antes de expirar trial.
- **Path feliz silencioso**.
- **Super-admin recibe email solo en**: chargebacks, manual payments registrados,
  intentos de fraude (2do chargeback), promo plans aplicados.

### G12: Cancelación scheduled, reversible libremente

- Cancel UI default = scheduled end-of-period. `scheduled_cancel_at = period_end`.
- Cliente revierte libremente desde UI antes de `period_end`. Sin límite, sin penalty.
- Al `period_end` con `scheduled_cancel_at` no nulo → `state='cancelled'`.

### G13: Single gateway Wompi + COP only + sin IVA

- Subscription billing usa Wompi hardcoded. La abstracción multi-gateway de
  `vendix-payment-processors` aplica solo a pagos de stores ecommerce.
- Solo COP. Sin currency field en plan.
- Régimen simple. `effective_price` es monto final sin IVA discriminado.

### G14: Doble asiento contable al confirmar pago

- Listener post-payment success genera asientos en (a) Vendix-platform y (b)
  store-cliente (gasto admin SaaS). Mapping_key: `saas_subscription_expense`.

---

## Rules

### Rule 1: `SubscriptionAccessService` is consumed inline AND via guard

Provide it from a `@Global()` module so any service can inject it:

```typescript
// SubscriptionsModule
@Global()
@Module({
  providers: [SubscriptionAccessService, SubscriptionResolverService],
  exports: [SubscriptionAccessService],
})
export class SubscriptionsModule {}
```

Guard for controllers (declarative):

```typescript
@UseGuards(AiAccessGuard)
@RequireAIFeature('text_generation')
@Post('generate')
generate(@Body() dto: GenerateDto) { ... }
```

Inline for service cores (imperative, runs under events/jobs too):

```typescript
const result = await this.subscriptionAccess.canUseAIFeature(storeId, feature);
if (result.mode === 'block' && process.env.AI_GATE_ENFORCE !== 'false') {
  const key = (result.reason as keyof typeof ErrorCodes) ?? 'SUBSCRIPTION_005';
  throw new VendixHttpException(ErrorCodes[key] ?? ErrorCodes.SUBSCRIPTION_005);
}
```

### Rule 2: Cache key = `sub:features:{storeId}` with 60s TTL; invalidate synchronously on state change

`SubscriptionResolverService` caches the resolved feature set in Redis. On any transition
(`activate`, `suspend`, `cancel`, partner override toggle, promo apply/expire), call:

```typescript
await this.subscriptionAccess.invalidateCache(storeId);
```

Write-through pattern: read cache -> miss -> resolve from DB -> write cache. Downstream TTL
bounds staleness to 60s if the synchronous invalidation fails.

### Rule 3: Canonical state -> mode mapping

```typescript
switch (state) {
  case 'active':
  case 'trial':
    return { mode: 'allow', severity: 'info' };
  case 'grace_soft':
    return { mode: 'warn', severity: 'warning', reason: 'SUBSCRIPTION_007' };
  case 'grace_hard': {
    const deg = feature?.degradation ?? 'warn';
    return deg === 'block'
      ? { mode: 'block', severity: 'critical', reason: 'SUBSCRIPTION_009' }
      : { mode: 'warn', severity: 'critical', reason: 'SUBSCRIPTION_007' };
  }
  case 'suspended': return { mode: 'block', severity: 'critical', reason: 'SUBSCRIPTION_008' };
  case 'blocked':   return { mode: 'block', severity: 'blocker', reason: 'SUBSCRIPTION_009' };
  case 'cancelled':
  case 'expired':   return { mode: 'block', severity: 'blocker', reason: 'SUBSCRIPTION_003' };
  case 'draft':
  default:          return { mode: 'block', severity: 'blocker', reason: 'SUBSCRIPTION_002' };
}
```

`grace_hard` respects the per-feature `degradation` hint (`warn` or `block`). All other
states are unconditional.

### Rule 4: `STORE_GATE_ENFORCE` controls rollout; default is **log-only**

- `STORE_GATE_ENFORCE=false` (default) -> log-only. Guards and inline checks record
  structured `STORE_GATE_OBSERVATION` / `AI_GATE_OBSERVATION` logs but allow the request
  through. Used for staging/canary and during rollout.
- `STORE_GATE_ENFORCE=true` -> enforce. Block paths throw `VendixHttpException`.

**Backwards-compat alias**: `AI_GATE_ENFORCE` is honored via OR for one release:

```typescript
private isEnforceMode(): boolean {
  return process.env.STORE_GATE_ENFORCE === 'true'
      || process.env.AI_GATE_ENFORCE === 'true';
}
```

Fail-closed / fail-open policy is consistent with the flag:

```typescript
private handleInternalError(err: unknown): AccessCheckResult {
  if (this.isEnforceMode()) {
    return { allowed: false, mode: 'block', severity: 'blocker',
             reason: 'SUBSCRIPTION_INTERNAL_ERROR', subscription_state: 'draft' };
  }
  // log-only: fail-open to preserve existing UX during rollout
  return { allowed: true, mode: 'allow', severity: 'info', subscription_state: 'draft' };
}
```

**Rollout sequence**:

1. Ship code with default `STORE_GATE_ENFORCE=false`.
2. Deploy staging; observe `*_GATE_OBSERVATION outcome=would_block` logs for 24-48h.
3. If 0 false-positives on legitimate routes: flip staging to `true`, run smoke (trial,
   active, grace_*, suspended, blocked, allowlist endpoints).
4. After 24-48h staging green: flip prod in coordinated window. Rollback = restart with
   flag `false` (1 min, no migrations).

### Rule 5: Structured observation logs for every decision

Always emit one JSON log per gate decision so dashboards can measure "would_block" volume
before flipping enforce:

```typescript
this.logger.log(JSON.stringify({
  event: 'AI_GATE_CHECK',
  appKey,
  storeId,
  feature,
  allowed: result.allowed,
  mode: result.mode,
  reason: result.reason,
  state: result.subscription_state,
  enforce: process.env.AI_GATE_ENFORCE !== 'false',
}));
```

For block decisions specifically, use `event: 'AI_GATE_OBSERVATION'` with
`outcome: 'would_block'`.

### Rule 6: Missing storeId in context has a defined policy

Internal callers (jobs, seeds, admin) may have no store context. The guard/inline check
MUST handle this:

- `AiAccessGuard` + no storeId: throw in enforce, log-and-pass in log-only.
- `runSubscriptionGate` + no storeId: treat as internal caller, return early (no gate).

```typescript
const storeId = RequestContextService.getStoreId();
if (!storeId) return; // internal caller, skip gate
```

### Rule 7: `consumeAIQuota` is post-success only, never pre-flight

Quotas are consumed AFTER a successful provider call so failed operations do not decrement
the cap. `canUseAIFeature` is read-only and does NOT increment.

```typescript
// runSubscriptionGate -> throws if blocked
await this.runSubscriptionGate(appKey, featureCategory);

// provider call
const output = await provider.run(input);

// ONLY on success
await this.consumeSubscriptionQuota(featureCategory, output.tokens);
```

### Rule 8: Unknown feature keys are hard-blocked, not silently allowed

```typescript
if (!isAIFeatureKey(feature)) {
  return this.failResult('SUBSCRIPTION_005', 'blocker', 'draft');
}
```

New features ship with an explicit entry in `AI_FEATURE_KEYS` + `FEATURE_QUOTA_CONFIG`.

### Rule 9: Partner overrides are restriction-only; promo overlays are union-of-max

Resolver precedence:

1. Base = `plan.ai_feature_flags`
2. Partner override (if `is_active`): intersect booleans (AND), min() caps, intersect tools
3. Promo overlay (if active per `promotional_applied_at + promo_rules.duration_days`):
   OR booleans, max() caps, union tools

Never use `current_period_end` for overlay expiry — that's a billing concept. Overlay
expiry is always derived from `promo_rules.duration_days`.

### Rule 10: `@RequireAIFeature` + `AiAccessGuard` at the controller

```typescript
import { AiAccessGuard, RequireAIFeature } from '../../subscriptions/guards/ai-access.guard';

@Controller('ai/generate')
export class AIGenerateController {
  @Post()
  @UseGuards(AiAccessGuard)
  @RequireAIFeature('text_generation')
  generate(@Body() dto: GenerateDto) { ... }
}
```

The guard also sets `X-Subscription-Warning: <state>` when `mode === 'warn'` so the
frontend can render a non-blocking banner.

### Rule 11: `StoreOperationsGuard` is global; `@SkipSubscriptionGate` is the only opt-out

The guard is registered as `APP_GUARD` in `AppModule`, so EVERY store endpoint is gated
by default. Filtering happens in the guard (not via `@UseGuards`) for performance and
to make the policy uniform:

```typescript
// app.module.ts
{ provide: APP_GUARD, useClass: StoreOperationsGuard }
```

The guard skips work in this order (cheap checks first):

1. Handler/class has `@SkipSubscriptionGate()` -> pass.
2. HTTP method is GET/HEAD/OPTIONS -> pass (reads always allowed).
3. `req.path` does NOT start with `/api/store/` -> pass (out of scope).
4. `req.path` starts with `/api/store/subscriptions/` -> pass (allowlist hardcoded).
5. `RequestContextService.getStoreId()` is missing -> pass (other guards handle it).
6. `canUseModule(storeId, 'store-operations')` -> apply state mapping.

**When to use `@SkipSubscriptionGate()`**:

- Subscription management endpoints (subscribe, cancel, checkout/preview, checkout/commit).
  Apply at class level on every controller under `domains/store/subscriptions/controllers/`.
- SaaS payment processing (NOT POS payments — those stay gated).
- Notification mark-as-read or any handler that mutates per-user system state, not store
  business data.
- Anything the user must reach even when blocked, otherwise they cannot unblock themselves.

```typescript
import { SkipSubscriptionGate } from '../decorators/skip-subscription-gate.decorator';

@Controller('store/subscriptions')
@SkipSubscriptionGate() // class-level: applies to every handler
export class StoreSubscriptionsController { ... }
```

**Override of the canonical mapping for store-operations**: in `canUseModule`, `grace_soft`
and `grace_hard` are forced to `warn` even if a feature's `degradation` is `'block'`.
Operations are never blocked in grace — only in `suspended/blocked/cancelled/expired/no-sub`:

```typescript
const stateMode = this.stateToMode(resolved.state, undefined);
const mode = stateMode.mode === 'block' && (resolved.state === 'grace_soft' || resolved.state === 'grace_hard')
  ? { mode: 'warn' as const, severity: 'warning' as const, reason: stateMode.reason }
  : stateMode;
```

### Rule 12: Frontend paywall is feature-level, not route-level

No `SubscriptionActiveGuard` is wired to any route. Instead, `subscriptionPaywallInterceptor`
catches HTTP 402/403 with `error_code` in:

```
SUBSCRIPTION_004 | SUBSCRIPTION_005 | SUBSCRIPTION_006
SUBSCRIPTION_008 | SUBSCRIPTION_009
PLAN_001 | TRIAL_001
```

and calls `SubscriptionAccessService.openPaywall(code, message)`. The service maps the
code to a variant (`{ title, ctaLabel, ctaRoute, message }`), sets `isPaywallOpen` signal
to dedupe concurrent requests, and `<app-paywall-outlet />` (mounted once per layout)
renders the modal.

```typescript
// app.config.ts — register AFTER authInterceptorFn
provideHttpClient(withInterceptors([authInterceptorFn, subscriptionPaywallInterceptor]))
```

**Rationale**: route-level redirect feels too heavy. Paywall-on-collision is more
contextual ("you just tried to do X — to do X you need plan Y") and less disruptive
than booting the user to a different screen.

---

## Code Example: Adding a New Gated Feature

Step 1 — Declare the feature key and config:

```typescript
// types/access.types.ts
export const AI_FEATURE_KEYS = [
  'text_generation',
  'streaming_chat',
  'async_queue',
  'rag_embeddings',
  'tool_agents',
  'conversations',
  'semantic_search', // <-- new
] as const;

export const FEATURE_QUOTA_CONFIG: Partial<
  Record<AIFeatureKey, { period: 'daily' | 'monthly'; capField: keyof FeatureConfig }>
> = {
  text_generation: { period: 'monthly', capField: 'monthly_tokens_cap' },
  streaming_chat:  { period: 'daily',   capField: 'daily_messages_cap' },
  async_queue:     { period: 'monthly', capField: 'monthly_jobs_cap' },
  semantic_search: { period: 'monthly', capField: 'indexed_docs_cap' }, // <-- new
};
```

Step 2 — Add the flag to plan seed:

```typescript
// subscription_plans.ai_feature_flags
{
  semantic_search: {
    enabled: true,
    degradation: 'warn', // 'warn' | 'block' during grace_hard
    indexed_docs_cap: 10000,
    period: 'monthly',
  },
}
```

Step 3 — Guard the controller:

```typescript
@Post('search')
@UseGuards(AiAccessGuard)
@RequireAIFeature('semantic_search')
async search(@Body() dto: SearchDto) {
  const out = await this.service.search(dto);
  return out;
}
```

Step 4 — Inline check + quota consumption inside the service:

```typescript
async search(dto: SearchDto) {
  const storeId = RequestContextService.getStoreId();
  if (storeId) {
    const result = await this.access.canUseAIFeature(storeId, 'semantic_search');
    if (result.mode === 'block' && process.env.AI_GATE_ENFORCE !== 'false') {
      const key = (result.reason as keyof typeof ErrorCodes) ?? 'SUBSCRIPTION_005';
      throw new VendixHttpException(ErrorCodes[key]);
    }
  }

  const out = await this.runSearch(dto);

  if (storeId) {
    await this.access.consumeAIQuota(storeId, 'semantic_search', out.doc_count);
  }
  return out;
}
```

Step 5 — Invalidate cache on every subscription state transition:

```typescript
// SubscriptionStateService.transition
await this.prisma.store_subscriptions.update({ where: { id }, data: { state: next } });
await this.access.invalidateCache(storeId); // sync
```

Step 6 — Roll out with `AI_GATE_ENFORCE=false`, observe `AI_GATE_OBSERVATION` logs for a
week, then flip to `true`.

---

## Anti-Patterns

### DON'T: Rely on the guard alone

Internal callers (jobs, events, cron) bypass controllers. Always add an inline check in
the service core so gate rules apply uniformly.

```typescript
// WRONG — job bypasses the guard
@Cron('0 * * * *')
async enrichEmbeddings() {
  for (const store of stores) await this.aiEngine.run(store.id, dto); // no gate!
}

// CORRECT — inline runSubscriptionGate inside AIEngineService.run()
```

### DON'T: Consume quota before the operation succeeds

```typescript
// WRONG — decrements cap even if provider call throws
await this.access.consumeAIQuota(storeId, feature, units);
const out = await provider.run(input);

// CORRECT — consume after
const out = await provider.run(input);
await this.access.consumeAIQuota(storeId, feature, out.tokens);
```

### DON'T: Skip cache invalidation on state transitions

```typescript
// WRONG — store remains blocked for up to 60s after reactivation
await prisma.store_subscriptions.update({ where: { id }, data: { state: 'active' } });

// CORRECT
await prisma.store_subscriptions.update({ where: { id }, data: { state: 'active' } });
await this.access.invalidateCache(storeId);
```

### DON'T: Throw on unknown feature keys downstream

The service MUST return a structured `AccessCheckResult` with `reason: 'SUBSCRIPTION_005'`
instead of crashing, so dashboards can track mapping gaps without 500s.

### DON'T: Use `current_period_end` to decide overlay expiry

`current_period_end` moves on every renewal. Promo expiry is derived from
`promotional_applied_at + promo_rules.duration_days`.

### DON'T: Fail-closed in log-only mode on internal errors

During rollout the gate must NOT break prod. In log-only (`AI_GATE_ENFORCE=false`),
internal errors return `allowed: true`. In enforce, they return `block`.

### DON'T: Treat partner overrides as *additive*

Partner overrides can only DISABLE features or LOWER caps — never enable or raise. The
resolver enforces this via `AND`/`min`; do not bypass by hand.

---

## Verification Checklist

Before merging gate changes:

- [ ] `SubscriptionAccessService` exported from a `@Global()` module
- [ ] `StoreOperationsGuard` registered as `APP_GUARD` in `AppModule` (order: AFTER JwtAuthGuard + RequestContextInterceptor)
- [ ] All controllers under `domains/store/subscriptions/controllers/` decorated with `@SkipSubscriptionGate()` at class level
- [ ] Notifications mark-as-read decorated with `@SkipSubscriptionGate()`
- [ ] Controller handler has `@UseGuards(AiAccessGuard)` AND `@RequireAIFeature('<key>')` for AI-gated endpoints
- [ ] Service core has an inline `canUseAIFeature` check for the same feature key
- [ ] Feature key present in `AI_FEATURE_KEYS` and `FEATURE_QUOTA_CONFIG`
- [ ] `SubscriptionResolverService` cache key is `sub:features:{storeId}` with 60s TTL
- [ ] All state transitions call `await access.invalidateCache(storeId)` synchronously
- [ ] `grace_hard` branch consults `feature?.degradation` (`'warn' | 'block'`) for AI features
- [ ] `canUseModule` overrides grace_* to `warn` (operations never blocked in grace)
- [ ] `STORE_GATE_ENFORCE` flag checked, with `AI_GATE_ENFORCE` honored as backwards-compat alias
- [ ] Log-only mode fails OPEN on internal errors; enforce mode fails CLOSED
- [ ] `STORE_GATE_OBSERVATION` and `AI_GATE_CHECK`/`AI_GATE_OBSERVATION` structured logs emitted for every decision
- [ ] `consumeAIQuota` called AFTER successful provider call, never before
- [ ] Missing storeId in context returns early (internal caller) instead of blocking
- [ ] Unknown feature keys return `SUBSCRIPTION_005` (not throw)
- [ ] **Subscribe controller validates `plan.state === 'active'`** before creating subscription (not just `archived_at`)
- [ ] `GET /api/store/subscriptions/plans` filters `state=active AND resellable=true AND archived_at IS NULL AND is_promotional=false`
- [ ] Frontend `subscriptionPaywallInterceptor` registered AFTER `authInterceptorFn` in `withInterceptors([...])`
- [ ] `<app-paywall-outlet />` mounted in store-admin, organization-admin, and super-admin layouts
- [ ] `openPaywall(code)` dedupes via `isPaywallOpen` signal — concurrent calls are no-ops
- [ ] No `SubscriptionActiveGuard` wired to routes (paywall-on-collision is the chosen UX)

---

## Related Skills

- `vendix-redis-quota` — underlying Redis INCR+EXPIRE counter pattern used by `consumeAIQuota`
- `vendix-saas-billing` — drives `store_subscription_state_enum` transitions
- `vendix-error-handling` — `SUBSCRIPTION_001..SUBSCRIPTION_010` error codes
- `vendix-multi-tenant-context` — how `RequestContextService.getStoreId()` is populated
- `vendix-ai-engine` — primary inline consumer of the gate
