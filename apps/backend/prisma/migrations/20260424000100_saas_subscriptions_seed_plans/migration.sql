-- =====================================================================
-- SaaS Subscriptions Module — Phase A: Seed base + promotional plans
-- =====================================================================
-- DATA IMPACT:
--   Tables affected:
--     * subscription_plans: INSERTs 4 rows (ON CONFLICT (code) DO UPDATE).
--       Codes: trial-full, core-free, pro, legacy-grace-30d.
--       ON CONFLICT preserves created_at / created_by via coalesce pattern
--       (we only update mutable fields).
--     * platform_settings: INSERTs 1 row (key='subscription_defaults').
--   Tables preserved: all others.
--   Expected row changes:
--     * subscription_plans: +4 rows on first apply, 0 on re-runs.
--     * platform_settings: +1 row on first apply, 0 on re-runs.
--   Idempotency: INSERT ... ON CONFLICT. No DELETE, no TRUNCATE, no DROP.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. trial-full
--   All AI features enabled with generous caps. Used as the seed plan
--   for new stores during the 14-day trial, and as the ai_feature_flags
--   source for the legacy-grace-30d overlay.
-- ---------------------------------------------------------------------
INSERT INTO "subscription_plans" (
  "code", "name", "description",
  "plan_type", "state", "billing_cycle",
  "base_price", "currency", "trial_days",
  "grace_period_soft_days", "grace_period_hard_days",
  "suspension_day", "cancellation_day",
  "feature_matrix", "ai_feature_flags",
  "resellable", "is_promotional", "promo_priority",
  "created_at", "updated_at"
) VALUES (
  'trial-full',
  'Trial Completo',
  'Plan semilla de trial con acceso completo a todas las funciones de IA durante 14 dias.',
  'base', 'active', 'monthly',
  0, 'COP', 14,
  5, 10, 14, 45,
  '{ "pos": true, "ecommerce": true, "accounting": true, "inventory": true }'::jsonb,
  '{
    "text_generation": { "enabled": true,  "monthly_tokens_cap": 500000, "degradation": "warn" },
    "streaming_chat":  { "enabled": true,  "daily_messages_cap": 500,    "degradation": "warn" },
    "conversations":   { "enabled": true,  "retention_days": 180,        "degradation": "warn" },
    "tool_agents":     { "enabled": true,  "tools_allowed": ["*"],       "degradation": "warn" },
    "rag_embeddings":  { "enabled": true,  "indexed_docs_cap": 1000,     "degradation": "warn" },
    "async_queue":     { "enabled": true,  "monthly_jobs_cap": 2000,     "degradation": "warn" }
  }'::jsonb,
  false, false, 0,
  now(), now()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"             = EXCLUDED."name",
  "description"      = EXCLUDED."description",
  "plan_type"        = EXCLUDED."plan_type",
  "state"            = EXCLUDED."state",
  "billing_cycle"    = EXCLUDED."billing_cycle",
  "base_price"       = EXCLUDED."base_price",
  "currency"         = EXCLUDED."currency",
  "trial_days"       = EXCLUDED."trial_days",
  "feature_matrix"   = EXCLUDED."feature_matrix",
  "ai_feature_flags" = EXCLUDED."ai_feature_flags",
  "updated_at"       = now();

-- ---------------------------------------------------------------------
-- 2. core-free
--   Free tier. POS/ecommerce/accounting fully available. NO AI features
--   enabled except a minimal text_generation preview with very low caps.
--   This is the default plan for all existing stores after backfill.
-- ---------------------------------------------------------------------
INSERT INTO "subscription_plans" (
  "code", "name", "description",
  "plan_type", "state", "billing_cycle",
  "base_price", "currency", "trial_days",
  "grace_period_soft_days", "grace_period_hard_days",
  "suspension_day", "cancellation_day",
  "feature_matrix", "ai_feature_flags",
  "resellable", "is_promotional", "promo_priority",
  "created_at", "updated_at"
) VALUES (
  'core-free',
  'Core Gratuito',
  'Plan gratuito con acceso completo al POS, ecommerce y contabilidad. Sin funciones de IA.',
  'base', 'active', 'monthly',
  0, 'COP', 0,
  5, 10, 14, 45,
  '{ "pos": true, "ecommerce": true, "accounting": true, "inventory": true }'::jsonb,
  '{
    "text_generation": { "enabled": true,  "monthly_tokens_cap": 2000, "degradation": "block" },
    "streaming_chat":  { "enabled": false, "daily_messages_cap": 0,    "degradation": "block" },
    "conversations":   { "enabled": false, "retention_days": 0,        "degradation": "block" },
    "tool_agents":     { "enabled": false, "tools_allowed": [],        "degradation": "block" },
    "rag_embeddings":  { "enabled": false, "indexed_docs_cap": 0,      "degradation": "block" },
    "async_queue":     { "enabled": false, "monthly_jobs_cap": 0,      "degradation": "block" }
  }'::jsonb,
  false, false, 0,
  now(), now()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"             = EXCLUDED."name",
  "description"      = EXCLUDED."description",
  "plan_type"        = EXCLUDED."plan_type",
  "state"            = EXCLUDED."state",
  "billing_cycle"    = EXCLUDED."billing_cycle",
  "base_price"       = EXCLUDED."base_price",
  "currency"         = EXCLUDED."currency",
  "feature_matrix"   = EXCLUDED."feature_matrix",
  "ai_feature_flags" = EXCLUDED."ai_feature_flags",
  "updated_at"       = now();

-- ---------------------------------------------------------------------
-- 3. pro
--   Paid tier (80,000 COP/month). Full AI access with generous caps.
--   Resellable by partners up to 30% margin cap.
-- ---------------------------------------------------------------------
INSERT INTO "subscription_plans" (
  "code", "name", "description",
  "plan_type", "state", "billing_cycle",
  "base_price", "currency", "trial_days",
  "grace_period_soft_days", "grace_period_hard_days",
  "suspension_day", "cancellation_day",
  "feature_matrix", "ai_feature_flags",
  "resellable", "max_partner_margin_pct",
  "is_promotional", "promo_priority",
  "created_at", "updated_at"
) VALUES (
  'pro',
  'Pro',
  'Plan profesional con acceso completo a todas las funciones de IA, agentes y RAG.',
  'base', 'active', 'monthly',
  80000, 'COP', 0,
  5, 10, 14, 45,
  '{ "pos": true, "ecommerce": true, "accounting": true, "inventory": true }'::jsonb,
  '{
    "text_generation": { "enabled": true, "monthly_tokens_cap": 1000000, "degradation": "warn" },
    "streaming_chat":  { "enabled": true, "daily_messages_cap": 1000,    "degradation": "warn" },
    "conversations":   { "enabled": true, "retention_days": 365,         "degradation": "warn" },
    "tool_agents":     { "enabled": true, "tools_allowed": ["*"],        "degradation": "warn" },
    "rag_embeddings":  { "enabled": true, "indexed_docs_cap": 5000,      "degradation": "warn" },
    "async_queue":     { "enabled": true, "monthly_jobs_cap": 5000,      "degradation": "warn" }
  }'::jsonb,
  true, 30.00,
  false, 0,
  now(), now()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"                   = EXCLUDED."name",
  "description"            = EXCLUDED."description",
  "plan_type"              = EXCLUDED."plan_type",
  "state"                  = EXCLUDED."state",
  "billing_cycle"          = EXCLUDED."billing_cycle",
  "base_price"             = EXCLUDED."base_price",
  "currency"               = EXCLUDED."currency",
  "feature_matrix"         = EXCLUDED."feature_matrix",
  "ai_feature_flags"       = EXCLUDED."ai_feature_flags",
  "resellable"             = EXCLUDED."resellable",
  "max_partner_margin_pct" = EXCLUDED."max_partner_margin_pct",
  "updated_at"             = now();

-- ---------------------------------------------------------------------
-- 4. legacy-grace-30d (promotional overlay)
--   Promotional plan applied automatically to existing stores during
--   backfill. Grants full AI access (trial-full feature_flags) for 30
--   days. Overlay merges by maximum of caps — never subtracts.
--   promo_rules.criteria targets existing stores at backfill-time; the
--   promotional_activation.job also re-evaluates the rule periodically.
-- ---------------------------------------------------------------------
INSERT INTO "subscription_plans" (
  "code", "name", "description",
  "plan_type", "state", "billing_cycle",
  "base_price", "currency", "trial_days",
  "grace_period_soft_days", "grace_period_hard_days",
  "suspension_day", "cancellation_day",
  "feature_matrix", "ai_feature_flags",
  "resellable", "is_promotional", "promo_priority", "promo_rules",
  "created_at", "updated_at"
) VALUES (
  'legacy-grace-30d',
  'Cortesia Legado 30 dias',
  'Overlay promocional de 30 dias para tiendas existentes al momento del lanzamiento del modulo SaaS. Otorga acceso completo a IA sin costo.',
  'promotional', 'active', 'monthly',
  0, 'COP', 0,
  5, 10, 14, 45,
  '{ "pos": true, "ecommerce": true, "accounting": true, "inventory": true }'::jsonb,
  '{
    "text_generation": { "enabled": true, "monthly_tokens_cap": 500000, "degradation": "warn" },
    "streaming_chat":  { "enabled": true, "daily_messages_cap": 500,    "degradation": "warn" },
    "conversations":   { "enabled": true, "retention_days": 180,        "degradation": "warn" },
    "tool_agents":     { "enabled": true, "tools_allowed": ["*"],       "degradation": "warn" },
    "rag_embeddings":  { "enabled": true, "indexed_docs_cap": 1000,     "degradation": "warn" },
    "async_queue":     { "enabled": true, "monthly_jobs_cap": 2000,     "degradation": "warn" }
  }'::jsonb,
  false, true, 100,
  '{
    "criteria": [
      { "field": "store.created_at", "op": "lte", "value": "__backfill_cutoff__" }
    ],
    "duration_days": 30,
    "ends_at_formula": "started_at + interval ''30 days''",
    "notes": "Criterio evaluado en backfill por store.id. Overlay caduca 30 dias tras promotional_applied_at."
  }'::jsonb,
  now(), now()
)
ON CONFLICT ("code") DO UPDATE SET
  "name"             = EXCLUDED."name",
  "description"      = EXCLUDED."description",
  "plan_type"        = EXCLUDED."plan_type",
  "state"            = EXCLUDED."state",
  "billing_cycle"    = EXCLUDED."billing_cycle",
  "base_price"       = EXCLUDED."base_price",
  "currency"         = EXCLUDED."currency",
  "feature_matrix"   = EXCLUDED."feature_matrix",
  "ai_feature_flags" = EXCLUDED."ai_feature_flags",
  "is_promotional"   = EXCLUDED."is_promotional",
  "promo_priority"   = EXCLUDED."promo_priority",
  "promo_rules"      = EXCLUDED."promo_rules",
  "updated_at"       = now();

-- ---------------------------------------------------------------------
-- 5. platform_settings: default_trial_days = 14
-- ---------------------------------------------------------------------
INSERT INTO "platform_settings" ("key", "value", "default_trial_days", "description", "created_at", "updated_at")
VALUES (
  'subscription_defaults',
  '{ "default_trial_days": 14, "default_plan_code": "core-free", "legacy_grace_plan_code": "legacy-grace-30d" }'::jsonb,
  14,
  'Configuracion global de suscripciones. default_trial_days aplica al crear nuevas tiendas.',
  now(), now()
)
ON CONFLICT ("key") DO UPDATE SET
  "value"              = EXCLUDED."value",
  "default_trial_days" = EXCLUDED."default_trial_days",
  "description"        = EXCLUDED."description",
  "updated_at"         = now();
