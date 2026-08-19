-- QUI-628: additive migration to give carts an operational state and a link
-- from cart -> order. Without this, the abandoned-carts metric has no honest
-- way to distinguish "the user came back and bought" from "the user really
-- walked away" — every previous estimate has been fabricated.
--
-- DATA IMPACT:
-- Tables affected: carts
-- Expected row changes: 0 rows updated. All new columns are NULLABLE without
--   defaults, so every existing cart row stays as-is. Pre-existing carts will
--   read as state=NULL until either (a) a checkout converts them (sets
--   state='converted', converted_order_id, converted_at), or (b) the backfill
--   script (separate, see apps/backend/scripts/backfill-cart-conversions.ts)
--   finds a matching historical order and stamps them.
-- Destructive operations: none. No DELETE, no DROP, no TRUNCATE, no CASCADE.
--   Only ADD COLUMN and CREATE INDEX, all of which are non-destructive.
-- FK/cascade risk: low. The FK `carts.converted_order_id -> orders.id` uses
--   ON DELETE SET NULL — if an order is ever deleted, the cart drops back to
--   converted_order_id=NULL (it'll show as "abandoned-ish" but never breaks).
-- Idempotency: Prisma migrations are tracked in `_prisma_migrations` so a
--   second apply is a no-op. If run by hand, the CREATE TYPE will fail on
--   the second run with `type cart_state_enum already exists` — guard by
--   checking before re-applying.

-- (1) New enum for cart state.
CREATE TYPE cart_state_enum AS ENUM ('active', 'abandoned', 'converted');

-- (2) New columns on carts. All nullable; no defaults; no NOT NULL.
ALTER TABLE "carts"
  ADD COLUMN "state"              cart_state_enum,
  ADD COLUMN "converted_order_id" INTEGER,
  ADD COLUMN "converted_at"       TIMESTAMP(6),
  ADD COLUMN "last_activity_at"   TIMESTAMP(6);

-- (3) FK to orders with SET NULL so a deleted order doesn't cascade-destroy
-- the cart history.
ALTER TABLE "carts"
  ADD CONSTRAINT "carts_converted_order_id_fkey"
  FOREIGN KEY ("converted_order_id") REFERENCES "orders"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

-- (4) Indexes for the metric queries: state + last_activity_at (abandoned scan)
-- and converted_at (recovered scan). Without these, the analytics endpoint
-- would do sequential scans of carts per period.
CREATE INDEX "idx_carts_store_state_last_activity"
  ON "carts" ("store_id", "state", "last_activity_at");

CREATE INDEX "idx_carts_store_converted_at"
  ON "carts" ("store_id", "converted_at");

-- WHY: the abandoned-carts metric needs an operational definition that
-- requires (a) knowing when the user last touched the cart, (b) knowing
-- whether the cart ever produced an order. Both are new columns. The metric
-- `abandonment_rate = recovered / (abandoned + recovered)` reads both, and
-- without these columns the only honest thing to do is hide the view.
