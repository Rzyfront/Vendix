-- products.usage_nature: naturaleza de uso del producto (venta, insumo, uso interno).
--
-- DATA IMPACT:
--   Tables affected: products (schema only: new column with DEFAULT).
--   Expected row changes: 0 explicit DML. Existing rows take the DEFAULT 'sale',
--     so everything that sells today keeps selling exactly the same.
--   Destructive operations: none.
--   FK/cascade risk: none.
--   Idempotency: guarded CREATE TYPE, ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
--
-- Rollback (manual, separate migration):
--   DROP INDEX IF EXISTS "products_store_id_usage_nature_state_idx";
--   -- Only once no row uses supply/internal_use, or after an explicit decision:
--   ALTER TABLE "products" DROP COLUMN IF EXISTS "usage_nature";
--   DROP TYPE IF EXISTS "product_usage_nature_enum";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_usage_nature_enum') THEN
    CREATE TYPE "product_usage_nature_enum" AS ENUM ('sale', 'supply', 'internal_use');
  END IF;
END $$;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "usage_nature" "product_usage_nature_enum" NOT NULL DEFAULT 'sale';

CREATE INDEX IF NOT EXISTS "products_store_id_usage_nature_state_idx"
  ON "products"("store_id", "usage_nature", "state");
