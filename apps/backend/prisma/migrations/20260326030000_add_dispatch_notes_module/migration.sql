-- CreateEnum
CREATE TYPE "dispatch_note_status_enum" AS ENUM ('draft', 'confirmed', 'delivered', 'invoiced', 'voided');

-- CreateTable
CREATE TABLE "dispatch_notes" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "dispatch_number" VARCHAR(50) NOT NULL,
    "status" "dispatch_note_status_enum" NOT NULL DEFAULT 'draft',
    "customer_id" INTEGER NOT NULL,
    "customer_name" VARCHAR(255),
    "customer_tax_id" VARCHAR(50),
    "customer_address" JSONB,
    "sales_order_id" INTEGER,
    "invoice_id" INTEGER,
    "emission_date" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agreed_delivery_date" TIMESTAMP(6),
    "actual_delivery_date" TIMESTAMP(6),
    "dispatch_location_id" INTEGER,
    "subtotal_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(10),
    "notes" TEXT,
    "internal_notes" TEXT,
    "void_reason" TEXT,
    "created_by_user_id" INTEGER,
    "confirmed_by_user_id" INTEGER,
    "delivered_by_user_id" INTEGER,
    "voided_by_user_id" INTEGER,
    "confirmed_at" TIMESTAMP(6),
    "delivered_at" TIMESTAMP(6),
    "voided_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_note_items" (
    "id" SERIAL NOT NULL,
    "dispatch_note_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_variant_id" INTEGER,
    "location_id" INTEGER,
    "ordered_quantity" INTEGER NOT NULL DEFAULT 0,
    "dispatched_quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2),
    "discount_amount" DECIMAL(12,2) DEFAULT 0,
    "tax_amount" DECIMAL(12,2) DEFAULT 0,
    "total_price" DECIMAL(12,2),
    "cost_price" DECIMAL(12,2),
    "lot_serial" VARCHAR(100),
    "sales_order_item_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_note_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dispatch_notes_store_id_dispatch_number_key" ON "dispatch_notes"("store_id", "dispatch_number");

-- CreateIndex
CREATE INDEX "dispatch_notes_store_id_status_idx" ON "dispatch_notes"("store_id", "status");

-- CreateIndex
CREATE INDEX "dispatch_notes_customer_id_idx" ON "dispatch_notes"("customer_id");

-- CreateIndex
CREATE INDEX "dispatch_notes_sales_order_id_idx" ON "dispatch_notes"("sales_order_id");

-- CreateIndex
CREATE INDEX "dispatch_notes_invoice_id_idx" ON "dispatch_notes"("invoice_id");

-- CreateIndex
CREATE INDEX "dispatch_note_items_dispatch_note_id_idx" ON "dispatch_note_items"("dispatch_note_id");

-- CreateIndex
CREATE INDEX "dispatch_note_items_product_id_idx" ON "dispatch_note_items"("product_id");

-- CreateIndex
CREATE INDEX "dispatch_note_items_sales_order_item_id_idx" ON "dispatch_note_items"("sales_order_item_id");

-- AddForeignKey
ALTER TABLE "dispatch_notes" ADD CONSTRAINT "dispatch_notes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dispatch_notes" ADD CONSTRAINT "dispatch_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dispatch_notes" ADD CONSTRAINT "dispatch_notes_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dispatch_notes" ADD CONSTRAINT "dispatch_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dispatch_notes" ADD CONSTRAINT "dispatch_notes_dispatch_location_id_fkey" FOREIGN KEY ("dispatch_location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dispatch_notes" ADD CONSTRAINT "dispatch_notes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dispatch_notes" ADD CONSTRAINT "dispatch_notes_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dispatch_notes" ADD CONSTRAINT "dispatch_notes_delivered_by_user_id_fkey" FOREIGN KEY ("delivered_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dispatch_notes" ADD CONSTRAINT "dispatch_notes_voided_by_user_id_fkey" FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dispatch_note_items" ADD CONSTRAINT "dispatch_note_items_dispatch_note_id_fkey" FOREIGN KEY ("dispatch_note_id") REFERENCES "dispatch_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_note_items" ADD CONSTRAINT "dispatch_note_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_note_items" ADD CONSTRAINT "dispatch_note_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_note_items" ADD CONSTRAINT "dispatch_note_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
