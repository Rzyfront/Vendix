---
name: vendix-prisma-migrations
description: >
  Safe Prisma migration patterns for production: enum handling, failed migration recovery (P3009),
  checksum mismatch recovery, idempotent SQL, and deployment troubleshooting.
  Trigger: When creating migrations, editing migration SQL, deploying to production, or recovering from failed migrations.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke: "Creating migrations, editing migration SQL, deploying migrations to production, recovering from P3009, failed migration recovery, ALTER TYPE ADD VALUE, checksum mismatch, modified migration after apply"
---

# Vendix Prisma Migrations - Production Safety

> **Production-safe migration patterns** - Prevents P3009 crash loops, enum failures, and partial migration states.

## When to Use

- Creating new Prisma migrations (`prisma migrate dev`)
- Reviewing generated migration SQL before merge
- Deploying migrations to production
- Recovering from failed migrations (P3009, P3006, P3008)
- Adding values to existing PostgreSQL enums
- Debugging backend crash loops after deploy

---

## CRITICAL: How Migrations Run in Production

The Vendix backend runs migrations **automatically on container startup** via the Dockerfile CMD:

```dockerfile
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
```

**This means:**

- If `prisma migrate deploy` fails, the backend **never starts** (`node dist/src/main.js` never executes)
- Docker's restart policy creates an **infinite crash loop**
- Nginx returns **502 Bad Gateway** because port 3000 never opens
- The ONLY fix is to resolve the migration at the **database level** - no code change or redeploy will help

---

## Rule 1: PostgreSQL Enum Safety (MOST COMMON FAILURE)

PostgreSQL `ALTER TYPE ... ADD VALUE` runs **outside transactions**. This is the #1 cause of partial migration failures.

### The Problem

Prisma generates this SQL when you add a value to an enum:

```sql
-- This runs OUTSIDE the transaction (PostgreSQL limitation)
ALTER TYPE "payments_state_enum" ADD VALUE 'cancelled';

-- These run INSIDE the transaction
ALTER TABLE "products" ADD COLUMN "pricing_type" "pricing_type_enum" NOT NULL DEFAULT 'unit';
```

If `cancelled` already exists in the enum, the `ADD VALUE` fails with:

```
ERROR: enum label "cancelled" already exists (code 42710)
```

The enum change was already applied (or was already present), but Prisma marks the **entire migration as failed**. Now you have:

- A partially applied migration that Prisma refuses to retry
- A `_prisma_migrations` record with `finished_at = NULL`
- Backend stuck in crash loop

### The Fix: Always Edit Migration SQL for Enums

After running `prisma migrate dev`, **ALWAYS review and edit** the generated migration SQL:

```sql
-- WRONG (Prisma default - not idempotent)
ALTER TYPE "payments_state_enum" ADD VALUE 'cancelled';

-- CORRECT (idempotent - safe for production)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'cancelled'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'payments_state_enum')
  ) THEN
    ALTER TYPE "payments_state_enum" ADD VALUE 'cancelled';
  END IF;
END
$$;
```

### The Fix (PostgreSQL 12+): Use IF NOT EXISTS

If the database is PostgreSQL 12+, you can use the simpler syntax:

```sql
ALTER TYPE "payments_state_enum" ADD VALUE IF NOT EXISTS 'cancelled';
```

> **Vendix uses PostgreSQL on RDS** - confirm version with `SELECT version();` but it should support `IF NOT EXISTS`.

---

## Rule 2: Always Review Generated Migration SQL

After `npx prisma migrate dev --name your_migration`, **before committing**:

1. Open the generated `migration.sql` file
2. Check for any `ALTER TYPE ... ADD VALUE` statements
3. Replace them with the idempotent version (Rule 1)
4. Check for `CREATE TYPE` that might already exist (use `IF NOT EXISTS` pattern)
5. Check for `CREATE INDEX` statements (add `IF NOT EXISTS`)

### Idempotent Patterns for Common Operations

```sql
-- Safe enum creation
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pricing_type_enum') THEN
    CREATE TYPE "pricing_type_enum" AS ENUM ('unit', 'weight');
  END IF;
END
$$;

-- Safe column addition
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "pricing_type" "pricing_type_enum" NOT NULL DEFAULT 'unit';

-- Safe index creation
CREATE INDEX IF NOT EXISTS "idx_products_pricing_type" ON "products"("pricing_type");
```

---

## Rule 3: Recovering from Failed Migrations (P3009)

When a migration fails in production, Prisma blocks ALL future migrations until the failure is resolved.

### Diagnosis

```bash
# SSH into the EC2 instance
ssh -i <key.pem> ec2-user@<server-ip>

# Check if backend is in crash loop
sudo docker ps -a  # Look for "Restarting" status

# Read the error
sudo docker logs vendix-backend --tail 50

# Check the migration record in the database
PGPASSWORD=<password> psql -h <rds-host> -U postgres -d vendix_db -c "
SELECT migration_name, started_at, finished_at, applied_steps_count, logs
FROM _prisma_migrations
WHERE finished_at IS NULL;
"
```

### Recovery Steps

**Step 1: Determine what was partially applied**

```bash
# Check if the enum/columns/tables from the failed migration exist
PGPASSWORD=<password> psql -h <rds-host> -U postgres -d vendix_db -c "
-- Check for enum
SELECT typname FROM pg_type WHERE typname = 'your_enum_name';
-- Check for columns
SELECT column_name FROM information_schema.columns
WHERE table_name = 'your_table' AND column_name IN ('col1', 'col2');
"
```

**Step 2A: If changes were partially applied (most common with enums)**

Apply the remaining changes manually, then mark as completed:

```sql
-- 1. Apply whatever is missing (example)
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "weight" DECIMAL(10,3);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "pricing_type" "pricing_type_enum" NOT NULL DEFAULT 'unit';

-- 2. Mark migration as successfully applied
UPDATE _prisma_migrations
SET finished_at = NOW(), applied_steps_count = 1, logs = NULL
WHERE migration_name = '20260302092145_add_pricing_type_and_weight_fields';
```

**Step 2B: If nothing was applied (clean failure)**

```sql
-- Option 1: Roll back and let Prisma retry
DELETE FROM _prisma_migrations
WHERE migration_name = '20260302092145_add_pricing_type_and_weight_fields';

-- Then fix the migration SQL to be idempotent and redeploy

-- Option 2: Use Prisma CLI from inside the container
-- (only works if you can exec into the container)
npx prisma migrate resolve --rolled-back 20260302092145_add_pricing_type_and_weight_fields
```

**Step 3: Restart the container**

```bash
sudo docker restart vendix-backend
# Wait and verify
sleep 10 && sudo docker ps && sudo docker logs vendix-backend --tail 20
```

**Step 4: Verify the API is responding**

```bash
curl -s -o /dev/null -w "%{http_code}" https://api.vendix.online/api/health
```

---

## Rule 4: Migration Checklist (Before Merge)

Every PR that includes a migration MUST verify:

- [ ] `migration.sql` has been manually reviewed
- [ ] All `ALTER TYPE ... ADD VALUE` use `IF NOT EXISTS` or the `DO $$ ... END $$` pattern
- [ ] All `CREATE TYPE` use the idempotent `DO $$ ... END $$` pattern
- [ ] **No `TRUNCATE ... CASCADE`, no `DROP TABLE`, no unscoped `DELETE FROM`** (see Rule 7)
- [ ] No destructive operations (DROP TABLE, DROP COLUMN, data wipe) without explicit user approval documented in the PR
- [ ] If migration clears a table with inbound FKs, FKs are dropped FIRST and recreated at the end
- [ ] Migration tested locally with `prisma migrate deploy` (not just `migrate dev`)
- [ ] If migration modifies enums, tested on a **fresh database** AND on a database with **existing data**
- [ ] If migration touches data in tables with FK dependents, tested against a **representative dataset** (not empty DB)

---

## Rule 5: Enum Migrations - The Safe Workflow

When adding a value to an existing enum:

```bash
# 1. Edit schema.prisma
# Add the new enum value

# 2. Generate migration (don't apply yet)
npx prisma migrate dev --create-only --name add_cancelled_to_payments_state

# 3. EDIT the generated migration.sql
# Replace the ALTER TYPE line with idempotent version

# 4. Apply locally
npx prisma migrate dev

# 5. Commit both schema.prisma AND the edited migration.sql
```

---

## Rule 6: NEVER Edit Applied Migrations (Checksum Mismatch)

Prisma stores a SHA-256 hash (checksum) of each migration's `.sql` file in the `_prisma_migrations` table. When you run `migrate dev` or `migrate deploy`, Prisma recalculates the hash and compares it. **If they differ by even a single character (including spaces or comments), Prisma refuses to continue.**

### The Problem

If someone edits an already-applied migration file (even with good intentions like adding `IF NOT EXISTS`):

```
Error: The migration `20260330170000_add_wallet_enum_value` was modified after it was applied.
We need to reset the "public" schema at "db:5432"
```

`migrate dev` will demand a **full database reset** (`DROP SCHEMA public`) — destroying ALL data.

### The Golden Rule

> **NEVER edit the SQL of a migration that has already been applied to ANY database (dev or production).**

If you need to "fix" an applied migration:
1. **DON'T** edit the existing migration file
2. **DO** create a new migration with the corrective SQL

### Recovery: The "Resolve + Apply Manual" Pattern

When you encounter a checksum mismatch and need to create a new migration without `migrate dev` cooperating:

```bash
# 1. Create the migration directory manually
mkdir -p prisma/migrations/20260412000000_fix_whatever

# 2. Write idempotent SQL in migration.sql
cat > prisma/migrations/20260412000000_fix_whatever/migration.sql << 'EOF'
ALTER TYPE "my_enum" ADD VALUE IF NOT EXISTS 'new_value';
ALTER TABLE "my_table" ADD COLUMN IF NOT EXISTS "new_col" TIMESTAMP(6);
EOF

# 3. Register the migration as applied WITHOUT executing it
npx prisma migrate resolve --applied 20260412000000_fix_whatever

# 4. Apply the SQL changes directly to the database
psql -U username -d vendix_db -c "ALTER TYPE \"my_enum\" ADD VALUE IF NOT EXISTS 'new_value';"
psql -U username -d vendix_db -c "ALTER TABLE \"my_table\" ADD COLUMN IF NOT EXISTS \"new_col\" TIMESTAMP(6);"
```

### Fixing Checksums in Production

If a modified migration was already deployed to production and you can't change the file back:

```sql
-- Option 1: Update the checksum to match the current file
-- First, get the new checksum from a clean migrate dev on a fresh DB, or calculate it
UPDATE _prisma_migrations
SET checksum = '<new_checksum_from_current_file>'
WHERE migration_name = '20260330170000_add_wallet_enum_value';

-- Option 2: Query current checksums to compare
SELECT migration_name, checksum, finished_at
FROM _prisma_migrations
ORDER BY started_at DESC
LIMIT 10;
```

### Verifying Checksum Integrity

Before deploying, verify no checksums are mismatched:

```bash
# Inside the container or with access to the database
npx prisma migrate status
```

If it reports "modified after applied", you have a checksum mismatch that MUST be resolved before deploying.

---

## Rule 7: NEVER Destructive Data Operations (TRUNCATE CASCADE is BANNED)

> **This rule has absolute priority. Violating it destroys production data.**

Migrations must preserve existing row-level data unless the user has explicitly authorized data loss AND a prod snapshot was taken before apply. Schema evolution is allowed; silent data wipes are NOT.

### The Killer: `TRUNCATE ... CASCADE`

PostgreSQL's `TRUNCATE target CASCADE` cascades **at the TABLE level, not the row level**. It ignores `ON DELETE RESTRICT`, `ON DELETE SET NULL`, and every other FK rule. Any table with an FK pointing (directly or transitively) to `target` is also truncated — entirely, all rows gone.

#### Real incident (April 2026, dev DB)

A migration aimed to reset the `brands` table for multi-tenant conversion:

```sql
-- ❌ DESTRUCTIVE - silently wiped products, variants, order_items
UPDATE products SET brand_id = NULL WHERE brand_id IS NOT NULL;
TRUNCATE TABLE brands RESTART IDENTITY CASCADE;
```

Intent: disassociate products from brands, then clear brands.
Reality: `TRUNCATE CASCADE` truncated `products`, `product_variants`, `order_items`, and everything downstream. Sales history lost.

The `UPDATE ... SET brand_id = NULL` was cosmetic — it does not remove the FK constraint, which is what CASCADE follows.

### The Safe Pattern for Clearing a Table With Inbound FKs

```sql
BEGIN;

-- 1. Drop FK(s) pointing into the target table FIRST
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_brand_id_fkey;

-- 2. (Optional) Null out references to preserve child rows explicitly
UPDATE products SET brand_id = NULL WHERE brand_id IS NOT NULL;

-- 3. Clear target WITHOUT CASCADE - no dependent table is touched
DELETE FROM brands;
-- or TRUNCATE TABLE brands;  (NO CASCADE keyword)

-- 4. Recreate FK with the desired ON DELETE behavior
ALTER TABLE products
  ADD CONSTRAINT products_brand_id_fkey
  FOREIGN KEY (brand_id) REFERENCES brands(id)
  ON DELETE SET NULL ON UPDATE NO ACTION;

COMMIT;
```

### Banned Patterns

| Pattern | Why banned | Safe alternative |
|---------|------------|------------------|
| `TRUNCATE ... CASCADE` | Silent table-level cascade, bypasses ON DELETE rules | Drop inbound FKs → `DELETE FROM` or `TRUNCATE` (no CASCADE) → recreate FKs |
| `DELETE FROM table` without `WHERE` | Unscoped row wipe | Add explicit `WHERE` that proves intent, or justify in PR |
| `DROP TABLE foo` | Irrecoverable without backup | Rename to `foo_deprecated_YYYYMMDD`; drop in later migration after verifying no reads |
| `ALTER TABLE ... DROP COLUMN` on populated column | Data loss | Mark column as deprecated in code first; drop in follow-up migration |
| `ON DELETE CASCADE` on parent tables holding business data | Chained deletion of unrelated rows | `ON DELETE RESTRICT` or `ON DELETE SET NULL` |
| `UPDATE foo SET x = Y` without `WHERE` | Mass mutation | Scope with `WHERE`; show expected row count in PR |

### Destructive Data Operation Decision Tree

Before writing any SQL that modifies existing rows:

```
Is this statement INSERT-only and only adds new rows? → Safe, proceed.
  ↓ No
Does it modify/delete existing rows?
  ↓ Yes
Does the user's request EXPLICITLY authorize this data change?
  ↓ No → STOP. Find a non-destructive alternative or ask the user.
  ↓ Yes
Is the affected data recoverable from backup/snapshot?
  ↓ No → STOP. Require snapshot before proceeding.
  ↓ Yes
Is the blast radius documented in the migration header comment?
  ↓ No → Document it (which tables, estimated row count, why).
  ↓ Yes
Have you checked inbound FKs for cascade risk? (`pg_constraint`)
  ↓ No → Check now. CASCADE bans apply.
  ↓ Yes → Proceed with safe pattern (drop FKs first).
```

### Required PR Comment for Any Data-Modifying Migration

```markdown
## Data Impact
- **Tables affected:** brands (cleared), products (brand_id set to NULL)
- **Tables preserved:** products, variants, order_items, inventory
- **Expected row changes:** brands N → 0; products M rows updated (brand_id NULL)
- **FK drop/recreate:** products_brand_id_fkey dropped pre-clear, recreated with ON DELETE SET NULL
- **Cascade risk check:** verified no remaining FKs point to brands (pg_constraint query)
- **User approval:** @username approved in #channel / PR comment
- **Snapshot:** RDS snapshot `vendix-prod-YYYYMMDD-pre-brands-reset` taken before deploy
```

A migration modifying data without this section MUST NOT merge.

---

## Common Prisma Migration Errors

| Error     | Cause                            | Solution                                                   |
| --------- | -------------------------------- | ---------------------------------------------------------- |
| **P3009** | Failed migration blocks new ones | Recover using Rule 3 steps                                 |
| **P3006** | Migration not cleanly applicable | Schema drift - compare DB state vs migration               |
| **P3008** | Migration already applied        | Mark as applied: `prisma migrate resolve --applied <name>` |
| **P3012** | Migration checksum mismatch      | NEVER edit applied migrations. Use Rule 6 recovery steps   |
| **42710** | Enum label already exists        | Use `IF NOT EXISTS` pattern (Rule 1)                       |
| **42P07** | Relation/type already exists     | Use `IF NOT EXISTS` on CREATE                              |
| **42701** | Column already exists            | Use `ADD COLUMN IF NOT EXISTS`                             |

---

## EC2 + Docker Quick Reference

```bash
# SSH into production
ssh -i keys/vendix-production-key.pem ec2-user@<server-ip>

# Check container status
sudo docker ps -a

# Read container logs
sudo docker logs vendix-backend --tail 100

# Restart after DB fix
sudo docker restart vendix-backend

# Execute command inside running container
sudo docker exec vendix-backend npx prisma migrate status

# Run one-off command with the backend image
sudo docker run --rm -e DATABASE_URL='...' --entrypoint sh <image> -c "npx prisma migrate status"

# Connect to RDS directly
PGPASSWORD=<password> psql -h <rds-host> -U postgres -d vendix_db
```

---

## Prevention Summary

1. **NEVER** commit a migration with bare `ALTER TYPE ... ADD VALUE` - always make it idempotent
2. **ALWAYS** use `--create-only` for migrations that touch enums, then edit the SQL
3. **ALWAYS** review `migration.sql` before committing
4. **TEST** migrations with `prisma migrate deploy` locally, not just `prisma migrate dev`
5. **KNOW** how to recover: the fix is always at the DB level, not in code
6. **NEVER** edit the SQL of a migration that has already been applied — create a new corrective migration instead
7. **NEVER** accept a `prisma migrate dev` database reset when there is data you want to keep — use the "resolve + apply manual" pattern (Rule 6)
8. **NEVER** use `TRUNCATE ... CASCADE`, `DROP TABLE`, or unscoped `DELETE FROM`/`UPDATE` in a migration — they silently destroy data across tables (Rule 7)
9. **ALWAYS** drop inbound FKs BEFORE clearing a table, then recreate after — never rely on `ON DELETE` rules to protect data during CASCADE
10. **ANY** migration that mutates existing rows requires: explicit user approval + PR-documented data impact + prod snapshot before deploy

---

## Related Skills

- `vendix-prisma-schema` - Schema editing and development workflow
- `vendix-prisma-scopes` - Multi-tenant scoping system
- `vendix-ec2-maintenance` - Server troubleshooting
- `git-workflow` - Commit and PR rules for migrations
