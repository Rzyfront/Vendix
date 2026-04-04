-- Remove unique constraint on order_id to allow multiple bookings per order (1:N)
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_order_id_key";

-- Add index for performance on the foreign key
CREATE INDEX IF NOT EXISTS "bookings_order_id_idx" ON "bookings"("order_id");
