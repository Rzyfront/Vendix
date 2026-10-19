-- DATA IMPACT:
-- Tables affected: NEW ai_agent_recipes, ai_agent_recipe_events only.
-- Expected row changes: zero; no backfill or mutation of historical data.
-- Destructive operations: none. FK/cascade risk: no business FKs, no cascades.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS; checks belong to new tables.
-- Approval: phase F execution brief. Automatic migrate deploy; not executed in this session.
CREATE TABLE IF NOT EXISTS ai_agent_recipes (
  id SERIAL PRIMARY KEY,
  identity_key VARCHAR(64) NOT NULL UNIQUE,
  knowledge_scope VARCHAR(10) NOT NULL,
  store_id INTEGER,
  organization_id INTEGER,
  user_id INTEGER,
  recipe_key VARCHAR(160) NOT NULL,
  version VARCHAR(80) NOT NULL,
  template JSONB NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'candidate',
  source_trace_ids JSONB NOT NULL DEFAULT '[]',
  source_objective_ids JSONB NOT NULL DEFAULT '[]',
  source_evidence_refs JSONB NOT NULL DEFAULT '[]',
  source_script_refs JSONB NOT NULL DEFAULT '[]',
  review JSONB,
  review_history JSONB NOT NULL DEFAULT '[]',
  approved_at TIMESTAMPTZ(6),
  expires_at TIMESTAMPTZ(6),
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  invalidation_count INTEGER NOT NULL DEFAULT 0,
  last_failure_code VARCHAR(40),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ai_agent_recipes_scope_check CHECK (
    (knowledge_scope='store' AND store_id>0 AND organization_id>0 AND user_id>0 AND store_id IS NOT NULL AND organization_id IS NOT NULL AND user_id IS NOT NULL)
    OR (knowledge_scope='global' AND store_id IS NULL AND organization_id IS NULL AND user_id IS NULL
      AND source_trace_ids='[]'::jsonb AND source_objective_ids='[]'::jsonb AND source_evidence_refs='[]'::jsonb AND source_script_refs='[]'::jsonb)),
  CONSTRAINT ai_agent_recipes_status_check CHECK (status IN ('candidate','reviewed','approved','deprecated','quarantined')),
  CONSTRAINT ai_agent_recipes_published_check CHECK (status<>'approved' OR (review IS NOT NULL AND approved_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at>approved_at)),
  CONSTRAINT ai_agent_recipes_counts_check CHECK (usage_count>=0 AND success_count>=0 AND failure_count>=0 AND invalidation_count>=0),
  CONSTRAINT ai_agent_recipes_template_check CHECK (template->>'kind' IS NOT DISTINCT FROM 'declarative' AND jsonb_typeof(template)='object'),
  CONSTRAINT ai_agent_recipes_sources_check CHECK (jsonb_typeof(source_trace_ids)='array' AND jsonb_typeof(source_objective_ids)='array'
    AND jsonb_typeof(source_evidence_refs)='array' AND jsonb_typeof(source_script_refs)='array' AND jsonb_typeof(review_history)='array')
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_recipes_version_uq ON ai_agent_recipes(knowledge_scope,COALESCE(store_id,0),COALESCE(organization_id,0),COALESCE(user_id,0),recipe_key,version);
CREATE INDEX IF NOT EXISTS ai_agent_recipes_owner_idx ON ai_agent_recipes(store_id,organization_id,user_id,status,expires_at);
CREATE INDEX IF NOT EXISTS ai_agent_recipes_global_idx ON ai_agent_recipes(knowledge_scope,status,expires_at);
CREATE TABLE IF NOT EXISTS ai_agent_recipe_events (
  id SERIAL PRIMARY KEY,
  recipe_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL CHECK(store_id>0),
  organization_id INTEGER NOT NULL CHECK(organization_id>0),
  user_id INTEGER NOT NULL CHECK(user_id>0),
  objective_id UUID NOT NULL,
  event_key VARCHAR(64) NOT NULL UNIQUE,
  kind VARCHAR(16) NOT NULL CHECK(kind IN ('used','success','failure')),
  code VARCHAR(40),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ai_agent_recipe_events_owner_idx ON ai_agent_recipe_events(store_id,organization_id,user_id,objective_id);
CREATE INDEX IF NOT EXISTS ai_agent_recipe_events_recipe_idx ON ai_agent_recipe_events(recipe_id,created_at);
