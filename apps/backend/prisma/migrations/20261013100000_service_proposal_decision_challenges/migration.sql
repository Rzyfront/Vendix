-- DATA IMPACT:
-- Tables affected: service_proposal_decision_challenges
-- Expected row changes: creates an empty table; no existing data is changed
-- Destructive operations: none
-- FK/cascade risk: restrictive composite FKs preserve store/session/proposal/token ownership
-- Idempotency: guarded table/index/constraint creation
-- Approval: additive feature migration; no data rewrite

CREATE TABLE IF NOT EXISTS "service_proposal_decision_challenges" (
  "id" UUID PRIMARY KEY,
  "store_id" INTEGER NOT NULL,
  "session_id" INTEGER NOT NULL,
  "proposal_id" INTEGER NOT NULL,
  "token_id" INTEGER NOT NULL,
  "challenge_hash" VARCHAR(64) NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_proposal_decision_challenges_attempt_count_check" CHECK ("attempt_count" BETWEEN 0 AND 5)
);

CREATE INDEX IF NOT EXISTS "service_proposal_decision_challenges_store_proposal_created_idx"
  ON "service_proposal_decision_challenges" ("store_id", "proposal_id", "created_at" DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_proposal_decision_challenges_session_store_fkey') THEN
    ALTER TABLE "service_proposal_decision_challenges"
      ADD CONSTRAINT "service_proposal_decision_challenges_session_store_fkey"
      FOREIGN KEY ("store_id", "session_id") REFERENCES "service_sessions"("store_id", "id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_proposal_decision_challenges_proposal_store_fkey') THEN
    ALTER TABLE "service_proposal_decision_challenges"
      ADD CONSTRAINT "service_proposal_decision_challenges_proposal_store_fkey"
      FOREIGN KEY ("store_id", "proposal_id") REFERENCES "service_change_proposals"("store_id", "id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_proposal_decision_challenges_token_session_store_fkey') THEN
    ALTER TABLE "service_proposal_decision_challenges"
      ADD CONSTRAINT "service_proposal_decision_challenges_token_session_store_fkey"
      FOREIGN KEY ("store_id", "session_id", "token_id") REFERENCES "service_session_tokens"("store_id", "session_id", "id") ON DELETE RESTRICT;
  END IF;
END $$;