-- CreateTable
CREATE TABLE "ai_engine_configs" (
    "id" SERIAL NOT NULL,
    "provider" VARCHAR(100) NOT NULL,
    "sdk_type" VARCHAR(50) NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "model_id" VARCHAR(100) NOT NULL,
    "base_url" VARCHAR(500),
    "api_key_ref" VARCHAR(500),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB,
    "last_tested_at" TIMESTAMP(6),
    "last_test_ok" BOOLEAN,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_engine_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_engine_configs_provider_model_id_key" ON "ai_engine_configs"("provider", "model_id");
