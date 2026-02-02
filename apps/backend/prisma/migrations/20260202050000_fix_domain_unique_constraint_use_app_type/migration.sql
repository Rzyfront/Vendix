-- Drop the old constraint that uses domain_type
DROP INDEX IF EXISTS "idx_domain_settings_org_active_type";

-- Create new constraint using app_type (the new source of truth)
-- This allows multiple domains per org with different app_types (e.g., ORG_LANDING and ORG_ADMIN)
CREATE UNIQUE INDEX "idx_domain_settings_org_active_app_type" ON "domain_settings"("organization_id", "app_type") WHERE "status" = 'active' AND "organization_id" IS NOT NULL;

-- Also add similar constraint for store domains
CREATE UNIQUE INDEX "idx_domain_settings_store_active_app_type" ON "domain_settings"("store_id", "app_type") WHERE "status" = 'active' AND "store_id" IS NOT NULL;
