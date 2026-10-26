---
name: vendix-prisma
description: >
  Prisma 7 for Vendix: config, snake_case schema editing (models, relations, indexes, enums),
  scoped services, migrations, seeds, commands. Trigger: editing schema.prisma, adding
  models/fields/enums, creating migrations, using Prisma client, seeding.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.3"
  scope: [root]
  auto_invoke:
    - "When editing schema.prisma, creating migrations, or using Prisma client"
    - "Editing Schema"
---

## When to Use

- Editing `apps/backend/prisma/schema.prisma` (adding/removing models, fields, relations, indexes, enums).
- Creating or reviewing migrations.
- Choosing the right Prisma service in NestJS.
- Running or updating seeds.

## Current Prisma Setup

- Prisma packages are in `apps/backend/package.json` and currently use Prisma 7.x.
- Schema path: `apps/backend/prisma/schema.prisma`.
- Prisma config path: `apps/backend/prisma.config.ts`.
- Scoped services: `apps/backend/src/prisma/services/`.
- Client uses `@prisma/adapter-pg` and `pg.Pool` in backend Prisma services.
- Current schema is large: 300+ models and 200+ enums. Do not duplicate exhaustive model lists in skills; inspect the schema before editing.

### Prisma 7 Datasource

`schema.prisma` declares provider/generator only. The database URL is not in the schema; it comes from `process.env.DATABASE_URL` in `prisma.config.ts`:

```typescript
// prisma.config.ts
export default defineConfig({
  datasource: { url: process.env.DATABASE_URL! },
});
```

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

## Schema Editing

### Naming

- Models are generally `snake_case`: `users`, `store_users`, `subscription_plans`. Do not use generic PascalCase Prisma examples in Vendix code.
- Fields are generally `snake_case`, but exceptions exist. Preserve existing naming in the touched model.
- Enum names are generally snake_case, often with `_enum`, but enum values are mixed lower/upper case. Treat the schema as source of truth.
- TypeScript variables stay camelCase unless mapping directly to Prisma field names.

### Workflow

1. Load relevant domain skills and `vendix-prisma-migrations`.
2. Edit `schema.prisma` minimally.
3. Create migration with backend workspace command, or `prisma migrate dev --create-only` when SQL needs review first.
4. Review generated SQL for enum, data, FK, index, and destructive risks.
5. Register new models in scoped Prisma services before writing service logic.
6. Regenerate client if needed.

### Relationships And Indexes

- Add indexes for foreign keys and common tenant filters.
- Multi-tenant models usually need `organization_id`, `store_id`, or a relation to a scoped parent.
- If a model is accessed through `StorePrismaService`, `OrganizationPrismaService`, or `EcommercePrismaService`, update the scoped service registration.
- For pgvector fields, Prisma uses `Unsupported("vector(1536)")`; vector operations use raw SQL.

### Migration Notes

- Adding enum values must be idempotent: `ALTER TYPE ... ADD VALUE IF NOT EXISTS` or guarded `DO $$`.
- If new enum values are used in data updates, split migrations when Postgres requires it.
- Do not drop columns/tables or mutate data without explicit approval and `DATA IMPACT` header.
- Always review generated SQL before committing migrations. Details: `vendix-prisma-migrations`.

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

## Rules

- Do not manually add tenant filters when the scoped service already applies them, unless using a documented base-client/manual-scope getter.
- Do not use `withoutScope()` in request handlers without explicit approval.
- Do not run destructive DB reset/clean commands unless the user explicitly asks.

## Related Skills

- `vendix-prisma-migrations`
- `vendix-prisma-scopes`
- `vendix-prisma-seed`
- `vendix-naming-conventions`
