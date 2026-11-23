-- QUI-1013 — Manufacturing: several production plants per store (phase 1).
--
-- DATA IMPACT:
-- Tables affected:
--   manufacturing_plants (NEW): one INSERT per store that has a manufacturing_settings
--     row and still has no plant ("Planta principal", copied from the settings'
--     default input/output locations).
--   production_orders: new nullable column plant_id; UPDATE only rows with
--     plant_id IS NULL AND order_number IS NOT NULL (manufacturing orders) of the
--     stores that received a plant, pointing them to that store's first plant.
--     Restaurant orders (order_number NULL) are not touched.
-- Expected row changes: plants = count(manufacturing_settings without a plant);
--   orders = count(manufacturing orders of those stores). Pre-deploy count:
--     SELECT count(*) FROM manufacturing_settings;
--     SELECT count(*) FROM production_orders po
--       WHERE po.order_number IS NOT NULL
--         AND EXISTS (SELECT 1 FROM manufacturing_settings ms WHERE ms.store_id = po.store_id);
-- Destructive operations: none (no DROP, no TRUNCATE, no DELETE; UPDATE is guarded
--   by WHERE plant_id IS NULL). manufacturing_settings is left intact (its default
--   locations stay as the fallback of orders without a plant).
-- FK/cascade risk: none. production_orders.plant_id -> manufacturing_plants ON DELETE
--   RESTRICT (plants are deactivated, never deleted); plant locations -> inventory_locations
--   ON DELETE RESTRICT; plant store -> stores ON DELETE RESTRICT; plant manager -> users
--   ON DELETE SET NULL (optional reference on the child row, no cascade on business data).
-- Idempotency: IF NOT EXISTS on table/column/indexes, pg_constraint guards on FKs,
--   NOT EXISTS guard on the plant INSERT and plant_id IS NULL guard on the UPDATE.
--   Running it twice inserts/updates 0 rows the second time.
-- Approval: backfill requested in the QUI-1013 brief (Rafael). Take a prod snapshot first.

-- 1. Plants table.
CREATE TABLE IF NOT EXISTS "manufacturing_plants" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "input_location_id" INTEGER,
    "output_location_id" INTEGER,
    "manager_user_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_plants_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "manufacturing_plants_store_id_is_active_idx"
  ON "manufacturing_plants"("store_id", "is_active");
CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_plants_store_id_name_key"
  ON "manufacturing_plants"("store_id", "name");

-- 2. production_orders.plant_id (nullable: restaurant orders and stores without plants).
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "plant_id" INTEGER;
CREATE INDEX IF NOT EXISTS "production_orders_store_id_plant_id_idx"
  ON "production_orders"("store_id", "plant_id");

-- 3. Foreign keys (guarded).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_plants_store_id_fkey') THEN
    ALTER TABLE "manufacturing_plants" ADD CONSTRAINT "manufacturing_plants_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_plants_input_location_id_fkey') THEN
    ALTER TABLE "manufacturing_plants" ADD CONSTRAINT "manufacturing_plants_input_location_id_fkey"
      FOREIGN KEY ("input_location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_plants_output_location_id_fkey') THEN
    ALTER TABLE "manufacturing_plants" ADD CONSTRAINT "manufacturing_plants_output_location_id_fkey"
      FOREIGN KEY ("output_location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_plants_manager_user_id_fkey') THEN
    ALTER TABLE "manufacturing_plants" ADD CONSTRAINT "manufacturing_plants_manager_user_id_fkey"
      FOREIGN KEY ("manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_orders_plant_id_fkey') THEN
    ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_plant_id_fkey"
      FOREIGN KEY ("plant_id") REFERENCES "manufacturing_plants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- 4. Backfill: the current plant configuration becomes the store's first plant.
-- manufacturing_settings has no FK on its default locations, so an id that no
-- longer exists is copied as NULL (today's fallback) instead of failing the FK.
INSERT INTO "manufacturing_plants"
  ("store_id", "name", "input_location_id", "output_location_id", "is_active", "created_at", "updated_at")
SELECT
  ms."store_id",
  'Planta principal',
  (SELECT l."id" FROM "inventory_locations" l WHERE l."id" = ms."default_input_location_id"),
  (SELECT l."id" FROM "inventory_locations" l WHERE l."id" = ms."default_output_location_id"),
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "manufacturing_settings" ms
WHERE NOT EXISTS (
  SELECT 1 FROM "manufacturing_plants" p WHERE p."store_id" = ms."store_id"
);

-- 5. Backfill: existing manufacturing orders go to their store's first plant.
UPDATE "production_orders" po
SET "plant_id" = first_plant."id"
FROM (
  SELECT DISTINCT ON (p."store_id") p."id", p."store_id"
  FROM "manufacturing_plants" p
  ORDER BY p."store_id", p."id" ASC
) first_plant
WHERE po."store_id" = first_plant."store_id"
  AND po."plant_id" IS NULL
  AND po."order_number" IS NOT NULL;
