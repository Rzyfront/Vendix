-- DATA IMPACT: non-destructive. Adds nullable FK from bookings to tables.
-- Allows restaurant operators to assign a booking to a specific table and
-- see the customer's reservation in the floor map.
--
-- Re-runnable via IF NOT EXISTS guards. Uses ON DELETE SET NULL so
-- removing a table preserves the booking (operator can re-assign).

-- AddTable: column on bookings
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "table_id" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bookings_store_id_table_id_idx" ON "bookings" ("store_id", "table_id");

-- AddForeignKey (idempotent via constraint name; uses ON DELETE SET NULL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_table_id_fkey'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_table_id_fkey"
      FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
