-- Add cash_on_delivery to payment_methods_type_enum (idempotent)
-- DATA IMPACT: No data mutation. Only adds a new enum value. Safe for production.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'cash_on_delivery'
      AND enumtypid = 'payment_methods_type_enum'::regtype
  ) THEN
    ALTER TYPE "payment_methods_type_enum" ADD VALUE 'cash_on_delivery';
  END IF;
END $$;
