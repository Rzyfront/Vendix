-- CreateEnum
CREATE TYPE "domain_type_enum" AS ENUM ('vendix_core', 'organization_root', 'organization_subdomain', 'store_subdomain', 'store_custom');

-- CreateEnum
CREATE TYPE "domain_purpose_enum" AS ENUM ('landing', 'admin', 'ecommerce', 'api');

-- CreateTable
CREATE TABLE "domain_settings" (
    "id" SERIAL NOT NULL,
    "hostname" VARCHAR(255) NOT NULL,
    "domain_type" "domain_type_enum" NOT NULL,
    "purpose" "domain_purpose_enum" NOT NULL,
    "organization_id" INTEGER,
    "store_id" INTEGER,
    "config" JSONB,
    "environment_config" JSONB,
    "ssl_enabled" BOOLEAN NOT NULL DEFAULT false,
    "ssl_certificate" TEXT,
    "force_https" BOOLEAN NOT NULL DEFAULT true,
    "cache_ttl" INTEGER NOT NULL DEFAULT 3600,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "verified_at" TIMESTAMP(6),
    "last_checked" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_themes" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "organization_id" INTEGER,
    "store_id" INTEGER,
    "primary_color" VARCHAR(7) NOT NULL,
    "secondary_color" VARCHAR(7) NOT NULL,
    "accent_color" VARCHAR(7) NOT NULL,
    "background_color" VARCHAR(7) NOT NULL,
    "text_color" VARCHAR(7) NOT NULL,
    "font_family" VARCHAR(255) NOT NULL DEFAULT 'Inter, system-ui, sans-serif',
    "font_headings" VARCHAR(255),
    "border_radius" VARCHAR(20) NOT NULL DEFAULT '0.5rem',
    "spacing_config" JSONB,
    "shadow_config" JSONB,
    "custom_css" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_branding" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER,
    "store_id" INTEGER,
    "logo_url" VARCHAR(500),
    "logo_alt" VARCHAR(255),
    "logo_width" INTEGER,
    "logo_height" INTEGER,
    "favicon_url" VARCHAR(500),
    "brand_name" VARCHAR(255),
    "tagline" VARCHAR(500),
    "colors_override" JSONB,
    "custom_css" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_branding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_seo" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER,
    "store_id" INTEGER,
    "title" VARCHAR(255),
    "description" VARCHAR(500),
    "keywords" TEXT,
    "og_title" VARCHAR(255),
    "og_description" VARCHAR(500),
    "og_image" VARCHAR(500),
    "og_type" VARCHAR(50) DEFAULT 'website',
    "twitter_card" VARCHAR(50) DEFAULT 'summary_large_image',
    "twitter_site" VARCHAR(100),
    "twitter_creator" VARCHAR(100),
    "canonical_url" VARCHAR(500),
    "robots" VARCHAR(100) DEFAULT 'index, follow',
    "schema_markup" JSONB,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_seo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_features" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER,
    "store_id" INTEGER,
    "multi_store" BOOLEAN NOT NULL DEFAULT true,
    "user_management" BOOLEAN NOT NULL DEFAULT true,
    "analytics" BOOLEAN NOT NULL DEFAULT true,
    "custom_domain" BOOLEAN NOT NULL DEFAULT false,
    "white_label" BOOLEAN NOT NULL DEFAULT false,
    "inventory" BOOLEAN NOT NULL DEFAULT true,
    "pos" BOOLEAN NOT NULL DEFAULT true,
    "orders" BOOLEAN NOT NULL DEFAULT true,
    "customers" BOOLEAN NOT NULL DEFAULT true,
    "reports" BOOLEAN NOT NULL DEFAULT true,
    "guest_checkout" BOOLEAN NOT NULL DEFAULT true,
    "wishlist" BOOLEAN NOT NULL DEFAULT true,
    "reviews" BOOLEAN NOT NULL DEFAULT true,
    "coupons" BOOLEAN NOT NULL DEFAULT false,
    "shipping" BOOLEAN NOT NULL DEFAULT true,
    "payments" BOOLEAN NOT NULL DEFAULT true,
    "api_access" BOOLEAN NOT NULL DEFAULT false,
    "webhooks" BOOLEAN NOT NULL DEFAULT false,
    "custom_themes" BOOLEAN NOT NULL DEFAULT false,
    "advanced_analytics" BOOLEAN NOT NULL DEFAULT false,
    "max_products" INTEGER,
    "max_orders" INTEGER,
    "max_storage_mb" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_features_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "domain_settings_hostname_key" ON "domain_settings"("hostname");

-- CreateIndex
CREATE INDEX "domain_settings_hostname_idx" ON "domain_settings"("hostname");

-- CreateIndex
CREATE INDEX "domain_settings_organization_id_idx" ON "domain_settings"("organization_id");

-- CreateIndex
CREATE INDEX "domain_settings_store_id_idx" ON "domain_settings"("store_id");

-- CreateIndex
CREATE INDEX "domain_settings_is_active_idx" ON "domain_settings"("is_active");

-- CreateIndex
CREATE INDEX "domain_settings_domain_type_purpose_idx" ON "domain_settings"("domain_type", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_themes_organization_id_name_key" ON "tenant_themes"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_themes_store_id_name_key" ON "tenant_themes"("store_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_branding_organization_id_key" ON "tenant_branding"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_branding_store_id_key" ON "tenant_branding"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_seo_organization_id_key" ON "tenant_seo"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_seo_store_id_key" ON "tenant_seo"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_features_organization_id_key" ON "tenant_features"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_features_store_id_key" ON "tenant_features"("store_id");

-- AddForeignKey
ALTER TABLE "domain_settings" ADD CONSTRAINT "domain_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_settings" ADD CONSTRAINT "domain_settings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_themes" ADD CONSTRAINT "tenant_themes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_themes" ADD CONSTRAINT "tenant_themes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_seo" ADD CONSTRAINT "tenant_seo_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_seo" ADD CONSTRAINT "tenant_seo_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_features" ADD CONSTRAINT "tenant_features_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_features" ADD CONSTRAINT "tenant_features_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
