-- QUI-1001 pre-deploy check. READ ONLY: SELECTs only, run manually against prod.
-- Counts stores WITHOUT the restaurant industry that use add-ons (option groups)
-- or scheduled orders today. If any row comes back, warn Rafael before deploying:
-- those stores lose the add-ons selector and the scheduled-orders UI (data stays).
-- "Not restaurant" = 'restaurant' absent from stores.industries (industry_enum[]).

-- 1) One row per affected store, with what it uses.
SELECT
  s.id AS store_id,
  s.name,
  s.industries,
  (SELECT COUNT(*) FROM product_option_groups g
    WHERE g.store_id = s.id AND g.is_active) AS active_option_groups,
  (SELECT COUNT(*) FROM order_fulfillment_schedules f
    WHERE f.store_id = s.id) AS scheduled_orders,
  COALESCE(ss.settings -> 'scheduled_orders' ->> 'enabled', 'false') AS scheduled_orders_setting_enabled,
  COALESCE(ss.settings -> 'product_options' ->> 'enabled', 'false') AS product_options_setting_enabled
FROM stores s
LEFT JOIN store_settings ss ON ss.store_id = s.id
WHERE NOT ('restaurant' = ANY (s.industries))
  AND (
    EXISTS (SELECT 1 FROM product_option_groups g WHERE g.store_id = s.id AND g.is_active)
    OR EXISTS (SELECT 1 FROM order_fulfillment_schedules f WHERE f.store_id = s.id)
    OR COALESCE(ss.settings -> 'scheduled_orders' ->> 'enabled', 'false') = 'true'
    OR COALESCE(ss.settings -> 'product_options' ->> 'enabled', 'false') = 'true'
  )
ORDER BY s.id;

-- 2) Total (the number to report).
SELECT COUNT(*) AS non_restaurant_stores_using_addons_or_scheduled_orders
FROM stores s
LEFT JOIN store_settings ss ON ss.store_id = s.id
WHERE NOT ('restaurant' = ANY (s.industries))
  AND (
    EXISTS (SELECT 1 FROM product_option_groups g WHERE g.store_id = s.id AND g.is_active)
    OR EXISTS (SELECT 1 FROM order_fulfillment_schedules f WHERE f.store_id = s.id)
    OR COALESCE(ss.settings -> 'scheduled_orders' ->> 'enabled', 'false') = 'true'
    OR COALESCE(ss.settings -> 'product_options' ->> 'enabled', 'false') = 'true'
  );
