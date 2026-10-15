-- DATA IMPACT:
-- Tables affected: invoices
-- Expected row changes: none; nullable column keeps all historical rows unchanged
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: ADD COLUMN IF NOT EXISTS and CREATE UNIQUE INDEX IF NOT EXISTS
-- Approval: release #921 request, finding 10
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "client_request_id" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_store_client_request_id_key"
  ON "invoices" ("store_id", "client_request_id")
  WHERE "client_request_id" IS NOT NULL;
