-- DATA IMPACT:
-- Tables affected: ai_agent_script_runs (script audit/admission sink, 7-day retention).
-- Expected row changes: none. Schema-only: 0 rows mutated, no backfill, no UPDATE/DELETE.
-- Constraint relaxed: "objective_id" drops NOT NULL so scripts that run in NORMAL
--   (non-durable) turns can be audited (F10 Code Mode). Existing rows keep their value.
-- Columns added (all nullable, no default, no table rewrite): executor, rounds,
--   lambda_request_ids, tenant_hash, cut_reason, returned_bytes.
-- Destructive operations: none. No DROP TABLE/COLUMN, TRUNCATE, DELETE, UPDATE or CASCADE.
-- FK/cascade risk: none; "objective_id" is an immutable UUID snapshot with no FK.
-- Idempotency: ADD COLUMN IF NOT EXISTS, DROP NOT NULL is a no-op when already
--   nullable, guarded CHECK creation; a second application changes nothing.
-- Approval: F10 stage 1 brief (L16, additive migrations only); execution deferred, no DB touched.
ALTER TABLE "ai_agent_script_runs" ALTER COLUMN "objective_id" DROP NOT NULL;

ALTER TABLE "ai_agent_script_runs" ADD COLUMN IF NOT EXISTS "executor" VARCHAR(20);
ALTER TABLE "ai_agent_script_runs" ADD COLUMN IF NOT EXISTS "rounds" INTEGER;
ALTER TABLE "ai_agent_script_runs" ADD COLUMN IF NOT EXISTS "lambda_request_ids" JSONB;
ALTER TABLE "ai_agent_script_runs" ADD COLUMN IF NOT EXISTS "tenant_hash" VARCHAR(64);
ALTER TABLE "ai_agent_script_runs" ADD COLUMN IF NOT EXISTS "cut_reason" VARCHAR(40);
ALTER TABLE "ai_agent_script_runs" ADD COLUMN IF NOT EXISTS "returned_bytes" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_agent_script_runs_codemode_check'
      AND conrelid = 'ai_agent_script_runs'::regclass
  ) THEN
    ALTER TABLE "ai_agent_script_runs"
      ADD CONSTRAINT "ai_agent_script_runs_codemode_check"
      CHECK (
        ("executor" IS NULL OR "executor" ~ '^[a-z][a-z0-9-]{0,19}$')
        AND ("tenant_hash" IS NULL OR "tenant_hash" ~ '^[a-f0-9]{64}$')
        AND ("rounds" IS NULL OR "rounds" BETWEEN 0 AND 100)
        AND ("returned_bytes" IS NULL OR "returned_bytes" >= 0)
        AND ("lambda_request_ids" IS NULL OR jsonb_typeof("lambda_request_ids") = 'array')
      );
  END IF;
END $$;
