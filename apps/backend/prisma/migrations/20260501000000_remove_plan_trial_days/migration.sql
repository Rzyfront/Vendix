-- DATA IMPACT:
-- Tables affected: subscription_plans
-- Expected row changes: none
-- Destructive operations: drops deprecated column subscription_plans.trial_days
-- FK/cascade risk: none
-- Idempotency: guarded with IF EXISTS
-- Approval: user confirmed the subscriptions module is not in production and asked to remove this flow before production release
-- Snapshot: not required by user because this module is not in production
--
-- Remove per-plan trial duration. Trial length is now owned only by
-- platform_settings.default_trial_days and the default trial plan owns access/features.

ALTER TABLE "subscription_plans"
  DROP CONSTRAINT IF EXISTS "subscription_plans_trial_days_nonneg";

ALTER TABLE "subscription_plans"
  DROP COLUMN IF EXISTS "trial_days";
