-- DATA IMPACT:
-- Tables affected: store_subscriptions
-- Expected row changes: subscriptions with an effective trial/paid plan whose resolved_features snapshot is empty or differs from the plan AI feature flags.
-- Destructive operations: none
-- FK/cascade risk: none; only updates scalar/json fields on store_subscriptions and does not touch relationships.
-- Idempotency: guarded by effective plan lookup and IS DISTINCT FROM checks.
-- Approval: user approved execution in chat on 2026-05-03 ("Dale"). Production deploy still requires a DB snapshot before running migrations.

UPDATE store_subscriptions AS sub
SET
  resolved_features = plan.ai_feature_flags,
  resolved_at = NOW(),
  updated_at = NOW()
FROM subscription_plans AS plan
WHERE plan.id = CASE
    WHEN sub.state = 'trial' THEN sub.plan_id
    ELSE sub.paid_plan_id
  END
  AND sub.state <> 'no_plan'
  AND plan.ai_feature_flags IS NOT NULL
  AND sub.resolved_features IS DISTINCT FROM plan.ai_feature_flags;
