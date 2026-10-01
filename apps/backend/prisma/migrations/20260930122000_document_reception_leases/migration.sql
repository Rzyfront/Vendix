-- DATA IMPACT:
-- Tables affected: document_reception_connections, document_reception_runs.
-- Expected existing row changes: none; new lease/version/public-token fields are
--   nullable or defaulted, with no backfill or rewrite of business data.
-- Destructive operations: none. No DROP, DELETE, UPDATE, table rewrite, or FK change.
-- FK behavior remains the existing RESTRICT policy.
-- Idempotency: ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS; checks
--   are guarded by pg_constraint and validated after a preflight.

ALTER TABLE "document_reception_connections"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "public_token" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "lease_token" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMP(6);

ALTER TABLE "document_reception_runs"
  ADD COLUMN IF NOT EXISTS "lease_token" VARCHAR(64);

-- Refuse to validate new invariants over pre-existing invalid configuration.
-- No rows are repaired or rewritten by this migration.
DO $$
DECLARE
  invalid_connection_ids TEXT;
BEGIN
  SELECT string_agg(connection_id::TEXT, ', ')
  INTO invalid_connection_ids
  FROM (
    SELECT "id" AS connection_id
    FROM "document_reception_connections"
    WHERE "version" < 1
       OR "poll_interval_minutes" < 1
       OR "poll_interval_minutes" > 1440
       OR (("lease_token" IS NULL) <> ("lease_expires_at" IS NULL))
    ORDER BY "id"
    LIMIT 50
  ) AS invalid_rows;

  IF invalid_connection_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot add document reception lease checks; invalid existing connection ids: %',
      invalid_connection_ids;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'doc_recv_conn_version_check'
      AND conrelid = 'document_reception_connections'::regclass
  ) THEN
    ALTER TABLE "document_reception_connections"
      ADD CONSTRAINT "doc_recv_conn_version_check"
      CHECK ("version" >= 1) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'doc_recv_conn_poll_interval_check'
      AND conrelid = 'document_reception_connections'::regclass
  ) THEN
    ALTER TABLE "document_reception_connections"
      ADD CONSTRAINT "doc_recv_conn_poll_interval_check"
      CHECK ("poll_interval_minutes" BETWEEN 1 AND 1440) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'doc_recv_conn_lease_pair_check'
      AND conrelid = 'document_reception_connections'::regclass
  ) THEN
    ALTER TABLE "document_reception_connections"
      ADD CONSTRAINT "doc_recv_conn_lease_pair_check"
      CHECK (("lease_token" IS NULL) = ("lease_expires_at" IS NULL)) NOT VALID;
  END IF;
END $$;

ALTER TABLE "document_reception_connections"
  VALIDATE CONSTRAINT "doc_recv_conn_version_check";
ALTER TABLE "document_reception_connections"
  VALIDATE CONSTRAINT "doc_recv_conn_poll_interval_check";
ALTER TABLE "document_reception_connections"
  VALIDATE CONSTRAINT "doc_recv_conn_lease_pair_check";

-- NULL is intentionally allowed for legacy connections; new connections receive
-- their opaque public token from application code.
CREATE UNIQUE INDEX IF NOT EXISTS "doc_recv_conn_public_token_key"
  ON "document_reception_connections" ("public_token");

-- Worker scans for expired leases; the index keeps this claim path bounded.
CREATE INDEX IF NOT EXISTS "doc_recv_conn_lease_expires_at_idx"
  ON "document_reception_connections" ("lease_expires_at");
