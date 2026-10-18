-- DATA IMPACT:
-- Table affected: ai_engine_logs; no row changes, backfill, data rewrite or FK changes.
-- Destructive operations: none. Existing writes remain allowed during index build.
-- Idempotency: IF NOT EXISTS. An interrupted INVALID index needs separate operator review.
-- This file must contain exactly ONE SQL statement: PostgreSQL simple-query batches
-- otherwise form an implicit transaction incompatible with CONCURRENTLY.
-- Approval: owner noflags brief; automatic migrate deploy. Not executed here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ai_engine_logs_trace_id_created_at_idx" ON "ai_engine_logs"("trace_id", "created_at");
