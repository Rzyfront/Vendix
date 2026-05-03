-- Domain certificate provisioning metadata.
-- DATA IMPACT: none. Adds nullable columns only; no existing rows are modified.
-- Destructive operations: none.
-- FK/cascade risk: none.

ALTER TABLE "domain_settings"
  ADD COLUMN IF NOT EXISTS "acm_certificate_arn" VARCHAR(2048),
  ADD COLUMN IF NOT EXISTS "certificate_requested_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "certificate_issued_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "cloudfront_distribution_id" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "cloudfront_alias_added_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "cloudfront_deployed_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "idx_domain_settings_acm_certificate_arn"
  ON "domain_settings"("acm_certificate_arn");

CREATE INDEX IF NOT EXISTS "idx_domain_settings_cloudfront_distribution_id"
  ON "domain_settings"("cloudfront_distribution_id");
