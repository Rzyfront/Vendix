-- =====================================================
-- App IA agent_knowledge_embeddings — índice semántico del catálogo de
-- herramientas y procesos de Vex/Vexi (carga dinámica de herramientas).
-- Consumida por KnowledgeEmbeddingService (job index-knowledge de la cola
-- ai-embedding). Sin ella el índice queda solo léxico.
-- =====================================================
-- DATA IMPACT: 0 o 1 fila insertada en ai_engine_applications
-- - Tabla afectada: ai_engine_applications. SOLO INSERT de la fila
--   key = 'agent_knowledge_embeddings'. Sin UPDATE, sin DELETE, sin DROP,
--   sin TRUNCATE.
-- - config_id = la config ACTIVA de model_type 'embedding' con model_id
--   text-embedding-3-small (con o sin prefijo de proveedor; en prod la #17
--   que ya usa product_embeddings), por is_default desc, id asc. Sin
--   proveedores ni modelos nuevos. Si no existe esa config inserta 0 filas
--   y el seed crea/enlaza la app cuando exista.
-- - rate_limit / retry_config: se copian de product_embeddings si existe.
-- - FK/cascade risk: config_id -> ai_engine_configs (ON DELETE SET NULL),
--   sin efecto. Sin cambios de schema, sin enums.
-- - Idempotencia: ON CONFLICT (key) DO NOTHING; re-ejecución => 0 filas. Nunca
--   pisa una app editada a mano en el panel de IA.
-- - Mismos valores que prisma/seeds/ai-engine-apps.seed.ts.
-- =====================================================

BEGIN;

INSERT INTO ai_engine_applications (
  key, name, description, config_id, system_prompt, prompt_template,
  temperature, max_tokens, output_format, model_type, rate_limit, retry_config,
  is_active, metadata, ai_feature_category, created_at, updated_at
)
SELECT
  'agent_knowledge_embeddings',
  'Embeddings del catálogo de herramientas del agente',
  'Vectoriza las fichas de herramientas y procesos de Vex/Vexi para la carga dinámica de herramientas por búsqueda semántica',
  cfg.id,
  NULL,
  NULL,
  NULL,
  NULL,
  'embedding',
  'embedding',
  src.rate_limit,
  src.retry_config,
  true,
  NULL,
  'rag_embeddings',
  NOW(),
  NOW()
FROM (
  SELECT c.id
  FROM ai_engine_configs c
  WHERE c.model_type = 'embedding'
    AND c.is_active = true
    AND c.model_id IN ('text-embedding-3-small', 'openai/text-embedding-3-small')
  ORDER BY c.is_default DESC, c.id ASC
  LIMIT 1
) cfg
LEFT JOIN ai_engine_applications src ON src.key = 'product_embeddings'
ON CONFLICT (key) DO NOTHING;

COMMIT;
