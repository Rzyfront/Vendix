-- DATA IMPACT:
-- Tables affected: accounting_entry_failures (NEW table, created empty)
-- Expected row changes: none (additive DDL only)
-- Destructive operations: none
-- FK/cascade risk: none (no foreign keys; plain org/store id columns by design)
-- Idempotency: guarded by IF NOT EXISTS on table and indexes
-- Approval: mini-plan aprobado (observabilidad de asientos automáticos fallidos)

CREATE TABLE IF NOT EXISTS "accounting_entry_failures" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER,
    "handler_key" VARCHAR(80) NOT NULL,
    "source_type" VARCHAR(50),
    "source_id" INTEGER,
    "event_payload" JSONB NOT NULL,
    "error_message" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "resolved_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_entry_failures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "accounting_entry_failures_organization_id_resolved_at_idx"
    ON "accounting_entry_failures"("organization_id", "resolved_at");

CREATE INDEX IF NOT EXISTS "accounting_entry_failures_source_type_source_id_idx"
    ON "accounting_entry_failures"("source_type", "source_id");
