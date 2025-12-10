-- CreateTable
CREATE TABLE "organization_payment_policies" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "allowed_methods" TEXT[],
    "default_config" JSONB,
    "enforce_policies" BOOLEAN NOT NULL DEFAULT false,
    "allow_store_overrides" BOOLEAN NOT NULL DEFAULT true,
    "min_order_amount" DECIMAL(12,2),
    "max_order_amount" DECIMAL(12,2),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_payment_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_payment_policies_organization_id_key" ON "organization_payment_policies"("organization_id");

-- CreateIndex
CREATE INDEX "organization_payment_policies_organization_id_idx" ON "organization_payment_policies"("organization_id");

-- AddForeignKey
ALTER TABLE "organization_payment_policies" ADD CONSTRAINT "organization_payment_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
