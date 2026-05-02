---
name: vendix-prisma-scopes
description: >
  Multi-tenant Prisma scoping system for Vendix: BasePrismaService, Global/Organization/Store/Ecommerce
  scoped services, model registration, manual-scope caveats, and withoutScope rules.
  Trigger: When working with Prisma scoped services, adding models to scopes, or debugging
  Forbidden/Unauthorized errors in database queries.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "Working with Prisma scoped services"
    - "Adding new models to domain scopes"
    - "Debugging Forbidden errors in Prisma queries"
---

## Source of Truth

- Base: `apps/backend/src/prisma/base/base-prisma.service.ts`.
- Services: `apps/backend/src/prisma/services/`.
- Module: `apps/backend/src/prisma/prisma.module.ts`.

## Services

| Service | Scope | Use |
| --- | --- | --- |
| `GlobalPrismaService` | none | super-admin, jobs, cross-tenant/system operations |
| `OrganizationPrismaService` | `organization_id` | organization admin domains |
| `StorePrismaService` | `store_id` plus org where applicable | store admin/POS/store domains |
| `EcommercePrismaService` | `store_id` plus user/customer where applicable | customer ecommerce domains |

`PrismaModule` exports all four services plus `RequestContextService`, `AccessValidationService`, and `StoreContextRunner`.

## BasePrismaService

Current base uses Prisma 7 with `pg.Pool`, `PrismaPg` adapter, and `new PrismaClient({ adapter, log: ['error', 'warn'] })`.

`withoutScope()` returns the raw base client. It bypasses all tenant isolation.

## Registration Rule

Getter access is not enough. A model is scoped only if it is registered in the relevant extension arrays/maps used by that service.

When adding a model:

1. Identify the domain service that will access it.
2. Determine direct tenant fields (`store_id`, `organization_id`) or relational parent scope.
3. Add it to the service's scoped model list or relational scope map.
4. Add/verify getter returns `scoped_client` only when the extension really handles it.
5. Verify creates inject expected tenant fields when supported.

## Service Caveats

`OrganizationPrismaService`:

- Scopes read/update/delete/count/group/aggregate/upsert operations.
- Does not scope `create`/`createMany`.
- `roles` includes org roles plus system roles where `organization_id = null`.
- Some getters return `scoped_client` but are not registered in org model lists; inspect source before assuming scope.
- `organization_payment_policies` is registered but getter currently returns `baseClient`.

`StorePrismaService`:

- Scopes reads/updates/deletes and injects `store_id` on create only for `store_scoped_models`.
- Has direct store models, relational scopes, and org-scoped model lists.
- Several getters intentionally return `baseClient` and require manual scoping, including examples like `users`, `stores`, `audit_logs`, `product_categories`, `customer_queue`, and `invoice_data_requests`.

`EcommercePrismaService`:

- Requires `store_id`; throws if missing.
- Injects `store_id` and user/customer fields on create when model type supports it.
- Some getters return `scoped_client` for models not registered in all model lists; inspect source before relying on automatic scope.
- `review_votes` and `review_reports` currently return `baseClient`.

## withoutScope Rules

- Never use `withoutScope()` in request handlers unless explicitly approved.
- Prefer registering the model correctly or using the semantically correct service.
- Acceptable cases: seeds, migrations, background jobs without request context, explicit super-admin cross-tenant operations, webhooks with explicit tenant extraction.
- Raw SQL bypasses Prisma extensions; add explicit tenant filters manually.

## Troubleshooting

- `ForbiddenException`: missing store/org context or model expects scope but context was not populated.
- `UnauthorizedException`: no request context, often a job/script using a scoped service.
- Data leak risk: getter returns `baseClient` or model missing from extension registration.
- Missing create tenant fields: model not in direct scoped model list.

## Related Skills

- `vendix-multi-tenant-context`
- `vendix-prisma-schema`
- `vendix-prisma-migrations`
- `vendix-backend-domain`
