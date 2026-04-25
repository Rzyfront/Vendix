-- Add operating_hours JSON column to stores table
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "operating_hours" JSONB;

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
