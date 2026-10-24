-- DATA IMPACT:
-- Tables affected: orders, cash_register_sessions
-- Expected row changes: no existing order attribution is written; existing cash sessions receive tracking=false via the column default.
-- Destructive operations: none
-- FK/cascade risk: nullable order origin references a session in the same store; deletion is restricted.
-- Idempotency: columns, unique/indexes, and FK are guarded.
-- Approval: QUI-920 plan A.1 recommendation; legacy orders remain unattributed.

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "origin_cash_session_id" INTEGER;

ALTER TABLE "cash_register_sessions"
  ADD COLUMN IF NOT EXISTS "pending_orders_tracking_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "cash_register_sessions_id_store_id_key"
  ON "cash_register_sessions"("id", "store_id");

CREATE INDEX IF NOT EXISTS "orders_store_id_origin_cash_session_id_state_idx"
  ON "orders"("store_id", "origin_cash_session_id", "state");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_origin_cash_session_id_store_id_fkey'
      AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_origin_cash_session_id_store_id_fkey"
      FOREIGN KEY ("origin_cash_session_id", "store_id")
      REFERENCES "cash_register_sessions"("id", "store_id")
      ON DELETE RESTRICT
      ON UPDATE NO ACTION;
  END IF;
END $$;
