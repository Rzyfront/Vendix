-- DATA IMPACT:
-- Table affected: ai_agent_tasks; no row changes, backfill, data rewrite or FK changes.
-- Destructive operations: none. Existing writes remain allowed during index build.
-- Idempotency: IF NOT EXISTS. An interrupted INVALID index needs separate operator review.
-- This file must contain exactly ONE SQL statement: PostgreSQL simple-query batches
-- otherwise form an implicit transaction incompatible with CONCURRENTLY.
-- Approval: owner noflags brief; automatic migrate deploy. Not executed here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ai_agent_tasks_objective_id_idx" ON "ai_agent_tasks"("objective_id");
