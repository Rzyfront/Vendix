-- QUI-1060 F3 · Actividades del plan → tareas del CRM + proveedores registrados.
-- 1) service_plan_activities.supplier_id: el tercero puede ser un proveedor registrado.
-- 2) service_plan_booking_tasks: enlace reserva × actividad → tarea CRM; el UNIQUE
--    (booking_id, activity_id) impide duplicar tareas al reconfirmar o reintentar.
--
-- DATA IMPACT:
-- Tables affected: service_plan_activities (new nullable column supplier_id, owner
--                  CHECK replaced by an equivalent one that also covers supplier_id),
--                  service_plan_booking_tasks (new)
-- Expected row changes: none (no UPDATE/DELETE; supplier_id starts NULL everywhere,
--                  so every existing row already satisfies the new CHECK)
-- Destructive operations: none (only the old CHECK constraint is dropped, after its
--                  stricter replacement is in place; no data dropped)
-- FK/cascade risk: no CASCADE. supplier_id → suppliers ON DELETE SET NULL (the name and
--                  contact stay copied on the activity); booking → bookings(store_id, id)
--                  and store → stores ON DELETE RESTRICT; activity_id → activities and
--                  crm_task_id → crm_tasks ON DELETE SET NULL (the task history stays).
-- Idempotency: ADD COLUMN / CREATE TABLE / CREATE INDEX IF NOT EXISTS, constraints
--              guarded by pg_constraint, DROP CONSTRAINT IF EXISTS. No ALTER TYPE.
-- Approval: plan QUI-1060 approved by Rafael (decisions 24-nov), additive only

ALTER TABLE "service_plan_activities" ADD COLUMN IF NOT EXISTS "supplier_id" INTEGER;

CREATE INDEX IF NOT EXISTS "service_plan_activities_supplier_id_idx"
  ON "service_plan_activities"("supplier_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_activities_supplier_fkey') THEN
    ALTER TABLE "service_plan_activities" ADD CONSTRAINT "service_plan_activities_supplier_fkey"
      FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  -- Responsable interno o tercero (registrado o escrito a mano), nunca los dos.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_activities_owner_xor_check') THEN
    ALTER TABLE "service_plan_activities" ADD CONSTRAINT "service_plan_activities_owner_xor_check"
      CHECK ("provider_id" IS NULL
         OR ("supplier_id" IS NULL AND "supplier_name" IS NULL AND "supplier_contact" IS NULL));
  END IF;
END $$;

-- La nueva regla incluye a la anterior: la vieja ya no aporta nada.
ALTER TABLE "service_plan_activities" DROP CONSTRAINT IF EXISTS "service_plan_activities_owner_check";

CREATE TABLE IF NOT EXISTS "service_plan_booking_tasks" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "booking_id" INTEGER NOT NULL,
  "activity_id" INTEGER,
  "crm_task_id" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_plan_booking_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_plan_booking_tasks_booking_activity_key"
  ON "service_plan_booking_tasks"("booking_id", "activity_id");
CREATE INDEX IF NOT EXISTS "service_plan_booking_tasks_store_booking_idx"
  ON "service_plan_booking_tasks"("store_id", "booking_id");
CREATE INDEX IF NOT EXISTS "service_plan_booking_tasks_activity_id_idx"
  ON "service_plan_booking_tasks"("activity_id");
CREATE INDEX IF NOT EXISTS "service_plan_booking_tasks_crm_task_id_idx"
  ON "service_plan_booking_tasks"("crm_task_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_booking_tasks_store_fkey') THEN
    ALTER TABLE "service_plan_booking_tasks" ADD CONSTRAINT "service_plan_booking_tasks_store_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  -- Compuesta: la reserva pertenece a la misma tienda del enlace.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_booking_tasks_booking_fkey') THEN
    ALTER TABLE "service_plan_booking_tasks" ADD CONSTRAINT "service_plan_booking_tasks_booking_fkey"
      FOREIGN KEY ("store_id", "booking_id") REFERENCES "bookings"("store_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_booking_tasks_activity_fkey') THEN
    ALTER TABLE "service_plan_booking_tasks" ADD CONSTRAINT "service_plan_booking_tasks_activity_fkey"
      FOREIGN KEY ("activity_id") REFERENCES "service_plan_activities"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_booking_tasks_crm_task_fkey') THEN
    ALTER TABLE "service_plan_booking_tasks" ADD CONSTRAINT "service_plan_booking_tasks_crm_task_fkey"
      FOREIGN KEY ("crm_task_id") REFERENCES "crm_tasks"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
