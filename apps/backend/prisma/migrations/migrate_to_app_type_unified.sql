-- Migration: migrate_to_app_type_unified
-- Description: Add app_type_enum and app_type columns to domain_settings and user_settings
-- This migration implements the unified app_type standard as the single source of truth

-- ============================================================================
-- 1. Create the new app_type_enum
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_type_enum') THEN
        CREATE TYPE app_type_enum AS ENUM (
            'VENDIX_LANDING',
            'VENDIX_ADMIN',
            'ORG_LANDING',
            'ORG_ADMIN',
            'STORE_LANDING',
            'STORE_ADMIN',
            'STORE_ECOMMERCE'
        );
    END IF;
END$$;

-- ============================================================================
-- 2. Add app_type column to domain_settings
-- ============================================================================
ALTER TABLE domain_settings
ADD COLUMN IF NOT EXISTS app_type app_type_enum DEFAULT 'VENDIX_LANDING';

-- ============================================================================
-- 3. Add app_type column to user_settings
-- ============================================================================
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS app_type app_type_enum DEFAULT 'STORE_ADMIN';

-- ============================================================================
-- 4. Make config column nullable in domain_settings (was required before)
-- ============================================================================
ALTER TABLE domain_settings
ALTER COLUMN config DROP NOT NULL;

-- Set default value for config if null
UPDATE domain_settings SET config = '{}' WHERE config IS NULL;

-- ============================================================================
-- 5. Migrate existing data: Copy config.app to app_type
-- ============================================================================
-- Map existing config.app values to the new app_type column
UPDATE domain_settings
SET app_type = CASE
    WHEN config->>'app' = 'VENDIX_LANDING' THEN 'VENDIX_LANDING'::app_type_enum
    WHEN config->>'app' = 'VENDIX_ADMIN' THEN 'VENDIX_ADMIN'::app_type_enum
    WHEN config->>'app' = 'ORG_LANDING' THEN 'ORG_LANDING'::app_type_enum
    WHEN config->>'app' = 'ORG_ADMIN' THEN 'ORG_ADMIN'::app_type_enum
    WHEN config->>'app' = 'STORE_LANDING' THEN 'STORE_LANDING'::app_type_enum
    WHEN config->>'app' = 'STORE_ADMIN' THEN 'STORE_ADMIN'::app_type_enum
    WHEN config->>'app' = 'STORE_ECOMMERCE' THEN 'STORE_ECOMMERCE'::app_type_enum
    -- Fallback based on domain_type for domains without config.app
    WHEN domain_type = 'vendix_core' THEN 'VENDIX_LANDING'::app_type_enum
    WHEN domain_type = 'organization' THEN 'ORG_LANDING'::app_type_enum
    WHEN domain_type = 'store' THEN 'STORE_ADMIN'::app_type_enum
    WHEN domain_type = 'ecommerce' THEN 'STORE_ECOMMERCE'::app_type_enum
    ELSE 'VENDIX_LANDING'::app_type_enum
END
WHERE app_type IS NULL OR app_type = 'VENDIX_LANDING'::app_type_enum;

-- ============================================================================
-- 6. Add indexes for app_type columns
-- ============================================================================
CREATE INDEX IF NOT EXISTS domain_settings_app_type_idx ON domain_settings(app_type);
CREATE INDEX IF NOT EXISTS user_settings_app_type_idx ON user_settings(app_type);

-- ============================================================================
-- 7. Migration complete - Notes for cleanup (run after verifying everything works)
-- ============================================================================
-- After verifying the migration works correctly, you can:
-- 1. Remove config.app from domain config JSON (no longer needed)
-- 2. Eventually deprecate domain_type_enum (app_type replaces its function)
--
-- DO NOT run these yet - they are for future cleanup:
-- DROP TYPE IF EXISTS domain_type_enum CASCADE;
-- ALTER TABLE domain_settings DROP COLUMN domain_type;
