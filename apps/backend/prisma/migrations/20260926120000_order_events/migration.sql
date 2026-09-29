-- DATA IMPACT: ninguno (solo CREATE TABLE e índices)
-- Tables affected: order_events (NUEVA). Ninguna tabla existente se altera.
-- Existing row changes: ninguno; tabla vacía al aplicar, sin backfill desde audit_logs.
-- Destructive operations: ninguna; no hay DROP, DELETE, UPDATE, TRUNCATE ni CASCADE.
-- FK/cascade risk: ninguno. order_id -> orders (RESTRICT), store_id -> stores (RESTRICT),
--   organization_id -> organizations (RESTRICT), actor_user_id -> users (SET NULL).
--   payment_id y order_item_id son columnas de correlación SIN FK a propósito (el evento
--   debe sobrevivir si el pago o el ítem referenciado se reescribe/elimina).
-- Idempotency: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, FKs guardadas con
--   DO $$ ... pg_constraint ... para poder reintentar la migración sin error.
-- Approval: plan aprobado "order-truth-and-invoice-tz", Objetivo específico 5 (historial
--   veraz de órdenes en tabla dedicada, escrita por un único servicio).

-- CreateTable
CREATE TABLE IF NOT EXISTS "order_events" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "organization_id" INTEGER,
    "order_id" INTEGER NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "from_state" "order_state_enum",
    "to_state" "order_state_enum",
    "actor_user_id" INTEGER,
    "actor_source" VARCHAR(20) NOT NULL,
    "payment_id" INTEGER,
    "order_item_id" INTEGER,
    "amount" DECIMAL(12,2),
    "payload" JSONB,
    "request_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_events_store_id_created_at_idx" ON "order_events"("store_id", "created_at");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_events_store_id_fkey' AND conrelid = '"order_events"'::regclass) THEN
    ALTER TABLE "order_events" ADD CONSTRAINT "order_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_events_organization_id_fkey' AND conrelid = '"order_events"'::regclass) THEN
    ALTER TABLE "order_events" ADD CONSTRAINT "order_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_events_order_id_fkey' AND conrelid = '"order_events"'::regclass) THEN
    ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_events_actor_user_id_fkey' AND conrelid = '"order_events"'::regclass) THEN
    ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
