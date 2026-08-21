-- CP-POS-SVC-PERF-001 / HU-B + HU-C
-- Allow anonymous sales (Venta Anónima) to carry a booking alongside the
-- order. Application-level guards remain: the cashier must still
-- supply provider + date + start/end when persisting the booking.
ALTER TABLE "bookings"
  ALTER COLUMN "customer_id" DROP NOT NULL;
