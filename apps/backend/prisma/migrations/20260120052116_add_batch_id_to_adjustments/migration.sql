-- AlterTable
ALTER TABLE "inventory_adjustments" ADD COLUMN     "batch_id" INTEGER;

-- CreateIndex
CREATE INDEX "inventory_adjustments_batch_id_idx" ON "inventory_adjustments"("batch_id");

-- AddForeignKey
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "inventory_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
