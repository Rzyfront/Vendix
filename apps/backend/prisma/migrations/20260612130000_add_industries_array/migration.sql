-- DATA IMPACT:
-- Tables affected: stores (additive: new industries array column)
-- Expected row changes: 0 destructive mutations. Purely additive: new enum type
--   and a new array column with server-side default ARRAY['retail']::industry_enum[]
--   so all existing stores rows are backfilled to {'retail'} atomically by the
--   ADD COLUMN DEFAULT. No UPDATE/DELETE/TRUNCATE.
-- Destructive operations: none. No DROP, TRUNCATE, DELETE, UPDATE.
-- FK/cascade risk: none. New column on an existing table, no FK changes.
-- Idempotency:
--   - CREATE TYPE is guarded by pg_type lookup (DO $$ IF NOT EXISTS).
--   - ADD COLUMN uses IF NOT EXISTS.
--   - DEFAULT is server-side, so re-running the migration on a DB that already
--     has the column leaves existing values untouched (DEFAULT only applies to
--     newly inserted rows or rows that don't yet have a value).
-- Reversibility: trivial — DROP COLUMN + DROP TYPE.
-- Approval: Step 1 of approved plan
--   planning/industry-field-foundation-plan.md (industries Multi-Select Foundation).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'industry_enum') THEN
    CREATE TYPE "industry_enum" AS ENUM ('retail', 'restaurant', 'manufacturing', 'service');
  END IF;
END $$;

-- Add the industries array column to stores with default ARRAY['retail'].
-- The default backfills every existing row to {'retail'} atomically as part of
-- the ALTER TABLE; no separate UPDATE is required and none is performed.
ALTER TABLE "stores"
  ADD COLUMN IF NOT EXISTS "industries" "industry_enum"[] NOT NULL
  DEFAULT ARRAY['retail']::"industry_enum"[];
