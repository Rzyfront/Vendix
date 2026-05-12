-- =====================================================================
-- No-op migration. Original data seeds (4 legacy plans + platform_settings)
-- removed before first production deploy. The single canonical
-- 'trial-default' plan is provisioned by prisma/seeds/subscription-plans.seed.ts
-- after migrations finish.
-- =====================================================================
SELECT 1;
