-- CP-POS-SVC-PERF-001 / HU-B second half — widen `bookings.cart_item_id`
-- to fit the full POS cart line id (`cart-` + `ITEM_` + UUID). The
-- previous VarChar(30) silently truncates the value when POST
-- /reservations runs, leaving the column NULL on inserts and breaking
-- the linkage between the cart row and the booking row.
ALTER TABLE "bookings" ALTER COLUMN "cart_item_id" TYPE VARCHAR(80);
