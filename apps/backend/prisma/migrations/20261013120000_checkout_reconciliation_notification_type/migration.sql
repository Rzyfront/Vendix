-- DATA IMPACT:
-- Tables affected: none. Adds one notification_type_enum value.
-- Destructive operations: none.
-- Idempotency: guarded by pg_enum lookup.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type_enum'
      AND e.enumlabel = 'checkout_reconciliation_required'
  ) THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'checkout_reconciliation_required';
  END IF;
END $$;