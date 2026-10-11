-- DATA IMPACT:
-- Tables affected: quotations
-- Expected row changes: zero; historical rows remain NULL
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: ADD COLUMN IF NOT EXISTS
-- Approval: additive P1.2 snapshot field; no backfill requested

ALTER TABLE "quotations"
ADD COLUMN IF NOT EXISTS "contract_economic_snapshot" JSONB;
