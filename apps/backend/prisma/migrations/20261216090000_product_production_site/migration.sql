-- Dónde se produce cada producto (cocina vs planta) y a qué pantalla pertenece
-- cada orden de producción.
--
-- DATA IMPACT:
-- Tables affected:
--   products: two new nullable columns (production_site VARCHAR(20),
--     production_plant_id INTEGER) + FK to manufacturing_plants ON DELETE SET NULL.
--   production_orders: one new nullable column (production_site VARCHAR(20)).
-- Expected row changes: 0. No UPDATE, no INSERT, no DELETE: existing rows keep
--   NULL, which the application resolves exactly as before (product: by store
--   industry; order: Planta = manual orders with a consecutive, Producción = rest).
-- Destructive operations: none (no DROP, no TRUNCATE, no DELETE, no UPDATE).
-- FK/cascade risk: none. products.production_plant_id -> manufacturing_plants
--   ON DELETE SET NULL (optional reference on the child row; plants are
--   deactivated, never deleted).
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS and a
--   pg_constraint guard on the FK. Running it twice changes nothing.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "production_site" VARCHAR(20);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "production_plant_id" INTEGER;
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "production_site" VARCHAR(20);

CREATE INDEX IF NOT EXISTS "products_production_plant_id_idx"
  ON "products"("production_plant_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_production_plant_id_fkey') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_production_plant_id_fkey"
      FOREIGN KEY ("production_plant_id") REFERENCES "manufacturing_plants"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
