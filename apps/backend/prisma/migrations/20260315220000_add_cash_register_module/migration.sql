-- CreateEnum: cash_register_session_status_enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cash_register_session_status_enum') THEN
    CREATE TYPE "cash_register_session_status_enum" AS ENUM ('open', 'closed', 'suspended');
  END IF;
END
$$;

-- CreateEnum: cash_register_movement_type_enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cash_register_movement_type_enum') THEN
    CREATE TYPE "cash_register_movement_type_enum" AS ENUM ('opening_balance', 'sale', 'refund', 'cash_in', 'cash_out', 'closing_balance');
  END IF;
END
$$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "cash_registers" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "default_opening_amount" DECIMAL(12,2),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "cash_register_sessions" (
    "id" SERIAL NOT NULL,
    "cash_register_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "opened_by" INTEGER NOT NULL,
    "closed_by" INTEGER,
    "status" "cash_register_session_status_enum" NOT NULL DEFAULT 'open',
    "opened_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(6),
    "opening_amount" DECIMAL(12,2) NOT NULL,
    "expected_closing_amount" DECIMAL(12,2),
    "actual_closing_amount" DECIMAL(12,2),
    "difference" DECIMAL(12,2),
    "closing_notes" TEXT,
    "summary" JSONB,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_register_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "cash_register_movements" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" "cash_register_movement_type_enum" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_method" VARCHAR(50),
    "reference" VARCHAR(255),
    "order_id" INTEGER,
    "payment_id" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_register_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "cash_registers_store_id_code_key" ON "cash_registers"("store_id", "code");
CREATE INDEX IF NOT EXISTS "cash_registers_store_id_is_active_idx" ON "cash_registers"("store_id", "is_active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cash_register_sessions_store_id_status_idx" ON "cash_register_sessions"("store_id", "status");
CREATE INDEX IF NOT EXISTS "cash_register_sessions_cash_register_id_status_idx" ON "cash_register_sessions"("cash_register_id", "status");
CREATE INDEX IF NOT EXISTS "cash_register_sessions_opened_by_status_idx" ON "cash_register_sessions"("opened_by", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cash_register_movements_session_id_type_idx" ON "cash_register_movements"("session_id", "type");
CREATE INDEX IF NOT EXISTS "cash_register_movements_store_id_idx" ON "cash_register_movements"("store_id");
CREATE INDEX IF NOT EXISTS "cash_register_movements_order_id_idx" ON "cash_register_movements"("order_id");

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cash_register_sessions" ADD CONSTRAINT "cash_register_sessions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "cash_register_sessions" ADD CONSTRAINT "cash_register_sessions_cash_register_id_fkey" FOREIGN KEY ("cash_register_id") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "cash_register_sessions" ADD CONSTRAINT "cash_register_sessions_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "cash_register_sessions" ADD CONSTRAINT "cash_register_sessions_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cash_register_movements" ADD CONSTRAINT "cash_register_movements_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cash_register_sessions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "cash_register_movements" ADD CONSTRAINT "cash_register_movements_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "cash_register_movements" ADD CONSTRAINT "cash_register_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "cash_register_movements" ADD CONSTRAINT "cash_register_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "cash_register_movements" ADD CONSTRAINT "cash_register_movements_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
