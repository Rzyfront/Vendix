-- ⚠️ DATABASE MIGRATION ⚠️
-- Remove deprecated credits module tables and add order installments support
--
-- DROP: credit_installment_payments, credit_installments, credits tables
-- DROP: credit_state_enum, installment_state_enum, installment_frequency_enum enums
-- DROP: users.credit_limit column
-- ADD: order credit fields (credit_type, interest_rate, interest_type, total_paid, remaining_balance, total_with_interest)
-- ADD: order_installments table
-- ADD: order_installment_state_enum enum

-- ============================================================
-- PHASE 1: Drop credit tables (order matters for FK constraints)
-- ============================================================

-- Drop credit_installment_payments first (depends on credit_installments)
DROP TABLE IF EXISTS "credit_installment_payments" CASCADE;

-- Drop credit_installments (depends on credits)
DROP TABLE IF EXISTS "credit_installments" CASCADE;

-- Drop credits (depends on orders, users, stores, store_payment_methods)
DROP TABLE IF EXISTS "credits" CASCADE;

-- ============================================================
-- PHASE 2: Drop credit enums
-- ============================================================

DROP TYPE IF EXISTS "credit_state_enum";
DROP TYPE IF EXISTS "installment_state_enum";
DROP TYPE IF EXISTS "installment_frequency_enum";

-- ============================================================
-- PHASE 3: Remove credit_limit from users
-- ============================================================

ALTER TABLE "users" DROP COLUMN IF EXISTS "credit_limit";

-- ============================================================
-- PHASE 4: Add credit fields to orders
-- ============================================================

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "credit_type" VARCHAR(20);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "interest_rate" DECIMAL(5,4);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "interest_type" VARCHAR(10);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "total_paid" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "remaining_balance" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "total_with_interest" DECIMAL(12,2);

-- ============================================================
-- PHASE 5: Create order_installment_state_enum
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_installment_state_enum') THEN
    CREATE TYPE "order_installment_state_enum" AS ENUM ('pending', 'paid', 'partial', 'overdue', 'forgiven');
  END IF;
END
$$;

-- ============================================================
-- PHASE 6: Create order_installments table
-- ============================================================

CREATE TABLE IF NOT EXISTS "order_installments" (
  "id" SERIAL PRIMARY KEY,
  "order_id" INTEGER NOT NULL,
  "installment_number" INTEGER NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "capital_amount" DECIMAL(12,2) NOT NULL,
  "interest_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "due_date" DATE NOT NULL,
  "state" "order_installment_state_enum" NOT NULL DEFAULT 'pending',
  "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "remaining_balance" DECIMAL(12,2) NOT NULL,
  "paid_at" TIMESTAMP(3),
  "notes" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "order_installments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS "order_installments_order_id_idx" ON "order_installments"("order_id");
CREATE INDEX IF NOT EXISTS "order_installments_due_date_state_idx" ON "order_installments"("due_date", "state");
