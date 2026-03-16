-- AlterTable: Add detailed refund breakdown fields to refunds
ALTER TABLE "refunds" ADD COLUMN "subtotal_refund" DECIMAL(12,2) DEFAULT 0;
ALTER TABLE "refunds" ADD COLUMN "tax_refund" DECIMAL(12,2) DEFAULT 0;
ALTER TABLE "refunds" ADD COLUMN "shipping_refund" DECIMAL(12,2) DEFAULT 0;
ALTER TABLE "refunds" ADD COLUMN "notes" TEXT;

-- AlterTable: Add item-level refund details to refund_items
ALTER TABLE "refund_items" ADD COLUMN "tax_amount" DECIMAL(12,2);
ALTER TABLE "refund_items" ADD COLUMN "discount_amount" DECIMAL(12,2);
ALTER TABLE "refund_items" ADD COLUMN "inventory_action" VARCHAR(20) DEFAULT 'no_return';
ALTER TABLE "refund_items" ADD COLUMN "location_id" INTEGER;

-- AddForeignKey
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
