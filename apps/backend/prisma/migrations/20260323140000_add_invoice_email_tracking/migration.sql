-- AlterTable: Add email tracking to invoices
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "email_sent_at" TIMESTAMP(6);

-- CreateTable: Invoice retry queue for failed DIAN submissions
CREATE TABLE IF NOT EXISTS "invoice_retry_queue" (
    "id" SERIAL NOT NULL,
    "org_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "last_error" TEXT,
    "next_retry_at" TIMESTAMP(6) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "invoice_retry_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoice_retry_queue_status_next_retry_at_idx" ON "invoice_retry_queue"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoice_retry_queue_invoice_id_idx" ON "invoice_retry_queue"("invoice_id");

-- AddForeignKey
ALTER TABLE "invoice_retry_queue" DROP CONSTRAINT IF EXISTS "invoice_retry_queue_invoice_id_fkey";
ALTER TABLE "invoice_retry_queue" ADD CONSTRAINT "invoice_retry_queue_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_retry_queue" DROP CONSTRAINT IF EXISTS "invoice_retry_queue_org_id_fkey";
ALTER TABLE "invoice_retry_queue" ADD CONSTRAINT "invoice_retry_queue_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_retry_queue" DROP CONSTRAINT IF EXISTS "invoice_retry_queue_store_id_fkey";
ALTER TABLE "invoice_retry_queue" ADD CONSTRAINT "invoice_retry_queue_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
