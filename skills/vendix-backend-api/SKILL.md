---
name: vendix-backend-api
description: >
  Vendix backend API endpoint patterns: flat namespaced controllers, DTO-first request
  validation, ResponseService helpers, pagination responses, and service/controller
  responsibilities. Trigger: When creating API endpoints.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Creating API endpoints"
---

# Vendix Backend API

## Source of Truth

- Controllers under `apps/backend/src/domains/**/**/*.controller.ts`
- `apps/backend/src/common/responses/response.service.ts`
- `apps/backend/src/common/errors/`
- `apps/backend/src/main.ts`

## Routing Pattern

Current controllers use flat namespaced prefixes such as:

- `store/...`
- `organization/...`
- `superadmin/...`
- `public/...`

Do not document old `domains/:domain_id/...` route patterns unless you are explicitly working with legacy code.

## Controller Rules

- Controllers stay thin: params/query/body DTOs, decorators/guards, one call into a service.
- Services own business logic and Prisma access.
- Use DTOs with global `ValidationPipe` rather than ad-hoc parsing.
- Use `VendixHttpException`/`ErrorCodes` when standardized domain errors exist.

## ResponseService

`ResponseService` currently exposes helpers including:

- `success(data, message?, meta?)`
- `paginated(data, total, page, limit, message?)`
- `noContent(message?)`
- `created(data, message?)`
- `updated(data, message?)`
- `deleted(message?)`

Use the helper that matches the intent rather than always falling back to `success()`.

## Pagination Pattern

Paginated services typically return raw `data + total + page + limit` inputs to the controller/response helper, not a nested `{ data, meta }` structure for `ResponseService.paginated()`.

## Related Skills

- `vendix-backend`
- `vendix-validation`
- `vendix-error-handling`
- `vendix-backend-auth`
