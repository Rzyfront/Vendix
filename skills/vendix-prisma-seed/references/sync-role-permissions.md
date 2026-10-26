# syncRolePermissions

Location: `apps/backend/prisma/seeds/shared/sync-role-permissions.ts`.

## Behaviour (current code)

- Dedupes `allowedPermissionIds`, then `role_permissions.createMany({ data, skipDuplicates: true })` against `@@unique([role_id, permission_id])`. Re-runs never duplicate rows.
- Additive-only: no `deleteMany`; existing assignments are never revoked. `revoked` is always `0`. (An earlier version revoked via `deleteMany({ permission_id: { notIn } })`; that was removed. The header doc comment in the file still describes revocation; trust the function body.)
- Logs `🔄 Synced <label>: +N added (canonical=K, additive-only)` only when rows were added.
- Accepts `PrismaClient` or `Prisma.TransactionClient`.

## Example (from `permissions-roles.seed.ts`)

```typescript
const managerPermissions = allPermissions.filter(/* canonical filter */);
const managerSync = await syncRolePermissions(
  client,
  managerRole.id,
  managerPermissions.map((p) => p.id),
  'STORE_ADMIN (manager)',
);
assignmentsCreated += managerSync.added;
```
