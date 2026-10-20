-- N6: abort on the first error even when run by hand (`psql -f` without
-- `-v ON_ERROR_STOP=1`): otherwise the guard below would only print its
-- exception and the UPDATE/INSERT statements after it would still run.
\set ON_ERROR_STOP on

-- Golden conversations E2E fixture. LOCAL DISPOSABLE CLONE ONLY.
--
-- Applied by live-http.adapter.ts before a run, after it refused any database
-- whose name does not contain "e2e". Idempotent: running it twice changes
-- nothing the second time. Never ship this to a real environment.
--
-- g17 (restaurant_owner = owner@roku.vendix.com): roku is the seeded
-- restaurant, but its seeded "Pro" plan limits tool_agents.tools_allowed to
-- inventory/customers/orders, so Vexi had no table or kitchen tool to route
-- to. The case needs a restaurant principal on a full plan: roku moves to the
-- same full plan as the owner principal (tech-bogota, `dev-annual`). Feature
-- gating reads `paid_plan_id` (SubscriptionResolverService), so both columns move.
DO $$
BEGIN
  IF current_database() !~ 'e2e' THEN
    RAISE EXCEPTION 'golden-e2e fixture refuses database %', current_database();
  END IF;
END $$;

UPDATE store_subscriptions ss
   SET plan_id = full_plan.id,
       paid_plan_id = full_plan.id,
       updated_at = CURRENT_TIMESTAMP
  FROM stores s,
       (SELECT id FROM subscription_plans WHERE code = 'dev-annual') AS full_plan
 WHERE ss.store_id = s.id
   AND s.slug = 'roku'
   AND (ss.plan_id IS DISTINCT FROM full_plan.id
        OR ss.paid_plan_id IS DISTINCT FROM full_plan.id);

-- g23 (owner = tech-bogota): the only low-stock product, "Cargador USB-C 65W"
-- (CHG-USB65-GAN), had no supplier that carries it, so no purchase order could
-- be proposed. A dedicated E2E supplier carries it as the preferred source.
INSERT INTO suppliers (organization_id, store_id, name, code, contact_person,
                       email, phone, state, is_active, updated_at)
SELECT s.organization_id, s.id, 'Distribuidora E2E Tecnología', 'E2E-TEC-001',
       'Compras E2E', 'compras@e2e-tecnologia.test', '3000000000',
       'active', true, CURRENT_TIMESTAMP
  FROM stores s
 WHERE s.slug = 'tech-bogota'
   AND NOT EXISTS (SELECT 1 FROM suppliers x
                    WHERE x.organization_id = s.organization_id
                      AND x.store_id = s.id AND x.code = 'E2E-TEC-001');

INSERT INTO supplier_products (supplier_id, product_id, supplier_sku,
                               cost_per_unit, min_order_qty, lead_time_days,
                               is_preferred, updated_at)
SELECT sup.id, p.id, 'E2E-CHG-65', 80000, 10, 3, true, CURRENT_TIMESTAMP
  FROM stores s
  JOIN suppliers sup ON sup.store_id = s.id AND sup.code = 'E2E-TEC-001'
  JOIN products p ON p.store_id = s.id AND p.sku = 'CHG-USB65-GAN'
 WHERE s.slug = 'tech-bogota'
ON CONFLICT (supplier_id, product_id) DO NOTHING;

-- Same product: the alert reads stock_levels.reorder_point (empty → the
-- store's default of 10) while the product sheet says 40, so the agent saw two
-- different shortfalls and asked which one to buy. The location carries the
-- product's own reorder point so both readings agree.
UPDATE stock_levels sl
   SET reorder_point = p.reorder_point,
       updated_at = CURRENT_TIMESTAMP
  FROM products p
  JOIN stores s ON s.id = p.store_id
 WHERE sl.product_id = p.id
   AND sl.product_variant_id IS NULL
   AND s.slug = 'tech-bogota'
   AND p.sku = 'CHG-USB65-GAN'
   AND p.reorder_point IS NOT NULL
   AND sl.reorder_point IS DISTINCT FROM p.reorder_point;
