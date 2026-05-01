---
name: vendix-multi-tenant-context
description: >
  Backend tenant context bridge from ecommerce domain resolution and JWT user context into AsyncLocalStorage.
  Trigger: Handling store context, implementing multi-tenant logic, or fixing Forbidden/403 errors in scoped services.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Handling store context"
    - "Implementing multi-tenant logic"
    - "Fixing Forbidden/403 errors in scoped services"
---

# Vendix Multi-Tenant Context

## Purpose

Use this skill for backend request context: how store/organization/user data reaches `RequestContextService` and scoped Prisma services.

## Real Context Flow

1. `DomainResolverMiddleware` is registered globally, but it only resolves domain context for URLs containing `/ecommerce/`.
2. For ecommerce routes, it first accepts `x-store-id` header or `store_id` query param.
3. If no explicit store is provided, it resolves hostname through cache and `PublicDomainsService.resolveDomain()`.
4. It writes `{ store_id, organization_id? }` to `req['domain_context']` and continues even if resolution fails.
5. `RequestContextInterceptor` merges JWT `req.user` and `domain_context` into AsyncLocalStorage.

Key files:

- `apps/backend/src/common/middleware/domain-resolver.middleware.ts`
- `apps/backend/src/common/interceptors/request-context.interceptor.ts`
- `apps/backend/src/common/context/request-context.service.ts`

## Precedence Rules

- JWT user context fills `user_id`, `organization_id`, `store_id`, roles, permissions, and flags first.
- Ecommerce `domain_context.store_id` overwrites `context.store_id`.
- Ecommerce `domain_context.organization_id` fills `organization_id` only when JWT did not provide one.
- Non-ecommerce routes usually rely on JWT/user context, not hostname resolution.

## Scoped Prisma Services

| Service | Scope |
| --- | --- |
| `GlobalPrismaService` | No tenant scope; use for superadmin/system operations only |
| `OrganizationPrismaService` | Organization-scoped models |
| `StorePrismaService` | Store/organization-scoped models |
| `EcommercePrismaService` | Ecommerce store/customer scoped access |

Model lists change over time. Treat the arrays inside the Prisma scoped service files as canonical instead of copying exhaustive lists into skills.

## Guardrails

- Do not use `GlobalPrismaService` for tenant data unless the use case is explicitly system-level or the code manually scopes the query.
- Do not rely on frontend-selected store IDs for authorization.
- Raw SQL and Prisma `$queryRaw` bypass scoped-service extensions; add explicit tenant filters.
- The current `RequestContextService` has a static `currentContext` fallback; treat it as existing behavior, not a pattern to expand.

## Debugging 403 / Missing Context

Check:

1. Is the route ecommerce? If not, domain middleware will not resolve hostname context.
2. Does JWT include the expected `organization_id` and `store_id`?
3. For ecommerce, is `x-store-id`, `store_id` query, or host domain resolving correctly?
4. Is the model registered in the correct scoped Prisma service?
5. Is raw SQL missing explicit tenant filters?

## Related Skills

- `vendix-prisma-scopes` - Scoped Prisma model registration
- `vendix-backend-auth` - JWT, public routes, guards
- `vendix-app-architecture` - App/domain concepts
- `vendix-mcp-server` - MCP auth/context injection
