-- =====================================================================
-- SaaS Subscriptions Module — Phase A++: Audit fixes
-- =====================================================================
-- DATA IMPACT:
--   Tables affected:
--     * store_subscriptions: adds 2 new FK constraints (schema-only). No row mutation.
--     * No other tables affected.
--   Expected row changes: ZERO. Schema-only.
--   Idempotency: FK adds wrapped in DO $$ ... duplicate_object guard.
--   FK policy: all new FKs use ON DELETE SET NULL (safe: overlay/history
--   references can evaporate without orphaning the base subscription).
--
-- RATIONALE:
--   Audit of migration 20260424000000_saas_subscriptions_init found two
--   missing FKs on store_subscriptions that allow orphaned references:
--     1. promotional_plan_id -> subscription_plans(id)
--     2. replaced_by_id      -> store_subscriptions(id)   (self-ref)
--   Without FKs a promo plan archive or a history-chain pruning could
--   leave dangling ids in existing rows. SET NULL preserves the base
--   subscription's integrity even when the referenced row disappears.
--
--   Backfill data issue (current_period_end = now() + 30 days conflating
--   billing period with promo overlay expiry) is intentionally NOT fixed
--   here as a data UPDATE — per global rule §6.3, data mutations on
--   applied migrations require explicit snapshot + approval. Fix path:
--   Fase B resolver MUST use `promotional_applied_at + duration_days`
--   for overlay expiry, NOT `current_period_end`. Fase C billing engine
--   MUST detect free plans (base_price = 0) and silently advance period
--   without invoice emission.
-- =====================================================================

-- 1. FK: store_subscriptions.promotional_plan_id -> subscription_plans(id)
DO $$ BEGIN
  ALTER TABLE "store_subscriptions"
    ADD CONSTRAINT "store_subscriptions_promotional_plan_id_fkey"
    FOREIGN KEY ("promotional_plan_id") REFERENCES "subscription_plans"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. FK: store_subscriptions.replaced_by_id -> store_subscriptions(id)  (self-ref)
DO $$ BEGIN
  ALTER TABLE "store_subscriptions"
    ADD CONSTRAINT "store_subscriptions_replaced_by_id_fkey"
    FOREIGN KEY ("replaced_by_id") REFERENCES "store_subscriptions"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. Index on promotional_plan_id for overlay lookups (future cron job filter).
CREATE INDEX IF NOT EXISTS "store_subscriptions_promotional_plan_id_idx"
  ON "store_subscriptions" ("promotional_plan_id")
  WHERE "promotional_plan_id" IS NOT NULL;

-- 4. Consolidate platform_settings: keep both forms for backward compat
--    but document intent via comment. NO-OP SQL here to register the
--    decision explicitly; no schema change.
COMMENT ON COLUMN "platform_settings"."default_trial_days"
  IS 'SOURCE OF TRUTH for global trial days. The "value" JSONB column may mirror this for UI convenience but MUST NOT be read independently. On write, update both atomically.';
