-- DATA IMPACT:
-- Tables affected: marketing_ad_creatives, marketing_ad_creative_products, marketing_ad_creative_images
-- Expected row changes: none (schema-only migration)
-- Destructive operations: none
-- FK/cascade risk: child rows cascade only when an ad creative is deleted; store/product parents are restricted
-- Idempotency: guarded types, tables, constraints, and indexes

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'marketing_ad_creative_status_enum'
  ) THEN
    CREATE TYPE "marketing_ad_creative_status_enum" AS ENUM (
      'draft',
      'processing',
      'completed',
      'failed'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'marketing_ad_creative_format_enum'
  ) THEN
    CREATE TYPE "marketing_ad_creative_format_enum" AS ENUM (
      'square',
      'story',
      'landscape'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "marketing_ad_creatives" (
  "id" SERIAL PRIMARY KEY,
  "store_id" INTEGER NOT NULL,
  "created_by_user_id" INTEGER,
  "title" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "prompt" TEXT,
  "format" "marketing_ad_creative_format_enum" NOT NULL DEFAULT 'square',
  "status" "marketing_ad_creative_status_enum" NOT NULL DEFAULT 'draft',
  "image_url" TEXT,
  "thumb_url" TEXT,
  "ai_app_key" VARCHAR(100) NOT NULL DEFAULT 'marketing_ad_image_generator',
  "provider_model" VARCHAR(100),
  "error_message" TEXT,
  "generation_metadata" JSONB,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(6)
);

CREATE TABLE IF NOT EXISTS "marketing_ad_creative_products" (
  "id" SERIAL PRIMARY KEY,
  "creative_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "marketing_ad_creative_images" (
  "id" SERIAL PRIMARY KEY,
  "creative_id" INTEGER NOT NULL,
  "product_image_id" INTEGER,
  "image_url" TEXT,
  "source_type" VARCHAR(30) NOT NULL DEFAULT 'product',
  "sort_order" INTEGER DEFAULT 0
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketing_ad_creatives_store_id_fkey'
  ) THEN
    ALTER TABLE "marketing_ad_creatives"
      ADD CONSTRAINT "marketing_ad_creatives_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketing_ad_creatives_created_by_user_id_fkey'
  ) THEN
    ALTER TABLE "marketing_ad_creatives"
      ADD CONSTRAINT "marketing_ad_creatives_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketing_ad_creative_products_creative_id_fkey'
  ) THEN
    ALTER TABLE "marketing_ad_creative_products"
      ADD CONSTRAINT "marketing_ad_creative_products_creative_id_fkey"
      FOREIGN KEY ("creative_id") REFERENCES "marketing_ad_creatives"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketing_ad_creative_products_product_id_fkey'
  ) THEN
    ALTER TABLE "marketing_ad_creative_products"
      ADD CONSTRAINT "marketing_ad_creative_products_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketing_ad_creative_images_creative_id_fkey'
  ) THEN
    ALTER TABLE "marketing_ad_creative_images"
      ADD CONSTRAINT "marketing_ad_creative_images_creative_id_fkey"
      FOREIGN KEY ("creative_id") REFERENCES "marketing_ad_creatives"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketing_ad_creative_images_product_image_id_fkey'
  ) THEN
    ALTER TABLE "marketing_ad_creative_images"
      ADD CONSTRAINT "marketing_ad_creative_images_product_image_id_fkey"
      FOREIGN KEY ("product_image_id") REFERENCES "product_images"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marketing_ad_creative_products_creative_id_product_id_key'
  ) THEN
    ALTER TABLE "marketing_ad_creative_products"
      ADD CONSTRAINT "marketing_ad_creative_products_creative_id_product_id_key"
      UNIQUE ("creative_id", "product_id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "marketing_ad_creatives_store_id_status_idx"
  ON "marketing_ad_creatives"("store_id", "status");

CREATE INDEX IF NOT EXISTS "marketing_ad_creatives_store_id_created_at_idx"
  ON "marketing_ad_creatives"("store_id", "created_at");

CREATE INDEX IF NOT EXISTS "marketing_ad_creatives_created_by_user_id_idx"
  ON "marketing_ad_creatives"("created_by_user_id");

CREATE INDEX IF NOT EXISTS "marketing_ad_creative_products_creative_id_idx"
  ON "marketing_ad_creative_products"("creative_id");

CREATE INDEX IF NOT EXISTS "marketing_ad_creative_products_product_id_idx"
  ON "marketing_ad_creative_products"("product_id");

CREATE INDEX IF NOT EXISTS "marketing_ad_creative_images_creative_id_idx"
  ON "marketing_ad_creative_images"("creative_id");

CREATE INDEX IF NOT EXISTS "marketing_ad_creative_images_product_image_id_idx"
  ON "marketing_ad_creative_images"("product_image_id");
