---
name: vendix-prisma-schema
description: >
  Prisma schema editing patterns for Vendix: snake_case schema, Prisma 7 datasource config,
  relationships, indexes, enums, and migration workflow. Trigger: When editing Schema or
  adding/removing Prisma models, fields, relations, indexes, or enums.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke: "Editing Schema"
---

## Source of Truth

- Schema: `apps/backend/prisma/schema.prisma`.
- Prisma config: `apps/backend/prisma.config.ts`.
- Scoped services: `apps/backend/src/prisma/services/`.

Current schema is large: 200+ models and 140+ enums. Do not duplicate exhaustive model lists in skills; inspect the schema before editing.

## Prisma 7 Datasource

`schema.prisma` declares provider/generator. The database URL is not in the schema; it is provided through `apps/backend/prisma.config.ts`.

```typescript
// prisma.config.ts
export default defineConfig({
  datasource: { url: process.env.DATABASE_URL! },
});
```

## Naming

- Models are generally `snake_case`: `users`, `store_users`, `subscription_plans`.
- Fields are generally `snake_case`, but exceptions exist. Preserve existing naming in the touched model.
- Enum names are generally snake_case, often with `_enum`, but enum values are mixed lower/upper case.
- TypeScript variables should stay camelCase unless mapping directly to Prisma field names.

## Schema Editing Workflow

1. Load relevant domain skills and `vendix-prisma-migrations`.
2. Edit `schema.prisma` minimally.
3. Create migration with backend workspace command or `prisma migrate dev --create-only` when SQL needs review first.
4. Review generated SQL for enum, data, FK, index, and destructive risks.
5. Register new models in scoped Prisma services before writing service logic.
6. Regenerate client if needed.

Preferred commands:

```bash
npm run db:migrate:dev -w apps/backend
npm run prisma:generate -w apps/backend
```

## Relationship And Index Rules

- Add indexes for foreign keys and common tenant filters.
- Multi-tenant models usually need `organization_id`, `store_id`, or a relation to a scoped parent.
- If a model is accessed through `StorePrismaService`, `OrganizationPrismaService`, or `EcommercePrismaService`, update the scoped service registration.
- For pgvector fields, Prisma uses `Unsupported("vector(1536)")`; vector operations use raw SQL.

## Migration Notes

- Adding enum values must be idempotent: `ALTER TYPE ... ADD VALUE IF NOT EXISTS` or guarded `DO $$`.
- If new enum values are used in data updates, split migrations when Postgres requires it.
- Do not drop columns/tables or mutate data without explicit approval and `DATA IMPACT` header.

## Related Skills

- `vendix-prisma-migrations`
- `vendix-prisma-scopes`
- `vendix-prisma-seed`
- `vendix-naming-conventions`
