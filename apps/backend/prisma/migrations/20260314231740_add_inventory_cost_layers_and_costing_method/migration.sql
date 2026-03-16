-- CreateEnum (idempotent - safe for production)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'costing_method_enum') THEN
    CREATE TYPE "costing_method_enum" AS ENUM ('weighted_average', 'fifo', 'lifo');
  END IF;
END
$$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "inventory_cost_layers" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_variant_id" INTEGER,
    "location_id" INTEGER NOT NULL,
    "purchase_order_id" INTEGER,
    "quantity_remaining" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(12,4) NOT NULL,
    "received_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_layers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inventory_cost_layers_product_id_product_variant_id_locati_idx"
ON "inventory_cost_layers"("product_id", "product_variant_id", "location_id", "received_at");

CREATE INDEX IF NOT EXISTS "inventory_cost_layers_organization_id_idx"
ON "inventory_cost_layers"("organization_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'inventory_cost_layers_organization_id_fkey'
    AND table_name = 'inventory_cost_layers'
  ) THEN
    ALTER TABLE "inventory_cost_layers"
    ADD CONSTRAINT "inventory_cost_layers_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'inventory_cost_layers_product_id_fkey'
    AND table_name = 'inventory_cost_layers'
  ) THEN
    ALTER TABLE "inventory_cost_layers"
    ADD CONSTRAINT "inventory_cost_layers_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'inventory_cost_layers_product_variant_id_fkey'
    AND table_name = 'inventory_cost_layers'
  ) THEN
    ALTER TABLE "inventory_cost_layers"
    ADD CONSTRAINT "inventory_cost_layers_product_variant_id_fkey"
    FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'inventory_cost_layers_location_id_fkey'
    AND table_name = 'inventory_cost_layers'
  ) THEN
    ALTER TABLE "inventory_cost_layers"
    ADD CONSTRAINT "inventory_cost_layers_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'inventory_cost_layers_purchase_order_id_fkey'
    AND table_name = 'inventory_cost_layers'
  ) THEN
    ALTER TABLE "inventory_cost_layers"
    ADD CONSTRAINT "inventory_cost_layers_purchase_order_id_fkey"
    FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
