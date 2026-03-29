-- CreateEnum
CREATE TYPE "booking_status_enum" AS ENUM ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');

-- CreateTable
CREATE TABLE "bookings" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "booking_number" VARCHAR(50) NOT NULL,
    "date" DATE NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "status" "booking_status_enum" NOT NULL DEFAULT 'pending',
    "channel" "order_channel_enum" NOT NULL DEFAULT 'pos',
    "notes" TEXT,
    "internal_notes" TEXT,
    "order_id" INTEGER,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_schedules" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "slot_duration_minutes" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_exceptions" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "product_id" INTEGER,
    "date" DATE NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "custom_start_time" VARCHAR(5),
    "custom_end_time" VARCHAR(5),
    "custom_capacity" INTEGER,
    "reason" VARCHAR(255),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: bookings
CREATE UNIQUE INDEX "bookings_store_id_booking_number_key" ON "bookings"("store_id", "booking_number");
CREATE INDEX "bookings_store_id_date_idx" ON "bookings"("store_id", "date");
CREATE INDEX "bookings_store_id_status_idx" ON "bookings"("store_id", "status");
CREATE INDEX "bookings_store_id_product_id_date_idx" ON "bookings"("store_id", "product_id", "date");
CREATE INDEX "bookings_customer_id_idx" ON "bookings"("customer_id");
CREATE UNIQUE INDEX "bookings_order_id_key" ON "bookings"("order_id");

-- CreateIndex: service_schedules
CREATE UNIQUE INDEX "service_schedules_store_id_product_id_day_of_week_key" ON "service_schedules"("store_id", "product_id", "day_of_week");
CREATE INDEX "service_schedules_store_id_idx" ON "service_schedules"("store_id");
CREATE INDEX "service_schedules_product_id_idx" ON "service_schedules"("product_id");

-- CreateIndex: schedule_exceptions
CREATE INDEX "schedule_exceptions_store_id_date_idx" ON "schedule_exceptions"("store_id", "date");
CREATE INDEX "schedule_exceptions_product_id_idx" ON "schedule_exceptions"("product_id");

-- AddForeignKey: bookings
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: service_schedules
ALTER TABLE "service_schedules" ADD CONSTRAINT "service_schedules_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_schedules" ADD CONSTRAINT "service_schedules_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: schedule_exceptions
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
