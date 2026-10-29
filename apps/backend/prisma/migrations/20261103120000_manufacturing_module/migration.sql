-- Manufacturing module (MVP): formulas, production orders and plant settings.
-- DATA IMPACT:
-- Tables affected: none mutated (schema-only, additive).
-- Expected row changes: 0. New columns are nullable or have defaults.
-- Destructive operations: none (no DROP, no TRUNCATE, no DELETE/UPDATE).
-- FK/cascade risk: only production_order_lines -> production_orders ON DELETE CASCADE
--   (child lines of a new table follow their order); no cascade on business parents.
-- Idempotency: IF NOT EXISTS guards on every statement.

-- 1. Enum values (ALTER TYPE ADD VALUE runs outside the transaction).
ALTER TYPE "product_type_enum" ADD VALUE IF NOT EXISTS 'manufactured';
ALTER TYPE "product_type_enum" ADD VALUE IF NOT EXISTS 'semi_finished';
ALTER TYPE "production_order_state_enum" ADD VALUE IF NOT EXISTS 'released';
ALTER TYPE "production_order_state_enum" ADD VALUE IF NOT EXISTS 'partially_completed';

-- 2. recipes: formula metadata (is_active kept for compatibility).
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "code" VARCHAR(50);
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) NOT NULL DEFAULT 'active';

-- 3. production_orders: manufacturing fields.
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "order_number" VARCHAR(30);
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "due_date" TIMESTAMP(6);
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP(6);
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "location_id" INTEGER;
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "batch_id" INTEGER;
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "priority" VARCHAR(20);
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "created_by" INTEGER;
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "source" VARCHAR(20);
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "planned_cost" DECIMAL(14,4);
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "actual_cost" DECIMAL(14,4);
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "unit_cost" DECIMAL(14,4);
-- Existing rows have NULL order_number; NULLs never collide in a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "production_orders_store_id_order_number_key"
  ON "production_orders"("store_id", "order_number");

-- 4. production_order_lines
CREATE TABLE IF NOT EXISTS "production_order_lines" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "component_product_id" INTEGER NOT NULL,
    "component_variant_id" INTEGER,
    "planned_qty" DECIMAL(12,4) NOT NULL,
    "consumed_qty" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "uom_id" INTEGER,
    "unit_cost" DECIMAL(14,4),
    "total_cost" DECIMAL(14,4),
    "cost_snapshot" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "production_order_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "production_order_lines_order_id_idx" ON "production_order_lines"("order_id");
CREATE INDEX IF NOT EXISTS "production_order_lines_component_product_id_idx" ON "production_order_lines"("component_product_id");

-- 5. manufacturing_settings
CREATE TABLE IF NOT EXISTS "manufacturing_settings" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "default_input_location_id" INTEGER,
    "default_output_location_id" INTEGER,
    "cost_method" VARCHAR(20) NOT NULL DEFAULT 'fifo',
    "lot_required" BOOLEAN NOT NULL DEFAULT false,
    "wip_account_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manufacturing_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "manufacturing_settings_store_id_key" ON "manufacturing_settings"("store_id");

-- 6. store_sequences
CREATE TABLE IF NOT EXISTS "store_sequences" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "prefix" VARCHAR(10) NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "store_sequences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "store_sequences_store_id_key_key" ON "store_sequences"("store_id", "key");

-- 7. Foreign keys (guarded).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_order_lines_order_id_fkey') THEN
    ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_order_lines_component_product_id_fkey') THEN
    ALTER TABLE "production_order_lines" ADD CONSTRAINT "production_order_lines_component_product_id_fkey"
      FOREIGN KEY ("component_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturing_settings_store_id_fkey') THEN
    ALTER TABLE "manufacturing_settings" ADD CONSTRAINT "manufacturing_settings_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_sequences_store_id_fkey') THEN
    ALTER TABLE "store_sequences" ADD CONSTRAINT "store_sequences_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
