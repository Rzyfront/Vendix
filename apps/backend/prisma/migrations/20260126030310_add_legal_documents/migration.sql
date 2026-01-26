-- CreateEnum
CREATE TYPE "legal_document_type_enum" AS ENUM ('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'REFUND_POLICY', 'SHIPPING_POLICY', 'RETURN_POLICY', 'COOKIES_POLICY', 'MERCHANT_AGREEMENT');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "requires_terms_update" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "terms_accepted_at" TIMESTAMP(6),
ADD COLUMN     "terms_accepted_version" VARCHAR(20);

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" SERIAL NOT NULL,
    "document_type" "legal_document_type_enum" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "description" TEXT,
    "effective_date" TIMESTAMP(6) NOT NULL,
    "expiry_date" TIMESTAMP(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "document_url" TEXT,
    "organization_id" INTEGER,
    "store_id" INTEGER,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_acceptances" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "document_id" INTEGER NOT NULL,
    "acceptance_version" VARCHAR(20) NOT NULL,
    "accepted_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_by_user_id" INTEGER,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "metadata" JSONB,

    CONSTRAINT "document_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_version_key" ON "legal_documents"("version");

-- CreateIndex
CREATE INDEX "legal_documents_document_type_is_active_idx" ON "legal_documents"("document_type", "is_active");

-- CreateIndex
CREATE INDEX "legal_documents_effective_date_idx" ON "legal_documents"("effective_date");

-- CreateIndex
CREATE INDEX "legal_documents_organization_id_idx" ON "legal_documents"("organization_id");

-- CreateIndex
CREATE INDEX "legal_documents_store_id_idx" ON "legal_documents"("store_id");

-- CreateIndex
CREATE INDEX "legal_documents_document_type_organization_id_is_active_idx" ON "legal_documents"("document_type", "organization_id", "is_active");

-- CreateIndex
CREATE INDEX "legal_documents_document_type_store_id_is_active_idx" ON "legal_documents"("document_type", "store_id", "is_active");

-- CreateIndex
CREATE INDEX "document_acceptances_user_id_idx" ON "document_acceptances"("user_id");

-- CreateIndex
CREATE INDEX "document_acceptances_document_id_accepted_at_idx" ON "document_acceptances"("document_id", "accepted_at");

-- CreateIndex
CREATE INDEX "document_acceptances_accepted_at_idx" ON "document_acceptances"("accepted_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_acceptances_user_id_document_id_acceptance_version_key" ON "document_acceptances"("user_id", "document_id", "acceptance_version");

-- CreateIndex
CREATE INDEX "users_requires_terms_update_idx" ON "users"("requires_terms_update");

-- AddForeignKey
ALTER TABLE "document_acceptances" ADD CONSTRAINT "document_acceptances_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "legal_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_acceptances" ADD CONSTRAINT "document_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
