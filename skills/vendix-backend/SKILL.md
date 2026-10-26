---
name: vendix-backend
description: >
  NestJS backend patterns for Vendix: domain architecture, API endpoints, ResponseService,
  DTOs, scoped Prisma, guards, module registration. Trigger: editing apps/backend, creating
  modules or API endpoints, working on backend domains.
license: MIT
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "Editing files in apps/backend/, creating modules, or working with Prisma"
    - "Creating API endpoints"
    - "Working on backend domains"
---

# Vendix Backend

## Source of Truth

- `apps/backend/src/domains/` (controllers: `domains/**/**/*.controller.ts`)
- `apps/backend/src/app.module.ts`
- `apps/backend/src/prisma/services/`
- `apps/backend/src/common/responses/response.service.ts`
- `apps/backend/src/common/errors/`
- `apps/backend/src/main.ts`

## Architecture

Backend code lives mainly under `apps/backend/src/domains/`, plus shared `common/`, `prisma/`, `ai-engine/`, and infrastructure modules. Do not create new feature folders under the old `src/features/` pattern.

Domain folders: `superadmin/`, `organization/`, `store/`, `ecommerce/`, `auth/`, `public/`.

## Standard Module Shape

Follow existing domain folder conventions:

```text
apps/backend/src/domains/<domain>/<module>/
  <module>.module.ts
  <module>.controller.ts
  <module>.service.ts
  dto/
```

Some established modules have nested submodules or shared services. Match the nearest existing pattern.

## Domain Runtime (cross-cutting)

Domain services run under:

- global `JwtAuthGuard`
- global `StoreOperationsGuard`
- `RequestContextInterceptor`
- scoped Prisma services and AsyncLocalStorage request context

Understand these layers before adding manual tenant/auth logic. Current tenancy does not depend on route params like `domains/:domain_id/...`.

**Shared service ownership:** if a shared service is exported by another module, import the owning module instead of duplicating the provider in your module. This avoids dependency drift when shared services gain new dependencies.

## Prisma Services

Use the domain-appropriate Prisma service:

| Context | Service |
| --- | --- |
| superadmin/system | `GlobalPrismaService` |
| organization admin | `OrganizationPrismaService` |
| store admin/POS | `StorePrismaService` |
| ecommerce customer/public store | `EcommercePrismaService` |

If adding a new model, register it in scoped Prisma services before relying on automatic tenant filters. See `vendix-prisma-scopes`.

Module registration: never add the scoped Prisma services to `providers:`/`exports:` of a domain module (nor import `PrismaModule`); they are `@Global()` singletons from `PrismaModule`. A re-declaration spawns another `PrismaClient` (~68 MB heap each) and drops `@Optional` deps. See "Singleton Rule" in `vendix-prisma-scopes`; the CI guard "Prisma Singleton Audit" enforces it (`npm run prisma-singleton:audit`).

## API Endpoints

### Routing

Controllers use flat namespaced prefixes: `store/...`, `organization/...`, `superadmin/...`, `public/...`. Do not document old `domains/:domain_id/...` route patterns unless explicitly working with legacy code.

### Controller Rules

- Controllers stay thin: params/query/body DTOs, decorators/guards, one call into a service.
- Services own business logic and Prisma access.
- Use DTOs with global `ValidationPipe` rather than ad-hoc parsing.
- Protect routes with the existing auth/permissions patterns where needed.

### ResponseService

`ResponseService` exposes helpers including:

- `success(data, message?, meta?)`
- `paginated(data, total, page, limit, message?)`
- `noContent(message?)`
- `created(data, message?)`
- `updated(data, message?)`
- `deleted(message?)`

Use the helper that matches the intent rather than always falling back to `success()`.

### Pagination

Paginated services typically return raw `data + total + page + limit` inputs to the controller/response helper, not a nested `{ data, meta }` structure for `ResponseService.paginated()`.

## Validation And Errors

- Global `ValidationPipe` is configured in `main.ts`; use class-validator DTOs.
- Use `VendixHttpException` and registered `ErrorCodes` when standardized domain errors exist.
- Keep validation/business checks as early throws in services.

## Commands

```bash
npm run prisma:generate -w apps/backend
npm run db:migrate:dev -w apps/backend
npm run db:migrate:prod -w apps/backend
npm run db:seed -w apps/backend
docker logs --tail 40 vendix_backend
npm run prisma-singleton:audit   # before pushing any backend *.module.ts change
```

Do not run destructive reset/clean commands unless explicitly requested.

## Related Skills

- `vendix-prisma`
- `vendix-prisma-scopes`
- `vendix-backend-auth`
- `vendix-backend-middleware`
- `vendix-validation`
- `vendix-error-handling`
