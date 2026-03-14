-- CreateEnum
CREATE TYPE "promotion_state_enum" AS ENUM ('draft', 'scheduled', 'active', 'paused', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "promotion_type_enum" AS ENUM ('percentage', 'fixed_amount');

-- CreateEnum
CREATE TYPE "promotion_scope_enum" AS ENUM ('order', 'product', 'category');

-- CreateTable
CREATE TABLE "promotions" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "code" VARCHAR(50),
    "type" "promotion_type_enum" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "scope" "promotion_scope_enum" NOT NULL DEFAULT 'order',
    "min_purchase_amount" DECIMAL(12,2),
    "max_discount_amount" DECIMAL(12,2),
    "usage_limit" INTEGER,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "per_customer_limit" INTEGER,
    "start_date" TIMESTAMP(6) NOT NULL,
    "end_date" TIMESTAMP(6),
    "state" "promotion_state_enum" NOT NULL DEFAULT 'draft',
    "is_auto_apply" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_products" (
    "id" SERIAL NOT NULL,
    "promotion_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,

    CONSTRAINT "promotion_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_categories" (
    "id" SERIAL NOT NULL,
    "promotion_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,

    CONSTRAINT "promotion_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_promotions" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "promotion_id" INTEGER NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promotions_store_id_code_key" ON "promotions"("store_id", "code");

-- CreateIndex
CREATE INDEX "promotions_store_id_state_idx" ON "promotions"("store_id", "state");

-- CreateIndex
CREATE INDEX "promotions_store_id_start_date_end_date_idx" ON "promotions"("store_id", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_products_promotion_id_product_id_key" ON "promotion_products"("promotion_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_categories_promotion_id_category_id_key" ON "promotion_categories"("promotion_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_promotions_order_id_promotion_id_key" ON "order_promotions"("order_id", "promotion_id");

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_products" ADD CONSTRAINT "promotion_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_categories" ADD CONSTRAINT "promotion_categories_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_categories" ADD CONSTRAINT "promotion_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_promotions" ADD CONSTRAINT "order_promotions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_promotions" ADD CONSTRAINT "order_promotions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
