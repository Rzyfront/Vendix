---
name: vendix-backend-middleware
description: >
  Backend middleware and request-context patterns: ecommerce-only domain resolution,
  cache-manager usage, domain_context on the request, and AsyncLocalStorage request context
  population via interceptor. Trigger: When configuring middleware.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Configuring middleware"
---

# Vendix Backend Middleware

## Source of Truth

- `apps/backend/src/common/middleware/domain-resolver.middleware.ts`
- `apps/backend/src/common/interceptors/request-context.interceptor.ts`
- `apps/backend/src/common/context/request-context.service.ts`
- `apps/backend/src/app.module.ts`

## Domain Resolver Reality

`DomainResolverMiddleware` is not a generic all-route tenancy resolver. It currently runs only for ecommerce-style requests and exits early unless `req.originalUrl` contains `/ecommerce/`.

It resolves store context in this order:

1. `x-store-id` header or `store_id` query param.
2. Hostname resolution via `PublicDomainsService.resolveDomain(hostname)`.
3. Cached hostname lookup through Nest `cache-manager`.

The middleware writes:

```typescript
req['domain_context'] = { store_id, organization_id? }
```

It does not write `req.store_id` / `req.organization_id` / `req.domain_type` directly.

## Request Context Reality

`RequestContextService` is AsyncLocalStorage-based, not request-scoped DI over `REQUEST`.

- `RequestContextInterceptor` merges auth user data and `req['domain_context']`.
- It propagates `x-request-id` into the request context.
- It calls `RequestContextService.asyncLocalStorage.run(contextObj, ...)`.
- Consumers read static helpers like `getStoreId()`, `getUserId()`, `getRequestId()`, `isSuperAdmin()`.

## Rules

- Do not document or implement new middleware assuming route-param tenancy.
- Do not inject a request-scoped `RequestContextService`; use the real ALS/static API.
- If you need tenant context in backend logic, prefer the interceptor-populated request context and scoped Prisma services.
- If you need hostname-based public store resolution outside ecommerce routes, verify the route path and current middleware coverage before expanding behavior.

## Related Skills

- `vendix-multi-tenant-context`
- `vendix-prisma-scopes`
- `vendix-backend-domain`
