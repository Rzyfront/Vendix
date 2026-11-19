-- CRM tasks: support people and "this task moves the opportunity".
--
-- DATA IMPACT:
--   Tables affected:
--     crm_tasks: new nullable column move_to_stage_id + index + FK to
--       crm_pipeline_stages ON DELETE SET NULL (metadata-only add, no table
--       rewrite). Existing tasks keep NULL: they move nothing, as today.
--     crm_task_assignees (NEW): support people of a task. Existing tasks
--       start with none.
--   Expected row changes: 0. No DML (no INSERT/UPDATE/DELETE).
--   Destructive operations: none. No DROP, no TRUNCATE.
--   FK/cascade risk: crm_task_assignees is a join table with no children;
--     its task_id -> crm_tasks and user_id -> users are ON DELETE CASCADE, so
--     deleting a task or a user only removes these link rows, never business
--     data. store_id -> stores ON DELETE RESTRICT. crm_tasks.move_to_stage_id
--     -> crm_pipeline_stages ON DELETE SET NULL (the task survives, it just
--     stops moving the opportunity).
--   Idempotency: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS
--     and FKs guarded with pg_constraint. Running it twice is a no-op.
--   Approval: additive schema of odd/tasks/crm-tareas-oportunidad-apoyo.md
--     (Rafael, 2026-11-19).

-- 1. Target stage of the linked opportunity when the task is completed.
ALTER TABLE "crm_tasks"
    ADD COLUMN IF NOT EXISTS "move_to_stage_id" INTEGER;

CREATE INDEX IF NOT EXISTS "crm_tasks_move_to_stage_id_idx"
    ON "crm_tasks"("move_to_stage_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_tasks_move_to_stage_id_fkey') THEN
    ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_move_to_stage_id_fkey" FOREIGN KEY ("move_to_stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- 2. Support people of a task (the assignee stays one: assigned_user_id).
CREATE TABLE IF NOT EXISTS "crm_task_assignees" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "task_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_task_assignees_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_task_assignees_task_id_user_id_key"
    ON "crm_task_assignees"("task_id", "user_id");

CREATE INDEX IF NOT EXISTS "crm_task_assignees_store_id_user_id_idx"
    ON "crm_task_assignees"("store_id", "user_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_task_assignees_store_id_fkey') THEN
    ALTER TABLE "crm_task_assignees" ADD CONSTRAINT "crm_task_assignees_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_task_assignees_task_id_fkey') THEN
    ALTER TABLE "crm_task_assignees" ADD CONSTRAINT "crm_task_assignees_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "crm_tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_task_assignees_user_id_fkey') THEN
    ALTER TABLE "crm_task_assignees" ADD CONSTRAINT "crm_task_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
