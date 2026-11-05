-- Estaciones fase 3 (S19): reservas recurrentes. Cada ocurrencia es una fila de bookings que
-- apunta a su serie (series_id, series_index).
--
-- DATA IMPACT:
-- Tables affected: booking_series (new), bookings (new nullable columns)
-- Expected row changes: none (new empty table, new nullable columns)
-- Destructive operations: none
-- FK/cascade risk: store, product and station FKs are ON DELETE RESTRICT; customer, variant, creator and bookings.series_id are ON DELETE SET NULL; no CASCADE
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, guarded constraints (pg_constraint)
-- Approval: plan approved in chat (L9 "Ejecuta!"), additive only

CREATE TABLE IF NOT EXISTS "booking_series" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "customer_id" INTEGER,
  "product_id" INTEGER NOT NULL,
  "product_variant_id" INTEGER,
  "station_id" INTEGER,
  "frequency" "booking_series_frequency_enum" NOT NULL,
  "interval_count" INTEGER NOT NULL DEFAULT 1,
  "start_date" DATE NOT NULL,
  "start_time" VARCHAR(5) NOT NULL,
  "end_time" VARCHAR(5) NOT NULL,
  "occurrences" INTEGER NOT NULL,
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_series_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "booking_series_store_created_idx" ON "booking_series"("store_id", "created_at");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_series_counts_check') THEN
    ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_counts_check"
      CHECK ("interval_count" >= 1 AND "occurrences" BETWEEN 1 AND 26);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_series_store_fkey') THEN
    ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_store_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_series_customer_fkey') THEN
    ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_customer_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_series_product_fkey') THEN
    ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_product_fkey"
      FOREIGN KEY ("store_id", "product_id") REFERENCES "products"("store_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_series_variant_fkey') THEN
    ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_variant_fkey"
      FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_series_station_fkey') THEN
    ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_station_fkey"
      FOREIGN KEY ("store_id", "station_id") REFERENCES "service_stations"("store_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_series_created_by_fkey') THEN
    ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_created_by_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "series_id" INTEGER;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "series_index" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "bookings_series_id_series_index_key" ON "bookings"("series_id", "series_index");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_series_id_fkey') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_series_id_fkey"
      FOREIGN KEY ("series_id") REFERENCES "booking_series"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
