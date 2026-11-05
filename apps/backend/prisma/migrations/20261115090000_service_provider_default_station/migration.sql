-- Estaciones (S10): estación preferida del proveedor de servicio. Al agendar con ese
-- proveedor se intenta primero su estación; si no sirve, cae a la asignación automática.
--
-- DATA IMPACT:
-- Tables affected: service_providers (new nullable column default_station_id)
-- Expected row changes: none (additive column, NULL for every existing row)
-- Destructive operations: none
-- FK/cascade risk: FK to service_stations(id) is ON DELETE SET NULL (clears the preference only); no CASCADE
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, constraint guarded by pg_constraint
-- Approval: authorized in chat for S10 (additive only)

ALTER TABLE "service_providers" ADD COLUMN IF NOT EXISTS "default_station_id" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_providers_default_station_fkey') THEN
    ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_default_station_fkey"
      FOREIGN KEY ("default_station_id") REFERENCES "service_stations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "service_providers_default_station_id_idx" ON "service_providers"("default_station_id");
