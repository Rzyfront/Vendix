-- DATA IMPACT:
-- Tables affected: service_providers (new column + one-time backfill).
-- Expected row changes: every provider that has at least one provider_schedules
--   row (active or not) gets uses_store_hours = false, so it keeps its own
--   schedule and its customers see the same slots as before. Providers with no
--   provider_schedules row keep the default true (today they offer no slots;
--   they start inheriting the store hours in settings.pos.business_hours).
-- Destructive operations: none (additive column, provider_schedules untouched).
-- FK/cascade risk: none.
-- Idempotency: the column is added and backfilled in the same guarded block,
--   only when it does not exist yet. A re-run is a no-op and never overwrites
--   a choice a store made after the first run.
-- Approval: requested by Rafael (24 nov 2026, "una sola fuente de verdad").

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'service_providers'
      AND column_name = 'uses_store_hours'
  ) THEN
    ALTER TABLE "service_providers"
      ADD COLUMN "uses_store_hours" BOOLEAN NOT NULL DEFAULT true;

    UPDATE "service_providers" AS sp
    SET "uses_store_hours" = false
    WHERE EXISTS (
      SELECT 1 FROM "provider_schedules" AS ps WHERE ps."provider_id" = sp."id"
    );
  END IF;
END $$;
