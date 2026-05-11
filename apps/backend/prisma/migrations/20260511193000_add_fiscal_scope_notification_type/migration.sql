-- DATA IMPACT:
-- Tables affected: none directly. Adds one enum value to notification_type_enum.
-- Destructive operations: none. No DELETE, TRUNCATE, DROP TABLE, or column drops.
-- Idempotency: guarded by pg_enum lookup.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type_enum'
      AND e.enumlabel = 'fiscal_scope_changed'
  ) THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'fiscal_scope_changed';
  END IF;
END $$;
