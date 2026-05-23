-- DATA IMPACT:
-- Tables affected: store_settings, organization_settings
-- Expected row changes: rename legacy panel_ui keys (analytics_traffic/performance)
--                      to new keys (analytics_purchases/reviews) inside settings JSON
-- Destructive operations: none (jsonb_set preserves other keys)
-- FK/cascade risk: none
-- Idempotency: WHERE clause checks for legacy keys; safe to re-run
-- NOTE: original migration referenced a non-existent top-level `panel_ui` column.
--       panel_ui is a nested key inside settings JSON. Corrected before any environment applied.

UPDATE store_settings
SET settings = jsonb_set(
    COALESCE(settings, '{}'::jsonb),
    '{panel_ui}',
    jsonb_build_object(
        'analytics', COALESCE((settings->'panel_ui'->>'analytics')::boolean, true),
        'analytics_overview', COALESCE((settings->'panel_ui'->>'analytics_overview')::boolean, true),
        'analytics_sales', COALESCE((settings->'panel_ui'->>'analytics_sales')::boolean, true),
        'analytics_purchases', COALESCE((settings->'panel_ui'->>'analytics_traffic')::boolean, true),
        'analytics_reviews', COALESCE((settings->'panel_ui'->>'analytics_performance')::boolean, true),
        'analytics_inventory', COALESCE((settings->'panel_ui'->>'analytics_inventory')::boolean, true),
        'analytics_products', COALESCE((settings->'panel_ui'->>'analytics_products')::boolean, true),
        'analytics_customers', COALESCE((settings->'panel_ui'->>'analytics_customers')::boolean, true),
        'analytics_financial', COALESCE((settings->'panel_ui'->>'analytics_financial')::boolean, true)
    )
)
WHERE settings IS NOT NULL
  AND (settings->'panel_ui' ? 'analytics_traffic' OR settings->'panel_ui' ? 'analytics_performance');

UPDATE organization_settings
SET settings = jsonb_set(
    COALESCE(settings, '{}'::jsonb),
    '{panel_ui}',
    jsonb_build_object(
        'analytics', COALESCE((settings->'panel_ui'->>'analytics')::boolean, true),
        'analytics_overview', COALESCE((settings->'panel_ui'->>'analytics_overview')::boolean, true),
        'analytics_sales', COALESCE((settings->'panel_ui'->>'analytics_sales')::boolean, true),
        'analytics_purchases', COALESCE((settings->'panel_ui'->>'analytics_traffic')::boolean, true),
        'analytics_reviews', COALESCE((settings->'panel_ui'->>'analytics_performance')::boolean, true),
        'analytics_inventory', COALESCE((settings->'panel_ui'->>'analytics_inventory')::boolean, true),
        'analytics_products', COALESCE((settings->'panel_ui'->>'analytics_products')::boolean, true),
        'analytics_customers', COALESCE((settings->'panel_ui'->>'analytics_customers')::boolean, true),
        'analytics_financial', COALESCE((settings->'panel_ui'->>'analytics_financial')::boolean, true)
    )
)
WHERE settings IS NOT NULL
  AND (settings->'panel_ui' ? 'analytics_traffic' OR settings->'panel_ui' ? 'analytics_performance');
