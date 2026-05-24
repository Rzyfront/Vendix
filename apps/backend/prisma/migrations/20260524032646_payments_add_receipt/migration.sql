-- DATA IMPACT: NONE - additive nullable columns
-- Tables affected: payments
-- Expected row changes: none (additive only)
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: guarded by IF NOT EXISTS
-- Approval: documented in plan webpage-annotations-jiggly-pond.md (sections 1.1)

ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "receipt_s3_key" VARCHAR(512);
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "receipt_uploaded_at" TIMESTAMP(6);
