---
name: vendix-error-handling
description: >
  Standardized backend/frontend error handling with VendixHttpException, error-codes.ts,
  AllExceptionsFilter, validation error mapping, frontend parseApiError, and UX message
  mapping. Trigger: When adding errors, handling exceptions, mapping API errors, or
  replacing generic Nest exceptions.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Handling Errors"
---

# Vendix Error Handling

## Source of Truth

- Backend codes: `apps/backend/src/common/errors/error-codes.ts`.
- Exception class: `apps/backend/src/common/errors/vendix-http.exception.ts`.
- Global filter: `apps/backend/src/common/filters/http-exception.filter.ts`.
- Frontend messages: `apps/frontend/src/app/core/utils/error-messages.ts`.
- Frontend parser: `apps/frontend/src/app/core/utils/parse-api-error.ts` and `api-error-handler.ts`.

## Backend Pattern

Prefer `VendixHttpException` with an existing `ErrorCodes` entry:

```typescript
throw new VendixHttpException(ErrorCodes.PAYMENT_SOURCE_NOT_FOUND, undefined, { payment_source_id });
```

The registry contains mixed naming styles. Do not invent a stricter format than the current file; follow nearby domain naming.

## Response Shape

Responses include:

- `statusCode`
- `error_code`
- `message`
- `timestamp`
- `path`
- optional `details`
- optional non-production `devDetails`

Validation arrays are mapped by `AllExceptionsFilter` to `SYS_VALIDATION_001`. Unknown errors map to `SYS_INTERNAL_001`.

## Frontend Pattern

Use `extractApiErrorMessage(error)` for simple display. It delegates to `parseApiError()` when `error_code` exists and maps to `ERROR_MESSAGES`.

Use `parseApiError()` directly only when component behavior depends on the code:

```typescript
const { errorCode, userMessage } = parseApiError(error);
this.toastService.error(userMessage);
```

Never display backend developer details to users.

## Adding A New Error

1. Add the backend code in `error-codes.ts` near the owning domain.
2. Use `VendixHttpException` at the service/controller boundary.
3. Add or update frontend UX copy in `error-messages.ts` if the error can reach UI.
4. Keep `details` safe for clients; put sensitive diagnostics only in logs/dev details.

## Related Skills

- `vendix-validation`
- `vendix-backend-api`
- `vendix-frontend`
