-- CreateTable: commission_rules
CREATE TABLE "commission_rules" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "rule_type" VARCHAR(30) NOT NULL,
    "conditions" JSONB NOT NULL,
    "commission_type" VARCHAR(20) NOT NULL,
    "value" DECIMAL(12,4),
    "tiers" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "valid_from" DATE,
    "valid_to" DATE,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable: commission_calculations
CREATE TABLE "commission_calculations" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "commission_rule_id" INTEGER NOT NULL,
    "source_type" VARCHAR(50) NOT NULL,
    "source_id" INTEGER NOT NULL,
    "base_amount" DECIMAL(12,2) NOT NULL,
    "commission_amount" DECIMAL(12,2) NOT NULL,
    "calculation_detail" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_rules_store_id_is_active_idx" ON "commission_rules"("store_id", "is_active");
CREATE INDEX "commission_calculations_store_id_created_at_idx" ON "commission_calculations"("store_id", "created_at");
CREATE INDEX "commission_calculations_source_type_source_id_idx" ON "commission_calculations"("source_type", "source_id");

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_calculations" ADD CONSTRAINT "commission_calculations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_calculations" ADD CONSTRAINT "commission_calculations_commission_rule_id_fkey" FOREIGN KEY ("commission_rule_id") REFERENCES "commission_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
