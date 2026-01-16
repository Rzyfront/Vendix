-- CreateEnum
CREATE TYPE "template_config_type_enum" AS ENUM ('domain', 'store_settings', 'ecommerce', 'payment_methods', 'shipping', 'tax', 'email', 'notifications');

-- CreateTable
CREATE TABLE "default_templates" (
    "id" SERIAL NOT NULL,
    "template_name" VARCHAR(255) NOT NULL,
    "configuration_type" "template_config_type_enum" NOT NULL,
    "template_data" JSONB NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "default_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "default_templates_template_name_key" ON "default_templates"("template_name");

-- CreateIndex
CREATE INDEX "default_templates_configuration_type_idx" ON "default_templates"("configuration_type");

-- CreateIndex
CREATE INDEX "default_templates_is_active_idx" ON "default_templates"("is_active");

-- CreateIndex
CREATE INDEX "default_templates_is_system_idx" ON "default_templates"("is_system");
