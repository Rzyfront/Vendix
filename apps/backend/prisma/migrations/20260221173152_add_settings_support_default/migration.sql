-- Migration: Add settings_support to default template and existing users
-- Purpose: Ensure all users have access to the support module in their panel_ui

-- Update the default template to include settings_support for STORE_ADMIN
UPDATE default_templates
SET template_data = jsonb_set(
  template_data,
  '{panel_ui,STORE_ADMIN,settings_support}',
  'true'::jsonb
)
WHERE template_name = 'user_settings_default';

-- Update existing user_settings to include settings_support for STORE_ADMIN
-- Only if the user has panel_ui for STORE_ADMIN and doesn't have settings_support yet
UPDATE user_settings
SET config = jsonb_set(
  config,
  '{panel_ui,STORE_ADMIN,settings_support}',
  'true'::jsonb
)
WHERE config->'panel_ui' ? 'STORE_ADMIN'
  AND config->'panel_ui'->'STORE_ADMIN' IS NOT NULL
  AND NOT (config->'panel_ui'->'STORE_ADMIN' ? 'settings_support');
