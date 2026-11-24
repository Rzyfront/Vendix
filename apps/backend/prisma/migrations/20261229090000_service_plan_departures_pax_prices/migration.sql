-- QUI-1060 F1 · Modo Plan: servicios de varios días con salidas fijas / fecha libre,
-- cupos por salida y precio del paquete según tamaño del grupo.
--
-- DATA IMPACT:
-- Tables affected: products (8 new nullable columns), bookings (3 new nullable columns),
--                  service_plan_departures (new), service_plan_pax_prices (new)
-- Expected row changes: none (new empty tables, new nullable columns without backfill)
-- Destructive operations: none
-- FK/cascade risk: store and (store_id, product_id) FKs are ON DELETE RESTRICT;
--                  bookings.departure_id is ON DELETE SET NULL; no CASCADE
-- Idempotency: types guarded by pg_type, CREATE TABLE/INDEX IF NOT EXISTS,
--              ADD COLUMN IF NOT EXISTS, constraints guarded by pg_constraint.
--              New types are created (CREATE TYPE), no ALTER TYPE ... ADD VALUE.
-- Approval: plan QUI-1060 approved by Rafael (decisions 24-nov), additive only

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_plan_departure_mode_enum') THEN
    CREATE TYPE "service_plan_departure_mode_enum" AS ENUM ('fixed', 'on_demand', 'both');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_plan_departure_status_enum') THEN
    CREATE TYPE "service_plan_departure_status_enum" AS ENUM ('open', 'closed', 'cancelled');
  END IF;
END $$;

-- Producto: ficha y reglas del plan (NULL = no es plan; servicios actuales intactos).
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "plan_duration_days" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "plan_duration_nights" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "plan_departure_mode" "service_plan_departure_mode_enum";
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "plan_min_pax" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "plan_max_pax" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "plan_includes" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "plan_excludes" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "plan_recommendations" TEXT;

CREATE TABLE IF NOT EXISTS "service_plan_departures" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "departure_date" DATE NOT NULL,
  "capacity" INTEGER NOT NULL,
  "seats_sold" INTEGER NOT NULL DEFAULT 0,
  "price_override" DECIMAL(12,2),
  "status" "service_plan_departure_status_enum" NOT NULL DEFAULT 'open',
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_plan_departures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "service_plan_departures_store_product_date_idx"
  ON "service_plan_departures"("store_id", "product_id", "departure_date");

CREATE TABLE IF NOT EXISTS "service_plan_pax_prices" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "min_pax" INTEGER NOT NULL,
  "max_pax" INTEGER NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_plan_pax_prices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "service_plan_pax_prices_store_product_min_idx"
  ON "service_plan_pax_prices"("store_id", "product_id", "min_pax");

-- Reserva: salida ocupada y tamaño del grupo (NULL en servicios normales).
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "departure_id" INTEGER;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "pax_adults" INTEGER;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "pax_children" INTEGER;

CREATE INDEX IF NOT EXISTS "bookings_departure_id_idx" ON "bookings"("departure_id");

DO $$ BEGIN
  -- Cupo nunca negativo ni sobrevendido: respaldo en base de la guarda del servicio.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_departures_seats_check') THEN
    ALTER TABLE "service_plan_departures" ADD CONSTRAINT "service_plan_departures_seats_check"
      CHECK ("capacity" >= 1 AND "seats_sold" >= 0 AND "seats_sold" <= "capacity");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_departures_price_check') THEN
    ALTER TABLE "service_plan_departures" ADD CONSTRAINT "service_plan_departures_price_check"
      CHECK ("price_override" IS NULL OR "price_override" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_departures_store_fkey') THEN
    ALTER TABLE "service_plan_departures" ADD CONSTRAINT "service_plan_departures_store_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_departures_product_fkey') THEN
    ALTER TABLE "service_plan_departures" ADD CONSTRAINT "service_plan_departures_product_fkey"
      FOREIGN KEY ("store_id", "product_id") REFERENCES "products"("store_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_pax_prices_range_check') THEN
    ALTER TABLE "service_plan_pax_prices" ADD CONSTRAINT "service_plan_pax_prices_range_check"
      CHECK ("min_pax" >= 1 AND "max_pax" >= "min_pax" AND "price" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_pax_prices_store_fkey') THEN
    ALTER TABLE "service_plan_pax_prices" ADD CONSTRAINT "service_plan_pax_prices_store_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_pax_prices_product_fkey') THEN
    ALTER TABLE "service_plan_pax_prices" ADD CONSTRAINT "service_plan_pax_prices_product_fkey"
      FOREIGN KEY ("store_id", "product_id") REFERENCES "products"("store_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_departure_id_fkey') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_departure_id_fkey"
      FOREIGN KEY ("departure_id") REFERENCES "service_plan_departures"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_pax_check') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pax_check"
      CHECK (("pax_adults" IS NULL OR "pax_adults" >= 0) AND ("pax_children" IS NULL OR "pax_children" >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_plan_fields_check') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_plan_fields_check"
      CHECK (("plan_duration_days" IS NULL OR "plan_duration_days" >= 1)
         AND ("plan_duration_nights" IS NULL OR "plan_duration_nights" >= 0)
         AND ("plan_min_pax" IS NULL OR "plan_min_pax" >= 1)
         AND ("plan_max_pax" IS NULL OR "plan_max_pax" >= 1)
         AND ("plan_min_pax" IS NULL OR "plan_max_pax" IS NULL OR "plan_min_pax" <= "plan_max_pax"));
  END IF;
END $$;
