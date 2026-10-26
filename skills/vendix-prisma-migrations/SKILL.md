---
name: vendix-prisma-migrations
description: >
  Production-safe Prisma migrations: idempotent SQL, enums, DATA IMPACT headers, destructive-op bans, failed-migration recovery. Trigger: creating/editing migration SQL, migrate deploy, P3009/P3012, checksum mismatch, any failed migration.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.2"
  scope: [root]
  auto_invoke: "Creating migrations, editing migration SQL, deploying migrations to production, recovering from P3009, failed migration recovery, ALTER TYPE ADD VALUE, checksum mismatch, modified migration after apply"
---

## When to Use

- Creating or reviewing `apps/backend/prisma/migrations/**/migration.sql`.
- Adding enum values, columns, indexes, constraints, or tables.
- Any migration that mutates existing rows.
- Recovering from `P3009`, `P3006`, `P3008`, `P3012`, `P3018`, enum conflicts, or checksum mismatches.

## How Migrations Run in Production

The Dockerfile CMD is only `node dist/src/main.js`. Migrations run in `.github/workflows/deploy-backend-ec2.yml` as a one-off container **before** the app starts: `npx prisma migrate deploy && node prisma/assert-schema-columns.js` (the second step checks `information_schema` so a skipped migration fails the deploy instead of producing `ColumnNotFound` 500s later). If it fails, the deploy stops; the fix is always at DB/migration level, never by redeploying code. The workflow deliberately does **not** auto-resolve failed migrations.

## Commands

```bash
npm run db:migrate:dev -w apps/backend
npm run db:migrate:prod -w apps/backend      # prisma migrate deploy
npm run prisma:generate -w apps/backend
npx prisma migrate dev --create-only --name describe_change   # SQL-first review (from apps/backend)
npx prisma migrate status                     # detects "modified after applied"
```

## Rule 1: Enum Safety

`ALTER TYPE ... ADD VALUE` runs outside the transaction; a bare one fails with `42710` if the label exists and leaves the migration half-applied (P3009). Always:

```sql
ALTER TYPE "my_enum" ADD VALUE IF NOT EXISTS 'new_value';
```

or the guarded `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_enum ...) ... END $$` form.

## Rule 2: Review Generated SQL Before Committing

Make every statement idempotent:

```sql
ALTER TABLE "my_table" ADD COLUMN IF NOT EXISTS "new_col" TEXT;
CREATE INDEX IF NOT EXISTS "idx_my_table_new_col" ON "my_table"("new_col");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'my_enum') THEN
    CREATE TYPE "my_enum" AS ENUM ('a', 'b');
  END IF;
END $$;
```

Recent migrations also use guarded `pg_attribute`, `pg_constraint`, `pg_enum`, `ON CONFLICT DO NOTHING`, and pre-flight validation before enum conversion. Follow those patterns.

## Rule 3: Failed Migration Recovery (P3009/P3018)

1. Inspect: `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations WHERE finished_at IS NULL;`
2. Verify what really exists via `information_schema` / `pg_type` / `pg_constraint`; never assume.
3. Nothing applied (`applied_steps_count = 0`, objects absent) → fix the SQL and `prisma migrate resolve --rolled-back <name>`.
4. Partially applied → complete the missing parts idempotently, then `prisma migrate resolve --applied <name>`. **Never `--rolled-back` here**: it re-runs all SQL, duplicating row mutations.
5. Never "fix" by editing an already-applied migration file.

This recovery is the only allowed exception to "DB changes only via migration". Diagnosis queries, EC2/RDS commands and verification: `references/recovery.md` (read on demand).

## Rule 4: Pre-Merge Checklist

- [ ] `migration.sql` manually reviewed; enums/types/indexes idempotent (Rules 1-2).
- [ ] No `TRUNCATE ... CASCADE`, `DROP TABLE`, unscoped `DELETE`/`UPDATE` (Rule 7).
- [ ] Destructive ops only with explicit user approval documented in the PR.
- [ ] Inbound FKs dropped first and recreated when clearing a table.
- [ ] Tested locally with `prisma migrate deploy` (not only `migrate dev`); enum changes on a fresh DB **and** on one with data; data changes on a representative dataset.

## Rule 5: Enum Workflow

1. Edit `schema.prisma`. 2. `migrate dev --create-only`. 3. Make the `ALTER TYPE` idempotent. 4. Apply locally. 5. Commit schema + edited SQL.
If the same migration later uses the new value, split it: (a) add values, (b) use them.

## Rule 6: Never Edit Applied Migrations (P3012 / Checksum Mismatch)

Prisma stores a SHA-256 checksum per migration; any byte change makes `migrate dev` demand a full schema reset (all data lost). Never edit SQL already applied to **any** DB; create a new corrective migration. Never accept a `migrate dev` reset on a DB with data you want to keep; use the "resolve + apply manual" pattern in `references/recovery.md`.

## Rule 7: No Destructive Data Operations

Absolute priority. Banned unless the user explicitly authorizes it and a prod snapshot exists:

- `TRUNCATE ... CASCADE` (table-level cascade, ignores `ON DELETE RESTRICT/SET NULL`; wiped `products`, variants and `order_items` in the April 2026 brands incident).
- `DROP TABLE` (rename to `<table>_deprecated_YYYYMMDD`, drop later), `DROP COLUMN` on populated columns.
- `DELETE FROM` / `UPDATE ... SET` without `WHERE`.
- `ON DELETE CASCADE` on parent tables with business data.

Clearing a table with inbound FKs (when approved): find inbound FKs via `pg_constraint` → drop them **first** → null/repoint children if preserving → `DELETE`/`TRUNCATE` without `CASCADE` → recreate FKs with explicit `ON DELETE`. Never rely on `ON DELETE` rules during a cascade.

Any migration that mutates rows needs: explicit approval, prod snapshot, `-- DATA IMPACT:` header, FK/cascade analysis, representative dry-run, and the PR "Data Impact" section.

```sql
-- DATA IMPACT:
-- Tables affected: subscription_invoices
-- Expected row changes: remap state partially_paid -> issued if present
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: guarded by WHERE and IF EXISTS checks
-- Approval: documented in chat/PR
```

Safe-pattern SQL, banned-pattern table, decision tree and PR template: `references/destructive-ops.md` (read on demand).

## Error Codes

| Error | Fix |
| --- | --- |
| P3009 / P3018 | Failed migration blocks deploy → Rule 3 |
| P3006 | Not cleanly applicable (drift) → compare DB vs migration |
| P3008 | Already applied → `migrate resolve --applied <name>` |
| P3012 | Checksum mismatch → Rule 6 |
| 42710 / 42P07 / 42701 | Enum label / relation / column exists → `IF NOT EXISTS` |

## Related Skills

- `vendix-prisma`
- `vendix-prisma-scopes`
- `vendix-prisma-seed`
- `vendix-ec2-maintenance` - Server troubleshooting
- `git-workflow`
