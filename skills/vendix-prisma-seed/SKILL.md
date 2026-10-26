---
name: vendix-prisma-seed
description: >
  Vendix seed patterns: seed runner, production seed, flat seed modules, idempotency, dev cleanup, `syncRolePermissions`. Trigger: creating or editing seeds, running seed scripts, resetting development data.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.3"
  scope: [root]
  auto_invoke: "Creating Seeds"
---

## Source of Truth

- Main seed: `apps/backend/prisma/seed.ts`.
- Production seed: `apps/backend/prisma/seed-production.ts`.
- Seed modules: `apps/backend/prisma/seeds/*.seed.ts`.
- Shared client: `apps/backend/prisma/seeds/shared/client.ts`.
- Dev cleanup: `apps/backend/prisma/seeds/shared/database.ts` and `seeds/shared/database-scripts/{clean,reset,stats}.ts`.

## Current Structure

Seeds are flat modules under `apps/backend/prisma/seeds/`, not `seeds/dev` and `seeds/prod` directories.

`seed.ts` runs modules sequentially, logs errors per module, continues, and exits with code `1` if any module failed.

Main order (see `seed.ts`): default and print-format templates, permissions/roles, system payment and shipping methods, organizations/stores, Vendix platform org, legal documents, users, products/categories, PUC and account mappings, domains, addresses, inventory locations, test orders, help articles, payroll rules, ICA rates, withholding tax, fiscal rule sets, AI apps and agents, payroll system defaults, subscription plans (trial + canonical production), PQR anonymous user. New modules go in that array.

## Production Seed

`seed-production.ts` is a lighter runner for essential production data: templates, permissions/roles, account mappings, payroll rules, AI apps and agents, system payment methods, and default trial subscription plan.

No package script: `.github/workflows/deploy-backend-ec2.yml` runs `npx --yes tsx prisma/seed-production.ts` in an isolated container on every deploy, after the new API is serving. Everything it runs must be idempotent and safe on prod data.

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

Canonical helper to grant a role's canonical permission set. **Additive-only**: inserts missing `role_permissions` with `createMany({ skipDuplicates: true })` and never revokes (`revoked` is always 0, kept for compatibility). Signature: `syncRolePermissions(client, roleId, allowedPermissionIds, label) → { added, revoked }`.

- Use it for every system role's canonical set (all 12 roles in `permissions-roles.seed.ts` already do: super_admin, owner, admin, fiscal_supervisor, manager, supervisor, employee, customer, cashier, carrier, waiter, kitchen).
- Removing a permission from a role's filter does **not** remove existing assignments; revoking needs an explicit, approved data change (migration with `DATA IMPACT`, see `vendix-prisma-migrations`).

Detail and example: `references/sync-role-permissions.md` (read on demand).

## Related Skills

- `vendix-prisma-migrations`
- `vendix-prisma`
- `vendix-prisma-scopes`
