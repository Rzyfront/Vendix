-- AlterTable
ALTER TABLE "shipping_methods" ADD COLUMN     "copied_from_system_method_id" INTEGER,
ADD COLUMN     "custom_config" JSONB,
ADD COLUMN     "max_order_amount" DECIMAL(12,2),
ADD COLUMN     "min_order_amount" DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "shipping_methods_copied_from_system_method_id_idx" ON "shipping_methods"("copied_from_system_method_id");

-- AddForeignKey
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_copied_from_system_method_id_fkey" FOREIGN KEY ("copied_from_system_method_id") REFERENCES "shipping_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
