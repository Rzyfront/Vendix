# Destructive data operations (detail for Rule 7)

## Incident (April 2026, dev DB)

```sql
-- DESTRUCTIVE: silently wiped products, product_variants, order_items
UPDATE products SET brand_id = NULL WHERE brand_id IS NOT NULL;
TRUNCATE TABLE brands RESTART IDENTITY CASCADE;
```

The `UPDATE` was cosmetic: it does not remove the FK, which is what `CASCADE` follows. `TRUNCATE CASCADE` truncates every table with an FK (direct or transitive) to the target, whole tables, ignoring `ON DELETE` rules.

## Safe pattern for clearing a table with inbound FKs

```sql
BEGIN;
-- 1. Drop inbound FKs FIRST
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_brand_id_fkey;
-- 2. (Optional) null out references to preserve children
UPDATE products SET brand_id = NULL WHERE brand_id IS NOT NULL;
-- 3. Clear target WITHOUT CASCADE
DELETE FROM brands;   -- or TRUNCATE TABLE brands;  (no CASCADE)
-- 4. Recreate FK with explicit ON DELETE
ALTER TABLE products ADD CONSTRAINT products_brand_id_fkey
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL ON UPDATE NO ACTION;
COMMIT;
```

Find inbound FKs:

```sql
SELECT conname, conrelid::regclass AS child
FROM pg_constraint WHERE contype = 'f' AND confrelid = 'brands'::regclass;
```

## Banned patterns

| Pattern | Why | Safe alternative |
| --- | --- | --- |
| `TRUNCATE ... CASCADE` | Table-level cascade, bypasses ON DELETE | Drop inbound FKs → `DELETE`/`TRUNCATE` (no CASCADE) → recreate FKs |
| `DELETE FROM t` without `WHERE` | Unscoped wipe | Explicit `WHERE` proving intent, justified in PR |
| `DROP TABLE foo` | Irrecoverable | Rename to `foo_deprecated_YYYYMMDD`; drop later after verifying no reads |
| `DROP COLUMN` on populated column | Data loss | Deprecate in code first; drop in follow-up migration |
| `ON DELETE CASCADE` on business parents | Chained deletion | `RESTRICT` or `SET NULL` |
| `UPDATE t SET x = y` without `WHERE` | Mass mutation | Scope with `WHERE`; state expected row count |

## Decision tree (before any SQL that touches existing rows)

1. INSERT-only, new rows? → proceed.
2. Modifies/deletes rows → does the user's request explicitly authorize it? No → stop; find a non-destructive alternative or ask.
3. Recoverable from snapshot? No → require snapshot first.
4. Blast radius documented in the `-- DATA IMPACT:` header (tables, estimated rows, why)? No → document.
5. Inbound FKs checked via `pg_constraint`? No → check; CASCADE bans apply.
6. Proceed with the safe pattern.

## Required PR section

```markdown
## Data Impact
- **Tables affected:** brands (cleared), products (brand_id set to NULL)
- **Tables preserved:** products, variants, order_items, inventory
- **Expected row changes:** brands N → 0; products M rows updated
- **FK drop/recreate:** products_brand_id_fkey dropped pre-clear, recreated ON DELETE SET NULL
- **Cascade risk check:** pg_constraint query shows no remaining FKs to brands
- **User approval:** link to chat/PR comment
- **Snapshot:** RDS snapshot `vendix-prod-YYYYMMDD-pre-<change>` taken before deploy
```

A data-modifying migration without this section must not merge.
