-- CreateEnum
CREATE TYPE "app_type_enum" AS ENUM ('VENDIX_LANDING', 'VENDIX_ADMIN', 'ORG_LANDING', 'ORG_ADMIN', 'STORE_LANDING', 'STORE_ADMIN', 'STORE_ECOMMERCE');

-- AlterTable
ALTER TABLE "domain_settings" ADD COLUMN     "app_type" "app_type_enum" NOT NULL DEFAULT 'VENDIX_LANDING',
ALTER COLUMN "config" DROP NOT NULL,
ALTER COLUMN "config" SET DEFAULT '{}';

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "app_type" "app_type_enum" NOT NULL DEFAULT 'STORE_ADMIN',
ALTER COLUMN "config" DROP NOT NULL,
ALTER COLUMN "config" SET DEFAULT '{}';

-- Set default value for config if null
UPDATE "domain_settings" SET "config" = '{}' WHERE "config" IS NULL;
UPDATE "user_settings" SET "config" = '{}' WHERE "config" IS NULL;

-- Migrate existing data: Copy config.app to app_type
UPDATE "domain_settings"
SET "app_type" = CASE
    WHEN config->>'app' = 'VENDIX_LANDING' THEN 'VENDIX_LANDING'::app_type_enum
    WHEN config->>'app' = 'VENDIX_ADMIN' THEN 'VENDIX_ADMIN'::app_type_enum
    WHEN config->>'app' = 'ORG_LANDING' THEN 'ORG_LANDING'::app_type_enum
    WHEN config->>'app' = 'ORG_ADMIN' THEN 'ORG_ADMIN'::app_type_enum
    WHEN config->>'app' = 'STORE_LANDING' THEN 'STORE_LANDING'::app_type_enum
    WHEN config->>'app' = 'STORE_ADMIN' THEN 'STORE_ADMIN'::app_type_enum
    WHEN config->>'app' = 'STORE_ECOMMERCE' THEN 'STORE_ECOMMERCE'::app_type_enum
    -- Fallback based on domain_type for domains without config.app
    WHEN "domain_type" = 'vendix_core' THEN 'VENDIX_LANDING'::app_type_enum
    WHEN "domain_type" = 'organization' THEN 'ORG_LANDING'::app_type_enum
    WHEN "domain_type" = 'store' THEN 'STORE_ADMIN'::app_type_enum
    WHEN "domain_type" = 'ecommerce' THEN 'STORE_ECOMMERCE'::app_type_enum
    ELSE 'VENDIX_LANDING'::app_type_enum
END
WHERE "app_type" IS NULL OR "app_type" = 'VENDIX_LANDING'::app_type_enum;

-- Migrate existing user_settings data
UPDATE "user_settings"
SET "app_type" = CASE
    WHEN config->>'app' = 'VENDIX_LANDING' THEN 'VENDIX_LANDING'::app_type_enum
    WHEN config->>'app' = 'VENDIX_ADMIN' THEN 'VENDIX_ADMIN'::app_type_enum
    WHEN config->>'app' = 'ORG_LANDING' THEN 'ORG_LANDING'::app_type_enum
    WHEN config->>'app' = 'ORG_ADMIN' THEN 'ORG_ADMIN'::app_type_enum
    WHEN config->>'app' = 'STORE_LANDING' THEN 'STORE_LANDING'::app_type_enum
    WHEN config->>'app' = 'STORE_ADMIN' THEN 'STORE_ADMIN'::app_type_enum
    WHEN config->>'app' = 'STORE_ECOMMERCE' THEN 'STORE_ECOMMERCE'::app_type_enum
    ELSE 'STORE_ADMIN'::app_type_enum
END
WHERE "app_type" IS NULL OR "app_type" = 'STORE_ADMIN'::app_type_enum;

-- CreateIndex
CREATE INDEX "domain_settings_app_type_idx" ON "domain_settings"("app_type");

-- CreateIndex
CREATE INDEX "user_settings_app_type_idx" ON "user_settings"("app_type");
