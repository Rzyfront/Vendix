-- Migration: Remove ghost panel_ui keys that don't correspond to real toggleable modules
-- These keys caused false positive "new module" badges because they existed in defaults
-- but had no corresponding entry in the settings modal (APP_MODULES)

-- 1. Remove ghost expenses sub-keys from default_templates (STORE_ADMIN)
UPDATE default_templates
SET template_data = template_data #- '{panel_ui,STORE_ADMIN,expenses_overview}'
WHERE template_name = 'user_settings_default'
  AND configuration_type = 'user_settings'
  AND template_data->'panel_ui'->'STORE_ADMIN' ? 'expenses_overview';

UPDATE default_templates
SET template_data = template_data #- '{panel_ui,STORE_ADMIN,expenses_all}'
WHERE template_name = 'user_settings_default'
  AND configuration_type = 'user_settings'
  AND template_data->'panel_ui'->'STORE_ADMIN' ? 'expenses_all';

UPDATE default_templates
SET template_data = template_data #- '{panel_ui,STORE_ADMIN,expenses_create}'
WHERE template_name = 'user_settings_default'
  AND configuration_type = 'user_settings'
  AND template_data->'panel_ui'->'STORE_ADMIN' ? 'expenses_create';

UPDATE default_templates
SET template_data = template_data #- '{panel_ui,STORE_ADMIN,expenses_categories}'
WHERE template_name = 'user_settings_default'
  AND configuration_type = 'user_settings'
  AND template_data->'panel_ui'->'STORE_ADMIN' ? 'expenses_categories';

UPDATE default_templates
SET template_data = template_data #- '{panel_ui,STORE_ADMIN,expenses_reports}'
WHERE template_name = 'user_settings_default'
  AND configuration_type = 'user_settings'
  AND template_data->'panel_ui'->'STORE_ADMIN' ? 'expenses_reports';

-- 2. Remove ghost settings_support from default_templates (STORE_ADMIN)
UPDATE default_templates
SET template_data = template_data #- '{panel_ui,STORE_ADMIN,settings_support}'
WHERE template_name = 'user_settings_default'
  AND configuration_type = 'user_settings'
  AND template_data->'panel_ui'->'STORE_ADMIN' ? 'settings_support';

-- 3. Remove the same ghost keys from existing user_settings configs
-- This prevents false positives for users who already had these keys injected
UPDATE user_settings
SET config = config #- '{panel_ui,STORE_ADMIN,expenses_overview}'
WHERE config->'panel_ui'->'STORE_ADMIN' ? 'expenses_overview';

UPDATE user_settings
SET config = config #- '{panel_ui,STORE_ADMIN,expenses_all}'
WHERE config->'panel_ui'->'STORE_ADMIN' ? 'expenses_all';

UPDATE user_settings
SET config = config #- '{panel_ui,STORE_ADMIN,expenses_create}'
WHERE config->'panel_ui'->'STORE_ADMIN' ? 'expenses_create';

UPDATE user_settings
SET config = config #- '{panel_ui,STORE_ADMIN,expenses_categories}'
WHERE config->'panel_ui'->'STORE_ADMIN' ? 'expenses_categories';

UPDATE user_settings
SET config = config #- '{panel_ui,STORE_ADMIN,expenses_reports}'
WHERE config->'panel_ui'->'STORE_ADMIN' ? 'expenses_reports';

UPDATE user_settings
SET config = config #- '{panel_ui,STORE_ADMIN,settings_support}'
WHERE config->'panel_ui'->'STORE_ADMIN' ? 'settings_support';
