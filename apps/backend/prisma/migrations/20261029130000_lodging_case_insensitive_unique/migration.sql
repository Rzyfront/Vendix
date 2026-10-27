-- DATA IMPACT:
-- Tables affected:
--   · lodging_unit_types — 1 unique index ADDED on (store_id, lower(name)).
--   · lodging_units      — 1 unique index ADDED on (store_id, lower(code)).
-- Expected row changes: 0 rows mutated. Pure DDL; the duplicate guard below
--   only counts.
-- Destructive operations: NONE. No DROP, TRUNCATE, CASCADE, DELETE or UPDATE.
-- FK/cascade risk: none. No FK is touched.
-- Idempotency: CREATE UNIQUE INDEX IF NOT EXISTS. Re-runnable.
--
-- Why: the services already reject "Doble"/"doble" and "A1"/"a1" in the same
-- store, but the existing unique indexes are case-sensitive, so two concurrent
-- requests could both pass. These indexes close that race; the existing
-- (store_id, name) and (store_id, code) indexes stay.
--
-- THE DEPLOY CAN FAIL, on purpose: if a store already has names or codes that
-- differ only in case, the guard aborts naming them instead of renaming data.
--
-- Prisma cannot represent an index on an expression: these live only in this
-- SQL. Do not drop them believing the schema covers them.

DO $$
DECLARE
    dup_count integer;
    dup_sample text;
BEGIN
    SELECT count(*), string_agg(detail, '; ')
      INTO dup_count, dup_sample
      FROM (
        SELECT format('lodging_unit_types store_id=%s name="%s" (ids %s)',
                      store_id, min(name), string_agg(id::text, ',' ORDER BY id)) AS detail
          FROM lodging_unit_types
         GROUP BY store_id, lower(name)
        HAVING count(*) > 1
        UNION ALL
        SELECT format('lodging_units store_id=%s code="%s" (ids %s)',
                      store_id, min(code), string_agg(id::text, ',' ORDER BY id))
          FROM lodging_units
         GROUP BY store_id, lower(code)
        HAVING count(*) > 1
         LIMIT 10
      ) AS duplicates;

    IF COALESCE(dup_count, 0) > 0 THEN
        RAISE EXCEPTION
            'Cannot create case-insensitive lodging unique indexes: % duplicate group(s). %. Rename them manually and re-apply.',
            dup_count, dup_sample;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_unit_types_store_id_lower_name_key"
    ON "lodging_unit_types" ("store_id", lower("name"));

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_units_store_id_lower_code_key"
    ON "lodging_units" ("store_id", lower("code"));
