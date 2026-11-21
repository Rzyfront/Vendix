-- Copia de los planes existentes a plan_ai_entitlements
-- (odd/tasks/vex-agente-avanzado.md §3.11, T11, M3).
--
-- Qué hace:
--   Por cada fila de subscription_plans inserta las 11 capacidades del
--   catálogo (libs/shared-types/ai-capabilities.ts) traducidas desde
--   subscription_plans.ai_feature_flags con la misma regla que
--   legacyFlagsToAIEntitlements(flags, 'complete'):
--     - enabled: 'always' → true; sin fuente → false; si no, true solo cuando
--       ai_feature_flags -> <feature> -> 'enabled' es el booleano JSON true.
--     - cap_value: número JSON > 0 → truncado a BIGINT; ausente, 0, negativo
--       o no numérico → NULL (el "ausente o ≤ 0 = sin límite" del modelo
--       viejo pasa a NULL = sin límite, nunca a 0).
--     - on_limit: sin fuente → 'block'; si no, 'block' solo cuando
--       degradation = 'block', si no 'warn'.
--   ai_feature_flags no se toca: el gate sigue decidiendo con él (modo
--   sombra, T10) y el resolver nuevo compara contra estas filas.
--
-- DATA IMPACT:
--   Tables affected: plan_ai_entitlements (INSERT). subscription_plans solo
--     se lee.
--   Expected row changes: 11 × (número de filas de subscription_plans)
--     inserciones, menos las capacidades que un plan ya tenga (WHERE NOT
--     EXISTS + ON CONFLICT DO NOTHING). Antes de desplegar:
--       SELECT count(*) * 11 FROM subscription_plans;
--   Destructive operations: ninguna. Sin UPDATE, DELETE, DROP ni TRUNCATE.
--   FK/cascade risk: ninguno. Solo inserta hijos de subscription_plans con la
--     FK ON DELETE RESTRICT creada en M2 (20261223090000).
--   Idempotency: cada fila se inserta solo si su (plan_id, agent_key,
--     capability_key) no existe; reejecutar no cambia nada.
--   Reversa: la tabla no decide acceso mientras dure el modo sombra, así que
--     estas filas pueden quedarse. Para retirarlas, una migración nueva que
--     renombre la tabla a plan_ai_entitlements_deprecated_YYYYMMDD; si hiciera
--     falta vaciarlas, DELETE FROM plan_ai_entitlements WHERE created_at <=
--     <instante de este despliegue> en una migración nueva con su propio
--     DATA IMPACT y aprobación. ai_feature_flags queda intacto, así que el
--     modelo viejo no pierde nada.
--   Dry-run: no ejecutado en esta máquina (sin Postgres local ni Docker en
--     marcha). La equivalencia con legacyFlagsToAIEntitlements está fijada
--     por src/domains/store/subscriptions/services/ai-entitlements.migration.spec.ts.
--   Approval: plan Vex Plus aprobado por Rafael (encargo F2, 2026-11-20):
--     "sin UPDATE/INSERT salvo lo que T11 exija para migrar planes — en ese
--     caso, dentro de la migración con WHERE acotado y explicando el rollback".

INSERT INTO "plan_ai_entitlements"
  ("plan_id", "agent_key", "capability_key", "enabled", "cap_value", "on_limit")
SELECT
  p."id",
  s.agent_key,
  s.capability_key,
  CASE
    WHEN s.source_feature IS NULL THEN false
    WHEN s.enabled_from = 'always' THEN true
    ELSE COALESCE(
      (p."ai_feature_flags" -> s.source_feature -> 'enabled') = 'true'::jsonb,
      false
    )
  END,
  -- Nested WHEN, not AND: Postgres does not promise AND evaluation order, and
  -- the ::numeric cast must never run on a non-numeric JSON value.
  CASE
    WHEN s.cap_field IS NULL THEN NULL
    WHEN jsonb_typeof(p."ai_feature_flags" -> s.source_feature -> s.cap_field)
      IS DISTINCT FROM 'number' THEN NULL
    WHEN (p."ai_feature_flags" -> s.source_feature ->> s.cap_field)::numeric <= 0
      THEN NULL
    WHEN (p."ai_feature_flags" -> s.source_feature ->> s.cap_field)::numeric
      >= 9223372036854775807 THEN NULL
    ELSE trunc((p."ai_feature_flags" -> s.source_feature ->> s.cap_field)::numeric)::bigint
  END,
  CASE
    WHEN s.source_feature IS NULL THEN 'block'::"ai_entitlement_on_limit_enum"
    WHEN (p."ai_feature_flags" -> s.source_feature -> 'degradation') = '"block"'::jsonb
      THEN 'block'::"ai_entitlement_on_limit_enum"
    ELSE 'warn'::"ai_entitlement_on_limit_enum"
  END
FROM "subscription_plans" p
CROSS JOIN (
  VALUES
    ('vex', 'agent', 'vex_agent', 'feature', 'daily_messages_cap'),
    ('vex', 'model_tokens', 'vex_agent', 'always', 'monthly_tokens_cap'),
    ('vex', 'voice_readout', 'realtime_voice', 'feature', 'monthly_voice_seconds_cap'),
    ('vex', 'files', 'vex_agent', 'feature', NULL),
    ('vex', 'code_analysis', NULL, NULL, NULL),
    ('vex', 'advanced_model', NULL, NULL, NULL),
    ('vexi', 'agent', 'streaming_chat', 'feature', 'daily_messages_cap'),
    ('vexi', 'model_tokens', 'text_generation', 'always', 'monthly_tokens_cap'),
    ('vexi', 'voice_readout', 'realtime_voice', 'feature', 'monthly_voice_seconds_cap'),
    ('platform', 'module_ai', 'text_generation', 'feature', 'monthly_tokens_cap'),
    ('platform', 'smart_search', 'rag_embeddings', 'feature', 'indexed_docs_cap')
) AS s (agent_key, capability_key, source_feature, enabled_from, cap_field)
WHERE NOT EXISTS (
  SELECT 1
  FROM "plan_ai_entitlements" e
  WHERE e."plan_id" = p."id"
    AND e."agent_key" = s.agent_key
    AND e."capability_key" = s.capability_key
)
ON CONFLICT ("plan_id", "agent_key", "capability_key") DO NOTHING;
