-- AlterEnum
ALTER TYPE "payments_state_enum" ADD VALUE 'cancelled';

-- DropIndex
DROP INDEX "idx_domain_settings_org_active_app_type";

-- DropIndex
DROP INDEX "idx_domain_settings_store_active_app_type";

-- DropIndex
DROP INDEX "idx_domain_settings_store_active_type";
