-- DATA IMPACT:
-- Tables affected: none (creates ENUM TYPE only)
-- Expected row changes: none
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: guarded by pg_type existence check (CREATE TYPE inside DO $$ IF NOT EXISTS)
-- Approval: documented in docs/plans/withholding-system.plan.md (Block A)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'withholding_type_enum') THEN
    CREATE TYPE "withholding_type_enum" AS ENUM ('retefuente', 'reteiva', 'reteica');
  END IF;
END $$;
