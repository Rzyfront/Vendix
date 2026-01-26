-- CreateUniqueIndex
CREATE UNIQUE INDEX "idx_domain_settings_store_active_type" ON "domain_settings"("store_id", "domain_type") WHERE "status" = 'active' AND "store_id" IS NOT NULL;

-- CreateUniqueIndex
CREATE UNIQUE INDEX "idx_domain_settings_org_active_type" ON "domain_settings"("organization_id", "domain_type") WHERE "status" = 'active' AND "organization_id" IS NOT NULL;
