-- DATA IMPACT:
-- Tables affected: lodging_reservations gains the nullable columns
--   precheckin_token and precheckin_completed_at, plus a unique index on
--   precheckin_token.
-- Expected row changes: none. Existing reservations read NULL (no link yet).
-- Destructive operations: none.
-- FK/cascade risk: none (no constraint added).
-- Idempotency: ADD COLUMN IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS.
-- Approval: hospitality plan, slice H8.1 (online check-in).

-- Token of the online check-in link the guest opens without login, and the
-- moment the guest completed it.
ALTER TABLE "lodging_reservations"
  ADD COLUMN IF NOT EXISTS "precheckin_token" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "precheckin_completed_at" TIMESTAMP(6);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_reservations_precheckin_token_key"
  ON "lodging_reservations"("precheckin_token");
