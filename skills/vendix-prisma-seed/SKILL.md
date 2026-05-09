---
name: vendix-prisma-seed
description: >
  Vendix database seed patterns: current seed runner, production seed, flat seed modules,
  Prisma 7 shared client, idempotency, destructive dev cleanup, and the
  `syncRolePermissions` helper for canonical role-permission synchronization. Trigger:
  When creating seeds, editing seed modules, running seed scripts, or resetting
  development data.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.2"
  scope: [root]
  auto_invoke: "Creating Seeds"
---

## Source of Truth

- Main seed: `apps/backend/prisma/seed.ts`.
- Production seed: `apps/backend/prisma/seed-production.ts`.
- Seed modules: `apps/backend/prisma/seeds/*.seed.ts`.
- Shared client: `apps/backend/prisma/seeds/shared/client.ts`.
- Dev cleanup: `apps/backend/prisma/seeds/shared/database.ts` and `database-scripts/clean.ts`.

## Current Structure

Seeds are flat modules under `apps/backend/prisma/seeds/`, not `seeds/dev` and `seeds/prod` directories.

`seed.ts` runs modules sequentially, logs errors per module, continues, and exits with code `1` if any module failed.

Current main order includes default templates, permissions/roles, system payment methods, organizations/stores, legal documents, users, products/categories, PUC/account mappings, domains, addresses, inventory locations, test orders, help articles, payroll defaults, AI apps, and subscription plans.

## Production Seed

`seed-production.ts` is a lighter runner for essential production data: templates, permissions/roles, account mappings, payroll rules, AI apps, system payment methods, and default trial subscription plan.

Commented usage is `npx tsx prisma/seed-production.ts`; there is no current backend package script pointing to it.

## Commands

```bash
npm run db:seed -w apps/backend
npm run db:reset -w apps/backend
npm run db:clean -w apps/backend
npm run db:reset-seed
```

Do not run reset/clean unless explicitly requested; these are destructive.

## Shared Client

`seeds/shared/client.ts` uses a singleton Prisma 7 client with `PrismaPg` adapter and `pg.Pool`. It falls back to a local placeholder URL if `DATABASE_URL` is missing.

## Idempotency Rules

- Prefer `upsert` for stable records.
- Preserve existing row ids when other tables may reference them.
- Use `findUnique` + update/create when composite/business logic needs custom behavior.
- Use `ON CONFLICT DO NOTHING` in migration seed SQL.
- Avoid random identifiers for stable system rows.

Examples in current code:

- Organizations/stores upsert by stable slug/compound keys.
- PUC accounts upsert by `organization_id_code`.
- Subscription production plans update/create by `code` to preserve ids.

## Cleanup Warning

`clearDatabase()` uses `deleteMany({})` in reverse dependency order. It is destructive and intended for local/dev seed utilities only. Do not use it in production flows.

## Helper: `syncRolePermissions`

Location: `apps/backend/prisma/seeds/shared/sync-role-permissions.ts`.

Canonical helper for synchronizing a role's `role_permissions` rows against a desired permission set. Replaces the legacy "upsert in a loop + optional `deleteMany({ permission_id: { notIn } })`" pattern that previously lived inline in `permissions-roles.seed.ts`.

### Signature

```typescript
import { syncRolePermissions } from './shared/sync-role-permissions';

await syncRolePermissions(
  client,                // PrismaClient | Prisma.TransactionClient
  roleId,                // number — roles.id
  allowedPermissionIds,  // number[] — canonical permissions.id list
  label,                 // string — log label, e.g. "STORE_ADMIN (manager)"
);
// → { added: number; revoked: number }
```

### When to use it

- Defining the canonical permission set for a role inside a seed.
- Renaming or removing a permission that must be revoked from existing roles.
- Moving a permission surface between roles (e.g. STORE_ADMIN → ORG_ADMIN write
  surfaces) where re-running the seed must drop stale rows.
- Anywhere a role's permission catalogue is rebuilt from a filter over
  `permissions.findMany()`.

### When NOT to use it

- One-off ad-hoc grants where the role already has other permissions managed
  elsewhere (helper would revoke them).
- Per-organization role assignments — the helper operates on a single role and
  treats `allowedPermissionIds` as authoritative for that role.

### Why it is idempotent and re-run safe

1. Inserts use `createMany({ skipDuplicates: true })` against the
   `@@unique([role_id, permission_id])` constraint — re-runs never duplicate
   rows.
2. Revocations use `deleteMany({ permission_id: { notIn: allowedIds } })`,
   which is a set-difference operation. The second run sees an empty diff and
   is a no-op.
3. Empty `allowedIds` is handled safely: the helper deletes everything for
   that role and skips the insert pass — useful when fully retiring a role's
   permissions.

### Example (from `permissions-roles.seed.ts`)

```typescript
const managerPermissions = allPermissions.filter(/* canonical filter */);

const managerSync = await syncRolePermissions(
  client,
  managerRole.id,
  managerPermissions.map((p) => p.id),
  'STORE_ADMIN (manager)',
);
assignmentsCreated += managerSync.added;
// Logs: "🔄 Synced STORE_ADMIN (manager): +N added, -M revoked (canonical=K)"
```

The helper replaced ~15 lines per role of upsert loops plus the
`deleteMany+notIn` revocation block, while preserving the existing
`assignmentsCreated` accounting and `console.log` traceability. All seven
system roles (`super_admin`, `owner`, `admin`, `manager`, `supervisor`,
`employee`, `customer`, `cashier`) now use it.

## Related Skills

- `vendix-prisma-migrations`
- `vendix-prisma-schema`
- `vendix-prisma-scopes`
