-- CreateEnum
CREATE TYPE "quotation_status_enum" AS ENUM ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted', 'cancelled');

-- CreateTable
CREATE TABLE "quotations" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER,
    "quotation_number" VARCHAR(50) NOT NULL,
    "status" "quotation_status_enum" NOT NULL DEFAULT 'draft',
    "channel" "order_channel_enum" NOT NULL DEFAULT 'pos',
    "subtotal_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "shipping_cost" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "grand_total" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "valid_until" TIMESTAMP(6),
    "notes" TEXT,
    "internal_notes" TEXT,
    "terms_and_conditions" TEXT,
    "sent_at" TIMESTAMP(6),
    "accepted_at" TIMESTAMP(6),
    "rejected_at" TIMESTAMP(6),
    "converted_at" TIMESTAMP(6),
    "converted_order_id" INTEGER,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" SERIAL NOT NULL,
    "quotation_id" INTEGER NOT NULL,
    "product_id" INTEGER,
    "product_variant_id" INTEGER,
    "product_name" VARCHAR(255) NOT NULL,
    "variant_sku" VARCHAR(100),
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "tax_rate" DECIMAL(6,5),
    "tax_amount_item" DECIMAL(12,2),
    "total_price" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotations_store_id_quotation_number_key" ON "quotations"("store_id", "quotation_number");

-- CreateIndex
CREATE INDEX "quotations_store_id_quotation_number_idx" ON "quotations"("store_id", "quotation_number");

-- CreateIndex
CREATE INDEX "quotations_store_id_status_idx" ON "quotations"("store_id", "status");

-- CreateIndex
CREATE INDEX "quotations_customer_id_idx" ON "quotations"("customer_id");

-- CreateIndex
CREATE INDEX "quotation_items_quotation_id_idx" ON "quotation_items"("quotation_id");

-- CreateIndex
CREATE INDEX "quotation_items_product_id_quotation_id_idx" ON "quotation_items"("product_id", "quotation_id");

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_converted_order_id_fkey" FOREIGN KEY ("converted_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
