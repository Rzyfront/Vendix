-- Balanza etiquetadora: código de balanza (PLU) por producto de peso.
-- DATA IMPACT:
-- Tables affected: products (nueva columna nullable)
-- Expected row changes: ninguno (no se muta ninguna fila)
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: ADD COLUMN IF NOT EXISTS, CHECK guardado en DO $$, CREATE INDEX IF NOT EXISTS

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "scale_code" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_scale_code_range_check'
      AND conrelid = 'products'::regclass
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_scale_code_range_check"
      CHECK ("scale_code" IS NULL OR ("scale_code" BETWEEN 1 AND 999999));
  END IF;
END $$;

-- Unicidad por tienda SOLO entre productos no archivados (igual que sku/barcode).
CREATE UNIQUE INDEX IF NOT EXISTS "products_store_id_scale_code_active_key"
  ON "products" ("store_id", "scale_code")
  WHERE "state" <> 'archived' AND "scale_code" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "products_store_id_scale_code_idx"
  ON "products" ("store_id", "scale_code");
