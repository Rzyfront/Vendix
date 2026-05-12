-- DATA IMPACT:
-- Tables affected: inventory_locations
-- Action: add boolean is_central_warehouse column (default FALSE), unique partial index for one-central-per-org, check constraint enforcing central locations cannot have store_id
-- Expected row changes: zero existing rows mutated (default FALSE preserves prior behavior)
-- Destructive operations: none
-- FK/cascade risk: none (no FKs added/altered)
-- Idempotency: guarded with IF NOT EXISTS / pg_constraint checks; re-runs are safe no-ops

-- 1. Add column (idempotent)
ALTER TABLE inventory_locations
  ADD COLUMN IF NOT EXISTS is_central_warehouse BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Unique partial index: at most one central warehouse per organization
CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_one_central_per_org
  ON inventory_locations(organization_id)
  WHERE is_central_warehouse = TRUE;

-- 3. CHECK constraint: a central warehouse cannot be store-scoped
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_locations_central_no_store_chk'
  ) THEN
    ALTER TABLE inventory_locations
      ADD CONSTRAINT inventory_locations_central_no_store_chk
      CHECK (NOT is_central_warehouse OR store_id IS NULL);
  END IF;
END$$;
