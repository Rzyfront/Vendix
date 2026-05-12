---
name: vendix-validation
description: >
  Vendix validation patterns: global Nest ValidationPipe, DTO-first backend validation,
  class-validator/class-transformer usage, business-rule validation, and Angular reactive
  form validators. Trigger: When writing validation logic, DTOs, form validators, or
  request payload handling.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke: "Writing Validation Logic"
---

# Vendix Validation

## Backend Default

Global validation is configured in `apps/backend/src/main.ts` with Nest `ValidationPipe`:

- `transform: true`
- `whitelist: true`
- `forbidNonWhitelisted: true`
- `enableImplicitConversion: true`

Design APIs assuming DTO validation runs before controller methods.

## DTO Rules

- Use `class-validator` decorators for shape, required fields, enums, lengths, arrays, and numeric bounds.
- Use `class-transformer` for type conversion: `@Type(() => Number)`, nested DTOs, arrays, and targeted `@Transform()`.
- Prefer DTO validation for request structure and simple constraints.
- Keep business invariants in services after resource lookup and permission/context checks.
- Avoid hypothetical shared helpers unless they exist in the codebase.

Example patterns used in Vendix:

```typescript
@IsOptional()
@Type(() => Number)
@IsInt()
store_id?: number;

@ValidateNested({ each: true })
@Type(() => LineItemDto)
items: LineItemDto[];
```

## Service Validation Order

Use early returns/throws, but do not duplicate DTO validation unnecessarily:

1. Auth/tenant context and permissions.
2. Resource existence and ownership.
3. Business state transitions.
4. Cross-record or monetary consistency.
5. Execute mutation.

Use `VendixHttpException` and domain error codes where available.

## Frontend Forms

- Use Angular reactive forms.
- Use typed controls/getters when templates need strict `FormControl` bindings.
- Use built-in `Validators` for simple fields and custom validators for cross-field rules.
- Product pricing has real cross-field validators in the product module; prefer existing validators over new ad-hoc checks.
- On submit, mark controls touched and return early when invalid.

## Related Skills

- `vendix-error-handling`
- `vendix-angular-forms`
- `vendix-backend-api`
