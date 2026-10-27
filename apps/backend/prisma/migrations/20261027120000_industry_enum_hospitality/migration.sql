-- DATA IMPACT:
-- Tables affected: none.
-- Enum changes: industry_enum += 'hospitality'
--   (idempotent ADD VALUE; the new value is NOT used by any DDL here).
-- Expected row changes: none. No existing store changes industry:
--   `stores.industries` defaults to [retail] and this migration touches no rows.
-- Destructive operations: none.
-- FK/cascade risk: none. A new enum value does not alter constraints.
-- Idempotency: guarded with ADD VALUE IF NOT EXISTS — safe to re-run.
-- Approval: hospitality plan, slice H0.1 (owner decisions 2026-10-26).
--
-- WHY THIS MIGRATION STANDS ALONE
-- Postgres cannot use an enum value in the same transaction that adds it.
-- Any later DDL or backfill referencing 'hospitality' (lodging tables in
-- H0.2+) must live in a subsequent migration.

ALTER TYPE "industry_enum" ADD VALUE IF NOT EXISTS 'hospitality';
