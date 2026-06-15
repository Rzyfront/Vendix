-- DATA IMPACT:
-- Tables affected: store_subscriptions (INSERT only — additive)
-- Expected row changes: one new row per production-mode store that currently
--   has NO subscription row. At authoring time this matched 14 active stores
--   belonging to organizations with mode='production'. Demo/test stores are
--   intentionally excluded.
-- Destructive operations: none (no UPDATE/DELETE/DROP/TRUNCATE)
-- FK/cascade risk: none — store_subscriptions.store_id is @unique and the
--   INSERT only targets stores without an existing row.
-- Idempotency: guarded by NOT EXISTS + store_id unique constraint; re-running
--   inserts zero rows for stores that already have a subscription.
-- Approval: documented in chat (apply early-access plan id=2 to production stores).
--
-- Notes:
--   * Plan id 2 = 'early-access' (is_free=true, base_price=0, monthly).
--   * resolved_features is copied live from subscription_plans.ai_feature_flags
--     for plan 2 so it never drifts from a hardcoded snapshot.
--   * Timestamps use UTC to match the @db.Timestamp(6) (no-tz) columns.

INSERT INTO "store_subscriptions" (
  "store_id",
  "plan_id",
  "paid_plan_id",
  "state",
  "current_period_start",
  "current_period_end",
  "next_billing_at",
  "effective_price",
  "vendix_base_price",
  "partner_margin_amount",
  "currency",
  "auto_renew",
  "resolved_features",
  "resolved_at",
  "created_at",
  "updated_at"
)
SELECT
  s."id",
  2,
  2,
  'active'::"store_subscription_state_enum",
  (now() AT TIME ZONE 'UTC'),
  (now() AT TIME ZONE 'UTC') + INTERVAL '1 month',
  (now() AT TIME ZONE 'UTC') + INTERVAL '1 month',
  0,
  0,
  0,
  'COP',
  true,
  (SELECT "ai_feature_flags" FROM "subscription_plans" WHERE "id" = 2),
  (now() AT TIME ZONE 'UTC'),
  (now() AT TIME ZONE 'UTC'),
  (now() AT TIME ZONE 'UTC')
FROM "stores" s
JOIN "organizations" o ON o."id" = s."organization_id"
WHERE o."mode" = 'production'
  AND s."is_active" = true
  AND NOT EXISTS (
    SELECT 1 FROM "store_subscriptions" ss WHERE ss."store_id" = s."id"
  );
