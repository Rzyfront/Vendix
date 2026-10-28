-- DATA IMPACT:
-- Tables affected: lodging_rate_prices (schema only, nullable column
-- season_id and its partial unique indexes). Creates lodging_seasons (empty).
-- Expected row changes: none. Existing price rows keep NULL (regular price).
-- Destructive operations: none on data. The two H2.1 partial unique indexes
-- of lodging_rate_prices are recreated with the extra predicate
-- "season_id IS NULL" (same name, same rows covered today).
-- FK/cascade risk: none. New FKs use ON DELETE RESTRICT.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- DROP INDEX IF EXISTS before each recreate and guarded constraints.
-- Approval: hospitality plan, slice H2.2 (owner decisions 2026-10-26).

-- Demand seasons. to_date is the last night inside the season.
CREATE TABLE IF NOT EXISTS "lodging_seasons" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "color" VARCHAR(7) NOT NULL DEFAULT '#F59E0B',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_seasons_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lodging_seasons_dates_check" CHECK ("to_date" >= "from_date")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_seasons_store_id_name_key" ON "lodging_seasons"("store_id", "name");
CREATE INDEX IF NOT EXISTS "lodging_seasons_store_id_from_date_to_date_idx" ON "lodging_seasons"("store_id", "from_date", "to_date");

-- Price of a plan × room type inside a season (NULL = regular price).
ALTER TABLE "lodging_rate_prices" ADD COLUMN IF NOT EXISTS "season_id" INTEGER;
CREATE INDEX IF NOT EXISTS "lodging_rate_prices_season_id_idx" ON "lodging_rate_prices"("season_id");

-- Regular prices: one base and one per weekday for each plan × type.
DROP INDEX IF EXISTS "lodging_rate_prices_base_key";
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_rate_prices_base_key" ON "lodging_rate_prices"("rate_plan_id", "unit_type_id") WHERE "day_of_week" IS NULL AND "season_id" IS NULL;
DROP INDEX IF EXISTS "lodging_rate_prices_dow_key";
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_rate_prices_dow_key" ON "lodging_rate_prices"("rate_plan_id", "unit_type_id", "day_of_week") WHERE "day_of_week" IS NOT NULL AND "season_id" IS NULL;
-- Season prices: the same, per season.
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_rate_prices_season_base_key" ON "lodging_rate_prices"("rate_plan_id", "unit_type_id", "season_id") WHERE "day_of_week" IS NULL AND "season_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_rate_prices_season_dow_key" ON "lodging_rate_prices"("rate_plan_id", "unit_type_id", "season_id", "day_of_week") WHERE "day_of_week" IS NOT NULL AND "season_id" IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_seasons_store_id_fkey') THEN
    ALTER TABLE "lodging_seasons" ADD CONSTRAINT "lodging_seasons_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_rate_prices_season_id_fkey') THEN
    ALTER TABLE "lodging_rate_prices" ADD CONSTRAINT "lodging_rate_prices_season_id_fkey"
      FOREIGN KEY ("season_id") REFERENCES "lodging_seasons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
