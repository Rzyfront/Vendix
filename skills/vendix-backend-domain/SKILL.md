---
name: vendix-backend-domain
description: >
  Backend domain architecture for Vendix: domains/* organization, flat namespaced
  controllers, scoped Prisma services, global guards/interceptors, and shared-service
  module ownership. Trigger: When working on backend domains.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Working on backend domains"
---

# Vendix Backend Domain

## Source of Truth

- `apps/backend/src/domains/`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/prisma/services/`

## Current Architecture

Vendix backend is organized by domain folders such as `auth`, `organization`, `store`, `ecommerce`, `superadmin`, and `public`.

Controllers use flat namespaced routes like `store/...`, `organization/...`, `superadmin/...`, and `public/...`; current tenancy does not depend on route params like `domains/:domain_id/...`.

## Cross-Cutting Runtime

Domain services run under:

- global `JwtAuthGuard`
- global `StoreOperationsGuard`
- `RequestContextInterceptor`
- scoped Prisma services and AsyncLocalStorage request context

Understand these layers before adding manual tenant/auth logic.

## Shared Service Ownership Rule

If a shared service is exported by another module, import the owning module instead of duplicating the provider in your module. This avoids dependency drift when shared services gain new dependencies.

## Related Skills

- `vendix-backend`
- `vendix-backend-api`
- `vendix-prisma-scopes`
- `vendix-backend-middleware`
