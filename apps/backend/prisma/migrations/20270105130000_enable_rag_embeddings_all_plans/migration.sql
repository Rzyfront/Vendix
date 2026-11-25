-- Indexación con IA en todos los planes.
--
-- Decisión de Rafael (2026-11-25): "por ahora todo se indexa". La indexación con
-- IA ya no se cobra ni se topa por tienda (#1395), pero el plan `starter` seguía
-- con `rag_embeddings.enabled = false` e `indexed_docs_cap = 0`, así que sus
-- tiendas quedaban bloqueadas por el gate `@RequireAIFeature('rag_embeddings')`
-- y por el paywall del frontend.
--
-- DATA IMPACT:
--   Table: subscription_plans (UPDATE only; no INSERT/DELETE, no schema change).
--   Column: ai_feature_flags (jsonb) — solo la clave `rag_embeddings`.
--   Rows touched: exactamente los planes cuya clave no está ya en
--   {enabled: true, indexed_docs_cap: null}: hoy los tres planes de producción
--   (starter, pro, enterprise) y cualquier plan creado desde el panel super-admin.
--   Expected count = result of:
--     SELECT count(*) FROM subscription_plans
--     WHERE COALESCE(ai_feature_flags -> 'rag_embeddings' ->> 'enabled', 'false') <> 'true'
--        OR (ai_feature_flags -> 'rag_embeddings' -> 'indexed_docs_cap') IS DISTINCT FROM 'null'::jsonb;
--   `enabled` pasa a true y `indexed_docs_cap` a null (sin tope). Las demás claves
--   de IA del plan (text_generation, tool_agents, vex_agent…) no se tocan.
--   Destructive operations: none — sin DELETE/TRUNCATE/CASCADE y sin pérdida de
--   datos: solo cambia un booleano y un tope. Revertir es el mismo UPDATE con
--   enabled=false / cap=0.
--   Idempotent: con el estado final el WHERE no selecciona ninguna fila.

UPDATE subscription_plans
SET ai_feature_flags = jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(ai_feature_flags, '{}'::jsonb),
          '{rag_embeddings}',
          COALESCE(ai_feature_flags -> 'rag_embeddings', '{}'::jsonb),
          true
        ),
        '{rag_embeddings,enabled}',
        'true'::jsonb,
        true
      ),
      '{rag_embeddings,indexed_docs_cap}',
      'null'::jsonb,
      true
    )
WHERE COALESCE(ai_feature_flags -> 'rag_embeddings' ->> 'enabled', 'false') <> 'true'
   OR (ai_feature_flags -> 'rag_embeddings' -> 'indexed_docs_cap') IS DISTINCT FROM 'null'::jsonb;
