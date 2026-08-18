-- DATA IMPACT:
-- Tables affected: expenses
-- Expected row changes: backfill "paid_at" ONLY for rows already in state 'paid' whose "paid_at" IS NULL.
--                       Value = COALESCE(approved_at, expense_date). No other state is touched.
--                       Rows in pending/approved/rejected/cancelled/refunded keep "paid_at" NULL.
-- Destructive operations: none (additive column + guarded UPDATE + additive indexes)
-- FK/cascade risk: none (no FK added, no FK dropped, no ON DELETE change)
-- Idempotency: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / UPDATE guarded by
--              "state = 'paid' AND paid_at IS NULL" -> re-running is a no-op
-- Approval: documented in chat (decision B2, cash-basis dashboard redesign)
--
-- WHY: the four dashboard cards move to a CASH basis. "Balance" must subtract expenses on the day
-- the money actually left the till, not on "expense_date" (the accrual/document date) nor on
-- "approved_at" (an authorization timestamp). Without this column the Balance card is not real cash.

-- 1. Additive column: nullable, no default, no rewrite of existing rows.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(6);

-- 2. Guarded backfill. Historical rows already marked 'paid' have no recorded payment instant;
--    the best available proxy is the approval instant, falling back to the document date.
--    NEVER an unqualified UPDATE: the WHERE clause bounds it to paid + still-null rows.
UPDATE "expenses"
SET "paid_at" = COALESCE("approved_at", "expense_date")
WHERE "state" = 'paid'
  AND "paid_at" IS NULL;

-- 3. Indexes for the cash-basis analytics window (store/org + paid_at range scans).
CREATE INDEX IF NOT EXISTS "expenses_store_id_paid_at_idx" ON "expenses"("store_id", "paid_at");
CREATE INDEX IF NOT EXISTS "expenses_organization_id_paid_at_idx" ON "expenses"("organization_id", "paid_at");
