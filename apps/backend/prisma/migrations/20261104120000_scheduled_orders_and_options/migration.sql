-- Pedidos programados + adiciones (venta por encargo).
-- DATA IMPACT:
-- Tables affected: none mutated (schema-only, additive).
-- Expected row changes: 0. Only new enums, new enum values and new tables.
-- Destructive operations: none (no DROP, no TRUNCATE, no DELETE/UPDATE).
-- FK/cascade risk: order_item_options -> order_items usa ON DELETE RESTRICT (decision de Rafael, 2026-10-30)
--   (snapshot child of a line, same pattern as order_item_exclusions); every
--   FK to business parents (stores, orders, products, categories) is RESTRICT.
-- Idempotency: IF NOT EXISTS / pg_type / pg_constraint guards on every statement.

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_fulfillment_status_enum') THEN
    CREATE TYPE "order_fulfillment_status_enum" AS ENUM ('scheduled', 'in_production', 'ready', 'delivered', 'no_show', 'cancelled');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_fulfillment_type_enum') THEN
    CREATE TYPE "order_fulfillment_type_enum" AS ENUM ('pickup', 'delivery');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_option_component_type_enum') THEN
    CREATE TYPE "product_option_component_type_enum" AS ENUM ('ingredient', 'recipe', 'product');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_option_scope_enum') THEN
    CREATE TYPE "product_option_scope_enum" AS ENUM ('per_unit', 'per_line');
  END IF;
END $$;

-- AlterEnum (ADD VALUE corre dentro de la transacción y es válido en PG 12+; IF NOT EXISTS lo hace re-ejecutable)
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'scheduled_order_reminder';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'scheduled_order_rescheduled';

-- CreateTable
CREATE TABLE IF NOT EXISTS "fulfillment_schedule_exceptions" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "start_time" VARCHAR(5),
    "end_time" VARCHAR(5),
    "slot_capacity" INTEGER,
    "day_capacity" INTEGER,
    "reason" VARCHAR(255),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillment_schedule_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "order_fulfillment_schedules" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "order_id" INTEGER NOT NULL,
    "scheduled_start" TIMESTAMP(6) NOT NULL,
    "scheduled_end" TIMESTAMP(6) NOT NULL,
    "fulfillment_type" "order_fulfillment_type_enum" NOT NULL DEFAULT 'pickup',
    "status" "order_fulfillment_status_enum" NOT NULL DEFAULT 'scheduled',
    "hold_expires_at" TIMESTAMP(6),
    "produced_at" TIMESTAMP(6),
    "ready_at" TIMESTAMP(6),
    "delivered_at" TIMESTAMP(6),
    "cancelled_at" TIMESTAMP(6),
    "notes" TEXT,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_fulfillment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "order_fulfillment_changes" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "schedule_id" INTEGER NOT NULL,
    "change_type" VARCHAR(20) NOT NULL,
    "from_status" "order_fulfillment_status_enum",
    "to_status" "order_fulfillment_status_enum",
    "from_start" TIMESTAMP(6),
    "to_start" TIMESTAMP(6),
    "from_end" TIMESTAMP(6),
    "to_end" TIMESTAMP(6),
    "note" VARCHAR(500),
    "changed_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_fulfillment_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "scheduled_order_reminder_logs" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "schedule_id" INTEGER NOT NULL,
    "rule_key" VARCHAR(30) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "sent_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_order_reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "product_option_groups" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER NOT NULL DEFAULT 1,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "scope" "product_option_scope_enum" NOT NULL DEFAULT 'per_unit',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_option_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "product_options" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "group_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "price_delta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "component_type" "product_option_component_type_enum" NOT NULL,
    "component_product_id" INTEGER NOT NULL,
    "component_variant_id" INTEGER,
    "quantity" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "uom" VARCHAR(20),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "product_option_group_assignments" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "group_id" INTEGER NOT NULL,
    "product_id" INTEGER,
    "category_id" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_option_group_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "order_item_options" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "order_item_id" INTEGER NOT NULL,
    "option_id" INTEGER,
    "group_name" VARCHAR(120) NOT NULL,
    "option_name" VARCHAR(120) NOT NULL,
    "scope" "product_option_scope_enum" NOT NULL,
    "price_delta" DECIMAL(12,2) NOT NULL,
    "component_type" "product_option_component_type_enum" NOT NULL,
    "component_product_id" INTEGER NOT NULL,
    "component_variant_id" INTEGER,
    "quantity" DECIMAL(12,4) NOT NULL,
    "uom" VARCHAR(20),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fulfillment_schedule_exceptions_store_id_date_idx" ON "fulfillment_schedule_exceptions"("store_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "fulfillment_schedule_exceptions_store_id_date_key" ON "fulfillment_schedule_exceptions"("store_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "order_fulfillment_schedules_order_id_key" ON "order_fulfillment_schedules"("order_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_fulfillment_schedules_store_id_scheduled_start_idx" ON "order_fulfillment_schedules"("store_id", "scheduled_start");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_fulfillment_schedules_store_id_status_idx" ON "order_fulfillment_schedules"("store_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_fulfillment_changes_schedule_id_idx" ON "order_fulfillment_changes"("schedule_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_fulfillment_changes_store_id_created_at_idx" ON "order_fulfillment_changes"("store_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "scheduled_order_reminder_logs_store_id_idx" ON "scheduled_order_reminder_logs"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_order_reminder_logs_schedule_id_rule_key_channel_key" ON "scheduled_order_reminder_logs"("schedule_id", "rule_key", "channel");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_option_groups_store_id_is_active_idx" ON "product_option_groups"("store_id", "is_active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_options_group_id_idx" ON "product_options"("group_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_options_store_id_idx" ON "product_options"("store_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_option_group_assignments_group_id_idx" ON "product_option_group_assignments"("group_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_option_group_assignments_product_id_idx" ON "product_option_group_assignments"("product_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_option_group_assignments_category_id_idx" ON "product_option_group_assignments"("category_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_item_options_order_item_id_idx" ON "order_item_options"("order_item_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_item_options_store_id_idx" ON "order_item_options"("store_id");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_schedule_exceptions_store_id_fkey') THEN
    ALTER TABLE "fulfillment_schedule_exceptions" ADD CONSTRAINT "fulfillment_schedule_exceptions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_fulfillment_schedules_store_id_fkey') THEN
    ALTER TABLE "order_fulfillment_schedules" ADD CONSTRAINT "order_fulfillment_schedules_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_fulfillment_schedules_order_id_fkey') THEN
    ALTER TABLE "order_fulfillment_schedules" ADD CONSTRAINT "order_fulfillment_schedules_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_fulfillment_schedules_created_by_user_id_fkey') THEN
    ALTER TABLE "order_fulfillment_schedules" ADD CONSTRAINT "order_fulfillment_schedules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_fulfillment_changes_store_id_fkey') THEN
    ALTER TABLE "order_fulfillment_changes" ADD CONSTRAINT "order_fulfillment_changes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_fulfillment_changes_schedule_id_fkey') THEN
    ALTER TABLE "order_fulfillment_changes" ADD CONSTRAINT "order_fulfillment_changes_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "order_fulfillment_schedules"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_fulfillment_changes_changed_by_user_id_fkey') THEN
    ALTER TABLE "order_fulfillment_changes" ADD CONSTRAINT "order_fulfillment_changes_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_order_reminder_logs_store_id_fkey') THEN
    ALTER TABLE "scheduled_order_reminder_logs" ADD CONSTRAINT "scheduled_order_reminder_logs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_order_reminder_logs_schedule_id_fkey') THEN
    ALTER TABLE "scheduled_order_reminder_logs" ADD CONSTRAINT "scheduled_order_reminder_logs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "order_fulfillment_schedules"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_option_groups_store_id_fkey') THEN
    ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_options_store_id_fkey') THEN
    ALTER TABLE "product_options" ADD CONSTRAINT "product_options_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_options_group_id_fkey') THEN
    ALTER TABLE "product_options" ADD CONSTRAINT "product_options_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "product_option_groups"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_options_component_product_id_fkey') THEN
    ALTER TABLE "product_options" ADD CONSTRAINT "product_options_component_product_id_fkey" FOREIGN KEY ("component_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_options_component_variant_id_fkey') THEN
    ALTER TABLE "product_options" ADD CONSTRAINT "product_options_component_variant_id_fkey" FOREIGN KEY ("component_variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_option_group_assignments_store_id_fkey') THEN
    ALTER TABLE "product_option_group_assignments" ADD CONSTRAINT "product_option_group_assignments_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_option_group_assignments_group_id_fkey') THEN
    ALTER TABLE "product_option_group_assignments" ADD CONSTRAINT "product_option_group_assignments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "product_option_groups"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_option_group_assignments_product_id_fkey') THEN
    ALTER TABLE "product_option_group_assignments" ADD CONSTRAINT "product_option_group_assignments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_option_group_assignments_category_id_fkey') THEN
    ALTER TABLE "product_option_group_assignments" ADD CONSTRAINT "product_option_group_assignments_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_item_options_store_id_fkey') THEN
    ALTER TABLE "order_item_options" ADD CONSTRAINT "order_item_options_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_item_options_order_item_id_fkey') THEN
    ALTER TABLE "order_item_options" ADD CONSTRAINT "order_item_options_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_item_options_option_id_fkey') THEN
    ALTER TABLE "order_item_options" ADD CONSTRAINT "order_item_options_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "product_options"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

