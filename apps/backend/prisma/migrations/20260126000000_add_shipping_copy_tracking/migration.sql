-- CreateEnum
CREATE TYPE "zone_source_type_enum" AS ENUM ('system_copy', 'custom');

-- AlterTable: Add copy tracking fields to shipping_zones
ALTER TABLE "shipping_zones" ADD COLUMN "copied_from_system_zone_id" INTEGER;
ALTER TABLE "shipping_zones" ADD COLUMN "source_type" "zone_source_type_enum";

-- AlterTable: Add copy tracking fields to shipping_rates
ALTER TABLE "shipping_rates" ADD COLUMN "copied_from_system_rate_id" INTEGER;
ALTER TABLE "shipping_rates" ADD COLUMN "source_type" "zone_source_type_enum";

-- CreateTable: Tracking de cambios en zonas del sistema
CREATE TABLE "system_zone_updates" (
    "id" SERIAL NOT NULL,
    "system_zone_id" INTEGER NOT NULL,
    "change_type" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_zone_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_zone_updates_system_zone_id_idx" ON "system_zone_updates"("system_zone_id");
CREATE INDEX "system_zone_updates_created_at_idx" ON "system_zone_updates"("created_at");

-- CreateIndex
CREATE INDEX "shipping_zones_copied_from_system_zone_id_idx" ON "shipping_zones"("copied_from_system_zone_id");
CREATE INDEX "shipping_zones_source_type_idx" ON "shipping_zones"("source_type");

-- CreateIndex
CREATE INDEX "shipping_rates_copied_from_system_rate_id_idx" ON "shipping_rates"("copied_from_system_rate_id");

-- AddForeignKey: Self-referential for zone copies
ALTER TABLE "shipping_zones" ADD CONSTRAINT "shipping_zones_copied_from_system_zone_id_fkey"
    FOREIGN KEY ("copied_from_system_zone_id") REFERENCES "shipping_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: system_zone_updates -> shipping_zones
ALTER TABLE "system_zone_updates" ADD CONSTRAINT "system_zone_updates_system_zone_id_fkey"
    FOREIGN KEY ("system_zone_id") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
