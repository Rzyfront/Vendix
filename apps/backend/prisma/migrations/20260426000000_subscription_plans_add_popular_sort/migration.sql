-- DATA IMPACT:
--   Tablas afectadas: subscription_plans
--   Filas afectadas: TODAS (UPDATE no destructivo: backfill de sort_order desde promo_priority)
--   Operación: ADD COLUMN is_popular (default false), ADD COLUMN sort_order (default 0)
--   Reversible: sí (DROP COLUMN sin pérdida si se restaura desde backup)
--   No CASCADE, no DROP, no DELETE/UPDATE sin WHERE.

-- 1. Add is_popular column (idempotent)
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "is_popular" BOOLEAN NOT NULL DEFAULT false;

-- 2. Add sort_order column (idempotent)
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;

-- 3. Backfill sort_order from existing promo_priority for stable ordering on first deploy
--    (only when sort_order is still default 0; preserves any manual overrides)
UPDATE "subscription_plans"
SET "sort_order" = COALESCE("promo_priority", 0)
WHERE "sort_order" = 0 AND "promo_priority" IS NOT NULL AND "promo_priority" <> 0;
