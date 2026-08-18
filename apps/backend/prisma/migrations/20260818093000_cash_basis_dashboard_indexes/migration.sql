-- DATA IMPACT:
-- Tables affected: expenses (corrective UPDATE), payments (index only), refunds (index only)
-- Expected row changes: expenses rows where the previous migration backfilled "paid_at" from a
--                       NAIVE-MIDNIGHT "expense_date" (no "approved_at" available) are moved to
--                       12:00 of that same calendar day. No other row is touched.
-- Destructive operations: none (guarded UPDATE + additive indexes)
-- FK/cascade risk: none
-- Idempotency: the UPDATE requires paid_at::time = '00:00:00', which is false after it runs;
--              indexes use CREATE INDEX IF NOT EXISTS
-- Approval: documented in chat (corrective follow-up of 20260818090000)
--
-- WHY (1) — midnight normalization: "expense_date" is a DATE-ONLY business date stored as naive
-- midnight. Copied verbatim into "paid_at" (an INSTANT column), that midnight is read as
-- 00:00 UTC, which in America/Bogota (UTC-5) is 19:00 of the PREVIOUS day — the expense would
-- land one day early in the cash-basis window and the daily Balance would not reconcile.
-- Anchoring at 12:00 keeps the same calendar day for every store timezone in UTC-11..UTC+11.
-- Rows whose "paid_at" came from "approved_at" are real instants and are left untouched.
--
-- WHY (2) — join indexes: neither "payments"."order_id" nor "refunds"."order_id" had an index
-- (Postgres does not create one for a FK automatically). Every cash-basis aggregate joins
-- payments/refunds -> orders to reach "store_id", and so does the whole order-detail path.

-- 1. Corrective: move date-only-derived paid_at to midday of the same calendar day.
UPDATE "expenses"
SET "paid_at" = "expense_date" + INTERVAL '12 hours'
WHERE "state" = 'paid'
  AND "approved_at" IS NULL
  AND "paid_at" IS NOT NULL
  AND "paid_at" = "expense_date"
  AND "paid_at"::time = TIME '00:00:00';

-- 2. Join indexes for the cash-basis aggregates (and every other order->payments/refunds path).
CREATE INDEX IF NOT EXISTS "payments_order_id_idx" ON "payments"("order_id");
CREATE INDEX IF NOT EXISTS "refunds_order_id_idx" ON "refunds"("order_id");
