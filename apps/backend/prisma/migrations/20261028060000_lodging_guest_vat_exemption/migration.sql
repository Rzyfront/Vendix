-- DATA IMPACT:
-- Tables affected: lodging_guests gains vat_exempt_at and vat_exempt_by_user_id (both nullable).
-- Expected row changes: none. Existing guests read NULL (no VAT exemption applied).
-- Destructive operations: none.
-- FK/cascade risk: none. No FKs added; no incoming FK changes.
-- Idempotency: ADD COLUMN IF NOT EXISTS.
-- Approval: hospitality plan, slice H3.9 (owner decisions 2026-10-26).

-- H3.9: the holder took the VAT exemption of a non-resident tourist
-- (art. 481 lit. d ET): when and by whom it was applied to the folio nights.
ALTER TABLE "lodging_guests" ADD COLUMN IF NOT EXISTS "vat_exempt_at" TIMESTAMP(6);
ALTER TABLE "lodging_guests" ADD COLUMN IF NOT EXISTS "vat_exempt_by_user_id" INTEGER;
