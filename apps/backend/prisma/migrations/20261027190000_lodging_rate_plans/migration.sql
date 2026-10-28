-- DATA IMPACT:
-- Tables affected: lodging_reservation_rooms (schema only, nullable column
-- rate_plan_id). Creates lodging_rate_plans and lodging_rate_prices (empty).
-- Expected row changes: none. Existing reservation rooms keep NULL (priced at
-- the room type base price, as today).
-- Destructive operations: none.
-- FK/cascade risk: none. New FKs use ON DELETE RESTRICT.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS and
-- guarded constraints.
-- Approval: hospitality plan, slice H2.1 (owner decisions 2026-10-26).

CREATE TABLE IF NOT EXISTS "lodging_rate_plans" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(30),
    "meal_plan" VARCHAR(30) NOT NULL DEFAULT 'room_only',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_rate_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_rate_plans_store_id_name_key" ON "lodging_rate_plans"("store_id", "name");
CREATE INDEX IF NOT EXISTS "lodging_rate_plans_store_id_is_active_idx" ON "lodging_rate_plans"("store_id", "is_active");
-- One default plan per store (Prisma cannot express a partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_rate_plans_store_default_key" ON "lodging_rate_plans"("store_id") WHERE "is_default";

-- Nightly price of a room type in a plan. day_of_week NULL = base price of
-- every night; 0 (Sunday) .. 6 (Saturday) overrides that weekday.
CREATE TABLE IF NOT EXISTS "lodging_rate_prices" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "rate_plan_id" INTEGER NOT NULL,
    "unit_type_id" INTEGER NOT NULL,
    "day_of_week" SMALLINT,
    "price" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_rate_prices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lodging_rate_prices_day_of_week_check" CHECK ("day_of_week" IS NULL OR "day_of_week" BETWEEN 0 AND 6),
    CONSTRAINT "lodging_rate_prices_price_check" CHECK ("price" >= 0)
);

CREATE INDEX IF NOT EXISTS "lodging_rate_prices_rate_plan_id_unit_type_id_idx" ON "lodging_rate_prices"("rate_plan_id", "unit_type_id");
CREATE INDEX IF NOT EXISTS "lodging_rate_prices_unit_type_id_idx" ON "lodging_rate_prices"("unit_type_id");
-- One base price and one price per weekday for each plan × room type.
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_rate_prices_base_key" ON "lodging_rate_prices"("rate_plan_id", "unit_type_id") WHERE "day_of_week" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_rate_prices_dow_key" ON "lodging_rate_prices"("rate_plan_id", "unit_type_id", "day_of_week") WHERE "day_of_week" IS NOT NULL;

-- Plan each reservation room was sold with (NULL = room type base price).
ALTER TABLE "lodging_reservation_rooms" ADD COLUMN IF NOT EXISTS "rate_plan_id" INTEGER;
CREATE INDEX IF NOT EXISTS "lodging_reservation_rooms_rate_plan_id_idx" ON "lodging_reservation_rooms"("rate_plan_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_rate_plans_store_id_fkey') THEN
    ALTER TABLE "lodging_rate_plans" ADD CONSTRAINT "lodging_rate_plans_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_rate_prices_store_id_fkey') THEN
    ALTER TABLE "lodging_rate_prices" ADD CONSTRAINT "lodging_rate_prices_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_rate_prices_rate_plan_id_fkey') THEN
    ALTER TABLE "lodging_rate_prices" ADD CONSTRAINT "lodging_rate_prices_rate_plan_id_fkey"
      FOREIGN KEY ("rate_plan_id") REFERENCES "lodging_rate_plans"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_rate_prices_unit_type_id_fkey') THEN
    ALTER TABLE "lodging_rate_prices" ADD CONSTRAINT "lodging_rate_prices_unit_type_id_fkey"
      FOREIGN KEY ("unit_type_id") REFERENCES "lodging_unit_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_reservation_rooms_rate_plan_id_fkey') THEN
    ALTER TABLE "lodging_reservation_rooms" ADD CONSTRAINT "lodging_reservation_rooms_rate_plan_id_fkey"
      FOREIGN KEY ("rate_plan_id") REFERENCES "lodging_rate_plans"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
