-- DATA IMPACT:
-- Tables affected: lodging_folios gains verified_at, verified_by_user_id, verified_total and closed_by_user_id (all nullable).
-- Expected row changes: none. Existing folios read NULL (not verified, not closed by anyone yet).
-- Destructive operations: none.
-- FK/cascade risk: none. No FKs added; no incoming FK changes.
-- Idempotency: ADD COLUMN IF NOT EXISTS.
-- Approval: hospitality plan, slice H3.7 (owner decisions 2026-10-26, D5 and D11).

-- H3.7 / D11: the folio invoice is emitted only after a user holding
-- store:lodging:folio:verify reviewed the folio at this total.
ALTER TABLE "lodging_folios" ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMP(6);
ALTER TABLE "lodging_folios" ADD COLUMN IF NOT EXISTS "verified_by_user_id" INTEGER;
ALTER TABLE "lodging_folios" ADD COLUMN IF NOT EXISTS "verified_total" DECIMAL(14,2);

-- H3.7: who closed the folio at check-out.
ALTER TABLE "lodging_folios" ADD COLUMN IF NOT EXISTS "closed_by_user_id" INTEGER;
