-- DATA IMPACT:
-- Tables affected: new ai_agent_script_runs audit/admission sink only.
-- Expected row changes: none; no historical/backfill/business data mutations.
-- Destructive operations: none. No DROP/DELETE/TRUNCATE or mass UPDATE.
-- FK/cascade risk: none; immutable objective UUID snapshot, checked under owner
-- scope by the repository, deliberately no business-parent/cascading FKs.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS; second application is a no-op.
-- Approval: approved phase E brief; migration execution deferred, no DB touched.
-- Source is AES-256-GCM ciphertext ONLY. The application key is server-side and
-- never persisted. expires_at enforces seven-day read ACL; an approved retention
-- operator may later dispose of expired encrypted rows (not part of this migration).
CREATE TABLE IF NOT EXISTS "ai_agent_script_runs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" INTEGER NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "objective_id" UUID NOT NULL,
  "source_hash" VARCHAR(64) NOT NULL,
  "source_ciphertext" BYTEA NOT NULL,
  "source_nonce" BYTEA NOT NULL,
  "source_auth_tag" BYTEA NOT NULL,
  "source_key_id" VARCHAR(16) NOT NULL,
  "policy_digest" VARCHAR(71) NOT NULL,
  "runtime_digest" VARCHAR(71) NOT NULL,
  "limits" JSONB NOT NULL,
  "manifest" JSONB NOT NULL,
  "calls" JSONB NOT NULL DEFAULT '[]',
  "outcome" VARCHAR(20) NOT NULL DEFAULT 'running',
  "usage" JSONB NOT NULL DEFAULT '{}',
  "lease_until" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),
  CONSTRAINT "ai_agent_script_runs_owner_check"
    CHECK ("store_id" > 0 AND "organization_id" > 0 AND "user_id" > 0),
  CONSTRAINT "ai_agent_script_runs_source_check"
    CHECK ("source_hash" ~ '^[a-f0-9]{64}$'
      AND octet_length("source_ciphertext") BETWEEN 1 AND 32768
      AND octet_length("source_nonce") = 12 AND octet_length("source_auth_tag") = 16
      AND "source_key_id" ~ '^[a-f0-9]{16}$'),
  CONSTRAINT "ai_agent_script_runs_digest_check"
    CHECK ("policy_digest" ~ '^(sha256:)?[a-f0-9]{64}$'
      AND "runtime_digest" ~ '^(sha256:)?[a-f0-9]{64}$'),
  CONSTRAINT "ai_agent_script_runs_json_check"
    CHECK (jsonb_typeof("limits") = 'object' AND jsonb_typeof("manifest") = 'array'
      AND jsonb_array_length("manifest") <= 20 AND jsonb_typeof("calls") = 'array'
      AND jsonb_array_length("calls") <= 40 AND jsonb_typeof("usage") = 'object'),
  CONSTRAINT "ai_agent_script_runs_outcome_check"
    CHECK ("outcome" IN ('running', 'ok', 'partial', 'denied', 'cancelled',
      'timeout', 'unavailable', 'failed')),
  CONSTRAINT "ai_agent_script_runs_expiry_check"
    CHECK ("lease_until" <= "created_at" + INTERVAL '30 seconds'
      AND "expires_at" > "created_at"
      AND "expires_at" <= "created_at" + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS "ai_agent_script_runs_owner_created_idx"
  ON "ai_agent_script_runs" ("store_id", "organization_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_agent_script_runs_owner_objective_idx"
  ON "ai_agent_script_runs" ("store_id", "organization_id", "user_id", "objective_id");
CREATE INDEX IF NOT EXISTS "ai_agent_script_runs_admission_idx"
  ON "ai_agent_script_runs" ("lease_until");
CREATE INDEX IF NOT EXISTS "ai_agent_script_runs_store_admission_idx"
  ON "ai_agent_script_runs" ("store_id", "lease_until");
CREATE INDEX IF NOT EXISTS "ai_agent_script_runs_retention_idx"
  ON "ai_agent_script_runs" ("expires_at");
