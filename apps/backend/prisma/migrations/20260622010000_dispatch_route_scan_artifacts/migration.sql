-- DATA IMPACT: additive only. Adds 4 nullable columns to dispatch_routes. 0 rows mutated. No DROP/TRUNCATE/CASCADE.
-- Tables affected: dispatch_routes
-- Expected row changes: none (all new columns are nullable, no defaults)
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: guarded by ADD COLUMN IF NOT EXISTS
-- Approval: additive scan-artifact persistence for Despacho COD v2 (paso 16)

ALTER TABLE "dispatch_routes" ADD COLUMN IF NOT EXISTS "planilla_pdf_key" TEXT;
ALTER TABLE "dispatch_routes" ADD COLUMN IF NOT EXISTS "planilla_scanned_at" TIMESTAMP(6);
ALTER TABLE "dispatch_routes" ADD COLUMN IF NOT EXISTS "scan_result" JSONB;
ALTER TABLE "dispatch_routes" ADD COLUMN IF NOT EXISTS "scan_confidence" DECIMAL(5,4);
