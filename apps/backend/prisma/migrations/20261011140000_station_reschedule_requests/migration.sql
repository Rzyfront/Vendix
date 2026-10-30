-- DATA IMPACT:
-- Adds optional station/provider/UTC target fields to pending reschedule requests.
-- Existing requests remain valid and NULL; no rows are rewritten.
-- No destructive operations. Composite FKs preserve store ownership.
-- Idempotente: se puede re-ejecutar sin error (columnas IF NOT EXISTS y
-- constraints protegidas con duplicate_object).

ALTER TABLE "booking_reschedule_requests"
  ADD COLUMN IF NOT EXISTS "requested_station_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "requested_provider_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "requested_slot_start_at" TIMESTAMPTZ(6);

DO $$
BEGIN
  ALTER TABLE "booking_reschedule_requests"
    ADD CONSTRAINT "booking_reschedule_requests_station_slot_pair_check"
      CHECK (("requested_station_id" IS NULL) = ("requested_slot_start_at" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "booking_reschedule_requests"
    ADD CONSTRAINT "booking_reschedule_requests_provider_station_check"
      CHECK ("requested_provider_id" IS NULL OR "requested_station_id" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "booking_reschedule_requests"
    ADD CONSTRAINT "booking_reschedule_requests_station_store_fkey"
      FOREIGN KEY ("requested_station_id", "store_id") REFERENCES "service_stations"("id", "store_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "booking_reschedule_requests"
    ADD CONSTRAINT "booking_reschedule_requests_provider_store_fkey"
      FOREIGN KEY ("requested_provider_id", "store_id") REFERENCES "service_providers"("id", "store_id") ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "booking_reschedule_requests_station_slot_idx"
  ON "booking_reschedule_requests"("store_id", "requested_station_id", "requested_slot_start_at")
  WHERE "status" = 'pending';
