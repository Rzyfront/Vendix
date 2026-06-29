-- =====================================================================
-- Make `notifications.store_id` nullable
-- =====================================================================
-- The `notifications` model powers the in-app bell badge across the
-- private app. Originally scoped per-store only, the column carried
-- a NOT NULL FK to `stores`. This commit relaxes that constraint so
-- the same table can also carry super-admin-level notifications
-- (e.g. "new PQR arrived on the platform") which have no store
-- context.
--
-- Onwards the contract is:
--   store_id IS NULL  → super-admin audience (audience encoded in
--                        the `data` JSON column, e.g.
--                        { kind: 'pqr.created', ticket_id: 17 }).
--   store_id IS NOT   → existing store-scoped behaviour, unchanged.
--
-- The FK becomes nullable. On delete cascade is preserved (rows with
-- store_id are deleted when their store is; null-store rows survive
-- any store deletion since they don't reference one).
-- =====================================================================

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_store_id_fkey";

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "store_id" DROP NOT NULL;

-- Re-add the foreign key with ON DELETE CASCADE (Postgres allows
-- nullable FKs; cascade still applies when the FK is set).
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Index for the new "fetch all super-admin notifications" query,
-- sorted by created_at desc.
CREATE INDEX IF NOT EXISTS "notifications_created_at_idx" ON "notifications"("created_at" DESC);
