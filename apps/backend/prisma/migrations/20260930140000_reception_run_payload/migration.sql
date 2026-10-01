-- DATA IMPACT
-- Additive, legacy-safe nullable columns on document_reception_runs only.
-- No existing row updates/backfill, business data rewrite, foreign-key change,
-- index change, table drop, or deletion. Existing runs keep NULL payload/version
-- fields; new ingestion attempts may retain a bounded webhook/API envelope.

ALTER TABLE "document_reception_runs"
  ADD COLUMN IF NOT EXISTS "connection_version" INTEGER,
  ADD COLUMN IF NOT EXISTS "input_payload" JSONB,
  ADD COLUMN IF NOT EXISTS "payload_sha256" CHAR(64);

DO $$
DECLARE
  invalid_ids INTEGER[];
BEGIN
  SELECT ARRAY_AGG(id) INTO invalid_ids
  FROM (
    SELECT id FROM "document_reception_runs"
    WHERE "connection_version" IS NOT NULL AND "connection_version" < 1
    ORDER BY id LIMIT 20
  ) AS invalid;
  IF COALESCE(CARDINALITY(invalid_ids), 0) > 0 THEN
    RAISE EXCEPTION 'document_reception_runs invalid connection_version; sample ids: %', invalid_ids;
  END IF;

  SELECT ARRAY_AGG(id) INTO invalid_ids
  FROM (
    SELECT id FROM "document_reception_runs"
    WHERE "payload_sha256" IS NOT NULL
      AND "payload_sha256" !~ '^[0-9a-f]{64}$'
    ORDER BY id LIMIT 20
  ) AS invalid;
  IF COALESCE(CARDINALITY(invalid_ids), 0) > 0 THEN
    RAISE EXCEPTION 'document_reception_runs invalid payload_sha256; sample ids: %', invalid_ids;
  END IF;

  SELECT ARRAY_AGG(id) INTO invalid_ids
  FROM (
    SELECT id FROM "document_reception_runs"
    WHERE "input_payload" IS NOT NULL
      AND NOT (
        jsonb_typeof("input_payload") = 'object'
        AND octet_length("input_payload"::text) <= 6291456
      )
    ORDER BY id LIMIT 20
  ) AS invalid;
  IF COALESCE(CARDINALITY(invalid_ids), 0) > 0 THEN
    RAISE EXCEPTION 'document_reception_runs invalid input_payload; sample ids: %', invalid_ids;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'doc_reception_runs_connection_version_check'
      AND conrelid = 'public.document_reception_runs'::regclass
  ) THEN
    ALTER TABLE "document_reception_runs"
      ADD CONSTRAINT "doc_reception_runs_connection_version_check"
      CHECK ("connection_version" IS NULL OR "connection_version" >= 1)
      NOT VALID;
  END IF;
  ALTER TABLE "document_reception_runs"
    VALIDATE CONSTRAINT "doc_reception_runs_connection_version_check";

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'doc_reception_runs_payload_sha256_check'
      AND conrelid = 'public.document_reception_runs'::regclass
  ) THEN
    ALTER TABLE "document_reception_runs"
      ADD CONSTRAINT "doc_reception_runs_payload_sha256_check"
      CHECK ("payload_sha256" IS NULL OR "payload_sha256" ~ '^[0-9a-f]{64}$')
      NOT VALID;
  END IF;
  ALTER TABLE "document_reception_runs"
    VALIDATE CONSTRAINT "doc_reception_runs_payload_sha256_check";

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'doc_reception_runs_input_payload_check'
      AND conrelid = 'public.document_reception_runs'::regclass
  ) THEN
    ALTER TABLE "document_reception_runs"
      ADD CONSTRAINT "doc_reception_runs_input_payload_check"
      CHECK (
        "input_payload" IS NULL OR (
          jsonb_typeof("input_payload") = 'object'
          AND octet_length("input_payload"::text) <= 6291456
        )
      )
      NOT VALID;
  END IF;
  ALTER TABLE "document_reception_runs"
    VALIDATE CONSTRAINT "doc_reception_runs_input_payload_check";
END $$;
