-- CreateEnum
CREATE TYPE "public"."location_type_enum" AS ENUM ('warehouse', 'store', 'production_area', 'receiving_area', 'shipping_area', 'quarantine', 'damaged_goods');

-- CreateEnum
CREATE TYPE "public"."movement_type_enum" AS ENUM ('stock_in', 'stock_out', 'transfer', 'adjustment', 'sale', 'return', 'damage', 'expiration');

-- CreateEnum
CREATE TYPE "public"."source_order_type_enum" AS ENUM ('purchase', 'sale', 'transfer', 'return');

-- CreateEnum
CREATE TYPE "public"."serial_status_enum" AS ENUM ('in_stock', 'reserved', 'sold', 'returned', 'damaged', 'expired', 'in_transit');

-- CreateEnum
CREATE TYPE "public"."adjustment_type_enum" AS ENUM ('damage', 'loss', 'theft', 'expiration', 'count_variance', 'manual_correction');

-- CreateEnum
CREATE TYPE "public"."reservation_type_enum" AS ENUM ('order', 'transfer', 'adjustment');

-- CreateEnum
CREATE TYPE "public"."reservation_status_enum" AS ENUM ('active', 'consumed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."purchase_order_status_enum" AS ENUM ('draft', 'approved', 'received', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."sales_order_status_enum" AS ENUM ('draft', 'confirmed', 'shipped', 'invoiced', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."transfer_status_enum" AS ENUM ('draft', 'in_transit', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."return_order_type_enum" AS ENUM ('purchase_return', 'sales_return');

-- CreateEnum
CREATE TYPE "public"."return_order_status_enum" AS ENUM ('draft', 'processed', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."related_order_type_enum" AS ENUM ('purchase_order', 'sales_order');

-- CreateEnum
CREATE TYPE "public"."partner_type_enum" AS ENUM ('customer', 'supplier');

-- CreateEnum
CREATE TYPE "public"."item_condition_enum" AS ENUM ('good', 'damaged');

-- CreateTable
CREATE TABLE "public"."inventory_locations" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "type" "public"."location_type_enum" NOT NULL DEFAULT 'warehouse',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "address_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_levels" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_variant_id" INTEGER,
    "location_id" INTEGER NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "quantity_reserved" INTEGER NOT NULL DEFAULT 0,
    "quantity_available" INTEGER NOT NULL DEFAULT 0,
    "reorder_point" INTEGER,
    "max_stock" INTEGER,
    "cost_per_unit" DECIMAL(12,4),
    "last_updated" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory_movements" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_variant_id" INTEGER,
    "from_location_id" INTEGER,
    "to_location_id" INTEGER,
    "quantity" INTEGER NOT NULL,
    "movement_type" "public"."movement_type_enum" NOT NULL,
    "source_order_type" "public"."source_order_type_enum",
    "source_order_id" INTEGER,
    "reason" TEXT,
    "notes" TEXT,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory_batches" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_variant_id" INTEGER,
    "batch_number" VARCHAR(100) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "quantity_used" INTEGER NOT NULL DEFAULT 0,
    "manufacturing_date" TIMESTAMP(6),
    "expiration_date" TIMESTAMP(6),
    "location_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory_serial_numbers" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_variant_id" INTEGER,
    "serial_number" VARCHAR(255) NOT NULL,
    "status" "public"."serial_status_enum" NOT NULL DEFAULT 'in_stock',
    "location_id" INTEGER,
    "batch_id" INTEGER,
    "cost" DECIMAL(12,4),
    "sold_date" TIMESTAMP(6),
    "warranty_expiry" TIMESTAMP(6),
    "notes" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_serial_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."suppliers" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "website" VARCHAR(255),
    "tax_id" VARCHAR(50),
    "payment_terms" VARCHAR(255),
    "lead_time_days" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."supplier_products" (
    "id" SERIAL NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "supplier_sku" VARCHAR(100),
    "cost_per_unit" DECIMAL(12,4),
    "min_order_qty" INTEGER,
    "lead_time_days" INTEGER,
    "is_preferred" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inventory_adjustments" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_variant_id" INTEGER,
    "location_id" INTEGER NOT NULL,
    "adjustment_type" "public"."adjustment_type_enum" NOT NULL,
    "quantity_before" INTEGER NOT NULL,
    "quantity_after" INTEGER NOT NULL,
    "quantity_change" INTEGER NOT NULL,
    "reason_code" VARCHAR(50),
    "description" TEXT,
    "approved_by_user_id" INTEGER,
    "created_by_user_id" INTEGER,
    "approved_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_reservations" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_variant_id" INTEGER,
    "location_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reserved_for_type" "public"."reservation_type_enum" NOT NULL,
    "reserved_for_id" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(6),
    "status" "public"."reservation_status_enum" NOT NULL DEFAULT 'active',
    "user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."purchase_orders" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "location_id" INTEGER NOT NULL,
    "order_number" VARCHAR(50) NOT NULL,
    "status" "public"."purchase_order_status_enum" NOT NULL DEFAULT 'draft',
    "order_date" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "expected_date" TIMESTAMP(6),
    "received_date" TIMESTAMP(6),
    "subtotal_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "notes" TEXT,
    "created_by_user_id" INTEGER,
    "approved_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."purchase_order_items" (
    "id" SERIAL NOT NULL,
    "purchase_order_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_variant_id" INTEGER,
    "quantity_ordered" INTEGER NOT NULL,
    "quantity_received" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(12,4),
    "total_cost" DECIMAL(12,2),
    "notes" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sales_orders" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "order_number" VARCHAR(50) NOT NULL,
    "status" "public"."sales_order_status_enum" NOT NULL DEFAULT 'draft',
    "shipping_address_id" INTEGER,
    "created_by_user_id" INTEGER,
    "approved_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sales_order_items" (
    "id" SERIAL NOT NULL,
    "sales_order_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_variant_id" INTEGER,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2),
    "discount" DECIMAL(12,2),
    "total_price" DECIMAL(12,2),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_transfers" (
    "id" SERIAL NOT NULL,
    "transfer_number" VARCHAR(50) NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "from_location_id" INTEGER NOT NULL,
    "to_location_id" INTEGER NOT NULL,
    "status" "public"."transfer_status_enum" NOT NULL DEFAULT 'draft',
    "transfer_date" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "expected_date" TIMESTAMP(6),
    "completed_date" TIMESTAMP(6),
    "notes" TEXT,
    "created_by_user_id" INTEGER,
    "approved_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stock_transfer_items" (
    "id" SERIAL NOT NULL,
    "stock_transfer_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_variant_id" INTEGER,
    "quantity" INTEGER NOT NULL,
    "quantity_received" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."return_orders" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "related_order_id" INTEGER,
    "related_order_type" "public"."related_order_type_enum",
    "partner_id" INTEGER,
    "partner_type" "public"."partner_type_enum",
    "type" "public"."return_order_type_enum" NOT NULL,
    "status" "public"."return_order_status_enum" NOT NULL DEFAULT 'draft',
    "reason_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."return_order_items" (
    "id" SERIAL NOT NULL,
    "return_order_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_variant_id" INTEGER,
    "quantity" INTEGER NOT NULL,
    "condition" "public"."item_condition_enum" NOT NULL DEFAULT 'good',
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."_product_variantsTosupplier_products" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_product_variantsTosupplier_products_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "inventory_locations_organization_id_store_id_idx" ON "public"."inventory_locations"("organization_id", "store_id");

-- CreateIndex
CREATE INDEX "inventory_locations_organization_id_type_idx" ON "public"."inventory_locations"("organization_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_locations_organization_id_code_key" ON "public"."inventory_locations"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_product_id_product_variant_id_location_id_key" ON "public"."stock_levels"("product_id", "product_variant_id", "location_id");

-- CreateIndex
CREATE INDEX "inventory_movements_organization_id_product_id_created_at_idx" ON "public"."inventory_movements"("organization_id", "product_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_organization_id_from_location_id_create_idx" ON "public"."inventory_movements"("organization_id", "from_location_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_organization_id_to_location_id_created__idx" ON "public"."inventory_movements"("organization_id", "to_location_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_organization_id_user_id_created_at_idx" ON "public"."inventory_movements"("organization_id", "user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_batches_product_id_batch_number_key" ON "public"."inventory_batches"("product_id", "batch_number");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_serial_numbers_serial_number_key" ON "public"."inventory_serial_numbers"("serial_number");

-- CreateIndex
CREATE INDEX "suppliers_organization_id_name_idx" ON "public"."suppliers"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organization_id_code_key" ON "public"."suppliers"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_products_supplier_id_product_id_key" ON "public"."supplier_products"("supplier_id", "product_id");

-- CreateIndex
CREATE INDEX "inventory_adjustments_organization_id_location_id_adjustmen_idx" ON "public"."inventory_adjustments"("organization_id", "location_id", "adjustment_type");

-- CreateIndex
CREATE INDEX "inventory_adjustments_organization_id_created_by_user_id_cr_idx" ON "public"."inventory_adjustments"("organization_id", "created_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_adjustments_organization_id_approved_by_user_id_a_idx" ON "public"."inventory_adjustments"("organization_id", "approved_by_user_id", "approved_at");

-- CreateIndex
CREATE INDEX "stock_reservations_organization_id_reserved_for_type_reserv_idx" ON "public"."stock_reservations"("organization_id", "reserved_for_type", "reserved_for_id");

-- CreateIndex
CREATE INDEX "stock_reservations_organization_id_location_id_status_idx" ON "public"."stock_reservations"("organization_id", "location_id", "status");

-- CreateIndex
CREATE INDEX "stock_reservations_organization_id_expires_at_status_idx" ON "public"."stock_reservations"("organization_id", "expires_at", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_organization_id_order_number_key" ON "public"."purchase_orders"("organization_id", "order_number");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "public"."purchase_order_items"("purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_items_product_id_purchase_order_id_idx" ON "public"."purchase_order_items"("product_id", "purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_organization_id_order_number_key" ON "public"."sales_orders"("organization_id", "order_number");

-- CreateIndex
CREATE INDEX "sales_order_items_sales_order_id_idx" ON "public"."sales_order_items"("sales_order_id");

-- CreateIndex
CREATE INDEX "sales_order_items_product_id_sales_order_id_idx" ON "public"."sales_order_items"("product_id", "sales_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_organization_id_transfer_number_key" ON "public"."stock_transfers"("organization_id", "transfer_number");

-- CreateIndex
CREATE INDEX "stock_transfer_items_stock_transfer_id_idx" ON "public"."stock_transfer_items"("stock_transfer_id");

-- CreateIndex
CREATE INDEX "stock_transfer_items_product_id_stock_transfer_id_idx" ON "public"."stock_transfer_items"("product_id", "stock_transfer_id");

-- CreateIndex
CREATE INDEX "return_orders_organization_id_type_status_idx" ON "public"."return_orders"("organization_id", "type", "status");

-- CreateIndex
CREATE INDEX "return_order_items_return_order_id_product_id_idx" ON "public"."return_order_items"("return_order_id", "product_id");

-- CreateIndex
CREATE INDEX "_product_variantsTosupplier_products_B_index" ON "public"."_product_variantsTosupplier_products"("B");

-- AddForeignKey
ALTER TABLE "public"."inventory_locations" ADD CONSTRAINT "inventory_locations_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inventory_locations" ADD CONSTRAINT "inventory_locations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_locations" ADD CONSTRAINT "inventory_locations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_levels" ADD CONSTRAINT "stock_levels_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_levels" ADD CONSTRAINT "stock_levels_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_levels" ADD CONSTRAINT "stock_levels_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_movements" ADD CONSTRAINT "inventory_movements_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inventory_movements" ADD CONSTRAINT "inventory_movements_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inventory_movements" ADD CONSTRAINT "inventory_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_movements" ADD CONSTRAINT "inventory_movements_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_movements" ADD CONSTRAINT "inventory_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inventory_batches" ADD CONSTRAINT "inventory_batches_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inventory_batches" ADD CONSTRAINT "inventory_batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_batches" ADD CONSTRAINT "inventory_batches_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_serial_numbers" ADD CONSTRAINT "inventory_serial_numbers_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."inventory_batches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inventory_serial_numbers" ADD CONSTRAINT "inventory_serial_numbers_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inventory_serial_numbers" ADD CONSTRAINT "inventory_serial_numbers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_serial_numbers" ADD CONSTRAINT "inventory_serial_numbers_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."suppliers" ADD CONSTRAINT "suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supplier_products" ADD CONSTRAINT "supplier_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."supplier_products" ADD CONSTRAINT "supplier_products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."stock_reservations" ADD CONSTRAINT "stock_reservations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_reservations" ADD CONSTRAINT "stock_reservations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_reservations" ADD CONSTRAINT "stock_reservations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_reservations" ADD CONSTRAINT "stock_reservations_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_reservations" ADD CONSTRAINT "stock_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."purchase_orders" ADD CONSTRAINT "purchase_orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_orders" ADD CONSTRAINT "sales_orders_shipping_address_id_fkey" FOREIGN KEY ("shipping_address_id") REFERENCES "public"."addresses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."sales_orders" ADD CONSTRAINT "sales_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_orders" ADD CONSTRAINT "sales_orders_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."sales_orders" ADD CONSTRAINT "sales_orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."sales_order_items" ADD CONSTRAINT "sales_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_order_items" ADD CONSTRAINT "sales_order_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_order_items" ADD CONSTRAINT "sales_order_items_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_transfers" ADD CONSTRAINT "stock_transfers_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."stock_transfers" ADD CONSTRAINT "stock_transfers_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."stock_transfers" ADD CONSTRAINT "stock_transfers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_transfers" ADD CONSTRAINT "stock_transfers_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_stock_transfer_id_fkey" FOREIGN KEY ("stock_transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."return_orders" ADD CONSTRAINT "return_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."return_order_items" ADD CONSTRAINT "return_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."return_order_items" ADD CONSTRAINT "return_order_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."return_order_items" ADD CONSTRAINT "return_order_items_return_order_id_fkey" FOREIGN KEY ("return_order_id") REFERENCES "public"."return_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_product_variantsTosupplier_products" ADD CONSTRAINT "_product_variantsTosupplier_products_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_product_variantsTosupplier_products" ADD CONSTRAINT "_product_variantsTosupplier_products_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."supplier_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
