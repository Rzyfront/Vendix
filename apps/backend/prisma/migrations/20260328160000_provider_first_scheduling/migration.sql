-- Provider-First Scheduling Migration
-- Replaces service_schedules/schedule_exceptions with provider-based scheduling

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "booking_mode_enum" AS ENUM ('provider_required', 'free_booking');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: bookings - add provider_id
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "provider_id" INTEGER;

-- AlterTable: products - add booking_mode and buffer_minutes
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "booking_mode" "booking_mode_enum" NOT NULL DEFAULT 'provider_required';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "buffer_minutes" INTEGER DEFAULT 0;

-- DropForeignKey (old tables)
ALTER TABLE "schedule_exceptions" DROP CONSTRAINT IF EXISTS "schedule_exceptions_product_id_fkey";
ALTER TABLE "schedule_exceptions" DROP CONSTRAINT IF EXISTS "schedule_exceptions_store_id_fkey";
ALTER TABLE "service_schedules" DROP CONSTRAINT IF EXISTS "service_schedules_product_id_fkey";
ALTER TABLE "service_schedules" DROP CONSTRAINT IF EXISTS "service_schedules_store_id_fkey";

-- DropTable (old tables)
DROP TABLE IF EXISTS "schedule_exceptions";
DROP TABLE IF EXISTS "service_schedules";

-- CreateTable: service_providers
CREATE TABLE IF NOT EXISTS "service_providers" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_name" VARCHAR(100),
    "avatar_url" TEXT,
    "bio" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: provider_services
CREATE TABLE IF NOT EXISTS "provider_services" (
    "id" SERIAL NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,

    CONSTRAINT "provider_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable: provider_schedules
CREATE TABLE IF NOT EXISTS "provider_schedules" (
    "id" SERIAL NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable: provider_exceptions
CREATE TABLE IF NOT EXISTS "provider_exceptions" (
    "id" SERIAL NOT NULL,
    "provider_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "is_unavailable" BOOLEAN NOT NULL DEFAULT true,
    "custom_start_time" VARCHAR(5),
    "custom_end_time" VARCHAR(5),
    "reason" VARCHAR(255),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "service_providers_store_id_is_active_idx" ON "service_providers"("store_id", "is_active");
CREATE UNIQUE INDEX IF NOT EXISTS "service_providers_store_id_employee_id_key" ON "service_providers"("store_id", "employee_id");
CREATE UNIQUE INDEX IF NOT EXISTS "provider_services_provider_id_product_id_key" ON "provider_services"("provider_id", "product_id");
CREATE INDEX IF NOT EXISTS "provider_schedules_provider_id_idx" ON "provider_schedules"("provider_id");
CREATE UNIQUE INDEX IF NOT EXISTS "provider_schedules_provider_id_day_of_week_key" ON "provider_schedules"("provider_id", "day_of_week");
CREATE INDEX IF NOT EXISTS "provider_exceptions_provider_id_date_idx" ON "provider_exceptions"("provider_id", "date");
CREATE INDEX IF NOT EXISTS "bookings_provider_id_idx" ON "bookings"("provider_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_services" ADD CONSTRAINT "provider_services_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_services" ADD CONSTRAINT "provider_services_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_schedules" ADD CONSTRAINT "provider_schedules_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_exceptions" ADD CONSTRAINT "provider_exceptions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
