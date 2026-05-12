---
name: vendix-prisma
description: >
  Prisma ORM overview for Vendix: Prisma 7 config, schema location, scoped services,
  migrations, seeds, and correct workspace commands. Trigger: When editing schema.prisma,
  creating migrations, using Prisma client, or seeding database data.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke: "When editing schema.prisma, creating migrations, or using Prisma client"
---

## When to Use

- Editing `apps/backend/prisma/schema.prisma`.
- Creating or reviewing migrations.
- Choosing the right Prisma service in NestJS.
- Running or updating seeds.

## Current Prisma Setup

- Prisma packages are in `apps/backend/package.json` and currently use Prisma 7.x.
- Schema path: `apps/backend/prisma/schema.prisma`.
- Prisma config path: `apps/backend/prisma.config.ts`.
- Datasource URL is configured in `prisma.config.ts` from `process.env.DATABASE_URL`, not in `schema.prisma`.
- Client uses `@prisma/adapter-pg` and `pg.Pool` in backend Prisma services.
- Models and fields are mostly `snake_case`; enum values are mixed. Treat the schema as source of truth.

## Scoped Services

Use domain-appropriate services instead of raw `PrismaClient` in request handlers:

| Domain | Service |
| --- | --- |
| `domains/superadmin/` | `GlobalPrismaService` |
| `domains/organization/` | `OrganizationPrismaService` |
| `domains/store/` | `StorePrismaService` |
| `domains/ecommerce/` | `EcommercePrismaService` |
| jobs/seeds/system scripts | `GlobalPrismaService` or explicit approved `withoutScope()` |

For model registration and tenant isolation details, use `vendix-prisma-scopes`.

## Commands

Run from repo root unless stated otherwise:

```bash
npm run prisma:generate -w apps/backend
npm run prisma:studio -w apps/backend
npm run db:migrate:dev -w apps/backend
npm run db:migrate:prod -w apps/backend
npm run db:seed -w apps/backend
npm run db:reset -w apps/backend
npm run db:clean -w apps/backend
npm run db:reset-seed
```

Use `vendix-prisma-migrations` before creating/reviewing migration SQL.

## Rules

- Do not use generic PascalCase Prisma examples in Vendix code; real model names are generally snake_case.
- Do not manually add tenant filters when the scoped service already applies them, unless using a documented base-client/manual-scope getter.
- Do not use `withoutScope()` in request handlers without explicit approval.
- Do not run destructive DB reset/clean commands unless the user explicitly asks.
- Always review generated SQL before committing migrations.

## Related Skills

- `vendix-prisma-schema`
- `vendix-prisma-migrations`
- `vendix-prisma-scopes`
- `vendix-prisma-seed`
