---
name: vendix-frontend-cache
description: >
  Frontend caching patterns for Vendix Angular services: shareReplay TTL caches, instance
  fields, module-level Map caches, parameterized cache keys, and invalidation after writes.
  Trigger: When caching frontend HTTP data or reducing repeated dashboard/report requests.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Caching frontend HTTP/dashboard/report data"
---

# Vendix Frontend Cache

## Source of Truth

Representative patterns live in:

- `.../super-admin/dashboard/services/super-admin-dashboard.service.ts`
- `.../organization/dashboard/services/organization-dashboard.service.ts`
- `.../store/reports/services/reports-data.service.ts`

## Current Reality

Vendix does not use one single cache shape.

Current patterns include:

- service instance fields with TTL timestamps
- module-level `Map` caches keyed by params/entity ids
- helper methods like `withCache(key, factory)`
- `shareReplay({ bufferSize: 1, refCount: true })` and also `refCount: false`

Do not document a false rule that Angular service instances are always recreated on navigation or that all caches must be static globals.

## Rules

- Pick cache shape based on the endpoint usage pattern, not ideology.
- Use stable cache keys when params/date ranges/entity ids change the result.
- Invalidate cache after writes that make the cached view stale.
- Avoid caching obviously real-time or rapidly changing streams unless the feature explicitly accepts staleness.
- Use short TTLs for dashboards/stats unless there is a stronger product reason.

## Related Skills

- `vendix-frontend-state`
- `vendix-zoneless-signals`
- `vendix-frontend-data-display`
