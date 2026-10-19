-- DATA IMPACT:
-- Table affected: ai_embeddings; no row changes, backfill, data rewrite or FK changes.
-- Destructive operations: none. Existing writes remain allowed during index build.
-- Idempotency: IF NOT EXISTS. An interrupted INVALID index needs separate operator review.
-- This file must contain exactly ONE SQL statement: PostgreSQL simple-query batches
-- otherwise form an implicit transaction incompatible with CONCURRENTLY.
-- Approval: owner noflags brief; automatic migrate deploy. Not executed here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_embeddings_knowledge_scope_idx
  ON ai_embeddings (knowledge_scope, store_id, organization_id, entity_type);
