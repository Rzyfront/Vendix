-- Vexi background tasks need their own notification types.
--
-- A long-running task (a 200-row bulk validation, a reconciliation sweep) finishes
-- minutes after the person left the chat, so the only way they learn about it is
-- the bell. Reusing an existing type would have mislabelled it in the panel's
-- filters and routed the click to the wrong module.
--
-- DATA IMPACT: none. Two new labels appended to an existing enum; no rows read,
-- written or deleted. Appending an enum value is not destructive and cannot
-- invalidate existing rows, since no row can already carry a label that did not
-- exist. Idempotent: each ADD VALUE is guarded by a pg_enum existence check, so
-- re-running the migration is a no-op rather than a duplicate_object error.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'vexi_task_completed'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'notification_type_enum')
  ) THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'vexi_task_completed';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'vexi_task_failed'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'notification_type_enum')
  ) THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'vexi_task_failed';
  END IF;
END $$;
