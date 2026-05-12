-- DATA IMPACT:
-- Adds nullable-default boolean column `is_historical_consolidated` to `accounting_entries`.
-- All existing rows receive default `false`. No row deletes, no FK drops, no CASCADE.
-- Used by the operating_scope downgrade wizard to flag entries created under
-- ORGANIZATION scope that must remain immutable in reports after a downgrade.
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

ALTER TABLE "accounting_entries"
  ADD COLUMN IF NOT EXISTS "is_historical_consolidated" BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index — only flagged rows. Optimizes "exclude consolidated" report filters.
CREATE INDEX IF NOT EXISTS "accounting_entries_is_historical_consolidated_idx"
  ON "accounting_entries" ("organization_id", "is_historical_consolidated")
  WHERE "is_historical_consolidated" = TRUE;
