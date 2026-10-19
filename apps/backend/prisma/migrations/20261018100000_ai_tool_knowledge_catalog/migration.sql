-- DATA IMPACT:
-- Tables: ai_embeddings (additive namespace/check), new ai_knowledge_documents.
-- Historical DML: ZERO. No backfill, deletion, tenant rewrite or constraint removal.
-- Existing NOT NULL/unique/HNSW remain. DEFAULT store is metadata-only on modern PG.
-- Locks: brief metadata ALTER only (PG11+ constant DEFAULT); CHECK is NOT VALID.
-- No historical scans/preflight RAISE. Existing rows never abort this deploy.
-- Existing-table index is in its own single-statement concurrent migration.
-- FK risk: sentinel global 0 is NOT a store/org. No FK is added/removed here.
-- Optional later maintenance, after separately inspecting historical rows:
-- ALTER TABLE ai_embeddings VALIDATE CONSTRAINT ai_embeddings_knowledge_scope_check;
-- Not executed by deploy: validation may scan/fail and needs an approved window.
-- Approval: owner noflags brief; automatic migrate deploy. Not executed in this session.
-- Idempotency: IF NOT EXISTS/pg_constraint guards. Execute this file verbatim twice in QA.
ALTER TABLE ai_embeddings ADD COLUMN IF NOT EXISTS knowledge_scope TEXT NOT NULL DEFAULT 'store';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ai_embeddings'::regclass
    AND conname = 'ai_embeddings_knowledge_scope_check') THEN
    ALTER TABLE ai_embeddings ADD CONSTRAINT ai_embeddings_knowledge_scope_check CHECK (
      (knowledge_scope = 'store' AND store_id > 0 AND organization_id > 0)
      OR (knowledge_scope = 'global' AND store_id = 0 AND organization_id = 0
        AND entity_type IN ('tool','skill','process','recipe'))) NOT VALID;
  END IF;
END $$;
-- Concurrent index ai_embeddings_knowledge_scope_idx is isolated in 20261018100001_ai_embeddings_knowledge_scope_index.


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
