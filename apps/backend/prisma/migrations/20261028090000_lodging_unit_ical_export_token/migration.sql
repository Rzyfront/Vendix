-- DATA IMPACT:
-- Tables affected: lodging_units gains the nullable column ical_export_token
--   and its unique index.
-- Expected row changes: none. Existing rows keep NULL (no feed published).
-- Destructive operations: none.
-- FK/cascade risk: none. No foreign keys added.
-- Idempotency: ADD COLUMN IF NOT EXISTS and CREATE UNIQUE INDEX IF NOT EXISTS.
-- Approval: hospitality plan, slice H6.1 (owner decisions 2026-10-26).

-- Secret of the public iCal export URL of a room; NULL = no feed.
ALTER TABLE "lodging_units" ADD COLUMN IF NOT EXISTS "ical_export_token" VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_units_ical_export_token_key"
  ON "lodging_units"("ical_export_token");
