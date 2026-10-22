-- DATA IMPACT:
-- Tables affected: service_stations (2 new columns).
-- Expected row changes: none rewritten. Existing stations get track_time = false, so the
--   attention timer is hidden until the store turns it on per station.
-- Destructive operations: none.
-- FK/cascade risk: none.
-- Idempotency: guarded with IF NOT EXISTS.
ALTER TABLE "service_stations" ADD COLUMN IF NOT EXISTS "track_time" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "service_stations" ADD COLUMN IF NOT EXISTS "target_minutes" INTEGER;
