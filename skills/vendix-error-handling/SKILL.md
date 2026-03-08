---
name: vendix-error-handling
description: Standardized error code system with VendixHttpException, error registry, and UX message mapping.
metadata:
  scope: [root]
  auto_invoke: "Handling Errors"
---
# Vendix Error Handling - Standardized Error Codes

> **Error Code Format:** `{DOMAIN}_{FUNCTIONALITY}_{NNN}`
> Example: `PAY_FIND_001` = Payment domain, Find functionality, first error

---

## Error Code System Architecture

```
Backend (throw)                    Frontend (display)
VendixHttpException ──> AllExceptionsFilter ──> { error_code } ──> parseApiError() ──> ERROR_MESSAGES[code]
```

### Domain Prefixes

| Prefix | Domain | Status |
|--------|--------|--------|
| `SYS_` | System (generic) | Active |
| `PAY_` | Payments | Active |
| `ORD_` | Orders | Pending |
| `AUTH_` | Authentication | Pending |
| `PROD_` | Products | Pending |
| `CUST_` | Customers | Pending |
| `INV_` | Inventory | Pending |
| `SHIP_` | Shipping | Pending |
| `CAT_` | Catalog | Pending |
| `STORE_` | Store settings | Pending |
| `ORG_` | Organization | Pending |
| `ECOM_` | Ecommerce | Pending |

### Functionality Suffixes

| Suffix | Use | Typical HTTP Status |
|--------|-----|---------------------|
| `FIND_` | Resource not found | 404 |
| `CREATE_` | Error creating | 400 |
| `VALIDATE_` | Business validation | 400/422 |
| `DUP_` | Duplicate/conflict | 409 |
| `STATUS_` | Invalid state transition | 400 |
| `PERM_` | No permissions | 403 |
| `TOKEN_` | Invalid/expired token | 401 |

---

## Backend: Throwing Errors

### Using VendixHttpException

```typescript
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

// Simple throw
throw new VendixHttpException(ErrorCodes.PAY_FIND_001);

// With custom detail (for logs, NOT shown to user)
throw new VendixHttpException(ErrorCodes.PAY_FIND_001, 'Payment abc-123 not found');

// With extra details object
throw new VendixHttpException(ErrorCodes.PAY_VALIDATE_001, 'Amount below minimum', { min: 1000 });
```

### Adding New Error Codes

1. Add to `apps/backend/src/common/errors/error-codes.ts`:

```typescript
export const ErrorCodes = {
  // ... existing codes
  ORD_FIND_001: { code: 'ORD_FIND_001', httpStatus: 404, devMessage: 'Order not found' },
} as const satisfies Record<string, ErrorCodeEntry>;
```

2. Add UX message to `apps/frontend/src/app/core/utils/error-messages.ts`:

```typescript
export const ERROR_MESSAGES: Record<string, string> = {
  // ... existing messages
  ORD_FIND_001: 'La orden no fue encontrada.',
};
```

3. Use in service:

```typescript
throw new VendixHttpException(ErrorCodes.ORD_FIND_001);
```

### Early Return Validation Order

Always validate in this order in services:

```typescript
async updateOrder(id: number, dto: UpdateOrderDto) {
  // 1. Auth/Permissions
  if (!user.can('update_orders')) throw new VendixHttpException(ErrorCodes.SYS_FORBIDDEN_001);

  // 2. Input validation (beyond DTO)
  if (dto.amount < 0) throw new VendixHttpException(ErrorCodes.ORD_VALIDATE_001);

  // 3. Resource lookup
  const order = await this.prisma.orders.findUnique({ where: { id } });
  if (!order) throw new VendixHttpException(ErrorCodes.ORD_FIND_001);

  // 4. Business logic
  if (order.state === 'finished') throw new VendixHttpException(ErrorCodes.ORD_STATUS_001);

  // 5. Execute
  return this.prisma.orders.update({ ... });
}
```

---

## Frontend: Displaying Errors

### NEVER show backend devMessage to users

The `extractApiErrorMessage()` function (used by 14+ files) automatically detects `error_code` and returns the UX message from `ERROR_MESSAGES`. No changes needed in components.

```typescript
// This already works - parseApiError is called internally
const msg = extractApiErrorMessage(httpError);
this.toast_service.error(msg); // Shows Spanish UX message, NOT devMessage
```

### For advanced error handling (e.g., conditional actions):

```typescript
import { parseApiError } from '@core/utils/parse-api-error';

this.api.createPayment(dto).subscribe({
  error: (err) => {
    const { errorCode, userMessage } = parseApiError(err);
    this.toast_service.error(userMessage);

    if (errorCode === 'PAY_DUPLICATE_001') {
      this.router.navigate(['/orders', orderId]);
    }
  }
});
```

---

## AllExceptionsFilter Behavior

The filter at `common/filters/http-exception.filter.ts` handles all exception types:

| Exception Type | `error_code` in response |
|---------------|-------------------------|
| `VendixHttpException` | From `errorCode` property |
| `HttpException` with `error_code` body | Passed through |
| `HttpException` with validation array | `SYS_VALIDATION_001` |
| Unknown exception | `SYS_INTERNAL_001` |

Response shape:

```json
{
  "statusCode": 404,
  "error_code": "PAY_FIND_001",
  "message": "Payment not found",
  "timestamp": "2026-03-07T...",
  "path": "/api/payments/abc"
}
```

---

## Migration Checklist (per domain)

- [ ] Add `{DOMAIN}_*` codes to `error-codes.ts`
- [ ] Replace `throw new NotFoundException('...')` with `throw new VendixHttpException(ErrorCodes.XXX_FIND_001)`
- [ ] Apply early return order: Auth -> Validation -> Lookup -> Business Logic
- [ ] Add UX messages to frontend `error-messages.ts`
- [ ] No component changes needed (extractApiErrorMessage handles it)

---

## Key Files

| File | Purpose |
|------|---------|
| `apps/backend/src/common/errors/error-codes.ts` | Error code registry |
| `apps/backend/src/common/errors/vendix-http.exception.ts` | Exception class |
| `apps/backend/src/common/errors/index.ts` | Barrel export |
| `apps/backend/src/common/filters/http-exception.filter.ts` | Global error filter |
| `apps/backend/src/common/responses/response.interface.ts` | ErrorResponse with error_code |
| `apps/backend/src/common/responses/response.service.ts` | error() with errorCode param |
| `apps/frontend/src/app/core/utils/error-messages.ts` | UX message map |
| `apps/frontend/src/app/core/utils/parse-api-error.ts` | Error parser |
| `apps/frontend/src/app/core/utils/api-error-handler.ts` | extractApiErrorMessage (auto-integration) |

---

## Related Skills

- `vendix-validation` - DTO validation patterns
- `vendix-backend-api` - API response patterns
- `vendix-backend-domain` - Service layer architecture
