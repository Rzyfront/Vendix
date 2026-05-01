---
name: vendix-backend-auth
description: >
  Backend authentication and authorization patterns: global JWT guard, public/optional auth, roles, permissions, and request user shape.
  Trigger: When implementing authentication, editing auth guards/decorators, or protecting backend endpoints.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Implementing authentication"
    - "Working with backend auth guards or decorators"
    - "Protecting backend endpoints with auth, roles, or permissions"
---

# Vendix Backend Auth

## Purpose

Use this skill for backend auth and endpoint protection. Use `vendix-permissions` for permission seed/decorator details and `vendix-subscription-gate` for subscription write gates.

## Current Global Pipeline

`AppModule` registers global guards/interceptors:

1. `ThrottlerGuard`
2. `JwtAuthGuard`
3. `StoreOperationsGuard`
4. `RequestContextInterceptor`
5. `AuditInterceptor`

Key file: `apps/backend/src/app.module.ts`.

## JWT Guard Rules

`JwtAuthGuard` is global. Routes require auth unless one of these applies:

- HTTP method is `OPTIONS`.
- Handler/class has `@Public()`.
- Route matches allowed public paths such as health/API docs.
- Handler/class uses optional auth via `@OptionalAuth()`.
- SSE notifications may pass token through query parameter because `EventSource` cannot send headers.

Key files:

- `apps/backend/src/domains/auth/guards/jwt-auth.guard.ts`
- `apps/backend/src/domains/auth/decorators/public.decorator.ts`
- `apps/backend/src/domains/auth/decorators/optional-auth.decorator.ts`
- `apps/backend/src/domains/auth/strategies/jwt.strategy.ts`

## Request User Shape

`JwtStrategy.validate()` returns a rich `req.user` object that includes IDs, roles, and permission objects. Permissions are not simple strings; they include route metadata such as `name`, `path`, `method`, and `status`.

`RequestContextInterceptor` then copies auth data into `RequestContextService` for scoped Prisma and downstream services.

## Roles And Permissions

- Use `@Roles(...)` for role constraints.
- Use `@Permissions(...)` for granular backend authorization.
- Super admin bypass behavior lives in `PermissionsGuard`.
- Permission checks support route/method metadata OR named permission matching.

Real role enum values include lowercase roles such as `super_admin`, `admin`, `manager`, `supervisor`, `employee`, `staff`, `owner`, plus `CUSTOMER`.

## Endpoint Protection Rules

| Endpoint Type | Pattern |
| --- | --- |
| Public auth/login/register/password reset | `@Public()` |
| Public ecommerce read flow | `@Public()` or optional auth only when intended |
| Admin/store write operations | JWT + permissions/roles + subscription gate as applicable |
| Store write operations | Also consider `StoreOperationsGuard` and `@SkipSubscriptionGate()` only when justified |
| Webhooks | Public only if signature/processor auth is implemented |

## Related Skills

- `vendix-permissions` - Permission names, seed rows, guard behavior
- `vendix-subscription-gate` - Store write protection by subscription state
- `vendix-multi-tenant-context` - Request context propagation
- `vendix-backend-api` - Controller endpoint patterns
