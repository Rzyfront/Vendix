ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "online_purchase_url" TEXT,
  ADD COLUMN IF NOT EXISTS "online_purchase_qr_code" TEXT,
  ADD COLUMN IF NOT EXISTS "online_purchase_domain_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "online_purchase_generated_at" TIMESTAMP(6);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_online_purchase_domain_id_fkey'
  ) THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_online_purchase_domain_id_fkey"
      FOREIGN KEY ("online_purchase_domain_id")
      REFERENCES "domain_settings"("id")
      ON DELETE SET NULL
      ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_products_online_purchase_domain_id"
  ON "products"("online_purchase_domain_id");
