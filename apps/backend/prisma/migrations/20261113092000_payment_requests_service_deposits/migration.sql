-- Estaciones fase 2 (S1, S3, S4, S5, S8, S9, S12, S15, S17): solicitudes de pago públicas
-- (página de Vendix con los medios en línea de la tienda) y libro del anticipo consumible
-- de reservas y atenciones de estación.
--
-- DATA IMPACT:
-- Tables affected: payment_requests (new), service_deposits (new)
-- Expected row changes: none (new empty tables)
-- Destructive operations: none
-- FK/cascade risk: every new FK is ON DELETE RESTRICT; no CASCADE
-- Idempotency: guarded enums (pg_type), CREATE TABLE/INDEX IF NOT EXISTS, guarded constraints (pg_constraint)
-- Approval: plan approved in chat (L9 "Ejecuta!"), additive only

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_deposit_kind_enum') THEN
    CREATE TYPE "service_deposit_kind_enum" AS ENUM ('received', 'applied', 'refunded', 'released');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_deposit_status_enum') THEN
    CREATE TYPE "service_deposit_status_enum" AS ENUM ('pending', 'completed', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_request_status_enum') THEN
    CREATE TYPE "payment_request_status_enum" AS ENUM ('pending', 'awaiting_confirmation', 'paid', 'expired', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "payment_requests" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "public_token_hash" VARCHAR(64) NOT NULL,
  "purpose" VARCHAR(30) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" VARCHAR(10) NOT NULL DEFAULT 'COP',
  "description" TEXT NOT NULL,
  "status" "payment_request_status_enum" NOT NULL DEFAULT 'pending',
  "expires_at" TIMESTAMPTZ(6),
  "payment_link_id" INTEGER,
  "transfer_store_payment_method_id" INTEGER,
  "transfer_receipt_s3_key" TEXT,
  "transfer_reference" VARCHAR(120),
  "transfer_submitted_at" TIMESTAMPTZ(6),
  "confirmed_by_user_id" INTEGER,
  "confirmed_at" TIMESTAMPTZ(6),
  "rejection_reason" TEXT,
  "paid_at" TIMESTAMPTZ(6),
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_requests_amount_positive_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_requests_public_token_hash_key" ON "payment_requests"("public_token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_requests_payment_link_id_key" ON "payment_requests"("payment_link_id");
CREATE INDEX IF NOT EXISTS "payment_requests_store_id_status_idx" ON "payment_requests"("store_id", "status");
CREATE INDEX IF NOT EXISTS "payment_requests_store_id_created_at_idx" ON "payment_requests"("store_id", "created_at");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_store_id_fkey') THEN
    ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_requests_payment_link_id_fkey') THEN
    ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_payment_link_id_fkey"
      FOREIGN KEY ("payment_link_id") REFERENCES "payment_links"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "service_deposits" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "booking_id" INTEGER,
  "session_id" INTEGER,
  "customer_id" INTEGER NOT NULL,
  "kind" "service_deposit_kind_enum" NOT NULL,
  "status" "service_deposit_status_enum" NOT NULL DEFAULT 'completed',
  "amount" DECIMAL(12,2) NOT NULL,
  "method" VARCHAR(30),
  "store_payment_method_id" INTEGER,
  "payment_request_id" INTEGER,
  "wallet_transaction_id" INTEGER,
  "payment_id" INTEGER,
  "request_id" VARCHAR(64) NOT NULL,
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_deposits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_deposits_owner_check" CHECK ("booking_id" IS NOT NULL OR "session_id" IS NOT NULL),
  CONSTRAINT "service_deposits_amount_positive_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_deposits_payment_request_id_key" ON "service_deposits"("payment_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "service_deposits_wallet_transaction_id_key" ON "service_deposits"("wallet_transaction_id");
CREATE UNIQUE INDEX IF NOT EXISTS "service_deposits_payment_id_key" ON "service_deposits"("payment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "service_deposits_store_id_request_id_key" ON "service_deposits"("store_id", "request_id");
CREATE INDEX IF NOT EXISTS "service_deposits_store_id_booking_id_idx" ON "service_deposits"("store_id", "booking_id");
CREATE INDEX IF NOT EXISTS "service_deposits_store_id_session_id_idx" ON "service_deposits"("store_id", "session_id");
CREATE INDEX IF NOT EXISTS "service_deposits_customer_id_idx" ON "service_deposits"("customer_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_deposits_store_id_fkey') THEN
    ALTER TABLE "service_deposits" ADD CONSTRAINT "service_deposits_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_deposits_booking_fkey') THEN
    ALTER TABLE "service_deposits" ADD CONSTRAINT "service_deposits_booking_fkey"
      FOREIGN KEY ("store_id", "booking_id") REFERENCES "bookings"("store_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_deposits_session_fkey') THEN
    ALTER TABLE "service_deposits" ADD CONSTRAINT "service_deposits_session_fkey"
      FOREIGN KEY ("store_id", "session_id") REFERENCES "service_sessions"("store_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_deposits_customer_id_fkey') THEN
    ALTER TABLE "service_deposits" ADD CONSTRAINT "service_deposits_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_deposits_payment_request_id_fkey') THEN
    ALTER TABLE "service_deposits" ADD CONSTRAINT "service_deposits_payment_request_id_fkey"
      FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_deposits_wallet_transaction_id_fkey') THEN
    ALTER TABLE "service_deposits" ADD CONSTRAINT "service_deposits_wallet_transaction_id_fkey"
      FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_deposits_payment_id_fkey') THEN
    ALTER TABLE "service_deposits" ADD CONSTRAINT "service_deposits_payment_id_fkey"
      FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
