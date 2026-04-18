-- Sync prod schema drift (icon columns missing + orphan index)
-- All statements are idempotent so dev DBs that already have these changes remain no-ops.

-- 1. Missing column: data_collection_templates.icon
ALTER TABLE "data_collection_templates" ADD COLUMN IF NOT EXISTS "icon" VARCHAR(100);

-- 2. Missing column: data_collection_items.icon
ALTER TABLE "data_collection_items" ADD COLUMN IF NOT EXISTS "icon" VARCHAR(100);

-- 3. Orphan unique index on bookings.order_id
-- Migration 20260403000000_remove_booking_order_id_unique used DROP CONSTRAINT IF EXISTS
-- but the object was created as a plain UNIQUE INDEX, so the drop was a no-op and the index persists.
DROP INDEX IF EXISTS "bookings_order_id_key";

-- 4. Index rename to match generated naming in newer Prisma versions
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'agreement_installments_payment_agreement_id_installment_numb_ke')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'agreement_installments_payment_agreement_id_installment_num_key') THEN
    ALTER INDEX "agreement_installments_payment_agreement_id_installment_numb_ke"
      RENAME TO "agreement_installments_payment_agreement_id_installment_num_key";
  END IF;
END $$;
