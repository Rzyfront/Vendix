-- DATA IMPACT:
-- Tables: ai_embeddings (additive namespace/check), new ai_knowledge_documents.
-- Historical DML: ZERO. No backfill, deletion, tenant rewrite or constraint removal.
-- Existing NOT NULL/unique/HNSW remain. DEFAULT store is metadata-only on modern PG.
-- Locks: ALTER TABLE + CHECK validation scans existing embeddings; schedule an approved window.
-- FK risk: sentinel global 0 is NOT a store/org. Abort on unexpected FKs; never add
-- unconditional store/org FKs here. Future FKs must respect the namespace boundary.
-- Approval: phase B approved brief; execution ONLY on an explicitly authorized QA snapshot.
-- Idempotency: IF NOT EXISTS/pg_constraint guards. Execute this file verbatim twice in QA.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ai_embeddings WHERE store_id <= 0 OR organization_id <= 0) THEN
    -- On a second application, only valid global rows introduced by this release are OK.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
      AND table_name = 'ai_embeddings' AND column_name = 'knowledge_scope') THEN
      RAISE EXCEPTION 'ai_embeddings: non-positive tenant IDs require review; no automatic correction';
    END IF;
    IF EXISTS (SELECT 1 FROM ai_embeddings WHERE (store_id <= 0 OR organization_id <= 0)
      AND NOT (knowledge_scope = 'global' AND store_id = 0 AND organization_id = 0
        AND entity_type IN ('tool','skill','process','recipe'))) THEN
      RAISE EXCEPTION 'ai_embeddings: conflicting namespace rows';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
    AND table_name = 'ai_embeddings' AND column_name = 'knowledge_scope'
    AND (data_type <> 'text' OR is_nullable <> 'NO' OR column_default IS DISTINCT FROM '''store''::text')) THEN
    RAISE EXCEPTION 'ai_embeddings: existing namespace column conflicts with this release';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f'
    AND (conrelid = 'ai_embeddings'::regclass OR confrelid = 'ai_embeddings'::regclass)) THEN
    RAISE EXCEPTION 'ai_embeddings: unexpected FK; review namespace design before applying';
  END IF;
END $$;

ALTER TABLE ai_embeddings ADD COLUMN IF NOT EXISTS knowledge_scope TEXT NOT NULL DEFAULT 'store';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ai_embeddings WHERE NOT (
    (knowledge_scope = 'store' AND store_id > 0 AND organization_id > 0)
    OR (knowledge_scope = 'global' AND store_id = 0 AND organization_id = 0
      AND entity_type IN ('tool','skill','process','recipe')))) THEN
    RAISE EXCEPTION 'ai_embeddings: scope conflict; abort without changing historical rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_embeddings'::regclass
    AND conname = 'ai_embeddings_knowledge_scope_check') THEN
    ALTER TABLE ai_embeddings ADD CONSTRAINT ai_embeddings_knowledge_scope_check CHECK (
      (knowledge_scope = 'store' AND store_id > 0 AND organization_id > 0)
      OR (knowledge_scope = 'global' AND store_id = 0 AND organization_id = 0
        AND entity_type IN ('tool','skill','process','recipe')));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ai_embeddings_knowledge_scope_idx
  ON ai_embeddings (knowledge_scope, store_id, organization_id, entity_type);

CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
  id SERIAL PRIMARY KEY,
  document_key VARCHAR(250) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  knowledge_scope TEXT NOT NULL DEFAULT 'global',
  store_id INTEGER,
  organization_id INTEGER,
  canonical_name VARCHAR(150) NOT NULL,
  version VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  lexical_text TEXT NOT NULL,
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('spanish', lexical_text)) STORED,
  metadata JSONB NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  indexed_hash VARCHAR(64),
  embedding_fingerprint VARCHAR(64),
  release_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  active BOOLEAN NOT NULL DEFAULT false,
  error_code VARCHAR(80),
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_knowledge_documents_document_key_key ON ai_knowledge_documents (document_key);
CREATE INDEX IF NOT EXISTS ai_knowledge_documents_scope_status_idx
  ON ai_knowledge_documents (knowledge_scope, entity_type, active, status);
CREATE INDEX IF NOT EXISTS ai_knowledge_documents_search_idx
  ON ai_knowledge_documents USING gin (search_vector) WHERE knowledge_scope = 'global';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_knowledge_documents'::regclass
    AND conname = 'ai_knowledge_documents_scope_check') THEN
    ALTER TABLE ai_knowledge_documents ADD CONSTRAINT ai_knowledge_documents_scope_check CHECK (
      entity_type IN ('tool','skill','process','recipe') AND (
        (knowledge_scope = 'global' AND store_id IS NULL AND organization_id IS NULL)
        OR (knowledge_scope = 'store' AND store_id > 0 AND organization_id > 0
          AND store_id IS NOT NULL AND organization_id IS NOT NULL)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_knowledge_documents'::regclass
    AND conname = 'ai_knowledge_documents_status_check') THEN
    ALTER TABLE ai_knowledge_documents ADD CONSTRAINT ai_knowledge_documents_status_check
      CHECK (status IN ('pending','ready','error','retired') AND (NOT active OR status = 'ready'));
  END IF;
END $$;
