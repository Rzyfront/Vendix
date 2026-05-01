---
name: vendix-prisma-seed
description: >
  Vendix database seed patterns: current seed runner, production seed, flat seed modules,
  Prisma 7 shared client, idempotency, and destructive dev cleanup. Trigger: When creating
  seeds, editing seed modules, running seed scripts, or resetting development data.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
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

## Related Skills

- `vendix-prisma-migrations`
- `vendix-prisma-schema`
- `vendix-prisma-scopes`
