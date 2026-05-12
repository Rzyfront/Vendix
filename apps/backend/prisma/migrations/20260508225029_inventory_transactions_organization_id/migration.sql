-- DATA IMPACT:
-- Tables affected: inventory_transactions
-- Action: add organization_id column, backfill via products->stores->organizations, set NOT NULL, add FK, add index
-- Expected row changes: every existing row gets organization_id = stores.organization_id (joined through products.store_id) (current count: 17, 0 product orphans)
-- Orphan handling: rows with no matching product/store get organization_id = 0 (sentinel; no real org has id=0, so FK lookup with 0 would fail — but current data has 0 orphans, so this branch is a defensive no-op)
-- Destructive operations: none
-- FK/cascade risk: new FK uses ON DELETE CASCADE per multi-tenant policy (deleting an organization removes its inventory_transactions)
-- Idempotency: re-runs without effect if column/constraint/index already present

-- 1. Add column nullable (idempotent)
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS organization_id INTEGER;

-- 2. Backfill via products.store_id -> stores.organization_id
UPDATE inventory_transactions it
SET organization_id = s.organization_id
FROM products p
JOIN stores s ON s.id = p.store_id
WHERE it.product_id = p.id
  AND it.organization_id IS NULL;

-- 3. Orphan rows: assign sentinel 0 (no products row found). Defensive — current dataset has 0 orphans.
UPDATE inventory_transactions
SET organization_id = 0
WHERE organization_id IS NULL;

-- 4. NOT NULL (idempotent: re-running does nothing if already NOT NULL)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions'
      AND column_name = 'organization_id'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE inventory_transactions ALTER COLUMN organization_id SET NOT NULL;
  END IF;
END$$;

-- 5. FK (idempotent via constraint name check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_organization_id_fkey'
  ) THEN
    ALTER TABLE inventory_transactions
      ADD CONSTRAINT inventory_transactions_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
      ON DELETE CASCADE;
  END IF;
END$$;

-- 6. Index (idempotent)
CREATE INDEX IF NOT EXISTS inventory_transactions_organization_idx
  ON inventory_transactions(organization_id, created_at DESC);
