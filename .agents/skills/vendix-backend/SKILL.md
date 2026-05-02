---
name: vendix-backend
description: >
  NestJS backend patterns for Vendix domains, controllers, services, DTOs, scoped Prisma,
  auth/permissions, validation, and module registration. Trigger: When editing files in
  apps/backend/, creating modules, or working with Prisma.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Editing files in apps/backend/, creating modules, or working with Prisma"
---

# Vendix Backend

## Architecture

Backend code lives mainly under `apps/backend/src/domains/`, plus shared `common/`, `prisma/`, `ai-engine/`, and infrastructure modules. Do not create new feature folders under the old `src/features/` pattern.

Common domain areas:

- `domains/superadmin/`
- `domains/organization/`
- `domains/store/`
- `domains/ecommerce/`
- `domains/auth/`

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

## Prisma Services

Use the domain-appropriate Prisma service:

| Context | Service |
| --- | --- |
| superadmin/system | `GlobalPrismaService` |
| organization admin | `OrganizationPrismaService` |
| store admin/POS | `StorePrismaService` |
| ecommerce customer/public store | `EcommercePrismaService` |

If adding a new model, register it in scoped Prisma services before relying on automatic tenant filters. See `vendix-prisma-scopes`.

## Controller Rules

- Controllers should stay thin: parse params, apply guards/decorators, call services.
- Use DTOs for request bodies and query payloads.
- Protect routes with the existing auth/permissions patterns where needed.
- Domain services own business logic and Prisma calls.

## Validation And Errors

- Global `ValidationPipe` is configured in `main.ts`; use class-validator DTOs.
- Use `VendixHttpException` and registered `ErrorCodes` where available.
- Keep validation/business checks as early throws in services.

## Commands

```bash
npm run prisma:generate -w apps/backend
npm run db:migrate:dev -w apps/backend
npm run db:migrate:prod -w apps/backend
npm run db:seed -w apps/backend
docker logs --tail 40 vendix_backend
```

Do not run destructive reset/clean commands unless explicitly requested.

## Related Skills

- `vendix-prisma`
- `vendix-prisma-scopes`
- `vendix-backend-auth`
- `vendix-backend-api`
- `vendix-validation`
- `vendix-error-handling`
