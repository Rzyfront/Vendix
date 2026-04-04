-- CreateEnum
CREATE TYPE "payment_link_status_enum" AS ENUM ('active', 'expired', 'paid', 'cancelled');

-- CreateTable
CREATE TABLE "payment_links" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "wompi_link_id" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "amount_in_cents" INTEGER,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'COP',
    "single_use" BOOLEAN NOT NULL DEFAULT true,
    "collect_shipping" BOOLEAN NOT NULL DEFAULT false,
    "checkout_url" TEXT NOT NULL,
    "status" "payment_link_status_enum" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(6),
    "redirect_url" TEXT,
    "image_url" TEXT,
    "sku" VARCHAR(36),
    "order_id" INTEGER,
    "wompi_response" JSONB,
    "transaction_id" VARCHAR(255),
    "paid_at" TIMESTAMP(6),
    "created_by" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_wompi_link_id_key" ON "payment_links"("wompi_link_id");

-- CreateIndex
CREATE INDEX "payment_links_store_id_status_idx" ON "payment_links"("store_id", "status");

-- CreateIndex
CREATE INDEX "payment_links_store_id_created_at_idx" ON "payment_links"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_links_wompi_link_id_idx" ON "payment_links"("wompi_link_id");

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
