-- DATA IMPACT:
-- - Adds product_price_tier_assignments as explicit product <-> price tier whitelist metadata.
-- - Backfills existing products with has_multiple_price_tiers=true using each store's active tiers.
-- - Non-destructive: no DELETE, TRUNCATE, DROP, or historical price mutation.

CREATE TABLE IF NOT EXISTS "product_price_tier_assignments" (
  "product_id" INTEGER NOT NULL,
  "price_tier_id" INTEGER NOT NULL,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_price_tier_assignments_pkey'
  ) THEN
    ALTER TABLE "product_price_tier_assignments"
      ADD CONSTRAINT "product_price_tier_assignments_pkey"
      PRIMARY KEY ("product_id", "price_tier_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_price_tier_assignments_product_id_fkey'
  ) THEN
    ALTER TABLE "product_price_tier_assignments"
      ADD CONSTRAINT "product_price_tier_assignments_product_id_fkey"
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
    WHERE conname = 'product_price_tier_assignments_price_tier_id_fkey'
  ) THEN
    ALTER TABLE "product_price_tier_assignments"
      ADD CONSTRAINT "product_price_tier_assignments_price_tier_id_fkey"
      FOREIGN KEY ("price_tier_id")
      REFERENCES "price_tiers"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "product_price_tier_assignments_price_tier_id_idx"
  ON "product_price_tier_assignments"("price_tier_id");

INSERT INTO "product_price_tier_assignments" (
  "product_id",
  "price_tier_id",
  "created_at"
)
SELECT
  p."id",
  pt."id",
  CURRENT_TIMESTAMP
FROM "products" p
JOIN "price_tiers" pt
  ON pt."store_id" = p."store_id"
 AND pt."is_active" = TRUE
WHERE p."has_multiple_price_tiers" = TRUE
ON CONFLICT ("product_id", "price_tier_id") DO NOTHING;
