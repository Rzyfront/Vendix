-- CreateEnum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_type_enum') THEN
    CREATE TYPE "product_type_enum" AS ENUM ('physical', 'service');
  END IF;
END
$$;

-- CreateEnum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_modality_enum') THEN
    CREATE TYPE "service_modality_enum" AS ENUM ('in_person', 'virtual', 'hybrid');
  END IF;
END
$$;

-- CreateEnum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_pricing_type_enum') THEN
    CREATE TYPE "service_pricing_type_enum" AS ENUM ('per_hour', 'per_session', 'package', 'subscription');
  END IF;
END
$$;

-- AlterTable order_items
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "item_type" VARCHAR(20) DEFAULT 'physical';

-- AlterTable products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_recurring" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "product_type" "product_type_enum" NOT NULL DEFAULT 'physical';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "requires_booking" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "service_duration_minutes" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "service_instructions" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "service_modality" "service_modality_enum";
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "service_pricing_type" "service_pricing_type_enum";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "products_store_id_product_type_idx" ON "products"("store_id", "product_type");
