-- CreateEnum
CREATE TYPE "customer_queue_status_enum" AS ENUM ('waiting', 'selected', 'consumed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "invoice_data_request_status_enum" AS ENUM ('pending', 'submitted', 'processing', 'completed', 'expired', 'failed');

-- AlterEnum
ALTER TYPE "notification_type_enum" ADD VALUE 'customer_queue_new';
ALTER TYPE "notification_type_enum" ADD VALUE 'customer_queue_selected';
ALTER TYPE "notification_type_enum" ADD VALUE 'customer_queue_consumed';
ALTER TYPE "notification_type_enum" ADD VALUE 'customer_queue_cancelled';
ALTER TYPE "notification_type_enum" ADD VALUE 'customer_queue_released';

-- CreateTable
CREATE TABLE "customer_queue" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "document_type" VARCHAR(50) NOT NULL,
    "document_number" VARCHAR(50) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "status" "customer_queue_status_enum" NOT NULL DEFAULT 'waiting',
    "position" INTEGER NOT NULL,
    "selected_by" INTEGER,
    "consumed_at" TIMESTAMP(6),
    "order_id" INTEGER,
    "customer_id" INTEGER,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_data_requests" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "order_id" INTEGER NOT NULL,
    "invoice_id" INTEGER,
    "token" VARCHAR(64) NOT NULL,
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "document_type" VARCHAR(50),
    "document_number" VARCHAR(50),
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "status" "invoice_data_request_status_enum" NOT NULL DEFAULT 'pending',
    "submitted_at" TIMESTAMP(6),
    "processed_at" TIMESTAMP(6),
    "new_invoice_id" INTEGER,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_data_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (customer_queue)
CREATE UNIQUE INDEX "customer_queue_token_key" ON "customer_queue"("token");
CREATE INDEX "customer_queue_store_id_status_idx" ON "customer_queue"("store_id", "status");
CREATE INDEX "customer_queue_store_id_document_number_idx" ON "customer_queue"("store_id", "document_number");
CREATE INDEX "customer_queue_expires_at_idx" ON "customer_queue"("expires_at");

-- CreateIndex (invoice_data_requests)
CREATE UNIQUE INDEX "invoice_data_requests_token_key" ON "invoice_data_requests"("token");
CREATE INDEX "invoice_data_requests_store_id_status_idx" ON "invoice_data_requests"("store_id", "status");
CREATE INDEX "invoice_data_requests_order_id_idx" ON "invoice_data_requests"("order_id");
CREATE INDEX "invoice_data_requests_expires_at_idx" ON "invoice_data_requests"("expires_at");

-- AddForeignKey
ALTER TABLE "customer_queue" ADD CONSTRAINT "customer_queue_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_data_requests" ADD CONSTRAINT "invoice_data_requests_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_data_requests" ADD CONSTRAINT "invoice_data_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
