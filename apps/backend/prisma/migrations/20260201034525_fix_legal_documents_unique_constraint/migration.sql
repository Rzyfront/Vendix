/*
  Warnings:

  - A unique constraint covering the columns `[version,store_id,organization_id,document_type]` on the table `legal_documents` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "legal_documents_version_key";

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_version_store_id_organization_id_document_t_key" ON "legal_documents"("version", "store_id", "organization_id", "document_type");
