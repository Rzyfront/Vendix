-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'advance_installment_status_enum') THEN
    CREATE TYPE "advance_installment_status_enum" AS ENUM ('pending', 'paid', 'overdue', 'cancelled');
  END IF;
END
$$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "employee_advance_installments" (
    "id" SERIAL NOT NULL,
    "advance_id" INTEGER NOT NULL,
    "installment_number" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" TIMESTAMP(6) NOT NULL,
    "status" "advance_installment_status_enum" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMP(6),
    "payment_id" INTEGER,
    "payroll_item_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employee_advance_installments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "employee_advance_installments_advance_id_installment_number_key"
  ON "employee_advance_installments"("advance_id", "installment_number");

CREATE INDEX IF NOT EXISTS "employee_advance_installments_advance_id_idx"
  ON "employee_advance_installments"("advance_id");

CREATE INDEX IF NOT EXISTS "employee_advance_installments_due_date_status_idx"
  ON "employee_advance_installments"("due_date", "status");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'employee_advance_installments_advance_id_fkey') THEN
    ALTER TABLE "employee_advance_installments"
      ADD CONSTRAINT "employee_advance_installments_advance_id_fkey"
      FOREIGN KEY ("advance_id") REFERENCES "employee_advances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'employee_advance_installments_payment_id_fkey') THEN
    ALTER TABLE "employee_advance_installments"
      ADD CONSTRAINT "employee_advance_installments_payment_id_fkey"
      FOREIGN KEY ("payment_id") REFERENCES "employee_advance_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'employee_advance_installments_payroll_item_id_fkey') THEN
    ALTER TABLE "employee_advance_installments"
      ADD CONSTRAINT "employee_advance_installments_payroll_item_id_fkey"
      FOREIGN KEY ("payroll_item_id") REFERENCES "payroll_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
