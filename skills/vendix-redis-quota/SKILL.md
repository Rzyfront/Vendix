---
name: vendix-redis-quota
description: >
  Periodic quota counter pattern using Redis INCR + EXPIRE with period-keyed storage
  (YYYYMMDD daily / YYYYMM monthly UTC). Auto-resets at period rollover, survives TTL
  extensions, and is post-success consumption (never pre-flight). Reusable for AI tokens,
  email sends, exports, uploads — any "N per period" quota.
  Trigger: When building a periodic quota counter, rate-limit by calendar window,
  feature cap enforcement (monthly tokens, daily messages), or reusing INCR+EXPIRE pattern.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Adding a monthly or daily Redis quota counter"
    - "Rate-limiting by calendar period (not sliding window)"
    - "Implementing feature caps with auto-reset at period rollover"
    - "Reusing INCR+EXPIRE pattern outside AI (uploads, emails, exports)"
    - "Debugging over-quota bypass or double-count on provider retries"
    - "Period-keyed counters YYYYMM / YYYYMMDD"
---

# Vendix Redis Quota - Period-Keyed INCR+EXPIRE Counters

> Reusable "N per calendar period" counter pattern. Period-keyed Redis keys roll over to
> fresh counters automatically at period boundary — no background reset job needed.

## When to Use

- Enforcing "monthly tokens cap" or "daily messages cap" on AI features
- Building ANY per-period quota: email sends, file uploads, PDF exports, API calls
- Replacing a sliding-window rate limiter with a calendar-window quota
- Checking remaining units before an operation and decrementing after success

Do NOT use this pattern when:

- Strict cross-request idempotency matters (see "Known limitation" below)
- Sliding windows are required (use a separate token-bucket/leaky-bucket library)

---

## Key Files

| File | Purpose |
|------|---------|
| `apps/backend/src/domains/store/subscriptions/services/subscription-access.service.ts` | Reference implementation: `canUseAIFeature` (check), `consumeAIQuota` (incr) |
| `apps/backend/src/common/redis/redis.module.ts` | `REDIS_CLIENT` ioredis provider |
| `apps/backend/src/domains/store/subscriptions/types/access.types.ts` | `FEATURE_QUOTA_CONFIG` mapping feature -> period + cap field |

---

## Architecture

```
Request -> canUseFeature(entityId, feature)
             |
             v
       GET {domain}:quota:{entityId}:{feature}:{periodKey}
             |  current
             v
       current >= cap ?  -> return { exceeded: true, remaining: 0 }  -> 403
             |  no
             v
       return { allowed: true, remaining: cap - current }

Operation runs...

On success -> consumeQuota(entityId, feature, units)
                  |
                  v
          pipeline:
            INCRBY key units
            EXPIRE key <period-ttl>
                  |
                  v
          next GET sees the updated counter
```

Period rollover is automatic because the **key changes** (`YYYYMM` -> next month is a new
key). The old key eventually expires via its TTL.

---

## Rules

### Rule 1: Key pattern is `{domain}:quota:{entityId}:{feature}:{periodKey}`

```typescript
// AI reference:  ai:quota:{storeId}:{feature}:{YYYYMM|YYYYMMDD}
private quotaKey(storeId: number, feature: string, periodKey: string): string {
  return `ai:quota:${storeId}:${feature}:${periodKey}`;
}

// Generic form for other domains:
// emails:quota:{storeId}:transactional:YYYYMM
// exports:quota:{orgId}:pdf:YYYYMMDD
```

The `entityId` must be validated as an integer before use to prevent Redis key injection:

```typescript
if (!Number.isInteger(storeId) || storeId <= 0) return;
```

### Rule 2: `periodKey` derivation in UTC

```typescript
private periodKey(period: 'daily' | 'monthly'): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  if (period === 'monthly') return `${y}${m}`;       // YYYYMM
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;                              // YYYYMMDD
}
```

Always UTC — local time zones cause cross-region inconsistency and DST anomalies at
period boundaries.

### Rule 3: Consume with INCRBY + EXPIRE in a single pipeline

```typescript
const pipeline = this.redis.pipeline();
pipeline.incrby(key, Math.floor(units));
pipeline.expire(key, ttlSeconds);
await pipeline.exec();
```

Extending TTL on an existing key within the same period is harmless — the next period uses
a different key anyway. This avoids the cost of a Lua script or a `GET+SETEX` dance while
still guaranteeing the key will not live forever.

> **Idempotency note**: bare INCR/INCRBY is **not** idempotent across provider retries. If
> you need strict idempotency, pass a per-request identifier (`X-Request-Id`) and use a
> Lua script that checks a dedup set before incrementing. This is a known limitation of
> the current implementation and should be tracked as a knowledge gap for strict flows.

### Rule 4: Check remaining BEFORE consuming; consume only on success

```typescript
// 1. CHECK (read-only, no INCR)
const quota = await this.checkQuotaRemaining(entityId, feature, config);
if (quota.exceeded) {
  return { allowed: false, reason: 'SUBSCRIPTION_006', remaining: quota.remaining };
}

// 2. DO THE WORK
const result = await provider.run(input);

// 3. CONSUME (only if the work succeeded)
await this.consumeQuota(entityId, feature, result.units);
```

This prevents failed/retried operations from permanently burning quota.

### Rule 5: TTL over-provisions the period

TTL should be **longer** than the period so the key is guaranteed present during its
entire period, but short enough to clean up eventually:

```typescript
private ttlForPeriod(period: 'daily' | 'monthly'): number {
  if (period === 'daily')   return 48 * 60 * 60;        // 48h  (2x the period)
  return 40 * 24 * 60 * 60;                              // 40d  (~1.3x the period)
}
```

Not setting a TTL is a memory leak — Redis keeps the key forever.

### Rule 6: Reading remaining is a GET + parseInt; missing key means 0

```typescript
const raw = await this.redis.get(key);
const current = raw ? parseInt(raw, 10) : 0;
const safeCurrent = Number.isFinite(current) ? current : 0;
const remaining = Math.max(0, cap - safeCurrent);
```

Missing key = fresh period = 0 consumed. Never treat `null` as an error.

### Rule 7: Consume path is best-effort; never throws

Quota accounting is observational. If Redis is temporarily unavailable the operation
already succeeded — failing here would penalize the caller for an infra issue.

```typescript
try {
  const pipeline = this.redis.pipeline();
  pipeline.incrby(key, Math.floor(units));
  pipeline.expire(key, ttlSeconds);
  await pipeline.exec();
} catch (err) {
  this.logger.warn(`consumeQuota failed: ${(err as Error).message}`);
  // swallow — never throw
}
```

The check path, by contrast, MAY fail-closed or fail-open depending on the enforce flag
of the surrounding gate (see `vendix-subscription-gate`).

### Rule 8: Unlimited caps are represented as `null` or `<= 0`, not a huge number

```typescript
const cap = config[quotaCfg.capField];
if (typeof cap !== 'number' || cap <= 0) {
  return { exceeded: false }; // unlimited
}
```

Never encode "unlimited" as `Number.MAX_SAFE_INTEGER` — it pollutes logs and dashboards.

### Rule 9: Units must be a positive integer; floor non-integers

```typescript
if (!Number.isFinite(units) || units <= 0) return;
pipeline.incrby(key, Math.floor(units));
```

Prevents negative decrements, NaN, and Redis protocol errors on fractional values.

### Rule 10: Cap mapping is configuration, not code

Feature -> period + cap field lives in a single table so adding a new gated feature is
one entry:

```typescript
export const FEATURE_QUOTA_CONFIG: Partial<
  Record<AIFeatureKey, { period: 'daily' | 'monthly'; capField: keyof FeatureConfig }>
> = {
  text_generation: { period: 'monthly', capField: 'monthly_tokens_cap' },
  streaming_chat:  { period: 'daily',   capField: 'daily_messages_cap' },
  async_queue:     { period: 'monthly', capField: 'monthly_jobs_cap' },
  rag_embeddings:  { period: 'monthly', capField: 'indexed_docs_cap' },
};
```

---

## Code Example: Full Check + Consume Pair

```typescript
@Injectable()
export class RedisQuotaService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Read-only: returns { exceeded, remaining }.
   */
  async checkQuotaRemaining(
    entityId: number,
    feature: string,
    cap: number,
    period: 'daily' | 'monthly',
  ): Promise<{ exceeded: boolean; remaining: number }> {
    if (!Number.isInteger(entityId) || entityId <= 0) {
      return { exceeded: true, remaining: 0 };
    }
    if (typeof cap !== 'number' || cap <= 0) {
      return { exceeded: false, remaining: Number.POSITIVE_INFINITY };
    }

    const key = this.quotaKey('ai', entityId, feature, this.periodKey(period));
    const raw = await this.redis.get(key);
    const current = raw ? parseInt(raw, 10) : 0;
    const safeCurrent = Number.isFinite(current) ? current : 0;

    return {
      exceeded: safeCurrent >= cap,
      remaining: Math.max(0, cap - safeCurrent),
    };
  }

  /**
   * Best-effort INCR+EXPIRE. Never throws.
   */
  async consumeQuota(
    entityId: number,
    feature: string,
    units: number,
    period: 'daily' | 'monthly',
  ): Promise<void> {
    if (!Number.isInteger(entityId) || entityId <= 0) return;
    if (!Number.isFinite(units) || units <= 0) return;

    const key = this.quotaKey('ai', entityId, feature, this.periodKey(period));
    const ttl = this.ttlForPeriod(period);

    try {
      const pipeline = this.redis.pipeline();
      pipeline.incrby(key, Math.floor(units));
      pipeline.expire(key, ttl);
      await pipeline.exec();
    } catch (err) {
      this.logger.warn(`consumeQuota failed: ${(err as Error).message}`);
    }
  }

  private quotaKey(domain: string, entityId: number, feature: string, periodKey: string) {
    return `${domain}:quota:${entityId}:${feature}:${periodKey}`;
  }

  private periodKey(period: 'daily' | 'monthly'): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    if (period === 'monthly') return `${y}${m}`;
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  private ttlForPeriod(period: 'daily' | 'monthly'): number {
    return period === 'daily' ? 48 * 60 * 60 : 40 * 24 * 60 * 60;
  }
}
```

---

## Code Example: Reusing for Non-AI Domains

Emails per store per month:

```typescript
// Outbound email sender
const cap = storePlan.monthly_email_cap ?? 10_000;
const check = await this.quota.checkQuotaRemaining(storeId, 'transactional_email', cap, 'monthly');
if (check.exceeded) {
  throw new VendixHttpException(ErrorCodes.EMAIL_QUOTA_001);
}

await this.mailer.send(message);
await this.quota.consumeQuota(storeId, 'transactional_email', 1, 'monthly');
```

PDF exports per user per day:

```typescript
const check = await this.quota.checkQuotaRemaining(userId, 'pdf_export', 50, 'daily');
if (check.exceeded) throw new VendixHttpException(ErrorCodes.EXPORT_QUOTA_001);

const pdf = await this.renderer.render(dto);
await this.quota.consumeQuota(userId, 'pdf_export', 1, 'daily');
return pdf;
```

Note the key pattern becomes `ai:quota:...` for AI, but you can change the `domain`
prefix (`emails:quota:...`, `exports:quota:...`) to keep metrics partitioned.

---

## Anti-Patterns

### DON'T: Consume before the operation (pre-flight INCR)

```typescript
// WRONG — failed/retried op burns quota permanently
await this.quota.consumeQuota(storeId, feature, units);
const out = await provider.run(input); // may throw

// CORRECT — consume on success only
const out = await provider.run(input);
await this.quota.consumeQuota(storeId, feature, out.units);
```

### DON'T: Skip `EXPIRE` (or set it on a separate call outside the pipeline)

```typescript
// WRONG — key lives forever (memory leak)
await this.redis.incrby(key, units);

// WRONG — EXPIRE may not run if the process dies between calls
await this.redis.incrby(key, units);
await this.redis.expire(key, ttl);

// CORRECT — pipeline (atomic batch)
const p = this.redis.pipeline();
p.incrby(key, units);
p.expire(key, ttl);
await p.exec();
```

### DON'T: Use local time for the period key

```typescript
// WRONG — cross-region inconsistency
const m = String(now.getMonth() + 1).padStart(2, '0'); // local tz

// CORRECT — always UTC
const m = String(now.getUTCMonth() + 1).padStart(2, '0');
```

### DON'T: Throw from the consume path on Redis errors

The operation already succeeded. Swallow and log.

```typescript
// WRONG
try { await pipeline.exec(); } catch (e) { throw e; }

// CORRECT
try { await pipeline.exec(); } catch (e) { this.logger.warn(...); }
```

### DON'T: Represent "unlimited" as `Number.MAX_SAFE_INTEGER`

```typescript
// WRONG — skews dashboards, arithmetic overflow risks
const cap = plan.monthly_cap ?? Number.MAX_SAFE_INTEGER;

// CORRECT — null/undefined/<=0 means no cap
const cap = plan.monthly_cap;
if (typeof cap !== 'number' || cap <= 0) return { exceeded: false };
```

### DON'T: Assume INCR is idempotent across retries

If a client retries a request, INCR will run twice. For strict accounting use a Lua script
with a dedup set keyed on `X-Request-Id`:

```lua
-- pseudocode
if redis.call('SADD', dedup_key, request_id) == 1 then
  redis.call('INCRBY', quota_key, units)
  redis.call('EXPIRE', quota_key, ttl)
  redis.call('EXPIRE', dedup_key, ttl)
end
```

### DON'T: Reuse the same key across period changes

Let the period rollover produce a new key naturally — never `DEL` + `SET` to "reset".
That introduces a race where two requests can both see 0 and pass.

---

## Verification Checklist

Before shipping a new quota flow:

- [ ] Key pattern is `{domain}:quota:{entityId}:{feature}:{periodKey}`
- [ ] `entityId` validated as a positive integer before interpolation
- [ ] `periodKey` derived in UTC (`YYYYMM` or `YYYYMMDD`)
- [ ] TTL is at least ~1.3x the period length (40d for monthly, 48h for daily)
- [ ] INCRBY + EXPIRE issued in a single `redis.pipeline()`
- [ ] Units floored to integer; NaN/negative short-circuited early
- [ ] Check is read-only GET; consume is INCR+EXPIRE only
- [ ] Consume is called ONLY on operation success
- [ ] Consume swallows Redis errors (log warn, never throw)
- [ ] Unlimited cap represented as `null`/`0`, not a sentinel integer
- [ ] Feature -> period+cap mapping in one config table (not scattered)
- [ ] If strict idempotency is required, request-id dedup Lua script added (else
      document as "known limitation: double-count on retries")

---

## Related Skills

- `vendix-subscription-gate` — consumes this pattern via `consumeAIQuota` / `canUseAIFeature`
- `vendix-saas-billing` — caps are defined in plan JSON; invoice emission is unrelated but
  orthogonal to quota
- `vendix-error-handling` — `SUBSCRIPTION_006` is the canonical "quota exceeded" code for
  AI features; domain-specific codes (e.g. `EMAIL_QUOTA_001`) follow the same convention
