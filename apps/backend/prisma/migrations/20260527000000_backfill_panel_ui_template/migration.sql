-- Migration: Backfill panel_ui keys into user_settings_default template
--
-- DATA IMPACT:
--   Tables affected: default_templates (UPDATE only, no row creates/deletes)
--   Rows affected:    1 row (where template_name='user_settings_default'
--                     AND is_active=true AND configuration_type='user_settings')
--   Operation:        JSONB merge (||) on template_data->panel_ui->{app_type}
--   Idempotent:       YES. Re-running re-applies the same key=true values;
--                     the `||` operator overwrites only the listed keys and
--                     never removes existing keys.
--   Destructive:      NO. We never DELETE / TRUNCATE / DROP, and never replace
--                     the parent objects with `false=create_missing`. We use
--                     jsonb_set with COALESCE so missing parents are
--                     initialized to '{}' before merging.
--   Why:              17 panel_ui keys exist in PANEL_UI_FALLBACK (hardcoded
--                     in default-panel-ui.service.ts) but were never seeded
--                     into the unified template, so MenuFilterService hid
--                     those modules for every user in production.
--                     Layer 1 (getUnifiedTemplate auto-merge) prevents this
--                     class of bug going forward; this migration aligns
--                     existing DB state so super-admin UI shows the same set.
--
-- Keys backfilled:
--   STORE_ADMIN (10): settings_price_tiers, marketing_anuncios,
--     marketing_social_sales, products_brands, products_categories,
--     products_list, settings_application, settings_operations,
--     settings_payment_methods, settings_fiscal_scope
--   ORG_ADMIN (8): audit, domains, stores, users, settings_application,
--     settings_operations, settings_payment_methods, settings_fiscal_scope
--   STORE_ECOMMERCE (3): favorites, history, profile

BEGIN;

-- 1. STORE_ADMIN: merge 10 keys into template_data->'panel_ui'->'STORE_ADMIN'
UPDATE default_templates
SET template_data = jsonb_set(
    template_data,
    '{panel_ui,STORE_ADMIN}',
    COALESCE(template_data->'panel_ui'->'STORE_ADMIN', '{}'::jsonb) || '{
      "settings_price_tiers": true,
      "marketing_anuncios": true,
      "marketing_social_sales": true,
      "products_brands": true,
      "products_categories": true,
      "products_list": true,
      "settings_application": true,
      "settings_operations": true,
      "settings_payment_methods": true,
      "settings_fiscal_scope": true
    }'::jsonb,
    true
)
WHERE template_name = 'user_settings_default'
  AND configuration_type = 'user_settings'
  AND is_active = true;

-- 2. ORG_ADMIN: merge 8 keys into template_data->'panel_ui'->'ORG_ADMIN'
UPDATE default_templates
SET template_data = jsonb_set(
    template_data,
    '{panel_ui,ORG_ADMIN}',
    COALESCE(template_data->'panel_ui'->'ORG_ADMIN', '{}'::jsonb) || '{
      "audit": true,
      "domains": true,
      "stores": true,
      "users": true,
      "settings_application": true,
      "settings_operations": true,
      "settings_payment_methods": true,
      "settings_fiscal_scope": true
    }'::jsonb,
    true
)
WHERE template_name = 'user_settings_default'
  AND configuration_type = 'user_settings'
  AND is_active = true;

-- 3. STORE_ECOMMERCE: merge 3 keys into template_data->'panel_ui'->'STORE_ECOMMERCE'
UPDATE default_templates
SET template_data = jsonb_set(
    template_data,
    '{panel_ui,STORE_ECOMMERCE}',
    COALESCE(template_data->'panel_ui'->'STORE_ECOMMERCE', '{}'::jsonb) || '{
      "favorites": true,
      "history": true,
      "profile": true
    }'::jsonb,
    true
)
WHERE template_name = 'user_settings_default'
  AND configuration_type = 'user_settings'
  AND is_active = true;

COMMIT;
