-- Add explicit is_free flag to subscription_plans
-- Purpose: replace fragile base_price <= 0 heuristic with an explicit flag.
-- The heuristic fails silently when sub.plan is null and routes paid checkouts
-- through free-plan branches (no widget, no charge, plan assigned anyway).
--
-- DATA IMPACT: subscription_plans (read-only ALTER + targeted UPDATE).
--   - Adds is_free BOOLEAN NOT NULL DEFAULT false.
--   - Backfills is_free=true ONLY where base_price <= 0 (existing free / trial /
--     promotional zero-priced rows). Paid plans untouched.
-- Idempotent: ADD COLUMN IF NOT EXISTS + UPDATE ... WHERE is_free = false.

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT false;

UPDATE subscription_plans
  SET is_free = true
  WHERE base_price <= 0 AND is_free = false;
