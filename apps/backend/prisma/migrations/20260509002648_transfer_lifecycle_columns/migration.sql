-- DATA IMPACT:
-- Tables affected: stock_transfers
-- Action: ADD lifecycle columns (approved_at, dispatched_at, dispatched_by_user_id, cancelled_at,
--   cancelled_by_user_id, cancellation_reason, source_order_id, source_order_type), add 2 user FKs
--   (dispatched_by, cancelled_by), backfill semantic status mappings (draft -> pending or approved
--   based on approved_by_user_id discriminator, completed -> received), add indices for source
--   order lookups and status filtering.
-- Note: The columns approved_by_user_id (and matching FK) already existed in the schema before
--   this lifecycle work; this migration adds the matching approved_at timestamp column.
-- Expected row changes: every existing row's status remapped according to backfill rules; new
--   columns NULL for pre-existing rows; idempotent re-runs are no-ops.
-- Destructive operations: NONE. Legacy enum values 'draft' and 'completed' are NOT dropped per
--   Plan §13#2 (deferred to a later release once application code stops referencing them).
-- FK/cascade risk: 2 new FKs to users with ON DELETE SET NULL (non-cascading, history-safe).
-- Idempotency: ADD COLUMN IF NOT EXISTS, guarded pg_constraint checks for FKs, CREATE INDEX
--   IF NOT EXISTS, and WHERE-guarded UPDATEs (only updating still-legacy values).
-- Approval: documented in plan P4.1 and chat.
--
-- This migration depends on `20260509002647_transfer_status_enum_values` having committed first
-- so that the new enum values 'pending', 'approved', 'received' are usable in the UPDATE
-- statements below.

-- 1. Add lifecycle columns (idempotent).
--    approved_by_user_id and its FK already exist in the schema, so we only add the timestamp
--    companion plus the new dispatched_*/cancelled_*/source_* columns.
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "approved_at"           TIMESTAMP(6);
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "dispatched_at"         TIMESTAMP(6);
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "dispatched_by_user_id" INTEGER;
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "cancelled_at"          TIMESTAMP(6);
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "cancelled_by_user_id"  INTEGER;
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "cancellation_reason"   TEXT;
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "source_order_id"       INTEGER;
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "source_order_type"     VARCHAR(50);

-- 2. FKs for the new user references (idempotent). approved_by_user_id FK already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_dispatched_by_user_id_fkey'
  ) THEN
    ALTER TABLE "stock_transfers"
      ADD CONSTRAINT "stock_transfers_dispatched_by_user_id_fkey"
      FOREIGN KEY ("dispatched_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfers_cancelled_by_user_id_fkey'
  ) THEN
    ALTER TABLE "stock_transfers"
      ADD CONSTRAINT "stock_transfers_cancelled_by_user_id_fkey"
      FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END$$;

-- 3. Backfill status: draft -> pending or approved (per discriminator), completed -> received.
--    P2.4 OrgTransfersService used "approved_by_user_id IS NOT NULL" inside status='draft' as the
--    discriminator for "already approved but not yet dispatched". Honor that semantic on backfill.
UPDATE "stock_transfers"
   SET "status" = 'approved'
 WHERE "status" = 'draft'
   AND "approved_by_user_id" IS NOT NULL;

UPDATE "stock_transfers"
   SET "status" = 'pending'
 WHERE "status" = 'draft'
   AND "approved_by_user_id" IS NULL;

UPDATE "stock_transfers"
   SET "status" = 'received'
 WHERE "status" = 'completed';
-- in_transit and cancelled stay as-is.

-- 3b. Update the column DEFAULT from 'draft' to 'pending' to match the new semantics.
--     New rows will default to 'pending' instead of legacy 'draft'.
ALTER TABLE "stock_transfers"
  ALTER COLUMN "status" SET DEFAULT 'pending';

-- 4. Indices for source order lookups (used by ecommerce auto-fulfillment idempotency)
--    and status filtering. Partial index on source_order_id since most transfers have no source.
CREATE INDEX IF NOT EXISTS "stock_transfers_source_order_idx"
  ON "stock_transfers"("source_order_type", "source_order_id")
  WHERE "source_order_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "stock_transfers_status_idx"
  ON "stock_transfers"("status");
