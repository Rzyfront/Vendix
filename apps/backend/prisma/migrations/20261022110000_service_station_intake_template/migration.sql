-- DATA IMPACT:
-- Tables affected: service_stations (1 new nullable column + FK).
-- Expected row changes: none. Existing stations keep NULL, so check-in keeps using the
--   service's linked intake form until a station-level form is chosen.
-- Destructive operations: none. Archiving/deleting a template sets the column to NULL.
-- FK/cascade risk: ON DELETE SET NULL to data_collection_templates(id).
-- Idempotency: guarded with IF NOT EXISTS / constraint existence check.
ALTER TABLE "service_stations" ADD COLUMN IF NOT EXISTS "intake_template_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_stations_intake_template_id_fkey') THEN
    ALTER TABLE "service_stations"
      ADD CONSTRAINT "service_stations_intake_template_id_fkey"
      FOREIGN KEY ("intake_template_id") REFERENCES "data_collection_templates"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "service_stations_intake_template_id_idx" ON "service_stations"("intake_template_id");
