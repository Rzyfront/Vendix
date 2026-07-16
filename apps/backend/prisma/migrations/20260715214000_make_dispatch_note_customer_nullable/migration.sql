-- DATA IMPACT:
-- Tables affected: dispatch_notes
-- Expected row changes: none (metadata-only change — relaxes a NOT NULL constraint)
-- Destructive operations: none (DROP NOT NULL never loses data; existing rows keep their customer_id)
-- FK/cascade risk: none (FK dispatch_notes_customer stays; Restrict only applies when customer_id is non-null)
-- Idempotency: guarded by pg_attribute attnotnull check
-- Approval: documented in plan (Remisiones Bidireccionales — R2 corrección de orquestador)

-- Make dispatch_notes.customer_id nullable so non-customer flows (transfer_out /
-- transfer_in / purchase_receipt) can persist a dispatch note without forcing a
-- fake "customer". The party for those subtypes lives in from_location_id /
-- to_location_id (transfer) or supplier_id (purchase_receipt). Existing outbound
-- rows (customer_delivery / customer_return) keep their real customer_id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = '"dispatch_notes"'::regclass
      AND attname = 'customer_id'
      AND attnotnull = true
  ) THEN
    ALTER TABLE "dispatch_notes" ALTER COLUMN "customer_id" DROP NOT NULL;
  END IF;
END $$;