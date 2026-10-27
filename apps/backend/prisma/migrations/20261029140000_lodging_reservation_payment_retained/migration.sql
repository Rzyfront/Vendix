-- DATA IMPACT:
-- Tables affected: lodging_reservation_payments gains the column
--   retained_amount (NOT NULL DEFAULT 0).
-- Expected row changes: none. Existing payments read 0 (nothing retained).
-- Destructive operations: none.
-- FK/cascade risk: none (no constraint added).
-- Idempotency: ADD COLUMN IF NOT EXISTS.
-- Approval: hospitality plan, wave 6 review fix (H6.6 penalty of a paid
--   web reservation that is cancelled or no-show).

-- Part of an online reservation payment kept as a cancellation / no-show
-- penalty (DR 2805 / CR penalty income). amount - applied - retained is
-- what the hotel owes back to the guest.
ALTER TABLE "lodging_reservation_payments"
  ADD COLUMN IF NOT EXISTS "retained_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;
