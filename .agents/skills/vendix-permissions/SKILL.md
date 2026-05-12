---
name: vendix-permissions
description: >
  Backend RBAC permission rows, @Permissions decorators, and PermissionsGuard behavior.
  Trigger: When adding permissions, editing @Permissions decorators, seeding roles/permissions, or distinguishing authorization from panel_ui visibility.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Adding backend permissions"
    - "Editing @Permissions decorators"
    - "Working with permissions-roles seed"
    - "Distinguishing panel_ui visibility from backend authorization"
---

# Vendix Permissions

## Purpose

Use this skill for backend authorization. Permissions protect API operations; they do not control sidebar visibility.

## Current Guard Behavior

`PermissionsGuard` authorizes when either route/method permission or named permission matches.

Real behavior:

- Super admin role bypasses permission checks.
- JWT user permissions are objects with `name`, `path`, `method`, and `status`.
- Route/method match passes when `currentPath === permission.path` or `currentPath.startsWith(permission.path)`, method matches, and status is `active`.
- Named match passes when any required `@Permissions(...)` name exists in active user permissions.
- The guard uses OR semantics: route/method match OR named permission match.

Key files:

- `apps/backend/src/domains/auth/guards/permissions.guard.ts`
- `apps/backend/src/domains/auth/decorators/permissions.decorator.ts`
- `apps/backend/src/domains/auth/strategies/jwt.strategy.ts`
- `apps/backend/prisma/seeds/permissions-roles.seed.ts`

## Permission Rows

`permissions` rows have both name and route metadata:

```typescript
{
  name: 'store:products:create',
  description: 'Create product',
  path: '/api/store/products',
  method: 'POST',
  status: 'active'
}
```

Database constraints include unique `name` and unique `[path, method]`.

## Naming Reality

Existing permissions use mixed historical formats:

- `store:products:create`
- `organization:users:update`
- `superadmin:subscriptions:plans:read`
- `subscriptions:read`
- `auth.login`
- `auth:sessions`

Prefer `domain:resource:action` or `domain:resource:subresource:action` for new permissions unless updating an existing domain with a local convention.

## Adding Or Changing A Permission

1. Add or update `@Permissions('permission:name')` on the protected controller/handler.
2. Add or update the row in `apps/backend/prisma/seeds/permissions-roles.seed.ts`.
3. Ensure `path` includes the API route shape expected by `PermissionsGuard`.
4. Ensure `method` matches the HTTP method or uses `ALL` only when intentional.
5. Assign the permission to the correct role(s) in the seed.
6. Treat seed cleanup as data-impacting: removed seed permissions may be removed/deprecated from DB by seed logic.

## panel_ui Is Not Authorization

| System | Purpose |
| --- | --- |
| `panel_ui` | Shows or hides sidebar/menu modules |
| Permissions | Allows or denies backend API operations |
| Roles | Group permissions and enable superadmin bypass |
| Subscription gates | Block store writes/features by plan/state |

Never rely on hidden frontend UI as a security boundary.

## Related Skills

- `vendix-backend-auth` - Global JWT auth and public routes
- `vendix-panel-ui` - Sidebar visibility
- `vendix-backend-api` - Controller patterns
- `vendix-prisma-seed` - Seed safety patterns
