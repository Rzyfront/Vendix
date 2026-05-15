-- DATA IMPACT:
-- Tables affected: domain_roots, domain_settings
-- Expected row changes: none
-- Destructive operations: none
-- FK/cascade risk: domain_settings.domain_root_id uses ON DELETE SET NULL; root deletion does not delete assignments.
-- Idempotency: guarded CREATE TABLE/ALTER TABLE/CREATE INDEX statements.
-- Approval: requested by the custom domain SaaS multi-tenant implementation plan.

CREATE TABLE IF NOT EXISTS "domain_roots" (
  "id" SERIAL PRIMARY KEY,
  "hostname" VARCHAR(255) NOT NULL,
  "organization_id" INTEGER,
  "store_id" INTEGER,
  "status" "domain_status_enum" NOT NULL DEFAULT 'pending_ownership',
  "ssl_status" "ssl_status_enum" NOT NULL DEFAULT 'pending',
  "verification_token" VARCHAR(100),
  "last_verified_at" TIMESTAMP(6),
  "expires_token_at" TIMESTAMPTZ(6),
  "validation_cname_name" VARCHAR(255),
  "validation_cname_value" VARCHAR(255),
  "acm_certificate_arn" VARCHAR(2048),
  "certificate_requested_at" TIMESTAMPTZ(6),
  "certificate_issued_at" TIMESTAMPTZ(6),
  "cert_expires_at" TIMESTAMPTZ(6),
  "cloudfront_saas_distribution_id" VARCHAR(80),
  "cloudfront_saas_connection_group_id" VARCHAR(80),
  "cloudfront_distribution_tenant_id" VARCHAR(120),
  "cloudfront_distribution_tenant_arn" VARCHAR(2048),
  "cloudfront_distribution_tenant_status" VARCHAR(80),
  "cloudfront_distribution_tenant_etag" VARCHAR(255),
  "routing_endpoint" VARCHAR(255),
  "cloudfront_deployed_at" TIMESTAMPTZ(6),
  "config" JSONB DEFAULT '{}',
  "last_error" VARCHAR(255),
  "last_error_code" VARCHAR(80),
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "domain_roots_hostname_key" ON "domain_roots"("hostname");
CREATE UNIQUE INDEX IF NOT EXISTS "domain_roots_verification_token_key" ON "domain_roots"("verification_token");
CREATE INDEX IF NOT EXISTS "domain_roots_organization_id_idx" ON "domain_roots"("organization_id");
CREATE INDEX IF NOT EXISTS "domain_roots_store_id_idx" ON "domain_roots"("store_id");
CREATE INDEX IF NOT EXISTS "domain_roots_status_idx" ON "domain_roots"("status");
CREATE INDEX IF NOT EXISTS "domain_roots_ssl_status_idx" ON "domain_roots"("ssl_status");
CREATE INDEX IF NOT EXISTS "domain_roots_cloudfront_distribution_tenant_id_idx" ON "domain_roots"("cloudfront_distribution_tenant_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'domain_roots_organization_id_fkey'
  ) THEN
    ALTER TABLE "domain_roots"
      ADD CONSTRAINT "domain_roots_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'domain_roots_store_id_fkey'
  ) THEN
    ALTER TABLE "domain_roots"
      ADD CONSTRAINT "domain_roots_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "domain_settings"
  ADD COLUMN IF NOT EXISTS "domain_root_id" INTEGER;

CREATE INDEX IF NOT EXISTS "domain_settings_domain_root_id_idx" ON "domain_settings"("domain_root_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'domain_settings_domain_root_id_fkey'
  ) THEN
    ALTER TABLE "domain_settings"
      ADD CONSTRAINT "domain_settings_domain_root_id_fkey"
      FOREIGN KEY ("domain_root_id") REFERENCES "domain_roots"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
