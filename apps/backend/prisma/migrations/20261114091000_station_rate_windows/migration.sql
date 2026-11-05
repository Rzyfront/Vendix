-- Estaciones fase 3 (S18): tarifa del bloque de alquiler por día de la semana y franja horaria.
-- Mismo formato que service_station_schedules; end_time <= start_time cruza la medianoche.
--
-- DATA IMPACT:
-- Tables affected: service_station_rate_windows (new)
-- Expected row changes: none (new empty table)
-- Destructive operations: none
-- FK/cascade risk: every new FK is ON DELETE RESTRICT; no CASCADE
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS, guarded constraints (pg_constraint)
-- Approval: plan approved in chat (L9 "Ejecuta!"), additive only

CREATE TABLE IF NOT EXISTS "service_station_rate_windows" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "station_id" INTEGER NOT NULL,
  "weekday" SMALLINT NOT NULL,
  "block_order" INTEGER NOT NULL DEFAULT 0,
  "start_time" VARCHAR(5) NOT NULL,
  "end_time" VARCHAR(5) NOT NULL,
  "block_price" DECIMAL(12,2) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_station_rate_windows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_station_rate_windows_station_weekday_block_key"
  ON "service_station_rate_windows"("station_id", "weekday", "block_order");
CREATE INDEX IF NOT EXISTS "service_station_rate_windows_store_station_weekday_idx"
  ON "service_station_rate_windows"("store_id", "station_id", "weekday");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_station_rate_windows_time_format_check') THEN
    ALTER TABLE "service_station_rate_windows" ADD CONSTRAINT "service_station_rate_windows_time_format_check"
      CHECK ("start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_station_rate_windows_weekday_check') THEN
    ALTER TABLE "service_station_rate_windows" ADD CONSTRAINT "service_station_rate_windows_weekday_check"
      CHECK ("weekday" BETWEEN 0 AND 6);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_station_rate_windows_price_check') THEN
    ALTER TABLE "service_station_rate_windows" ADD CONSTRAINT "service_station_rate_windows_price_check"
      CHECK ("block_price" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_station_rate_windows_store_fkey') THEN
    ALTER TABLE "service_station_rate_windows" ADD CONSTRAINT "service_station_rate_windows_store_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_station_rate_windows_station_fkey') THEN
    ALTER TABLE "service_station_rate_windows" ADD CONSTRAINT "service_station_rate_windows_station_fkey"
      FOREIGN KEY ("store_id", "station_id") REFERENCES "service_stations"("store_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
