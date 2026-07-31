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
  version: "2.1"
  scope: [root]
  auto_invoke:
    - "Handling Errors"
    - "Wrapping a controller handler in try/catch or calling responseService.error"
    - "Debugging an endpoint that answers HTTP 200 with success:false in the body"
    - "Removing a frontend envelope unwrapper that reads success === false"
---

# Vendix Error Handling

## Hard Rule — Rethrow, Never Return An Error

`AllExceptionsFilter` runs only when the exception **leaves** the handler. Returning
`responseService.error(...)` from a `catch` consumes it, so Nest answers **HTTP 200**
with the real status buried in the body. Any client that reads the status line sees a
success where the backend rejected.

```typescript
// WRONG — responds 200 with {"success":false,…,"statusCode":409}
try {
  const result = await this.tablesService.update(id, dto);
  return this.responseService.updated(result, 'Mesa actualizada exitosamente');
} catch (error) {
  return this.responseService.error(error.message, error.status || 400);
}

// RIGHT — no try/catch; the service throws typed and the filter emits 409 + error_code
const result = await this.tablesService.update(id, dto);
return this.responseService.updated(result, 'Mesa actualizada exitosamente');
```

Precondition before deleting a `try/catch`: every path of the service must throw
`VendixHttpException` or a Nest `HttpException`. Verify with
`grep -c "throw new Error" <service>` — it must be `0`, otherwise the filter degrades
the case to `SYS_INTERNAL_001` / 500, which is worse than the 200.

Reference implementations with zero `try/catch`:
`apps/backend/src/domains/store/tables/tables.controller.ts` and its sibling
`table-sessions.controller.ts`.

Measured 2026-07-30: **358** `responseService.error` calls across **54** controllers
still carry the pattern, plus **16** frontend reads of `success === false` compensating
for it. Repo-wide sweep ticket: **QUI-571**.

**Deliberate exception — do not "fix" it.** `apps/backend/src/domains/auth/auth.controller.ts`
answers 200 with `statusCode: 401` on failed login, and
`apps/frontend/src/app/core/store/auth/auth.effects.ts:193,488` reads that body on
purpose. Changing it breaks login.

### Frontend corollary

Never hand-roll an envelope unwrapper (`if (res.success === false) throw ...`). It hides
a broken contract instead of reporting it, and the filter's error body carries
`"success": null` — not `false` — so the check silently stops matching the moment the
status starts travelling correctly. Rely on `catchError` + `extractApiErrorMessage`.

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
