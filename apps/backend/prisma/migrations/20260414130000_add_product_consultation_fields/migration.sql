-- Add consultation fields to products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_consultation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "send_preconsultation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "consultation_template_id" INTEGER;

-- Add foreign key constraint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_consultation_template_id_fkey') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_consultation_template_id_fkey"
      FOREIGN KEY ("consultation_template_id") REFERENCES "data_collection_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Add index
CREATE INDEX IF NOT EXISTS "products_store_id_is_consultation_idx" ON "products"("store_id", "is_consultation");
