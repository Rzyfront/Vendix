-- DATA IMPACT:
-- Tables affected: subscription_plans
-- Expected row changes: additive columns plan_group_code (varchar 64) and
--   details_md (text). Backfill sets plan_group_code = code for every existing
--   row where plan_group_code IS NULL, so each pre-existing plan becomes a
--   single-row group of itself. No rows are deleted or destroyed.
-- Destructive operations: none (only ADD COLUMN + CREATE INDEX + guarded UPDATE)
-- FK/cascade risk: none (no FKs added or dropped)
-- Idempotency: guarded with IF NOT EXISTS and a WHERE filter on the backfill
-- Approval: additive multi-cycle plan support (feat/subscription-plan-multi-cycle)

-- 1. Multi-cycle grouping key. Plans sharing the same plan_group_code form a
--    single logical plan exposed with multiple billing-cycle pricings.
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS plan_group_code varchar(64);

-- 2. Optional markdown details body for the plan group.
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS details_md text;

-- 3. Index for resolving a group by its shared code.
CREATE INDEX IF NOT EXISTS subscription_plans_plan_group_code_idx ON subscription_plans(plan_group_code);

-- 4. Backfill: existing plans become a group of themselves. Guarded by WHERE so
--    re-running the migration never overwrites an already-set group code.
UPDATE subscription_plans SET plan_group_code = code WHERE plan_group_code IS NULL;
