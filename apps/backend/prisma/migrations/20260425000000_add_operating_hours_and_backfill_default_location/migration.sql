-- Add operating_hours JSON column to stores table
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "operating_hours" JSONB;

-- Ensure inventory_locations.is_default exists (schema-drift recovery).
-- Schema.prisma declares it but no prior migration created it.
ALTER TABLE "inventory_locations"
  ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false;

-- Ensure default_location_id column + FK + unique exist before backfill.
-- The column is declared in schema.prisma but had no prior migration creating
-- it (schema drift). Idempotent so older DBs that already had it stay intact.
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "default_location_id" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stores_default_location_id_fkey'
  ) THEN
    ALTER TABLE "stores"
      ADD CONSTRAINT "stores_default_location_id_fkey"
      FOREIGN KEY ("default_location_id")
      REFERENCES "inventory_locations"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "stores_default_location_id_key"
  ON "stores" ("default_location_id");

-- Backfill default_location_id for existing stores (idempotent, non-destructive)
-- Only for non-online stores that have at least one inventory location
UPDATE "stores" s
SET "default_location_id" = (
  SELECT id FROM "inventory_locations" il
  WHERE il."store_id" = s.id
  AND il."is_default" = true
  AND il."type" = 'store'
  LIMIT 1
)
WHERE s."default_location_id" IS NULL
AND s."store_type" != 'online';

-- Index for faster lookups on operating_hours (useful for queries filtering by day)
CREATE INDEX IF NOT EXISTS "idx_stores_operating_hours" ON "stores"("operating_hours") WHERE "operating_hours" IS NOT NULL;
