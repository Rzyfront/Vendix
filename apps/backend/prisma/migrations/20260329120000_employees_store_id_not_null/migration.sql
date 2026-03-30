-- Backfill: assign store_id from store_users or fallback to first org store
UPDATE employees e
SET store_id = COALESCE(
  (SELECT su.store_id FROM store_users su WHERE su.user_id = e.user_id LIMIT 1),
  (SELECT s.id FROM stores s WHERE s.organization_id = e.organization_id LIMIT 1)
)
WHERE e.store_id IS NULL;

-- Make store_id NOT NULL
ALTER TABLE "employees" ALTER COLUMN "store_id" SET NOT NULL;
