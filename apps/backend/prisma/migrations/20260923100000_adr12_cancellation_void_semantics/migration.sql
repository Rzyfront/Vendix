-- DATA IMPACT:
-- Tables affected: accounts_receivable (+3 columns), refunds (+1 nullable column
--   and its unique index / FK); order_installment_state_enum (+1 value).
-- Existing row changes: no DML or backfill. Existing AR rows read
--   cancelled_amount = 0 via a constant default; other new columns stay NULL.
-- Destructive operations: none. No DROP, UPDATE, DELETE, or table rewrite.
-- FK/cascade risk: refunds.ar_payment_id references ar_payments.id with
--   ON DELETE RESTRICT; no business-parent cascade.
-- Idempotency: IF NOT EXISTS for enum, columns, and index; catalog-guarded FK.
-- Approval: ADR-12 cancellation void policy accepted by owner (2026-09-23).

ALTER TYPE "order_installment_state_enum" ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE "accounts_receivable"
  ADD COLUMN IF NOT EXISTS "cancelled_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "cancellation_reason" TEXT;

ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "ar_payment_id" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "refunds_ar_payment_id_key"
  ON "refunds"("ar_payment_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'refunds_ar_payment_id_fkey'
      AND conrelid = 'refunds'::regclass
  ) THEN
    ALTER TABLE "refunds"
      ADD CONSTRAINT "refunds_ar_payment_id_fkey"
      FOREIGN KEY ("ar_payment_id") REFERENCES "ar_payments"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
