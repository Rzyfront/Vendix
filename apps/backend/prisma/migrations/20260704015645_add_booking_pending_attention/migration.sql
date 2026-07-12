-- AlterEnum
-- This migration adds the new enum value `booking_pending_attention` to
-- the `notification_type_enum` type. Uses IF NOT EXISTS for idempotency.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'notification_type_enum'::regtype
      AND enumlabel = 'booking_pending_attention'
  ) THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'booking_pending_attention';
  END IF;
END $$;
