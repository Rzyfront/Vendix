-- Evidence is append-only at the database level (M4 of the #1099 review), so no
-- future code path can rewrite it. Triggers on three tables:
--   workflow_instance_events: no UPDATE, no DELETE.
--   dossier_items: UPDATE only moves `status` to 'superseded'; no DELETE.
--   stored_files: identity columns are immutable (retention_until, legal_hold and
--     deleted_at stay editable); DELETE only for a file no dossier item references,
--     without legal_hold and with its retention over.
-- TRUNCATE (local seed resets) does not fire row triggers.
--
-- DATA IMPACT: none. No rows change; only future UPDATE/DELETE are restricted.
--   Destructive operations: none.
--   FK/cascade risk: none. The FKs on these tables are RESTRICT or SET NULL.
--   Idempotency: CREATE OR REPLACE FUNCTION and triggers guarded by pg_trigger.

CREATE OR REPLACE FUNCTION "workflow_events_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'EVIDENCE_APPEND_ONLY: % on workflow_instance_events is not allowed', TG_OP
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "dossier_items_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'EVIDENCE_APPEND_ONLY: DELETE on dossier_items is not allowed'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW."status" = 'superseded'
     AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'EVIDENCE_APPEND_ONLY: dossier_items only allows status -> superseded'
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "stored_files_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'retention_until' - 'legal_hold' - 'deleted_at')
       = (to_jsonb(OLD) - 'retention_until' - 'legal_hold' - 'deleted_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'EVIDENCE_APPEND_ONLY: stored_files identity columns are immutable'
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD."legal_hold"
     OR (OLD."retention_until" IS NOT NULL AND OLD."retention_until" > now())
     OR EXISTS (SELECT 1 FROM "dossier_items" i WHERE i."file_id" = OLD."id") THEN
    RAISE EXCEPTION 'EVIDENCE_APPEND_ONLY: stored file % is retained or referenced', OLD."id"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workflow_events_append_only_trg') THEN
    CREATE TRIGGER "workflow_events_append_only_trg"
      BEFORE UPDATE OR DELETE ON "workflow_instance_events"
      FOR EACH ROW EXECUTE FUNCTION "workflow_events_append_only"();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'dossier_items_append_only_trg') THEN
    CREATE TRIGGER "dossier_items_append_only_trg"
      BEFORE UPDATE OR DELETE ON "dossier_items"
      FOR EACH ROW EXECUTE FUNCTION "dossier_items_append_only"();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'stored_files_append_only_trg') THEN
    CREATE TRIGGER "stored_files_append_only_trg"
      BEFORE UPDATE OR DELETE ON "stored_files"
      FOR EACH ROW EXECUTE FUNCTION "stored_files_append_only"();
  END IF;
END $$;
