-- DATA IMPACT:
-- - Adds product_sale_uoms (QUI-978): sale UoMs per measured product (one principal + additional).
-- - Non-destructive: new empty table, no backfill, no DELETE/TRUNCATE/DROP, no row mutation.

CREATE TABLE IF NOT EXISTS "product_sale_uoms" (
  "id"           SERIAL       PRIMARY KEY,
  "product_id"   INTEGER      NOT NULL,
  "uom_id"       INTEGER      NOT NULL,
  "is_principal" BOOLEAN      NOT NULL DEFAULT false,
  "created_at"   TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_sale_uoms_product_id_fkey'
  ) THEN
    ALTER TABLE "product_sale_uoms"
      ADD CONSTRAINT "product_sale_uoms_product_id_fkey"
      FOREIGN KEY ("product_id")
      REFERENCES "products"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_sale_uoms_uom_id_fkey'
  ) THEN
    ALTER TABLE "product_sale_uoms"
      ADD CONSTRAINT "product_sale_uoms_uom_id_fkey"
      FOREIGN KEY ("uom_id")
      REFERENCES "units_of_measure"("id")
      ON DELETE RESTRICT
      ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_sale_uoms_product_id_uom_id_key'
  ) THEN
    ALTER TABLE "product_sale_uoms"
      ADD CONSTRAINT "product_sale_uoms_product_id_uom_id_key"
      UNIQUE ("product_id", "uom_id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "product_sale_uoms_uom_id_idx"
  ON "product_sale_uoms"("uom_id");

-- Single principal per product. Prisma cannot express a partial unique
-- index: this statement is the ONLY enforcer, do not remove it.
CREATE UNIQUE INDEX IF NOT EXISTS "product_sale_uoms_single_principal_idx"
  ON "product_sale_uoms"("product_id")
  WHERE is_principal;
