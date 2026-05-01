---
name: vendix-redis-quota
description: >
  Periodic quota counters with Redis, UTC period keys, Lua-based idempotent AI quota
  consumption, request-id deduplication, and post-success consumption. Trigger: When
  building quota counters, enforcing monthly/daily feature caps, or reusing AI quota
  patterns for uploads, emails, exports, or rate-limited features.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "Adding a monthly or daily Redis quota counter"
    - "Implementing feature caps with auto-reset at period rollover"
    - "Rate-limiting by calendar period (not sliding window)"
    - "Reusing INCR+EXPIRE pattern outside AI (uploads, emails, exports)"
    - "Debugging over-quota bypass or double-count on provider retries"
    - "Period-keyed counters YYYYMM / YYYYMMDD"
---

# Vendix Redis Quota

## Source of Truth

- `apps/backend/src/domains/store/subscriptions/services/subscription-access.service.ts`
- `apps/backend/src/domains/store/subscriptions/types/access.types.ts`
- `apps/backend/src/common/redis/redis.module.ts`

## Current AI Pattern

AI quota checks are read-only. Consumption happens only after a successful operation and requires a stable `requestId`.

- Quota key: `ai:quota:{storeId}:{feature}:{period}`.
- Dedup key: `ai:quota:dedup:{storeId}:{feature}:{period}`.
- Period keys use UTC: `YYYYMMDD` for daily, `YYYYMM` for monthly.
- `consumeAIQuota()` requires non-empty `requestId`; missing request id throws `InternalServerErrorException`.
- Consumption uses Redis Lua `eval` to deduplicate by request id and increment quota once.
- Redis errors during consumption are logged/swallowed because the AI operation already succeeded.

## Rules

- Check quota before work; consume only after success.
- Never pre-increment before provider/API work.
- Use UTC period keys to avoid timezone/DST rollover bugs.
- Validate entity ids before interpolating Redis keys.
- Units must be positive integers; floor fractional units when needed.
- Unlimited quota is represented by null, undefined, or `<= 0`, not a huge sentinel number.
- TTL should outlive the period enough for cleanup: daily about 48h, monthly about 40d.
- If strict retry idempotency matters, require a request id and dedup key.

## Generic Non-AI Reuse

For non-AI quotas, either reuse the same Lua+dedup approach or create a dedicated quota service. Use domain-specific prefixes like:

- `emails:quota:{storeId}:transactional:{YYYYMM}`
- `exports:quota:{userId}:pdf:{YYYYMMDD}`
- `uploads:quota:{storeId}:images:{YYYYMM}`

Do not copy old bare `INCRBY + EXPIRE` examples for flows where duplicate retries matter.

## Failure Semantics

- Check path can fail open or closed depending on the surrounding gate policy.
- Consume path should not throw for Redis infrastructure errors after the protected operation succeeded.
- Missing `requestId` is a programming error in the current AI implementation and should not be swallowed.

## Related Skills

- `vendix-subscription-gate`
- `vendix-ai-platform-core`
- `vendix-error-handling`
