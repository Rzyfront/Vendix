-- Migration: fiscal_operation_events
-- Purpose: Adds an append-only fiscal operations event log for obligations, declarations,
-- evidence and close sessions.
-- Data impact: schema-only. Existing fiscal records are not modified.

CREATE TABLE IF NOT EXISTS "fiscal_operation_events" (
  "id" SERIAL PRIMARY KEY,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "accounting_entity_id" INTEGER NOT NULL,
  "event_type" VARCHAR(100) NOT NULL,
  "resource_type" VARCHAR(80) NOT NULL,
  "resource_id" INTEGER,
  "obligation_id" INTEGER,
  "declaration_id" INTEGER,
  "close_session_id" INTEGER,
  "evidence_id" INTEGER,
  "previous_status" VARCHAR(60),
  "new_status" VARCHAR(60),
  "actor_user_id" INTEGER,
  "metadata" JSONB,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_operation_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_operation_events_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_operation_events_accounting_entity_id_fkey"
    FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiscal_operation_events_obligation_id_fkey"
    FOREIGN KEY ("obligation_id") REFERENCES "fiscal_obligations"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_operation_events_declaration_id_fkey"
    FOREIGN KEY ("declaration_id") REFERENCES "tax_declaration_drafts"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_operation_events_close_session_id_fkey"
    FOREIGN KEY ("close_session_id") REFERENCES "fiscal_close_sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_operation_events_evidence_id_fkey"
    FOREIGN KEY ("evidence_id") REFERENCES "fiscal_evidences"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "fiscal_operation_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "fiscal_operation_events_org_entity_created_idx"
  ON "fiscal_operation_events"("organization_id", "accounting_entity_id", "created_at");

CREATE INDEX IF NOT EXISTS "fiscal_operation_events_resource_idx"
  ON "fiscal_operation_events"("resource_type", "resource_id");

CREATE INDEX IF NOT EXISTS "fiscal_operation_events_obligation_created_idx"
  ON "fiscal_operation_events"("obligation_id", "created_at");

CREATE INDEX IF NOT EXISTS "fiscal_operation_events_declaration_created_idx"
  ON "fiscal_operation_events"("declaration_id", "created_at");

CREATE INDEX IF NOT EXISTS "fiscal_operation_events_close_created_idx"
  ON "fiscal_operation_events"("close_session_id", "created_at");

CREATE INDEX IF NOT EXISTS "fiscal_operation_events_evidence_created_idx"
  ON "fiscal_operation_events"("evidence_id", "created_at");

CREATE INDEX IF NOT EXISTS "fiscal_operation_events_type_created_idx"
  ON "fiscal_operation_events"("event_type", "created_at");
