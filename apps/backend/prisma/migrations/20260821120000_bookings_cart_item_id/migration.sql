-- CP-POS-SVC-PERF-001 / C.1
-- Add optional `cart_item_id` column to `bookings` so the POS can link a
-- reservation back to the cart line that produced it. NULLABLE — no
-- backfill required, no destructive operation.
--
-- DATA IMPACT: none — additive nullable column.

ALTER TABLE "bookings"
  ADD COLUMN "cart_item_id" VARCHAR(30) NULL;