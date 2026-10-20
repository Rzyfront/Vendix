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
