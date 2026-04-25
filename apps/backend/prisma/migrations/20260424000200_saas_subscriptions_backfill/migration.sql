-- =====================================================================
-- SaaS Subscriptions Module — Phase A: Backfill existing stores
-- =====================================================================
-- DATA IMPACT:
--   Tables affected:
--     * store_subscriptions: INSERTs 1 row per existing stores.id.
--       ON CONFLICT (store_id) DO NOTHING — re-runs are safe.
--   Tables preserved: stores (read-only JOIN), subscription_plans (read-only).
--   Expected row changes:
--     * store_subscriptions: EXACTLY (SELECT COUNT(*) FROM stores) on first apply.
--     * 0 rows on any subsequent apply (idempotent via UNIQUE store_id + ON CONFLICT).
--   No UPDATE, no DELETE, no TRUNCATE, no DROP. Append-only.
--
-- WHY THIS IS CRITICAL:
--   The SubscriptionAccessService gate fails CLOSED when a store has no
--   store_subscriptions row. Without this backfill, every existing store
--   would immediately lose AI access once the gate is enabled. This
--   migration guarantees every store has a baseline core-free plan +
--   legacy-grace-30d promotional overlay granting 30 days of full AI
--   access as a cortesia transition window.
--
-- ROW COUNT VERIFICATION (run manually in staging after deploy):
--   SELECT
--     (SELECT COUNT(*) FROM stores)              AS stores_total,
--     (SELECT COUNT(*) FROM store_subscriptions) AS subs_total;
--   -- Both counts MUST match. If not, investigate before flipping gate to enforce.
-- =====================================================================

-- Resolve plan ids and legacy feature flags in a single transactional batch.
-- We reference trial-full's ai_feature_flags as the resolved_features for
-- the legacy-grace-30d overlay, matching the plan design (full AI during grace).
DO $$
DECLARE
  v_core_plan_id          INTEGER;
  v_legacy_plan_id        INTEGER;
  v_trial_feature_flags   JSONB;
  v_grace_days_interval   INTERVAL := INTERVAL '30 days';
BEGIN
  SELECT id INTO v_core_plan_id
  FROM "subscription_plans"
  WHERE code = 'core-free';

  SELECT id INTO v_legacy_plan_id
  FROM "subscription_plans"
  WHERE code = 'legacy-grace-30d';

  SELECT ai_feature_flags INTO v_trial_feature_flags
  FROM "subscription_plans"
  WHERE code = 'trial-full';

  IF v_core_plan_id IS NULL OR v_legacy_plan_id IS NULL OR v_trial_feature_flags IS NULL THEN
    RAISE EXCEPTION 'Seed migration 20260424000100 must run before backfill. Missing plan(s): core-free=%, legacy-grace-30d=%, trial-full flags present=%',
      v_core_plan_id, v_legacy_plan_id, (v_trial_feature_flags IS NOT NULL);
  END IF;

  -- Append-only backfill. One row per existing store.
  INSERT INTO "store_subscriptions" (
    "store_id",
    "plan_id",
    "state",
    "started_at",
    "current_period_start",
    "current_period_end",
    "effective_price",
    "vendix_base_price",
    "partner_margin_amount",
    "currency",
    "auto_renew",
    "promotional_plan_id",
    "promotional_applied_at",
    "resolved_features",
    "resolved_at",
    "metadata",
    "created_at",
    "updated_at"
  )
  SELECT
    s.id,
    v_core_plan_id,
    'active'::"store_subscription_state_enum",
    now(),
    now(),
    now() + v_grace_days_interval,
    0,
    0,
    0,
    'COP',
    true,
    v_legacy_plan_id,
    now(),
    v_trial_feature_flags,
    now(),
    jsonb_build_object(
      'backfill_source', 'saas_subscriptions_backfill_20260424000200',
      'legacy_grace_days', 30,
      'base_plan_code', 'core-free',
      'promotional_plan_code', 'legacy-grace-30d'
    ),
    now(),
    now()
  FROM "stores" s
  ON CONFLICT ("store_id") DO NOTHING;

  RAISE NOTICE 'Backfill complete. store_subscriptions row count should now equal stores row count.';
END
$$;
