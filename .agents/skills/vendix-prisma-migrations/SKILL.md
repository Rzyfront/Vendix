---
name: vendix-prisma-migrations
description: >
  Production-safe Prisma migration patterns for Vendix: idempotent SQL, enum handling,
  data-impact headers, destructive-operation bans, failed migration recovery, and Prisma 7
  config. Trigger: When creating migrations, editing migration SQL, deploying migrations,
  or recovering from failed Prisma migrations.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke: "Creating migrations, editing migration SQL, deploying migrations to production, recovering from P3009, failed migration recovery, ALTER TYPE ADD VALUE, checksum mismatch, modified migration after apply"
---

## When to Use

- Creating or reviewing `apps/backend/prisma/migrations/**/migration.sql`.
- Adding enum values, columns, indexes, constraints, or tables.
- Any migration that mutates existing rows.
- Recovering from `P3009`, `P3006`, `P3008`, `P3012`, enum conflicts, or checksum mismatches.

## Current Runtime Reality

The current backend Dockerfile runs `node dist/src/main.js`; it does not currently run `npx prisma migrate deploy` in the container CMD. Do not claim startup migrations unless deployment pipeline code confirms it.

Production deploys still must run `prisma migrate deploy` somewhere in the release process. Migration failures can still block deploys and must be resolved at database/migration level.

## Commands

```bash
npm run db:migrate:dev -w apps/backend
npm run db:migrate:prod -w apps/backend
npm run prisma:generate -w apps/backend
```

For SQL-first review:

```bash
npx prisma migrate dev --create-only --name describe_change
```

## Mandatory Safety Rules

- Never commit bare `ALTER TYPE ... ADD VALUE`; use `IF NOT EXISTS` or guarded `DO $$`.
- Never edit an already-applied migration; create a new corrective migration.
- Never use `TRUNCATE ... CASCADE`.
- Never use `DELETE FROM table` or `UPDATE table SET ...` without `WHERE`.
- Never drop populated columns/tables without explicit user approval and backup/snapshot.
- Never add `ON DELETE CASCADE` to business parent tables without explicit approval.
- Data-mutating migrations require explicit user approval, `DATA IMPACT` header, FK/cascade analysis, and representative dry-run.

## DATA IMPACT Header

Use this pattern for any migration that modifies rows or has non-trivial production risk:

```sql
-- DATA IMPACT:
-- Tables affected: subscription_invoices
-- Expected row changes: remap state partially_paid -> issued if present
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: guarded by WHERE and IF EXISTS checks
-- Approval: documented in chat/PR
```

## Idempotent SQL Patterns

```sql
ALTER TYPE "my_enum" ADD VALUE IF NOT EXISTS 'new_value';

ALTER TABLE "my_table" ADD COLUMN IF NOT EXISTS "new_col" TEXT;

CREATE INDEX IF NOT EXISTS "idx_my_table_new_col" ON "my_table"("new_col");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'my_enum') THEN
    CREATE TYPE "my_enum" AS ENUM ('a', 'b');
  END IF;
END $$;
```

Recent migrations also use guarded `pg_attribute`, `pg_constraint`, `pg_enum`, `ON CONFLICT DO NOTHING`, and pre-flight validation before enum conversion. Follow those existing patterns.

## Enum Rule

Postgres enum additions can be problematic when the same migration later uses the new value. If needed, split into two migrations:

1. Add enum values idempotently.
2. Use new values in data/schema changes.

## Failed Migration Recovery

General workflow:

1. Inspect `_prisma_migrations` for `finished_at IS NULL`.
2. Determine which SQL was partially applied using catalog queries.
3. Apply missing changes idempotently or mark migration rolled back/applied with Prisma CLI or DB update only when safe.
4. Never “fix” by editing an already-applied migration file.

Use `prisma migrate resolve --applied <migration>` or `--rolled-back <migration>` when appropriate and safe.

## Destructive Table Cleanup Pattern

If clearing a table with inbound FKs is explicitly approved:

1. Identify inbound FKs through `pg_constraint`.
2. Drop inbound FKs first.
3. Null/repoint child rows if preserving them.
4. Delete/truncate target without `CASCADE`.
5. Recreate FKs with explicit `ON DELETE` behavior.

## Related Skills

- `vendix-prisma-schema`
- `vendix-prisma-scopes`
- `vendix-prisma-seed`
- `git-workflow`
