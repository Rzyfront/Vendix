-- P4.2 hardening: signature evidence is append-only for TRUNCATE too.
-- The row trigger of 20261120090000_workflow_documents_p4 covers UPDATE and
-- DELETE; TRUNCATE fires only statement-level triggers, so it gets its own.
--
-- DATA IMPACT:
-- Tables affected: none (adds a trigger on signature_evidence_events)
-- Expected row changes: none
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: guarded by pg_trigger

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'signature_evidence_no_truncate_trg') THEN
    CREATE TRIGGER "signature_evidence_no_truncate_trg"
      BEFORE TRUNCATE ON "signature_evidence_events"
      FOR EACH STATEMENT EXECUTE FUNCTION "signature_evidence_append_only"();
  END IF;
END $$;
