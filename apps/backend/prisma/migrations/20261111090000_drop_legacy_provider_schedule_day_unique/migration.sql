-- DATA IMPACT:
-- Tables affected: provider_schedules (index only)
-- Expected row changes: none
-- Destructive operations: drops the legacy unique index on (provider_id, day_of_week).
--   20260328160000_provider_first_scheduling created it with CREATE UNIQUE INDEX;
--   20260719000000_add_multi_block_schedules tried to drop it as a CONSTRAINT
--   (information_schema.table_constraints does not list plain unique indexes),
--   so it survived and rejects a second block on the same day (P2002 →
--   "Los bloques del horario están duplicados…"). Uniqueness stays enforced by
--   provider_schedules_provider_id_day_of_week_block_order_key.
-- FK/cascade risk: none
-- Idempotency: IF EXISTS guards; no-op where the index is already gone.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'provider_schedules_provider_id_day_of_week_key'
  ) THEN
    ALTER TABLE "provider_schedules"
      DROP CONSTRAINT "provider_schedules_provider_id_day_of_week_key";
  END IF;
END $$;

DROP INDEX IF EXISTS "provider_schedules_provider_id_day_of_week_key";

-- Guarantee the multi-block uniqueness exists before relying on it.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'provider_schedules'
      AND indexname = 'provider_schedules_provider_id_day_of_week_block_order_key'
  ) THEN
    ALTER TABLE "provider_schedules"
      ADD CONSTRAINT "provider_schedules_provider_id_day_of_week_block_order_key"
      UNIQUE ("provider_id", "day_of_week", "block_order");
  END IF;
END $$;
