-- DATA IMPACT:
-- Adds optional station/provider/UTC target fields to pending reschedule requests.
-- Existing requests remain valid and NULL; no rows are rewritten.
-- No destructive operations. Composite FKs preserve store ownership.

ALTER TABLE "booking_reschedule_requests"
  ADD COLUMN "requested_station_id" INTEGER,
  ADD COLUMN "requested_provider_id" INTEGER,
  ADD COLUMN "requested_slot_start_at" TIMESTAMPTZ(6);

ALTER TABLE "booking_reschedule_requests"
  ADD CONSTRAINT "booking_reschedule_requests_station_slot_pair_check"
    CHECK (("requested_station_id" IS NULL) = ("requested_slot_start_at" IS NULL)),
  ADD CONSTRAINT "booking_reschedule_requests_provider_station_check"
    CHECK ("requested_provider_id" IS NULL OR "requested_station_id" IS NOT NULL),
  ADD CONSTRAINT "booking_reschedule_requests_station_store_fkey"
    FOREIGN KEY ("requested_station_id", "store_id") REFERENCES "service_stations"("id", "store_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "booking_reschedule_requests_provider_store_fkey"
    FOREIGN KEY ("requested_provider_id", "store_id") REFERENCES "service_providers"("id", "store_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE INDEX "booking_reschedule_requests_station_slot_idx"
  ON "booking_reschedule_requests"("store_id", "requested_station_id", "requested_slot_start_at")
  WHERE "status" = 'pending';