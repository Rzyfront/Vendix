-- Multi-NIT DIAN Configurations
-- Allows multiple DIAN configurations per store (e.g., persona natural CC + empresa NIT/SAS)

-- 1. Create enum for NIT document types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dian_nit_type_enum') THEN
    CREATE TYPE "dian_nit_type_enum" AS ENUM ('NIT', 'CC', 'CE', 'TI', 'PP', 'NIT_EXTRANJERIA');
  END IF;
END
$$;

-- 2. Drop the unique constraint on store_id (allows multiple configs per store)
ALTER TABLE "dian_configurations" DROP CONSTRAINT IF EXISTS "dian_configurations_store_id_key";

-- 3. Add new columns
ALTER TABLE "dian_configurations" ADD COLUMN IF NOT EXISTS "name" VARCHAR(100);
ALTER TABLE "dian_configurations" ADD COLUMN IF NOT EXISTS "nit_type" "dian_nit_type_enum" NOT NULL DEFAULT 'NIT';
ALTER TABLE "dian_configurations" ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false;

-- 4. Backfill existing records
UPDATE "dian_configurations"
SET "name" = CONCAT('NIT ', "nit"),
    "is_default" = true
WHERE "name" IS NULL;

-- 5. Make name NOT NULL after backfill
ALTER TABLE "dian_configurations" ALTER COLUMN "name" SET NOT NULL;

-- 6. Add unique constraint on (store_id, nit) to prevent duplicate NITs per store
ALTER TABLE "dian_configurations" DROP CONSTRAINT IF EXISTS "dian_configurations_store_id_nit_key";
ALTER TABLE "dian_configurations" ADD CONSTRAINT "dian_configurations_store_id_nit_key" UNIQUE ("store_id", "nit");

-- 7. Add index on store_id for efficient lookups
CREATE INDEX IF NOT EXISTS "dian_configurations_store_id_idx" ON "dian_configurations"("store_id");
