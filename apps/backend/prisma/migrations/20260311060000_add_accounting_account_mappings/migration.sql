-- CreateTable
CREATE TABLE "accounting_account_mappings" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "mapping_key" VARCHAR(100) NOT NULL,
    "account_id" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_account_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "accounting_account_mappings_organization_id_store_id_idx" ON "accounting_account_mappings"("organization_id", "store_id");

-- CreateUniqueIndex
CREATE UNIQUE INDEX IF NOT EXISTS "accounting_account_mappings_organization_id_store_id_mapping_key" ON "accounting_account_mappings"("organization_id", "store_id", "mapping_key");

-- AddForeignKey
ALTER TABLE "accounting_account_mappings" ADD CONSTRAINT "accounting_account_mappings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_account_mappings" ADD CONSTRAINT "accounting_account_mappings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_account_mappings" ADD CONSTRAINT "accounting_account_mappings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterEnum (idempotent)
ALTER TYPE "accounting_entry_type_enum" ADD VALUE IF NOT EXISTS 'auto_purchase';
ALTER TYPE "accounting_entry_type_enum" ADD VALUE IF NOT EXISTS 'auto_return';
