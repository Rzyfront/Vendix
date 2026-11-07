-- Approval gate of Flows (flujos-adm P1.3): a sensitive operation governed by a
-- flow waits in `workflow_approval_gates` until its request is approved,
-- rejected or cancelled. Additive only: a new enum and a new table.
--
-- DATA IMPACT: none. No existing row changes.
--   Destructive operations: none.
--   FK/cascade risk: none. The new FKs point from the new table to stores and
--     workflow_definitions (RESTRICT) and workflow_instances (SET NULL).
--   Idempotency: guarded by pg_type / IF NOT EXISTS / pg_constraint checks.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_gate_status_enum') THEN
    CREATE TYPE "workflow_gate_status_enum" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "workflow_approval_gates" (
  "id" SERIAL NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER NOT NULL,
  "definition_id" INTEGER NOT NULL,
  "instance_id" INTEGER,
  "operation" VARCHAR(60) NOT NULL,
  "entity_type" VARCHAR(40) NOT NULL,
  "entity_id" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "amount" DECIMAL(18,2),
  "status" "workflow_gate_status_enum" NOT NULL DEFAULT 'pending',
  "reason" TEXT,
  "context" JSONB NOT NULL DEFAULT '{}',
  "request" JSONB,
  "requested_by_user_id" INTEGER,
  "resolved_at" TIMESTAMP(6),
  "consumed_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_approval_gates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "workflow_approval_gates" ADD COLUMN IF NOT EXISTS "request" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_approval_gates_store_id_operation_entity_id_revisi_key"
  ON "workflow_approval_gates"("store_id", "operation", "entity_id", "revision");
CREATE INDEX IF NOT EXISTS "workflow_approval_gates_store_id_entity_type_entity_id_idx"
  ON "workflow_approval_gates"("store_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "workflow_approval_gates_instance_id_idx"
  ON "workflow_approval_gates"("instance_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_approval_gates_store_id_fkey') THEN
    ALTER TABLE "workflow_approval_gates" ADD CONSTRAINT "workflow_approval_gates_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_approval_gates_definition_id_fkey') THEN
    ALTER TABLE "workflow_approval_gates" ADD CONSTRAINT "workflow_approval_gates_definition_id_fkey"
      FOREIGN KEY ("definition_id") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_approval_gates_instance_id_fkey') THEN
    ALTER TABLE "workflow_approval_gates" ADD CONSTRAINT "workflow_approval_gates_instance_id_fkey"
      FOREIGN KEY ("instance_id") REFERENCES "workflow_instances"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
