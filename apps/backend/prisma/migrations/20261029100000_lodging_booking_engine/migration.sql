-- DATA IMPACT:
-- Tables affected: new table lodging_reservation_payments and its enum
--   lodging_reservation_payment_status_enum; lodging_reservations gains the
--   nullable column hold_expires_at and one index.
-- Expected row changes: none. Existing reservations keep NULL (no web hold).
-- Destructive operations: none.
-- FK/cascade risk: lodging_reservation_payments -> stores /
--   lodging_reservations / payment_links ON DELETE RESTRICT. No CASCADE.
-- Idempotency: guarded CREATE TYPE, CREATE TABLE/INDEX IF NOT EXISTS,
--   ADD COLUMN IF NOT EXISTS and guarded ADD CONSTRAINT.
-- Approval: hospitality plan, slice H6.6 (owner decisions 2026-10-26).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lodging_reservation_payment_status_enum') THEN
    CREATE TYPE "lodging_reservation_payment_status_enum" AS ENUM ('pending', 'completed', 'cancelled');
  END IF;
END $$;

-- A web booking is a tentative reservation held until this moment.
ALTER TABLE "lodging_reservations" ADD COLUMN IF NOT EXISTS "hold_expires_at" TIMESTAMP(6);

CREATE INDEX IF NOT EXISTS "lodging_reservations_status_hold_expires_at_idx"
  ON "lodging_reservations"("status", "hold_expires_at");

-- Direct payment of a reservation made online (never a deposit, D3).
CREATE TABLE IF NOT EXISTS "lodging_reservation_payments" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "reservation_id" INTEGER NOT NULL,
  "status" "lodging_reservation_payment_status_enum" NOT NULL DEFAULT 'pending',
  "amount" DECIMAL(14,2) NOT NULL,
  "applied_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "method" VARCHAR(30) NOT NULL,
  "payment_link_id" INTEGER,
  "transaction_id" VARCHAR(255),
  "paid_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lodging_reservation_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_reservation_payments_payment_link_id_key"
  ON "lodging_reservation_payments"("payment_link_id");
CREATE INDEX IF NOT EXISTS "lodging_reservation_payments_reservation_id_idx"
  ON "lodging_reservation_payments"("reservation_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_reservation_payments_store_id_fkey') THEN
    ALTER TABLE "lodging_reservation_payments" ADD CONSTRAINT "lodging_reservation_payments_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_reservation_payments_reservation_id_fkey') THEN
    ALTER TABLE "lodging_reservation_payments" ADD CONSTRAINT "lodging_reservation_payments_reservation_id_fkey"
      FOREIGN KEY ("reservation_id") REFERENCES "lodging_reservations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_reservation_payments_payment_link_id_fkey') THEN
    ALTER TABLE "lodging_reservation_payments" ADD CONSTRAINT "lodging_reservation_payments_payment_link_id_fkey"
      FOREIGN KEY ("payment_link_id") REFERENCES "payment_links"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
