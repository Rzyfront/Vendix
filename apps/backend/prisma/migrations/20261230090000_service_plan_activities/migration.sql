-- QUI-1060 F2 · Itinerario del plan: actividades por día de un servicio tipo paquete.
-- Incluye ya las columnas que F3 usará para tareas (responsable, costo, creates_task)
-- para no migrar dos veces.
--
-- DATA IMPACT:
-- Tables affected: service_plan_activities (new)
-- Expected row changes: none (new empty table)
-- Destructive operations: none
-- FK/cascade risk: store, (store_id, product_id) and (store_id, provider_id) FKs are
--                  ON DELETE RESTRICT; no CASCADE
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS, constraints guarded by pg_constraint.
--              No ALTER TYPE ... ADD VALUE.
-- Approval: plan QUI-1060 approved by Rafael (decisions 24-nov), additive only

CREATE TABLE IF NOT EXISTS "service_plan_activities" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "product_id" INTEGER NOT NULL,
  "day_number" INTEGER NOT NULL,
  "start_time" VARCHAR(5),
  "title" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "provider_id" INTEGER,
  "supplier_name" VARCHAR(200),
  "supplier_contact" VARCHAR(200),
  "cost" DECIMAL(12,2),
  "creates_task" BOOLEAN NOT NULL DEFAULT false,
  "is_public" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_plan_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "service_plan_activities_store_product_day_order_idx"
  ON "service_plan_activities"("store_id", "product_id", "day_number", "sort_order");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_activities_values_check') THEN
    ALTER TABLE "service_plan_activities" ADD CONSTRAINT "service_plan_activities_values_check"
      CHECK ("day_number" >= 1
         AND ("cost" IS NULL OR "cost" >= 0)
         AND ("start_time" IS NULL OR "start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'));
  END IF;
  -- Responsable interno o tercero, nunca los dos.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_activities_owner_check') THEN
    ALTER TABLE "service_plan_activities" ADD CONSTRAINT "service_plan_activities_owner_check"
      CHECK ("provider_id" IS NULL OR ("supplier_name" IS NULL AND "supplier_contact" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_activities_store_fkey') THEN
    ALTER TABLE "service_plan_activities" ADD CONSTRAINT "service_plan_activities_store_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_activities_product_fkey') THEN
    ALTER TABLE "service_plan_activities" ADD CONSTRAINT "service_plan_activities_product_fkey"
      FOREIGN KEY ("store_id", "product_id") REFERENCES "products"("store_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  -- Compuesta: el responsable interno pertenece a la misma tienda.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_plan_activities_provider_fkey') THEN
    ALTER TABLE "service_plan_activities" ADD CONSTRAINT "service_plan_activities_provider_fkey"
      FOREIGN KEY ("store_id", "provider_id") REFERENCES "service_providers"("store_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
