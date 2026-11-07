-- Visual builder and live experience of Flows (flujos-adm P5).
-- P5.5: optional branch (sede = inventory location of the store) per request,
--   to filter the multi-flow board.
-- P5.2: variables snapshot per timeline event, for the instance debugger.
-- P5.6: NOTIFY on the "workflow_live" channel when a request event or a task
--   is written, so connected screens refresh without reloading. NOTIFY is
--   delivered only on COMMIT, so listeners never see uncommitted work. The
--   payload carries ids only (store, instance, task), never data.
--
-- DATA IMPACT:
-- Tables affected: workflow_instances (new nullable column), workflow_instance_events
--   (new nullable column), workflow_tasks (trigger only)
-- Expected row changes: none (new columns are NULL for existing rows)
-- Destructive operations: none
-- FK/cascade risk: none. workflow_instances.location_id -> inventory_locations
--   ON DELETE SET NULL (deleting a location never touches requests).
-- Idempotency: guarded by IF NOT EXISTS / pg_constraint / pg_trigger checks;
--   functions use CREATE OR REPLACE.

ALTER TABLE "workflow_instances"
  ADD COLUMN IF NOT EXISTS "location_id" INTEGER;

ALTER TABLE "workflow_instance_events"
  ADD COLUMN IF NOT EXISTS "data_snapshot" JSONB;

CREATE INDEX IF NOT EXISTS "workflow_instances_store_id_location_id_status_idx"
  ON "workflow_instances"("store_id", "location_id", "status");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workflow_instances_location_id_fkey'
  ) THEN
    ALTER TABLE "workflow_instances"
      ADD CONSTRAINT "workflow_instances_location_id_fkey"
      FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "workflow_live_notify_event"() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('workflow_live', json_build_object(
    'store_id', NEW."store_id",
    'instance_id', NEW."instance_id",
    'kind', 'event'
  )::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "workflow_live_notify_task"() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('workflow_live', json_build_object(
    'store_id', NEW."store_id",
    'instance_id', NEW."instance_id",
    'task_id', NEW."id",
    'kind', 'task'
  )::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workflow_instance_events_live_trg') THEN
    CREATE TRIGGER "workflow_instance_events_live_trg"
      AFTER INSERT ON "workflow_instance_events"
      FOR EACH ROW EXECUTE FUNCTION "workflow_live_notify_event"();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workflow_tasks_live_trg') THEN
    CREATE TRIGGER "workflow_tasks_live_trg"
      AFTER INSERT OR UPDATE ON "workflow_tasks"
      FOR EACH ROW EXECUTE FUNCTION "workflow_live_notify_task"();
  END IF;
END $$;
