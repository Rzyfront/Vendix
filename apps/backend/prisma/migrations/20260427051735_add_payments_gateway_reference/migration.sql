-- Idempotent and non-destructive: nullable column + index
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "gateway_reference" VARCHAR(255);
CREATE INDEX IF NOT EXISTS "payments_gateway_reference_idx" ON "payments"("gateway_reference");
