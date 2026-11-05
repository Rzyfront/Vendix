-- Estaciones fase 3 (S1, S2, S10, S11, S18): reglas de alquiler de la estación (unidad, modo de
-- cobro, momento del cobro, cobro para reservar), copia de la tarifa en la atención, orden propia
-- del alquiler, unidad de duración del producto y precio cotizado de la reserva.
--
-- DATA IMPACT:
-- Tables affected: service_stations, service_sessions, products, product_variants, bookings (new columns only)
-- Expected row changes: none (new nullable columns, or NOT NULL columns with constant defaults that reproduce today's behavior)
-- Destructive operations: none (no DROP, no UPDATE, no DELETE)
-- FK/cascade risk: service_sessions_rental_order_fkey is ON DELETE RESTRICT; no CASCADE
-- Idempotency: guarded enums (pg_type), ADD COLUMN IF NOT EXISTS, guarded constraints (pg_constraint), CREATE INDEX IF NOT EXISTS
-- Approval: plan approved in chat (L9 "Ejecuta!"), additive only

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'duration_unit_enum') THEN
    CREATE TYPE "duration_unit_enum" AS ENUM ('minute', 'hour', 'day');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'station_rental_billing_enum') THEN
    CREATE TYPE "station_rental_billing_enum" AS ENUM ('elapsed', 'planned');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'station_rental_timing_enum') THEN
    CREATE TYPE "station_rental_timing_enum" AS ENUM ('at_start', 'at_end');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'station_prepay_mode_enum') THEN
    CREATE TYPE "station_prepay_mode_enum" AS ENUM ('none', 'full', 'partial');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rental_pricing_mode_enum') THEN
    CREATE TYPE "rental_pricing_mode_enum" AS ENUM ('fixed_price', 'station_rate');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_series_frequency_enum') THEN
    CREATE TYPE "booking_series_frequency_enum" AS ENUM ('daily', 'weekly');
  END IF;
END $$;

ALTER TABLE "service_stations" ADD COLUMN IF NOT EXISTS "rental_block_unit" "duration_unit_enum" NOT NULL DEFAULT 'minute';
ALTER TABLE "service_stations" ADD COLUMN IF NOT EXISTS "rental_billing_mode" "station_rental_billing_enum" NOT NULL DEFAULT 'elapsed';
ALTER TABLE "service_stations" ADD COLUMN IF NOT EXISTS "rental_charge_timing" "station_rental_timing_enum" NOT NULL DEFAULT 'at_end';
ALTER TABLE "service_stations" ADD COLUMN IF NOT EXISTS "booking_prepay_mode" "station_prepay_mode_enum" NOT NULL DEFAULT 'none';
ALTER TABLE "service_stations" ADD COLUMN IF NOT EXISTS "booking_prepay_percent" DECIMAL(5,2);
ALTER TABLE "service_stations" ADD COLUMN IF NOT EXISTS "booking_prepay_amount" DECIMAL(12,2);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_stations_booking_prepay_check') THEN
    ALTER TABLE "service_stations" ADD CONSTRAINT "service_stations_booking_prepay_check"
      CHECK (
        ("booking_prepay_percent" IS NULL OR ("booking_prepay_percent" > 0 AND "booking_prepay_percent" <= 100))
        AND ("booking_prepay_amount" IS NULL OR "booking_prepay_amount" > 0)
      );
  END IF;
END $$;

ALTER TABLE "service_sessions" ADD COLUMN IF NOT EXISTS "rental_billing_mode" "station_rental_billing_enum";
ALTER TABLE "service_sessions" ADD COLUMN IF NOT EXISTS "rental_charge_timing" "station_rental_timing_enum";
ALTER TABLE "service_sessions" ADD COLUMN IF NOT EXISTS "rental_block_minutes" INTEGER;
ALTER TABLE "service_sessions" ADD COLUMN IF NOT EXISTS "rental_block_price" DECIMAL(12,2);
ALTER TABLE "service_sessions" ADD COLUMN IF NOT EXISTS "rate_windows_snapshot" JSONB;
ALTER TABLE "service_sessions" ADD COLUMN IF NOT EXISTS "rental_order_id" INTEGER;

CREATE INDEX IF NOT EXISTS "service_sessions_rental_order_idx" ON "service_sessions"("rental_order_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_sessions_rental_order_fkey') THEN
    ALTER TABLE "service_sessions" ADD CONSTRAINT "service_sessions_rental_order_fkey"
      FOREIGN KEY ("store_id", "rental_order_id") REFERENCES "orders"("store_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "service_duration_unit" "duration_unit_enum";
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "rental_pricing_mode" "rental_pricing_mode_enum";
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "service_duration_unit" "duration_unit_enum";

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "quoted_amount" DECIMAL(12,2);
