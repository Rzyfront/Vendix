-- CreateEnum: purchase_order_payment_status_enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_order_payment_status_enum') THEN
    CREATE TYPE "purchase_order_payment_status_enum" AS ENUM ('unpaid', 'partial', 'paid');
  END IF;
END
$$;

-- AddEnumValue: partial to purchase_order_status_enum
ALTER TYPE "purchase_order_status_enum" ADD VALUE IF NOT EXISTS 'partial';

-- AddColumn: payment_status to purchase_orders
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "payment_status" "purchase_order_payment_status_enum" NOT NULL DEFAULT 'unpaid';

-- AddColumn: payment_due_date to purchase_orders
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "payment_due_date" TIMESTAMP(6);

-- CreateTable: purchase_order_attachments
CREATE TABLE IF NOT EXISTS "purchase_order_attachments" (
    "id" SERIAL NOT NULL,
    "purchase_order_id" INTEGER NOT NULL,
    "file_url" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_type" VARCHAR(100) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "supplier_invoice_number" VARCHAR(100),
    "supplier_invoice_date" TIMESTAMP(3),
    "supplier_invoice_amount" DECIMAL(12,2),
    "notes" TEXT,
    "uploaded_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: purchase_order_payments
CREATE TABLE IF NOT EXISTS "purchase_order_payments" (
    "id" SERIAL NOT NULL,
    "purchase_order_id" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL,
    "payment_method" VARCHAR(50) NOT NULL,
    "reference" VARCHAR(255),
    "notes" TEXT,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: purchase_order_receptions
CREATE TABLE IF NOT EXISTS "purchase_order_receptions" (
    "id" SERIAL NOT NULL,
    "purchase_order_id" INTEGER NOT NULL,
    "received_by_user_id" INTEGER,
    "notes" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_receptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: purchase_order_reception_items
CREATE TABLE IF NOT EXISTS "purchase_order_reception_items" (
    "id" SERIAL NOT NULL,
    "reception_id" INTEGER NOT NULL,
    "purchase_order_item_id" INTEGER NOT NULL,
    "quantity_received" INTEGER NOT NULL,

    CONSTRAINT "purchase_order_reception_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: purchase_order_attachments
CREATE INDEX IF NOT EXISTS "purchase_order_attachments_purchase_order_id_idx" ON "purchase_order_attachments"("purchase_order_id");

-- CreateIndex: purchase_order_payments
CREATE INDEX IF NOT EXISTS "purchase_order_payments_purchase_order_id_idx" ON "purchase_order_payments"("purchase_order_id");

-- CreateIndex: purchase_order_receptions
CREATE INDEX IF NOT EXISTS "purchase_order_receptions_purchase_order_id_idx" ON "purchase_order_receptions"("purchase_order_id");

-- CreateIndex: purchase_order_reception_items
CREATE INDEX IF NOT EXISTS "purchase_order_reception_items_reception_id_idx" ON "purchase_order_reception_items"("reception_id");
CREATE INDEX IF NOT EXISTS "purchase_order_reception_items_purchase_order_item_id_idx" ON "purchase_order_reception_items"("purchase_order_item_id");

-- AddForeignKey: purchase_order_attachments -> purchase_orders
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_attachments_purchase_order_id_fkey') THEN
    ALTER TABLE "purchase_order_attachments" ADD CONSTRAINT "purchase_order_attachments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- AddForeignKey: purchase_order_attachments -> users
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_attachments_uploaded_by_user_id_fkey') THEN
    ALTER TABLE "purchase_order_attachments" ADD CONSTRAINT "purchase_order_attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- AddForeignKey: purchase_order_payments -> purchase_orders
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_payments_purchase_order_id_fkey') THEN
    ALTER TABLE "purchase_order_payments" ADD CONSTRAINT "purchase_order_payments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- AddForeignKey: purchase_order_payments -> users
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_payments_created_by_user_id_fkey') THEN
    ALTER TABLE "purchase_order_payments" ADD CONSTRAINT "purchase_order_payments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- AddForeignKey: purchase_order_receptions -> purchase_orders
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_receptions_purchase_order_id_fkey') THEN
    ALTER TABLE "purchase_order_receptions" ADD CONSTRAINT "purchase_order_receptions_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- AddForeignKey: purchase_order_receptions -> users
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_receptions_received_by_user_id_fkey') THEN
    ALTER TABLE "purchase_order_receptions" ADD CONSTRAINT "purchase_order_receptions_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- AddForeignKey: purchase_order_reception_items -> purchase_order_receptions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_reception_items_reception_id_fkey') THEN
    ALTER TABLE "purchase_order_reception_items" ADD CONSTRAINT "purchase_order_reception_items_reception_id_fkey" FOREIGN KEY ("reception_id") REFERENCES "purchase_order_receptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- AddForeignKey: purchase_order_reception_items -> purchase_order_items
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_reception_items_purchase_order_item_id_fkey') THEN
    ALTER TABLE "purchase_order_reception_items" ADD CONSTRAINT "purchase_order_reception_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
