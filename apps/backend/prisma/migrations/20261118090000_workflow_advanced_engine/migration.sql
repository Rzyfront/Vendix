-- Advanced engine of Flows (flujos-adm P2): on/off switch per flow (P2.11),
-- loop counters (P2.4), subflow parent links (P2.2) and parallel branch tasks
-- (P2.1). Additive only: new nullable or defaulted columns, one FK and indexes.
--
-- DATA IMPACT: none. No existing row changes beyond the column defaults
--   (`is_enabled` = true keeps every flow on; `runtime` = '{}').
--   Destructive operations: none.
--   FK/cascade risk: none. `workflow_instances.parent_instance_id` points to
--     workflow_instances with ON DELETE SET NULL (requests are never deleted).
--   Idempotency: guarded by IF NOT EXISTS / pg_constraint checks.

ALTER TABLE "workflow_definitions"
  ADD COLUMN IF NOT EXISTS "is_enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "workflow_instances"
  ADD COLUMN IF NOT EXISTS "runtime" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "workflow_instances"
  ADD COLUMN IF NOT EXISTS "parent_instance_id" INTEGER;
ALTER TABLE "workflow_instances"
  ADD COLUMN IF NOT EXISTS "parent_stage_key" VARCHAR(80);
ALTER TABLE "workflow_instances"
  ADD COLUMN IF NOT EXISTS "parent_entry_seq" INTEGER;

ALTER TABLE "workflow_tasks"
  ADD COLUMN IF NOT EXISTS "branch_key" VARCHAR(80);

CREATE INDEX IF NOT EXISTS "workflow_instances_store_id_parent_instance_id_idx"
  ON "workflow_instances"("store_id", "parent_instance_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_instances_parent_instance_id_fkey') THEN
    ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_parent_instance_id_fkey"
      FOREIGN KEY ("parent_instance_id") REFERENCES "workflow_instances"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
