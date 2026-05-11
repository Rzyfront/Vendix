-- DATA IMPACT:
-- Tables affected: fiscal_status_audit_log enum metadata only
-- Expected row changes: none
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: guarded by pg_enum existence check

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'fiscal_status_source_enum'
      AND e.enumlabel = 'wizard'
  ) THEN
    ALTER TYPE "fiscal_status_source_enum" ADD VALUE 'wizard';
  END IF;
END $$;
