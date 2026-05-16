-- Update panel_ui JSON: replace analytics_traffic/performance with analytics_purchases/reviews
-- This migration ensures existing tenants get the new analytics keys

-- Store settings
UPDATE store_settings
SET panel_ui = jsonb_build_object(
    'analytics', COALESCE((panel_ui->>'analytics')::boolean, true),
    'analytics_overview', COALESCE((panel_ui->>'analytics_overview')::boolean, true),
    'analytics_sales', COALESCE((panel_ui->>'analytics_sales')::boolean, true),
    'analytics_purchases', COALESCE((panel_ui->>'analytics_traffic')::boolean, true),
    'analytics_reviews', COALESCE((panel_ui->>'analytics_performance')::boolean, true),
    'analytics_inventory', COALESCE((panel_ui->>'analytics_inventory')::boolean, true),
    'analytics_products', COALESCE((panel_ui->>'analytics_products')::boolean, true),
    'analytics_customers', COALESCE((panel_ui->>'analytics_customers')::boolean, true),
    'analytics_financial', COALESCE((panel_ui->>'analytics_financial')::boolean, true)
)
WHERE panel_ui ? 'analytics_traffic' OR panel_ui ? 'analytics_performance';

-- Organization settings
UPDATE organization_settings
SET panel_ui = jsonb_build_object(
    'analytics', COALESCE((panel_ui->>'analytics')::boolean, true),
    'analytics_overview', COALESCE((panel_ui->>'analytics_overview')::boolean, true),
    'analytics_sales', COALESCE((panel_ui->>'analytics_sales')::boolean, true),
    'analytics_purchases', COALESCE((panel_ui->>'analytics_traffic')::boolean, true),
    'analytics_reviews', COALESCE((panel_ui->>'analytics_performance')::boolean, true),
    'analytics_inventory', COALESCE((panel_ui->>'analytics_inventory')::boolean, true),
    'analytics_products', COALESCE((panel_ui->>'analytics_products')::boolean, true),
    'analytics_customers', COALESCE((panel_ui->>'analytics_customers')::boolean, true),
    'analytics_financial', COALESCE((panel_ui->>'analytics_financial')::boolean, true)
)
WHERE panel_ui ? 'analytics_traffic' OR panel_ui ? 'analytics_performance';