-- CreateEnum: coupon_discount_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coupon_discount_type') THEN
    CREATE TYPE "coupon_discount_type" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');
  END IF;
END
$$;

-- CreateEnum: coupon_applies_to
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coupon_applies_to') THEN
    CREATE TYPE "coupon_applies_to" AS ENUM ('ALL_PRODUCTS', 'SPECIFIC_PRODUCTS', 'SPECIFIC_CATEGORIES');
  END IF;
END
$$;

-- CreateTable: coupons
CREATE TABLE IF NOT EXISTS "coupons" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "discount_type" "coupon_discount_type" NOT NULL,
    "discount_value" DECIMAL(12,2) NOT NULL,
    "min_purchase_amount" DECIMAL(12,2),
    "max_discount_amount" DECIMAL(12,2),
    "max_uses" INTEGER,
    "max_uses_per_customer" INTEGER DEFAULT 1,
    "current_uses" INTEGER NOT NULL DEFAULT 0,
    "valid_from" TIMESTAMP(6) NOT NULL,
    "valid_until" TIMESTAMP(6) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "applies_to" "coupon_applies_to" NOT NULL DEFAULT 'ALL_PRODUCTS',
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable: coupon_products
CREATE TABLE IF NOT EXISTS "coupon_products" (
    "id" SERIAL NOT NULL,
    "coupon_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,

    CONSTRAINT "coupon_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable: coupon_categories
CREATE TABLE IF NOT EXISTS "coupon_categories" (
    "id" SERIAL NOT NULL,
    "coupon_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,

    CONSTRAINT "coupon_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable: coupon_uses
CREATE TABLE IF NOT EXISTS "coupon_uses" (
    "id" SERIAL NOT NULL,
    "coupon_id" INTEGER NOT NULL,
    "order_id" INTEGER NOT NULL,
    "customer_id" INTEGER,
    "discount_applied" DECIMAL(12,2) NOT NULL,
    "used_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_uses_pkey" PRIMARY KEY ("id")
);

-- Add coupon fields to orders
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "coupon_id" INTEGER;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "coupon_code" VARCHAR(50);

-- CreateIndex: coupons
CREATE UNIQUE INDEX IF NOT EXISTS "coupons_store_id_code_key" ON "coupons"("store_id", "code");
CREATE INDEX IF NOT EXISTS "coupons_store_id_is_active_idx" ON "coupons"("store_id", "is_active");

-- CreateIndex: coupon_products
CREATE UNIQUE INDEX IF NOT EXISTS "coupon_products_coupon_id_product_id_key" ON "coupon_products"("coupon_id", "product_id");
CREATE INDEX IF NOT EXISTS "coupon_products_coupon_id_idx" ON "coupon_products"("coupon_id");

-- CreateIndex: coupon_categories
CREATE UNIQUE INDEX IF NOT EXISTS "coupon_categories_coupon_id_category_id_key" ON "coupon_categories"("coupon_id", "category_id");
CREATE INDEX IF NOT EXISTS "coupon_categories_coupon_id_idx" ON "coupon_categories"("coupon_id");

-- CreateIndex: coupon_uses
CREATE INDEX IF NOT EXISTS "coupon_uses_coupon_id_customer_id_idx" ON "coupon_uses"("coupon_id", "customer_id");
CREATE INDEX IF NOT EXISTS "coupon_uses_order_id_idx" ON "coupon_uses"("order_id");

-- AddForeignKey: coupons -> stores
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey: coupon_products -> coupons
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: coupon_products -> products
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: coupon_categories -> coupons
ALTER TABLE "coupon_categories" ADD CONSTRAINT "coupon_categories_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: coupon_categories -> categories
ALTER TABLE "coupon_categories" ADD CONSTRAINT "coupon_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: coupon_uses -> coupons
ALTER TABLE "coupon_uses" ADD CONSTRAINT "coupon_uses_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: coupon_uses -> orders
ALTER TABLE "coupon_uses" ADD CONSTRAINT "coupon_uses_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: coupon_uses -> users
ALTER TABLE "coupon_uses" ADD CONSTRAINT "coupon_uses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey: orders -> coupons
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
