-- =====================================================================
-- DATA IMPACT:
--   Tables affected: platform_settings (1 INSERT, idempotent via ON CONFLICT)
--   Tables preserved: all others
--   Expected row changes: +1 row in platform_settings (key='core') if missing
--   Cascade risk: none (insert-only)
-- Rationale:
--   Guarantees a canonical platform_settings row exists with key='core'
--   so SubscriptionTrialService can use findUnique({ where: { key: 'core' } })
--   instead of findFirst() (deterministic + safer in concurrent reads).
-- =====================================================================

INSERT INTO "platform_settings" ("key", "value", "default_trial_days")
VALUES ('core', '{}'::jsonb, 14)
ON CONFLICT ("key") DO NOTHING;
