-- AlterTable
ALTER TABLE "shipping_methods" ADD COLUMN     "is_system" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "store_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "shipping_zones" ADD COLUMN     "is_system" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "store_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "shipping_methods_is_system_idx" ON "shipping_methods"("is_system");

-- CreateIndex
CREATE INDEX "shipping_zones_is_system_idx" ON "shipping_zones"("is_system");
