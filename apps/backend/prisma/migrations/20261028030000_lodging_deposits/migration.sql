-- DATA IMPACT:
-- Tables affected: creates lodging_deposits (empty) and the enums lodging_deposit_kind_enum, lodging_deposit_status_enum.
-- Expected row changes: none. No existing table or row is modified.
-- Destructive operations: none.
-- FK/cascade risk: none. New FKs use ON DELETE RESTRICT; no incoming FK changes.
-- Idempotency: guarded CREATE TYPE, CREATE TABLE/INDEX IF NOT EXISTS and guarded constraints.
-- Approval: hospitality plan, slice H3.5 (owner decisions 2026-10-26, D3).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lodging_deposit_kind_enum') THEN
    CREATE TYPE "lodging_deposit_kind_enum" AS ENUM ('received', 'applied', 'retained');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lodging_deposit_status_enum') THEN
    CREATE TYPE "lodging_deposit_status_enum" AS ENUM ('pending', 'completed', 'cancelled');
  END IF;
END $$;

-- H3.5: deposit ledger of a reservation. The money is a customer advance in
-- the holder's wallet (D3); each row is one receipt, application to the folio
-- or retention as penalty.
CREATE TABLE IF NOT EXISTS "lodging_deposits" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "reservation_id" INTEGER NOT NULL,
    "kind" "lodging_deposit_kind_enum" NOT NULL,
    "status" "lodging_deposit_status_enum" NOT NULL DEFAULT 'completed',
    "amount" DECIMAL(14,2) NOT NULL,
    "method" VARCHAR(30),
    "store_payment_method_id" INTEGER,
    "payment_link_id" INTEGER,
    "wallet_transaction_id" INTEGER,
    "payment_id" INTEGER,
    "request_id" VARCHAR(64),
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_deposits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_deposits_payment_link_id_key" ON "lodging_deposits"("payment_link_id");
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_deposits_wallet_transaction_id_key" ON "lodging_deposits"("wallet_transaction_id");
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_deposits_payment_id_key" ON "lodging_deposits"("payment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_deposits_store_id_request_id_key" ON "lodging_deposits"("store_id", "request_id");
CREATE INDEX IF NOT EXISTS "lodging_deposits_reservation_id_idx" ON "lodging_deposits"("reservation_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_deposits_store_id_fkey') THEN
    ALTER TABLE "lodging_deposits" ADD CONSTRAINT "lodging_deposits_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_deposits_reservation_id_fkey') THEN
    ALTER TABLE "lodging_deposits" ADD CONSTRAINT "lodging_deposits_reservation_id_fkey"
      FOREIGN KEY ("reservation_id") REFERENCES "lodging_reservations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_deposits_payment_link_id_fkey') THEN
    ALTER TABLE "lodging_deposits" ADD CONSTRAINT "lodging_deposits_payment_link_id_fkey"
      FOREIGN KEY ("payment_link_id") REFERENCES "payment_links"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_deposits_wallet_transaction_id_fkey') THEN
    ALTER TABLE "lodging_deposits" ADD CONSTRAINT "lodging_deposits_wallet_transaction_id_fkey"
      FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_deposits_payment_id_fkey') THEN
    ALTER TABLE "lodging_deposits" ADD CONSTRAINT "lodging_deposits_payment_id_fkey"
      FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
