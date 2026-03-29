-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_engine_logs" (
    "id" SERIAL NOT NULL,
    "request_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "app_key" VARCHAR(100),
    "config_id" INTEGER,
    "organization_id" INTEGER,
    "store_id" INTEGER,
    "user_id" INTEGER,
    "model" VARCHAR(100),
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,8) NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'success',
    "error_message" TEXT,
    "input_preview" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_engine_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_engine_logs_organization_id_idx" ON "ai_engine_logs"("organization_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_engine_logs_store_id_idx" ON "ai_engine_logs"("store_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_engine_logs_app_key_idx" ON "ai_engine_logs"("app_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_engine_logs_created_at_idx" ON "ai_engine_logs"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_engine_logs_config_id_idx" ON "ai_engine_logs"("config_id");

-- AddForeignKey
ALTER TABLE "ai_engine_logs" ADD CONSTRAINT "ai_engine_logs_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "ai_engine_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
