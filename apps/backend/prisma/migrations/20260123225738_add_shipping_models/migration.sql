-- CreateEnum
CREATE TYPE "shipping_method_type_enum" AS ENUM ('custom', 'pickup', 'own_fleet', 'carrier', 'third_party_provider');

-- CreateEnum
CREATE TYPE "shipping_rate_type_enum" AS ENUM ('flat', 'weight_based', 'price_based', 'carrier_calculated', 'free');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "shipping_method_id" INTEGER;

-- CreateTable
CREATE TABLE "shipping_zones" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(100),
    "countries" TEXT[],
    "regions" TEXT[],
    "cities" TEXT[],
    "zip_codes" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_methods" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(50),
    "description" TEXT,
    "logo_url" TEXT,
    "type" "shipping_method_type_enum" NOT NULL DEFAULT 'custom',
    "provider_name" VARCHAR(50),
    "tracking_url" TEXT,
    "min_days" INTEGER,
    "max_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_rates" (
    "id" SERIAL NOT NULL,
    "shipping_zone_id" INTEGER NOT NULL,
    "shipping_method_id" INTEGER NOT NULL,
    "name" VARCHAR(100),
    "type" "shipping_rate_type_enum" NOT NULL DEFAULT 'flat',
    "base_cost" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "per_unit_cost" DECIMAL(12,2) DEFAULT 0.00,
    "min_val" DECIMAL(12,2),
    "max_val" DECIMAL(12,2),
    "free_shipping_threshold" DECIMAL(12,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipping_zones_store_id_idx" ON "shipping_zones"("store_id");

-- CreateIndex
CREATE INDEX "shipping_methods_store_id_idx" ON "shipping_methods"("store_id");

-- CreateIndex
CREATE INDEX "shipping_rates_shipping_zone_id_idx" ON "shipping_rates"("shipping_zone_id");

-- CreateIndex
CREATE INDEX "shipping_rates_shipping_method_id_idx" ON "shipping_rates"("shipping_method_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_method_id_fkey" FOREIGN KEY ("shipping_method_id") REFERENCES "shipping_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_zones" ADD CONSTRAINT "shipping_zones_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_shipping_zone_id_fkey" FOREIGN KEY ("shipping_zone_id") REFERENCES "shipping_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_shipping_method_id_fkey" FOREIGN KEY ("shipping_method_id") REFERENCES "shipping_methods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
