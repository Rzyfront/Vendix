-- DATA IMPACT: ninguna fila modificada. Sólo schema additions, todas las nuevas columnas nullables.
-- TABLAS AFECTADAS: product_variants (4 cols), bookings (1 col + 1 FK + 1 index).
-- SIN CASCADE / SIN TRUNCATE / SIN DROP / SIN UPDATE.

ALTER TABLE "product_variants"
  ADD COLUMN IF NOT EXISTS "service_duration_minutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "service_pricing_type" "service_pricing_type_enum",
  ADD COLUMN IF NOT EXISTS "buffer_minutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "preparation_time_minutes" INTEGER;

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "product_variant_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_product_variant_id_fkey'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_product_variant_id_fkey"
      FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "bookings_store_product_variant_date_idx"
  ON "bookings" ("store_id", "product_id", "product_variant_id", "date");
