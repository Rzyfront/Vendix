-- DATA IMPACT:
-- Tables affected: service_session_tokens, service_session_email_deliveries
-- Expected row changes: none; adds a unique key and replaces a single-column FK.
-- Destructive operations: none.
-- FK/cascade risk: RESTRICT behavior is retained.
-- Idempotency: catalog-guarded constraints; existing invalid links fail migration for reconciliation.
-- Approval: additive integrity hardening for the service-session delivery contract.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_session_tokens_store_session_id_key'
  ) THEN
    ALTER TABLE "service_session_tokens"
      ADD CONSTRAINT "service_session_tokens_store_session_id_key"
      UNIQUE ("store_id", "session_id", "id");
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_session_email_deliveries_token_fkey'
  ) THEN
    ALTER TABLE "service_session_email_deliveries"
      DROP CONSTRAINT "service_session_email_deliveries_token_fkey";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_session_email_deliveries_token_scope_fkey'
  ) THEN
    ALTER TABLE "service_session_email_deliveries"
      ADD CONSTRAINT "service_session_email_deliveries_token_scope_fkey"
      FOREIGN KEY ("store_id", "session_id", "token_id")
      REFERENCES "service_session_tokens" ("store_id", "session_id", "id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
