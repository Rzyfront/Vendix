-- CreateTable
CREATE TABLE "pos_customers" (
    "id" SERIAL NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100),
    "email" VARCHAR(255) NOT NULL,
    "document_type" VARCHAR(50) NOT NULL,
    "document_number" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pos_customers_email_key" ON "pos_customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "pos_customers_document_number_key" ON "pos_customers"("document_number");

-- CreateIndex
CREATE INDEX "pos_customers_email_idx" ON "pos_customers"("email");

-- CreateIndex
CREATE INDEX "pos_customers_document_number_idx" ON "pos_customers"("document_number");
