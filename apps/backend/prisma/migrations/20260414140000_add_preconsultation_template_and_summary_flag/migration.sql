-- Add preconsultation_template_id to products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "preconsultation_template_id" INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_preconsultation_template_id_fkey') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_preconsultation_template_id_fkey"
      FOREIGN KEY ("preconsultation_template_id") REFERENCES "data_collection_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Add include_in_summary to data_collection_items
ALTER TABLE "data_collection_items" ADD COLUMN IF NOT EXISTS "include_in_summary" BOOLEAN NOT NULL DEFAULT false;
