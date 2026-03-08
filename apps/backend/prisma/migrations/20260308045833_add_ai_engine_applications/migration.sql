-- CreateTable
CREATE TABLE "ai_engine_applications" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "config_id" INTEGER,
    "system_prompt" TEXT,
    "prompt_template" TEXT,
    "temperature" DECIMAL(3,2),
    "max_tokens" INTEGER,
    "output_format" VARCHAR(50) NOT NULL DEFAULT 'text',
    "rate_limit" JSONB,
    "retry_config" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_engine_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_engine_applications_key_key" ON "ai_engine_applications"("key");

-- CreateIndex
CREATE INDEX "ai_engine_applications_config_id_idx" ON "ai_engine_applications"("config_id");

-- AddForeignKey
ALTER TABLE "ai_engine_applications" ADD CONSTRAINT "ai_engine_applications_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "ai_engine_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
