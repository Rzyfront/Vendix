-- DATA IMPACT:
-- Tables affected: creates lodging_housekeeping_tasks (empty) and the enums
--   lodging_housekeeping_task_type_enum and lodging_housekeeping_task_status_enum.
-- Expected row changes: none. No existing table or row is modified.
-- Destructive operations: none.
-- FK/cascade risk: none. New FKs use ON DELETE RESTRICT.
-- Idempotency: guarded CREATE TYPE, CREATE TABLE/INDEX IF NOT EXISTS and guarded constraints.
-- Approval: hospitality plan, slice H5.2 (owner decisions 2026-10-26).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lodging_housekeeping_task_type_enum') THEN
    CREATE TYPE "lodging_housekeeping_task_type_enum" AS ENUM ('checkout_clean', 'stayover', 'inspection', 'maintenance');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lodging_housekeeping_task_status_enum') THEN
    CREATE TYPE "lodging_housekeeping_task_status_enum" AS ENUM ('pending', 'done');
  END IF;
END $$;

-- Room task of the day, assigned to a housekeeper. One task per room, day and
-- type: the daily generation is idempotent on this key.
CREATE TABLE IF NOT EXISTS "lodging_housekeeping_tasks" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "task_date" DATE NOT NULL,
    "type" "lodging_housekeeping_task_type_enum" NOT NULL,
    "status" "lodging_housekeeping_task_status_enum" NOT NULL DEFAULT 'pending',
    "assigned_user_id" INTEGER,
    "notes" VARCHAR(500),
    "completed_at" TIMESTAMP(6),
    "completed_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_housekeeping_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_housekeeping_tasks_store_id_unit_id_task_date_type_key"
  ON "lodging_housekeeping_tasks"("store_id", "unit_id", "task_date", "type");
CREATE INDEX IF NOT EXISTS "lodging_housekeeping_tasks_store_id_task_date_assigned_user_id_idx"
  ON "lodging_housekeeping_tasks"("store_id", "task_date", "assigned_user_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_housekeeping_tasks_store_id_fkey') THEN
    ALTER TABLE "lodging_housekeeping_tasks" ADD CONSTRAINT "lodging_housekeeping_tasks_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_housekeeping_tasks_unit_id_fkey') THEN
    ALTER TABLE "lodging_housekeeping_tasks" ADD CONSTRAINT "lodging_housekeeping_tasks_unit_id_fkey"
      FOREIGN KEY ("unit_id") REFERENCES "lodging_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
