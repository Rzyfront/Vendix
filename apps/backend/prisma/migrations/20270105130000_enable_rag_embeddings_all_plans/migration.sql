-- Indexación con IA en todos los planes.
--
-- Decisión de Rafael (2026-11-25): "por ahora todo se indexa". La indexación con
-- IA ya no se cobra ni se topa por tienda (#1395), pero el plan `starter` seguía
-- con `rag_embeddings.enabled = false` e `indexed_docs_cap = 0`, así que sus
-- tiendas quedaban bloqueadas por el gate `@RequireAIFeature('rag_embeddings')`.
--
-- Hay dos fuentes que deciden: el JSON heredado `subscription_plans.ai_feature_flags`
-- (modo shadow, el activo hoy) y la tabla `plan_ai_entitlements` (modo enforce).
-- Esta migración deja las dos iguales a lo que produce el seed.
--
-- DATA IMPACT:
--   Tables: subscription_plans (UPDATE de `ai_feature_flags`, jsonb) y
--           plan_ai_entitlements (UPDATE/INSERT de la fila platform/smart_search,
--           que es la capacidad de indexación en `AI_CAPABILITIES`).
--   Rows touched: en `subscription_plans`, exactamente los planes cuya clave
--   `rag_embeddings` no esté ya en {enabled: true, indexed_docs_cap: null,
--   degradation: 'warn'} — hoy los tres planes de producción y cualquier plan
--   creado desde el panel super-admin. En `plan_ai_entitlements`, una fila por
--   plan (se crea si falta) para platform/smart_search.
--   Expected counts:
--     SELECT count(*) FROM subscription_plans
--     WHERE COALESCE(ai_feature_flags -> 'rag_embeddings' ->> 'enabled','false') <> 'true'
--        OR (ai_feature_flags -> 'rag_embeddings' -> 'indexed_docs_cap') IS DISTINCT FROM 'null'::jsonb
--        OR (ai_feature_flags -> 'rag_embeddings' ->> 'degradation') IS DISTINCT FROM 'warn';
--     SELECT count(*) FROM plan_ai_entitlements
--     WHERE agent_key='platform' AND capability_key='smart_search'
--       AND (enabled IS DISTINCT FROM true OR cap_value IS NOT NULL OR on_limit::text <> 'warn');
--   Destructive operations: none. Sin DELETE/TRUNCATE/CASCADE y sin pérdida de
--   datos: solo un booleano, un tope y el modo de degradación. El resto de las
--   claves de IA del plan no se toca. Revertir = el mismo UPDATE con
--   enabled=false, cap=0, degradation='block'.
--   Idempotent: con el estado final ninguna cláusula WHERE selecciona filas.

UPDATE subscription_plans
SET ai_feature_flags = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            CASE
              WHEN jsonb_typeof(ai_feature_flags) = 'object' THEN ai_feature_flags
              ELSE '{}'::jsonb
            END,
            '{rag_embeddings}',
            CASE
              WHEN jsonb_typeof(ai_feature_flags -> 'rag_embeddings') = 'object'
                THEN ai_feature_flags -> 'rag_embeddings'
              ELSE '{}'::jsonb
            END,
            true
          ),
          '{rag_embeddings,enabled}',
          'true'::jsonb,
          true
        ),
        '{rag_embeddings,indexed_docs_cap}',
        'null'::jsonb,
        true
      ),
      '{rag_embeddings,degradation}',
      '"warn"'::jsonb,
      true
    )
WHERE COALESCE(ai_feature_flags -> 'rag_embeddings' ->> 'enabled', 'false') <> 'true'
   OR (ai_feature_flags -> 'rag_embeddings' -> 'indexed_docs_cap') IS DISTINCT FROM 'null'::jsonb
   OR (ai_feature_flags -> 'rag_embeddings' ->> 'degradation') IS DISTINCT FROM 'warn';

INSERT INTO plan_ai_entitlements (plan_id, agent_key, capability_key, enabled, cap_value, on_limit)
SELECT p.id, 'platform', 'smart_search', true, NULL, 'warn'
FROM subscription_plans p
ON CONFLICT (plan_id, agent_key, capability_key) DO UPDATE
SET enabled = true,
    cap_value = NULL,
    on_limit = 'warn',
    updated_at = now()
WHERE plan_ai_entitlements.enabled IS DISTINCT FROM true
   OR plan_ai_entitlements.cap_value IS NOT NULL
   OR plan_ai_entitlements.on_limit::text <> 'warn';
