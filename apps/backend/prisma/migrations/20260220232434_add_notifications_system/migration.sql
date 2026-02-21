-- CreateEnum
CREATE TYPE "notification_type_enum" AS ENUM ('new_order', 'order_status_change', 'low_stock', 'new_customer', 'payment_received');

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "type" "notification_type_enum" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_subscriptions" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" "notification_type_enum" NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_store_id_idx" ON "notifications"("store_id");

-- CreateIndex
CREATE INDEX "notifications_store_id_is_read_idx" ON "notifications"("store_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_store_id_created_at_idx" ON "notifications"("store_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_subscriptions_store_id_user_id_idx" ON "notification_subscriptions"("store_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_subscriptions_store_id_user_id_type_key" ON "notification_subscriptions"("store_id", "user_id", "type");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
